import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, hash, validateSnapshot, group, buildDaily, buildWeekly, candidates, buildSoc } from '../../cloudflare/phase3/src/core.mjs';
import { writerPacket, validateDraft, draftMarkdown } from '../../cloudflare/phase3/src/writer.mjs';

import { reportMarkdown, socMarkdown } from '../../cloudflare/phase3/src/markdown.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){if(!['--input','--out','--date','--week-start','--draft','--semantic'].includes(args[i]) || !args[i+1]) throw new Error('Unknown or missing argument');opts[args[i]]=args[i+1];}
const read=async p=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const snapshot=validateSnapshot(await read(opts['--input']??'cloudflare/phase3/samples/completed.json'));
const decisions=opts['--semantic']?await read(opts['--semantic']):[];
const grouped=group(snapshot.articles.filter(a=>a.publish_eligible===1&&!a.is_backfill),decisions);
const daily=buildDaily(snapshot,grouped,opts['--date']??'2026-10-02'),weekly=buildWeekly(snapshot,grouped,opts['--week-start']??'2026-09-28');
const queue=candidates(weekly),soc=buildSoc(snapshot,grouped.events);
const skill=await fs.readFile(path.join(root,'industry/robotics/skills/uprivate-writer-v1.1/SKILL.md'),'utf8');
const packet=queue.length ? writerPacket(skill,queue[0],grouped.events,hash(snapshot)) : null;
const weekDate=new Date(weekly.period.start.slice(0,10)+'T00:00:00Z');
weekDate.setUTCDate(weekDate.getUTCDate()+3-((weekDate.getUTCDay()+6)%7));
const weekYear=weekDate.getUTCFullYear(), firstThursday=new Date(Date.UTC(weekYear,0,4));
firstThursday.setUTCDate(firstThursday.getUTCDate()+3-((firstThursday.getUTCDay()+6)%7));
const weekKey=weekYear+'-W'+String(1+Math.round((weekDate-firstThursday)/604800000)).padStart(2,'0');
const output=path.resolve(root,opts['--out']??'content/generated');
await fs.mkdir(output,{recursive:true});
const files=[];
async function save(name,data){await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true});const text=typeof data==='string'?data:JSON.stringify(data,null,2)+'\n';await fs.writeFile(path.join(output,name),text);files.push({path:name,sha256:hash(text)});}
await save('daily/'+daily.date+'.json',daily);await save('daily/'+daily.date+'.md',reportMarkdown(daily,'Daily Intelligence · '+daily.date));
await save('weekly/'+weekKey+'.json',weekly);await save('weekly/'+weekKey+'.md',reportMarkdown(weekly,'Weekly Intelligence · '+weekKey));
await save('insights/candidates.json',queue);await save('soc/index.json',soc);await save('soc/index.md',socMarkdown(soc));await save('events/index.json',grouped);
if(packet) await save('insights/writer-packet.json',packet);
if(opts['--draft']){if(!packet) throw new Error('No insight candidate for draft');const draft=validateDraft(await read(opts['--draft']),packet);await save('insights/'+draft.slug+'.json',draft);await save('insights/'+draft.slug+'.md',draftMarkdown(draft));}
await save('source-map.json',snapshot.articles.map(a=>({article_id:a.id,source_url:a.canonical_url,evidence_hash:a.evidence.evidence_snapshot_hash,input_hash:a.input_snapshot_hash,acceptance:a.provenance.acceptance,evidence_file:a.provenance.evidence_file,submission_ids:a.submission_ids})));
await save('manifest.json',{schema_version:VERSION,publication:'shadow-only',publish:false,as_of:snapshot.snapshot_at,input_sha256:hash(snapshot),
  design_contract:{navigation:['Daily','Weekly','Insights','AI SoC','Others'],locales:['zh-CN','en'],themes:['dark','light'],english_translation_status:'not-generated; never label Chinese text as English'},
  localized_metadata:{daily:{'zh-CN':{title:'Daily Intelligence · '+daily.date,summary:'已验证样本的事实日报'},en:{title:'Daily Intelligence · '+daily.date,summary:null,status:'translation-pending'}},weekly:{'zh-CN':{title:'Weekly Intelligence · '+weekKey,summary:'已验证样本的部分周报'},en:{title:'Weekly Intelligence · '+weekKey,summary:null,status:'translation-pending'}},insights:{en:{title:'From SmolVLA demo to robot deployment',summary:null,status:'editorial-placeholder'}},soc:{en:{title:'Edge AI SoC Index',summary:null,status:'translation-pending'}}},
  files:[...files]});
console.log(JSON.stringify({output,events:grouped.events.length,daily:daily.counts,candidates:queue.map(c=>({id:c.id,status:c.status,missing:c.missing_gates})),skill_sha256:hash(skill),input_sha256:packet?.input_sha256??null},null,2));
