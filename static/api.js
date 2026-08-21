// API 抽象层：在 Tauri 桌面端用 invoke 调 Rust 命令；在网页/服务端模式用 fetch。
// 这样同一份前端代码可在两种模式下运行，无需改动业务调用点。

const inTauri =
  typeof window !== 'undefined' &&
  window.__TAURI_INTERNALS__ !== undefined;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 简单串行重试，避免 invoke 在窗口刚就绪时的竞态
async function invokeWithRetry(cmd, args, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // @tauri-apps/api 的 invoke 通过 window.__TAURI__.core.invoke 暴露
      const invoke =
        window.__TAURI__?.core?.invoke ||
        window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== 'function') {
        throw new Error('Tauri invoke 不可用');
      }
      return await invoke(cmd, args || {});
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(80 * (i + 1));
    }
  }
  throw new Error('invoke 失败');
}

// Web 模式下把命令名映射回原 HTTP 端点
const WEB_ENDPOINTS = {
  get_skills: { method: 'GET', path: '/api/skills' },
  get_skill_detail: { method: 'GET', path: (a) => `/api/skills/${encodeURIComponent(a.id)}` },
  check_updates: { method: 'GET', path: '/api/updates' },
  update_skill: { method: 'POST', path: '/api/update' },
  link_skill: { method: 'POST', path: '/api/link' },
  toggle_pin: { method: 'POST', path: (a) => `/api/skills/${encodeURIComponent(a.id)}/pin` },
  set_state: { method: 'POST', path: (a) => `/api/skills/${encodeURIComponent(a.id)}/state` },
  delete_skill: { method: 'POST', path: (a) => `/api/skills/${encodeURIComponent(a.id)}/delete` },
  install_skill: { method: 'POST', path: '/api/install' },
};

async function webFetch(cmd, args) {
  const def = WEB_ENDPOINTS[cmd];
  if (!def) throw new Error('未知命令: ' + cmd);
  const path = typeof def.path === 'function' ? def.path(args || {}) : def.path;
  const opts = { method: def.method, headers: { 'Content-Type': 'application/json' } };
  if (def.method === 'POST') opts.body = JSON.stringify(args || {});
  const r = await fetch(path, opts);
  return await r.json();
}

export async function api(cmd, args) {
  if (inTauri) {
    return await invokeWithRetry(cmd, args);
  }
  return await webFetch(cmd, args);
}

// 在系统默认浏览器打开外链（Tauri 下用 shell open，web 下用 window.open）
export async function openExternal(url) {
  try {
    if (inTauri && window.__TAURI__?.shell?.open) {
      await window.__TAURI__.shell.open(url);
      return;
    }
  } catch (e) {
    /* fallthrough */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
