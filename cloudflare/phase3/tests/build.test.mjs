import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=new URL('../../../',import.meta.url);
test('static export handles an empty candidate period and derives its ISO week',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase3-build-'));
 try{execFileSync(process.execPath,['scripts/phase3/build.mjs','--out',dir,'--date','2026-10-12','--week-start','2026-10-12'],{cwd:root});
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 assert.ok(manifest.files.some(f=>f.path==='weekly/2026-W42.json'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'insights/candidates.json'))),[]);
 assert.ok(!manifest.files.some(f=>f.path.includes('writer-packet')));
 assert.equal(manifest.publish,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real three-article export preserves every citation and rebuilds deterministically',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase3-real-'));
 try{
 const args=['scripts/phase3/build.mjs','--out',dir,'--draft','cloudflare/phase3/samples/insight-draft.json'];
 execFileSync(process.execPath,args,{cwd:root});
 const before=fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),manifest=JSON.parse(before);
 const source=JSON.parse(fs.readFileSync(path.join(dir,'source-map.json')));
 const events=JSON.parse(fs.readFileSync(path.join(dir,'events/index.json'))).events;
 assert.equal(source.length,3);assert.equal(events.length,3);
 const facts=new Set(events.flatMap(e=>e.facts.map(f=>f.id)));
 for(const kind of ['daily','weekly']){
 const file=manifest.files.find(f=>f.path.startsWith(kind+'/')&&f.path.endsWith('.json'));
 const report=JSON.parse(fs.readFileSync(path.join(dir,file.path)));
 assert.equal(report.writer_skill,null);assert.ok(report.what_to_watch.length);
 for(const s of report.executive_summary)for(const id of s.fact_ids)assert.ok(facts.has(id));
 const md=fs.readFileSync(path.join(dir,file.path.replace('.json','.md')),'utf8');
 assert.match(md,/Executive summary/);assert.match(md,/What to watch/);assert.match(md,/不是完整新闻覆盖/);
 }
 assert.ok(manifest.files.some(f=>f.path==='soc/index.md'));
 execFileSync(process.execPath,args,{cwd:root});assert.equal(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
