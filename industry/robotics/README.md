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

The first implementation is additive so upstream AIHOT can still be synchronized cleanly. After evaluation, these configs will be merged into the active industry/*.ts and prompts.
