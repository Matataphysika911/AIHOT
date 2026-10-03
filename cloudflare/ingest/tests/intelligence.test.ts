import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir=mkdtempSync(join(tmpdir(),'intelligence-test-'));
await build({entryPoints:['src/intelligence.ts'],bundle:true,platform:'node',format:'esm',loader:{'.txt':'text'},outfile:join(dir,'intelligence.mjs')});
const api=await import(pathToFileURL(join(dir,'intelligence.mjs')).href);
class DB {
 db=new DatabaseSync(':memory:');
 constructor() {
  for(const file of ['0001_initial.sql','0002_phase_1_1.sql','0005_intelligence.sql']) this.db.exec(readFileSync(`migrations/${file}`,'utf8'));
 }
 prepare(sql:string) {
  const db=this.db; let values:any[]=[];
  return {bind(...args:any[]) {values=args;return this;},async run() { const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},async first() {return db.prepare(sql).get(...values)??null;},async all() {return {results:db.prepare(sql).all(...values)};}};
 }
 async batch(statements:any[]) {this.db.exec('BEGIN');try{const results=[];for(const statement of statements) results.push(await statement.run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
function fixture(tier='T1') {
 const DBInstance=new DB();
 DBInstance.db.prepare(`INSERT INTO sources(id,name,kind,config_json,tier) VALUES('source','Fixture','rss','{}',?)`).run(tier);
 DBInstance.db.exec(`INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at) VALUES('article','source','https://example.com/a','hash','Robot release','New robot','2026-10-01')`);
 const messages:any[]=[];
 return {DB:DBInstance,PROCESSING_QUEUE:{async send(body:any){messages.push(body);}},messages};
}
test('weighted robotics dimensions and exact tier boundaries',()=>{
 const score=api.validate('score_a',JSON.stringify({dimensions:{industry_impact:100,robotics_relevance:80,soc_relevance:60,commercial_signal:40,technical_novelty:20,source_credibility:0},reason:'Evidence'}));
 assert.equal(score.score,61);
 assert.equal(api.selection(59,61,'T1',true).selection_status,'selected');
 assert.equal(api.selection(64,65,'T1_5',true).selection_status,'near-selected');
 assert.equal(api.selection(75,77,'T2',true).selection_status,'selected');
 assert.equal(api.selection(99,99,'T1',false).selection_status,'ineligible');
 assert.equal(api.selection(99,99,'EXCLUDE_MP',true).selection_status,'unrated');
 assert.throws(()=>api.validate('score_b',JSON.stringify({dimensions:{industry_impact:101},reason:'bad'})));
 assert.throws(()=>api.validate('prefilter','{"decision":"MAYBE","reason":"bad"}'));
});
test('two independent receipts; duplicate and concurrent processing is idempotent; mock never writes articles',async()=>{
 const env=fixture(); const a=await api.enqueueArticle(env,'article','mock');const b=await api.enqueueArticle(env,'article','mock');assert.equal(a.taskId,b.taskId);
 await Promise.allSettled([api.processTask(env,a.taskId),api.processTask(env,a.taskId)]);
 await api.processTask(env,a.taskId);
 const receipts=env.DB.db.prepare('SELECT * FROM task_receipts ORDER BY stage').all(); assert.equal(receipts.length,4);
 assert.equal(env.DB.db.prepare('SELECT count(*) n FROM ai_runs').get()!.n,4);
 const scoreA=receipts.find(x=>x.stage==='score_a')!,scoreB=receipts.find(x=>x.stage==='score_b')!;assert.notEqual(scoreA.id,scoreB.id);
 assert.equal(env.DB.db.prepare('SELECT processing_status,final_score FROM articles').get()!.processing_status,'new');
 assert.equal(env.DB.db.prepare('SELECT final_score FROM articles').get()!.final_score,null);
});
test('received response recovers without another call; retry keeps successful earlier stages',async()=>{
 const env=fixture();const a=await api.enqueueArticle(env,'article','mock');await api.processTask(env,a.taskId);
 env.DB.db.exec(`UPDATE processing_tasks SET status='retry'; UPDATE task_receipts SET status='received',validated_output=NULL WHERE stage='score_b';`);
 await api.processTask(env,a.taskId);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM ai_runs').get()!.n,4);
 env.DB.db.exec(`UPDATE processing_tasks SET status='retry'; UPDATE task_receipts SET status='retry',output=NULL,validated_output=NULL WHERE stage='structure';`);
 await api.processTask(env,a.taskId);assert.equal(env.DB.db.prepare('SELECT count(*) n FROM ai_runs').get()!.n,5);
});
test('unknown paid outcome stops automatic resend; invalid schema remains audited',async()=>{
 const env=fixture();const a=await api.enqueueArticle(env,'article','mock');await api.processTask(env,a.taskId);
 env.DB.db.exec(`UPDATE processing_tasks SET status='retry';UPDATE task_receipts SET status='pending' WHERE stage='score_b';`);
 await assert.rejects(api.processTask(env,a.taskId),/receipt_outcome_unknown/);
 assert.equal(env.DB.db.prepare('SELECT status FROM processing_tasks').get()!.status,'unknown');
 assert.equal(env.DB.db.prepare('SELECT count(*) n FROM ai_runs').get()!.n,4);
 env.DB.db.exec(`UPDATE processing_tasks SET status='retry',next_attempt_at=NULL; UPDATE task_receipts SET status='received',output='{}' WHERE stage='score_b';`);
 await assert.rejects(api.processTask(env,a.taskId),/invalid_stage_schema/);
 assert.equal(env.DB.db.prepare('SELECT status FROM processing_tasks').get()!.status,'failed');
});
test('protected processing endpoint validates and unavailable live provider reports 503',async()=>{
 const env=fixture();const request=new Request('https://example.com/admin/processing/enqueue',{method:'POST',body:JSON.stringify({articleIds:['article'],mode:'live'})});
 assert.equal((await api.manualProcessing(request,env)).status,503);
});
test('canonical prompt and threshold snapshots match industry files',()=>{
 assert.equal(readFileSync('src/prompts/scoring.v1.txt','utf8'),readFileSync('../../industry/robotics/scoring.v1.md','utf8'));
 assert.equal(readFileSync('src/prompts/analysis.v1.txt','utf8'),readFileSync('../../industry/robotics/prompts/analysis.v1.md','utf8'));
 assert.equal(readFileSync('src/taxonomy.ts','utf8'),readFileSync('../../industry/taxonomy.ts','utf8'));
 assert.equal(readFileSync('src/selection.ts','utf8'),readFileSync('../../industry/selection.ts','utf8'));
});
test('live provider makes independent calls; 429 retries only failed stage; atomic budget stops extra calls',async()=>{
 const env={...fixture('T2'),MODEL_CALLS_ENABLED:'true',INTELLIGENCE_API_KEY:'test-only',INTELLIGENCE_BASE_URL:'https://provider.invalid/v1',INTELLIGENCE_MODEL:'test-model',INTELLIGENCE_DAILY_CALL_LIMIT:'6',INTELLIGENCE_HOURLY_CALL_LIMIT:'6'};
 const requests:any[]=[]; const oldFetch=globalThis.fetch;let rejectOnce=true;
 globalThis.fetch=async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);requests.push({key:init.headers['Idempotency-Key'],body});
  if(requests.length===3&&rejectOnce){rejectOnce=false;return new Response('{}',{status:429});}
  const prompt=body.messages[0].content;
  const content=prompt.includes('prefilter')?{decision:'PASS',reason:'robot'}:prompt.includes('independent reviewer')?{dimensions:{industry_impact:80,robotics_relevance:80,soc_relevance:80,commercial_signal:80,technical_novelty:80,source_credibility:80},reason:'fixture'}:{category:'robotics-products',tags:[],companies:[],fact_frame:{subject:'robot',action:'released',object:'product',evidence:'source'},robotics_relevance:'robot',soc_relevance:'未披露',commercial_signal:'launch',what_happened:'release',why_it_matters:'robot',what_to_watch:[]};
  return Response.json({choices:[{message:{content:JSON.stringify(content)}}]});
 };
 try {
  const task=await api.enqueueArticle(env,'article','live');await assert.rejects(api.processTask(env,task.taskId),/provider_http_429/);
  env.DB.db.exec(`UPDATE processing_tasks SET next_attempt_at=NULL;`);await api.processTask(env,task.taskId);
  assert.equal(requests.length,5);assert.notEqual(requests[1].key,requests[2].key);assert.equal(requests[2].key,requests[3].key);
  assert.deepEqual(requests[1].body.messages,requests[2].body.messages);
  assert.equal(env.DB.db.prepare('SELECT selection_status FROM articles').get()!.selection_status,'selected');
  env.DB.db.exec(`UPDATE articles SET summary='changed';`);
  const next=await api.enqueueArticle(env,'article','live');await assert.rejects(api.processTask(env,next.taskId),/call_budget_exhausted/);
  assert.equal(requests.length,6);
 } finally {globalThis.fetch=oldFetch;}
});
test('Worker requires admin token; authorized mock endpoint queues; invalid requests rejected',async()=>{
 await build({entryPoints:['src/index.ts'],bundle:true,platform:'node',format:'esm',loader:{'.txt':'text'},outfile:join(dir,'worker.mjs')});
 const worker=(await import(pathToFileURL(join(dir,'worker.mjs')).href)).default;
 const env={...fixture(),ADMIN_TOKEN:'test-admin'};
 const url='https://example.com/admin/processing/enqueue';
 assert.equal((await worker.fetch(new Request(url,{method:'POST',body:'{}'}),env)).status,401);
 const request=new Request(url,{method:'POST',headers:{authorization:'Bearer test-admin'},body:JSON.stringify({articleIds:['article'],mode:'mock'})});
 const response=await worker.fetch(request,env);assert.equal(response.status,200);assert.equal(env.messages.length,1);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{authorization:'Bearer test-admin'},body:'{"articleIds":[]}'}),env)).status,400);
});
test('BLOCK terminates before scoring; excluded tiers never receive scores',async()=>{
 const env={...fixture(),MODEL_CALLS_ENABLED:'true',INTELLIGENCE_API_KEY:'test-only',INTELLIGENCE_BASE_URL:'https://provider.invalid/v1',INTELLIGENCE_MODEL:'test-model'};
 const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'{"decision":"BLOCK","reason":"clearly unrelated"}'}}]});};
 try{
  const task=await api.enqueueArticle(env,'article','live');await api.processTask(env,task.taskId);
  assert.equal(calls,1);assert.equal(env.DB.db.prepare('SELECT selection_status FROM articles').get()!.selection_status,'blocked');
  assert.equal(env.DB.db.prepare('SELECT count(*) n FROM task_receipts').get()!.n,1);
 }finally{globalThis.fetch=oldFetch;}
 const excluded=fixture('EXCLUDE_MP');const task=await api.enqueueArticle(excluded,'article','mock');await api.processTask(excluded,task.taskId);
 assert.equal(excluded.DB.db.prepare("SELECT count(*) n FROM task_receipts WHERE stage IN ('score_a','score_b')").get()!.n,0);
 assert.equal(JSON.parse(excluded.DB.db.prepare('SELECT result_json FROM processing_tasks').get()!.result_json as string).selection_status,'unrated');
});
