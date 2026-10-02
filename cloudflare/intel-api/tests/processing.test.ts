import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { saveProduction, PROMPT_VERSION } from '../src/processing.ts';
function setup() {
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_initial','0002_phase_1_1','0005_intelligence','0007_phase2b_mcp'])sql.exec(readFileSync(`../ingest/migrations/${name}.sql`,'utf8'));
 sql.exec("INSERT INTO sources(id,name,kind,config_json,tier) VALUES('src','Source','rss','{}','T1_5'); INSERT INTO articles(id,source_id,canonical_url,url_hash,title,summary,discovered_at,raw_r2_key) VALUES('a','src','https://example.com/a','hash','Robot','Source facts','2026-10-02','raw/object')");
 const db={prepare(query:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;}, async first(){return sql.prepare(query).get(...values)??null;}, async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:r.changes}};}, execute(){return sql.prepare(query).run(...values);}};},async batch(stmts:any[]){sql.exec('BEGIN');try{const r=stmts.map(s=>s.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db:db as any};
}
const base={article_id:'a',run_id:'phase2b-test-a',prompt_version:PROMPT_VERSION};
const pre={...base,status:'PASS',reason:'Robot research'};
const dims={industry_impact:65,robotics_relevance:90,soc_relevance:50,commercial_signal:30,technical_novelty:80,source_credibility:85}; // 65.25
const score={...base,slot:'A',dimension_scores:dims,total:65.25,reason:'Source evidence'};
const structure={...base,category:'paper',tags:['论文/研究'],companies:[],fact_frame:{subject:'Researchers',action:'demonstrated',object:'robot capability',evidence:'Source facts'},robotics_relevance:'Robot perception',soc_relevance:'未披露',commercial_signal:'未披露'};
test('real SQLite transactions persist full flow, audit and immutable facts; all repeats are idempotent',async()=>{
 const {sql,db}=setup();const before=sql.prepare('SELECT snapshot FROM mcp_article_facts').get();
 for(const [tool,args] of [['save_prefilter',pre],['save_score',score],['save_score',{...score,slot:'B'}],['save_structure',structure],['finalize_processing',{article_id:'a',run_id:base.run_id}]] as const){assert.equal((await saveProduction(db,tool,args,'chatgpt')).inserted,true);assert.equal((await saveProduction(db,tool,args,'chatgpt')).inserted,false);}
 const row=sql.prepare('SELECT * FROM articles').get()!;assert.equal(row.processing_status,'completed');assert.equal(row.selection_status,'selected');assert.equal(row.final_score,65);assert.deepEqual(sql.prepare('SELECT snapshot FROM mcp_article_facts').get(),before);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_ai_runs').get()!.n,5);
 assert.equal((await saveProduction(db,'save_score',{...score,reason:'changed'},'chatgpt')).error,'receipt_conflict');
 assert.equal((await saveProduction(db,'save_prefilter',{...pre,run_id:'another'},'chatgpt')).saved,false);
});
test('wrong run/client, missing stages, tampered facts, invalid total and injected SQL fail closed',async()=>{
 const {sql,db}=setup();assert.equal((await saveProduction(db,'finalize_processing',{article_id:'a',run_id:base.run_id},'chatgpt')).saved,false);
 await saveProduction(db,'save_prefilter',pre,'chatgpt');
 assert.equal((await saveProduction(db,'save_score',score,'other')).error,'run_id_conflict');
 assert.equal((await saveProduction(db,'save_score',{...score,slot:'B'},'chatgpt')).saved,false);
 assert.equal((await saveProduction(db,'save_structure',structure,'chatgpt')).saved,false);
 assert.equal((await saveProduction(db,'save_score',{...score,total:99},'chatgpt')).error,'weighted_total_mismatch');
 await assert.rejects(()=>saveProduction(db,'save_prefilter',{...pre,sql:'DROP TABLE articles'},'chatgpt'));
 sql.exec("UPDATE articles SET raw_r2_key='changed' WHERE id='a'");assert.equal((await saveProduction(db,'save_score',score,'chatgpt')).saved,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,1);
});
test('BLOCK finalizes directly and cannot write scores; ineligible and each tier retain original thresholds',async()=>{
 const block=setup();await saveProduction(block.db,'save_prefilter',{...pre,status:'BLOCK'},'chatgpt');assert.equal((await saveProduction(block.db,'save_score',score,'chatgpt')).saved,false);await saveProduction(block.db,'finalize_processing',{article_id:'a',run_id:base.run_id},'chatgpt');assert.equal(block.sql.prepare('SELECT selection_status FROM articles').get()!.selection_status,'blocked');
 for(const [tier,eligible,expected] of [['T1',1,'selected'],['T1_5',1,'selected'],['T2',1,'near-selected'],['OTHER',1,'unrated'],['T1',0,'ineligible']] as const){const {sql,db}=setup();sql.prepare('UPDATE sources SET tier=?').run(tier);sql.prepare('UPDATE articles SET publish_eligible=?').run(eligible);for(const [tool,args] of [['save_prefilter',pre],['save_score',score],['save_score',{...score,slot:'B'}],['save_structure',structure],['finalize_processing',{article_id:'a',run_id:base.run_id}]] as const)assert.equal((await saveProduction(db,tool,args,'chatgpt')).saved,true);assert.equal(sql.prepare('SELECT selection_status FROM articles').get()!.selection_status,expected);}
});
test('concurrent matching writes converge and competing run claims have only one winner',async()=>{
 const same=setup();const replies=await Promise.all([saveProduction(same.db,'save_prefilter',pre,'chatgpt'),saveProduction(same.db,'save_prefilter',pre,'chatgpt')]);assert.ok(replies.every(r=>r.saved));assert.equal(replies.filter(r=>r.inserted).length,1);assert.equal(same.sql.prepare('SELECT count(*) n FROM mcp_task_receipts').get()!.n,1);
 const race=setup();const outcomes=await Promise.all([saveProduction(race.db,'save_prefilter',pre,'chatgpt'),saveProduction(race.db,'save_prefilter',{...pre,run_id:'competing'},'chatgpt')]);assert.equal(outcomes.filter(r=>r.saved).length,1);assert.equal(race.sql.prepare('SELECT count(*) n FROM mcp_processing_runs').get()!.n,1);
});
