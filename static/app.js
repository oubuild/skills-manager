import { api, openExternal } from './api.js';
const { createApp, ref, computed, onMounted } = Vue;

// ---------- 平台注册表（与后端 AGENTS 对齐）----------
// icon: 单色 SVG path（24x24 viewBox, currentColor），fallback 用首字母色块
const PLATFORM_META = {
  hermes:      { label: 'Hermes',      group: 'Coding',  color: '#18181b' },
  claude:      { label: 'Claude',      group: 'Coding',  color: '#d97757' },
  codex:       { label: 'Codex',       group: 'Coding',  color: '#10a37f' },
  cursor:      { label: 'Cursor',      group: 'Coding',  color: '#3b82f6' },
  copilot:     { label: 'Copilot',     group: 'Coding',  color: '#6e7781' },
  gemini:      { label: 'Gemini',      group: 'Coding',  color: '#4285f4' },
  windsurf:    { label: 'Windsurf',    group: 'Coding',  color: '#14b8a6' },
  trae:        { label: 'Trae',        group: 'Coding',  color: '#ef4444' },
  'trae-cn':   { label: 'Trae CN',     group: 'Coding',  color: '#dc2626' },
  qwen:        { label: 'Qwen',        group: 'Coding',  color: '#7c3aed' },
  qoder:       { label: 'Qoder',       group: 'Coding',  color: '#0ea5e9' },
  augment:     { label: 'Augment',     group: 'Coding',  color: '#f59e0b' },
  opencode:    { label: 'OpenCode',    group: 'Coding',  color: '#22c55e' },
  kilocode:    { label: 'KiloCode',    group: 'Coding',  color: '#8b5cf6' },
  ob1:         { label: 'OB1',         group: 'Coding',  color: '#334155' },
  amp:         { label: 'Amp',         group: 'Coding',  color: '#111111' },
  kiro:        { label: 'Kiro',        group: 'Coding',  color: '#06b6d4' },
  codebuddy:   { label: 'CodeBuddy',   group: 'Coding',  color: '#2563eb' },
  aider:       { label: 'Aider',       group: 'Coding',  color: '#f97316' },
  factory:     { label: 'Factory',     group: 'Coding',  color: '#64748b' },
  junie:       { label: 'Junie',       group: 'Coding',  color: '#ec4899' },
  openclaw:    { label: 'OpenClaw 开爪',   group: 'Lobster', color: '#e11d48' },
  qclaw:       { label: 'QClaw 千爪',      group: 'Lobster', color: '#be123c' },
  easyclaw:    { label: 'EasyClaw 简爪',   group: 'Lobster', color: '#f43f5e' },
  'easyclaw-v2': { label: 'EasyClaw V2', group: 'Lobster', color: '#fb7185' },
  autoclaw:    { label: 'AutoClaw',    group: 'Lobster', color: '#9f1239' },
  workbuddy:   { label: 'WorkBuddy 打工搭子', group: 'Lobster', color: '#d946ef' },
  central:     { label: 'Central',     group: 'Central', color: '#a16207' },
};

// 各平台首字母（无 SVG logo 时渲染成圆角色块）
function platformInitial(key) {
  const meta = PLATFORM_META[key];
  return meta ? meta.label.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '').charAt(0).toUpperCase() : '?';
}

// ---------- Agent 徽章配色 ----------
const AGENT_COLORS = {
  Hermes: { bg: 'hsl(240 5.9% 10%)', fg: '#fff' },
  Claude: { bg: 'hsl(25 95% 53%)', fg: '#fff' },
  Codex: { bg: 'hsl(142 71% 45%)', fg: '#fff' },
  Cursor: { bg: 'hsl(217 91% 60%)', fg: '#fff' },
  Shared: { bg: 'hsl(262 83% 58%)', fg: '#fff' },
};

// ---------- 场景分类映射（与 SKILLS-INDEX.md 对齐） ----------
const SCENE_BY_CATEGORY = {
  research: 'Research',
  'data-science': 'Data',
  mlops: 'Data',
  'mlops/evaluation': 'Data',
  'mlops/inference': 'Data',
  'mlops/models': 'Data',
  apple: 'General',
  'smart-home': 'General',
  'note-taking': 'General',
  email: 'General',
  media: 'General',
  'social-media': 'General',
};
const SCENE_BY_NAME = {
  airtable: 'Data', notion: 'Data', 'google-workspace': 'Data', xlsx: 'Data', docx: 'Data',
  powerpoint: 'Data', pdf: 'Data', 'nano-pdf': 'Data', 'ocr-and-documents': 'Data',
  maps: 'Data', 'meeting-action-items': 'Data', 'document-to-action-items': 'Data',
  'teams-meeting-pipeline': 'Data', songsee: 'Data',
  'youtube-content': 'Research', xurl: 'Research', 'product-price-monitor': 'Research',
  'wechat-article-workflow': 'Writing', 'x-to-wechat': 'Writing',
  'yuwen-publish-precheck': 'Writing', humanizer: 'Writing',
  'technical-project-documentation': 'Writing', 'baoyu-infographic': 'Writing',
  'personal-ip-skill': 'Writing', 'songwriting-and-ai-music': 'Writing', heartmula: 'Writing',
  dogfood: 'Browser', 'hermes-desktop-ui-diagnostics': 'Browser',
  'inspecting-hermes-desktop-dom': 'Browser',
  'hermes-agent': 'General', 'install-external-skill': 'General', 'find-skills': 'General',
  'writing-skills': 'General', 'computer-use': 'General', petdex: 'General',
  'petdex-custom-pets': 'General', 'hatch-pet': 'General', himalaya: 'General',
  'email-inbox-triage': 'General', obsidian: 'General', openhue: 'General', yuanbao: 'General',
  'remove-bg': 'General', 'weekly-review-planning': 'General', 'i-have-adhd': 'General',
  'ascii-art': 'General', 'ascii-video': 'General', 'manim-video': 'General',
  comfyui: 'General', 'touchdesigner-mcp': 'General',
};
const SCENE_ORDER = ['Coding', 'Research', 'Writing', 'Browser', 'Data', 'General'];
const SCENE_ICONS = { Coding: '⌘', Research: '◈', Writing: '✎', Browser: '◎', Data: '◆', General: '●' };

function sceneOf(skill) {
  return SCENE_BY_NAME[skill.name] || SCENE_BY_CATEGORY[skill.category] || 'Coding';
}

// ---------- 主应用 ----------
createApp({
  setup() {
    const skills = ref([]);
    const loading = ref(true);
    const error = ref('');
    const search = ref('');
    const activeScene = ref('');
    const activeCategory = ref('');
    const detail = ref(null);
    const detailLoading = ref(false);
    const detailTab = ref('doc');   // doc / files / stats
    const updates = ref(null);
    const updatesLoading = ref(false);
    const installDialog = ref(false);
    const installInput = ref('');
    const installResult = ref(null);
    const installLoading = ref(false);
    const deleteTarget = ref(null);   // skill 对象（多源时弹选择）
    const deleteAgent = ref('');      // 已选定要删的源
    const deleteLoading = ref(false);
    const updateDialog = ref(false);  // 更新面板
    const updateResult = ref(null);   // 更新结果 {ok, name, stdout, stderr}
    const updatingName = ref('');     // 正在更新的 skill（空=全部）
    const updating = ref(false);      // 是否正在执行更新
    const toast = ref(null);
    let toastTimer = null;
     const sources = ref([]);          // 各 agent 源统计（后端 /api/skills.sources）
    const activeAgents = ref([]);     // 已选 agent 筛选（空 = 全部）
    const showPinned = ref(false);    // 只看已固定
    const showArchived = ref(false);  // 只看已停用

    // ---------- 暗色模式 ----------
    const isDark = ref(localStorage.getItem('theme') === 'dark');
    function applyTheme() {
      document.documentElement.classList.toggle('dark', isDark.value);
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
    }
    function toggleTheme() {
      isDark.value = !isDark.value;
      applyTheme();
    }
    applyTheme();

    // ---------- 当前版本号 ----------
    const appVersion = ref('');

    const showToast = (msg, type = 'success') => {
      toast.value = { msg, type };
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.value = null, 3000);
    };

    const agentStyle = (agent) => {
      const meta = PLATFORM_META[agent.toLowerCase().replace(/ /g, '-')];
      if (meta) return { background: meta.color, color: '#fff' };
      const c = AGENT_COLORS[agent] || { bg: 'hsl(240 5% 60%)', fg: '#fff' };
      return { background: c.bg, color: c.fg };
    };

    // ---------- 平台列表：展开全部 / 隐藏空平台 ----------
    const showAllPlatforms = ref(localStorage.getItem('showAllPlatforms') === '1');
    const hideEmptyPlatforms = ref(localStorage.getItem('hideEmptyPlatforms') === '1');
    function toggleShowAllPlatforms() {
      showAllPlatforms.value = !showAllPlatforms.value;
      localStorage.setItem('showAllPlatforms', showAllPlatforms.value ? '1' : '0');
    }
    function toggleHideEmptyPlatforms() {
      hideEmptyPlatforms.value = !hideEmptyPlatforms.value;
      localStorage.setItem('hideEmptyPlatforms', hideEmptyPlatforms.value ? '1' : '0');
    }
    // 侧边栏实际显示的平台列表
    const visiblePlatforms = computed(() => {
      let list = sources.value;
      if (!showAllPlatforms.value) list = list.filter(s => s.count > 0);
      else if (hideEmptyPlatforms.value) list = list.filter(s => s.count > 0);
      return list;
    });
    // 展开全部时才可能出现 count=0 的平台
    const hasEmptyPlatforms = computed(() => sources.value.some(s => s.count === 0));

    // ---------- 数据加载 ----------
    async function loadSkills() {
      loading.value = true;
      error.value = '';
      try {
        const d = await api('get_skills');
        if (d.error) throw new Error(d.error);
        skills.value = d.skills.map(s => ({ ...s, scene: sceneOf(s) }));
         sources.value = d.sources || [];
        if (d.warning) console.warn('[skills] ' + d.warning);
      } catch (e) {
        error.value = '加载失败: ' + (e?.message || e?.error || e);
      } finally {
        loading.value = false;
      }
    }

    async function checkUpdates(openDialog = true) {
      updatesLoading.value = true;
      try {
        updates.value = await api('check_updates');
        if (openDialog) openUpdateDialog();
      } catch (e) {
        // Tauri invoke 的错误是 {error: "..."} 对象或纯字符串，不是 Error 实例
        const msg = e?.message || e?.error || (typeof e === 'string' ? e : String(e));
        showToast('检查更新失败: ' + msg, 'error');
      } finally {
        updatesLoading.value = false;
      }
    }

    function openUpdateDialog() {
      updateDialog.value = true;
      updateResult.value = null;
      updatingName.value = '';
    }

    async function doUpdate(name) {
      updatingName.value = name || '';
      updating.value = true;
      updateResult.value = null;
      try {
        updateResult.value = await api('update_skill', { name: name || '' });
        if (updateResult.value.ok) {
          showToast(name ? `已更新 ${name}` : '已更新全部过期 skill');
          await loadSkills();
          // 静默重查，刷新顶部待更新数
          updates.value = await api('check_updates');
        }
      } catch (e) {
        updateResult.value = { ok: false, stderr: e?.message || e?.error || e };
      } finally {
        updatingName.value = '';
        updating.value = false;
      }
    }

    // ---------- 详情 ----------
    async function openDetail(s) {
      detailLoading.value = true;
      detailTab.value = 'doc';
      detail.value = { ...s, content: '', files: {} };
      try {
        const d = await api('get_skill_detail', { id: s.id });
        if (d.error) throw new Error(d.error);
        detail.value = { ...s, content: d.content, files: d.files };
      } catch (e) {
        showToast('加载详情失败: ' + (e?.message || e?.error || e), 'error');
        detail.value = null;
      } finally {
        detailLoading.value = false;
      }
    }

    const renderedDoc = computed(() => {
      if (!detail.value?.content) return '';
      const text = detail.value.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
      return marked.parse(text);
    });

    // 未安装该 skill 的源（用于「链接到」按钮）
    const linkTargets = computed(() => {
      if (!detail.value) return [];
      return ['Hermes', 'Claude', 'Codex', 'Cursor'].filter(a => !detail.value.agents.includes(a));
    });

    async function linkTo(agent) {
      if (!detail.value) return;
      try {
        const d = await api('link_skill', { id: detail.value.id, agent });
        if (d.error) throw new Error(d.error);
        showToast(`已链接到 ${agent}`);
        await loadSkills();
        const fresh = skills.value.find(x => x.id === detail.value.id);
        if (fresh) detail.value = { ...fresh, content: detail.value.content, files: detail.value.files };
      } catch (e) {
        showToast('链接失败: ' + (e?.message || e?.error || e), 'error');
      }
    }

    // ---------- 操作 ----------
    async function togglePin(s, ev) {
      ev?.stopPropagation();
      try {
        const d = await api('toggle_pin', { id: s.id });
        if (d.error) throw new Error(d.error);
        s.pinned = d.pinned;
        if (detail.value?.id === s.id) detail.value.pinned = d.pinned;
        showToast(d.pinned ? `已固定 ${s.name}` : `已取消固定 ${s.name}`);
      } catch (e) {
        showToast('操作失败: ' + (e?.message || e?.error || e), 'error');
      }
    }

    async function toggleState(s, ev) {
      ev?.stopPropagation();
      const target = s.state === 'active' ? 'archived' : 'active';
      try {
        const d = await api('set_state', { id: s.id, state: target });
        if (d.error) throw new Error(d.error);
        s.state = d.state;
        if (detail.value?.id === s.id) detail.value.state = d.state;
        showToast(d.state === 'active' ? `已启用 ${s.name}` : `已停用 ${s.name}`);
      } catch (e) {
        showToast('操作失败: ' + (e?.message || e?.error || e), 'error');
      }
    }

    function askDelete(s) {
      deleteTarget.value = s;
      deleteAgent.value = s.links?.length === 1 ? s.links[0].agent : '';
    }

    async function confirmDelete() {
      const s = deleteTarget.value;
      const agent = deleteAgent.value;
      if (!s || !agent) return;
      deleteLoading.value = true;
      try {
        const d = await api('delete_skill', { id: s.id, confirm: true, agent });
        if (d.error) throw new Error(d.error);
        if (d.warning) showToast(d.warning, 'warn');
        await loadSkills();
        const fresh = skills.value.find(x => x.id === s.id);
        if (detail.value?.id === s.id) {
          if (fresh) detail.value = fresh; else detail.value = null;
        }
        showToast(`已从 ${agent} 删除 ${s.name}（${d.method}）`);
        deleteTarget.value = null;
        deleteAgent.value = '';
      } catch (e) {
        showToast('删除失败: ' + (e?.message || e?.error || e), 'error');
      } finally {
        deleteLoading.value = false;
      }
    }

    async function doInstall() {
      if (!installInput.value.trim()) return;
      installLoading.value = true;
      installResult.value = null;
      try {
        installResult.value = await api('install_skill', { identifier: installInput.value.trim() });
        if (installResult.value.ok) {
          showToast('安装成功');
          installInput.value = '';
          await loadSkills();
        }
      } catch (e) {
        installResult.value = { ok: false, stderr: e?.message || e?.error || e };
      } finally {
        installLoading.value = false;
      }
    }

    // ---------- 计算属性 ----------
    const scenes = computed(() => {
      const map = new Map();
      for (const s of skills.value) {
        if (!map.has(s.scene)) map.set(s.scene, new Set());
        if (s.category) map.get(s.scene).add(s.category);
      }
      return SCENE_ORDER.filter(sc => map.has(sc)).map(sc => ({
        name: sc,
        count: skills.value.filter(s => s.scene === sc).length,
        categories: [...map.get(sc)].sort(),
      }));
    });

    const filtered = computed(() => {
      let list = skills.value;
      if (activeScene.value) list = list.filter(s => s.scene === activeScene.value);
      if (activeCategory.value) list = list.filter(s => s.category === activeCategory.value);
       if (activeAgents.value.length) {
        list = list.filter(s => activeAgents.value.some(a => s.agents.includes(a)));
      }
      if (showPinned.value) list = list.filter(s => s.pinned);
      if (showArchived.value) list = list.filter(s => s.state === 'archived');
      const q = search.value.trim().toLowerCase();
      if (q) {
        list = list.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q)
        );
      }
      return [...list].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.state !== b.state) return a.state === 'active' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    });

    const stats = computed(() => ({
      total: skills.value.length,
      pinned: skills.value.filter(s => s.pinned).length,
      archived: skills.value.filter(s => s.state === 'archived').length,
      updateCount: updates.value?.count ?? null,
    }));

    function selectScene(sc) {
      if (activeScene.value === sc) {
        activeScene.value = ''; activeCategory.value = '';
      } else {
        activeScene.value = sc; activeCategory.value = '';
      }
    }
     function toggleAgent(a) {
       const i = activeAgents.value.indexOf(a);
       if (i >= 0) activeAgents.value.splice(i, 1);
       else activeAgents.value.push(a);
     }
    function selectCategory(sc, cat) {
      activeScene.value = sc;
      activeCategory.value = activeCategory.value === cat ? '' : cat;
    }

    // ---------- 应用自更新（Tauri updater 插件，仅桌面端可用） ----------
    const appUpdate = ref(null);        // { version, body } 或 null
    const appUpdateChecking = ref(false);
    const appUpdateDownloading = ref(false);
    const appUpdateProgress = ref(0);   // 0-100
    const inTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

    async function checkAppUpdate() {
      if (!inTauri) { showToast('网页模式不支持应用更新', 'warn'); return; }
      appUpdateChecking.value = true;
      try {
        const { check } = await import('./ota.js');
        const u = await check();
        if (u) {
          appUpdate.value = { version: u.version, body: u.body || '' };
          showToast(`发现新版本 v${u.version}`);
        } else {
          appUpdate.value = null;
          showToast('已是最新版本');
        }
      } catch (e) {
        showToast('检查应用更新失败: ' + (e?.message || e?.error || e), 'error');
      } finally {
        appUpdateChecking.value = false;
      }
    }

    async function installAppUpdate() {
      if (!appUpdate.value || appUpdateDownloading.value) return;
      appUpdateDownloading.value = true;
      appUpdateProgress.value = 0;
      try {
        const { check } = await import('./ota.js');
        const { relaunch } = await import('./ota.js');
        const u = await check();
        if (!u) return;
        let contentLength = 0, received = 0;
        await u.downloadAndInstall((evt) => {
          if (evt.event === 'Started') contentLength = evt.data.contentLength || 0;
          else if (evt.event === 'Progress') {
            received += evt.data.chunkLength;
            if (contentLength > 0) appUpdateProgress.value = Math.round(received * 100 / contentLength);
          }
        });
        // 安装完成后重启（updater 替换二进制）
        await relaunch();
      } catch (e) {
        showToast('更新失败: ' + (e?.message || e?.error || e), 'error');
        appUpdateDownloading.value = false;
      }
    }

    onMounted(() => {
      loadSkills();
      checkUpdates(false);
      // 读取应用版本号：桌面端走 Tauri API，网页端走后端接口
      if (inTauri) {
        const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke === 'function') {
          invoke('plugin:app|version').then(v => appVersion.value = v).catch(() => {});
        }
      } else {
        fetch('/api/app_version').then(r => r.json())
          .then(d => appVersion.value = d.version || '').catch(() => {});
      }
    });

    return {
      skills, loading, error, search, activeScene, activeCategory,
      sources, activeAgents, toggleAgent, showPinned, showArchived,
      detail, detailLoading, detailTab, renderedDoc, linkTargets, linkTo,
      updates, updatesLoading, installDialog, installInput, installResult, installLoading,
      updateDialog, updateResult, updatingName, updating, doUpdate, openUpdateDialog,
      deleteTarget, deleteAgent, deleteLoading, toast,
      scenes, filtered, stats,
      selectScene, selectCategory, agentStyle,
      openDetail, togglePin, toggleState, askDelete, confirmDelete, doInstall, checkUpdates,
      closeDetail: () => detail.value = null,
      closeDelete: () => { deleteTarget.value = null; deleteAgent.value = ''; },
      openExternal,
      appUpdate, appUpdateChecking, appUpdateDownloading, appUpdateProgress, inTauri,
      checkAppUpdate, installAppUpdate,
      isDark, toggleTheme, appVersion,
      showAllPlatforms, hideEmptyPlatforms, toggleShowAllPlatforms, toggleHideEmptyPlatforms,
      visiblePlatforms, hasEmptyPlatforms, platformInitial,
      SCENE_ICONS,
    };
  },

  template: `
  <div class="h-screen flex flex-col overflow-hidden">
    <!-- Header -->
    <header class="border-b sticky top-0 z-40 bg-background/95 backdrop-blur">
      <div class="px-6 h-14 flex items-center gap-4">
        <h1 class="text-base font-semibold tracking-tight flex items-center gap-2 shrink-0">
          <span class="text-lg">⬡</span> Skills Manager
        </h1>
        <div class="absolute left-1/2 -translate-x-1/2 w-72">
          <input v-model="search" class="input w-full" placeholder="搜索 skill 名称或描述…" />
        </div>
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <button class="btn btn-outline btn-sm" @click="checkUpdates()" :disabled="updatesLoading">
            {{ updatesLoading ? '检查中…' : '检查更新' }}
            <span v-if="updates && updates.count > 0" class="badge badge-destructive ml-1">{{ updates.count }}</span>
          </button>
          <button class="btn btn-default btn-sm" @click="installDialog = true">+ 安装 Skill</button>
          <a href="https://github.com/oubuild/skills-manager" @click.prevent="openExternal('https://github.com/oubuild/skills-manager')"
             class="btn btn-outline btn-icon" title="在 GitHub 上查看此项目" aria-label="GitHub 仓库">
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path>
            </svg>
          </a>
        </div>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Sidebar -->
      <aside class="w-56 border-r p-4 shrink-0 flex flex-col min-h-0">
         <div class="flex-1 overflow-y-auto scrollbar-thin min-h-0">
         <div class="text-xs font-medium text-muted-foreground mb-2 px-2 flex items-center">
           平台
           <button class="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                   @click="toggleShowAllPlatforms()"
                   :title="showAllPlatforms ? '只显示有 skills 的平台' : '展开全部已安装平台'">
             {{ showAllPlatforms ? '收起' : '展开全部' }}
           </button>
         </div>
         <div v-if="showAllPlatforms && hasEmptyPlatforms" class="flex items-center gap-2 px-2 mb-2">
           <span class="text-[11px] text-muted-foreground">隐藏空平台</span>
           <span class="switch ml-auto" :data-on="hideEmptyPlatforms" style="transform:scale(.8)"
                 @click="toggleHideEmptyPlatforms()"></span>
         </div>
         <button
           class="w-full text-left px-2 py-1.5 rounded-md text-sm mb-1 transition-colors"
           :class="!activeAgents.length ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
           @click="activeAgents = []">
           全部
         </button>
         <div class="space-y-1 mb-3">
           <button v-for="src in visiblePlatforms" :key="src.agent"
             class="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2"
             :class="activeAgents.includes(src.agent) ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
             @click="toggleAgent(src.agent)">
             <!-- 图标：首字母圆角色块 -->
             <span class="shrink-0 inline-flex items-center justify-center rounded w-4 h-4 text-[9px] font-bold text-white"
                   :style="{ background: agentStyle(src.agent).background }">{{ platformInitial(src.icon) }}</span>
             <span class="truncate">{{ src.agent }}</span>
             <span class="ml-auto text-xs shrink-0"
                   :class="src.count > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'">{{ src.count }}</span>
           </button>
         </div>
        <div class="text-xs font-medium text-muted-foreground mb-2 px-2">场景分类</div>
        <button
          class="w-full text-left px-2 py-1.5 rounded-md text-sm mb-1 transition-colors"
          :class="!activeScene ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
          @click="selectScene('')">
          全部 <span class="text-muted-foreground">({{ skills.length }})</span>
        </button>
        <div v-for="sc in scenes" :key="sc.name" class="mb-1">
          <button
            class="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2"
            :class="activeScene === sc.name && !activeCategory ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
            @click="selectScene(sc.name)">
            <span class="text-muted-foreground w-4">{{ SCENE_ICONS[sc.name] }}</span>
            {{ sc.name }}
            <span class="ml-auto text-xs text-muted-foreground">{{ sc.count }}</span>
          </button>
          <div v-if="activeScene === sc.name" class="ml-6 mt-0.5 space-y-0.5">
            <button v-for="cat in sc.categories" :key="cat"
              class="w-full text-left px-2 py-1 rounded text-xs transition-colors"
              :class="activeCategory === cat ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-secondary/60'"
              @click="selectCategory(sc.name, cat)">
              {{ cat }}
            </button>
          </div>
        </div>
         </div><!-- /菜单滚动区 -->

        <!-- 底部：暗色模式 + 应用版本/更新（固定不随菜单滚动） -->
        <div class="pt-3 border-t space-y-1 shrink-0">
          <button
            class="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 hover:bg-secondary/60"
            @click="toggleTheme">
            <span class="text-muted-foreground w-4">{{ isDark ? '🌙' : '☀️' }}</span>
            {{ isDark ? '深色模式' : '浅色模式' }}
            <span class="switch ml-auto" :data-on="isDark" style="pointer-events:none"></span>
          </button>
          <button
            class="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 hover:bg-secondary/60"
            :disabled="appUpdateChecking || appUpdateDownloading"
            @click="checkAppUpdate()">
            <span class="text-muted-foreground w-4">⬡</span>
            <span class="font-mono text-xs">v{{ appVersion || '…' }}</span>
            <!-- 有新版本时右侧显示可更新图标 -->
            <span v-if="appUpdate" class="ml-auto badge badge-destructive animate-pulse" title="有新版本">↑ 可更新</span>
            <span v-else-if="appUpdateChecking" class="ml-auto text-xs text-muted-foreground">检查中…</span>
          </button>
        </div>
      </aside>

      <!-- Main -->
      <main class="flex-1 overflow-y-auto scrollbar-thin p-6 min-h-0">
        <!-- Stats -->
        <div class="text-xs text-muted-foreground mb-3">
          共 <span class="font-semibold text-foreground">{{ stats.total }}</span> 个技能，
          覆盖 <span class="font-semibold text-foreground">{{ sources.length }}</span> 个 Agent
        </div>
        <div class="grid grid-cols-3 gap-3 mb-6">
          <div class="card p-4 cursor-pointer"
               :class="showPinned ? 'ring-2' : 'hover:ring-1'"
               style="--tw-ring-color: hsl(var(--ring));"
               @click="showPinned = !showPinned">
            <div class="text-2xl font-semibold">{{ stats.pinned }}</div>
            <div class="text-xs text-muted-foreground mt-1">已固定</div>
          </div>
          <div class="card p-4 cursor-pointer"
               :class="showArchived ? 'ring-2' : 'hover:ring-1'"
               style="--tw-ring-color: hsl(var(--ring));"
               @click="showArchived = !showArchived">
            <div class="text-2xl font-semibold">{{ stats.archived }}</div>
            <div class="text-xs text-muted-foreground mt-1">已停用</div>
          </div>
          <div class="card p-4"><div class="text-2xl font-semibold">{{ stats.updateCount ?? '—' }}</div>
            <div class="text-xs text-muted-foreground mt-1">待更新（Hermes）</div></div>
        </div>

        <hr class="mb-6 border-border" />

        <!-- 状态 -->
        <div v-if="loading" class="text-center py-20 text-muted-foreground">加载中…</div>
        <div v-else-if="error" class="text-center py-20 text-destructive">{{ error }}</div>
        <div v-else-if="!filtered.length" class="text-center py-20 text-muted-foreground">
          没有匹配的 skill
        </div>

        <!-- 卡片网格 -->
        <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
          <div v-for="s in filtered" :key="s.id"
               class="card card-hover p-4 flex flex-col gap-2"
               :class="{ 'opacity-60': s.state === 'archived' }"
               @click="openDetail(s)">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate flex items-center gap-1.5">
                  <span v-if="s.pinned" title="已固定">📌</span>{{ s.name }}
                </div>
                <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span class="badge badge-secondary">{{ s.scene }}</span>
                  <span v-if="s.category" class="badge badge-outline">{{ s.category }}</span>
                  <span v-if="s.state === 'archived'" class="badge badge-destructive">已停用</span>
                </div>
              </div>
              <div class="flex gap-0.5 shrink-0" @click.stop>
                <button class="btn btn-ghost btn-sm btn-icon" :title="s.pinned ? '取消固定' : '固定'"
                        @click="togglePin(s)">{{ s.pinned ? '📌' : '📍' }}</button>
                <button class="btn btn-ghost btn-sm btn-icon"
                        :class="s.state === 'active' ? '' : 'text-destructive'"
                        :title="s.state === 'active' ? '停用' : '启用'"
                        @click="toggleState(s)">
                  <span class="switch" :data-on="s.state === 'active'" style="pointer-events:none; transform:scale(.85)"></span>
                </button>
                <button class="btn btn-ghost btn-sm btn-icon" title="删除"
                        @click="askDelete(s)">🗑</button>
              </div>
            </div>
            <p class="text-xs text-muted-foreground line-clamp-2 leading-relaxed flex-1">
              {{ s.description || '(无描述)' }}
            </p>
            <div class="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
              <span class="flex items-center gap-1">
                <span v-for="a in s.agents" :key="a" class="agent-pill" :style="agentStyle(a)"
                      :title="a">{{ a }}</span>
              </span>
              <span>使用 {{ s.use_count }} 次</span>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 详情 Sheet -->
    <template v-if="detail">
      <div class="sheet-overlay" @click="closeDetail"></div>
      <div class="sheet">
        <div class="p-6 border-b sticky top-0 bg-background z-10">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <h2 class="text-xl font-semibold flex items-center gap-2">
                <span v-if="detail.pinned">📌</span>{{ detail.name }}
              </h2>
              <div class="flex items-center gap-2 mt-2 flex-wrap">
                <span class="badge badge-secondary">{{ detail.scene }}</span>
                <span v-if="detail.category" class="badge badge-outline">{{ detail.category }}</span>
                <span v-for="a in detail.agents" :key="a" class="agent-pill" :style="agentStyle(a)">{{ a }}</span>
                <span v-if="detail.state === 'archived'" class="badge badge-destructive">已停用</span>
              </div>
            </div>
            <div class="flex gap-1">
              <button class="btn btn-outline btn-sm" @click="togglePin(detail)">
                {{ detail.pinned ? '取消固定' : '固定' }}
              </button>
              <button class="btn btn-outline btn-sm" @click="toggleState(detail)">
                {{ detail.state === 'active' ? '停用' : '启用' }}
              </button>
              <button class="btn btn-destructive btn-sm" @click="askDelete(detail)">删除</button>
              <button class="btn btn-ghost btn-sm btn-icon" @click="closeDetail">✕</button>
            </div>
          </div>
          <div class="tabs-list mt-4">
            <button class="tabs-trigger" :data-active="detailTab === 'doc'" @click="detailTab = 'doc'">说明</button>
            <button class="tabs-trigger" :data-active="detailTab === 'files'" @click="detailTab = 'files'">
              关联文件 ({{ Object.keys(detail.files || {}).length }})
            </button>
            <button class="tabs-trigger" :data-active="detailTab === 'stats'" @click="detailTab = 'stats'">统计</button>
          </div>
        </div>
        <div class="p-6">
          <div v-if="detailLoading" class="text-center py-10 text-muted-foreground">加载中…</div>
          <template v-else>
            <div v-if="detailTab === 'doc'" class="md" v-html="renderedDoc"></div>
            <div v-else-if="detailTab === 'files'">
              <div v-if="!Object.keys(detail.files || {}).length" class="text-sm text-muted-foreground py-8 text-center">
                无关联文件
              </div>
              <details v-for="(content, path) in detail.files" :key="path" class="mb-2 card">
                <summary class="px-3 py-2 cursor-pointer text-sm font-mono hover:bg-secondary/60 rounded-lg">{{ path }}</summary>
                <pre class="px-3 pb-3 text-xs overflow-x-auto scrollbar-thin"><code>{{ content }}</code></pre>
              </details>
            </div>
            <div v-else class="space-y-3">
              <div class="card p-4"><div class="text-xs text-muted-foreground">安装分布（{{ detail.agents.length }} 个源）</div>
                <div class="mt-2 space-y-1.5">
                  <div v-for="l in detail.links" :key="l.agent + l.path"
                       class="flex items-center gap-2 text-xs font-mono">
                    <span class="agent-pill shrink-0" :style="agentStyle(l.agent)">{{ l.agent }}</span>
                    <span class="break-all text-muted-foreground">{{ l.path }}</span>
                    <span v-if="l.is_symlink" class="badge badge-outline shrink-0">软链</span>
                  </div>
                </div>
                <div v-if="linkTargets.length" class="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                  <span class="text-xs text-muted-foreground">链接到：</span>
                  <button v-for="a in linkTargets" :key="a" class="btn btn-outline btn-sm"
                          @click="linkTo(a)">+ {{ a }}</button>
                </div>
              </div>
              <div class="card p-4"><div class="text-xs text-muted-foreground">使用次数</div>
                <div class="text-xl font-semibold mt-1">{{ detail.use_count }}</div></div>
              <div class="card p-4"><div class="text-xs text-muted-foreground">浏览次数</div>
                <div class="text-xl font-semibold mt-1">{{ detail.view_count }}</div></div>
              <div class="card p-4"><div class="text-xs text-muted-foreground">最近使用</div>
                <div class="text-sm mt-1">{{ detail.last_used_at || '从未' }}</div></div>
              <div class="card p-4"><div class="text-xs text-muted-foreground">安装时间</div>
                <div class="text-sm mt-1">{{ detail.created_at || '—' }}</div></div>
              <div class="card p-4"><div class="text-xs text-muted-foreground">真身路径</div>
                <div class="text-xs font-mono mt-1 break-all">{{ detail.path }}</div></div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- 删除确认 -->
    <template v-if="deleteTarget">
      <div class="dialog-overlay" @click="closeDelete"></div>
      <div class="dialog">
        <h3 class="text-base font-semibold mb-2">确认删除</h3>
        <p class="text-sm text-muted-foreground mb-3">
          skill：<span class="font-mono text-foreground">{{ deleteTarget.name }}</span>
          <span v-if="deleteTarget.links.length > 1">存在于 {{ deleteTarget.links.length }} 个源，选择要移除的源：</span>
        </p>
        <div class="space-y-2 mb-4">
          <label v-for="l in deleteTarget.links" :key="l.agent"
                 class="card p-3 flex items-center gap-3 cursor-pointer"
                 :class="deleteAgent === l.agent ? 'ring-2 ring-offset-1' : ''"
                 style="--tw-ring-color: hsl(var(--ring));">
            <input type="radio" :value="l.agent" v-model="deleteAgent" class="accent-current" />
            <span class="agent-pill shrink-0" :style="agentStyle(l.agent)">{{ l.agent }}</span>
            <span class="text-xs font-mono text-muted-foreground break-all flex-1">{{ l.path }}</span>
            <span v-if="l.is_symlink" class="badge badge-outline shrink-0">软链</span>
          </label>
        </div>
        <p v-if="deleteTarget.links.length > 1 && deleteAgent" class="text-xs text-amber-600 mb-4">
          ⚠ 若删除的是被其他源软链引用的真身目录，其余软链将失效。
        </p>
        <div class="flex justify-end gap-2">
          <button class="btn btn-outline btn-sm" @click="closeDelete">取消</button>
          <button class="btn btn-destructive btn-sm" @click="confirmDelete"
                  :disabled="deleteLoading || !deleteAgent">
            {{ deleteLoading ? '删除中…' : ('确认删除' + (deleteAgent ? '（' + deleteAgent + '）' : '')) }}
          </button>
        </div>
      </div>
    </template>

    <!-- 更新 Dialog -->
    <template v-if="updateDialog">
      <div class="dialog-overlay" @click="updateDialog = false; updateResult = null"></div>
      <div class="dialog" style="width:min(40rem, calc(100vw - 2rem))">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-base font-semibold">更新 Skill</h3>
          <button v-if="updates && updates.count > 0 && !updateResult"
                  class="btn btn-default btn-sm" @click="doUpdate('')" :disabled="updating">
            {{ updating ? '更新中…' : '更新全部' }}
          </button>
        </div>

        <template v-if="!updateResult">
          <p v-if="updates && updates.count > 0" class="text-sm text-muted-foreground mb-1">
            发现 {{ updates.count }} 个可更新的 skill：
          </p>
          <div v-if="updates && updates.count > 0" class="space-y-2 mb-4 mt-2">
            <div v-for="u in updates.updates" :key="u.name"
                 class="card p-3 flex items-center gap-3">
              <span class="font-mono text-sm flex-1">{{ u.name }}</span>
              <span class="badge badge-outline">{{ u.source }}</span>
              <span class="badge badge-destructive">可更新</span>
              <button class="btn btn-default btn-sm shrink-0" @click="doUpdate(u.name)"
                      :disabled="updating">
                {{ updatingName === u.name ? '更新中…' : '更新' }}
              </button>
            </div>
          </div>
          <div v-else class="text-sm text-muted-foreground py-6 text-center">
            所有 skill 已是最新 ✓
          </div>
        </template>

        <template v-else>
          <div class="mb-3 p-3 rounded-md text-xs font-mono whitespace-pre-wrap max-h-56 overflow-y-auto scrollbar-thin"
               :class="updateResult.ok ? 'bg-secondary' : 'bg-red-50 text-red-900 border border-red-200'">
            {{ updateResult.ok ? (updateResult.stdout || '更新完成') : (updateResult.stderr || updateResult.error) }}
          </div>
        </template>

        <div class="flex justify-end gap-2 mt-4">
          <button class="btn btn-outline btn-sm" @click="updateDialog = false; updateResult = null">关闭</button>
        </div>
      </div>
    </template>

    <!-- 安装 Dialog -->
    <template v-if="installDialog">
      <div class="dialog-overlay" @click="installDialog = false; installResult = null"></div>
      <div class="dialog" style="width:min(36rem, calc(100vw - 2rem))">
        <h3 class="text-base font-semibold mb-2">安装 Skill</h3>
        <p class="text-xs text-muted-foreground mb-3">
          支持 <span class="font-mono">org/repo/skill-name</span> 或 SKILL.md 直链 URL，通过 <span class="font-mono">hermes skills install</span> 安装到 Hermes 源。
        </p>
        <input v-model="installInput" class="input mb-3" placeholder="openai/skills/skill-creator"
               @keyup.enter="doInstall" />
        <div v-if="installResult" class="mb-3 p-3 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto scrollbar-thin"
             :class="installResult.ok ? 'bg-secondary' : 'bg-red-50 text-red-900 border border-red-200'">
          {{ installResult.ok ? installResult.stdout : (installResult.stderr || installResult.error) }}
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-outline btn-sm" @click="installDialog = false; installResult = null">关闭</button>
          <button class="btn btn-default btn-sm" @click="doInstall" :disabled="installLoading || !installInput.trim()">
            {{ installLoading ? '安装中…' : '安装' }}
          </button>
        </div>
      </div>
    </template>

    <!-- 应用更新 Dialog -->
    <template v-if="appUpdate">
      <div class="dialog-overlay" @click="!appUpdateDownloading && (appUpdate = null)"></div>
      <div class="dialog">
        <h3 class="text-base font-semibold mb-2">发现新版本 v{{ appUpdate.version }}</h3>
        <p v-if="appUpdate.body" class="text-sm text-muted-foreground mb-3 whitespace-pre-wrap">{{ appUpdate.body }}</p>
        <div v-if="appUpdateDownloading" class="mb-4">
          <div class="h-2 rounded-full bg-secondary overflow-hidden">
            <div class="h-full bg-zinc-900 transition-all" :style="{ width: appUpdateProgress + '%' }"></div>
          </div>
          <p class="text-xs text-muted-foreground mt-1">下载中… {{ appUpdateProgress }}%</p>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-outline btn-sm" @click="appUpdate = null" :disabled="appUpdateDownloading">稍后</button>
          <button class="btn btn-default btn-sm" @click="installAppUpdate()" :disabled="appUpdateDownloading">
            {{ appUpdateDownloading ? '更新中…' : '立即更新并重启' }}
          </button>
        </div>
      </div>
    </template>

    <!-- Toast -->
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-md text-sm shadow-lg"
         :class="toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'warn' ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-white'"
         style="animation: slideIn .15s">
      {{ toast.msg }}
    </div>
  </div>
  `,
}).mount('#app');
