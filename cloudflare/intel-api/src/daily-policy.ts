export function dailyWindow(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date)throw new Error('invalid_date');
 const end=new Date(date+'T08:30:00+08:00').toISOString();
 return {start:new Date(Date.parse(end)-86400000).toISOString(),end};
}
export const canonicalDaily=(v:any):string=>Array.isArray(v)?'['+v.map(canonicalDaily).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalDaily(v[k])).join(',')+'}':JSON.stringify(v);
export async function dailyHash(v:any){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof v==='string'?v:canonicalDaily(v)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function validateDailyCopy(copy:any,snapshot:any,date:string){
 if(copy.schema_version!=='daily-editorial.v1'||copy.date!==date||copy.review_status!=='session-reviewed'||!['en','zh-CN'].includes(copy.original_language))throw new Error('invalid_editorial_receipt');
 const pair=(p:any)=>{if(!p||typeof p.zh!=='string'||typeof p.en!=='string'||!p.zh.trim()||!p.en.trim()||/\p{Script=Han}/u.test(p.en))throw new Error('missing_locale');};
 pair(copy.title);pair(copy.coverage_note);
 if(!Array.isArray(copy.highlights)||copy.highlights.length<1||copy.highlights.length>3||!Array.isArray(copy.briefs)||copy.briefs.length>8||!Array.isArray(copy.watch_items)||copy.watch_items.length>4)throw new Error('invalid_brief_shape');
 const seen=new Set();for(const s of [...copy.highlights,...copy.briefs]){
  const a=snapshot.articles.find((a:any)=>a.id===s.article_id);if(!a||a.selection_status==='not-selected'||seen.has(a.id))throw new Error('unsupported_article');seen.add(a.id);
  pair({zh:s.zh?.title,en:s.en?.title});pair({zh:s.zh?.text,en:s.en?.text});
  if(!Array.isArray(s.fact_indices)||!s.fact_indices.length||s.fact_indices.some((i:any)=>!Number.isInteger(i)||i<0||typeof a.structure.facts[i]!=='string'))throw new Error('unsupported_fact');
 }
 for(const w of copy.watch_items){pair(w);if(!Array.isArray(w.article_ids)||!w.article_ids.length||w.article_ids.some((id:any)=>!seen.has(id)))throw new Error('unsupported_watch');}
 if(new TextEncoder().encode(JSON.stringify(copy)).byteLength>50000)throw new Error('editorial_too_large');return copy;
}
export function publicationDecision(row:any,copyHash:string,now:number){
 if(row.copy_sha256!==copyHash)throw new Error('date_hash_conflict');
 if(row.state==='published')return 'already_published';
 if(row.lease_until&&Date.parse(row.lease_until)>now)return 'busy';return 'claim';
}
export function originalFromCopy(copy:any){const lang=copy.original_language==='en'?'en':'zh';return {schema_version:'daily-original.v1',date:copy.date,snapshot_sha256:copy.snapshot_sha256,language:copy.original_language,title:copy.title[lang],highlights:copy.highlights.map((s:any)=>({article_id:s.article_id,fact_indices:s.fact_indices,...s[lang]})),briefs:copy.briefs.map((s:any)=>({article_id:s.article_id,fact_indices:s.fact_indices,...s[lang]})),watch_items:copy.watch_items.map((s:any)=>({article_ids:s.article_ids,text:s[lang]})),coverage_note:copy.coverage_note[lang]};}
export function validateOriginal(original:any,snapshot:any,date:string){
 if(original.schema_version!=='daily-original.v1'||original.date!==date||!['en','zh-CN'].includes(original.language))throw new Error('invalid_original');
 const text=(s:any)=>{if(typeof s!=='string'||!s.trim()||(original.language==='en'&&/\p{Script=Han}/u.test(s)))throw new Error('incomplete_original');};text(original.title);text(original.coverage_note);
 if(!Array.isArray(original.highlights)||original.highlights.length<1||original.highlights.length>3||!Array.isArray(original.briefs)||original.briefs.length>8||!Array.isArray(original.watch_items)||original.watch_items.length>4)throw new Error('invalid_original_sections');
 const seen=new Set();for(const s of [...original.highlights,...original.briefs]){text(s.title);text(s.text);const a=snapshot.articles.find((a:any)=>a.id===s.article_id);if(!a||a.selection_status==='not-selected'||seen.has(a.id)||!Array.isArray(s.fact_indices)||!s.fact_indices.length||s.fact_indices.some((i:any)=>!Number.isInteger(i)||i<0||typeof a.structure.facts[i]!=='string'))throw new Error('unsupported_original_fact');seen.add(a.id);}
 for(const w of original.watch_items){text(w.text);if(!Array.isArray(w.article_ids)||!w.article_ids.length||w.article_ids.some((id:any)=>!seen.has(id)))throw new Error('unsupported_original_watch');}return original;
}
export async function validateTranslation(copy:any,original:any,originalHash:string){
 if(await dailyHash(original)!==originalHash||copy.translation?.translated_from_sha256!==originalHash||await dailyHash(originalFromCopy(copy))!==originalHash)throw new Error('stale_translation_original');
 if(!['facts','numbers_units_names','uncertainty','complete_sections'].every(k=>copy.translation?.review_checks?.[k]===true))throw new Error('translation_review_incomplete');
 const numbers=numericTokens;
 for(const p of [copy.title,copy.coverage_note])if(JSON.stringify(numbers(p.zh))!==JSON.stringify(numbers(p.en)))throw new Error('translation_header_numeric_drift');
 for(const s of [...copy.highlights,...copy.briefs])if(JSON.stringify(numbers(s.zh.title+' '+s.zh.text))!==JSON.stringify(numbers(s.en.title+' '+s.en.text)))throw new Error('translation_numeric_drift');
 for(const w of copy.watch_items)if(JSON.stringify(numbers(w.zh))!==JSON.stringify(numbers(w.en)))throw new Error('translation_watch_numeric_drift');
 return true;
}

export function numericTokens(text:string){const expanded=text.replace(/(\d+(?:\.\d+)?)\s*[–—~～-]\s*(\d+(?:\.\d+)?)%/g,'$1%–$2%').replace(/(\d+(?:[.,]\d+)*)\s*(million\b|billion\b|thousand\b|万|亿)/gi,(_,n,u)=>String(Number(n.replaceAll(',',''))*({million:1e6,billion:1e9,thousand:1e3,'万':1e4,'亿':1e8} as any)[u.toLowerCase()]));return (expanded.match(/\d+(?:[.,]\d+)*(?:%)?/g)??[]).map(s=>s.replaceAll(',','')).sort();}
