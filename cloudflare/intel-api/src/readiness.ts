import {processingBacklog} from './health.ts';
type Poll={reviewer:string;candidate_count:number;returned_count:number;checked_at:string};
export function recentObservation(value:string|undefined,now:number){
 if(!value)return false;
 const at=Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z');
 return Number.isFinite(at)&&at<=now&&now-at<=4*3600000;
}
export async function quietDailyReadiness(db:D1Database,now:string){
 const polls=await db.prepare("SELECT reviewer,candidate_count,returned_count,checked_at FROM reviewer_poll_health WHERE reviewer IN ('A','B')").all<Poll>();
 const epoch=Date.parse(now);
 if(!['A','B'].every(role=>{const p=polls.results.find(p=>p.reviewer===role);return p&&p.candidate_count===0&&p.returned_count===0&&recentObservation(p.checked_at,epoch);}))return false;
 // Never trust the watchdog's cached queue counts for a freeze decision.
 const backlog=await processingBacklog(db);
 if(backlog.reviewer_a_pending_count||backlog.reviewer_b_pending_count||backlog.pending_apply_count)return false;
 // A quiet reviewer queue is insufficient when collection is uninitialized/overdue.
 const collection=await db.prepare("SELECT count(*) n,sum(CASE WHEN last_fetch_at IS NULL OR next_fetch_at IS NULL OR julianday(next_fetch_at) IS NULL OR julianday(next_fetch_at)<julianday(?)-20.0/1440 THEN 1 ELSE 0 END) overdue FROM sources WHERE enabled=1 AND kind IN ('rss','json_list','web_list')").bind(now).first<{n:number;overdue:number}>();
 return !!collection&&collection.n>0&&collection.overdue===0;
}
