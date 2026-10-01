import test from 'node:test';
import assert from 'node:assert/strict';
import { getProcessingBatch, getArticle } from '../src/articles.ts';

function fakeDb(rows = [{ id: 'real-article' }]) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  return { calls, db: { prepare(sql: string) {
    const call = { sql, parameters: [] as unknown[] }; calls.push(call);
    return { bind(...parameters: unknown[]) {
      call.parameters = parameters;
      return { all: async () => ({ results: rows }), first: async () => rows[0] ?? null };
    } };
  } } as any };
}

test('batch uses bounded, parameterized SELECT and default new status without claiming articles', async () => {
  const { db, calls } = fakeDb();
  assert.equal((await getProcessingBatch(db, {})).count, 1);
  assert.deepEqual(calls[0].parameters, ['new', 5]);
  assert.match(calls[0].sql, /JOIN sources/);
  assert.match(calls[0].sql, /substr\(a.summary,1,2000\)/);
  assert.doesNotMatch(calls[0].sql, /UPDATE|INSERT|DELETE|config_json|raw_r2_key/);
});
test('invalid batch arguments are rejected before any D1 query', async () => {
  for (const input of [{ limit: 21 }, { limit: 0 }, { limit: 1.5 }, { statuses: [] },
    { statuses: ["new'); DROP TABLE articles;--"] }, { sql: 'SELECT * FROM sources' }]) {
    const { db, calls } = fakeDb();
    await assert.rejects(() => getProcessingBatch(db, input));
    assert.equal(calls.length, 0);
  }
});
test('status filters are bound and duplicates eliminated', async () => {
  const { db, calls } = fakeDb();
  await getProcessingBatch(db, { limit: 20, statuses: ['new', 'failed', 'new'] });
  assert.deepEqual(calls[0].parameters, ['new', 'failed', 20]);
  assert.match(calls[0].sql, /IN \(\?,\?\)/);
});
test('article lookup binds id and missing row has an explicit found=false', async () => {
  const { db, calls } = fakeDb([]);
  assert.deepEqual(await getArticle(db, { id: 'abc-123' }), {
    article: null, found: false, read_only: true, summaries_truncated_at: 2000,
  });
  assert.deepEqual(calls[0].parameters, ['abc-123']);
});
test('article rejects SQL input, excessive ids and extra arguments before querying', async () => {
  for (const input of [{ id: 'a'.repeat(129) }, { id: "' OR 1=1 --" }, { id: 'abc', sql: 'UPDATE articles' }]) {
    const { db, calls } = fakeDb();
    await assert.rejects(() => getArticle(db, input));
    assert.equal(calls.length, 0);
  }
});
