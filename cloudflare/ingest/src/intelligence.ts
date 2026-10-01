import { CATEGORIES, CATEGORY_TAGS, TOPIC_TAGS, ENTITY_TAGS } from './taxonomy';
import { createProvider, ProviderError, providerReady, type ProviderEnv } from './provider';
import { PROMPTS, PROMPT_VERSION, type Stage } from './prompts';
import { SELECTION } from './selection';
export interface ProcessingJob { taskId: string }
export interface IntelligenceEnv extends ProviderEnv { DB: D1Database; PROCESSING_QUEUE: Queue<ProcessingJob> }
type Mode = 'live'|'mock';
type Obj = Record<string, unknown>;
interface Task { id:string; article_id:string; mode:Mode; revision:string; input_hash:string; input_json:string; status:string; attempts:number }
interface Receipt { id:string; status:string; output:string|null; validated_output:string|null }
export async function hash(value: string) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const dimensions = {industry_impact:.25,robotics_relevance:.2,soc_relevance:.2,commercial_signal:.15,technical_novelty:.1,source_credibility:.1};
function textField(value:unknown) { if(typeof value!=='string'||!value.trim()||value.length>12000) throw new Error('invalid_text_field'); return value; }
function strings(value:unknown) { if(!Array.isArray(value)||value.length>50||value.some(x=>typeof x!=='string'||x.length>1000)) throw new Error('invalid_array'); return value; }
export function validate(stage:Stage, raw:string): Obj {
 const data=JSON.parse(raw) as Obj;
 if(!data || typeof data!=='object'||Array.isArray(data)) throw new Error('invalid_object');
 if(stage==='prefilter') {
  if(!['PASS','UNKNOWN','BLOCK'].includes(String(data.decision))) throw new Error('invalid_prefilter');
  textField(data.reason); return data;
 }
 if(stage==='score_a'||stage==='score_b') {
  const d=data.dimensions as Obj; if(!d||typeof d!=='object') throw new Error('invalid_dimensions');
  let score=0;
  for(const [name,weight] of Object.entries(dimensions)) {
   const n=d[name]; if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100) throw new Error('invalid_dimension'); score+=n*weight;
  }
  textField(data.reason); return {...data,score:Math.round(score*100)/100};
 }
 for(const k of ['category','robotics_relevance','soc_relevance','commercial_signal','what_happened','why_it_matters']) textField(data[k]);
 for(const k of ['tags','companies','what_to_watch']) strings(data[k]);
 if(!CATEGORIES.some(category=>category.key===data.category)) throw new Error('invalid_category');
 const allowedTags=new Set<string>([...CATEGORY_TAGS,...TOPIC_TAGS,...ENTITY_TAGS]);
 if((data.tags as string[]).some(tag=>!allowedTags.has(tag))) throw new Error('invalid_tag');
 const frame=data.fact_frame as Obj; if(!frame||typeof frame!=='object') throw new Error('invalid_fact_frame');
 for(const k of ['subject','action','object','evidence']) textField(frame[k]);
 return data;
}
export function selection(a:number,b:number,tier:string,eligible:boolean) {
 const mean=(a+b)/2, threshold=SELECTION.thresholds[tier];
 return {score_a:a,score_b:b,final_score:Math.floor(mean),threshold:threshold??null,
  selection_status:!eligible?'ineligible':threshold===undefined?'unrated':a+b>=2*threshold?'selected':mean>SELECTION.understandFloor?'near-selected':'not-selected'};
}
async function revisionFor(env:IntelligenceEnv,mode:Mode) {
 const provider=createProvider(env,mode);
 return hash(JSON.stringify({version:PROMPT_VERSION,prompts:PROMPTS,selection:SELECTION,provider:provider.name,model:provider.model,base:mode==='live'?env.INTELLIGENCE_BASE_URL:null}));
}
export async function enqueueArticle(env:IntelligenceEnv,articleId:string,mode:Mode) {
 if(mode==='live'&&!providerReady(env)) throw new ProviderError('provider_not_configured_or_disabled','failed');
 const article=await env.DB.prepare(`SELECT a.id,a.title,a.summary,a.canonical_url,a.published_at,a.publish_eligible,a.is_backfill,s.name source_name,s.tier,s.first_party FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=?`).bind(articleId).first<Obj>();
 if(!article) throw new Error('article_not_found');
 const input=JSON.stringify(article), inputHash=await hash(input);
 const revision=await revisionFor(env,mode);
 const id=await hash(`${articleId}:${mode}:${revision}:${inputHash}`);
 await env.DB.prepare(`INSERT OR IGNORE INTO processing_tasks(id,article_id,mode,revision,input_hash,input_json,status) VALUES(?,?,?,?,?,?,'pending')`).bind(id,articleId,mode,revision,inputHash,input).run();
 const task=await env.DB.prepare('SELECT status FROM processing_tasks WHERE id=?').bind(id).first<{status:string}>();
 if(mode==='live') await env.DB.prepare("UPDATE articles SET intelligence_revision=?,processing_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(revision,task?.status==='pending'?'queued':task?.status??'queued',articleId).run();
 if(task?.status==='pending'||task?.status==='retry') await env.PROCESSING_QUEUE.send({taskId:id});
 return {taskId:id,status:task?.status,mode};
}
export async function enqueueNew(env:IntelligenceEnv) {
 if(!providerReady(env)) return;
 const rows=await env.DB.prepare(`SELECT id FROM articles WHERE processing_status='new' AND publish_eligible=1 ORDER BY discovered_at DESC LIMIT 10`).all<{id:string}>();
 for(const row of rows.results) await enqueueArticle(env,row.id,'live');
}
async function runStage(env:IntelligenceEnv,task:Task,stage:Stage) {
 const provider=createProvider(env,task.mode), receiptId=await hash(`${task.id}:${stage}`);
 await env.DB.prepare(`INSERT OR IGNORE INTO task_receipts(id,task_id,stage,provider,model,prompt_version,input_hash,status) VALUES(?,?,?,?,?,?,?,'retry')`).bind(receiptId,task.id,stage,provider.name,provider.model,`${PROMPT_VERSION}:${task.revision}`,task.input_hash).run();
 let receipt=await env.DB.prepare('SELECT id,status,output,validated_output FROM task_receipts WHERE id=?').bind(receiptId).first<Receipt>();
 if(receipt?.status==='succeeded') return JSON.parse(receipt.validated_output!) as Obj;
 if(receipt?.status==='pending') {
  await env.DB.batch([
   env.DB.prepare("UPDATE task_receipts SET status='unknown',error='interrupted_provider_call',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(receiptId),
   env.DB.prepare("UPDATE ai_runs SET status='unknown',error='interrupted_provider_call' WHERE receipt_id=? AND status='pending'").bind(receiptId),
  ]);
  throw new ProviderError('receipt_outcome_unknown','unknown');
 }
 if(receipt?.status==='unknown') throw new ProviderError('receipt_outcome_unknown','unknown');
 if(receipt?.status==='failed') throw new ProviderError('receipt_failed_requires_configuration_or_prompt_revision','failed');
 if(receipt?.status!=='received') {
  const runId=crypto.randomUUID();
  if(task.mode==='live') {
   const day=Number(env.INTELLIGENCE_DAILY_CALL_LIMIT??'100'), hour=Number(env.INTELLIGENCE_HOURLY_CALL_LIMIT??'20');
   if(!Number.isInteger(day)||!Number.isInteger(hour)||day<1||hour<1) throw new ProviderError('budget_disabled','retry');
   const reserved=await env.DB.prepare(`INSERT INTO intelligence_budget_slots(slot,run_id)
    SELECT ?,? WHERE (SELECT count(*) FROM intelligence_budget_slots WHERE datetime(created_at)>=datetime('now','-24 hours')) < ?
    AND (SELECT count(*) FROM intelligence_budget_slots WHERE datetime(created_at)>=datetime('now','-1 hour')) < ?`).bind(runId,runId,day,hour).run();
   if(!reserved.meta.changes) throw new ProviderError('call_budget_exhausted','retry');
  }
  await env.DB.batch([
   env.DB.prepare(`UPDATE task_receipts SET status='pending',updated_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?`).bind(receiptId),
   env.DB.prepare(`INSERT INTO ai_runs(id,receipt_id,mode,provider,model,prompt_version,input_hash,status) VALUES(?,?,?,?,?,?,?,'pending')`).bind(runId,receiptId,task.mode,provider.name,provider.model,`${PROMPT_VERSION}:${task.revision}`,task.input_hash),
  ]);
  const started=Date.now();
  try {
   // A and B receive the same article independently, without the other score or conversational history.
   const result=await provider.invoke(stage,JSON.parse(task.input_json),receiptId);
   await env.DB.batch([
    env.DB.prepare(`UPDATE task_receipts SET status='received',output=?,latency_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(result.output,Date.now()-started,receiptId),
    env.DB.prepare(`UPDATE ai_runs SET status='received',output=?,usage_json=?,latency_ms=?,finished_at=CURRENT_TIMESTAMP WHERE id=?`).bind(result.output,JSON.stringify(result.usage??null),Date.now()-started,runId),
   ]);
   receipt={id:receiptId,status:'received',output:result.output,validated_output:null};
  } catch(error) {
   const status=error instanceof ProviderError?error.disposition:'unknown';
   const safe=error instanceof ProviderError?error.message:'provider_or_persistence_outcome_unknown';
   await env.DB.batch([
    env.DB.prepare(`UPDATE task_receipts SET status=?,error=?,latency_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,safe,Date.now()-started,receiptId),
    env.DB.prepare(`UPDATE ai_runs SET status=?,error=?,latency_ms=?,finished_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,safe,Date.now()-started,runId),
   ]);
   throw new ProviderError(safe,status);
  }
 }
 let output:Obj;
 try { output=validate(stage,receipt!.output!); } catch {
  await env.DB.prepare(`UPDATE task_receipts SET status='failed',error='invalid_stage_schema',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(receiptId).run();
  await env.DB.prepare(`UPDATE ai_runs SET status='failed',error='invalid_stage_schema' WHERE receipt_id=? AND status='received'`).bind(receiptId).run();
  throw new ProviderError('invalid_stage_schema','failed');
 }
 await env.DB.batch([
  env.DB.prepare(`UPDATE task_receipts SET status='succeeded',validated_output=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(output),receiptId),
  env.DB.prepare(`UPDATE ai_runs SET status='succeeded' WHERE receipt_id=? AND status='received'`).bind(receiptId),
 ]);
 return output;
}
export async function processTask(env:IntelligenceEnv,id:string) {
 const token=crypto.randomUUID();
 const claimed=await env.DB.prepare(`UPDATE processing_tasks SET status='running',lease_token=?,lease_until=datetime('now','+10 minutes'),attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
 WHERE id=? AND (status IN ('pending','retry') OR (status='running' AND datetime(lease_until)<datetime('now'))) AND (next_attempt_at IS NULL OR datetime(next_attempt_at)<=datetime('now'))`).bind(token,id).run();
 if(!claimed.meta.changes) {
  const state=await env.DB.prepare('SELECT status FROM processing_tasks WHERE id=?').bind(id).first<{status:string}>();
  if(state?.status==='running'||state?.status==='retry'||state?.status==='pending') throw new ProviderError('task_busy_or_delayed','retry');
  return;
 }
 const task=(await env.DB.prepare('SELECT * FROM processing_tasks WHERE id=?').bind(id).first<Task>())!;
 if(task.mode==='live') await env.DB.prepare("UPDATE articles SET processing_status='processing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND intelligence_revision=?").bind(task.article_id,task.revision).run();
 try {
  if(task.revision!==await revisionFor(env,task.mode)) throw new ProviderError('configuration_revision_changed; enqueue_new_revision','failed');
  const input=JSON.parse(task.input_json) as Obj;
  const outputs:Partial<Record<Stage,Obj>>={};
  for(const stage of ['prefilter','score_a','score_b','structure'] as Stage[]) {
   if(stage!=='prefilter'&&outputs.prefilter?.decision==='BLOCK') break;
   if((stage==='score_a'||stage==='score_b')&&SELECTION.thresholds[String(input.tier)]===undefined) continue;
   await env.DB.prepare('UPDATE processing_tasks SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?').bind(stage,id,token).run();
   outputs[stage]=await runStage(env,task,stage);
  }
  const current=await env.DB.prepare('SELECT publish_eligible FROM articles WHERE id=?').bind(task.article_id).first<{publish_eligible:number}>();
  const result=outputs.prefilter?.decision==='BLOCK'?{selection_status:'blocked',prefilter:outputs.prefilter}:outputs.score_a&&outputs.score_b?
   {...selection(Number(outputs.score_a.score),Number(outputs.score_b.score),String(input.tier),input.publish_eligible===1&&current?.publish_eligible===1),prefilter:outputs.prefilter,structure:outputs.structure}:
   {selection_status:'unrated',prefilter:outputs.prefilter,structure:outputs.structure};
  const statements=[env.DB.prepare(`UPDATE processing_tasks SET status='completed',stage='done',result_json=?,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).bind(JSON.stringify(result),id,token)];
  if(task.mode==='live') statements.unshift(env.DB.prepare(`UPDATE articles SET processing_status='completed',prefilter_status=?,score_a=?,score_b=?,final_score=?,selection_status=?,structure_json=?,intelligence_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND intelligence_revision=? AND EXISTS(SELECT 1 FROM processing_tasks WHERE id=? AND lease_token=?)`).bind(outputs.prefilter?.decision??null,'score_a' in result?result.score_a:null,'score_b' in result?result.score_b:null,'final_score' in result?result.final_score:null,result.selection_status,JSON.stringify(outputs.structure??null),task.revision,task.article_id,task.revision,id,token));
  await env.DB.batch(statements);
 } catch(error) {
  let status=error instanceof ProviderError?error.disposition:'retry';
  const budgetWait=error instanceof ProviderError && ['call_budget_exhausted','budget_disabled'].includes(error.message);
  if(status==='retry'&&task.attempts>=4&&!budgetWait) status='failed';
  const safe=error instanceof ProviderError?error.message:'processing_failed';
  await env.DB.prepare(`UPDATE processing_tasks SET status=?,error=?,next_attempt_at=datetime('now',?),attempts=attempts-?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).bind(status,safe,budgetWait?'+1 hour':'+5 minutes',budgetWait?1:0,id,token).run();
  if(task.mode==='live') await env.DB.prepare("UPDATE articles SET processing_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND intelligence_revision=?").bind(status,task.article_id,task.revision).run();
  throw new ProviderError(safe,status);
 }
}
export async function recoverDue(env:IntelligenceEnv) {
 const tasks=await env.DB.prepare(`SELECT id FROM processing_tasks WHERE status IN ('pending','retry') AND (next_attempt_at IS NULL OR datetime(next_attempt_at)<=datetime('now')) OR status='running' AND datetime(lease_until)<datetime('now') LIMIT 20`).all<{id:string}>();
 for(const task of tasks.results) await env.PROCESSING_QUEUE.send({taskId:task.id});
}
export async function intelligenceHealth(env:IntelligenceEnv) {
 const states=await env.DB.prepare('SELECT mode,status,count(*) count FROM processing_tasks GROUP BY mode,status').all();
 const runs=await env.DB.prepare(`SELECT mode,status,count(*) count,round(avg(latency_ms)) latency_ms FROM ai_runs GROUP BY mode,status`).all();
 return {providerConfigured:!!env.INTELLIGENCE_API_KEY,liveEnabled:providerReady(env),promptVersion:PROMPT_VERSION,states:states.results,runs:runs.results};
}
export async function manualProcessing(request:Request,env:IntelligenceEnv) {
 const url=new URL(request.url);
 if(url.pathname==='/admin/processing/metrics'&&request.method==='GET') return Response.json(await intelligenceHealth(env));
 if(url.pathname==='/admin/processing/task'&&request.method==='GET') {
  const task=await env.DB.prepare('SELECT * FROM processing_tasks WHERE id=?').bind(url.searchParams.get('id')).first();
  const receipts=await env.DB.prepare('SELECT * FROM task_receipts WHERE task_id=?').bind(url.searchParams.get('id')).all();
  return Response.json({task,receipts:receipts.results});
 }
 if(url.pathname==='/admin/processing/enqueue'&&request.method==='POST') {
  const body=await request.json<{articleIds?:string[];mode?:string}>();
  if(!Array.isArray(body.articleIds)||body.articleIds.length<1||body.articleIds.length>20||body.articleIds.some(id=>typeof id!=='string')||!['live','mock'].includes(body.mode??'live')) return Response.json({error:'invalid_request'},{status:400});
  if((body.mode??'live')==='live'&&!providerReady(env)) return Response.json({error:'provider_not_configured_or_disabled'},{status:503});
  const tasks=[];
  for(const id of body.articleIds) tasks.push(await enqueueArticle(env,id,(body.mode??'live') as Mode));
  return Response.json({tasks});
 }
 if(url.pathname==='/admin/processing/retry'&&request.method==='POST') {
  const body=await request.json<{taskId?:string;acknowledgeUnknownCost?:boolean}>();
  if(!body.taskId) return Response.json({error:'taskId_required'},{status:400});
  const task=await env.DB.prepare('SELECT status,mode FROM processing_tasks WHERE id=?').bind(body.taskId).first<{status:string;mode:Mode}>();
  if(!task) return Response.json({error:'not_found'},{status:404});
  if(task.mode==='live'&&!providerReady(env)) return Response.json({error:'provider_not_configured_or_disabled'},{status:503});
  if(task.status==='unknown'&&!body.acknowledgeUnknownCost) return Response.json({error:'unknown_outcome_may_have_been_billed; explicit acknowledgement required'},{status:409});
  if(!['retry','failed','unknown'].includes(task.status)) return Response.json({error:'task_not_retryable'},{status:409});
  await env.DB.batch([
   env.DB.prepare(`UPDATE task_receipts SET status='retry',error=NULL WHERE task_id=? AND status IN ('failed','unknown','pending')`).bind(body.taskId),
   env.DB.prepare(`UPDATE processing_tasks SET status='retry',attempts=0,next_attempt_at=NULL,error=NULL WHERE id=?`).bind(body.taskId),
  ]);
  await env.PROCESSING_QUEUE.send({taskId:body.taskId});
  return Response.json({queued:body.taskId});
 }
 return new Response('Not Found',{status:404});
}
