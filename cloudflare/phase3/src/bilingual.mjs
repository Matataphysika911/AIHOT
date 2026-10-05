import {hash,canonicalJson} from './core.mjs';
export const BILINGUAL={version:'phase3-bilingual.v1',locales:['zh-CN','en'],policy:'paired-session-authored-content; fail closed on missing/stale translation; no automatic translation API'};
export function sourceProjection(daily,weekly,insight){return {daily:{date:daily.date,as_of:daily.as_of,reading:daily.reading},weekly:{period:weekly.period,as_of:weekly.as_of,reading:weekly.reading},insight:insight?Object.fromEntries(['slug','title','deck','summary','body','unknowns','title_candidates','source_mapping','claims'].map(k=>[k,insight[k]])):null};}
export const projectionHash=(daily,weekly,insight)=>hash(canonicalJson(sourceProjection(daily,weekly,insight)));
const skeleton=value=>{
 if(Array.isArray(value))return value.map(skeleton);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['title','text','heading','paragraphs','editor_note','coverage_note','unknowns','rationale','deck','summary'].includes(k)).map(([k,v])=>[k,skeleton(v)]));
 return value;
};
export function validateBilingual(packet,daily,weekly,insight){
 if(packet.schema_version!==BILINGUAL.version||packet.review_status!=='session-reviewed'||packet.sourceLanguage!=='en'||packet.english_sha256!==hash(canonicalJson(packet.english))||packet.source_sha256!==projectionHash(daily,weekly,insight))throw new Error('Missing/stale bilingual review');
 for(const [key,source] of [['daily',daily.reading],['weekly',weekly.reading],...(insight?[['insight',sourceProjection(daily,weekly,insight).insight]]:[])]){
  const en=packet.english?.[key];if(!en)throw new Error('Missing English content');
  // Paragraph count and claim mapping bind prose, not only headings.
  if(key==='insight'){
   if(!en.title||!en.deck||!en.summary||JSON.stringify(en.body.map(s=>s.paragraphs.map(p=>p.claim_ids)))!==JSON.stringify(source.body.map(s=>s.paragraphs.map(p=>p.claim_ids)))||en.unknowns.length!==source.unknowns.length||en.title_candidates.length!==source.title_candidates.length)throw new Error('Bilingual article structure mismatch');
   for(let n=0;n<source.body.length;n++)if(Boolean(en.body[n].heading)!==Boolean(source.body[n].heading))throw new Error('Bilingual heading mismatch');
   if(JSON.stringify(en.title_candidates.map(skeleton))!==JSON.stringify(source.title_candidates.map(skeleton)))throw new Error('Bilingual headline evidence mismatch');
  }else if(JSON.stringify(skeleton(en))!==JSON.stringify(skeleton(source)))throw new Error('Bilingual evidence/period mismatch');
  const prose=key==='daily'?[...en.highlights.flatMap(s=>[s.title,s.text]),...en.briefs.flatMap(s=>[s.title,s.text]),...en.watch_items.map(s=>s.text),en.coverage_note??'']:key==='weekly'?[en.editor_note,...en.themes.flatMap(s=>[s.heading,...s.paragraphs]),...en.watch_items.map(s=>s.text),en.coverage_note]:[en.title,en.deck,en.summary,...en.body.flatMap(s=>[s.heading??'',...s.paragraphs.map(p=>p.text)]),...en.unknowns,...en.title_candidates.flatMap(c=>[c.title,c.rationale])];
  if(prose.some(t=>typeof t!=='string'||/\p{Script=Han}/u.test(t)))throw new Error('English content contains missing/untranslated prose');
  if(key==='weekly'&&en.themes.some((s,n)=>s.paragraphs.length!==source.themes[n].paragraphs.length))throw new Error('Bilingual theme paragraph mismatch');
 }
 return packet;
}
export function translatedOutputs(packet,daily,weekly,insight){
 validateBilingual(packet,daily,weekly,insight);
 const make=(item,key)=>({translationKey:key,sourceLanguage:packet.sourceLanguage,editorialOriginalLanguage:packet.editorialOriginalLanguage,status:'session-reviewed-draft',reviewed_at:packet.reviewed_at,source_sha256:packet.source_sha256,english_sha256:hash(canonicalJson(packet.english[item])),publication:'draft; publish=false; author approval pending'});
 return {daily:{...daily,language:'en',reading:packet.english.daily,executive_summary:packet.english.daily.highlights,top_signals:packet.english.daily.highlights,what_to_watch:packet.english.daily.watch_items,translation:make('daily','daily-'+daily.date)},weekly:{...weekly,language:'en',reading:packet.english.weekly,executive_summary:packet.english.daily.highlights,what_to_watch:packet.english.weekly.watch_items,translation:make('weekly','weekly-'+weekly.period.start.slice(0,10))},insight:insight?{...insight,...packet.english.insight,language:'en',headline_selection:{...insight.headline_selection,title:packet.english.insight.title},sections:packet.english.insight.body.map(s=>({heading:s.heading,claim_ids:[...new Set(s.paragraphs.flatMap(p=>p.claim_ids))]})),translation:make('insight',insight.slug),claims:insight.claims.map(c=>({...c,text:packet.english.insight.body.flatMap(s=>s.paragraphs).find(p=>p.claim_ids.length===1&&p.claim_ids[0]===c.id)?.text??c.text}))}:null};
}
export function englishMarkdown(d){
 const report=d.type==='daily'||d.type==='weekly';
 let md=`---\ntitle: ${JSON.stringify(report?(d.type==='daily'?'Daily Intelligence · '+d.date:'Weekly Intelligence'):d.title)}\nlang: en\ntranslationKey: ${d.translation.translationKey}\nsourceLanguage: en\nsource_sha256: ${d.translation.source_sha256}\ndraft: true\npublish: false\n---\n\n`;
 if(report){const r=d.reading;
  if(d.type==='daily'){md+='## Worth reading today\n\n'+r.highlights.map(s=>`**${s.title}**\n\n${s.text} [Source](${s.citations[0].source_url})`).join('\n\n');if(r.briefs.length)md+='\n\n## Also worth knowing\n\n'+r.briefs.map(s=>s.title+'\n\n'+s.text).join('\n\n');}
  else md+=r.editor_note+'\n\n'+r.themes.map(s=>'## '+s.heading+'\n\n'+s.paragraphs.join('\n\n')+'\n\n'+s.citations.map(c=>`[Source](${c.source_url})`).join(' · ')).join('\n\n');
  md+='\n\n## '+(d.type==='daily'?'Watching next':'What to watch next week')+'\n\n'+r.watch_items.map(s=>'- '+s.text).join('\n')+'\n\n'+(r.coverage_note??'');
 }else md+='# '+d.title+'\n\n'+d.deck+'\n\n'+d.body.map(s=>(s.heading?'## '+s.heading+'\n\n':'')+s.paragraphs.map(p=>p.text).join('\n\n')).join('\n\n')+'\n\n<details>\n<summary>Sources, unknowns and editorial context</summary>\n\nExploratory draft. Personal judgments await author review.\n\n'+d.unknowns.map(s=>'- '+s).join('\n')+'\n\n'+d.source_mapping.map(m=>'- '+m.claim_id+': '+m.facts.map(f=>`[Source](${f.citation.source_url})`).join(' · ')).join('\n')+'\n\n</details>';
 return md+'\n';
}
