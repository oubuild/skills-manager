# Skills Manager → 桌面端（Tauri + Rust）改造计划

> 目标：把现有「Python http.server + Vue/Tailwind CDN 网页」改造成**跨平台桌面应用**。
> 已确认决策：
> - 框架：**Tauri 2.x**（Rust 外壳）
> - 后端：**用 Rust 重写**（不保留 Python sidecar，目标机仅需 `hermes` CLI，无需 Python）
> - 前端：**离线本地化**（Vue / Tailwind 改为本地文件，不再走 CDN）
> - 节奏：**先 macOS 跑通**，再补 Win/Linux 构建配置与 CI

---

## 1. 架构总览

```
┌─────────────────────────────────────────────┐
│  Skills Manager.app (macOS) / .exe / AppImage│
│                                               │
│  Tauri WebView (系统原生 WebView)             │
│   └─ 加载 frontendDist = static/ 目录          │
│       ├─ index.html                           │
│       ├─ app.js  (Vue 应用，调用 invoke)        │
│       ├─ vue.global.prod.js (本地)             │
│       └─ tailwind.css (本地预编译)             │
│                                               │
│  Rust 后端 (编译进二进制)                      │
│   └─ #[tauri::command] 命令：                  │
│       get_skills / get_skill_detail /          │
│       check_updates / update_skill /           │
│       link_skill / toggle_pin / set_state /    │
│       delete_skill / install_skill             │
│       └─ 遍历 ~/.hermes|.claude|.codex|        │
│          .cursor|.agents/skills                │
│       └─ 调 `hermes skills ...` CLI            │
└─────────────────────────────────────────────┘
```

**关键变化**：前端不再 `fetch('/api/...')`，改为 `window.__TAURI__.core.invoke('command', args)` 调用 Rust 命令；Rust 命令返回 serde 序列化的对象（等价于原 JSON）。无 HTTP 服务器。

---

## 2. 文件改动清单

### A. 新增（Tauri 工程）

| 文件 | 作用 |
|---|---|
| `src-tauri/Cargo.toml` | Rust 依赖：`tauri = "2"`, `serde`, `serde_json`, `tauri-plugin-shell` |
| `src-tauri/build.rs` | `tauri_build::build()` |
| `src-tauri/src/main.rs` | `main()` 入口，`Builder.run()` |
| `src-tauri/src/lib.rs` | 全部 `#[tauri::command]` 实现 + `run()` |
| `src-tauri/tauri.conf.json` | `productName`, `identifier`, `frontendDist = "../static"`, `withGlobalTauri: true`, `plugin-shell` 权限, `devUrl` |
| `src-tauri/icons/` | 用现有六边形 SVG 生成各尺寸图标（icns/ico/png） |
| `src-tauri/capabilities/default.json` | 授予 `core:event`、shell `open` 权限 |
| `tailwind.config.js` | 颜色映射 `hsl(var(--x) / <alpha-value>)`，扫描 `index.html`+`app.js` |
| `input.css` | `@tailwind base/components/utilities` |
| `package.json` | devDeps：`tailwindcss@3`、`@tauri-apps/cli`；scripts：`build:css`、`tauri` |
| `.github/workflows/release.yml` | （阶段四）三平台构建 |

### B. 修改（前端）

- `static/index.html`
  - 删除 Vue / marked / Tailwind **三个 CDN `<script>/<link>`**
  - 新增 `<script src="./vue.global.prod.js"></script>`、`<link rel="stylesheet" href="./tailwind.css">`
  - `<script type="module" src="/static/app.js">` → `src="./app.js"`
  - 保留内联 `<style>`（CSS 变量 + `.btn/.card/.badge` 等手写类）
- `static/app.js`
  - 10 处 `fetch('/api/...')` 全部改为 `invoke(...)`（见 §3 映射）
  - 移除 `.json()` 解析（`invoke` 直返对象）
  - `encodeURIComponent(s.id)` 改为直接传 `id` 参数
  - GitHub 图标 `<a>` 的 `target="_blank"` → 改为 `onclick` 调 `window.__TAURI__.shell.open(url)`（避免 Tauri 拦截 `target=_blank`）
- `static/vue.global.prod.js`：下载一次到本地（离线）
- `static/tailwind.css`：由 `tailwind.config.js` 预编译生成（构建前命令）

### C. 保留

- `server.py`：**予以保留**作为「网页/CLI 模式」兜底（不删除，README 注明两者并存），但桌面端走 Rust 路径。

---

## 3. API → Rust 命令映射

| 原端点 | Rust 命令 | 入参 | 返回 |
|---|---|---|---|
| `GET /api/skills` | `get_skills` | — | `{skills, sources, total, warning?}` |
| `GET /api/skills/{id}` | `get_skill_detail` | `id: String` | `{name, content, files}` |
| `GET /api/updates` | `check_updates` | — | `{updates, count, raw}` |
| `POST /api/update` | `update_skill` | `{name?: String}` | `{ok, name, stdout, stderr}` |
| `POST /api/link` | `link_skill` | `{id, agent}` | `{name, agent, path, ok}` |
| `POST /api/skills/{id}/pin` | `toggle_pin` | `id` | `{name, pinned}` |
| `POST /api/skills/{id}/state` | `set_state` | `{id, state}` | `{name, state}` |
| `POST /api/skills/{id}/delete` | `delete_skill` | `{id, agent, confirm}` | `{name, agent, method, ok, warning?}` |
| `POST /api/install` | `install_skill` | `{identifier}` | `{ok, identifier, stdout, stderr}` |

**Rust 内部复用 server.py 的逻辑**（忠实移植）：
- `AGENT_ORDER` / `SOURCES` / `ACTIVE_SOURCES`（macOS/Linux 用 symlink，Windows 用 `cmd /c mklink /J` junction）
- `encode_id`/`decode_id`：base64 url-safe 真身路径（**保持与现有 `.usage.json` 兼容**，key 用 skill name）
- frontmatter 解析（正则取 name/description/category）
- `collect_skills` 多源扫描+按真身合并+挂 agent 徽章
- `_check_updates` 解析 `hermes skills check` 表格
- 路径穿越防护：真身必须落在已注册源树内
- `.usage.json` 读写（原子写：tmp→rename）
- CLI 调用：`hermes skills list/check/update/install/uninstall`，`std::process::Command` list 传参（无 shell 注入）
- 安装 identifier 白名单正则 `^[a-zA-Z0-9_\\-\\.\\/:@?=&%]+$`

---

## 4. 实施步骤（分阶段，先 macOS）

**阶段 0 — 工具链准备**
- 本机已有 `cargo`、`node`、`npm`
- 安装 `@tauri-apps/cli`（npm 全局或项目 devDep）、`tailwindcss@3`
- 下载 `vue.global.prod.js` 到 `static/`（离线）
- 生成 Tauri 图标（六边形 SVG → icns/ico/png）

**阶段 1 — 前端离线化（不改架构，先验证网页仍可用）**
- 引入 `tailwind.config.js` + `input.css`，`npm run build:css` 生成 `static/tailwind.css`
- 改 `index.html` 引用本地 Vue/Tailwind，路径改相对
- 用 `python3 server.py` 起服务，浏览器验证外观/功能不变（确保离线化无回归）

**阶段 2 — 前端 invoke 化**
- `app.js` 的 10 处 fetch → `invoke`；去 `.json()`；GitHub 图标改 `shell.open`
- 此时网页端会因无 `window.__TAURI__` 报错，属预期——下一阶段用 Tauri 跑

**阶段 3 — Rust 后端 + Tauri 壳（macOS 跑通）**
- 写 `src-tauri/` 全部文件，移植 9 个命令
- `tauri.conf.json` 指向 `../static` 为 `frontendDist`
- `cargo tauri dev`（或 `npm run tauri dev`）在 macOS 起桌面窗口，逐功能验证：
  浏览/搜索/筛选 ✓、详情/关联文件 ✓、固定/启停 ✓、链接 ✓、
  检查更新 ✓、安装/卸载 ✓、删除 ✓、GitHub 图标打开浏览器 ✓

**阶段 4 — 跨平台构建（后续）**
- 写 `.github/workflows/release.yml`：matrix `[macos, windows, ubuntu]`
- Linux 需 `webkit2gtk-4.1-dev`；Windows 需 WebView2（Tauri 自动处理）
- 产出 `.dmg` / `.msi` / `.AppImage` + 自动更新（可选 `tauri-plugin-updater`）

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 首次 `cargo build` 拉取 Tauri 依赖耗时（数分钟~十几分钟） | 阶段 3 留足时间；可后台跑 |
| Tailwind `bg-background/95` 透明度依赖 CSS 变量格式 | `tailwind.config.js` 颜色定义为 `hsl(var(--x) / <alpha-value>)`（shadcn 标准） |
| Tauri 拦截 `target="_blank"` | 改用 `plugin-shell` 的 `open()` |
| Windows junction 需 `shell:true` 调 `mklink` | Rust 用 `Command::new("cmd").args(["/c","mklink","/J",...])` |
| ID/base64 与旧 `.usage.json` 兼容性 | 保持 key=skill name（server.py 即用 name 作 key），无兼容问题 |
| `hermes` CLI 不在 PATH | 桌面端沿用 `Command::new("hermes")`；缺失时命令返回友好错误（同 server.py 行为） |
| 离线化导致功能细节遗漏 | 阶段 1 单独验证网页功能无回归后再动架构 |

---

## 6. 验证标准（macOS 跑通判定）

- [ ] `npm run tauri dev` 启动桌面窗口，标题栏显示六边形图标
- [ ] 主区列出所有 agent 的 skills，统计卡片数字正确
- [ ] 搜索 / Agent 筛选 / 场景分类筛选生效
- [ ] 点卡片右侧滑出详情，SKILL.md 与关联文件可读
- [ ] 固定 / 启用停用状态写入 `~/.hermes/skills/.usage.json`
- [ ] 「链接到」能创建跨源软链
- [ ] 检查更新 / 安装 / 卸载调用 `hermes` CLI 成功
- [ ] 删除带二次确认，软链/真身分支正确
- [ ] 右上角 GitHub 图标点击在系统浏览器打开仓库
- [ ] 全程离线（断网）可正常使用（除需联网的 install/check）

---

## 7. 待你确认的点

1. **是否删除 `server.py`？** 计划建议保留作兜底（README 说明两种运行方式），不删。
2. **应用名 / bundle identifier**：建议 `Skills Manager` / `com.oubuild.skillsmanager`，可改。
3. **阶段 4 的 CI 发布**：是否现在就配三平台 release（需你提供 GitHub 仓库写权限/Secrets），还是先 macOS 本地跑通、CI 稍后？

> 确认后我从「阶段 0」开始实施，每阶段完成后向你汇报再继续。
