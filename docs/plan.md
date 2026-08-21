# Skills Manager 实现计划

> 日期：2026-08-21 ｜ 状态：待确认
> 目标：本地网页管理 Hermes Agent 全部 skills（浏览/搜索/启停/固定/安装/更新检查/删除）

## 1. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 后端 | Python 3.9 标准库 `http.server` | 零依赖，`python3 server.py` 一行启动 |
| 前端 | Vue 3 (CDN) + Tailwind Play CDN + 手写 shadcn CSS 变量 | 无构建步骤，复刻 shadcn/ui zinc 主题 |
| 数据源 | `~/.hermes/skills/` 目录遍历 + `.usage.json` + `hermes skills list --json` | 文件读取为主，CLI 为辅 |

## 2. 目录结构

```
~/dev/skills-manager/
├── server.py            # 单文件后端：API + 静态文件托管
├── static/
│   ├── index.html       # 单页入口（CDN 引入 + CSS 变量）
│   └── app.js           # Vue 应用逻辑
├── docs/
│   └── plan.md          # 本文件
└── README.md            # 启动说明
```

## 3. 后端 API（server.py）

### 3.1 接口清单

| 方法 | 路径 | 功能 | 实现 |
|---|---|---|---|
| GET | `/api/skills` | 技能列表（含分类/描述/使用统计/状态） | 遍历目录解析 SKILL.md frontmatter，合并 `.usage.json` 与 `hermes skills list --json` |
| GET | `/api/skills/<name>` | 详情：SKILL.md 全文 + references/scripts 文件列表 | 文件读取 |
| POST | `/api/skills/<name>/pin` | 固定/取消固定 | 写 `.usage.json` 的 `pinned` 布尔字段 |
| POST | `/api/skills/<name>/state` | 启用/停用（单 skill） | 写 `.usage.json` 的 `state: active/archived` |
| POST | `/api/install` | 安装新 skill | `hermes skills install <identifier> -y` |
| GET | `/api/updates` | 检查更新 | `hermes skills check --json`（若无 --json 则解析表格） |
| POST | `/api/skills/<name>/delete` | 删除 | hub 来源→`hermes skills uninstall <name>`；其余→删除目录 |

### 3.2 安全约束

1. **路径锁定**：所有文件操作限定在 `~/.hermes/skills/` 内，`Path.resolve()` 校验防 `../` 遍历
2. **CLI 参数白名单**：install identifier 仅允许 `^[a-zA-Z0-9_\-/\.:]+$`（支持 `org/repo/skill` 和 https URL）
3. **无 shell 注入**：subprocess 用 list 传参，不用 `shell=True`
4. **删除二次确认**：API 要求请求体 `{"confirm": true}`，前端弹 Dialog 确认

### 3.3 frontmatter 解析

用 `re` 提取 `---` 块，`yaml` 不可用 → 自写简易解析：只取 `name/description/category/tags` 三个字段（多行 description 跳过，单页够用）。

## 4. 前端页面（shadcn/ui 风格）

### 4.1 布局

```
┌─────────────────────────────────────────────────────────┐
│ Header: Skills Manager    [搜索Input]  [检查更新Btn] [安装Btn] │
├──────────┬──────────────────────────────────────────────┤
│ 左侧分类树 │  统计卡片行: 总数/已固定/已停用/待更新          │
│          │                                              │
│ ▸Research│  ┌─────┐ ┌─────┐ ┌─────┐                     │
│ ▸Writing │  │Card │ │Card │ │Card │  ...                │
│ ▸Coding  │  └─────┘ └─────┘ └─────┘                     │
│ ▸Browser │                                              │
│ ▸Data    │  (点击卡片 → 右侧 Sheet 滑出详情)              │
│ ▸General │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### 4.2 组件对照（手写 CSS 复刻 shadcn）

| 组件 | 用途 | class 要点 |
|---|---|---|
| Card | skill 卡片 | `border rounded-lg shadow-sm bg-card`，hover `-translate-y-0.5` |
| Badge | 场景标签/pinned/停用 | secondary / outline / destructive 变体 |
| Button | 全部操作 | default(黑) / outline / ghost / destructive 四变体 |
| Input | 搜索框 | `border rounded-md h-9 px-3`，focus `ring-2 ring-ring` |
| Dialog | 删除确认、安装弹窗 | 居中遮罩 + `rounded-lg border bg-background p-6` |
| Sheet | 详情面板 | 右侧 `fixed inset-y-0 right-0 w-3/4 max-w-md`，滑入动画 |
| Tabs | 详情内「说明/关联文件/统计」 | 下划线选中 |
| Switch | 启用/停用、固定 | 滑动开关 |

### 4.3 CSS 变量（zinc 主题）

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --muted: 240 4.8% 95.9%;
  --border: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --radius: 0.5rem;
}
```

### 4.4 分类映射（与 SKILLS-INDEX.md 对齐）

- 保留原目录分类作为**二级**（apple/github/research/…）
- 新增**场景层**（Research/Writing/Coding/Browser/Data/General）作为一级，映射规则写死在前端常量中
- superpowers 系列归入 Coding

## 5. 实现步骤（TDD 轻量版）

1. **后端骨架**：`server.py` 起 HTTP 服务 + 静态文件路由，GET `/api/skills` 返回真实数据
2. **前端骨架**：index.html + app.js 渲染卡片网格，调通 `/api/skills`
3. **详情面板**：GET `/api/skills/<name>` + Sheet 滑出 + marked 渲染 Markdown
4. **状态操作**：pin/state 两个 POST，先写 `.usage.json` 再刷新列表
5. **安装/更新/删除**：CLI 桥接，Dialog 确认
6. **打磨**：分类树筛选、搜索防抖、空状态、错误提示

## 6. 验证清单

- [ ] `python3 server.py` 启动后 `http://localhost:8080` 可访问
- [ ] 列表正确显示 173 个 skills 的名称/分类/描述/使用次数
- [ ] 点击卡片弹出详情，SKILL.md 正常渲染
- [ ] 固定/停用状态切换后 `.usage.json` 被正确修改
- [ ] 安装 `openai/skills/skill-creator` 成功并出现在列表
- [ ] `检查更新` 返回 yuanbao/polymarket 待更新
- [ ] 删除自建 skill 后目录消失，hub skill 走 uninstall
- [ ] 恶意路径 `GET /api/skills/..%2Fsecret` 返回 400

## 7. 风险与回退

| 风险 | 应对 |
|---|---|
| `hermes skills check` 无 `--json` | 解析 Rich 表格（列固定）或降级显示文本输出 |
| `.usage.json` 写入并发 | 每次操作读-改-写，加文件锁（`fcntl`） |
| Tailwind Play CDN 生产警告 | 仅本地工具，可接受；后续可换预编译 CSS |
