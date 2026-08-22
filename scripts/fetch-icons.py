#!/usr/bin/env python3
"""下载各平台 favicon 图标到 static/icons/，供侧边栏平台列表使用。
来源: favicon.run（Google s2 favicons 的代理）
用法: python3 scripts/fetch-icons.py
兜底：前端对下载失败/缺失的平台用首字母色块渲染。
"""
import os
import sys
import urllib.request

# 平台 key -> 用于抓图标的域名
PLATFORM_DOMAINS = {
    "hermes": "hermes-agent.nousresearch.com",
    "claude": "claude.ai",
    "codex": "chatgpt.com",
    "cursor": "cursor.com",
    "copilot": "github.com",
    "gemini": "gemini.google.com",
    "windsurf": "windsurf.com",
    "trae": "trae.ai",
    "trae-cn": "trae.cn",
    "qwen": "chat.qwen.ai",
    "qoder": "qoder.com",
    "augment": "augmentcode.com",
    "opencode": "opencode.ai",
    "kilocode": "kilocode.ai",
    "ob1": "ob1.ai",
    "amp": "ampcode.com",
    "kiro": "kiro.dev",
    "codebuddy": "codebuddy.ai",
    "aider": "aider.chat",
    "factory": "factory.ai",
    "junie": "junie.jetbrains.com",
    "openclaw": "openclaw.ai",
    "qclaw": "qclaw.ai",
    "easyclaw": "easyclaw.ai",
    "easyclaw-v2": "easyclaw.ai",
    "autoclaw": "autoclaw.ai",
    "workbuddy": "workbuddy.ai",
    "central": "central.ai",
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
SIZE = 64

def fetch(key: str, domain: str) -> bool:
    url = f"https://favicon.run/favicon?domain={domain}&sz={SIZE}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        if len(data) < 100:  # 太小基本是错误页/空图
            print(f"  [skip] {key}: response too small ({len(data)}B)")
            return False
        out = os.path.normpath(os.path.join(OUT_DIR, f"{key}.png"))
        with open(out, "wb") as f:
            f.write(data)
        print(f"  [ok]   {key:<12} <- {domain} ({len(data)}B)")
        return True
    except Exception as e:
        print(f"  [fail] {key:<12} <- {domain}: {e}")
        return False

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ok = fail = 0
    for key, domain in PLATFORM_DOMAINS.items():
        if fetch(key, domain):
            ok += 1
        else:
            fail += 1
    print(f"\ndone: {ok} ok, {fail} failed -> {os.path.normpath(OUT_DIR)}")
    sys.exit(0 if fail == 0 else 1)

if __name__ == "__main__":
    main()
