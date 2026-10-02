import { PROMPTS, type Stage } from './prompts';
export interface ProviderEnv {
 INTELLIGENCE_API_KEY?: string;
 INTELLIGENCE_BASE_URL?: string;
 INTELLIGENCE_MODEL?: string;
 INTELLIGENCE_PROVIDER?: string;
 MODEL_CALLS_ENABLED?: string;
 INTELLIGENCE_DAILY_CALL_LIMIT?: string;
 INTELLIGENCE_HOURLY_CALL_LIMIT?: string;
}
export class ProviderError extends Error {
 constructor(message: string, public disposition: 'retry'|'unknown'|'failed', public details?: string) { super(message); }
}
export interface IntelligenceProvider {
 name: string; model: string;
 invoke(stage: Stage, input: unknown, key: string): Promise<{output: string; usage?: unknown; responseId?: string; responseModel?: string; responseStatus?: number}>;
}
export function providerReady(env: ProviderEnv) {
 return env.MODEL_CALLS_ENABLED === 'true' && !!env.INTELLIGENCE_API_KEY && !!env.INTELLIGENCE_MODEL && !!env.INTELLIGENCE_BASE_URL;
}
export function createProvider(env: ProviderEnv, mode: 'live'|'mock'): IntelligenceProvider {
 if (mode === 'mock') return {
  name: 'mock', model: 'deterministic-fixture-v1',
  async invoke(stage) {
   const value = stage === 'prefilter' ? {decision:'UNKNOWN',reason:'Mock fixture; no editorial judgement'} :
    stage === 'structure' ? {category:'industry',tags:[],companies:[],fact_frame:{subject:'未披露',action:'未披露',object:'未披露',evidence:'Mock fixture'},robotics_relevance:'mock',soc_relevance:'mock',commercial_signal:'mock',what_happened:'mock',why_it_matters:'mock',what_to_watch:[]} :
    {dimensions:{industry_impact:60,robotics_relevance:60,soc_relevance:60,commercial_signal:60,technical_novelty:60,source_credibility:60},reason:'Mock fixture; not an AI score'};
   return {output:JSON.stringify(value)};
  },
 };
 if (!providerReady(env)) throw new ProviderError('provider_not_configured_or_disabled','failed');
 const base = new URL(env.INTELLIGENCE_BASE_URL!);
 if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new ProviderError('invalid_provider_base_url','failed');
 return {
  name:env.INTELLIGENCE_PROVIDER ?? 'openai-compatible',model:env.INTELLIGENCE_MODEL!,
  async invoke(stage,input,key) {
   let response: Response;
   try {
    response = await fetch(`${base.toString().replace(/\/$/,'')}/chat/completions`, {
     method:'POST', redirect:'manual', signal:AbortSignal.timeout(60000),
     headers:{Authorization:`Bearer ${env.INTELLIGENCE_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},
     body:JSON.stringify({model:env.INTELLIGENCE_MODEL,messages:[{role:'system',content:PROMPTS[stage]},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_object'},max_tokens:2500}),
    });
   } catch(error) {
    // Classify safely without recording header values, keys or raw exceptions.
    const message=error instanceof Error?error.message:'';
    const kind=error instanceof Error&&error.name==='TimeoutError'?'timeout':
     /redirect/i.test(message)?'redirect':/header/i.test(message)?'header':
     /public|private address/i.test(message)?'public_fetch_policy':
     /AbortSignal|signal/i.test(message)?'signal':error instanceof Error?error.name.replace(/[^a-zA-Z]/g,'').slice(0,30):'error';
    throw new ProviderError(`provider_transport_${kind}_outcome_unknown`,'unknown');
   }
   if (!response.ok) {
    const details:Record<string,unknown>={http_status:response.status,retry_after:response.headers.get('retry-after')};
    for(const name of ['content-type','server','cf-ray','x-request-id','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']) {
     const value=response.headers.get(name);if(value)details[name]=value.slice(0,200);
    }
    const redact=(value:string)=>value.replaceAll(env.INTELLIGENCE_API_KEY!,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/https?:\/\/\S+/gi,'[url]').slice(0,512);
    let raw='';
    try {
     const reader=response.body?.getReader();
     if(reader){const decoder=new TextDecoder();while(raw.length<4096){const {value,done}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});}await reader.cancel();}
     const parsed=JSON.parse(raw);const error=parsed.error??parsed;
     if(typeof error.code==='string')details.code=error.code.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100);
     if(typeof error.message==='string')details.message=redact(error.message);
    }catch{if(raw.trim())details.message=redact(raw.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());}
    throw new ProviderError(`provider_http_${response.status}`,response.status === 429 ? 'retry' : response.status >= 500 || response.status === 408 ? 'unknown' : 'failed',JSON.stringify(details));
   }
   let body: {choices?:{message?:{content?:string}}[];usage?:unknown;id?:string;model?:string};
   try { body=await response.json(); } catch { throw new ProviderError('provider_invalid_response','unknown'); }
   const output=body.choices?.[0]?.message?.content;
   if (typeof output !== 'string' || output.length > 100000) throw new ProviderError('provider_missing_or_oversized_content','failed');
   return {output,usage:body.usage,responseId:body.id,responseModel:body.model,responseStatus:response.status};
  },
 };
}
