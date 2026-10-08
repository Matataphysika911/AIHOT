---
title: "VLA, SLAM and navigation on one SoC: the questions are just beginning"
lang: en
translationKey: ambarella-physical-ai-workload-integration
sourceLanguage: en
source_sha256: 6aeb3f25dab00d6582e07bade4a99300b0cd0d28563e0a08b988281116da24d7
draft: true
publish: false
---

# VLA, SLAM and navigation on one SoC: the questions are just beginning

Ambarella has put SmolVLA, SLAM and navigation on the N1-655. The more useful question now is whether these tasks can keep working together, reliably and over time.

Putting SmolVLA on a chip is enough to draw attention to a robotics story. What interests me more here is the company it keeps: SLAM, navigation and pick-and-place.

In its own AI Infrastructure Summit article, Ambarella says the N1-655 powered an autonomous mobile manipulator running SmolVLA, SLAM, navigation and pick-and-place on a single chip. What this confirms is a vendor-described demonstration; the real system’s operating headroom remains undisclosed.

Several tasks working on one chip move the question a step beyond whether a model can run. A moving robot still needs to sense its surroundings, update its position and prepare its next action. Those tasks do not take turns clocking out.

## What changes when workloads run together

That brings me to a fairly ordinary engineering question. Sensors keep sending data while the model produces an action, and navigation does not wait for it to finish. Workloads running together may compete for memory, bandwidth and scheduling time. What needs measuring is whether end-to-end latency remains predictable after those interactions. The available evidence does not answer that.

This is why one compute figure tells us so little about the question this demo raises.

Single-chip changes the integration boundary. Less movement between devices could simplify the system; resource contention could also become concentrated inside the chip. How the CPU, GPU and NPU divide the work, and how the runtime assigns priorities, depends on the implementation. I would be cautious here: the demo’s resource allocation is still unknown. One chip does not reveal the architecture, or establish that coordination has been solved.

The same article describes a Unitree humanoid demonstration with an on-device vision-to-action loop, and a warehouse demo combining Dify, Liquid AI models, live video and RAG on the N1-655. They all come from one vendor source. They are not three independent validations.

## Customers do not buy a demonstration

Ambarella also describes the X7 as its first standalone AI accelerator, saying it can add AI processing alongside an existing host computer without necessarily replacing installed equipment. The article mentions collaborations and tooling involving Ultralytics, Developer Zone and ZEDEDA.

Read together, the N1-655 and X7 descriptions suggest two integration approaches that still need validation: a new system brings workloads into the SoC, while an installed system adds an accelerator alongside its host. The latter may preserve the existing control chain, while leaving new coordination problems between host and accelerator. Lower migration costs, easier model updates and maintenance, and a worthwhile BOM all require engineering and customer validation.

The article’s figure of more than 50 million refers to Ambarella’s own claim about its overall installed base of AI processors or AI SoCs across different edge applications. It is not a shipment figure for the N1-655, the X7 or robotics products.

For now, I would keep this on the platform-capability watchlist. It deserves attention because it brings the discussion to how several workloads operate together. I would not yet call it a repeatable commercial solution. Sustained operation and a customer choosing to put it into a product are still some distance apart. Does it actually ship? Here, that remains a question.

The next material I would like to see is end-to-end latency under the same configuration, power and thermal behavior over sustained operation, memory/bandwidth use, and support for model migration. Independent reproduction or a customer application would make the discussion much firmer. Until that evidence arrives, I would not use this demo to rank NVIDIA, Qualcomm or other SoCs.

<details>
<summary>Sources, unknowns and editorial context</summary>

Exploratory draft. Personal judgments await author review.

- ASP/pricing for N1-655 or X7: not disclosed.
- Exact latency/FPS and model sizes for SmolVLA, vision-to-action, RAG and video-search demonstrations: not disclosed.
- Memory capacity and bandwidth for the demonstrated N1-655/X7 configurations: not disclosed.
- N1-655 and X7 exact SoC/accelerator TOPS, precision throughput and utilization: not disclosed.
- N1-655 and X7 power/TDP and thermal envelope: not disclosed.

- F1: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- F2: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- I1: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- I2: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- F3: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- I3: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- F4: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- J1: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)
- J2: [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · [Source](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara)

</details>
