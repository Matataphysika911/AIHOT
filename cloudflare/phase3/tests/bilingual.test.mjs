import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {translatedOutputs,validateBilingual,projectionHash} from '../src/bilingual.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const d=read('../../../content/generated/daily/2026-10-02.json'),w=read('../../../content/generated/weekly/2026-W40.json'),i=read('../../../content/generated/insights/ambarella-physical-ai-workload-integration.json'),t=read('../samples/bilingual-editorial.json');
test('complete paired prose preserves period, citations, unknowns and claim bindings',()=>{
 const en=translatedOutputs(t,d,w,i);assert.equal(en.daily.language,'en');assert.deepEqual(en.weekly.period,w.period);assert.deepEqual(en.insight.source_mapping,i.source_mapping);assert.equal(en.insight.unknowns.length,i.unknowns.length);assert.equal(en.insight.publish,false);
 assert.ok(en.insight.claims.every(c=>!/[\p{Script=Han}]/u.test(c.text)));
 assert.equal(en.insight.body.filter(s=>s.heading).length,2);assert.equal(en.insight.title,t.english.insight.title_candidates[1].title);
});
test('changing current Chinese prose invalidates the English review',()=>{
 const changed=structuredClone(i);changed.body[0].paragraphs[0].text+=' 修改';assert.throws(()=>validateBilingual(t,d,w,changed),/stale/);
});
test('missing English copy, changed claims/evidence and untranslated prose fail closed',()=>{
 for(const mutate of [x=>delete x.english.insight,x=>x.english.daily.highlights[0].fact_ids=['fiction'],x=>x.english.insight.body[0].paragraphs[0].claim_ids=['fiction'],x=>x.english.weekly.themes[0].paragraphs.pop(),x=>x.english.insight.deck='仍然是中文']){
  const changed=structuredClone(t);mutate(changed);assert.throws(()=>validateBilingual(changed,d,w,i));
 }
});
test('locale receipts are tied to content instead of flags',()=>{assert.equal(t.source_sha256,projectionHash(d,w,i));const changed=structuredClone(t);changed.review_status='pending';assert.throws(()=>validateBilingual(changed,d,w,i),/review/);});
