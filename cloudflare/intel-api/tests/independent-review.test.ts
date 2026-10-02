import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { HYBRID_PROMPT_VERSION, saveProduction } from '../src/processing.ts';
const dir=mkdtempSync(join(tmpdir(),'optional-agnes-test-'));
await build({entryPoints:['src/independent-review.ts'],bundle:true,platform:'node',format:'esm',loader:{'.txt':'text'},outfile:join(dir,'review.mjs')});
const {independentReview,reviewerInput}=await import(pathToFileURL(join(dir,'review.mjs')).href);
await build({entryPoints:['src/connectivity.ts'],bundle:true,platform:'node',format:'esm',loader:{'.txt':'text'},outfile:join(dir,'connectivity.mjs')});
const {probeConnection}=await import(pathToFileURL(join(dir,'connectivity.mjs')).href);
function fixture() {
 const sql=new DatabaseSync(':memory:');
for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe'])sql.exec(readFileSync(`../ingest/migrations/${name}.sql`,'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json,tier) VALUES('s','Source','rss','{}','T1_5'); INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at,raw_r2_key) VALUES('a','s','https://example.com/a','h','Robot','Original robotics facts','2026-10-02','raw/a')");
 const db:any={prepare(query:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return sql.prepare(query).get(...values)??null;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},execute(){return sql.prepare(query).run(...values);}};},async batch(stmts:any[]){sql.exec('BEGIN');try{const result=stmts.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db};
}
const args={article_id:'a',run_id:'phase2b-hybrid-interactive-test-a',prompt_version:HYBRID_PROMPT_VERSION};
const dimensions={industry_impact:70,robotics_relevance:80,soc_relevance:40,commercial_signal:30,technical_novelty:90,source_credibility:80};
const score={...args,slot:'A',dimension_scores:dimensions,total:63,reason:'A private reasoning MUST NOT be sent'};
const env={AGNES_API_KEY:'fixture-key',AGNES_MODEL:'agnes-2.5-flash',AGNES_REVIEW_ENABLED:'true',AGNES_REVIEW_CALL_LIMIT:'5'};
async function claim(db:any) {await saveProduction(db,'save_prefilter',{...args,status:'PASS',reason:'Robot'},'chatgpt');assert.equal((await saveProduction(db,'save_score',score,'chatgpt')).saved,true);}
test('isolated AGNES request is factual, stage-guarded, audited, idempotent and cannot be replaced by caller score B',async()=>{
 const {sql,db}=fixture();await claim(db);const facts=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 assert.equal((await saveProduction(db,'save_score',{...score,slot:'B'},'chatgpt')).saved,false);
 let calls=0;const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url:any,init:any)=>{calls++;assert.equal(url,'https://apihub.agnes-ai.com/v1/chat/completions');const body=JSON.parse(init.body);assert.equal(body.messages.length,2);assert.equal(body.model,env.AGNES_MODEL);assert.ok(!init.body.includes(score.reason));const evidence=JSON.parse(body.messages[1].content);assert.deepEqual(Object.keys(evidence),['id','title','summary','canonical_url','author','published_at','source_tier','source_first_party']);assert.equal(evidence.summary,'Original robotics facts');assert.ok(!init.body.includes('raw/a'));return Response.json({id:'agnes-response',model:'agnes-2.5-flash',usage:{total_tokens:20},choices:[{message:{content:JSON.stringify({dimensions,reason:'Independent source reasoning'})}}]});};
 try {
  assert.equal((await independentReview(db,args,'other',env)).error,'run_id_conflict');assert.equal(calls,0);
  assert.equal((await independentReview(db,args,'chatgpt',env)).saved,true);
  assert.equal((await independentReview(db,args,'chatgpt',{...env,AGNES_REVIEW_ENABLED:'false'})).inserted,false);assert.equal(calls,1);
  const audit=sql.prepare("SELECT * FROM mcp_ai_runs WHERE stage='score_b'").get()!;assert.equal(audit.provider,'AGNES API');assert.equal(audit.independence,'independent_stateless_request');assert.equal(audit.response_id,'agnes-response');assert.equal(audit.billing_path,'AGNES API (user-authorized)');
  assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),facts);
  assert.equal((await saveProduction(db,'save_score',{...score,slot:'B',reason:'Forged'},'chatgpt')).error,'receipt_conflict');
  sql.exec("INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at) VALUES('b','s','https://example.com/b','hb','Second robot','New factual evidence','2026-10-02')");
  const next={...args,article_id:'b',run_id:'phase2b-hybrid-interactive-test-b'};
  await saveProduction(db,'save_prefilter',{...next,status:'PASS',reason:'Robot'},'chatgpt');
  await saveProduction(db,'save_score',{...score,...next},'chatgpt');
  const exhausted=await independentReview(db,next,'chatgpt',{...env,AGNES_REVIEW_CALL_LIMIT:'1'});
  assert.equal(exhausted.fallback_allowed,true);assert.equal(exhausted.error,'review_call_budget_exhausted');assert.equal(calls,1);
 }finally{globalThis.fetch=oldFetch;}
});
test('disabled or exhausted AGNES records Plus fallback without a paid call and allows dual Plus completion',async()=>{
 for(const disabled of [true,false]) {
  const {sql,db}=fixture();await claim(db);if(!disabled)sql.exec("INSERT INTO mcp_external_reviews(run_id,article_id,caller_client_id,prompt_version,model,input_json,input_hash,selected_path,status,request_started_at) VALUES('phase2b-hybrid-interactive-test-a','a','chatgpt','robotics-plus-agnes-mcp.phase2b.v1','agnes','{}','h','plus_fallback','unknown',CURRENT_TIMESTAMP)");
  const result=await independentReview(db,args,'chatgpt',{...env,AGNES_REVIEW_ENABLED:disabled?'false':'true'});assert.equal(result.fallback_allowed,true);
  assert.equal((await saveProduction(db,'save_score',{...score,slot:'B',reason:'Plus fallback source review'},'chatgpt')).saved,true);
  const audit=sql.prepare("SELECT * FROM mcp_ai_runs WHERE stage='score_b'").get()!;assert.equal(audit.provider,'ChatGPT Plus fallback/MCP');assert.equal(audit.independence,'not_verified');assert.equal(audit.billing_path,'no_paid_model_api');
  const structure={...args,category:'paper',tags:[],companies:[],fact_frame:{subject:'robot',action:'tested',object:'task',evidence:'Original robotics facts'},robotics_relevance:'robot',soc_relevance:'未披露',commercial_signal:'未披露'};
  await saveProduction(db,'save_structure',structure,'chatgpt');assert.equal((await saveProduction(db,'finalize_processing',{article_id:'a',run_id:args.run_id},'chatgpt')).saved,true);
  assert.equal((await independentReview(db,args,'chatgpt',{...env,AGNES_REVIEW_ENABLED:'false'})).inserted,false);
  assert.equal((await saveProduction(db,'save_prefilter',{...args,status:'PASS',reason:'Robot'},'chatgpt')).inserted,false);
 }
});
test('transport uncertainty is retained and fallback never repeats a possibly billed request',async()=>{
 const {sql,db}=fixture();await claim(db);const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('timeout');};
 try{const result=await independentReview(db,args,'chatgpt',env);assert.equal(result.external_status,'unknown');assert.equal(result.fallback_allowed,true);assert.equal((await independentReview(db,args,'chatgpt',env)).fallback_allowed,true);assert.equal(calls,1);assert.equal(sql.prepare('SELECT status FROM mcp_external_reviews').get()!.status,'unknown');}finally{globalThis.fetch=oldFetch;}
});
test('budget and mutable facts fail closed; pending reservation cannot call API twice',async()=>{
 const {sql,db}=fixture();await claim(db);assert.equal((await independentReview(db,args,'chatgpt',{...env,AGNES_REVIEW_CALL_LIMIT:'0'})).error,'review_budget_disabled');
 const changed=fixture();await claim(changed.db);changed.sql.exec("UPDATE articles SET summary='tampered'");assert.equal((await independentReview(changed.db,args,'chatgpt',env)).error,'state_run_snapshot_conflict');
 const pending=fixture();await claim(pending.db);pending.sql.exec("INSERT INTO mcp_external_reviews(run_id,article_id,caller_client_id,prompt_version,model,input_json,input_hash,selected_path,status,request_started_at) VALUES('phase2b-hybrid-interactive-test-a','a','chatgpt','robotics-plus-agnes-mcp.phase2b.v1','agnes','{}','h','agnes','pending',CURRENT_TIMESTAMP)");assert.equal((await independentReview(pending.db,args,'chatgpt',env)).error,'review_pending_or_interrupted_no_automatic_retry');
 assert.ok(!('score_a' in reviewerInput({id:'a',title:'robot',summary:'facts',score_a:99,reason:'hidden',raw_r2_key:'hidden'})));
});
test('manual redirect mode rejects redirects without forwarding the credential or repeating the request',async()=>{
 const {db}=fixture();await claim(db);const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url:any,init:any)=>{calls++;assert.equal(init.redirect,'manual');return new Response('',{status:307,headers:{Location:'https://untrusted.invalid/'}});};
 try{const result=await independentReview(db,args,'chatgpt',env);assert.equal(result.error,'provider_http_307');assert.equal(result.fallback_allowed,true);await independentReview(db,args,'chatgpt',env);assert.equal(calls,1);}finally{globalThis.fetch=oldFetch;}
});
test('both authorized models work; reserved model changes and arbitrary models are rejected',async()=>{
 const {db}=fixture();await claim(db);const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url:any,init:any)=>{calls++;assert.equal(JSON.parse(init.body).model,'agnes-3.0-flash');return Response.json({model:'agnes-3.0-flash',id:'model3-fixture',choices:[{message:{content:JSON.stringify({dimensions,reason:'Independent model 3 evidence'})}}]});};
 try{const selected={...args,model:'agnes-3.0-flash'};assert.equal((await independentReview(db,selected,'chatgpt',env)).saved,true);assert.equal((await independentReview(db,selected,'chatgpt',env)).inserted,false);assert.equal((await independentReview(db,{...args,model:'agnes-2.5-flash'},'chatgpt',env)).error,'review_model_conflict');await assert.rejects(()=>independentReview(db,{...args,model:'arbitrary'},'chatgpt',env));assert.equal(calls,1);}finally{globalThis.fetch=oldFetch;}
});
test('standalone cloud connectivity probes preserve articles, replay without cost and share the exact reviewer budget',async()=>{
 const {sql,db}=fixture();const before=sql.prepare('SELECT * FROM articles').get();const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url:any,init:any)=>{calls++;assert.equal(init.redirect,'manual');return Response.json({model:'agnes-2.5-flash',id:'connectivity-fixture',usage:{total_tokens:10},choices:[{message:{content:'{"decision":"BLOCK","reason":"Synthetic weather probe"}'}}]});};
 try{const probe={probe_id:'agnes-connectivity-test-25',model:'agnes-2.5-flash'};const result=await probeConnection(db,probe,{...env,AGNES_REVIEW_CALL_LIMIT:'1'});assert.equal(result.ok,true);assert.equal(result.receipt.http_status,200);assert.equal((await probeConnection(db,probe,env)).inserted,false);assert.equal((await probeConnection(db,{...probe,model:'agnes-3.0-flash'},env)).error,'probe_id_model_conflict');assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);await claim(db);assert.equal((await independentReview(db,args,'chatgpt',{...env,AGNES_REVIEW_CALL_LIMIT:'1'})).error,'review_call_budget_exhausted');assert.equal(calls,1);await assert.rejects(()=>probeConnection(db,{...probe,sql:'SELECT 1'},env));}finally{globalThis.fetch=oldFetch;}
});
test('standalone score probe uses frozen rubric and facts, validates the score, and never writes production stages',async()=>{
 const {sql,db}=fixture();await claim(db);
 const before=sql.prepare('SELECT * FROM articles').get(), receipts=sql.prepare('SELECT count(*) AS n FROM mcp_task_receipts').get();
 const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url:any,init:any)=>{calls++;const body=JSON.parse(init.body);assert.ok(body.messages[0].content.includes('industry_impact'));assert.ok(!init.body.includes(score.reason));assert.ok(!init.body.includes('raw/a'));return Response.json({id:'standalone-score',model:'agnes-2.5-flash',usage:{total_tokens:100},choices:[{message:{content:JSON.stringify({dimensions,reason:'Source-only standalone scoring'})}}]});};
 const args={probe_id:'agnes-connectivity-score-test',model:'agnes-2.5-flash',stage:'score_b',article_id:'a'};
 try{const result=await probeConnection(db,args,env);assert.equal(result.ok,true);assert.equal(JSON.parse(result.receipt.validated_output).score,63);assert.equal((await probeConnection(db,args,env)).inserted,false);assert.equal((await probeConnection(db,{...args,stage:'prefilter',article_id:undefined},env)).error,'probe_id_input_conflict');assert.equal((await probeConnection(db,{...args,article_id:'b'},env)).error,'probe_id_input_conflict');assert.equal(calls,1);assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);assert.deepEqual(sql.prepare('SELECT count(*) AS n FROM mcp_task_receipts').get(),receipts);await assert.rejects(()=>probeConnection(db,{...args,article_id:undefined},env));}finally{globalThis.fetch=oldFetch;}
});
test('provider 429 diagnostics retain useful gateway evidence while redacting credentials',async()=>{
 const {db}=fixture();const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<html>Too Many Requests Bearer fixture-key https://example.invalid/private</html>',{status:429,headers:{'Retry-After':'600','Content-Type':'text/html','Server':'gateway','cf-ray':'trace-fixture'}});
 try{const result=await probeConnection(db,{probe_id:'agnes-connectivity-error-diagnostics',model:'agnes-2.5-flash'},env);assert.equal(result.ok,false);const details=JSON.parse(result.receipt.output);assert.equal(details.retry_after,'600');assert.equal(details.server,'gateway');assert.equal(details['cf-ray'],'trace-fixture');assert.ok(details.message.includes('Too Many Requests'));assert.ok(!result.receipt.output.includes('fixture-key'));assert.ok(!result.receipt.output.includes('example.invalid'));}finally{globalThis.fetch=oldFetch;}
});
