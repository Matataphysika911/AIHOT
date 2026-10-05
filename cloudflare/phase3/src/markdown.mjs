const labels={robotics:'Robotics · 机器人', 'embodied-ai':'Embodied AI · 具身智能','edge-ai-soc':'Edge AI SoC · 端侧芯片','commercial-signals':'Commercial · 商业信号'};
const linked=s=>`**${s.title}**\n\n${s.text} [来源](${s.citations[0]?.source_url})`;
export function reportMarkdown(report,title){
 let md=`---\ntitle: ${JSON.stringify(title)}\nlang: zh-CN\ndraft: true\npublish: false\nwriter_skill: null\neditorial_version: ${report.editorial_spec.version}\neditorial_sha256: ${report.editorial_spec.sha256}\n---\n\n# ${title}\n\n> 历史已验证样本；不是完整新闻覆盖。\n\n`;
 const r=report.reading;
 if(report.type==='daily'){
  md+='## 今天值得看\n\n'+(r.highlights.map(linked).join('\n\n')||'当前时间窗暂无已验证事件。');
  if(r.briefs.length)md+='\n\n## 另外值得知道\n\n'+r.briefs.map(linked).join('\n\n');
 }else{
  md+=r.editor_note+'\n\n'+r.themes.map(s=>`## ${s.heading}\n\n`+s.paragraphs.join('\n\n')+'\n\n'+s.citations.map(c=>`[来源](${c.source_url})`).join(' · ')).join('\n\n');
 }
 if(r.watch_items.length)md+=`\n\n## ${report.type==='daily'?'我还在看':'下周我会继续看'}\n\n`+r.watch_items.map(w=>'- '+w.text).join('\n');
 md+='\n\n<details>\n<summary>Source / Methodology · 覆盖与证据</summary>\n\n'+(r.coverage_note??'仅覆盖已验证历史样本。')+'\n\nas of '+report.as_of+'\n\n'+report.events.map(e=>`- ${e.id} · Phase2 ${e.score} · hotness ${e.hotness.value}\n`+e.facts.map(f=>`  - ${f.id}: ${f.text} [来源](${f.citation.source_url})`).join('\n')).join('\n')+'\n\n</details>\n';
 return md;
}
export function socMarkdown(index){return '# AI SoC index · 静态观察索引\n\n> shadow / publish=false；空芯片族是用户指定的分类种子，未取得样本证据。所有数值规格均未披露。\n\n'+index.vendors.map(v=>`## ${v.name}\n\n`+v.families.map(f=>`### ${f.name}\n\n`+(f.chips.length?f.chips.map(c=>`- **${c.name}** (${c.content_type}) · 规格：未披露 · `+c.news.map(n=>`[来源](${n.citation.source_url}) · article ${n.article_id} · event ${n.event_id}`).join('; ')+` · ${c.application.length} 条来源描述的 demo/use；benchmark/review 暂空。`).join('\n'):'待 evidence 挂接；没有虚构芯片规格。')).join('\n\n')).join('\n\n')+'\n';}
