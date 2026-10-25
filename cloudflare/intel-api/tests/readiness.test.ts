import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {recentObservation,quietDailyReadiness} from '../src/readiness.ts';
import {dailyPublishRequest} from '../src/daily.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const n of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp','0008_optional_agnes_review','0009_agnes_connectivity_probe','0010_agnes_scoring_probe','0011_phase2b1_reviewers','0012_phase2b2_submissions','0013_phase2_finalization','0014_phase2_evidence','0015_daily_production','0016_watchdog_query_indexes','0017_pending_review_queue','0018_daily_operational_readiness'])sql.exec(readFileSync(new URL(`../../ingest/migrations/${n}.sql`,import.meta.url),'utf8'));
 const db:any={prepare(q:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return sql.prepare(q).get(...values)??null;},async all(){return {success:true,results:sql.prepare(q).all(...values)};},async run(){return {meta:sql.prepare(q).run(...values)};}};}};
 return {sql,db};
}
const now='2026-10-25T01:00:00Z';
function quiet(sql:DatabaseSync){
 sql.exec("INSERT INTO sources(id,name,kind,config_json,last_fetch_at,next_fetch_at) VALUES('s','s','rss','{}','2026-10-25T00:30:00Z','2026-10-25T02:30:00Z');INSERT INTO reviewer_poll_health VALUES('A',0,0,'2026-10-25 00:30:00'),('B',0,0,'2026-10-25 00:30:00')");
}
test('recent observations reject missing, invalid, future and old dates at a deterministic boundary',()=>{
 for(const s of [undefined,'invalid','2026-10-25T02:00:00Z','2026-10-24 20:59:59'])assert.equal(recentObservation(s,Date.parse(now)),false);
 assert.equal(recentObservation('2026-10-24 21:00:00',Date.parse(now)),true);
});
test('quiet readiness requires both global empty polls and initialized timely collection',async()=>{
 const {sql,db}=fixture();assert.equal(await quietDailyReadiness(db,now),false);quiet(sql);assert.equal(await quietDailyReadiness(db,now),true);
 sql.exec("UPDATE reviewer_poll_health SET candidate_count=1,returned_count=0 WHERE reviewer='A'");assert.equal(await quietDailyReadiness(db,now),false);
 sql.exec("UPDATE reviewer_poll_health SET candidate_count=0,checked_at='2026-10-24 20:00:00' WHERE reviewer='A'");assert.equal(await quietDailyReadiness(db,now),false);
 sql.exec("UPDATE reviewer_poll_health SET checked_at='2026-10-25 00:30:00';UPDATE sources SET next_fetch_at='2026-10-25T00:00:00Z'");assert.equal(await quietDailyReadiness(db,now),false);sql.close();
});
test('empty poll cannot bypass live A backlog and never changes the historical B application timestamp',async()=>{
 const {sql,db}=fixture();quiet(sql);
 sql.exec("INSERT INTO review_application_latest VALUES('B','2026-10-20 00:00:00');INSERT INTO articles(id,source_id,canonical_url,url_hash,title,discovered_at) VALUES('a','s','https://example.com/a','a','a','2026-10-25T00:30:00Z')");
 assert.equal(await quietDailyReadiness(db,now),false);
 assert.equal(sql.prepare("SELECT applied_at FROM review_application_latest WHERE reviewer='B'").get()!.applied_at,'2026-10-20 00:00:00');sql.close();
});
test('pending dates include oldest two ready dates and today without exposing content or future work',async()=>{
 const {sql,db}=fixture();const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 for(const [date,state] of [['2020-01-01','published'],['2020-01-02','ready'],['2020-01-03','ready'],['2020-01-04','ready'],['2020-01-05','pending'],['2099-01-01','ready'],[today,'ready']])sql.prepare('INSERT INTO phase3_daily_jobs(date,snapshot_sha256,snapshot_json,state,copy_sha256) VALUES(?,?,?,?,?)').run(date,'a'.repeat(64),'{}',state,'b'.repeat(64));
 const r=await dailyPublishRequest(new Request('https://local/production/daily?pending=1'),db),data:any=await r.json();
 assert.deepEqual(data,{dates:['2020-01-02','2020-01-03',today],limit:3});
 const plan=sql.prepare("EXPLAIN QUERY PLAN SELECT date FROM phase3_daily_jobs WHERE state='ready' AND copy_sha256 IS NOT NULL AND date<? ORDER BY date LIMIT 2").all(today).map(r=>r.detail).join('\n');assert.match(plan,/idx_phase3_daily_jobs_state_date/);assert.doesNotMatch(plan,/TEMP B-TREE/);sql.close();
});
