// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 */
// V1 keys are additive: existing category URLs and API identities remain valid.
export const CATEGORIES = [
  {"key": "embodied-ai", "label": "具身智能", "section": "具身智能", "guide": "具身基础模型、VLA、世界模型与人形、四足、移动操作和灵巧手能力进展；具体论文归 paper"},
  {"key": "robotics-products", "label": "机器人产品", "section": "机器人产品", "guide": "消费、服务、工业与巡检机器人的整机发布、硬件升级与产品参数"},
  {"key": "robot-ai", "label": "机器人AI", "section": "机器人AI", "guide": "感知、SLAM、导航、规划、运动控制、仿真、Sim2Real 与数据引擎的工具及系统更新；论文归 paper，教程归 tip"},
  {"key": "edge-ai-soc", "label": "端侧AI SoC", "section": "端侧AI SoC", "guide": "端侧 AI SoC、NPU、ISP、传感器、内存带宽、编译器、量化与推理运行时的发布和工程变化"},
  {"key": "industry-signal", "label": "产业信号", "section": "产业信号", "guide": "机器人与端侧 AI 的 design win、量产、订单、融资并购、价格、供应链与监管信号"},
  { key: "ai-models", label: "模型", section: "模型发布/更新", guide: "新模型、模型版本、权重开放、模型能力与价格变化的发布与评测结果" },
  { key: "ai-products", label: "产品", section: "产品发布/更新", guide: "AI 产品、功能、应用、工具、API 与平台的发布和更新" },
  { key: "industry", label: "行业", section: "行业动态", guide: "公司经营、融资并购、人事、合作、诉讼、监管与政策、市场与基础设施" },
  { key: "paper", label: "论文", section: "论文研究", guide: "研究论文、技术报告、基准与数据集" },
  { key: "tip", label: "教程", section: "技巧与观点", guide: "教程、实践经验、使用技巧、提示词与工具用法、深度技术讲解" },
  { key: "opinion", label: "观点", section: "技巧与观点", guide: "人物观点、评论、分析、访谈、现象与趋势讨论" },
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "产品更新", "模型发布", "论文/研究", "开源/仓库", "教程/实践", "现象/趋势", "大佬观点", "评测/基准", "安全/对齐", "行业动态", "政策/监管",
  "非AI/通用工具", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "机器人产品", "人形机器人", "四足机器人", "灵巧操作", "VLA", "世界模型", "感知/SLAM", "导航/规划", "运动控制", "仿真/Sim2Real", "边缘AI SoC", "NPU", "ISP/传感器", "内存/带宽", "量化/编译器", "量产/订单", "Design Win", "供应链",
  "Agent", "编码", "推理", "多模态", "语音", "视频", "图像生成", "RAG", "端侧", "数据/训练", "搜索", "部署/工程", "开源生态", "具身智能", "MCP/工具调用",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["Qualcomm", "Arm", "D-Robotics", "Horizon Robotics", "Rockchip", "Ambarella", "Axera", "Tesla", "Figure AI", "Agility Robotics", "Unitree", "Boston Dynamics", "1X", "Apptronik", "Physical Intelligence", "Skild AI", "Open Robotics", "NVIDIA", "OpenAI", "Anthropic", "DeepSeek", "DeepMind", "Google", "Meta", "Microsoft", "xAI", "Hugging Face", "GitHub", "arXiv"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "教程/玩法": "教程/实践", "技巧/最佳实践": "教程/实践", "合作/生态": "行业动态", "融资/收购": "行业动态", "公司动态": "行业动态",
  合作: "行业动态", 生态: "行业动态", 融资: "行业动态", 收购: "行业动态", 投资: "行业动态", 并购: "行业动态",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 安全: "安全/对齐", 对齐: "安全/对齐",
  论文: "论文/研究", 研究: "论文/研究", paper: "论文/研究", papers: "论文/研究",
  "open-source": "开源/仓库", 开源: "开源/仓库", 仓库: "开源/仓库", repo: "开源/仓库",
  教程: "教程/实践", 玩法: "教程/实践", 指南: "教程/实践", 技巧: "教程/实践", 最佳实践: "教程/实践", 实践: "教程/实践",
  产品: "产品更新", 更新: "产品更新", 发布: "模型发布", 模型: "模型发布", 趋势: "现象/趋势", 现象: "现象/趋势", 观点: "大佬观点",
  视频生成: "视频", 非ai: "非AI/通用工具", "non-ai": "非AI/通用工具", 通用工具: "非AI/通用工具", 工程工具: "非AI/通用工具",
  安全扫描: "非AI/通用工具", devops: "非AI/通用工具", 行业: "行业动态", 动态: "行业动态",
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  model_release: "模型发布", product_launch: "产品更新", tool_or_prompt: "教程/实践", research_paper: "论文/研究",
  industry_event: "行业动态", opinion_analysis: "大佬观点", tutorial_explainer: "教程/实践",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/** 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  "qualcomm": {"name": "Qualcomm", "displayTag": "Qualcomm", "aliases": ["Qualcomm", "高通"]},
  "arm": {"name": "Arm", "displayTag": "Arm", "aliases": ["Arm"]},
  "d-robotics": {"name": "D-Robotics", "displayTag": "D-Robotics", "aliases": ["D-Robotics", "地瓜机器人"]},
  "horizon-robotics": {"name": "Horizon Robotics", "displayTag": "Horizon Robotics", "aliases": ["Horizon Robotics", "地平线机器人"]},
  "rockchip": {"name": "Rockchip", "displayTag": "Rockchip", "aliases": ["Rockchip", "瑞芯微"]},
  "ambarella": {"name": "Ambarella", "displayTag": "Ambarella", "aliases": ["Ambarella", "安霸"]},
  "axera": {"name": "Axera", "displayTag": "Axera", "aliases": ["Axera", "爱芯元智"]},
  "tesla": {"name": "Tesla", "displayTag": "Tesla", "aliases": ["Tesla", "特斯拉"]},
  "figure": {"name": "Figure AI", "displayTag": "Figure AI", "aliases": ["Figure AI", "Figure Robotics"]},
  "agility": {"name": "Agility Robotics", "displayTag": "Agility Robotics", "aliases": ["Agility Robotics"]},
  "unitree": {"name": "Unitree", "displayTag": "Unitree", "aliases": ["Unitree", "宇树"]},
  "boston-dynamics": {"name": "Boston Dynamics", "displayTag": "Boston Dynamics", "aliases": ["Boston Dynamics", "波士顿动力"]},
  "1x": {"name": "1X", "displayTag": "1X", "aliases": ["1X Technologies", "1X"]},
  "apptronik": {"name": "Apptronik", "displayTag": "Apptronik", "aliases": ["Apptronik"]},
  "physical-intelligence": {"name": "Physical Intelligence", "displayTag": "Physical Intelligence", "aliases": ["Physical Intelligence"]},
  "skild-ai": {"name": "Skild AI", "displayTag": "Skild AI", "aliases": ["Skild AI"]},
  "open-robotics": {"name": "Open Robotics", "displayTag": "Open Robotics", "aliases": ["Open Robotics"]},

  openai: { name: "OpenAI", displayTag: "OpenAI", aliases: ["OpenAI", "ChatGPT", "Sora", "Codex", "GPT"] },
  anthropic: { name: "Anthropic", displayTag: "Anthropic", aliases: ["Anthropic", "Claude"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "DeepMind", "Gemini", "谷歌"] },
  deepseek: { name: "DeepSeek", displayTag: "DeepSeek", aliases: ["DeepSeek", "深度求索"] },
  qwen: { name: "千问 Qwen", displayTag: null, aliases: ["Qwen", "通义", "阿里"] },
  kimi: { name: "Kimi / 月之暗面", displayTag: null, aliases: ["Kimi", "月之暗面", "Moonshot"] },
  minimax: { name: "MiniMax", displayTag: null, aliases: ["MiniMax", "海螺"] },
  zhipu: { name: "智谱 GLM", displayTag: null, aliases: ["智谱", "GLM", "Z.ai"] },
  xai: { name: "xAI", displayTag: "xAI", aliases: ["xAI", "Grok"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "Llama"] },
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Copilot"] },
  nvidia: { name: "NVIDIA", displayTag: "NVIDIA", aliases: ["NVIDIA", "英伟达"] },
  "hugging-face": { name: "Hugging Face", displayTag: "Hugging Face", aliases: ["Hugging Face"] },
  cursor: { name: "Cursor", displayTag: null, aliases: ["Cursor", "Anysphere"] },
  openrouter: { name: "OpenRouter", displayTag: null, aliases: ["OpenRouter"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "qualcomm", name: "Qualcomm", patterns: [/\bQualcomm\b|高通/i] },
  { id: "arm", name: "Arm", patterns: [/\bArm\b/] },
  { id: "d-robotics", name: "D-Robotics", patterns: [/\bD\-Robotics\b|地瓜机器人/i] },
  { id: "horizon-robotics", name: "Horizon Robotics", patterns: [/\bHorizon\ Robotics\b|地平线机器人/i] },
  { id: "rockchip", name: "Rockchip", patterns: [/\bRockchip\b|瑞芯微/i] },
  { id: "ambarella", name: "Ambarella", patterns: [/\bAmbarella\b|安霸/i] },
  { id: "axera", name: "Axera", patterns: [/\bAxera\b|爱芯元智/i] },
  { id: "tesla", name: "Tesla", patterns: [/\bTesla\b|特斯拉/i] },
  { id: "figure", name: "Figure AI", patterns: [/\bFigure\ AI\b|\bFigure\ Robotics\b/i] },
  { id: "agility", name: "Agility Robotics", patterns: [/\bAgility\ Robotics\b/i] },
  { id: "unitree", name: "Unitree", patterns: [/\bUnitree\b|宇树/i] },
  { id: "boston-dynamics", name: "Boston Dynamics", patterns: [/\bBoston\ Dynamics\b|波士顿动力/i] },
  { id: "1x", name: "1X", patterns: [/\b1X\ Technologies\b/i, /\b1X\b/] },
  { id: "apptronik", name: "Apptronik", patterns: [/\bApptronik\b/i] },
  { id: "physical-intelligence", name: "Physical Intelligence", patterns: [/\bPhysical\ Intelligence\b/i] },
  { id: "skild-ai", name: "Skild AI", patterns: [/\bSkild\ AI\b/i] },
  { id: "open-robotics", name: "Open Robotics", patterns: [/\bOpen\ Robotics\b/i] },

  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b|\bcodex\b/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i, /\b(?:opus|sonnet|haiku)\s*\d+(?:[.\-]\d+)*\b/i, /\bfable\s*\d+(?:[.\-]\d+)*\b|\bmythos\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|notebooklm|\bveo\s?\d|\bAlphaFold\b|\bAMIE\b/i] },
  { id: "deepseek", name: "DeepSeek", patterns: [/deepseek|深度求索/i] },
  { id: "xai", name: "xAI / Grok", patterns: [/\bxai\b|\bgrok\b/i] },
  { id: "meta", name: "Meta / Llama", patterns: [/\bMeta\b/, /\bmeta\s?ai\b|\bllama\b/i] },
  { id: "microsoft", name: "Microsoft / Copilot", patterns: [/microsoft|copilot|微软/i] },
  { id: "nvidia", name: "NVIDIA", patterns: [/nvidia|英伟达|\bnemotron\b|\bnemo\b|\bblackwell\b|\brubin(?:\s+ultra)?\b|\bcuda\b/i] },
  { id: "qwen", name: "千问 Qwen", patterns: [/\bqwen|通义|千问/i] },
  { id: "hugging-face", name: "Hugging Face", patterns: [/hugging\s?face/i] },
  { id: "cursor", name: "Cursor", patterns: [/\bCursor\b/] },
  { id: "kimi", name: "Kimi / 月之暗面", patterns: [/\bkimi\b|月之暗面|\bmoonshot\s?ai\b/i] },
  { id: "openrouter", name: "OpenRouter", patterns: [/openrouter/i] },
  { id: "minimax", name: "MiniMax", patterns: [/minimax/i] },
  { id: "zhipu", name: "智谱 GLM", patterns: [/智谱|\bglm-?[4-9]/i] },
  { id: "hunyuan", name: "腾讯混元", patterns: [/混元|hunyuan/i] },
  { id: "doubao", name: "字节豆包", patterns: [/豆包|doubao|字节跳动|bytedance/i] },
  { id: "mistral", name: "Mistral", patterns: [/mistral/i] },
  { id: "perplexity", name: "Perplexity", patterns: [/\bPerplexity\b/] },
  { id: "runway", name: "Runway", patterns: [/\brunway\b/i] },
  { id: "suno", name: "Suno", patterns: [/\bsuno\b/i] },
  { id: "midjourney", name: "Midjourney", patterns: [/midjourney/i] },
  { id: "stability-ai", name: "Stability AI", patterns: [/stability\s?ai/i] },
  { id: "elevenlabs", name: "ElevenLabs", patterns: [/eleven\s?labs/i] },
  { id: "vllm", name: "vLLM", patterns: [/\bvllm\b/i] },
  { id: "ollama", name: "Ollama", patterns: [/\bollama\b/i] },
  { id: "windsurf", name: "Windsurf", patterns: [/windsurf/i] },
  { id: "devin", name: "Devin", patterns: [/\bdevin\b/i] },
  { id: "manus", name: "Manus", patterns: [/\bmanus\b/i] },
  { id: "apple", name: "Apple AI", patterns: [/\bapple\s?(intelligence|silicon|ai)\b|苹果(智能|\s?AI)/i] },
  { id: "amazon", name: "Amazon / AWS", patterns: [/amazon|\baws\b|亚马逊/i] },
  { id: "baidu", name: "百度文心", patterns: [/百度|baidu|文心|\bernie\s?bot\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  {"entityId": "qualcomm", "domains": ["qualcomm.com"]},
  {"entityId": "arm", "domains": ["arm.com"]},
  {"entityId": "d-robotics", "domains": ["d-robotics.cc"]},
  {"entityId": "horizon-robotics", "domains": ["horizon.auto"]},
  {"entityId": "rockchip", "domains": ["rock-chips.com"]},
  {"entityId": "ambarella", "domains": ["ambarella.com"]},
  {"entityId": "axera", "domains": ["axera-tech.com"]},
  {"entityId": "tesla", "domains": ["tesla.com"]},
  {"entityId": "figure", "domains": ["figure.ai"]},
  {"entityId": "agility", "domains": ["agilityrobotics.com"]},
  {"entityId": "unitree", "domains": ["unitree.com"]},
  {"entityId": "boston-dynamics", "domains": ["bostondynamics.com"]},
  {"entityId": "1x", "domains": ["1x.tech"]},
  {"entityId": "apptronik", "domains": ["apptronik.com"]},
  {"entityId": "physical-intelligence", "domains": ["pi.website"]},
  {"entityId": "skild-ai", "domains": ["skild.ai"]},
  {"entityId": "open-robotics", "domains": ["openrobotics.org"]},

  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "anthropic", domains: ["anthropic.com", "claude.com"] },
  { entityId: "google", domains: ["deepmind.google", "ai.google", "blog.google"] },
  { entityId: "deepseek", domains: ["deepseek.com"] },
  { entityId: "xai", domains: ["x.ai"] },
  { entityId: "meta", domains: ["ai.meta.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "qwen", domains: ["qwen.ai"] },
  { entityId: "cursor", domains: ["cursor.com"] },
  { entityId: "openrouter", domains: ["openrouter.ai"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "meta", pattern: /@AIatMeta\b/i },
  { entityId: "zhipu", pattern: /\bZhipu(?:\s+AI\b|['’]s\b)/i },
];
