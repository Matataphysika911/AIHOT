import { createProvider, ProviderError } from '../../ingest/src/provider';
import { validate } from '../../ingest/src/intelligence';
import { HYBRID_PROMPT_VERSION, independentScoreSchema, scoreSchema, saveProduction } from './processing';

export interface ReviewEnv {
 AGNES_API_KEY?: string;
 AGNES_MODEL?: string;
 AGNES_REVIEW_ENABLED?: string;
 AGNES_REVIEW_CALL_LIMIT?: string;
}
type Row = Record<string,any>;
// Both reviewers get the same bounded source evidence. Never serialize a run,
// receipt, processing field, another score, reasoning, or conversational history.
export function reviewerInput(snapshot:Row) {
 return {id:snapshot.id,title:String(snapshot.title??'').slice(0,512),
 summary:String(snapshot.summary??'').slice(0,2000),canonical_url:String(snapshot.canonical_url??'').slice(0,2048),
 author:snapshot.author==null?null:String(snapshot.author).slice(0,256),published_at:snapshot.published_at,
 source_tier:snapshot.tier,source_first_party:snapshot.first_party};
}
async function digest(s:string) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const fallback=(error:string,status:string)=>({saved:false,fallback_allowed:true,selected_path:'plus_fallback',external_status:status,error,
 instruction:'Use ChatGPT Plus to score B from the original article and frozen rubric, then save_score slot B. Do not copy A. Same-conversation independence is NOT verified. No AGNES retry is permitted for this run.'});
export async function independentReview(db:D1Database,input:unknown,clientId:string,env:ReviewEnv) {
 const args=independentScoreSchema.parse(input);
 const writeArgs={article_id:args.article_id,run_id:args.run_id,prompt_version:args.prompt_version};
 const run=await db.prepare('SELECT p.*,f.snapshot AS current_snapshot,a.processing_status,a.intelligence_revision FROM mcp_processing_runs p JOIN articles a ON a.id=p.article_id JOIN mcp_article_facts f ON f.id=a.id WHERE p.run_id=?').bind(args.run_id).first<Row>();
 if(!run||run.article_id!==args.article_id||run.caller_client_id!==clientId||run.prompt_version!==HYBRID_PROMPT_VERSION)return {saved:false,error:'run_id_conflict'};
 let review=await db.prepare('SELECT * FROM mcp_external_reviews WHERE run_id=?').bind(args.run_id).first<Row>();
 if(review&&args.model&&review.model!==args.model)return {saved:false,error:'review_model_conflict'};
 if(review?.status==='succeeded')return saveProduction(db,'save_score',{...writeArgs,slot:'B',...JSON.parse(review.validated_output)},clientId);
 if(review?.selected_path==='plus_fallback') {
  const receipt=await db.prepare("SELECT payload FROM mcp_task_receipts WHERE run_id=? AND stage='score_b'").bind(args.run_id).first<Row>();
  if(receipt)return {saved:true,inserted:false,run_id:args.run_id,stage:'score_b',selected_path:'plus_fallback',provider:'ChatGPT Plus fallback/MCP',independence:'not_verified',external_status:review.status,error:review.error};
 }
 if(run.status!=='processing'||run.processing_status!=='processing'||run.intelligence_revision!==args.run_id||run.input_snapshot!==run.current_snapshot)return {saved:false,error:'state_run_snapshot_conflict'};
 const stages=await db.prepare("SELECT count(*) n FROM mcp_task_receipts WHERE run_id=? AND (stage='score_a' OR (stage='prefilter' AND json_extract(payload,'$.status')!='BLOCK'))").bind(args.run_id).first<{n:number}>();
 if(stages?.n!==2)return {saved:false,error:'prefilter_and_score_a_required'};
 if(review?.selected_path==='plus_fallback')return fallback(review.error,review.status);
 if(review?.status==='pending')return {saved:false,error:'review_pending_or_interrupted_no_automatic_retry'};
 const evidence=JSON.stringify(reviewerInput(JSON.parse(run.input_snapshot))),inputHash=await digest(evidence);
 const model=args.model??env.AGNES_MODEL??'agnes-2.5-flash';
 if(!review) {
  const limit=Number(env.AGNES_REVIEW_CALL_LIMIT??'5');
  const unavailable=env.AGNES_REVIEW_ENABLED!=='true'?'agnes_disabled':!env.AGNES_API_KEY?'agnes_key_unavailable':!['agnes-2.5-flash','agnes-3.0-flash'].includes(model)?'agnes_model_unavailable':!Number.isInteger(limit)||limit<1||limit>20?'review_budget_disabled':null;
  if(unavailable) {
   await db.prepare(`INSERT OR IGNORE INTO mcp_external_reviews(run_id,article_id,caller_client_id,prompt_version,model,input_json,input_hash,selected_path,status,error) VALUES(?,?,?,?,?,?,?,'plus_fallback','unavailable',?)`).bind(args.run_id,args.article_id,clientId,args.prompt_version,model,evidence,inputHash,unavailable).run();
   return independentReview(db,args,clientId,env);
  }
  // A permanent receipt reserves one possible paid call; no automatic retry,
  // even if the provider's Idempotency-Key is unsupported or its outcome unknown.
  const reserved=await db.prepare(`INSERT OR IGNORE INTO mcp_external_reviews(run_id,article_id,caller_client_id,prompt_version,model,input_json,input_hash,selected_path,status,request_started_at)
   SELECT ?,?,?,?,?,?,?,'agnes','pending',CURRENT_TIMESTAMP
   WHERE (SELECT count(*) FROM mcp_external_reviews WHERE request_started_at IS NOT NULL)+(SELECT count(*) FROM mcp_provider_probes) < ?`).bind(args.run_id,args.article_id,clientId,args.prompt_version,model,evidence,inputHash,limit).run();
  if(!reserved.meta.changes) {
   const winner=await db.prepare('SELECT status FROM mcp_external_reviews WHERE run_id=?').bind(args.run_id).first();
   if(winner)return {saved:false,error:'review_already_reserved'};
   await db.prepare(`INSERT OR IGNORE INTO mcp_external_reviews(run_id,article_id,caller_client_id,prompt_version,model,input_json,input_hash,selected_path,status,error) VALUES(?,?,?,?,?,?,?,'plus_fallback','unavailable','review_call_budget_exhausted')`).bind(args.run_id,args.article_id,clientId,args.prompt_version,model,evidence,inputHash).run();
   return independentReview(db,args,clientId,env);
  }
  let responseReceived=false;
  try {
   // Reuse the existing provider transport and the frozen scoring.v1 prompt.
   const provider=createProvider({MODEL_CALLS_ENABLED:'true',INTELLIGENCE_API_KEY:env.AGNES_API_KEY,
    INTELLIGENCE_BASE_URL:'https://apihub.agnes-ai.com/v1',INTELLIGENCE_MODEL:model,INTELLIGENCE_PROVIDER:'AGNES API'},'live');
   const result=await provider.invoke('score_b',JSON.parse(evidence),`mcp-agnes:${args.run_id}:B`);
   responseReceived=true;
   await db.prepare(`UPDATE mcp_external_reviews SET output=?,response_id=?,response_model=?,usage_json=?,finished_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending'`).bind(result.output,result.responseId??null,result.responseModel??null,JSON.stringify(result.usage??null),args.run_id).run();
   const parsed=validate('score_b',result.output);
   const validated={dimension_scores:parsed.dimensions,total:parsed.score,reason:parsed.reason};
   scoreSchema.parse({...writeArgs,slot:'B',...validated});
   await db.prepare(`UPDATE mcp_external_reviews SET status='received',output=?,validated_output=?,response_id=?,response_model=?,usage_json=?,finished_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending'`).bind(result.output,JSON.stringify(validated),result.responseId??null,result.responseModel??null,JSON.stringify(result.usage??null),args.run_id).run();
  } catch(error) {
   const status=responseReceived||error instanceof ProviderError&&error.disposition!=='unknown'?'failed':'unknown';
   const safe=error instanceof ProviderError?error.message:responseReceived?'invalid_response_or_persistence_failed':'provider_outcome_unknown';
   await db.prepare(`UPDATE mcp_external_reviews SET status=?,selected_path='plus_fallback',error=?,output=coalesce(output,?),finished_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending'`).bind(status,safe,error instanceof ProviderError?error.details??null:null,args.run_id).run();
   return fallback(safe,status);
  }
  review=await db.prepare('SELECT * FROM mcp_external_reviews WHERE run_id=?').bind(args.run_id).first<Row>();
 }
 if(review?.status!=='received')return {saved:false,error:'review_not_ready'};
 const saved=await saveProduction(db,'save_score',{...writeArgs,slot:'B',...JSON.parse(review.validated_output)},clientId);
 if(saved.saved)await db.prepare("UPDATE mcp_external_reviews SET status='succeeded' WHERE run_id=? AND status='received'").bind(args.run_id).run();
 return {...saved,selected_path:'agnes',provider:'AGNES API',model:review.model,response_model:review.response_model,response_id:review.response_id,input_hash:review.input_hash,independence:'independent_stateless_request'};
}
