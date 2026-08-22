#!/usr/bin/env python3
"""Skills Manager - 多 Agent skills 统一管理网页后端（零依赖，Python 3.9 标准库）

支持源：Hermes / Claude / Codex / Cursor / Shared(~/.agents)。
同一真身被多个源软链引用时合并为一条记录，挂多个 agent 徽章。
跨平台：macOS/Linux 用符号链接；Windows 用 Junction（mklink /J，免管理员）。
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

HOME = Path.home()
IS_WINDOWS = os.name == "nt"

# Windows 下 hermes CLI 可能输出 GBK，统一按 UTF-8 解码并容错
def _run(cmd, timeout):
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout,
        encoding="utf-8", errors="replace",
    )
# ---------------- 多源注册表 ----------------
AGENT_ORDER = [
    # (name, home-relative dir, group)
    ("Hermes", ".hermes/skills", "Coding"),
    ("Claude", ".claude/skills", "Coding"),
    ("Codex", ".codex/skills", "Coding"),
    ("Cursor", ".cursor/skills", "Coding"),
    ("Copilot", ".copilot/skills", "Coding"),
    ("Gemini", ".gemini/skills", "Coding"),
    ("Windsurf", ".windsurf/skills", "Coding"),
    ("Trae", ".trae/skills", "Coding"),
    ("Trae CN", ".trae-cn/skills", "Coding"),
    ("Qwen", ".qwen/skills", "Coding"),
    ("Qoder", ".qoder/skills", "Coding"),
    ("Augment", ".augment/skills", "Coding"),
    ("OpenCode", ".opencode/skills", "Coding"),
    ("KiloCode", ".kilocode/skills", "Coding"),
    ("OB1", ".ob1/skills", "Coding"),
    ("Amp", ".amp/skills", "Coding"),
    ("Kiro", ".kiro/skills", "Coding"),
    ("CodeBuddy", ".codebuddy/skills", "Coding"),
    ("Aider", ".aider/skills", "Coding"),
    ("Factory", ".factory/skills", "Coding"),
    ("Junie", ".junie/skills", "Coding"),
    ("OpenClaw", ".openclaw/skills", "Lobster"),
    ("QClaw", ".qclaw/skills", "Lobster"),
    ("EasyClaw", ".easyclaw/skills", "Lobster"),
    ("EasyClaw V2", ".easyclaw-20260322-01/skills", "Lobster"),
    ("AutoClaw", ".openclaw-autoclaw/skills", "Lobster"),
    ("WorkBuddy", ".workbuddy/skills-marketplace/skills", "Lobster"),
    ("Central", ".agents/skills", "Central"),
]


def _resolve_source_dir(name: str, rel: str) -> Path:
    """Windows 上先探 %LOCALAPPDATA%\\<首段>\\skills，再回退 ~/<rel>；其他平台直接 ~/rel。"""
    first_seg = rel.split("/")[0]
    local = os.environ.get("LOCALAPPDATA")
    if sys.platform == "win32" and local:
        cand = Path(local) / first_seg / "skills"
        if cand.is_dir():
            return cand
    return HOME / rel


SOURCES = {name: _resolve_source_dir(name, rel) for name, rel, _group in AGENT_ORDER}
SOURCE_GROUPS = {name: group for name, _rel, group in AGENT_ORDER}
AGENT_NAMES = [name for name, _rel, _group in AGENT_ORDER]
ACTIVE_SOURCES = {a: p for a, p in SOURCES.items() if p.is_dir()}

USAGE_FILE = SOURCES["Hermes"] / ".usage.json"
STATIC_DIR = Path(__file__).parent / "static"
PORT = int(os.environ.get("SKILLS_MANAGER_PORT", "8080"))

_usage_lock = threading.Lock()

# ---------------- ID 编解码（真身路径 → url-safe id） ----------------

def encode_id(resolved_path):
    return base64.urlsafe_b64encode(str(resolved_path).encode()).decode().rstrip("=")


def decode_id(sid):
    try:
        pad = "=" * (-len(sid) % 4)
        return Path(base64.urlsafe_b64decode(sid + pad).decode())
    except Exception:
        return None

# ---------------- frontmatter 解析（无 yaml 依赖，取关键字段） ----------------

def parse_frontmatter(text):
    """从 SKILL.md 提取 name/description/category"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return {}
    block = m.group(1)
    out = {}
    nm = re.search(r"^name:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", block, re.M)
    if nm:
        out["name"] = nm.group(1).strip()
    dm = re.search(r'^description:\s*["\'](.*?)["\']\s*$', block, re.M)
    if not dm:
        dm = re.search(r"^description:\s*(.+?)\s*$", block, re.M)
    if dm:
        out["description"] = dm.group(1).strip()
    cm = re.search(r"^category:\s*(.+?)\s*$", block, re.M)
    if cm:
        out["category"] = cm.group(1).strip().strip("'\"")
    return out

# ---------------- usage 统计 ----------------

def load_usage():
    try:
        return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_usage(data):
    with _usage_lock:
        tmp = USAGE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(USAGE_FILE)

# ---------------- hermes CLI 元数据 ----------------

def hermes_skills_list():
    """解析 `hermes skills list` 表格 → {name: {source, trust, enabled, category}}"""
    try:
        r = _run(["hermes", "skills", "list"], 30)
        out = r.stdout
    except Exception as e:
        return {}, f"hermes CLI 不可用: {e}"
    skills = {}
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("│"):
            continue
        cells = [c.strip() for c in line.strip("│").split("│")]
        if len(cells) != 5:
            continue
        name, category, source, trust, status = cells
        if name in ("Name", ""):
            continue
        truncated = name.endswith("…")
        skills[name.rstrip("…")] = {
            "category": category,
            "source": source,
            "trust": trust,
            "enabled": status == "enabled",
            "_truncated": truncated,
        }
    return skills, None


def match_cli_meta(skill_name, cli_map):
    if skill_name in cli_map:
        return cli_map[skill_name]
    for key, meta in cli_map.items():
        if meta.get("_truncated") and skill_name.startswith(key):
            return meta
    return None

# ---------------- 多源扫描与合并 ----------------

def walk_source(root, entries):
    """递归收集 (dir_path, category)。含 SKILL.md 的目录即 skill；支持软链目录。"""
    def walk(d, category):
        if (d / "SKILL.md").exists():
            entries.append((d, category))
            return
        try:
            for sub in sorted(d.iterdir()):
                if sub.name.startswith(".") or sub.name.startswith("_"):
                    continue
                if not (sub.is_dir() or sub.is_symlink()):
                    continue
                if (sub / "SKILL.md").exists():
                    walk(sub, category)
                else:
                    sub_cat = f"{category}/{sub.name}" if category else sub.name
                    walk(sub, sub_cat)
        except PermissionError:
            pass

    for entry in sorted(root.iterdir()):
        if entry.name.startswith(".") or entry.name.startswith("_"):
            continue
        if not (entry.is_dir() or entry.is_symlink()):
            continue
        if (entry / "SKILL.md").exists():
            entries.append((entry, ""))
        else:
            walk(entry, entry.name)


def collect_skills():
    """扫描所有源 → 按真身路径合并 → 返回 (items, sources_info, cli_err)"""
    cli_map, cli_err = hermes_skills_list()
    usage = load_usage()

    groups = {}  # resolved_path -> [entry...]
    for agent, root in ACTIVE_SOURCES.items():
        raw = []
        walk_source(root, raw)
        for d, category in raw:
            try:
                resolved = d.resolve()
            except Exception:
                continue
            groups.setdefault(resolved, []).append({
                "agent": agent,
                "path": d,
                "is_symlink": d.is_symlink(),
                "category": category,
            })

    items = []
    for resolved, group in groups.items():
        items.append(_build_item(resolved, group, cli_map, usage))
    items.sort(key=lambda s: s["name"])

    sources_info = []
    for agent, _rel, group in AGENT_ORDER:
        if agent not in ACTIVE_SOURCES:
            continue
        sources_info.append({
            "agent": agent,
            "icon": agent.lower().replace(" ", "-"),
            "group": group,
            "root": str(ACTIVE_SOURCES[agent]),
            "count": sum(1 for it in items if agent in it["agents"]),
        })
    return items, sources_info, cli_err


def _linked_files_of(d):
    refs = []
    for sub in ("references", "scripts", "templates", "agents", "assets"):
        p = d / sub
        if p.is_dir():
            refs.extend(f"{sub}/{f.name}" for f in p.iterdir() if f.is_file())
    return refs


def _build_item(resolved, group, cli_map, usage):
    md = resolved / "SKILL.md"
    try:
        text = md.read_text(errors="replace")
    except Exception:
        text = ""
    fm = parse_frontmatter(text)
    name = fm.get("name") or resolved.name

    agents = [a for a in AGENT_NAMES if a in {e["agent"] for e in group}]
    in_hermes = "Hermes" in agents
    cli_meta = match_cli_meta(name, cli_map) if in_hermes else None
    cli_meta = cli_meta or {}

    # category 优先级：hermes 遍历分类 > frontmatter > 任意源的遍历分类
    hermes_cat = next((e["category"] for e in group if e["agent"] == "Hermes" and e["category"]), "")
    other_cat = next((e["category"] for e in group if e["category"]), "")
    cat = hermes_cat or fm.get("category") or other_cat or ""

    u = usage.get(name, {})
    links = [{
        "agent": e["agent"],
        "path": str(e["path"]),
        "is_symlink": e["is_symlink"],
    } for e in sorted(group, key=lambda e: AGENT_NAMES.index(e["agent"]))]

    return {
        "id": encode_id(resolved),
        "name": name,
        "dir_name": resolved.name,
        "path": str(resolved),
        "category": cat,
        "description": fm.get("description", ""),
        "agents": agents,
        "links": links,
        "source": cli_meta.get("source", "local"),
        "trust": cli_meta.get("trust", "local" if not in_hermes else "local"),
        "enabled": cli_meta.get("enabled", True),
        "pinned": bool(u.get("pinned", False)),
        "state": u.get("state", "active"),
        "use_count": u.get("use_count", 0),
        "view_count": u.get("view_count", 0),
        "last_used_at": u.get("last_used_at"),
        "created_at": u.get("created_at"),
        "linked_files": _linked_files_of(resolved),
    }


def find_item(skill_id):
    """按 id 查找 (item, group)。"""
    resolved = decode_id(skill_id)
    if not resolved:
        return None, None
    # 安全检查：真身必须落在某个已注册源的树内
    try:
        rp = resolved.resolve()
        if not any(str(rp).startswith(str(root.resolve())) for root in ACTIVE_SOURCES.values()):
            return None, None
    except Exception:
        return None, None
    if not (rp / "SKILL.md").exists():
        return None, None
    cli_map, _ = hermes_skills_list()
    usage = load_usage()
    group = []
    for agent, root in ACTIVE_SOURCES.items():
        # 在各源中找指向该真身的条目
        raw = []
        walk_source(root, raw)
        for d, category in raw:
            try:
                if d.resolve() == rp:
                    group.append({"agent": agent, "path": d,
                                  "is_symlink": d.is_symlink(), "category": category})
            except Exception:
                continue
    if not group:
        return None, None
    return _build_item(rp, group, cli_map, usage), group

# ---------------- HTTP Handler ----------------

class Handler(BaseHTTPRequestHandler):
    server_version = "SkillsManager/0.2"

    def log_message(self, fmt, *args):
        pass  # 静默

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._json(code, {"error": msg})

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n <= 0:
                return {}
            return json.loads(self.rfile.read(n).decode())
        except Exception:
            return {}

    # ---------- GET ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/skills":
            items, sources_info, cli_err = collect_skills()
            resp = {"skills": items, "sources": sources_info, "total": len(items)}
            if cli_err:
                resp["warning"] = cli_err
            self._json(200, resp)
        elif path.startswith("/api/skills/"):
            rest = unquote(path[len("/api/skills/"):])
            m = re.match(r"^([A-Za-z0-9_\-]+)$", rest)
            if m:
                return self._get_skill_detail(m.group(1))
            self._error(404, "not found")
        elif path == "/api/updates":
            self._check_updates()
        elif path == "/api/app_version":
            try:
                conf = json.loads((Path(__file__).parent / "src-tauri" / "tauri.conf.json").read_text())
                self._json(200, {"version": conf.get("version", "")})
            except Exception as e:
                self._error(500, str(e))
        elif path == "/" or path == "/index.html":
            self._serve_static("index.html")
        elif path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
        else:
            self._error(404, "not found")

    def _get_skill_detail(self, skill_id):
        item, _group = find_item(skill_id)
        if not item:
            return self._error(404, "skill not found")
        p = Path(item["path"])
        try:
            content = (p / "SKILL.md").read_text(errors="replace")
        except Exception as e:
            return self._error(500, str(e))
        files = {}
        for sub in ("references", "scripts", "templates", "agents", "assets"):
            d = p / sub
            if d.is_dir():
                for f in d.iterdir():
                    if f.is_file():
                        try:
                            files[f"{sub}/{f.name}"] = f.read_text(errors="replace")[:50000]
                        except Exception:
                            files[f"{sub}/{f.name}"] = "(无法读取)"
        self._json(200, {"name": item["name"], "content": content, "files": files})

    def _check_updates(self):
        try:
            r = _run(["hermes", "skills", "check"], 60)
            out = r.stdout + r.stderr
        except Exception as e:
            return self._error(500, f"检查更新失败: {e}")
        updates = []
        for line in out.splitlines():
            line = line.strip()
            if not line.startswith("│"):
                continue
            cells = [c.strip() for c in line.strip("│").split("│")]
            if len(cells) == 3 and cells[0] != "Name":
                updates.append({"name": cells[0], "source": cells[1], "status": cells[2]})
        m = re.search(r"(\d+)\s+update\(s\)\s+available", out)
        self._json(200, {
            "updates": updates,
            "count": int(m.group(1)) if m else len(updates),
            "raw": out,
        })

    def _serve_static(self, rel):
        rel = rel or "index.html"
        target = (STATIC_DIR / rel).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())):
            return self._error(403, "forbidden")
        if not target.is_file():
            return self._error(404, "not found")
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".svg": "image/svg+xml",
        }.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- POST ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._body()

        if path == "/api/install":
            return self._install(body)
        if path == "/api/update":
            return self._update(body)
        if path == "/api/link":
            return self._link(body)
        m = re.match(r"^/api/skills/([A-Za-z0-9_\-]+)/(pin|state|delete)$", path)
        if m:
            skill_id, action = m.group(1), m.group(2)
            if action == "pin":
                return self._toggle_pin(skill_id)
            if action == "state":
                return self._toggle_state(skill_id, body)
            if action == "delete":
                return self._delete(skill_id, body)
        return self._error(404, "not found")

    def _toggle_pin(self, skill_id):
        item, _ = find_item(skill_id)
        if not item:
            return self._error(404, "skill not found")
        usage = load_usage()
        u = usage.setdefault(item["name"], {})
        u["pinned"] = not bool(u.get("pinned", False))
        save_usage(usage)
        self._json(200, {"name": item["name"], "pinned": u["pinned"]})

    def _toggle_state(self, skill_id, body):
        item, _ = find_item(skill_id)
        if not item:
            return self._error(404, "skill not found")
        target = body.get("state")
        if target not in ("active", "archived"):
            return self._error(400, "state must be 'active' or 'archived'")
        usage = load_usage()
        usage.setdefault(item["name"], {})["state"] = target
        save_usage(usage)
        self._json(200, {"name": item["name"], "state": target})

    def _delete(self, skill_id, body):
        """删除指定 agent 源中的条目。软链→unlink；hermes hub/official→CLI uninstall；否则删目录。"""
        if not body.get("confirm"):
            return self._error(400, "需要 confirm:true 二次确认")
        agent = body.get("agent")
        if agent not in ACTIVE_SOURCES:
            return self._error(400, f"agent 必须是 {list(ACTIVE_SOURCES)} 之一")
        item, group = find_item(skill_id)
        if not item:
            return self._error(404, "skill not found")
        entry = next((e for e in group if e["agent"] == agent), None)
        if not entry:
            return self._error(404, f"该 skill 不在 {agent} 源中")
        p = entry["path"]

        # hermes 非软链 + hub/official 来源 → 走 CLI 卸载
        if agent == "Hermes" and not entry["is_symlink"] and item["source"] in ("official", "hub"):
            try:
                r = _run(["hermes", "skills", "uninstall", item["name"], "--yes"], 60)
                if r.returncode != 0:
                    return self._error(500, f"uninstall 失败: {r.stderr or r.stdout}")
                return self._json(200, {"name": item["name"], "agent": agent,
                                        "method": "hermes uninstall", "ok": True})
            except Exception as e:
                return self._error(500, str(e))

        try:
            if entry["is_symlink"]:
                p.unlink()
                method = "unlink symlink"
            else:
                shutil.rmtree(p)
                method = "filesystem"
            # 若删的是真身且该 skill 只剩软链引用，提示断链
            warning = None
            remaining = [e for e in group if e["agent"] != agent]
            if remaining and not entry["is_symlink"]:
                warning = (f"已删除 {agent} 中的真身目录，"
                           f"其余 {len(remaining)} 个源（"
                           f"{', '.join(e['agent'] for e in remaining)}）的软链现已失效")
            # 该 skill 被完全移除时清理 usage
            if not remaining:
                usage = load_usage()
                usage.pop(item["name"], None)
                save_usage(usage)
            resp = {"name": item["name"], "agent": agent, "method": method, "ok": True}
            if warning:
                resp["warning"] = warning
            return self._json(200, resp)
        except Exception as e:
            return self._error(500, str(e))

    def _link(self, body):
        """把已有 skill 软链到目标 agent 源（共享真身）。"""
        skill_id = body.get("id")
        agent = body.get("agent")
        if agent not in ACTIVE_SOURCES:
            return self._error(400, f"agent 必须是 {list(ACTIVE_SOURCES)} 之一")
        item, _ = find_item(skill_id)
        if not item:
            return self._error(404, "skill not found")
        if agent in item["agents"]:
            return self._error(400, f"该 skill 已存在于 {agent}")
        root = ACTIVE_SOURCES[agent]
        target = root / item["dir_name"]
        if target.exists() or target.is_symlink():
            return self._error(400, f"{target} 已存在，无法创建软链")
        try:
            if IS_WINDOWS:
                # Junction 无需管理员/开发者模式；cmd 内联 mklink /J 需要 shell
                r = subprocess.run(
                    f'mklink /J "{target}" "{Path(item["path"])}"',
                    shell=True, capture_output=True, text=True,
                    timeout=30, encoding="utf-8", errors="replace",
                )
                if r.returncode != 0:
                    return self._error(500, f"创建 Junction 失败: {r.stderr or r.stdout}")
            else:
                os.symlink(Path(item["path"]), target)
            return self._json(200, {"name": item["name"], "agent": agent,
                                    "path": str(target), "ok": True})
        except Exception as e:
            return self._error(500, str(e))

    def _update(self, body):
        """更新 skill：指定 name 更新单个，否则更新全部过期 skill。"""
        name = (body.get("name") or "").strip()
        if name and not re.match(r"^[a-zA-Z0-9_\-\.]+$", name):
            return self._error(400, "skill 名称含非法字符")
        cmd = ["hermes", "skills", "update"] + ([name] if name else [])
        try:
            r = _run(cmd, 300)
            ok = r.returncode == 0
            return self._json(200 if ok else 500, {
                "ok": ok,
                "name": name or "(全部)",
                "stdout": r.stdout[-3000:],
                "stderr": r.stderr[-3000:],
            })
        except subprocess.TimeoutExpired:
            return self._error(500, "更新超时（300s）")
        except Exception as e:
            return self._error(500, str(e))

    def _install(self, body):
        identifier = (body.get("identifier") or "").strip()
        if not identifier:
            return self._error(400, "identifier 不能为空")
        if not re.match(r"^[a-zA-Z0-9_\-\.\/:@?=&%]+$", identifier):
            return self._error(400, "identifier 含非法字符")
        try:
            r = _run(["hermes", "skills", "install", identifier, "--yes"], 180)
            ok = r.returncode == 0
            return self._json(200 if ok else 500, {
                "ok": ok,
                "identifier": identifier,
                "stdout": r.stdout[-3000:],
                "stderr": r.stderr[-3000:],
            })
        except subprocess.TimeoutExpired:
            return self._error(500, "安装超时（180s）")
        except Exception as e:
            return self._error(500, str(e))


def main():
    STATIC_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"✦ Skills Manager 已启动: http://127.0.0.1:{PORT}")
    for agent, root in ACTIVE_SOURCES.items():
        print(f"  [{agent}] {root}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
