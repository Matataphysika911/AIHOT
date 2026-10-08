---
version: 1.2-editorial-preview.20261005
scope: phase3-editorial-overlay
---
# Phase3 content specification

This version overlays presentation only. Recovered Writer Skill 1.1-recovered.20261001 remains byte-identical, SHA-256 98ec657ae89ab91070cc6f0f94e4b1f598eb9ce77f53a5f96e09cb2786fd0815. Facts, evidence, scoring, candidate gates and event identity remain unchanged. Outputs stay draft, publish=false; no production deployment.

## Daily
Quick industry brief, 2–5 minutes. 今天值得看: up to 3 priorities, roughly 50–120 Chinese characters each excluding technical identifiers. Explain what happened, why it matters, and a relevant unknown. 另外值得知道: normally 5–8 short items from remaining distinct evidence; omit when insufficient, never pad or duplicate. Optional 我还在看: 2–4 research questions, fewer for thin coverage. Rank by importance, no category quotas. writer_skill=null. Scores/hotness/event/fact IDs appear only in metadata or collapsed Source / Methodology.

## Weekly
A seven-day editorial synthesis answering what changed while the reader was away. Start with a natural editor note, connect 3–5 evidence-backed themes with change-oriented headings; fewer if evidence is thin. Never concatenate Daily or force Robotics/SoC/Commercial categories. End optionally with 下周我会继续看. Mark partial corpus and insufficient baseline explicitly; neither sample concentration nor related questions prove an industry trend. writer_skill=null, no personal writer voice required.

## Insights
70% Editorial Essay + 30% Personal Column. Framework stays invisible. Internal event → constraint → mechanism → silicon → reality/commercialization → judgment remains mandatory reasoning, never mandatory visible outline. Ordinary articles use 0–3 descriptive H2; prefer 2. No default 从 SoC 这一侧看 / 回到真实场景 / 我的判断 / 接下来，我会盯什么 headings. Narrative transitions, uneven paragraph lengths, occasional reflective short sentences; no forced paragraph conclusions, symmetry, or report cadence. First person owns uncertainty and judgment without influencer rhetoric. Technical English stays natural. Facts immutable, analysis derived, opinion explicit: vendor attribution and first-person/inferential wording remain in prose; per-claim labels, mappings and full unknowns move to collapsed end matter. New numeric/specification claims require evidence. Proposed judgments stay user_approved=false.

## Headline selection
Curiosity + tension + specificity + technical relevance + evidence fidelity, each scored 0–5 by the session editor. Preserve 3–5 candidates, claim IDs, scores, rationale and selection receipt in title_candidates metadata. Reject evidence fidelity below 5 or an ungrounded causal/competitive conclusion. Reject clickbait, absolute victory/failure and undisclosed measurements. Choose highest total; break ties by specificity, then original order. Scores are editorial review data, not automatic semantic proof. Prefer contrast, a question, an unresolved variable, or a concrete engineering tension. Title must match this article, not general industry extrapolation. Examples are possibilities, not fixed title templates.

## Reproducibility and preview
Version and SHA-256 of this file bind report metadata, writer packet, draft and manifest. Curated summaries/themes bind exact evidence hashes; stale evidence falls back to source-grounded metadata, never old prose. Separate claim storage from reading paragraphs; every visible paragraph maps claim IDs. Tests reject unsupported references, stale overlay, >3 headings, rejected headline winners and hidden-data leakage. Rebuild generated JSON/Markdown, verify provenance, immutable Phase2 files and skill hash, and drift. Preserve historical acceptance; add a new round-two record instead of rewriting old claims of preservation. Preview consumes generated content only, nav Daily / Weekly / Insights / AI SoC / Others; noindex and branch-only enabling. Chinese draft text on English UI stays labeled translation-pending; it is not a reviewed English publication.
