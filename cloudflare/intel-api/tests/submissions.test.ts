import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { digest, validateReviewResult, appendReview, applyReviewSubmission } from '../src/submissions.ts';
import { getReviewerBatch } from '../src/reviewers.ts';
import { REVIEWER_PROMPT_VERSION } from '../src/processing.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe','0011_phase2b1_reviewers','0012_phase2b2_submissions','0013_phase2_finalization'])sql.exec(readFileSync(`../ingest/migrations/${name}.sql`,'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json,tier) VALUES('s','Source','rss','{}','T1_5'); INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at,raw_r2_key) VALUES('a','s','https://example.com/a','h','Robot','Original robotics facts','2026-10-02','raw/a')");
 const db:any={prepare(query:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};},execute(){return sql.prepare(query).run(...values);},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:r.changes}};}};},async batch(stmts:any[]){sql.exec('BEGIN');try{const result=stmts.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db};
}

const caller='https://chatgpt.com/oauth/client.json';
async function input(sql:any){return {id:'sub-1',article_id:'a',reviewer:'A',reviewer_run_id:'run-a',scheduled_task_id:'task-a',context_id:'chat-a',prompt_version:REVIEWER_PROMPT_VERSION,input_snapshot_hash:await digest(sql.prepare('SELECT snapshot FROM mcp_article_facts').get().snapshot),payload:{prefilter:{status:'PASS',reason:'Relevant'},score:{dimension_scores:{industry_impact:65,robotics_relevance:90,soc_relevance:50,commercial_signal:30,technical_novelty:80,source_credibility:85},total:65.25,reason:'Independent A'}}};}
test('L0 has no side effect; L1 isolated; L2 immutable inbox only; apply atomic and replay idempotent; B blind',async()=>{
 const {sql,db}=fixture(),a=await input(sql);
 const before=sql.prepare('SELECT * FROM articles').get();
 const facts=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 assert.equal(validateReviewResult(a).valid,true);
 assert.equal((await appendReview(db,a,caller,true)).inserted,true);
 assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);
 assert.equal((await appendReview(db,a,caller)).inserted,true);
 assert.equal((await appendReview(db,a,caller)).inserted,false);
 assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_processing_runs').get()!.n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,0);
 for(const table of ['review_submissions','review_submission_probes']){
  assert.throws(()=>sql.exec(`UPDATE ${table} SET id='changed'`),/immutable/);
  assert.throws(()=>sql.exec(`DELETE FROM ${table}`),/immutable/);
 }
 assert.equal((await applyReviewSubmission(db,{id:a.id})).applied,true);
 assert.equal((await applyReviewSubmission(db,{id:a.id})).inserted,false);
 assert.equal((await appendReview(db,a,caller)).inserted,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM review_submissions').get()!.n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,2);
 assert.equal(sql.prepare('SELECT score_a FROM articles').get()!.score_a,65.25);
 assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),facts);
 const b=await getReviewerBatch(db,'B',{},{});assert.equal(b.count,1);
 for(const forbidden of ['score_a','Independent A','prefilter','receipt','context_id'])assert.ok(!JSON.stringify(b).includes(forbidden));
 assert.throws(()=>sql.exec('DELETE FROM review_submission_applications'),/immutable/);
});
test('invalid arithmetic/schema/prompt/hash and conflicting replays fail closed',async()=>{
 const {sql,db}=fixture(),a=await input(sql);
 assert.equal(validateReviewResult({...a,payload:{...a.payload,score:{...a.payload.score,total:99}}}).valid,false);
 assert.equal(validateReviewResult({...a,prompt_version:'other'}).valid,false);
 assert.equal((await appendReview(db,{...a,input_snapshot_hash:'0'.repeat(64)},caller)).saved,false);
 await appendReview(db,a,caller);
 assert.equal((await appendReview(db,{...a,context_id:'changed'},caller)).saved,false);
 assert.equal((await appendReview(db,{...a,id:'sub-other',reviewer_run_id:'run-other'},caller)).saved,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM review_submissions').get()!.n,1);
});
test('apply rejects changed immutable facts or wrong caller without claiming production',async()=>{
 for(const tamper of [true,false]){
 const {sql,db}=fixture(),a=await input(sql);
 await appendReview(db,a,tamper?caller:'untrusted');
 if(tamper)sql.exec("UPDATE articles SET summary='changed' WHERE id='a'");
 assert.equal((await applyReviewSubmission(db,{id:a.id})).applied,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_processing_runs').get()!.n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,0);
 assert.equal((await applyReviewSubmission(db,{id:a.id})).inserted,false);
 }
});
test('competing apply is atomic and state conflicts leave zero partial receipts',async()=>{
 const {sql,db}=fixture(),a=await input(sql);await appendReview(db,a,caller);
 const results=await Promise.all([applyReviewSubmission(db,{id:a.id}),applyReviewSubmission(db,{id:a.id})]);
 assert.ok(results.every(x=>x.applied));assert.equal(results.filter(x=>x.inserted).length,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,2);
 const other=fixture(),c=await input(other.sql);await appendReview(other.db,c,caller);
 other.sql.exec("UPDATE articles SET processing_status='processing' WHERE id='a'");
 assert.equal((await applyReviewSubmission(other.db,{id:c.id})).applied,false);
 assert.equal(other.sql.prepare('SELECT count(*) n FROM mcp_reviewer_runs').get()!.n,0);
 assert.equal(other.sql.prepare('SELECT count(*) n FROM mcp_processing_runs').get()!.n,0);
});
test('BLOCK submission deterministically closes only on apply',async()=>{
 const {sql,db}=fixture(),a=await input(sql);const block={...a,payload:{prefilter:{status:'BLOCK',reason:'Not relevant'}}};
 await appendReview(db,block,caller);assert.equal(sql.prepare('SELECT processing_status FROM articles').get()!.processing_status,'new');
 assert.equal((await applyReviewSubmission(db,{id:a.id})).applied,true);
 assert.equal(sql.prepare('SELECT selection_status FROM articles').get()!.selection_status,'blocked');
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,1);
});
const structure={category:'paper',tags:['论文/研究'],companies:[],fact_frame:{subject:'Researchers',action:'demonstrated',object:'robot capability',evidence:'Original robotics facts'},robotics_relevance:'Robot perception',soc_relevance:'未披露',commercial_signal:'未披露'};
async function bInput(sql:any,a:any){return {...a,id:'sub-b',reviewer:'B',reviewer_run_id:'run-b',scheduled_task_id:'task-b',context_id:'chat-b',payload:{score_b:{...a.payload.score,total:65.25,reason:'Blind B'},structure}};}
test('dual immutable submit/apply: pre-review dedup, role-only receipt, no production changes before either apply, atomic final and exact replay',async()=>{
 const {getReviewSubmission}=await import('../src/submissions.ts');
 const {sql,db}=fixture(),a=await input(sql),b=await bInput(sql,a);
 const original=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 assert.equal((await getReviewerBatch(db,'A',{},{})).count,1);
 assert.equal((await appendReview(db,b,caller)).saved,false);
 await appendReview(db,a,caller);
 assert.equal((await getReviewerBatch(db,'A',{},{})).count,0);
 assert.equal((await getReviewerBatch(db,'B',{},{})).count,0);
 const lookup={article_id:'a',prompt_version:a.prompt_version,input_snapshot_hash:a.input_snapshot_hash};
 assert.deepEqual((await getReviewSubmission(db,'A',lookup,caller)).submission,a);
 assert.equal((await getReviewSubmission(db,'B',lookup,caller)).found,false);
 await applyReviewSubmission(db,{id:a.id});
 const blind=await getReviewerBatch(db,'B',{},{});assert.equal(blind.count,1);
 for(const key of ['score_a','Independent A','prefilter','receipts','context_id','scheduled_task_id','processing_status','dimension_scores'])assert.ok(!JSON.stringify(blind).includes(key));
 const beforeB=sql.prepare('SELECT * FROM articles').get();
 for(const override of [{context_id:a.context_id},{scheduled_task_id:a.scheduled_task_id},{reviewer_run_id:a.reviewer_run_id},{input_snapshot_hash:'0'.repeat(64)}])assert.equal((await appendReview(db,{...b,...override},caller)).saved,false);
 assert.equal((await appendReview(db,b,caller)).inserted,true);
 assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),beforeB);
 assert.equal((await getReviewerBatch(db,'B',{},{})).count,0);
 assert.deepEqual((await getReviewSubmission(db,'B',lookup,caller)).submission,b);
 assert.equal((await applyReviewSubmission(db,{id:b.id})).applied,true);
 assert.equal((await applyReviewSubmission(db,{id:b.id})).inserted,false);
 assert.equal((await appendReview(db,b,caller)).inserted,false);
 assert.deepEqual({...sql.prepare('SELECT processing_status,final_score,selection_status FROM articles').get()},{processing_status:'completed',final_score:65,selection_status:'selected'});
 assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),original);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,5);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts WHERE input_snapshot_hash IS NOT NULL').get()!.n,5);
 for(const table of ['mcp_task_receipts','mcp_reviewer_runs'])assert.throws(()=>sql.exec(`DELETE FROM ${table}`),/immutable/);
});
test('B rejects invalid arithmetic and injected A outputs; apply rollback does not strand B or partial structure/final',async()=>{
 const {sql,db}=fixture(),a=await input(sql),b=await bInput(sql,a);
 assert.equal(validateReviewResult({...b,payload:{...b.payload,score_b:{...b.payload.score_b,total:99}}}).valid,false);
 assert.equal(validateReviewResult({...b,payload:{...b.payload,score_a:100}}).valid,false);
 await appendReview(db,a,caller);await applyReviewSubmission(db,{id:a.id});await appendReview(db,b,caller);
 sql.exec("CREATE TRIGGER test_fail_structure BEFORE INSERT ON mcp_task_receipts WHEN NEW.stage='structure' BEGIN SELECT RAISE(ABORT,'test_rollback'); END;");
 const before=sql.prepare('SELECT * FROM articles').get();
 assert.equal((await applyReviewSubmission(db,{id:b.id})).applied,false);
 assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);
 assert.equal(sql.prepare("SELECT count(*) n FROM mcp_reviewer_runs WHERE reviewer='B'").get()!.n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,2);
});
test('UNKNOWN retains frozen dual scoring; BLOCK never schedules B; pending apply cron and concurrent B apply converge',async()=>{
 const {applyPendingReviews}=await import('../src/submissions.ts');
 const {sql,db}=fixture(),a=await input(sql);a.payload.prefilter.status='UNKNOWN';
 await appendReview(db,a,caller);assert.equal((await applyPendingReviews(db))[0].applied,true);
 assert.equal((await getReviewerBatch(db,'B',{},{})).count,1);
 const b=await bInput(sql,a);await appendReview(db,b,caller);
 const outcomes=await Promise.all([applyReviewSubmission(db,{id:b.id}),applyReviewSubmission(db,{id:b.id})]);
 assert.ok(outcomes.every(x=>x.applied));assert.equal(outcomes.filter(x=>x.inserted).length,1);
 assert.equal((await applyPendingReviews(db)).length,0);
 const block=fixture(),blocked=await input(block.sql);blocked.payload={prefilter:{status:'BLOCK',reason:'Unrelated'}} as any;
 await appendReview(block.db,blocked,caller);await applyPendingReviews(block.db);
 assert.equal((await getReviewerBatch(block.db,'B',{},{})).count,0);
});
test('schema extension preserves historical submission/application rows and foreign keys',async()=>{
 const {sql,db}=fixture(),a=await input(sql);await appendReview(db,a,caller);await applyReviewSubmission(db,{id:a.id});
 // Repeat the table-extension portion against existing applied A rows.
 const before=sql.prepare('SELECT * FROM review_submissions').all(),audit=sql.prepare('SELECT * FROM review_submission_applications').all();
 const migration=readFileSync('../ingest/migrations/0013_phase2_finalization.sql','utf8').split('-- Receipt snapshots')[0];
 sql.exec('PRAGMA foreign_keys=ON; BEGIN;');sql.exec(migration);sql.exec('COMMIT;');
 assert.deepEqual(sql.prepare('SELECT * FROM review_submissions').all(),before);
 assert.deepEqual(sql.prepare('SELECT * FROM review_submission_applications').all(),audit);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
