import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EDITORIAL,selectHeadline} from '../src/editorial.mjs';
import {buildDaily,buildWeekly,group,candidates,hash} from '../src/core.mjs';
import {writerPacket,validateDraft,draftMarkdown} from '../src/writer.mjs';
import {reportMarkdown} from '../src/markdown.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const snapshot=read('../samples/completed.json'),draft=read('../samples/insight-draft.json');
const events=group(snapshot.articles),daily=buildDaily(snapshot,events,'2026-10-02'),weekly=buildWeekly(snapshot,events,'2026-09-28');
const skill=fs.readFileSync(new URL('../../../industry/robotics/skills/uprivate-writer-v1.1/SKILL.md',import.meta.url),'utf8');
const packet=writerPacket(skill,candidates(weekly)[0],events.events,hash(snapshot));
test('thin Daily avoids filler and repeated priorities; audit data stays outside main prose',()=>{
 assert.equal(daily.reading.highlights.length,3);assert.equal(daily.reading.briefs.length,0);
 assert.equal(new Set(daily.reading.highlights.map(x=>x.event_id)).size,3);
 for(const s of daily.reading.highlights)assert.ok([...s.text].length>=50&&[...s.text].length<=150);
 const main=reportMarkdown(daily,'Daily').split('<details>')[0];
 assert.doesNotMatch(main,/hotness|Phase2|event-|:fact:/);assert.equal(daily.writer_skill,null);
});
test('Weekly is independent seven-day synthesis with explicit partial and insufficient baseline',()=>{
 assert.equal(Date.parse(weekly.period.end)-Date.parse(weekly.period.start),7*86400000);
 assert.equal(weekly.reading.themes.length,3);assert.equal(weekly.reading.partial,true);
 assert.equal(weekly.reading.baseline,'insufficient-baseline');assert.match(weekly.reading.editor_note,/不能据此宣布行业拐点/);
 assert.ok(weekly.reading.themes.every(t=>t.fact_ids.every(id=>events.events.some(e=>e.facts.some(f=>f.id===id)))));
});
test('stale source evidence removes curated theme interpretation',()=>{
 const g=structuredClone(events);g.events[0].citations[0].evidence_hash=hash('changed');
 const w=buildWeekly(snapshot,g,'2026-09-28');assert.equal(w.reading.themes.length,2);
});
test('headlines reject low fidelity even with high engagement scores and tie deterministically',()=>{
 const c=structuredClone(draft.title_candidates);c[0].scores.evidence_fidelity=4;
 assert.equal(selectHeadline(c).index,1);assert.throws(()=>selectHeadline(c.map(x=>({...x,evidence_review:'fail'}))),/No evidence/);
 assert.throws(()=>selectHeadline(c.slice(0,2)),/candidates/);
});
test('draft rejects stale overlay, too many headings, unbound prose and wrong headline',()=>{
 for(const mutate of [d=>d.editorial_spec.sha256='stale',d=>d.body.push(...d.body),d=>d.body[0].paragraphs[0].claim_ids=['fiction'],d=>d.title='胜负已定']){
  const d=structuredClone(draft);mutate(d);assert.throws(()=>validateDraft(d,packet));
 }
 const d=validateDraft(draft,packet);assert.deepEqual(d.editorial_spec,EDITORIAL);
 const main=draftMarkdown(d).split('<details>')[0];assert.equal((main.match(/^## /gm)||[]).length,2);assert.doesNotMatch(main,/\*\*事实\*\*|F1\]|user_approved|skill_sha256/);
});
