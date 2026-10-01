# Robotics V1 source matrix

Verified on 2026-10-01: the endpoints returned public payloads; those captured responses were then passed through AIHOT's actual RSS / JSON / HTML parsers using a local fixture server. Counts below are snapshot results, not availability guarantees or model evaluations. No paid providers or collection workers were enabled. Every configured source produced nonempty titles, HTTPS article URLs and publication dates.

## Active seed (19 sources)

All sources are editorial, with initialBackfillLimit=8 and both full-text grants false. Broad company feeds remain subject to the robotics prefilter. arXiv cs.RO is T1_5 rather than a verified company announcement; hosted community posts on ROS Discourse are T2, not first-party Open Robotics statements. GitHub APIs work anonymously with public rate limits; an optional GITHUB_TOKEN is already supported upstream. Release APIs exclude prereleases; Atom feeds can include early-access releases, whose stage must be preserved in summaries.

| Source ID | Endpoint | Kind / tier | Parsed / dated |
|---|---|---|---|
| `robotics-nvidia-robotics` | [NVIDIA Robotics Technical Blog](https://developer.nvidia.com/blog/category/robotics/feed/) | rss / T1 | 100 / 100 |
| `robotics-nvidia-jetson` | [NVIDIA Jetson Technical Blog](https://developer.nvidia.com/blog/tag/jetson/feed/) | rss / T1 | 100 / 100 |
| `robotics-nvidia-news` | [NVIDIA Robotics Newsroom](https://nvidianews.nvidia.com/cats/robotics.xml) | rss / T1 | 19 / 19 |
| `robotics-arm` | [Arm Newsroom](https://newsroom.arm.com/feed) | rss / T1 | 6 / 6 |
| `robotics-ambarella` | [Ambarella Blog](https://www.ambarella.com/feed/) | rss / T1 | 10 / 10 |
| `robotics-deepmind` | [Google DeepMind](https://deepmind.google/blog/rss.xml) | rss / T1 | 100 / 100 |
| `robotics-arxiv-robotics` | [arXiv cs.RO](https://rss.arxiv.org/rss/cs.RO) | rss / T1_5 | 203 / 203 |
| `robotics-robot-report` | [The Robot Report](https://www.therobotreport.com/feed/) | rss / T2 | 15 / 15 |
| `robotics-ros` | [Open Robotics Discourse](https://discourse.openrobotics.org/latest.rss) | rss / T2 | 30 / 30 |
| `robotics-semieng` | [Semiconductor Engineering](https://semiengineering.com/feed/) | rss / T2 | 10 / 10 |
| `robotics-lerobot` | [Hugging Face LeRobot Releases](https://api.github.com/repos/huggingface/lerobot/releases?per_page=5) | json_list / T1 | 5 / 5 |
| `robotics-unitree-sdk` | [Unitree SDK2 Releases](https://api.github.com/repos/unitreerobotics/unitree_sdk2/releases?per_page=5) | json_list / T1 | 4 / 4 |
| `robotics-d-robotics` | [D-Robotics hobot_dnn Releases](https://api.github.com/repos/D-Robotics/hobot_dnn/releases?per_page=5) | json_list / T1 | 5 / 5 |
| `robotics-rockchip` | [Rockchip RKNN Toolkit2 Releases](https://api.github.com/repos/airockchip/rknn-toolkit2/releases?per_page=5) | json_list / T1 | 9 / 9 |
| `robotics-axera-api` | [AXERA ax-samples Releases](https://api.github.com/repos/AXERA-TECH/ax-samples/releases?per_page=5) | json_list / T1 | 8 / 8 |
| `robotics-figure` | [Figure AI News](https://www.figure.ai/news) | web_list / T1 | 21 / 21 |
| `robotics-unitree` | [Unitree News](https://www.unitree.com/news/) | web_list / T1 | 11 / 11 |
| `robotics-qualcomm-aihub` | [Qualcomm AI Hub Models Releases](https://github.com/qualcomm/ai-hub-models/releases.atom) | rss / T1 | 10 / 10 |
| `robotics-isaaclab` | [NVIDIA Isaac Lab Releases](https://github.com/isaac-sim/IsaacLab/releases.atom) | rss / T1 | 10 / 10 |

## Deferred candidates

- Physical Intelligence: https://www.pi.website/blog is the official listing, but direct fetch returned 429. Do not enable an unverified scraper or paid Jina fallback automatically.
- 1X: https://www.1x.tech/discover returned 11 valid article links, but no listing dates. A sampled detail page has a human-readable date but no standard JSON-LD/time metadata. Add a tested detail date selector before enabling.
- Boston Dynamics: https://bostondynamics.com/feed/ returned an empty feed. The guessed /blog/feed/ returned 404.
- Apptronik: guessed /news returned 404; find the actual listing before configuring.
- Qualcomm corporate news: the guessed investor RSS returned 404; a press-release listing is reachable, but its parser was not validated. Qualcomm AI Hub Models releases provide the verified engineering source for now.
- Ambarella investor RSS returned 403; the official blog feed is active instead.
- Horizon Robotics, Tesla, Agility, Skild AI and Chinese news/media remain watchlist entries. D-Robotics is represented separately from Horizon Robotics; do not conflate their announcements.

## Rollout and compatibility

1. Review this draft PR before deployment. The original six category keys, item types, five-axis weights, scoring JSON output and source-tier thresholds are unchanged. V1 categories are additive; topic slugs and existing entity IDs remain valid. Changes are confined to the industry pack, a contract test and a seed-count check in CI. LICENSE and NOTICE are retained.
2. Fresh deployments seed this robotics set. Existing deployments must rerun `node --env-file=.env scripts/seed.ts` to add new IDs and update topics. Existing sources and administrator edits are never overwritten. Review/pause unwanted generic sources in the admin UI; the seed does not delete or disable them. Old classifications/content are not automatically rewritten.
3. The site now identifies as uPrivate Robotics Intelligence, with crawler uPrivateRoboticsBot and MCP prefix uprivate_robotics. Existing clients using myhot_* tool names must reconnect. SITE_URL still comes from deployment settings; no domain is assumed.
4. Robotics Relevance, Edge AI SoC Relevance, Commercial Signal, Technology Signal and SoC implications are expressed in the active prefilter, five-axis score rubric, vocabulary and writing rules. The analysis.v1.md and daily-digest.v1.md designs remain reference documents: no extra analysis job, schema or SoC Radar endpoint is claimed.
5. Thresholds remain T1=60, T1_5=65, T2=76 pending a human-labelled robotics gold set and SelectBench evaluation. No live model evaluation, production collection, deployment, schedule change or notification integration was performed. Terms/privacy remain templates; final icon/brand assets and legal copy need review before launch.
6. Upstream synchronization: retain the fork origin and use `git remote add upstream https://github.com/KKKKhazix/AIHOT.git` if absent. Review incoming industry-pack changes rather than replacing this configuration wholesale.

## Validation

- `npm run typecheck`: passed.
- Web production build and all 31 web tests: passed.
- Robotics industry contract tests (3) and architecture tests (5): passed. Contracts check collector config support, full-text restrictions, entity references, public category identities, prompt whitelist consistency and ambiguous company-name guards.
- Captured-response parser check: all 19 configured sources returned valid dated candidates.
- Local full backend database suite and running-site smoke/MCP checks are unverified: PostgreSQL and Docker are unavailable here. The existing GitHub workflow performs them with a disposable *_ci database and collection/model calls off.
