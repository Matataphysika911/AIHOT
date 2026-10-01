export interface StorageEnv {
  DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  R2_BUCKET_NAME?: string;
  RAW_RETENTION_DAYS?: string;
  R2_FREE_BYTES?: string;
  R2_WARNING_PERCENT?: string;
  R2_CRITICAL_PERCENT?: string;
  R2_CLEANUP_PERCENT?: string;
  R2_SCAN_MAX_PAGES?: string;
  R2_DELETE_MAX_OBJECTS?: string;
}

export function storagePolicy(env: StorageEnv) {
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    if (value === undefined) return fallback;
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid storage policy');
    return n;
  };
  const policy = {
    retentionDays: positive(env.RAW_RETENTION_DAYS, 60),
    freeBytes: positive(env.R2_FREE_BYTES, 10_000_000_000),
    warning: positive(env.R2_WARNING_PERCENT, 70),
    critical: positive(env.R2_CRITICAL_PERCENT, 85),
    cleanup: positive(env.R2_CLEANUP_PERCENT, 90),
    maxPages: Math.floor(positive(env.R2_SCAN_MAX_PAGES, 20)),
    maxDeletes: Math.floor(positive(env.R2_DELETE_MAX_OBJECTS, 100)),
  };
  if (!(policy.warning < policy.critical && policy.critical < policy.cleanup && policy.cleanup <= 100)
      || policy.maxPages > 100 || policy.maxDeletes > 200 || policy.maxPages < 1 || policy.maxDeletes < 1) {
    throw new Error('Invalid storage policy limits');
  }
  return policy;
}

// Both upload age and a valid raw/YYYY/MM/DD/ key must expire. A backdated key
// alone must never delete a newly uploaded object. Reserved prefixes never match.
export function expiredRaw(object: Pick<R2Object, 'key' | 'uploaded'>, cutoff: number): boolean {
  const match = /^raw\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(object.key);
  if (!match) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date
    && stamp + 86_400_000 <= cutoff && object.uploaded.getTime() < cutoff;
}

export async function inventory(env: StorageEnv, now: number) {
  const policy = storagePolicy(env);
  let bytes = 0, objects = 0, cursor: string | undefined;
  const expired: R2Object[] = [];
  for (let page = 0; page < policy.maxPages; page++) {
    const result = await env.RAW_ARCHIVE.list({ limit: 1000, cursor });
    for (const object of result.objects) {
      bytes += object.size;
      objects++;
      if (expired.length < policy.maxDeletes && expiredRaw(object, now - policy.retentionDays * 86_400_000)) expired.push(object);
    }
    if (!result.truncated) return { bytes, objects, complete: true, expired };
    cursor = result.cursor;
  }
  return { bytes, objects, complete: false, expired };
}

export async function providerMetrics(env: StorageEnv, now: number) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return { available: false, reason: 'analytics_token_not_configured', billingGbMonth: null };
  }
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        query: `query Storage($account: String, $filter: R2StorageAdaptiveGroupsFilter_InputObject) {
          viewer { accounts(filter: {accountTag: $account}) {
            r2StorageAdaptiveGroups(limit: 10000, filter: $filter, orderBy: [datetime_DESC]) {
              max { payloadSize metadataSize objectCount uploadCount }
              dimensions { bucketName datetime }
            }
          } }
        }`,
        variables: { account: env.CF_ACCOUNT_ID, filter: {datetime_geq: new Date(now - 2 * 86_400_000).toISOString(), datetime_leq: new Date(now).toISOString()} },
      }),
    });
    const data = await response.json() as any;
    if (!response.ok || data.errors?.length) throw new Error(`Analytics unavailable (HTTP ${response.status}, ${data.errors?.[0]?.message ?? 'no details'})`);
    const rows = data.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
    if (!Array.isArray(rows) || !rows.length) throw new Error('Analytics has no samples');
    const buckets = new Map<string, any>();
    for (const row of rows) if (!buckets.has(row.dimensions.bucketName)) buckets.set(row.dimensions.bucketName, row);
    const samples = [...buckets.values()];
    const bytes = samples.reduce((sum, row) => sum + Number(row.max.payloadSize) + Number(row.max.metadataSize), 0);
    if (!Number.isFinite(bytes)) throw new Error('Invalid analytics size');
    return {
      available: true, source: 'cloudflare_graphql', scope: 'account_latest_observed_buckets',
      bytes, buckets: samples, billingGbMonth: null,
      caveat: 'Delayed samples, not an invoice or a complete account inventory. Free tier is shared account-wide; GB-month and operation quotas require billing/operations metrics.',
    };
  } catch (error) {
    return { available: false, reason: String(error).slice(0, 1000), billingGbMonth: null };
  }
}

export function storageLevel(percent: number, complete: boolean, policy: ReturnType<typeof storagePolicy>) {
  if (percent >= policy.critical) return 'critical';
  if (percent >= policy.warning) return 'warning';
  return complete ? 'ok' : 'unknown';
}

async function recordMetric(env: StorageEnv, scan: Awaited<ReturnType<typeof inventory>>, provider: Awaited<ReturnType<typeof providerMetrics>>) {
  const policy = storagePolicy(env);
  const percent = Math.max(scan.bytes, provider.available ? provider.bytes! : 0) / policy.freeBytes * 100;
  const status = storageLevel(percent, scan.complete, policy);
  await env.DB.prepare(`INSERT INTO storage_metrics VALUES(?,?,?,?,?,?,?,?)`).bind(
    crypto.randomUUID(), new Date().toISOString(), JSON.stringify(provider), scan.bytes, scan.objects, scan.complete ? 1 : 0, status, percent,
  ).run();
  if (status !== 'ok') console.warn('R2 storage alert', { status, percent, complete: scan.complete });
  return { status, percent };
}

export async function maintainStorage(env: StorageEnv, dryRun = false) {
  const policy = storagePolicy(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  const started = new Date(now).toISOString();
  const lock = await env.DB.prepare(`INSERT INTO maintenance_locks(name,owner,expires_at) VALUES('storage',?,?)
    ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
    WHERE maintenance_locks.expires_at < ?`).bind(id, new Date(now + 30 * 60_000).toISOString(), started).run();
  if (!lock.meta.changes) return { ok: false, reason: 'maintenance_already_running' };
  let deleted = 0, deletedBytes = 0;
  try {
    await env.DB.prepare(`INSERT INTO maintenance_runs(id,started_at,status,retention_days) VALUES(?,?,'running',?)`).bind(id, started, policy.retentionDays).run();
    const provider = await providerMetrics(env, now);
    const before = await inventory(env, now);
    const metric = await recordMetric(env, before, provider);
    await env.DB.prepare(`UPDATE maintenance_runs SET before_bytes=?,before_objects=? WHERE id=?`).bind(before.bytes, before.objects, id).run();
    // Daily retention applies even below thresholds; pressure never reduces retention.
    // Incomplete inventories are observable lower bounds and are never used to delete.
    if (!dryRun && before.complete) {
      for (const object of before.expired) {
        // Recheck replacements after listing. Raw archive keys are immutable in ingestion.
        const current = await env.RAW_ARCHIVE.head(object.key);
        if (!current || current.etag !== object.etag || !expiredRaw(current, now - policy.retentionDays * 86_400_000)) continue;
        await env.RAW_ARCHIVE.delete(object.key);
        deleted++;
        deletedBytes += current.size;
        await env.DB.prepare('UPDATE maintenance_runs SET deleted_count=?,deleted_bytes=? WHERE id=?').bind(deleted, deletedBytes, id).run();
      }
    }
    const after = deleted ? await inventory(env, Date.now()) : before;
    // Keep provider's delayed pre-cleanup snapshot separate from the immediate R2 scan.
    const afterMetric = deleted ? await recordMetric(env, after, provider) : metric;
    const details = {
      dryRun, eligibleObjects: before.expired.length, inventoryComplete: before.complete,
      afterInventoryComplete: after.complete, provider, metric: afterMetric,
      pressureCleanup: metric.percent >= policy.cleanup, cleanupTargetPercent: policy.critical,
      pressureUnresolved: afterMetric.percent >= policy.critical,
      deletionLimitReached: deleted >= policy.maxDeletes,
    };
    const status = before.complete && after.complete ? (dryRun ? 'dry_run' : 'success') : 'incomplete';
    await env.DB.prepare(`UPDATE maintenance_runs SET finished_at=?,status=?,after_bytes=?,after_objects=?,deleted_count=?,deleted_bytes=?,details_json=? WHERE id=?`).bind(
      new Date().toISOString(), status, after.bytes, after.objects, deleted, deletedBytes, JSON.stringify(details), id,
    ).run();
    return { ok: status !== 'incomplete', id, status, before: { bytes: before.bytes, objects: before.objects }, after: { bytes: after.bytes, objects: after.objects }, deleted, ...details };
  } catch (error) {
    await env.DB.prepare(`UPDATE maintenance_runs SET finished_at=?,status='failed',deleted_count=?,deleted_bytes=?,error=? WHERE id=?`).bind(
      new Date().toISOString(), deleted, deletedBytes, String(error).slice(0, 1000), id,
    ).run();
    throw error;
  } finally {
    await env.DB.prepare(`DELETE FROM maintenance_locks WHERE name='storage' AND owner=?`).bind(id).run();
  }
}

export async function storageStatus(env: StorageEnv) {
  const [latest, run] = await Promise.all([
    env.DB.prepare('SELECT * FROM storage_metrics ORDER BY measured_at DESC LIMIT 1').first<any>(),
    env.DB.prepare('SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 1').first<any>(),
  ]);
  return {
    policy: storagePolicy(env), latest, lastMaintenance: run,
    stale: !latest || Date.now() - Date.parse(latest.measured_at) > 30 * 3_600_000,
    quotaScope: 'account-wide GB-month; inventory is current bucket payload bytes',
    accountBillingQuotaStatus: 'unknown; current bytes do not establish monthly billing or other-bucket coverage',
    notifications: 'D1 status and Worker warning logs; Dashboard must poll /admin/storage/status',
  };
}
