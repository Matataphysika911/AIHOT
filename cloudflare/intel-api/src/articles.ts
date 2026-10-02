import { z } from 'zod';

export const statuses = ['new', 'processing', 'selected', 'near_selected', 'rejected', 'failed', 'completed'] as const;
export const batchSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  statuses: z.array(z.enum(statuses)).min(1).max(7).optional(),
}).strict();
export const articleSchema = z.object({ id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/) }).strict();

// Explicit projection: no source config, raw archive, full text or scoring writes.
const projection = `a.id, a.source_id, substr(a.canonical_url,1,2048) AS canonical_url,
  substr(a.title,1,512) AS title, substr(a.summary,1,2000) AS summary,
  substr(a.author,1,256) AS author, a.published_at, a.discovered_at,
  a.is_backfill, a.publish_eligible, a.processing_status,
  substr(s.name,1,256) AS source_name, s.kind AS source_kind,
  s.tier AS source_tier, s.first_party AS source_first_party`;

export async function getProcessingBatch(db: D1Database, input: unknown) {
  const args = batchSchema.parse(input);
  const filter = [...new Set(args.statuses ?? ['new'])];
  const result = await db.prepare(`SELECT ${projection} FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.processing_status IN (${filter.map(() => '?').join(',')})
    ORDER BY a.discovered_at DESC, a.id ASC LIMIT ?`).bind(...filter, args.limit).all();
  return { articles: result.results, count: result.results.length, statuses: filter,
    limit: args.limit, read_only: true, summaries_truncated_at: 2000 };
}

export async function getArticle(db: D1Database, input: unknown) {
  const args = articleSchema.parse(input);
  const article = await db.prepare(`SELECT ${projection} FROM articles a
    JOIN sources s ON s.id = a.source_id WHERE a.id = ? LIMIT 1`).bind(args.id).first();
  return { article, found: article !== null, read_only: true, summaries_truncated_at: 2000 };
}
