import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hash,canonical,validateSnapshot,relate,group,hotness,buildDaily,buildWeekly,candidates,buildSoc} from '../src/core.mjs';
import {writerPacket,validateDraft} from '../src/writer.mjs';
const snapshot=JSON.parse(fs.readFileSync(new URL('../samples/completed.json',import.meta.url)));
const skill=fs.readFileSync(new URL('../../../industry/robotics/skills/uprivate-writer-v1.1/SKILL.md',import.meta.url),'utf8');
const copy=x=>structuredClone(x);
const fixture=(id,source='example.org',time='2026-10-02T01:00:00Z')=>{
  const a=copy(snapshot.articles[2]);a.id=id;a.canonical_url=`https://${source}/${id}`;a.source_id=source;a.published_at=time;
  a.title=`Acme rover ${id}`;a.input_snapshot_hash=hash(id);a.evidence.content_hash=hash(id);a.structure.fact_frame={subject:'Acme',action:'launched',object:id,evidence:id};a.structure.companies=['Acme'];return a;
};
const decision=(a,b,relation)=>({article_ids:[a.id,b.id],input_hashes:[a.input_snapshot_hash,b.input_snapshot_hash],relation,confidence:.95,
  reason:'Test adjudication from both records',execution:'test fixture; no external service',support:[a,b].map(x=>({article_id:x.id,fact_ids:[`${x.id}:fact:0`]}))});
test('real cohort evidence digests and finalized receipts are valid',()=>assert.equal(validateSnapshot(copy(snapshot)).articles.length,3));
test('tampered evidence and uncompleted records are rejected',()=>{
  const a=copy(snapshot);a.articles[0].evidence.extracted_text+='corruption';assert.throws(()=>validateSnapshot(a),/digest/);
  const b=copy(snapshot);b.articles[0].processing_status='new';assert.throws(()=>validateSnapshot(b),/finalized/);
});
test('canonical URLs remove tracking, retain meaningful query parameters',()=>assert.equal(canonical('https://example.org/news/?id=2&utm_source=feed#x'),'https://example.org/news?id=2'));
test('canonical duplicate counts once, including two feeds from same publisher',()=>{
  const a=fixture('a'),b=fixture('b');b.canonical_url=a.canonical_url;const e=group([a,b]).events[0];
  assert.equal(e.article_ids.length,2);assert.equal(hotness(e,[a,b],'2026-10-02T01:00:00Z').value,1);
});
test('same company/product/topic is insufficient to merge two announcements',()=>{
  const a=fixture('a'),b=fixture('b');assert.equal(relate(a,b).relation,'UNRELATED');assert.equal(group([a,b]).events.length,2);
});
test('semantic occurrence joins; same story links distinct occurrences',()=>{
  const a=fixture('a'),b=fixture('b');assert.equal(group([a,b],[decision(a,b,'SAME_OCCURRENCE')]).events.length,1);
  const story=group([a,b],[decision(a,b,'SAME_STORY')]);assert.equal(story.events.length,2);assert.equal(story.story_links.length,1);
});
test('roundup cannot bridge distinct stories',()=>{
  const a=fixture('a'),b=fixture('b');b.title='Weekly digest';assert.equal(relate(a,b,[decision(a,b,'SAME_OCCURRENCE')]).relation,'ROUNDUP');assert.equal(group([a,b]).events.length,2);
});
test('stale semantic cache and unsupported merge fail closed',()=>{
  const a=fixture('a'),b=fixture('b'),d=decision(a,b,'SAME_OCCURRENCE');d.input_hashes[0]=hash('stale');assert.throws(()=>relate(a,b,[d]),/Stale/);
  const e=decision(a,b,'SAME_OCCURRENCE');e.support[0].fact_ids=['invented'];assert.throws(()=>relate(a,b,[e]),/Unsupported/);
});
test('14-day retrieval and 48-hour occurrence bounds',()=>{
  const a=fixture('a'),b=fixture('b','example.org','2026-09-01T00:00:00Z');assert.equal(relate(a,b).relation,'UNRELATED');
  b.published_at='2026-09-28T00:00:00Z';assert.throws(()=>relate(a,b,[decision(a,b,'SAME_OCCURRENCE')]),/48 hours/);
});
test('complete linkage blocks transitive unrelated bridges',()=>{
  const a=fixture('a'),b=fixture('b'),c=fixture('c');const d=[decision(a,b,'SAME_OCCURRENCE'),decision(b,c,'SAME_OCCURRENCE'),decision(a,c,'UNRELATED')];
  assert.equal(group([a,b,c],d).events.length,2);
});
test('hotness uses 24-hour half-life and rejects future/outside-window',()=>{
  const a=fixture('a'),e=group([a]).events[0];assert.equal(hotness(e,[a],'2026-10-03T01:00:00Z').value,.5);
  assert.equal(hotness(e,[a],'2026-10-01T01:00:00Z').value,0);assert.equal(hotness(e,[a],'2026-10-05T01:00:00Z').value,0);
});
test('Shanghai Daily excludes backfill/ineligible and does not apply writer skill',()=>{
  const s=copy(snapshot);s.articles[0].is_backfill=1;s.articles[1].publish_eligible=0;
  const d=buildDaily(s,group(s.articles),'2026-10-02');assert.equal(d.counts.articles,1);assert.equal(d.writer_skill,null);
  assert.equal(buildDaily(snapshot,group(snapshot.articles),'2026-10-04').counts.articles,0);
});
test('Weekly preserves partial coverage and insufficient trend baseline',()=>{
  const w=buildWeekly(snapshot,group(snapshot.articles),'2026-09-28');assert.equal(w.partial,true);assert.equal(w.writer_skill,null);
  assert.ok(w.topic_trend.every(t=>t.trend_status==='insufficient-baseline'));
});
test('three real candidates stay watchlist without independent continuity',()=>{
  const cs=candidates(buildWeekly(snapshot,group(snapshot.articles),'2026-09-28'));
  assert.equal(cs.length,3);assert.ok(cs.every(c=>c.status==='watchlist'&&c.publish===false&&!c.criteria.multi_source));
});
test('SoC catalog separates evidence-backed chips from unverified family seeds',()=>{
  const index=buildSoc(snapshot,group(snapshot.articles).events);assert.equal(index.vendors.length,9);
  const chips=index.vendors.find(v=>v.id==='ambarella').families.flatMap(f=>f.chips);assert.equal(chips.length,3);
  assert.ok(chips.every(c=>c.news.length===1&&Object.values(c.specs).every(v=>v===null)));assert.equal(index.vendors[0].families[0].chips.length,0);
});
test('writer receipt binds exact skill/input and rejects nonexistent citations',()=>{
  const g=group(snapshot.articles),candidate=candidates(buildWeekly(snapshot,g,'2026-09-28'))[0];const p=writerPacket(skill,candidate,g.events,hash(snapshot));
  const draft=JSON.parse(fs.readFileSync(new URL('../samples/insight-draft.json',import.meta.url)));assert.equal(validateDraft(draft,p).status,'draft');
  const d=copy(draft);d.claims[0].fact_ids=['fictional'];assert.throws(()=>validateDraft(d,p),/Unknown/);
  const e=copy(draft);e.publish=true;assert.throws(()=>validateDraft(e,p),/Draft-only/);
});
test('grouping is invariant to input order and makes no mutation',()=>{
  const original=JSON.stringify(snapshot);assert.deepEqual(group(snapshot.articles),group([...snapshot.articles].reverse()));assert.equal(JSON.stringify(snapshot),original);
});

test('recovered writer pin rejects old version and edited bytes',()=>{
 const g=group(snapshot.articles),candidate=candidates(buildWeekly(snapshot,g,'2026-09-28'))[0];
 assert.throws(()=>writerPacket(skill.replace('1.1-recovered.20261001','1.1-reconstructed.1'),candidate,g.events,hash(snapshot)),/Unrecognized/);
 assert.throws(()=>writerPacket(skill+'\n',candidate,g.events,hash(snapshot)),/Unrecognized/);
});
test('writer validation rejects wrong version, provenance, input and approved judgment',()=>{
 const g=group(snapshot.articles),candidate=candidates(buildWeekly(snapshot,g,'2026-09-28'))[0],p=writerPacket(skill,candidate,g.events,hash(snapshot));
 const draft=JSON.parse(fs.readFileSync(new URL('../samples/insight-draft.json',import.meta.url)));
 for(const key of ['skill_version','skill_provenance','skill_sha256','input_sha256']){const d=copy(draft);d[key]='stale';assert.throws(()=>validateDraft(d,p),/does not bind/);}
 const d=copy(draft);d.claims.find(c=>c.kind==='personal_judgment').user_approved=true;assert.throws(()=>validateDraft(d,p),/user review/);
});

test('period metadata excludes next-day publishers and future publications',()=>{
 const a=fixture('a','one.example','2026-10-01T15:00:00Z'),b=fixture('b','two.example','2026-10-01T17:00:00Z');
 b.canonical_url=a.canonical_url;b.source_id='second-feed';b.final_score=99;b.structure.companies=['OtherCo'];
 const corpus={...snapshot,articles:[a,b]},g=group(corpus.articles);
 const d=buildDaily(corpus,g,'2026-10-01');assert.equal(d.events.length,1);assert.deepEqual(d.events[0].source_ids,['one.example']);assert.deepEqual(d.events[0].companies,['Acme']);assert.equal(d.events[0].score,a.final_score);
 const future=fixture('future','future.example','2026-10-03T12:00:00Z');
 assert.equal(buildDaily({...snapshot,articles:[future]},group([future]),'2026-10-03').counts.events,0);
});

test('semantic merges require an explicit finite confidence in range',()=>{
 const a=fixture('a'),b=fixture('b');
 for(const confidence of [undefined,NaN,1.1,.79]){const d=decision(a,b,'SAME_STORY');d.confidence=confidence;assert.throws(()=>relate(a,b,[d]),/Unsupported/);}
});
test('candidate ready gate requires score, independent sources and topical continuity together',()=>{
 const w=buildWeekly(snapshot,group(snapshot.articles),'2026-09-28');
 const e=copy(w.events[0]);e.id='independent-followup';e.published_at='2026-10-03T00:00:00Z';e.article_ids=['followup'];e.independent_publishers=['independent.example'];
 const ready=candidates({...w,events:[...w.events,e]}).find(c=>c.primary_event_id===w.events[0].id);
 assert.equal(ready.status,'ready-for-editorial-review');assert.equal(ready.publish,false);
 assert.ok(ready.why_now.text&&ready.angle&&ready.risks.length);
 e.independent_publishers=w.events[0].independent_publishers;
 assert.equal(candidates({...w,events:[w.events[0],e]})[0].status,'watchlist');
});
test('curated Chinese translations cannot silently carry over to changed evidence',()=>{
 const g=group(snapshot.articles);g.events[0].citations[0].evidence_hash=hash('changed');
 const d=buildDaily(snapshot,g,'2026-10-02');
 const s=d.executive_summary.find(s=>s.event_id===g.events[0].id);
 assert.match(s.text,/暂无人工核验中文摘要/);
});
