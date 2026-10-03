import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getReviewerBatch, saveReviewer, reviewerAllowed } from '../src/reviewers.ts';
import { REVIEWER_PROMPT_VERSION, saveProduction } from '../src/processing.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe','0011_phase2b1_reviewers','0012_phase2b2_submissions','0013_phase2_finalization'])sql.exec(readFileSync(`../ingest/migrations/${name}.sql`,'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json,tier) VALUES('s','Source','rss','{}','T1_5'); INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at,raw_r2_key) VALUES('a','s','https://example.com/a','h','Robot','Original robotics facts','2026-10-02','raw/a')");
 const db:any={prepare(query:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};},execute(){return sql.prepare(query).run(...values);}};},async batch(stmts:any[]){sql.exec('BEGIN');try{const result=stmts.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db};
}
const a={article_id:'a',run_id:'phase2b1-interactive-a',scheduled_task_id:'interactive-a',context_id:'chat-a',prompt_version:REVIEWER_PROMPT_VERSION};
const b={...a,run_id:'phase2b1-interactive-b',scheduled_task_id:'interactive-b',context_id:'chat-b'};
const pre={...a,status:'PASS',reason:'Secret prefilter reason'};
const dims={industry_impact:65,robotics_relevance:90,soc_relevance:50,commercial_signal:30,technical_novelty:80,source_credibility:85};
const score={...a,slot:'A',dimension_scores:dims,total:65.25,reason:'A PRIVATE reasoning must never reach B'};
const structure={...b,category:'paper',tags:['论文/研究'],companies:[],fact_frame:{subject:'Researchers',action:'demonstrated',object:'robot capability',evidence:'Original robotics facts'},robotics_relevance:'Robot perception',soc_relevance:'未披露',commercial_signal:'未披露'};
async function claim(db:any){assert.equal((await saveReviewer(db,'A','save_prefilter',pre,'chatgpt')).saved,true);assert.equal((await saveReviewer(db,'A','save_score',score,'chatgpt')).saved,true);}
test('A/B receipts have independent identity; B facts and every acknowledgment exclude A; deterministic finalize and retries preserve facts',async()=>{
 const {sql,db}=fixture();const before=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 assert.equal((await getReviewerBatch(db,'B',{},{})).count,0);
 await claim(db);
 const input=await getReviewerBatch(db,'B',{limit:3},{prompt_version:REVIEWER_PROMPT_VERSION,scoring:'Frozen rubric'});
 assert.equal(input.count,0);/* Legacy direct writes are no longer B submission eligible. */ assert.deepEqual(Object.keys((await getReviewerBatch(fixture().db,'A',{},{})).articles[0]).filter(k=>k!=='input_snapshot_hash'),['id','source_id','canonical_url','title','summary','author','published_at','discovered_at','is_backfill','publish_eligible','source_name','source_kind','source_tier','source_first_party']);

 for(const forbidden of ['score_a','PRIVATE','prefilter','receipt','run_id','context_id','dimension_scores','processing_status'])assert.ok(!JSON.stringify(input).includes(forbidden));
 for(const [role,tool,args] of [['A','save_prefilter',pre],['A','save_score',score],['B','save_score',{...score,...b,slot:'B',reason:'B independent reasoning'}],['B','save_structure',structure],['B','finalize_processing',{article_id:'a',run_id:b.run_id,scheduled_task_id:b.scheduled_task_id,context_id:b.context_id}]] as const){
  const result=await saveReviewer(db,role,tool,args,'chatgpt');assert.equal(result.saved,true);
  for(const forbidden of ['score_a','score_b','PRIVATE','article"','final_score','selection_status'])assert.ok(!JSON.stringify(result).includes(forbidden));
  assert.equal((await saveReviewer(db,role,tool,args,'chatgpt')).inserted,false);
 }
 assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),before);
 assert.deepEqual({...sql.prepare('SELECT final_score,selection_status FROM articles').get()},{final_score:65,selection_status:'selected'});
 const receipts=sql.prepare('SELECT reviewer,reviewer_run_id,scheduled_task_id,context_id,prompt_version,caller_client_id FROM mcp_task_receipts ORDER BY stage').all();assert.equal(receipts.length,5);assert.equal(new Set(receipts.map(r=>r.context_id)).size,2);assert.equal(new Set(receipts.map(r=>r.scheduled_task_id)).size,2);assert.ok(receipts.every(r=>r.caller_client_id==='chatgpt'&&r.prompt_version===REVIEWER_PROMPT_VERSION));
 assert.equal((await getReviewerBatch(db,'B',{},{})).count,0);
});
test('least scopes, cross-slot tools, mixed/broad grants, A leakage via legacy writes, and reused contexts fail closed',async()=>{
 assert.equal(reviewerAllowed(['articles:read','processing:a'],'A'),true);assert.equal(reviewerAllowed(['processing:b'],'B'),true);
 for(const scopes of [[],['articles:read'],['processing:write'],['processing:a','processing:b'],['processing:b','processing:write'],['processing:b','probes:write']])assert.equal(reviewerAllowed(scopes,'B'),false);
 const {sql,db}=fixture();await claim(db);
 assert.equal((await saveReviewer(db,'A','save_score',{...score,slot:'B'},'chatgpt')).error,'reviewer_scope_denied');
 assert.equal((await saveReviewer(db,'B','save_prefilter',{...pre,...b},'chatgpt')).error,'reviewer_scope_denied');
 assert.equal((await saveReviewer(db,'A','save_structure',{...structure,...a},'chatgpt')).error,'reviewer_scope_denied');
 for(const overrides of [{context_id:a.context_id},{scheduled_task_id:a.scheduled_task_id},{run_id:a.run_id}])assert.equal((await saveReviewer(db,'B','save_score',{...score,...b,...overrides,slot:'B'},'chatgpt')).saved,false);
 assert.equal((await saveProduction(db,'save_score',{article_id:'a',run_id:a.run_id,prompt_version:REVIEWER_PROMPT_VERSION,slot:'B',dimension_scores:dims,total:65.25,reason:'bypass'},'chatgpt')).error,'reviewer_endpoint_required');
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_reviewer_runs').get()!.n,1);
 await assert.rejects(()=>saveReviewer(db,'B','save_score',{...score,...b,slot:'B',score_a:99},'chatgpt'));
});
test('stage/fact/audit conflicts, score-total mismatch and parallel claim conflicts preserve state',async()=>{
 const {sql,db}=fixture();
 assert.equal((await saveReviewer(db,'A','save_score',{...score,total:99},'chatgpt')).error,'weighted_total_mismatch');
 const race=await Promise.all([saveReviewer(db,'A','save_prefilter',pre,'chatgpt'),saveReviewer(db,'A','save_prefilter',pre,'chatgpt')]);assert.ok(race.every(r=>r.saved));assert.equal(race.filter(r=>r.inserted).length,1);
 assert.equal((await saveReviewer(db,'B','save_score',{...score,...b,slot:'B'},'chatgpt')).saved,false);
 assert.equal((await saveReviewer(db,'A','save_prefilter',{...pre,context_id:'forged'},'chatgpt')).saved,false);
 assert.equal((await saveReviewer(db,'A','save_score',score,'chatgpt')).saved,true);
 sql.exec("UPDATE articles SET raw_r2_key='tampered' WHERE id='a'");
 assert.equal((await saveReviewer(db,'B','save_score',{...score,...b,slot:'B'},'chatgpt')).saved,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,2);
});
test('BLOCK closes deterministically in Worker/database without giving A finalize permission',async()=>{
 const {sql,db}=fixture();assert.equal((await saveReviewer(db,'A','save_prefilter',{...pre,status:'BLOCK'},'chatgpt')).saved,true);
 assert.equal(sql.prepare('SELECT selection_status FROM articles').get()!.selection_status,'blocked');
 assert.equal((await saveReviewer(db,'A','finalize_processing',{article_id:'a',run_id:a.run_id,scheduled_task_id:a.scheduled_task_id,context_id:a.context_id},'chatgpt')).error,'reviewer_scope_denied');
 assert.equal((await saveReviewer(db,'A','save_score',score,'chatgpt')).saved,false);
});
