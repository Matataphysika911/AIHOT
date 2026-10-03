import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { materializeEvidence, readEvidence, inputHash, extractArticle, publicPage } from '../src/evidence.ts';
import { processingBacklog, backlogStatus } from '../src/health.ts';
import { appendReview, applyReviewSubmission, digest } from '../src/submissions.ts';
import { getReviewerBatch } from '../src/reviewers.ts';
import { EVIDENCE_PROMPT_VERSION, REVIEWER_PROMPT_VERSION } from '../src/processing.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe','0011_phase2b1_reviewers','0012_phase2b2_submissions','0013_phase2_finalization','0014_phase2_evidence'])sql.exec(readFileSync(`../ingest/migrations/${name}.sql`,'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json,tier) VALUES('s','Source','rss','{}','T1_5'); INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at,raw_r2_key) VALUES('a','s','https://example.com/a','h','Robot','Original robotics facts','2026-10-02','raw/a')");
 const db:any={prepare(query:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};},execute(){return sql.prepare(query).run(...values);},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:r.changes}};}};},async batch(stmts:any[]){sql.exec('BEGIN');try{const result=stmts.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db};
}


const caller='https://chatgpt.com/oauth/client.json';
const score={dimension_scores:{industry_impact:65,robotics_relevance:90,soc_relevance:50,commercial_signal:30,technical_novelty:80,source_credibility:85},total:65.25,reason:'Source supported'};
const structure={category:'paper',tags:['论文/研究'],companies:[],fact_frame:{subject:'Researchers',action:'demonstrated',object:'robot capability',evidence:'Original robotics facts'},robotics_relevance:'Robot perception',soc_relevance:'未披露',commercial_signal:'未披露',facts:['Reported capability'],inferences:['Potential deployment benefit'],unknowns:['TOPS/power/memory/ASP 未披露']};
test('bounded page extraction, fallback, immutable evidence, same A/B snapshot, submit/apply/replay and deterministic final',async()=>{
 const {sql,db}=fixture();const before=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 const env={fetcher:async()=>new Response('<html><nav>navigation noise</nav><article><p>'+('Robot evidence. '.repeat(1000))+'</p><script>private instructions</script></article></html>',{headers:{'content-type':'text/html'}})} as any;
 const aBatch=await getReviewerBatch(db,'A',{limit:5},{},env);assert.equal(aBatch.count,1);
 const e=aBatch.articles[0].evidence;assert.equal(e.extracted_text.length,12000);assert.equal(e.truncated,true);assert.ok(!e.extracted_text.includes('private instructions'));assert.ok(!e.extracted_text.includes('navigation noise'));
 const a={id:'v2-a',article_id:'a',reviewer:'A',reviewer_run_id:'run-v2-a',scheduled_task_id:'task-a',context_id:'chat-a',prompt_version:EVIDENCE_PROMPT_VERSION,input_snapshot_hash:aBatch.articles[0].input_snapshot_hash,payload:{prefilter:{status:'PASS',reason:'Relevant'},score}};
 const articleBefore=sql.prepare('SELECT * FROM articles').get();
 assert.equal((await appendReview(db,a,caller)).inserted,true);assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),articleBefore);
 assert.equal((await getReviewerBatch(db,'A',{}, {},env)).count,0);
 assert.equal((await appendReview(db,a,caller)).inserted,false);assert.equal((await applyReviewSubmission(db,{id:a.id})).applied,true);assert.equal((await applyReviewSubmission(db,{id:a.id})).inserted,false);
 const bBatch=await getReviewerBatch(db,'B',{}, {},env);assert.equal(bBatch.count,1);assert.deepEqual(bBatch.articles[0].evidence,e);assert.equal(bBatch.articles[0].input_snapshot_hash,a.input_snapshot_hash);
 for(const key of ['score_a','context_id','prefilter_status','dimension_scores','scheduled_task_id'])assert.ok(!JSON.stringify(bBatch).includes(key));
 const b={...a,id:'v2-b',reviewer:'B',reviewer_run_id:'run-v2-b',scheduled_task_id:'task-b',context_id:'chat-b',payload:{score_b:score,structure}};
 const beforeB=sql.prepare('SELECT * FROM articles').get();assert.equal((await appendReview(db,b,caller)).inserted,true);assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),beforeB);
 assert.equal((await applyReviewSubmission(db,{id:b.id})).applied,true);assert.equal((await appendReview(db,b,caller)).inserted,false);assert.equal((await applyReviewSubmission(db,{id:b.id})).inserted,false);
 assert.equal(sql.prepare('SELECT final_score FROM articles').get()!.final_score,65);assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),before);
 assert.throws(()=>sql.exec('DELETE FROM article_evidence'),/immutable/);assert.throws(()=>sql.exec("UPDATE article_evidence SET extracted_text='changed'"),/immutable/);
 assert.deepEqual(await materializeEvidence(db,'a',{fetcher:async()=>{throw Error('must not refetch');}} as any),e);
});
test('network/extraction failure freezes summary; rich abstracts avoid network; no ingestion changes',async()=>{
 for(const url of ['https://example.com/fail','https://arxiv.org/abs/2610.12345']){
 const {sql,db}=fixture();sql.prepare('UPDATE articles SET canonical_url=?').run(url);
 const before=sql.prepare('SELECT * FROM articles').get();let calls=0;
 const e=await materializeEvidence(db,'a',{fetcher:async()=>{calls++;throw Error('fetch_failed');}} as any);
 assert.equal(e.extracted_text,'Original robotics facts');assert.equal(e.status,'fallback');assert.equal(calls,url.includes('arxiv')?0:1);assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);
 }
 assert.throws(()=>publicPage('https://127.0.0.1/private'),/unsafe/);assert.throws(()=>publicPage('http://example.com'),/unsafe/);
});
test('backlog counters cover each stage and severity boundaries',async()=>{
 const {sql,db}=fixture();let h=await processingBacklog(db);assert.equal(h.reviewer_a_pending_count,1);assert.equal(h.reviewer_b_pending_count,0);
 for(const [minutes,status] of [[119,'healthy'],[120,'warning'],[360,'warning'],[361,'degraded'],[720,'degraded'],[721,'critical']] as const)assert.equal(backlogStatus(minutes),status);
 await materializeEvidence(db,'a',{fetcher:async()=>{throw Error('offline');}} as any);
 const facts=sql.prepare('SELECT snapshot FROM mcp_article_facts').get()!.snapshot as string;
 const a={id:'health-a',article_id:'a',reviewer:'A',reviewer_run_id:'health-run-a',scheduled_task_id:'task-a',context_id:'chat-a',prompt_version:EVIDENCE_PROMPT_VERSION,input_snapshot_hash:await inputHash(db,'a',facts,EVIDENCE_PROMPT_VERSION),payload:{prefilter:{status:'PASS',reason:'Relevant'},score}};
 await appendReview(db,a,caller);h=await processingBacklog(db);assert.equal(h.reviewer_a_pending_count,0);assert.equal(h.pending_apply_count,1);
 await applyReviewSubmission(db,{id:a.id});h=await processingBacklog(db);assert.equal(h.pending_apply_count,0);assert.equal(h.reviewer_b_pending_count,1);
});
test('migration preserves old applied receipts and supports exact old replay',async()=>{
 const {sql,db}=fixture();const facts=sql.prepare('SELECT snapshot FROM mcp_article_facts').get()!.snapshot as string;
 const a={id:'old-a',article_id:'a',reviewer:'A',reviewer_run_id:'old-run',scheduled_task_id:'task-a',context_id:'chat-a',prompt_version:REVIEWER_PROMPT_VERSION,input_snapshot_hash:await digest(facts),payload:{prefilter:{status:'PASS',reason:'Relevant'},score}};
 await appendReview(db,a,caller);assert.equal((await applyReviewSubmission(db,{id:a.id})).applied,true);
 const before=sql.prepare('SELECT * FROM mcp_reviewer_runs').all();
 assert.equal(sql.prepare("SELECT count(*) n FROM mcp_reviewer_runs_v2").get()!.n,0);
 assert.deepEqual(sql.prepare('SELECT * FROM mcp_reviewer_runs').all(),before);assert.equal((await appendReview(db,a,caller)).inserted,false);assert.equal((await applyReviewSubmission(db,{id:a.id})).inserted,false);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
