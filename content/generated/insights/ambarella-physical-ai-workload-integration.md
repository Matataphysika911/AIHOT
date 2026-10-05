---
title: "当 VLA、SLAM 和 navigation 挤进一颗 SoC，问题才刚开始"
slug: ambarella-physical-ai-workload-integration
lang: zh-CN
draft: true
publish: false
editorial_version: 1.2-editorial-preview.20261005
editorial_sha256: e697ffd95c3a923161fb81f1a6bc5b9b7ce848e9dffa8d968d7d3eb741798782
---

# 当 VLA、SLAM 和 navigation 挤进一颗 SoC，问题才刚开始

Ambarella 把 SmolVLA、SLAM 和 navigation 放到了 N1-655 上。接下来更值得追问的，是这些任务能否持续、稳定地一起工作。

把 SmolVLA 放到芯片上，已经足够让一条机器人新闻被看见。但这次更吸引我的，是它身边还坐着 SLAM、navigation 和 pick-and-place。

Ambarella 在自己的 AI Infrastructure Summit 文章中称，N1-655 驱动了一台 autonomous mobile manipulator，把 SmolVLA、SLAM、navigation 和 pick-and-place 放到同一颗芯片上运行。这里能确认的是厂商描述的一次展示，真实系统的余量仍未披露。

几个任务在同一颗芯片上工作，问题也就从“这个模型能不能跑”往前走了一步。机器人移动时还要感知环境、更新位置、准备下一次动作，它们不会轮流下班。

## 一起跑，比单独跑多了什么

这让我更在意一个很普通的工程问题：模型在输出 action 的时候，传感器不会停止送数据，导航也不会等它忙完。几种 workload 一起运行，可能争抢 Memory、Bandwidth 和调度时间。真正需要测量的，是这些任务互相影响之后，端到端 Latency 还能不能保持可预测。当前公开 evidence 没有给出答案。

这也是为什么，单看一个算力数字，很难回答这次展示提出的问题。

single-chip 改变的是集成边界。少了跨设备的数据搬运，可能让系统更简洁；资源竞争也可能因此集中到芯片内部。CPU、GPU、NPU 怎样分工，runtime 如何安排优先级，都要看实现。这里我会稍微保守一点：我们还不知道这次展示的具体资源分配，不能由“一颗芯片”反推出芯片架构，更不能认定它已经解决了协同问题。

同一篇文章还介绍了 Unitree humanoid 的 on-device vision-to-action 展示，以及 N1-655 上结合 Dify、Liquid AI models、live video 和 RAG 的 warehouse demo。这些都来自同一家厂商，不能算成三份独立验证。

## 客户不会只买一场演示

Ambarella 同时介绍了 X7，称其是公司的第一款 standalone AI accelerator，可以在既有 host computer 旁边增加 AI processing，而不一定替换原有设备；文章也提到 Ultralytics、Developer Zone 和 ZEDEDA 的合作与工具扩展。

把 N1-655 和 X7 的描述放在一起，能看出两种待验证的集成思路：新系统把 workload 收进 SoC，存量系统则在 host 旁增加 accelerator。后者可能保留既有控制链，也会把新的协同问题留给 host 和 accelerator。客户是否少付了迁移成本，模型更新和维护是否容易，BOM 是否划算，都需要工程与客户验证。

文章中“超过 5,000 万”的数字，是 Ambarella 对已部署 AI processors／AI SoC 总体装机量的自述，覆盖多种端侧用途。这不是 N1-655、X7 或机器人产品的出货量。

我现在会把这条消息留在平台能力观察名单里。它值得关注的地方，是把讨论带到了几种 workload 如何共同工作；但我还不会判断它已经是一套可以复制的商业方案。能持续运行，和客户愿意把它放进产品里，中间还有一段路。Does it actually ship? 到这里仍然是一个问题。

我更想看到的下一份材料，是同一配置下的端到端 Latency、长时间运行的 Power 和 thermal 行为，再加上 Memory／Bandwidth 使用情况与模型迁移支持。第三方复现或客户应用会让讨论扎实很多。在这些证据出现之前，我不会拿这次展示去排 NVIDIA、Qualcomm 或其他 SoC 的名次。

<details>
<summary>来源、证据边界与写作依据</summary>

探索性草稿，个人判断待作者审阅。

- ASP/pricing for N1-655 or X7: 未披露.
- Exact latency/FPS and model sizes for SmolVLA, vision-to-action, RAG and video-search demonstrations: 未披露.
- Memory capacity and bandwidth for the demonstrated N1-655/X7 configurations: 未披露.
- N1-655 and X7 exact SoC/accelerator TOPS, precision throughput and utilization: 未披露.
- N1-655 and X7 power/TDP and thermal envelope: 未披露.

- F1 (fact): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0
- F2 (fact): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:1; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:2
- I1 (inference): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:1
- I2 (inference): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0
- F3 (fact): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:4; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:5
- I3 (inference): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:4; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:5
- F4 (fact): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:6
- J1 (personal_judgment): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:4; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:5
- J2 (personal_judgment): [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:0; [原始来源](https://www.ambarella.com/blog/ambarella-at-the-ai-infrastructure-summit-in-santa-clara) · 5baa5d53-15ec-44a5-b054-1058752304fe:fact:4

</details>
