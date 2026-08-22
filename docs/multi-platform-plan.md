# Skills Manager 多平台接入改造计划

> 目标：把应用从「写死 5 个 agent 源」改造为「注册表驱动的 28+ 平台源」，本地不存在的平台自动隐藏；侧边栏平台列表用图标 + 名称 + 数量展示，支持展开全部/收起；去掉右侧重复的平台卡片。

## 一、需求确认（基于对话整理）

1. **多平台接入**：按下表注册 28 个平台源（Coding 21 个 + Lobster 6 个 + Central 1 个）
2. **动态显隐**：本地目录不存在的平台自动隐藏，只显示扫到 skills 的
3. **侧边栏改造**：每个平台一行 = 图标 + 名字 + 数量；默认显示有内容的，提供「展开全部平台」按钮；空 skills 平台可隐藏
4. **保留场景分类**：场景分类功能保留不动
5. **去重**：右侧主区的平台统计卡片（Agent 卡片网格）删掉——和侧边栏重复

### 平台注册表

| Platform | 目录 | 分类 |
|----------|------|------|
| Hermes | `~/.hermes/skills` | Coding |
| Claude Code | `~/.claude/skills` | Coding |
| Codex CLI | `~/.codex/skills` | Coding |
| Cursor | `~/.cursor/skills` | Coding |
| Copilot | `~/.copilot/skills` | Coding |
| Gemini CLI | `~/.gemini/skills` | Coding |
| Windsurf | `~/.windsurf/skills` | Coding |
| Trae | `~/.trae/skills` | Coding |
| Trae CN | `~/.trae-cn/skills` | Coding |
| Qwen | `~/.qwen/skills` | Coding |
| Qoder | `~/.qoder/skills` | Coding |
| Augment | `~/.augment/skills` | Coding |
| OpenCode | `~/.opencode/skills` | Coding |
| KiloCode | `~/.kilocode/skills` | Coding |
| OB1 | `~/.ob1/skills` | Coding |
| Amp | `~/.amp/skills` | Coding |
| Kiro | `~/.kiro/skills` | Coding |
| CodeBuddy | `~/.codebuddy/skills` | Coding |
| Aider | `~/.aider/skills` | Coding |
| Factory Droid | `~/.factory/skills` | Coding |
| Junie | `~/.junie/skills` | Coding |
| OpenClaw (开爪) | `~/.openclaw/skills` | Lobster |
| QClaw (千爪) | `~/.qclaw/skills` | Lobster |
| EasyClaw (简爪) | `~/.easyclaw/skills` | Lobster |
| EasyClaw V2 | `~/.easyclaw-20260322-01/skills` | Lobster |
| AutoClaw | `~/.openclaw-autoclaw/skills` | Lobster |
| WorkBuddy (打工搭子) | `~/.workbuddy/skills-marketplace/skills` | Lobster |
| Central Skills | `~/.agents/skills` | Central |

**注意冲突**：用户表格里 Codex CLI 标的是 `~/.agents/skills`，但 Central 也是 `~/.agents/skills`。按现有代码语义（Codex=`~/.codex/skills`，Shared/Central=`~/.agents/skills`），采用上表修正版：Codex 用 `.codex`，Central 用 `.agents`。需向用户确认这一点。

## 二、后端改造（src-tauri/src/lib.rs）

### 2.1 平台注册表常量

```rust
struct AgentDef { name: &'static str, dir: &'static str, group: &'static str }

const AGENTS: &[AgentDef] = &[
    // name, home-relative dir, group
    AgentDef { name: "Hermes",     dir: ".hermes/skills",   group: "Coding" },
    AgentDef { name: "Claude",     dir: ".claude/skills",   group: "Coding" },
    // ... 全部 28 条
    AgentDef { name: "Central",    dir: ".agents/skills",   group: "Central" },
];
```

- 删除旧的 `AGENT_ORDER`、硬编码的 `sources()` Windows/macOS 分支大 if
- `sources()` 变为遍历 `AGENTS` 拼 `$HOME/<dir>`；Windows 特殊处理仅保留 **Hermes**（`%LOCALAPPDATA%\hermes\skills`）这一条已证实的差异，其余平台 Windows 上同样先探 `%LOCALAPPDATA%\<lowercase>\skills` 再回退 `~` 路径

### 2.2 SourceInfo 增加字段

```rust
struct SourceInfo {
    agent: String,
    root: String,
    count: usize,      // 现有
    icon: String,      // 新增：前端渲染图标用的 key（如 "claude"）
    group: String,     // 新增：Coding / Lobster / Central
}
```

### 2.3 兼容性影响点排查

- `AGENT_ORDER` 引用处（3 处）：`collect_skills` 的 sources_info 构建、`build_item` 的 agents 排序、link/delete 校验 → 全部改为遍历 `AGENTS`
- hermes CLI 相关逻辑（usage.json、check_updates、uninstall）继续只认 `"Hermes"` 名字，不变
- 前端 `AGENT_COLORS` 缺失的平台给统一默认色

## 三、前端改造（static/app.js + index.html）

### 3.1 图标方案

- 每个平台一个 SVG path 或 emoji 字母块（首选：单色 SVG logo，存成 JS 对象 `PLATFORM_ICONS = { claude: '<path d="..."/>', ... }`，行内渲染 `<svg><path/></svg>`，继承 currentColor 适配暗色模式）
- 拿不到官方 SVG 的用「首字母圆角色块」兜底（如 Lobster 系列爪子图标）
- 不引入外部图片请求（离线可用、无网络依赖）

### 3.2 侧边栏「平台」区（替换现有 Agent 区）

结构：

```
平台                    [⌄ 展开全部]   ← 折叠按钮
─────────────────────────────
[icon] Hermes        178
[icon] Claude         14
[icon] Cursor         25
...
── 仅当展开时 ──
[icon] Gemini CLI      0   ← 空 skills 平台（可被"隐藏空平台"开关过滤）
```

交互：
- 默认只显示 count > 0 的平台；「展开全部」显示所有已探测到目录的平台（count=0 也列出）
- 「隐藏空 skills 平台」开关（switch，持久化到 localStorage）：开启时空平台彻底不显示
- 点击平台名 = 过滤该平台（多选，沿用现有 toggleAgent 逻辑）
- 「全部」选项保留

### 3.3 场景分类

保留不动（用户确认）。

### 3.4 右侧主区去重

- 删掉「平台统计卡片网格」（`grid gap-3 mb-3` 那段 sources 循环卡片）
- 顶部统计行「共 N 个技能，覆盖 M 个 Agent」保留
- 「已固定 / 已停用 / 待更新」三卡保留

## 四、实施步骤

| 步骤 | 内容 | 验证 |
|------|------|------|
| 1 | lib.rs：AGENTS 注册表 + sources() 重写 + SourceInfo 加 icon/group 字段 | cargo check |
| 2 | lib.rs：三处 AGENT_ORDER 引用改遍历；link/delete 校验随注册表走 | cargo check |
| 3 | app.js：PLATFORM_ICONS 表 + 侧边栏平台区重构（折叠/空平台开关） | 本地 server.py 手测 |
| 4 | app.js：删除右侧平台卡片网格；agentStyle 兜底配色 | 本地手测暗色模式 |
| 5 | server.py 同步 sources 注册表（web 模式一致） | web 模式对比 |
| 6 | 回归：扫描数、详情、固定/停用/删除/链接、检查更新 | 全功能过一遍 |
| 7 | 发版 v1.3.0（minor），三平台构建 + OTA 验证 | CI 绿 + latest.json 三平台齐全 |

## 五、风险与待确认

1. **Codex vs Central 路径冲突**（见一）：按修正表执行还是严格按用户原表？
2. **Windows LOCALAPPDATA 探测**：除 Hermes 外其他平台是否真有 AppData 布局？保守做法是 Windows 也直接用 `~` 相对路径 + Hermes 特例
3. **图标版权/体积**：28 个内联 SVG 约 3-5KB，可接受；Lobster 系列没有现成 logo，用首字母色块
4. **性能**：28 个目录逐个 is_dir() 探测，开销可忽略
