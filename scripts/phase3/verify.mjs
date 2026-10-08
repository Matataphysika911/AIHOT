import {validateBilingual,translatedOutputs} from '../../cloudflare/phase3/src/bilingual.mjs';
import {EDITORIAL} from '../../cloudflare/phase3/src/editorial.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash,canonicalJson,validateSnapshot} from '../../cloudflare/phase3/src/core.mjs';
import {writerPacket,validateDraft} from '../../cloudflare/phase3/src/writer.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const out='content/generated',m=read(out+'/manifest.json');
assert.equal(m.publish,false);
for(const f of m.files){assert.ok(!path.isAbsolute(f.path)&&!f.path.split('/').includes('..'));assert.equal(hash(fs.readFileSync(path.join(out,f.path),'utf8')),f.sha256,f.path);}
const snapshot=validateSnapshot(read('cloudflare/phase3/samples/completed.json'));
assert.equal(hash(snapshot),m.input_sha256);
const acceptance=read('acceptance/phase2-optimization-2026-10-03.json');
for(const a of snapshot.articles){
 const original=acceptance.cohort.find(x=>x.article_id===a.id);assert.ok(original);
 for(const k of ['final_score','selection_status','processing_status','input_snapshot_hash'])assert.equal(a[k],original[k],`${a.id}:${k}`);
 assert.equal(canonicalJson(a.structure),canonicalJson(original.b_structure));
 assert.deepEqual(a.submission_ids,original.submissions.map(s=>s.id));
 assert.equal(Date.parse(a.completed_at),Date.parse(original.submissions.find(s=>s.reviewer==='B').applied_at.replace(' ','T')+'Z'));
 const sdk=read(a.provenance.evidence_file),raw=sdk.reviewer_a.batch.articles.find(x=>x.id===a.id);assert.ok(raw);
 assert.equal(canonicalJson(a.evidence),canonicalJson(raw.evidence));
 for(const k of ['canonical_url','title','summary','published_at','source_id'])assert.equal(a[k],raw[k]);
}
const events=read(out+'/events/index.json').events;
const facts=new Map(events.flatMap(e=>e.facts.map(f=>[f.id,f]))),eventIds=new Set(events.map(e=>e.id));
for(const r of [read(out+'/daily/2026-10-02.json'),read(out+'/weekly/2026-W40.json')]){
 assert.equal(r.writer_skill,null);assert.equal(r.publish,false);
 for(const signal of r.executive_summary){assert.ok(eventIds.has(signal.event_id));for(const id of signal.fact_ids)assert.ok(facts.has(id));}
}
for(const c of read(out+'/insights/candidates.json')){assert.ok(c.why_now.text&&c.angle&&c.risks.length&&c.unknowns.length);c.event_ids.forEach(id=>assert.ok(eventIds.has(id)));}
const draft=read(out+'/insights/ambarella-physical-ai-workload-integration.json');
const skill=fs.readFileSync('industry/robotics/skills/uprivate-writer-v1.1/SKILL.md','utf8');
const packet=read(out+'/insights/writer-packet.json');
assert.deepEqual(packet,writerPacket(skill,read(out+'/insights/candidates.json')[0],events,hash(snapshot)));
const {translation:zhReceipt,...draftWithoutTranslation}=draft;
assert.deepEqual(draftWithoutTranslation,validateDraft(read('cloudflare/phase3/samples/insight-draft.json'),packet));
const rebind=read('acceptance/phase3-writer-skill-rebind-2026-10-04.json');
assert.equal(packet.input_sha256,rebind.input_sha256);
assert.equal(draft.candidate_id,rebind.candidate_id);
assert.equal(m.input_sha256,rebind.snapshot_sha256);
assert.equal(hash(draft.claims.filter(c=>c.kind==='fact')),rebind.preserved.fact_claims_sha256);
assert.equal(hash(draft.claims.map(({id,kind,fact_ids,user_approved})=>({id,kind,fact_ids,user_approved}))),rebind.preserved.claim_bindings_sha256);
for(const key of ['unknowns','editorial_context'])assert.equal(hash(draft[key]),rebind.preserved[key+'_sha256']);
for(const f of rebind.preserved.files)assert.equal(hash(fs.readFileSync(f.path,'utf8')),f.sha256,f.path);
assert.deepEqual(m.editorial_spec,EDITORIAL);
assert.deepEqual(draft.editorial_spec,EDITORIAL);
for(const f of rebind.preserved.generated_files.filter(f=>!f.path.startsWith('daily/')&&!f.path.startsWith('weekly/')))assert.equal(hash(fs.readFileSync(path.join(out,f.path),'utf8')),f.sha256,f.path);
assert.equal(draft.skill_sha256,hash(fs.readFileSync('industry/robotics/skills/uprivate-writer-v1.1/SKILL.md','utf8')));
assert.equal(draft.publish,false);
for(const map of draft.source_mapping)for(const f of map.facts)assert.deepEqual(f.citation,facts.get(f.fact_id).citation);
const editorialAcceptance=read('acceptance/phase3-editorial-preview-2026-10-05.json');
assert.deepEqual(editorialAcceptance.editorial_spec,EDITORIAL);
// Round-two acceptance remains an immutable historical record; current bilingual export has a new acceptance.
const translations=read('cloudflare/phase3/samples/bilingual-editorial.json');
const english=translatedOutputs(translations,read(out+'/daily/2026-10-02.json'),read(out+'/weekly/2026-W40.json'),draft);
assert.deepEqual(zhReceipt,english.insight.translation);
assert.deepEqual(english.daily,read(out+'/en/daily/2026-10-02.json'));
assert.deepEqual(english.weekly,read(out+'/en/weekly/2026-W40.json'));
assert.deepEqual(english.insight,read(out+'/en/insights/'+draft.slug+'.json'));
const bilingualAcceptance=read('acceptance/phase3-bilingual-preview-2026-10-05.json');
assert.equal(bilingualAcceptance.generated_manifest_sha256,hash(fs.readFileSync(out+'/manifest.json','utf8')));
assert.deepEqual(bilingualAcceptance.generated_files,m.files);
console.log('PASS: all output digests, real Phase2 provenance/structure/evidence, report citations, candidate gates, recovered skill binding and controlled-rebind invariants');
