# uPrivate Robotics Intelligence — V1

Industry intelligence layer for embodied AI, robotics and edge AI SoC.

## Scope

- Embodied intelligence: humanoid, wheeled mobile manipulation, quadruped, dexterous manipulation, VLA/world models.
- Consumer/service robotics: vacuum, lawn, pool, companion, sports and inspection robots.
- Robot AI stack: perception, SLAM, navigation, manipulation, motion control, simulation and data engines.
- Edge AI SoC: NPU/GPU/CPU/MCU, ISP/sensor pipeline, memory/bandwidth, toolchain, quantization and deployment.
- Commercial signals: product launch, design win, production, funding, partnership, pricing, supply chain and regulation.

## V1 pipeline

Source ingestion → prefilter → dual scoring → event clustering → hotness → robotics relevance → SoC/commercial implications → daily digest.

The active industry pack now uses the V1 identity, additive categories, robotics vocabulary, prefilter and selection rubric, and 19 crawlable sources. See [source matrix and rollout notes](source-matrix.md) for verification, limitations and migration behavior. The dedicated SoC analysis and custom digest designs remain reference documents; the runtime still uses the upstream pipeline and output schemas.
