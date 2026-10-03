import { materializeEvidence, inputHash, readEvidence, type EvidenceEnv } from './evidence.ts';
import { z } from 'zod';
import { processingSchemas, saveProduction, REVIEWER_PROMPT_VERSION, EVIDENCE_PROMPT_VERSION, weights } from './processing.ts';
export type Reviewer = 'A' | 'B';
const id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const reviewerBatchSchema=z.object({limit:z.number().int().min(1).max(5).default(3),article_id:id.optional()}).strict();
const audit={scheduled_task_id:id,context_id:id};
export const reviewerSchemas=Object.fromEntries(Object.entries(processingSchemas).map(([name,schema])=>[name,schema.extend(audit)])) as unknown as Record<keyof typeof processingSchemas,z.ZodObject>;
export function reviewerAllowed(scopes:string[],role:Reviewer) {
 return scopes.includes(`processing:${role.toLowerCase()}`)&&!scopes.includes(`processing:${role==='A'?'b':'a'}`)&&!scopes.includes('processing:write')&&!scopes.includes('probes:write');
}
// Allowlist every field. No processing status, run/receipt, prefilter, or reviewer output.
export const factProjection=`a.id,a.source_id,substr(a.canonical_url,1,2048) AS canonical_url,
 substr(a.title,1,512) AS title,substr(a.summary,1,2000) AS summary,
 substr(a.author,1,256) AS author,a.published_at,a.discovered_at,a.is_backfill,a.publish_eligible,
 substr(s.name,1,256) AS source_name,s.kind AS source_kind,s.tier AS source_tier,s.first_party AS source_first_party`;
export async function getReviewerBatch(db:D1Database,role:Reviewer,input:unknown,policy:Record<string,unknown>,evidenceEnv?:EvidenceEnv) {
 const args=reviewerBatchSchema.parse(input);
 const version=evidenceEnv?EVIDENCE_PROMPT_VERSION:REVIEWER_PROMPT_VERSION;
 const predicate=role==='A'?`a.processing_status='new' AND a.intelligence_revision IS NULL AND a.prefilter_status IS NULL AND a.score_a IS NULL AND a.score_b IS NULL`:
 `EXISTS(SELECT 1 FROM review_submissions s JOIN review_submission_applications v ON v.submission_id=s.id
 JOIN mcp_processing_runs p ON p.run_id=s.reviewer_run_id
 WHERE s.article_id=a.id AND s.reviewer='A' AND s.prompt_version IN ('${REVIEWER_PROMPT_VERSION}','${EVIDENCE_PROMPT_VERSION}')
 AND v.validation_status='applied' AND p.status='processing' AND p.input_snapshot=f.snapshot)
 AND a.prefilter_status IN ('PASS','UNKNOWN') AND a.score_a IS NOT NULL AND a.score_b IS NULL AND a.processing_status='processing'`;
 // Snapshot equality is the exact preimage of the validated SHA-256 dedup key.
 // Filter before LIMIT so submitted articles cannot starve the next batch.
 const query=`SELECT ${factProjection},f.snapshot FROM articles a JOIN sources s ON s.id=a.source_id
 JOIN mcp_article_facts f ON f.id=a.id WHERE ${predicate}
 AND NOT EXISTS(SELECT 1 FROM review_submissions submitted WHERE submitted.article_id=a.id
 AND submitted.reviewer=? AND submitted.prompt_version IN (?,'robotics-plus-mcp.phase2b1.v1') AND submitted.input_snapshot=f.snapshot)
 ${args.article_id?' AND a.id=?':''} ORDER BY a.discovered_at DESC,a.id ASC LIMIT ?`;
 const candidates=await db.prepare(query).bind(role,version,...(args.article_id?[args.article_id]:[]),args.limit).all();
 const rows:{results:Record<string,any>[]}={results:[]};
 for(const candidate of candidates.results){
  const {snapshot,...row}=candidate as any;
  let effectiveVersion=version;
  if(role==='B'){const parent=await db.prepare("SELECT prompt_version FROM review_submissions WHERE article_id=? AND reviewer='A'").bind(row.id).first<any>();effectiveVersion=parent.prompt_version;}
  if(evidenceEnv&&effectiveVersion===EVIDENCE_PROMPT_VERSION){
   if(role==='A')await materializeEvidence(db,row.id,evidenceEnv);
   row.evidence=await readEvidence(db,row.id);
   if(!row.evidence)continue;
   row.prompt_version=effectiveVersion;
   row.input_snapshot_hash=await inputHash(db,row.id,String(snapshot),effectiveVersion);
  }else row.input_snapshot_hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(snapshot))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(evidenceEnv)row.prompt_version=effectiveVersion;
  rows.results.push(row);
 }
 return {articles:rows.results,count:rows.results.length,read_only:true,frozen_policy:policy};
}
export async function saveReviewer(db:D1Database,role:Reviewer,tool:keyof typeof processingSchemas,input:unknown,clientId:string) {
 const args=reviewerSchemas[tool].parse(input) as any;
 if((role==='A'&&(tool==='save_structure'||tool==='finalize_processing'||(tool==='save_score'&&args.slot!=='A')))||
 (role==='B'&&(tool==='save_prefilter'||(tool==='save_score'&&args.slot!=='B'))))return {saved:false,error:'reviewer_scope_denied'};
 if(args.prompt_version&&args.prompt_version!==REVIEWER_PROMPT_VERSION)return {saved:false,error:'frozen_reviewer_version_required'};
 // Validate before claiming a run so malformed totals never strand an article.
 if(tool==='save_score'){
 const total=Math.round(Object.entries(weights).reduce((s,[k,w])=>s+args.dimension_scores[k]*w,0)*100)/100;
 if(Math.abs(total-args.total)>0.001)return {saved:false,error:'weighted_total_mismatch',expected_total:total};
 }
 let own=await db.prepare('SELECT * FROM mcp_reviewer_runs WHERE reviewer_run_id=?').bind(args.run_id).first<any>();
 if(own&&(own.article_id!==args.article_id||own.reviewer!==role||own.scheduled_task_id!==args.scheduled_task_id||own.context_id!==args.context_id||own.caller_client_id!==clientId))return {saved:false,error:'reviewer_run_conflict'};
 if(!own){
  const parent=await db.prepare('SELECT * FROM mcp_processing_runs WHERE article_id=?').bind(args.article_id).first<any>();
  if(parent&&(parent.prompt_version!==REVIEWER_PROMPT_VERSION||parent.caller_client_id!==clientId))return {saved:false,error:'reviewer_run_conflict'};
  if(role==='A'&&parent){
   own=await db.prepare('SELECT * FROM mcp_reviewer_runs WHERE reviewer_run_id=?').bind(args.run_id).first<any>();
   if(own&&own.article_id===args.article_id&&own.reviewer===role&&own.scheduled_task_id===args.scheduled_task_id&&own.context_id===args.context_id&&own.caller_client_id===clientId){
    const {scheduled_task_id,context_id,...payload}=args;
    const reply=await saveProduction(db,tool,{...payload,run_id:own.processing_run_id},clientId,{reviewer:role,reviewer_run_id:args.run_id,scheduled_task_id,context_id});
    return {saved:reply.saved,...('inserted' in reply?{inserted:reply.inserted}:{}),...('error' in reply?{error:reply.error}:{}),reviewer:role,run_id:args.run_id,article_id:args.article_id};
   }
  }
  if(role==='A'&&(parent||tool!=='save_prefilter'))return {saved:false,error:'prefilter_required_or_owned'};
  if(role==='B'&&(!parent||parent.status!=='processing'||tool!=='save_score'))return {saved:false,error:'reviewer_stage_not_ready'};
  if(role==='B'&&tool==='save_score'&&!await db.prepare("SELECT 1 FROM mcp_task_receipts WHERE run_id=? AND stage='score_a'").bind(parent.run_id).first())return {saved:false,error:'reviewer_stage_not_ready'};
  const processingRun=parent?.run_id??args.run_id;
  const stmts=[];
  if(!parent)stmts.push(db.prepare(`INSERT INTO mcp_processing_runs(run_id,article_id,caller_client_id,provider,runtime_claim,prompt_version,input_snapshot)
   SELECT ?,id,?,'ChatGPT Plus separate reviewers/MCP','Independent contexts and task ids declared; external evidence required',?,snapshot FROM mcp_article_facts WHERE id=?`).bind(processingRun,clientId,REVIEWER_PROMPT_VERSION,args.article_id));
  stmts.push(db.prepare(`INSERT INTO mcp_reviewer_runs(reviewer_run_id,processing_run_id,article_id,reviewer,scheduled_task_id,context_id,caller_client_id,prompt_version,input_snapshot)
   SELECT ?,?,id,?,?,?,?,?,snapshot FROM mcp_article_facts WHERE id=?`).bind(args.run_id,processingRun,role,args.scheduled_task_id,args.context_id,clientId,REVIEWER_PROMPT_VERSION,args.article_id));
  try{await db.batch(stmts);}catch{
   own=await db.prepare('SELECT * FROM mcp_reviewer_runs WHERE reviewer_run_id=?').bind(args.run_id).first<any>();
   if(!own||own.article_id!==args.article_id||own.reviewer!==role||own.scheduled_task_id!==args.scheduled_task_id||own.context_id!==args.context_id||own.caller_client_id!==clientId)return {saved:false,error:'reviewer_state_or_context_conflict'};
  }
  own??=await db.prepare('SELECT * FROM mcp_reviewer_runs WHERE reviewer_run_id=?').bind(args.run_id).first<any>();
 }
 if(!own)return {saved:false,error:'article_not_found'};
 const {scheduled_task_id,context_id,...payload}=args;
 const data=await saveProduction(db,tool,{...payload,run_id:own.processing_run_id},clientId,
 {reviewer:role,reviewer_run_id:args.run_id,scheduled_task_id,context_id});
 // Never return the legacy article result, processing run, or another reviewer's output.
 return {saved:data.saved,...('inserted' in data?{inserted:data.inserted}:{}),...('error' in data?{error:data.error}:{}),reviewer:role,run_id:args.run_id,article_id:args.article_id};
}
