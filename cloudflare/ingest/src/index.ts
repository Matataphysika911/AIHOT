import { enqueueNew, recoverDue, processTask, manualProcessing, intelligenceHealth, type IntelligenceEnv, type ProcessingJob } from "./intelligence";
import { ProviderError } from "./provider";
import { XMLParser } from "fast-xml-parser";
import { maintainStorage, storageStatus, type StorageEnv } from "./storage";

type SourceKind = "rss" | "json_list" | "web_list" | "external";

interface Env extends StorageEnv, IntelligenceEnv {
  DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
  SOURCE_QUEUE: Queue<SourceJob>;
  ADMIN_TOKEN: string;
  OLD_NEWS_HOURS?: string;
  DEFAULT_FETCH_MINUTES?: string;
}

interface SourceJob {
  sourceId: string;
}

interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  config_json: string;
  tier: string;
  first_party: number;
  owner_entity_id: string | null;
  participation_mode: string;
  interval_minutes: number;
  consecutive_failures: number;
  initialized_at: string | null;
}

interface NormalizedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
  author: string | null;
  externalId: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const [sources, articles24h, failed24h] = await Promise.all([
        env.DB.prepare(`SELECT
          count(*) AS total,
          sum(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled,
          sum(CASE WHEN health='ok' THEN 1 ELSE 0 END) AS healthy,
          sum(CASE WHEN health='degraded' THEN 1 ELSE 0 END) AS degraded,
          sum(CASE WHEN health='failing' THEN 1 ELSE 0 END) AS failing
          FROM sources`).first(),
        env.DB.prepare("SELECT count(*) AS count FROM articles WHERE datetime(discovered_at) >= datetime('now','-24 hours')").first(),
        env.DB.prepare("SELECT count(*) AS count FROM collection_runs WHERE status='failed' AND datetime(started_at) >= datetime('now','-24 hours')").first(),
      ]);
      return Response.json({
        ok: true,
        service: "uprivate-intelligence-ingest",
        sources,
        articles24h,
        failedRuns24h: failed24h,
        storage: await storageStatus(env),
        intelligence: await intelligenceHealth(env),
        lastScheduled: await env.DB.prepare('SELECT cron,scheduled_at,finished_at,status,error FROM scheduler_runs ORDER BY started_at DESC LIMIT 1').first(),
      });
    }

    if (url.pathname.startsWith("/admin/processing/")) {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      try { return await manualProcessing(request, env); } catch { return Response.json({error:"processing_request_failed"}, {status:400}); }
    }

    if (url.pathname === "/admin/storage/status" && request.method === "GET") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return Response.json(await storageStatus(env));
    }

    if (url.pathname === "/admin/storage/check" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const body = await request.json<{ dryRun?: boolean }>();
      return Response.json(await maintainStorage(env, body.dryRun !== false));
    }

    if (url.pathname === "/admin/sources/sync" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const payload = await request.json<{ sources?: unknown[] }>();
      if (!Array.isArray(payload.sources)) {
        return Response.json({ ok: false, error: "sources must be an array" }, { status: 400 });
      }
      const result = await syncSources(env, payload.sources);
      return Response.json({ ok: true, ...result });
    }

    if (url.pathname === "/admin/collect" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const body = await request.json<{ sourceId?: string }>();
      if (!body.sourceId) {
        return Response.json({ ok: false, error: "sourceId is required" }, { status: 400 });
      }
      await env.SOURCE_QUEUE.send({ sourceId: body.sourceId });
      return Response.json({ ok: true, queued: body.sourceId });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller, env));
  },

  async queue(batch: MessageBatch<SourceJob | ProcessingJob>, env: Env): Promise<void> {
    if (batch.queue === "uprivate-processing-jobs") {
      for (const message of batch.messages) {
        try { await processTask(env, (message.body as ProcessingJob).taskId); message.ack(); }
        catch (error) {
          if (error instanceof ProviderError && error.disposition !== "retry") message.ack();
          else message.retry({delaySeconds:300});
        }
      }
      return;
    }
    for (const message of batch.messages) {
      try {
        await collectSource(env, (message.body as SourceJob).sourceId);
        message.ack();
      } catch (error) {
        console.error("collection failed", (message.body as SourceJob).sourceId, error);
        const state = await env.DB.prepare('SELECT next_fetch_at FROM sources WHERE id=?').bind((message.body as SourceJob).sourceId).first<{ next_fetch_at: string }>();
        const delaySeconds = Math.max(60, Math.min(43200, Math.ceil((Date.parse(state?.next_fetch_at ?? '') - Date.now()) / 1000) || 60));
        console.warn('collection retry scheduled', { sourceId: (message.body as SourceJob).sourceId, delaySeconds, attempts: message.attempts });
        message.retry({ delaySeconds });
      }
    }
  },
} satisfies ExportedHandler<Env, SourceJob | ProcessingJob>;

async function runScheduled(controller: ScheduledController, env: Env) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO scheduler_runs(id,cron,scheduled_at,started_at,status) VALUES(?,?,?,?,'running')`).bind(
    id, controller.cron, new Date(controller.scheduledTime).toISOString(), new Date().toISOString(),
  ).run();
  try {
    if (controller.cron === '35 20 * * *') await maintainStorage(env);
    else if (controller.cron === '20 20 * * *') await adaptIntervals(env);
    else {
      await enqueueDueSources(env);
      // Processing outages must never change the source scheduler outcome. D1 is the durable outbox.
      try { await recoverDue(env); await enqueueNew(env); }
      catch { console.error("intelligence dispatch failed; will recover next Cron"); }
    }
    await env.DB.prepare("UPDATE scheduler_runs SET finished_at=?,status='success' WHERE id=?").bind(new Date().toISOString(), id).run();
  } catch (error) {
    await env.DB.prepare("UPDATE scheduler_runs SET finished_at=?,status='failed',error=? WHERE id=?").bind(new Date().toISOString(), String(error).slice(0,1000), id).run();
    throw error;
  }
}

function authorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("authorization");
  return Boolean(env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`);
}

async function enqueueDueSources(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT id FROM sources
     WHERE enabled = 1
       AND kind IN ('rss','json_list','web_list')
       AND (next_fetch_at IS NULL OR next_fetch_at <= ?)
     ORDER BY COALESCE(next_fetch_at, '1970-01-01T00:00:00Z')
     LIMIT 100`,
  ).bind(now).all<{ id: string }>();

  if (!due.results.length) return;
  await env.SOURCE_QUEUE.sendBatch(
    due.results.map((row) => ({ body: { sourceId: row.id } })),
  );
}

async function collectSource(env: Env, sourceId: string): Promise<void> {
  const source = await env.DB.prepare(
    `SELECT id,name,kind,config_json,tier,first_party,owner_entity_id,
            participation_mode,interval_minutes,consecutive_failures,initialized_at
       FROM sources WHERE id = ? AND enabled = 1`,
  ).bind(sourceId).first<SourceRow>();

  if (!source) return;

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO collection_runs(id,source_id,started_at,status)
     VALUES(?,?,?,'running')`,
  ).bind(runId, source.id, startedAt).run();

  try {
    const config = JSON.parse(source.config_json) as Record<string, unknown>;
    const response = await fetchSource(source.kind, config);
    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`upstream HTTP ${response.status}`);
    }

    const archiveKey = rawArchiveKey(source.id, startedAt, source.kind);
    await env.RAW_ARCHIVE.put(archiveKey, rawText, {
      httpMetadata: { contentType: response.headers.get("content-type") ?? "text/plain" },
      customMetadata: { sourceId: source.id, fetchedAt: startedAt },
    });

    let items =
      source.kind === "rss"
        ? parseFeed(rawText)
        : source.kind === "json_list"
          ? parseJsonList(rawText, config)
          : source.kind === "web_list"
            ? await parseWebList(rawText, config)
            : [];

    const firstImport = !source.initialized_at;
    const initialLimit = Number((config._aihot as Record<string, unknown> | undefined)?.initialBackfillLimit ?? 30);
    if (firstImport && Number.isFinite(initialLimit) && initialLimit > 0) items = items.slice(0, initialLimit);

    let inserted = 0, duplicates = 0, backfill = 0;
    for (const item of items) {
      const stored = await storeItem(env, source, item, archiveKey, startedAt, firstImport);
      if (stored.inserted) {
        inserted++;
        if (stored.backfill) backfill++;
      } else duplicates++;
    }

    const nextFetchAt = new Date(
      Date.now() + Math.max(15, source.interval_minutes || Number(env.DEFAULT_FETCH_MINUTES ?? "120")) * 60_000,
    ).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sources
         SET last_fetch_at=?, last_success_at=?, next_fetch_at=?,
             consecutive_failures=0, last_error=NULL, health='ok',
             initialized_at=COALESCE(initialized_at, ?), updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      ).bind(startedAt, new Date().toISOString(), nextFetchAt, startedAt, source.id),
      env.DB.prepare(
        `UPDATE collection_runs
         SET finished_at=?, status='success', fetched_items=?, inserted_items=?,
             duplicate_items=?, backfill_items=?
         WHERE id=?`,
      ).bind(new Date().toISOString(), items.length, inserted, duplicates, backfill, runId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextFailureCount = source.consecutive_failures + 1;
    const retryMinutes = Math.max(15, Math.min((source.interval_minutes || 120) * (nextFailureCount + 1), 360));
    const nextFetchAt = new Date(Date.now() + retryMinutes * 60_000).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sources
         SET last_fetch_at=?, next_fetch_at=?, consecutive_failures=consecutive_failures+1,
             last_error=?, health=CASE WHEN consecutive_failures + 1 >= 5 THEN 'failing' ELSE 'degraded' END,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      ).bind(startedAt, nextFetchAt, message.slice(0, 1000), source.id),
      env.DB.prepare(
        `UPDATE collection_runs
         SET finished_at=?, status='failed', error=?
         WHERE id=?`,
      ).bind(new Date().toISOString(), message.slice(0, 1000), runId),
    ]);
    throw error;
  }
}

async function fetchSource(kind: SourceKind, config: Record<string, unknown>): Promise<Response> {
  const target =
    kind === "rss"
      ? stringValue(config.feedUrl)
      : kind === "json_list" || kind === "web_list"
        ? stringValue(config.url)
        : null;

  if (!target) throw new Error(`missing source URL for ${kind}`);

  return fetch(target, {
    headers: {
      "user-agent": "uPrivate-Robotics-Intelligence/1.0 (+https://blog.uprivate.top)",
      accept: kind === "rss"
        ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
        : kind === "json_list"
          ? "application/json, text/plain;q=0.9, */*;q=0.5"
          : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    },
    redirect: "follow",
  });
}

function parseFeed(xml: string): NormalizedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const rssItems = toArray(doc?.rss?.channel?.item);
  const atomItems = toArray(doc?.feed?.entry);
  const items = rssItems.length ? rssItems : atomItems;

  return items.flatMap((item): NormalizedItem[] => {
    const title = textValue(item?.title);
    const url =
      stringValue(item?.link?.["@_href"]) ??
      stringValue(item?.link) ??
      stringValue(item?.guid?.["#text"]) ??
      stringValue(item?.guid);
    if (!title || !url) return [];

    return [{
      title,
      url,
      publishedAt: normalizeDate(
        textValue(item?.pubDate) ??
        textValue(item?.published) ??
        textValue(item?.updated),
      ),
      summary:
        textValue(item?.description) ??
        textValue(item?.summary) ??
        textValue(item?.content),
      author:
        textValue(item?.author?.name) ??
        textValue(item?.author) ??
        textValue(item?.["dc:creator"]),
      externalId: textValue(item?.id) ?? textValue(item?.guid),
    }];
  });
}

async function parseWebList(html: string, config: Record<string, unknown>): Promise<NormalizedItem[]> {
  const itemSelector = stringValue(config.itemSelector);
  const sourceUrl = stringValue(config.url);
  if (!itemSelector || !sourceUrl) throw new Error("web_list requires itemSelector and url");

  const items: Array<{ href: string | null; text: string; title: string; date: string; datetime: string | null }> = [];
  let current: typeof items[number] | null = null;

  const rewriter = new HTMLRewriter().on(itemSelector, {
    element(element) {
      current = { href: element.getAttribute("href"), text: "", title: "", date: "", datetime: null };
      items.push(current);
      element.onEndTag(() => { current = null; });
    },
    text(text) {
      if (current) current.text += text.text;
    },
  });

  const titleSelector = stringValue(config.titleSelector);
  if (titleSelector) rewriter.on(`${itemSelector} ${titleSelector}`, {
    text(text) { if (current) current.title += text.text; },
  });
  const dateSelector = stringValue(config.publishedAtSelector);
  if (dateSelector) rewriter.on(`${itemSelector} ${dateSelector}`, {
    element(element) { if (current) current.datetime = element.getAttribute('datetime'); },
    text(text) { if (current) current.date += text.text; },
  });

  await rewriter.transform(new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } })).text();

  const base = stringValue(config.baseUrl) ?? sourceUrl;
  const allow = Array.isArray(config.allowUrlPrefixes) ? config.allowUrlPrefixes.filter((x): x is string => typeof x === "string") : [];
  const deny = Array.isArray(config.denyUrlPrefixes) ? config.denyUrlPrefixes.filter((x): x is string => typeof x === "string") : [];

  return items.flatMap((item): NormalizedItem[] => {
    if (!item.href) return [];
    let url: string;
    try { url = new URL(item.href, base).toString(); } catch { return []; }
    if (allow.length && !allow.some((p) => url.startsWith(p))) return [];
    if (deny.some((p) => url.startsWith(p))) return [];
    const title = (item.title.trim() || item.text).replace(/\s+/g, " ").trim();
    if (!title) return [];
    let date = item.datetime || item.date.trim() || null;
    if (date && /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(date)) {
      date = `${date.replace(/[./]/g, '-')}T00:00:00${stringValue(config.publishedAtUtcOffset) ?? '+00:00'}`;
    }
    return [{ title, url, publishedAt: normalizeDate(date), summary: null, author: null, externalId: null }];
  });
}

function parseJsonList(raw: string, config: Record<string, unknown>): NormalizedItem[] {
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [];
  const required = config.requireBoolean as { path?: string; equals?: boolean } | undefined;

  return rows.flatMap((row): NormalizedItem[] => {
    if (!row || typeof row !== "object") return [];
    if (required?.path) {
      const value = getPath(row, required.path);
      if (value !== required.equals) return [];
    }

    const title = firstPathString(row, config.titlePaths);
    const publishedAt = normalizeDate(pathString(row, config.publishedAtPath));
    const summary = firstPathString(row, config.summaryPaths);
    const author = firstPathString(row, config.authorPaths);
    const externalId = scalarToString(getPath(row, stringValue(config.externalIdPath) ?? ""));
    const urlTemplate = stringValue(config.urlTemplate);
    const url = urlTemplate
      ? urlTemplate.replace(/\{raw:([^}]+)\}/g, (_match, path: string) =>
          encodeURI(scalarToString(getPath(row, path)) ?? ""))
      : firstPathString(row, config.urlPaths);

    if (!title || !url) return [];
    return [{ title, url, publishedAt, summary, author, externalId }];
  });
}

async function storeItem(
  env: Env,
  source: SourceRow,
  item: NormalizedItem,
  rawR2Key: string,
  discoveredAt: string,
  forceBackfill = false,
): Promise<{ inserted: boolean; backfill: boolean }> {
  const canonicalUrl = canonicalizeUrl(item.url);
  const urlHash = await sha256(canonicalUrl);
  const contentHash = await sha256(
    normalizeTextForHash(item.title) + "\n" + normalizeTextForHash(item.summary ?? ""),
  );
  const published = item.publishedAt ? new Date(item.publishedAt) : null;
  const oldNewsHours = Number(env.OLD_NEWS_HOURS ?? "48");
  const ageMs = published ? Date.now() - published.getTime() : 0;
  const isBackfill = forceBackfill || Boolean(published && ageMs > oldNewsHours * 3_600_000);

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO articles(
       id,source_id,canonical_url,url_hash,content_hash,external_id,title,summary,author,
       published_at,discovered_at,raw_r2_key,is_backfill,publish_eligible,processing_status
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new')`,
  ).bind(
    crypto.randomUUID(),
    source.id,
    canonicalUrl,
    urlHash,
    contentHash,
    item.externalId,
    item.title.slice(0, 1000),
    item.summary?.slice(0, 8000) ?? null,
    item.author?.slice(0, 500) ?? null,
    item.publishedAt,
    discoveredAt,
    rawR2Key,
    isBackfill ? 1 : 0,
    isBackfill ? 0 : 1,
  ).run();

  if (!Number(result.meta.changes ?? 0) && item.publishedAt) {
    await env.DB.prepare(`UPDATE articles SET published_at=?,
      is_backfill=CASE WHEN ?=1 THEN 1 ELSE is_backfill END,
      publish_eligible=CASE WHEN ?=1 THEN 0 ELSE publish_eligible END
      WHERE source_id=? AND url_hash=? AND published_at IS NULL`).bind(
      item.publishedAt, isBackfill ? 1 : 0, isBackfill ? 1 : 0, source.id, urlHash,
    ).run();
  }

  return { inserted: Number(result.meta.changes ?? 0) > 0, backfill: isBackfill };
}

async function syncSources(env: Env, rawSources: unknown[]): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0, updated = 0, skipped = 0;

  for (const raw of rawSources) {
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const s = raw as Record<string, any>;
    const id = stringValue(s.id);
    const name = stringValue(s.name);
    const kind = stringValue(s.kind) as SourceKind | null;
    const config = s.config;
    if (!id || !name || !kind || !config || !["rss","json_list","web_list","external"].includes(kind)) {
      skipped++; continue;
    }

    const existing = await env.DB.prepare("SELECT id FROM sources WHERE id=?").bind(id).first();
    const interval = Number(s.interval_minutes ?? env.DEFAULT_FETCH_MINUTES ?? 120);

    await env.DB.prepare(
      `INSERT INTO sources(
         id,name,kind,config_json,tier,first_party,owner_entity_id,participation_mode,
         interval_minutes,enabled,next_fetch_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         kind=excluded.kind,
         config_json=excluded.config_json,
         tier=excluded.tier,
         first_party=excluded.first_party,
         owner_entity_id=excluded.owner_entity_id,
         participation_mode=excluded.participation_mode,
         interval_minutes=excluded.interval_minutes,
         updated_at=CURRENT_TIMESTAMP`,
    ).bind(
      id, name, kind, JSON.stringify(config), stringValue(s.tier) ?? "T2",
      s.first_party ? 1 : 0, stringValue(s.owner_entity_id),
      stringValue(s.participation_mode) ?? "editorial",
      Number.isFinite(interval) ? interval : 120,
    ).run();

    existing ? updated++ : inserted++;
  }
  return { inserted, updated, skipped };
}

async function adaptIntervals(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT s.id,s.kind,s.participation_mode,s.interval_minutes,
      (SELECT count(*) FROM articles a
       WHERE a.source_id=s.id
         AND datetime(a.discovered_at) >= datetime('now','-7 days')
         AND a.is_backfill=0) / 7.0 AS per_day
     FROM sources s
     WHERE s.enabled=1 AND s.kind IN ('rss','json_list','web_list')`
  ).all<{ id: string; kind: SourceKind; participation_mode: string; interval_minutes: number; per_day: number }>();

  for (const row of rows.results) {
    const perDay = Number(row.per_day ?? 0);
    const max = row.participation_mode === "hot_signal" ? 180 : 60;
    const min = 15;
    const target = perDay <= 0.15
      ? max
      : Math.round(Math.min(max, Math.max(min, (24 * 60) / (perDay * 3))));
    if (target !== row.interval_minutes) {
      await env.DB.prepare(
        "UPDATE sources SET interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(target, row.id).run();
    }
  }
}

function normalizeTextForHash(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrl(value: string): string {
  const u = new URL(value);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rawArchiveKey(sourceId: string, iso: string, kind: string): string {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `raw/${yyyy}/${mm}/${dd}/${sourceId}/${iso.replace(/[:.]/g, "-")}.${kind === "json_list" ? "json" : kind === "web_list" ? "html" : "xml"}`;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValue(value: any): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (value && typeof value === "object") {
    return stringValue(value["#text"]) ?? stringValue(value.__cdata);
  }
  return null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getPath(root: any, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce((value, key) => value == null ? undefined : value[key], root);
}

function scalarToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function pathString(root: any, pathValue: unknown): string | null {
  const path = stringValue(pathValue);
  return path ? scalarToString(getPath(root, path)) : null;
}

function firstPathString(root: any, pathsValue: unknown): string | null {
  if (!Array.isArray(pathsValue)) return null;
  for (const path of pathsValue) {
    if (typeof path !== "string") continue;
    const value = scalarToString(getPath(root, path));
    if (value?.trim()) return value.trim();
  }
  return null;
}
