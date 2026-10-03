import test from 'node:test';
import assert from 'node:assert/strict';
import {expiredRaw,inventory,maintainStorage,storageLevel,storagePolicy,providerMetrics} from '../src/storage.ts';
const now=Date.parse('2026-10-01T12:00:00Z');
const cutoff=now-60*86400000;
const object=(key:string, uploaded='2026-06-01T00:00:00Z',size=10)=>({key,uploaded:new Date(uploaded),size,etag:key});
test('retention protects reserved prefixes, new uploads, new dates and invalid dates',()=>{
 assert.equal(expiredRaw(object('raw/2026/06/01/source/a'),cutoff),true);
 for(const key of ['reports/2026/06/01/a','backup-staging/a','raw/2026/02/31/a','raw/2026/09/01/a','rawish/2026/06/01/a']) assert.equal(expiredRaw(object(key),cutoff),false);
 assert.equal(expiredRaw(object('raw/2026/06/01/a','2026-09-30T00:00:00Z'),cutoff),false);
});
test('thresholds and policy validation fail safely',()=>{
 const p=storagePolicy({} as any);
 assert.equal(storageLevel(69,true,p),'ok');assert.equal(storageLevel(70,true,p),'warning');assert.equal(storageLevel(85,true,p),'critical');assert.equal(storageLevel(0,false,p),'unknown');
 for(const value of ['0','-60','nope']) assert.throws(()=>storagePolicy({RAW_RETENTION_DAYS:value} as any));
 assert.throws(()=>storagePolicy({R2_DELETE_MAX_OBJECTS:'10000'} as any));
});
function fixture(rows:any[], incomplete=false, failDelete=false){
 const events:any[]=[];
 const objects=new Map(rows.map(o=>[o.key,o]));
 const env:any={RAW_RETENTION_DAYS:'60',R2_SCAN_MAX_PAGES:'2',DB:{prepare(sql:string){let values:any[]=[];return {bind(...args:any[]){values=args;return this},async run(){events.push({sql,values});return {meta:{changes:1}}}}}},RAW_ARCHIVE:{
 async list(){return {objects:[...objects.values()],truncated:incomplete,cursor:'next'}},
 async head(key:string){return objects.get(key)??null},
 async delete(key:string){if(failDelete)throw new Error('test delete failed');objects.delete(key)}
 }};
 return {env,objects,events};
}
test('paged inventory sums all prefixes; incomplete scan reports a lower bound',async()=>{
 const {env}=fixture([object('reports/a'),object('raw/2026/06/01/a')],true);
 const scan=await inventory(env,now);assert.equal(scan.complete,false);assert.equal(scan.bytes,40);
});
test('maintenance deletes only expired raw and records before/after/deleted counts',async()=>{
 const {env,objects,events}=fixture([object('raw/2026/01/01/a'),object('reports/a'),object('backup-staging/a'),object('raw/2026/09/30/a','2026-09-30T00:00:00Z')]);
 const result:any=await maintainStorage(env);assert.equal(result.deleted,1);assert.equal(result.before.objects,4);assert.equal(result.after.objects,3);assert.equal(objects.has('reports/a'),true);assert.equal(objects.has('backup-staging/a'),true);
 assert.equal(events.some(e=>e.sql.includes('after_bytes')),true);assert.equal(events.at(-1).sql.includes('DELETE FROM maintenance_locks'),true);
});
test('dry run and incomplete inventory cannot delete',async()=>{
 for(const [dry,incomplete] of [[true,false],[false,true]]){
 const {env,objects}=fixture([object('raw/2026/01/01/a')],incomplete);const result:any=await maintainStorage(env,dry);assert.equal(result.deleted,0);assert.equal(objects.size,1);
 }
});
test('failed deletion is recorded and lock is released',async()=>{
 const {env,events}=fixture([object('raw/2026/01/01/a')],false,true);
 await assert.rejects(maintainStorage(env),/test delete failed/);assert.equal(events.some(e=>e.sql.includes("status='failed'")),true);assert.equal(events.at(-1).sql.includes('DELETE FROM maintenance_locks'),true);
});
test('provider permission errors are explicit, never reported as zero usage',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({errors:[{message:'denied'}]}),{status:403});
 try{const result:any=await providerMetrics({CF_ACCOUNT_ID:'account',CF_ANALYTICS_TOKEN:'test'} as any,now);assert.equal(result.available,false);assert.match(result.reason,/denied/);assert.equal(result.billingGbMonth,null);}finally{globalThis.fetch=original;}
});
test('empty analytics samples distinguish a successful query from inaccessible account',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [accounts,expected] of [[[{r2StorageAdaptiveGroups:[]}],true],[[],false]] as const){
   globalThis.fetch=async()=>Response.json({data:{viewer:{accounts}}});
   const result:any=await providerMetrics({CF_ACCOUNT_ID:'account',CF_ANALYTICS_TOKEN:'test'} as any,now);
   assert.equal(result.available,false);assert.equal(result.configured,true);assert.equal(result.querySucceeded,expected);
   if(expected)assert.equal(result.reason,'analytics_no_samples');
  }
 }finally{globalThis.fetch=original;}
});
test('provider groups newest observed bucket samples and includes metadata separately from billing',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:{viewer:{accounts:[{r2StorageAdaptiveGroups:[
  {dimensions:{bucketName:'raw',datetime:'2026-10-01T11:00:00Z'},max:{payloadSize:100,metadataSize:10}},
  {dimensions:{bucketName:'other',datetime:'2026-10-01T10:00:00Z'},max:{payloadSize:200,metadataSize:20}},
  {dimensions:{bucketName:'raw',datetime:'2026-10-01T09:00:00Z'},max:{payloadSize:90,metadataSize:9}},
 ]}]}}});
 try{const result:any=await providerMetrics({CF_ACCOUNT_ID:'account',CF_ANALYTICS_TOKEN:'test'} as any,now);assert.equal(result.available,true);assert.equal(result.bytes,330);assert.equal(result.buckets.length,2);assert.equal(result.billingGbMonth,null);}finally{globalThis.fetch=original;}
});
