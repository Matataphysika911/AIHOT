import { z } from 'zod';
import { createProvider, ProviderError } from '../../ingest/src/provider';
import { validate } from '../../ingest/src/intelligence';
import { reviewerInput, type ReviewEnv } from './independent-review';
import { scoreSchema, HYBRID_PROMPT_VERSION } from './processing';
const schema=z.object({probe_id:z.string().regex(/^agnes-connectivity-[a-zA-Z0-9_-]{1,100}$/),model:z.enum(['agnes-2.5-flash','agnes-3.0-flash']),stage:z.enum(['prefilter','score_b']).default('prefilter'),article_id:z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional()}).strict().refine(args=>args.stage==='score_b'?!!args.article_id:!args.article_id);
export async function probeConnection(db:D1Database,input:unknown,env:ReviewEnv) {
 const args=schema.parse(input);
 const previous=await db.prepare('SELECT * FROM mcp_provider_probes WHERE probe_id=?').bind(args.probe_id).first<any>();
 if(previous)return previous.model!==args.model?{ok:false,error:'probe_id_model_conflict'}:previous.stage!==args.stage||previous.article_id!==(args.article_id??null)?{ok:false,error:'probe_id_input_conflict'}:{ok:previous.status==='succeeded',inserted:false,receipt:previous};
 const limit=Number(env.AGNES_REVIEW_CALL_LIMIT??'5');
 if(env.AGNES_REVIEW_ENABLED!=='true'||!env.AGNES_API_KEY||!Number.isInteger(limit)||limit<1||limit>20)return {ok:false,error:'provider_disabled_or_unavailable'};
 let evidence:unknown={title:'Connectivity probe: routine weather forecast',summary:'This is a synthetic connectivity probe about routine weather, unrelated to robotics or edge SoC. It is not a real article or production processing.'};
 if(args.stage==='score_b') {
  const facts=await db.prepare('SELECT snapshot FROM mcp_article_facts WHERE id=?').bind(args.article_id!).first<{snapshot:string}>();
  if(!facts)return {ok:false,error:'article_not_found'};
  evidence=reviewerInput(JSON.parse(facts.snapshot));
 }
 const claimed=await db.prepare(`INSERT OR IGNORE INTO mcp_provider_probes(probe_id,model,status,stage,article_id,input_json)
 SELECT ?,?,'pending',?,?,? WHERE (SELECT count(*) FROM mcp_external_reviews WHERE request_started_at IS NOT NULL)+(SELECT count(*) FROM mcp_provider_probes) < ?`).bind(args.probe_id,args.model,args.stage,args.article_id??null,JSON.stringify(evidence),limit).run();
 if(!claimed.meta.changes)return {ok:false,error:'probe_reserved_or_call_budget_exhausted'};
 try {
  const provider=createProvider({MODEL_CALLS_ENABLED:'true',INTELLIGENCE_API_KEY:env.AGNES_API_KEY,INTELLIGENCE_BASE_URL:'https://apihub.agnes-ai.com/v1',INTELLIGENCE_MODEL:args.model,INTELLIGENCE_PROVIDER:'AGNES API'},'live');
  const result=await provider.invoke(args.stage,evidence,`connectivity:${args.probe_id}`);
  const validated=validate(args.stage,result.output);
  if(args.stage==='score_b')scoreSchema.parse({article_id:args.article_id,run_id:args.probe_id,prompt_version:HYBRID_PROMPT_VERSION,slot:'B',dimension_scores:validated.dimensions,total:validated.score,reason:validated.reason});
  await db.prepare(`UPDATE mcp_provider_probes SET status='succeeded',response_id=?,response_model=?,http_status=?,output=?,usage_json=?,validated_output=?,finished_at=CURRENT_TIMESTAMP WHERE probe_id=? AND status='pending'`).bind(result.responseId??null,result.responseModel??null,result.responseStatus??null,result.output,JSON.stringify(result.usage??null),JSON.stringify(validated),args.probe_id).run();
 } catch(error) {
  const message=error instanceof ProviderError?error.message:'probe_response_or_persistence_failed';
  const status=error instanceof ProviderError&&error.disposition==='unknown'?'unknown':'failed';
  const http=message.match(/^provider_http_(\d+)$/)?.[1];
  await db.prepare(`UPDATE mcp_provider_probes SET status=?,error=?,http_status=?,output=?,finished_at=CURRENT_TIMESTAMP WHERE probe_id=? AND status='pending'`).bind(status,message,http?Number(http):null,error instanceof ProviderError?error.details??null:null,args.probe_id).run();
 }
 const receipt=await db.prepare('SELECT * FROM mcp_provider_probes WHERE probe_id=?').bind(args.probe_id).first<any>();
 return {ok:receipt?.status==='succeeded',inserted:true,receipt};
}
