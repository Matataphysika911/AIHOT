import { canonical, digest } from './submissions.ts';
import { EVIDENCE_PROMPT_VERSION } from './processing.ts';
export interface EvidenceEnv { RAW_ARCHIVE?: R2Bucket; fetcher?: typeof fetch }
export const MAX_EVIDENCE_CHARS=12000;
const MAX_PAGE_BYTES=512000;
// Canonical source pages are data, never instructions. No arbitrary caller-provided URL.
export function publicPage(value:string) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname))throw Error('unsafe_source_url');
 return u;
}
function decode(text:string) {return text.replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>(({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[n]!));}
export function extractArticle(html:string) {
 const clean=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
 const body=clean.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]??clean.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
 const fragments=(body??clean).match(/<(p|h[1-4]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)??[];
 return decode(fragments.join('\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
async function pageText(url:string,env:EvidenceEnv) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try {
  let current=publicPage(url);
  for(let redirects=0;redirects<=3;redirects++){
   const response=await (env.fetcher??fetch)(current.href,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html','User-Agent':'uPrivate-Evidence/1.0'}});
   if(response.status>=300&&response.status<400){await response.body?.cancel();current=publicPage(new URL(response.headers.get('location')??'',current).href);continue;}
   if(!response.ok||!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();throw Error(`source_http_${response.status}_or_non_html`);}
   if(!response.body)throw Error('empty_page');
   const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,html='';
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>MAX_PAGE_BYTES){await reader.cancel();throw Error('page_byte_limit');}html+=decoder.decode(part.value,{stream:true});}
   html+=decoder.decode();return {html,text:extractArticle(html)};
  }
  throw Error('redirect_limit');
 }finally{clearTimeout(timer);}
}
export async function readEvidence(db:D1Database,articleId:string) {
 const row=await db.prepare('SELECT snapshot_json,evidence_snapshot_hash FROM article_evidence WHERE article_id=?').bind(articleId).first<any>();
 if(!row)return null;
 if(await digest(row.snapshot_json)!==row.evidence_snapshot_hash)throw Error('evidence_snapshot_changed');
 return {...JSON.parse(row.snapshot_json),evidence_snapshot_hash:row.evidence_snapshot_hash};
}
export async function inputHash(db:D1Database,articleId:string,facts:string,version:string) {
 if(version!==EVIDENCE_PROMPT_VERSION)return digest(facts);
 const evidence=await readEvidence(db,articleId);if(!evidence)return null;
 return digest(canonical({facts:JSON.parse(facts),evidence,prompt_version:version}));
}
export async function materializeEvidence(db:D1Database,articleId:string,env:EvidenceEnv) {
 const existing=await readEvidence(db,articleId);if(existing)return existing;
 const row=await db.prepare('SELECT canonical_url,summary,raw_r2_key FROM articles WHERE id=?').bind(articleId).first<any>();
 if(!row)throw Error('article_missing');
 let text=String(row.summary??''),method='summary',status='fallback',error:string|null=null,rawKey:string|null=null;
 if(/https:\/\/(?:export\.)?arxiv\.org\//i.test(row.canonical_url)){method='arxiv_abstract';}
 else if(text.length>=1500){method='rich_summary';}
 else try{
  const page=await pageText(row.canonical_url,env);
  if(page.text.length<Math.max(200,text.length))throw Error('insufficient_article_text');
  text=page.text;method='html_article_paragraphs.v1';status='extracted';
  if(env.RAW_ARCHIVE){rawKey=`evidence/${articleId}/${await digest(page.html)}.html`;try{await env.RAW_ARCHIVE.put(rawKey,page.html,{httpMetadata:{contentType:'text/html'}});}catch{rawKey=null;error='raw_archive_failed';}}
 }catch(e){error=e instanceof Error?e.message.slice(0,160):'extraction_failed';}
 const snapshot={article_id:articleId,source_url:row.canonical_url,extracted_text:text.slice(0,MAX_EVIDENCE_CHARS),extraction_method:method,fetched_at:new Date().toISOString(),content_hash:await digest(text),status,error,original_chars:text.length,truncated:text.length>MAX_EVIDENCE_CHARS,truncation_limit_chars:MAX_EVIDENCE_CHARS,raw_r2_key:rawKey,ingestion_raw_r2_key:row.raw_r2_key};
 const serialized=canonical(snapshot),hash=await digest(serialized);
 await db.prepare(`INSERT OR IGNORE INTO article_evidence(article_id,source_url,extracted_text,extraction_method,fetched_at,content_hash,evidence_snapshot_hash,status,error,original_chars,truncated,raw_r2_key,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(articleId,snapshot.source_url,snapshot.extracted_text,method,snapshot.fetched_at,snapshot.content_hash,hash,status,error,snapshot.original_chars,Number(snapshot.truncated),rawKey,serialized).run();
 return readEvidence(db,articleId);
}
export async function materializePendingEvidence(db:D1Database,env:EvidenceEnv) {
 const rows=await db.prepare(`SELECT a.id FROM articles a WHERE a.processing_status='new' AND NOT EXISTS(SELECT 1 FROM article_evidence e WHERE e.article_id=a.id) ORDER BY a.discovered_at DESC,a.id LIMIT 5`).all<{id:string}>();
 const result=[];for(const row of rows.results){try{const e=await materializeEvidence(db,row.id,env);result.push({article_id:row.id,status:e.status,method:e.extraction_method});}catch{result.push({article_id:row.id,status:'error'});}}
 return result;
}
