import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash,canonicalJson,validateSnapshot} from '../../cloudflare/phase3/src/core.mjs';
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
assert.equal(draft.skill_sha256,hash(fs.readFileSync('industry/robotics/skills/uprivate-writer-v1.1/SKILL.md','utf8')));
assert.equal(draft.publish,false);
for(const map of draft.source_mapping)for(const f of map.facts)assert.deepEqual(f.citation,facts.get(f.fact_id).citation);
console.log('PASS: all output digests, real Phase2 provenance/structure/evidence, report citations, candidate gates and skill mapping');
