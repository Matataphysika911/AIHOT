import { validateSnapshot } from './core.mjs';

// Read adapter only. No state transition, evidence materialization, submission, or publisher.
export const COMPLETED_SQL = `SELECT a.id,a.source_id,a.canonical_url,a.title,a.summary,a.author,
 a.published_at,a.discovered_at,a.is_backfill,a.publish_eligible,a.processing_status,
 a.selection_status,a.final_score,a.structure_json,s.name AS source_name,s.tier AS source_tier,
 s.kind AS source_kind,s.first_party AS source_first_party,e.snapshot_json AS evidence_json,e.evidence_snapshot_hash AS evidence_hash,
 b.prompt_version,b.input_snapshot_hash,b.id AS b_submission_id,ra.id AS a_submission_id,
 ba.applied_at AS completed_at
 FROM articles a JOIN sources s ON s.id=a.source_id
 JOIN article_evidence e ON e.article_id=a.id
 JOIN review_submissions b ON b.article_id=a.id AND b.reviewer='B'
 JOIN review_submission_applications ba ON ba.submission_id=b.id AND ba.validation_status='applied'
 JOIN review_submissions ra ON ra.article_id=a.id AND ra.reviewer='A' AND ra.prompt_version=b.prompt_version
 AND ra.input_snapshot_hash=b.input_snapshot_hash
 JOIN review_submission_applications aa ON aa.submission_id=ra.id AND aa.validation_status='applied'
 WHERE a.processing_status='completed' AND a.selection_status IN ('selected','near-selected','not-selected')
 AND a.publish_eligible=1 AND a.is_backfill=0 AND a.structure_json IS NOT NULL
 AND julianday(a.published_at)>=julianday(?) AND julianday(a.published_at)<julianday(?)
 AND julianday(ba.applied_at)<=julianday(?)
 ORDER BY a.published_at,a.id LIMIT ?`;

export async function readCompleted(db,{start,end,asOf,limit=200}) {
  if (![start,end,asOf].every(t=>Number.isFinite(Date.parse(t))) || Date.parse(start)>=Date.parse(end) || !Number.isInteger(limit) || limit<1 || limit>500) throw new Error('Invalid bounded export range');
  const result=await db.prepare(COMPLETED_SQL).bind(start,end,asOf,limit+1).all();
  if (result.success===false) throw new Error('D1 read failed');
  if(result.results.length>limit) throw new Error('Export exceeds cap; narrow time range rather than silently drop rows');
  const snapshot={schema_version:'phase3-input.v1',snapshot_at:asOf,mode:'bounded-d1-completed-read',articles:result.results.map(row=>{
    const {structure_json,evidence_json,evidence_hash,a_submission_id,b_submission_id,...a}=row;
    return {...a,completed_at:/Z$|[+-]\d\d:\d\d$/.test(a.completed_at)?a.completed_at:a.completed_at.replace(' ','T')+'Z',
      structure:JSON.parse(structure_json),evidence:{...JSON.parse(evidence_json),evidence_snapshot_hash:evidence_hash},submission_ids:[a_submission_id,b_submission_id],
      provenance:{acceptance:'live D1 applied A/B receipts',evidence_file:'article_evidence.snapshot_json'}};
  })};
  return validateSnapshot(snapshot);
}
