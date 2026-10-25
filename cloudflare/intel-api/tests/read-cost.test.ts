import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {backlogQuery} from '../src/health.ts';
const migration=readFileSync(new URL('../../ingest/migrations/0017_pending_review_queue.sql',import.meta.url),'utf8');
const pendingQuery='SELECT submission_id AS id FROM review_pending_applications ORDER BY reviewer,created_at,submission_id LIMIT ?';
function fixture(history=0,install=true){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe','0011_phase2b1_reviewers','0012_phase2b2_submissions','0013_phase2_finalization','0014_phase2_evidence','0015_daily_production','0016_watchdog_query_indexes'])sql.exec(readFileSync(new URL(`../../ingest/migrations/${name}.sql`,import.meta.url),'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json) VALUES('src','Source','rss','{}');");
 function article(id:string){sql.prepare("INSERT INTO articles(id,source_id,canonical_url,url_hash,title,discovered_at) VALUES(?,'src','https://example.com/'||?,?,?,'2026-10-25 00:00:00')").run(id,id,id,id);}
 function submit(id:string,articleId:string,role='A',created='2026-10-25 00:01:00',version='v1'){
  const snapshot=sql.prepare('SELECT snapshot FROM mcp_article_facts WHERE id=?').get(articleId)!.snapshot;
  sql.prepare("INSERT INTO review_submissions(id,article_id,reviewer,reviewer_run_id,scheduled_task_id,context_id,prompt_version,input_snapshot_hash,input_snapshot,payload_json,payload_hash,caller_client_id,created_at) VALUES(?,?,?,?,'task','context',?,'hash',?,'{}','hash','client',?)").run(id,articleId,role,id,version,snapshot,created);
 }
 function reject(id:string){sql.prepare("INSERT INTO review_submission_applications(submission_id,validation_status,error) VALUES(?,'rejected','fixture')").run(id);}
 sql.exec('BEGIN');
 for(let i=0;i<history;i++){const id='h'+i;article(id);submit(id,id);reject(id);sql.prepare("UPDATE articles SET processing_status='completed' WHERE id=?").run(id);}
 sql.exec('COMMIT');if(install)sql.exec(migration);
 return {sql,article,submit,reject};
}
test('queue bootstrap includes old pending work; rejected and applied history stays out; migration replay is safe',()=>{
 const {sql,article,submit,reject}=fixture(20,false);article('old');submit('late','old','A','2020-01-01');
 sql.exec(migration);assert.deepEqual(sql.prepare(pendingQuery).all(10).map(x=>x.id),['late']);
 reject('late');sql.exec(migration);assert.deepEqual(sql.prepare(pendingQuery).all(10),[]);sql.close();
});
test('trigger queue catches late dates, orders A before B, drains on either application outcome, and rolls back atomically',()=>{
 const {sql,article,submit,reject}=fixture();article('a');article('b');
 submit('b','b','B','2000-01-01');submit('a','a');
 assert.deepEqual(sql.prepare(pendingQuery).all(10).map(x=>x.id),['a','b']);
 sql.exec('BEGIN');reject('a');assert.deepEqual(sql.prepare(pendingQuery).all(10).map(x=>x.id),['b']);sql.exec('ROLLBACK');
 assert.deepEqual(sql.prepare(pendingQuery).all(10).map(x=>x.id),['a','b']);
 reject('a');sql.exec("INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES('b','applied',CURRENT_TIMESTAMP)");
 assert.deepEqual(sql.prepare(pendingQuery).all(10),[]);
 assert.throws(()=>sql.exec("UPDATE review_submissions SET id='changed'"),/immutable/);
 assert.throws(()=>sql.exec('DELETE FROM review_submission_applications'),/immutable/);sql.close();
});
test('duplicate submission cannot recreate a consumed queue entry; failed insert leaves no queue entry',()=>{
 const {sql,article,submit,reject}=fixture();article('a');submit('a','a');reject('a');
 sql.exec("INSERT OR IGNORE INTO review_submissions SELECT * FROM review_submissions WHERE id='a'");
 assert.deepEqual(sql.prepare(pendingQuery).all(10),[]);
 sql.exec('BEGIN');article('rollback');submit('rollback','rollback');sql.exec('ROLLBACK');
 assert.deepEqual(sql.prepare(pendingQuery).all(10),[]);sql.close();
});
test('application watermark equals historical MAX; rejected and late applications never fake or regress freshness',()=>{
 const {sql,article,submit,reject}=fixture(20,false);
 article('a');submit('a','a','B');sql.exec("INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES('a','applied','2026-10-25 01:00:00')");
 sql.exec(migration);assert.equal(sql.prepare("SELECT applied_at FROM review_application_latest WHERE reviewer='B'").get()!.applied_at,'2026-10-25 01:00:00');
 article('b');submit('b','b','B');sql.exec("INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES('b','applied','2020-01-01 00:00:00')");
 article('c');submit('c','c','B');reject('c');
 assert.equal(sql.prepare("SELECT applied_at FROM review_application_latest WHERE reviewer='B'").get()!.applied_at,'2026-10-25 01:00:00');
 sql.exec('BEGIN');article('d');submit('d','d','B');sql.exec("INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES('d','applied','2026-10-25 02:00:00')");sql.exec('ROLLBACK');
 const historical=sql.prepare("SELECT max(v.applied_at) t FROM review_submissions s JOIN review_submission_applications v ON v.submission_id=s.id WHERE s.reviewer='B' AND v.validation_status='applied'").get()!.t;
 assert.equal(sql.prepare("SELECT applied_at FROM review_application_latest WHERE reviewer='B'").get()!.applied_at,historical);sql.close();
});
test('backlog preserves eligibility, snapshot and prompt matching while reading only active articles',()=>{
 const {sql,article,submit,reject}=fixture(100);
 article('new');article('submitted');submit('submitted','submitted');reject('submitted');
 article('processing');submit('A-processing','processing');
 const snapshot=sql.prepare("SELECT snapshot FROM mcp_article_facts WHERE id='processing'").get()!.snapshot;
 sql.prepare("INSERT INTO mcp_processing_runs(run_id,article_id,caller_client_id,provider,runtime_claim,prompt_version,input_snapshot) VALUES('A-processing','processing','client','fixture','fixture','v1',?)").run(snapshot);
 sql.exec("UPDATE articles SET prefilter_status='PASS',score_a=70 WHERE id='processing';INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES('A-processing','applied',CURRENT_TIMESTAMP)");
 let h=sql.prepare(backlogQuery).get()!;assert.equal(h.reviewer_a_pending_count,1);assert.equal(h.reviewer_b_pending_count,1);assert.equal(h.pending_apply_count,0);
 submit('B-other-version','processing','B',undefined,'v2');h=sql.prepare(backlogQuery).get()!;assert.equal(h.reviewer_b_pending_count,1);assert.equal(h.pending_apply_count,1);
 submit('B-current','processing','B');h=sql.prepare(backlogQuery).get()!;assert.equal(h.reviewer_b_pending_count,0);assert.equal(h.pending_apply_count,2);
 const original=readFileSync(new URL('./fixtures/backlog-before.sql',import.meta.url),'utf8');
 const old=sql.prepare(original).get()!;
 for(const key of ['reviewer_a_pending_count','reviewer_b_pending_count','pending_apply_count'])assert.equal(h[key],old[key]);
 for(const key of ['oldest_pending_age_minutes','oldest_unapplied_age_minutes'])assert.ok(Math.abs(Number(h[key])-Number(old[key]))<0.01);
 sql.close();
});
test('ten thousand completed submissions do not appear in the idle query plan or queue',()=>{
 const {sql,article}=fixture(10000);article('active');
 assert.equal(sql.prepare('SELECT count(*) n FROM review_pending_applications').get()!.n,0);
 const queuePlan=sql.prepare('EXPLAIN QUERY PLAN '+pendingQuery).all(10).map(x=>x.detail).join('\n');
 assert.match(queuePlan,/idx_review_pending_order/);assert.doesNotMatch(queuePlan,/review_submissions|review_submission_applications|TEMP B-TREE/);
 const plan=sql.prepare('EXPLAIN QUERY PLAN '+backlogQuery).all().map(x=>x.detail).join('\n');
 assert.match(plan,/MATERIALIZE a_pending/);assert.match(plan,/MATERIALIZE b_pending/);assert.match(plan,/idx_articles_processing/);
 assert.doesNotMatch(plan,/idx_review_submissions_reviewer_created/);assert.equal(sql.prepare(backlogQuery).get()!.reviewer_a_pending_count,1);sql.close();
});
