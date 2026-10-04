const labels={robotics:'Robotics · 机器人', 'embodied-ai':'Embodied AI · 具身智能','edge-ai-soc':'Edge AI SoC · 端侧芯片','commercial-signals':'Commercial · 商业信号'};
const linked=s=>`- **${s.title}**：${s.text} [来源](${s.citations[0]?.source_url}) · event ${s.event_id} · facts ${s.fact_ids.join(', ')}`;
export function reportMarkdown(report,title){
 let md=`---\ntitle: ${JSON.stringify(title)}\nlang: zh-CN\ndraft: true\npublish: false\nwriter_skill: null\n---\n\n# ${title}\n\n> 历史已验证样本，as of ${report.as_of}。按新闻发布时间归期、按当前 completed 快照回顾；不是当时已完成的实时日报，也不是完整新闻覆盖。\n\n## Executive summary · 摘要\n\n`;
 md+=report.executive_summary.map(linked).join('\n')||'该时间窗没有符合条件的已验证事件。';
 if(report.type==='daily'){
  md+='\n\n## Top signals · 重点信号\n\n'+report.top_signals.map(s=>linked(s)+` · Phase2 ${s.score} · hotness ${s.hotness.value}`).join('\n');
  for(const section of report.sections){md+=`\n\n## ${labels[section.key]}\n\n`;
   md+=report.executive_summary.filter(s=>section.event_ids.includes(s.event_id)).map(linked).join('\n')||'本样本时间窗暂无更多可核验信号。';}
 }else{
  md+='\n\n## Key shifts · 变化线索\n\n'+(report.key_shifts.map(t=>`- ${t.label} · ${t.event_ids.join(', ')}；仅反映样本集中度，尚不能建立行业趋势。`).join('\n')||'样本不足以确认持续变化。');
  md+='\n\n## Trending topics · 主题观察\n\n'+report.topic_trend.map(t=>`- ${t.topic}：本期 ${t.current_events} / 上期 ${t.previous_events}；${t.trend_status==='insufficient-baseline'?'缺少上期基线':'已观察样本数变化'} · ${t.event_ids.join(', ')}`).join('\n');
  md+='\n\n## Companies to watch · 公司观察\n\n'+report.company_watch.map(c=>`- ${c.company} · ${c.event_ids.join(', ')}；仅表示来源提及，不能据此认定客户关系。`).join('\n');
  md+='\n\n## Edge AI SoC · 端侧芯片\n\n'+report.edge_ai_soc.map(linked).join('\n');
  md+='\n\n## Commercial signals · 商业信号\n\n'+report.edge_ai_soc.map(linked).join('\n')+'\n\n> Ambarella 的总体 AI processor 装机声明不能解释为机器人、N1-655 或 X7 出货量；论文与手部摘要未披露量产/订单。';
  md+='\n\n## What changed · 本期变化\n\n'+report.what_changed.note;
 }
 md+='\n\n## What to watch · 后续验证\n\n'+report.what_to_watch.map(w=>`- ${w.text} · ${w.event_id}`).join('\n');
 md+='\n\n## Evidence · 事实与溯源\n\n'+report.events.map(e=>`### ${e.title}\n\n`+e.facts.map(f=>`- ${f.text} [来源](${f.citation.source_url}) · ${f.id}`).join('\n')+'\n\n未知项：'+e.unknowns.join('；')).join('\n\n');
 return md+'\n';
}
export function socMarkdown(index){return '# AI SoC index · 静态观察索引\n\n> shadow / publish=false；空芯片族是用户指定的分类种子，未取得样本证据。所有数值规格均未披露。\n\n'+index.vendors.map(v=>`## ${v.name}\n\n`+v.families.map(f=>`### ${f.name}\n\n`+(f.chips.length?f.chips.map(c=>`- **${c.name}** (${c.content_type}) · 规格：未披露 · `+c.news.map(n=>`[来源](${n.citation.source_url}) · article ${n.article_id} · event ${n.event_id}`).join('; ')+` · ${c.application.length} 条来源描述的 demo/use；benchmark/review 暂空。`).join('\n'):'待 evidence 挂接；没有虚构芯片规格。')).join('\n\n')).join('\n\n')+'\n';}
