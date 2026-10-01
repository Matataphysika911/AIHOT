# Robotics Intelligence scoring V1

Each candidate is scored 0–100 on six dimensions.

| Dimension | Weight |
|---|---:|
| Industry impact | 25% |
| Robotics relevance | 20% |
| Edge-AI-SoC relevance | 20% |
| Commercial signal | 15% |
| Technical novelty | 10% |
| Source credibility | 10% |

## Interpretation

- 90–100: Must Read — strategic or immediate technical/commercial implication.
- 75–89: Important — meaningful industry signal, product movement or workload change.
- 60–74: Watch — relevant, but implication is still forming.
- 40–59: Background — useful context, not a priority.
- <40: Noise — weak relevance, repetition or low-information content.

## Additional analysis fields

For selected items generate:
- what_happened
- why_it_matters
- robotics_signal
- soc_implication
- commercial_signal
- companies_affected
- what_to_watch

## SoC implication rubric

Explicitly examine:
- compute/TOPS and precision
- CPU/GPU/NPU heterogeneous workload
- memory capacity and bandwidth
- camera/sensor/ISP pipeline
- transformer/VLA operator requirements
- latency, power and thermal envelope
- compiler/runtime/toolchain requirements
- on-device vs cloud split

Never infer unpublished silicon specifications. Separate source facts from analysis.
