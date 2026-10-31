import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {recentObservation} from '../src/readiness.ts';
const file=fs.readFileSync(new URL('../src/daily.ts',import.meta.url),'utf8');
const source=file.slice(file.indexOf('export async function dailyWatchdog('),file.indexOf('export async function appendDailyOriginal')).replace('export ','').replace('db:D1Database','db').replaceAll('.all<any>()','.all()').replaceAll('.first<any>()','.first()');
async function check(at,{jobs={},previous=null,roles,polls=[],backlogStatus='healthy'}={}) {
  const writes=[]; let backlogReads=0;
  const epoch=Date.parse(at);
  const clock=class extends Date {constructor(...args){super(...(args.length?args:[epoch]));} static now(){return epoch;}};
  const db={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){
    if(sql.includes('SELECT digest,health_json')) return previous;
    if(sql.includes('FROM phase3_daily_jobs')) return jobs[values[0]]??null;
    throw Error('Unexpected read: '+sql);
  },async all(){
    if(sql.includes("SELECT 'A' reviewer"))return {results:roles??['A','B'].map(reviewer=>({reviewer,last_submission:new Date(epoch-3600000).toISOString().slice(0,19).replace('T',' ')}))};
    if(sql.includes('FROM reviewer_poll_health'))return {results:polls};
    if(sql.includes('FROM sources'))return {results:[]};
    throw Error('Unexpected query: '+sql);
  },async run(){writes.push({sql,values});return {success:true};}};}};
  const context=vm.createContext({Date:clock,console:{log(){}},recentObservation,processingBacklog:async()=>{backlogReads++;return {status:backlogStatus};},dailyHash:async data=>JSON.stringify(data)});
  vm.runInContext(source+';this.run=dailyWatchdog;',context);
  const health=JSON.parse(JSON.stringify(await context.run(db)));
  return {health,writes,backlogReads};
}
test('midnight continues to flag yesterday missing; does not reset to healthy',async()=>{
  const {health}=await check('2026-10-18T18:34:34Z');
  assert.equal(health.expected_publication_date,'2026-10-18');assert.equal(health.missing_publication,true);assert.equal(health.status,'degraded');
});
test('before deadline yesterday published is healthy while today is pending',async()=>{
  const {health}=await check('2026-10-19T00:45:00Z',{jobs:{'2026-10-18':{state:'published'},'2026-10-19':{state:'pending'}}});
  assert.equal(health.status,'healthy');assert.equal(health.expected_publication_date,'2026-10-18');
});
test('at deadline today must be published',async()=>{
  const {health}=await check('2026-10-19T01:00:00Z',{jobs:{'2026-10-18':{state:'published'},'2026-10-19':{state:'pending'}}});
  assert.equal(health.expected_publication_date,'2026-10-19');assert.equal(health.missing_publication,true);
});
test('published today clears publication alarm',async()=>{
  const {health}=await check('2026-10-19T04:00:00Z',{jobs:{'2026-10-19':{state:'published'}}});assert.equal(health.status,'healthy');
});
test('missing and malformed reviewer timestamps are stale, never a crash',async()=>{
  const {health}=await check('2026-10-19T04:00:00Z',{roles:[{reviewer:'A',last_submission:null},{reviewer:'B',last_submission:'invalid'}]});assert.deepEqual(health.stale_reviewers,['A','B']);
});
test('recent successful empty polls keep reviewers alive without fresh submissions',async()=>{
 const {health}=await check('2026-10-19T04:00:00Z',{roles:['A','B'].map(reviewer=>({reviewer,last_submission:'2026-10-10 00:00:00'})),polls:['A','B'].map(reviewer=>({reviewer,candidate_count:0,returned_count:0,checked_at:'2026-10-19 03:00:00'})),jobs:{'2026-10-19':{state:'published'}}});
 assert.deepEqual(health.stale_reviewers,[]);assert.equal(health.status,'healthy');assert.match(health.poll_observation,/not proof/);
});
test('recent cached backlog avoids repeated scan and retains observation time',async()=>{
  const observed='2026-10-19T03:40:00Z';const previous={health_json:JSON.stringify({backlog:{status:'critical'},backlog_checked_at:observed})};
  const {health,backlogReads}=await check('2026-10-19T04:00:00Z',{previous,jobs:{'2026-10-19':{state:'published'}}});
  assert.equal(backlogReads,0);assert.equal(health.backlog_checked_at,observed);assert.equal(health.status,'degraded');
});
test('thirty minute cache expiry recomputes backlog',async()=>{
  const previous={health_json:JSON.stringify({backlog:{status:'healthy'},backlog_checked_at:'2026-10-19T03:30:00Z'})};
  const {backlogReads,health}=await check('2026-10-19T04:00:00Z',{previous});assert.equal(backlogReads,1);assert.equal(health.backlog_checked_at,'2026-10-19T04:00:00.000Z');
});
test('invalid or future cached observations force a fresh read',async()=>{
  for(const previous of [{health_json:'broken'},{health_json:JSON.stringify({backlog:{status:'healthy'},backlog_checked_at:'2026-10-20T00:00:00Z'})}])assert.equal((await check('2026-10-19T04:00:00Z',{previous})).backlogReads,1);
});
