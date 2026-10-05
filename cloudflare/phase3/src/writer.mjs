import {EDITORIAL,selectHeadline} from './editorial.mjs';
import { hash } from './core.mjs';

export const WRITER_SKILL={version:'1.1-recovered.20261001',sha256:'98ec657ae89ab91070cc6f0f94e4b1f598eb9ce77f53a5f96e09cb2786fd0815',
  provenance:'recovered_from_conversation_context; historically confirmed rules; not byte-identical original',
  path:'industry/robotics/skills/uprivate-writer-v1.1/SKILL.md',library_path:'/uPrivate/skills/uprivate-writer-v1.1/SKILL.md'};

export function writerPacket(skillText, candidate, events, snapshotHash) {
  if (!/^scope: insight-draft-only$/m.test(skillText) || !/^version: 1\.1-recovered\.20261001$/m.test(skillText) || hash(skillText)!==WRITER_SKILL.sha256) throw new Error('Unrecognized writer skill');
  const evidence=events.filter(e=>candidate.event_ids.includes(e.id));
  if (!evidence.length || candidate.article_ids.some(id=>!evidence.some(e=>e.article_ids.includes(id)))) throw new Error('Unbound candidate');
  const input={candidate,evidence,snapshot_hash:snapshotHash};
  return {schema_version:'insight-writer-packet.v1',skill:{...WRITER_SKILL},
    editorial_spec:EDITORIAL,input_sha256:hash(input),input,skill_text:skillText,execution_policy:'Read skill_text and evidence in current ChatGPT/Codex session; no model API; return draft JSON only',
    instruction:'Apply the skill only to this candidate. Every fact must bind a fact ID. Inferences and proposed personal judgment must be labeled. Missing SoC numbers stay 未披露. Candidate watchlist may produce an explicitly exploratory sample, never publication-ready content.'};
}

export function validateDraft(draft, packet) {
  if (draft.status!=='draft' || draft.publish!==false || draft.candidate_id!==packet.input.candidate.id || draft.language!=='zh-CN') throw new Error('Draft-only candidate contract');
  if (draft.skill_version!==packet.skill.version || draft.skill_sha256!==packet.skill.sha256 || draft.skill_provenance!==packet.skill.provenance || draft.input_sha256!==packet.input_sha256) throw new Error('Writer receipt does not bind skill/input');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) || !draft.title || !draft.deck || !draft.summary || !draft.sections?.length) throw new Error('Missing article metadata');
  const facts=new Map(packet.input.evidence.flatMap(e=>e.facts.map(f=>[f.id,f]))),claims=new Map();
  for (const c of draft.claims ?? []) {
    if (!c.id || claims.has(c.id) || !['fact','inference','personal_judgment'].includes(c.kind) || !c.text || !c.fact_ids?.length) throw new Error('Invalid claim');
    for (const id of c.fact_ids) if (!facts.has(id)) throw new Error('Unknown evidence fact');
    if (c.kind==='personal_judgment' && c.user_approved!==false) throw new Error('Proposed judgment requires user review');
    claims.set(c.id,c);
  }
  for (const s of draft.sections) {
    if (!(s.heading===null||typeof s.heading==='string') || !s.claim_ids?.length || s.claim_ids.some(id=>!claims.has(id))) throw new Error('Unmapped section');
  }
  for (const kind of ['fact','inference','personal_judgment']) if (![...claims.values()].some(c=>c.kind===kind)) throw new Error('Missing epistemic layer');
  if (!draft.unknowns?.length) throw new Error('Unknown disclosures required');
  if (JSON.stringify(draft.editorial_spec)!==JSON.stringify(EDITORIAL)) throw new Error('Stale editorial overlay');
  if (!Array.isArray(draft.body)||draft.body.filter(s=>s.heading).length>3 || draft.body.some(s=>['从 SoC 这一侧看','回到真实场景','我的判断','接下来，我会盯什么'].includes(s.heading))) throw new Error('Visible editorial outline');
  for(const s of draft.body) for(const p of s.paragraphs??[]) if(!p.text||!p.claim_ids?.length||p.claim_ids.some(id=>!claims.has(id)))throw new Error('Unmapped reading paragraph');
  if(!draft.body.every(s=>s.paragraphs?.length))throw new Error('Empty reading section');
  for(const c of draft.title_candidates??[])if(c.claim_ids?.some(id=>!claims.has(id)))throw new Error('Unmapped headline');
  const headline_selection=selectHeadline(draft.title_candidates);
  if(draft.title!==headline_selection.title)throw new Error('Headline selection mismatch');
  return {...draft,headline_selection,source_mapping:[...claims.values()].map(c=>({claim_id:c.id,kind:c.kind,facts:c.fact_ids.map(id=>({fact_id:id,citation:facts.get(id).citation}))})),
    writer_receipt:{execution:'committed session-authored draft; deterministic structural/provenance validation; no model API',skill:packet.skill,input_sha256:packet.input_sha256,
      editorial_spec:EDITORIAL,candidate_status:packet.input.candidate.status,editorial_status:'pending-user-review',validation_scope:'structural/provenance checks; semantic grounding reviewed separately'}};
}

export function draftMarkdown(d) {
 return `---\ntitle: ${JSON.stringify(d.title)}\nslug: ${d.slug}\nlang: zh-CN\ndraft: true\npublish: false\neditorial_version: ${EDITORIAL.version}\neditorial_sha256: ${EDITORIAL.sha256}\n---\n\n# ${d.title}\n\n${d.deck}\n\n`+
 d.body.map(s=>(s.heading?`## ${s.heading}\n\n`:'')+s.paragraphs.map(p=>p.text).join('\n\n')).join('\n\n')+
 '\n\n<details>\n<summary>来源、证据边界与写作依据</summary>\n\n探索性草稿，个人判断待作者审阅。\n\n'+d.unknowns.map(x=>'- '+x).join('\n')+'\n\n'+d.source_mapping.map(m=>`- ${m.claim_id} (${m.kind}): `+m.facts.map(f=>`[原始来源](${f.citation.source_url}) · ${f.fact_id}`).join('; ')).join('\n')+'\n\n</details>\n';
}
