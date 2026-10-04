import { createHash } from 'node:crypto';

export const VERSION = 'phase3-mvp.v1';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const canonicalJson = value => Array.isArray(value)?'['+value.map(canonicalJson).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}':JSON.stringify(value);
const unique = xs => [...new Set(xs)].sort();
const millis = value => { const t = Date.parse(value); if (!Number.isFinite(t)) throw new Error(`Invalid timestamp: ${value}`); return t; };
const hours = (a, b) => Math.abs(millis(a) - millis(b)) / 3600000;
const tokens = text => new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}|[\p{Script=Han}]{2,}/gu) ?? []).filter(x => !['the','and','with','for','from','new','ai','robotics'].includes(x)));
const overlap = (a, b) => a.filter(x => b.includes(x)).length;
const jaccard = (a, b) => { const common = [...a].filter(x => b.has(x)).length; return common / (new Set([...a, ...b]).size || 1); };

export function canonical(url) {
  const u = new URL(url); if (u.protocol !== 'https:') throw new Error('HTTPS source required');
  u.hash = ''; for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); u.pathname = u.pathname.replace(/\/$/, '') || '/'; return u.href;
}

export function validateSnapshot(snapshot) {
  if (snapshot.schema_version !== 'phase3-input.v1' || !Array.isArray(snapshot.articles)) throw new Error('Unsupported snapshot');
  millis(snapshot.snapshot_at);
  const ids = new Set();
  for (const a of snapshot.articles) {
    if (!a.id || ids.has(a.id)) throw new Error('Duplicate/missing article id'); ids.add(a.id);
    canonical(a.canonical_url); millis(a.published_at); millis(a.completed_at);
    if (millis(a.completed_at) > millis(snapshot.snapshot_at)) throw new Error('Completion after snapshot');
    if (a.processing_status !== 'completed' || !['selected','near-selected','not-selected'].includes(a.selection_status)) throw new Error('Only finalized Phase 2 rows');
    if (!Number.isFinite(a.final_score) || a.final_score < 0 || a.final_score > 100) throw new Error('Invalid final score');
    if (![a.input_snapshot_hash, a.evidence?.evidence_snapshot_hash, a.evidence?.content_hash].every(h=>/^[a-f0-9]{64}$/.test(h ?? ''))) throw new Error('Evidence hash required');
    const {evidence_snapshot_hash,...frozen}=a.evidence;
    if (hash(canonicalJson(frozen)) !== evidence_snapshot_hash) throw new Error('Evidence snapshot digest mismatch');
    if (!a.evidence.truncated && hash(a.evidence.extracted_text) !== a.evidence.content_hash) throw new Error('Evidence content digest mismatch');
    if (a.evidence.article_id !== a.id || canonical(a.evidence.source_url) !== canonical(a.canonical_url)) throw new Error('Evidence owner/source mismatch');
    if (!Array.isArray(a.structure?.facts) || a.submission_ids?.length!==2 || a.submission_ids[0]===a.submission_ids[1] || !a.provenance?.acceptance || !a.provenance?.evidence_file || !a.source_id) throw new Error('Facts/receipts/source required');
  }
  return snapshot;
}

export function features(a) {
  const s = a.structure, frame = s.fact_frame;
  return { companies: unique(s.companies.map(x=>x.toLowerCase())), topics: unique([s.category,...s.tags]),
    products: unique((`${frame.subject} ${frame.object}`.match(/\b(?:N1-655|CV25|X7|PReFlow|SmolVLA|Jetson|Thor|RB[56]|RK\d+)\b/gi) ?? []).map(x=>x.toLowerCase())),
    subject: frame.subject.toLowerCase(), action: frame.action.toLowerCase(), object: frame.object.toLowerCase(),
    title_tokens: [...tokens(a.title)], roundup: /roundup|weekly digest|news roundup|新闻汇总/i.test(a.title) || s.category === 'roundup' };
}

// Semantic decisions are external ChatGPT/author-reviewed data, never a paid API call.
// Cache entries bind both immutable input hashes; stale or unsupported merges fail closed.
export function relate(a, b, decisions = []) {
  const fa = features(a), fb = features(b), gap = hours(a.published_at,b.published_at);
  const signals = {hours:gap, companies:overlap(fa.companies,fb.companies), products:overlap(fa.products,fb.products),
    topics:overlap(fa.topics,fb.topics), title_similarity:jaccard(new Set(fa.title_tokens),new Set(fb.title_tokens))};
  const base = { article_ids:[a.id,b.id].sort(), input_hashes:[a.input_snapshot_hash,b.input_snapshot_hash].sort(), signals };
  if (fa.roundup || fb.roundup) return {...base,relation:'ROUNDUP',method:'deterministic',reason:'Roundups cannot bridge unrelated occurrences'};
  if (gap > 14*24) return {...base,relation:'UNRELATED',method:'deterministic',reason:'Outside 14-day retrieval window'};
  if (canonical(a.canonical_url) === canonical(b.canonical_url) || a.evidence.content_hash === b.evidence.content_hash) return {...base,relation:'SAME_OCCURRENCE',method:'deterministic',reason:'Canonical URL or exact evidence digest'};
  const candidate = signals.companies > 0 || signals.products > 0 || signals.title_similarity >= .25;
  if (!candidate) return {...base,relation:'UNRELATED',method:'deterministic',reason:'Topic alone cannot establish an event'};
  const cached = decisions.find(d => JSON.stringify([...d.article_ids].sort()) === JSON.stringify(base.article_ids));
  if (cached) {
    if (JSON.stringify([...cached.input_hashes].sort()) !== JSON.stringify(base.input_hashes)) throw new Error('Stale semantic decision');
    if (!['SAME_OCCURRENCE','SAME_STORY','ROUNDUP','UNRELATED'].includes(cached.relation) || !cached.reason || !cached.execution || !Array.isArray(cached.support)) throw new Error('Invalid semantic decision');
    if (cached.relation === 'SAME_OCCURRENCE' && gap > 48) throw new Error('Occurrence beyond 48 hours');
    if (['SAME_OCCURRENCE','SAME_STORY'].includes(cached.relation) && (!Number.isFinite(cached.confidence) || cached.confidence < .8 || cached.confidence > 1 || ![a,b].every(row=>cached.support.some(s=>s.article_id===row.id && s.fact_ids?.length && s.fact_ids.every(id=>row.structure.facts.some((_,i)=>id===`${row.id}:fact:${i}`)))))) throw new Error('Unsupported semantic merge');
    return {...base,relation:cached.relation,method:'semantic-cache',reason:cached.reason,receipt:cached};
  }
  if (gap <= 48 && fa.subject === fb.subject && fa.action === fb.action && fa.object === fb.object && signals.title_similarity >= .65) return {...base,relation:'SAME_OCCURRENCE',method:'deterministic-frame',reason:'Exact subject/action/object plus near-identical title'};
  return {...base,relation:'UNRELATED',method:'conservative-fallback',reason:'Semantic adjudication required; no merge',needs_semantic_review:true};
}

function citation(a) {
  return {article_id:a.id,source_id:a.source_id,source_name:a.source_name,source_url:canonical(a.canonical_url),
    evidence_hash:a.evidence.evidence_snapshot_hash,input_hash:a.input_snapshot_hash,evidence_status:a.evidence.status,
    content_hash:a.evidence.content_hash,extraction_method:a.evidence.extraction_method,submission_ids:a.submission_ids,
    acceptance:a.provenance.acceptance,evidence_file:a.provenance.evidence_file};
}

export function group(articles, decisions = []) {
  const rows = [...articles].sort((a,b)=>a.id.localeCompare(b.id)), relations=[];
  const pairs=new Map();
  for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
    const r=relate(rows[i],rows[j],decisions); relations.push(r); pairs.set(r.article_ids.join('|'),r);
  }
  const clusters=[];
  for (const a of rows) {
    let target;
    for (const cluster of clusters) {
      // Complete linkage prevents a weak bridge from merging unrelated stories.
      const checks=cluster.map(b=>pairs.get([a.id,b.id].sort().join('|')));
      if (checks.every(p=>p.relation==='SAME_OCCURRENCE')) { target=cluster; break; }
    }
    if (target) target.push(a); else clusters.push([a]);
  }
  const events=clusters.map(xs=>({id:'event-'+hash(xs.map(a=>a.id).sort()).slice(0,16),article_ids:xs.map(a=>a.id).sort(),
    title:xs[0].title,published_at:xs.map(a=>a.published_at).sort()[0],latest_at:xs.map(a=>a.published_at).sort().at(-1),
    source_ids:unique(xs.map(a=>a.source_id)),independent_publishers:unique(xs.map(a=>new URL(a.canonical_url).hostname.replace(/^www\./,''))),
    products:unique(xs.flatMap(a=>features(a).products)),companies:unique(xs.flatMap(a=>a.structure.companies)),topics:unique(xs.flatMap(a=>[a.structure.category,...a.structure.tags])),
    score:Math.max(...xs.map(a=>a.final_score)),facts:xs.flatMap(a=>a.structure.facts.map((text,i)=>({id:`${a.id}:fact:${i}`,text,citation:citation(a)}))),
    unknowns:unique(xs.flatMap(a=>a.structure.unknowns ?? [])),citations:xs.map(citation)}));
  const eventByArticle=new Map(events.flatMap(e=>e.article_ids.map(id=>[id,e.id])));
  const story_links=relations.filter(r=>r.relation==='SAME_STORY').map(r=>({...r,event_ids:unique(r.article_ids.map(id=>eventByArticle.get(id)))}));
  return {events,relations,story_links};
}

export function hotness(event, articles, asOf) {
  const t=millis(asOf), publishers=new Map();
  for (const a of articles.filter(a=>event.article_ids.includes(a.id))) {
    const age=(t-millis(a.published_at))/3600000;
    if (age < 0 || age > 48) continue;
    const publisher=new URL(a.canonical_url).hostname.replace(/^www\./,'');
    const value=2**(-age/24); publishers.set(publisher,Math.max(publishers.get(publisher)??0,value));
  }
  return {value:Number([...publishers.values()].reduce((a,b)=>a+b,0).toFixed(6)),window_hours:48,half_life_hours:24,
    independent_publishers:publishers.size,contributions:[...publishers].sort().map(([publisher,value])=>({publisher,value}))};
}

function reportEvents(events, rows, start, end, asOf) {
  const chosen=rows.filter(a=>a.publish_eligible===1 && !a.is_backfill && millis(a.published_at)>=millis(start) && millis(a.published_at)<millis(end) && millis(a.published_at)<=millis(asOf) && millis(a.completed_at)<=millis(asOf));
  const ids=new Set(chosen.map(a=>a.id));
  return events.filter(e=>e.article_ids.some(id=>ids.has(id))).map(e=>{
    const article_ids=e.article_ids.filter(id=>ids.has(id)),subset=chosen.filter(a=>article_ids.includes(a.id));
    return {...e,article_ids,source_ids:unique(subset.map(a=>a.source_id)),
      independent_publishers:unique(subset.map(a=>new URL(a.canonical_url).hostname.replace(/^www\./,''))),
      products:unique(subset.flatMap(a=>features(a).products)),companies:unique(subset.flatMap(a=>a.structure.companies)),topics:unique(subset.flatMap(a=>[a.structure.category,...a.structure.tags])),
      score:Math.max(...subset.map(a=>a.final_score)),published_at:subset.map(a=>a.published_at).sort()[0],latest_at:subset.map(a=>a.published_at).sort().at(-1),
      unknowns:unique(subset.flatMap(a=>a.structure.unknowns??[])),facts:e.facts.filter(f=>ids.has(f.citation.article_id)),citations:e.citations.filter(c=>ids.has(c.article_id)),
      hotness:hotness(e,chosen,asOf)};
  }).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}

export function buildDaily(snapshot, grouped, date) {
  const start=`${date}T00:00:00+08:00`,end=new Date(millis(start)+86400000).toISOString();
  const events=reportEvents(grouped.events,snapshot.articles,start,end,snapshot.snapshot_at);
  return {schema_version:VERSION,type:'daily',status:'shadow',language:'zh-CN',date,timezone:'Asia/Shanghai',period:{start,end},
    as_of:snapshot.snapshot_at,data_mode:snapshot.mode,writer_skill:null,events,
    publish:false,counts:{events:events.length,articles:unique(events.flatMap(e=>e.article_ids)).length},
    executive_summary:events.slice(0,3).map(signal),top_signals:events.slice(0,3).map(signal),what_to_watch:events.map(watch),
    sections:['robotics','embodied-ai','edge-ai-soc','commercial-signals'].map(key=>({key,event_ids:events.filter(e=>key==='commercial-signals'?e.topics.some(t=>/量产|部署|工程|合作/.test(t)):key==='edge-ai-soc'?e.topics.includes(key):key==='embodied-ai'?e.topics.some(t=>/VLA|数据|训练|运动控制/.test(t)):e.topics.some(t=>/机器人/.test(t))).map(e=>e.id)}))};
}

export function buildWeekly(snapshot, grouped, startDate) {
  const start=`${startDate}T00:00:00+08:00`,end=new Date(millis(start)+7*86400000).toISOString(),prevStart=new Date(millis(start)-7*86400000).toISOString();
  const events=reportEvents(grouped.events,snapshot.articles,start,end,snapshot.snapshot_at),previous=reportEvents(grouped.events,snapshot.articles,prevStart,start,snapshot.snapshot_at);
  const topics=unique(events.flatMap(e=>e.topics)).map(topic=>{
    const current=events.filter(e=>e.topics.includes(topic)),prior=previous.filter(e=>e.topics.includes(topic));
    return {topic,current_events:current.length,previous_events:prior.length,delta:current.length-prior.length,
      trend_status:prior.length?'observed-count-change':'insufficient-baseline',event_ids:current.map(e=>e.id),article_ids:unique(current.flatMap(e=>e.article_ids)),
      continuity:unique(current.map(e=>new Date(millis(e.published_at)+8*3600000).toISOString().slice(0,10))).length,
      period:{start,end},source_dedup:'publisher-hostname maximum per event',
      independent_publishers:unique(current.flatMap(e=>e.independent_publishers)),
      score_inputs:current.map(e=>({event_id:e.id,phase2_final_score:e.score,hotness:e.hotness}))};
  });
  return {schema_version:VERSION,type:'weekly',status:'shadow',language:'zh-CN',timezone:'Asia/Shanghai',period:{start,end},story_links:grouped.story_links.filter(r=>r.event_ids.every(id=>events.some(e=>e.id===id))),
    as_of:snapshot.snapshot_at,data_mode:snapshot.mode,writer_skill:null,partial:millis(snapshot.snapshot_at)<millis(end),
    publish:false,coverage:'verified cohort only; not a complete weekly corpus',events,topic_trend:topics,
    executive_summary:events.slice(0,3).map(signal),edge_ai_soc:events.filter(e=>e.topics.includes('edge-ai-soc')).map(signal),
    what_to_watch:events.map(watch),what_changed:{status:previous.length?'observed-cohort-change':'insufficient-baseline',
      current_event_ids:events.map(e=>e.id),previous_event_ids:previous.map(e=>e.id),
      note:'仅比较已验证样本；没有上期完整覆盖，不能把新增样本解释为行业增长。'},
    key_shifts:topics.filter(t=>t.current_events>=2).map(t=>({...t,label:`${t.topic}: ${t.current_events} 个已验证事件`,interpretation:'sample concentration; not established industry trend'})),
    company_watch:unique(events.flatMap(e=>e.companies)).map(company=>({company,event_ids:events.filter(e=>e.companies.includes(company)).map(e=>e.id),role:'mentioned; customer relationship not implied'})),
    commercial_signal:snapshot.articles.filter(a=>events.some(e=>e.article_ids.includes(a.id))).map(a=>({text:a.structure.commercial_signal,attribution:'Phase2 source-grounded structure',article_id:a.id,event_id:events.find(e=>e.article_ids.includes(a.id)).id,citation:citation(a)}))};
}

export function candidates(weekly) {
  return weekly.events.map(e=>{
    const relevance=e.topics.some(t=>/robot|soc|paper|VLA|机器人|端侧|边缘|训练|控制/i.test(t));
    const anchors=['edge-ai-soc','VLA','VLM','世界模型','Memory','Bandwidth','NPU'];
    const related=weekly.events.filter(x=>x.id===e.id || x.topics.some(t=>anchors.includes(t) && e.topics.includes(t)));
    const sourceCount=unique(related.flatMap(x=>x.independent_publishers)).length;
    const observationDays=unique(related.map(x=>new Date(millis(x.published_at)+8*3600000).toISOString().slice(0,10)));
    const supportedStory=weekly.story_links.some(link=>link.event_ids.every(id=>related.some(x=>x.id===id)));
    const high=e.score>=75,multi=sourceCount>=2,continuity=related.length>=2&&(observationDays.length>=2||supportedStory);
    return {id:'candidate-'+e.id,title:e.title,status:high&&multi&&continuity&&relevance?'ready-for-editorial-review':'watchlist',
      rank_score:e.score + (multi?10:0)+(continuity?10:0),criteria:{high_score:high,multi_source:multi,multi_event_continuity:continuity,user_focus:relevance},
      missing_gates:[...(!high?['high-score']:[]),...(!multi?['independent-sources']:[]),...(!continuity?['event-continuity']:[])],
      event_ids:related.map(x=>x.id),article_ids:unique(related.flatMap(x=>x.article_ids)),primary_event_id:e.id,
      citations:related.flatMap(x=>x.citations),evidence_links:related.flatMap(x=>x.facts),unknowns:unique(related.flatMap(x=>x.unknowns)),
      why_now:{as_of:weekly.as_of,text:`本期出现 ${related.length} 个关联样本、${sourceCount} 个来源；最高 Phase2 分数 ${e.score}。这支持提出验证问题，未满足的证据门槛见 missing_gates。`,event_ids:related.map(x=>x.id)},
      angle:e.topics.includes('edge-ai-soc')?'多 workload integration 如何走向可验证的机器人 Deployment？':e.topics.includes('paper')?'policy 改进的研究结果距真实机器人与端侧 runtime 还有哪些验证？':'手部设计取舍如何影响操作能力，现有摘要能支持什么判断？',
      risks:['样本覆盖不完整；共享公司或 topic 不是同一事件或独立验证。',...(multi?[]:['单一独立来源；厂商声明与第三方复现须区分。']),...(continuity?[]:['未建立同一分析主线的连续事件证据。'])],
      publish:false,writer_skill_required:'uPrivate Writer Skill v1.1',independent_sources:sourceCount,observation_days:observationDays,continuity_basis:supportedStory?'evidence-supported-story-link':'distinct-Shanghai-publication-days'};
  }).sort((a,b)=>b.rank_score-a.rank_score || a.id.localeCompare(b.id));
}

export const vendorSeed = [
  ['nvidia','NVIDIA',['Jetson','Thor']],['qualcomm','Qualcomm',['RB','Snapdragon']],['ambarella','Ambarella',['CV','N1','X']],
  ['horizon','Horizon',['待 evidence 确认']],['d-robotics','D-Robotics',['待 evidence 确认']],['rockchip','Rockchip',['RK AI']],
  ['mediatek','MediaTek',['Genio']],['apple','Apple',['M']],['others','Others',['unclassified']]
];
export function buildSoc(snapshot, events) {
  const bindings=[['ambarella','N1','N1-655'],['ambarella','CV','CV25'],['ambarella','X','X7']];
  return {schema_version:VERSION,type:'soc-index',status:'shadow',vendor_seed_origin:'user-confirmed scope; unverified catalog placeholders',
    content_types:['news','benchmark','review','application'],vendors:vendorSeed.map(([id,name,families])=>({id,name,
      families:families.map(family=>({id:`${id}:${family}`,name:family,status:'seed',chips:bindings.filter(b=>b[0]===id&&b[1]===family).map(([, ,chip])=>{
        const rows=snapshot.articles.filter(a=>a.structure.facts.some(f=>new RegExp(`\\b${chip}\\b`,'i').test(f)));
        return {id:`${id}:${chip.toLowerCase()}`,name:chip,content_type:chip==='X7'?'accelerator':'chip',specs:{TOPS:null,Memory:null,Bandwidth:null,Latency:null,Power:null,BOM:null,ASP:null},spec_status:'未披露',
          news:rows.map(a=>({article_id:a.id,event_id:events.find(e=>e.article_ids.includes(a.id))?.id,citation:citation(a)})),benchmark:[],review:[],application:rows.flatMap(a=>a.structure.facts.map((text,i)=>({text,i})).filter(f=>new RegExp(`\\b${chip}\\b`,'i').test(f.text)&&/demo|powered|uses|workload/i.test(f.text)).map(f=>({kind:'source-described-demo-or-use',fact_id:`${a.id}:fact:${f.i}`,article_id:a.id,event_id:events.find(e=>e.article_ids.includes(a.id))?.id,citation:citation(a)}))),
          status:rows.length?'evidence-linked':'unverified-seed'};
      })})),
      mentioned_articles:snapshot.articles.filter(a=>a.structure.companies.some(c=>c.toLowerCase()===name.toLowerCase())).map(a=>({article_id:a.id,relation:'mentioned',citation:citation(a)}))}))};
}

const chineseSignals={
 '5baa5d53-15ec-44a5-b054-1058752304fe':{
  title:'Ambarella 展示 N1-655 多 workload 集成，并介绍 X7 与生态合作',
  evidence_hash:'56f3f46d5ac7ba03b04b378e0def7135083f7e55280c3b0539f0df791f26259d',text:'Ambarella 自述：N1-655 在移动操作机器人展示中运行 SmolVLA、SLAM、navigation 与 pick-and-place；另介绍 X7 standalone accelerator。展示未披露持续运行性能、功耗或客户量产证据。',fact_indexes:[0,4],
  watch:'跟进同一配置下的 Latency、Power、Memory/Bandwidth 和第三方或客户验证；不将 demo 视为量产。'},
 '21557a04-bf5f-4de9-bc62-738fdeb03ceb':{
  title:'PReFlow 报告 offline-to-online policy 改进结果',
  evidence_hash:'4320d2098e9cdebedb4a9bf7e006546b380d446bee759c0dd7bd14e87ce4b262',text:'论文摘要介绍 critic-based proposal selection 与 conditional refinement flow，并报告 OGBench 评估结果。它提供 policy 学习线索，未披露真实机器人 Deployment 或 SoC 测量。',fact_indexes:[0,3],
  watch:'跟进真实机器人、模型实现与端到端 runtime 测量；研究 benchmark 不代表机器人部署效果。'},
 '1f9fd3e9-0e21-413d-8bb7-b2d16b3be070':{
  title:'Boston Dynamics 手部设计报道：当前只有短 RSS 摘要',
  evidence_hash:'82e877e75fbd24005b5045a3fcc8f9bf60b3f2cf8e23685f2986255b7faee0cd',text:'报道标题提及新 humanoid hand 去掉小指；摘要仅描述工程师把小指与无名指绑在一起进行体验。正文抓取为 403，不能补写手部规格或性能结论。',fact_indexes:[0,1,2],
  watch:'取得更多可访问的手部设计证据，再确认自由度、抓取能力与具体取舍；当前不推断性能。'}
};
export function signal(e){
 const a=e.article_ids.find(id=>chineseSignals[id]),copy=e.citations.some(c=>c.article_id===a&&c.evidence_hash===chineseSignals[a]?.evidence_hash)?chineseSignals[a]:null;
 return {event_id:e.id,article_ids:e.article_ids,title:copy?.title??e.title,text:copy?.text??'本事件暂无人工核验中文摘要；请查看事实与来源。',
  kind:'fact-summary',fact_ids:copy?copy.fact_indexes.map(i=>`${a}:fact:${i}`):e.facts.map(f=>f.id),score:e.score,hotness:e.hotness,citations:e.citations};
}
function watch(e){const a=e.article_ids.find(id=>chineseSignals[id]);return {event_id:e.id,article_ids:e.article_ids,kind:'research-question',text:e.citations.some(c=>c.article_id===a&&c.evidence_hash===chineseSignals[a]?.evidence_hash)?chineseSignals[a].watch:'跟进独立来源与未披露项。',unknowns:e.unknowns};}
