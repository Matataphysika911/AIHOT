import { z } from 'zod';
import { CATEGORIES, CATEGORY_TAGS, TOPIC_TAGS, ENTITY_TAGS } from '../../ingest/src/taxonomy.ts';
export const PROMPT_VERSION = 'robotics-plus-mcp.phase2b.v1';
export const HYBRID_PROMPT_VERSION = 'robotics-plus-agnes-mcp.phase2b.v1';
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(1600);
const base = { article_id: id, run_id: id, prompt_version: z.enum([PROMPT_VERSION,HYBRID_PROMPT_VERSION]) };
export const independentScoreSchema = z.object({article_id:id,run_id:id,prompt_version:z.literal(HYBRID_PROMPT_VERSION),model:z.enum(['agnes-2.5-flash','agnes-3.0-flash']).optional()}).strict();
export const prefilterSchema = z.object({...base, status: z.enum(['PASS','UNKNOWN','BLOCK']), reason: text}).strict();
export const weights = { industry_impact: .25, robotics_relevance: .2, soc_relevance: .2, commercial_signal: .15, technical_novelty: .1, source_credibility: .1 };
const dimensions = z.object(Object.fromEntries(Object.keys(weights).map(k => [k,z.number().min(0).max(100)]))).strict();
export const scoreSchema = z.object({...base, slot: z.enum(['A','B']), dimension_scores: dimensions, total: z.number().min(0).max(100), reason: text}).strict();
const array = z.array(z.string().trim().min(1).max(100)).max(20);
export const structureSchema = z.object({...base, category: z.string().refine(k=>CATEGORIES.some(c=>c.key===k)),
 tags: array.refine(tags=>tags.every(t=>[...CATEGORY_TAGS,...TOPIC_TAGS,...ENTITY_TAGS].includes(t as never))),
 companies: array, fact_frame: z.object({subject:text, action:text, object:text, evidence:text}).strict(),
 robotics_relevance:text, soc_relevance:text, commercial_signal:text }).strict();
export const finalizeSchema = z.object({article_id:id,run_id:id}).strict();
export const processingSchemas = {save_prefilter:prefilterSchema,save_score:scoreSchema,save_structure:structureSchema,finalize_processing:finalizeSchema};
async function hash(s:string) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function canonical(value:any):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export async function saveProduction(db:D1Database,tool:keyof typeof processingSchemas,input:unknown,clientId:string) {
 const args = processingSchemas[tool].parse(input) as any;
 if(tool==='save_score') {
  const total=Math.round(Object.entries(weights).reduce((sum,[k,w])=>sum+args.dimension_scores[k]*w,0)*100)/100;
  if(Math.abs(total-args.total)>0.001) return {saved:false,error:'weighted_total_mismatch',expected_total:total};
 }
 const stage=tool==='save_prefilter'?'prefilter':tool==='save_score'?`score_${args.slot.toLowerCase()}`:tool==='save_structure'?'structure':'finalize';
 const payload=canonical(Object.fromEntries(Object.entries(args).filter(([k])=>!['article_id','run_id','prompt_version','slot'].includes(k))));
 const digest=await hash(payload);
 const run=await db.prepare('SELECT * FROM mcp_processing_runs WHERE run_id=?').bind(args.run_id).first<any>();
 const version=args.prompt_version??run?.prompt_version??PROMPT_VERSION;
 if(run&&(run.article_id!==args.article_id||run.caller_client_id!==clientId||run.prompt_version!==version))return {saved:false,error:'run_id_conflict'};
 const receipt=await db.prepare('SELECT payload_hash FROM mcp_task_receipts WHERE run_id=? AND stage=?').bind(args.run_id,stage).first<any>();
 if(receipt)return receipt.payload_hash===digest?{saved:true,inserted:false,run_id:args.run_id,stage}:{saved:false,error:'receipt_conflict'};
 if(!run&&stage!=='prefilter')return {saved:false,error:'prefilter_required'};
 const hybrid=version===HYBRID_PROMPT_VERSION;
 if(hybrid&&!/^phase2b-hybrid-(scheduled|interactive)-/.test(args.run_id))return {saved:false,error:'hybrid_run_prefix_required'};
 const scheduled=args.run_id.startsWith(hybrid?'phase2b-hybrid-scheduled-':'phase2b-plus-scheduled-');
 const provider=run?.provider ?? `${scheduled?'ChatGPT Plus Scheduled/MCP':'ChatGPT Plus interactive/MCP'}${hybrid?' (AGNES optional)':''}`;
 const statements=[];
 if(!run)statements.push(db.prepare(`INSERT INTO mcp_processing_runs(run_id,article_id,caller_client_id,provider,runtime_claim,prompt_version,input_snapshot)
 SELECT ?,id,?,?,?,?,snapshot FROM mcp_article_facts WHERE id=?`).bind(args.run_id,clientId,provider,`${scheduled?'ChatGPT Plus Scheduled/MCP':'ChatGPT Plus interactive/MCP'} (declared)`,version,args.article_id));
 statements.push(db.prepare('INSERT INTO mcp_task_receipts(run_id,stage,payload,payload_hash,provider,prompt_version,caller_client_id) VALUES(?,?,?,?,?,?,?)').bind(args.run_id,stage,payload,digest,provider,version,clientId));
 try {await db.batch(statements);} catch {
  // A competing identical write can win between our read and the transaction.
  const winner=await db.prepare(`SELECT r.payload_hash,p.article_id,p.caller_client_id,p.prompt_version FROM mcp_task_receipts r JOIN mcp_processing_runs p USING(run_id) WHERE r.run_id=? AND r.stage=?`).bind(args.run_id,stage).first<any>();
  if(winner&&winner.payload_hash===digest&&winner.article_id===args.article_id&&winner.caller_client_id===clientId&&winner.prompt_version===version)return {saved:true,inserted:false,run_id:args.run_id,stage};
  return {saved:false,error:'state_run_snapshot_or_stage_conflict'};
 }
 const article=await db.prepare('SELECT id,processing_status,prefilter_status,score_a,score_b,final_score,selection_status,intelligence_revision FROM articles WHERE id=?').bind(args.article_id).first();
 return {saved:true,inserted:true,run_id:args.run_id,stage,article};
}
