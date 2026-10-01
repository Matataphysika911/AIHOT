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
 constructor(message: string, public disposition: 'retry'|'unknown'|'failed') { super(message); }
}
export interface IntelligenceProvider {
 name: string; model: string;
 invoke(stage: Stage, input: unknown, key: string): Promise<{output: string; usage?: unknown}>;
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
     method:'POST', redirect:'error', signal:AbortSignal.timeout(60000),
     headers:{Authorization:`Bearer ${env.INTELLIGENCE_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},
     body:JSON.stringify({model:env.INTELLIGENCE_MODEL,messages:[{role:'system',content:PROMPTS[stage]},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_object'},max_tokens:2500}),
    });
   } catch { throw new ProviderError('provider_transport_outcome_unknown','unknown'); }
   if (!response.ok) throw new ProviderError(`provider_http_${response.status}`,response.status === 429 ? 'retry' : response.status >= 500 || response.status === 408 ? 'unknown' : 'failed');
   let body: {choices?:{message?:{content?:string}}[];usage?:unknown};
   try { body=await response.json(); } catch { throw new ProviderError('provider_invalid_response','unknown'); }
   const output=body.choices?.[0]?.message?.content;
   if (typeof output !== 'string' || output.length > 100000) throw new ProviderError('provider_missing_or_oversized_content','failed');
   return {output,usage:body.usage};
  },
 };
}
