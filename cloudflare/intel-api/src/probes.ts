import { z } from 'zod';

export const probeSchema = z.object({
  article_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  note: z.string().trim().min(1).max(256),
  run_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

export async function saveProcessingProbe(db: D1Database, input: unknown, clientId: string) {
  const args = probeSchema.parse(input);
  // One atomic INSERT SELECT ensures the article exists. A reused run_id never
  // overwrites a receipt. Production articles are read, never updated.
  const inserted = await db.prepare(`INSERT OR IGNORE INTO processing_probes
    (run_id, article_id, note, caller_client_id, created_at)
    SELECT ?, id, ?, ?, ? FROM articles WHERE id = ?`).bind(
    args.run_id, args.note, clientId, new Date().toISOString(), args.article_id,
  ).run();
  const probe = await db.prepare(`SELECT run_id, article_id, note, caller_client_id, created_at
    FROM processing_probes WHERE run_id = ? LIMIT 1`).bind(args.run_id).first<{ run_id: string; article_id: string; note: string; caller_client_id: string; created_at: string }>();
  if (!probe) return { saved: false, error: 'article_not_found', production_articles_modified: false };
  if (probe.article_id !== args.article_id || probe.note !== args.note || probe.caller_client_id !== clientId) {
    return { saved: false, error: 'run_id_conflict', production_articles_modified: false };
  }
  return { saved: true, inserted: inserted.meta.changes > 0, probe, production_articles_modified: false };
}
