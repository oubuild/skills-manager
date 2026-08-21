const { createApp, ref, computed, onMounted } = Vue;

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
    const toast = ref(null);
    let toastTimer = null;
     const sources = ref([]);          // 各 agent 源统计（后端 /api/skills.sources）
     const activeAgents = ref([]);     // 已选 agent 筛选（空 = 全部）

    const showToast = (msg, type = 'success') => {
      toast.value = { msg, type };
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.value = null, 3000);
    };

    const agentStyle = (agent) => {
      const c = AGENT_COLORS[agent] || { bg: 'hsl(240 5% 60%)', fg: '#fff' };
      return { background: c.bg, color: c.fg };
    };

    // ---------- 数据加载 ----------
    async function loadSkills() {
      loading.value = true;
      error.value = '';
      try {
        const r = await fetch('/api/skills');
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        skills.value = d.skills.map(s => ({ ...s, scene: sceneOf(s) }));
         sources.value = d.sources || [];
        if (d.warning) showToast(d.warning, 'warn');
      } catch (e) {
        error.value = '加载失败: ' + e.message;
      } finally {
        loading.value = false;
      }
    }

    async function checkUpdates() {
      updatesLoading.value = true;
      try {
        const r = await fetch('/api/updates');
        updates.value = await r.json();
      } catch (e) {
        showToast('检查更新失败: ' + e.message, 'error');
      } finally {
        updatesLoading.value = false;
      }
    }

    // ---------- 详情 ----------
    async function openDetail(s) {
      detailLoading.value = true;
      detailTab.value = 'doc';
      detail.value = { ...s, content: '', files: {} };
      try {
        const r = await fetch('/api/skills/' + encodeURIComponent(s.id));
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        detail.value = { ...s, content: d.content, files: d.files };
      } catch (e) {
        showToast('加载详情失败: ' + e.message, 'error');
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
        const r = await fetch('/api/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: detail.value.id, agent }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        showToast(`已链接到 ${agent}`);
        await loadSkills();
        const fresh = skills.value.find(x => x.id === detail.value.id);
        if (fresh) detail.value = { ...fresh, content: detail.value.content, files: detail.value.files };
      } catch (e) {
        showToast('链接失败: ' + e.message, 'error');
      }
    }

    // ---------- 操作 ----------
    async function togglePin(s, ev) {
      ev?.stopPropagation();
      try {
        const r = await fetch(`/api/skills/${encodeURIComponent(s.id)}/pin`, { method: 'POST' });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        s.pinned = d.pinned;
        if (detail.value?.id === s.id) detail.value.pinned = d.pinned;
        showToast(d.pinned ? `已固定 ${s.name}` : `已取消固定 ${s.name}`);
      } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
      }
    }

    async function toggleState(s, ev) {
      ev?.stopPropagation();
      const target = s.state === 'active' ? 'archived' : 'active';
      try {
        const r = await fetch(`/api/skills/${encodeURIComponent(s.id)}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: target }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        s.state = d.state;
        if (detail.value?.id === s.id) detail.value.state = d.state;
        showToast(d.state === 'active' ? `已启用 ${s.name}` : `已停用 ${s.name}`);
      } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
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
        const r = await fetch(`/api/skills/${encodeURIComponent(s.id)}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true, agent }),
        });
        const d = await r.json();
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
        showToast('删除失败: ' + e.message, 'error');
      } finally {
        deleteLoading.value = false;
      }
    }

    async function doInstall() {
      if (!installInput.value.trim()) return;
      installLoading.value = true;
      installResult.value = null;
      try {
        const r = await fetch('/api/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: installInput.value.trim() }),
        });
        installResult.value = await r.json();
        if (installResult.value.ok) {
          showToast('安装成功');
          installInput.value = '';
          await loadSkills();
        }
      } catch (e) {
        installResult.value = { ok: false, stderr: e.message };
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

    onMounted(() => {
      loadSkills();
      checkUpdates();
    });

    return {
      skills, loading, error, search, activeScene, activeCategory,
       sources, activeAgents, toggleAgent,
      detail, detailLoading, detailTab, renderedDoc, linkTargets, linkTo,
      updates, updatesLoading, installDialog, installInput, installResult, installLoading,
      deleteTarget, deleteAgent, deleteLoading, toast,
      scenes, filtered, stats,
      selectScene, selectCategory, agentStyle,
      openDetail, togglePin, toggleState, askDelete, confirmDelete, doInstall, checkUpdates,
      closeDetail: () => detail.value = null,
      closeDelete: () => { deleteTarget.value = null; deleteAgent.value = ''; },
      SCENE_ICONS,
    };
  },

  template: `
  <div class="min-h-screen flex flex-col">
    <!-- Header -->
    <header class="border-b sticky top-0 z-40 bg-background/95 backdrop-blur">
      <div class="px-6 h-14 flex items-center gap-4">
        <h1 class="text-base font-semibold tracking-tight flex items-center gap-2">
          <span class="text-lg">⬡</span> Skills Manager
        </h1>
        <div class="flex-1 max-w-md">
          <input v-model="search" class="input" placeholder="搜索 skill 名称或描述…" />
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button class="btn btn-outline btn-sm" @click="checkUpdates" :disabled="updatesLoading">
            {{ updatesLoading ? '检查中…' : '检查更新' }}
            <span v-if="updates && updates.count > 0" class="badge badge-destructive ml-1">{{ updates.count }}</span>
          </button>
          <button class="btn btn-default btn-sm" @click="installDialog = true">+ 安装 Skill</button>
        </div>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar -->
      <aside class="w-56 border-r p-4 overflow-y-auto scrollbar-thin shrink-0">
         <div class="text-xs font-medium text-muted-foreground mb-2 px-2">Agent</div>
         <button
           class="w-full text-left px-2 py-1.5 rounded-md text-sm mb-1 transition-colors"
           :class="!activeAgents.length ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
           @click="activeAgents = []">
           全部
         </button>
         <div class="space-y-1 mb-3">
           <button v-for="src in sources" :key="src.agent"
             class="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2"
             :class="activeAgents.includes(src.agent) ? 'bg-secondary font-medium' : 'hover:bg-secondary/60'"
             @click="toggleAgent(src.agent)">
             <span class="agent-pill" :style="agentStyle(src.agent)">{{ src.agent }}</span>
             <span class="ml-auto text-xs text-muted-foreground">{{ src.count }}</span>
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
      </aside>

      <!-- Main -->
      <main class="flex-1 overflow-y-auto scrollbar-thin p-6">
        <!-- Stats -->
        <div class="grid gap-3 mb-3" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
          <div class="card p-4"><div class="text-2xl font-semibold">{{ stats.total }}</div>
            <div class="text-xs text-muted-foreground mt-1">唯一技能数</div></div>
          <div v-for="src in sources" :key="src.agent" class="card p-4 cursor-pointer"
               :class="activeAgents.includes(src.agent) ? 'ring-2' : 'hover:ring-1'"
               style="--tw-ring-color: hsl(var(--ring));"
               @click="toggleAgent(src.agent)">
            <div class="flex items-center gap-2 h-5">
              <span class="agent-pill" :style="agentStyle(src.agent)">{{ src.agent }}</span>
            </div>
            <div class="text-2xl font-semibold mt-1">{{ src.count }}</div>
            <div class="text-xs text-muted-foreground mt-0.5">拥有的 skill</div>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 mb-6">
          <div class="card p-4"><div class="text-2xl font-semibold">{{ stats.pinned }}</div>
            <div class="text-xs text-muted-foreground mt-1">已固定</div></div>
          <div class="card p-4"><div class="text-2xl font-semibold">{{ stats.archived }}</div>
            <div class="text-xs text-muted-foreground mt-1">已停用</div></div>
          <div class="card p-4"><div class="text-2xl font-semibold">{{ stats.updateCount ?? '—' }}</div>
            <div class="text-xs text-muted-foreground mt-1">待更新（Hermes）</div></div>
        </div>

        <!-- 更新提示条 -->
        <div v-if="updates && updates.count > 0" class="card p-3 mb-4 flex items-center gap-3 border-l-4"
             style="border-left-color: hsl(var(--destructive));">
          <span class="text-sm">📦 {{ updates.count }} 个技能有更新：</span>
          <span v-for="u in updates.updates" :key="u.name" class="badge badge-secondary">{{ u.name }}</span>
        </div>

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

    <!-- Toast -->
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-md text-sm shadow-lg"
         :class="toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'warn' ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-white'"
         style="animation: slideIn .15s">
      {{ toast.msg }}
    </div>
  </div>
  `,
}).mount('#app');
