import { hash } from './core.mjs';

export function writerPacket(skillText, candidate, events, snapshotHash) {
  if (!skillText.includes('scope: insight-draft-only') || !skillText.includes('version: 1.1-reconstructed.1')) throw new Error('Unrecognized writer skill');
  const evidence=events.filter(e=>candidate.event_ids.includes(e.id));
  if (!evidence.length || candidate.article_ids.some(id=>!evidence.some(e=>e.article_ids.includes(id)))) throw new Error('Unbound candidate');
  const input={candidate,evidence,snapshot_hash:snapshotHash};
  return {schema_version:'insight-writer-packet.v1',skill:{version:'1.1-reconstructed.1',sha256:hash(skillText),provenance:'confirmed-rule reconstruction; original unavailable'},
    input_sha256:hash(input),input,skill_text:skillText,execution_policy:'Read skill_text and evidence in current ChatGPT/Codex session; no model API; return draft JSON only',
    instruction:'Apply the skill only to this candidate. Every fact must bind a fact ID. Inferences and proposed personal judgment must be labeled. Missing SoC numbers stay 未披露. Candidate watchlist may produce an explicitly exploratory sample, never publication-ready content.'};
}

export function validateDraft(draft, packet) {
  if (draft.status!=='draft' || draft.publish!==false || draft.candidate_id!==packet.input.candidate.id || draft.language!=='zh-CN') throw new Error('Draft-only candidate contract');
  if (draft.skill_sha256!==packet.skill.sha256 || draft.input_sha256!==packet.input_sha256) throw new Error('Writer receipt does not bind skill/input');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) || !draft.title || !draft.deck || !draft.summary || !draft.sections?.length) throw new Error('Missing article metadata');
  const facts=new Map(packet.input.evidence.flatMap(e=>e.facts.map(f=>[f.id,f]))),claims=new Map();
  for (const c of draft.claims ?? []) {
    if (!c.id || claims.has(c.id) || !['fact','inference','personal_judgment'].includes(c.kind) || !c.text || !c.fact_ids?.length) throw new Error('Invalid claim');
    for (const id of c.fact_ids) if (!facts.has(id)) throw new Error('Unknown evidence fact');
    if (c.kind==='personal_judgment' && c.user_approved!==false) throw new Error('Proposed judgment requires user review');
    claims.set(c.id,c);
  }
  for (const s of draft.sections) {
    if (!s.heading || !s.claim_ids?.length || s.claim_ids.some(id=>!claims.has(id))) throw new Error('Unmapped section');
  }
  for (const kind of ['fact','inference','personal_judgment']) if (![...claims.values()].some(c=>c.kind===kind)) throw new Error('Missing epistemic layer');
  if (!draft.unknowns?.length) throw new Error('Unknown disclosures required');
  return {...draft,source_mapping:[...claims.values()].map(c=>({claim_id:c.id,kind:c.kind,facts:c.fact_ids.map(id=>({fact_id:id,citation:facts.get(id).citation}))})),
    writer_receipt:{execution:'current Codex session, skill read and applied; no model API',skill:packet.skill,input_sha256:packet.input_sha256,
      candidate_status:packet.input.candidate.status,editorial_status:'pending-user-review',validation_scope:'structural/provenance checks; semantic grounding reviewed separately'}};
}

export function draftMarkdown(d) {
  const claims=new Map(d.claims.map(c=>[c.id,c]));
  const label={fact:'事实',inference:'推断',personal_judgment:'个人判断草稿'};
  return `---\ntitle: ${JSON.stringify(d.title)}\ndeck: ${JSON.stringify(d.deck)}\nslug: ${d.slug}\nsummary: ${JSON.stringify(d.summary)}\nlang: zh-CN\ndraft: true\npublish: false\nskill_version: ${d.writer_receipt.skill.version}\nskill_sha256: ${d.skill_sha256}\n---\n\n# ${d.title}\n\n${d.deck}\n\n> 探索性草稿，候选证据门槛未齐；个人判断待作者审阅。\n\n`+
    d.sections.map(s=>`## ${s.heading}\n\n`+s.claim_ids.map(id=>{const c=claims.get(id);return `**${label[c.kind]}** · ${c.text} [${id}]`;}).join('\n\n')).join('\n\n')+
    '\n\n## 尚未披露\n\n'+d.unknowns.map(x=>'- '+x).join('\n')+'\n\n## 来源映射\n\n'+d.source_mapping.map(m=>`- ${m.claim_id} (${m.kind}): `+m.facts.map(f=>`[${f.fact_id}](${f.citation.source_url}) · evidence ${f.citation.evidence_hash}`).join('; ')).join('\n')+'\n';
}
