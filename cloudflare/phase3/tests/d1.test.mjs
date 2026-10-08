import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {readCompleted,COMPLETED_SQL} from '../src/d1.mjs';
const s=JSON.parse(fs.readFileSync(new URL('../samples/completed.json',import.meta.url)));
const rows=s.articles.map(a=>{const {evidence_snapshot_hash,...e}=a.evidence;return {...a,structure_json:JSON.stringify(a.structure),evidence_json:JSON.stringify(e),evidence_hash:evidence_snapshot_hash,a_submission_id:a.submission_ids[0],b_submission_id:a.submission_ids[1]};});
test('D1 adapter uses one bounded read and preserves Phase 2 evidence',async()=>{
 let calls=0;const db={prepare(sql){assert.equal(sql,COMPLETED_SQL);assert.ok(!/\b(UPDATE|INSERT|DELETE|REPLACE)\b/i.test(sql));return{bind(...args){assert.equal(args.length,4);return{async all(){calls++;return{success:true,results:rows}}}}}}};
 const out=await readCompleted(db,{start:'2026-09-28T00:00:00Z',end:'2026-10-04T00:00:00Z',asOf:s.snapshot_at});assert.equal(out.articles.length,3);assert.equal(calls,1);
});
test('D1 overflow fails visibly, instead of producing an incomplete export',async()=>{
 const db={prepare(){return{bind(){return{async all(){return{success:true,results:rows}}}}}}};
 await assert.rejects(readCompleted(db,{start:'2026-09-28',end:'2026-10-04',asOf:s.snapshot_at,limit:1}),/cap/);
});

test('D1 query executes against the actual migrated SQLite schema',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 const dir=new URL('../../ingest/migrations/',import.meta.url);
 try{for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(name,dir),'utf8'));
 assert.deepEqual(db.prepare(COMPLETED_SQL).all('2026-09-28','2026-10-05',s.snapshot_at,201),[]);
 }finally{db.close();}
});
