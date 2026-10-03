import test from 'node:test';
import assert from 'node:assert/strict';
import { saveProcessingProbe } from '../src/probes.ts';

function fakeDb(row: unknown, changes = 1) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  return { calls, db: { prepare(sql: string) {
    const call = { sql, parameters: [] as unknown[] }; calls.push(call);
    return { bind(...parameters: unknown[]) {
      call.parameters = parameters;
      return { run: async () => ({ meta: { changes } }), first: async () => row };
    } };
  } } as any };
}
const args = { article_id: 'article-1', note: 'Phase 2A test', run_id: 'probe-run-1' };
const row = { ...args, caller_client_id: 'client-1', created_at: '2026-10-01T15:00:00Z' };
test('probe appends only to test table and binds all inputs', async () => {
  const { db, calls } = fakeDb(row);
  const result = await saveProcessingProbe(db, args, 'client-1');
  assert.equal(result.saved, true);
  assert.equal(result.inserted, true);
  assert.equal(result.production_articles_modified, false);
  assert.match(calls[0].sql, /INSERT OR IGNORE INTO processing_probes/);
  assert.match(calls[0].sql, /FROM articles WHERE id = \?/);
  assert.doesNotMatch(calls.map(c => c.sql).join(' '), /UPDATE|DELETE|score_a|score_b|final_score|processing_status/);
  assert.equal(calls[0].parameters[0], args.run_id);
  assert.equal(calls[0].parameters[4], args.article_id);
});
test('matching repeat is idempotent, conflict never overwrites', async () => {
  const same = fakeDb(row, 0);
  assert.equal((await saveProcessingProbe(same.db, args, 'client-1')).inserted, false);
  for (const altered of [{ ...row, article_id: 'other' }, { ...row, note: 'other' }, { ...row, caller_client_id: 'other' }]) {
    const { db } = fakeDb(altered, 0);
    assert.equal((await saveProcessingProbe(db, args, 'client-1')).error, 'run_id_conflict');
  }
});
test('unknown article cannot create a receipt', async () => {
  const { db } = fakeDb(null, 0);
  assert.equal((await saveProcessingProbe(db, args, 'client-1')).error, 'article_not_found');
});
test('note/run id/extra SQL boundaries reject before D1', async () => {
  for (const input of [{ ...args, note: 'x'.repeat(257) }, { ...args, note: ' ' },
    { ...args, run_id: "x';DROP TABLE articles;--" }, { ...args, sql: 'UPDATE articles' }]) {
    const { db, calls } = fakeDb(row);
    await assert.rejects(() => saveProcessingProbe(db, input, 'client-1'));
    assert.equal(calls.length, 0);
  }
});
