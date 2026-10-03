import { inputHash } from './evidence.ts';
import { z } from 'zod';
import { prefilterSchema, scoreSchema, structureSchema, REVIEWER_PROMPT_VERSION, EVIDENCE_PROMPT_VERSION, weights } from './processing.ts';

const id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const identity={id,article_id:id,reviewer_run_id:id,scheduled_task_id:id,context_id:id,
 prompt_version:z.enum([REVIEWER_PROMPT_VERSION,EVIDENCE_PROMPT_VERSION]),input_snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/)};
const scorePayload=scoreSchema.omit({article_id:true,run_id:true,prompt_version:true,slot:true});
export const submissionSchema=z.object({...identity,reviewer:z.literal('A'),
 payload:z.object({prefilter:prefilterSchema.omit({article_id:true,run_id:true,prompt_version:true}),score:scorePayload.optional()}).strict()}).strict();
export const bSubmissionSchema=z.object({...identity,reviewer:z.literal('B'),
 payload:z.object({score_b:scorePayload,structure:structureSchema.omit({article_id:true,run_id:true,prompt_version:true})}).strict()}).strict();
const anySubmissionSchema=z.discriminatedUnion('reviewer',[submissionSchema,bSubmissionSchema]);
export const receiptLookupSchema=z.object({article_id:id,prompt_version:z.enum([REVIEWER_PROMPT_VERSION,EVIDENCE_PROMPT_VERSION]),input_snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
// Own-role only; B must never receive the A submission or application context.
export async function getReviewSubmission(db:D1Database,role:'A'|'B',input:unknown,clientId:string) {
 const a=receiptLookupSchema.parse(input);
 const row=await db.prepare(`SELECT s.payload_json,v.validation_status,v.applied_at,v.error FROM review_submissions s
 JOIN review_submission_status v ON v.id=s.id WHERE s.article_id=? AND s.reviewer=?
 AND s.prompt_version=? AND s.input_snapshot_hash=? AND s.caller_client_id=?`).bind(a.article_id,role,a.prompt_version,a.input_snapshot_hash,clientId).first<any>();
 return row?{found:true,submission:JSON.parse(row.payload_json),status:row.validation_status,applied_at:row.applied_at,error:row.error,read_only:true}:{found:false,read_only:true};
}
export const applySchema=z.object({id}).strict();
export function canonical(v:any):string {
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
export async function digest(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
// L0: schema and arithmetic only. No database, network, or model call.
export function validateReviewResult(input:unknown) {
 const parsed=anySubmissionSchema.safeParse(input);
 if(!parsed.success)return {valid:false,error:'invalid_submission_schema'};
 const a=parsed.data;
 if(a.prompt_version===EVIDENCE_PROMPT_VERSION&&a.reviewer==='B'&&['facts','inferences','unknowns'].some(k=>!Array.isArray((a.payload.structure as any)[k])))return {valid:false,error:'evidence_structure_fields_required'};
 if(a.reviewer==='A'&&(a.payload.prefilter.status==='BLOCK')!==!a.payload.score)return {valid:false,error:'score_required_unless_blocked'};
 const score=a.reviewer==='A'?a.payload.score:a.payload.score_b;
 if(score){
  const total=Math.round(Object.entries(weights).reduce((s,[k,w])=>s+(score.dimension_scores as any)[k]*w,0)*100)/100;
  if(Math.abs(total-score.total)>0.001)return {valid:false,error:'weighted_total_mismatch',expected_total:total};
 }
 return {valid:true,id:a.id,reviewer:a.reviewer,prompt_version:a.prompt_version};
}
export async function appendReview(db:D1Database,input:unknown,clientId:string,probe=false) {
 const valid=validateReviewResult(input);if(!valid.valid)return {saved:false,...valid};
 const a=anySubmissionSchema.parse(input),serialized=canonical(a),table=probe?'review_submission_probes':'review_submissions';
 const existing=await db.prepare(`SELECT * FROM ${table} WHERE id=? OR reviewer_run_id=?`).bind(a.id,a.reviewer_run_id).first<any>();
 if(existing)return existing.id===a.id&&existing.payload_json===serialized&&existing.caller_client_id===clientId?
  {saved:true,inserted:false,id:a.id,production_articles_modified:false}:{saved:false,error:'submission_conflict'};
 const facts=await db.prepare('SELECT f.snapshot,a.processing_status FROM mcp_article_facts f JOIN articles a ON a.id=f.id WHERE f.id=?').bind(a.article_id).first<any>();
 if(!facts||facts.processing_status!==(a.reviewer==='A'?'new':'processing')||await inputHash(db,a.article_id,facts.snapshot,a.prompt_version)!==a.input_snapshot_hash)return {saved:false,error:'article_not_new_or_snapshot_changed'};
 if(a.reviewer==='B'){
  const parent=await appliedA(db,a.article_id);
  if(!parent||parent.input_snapshot_hash!==a.input_snapshot_hash||parent.prompt_version!==a.prompt_version||parent.caller_client_id!==clientId)return {saved:false,error:'applied_a_required'};
  if(parent.context_id===a.context_id||parent.scheduled_task_id===a.scheduled_task_id||parent.reviewer_run_id===a.reviewer_run_id)return {saved:false,error:'independent_context_required'};
 }
 try {
  if(probe)await db.prepare('INSERT INTO review_submission_probes(id,article_id,reviewer_run_id,payload_json,caller_client_id) VALUES(?,?,?,?,?)').bind(a.id,a.article_id,a.reviewer_run_id,serialized,clientId).run();
  else await db.prepare(`INSERT INTO review_submissions(id,article_id,reviewer,reviewer_run_id,scheduled_task_id,context_id,prompt_version,input_snapshot_hash,input_snapshot,payload_json,payload_hash,caller_client_id)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(a.id,a.article_id,a.reviewer,a.reviewer_run_id,a.scheduled_task_id,a.context_id,a.prompt_version,a.input_snapshot_hash,facts.snapshot,serialized,await digest(serialized),clientId).run();
 } catch {
  const winner=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(a.id).first<any>();
  if(winner?.payload_json===serialized&&winner.caller_client_id===clientId)return {saved:true,inserted:false,id:a.id,production_articles_modified:false};
  return {saved:false,error:'submission_conflict'};
 }
 return {saved:true,inserted:true,id:a.id,production_articles_modified:false};
}
// Admin-only deterministic commit. One D1 transaction includes all receipts and status.
export async function applyReviewSubmission(db:D1Database,input:unknown) {
 const {id}=applySchema.parse(input);
 const prior=await db.prepare('SELECT * FROM review_submission_applications WHERE submission_id=?').bind(id).first<any>();
 if(prior)return {applied:prior.validation_status==='applied',inserted:false,id,error:prior.error};
 const row=await db.prepare('SELECT * FROM review_submissions WHERE id=?').bind(id).first<any>();
 if(!row)return {applied:false,error:'submission_not_found'};
 let a:z.infer<typeof anySubmissionSchema>|undefined,error:string|undefined;
 try {
  const input=JSON.parse(row.payload_json),valid=validateReviewResult(input);
  if(!valid.valid)error=valid.error;
  else {
   a=anySubmissionSchema.parse(input);
   if(a.id!==row.id||a.article_id!==row.article_id||a.reviewer!==row.reviewer||a.reviewer_run_id!==row.reviewer_run_id||a.scheduled_task_id!==row.scheduled_task_id||a.context_id!==row.context_id||a.prompt_version!==row.prompt_version||a.input_snapshot_hash!==row.input_snapshot_hash||row.caller_client_id!=='https://chatgpt.com/oauth/client.json')error='reviewer_identity_conflict';
   const facts=await db.prepare('SELECT snapshot FROM mcp_article_facts WHERE id=?').bind(a.article_id).first<any>();
   if(!facts||facts.snapshot!==row.input_snapshot||await inputHash(db,a.article_id,facts.snapshot,a.prompt_version)!==a.input_snapshot_hash||await digest(row.payload_json)!==row.payload_hash)error='snapshot_or_payload_changed';
  }
 }catch{error='invalid_submission_schema';}
 if(error||!a){
  await db.prepare("INSERT OR IGNORE INTO review_submission_applications(submission_id,validation_status,error) VALUES(?,'rejected',?)").bind(id,error??'invalid_submission').run();
  return {applied:false,id,error};
 }
 const parent=a.reviewer==='B'?await appliedA(db,a.article_id):null;
 if(a.reviewer==='B'&&(!parent||parent.input_snapshot_hash!==a.input_snapshot_hash||parent.prompt_version!==a.prompt_version||parent.caller_client_id!==row.caller_client_id||parent.context_id===a.context_id||parent.scheduled_task_id===a.scheduled_task_id||parent.reviewer_run_id===a.reviewer_run_id)){
  const error='applied_a_or_independent_identity_required';
  await db.prepare("INSERT OR IGNORE INTO review_submission_applications(submission_id,validation_status,error) VALUES(?,'rejected',?)").bind(id,error).run();
  return {applied:false,id,error};
 }
 const provider='ChatGPT Plus separate reviewers/MCP';
 const processingRun=a.reviewer==='A'?a.reviewer_run_id:parent.reviewer_run_id;
 const stmts=[];
 const reviewerTable=a.prompt_version===EVIDENCE_PROMPT_VERSION?'mcp_reviewer_runs_v2':'mcp_reviewer_runs';
 if(a.reviewer==='A')stmts.push(db.prepare(`INSERT INTO mcp_processing_runs(run_id,article_id,caller_client_id,provider,runtime_claim,prompt_version,input_snapshot) VALUES(?,?,?,?,?,?,?)`).bind(a.reviewer_run_id,a.article_id,row.caller_client_id,provider,'Submission identity declared; external Scheduled run evidence required',a.prompt_version,row.input_snapshot));
 stmts.push(db.prepare(`INSERT INTO ${reviewerTable}(reviewer_run_id,processing_run_id,article_id,reviewer,scheduled_task_id,context_id,caller_client_id,prompt_version,input_snapshot) VALUES(?,?,?,?,?,?,?,?,?)`).bind(a.reviewer_run_id,processingRun,a.article_id,a.reviewer,a.scheduled_task_id,a.context_id,row.caller_client_id,a.prompt_version,row.input_snapshot));
 const stages:[string,unknown][]=a.reviewer==='A'?[['prefilter',a.payload.prefilter],...(a.payload.score?[['score_a',a.payload.score] as [string,unknown]]:[])]:[['score_b',a.payload.score_b],['structure',a.payload.structure],['finalize',{}]];
 for(const [stage,payload] of stages){
  const serialized=canonical(payload);
  stmts.push(db.prepare(`INSERT INTO mcp_task_receipts(run_id,stage,payload,payload_hash,provider,prompt_version,caller_client_id,reviewer,reviewer_run_id,scheduled_task_id,context_id,input_snapshot_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(processingRun,stage,serialized,await digest(serialized),provider,a.prompt_version,row.caller_client_id,a.reviewer,a.reviewer_run_id,a.scheduled_task_id,a.context_id,a.input_snapshot_hash));
 }
 stmts.push(db.prepare("INSERT INTO review_submission_applications(submission_id,validation_status,applied_at) VALUES(?,'applied',CURRENT_TIMESTAMP)").bind(id));
 try{await db.batch(stmts);}catch{
  const winner=await db.prepare('SELECT * FROM review_submission_applications WHERE submission_id=?').bind(id).first<any>();
  if(winner)return {applied:winner.validation_status==='applied',inserted:false,id,error:winner.error};
  await db.prepare("INSERT OR IGNORE INTO review_submission_applications(submission_id,validation_status,error) VALUES(?,'rejected','state_run_snapshot_or_stage_conflict')").bind(id).run();
  return {applied:false,id,error:'state_run_snapshot_or_stage_conflict'};
 }
 return {applied:true,inserted:true,id,model_calls:0};
}

async function appliedA(db:D1Database,articleId:string) {
 return db.prepare(`SELECT s.* FROM review_submissions s JOIN review_submission_applications v ON v.submission_id=s.id
 JOIN mcp_processing_runs p ON p.run_id=s.reviewer_run_id JOIN articles a ON a.id=p.article_id
 WHERE s.article_id=? AND s.reviewer='A' AND v.validation_status='applied' AND p.status='processing'
 AND a.processing_status='processing' AND a.prefilter_status IN ('PASS','UNKNOWN') AND a.score_a IS NOT NULL
 AND EXISTS(SELECT 1 FROM mcp_task_receipts t WHERE t.run_id=p.run_id AND t.stage='score_a')`).bind(articleId).first<any>();
}
// Cloudflare cron applies A first, then B; no model or reviewer token is involved.
export async function applyPendingReviews(db:D1Database,limit=10) {
 const rows=await db.prepare(`SELECT s.id FROM review_submissions s LEFT JOIN review_submission_applications v ON v.submission_id=s.id
 WHERE v.submission_id IS NULL ORDER BY s.reviewer,s.created_at,s.id LIMIT ?`).bind(limit).all<{id:string}>();
 const results=[];for(const row of rows.results)results.push(await applyReviewSubmission(db,row));
 return results;
}
