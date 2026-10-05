import fs from 'node:fs';
import {createHash} from 'node:crypto';
const text=fs.readFileSync(new URL('../../../industry/robotics/editorial/PHASE3-CONTENT-SPEC.md',import.meta.url),'utf8');
export const EDITORIAL={version:'1.2-editorial-preview.20261005',sha256:createHash('sha256').update(text).digest('hex'),path:'industry/robotics/editorial/PHASE3-CONTENT-SPEC.md'};
export function selectHeadline(candidates){
 if(!Array.isArray(candidates)||candidates.length<3||candidates.length>5)throw new Error('3–5 headline candidates required');
 const keys=['curiosity','tension','specificity','technical_relevance','evidence_fidelity'];
 const ranked=candidates.map((c,i)=>{
  if(!c.title||!c.rationale||!c.claim_ids?.length||keys.some(k=>!Number.isInteger(c.scores?.[k])||c.scores[k]<0||c.scores[k]>5))throw new Error('Invalid headline rubric');
  return {...c,index:i,total:keys.reduce((n,k)=>n+c.scores[k],0)};
 }).filter(c=>c.scores.evidence_fidelity===5&&c.evidence_review==='pass');
 if(!ranked.length)throw new Error('No evidence-faithful headline');
 ranked.sort((a,b)=>b.total-a.total||b.scores.specificity-a.scores.specificity||a.index-b.index);
 return {title:ranked[0].title,index:ranked[0].index,total:ranked[0].total,rule:'fidelity=5/pass; total desc; specificity desc; input order',review:'session-editor scores; not automated semantic entailment'};
}
export function editorialReport(report){
 const signals=report.executive_summary;
 const bound=signals.filter(s=>!s.text.includes('暂无人工核验'));
 const themes=bound.map(s=>{
  const amb=s.title.includes('Ambarella'),paper=s.title.includes('PReFlow');
  return {heading:amb?'算力的问题，开始落到多种 workload 怎么一起跑':paper?'学习策略有了新进展，部署验证仍是另一道题':'手部取舍把操作问题带到台前，但证据还很薄',
   paragraphs:[s.text,amb?'这条展示把模型、感知和导航放进同一配置，值得继续看的是它们如何共享资源。当前没有持续运行测量，也没有客户量产数据，不能把集成演示解释为产品成熟。':paper?'算法 benchmark 与真实机器人的约束并不相同。把它和芯片展示放在一起看，可以提出一个共同的验证问题：学习到的能力，怎样在具体系统里维持可用？这仍是问题，尚不是两条消息已经形成的趋势。':'现有标题和短摘要支持关注设计取舍，无法支持自由度或抓取性能比较。它给本周观察补上了机械端的一角，但不够证明整个人形机器人行业已经转向。'],
   event_ids:[s.event_id],fact_ids:s.fact_ids,citations:s.citations,interpretation:'editorial synthesis / verification question; not established trend'};
 });
 return {...report,editorial_spec:EDITORIAL,reading:report.type==='daily'?{
  mode:'quick-industry-brief',highlights:signals.slice(0,3),briefs:report.events.slice(3,11).map(e=>({title:e.title,text:'更多事实见原始来源。',event_id:e.id,fact_ids:e.facts.map(f=>f.id),citations:e.citations})),watch_items:report.what_to_watch.slice(0,4),coverage_note:report.events.length<8?'样本不足，未凑满简讯；仅覆盖已验证历史样本。':null
 }:{mode:'seven-day-editorial-synthesis',editor_note:bound.length?`本周这 ${bound.length} 条已验证样本，把关注点带到了模型之外：芯片上的多任务协同、策略学习怎样走到部署，以及手部操作的设计取舍。把它们放在一起，是为了找出下一步该验证什么。当前覆盖不完整，也没有足够的上期基线，不能据此宣布行业拐点。`:'当前时间窗没有足够的已验证材料形成主题观察。',themes,watch_items:report.what_to_watch.slice(0,4),partial:true,baseline:report.what_changed.status,coverage_note:'七天窗口的部分样本观察；并非完整行业周报。'}};
}
