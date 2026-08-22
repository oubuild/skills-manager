<p align="center">
  <img src="static/logo.png" width="120" alt="Skills Manager logo" />
</p>

<h1 align="center">Skills Manager</h1>

<p align="center">本地统一管理多个 AI Agent 的 skills：浏览、搜索、按 agent/场景筛选、启停、固定、安装、链接、删除、检查更新。</p>

## 启动

**桌面应用（Tauri）：**

```bash
pnpm install
pnpm dev
```

**网页模式：**

```bash
python3 server.py
# 打开 http://127.0.0.1:8080
```

自定义端口：`SKILLS_MANAGER_PORT=9000 python3 server.py`

## 支持的数据源

| Agent | 目录 | 说明 |
|---|---|---|
| Hermes | `~/.hermes/skills` | 主源，含分类、`hermes skills` CLI 元数据 |
| Claude | `~/.claude/skills` | |
| Codex | `~/.codex/skills` | |
| Cursor | `~/.cursor/skills-cursor` | |
| Shared | `~/.agents/skills` | 多 agent 共享目录 |

同一真身目录被多个源用**软链**引用时，自动合并为一条记录，挂多个 agent 徽章；
不同源中存在同名但不同真身的目录时，保留为多条独立记录（按真身路径去重）。

## 功能

| 功能 | 入口 |
|---|---|
| 浏览 / 搜索 / 筛选 | 顶栏搜索框 + 左侧「Agent」多选筛选 + 「场景分类」树 |
| 各 agent 数量统计 | 主区统计卡片行（每源拥有的 skill 数，点击即筛选） |
| 查看 SKILL.md / 关联文件 / 使用统计 | 点击卡片，右侧滑出详情 |
| 固定 / 启用停用 | 卡片右上角按钮，写入 `~/.hermes/skills/.usage.json` |
| 链接到其他 agent | 详情面板「链接到 + Agent」，跨源建软链共享同一真身 |
| 检查更新 | 顶栏按钮，调 `hermes skills check` |
| 安装新 skill | 顶栏「+ 安装 Skill」，调 `hermes skills install`（装到 Hermes 源） |
| 删除 | 卡片/详情按钮，弹确认框选择要移除的源；软链→unlink，Hermes hub/official→`hermes skills uninstall`，其余→删目录 |

## 技术栈

- 桌面端：Tauri 2（Rust 后端，复用 `server.py` 逻辑）
- 网页模式：Python 3.9 标准库（零依赖，`http.server`）
- 前端：Vue 3 + Tailwind CSS（预构建）+ 手写 shadcn/ui zinc 主题 CSS 变量
- 数据源：多源目录遍历 + `.usage.json` + `hermes skills list`

## 场景分类

按 SKILLS-INDEX.md 分为 6 大场景：Coding / Research / Writing / Browser / Data / General。
映射规则在 `static/app.js` 顶部 `SCENE_BY_CATEGORY` 和 `SCENE_BY_NAME`。

## 安全约束

- 路径锁定：文件操作限定在已注册源的树内，`Path.resolve()` 校验防路径遍历
- 安装 identifier 白名单：`^[a-zA-Z0-9_\-\.\/:@?=&%]+$`
- subprocess 用 list 传参，无 shell 注入
- 删除二次确认：API 要求 `{"confirm": true}`