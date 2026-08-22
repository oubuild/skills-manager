// Skills Manager 桌面端后端（Rust，编译进 Tauri 二进制）
// 忠实移植 server.py 的逻辑：多源扫描、按真身合并、frontmatter 解析、
// hermes CLI 元数据、固定/启停/链接/删除/安装/更新，以及路径穿越防护。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

// ---------------- 常量 / 源注册表 ----------------

const AGENT_ORDER: &[&str] = &["Hermes", "Claude", "Codex", "Cursor", "Shared"];
const USAGE_SUBS: &[&str] = &["references", "scripts", "templates", "agents", "assets"];

fn home() -> PathBuf {
    // Windows 没有 HOME，只有 USERPROFILE
    std::env::var(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .or_else(|_| std::env::var("HOME"))
    .or_else(|_| std::env::var("USERPROFILE"))
    .unwrap_or_else(|_| "/".to_string())
    .into()
}

fn sources() -> HashMap<String, PathBuf> {
    let h = home();
    let mut m = HashMap::new();

    // Windows 下各 CLI 的数据目录在 %LOCALAPPDATA%，与 macOS/Linux 的 ~/.xxx 不同
    if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| h.join("AppData").join("Local"));

        m.insert("Hermes".into(), local.join("hermes").join("skills"));
        m.insert(
            "Claude".into(),
            pick_first(&[
                local.join("claude").join("skills"),
                local.join("anthropic-claude").join("skills"),
                h.join(".claude").join("skills"),
            ]),
        );
        m.insert(
            "Codex".into(),
            pick_first(&[
                local.join("codex").join("skills"),
                h.join(".codex").join("skills"),
            ]),
        );
        m.insert(
            "Cursor".into(),
            pick_first(&[
                local.join("cursor").join("skills-cursor"),
                h.join(".cursor").join("skills-cursor"),
            ]),
        );
        m.insert(
            "Shared".into(),
            pick_first(&[
                local.join("agents").join("skills"),
                h.join(".agents").join("skills"),
            ]),
        );
    } else {
        m.insert("Hermes".into(), h.join(".hermes").join("skills"));
        m.insert("Claude".into(), h.join(".claude").join("skills"));
        m.insert("Codex".into(), h.join(".codex").join("skills"));
        m.insert("Cursor".into(), h.join(".cursor").join("skills-cursor"));
        m.insert("Shared".into(), h.join(".agents").join("skills"));
    }
    m
}

// 返回第一个已存在的候选路径；都不存在时返回最后一个（保持语义一致）
fn pick_first(candidates: &[PathBuf]) -> PathBuf {
    candidates
        .iter()
        .find(|p| p.is_dir())
        .cloned()
        .unwrap_or_else(|| candidates[candidates.len() - 1].to_path_buf())
}

fn active_sources() -> HashMap<String, PathBuf> {
    sources().into_iter().filter(|(_, p)| p.is_dir()).collect()
}

fn usage_file() -> PathBuf {
    sources()["Hermes"].join(".usage.json")
}

fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

// ---------------- 数据模型 ----------------

#[derive(Serialize, Clone)]
struct SkillItem {
    id: String,
    name: String,
    dir_name: String,
    path: String,
    category: String,
    description: String,
    agents: Vec<String>,
    links: Vec<LinkEntry>,
    source: String,
    trust: String,
    enabled: bool,
    pinned: bool,
    state: String,
    use_count: i64,
    view_count: i64,
    last_used_at: Option<String>,
    created_at: Option<String>,
    linked_files: Vec<String>,
}

#[derive(Serialize, Clone)]
struct LinkEntry {
    agent: String,
    path: String,
    is_symlink: bool,
}

#[derive(Serialize)]
struct SourceInfo {
    agent: String,
    root: String,
    count: usize,
}

#[derive(Serialize)]
struct SkillsResponse {
    skills: Vec<SkillItem>,
    sources: Vec<SourceInfo>,
    total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
struct UpdatesResponse {
    updates: Vec<UpdateRow>,
    count: usize,
    raw: String,
}

#[derive(Serialize)]
struct UpdateRow {
    name: String,
    source: String,
    status: String,
}

#[derive(Serialize)]
struct DetailResponse {
    name: String,
    content: String,
    files: HashMap<String, String>,
}

#[derive(Serialize, Default)]
struct SimpleResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

// ---------------- ID 编解码（真身路径 → url-safe base64） ----------------

fn encode_id(p: &Path) -> String {
    let b64 = base64_encode_url(p.to_string_lossy().as_bytes());
    b64
}

fn decode_id(sid: &str) -> Option<PathBuf> {
    let pad = "=".repeat((4 - sid.len() % 4) % 4);
    let mut buf = String::with_capacity(sid.len() + pad.len());
    buf.push_str(sid);
    buf.push_str(&pad);
    // url-safe base64: '-' -> '+', '_' -> '/'
    let std = buf.replace('-', "+").replace('_', "/");
    let bytes = base64_decode(&std)?;
    Some(PathBuf::from(String::from_utf8_lossy(&bytes).into_owned()))
}

// 手写 base64 编解码，避免引入额外 crate
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode_url(input: &[u8]) -> String {
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out.replace('+', "-").replace('/', "_").replace('=', "")
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let mut lookup = [255u8; 256];
    for (i, &c) in B64.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }
    let mut buf = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in input.bytes() {
        if c == b'=' {
            break;
        }
        let v = lookup[c as usize];
        if v == 255 {
            return None;
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            buf.push((acc >> bits) as u8 & 0xff);
        }
    }
    Some(buf)
}

// ---------------- frontmatter 解析 ----------------

fn parse_frontmatter(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    // 提取 -- 之间（首个 --- 到下一个 ---）的 frontmatter 块
    let block = match extract_fm_block(text) {
        Some(b) => b,
        None => return out,
    };
    for line in block.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("name:").or_else(|| l.strip_prefix("Name:")) {
            out.insert("name".into(), unquote(rest.trim()));
        } else if let Some(rest) = l
            .strip_prefix("description:")
            .or_else(|| l.strip_prefix("Description:"))
        {
            out.insert("description".into(), unquote(rest.trim()));
        } else if let Some(rest) = l
            .strip_prefix("category:")
            .or_else(|| l.strip_prefix("Category:"))
        {
            out.insert("category".into(), unquote(rest.trim()));
        }
    }
    out
}

// 取出首个 `---` 与下一个 `---` 之间的文本块（不含分隔符）
fn extract_fm_block(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut start = None;
    for (i, ln) in lines.iter().enumerate() {
        if ln.trim() == "---" {
            if start.is_none() {
                start = Some(i);
            } else {
                return Some(lines[start.unwrap() + 1..i].join("\n"));
            }
        }
    }
    None
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn load_usage() -> HashMap<String, serde_json::Value> {
    let p = usage_file();
    match std::fs::read_to_string(&p) {
        Ok(t) => serde_json::from_str(&t).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_usage(data: &HashMap<String, serde_json::Value>) {
    let p = usage_file();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(data).unwrap_or_default();
    let tmp = p.with_extension("tmp");
    if let Ok(()) = std::fs::write(&tmp, &json) {
        let _ = std::fs::rename(&tmp, &p);
    }
}

// ---------------- hermes CLI 元数据 ----------------

#[derive(Default, Clone)]
struct CliMeta {
    source: String,
    trust: String,
    enabled: bool,
}

fn hermes_skills_list() -> (HashMap<String, CliMeta>, Option<String>) {
    let out = match run_hermes(&["skills", "list"], 30) {
        Ok(o) => o,
        Err(e) => return (HashMap::new(), Some(format!("hermes CLI 不可用: {}", e))),
    };
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim();
        if !line.starts_with('│') {
            continue;
        }
        let cells: Vec<&str> = line
            .trim_matches('│')
            .split('│')
            .map(|c| c.trim())
            .collect();
        if cells.len() != 5 {
            continue;
        }
        let name = cells[0];
        if name.is_empty() || name == "Name" {
            continue;
        }
        let clean = name.trim_end_matches('…');
        let mut meta = CliMeta {
            source: cells[2].to_string(),
            trust: cells[3].to_string(),
            enabled: cells[4] == "enabled",
        };
        // 默认 source/trust
        if meta.source.is_empty() {
            meta.source = "local".into();
        }
        if meta.trust.is_empty() {
            meta.trust = "local".into();
        }
        map.insert(clean.to_string(), meta);
    }
    (map, None)
}

// GUI 应用（Finder/Dock 启动）不继承 shell 的 PATH，
// hermes 可能装在 ~/.local/bin、~/bin、homebrew 等位置，需要显式补全搜索路径
fn shell_path() -> String {
    let mut extra = Vec::new();
    if let Ok(h) = std::env::var("HOME") {
        let h = PathBuf::from(h);
        for dir in [".local/bin", "bin", ".cargo/bin", "go/bin"] {
            let p = h.join(dir);
            if p.is_dir() {
                extra.push(p.to_string_lossy().to_string());
            }
        }
    }
    // homebrew (Apple Silicon / Intel)
    for p in ["/opt/homebrew/bin", "/usr/local/bin"] {
        if Path::new(p).is_dir() {
            extra.push(p.to_string());
        }
    }
    let base = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    if extra.is_empty() {
        base
    } else {
        format!("{}:{}", extra.join(":"), base)
    }
}

fn hermes_available() -> bool {
    let path = shell_path();
    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/c", "where", "hermes"])
            .env("PATH", &path)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("which")
            .arg("hermes")
            .env("PATH", &path)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn run_hermes(args: &[&str], timeout_secs: u64) -> Result<String, String> {
    // Windows 上 npm 全局命令是 hermes.cmd，必须经 cmd /c 调用
    let path = shell_path();
    let r = if cfg!(target_os = "windows") {
        let mut full = vec!["/c", "hermes"];
        full.extend_from_slice(args);
        Command::new("cmd").args(&full).env("PATH", &path).output()
    } else {
        Command::new("hermes")
            .args(args)
            .env("PATH", &path)
            .output()
    }
    .map_err(|e| e.to_string())?;
    let _ = timeout_secs;
    let mut out = String::from_utf8_lossy(&r.stdout).to_string();
    out.push_str(&String::from_utf8_lossy(&r.stderr));
    Ok(out)
}

// ---------------- 多源扫描与合并 ----------------

#[derive(Clone)]
struct Entry {
    agent: String,
    path: PathBuf,
    is_symlink: bool,
    category: String,
}

fn scan_root(root: &Path) -> Vec<(PathBuf, String)> {
    let mut entries = Vec::new();
    if root.join("SKILL.md").exists() {
        entries.push((root.to_path_buf(), String::new()));
    }
    if let Ok(iter) = std::fs::read_dir(root) {
        for ent in iter.flatten() {
            let entry = ent.path();
            let name = entry
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            if !(entry.is_dir() || entry.is_symlink()) {
                continue;
            }
            if entry.join("SKILL.md").exists() {
                entries.push((entry.clone(), String::new()));
            } else {
                entries.extend(walk_sub(&entry, &name));
            }
        }
    }
    entries
}

fn walk_sub(d: &Path, category: &str) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    if let Ok(iter) = std::fs::read_dir(d) {
        for ent in iter.flatten() {
            let sub = ent.path();
            let name = sub
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            if !(sub.is_dir() || sub.is_symlink()) {
                continue;
            }
            let sub_cat = if category.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", category, name)
            };
            if sub.join("SKILL.md").exists() {
                out.push((sub.clone(), sub_cat));
            } else {
                out.extend(walk_sub(&sub, &sub_cat));
            }
        }
    }
    out
}

fn collect_skills() -> (Vec<SkillItem>, Vec<SourceInfo>, Option<String>) {
    let (cli_map, cli_err) = hermes_skills_list();
    let usage = load_usage();
    let active = active_sources();

    let mut groups: HashMap<PathBuf, Vec<Entry>> = HashMap::new();
    for (agent, root) in &active {
        for (d, category) in scan_root(root) {
            if let Ok(resolved) = d.canonicalize() {
                groups.entry(resolved.clone()).or_default().push(Entry {
                    agent: agent.clone(),
                    path: d.clone(),
                    is_symlink: d.is_symlink(),
                    category,
                });
            }
        }
    }

    let mut items = Vec::new();
    for (resolved, group) in groups {
        items.push(build_item(&resolved, &group, &cli_map, &usage));
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));

    let sources_info: Vec<SourceInfo> = AGENT_ORDER
        .iter()
        .filter(|a| active.contains_key(**a))
        .map(|a| SourceInfo {
            agent: a.to_string(),
            root: active[*a].to_string_lossy().to_string(),
            count: items
                .iter()
                .filter(|it| it.agents.contains(&a.to_string()))
                .count(),
        })
        .collect();

    (items, sources_info, cli_err)
}

fn linked_files_of(d: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for sub in USAGE_SUBS {
        let p = d.join(sub);
        if let Ok(iter) = std::fs::read_dir(&p) {
            for f in iter.flatten() {
                if f.path().is_file() {
                    out.push(format!("{}/{}", sub, f.file_name().to_string_lossy()));
                }
            }
        }
    }
    out
}

fn build_item(
    resolved: &Path,
    group: &[Entry],
    cli_map: &HashMap<String, CliMeta>,
    usage: &HashMap<String, serde_json::Value>,
) -> SkillItem {
    let md = resolved.join("SKILL.md");
    let text = std::fs::read_to_string(&md).unwrap_or_default();
    let fm = parse_frontmatter(&text);
    let name = fm.get("name").cloned().unwrap_or_else(|| {
        resolved
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });

    let agents: Vec<String> = AGENT_ORDER
        .iter()
        .filter(|a| group.iter().any(|e| &e.agent == **a))
        .map(|s| s.to_string())
        .collect();
    let in_hermes = agents.iter().any(|a| a == "Hermes");
    let cli_meta = if in_hermes {
        cli_map.get(&name).cloned().unwrap_or_default()
    } else {
        CliMeta::default()
    };

    // category 优先级：hermes 遍历分类 > frontmatter > 任意源的遍历分类
    let hermes_cat = group
        .iter()
        .find(|e| e.agent == "Hermes" && !e.category.is_empty())
        .map(|e| e.category.clone())
        .unwrap_or_default();
    let other_cat = group
        .iter()
        .find(|e| !e.category.is_empty())
        .map(|e| e.category.clone())
        .unwrap_or_default();
    let cat = if !hermes_cat.is_empty() {
        hermes_cat
    } else if let Some(c) = fm.get("category") {
        c.clone()
    } else {
        other_cat
    };

    let links: Vec<LinkEntry> = group
        .iter()
        .map(|e| LinkEntry {
            agent: e.agent.clone(),
            path: e.path.to_string_lossy().to_string(),
            is_symlink: e.is_symlink,
        })
        .collect();

    let u = usage.get(&name).cloned().unwrap_or(serde_json::Value::Null);
    let get_str = |k: &str| u.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());
    let get_bool = |k: &str| u.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    let get_i64 = |k: &str| u.get(k).and_then(|v| v.as_i64()).unwrap_or(0);

    SkillItem {
        id: encode_id(resolved),
        name: name.clone(),
        dir_name: resolved
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: resolved.to_string_lossy().to_string(),
        category: cat,
        description: fm.get("description").cloned().unwrap_or_default(),
        agents,
        links,
        source: if cli_meta.source.is_empty() {
            "local".into()
        } else {
            cli_meta.source.clone()
        },
        trust: if cli_meta.trust.is_empty() {
            if in_hermes {
                "local".into()
            } else {
                "local".into()
            }
        } else {
            cli_meta.trust.clone()
        },
        enabled: cli_meta.enabled,
        pinned: get_bool("pinned"),
        state: get_str("state").unwrap_or_else(|| "active".into()),
        use_count: get_i64("use_count"),
        view_count: get_i64("view_count"),
        last_used_at: get_str("last_used_at"),
        created_at: get_str("created_at"),
        linked_files: linked_files_of(resolved),
    }
}

// 按 id 找真身 + group（路径穿越防护）
fn find_item(skill_id: &str) -> Option<(SkillItem, Vec<Entry>)> {
    let resolved = decode_id(skill_id)?;
    let resolved = resolved.canonicalize().ok()?;
    let active = active_sources();
    // 安全检查：真身必须落在某个已注册源的树内
    let allowed = active.values().any(|root| {
        if let Ok(r) = root.canonicalize() {
            resolved.starts_with(&r)
        } else {
            resolved.starts_with(root)
        }
    });
    if !allowed {
        return None;
    }
    if !resolved.join("SKILL.md").exists() {
        return None;
    }
    let (cli_map, _) = hermes_skills_list();
    let usage = load_usage();
    let mut group = Vec::new();
    for (agent, root) in &active {
        for (d, _cat) in scan_root(root) {
            if let Ok(rp) = d.canonicalize() {
                if rp == resolved {
                    group.push(Entry {
                        agent: agent.clone(),
                        path: d.clone(),
                        is_symlink: d.is_symlink(),
                        category: String::new(),
                    });
                }
            }
        }
    }
    if group.is_empty() {
        return None;
    }
    Some((build_item(&resolved, &group, &cli_map, &usage), group))
}

// ---------------- Tauri 命令 ----------------

#[tauri::command]
fn get_skills() -> Result<SkillsResponse, ApiError> {
    let (skills, sources, warning) = collect_skills();
    Ok(SkillsResponse {
        total: skills.len(),
        skills,
        sources,
        warning,
    })
}

#[tauri::command]
fn get_skill_detail(id: String) -> Result<DetailResponse, ApiError> {
    let (item, _) = find_item(&id).ok_or_else(|| ApiError {
        error: "skill not found".into(),
    })?;
    let p = PathBuf::from(&item.path);
    let content = std::fs::read_to_string(p.join("SKILL.md")).unwrap_or_default();
    let mut files = HashMap::new();
    for sub in USAGE_SUBS {
        let d = p.join(sub);
        if let Ok(iter) = std::fs::read_dir(&d) {
            for f in iter.flatten() {
                let fp = f.path();
                if fp.is_file() {
                    let key = format!("{}/{}", sub, f.file_name().to_string_lossy());
                    let content =
                        std::fs::read_to_string(&fp).unwrap_or_else(|_| "(无法读取)".into());
                    files.insert(key, content.chars().take(50000).collect());
                }
            }
        }
    }
    Ok(DetailResponse {
        name: item.name,
        content,
        files,
    })
}

#[tauri::command]
fn check_updates() -> Result<UpdatesResponse, ApiError> {
    if !hermes_available() {
        return Err(ApiError {
            error: "未安装 Hermes CLI，无法检查 skill 更新（应用自身的更新不受影响）".into(),
        });
    }
    let out = run_hermes(&["skills", "check"], 60).map_err(|e| ApiError {
        error: format!("检查更新失败: {}", e),
    })?;
    let mut updates = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if !line.starts_with('│') {
            continue;
        }
        let cells: Vec<&str> = line
            .trim_matches('│')
            .split('│')
            .map(|c| c.trim())
            .collect();
        if cells.len() == 3 && cells[0] != "Name" {
            updates.push(UpdateRow {
                name: cells[0].to_string(),
                source: cells[1].to_string(),
                status: cells[2].to_string(),
            });
        }
    }
    let count = out
        .find("update")
        .and_then(|i| {
            out[i..]
                .chars()
                .position(|c| c.is_ascii_digit())
                .map(|j| i + j)
        })
        .and_then(|start| {
            let s = &out[start..];
            s.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<usize>()
                .ok()
        })
        .unwrap_or(updates.len());
    Ok(UpdatesResponse {
        updates,
        count,
        raw: out,
    })
}

#[tauri::command]
fn update_skill(name: Option<String>) -> Result<SimpleResult, ApiError> {
    let n = name.clone().unwrap_or_default();
    if !n.is_empty() && !regex_simple_ident(&n) {
        return Err(ApiError {
            error: "skill 名称含非法字符".into(),
        });
    }
    let mut args = vec!["skills", "update"];
    let owned: Vec<String>;
    if !n.is_empty() {
        owned = vec![n.clone()];
        args.push(&owned[0]);
    }
    let out = run_hermes(&args, 300).map_err(|e| ApiError {
        error: e.to_string(),
    })?;
    Ok(SimpleResult {
        ok: true,
        name: Some(if n.is_empty() { "(全部)".into() } else { n }),
        stdout: Some(out.chars().take(3000).collect()),
        stderr: None,
        ..Default::default()
    })
}

#[tauri::command]
fn install_skill(identifier: String) -> Result<SimpleResult, ApiError> {
    let id = identifier.trim().to_string();
    if id.is_empty() {
        return Err(ApiError {
            error: "identifier 不能为空".into(),
        });
    }
    if !regex_install_ident(&id) {
        return Err(ApiError {
            error: "identifier 含非法字符".into(),
        });
    }
    let args = ["skills", "install", &id, "--yes"];
    let out = run_hermes(&args, 180).map_err(|e| ApiError {
        error: e.to_string(),
    })?;
    Ok(SimpleResult {
        ok: true,
        identifier: Some(id),
        stdout: Some(out.chars().take(3000).collect()),
        stderr: None,
        ..Default::default()
    })
}

#[tauri::command]
fn link_skill(id: String, agent: String) -> Result<SimpleResult, ApiError> {
    let active = active_sources();
    if !active.contains_key(&agent) {
        return Err(ApiError {
            error: format!("agent 必须是 {:?} 之一", active.keys().collect::<Vec<_>>()),
        });
    }
    let (item, _) = find_item(&id).ok_or_else(|| ApiError {
        error: "skill not found".into(),
    })?;
    if item.agents.contains(&agent) {
        return Err(ApiError {
            error: format!("该 skill 已存在于 {}", agent),
        });
    }
    let root = &active[&agent];
    let target = root.join(&item.dir_name);
    if target.exists() || target.is_symlink() {
        return Err(ApiError {
            error: format!("{} 已存在，无法创建软链", target.display()),
        });
    }
    if is_windows() {
        let r = Command::new("cmd")
            .args(["/c", "mklink", "/J", &target.to_string_lossy(), &item.path])
            .output();
        if let Ok(o) = r {
            if !o.status.success() {
                return Err(ApiError {
                    error: format!("创建 Junction 失败: {}", String::from_utf8_lossy(&o.stderr)),
                });
            }
        } else {
            return Err(ApiError {
                error: "创建 Junction 失败".into(),
            });
        }
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            if let Err(e) = symlink(&item.path, &target) {
                return Err(ApiError {
                    error: format!("创建软链失败: {}", e),
                });
            }
        }
    }
    Ok(SimpleResult {
        ok: true,
        name: Some(item.name),
        agent: Some(agent),
        path: Some(target.to_string_lossy().to_string()),
        ..Default::default()
    })
}

#[tauri::command]
fn toggle_pin(id: String) -> Result<SimpleResult, ApiError> {
    let (item, _) = find_item(&id).ok_or_else(|| ApiError {
        error: "skill not found".into(),
    })?;
    let mut usage = load_usage();
    let entry = usage
        .entry(item.name.clone())
        .or_insert(serde_json::json!({}));
    let cur = entry
        .get("pinned")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    entry["pinned"] = serde_json::json!(!cur);
    save_usage(&usage);
    Ok(SimpleResult {
        ok: true,
        name: Some(item.name),
        pinned: Some(!cur),
        ..Default::default()
    })
}

#[tauri::command]
fn set_state(id: String, state: String) -> Result<SimpleResult, ApiError> {
    if state != "active" && state != "archived" {
        return Err(ApiError {
            error: "state must be 'active' or 'archived'".into(),
        });
    }
    let (item, _) = find_item(&id).ok_or_else(|| ApiError {
        error: "skill not found".into(),
    })?;
    let mut usage = load_usage();
    let entry = usage
        .entry(item.name.clone())
        .or_insert(serde_json::json!({}));
    entry["state"] = serde_json::json!(state.clone());
    save_usage(&usage);
    Ok(SimpleResult {
        ok: true,
        name: Some(item.name),
        state: Some(state),
        ..Default::default()
    })
}

#[tauri::command]
fn delete_skill(id: String, agent: String, confirm: bool) -> Result<SimpleResult, ApiError> {
    if !confirm {
        return Err(ApiError {
            error: "需要 confirm:true 二次确认".into(),
        });
    }
    let active = active_sources();
    if !active.contains_key(&agent) {
        return Err(ApiError {
            error: format!("agent 必须是 {:?} 之一", active.keys().collect::<Vec<_>>()),
        });
    }
    let (item, group) = find_item(&id).ok_or_else(|| ApiError {
        error: "skill not found".into(),
    })?;
    let entry = group
        .iter()
        .find(|e| e.agent == agent)
        .ok_or_else(|| ApiError {
            error: format!("该 skill 不在 {} 源中", agent),
        })?;
    let p = &entry.path;

    // hermes 非软链 + hub/official 来源 → 走 CLI 卸载
    if agent == "Hermes" && !entry.is_symlink && (item.source == "official" || item.source == "hub")
    {
        let out = run_hermes(&["skills", "uninstall", &item.name, "--yes"], 60);
        return match out {
            Ok(_) => Ok(SimpleResult {
                ok: true,
                name: Some(item.name),
                agent: Some(agent),
                method: Some("hermes uninstall".into()),
                ..Default::default()
            }),
            Err(e) => Err(ApiError {
                error: format!("uninstall 失败: {}", e),
            }),
        };
    }

    let method: &str;
    let mut warning = None;
    if entry.is_symlink {
        let _ = std::fs::remove_file(p);
        method = "unlink symlink";
    } else {
        let _ = std::fs::remove_dir_all(p);
        method = "filesystem";
        let remaining: Vec<&Entry> = group.iter().filter(|e| e.agent != agent).collect();
        if !remaining.is_empty() {
            warning = Some(format!(
                "已删除 {} 中的真身目录，其余 {} 个源（{}）的软链现已失效",
                agent,
                remaining.len(),
                remaining
                    .iter()
                    .map(|e| e.agent.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    // 该 skill 被完全移除时清理 usage
    let remaining: Vec<&Entry> = group.iter().filter(|e| e.agent != agent).collect();
    if remaining.is_empty() {
        let mut usage = load_usage();
        usage.remove(&item.name);
        save_usage(&usage);
    }
    Ok(SimpleResult {
        ok: true,
        name: Some(item.name),
        agent: Some(agent),
        method: Some(method.into()),
        warning,
        ..Default::default()
    })
}

// ---------------- 简易正则校验 ----------------

fn regex_simple_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn regex_install_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | '-' | '.' | '/' | ':' | '@' | '?' | '=' | '&' | '%')
        })
}

// ---------------- 应用入口 ----------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_skills,
            get_skill_detail,
            check_updates,
            update_skill,
            install_skill,
            link_skill,
            toggle_pin,
            set_state,
            delete_skill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
