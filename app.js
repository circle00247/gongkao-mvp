/* ============================================================
   上岸计划 · 考公备考站  —  应用主逻辑（站内内容中心）
   ============================================================ */
const publicConfig = {
  endpoint: "https://gongkao-prep-56136.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_udntcIyzwyuIL9UfizoroS_5uQluM1i64DE955KhFkm5CfAhwVMX0Jf"
};
const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey
});

const state = {
  session: null,
  tasks: [], settings: [], settingsObj: null, notes: [], favs: [],
  videos: [], ebooks: [], handouts: [],
  currentScheduleDate: todayStr(),
  editingTaskId: null, editingNoteId: null, editingUploadId: null, uploadKind: "handout",
  materialFilter: "全部",
  reader: null // epub 阅读器实例
};

/* ---------------- 工具 ---------------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showToast(msg, ms = 2200) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function unwrap(res, ctx) { if (res && res.error) throw new Error(`${ctx}: ${res.error.message || res.error}`); return res ? res.data : res; }
function daysBetween(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00"), now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}
function fileExt(name) { return String(name || "").split(".").pop().toLowerCase(); }

/* 解析 B站链接中的 BV 号 */
function parseBvid(input) {
  const s = String(input || "").trim();
  let m = s.match(/BV[0-9A-Za-z]{10}/);
  if (m) return m[0];
  m = s.match(/\/video\/(BV[0-9A-Za-z]{10})/);
  if (m) return m[1];
  m = s.match(/b23\.tv\/([0-9A-Za-z]+)/); // 短链无法直接解析，提示用户
  return null;
}

/* ============================================================
   鉴权
   ============================================================ */
async function restoreAuth() {
  const url = new URL(location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) return await restoreSession();
  const provider = url.searchParams.get("provider");
  if (provider !== "workbuddy" && provider !== "wechat") { showLoginErrorSafe("授权回调缺少有效的登录方式，请重新登录。"); return false; }
  const handler = provider === "workbuddy" ? cloud.auth.handleWorkBuddyCallback : cloud.auth.handleWechatWebCallback;
  if (typeof handler !== "function") { showLoginErrorSafe("暂时无法使用此方式登录，请联系应用管理员。"); return false; }
  const { data: session, error } = await handler.call(cloud.auth);
  if (error) { showLoginErrorSafe(error.message || "登录失败"); return false; }
  if (session) {
    for (const k of ["code", "state", "provider"]) url.searchParams.delete(k);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    state.session = session; return true;
  }
  return await restoreSession();
}
async function restoreSession() {
  const { data: session, error } = await cloud.auth.getSession();
  if (error || !session) return false;
  state.session = session; return true;
}
function showLoginErrorSafe(msg) {
  $("#boot-loading").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  $("#login-error").textContent = msg;
}
let pendingOtp = null, codeCooldown = 0;
function initLogin() {
  $$(".login-tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".login-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.loginTab;
    $("#login-panel-phone").classList.toggle("hidden", which !== "phone");
    $("#login-panel-wechat").classList.toggle("hidden", which !== "wechat");
    $("#login-error").textContent = "";
  }));
  $("#phone-input").addEventListener("input", () => { $("#phone-error").textContent = ""; });
  $("#send-code-btn").addEventListener("click", async () => {
    const phone = $("#phone-input").value.trim();
    if (!/^1\d{10}$/.test(phone)) { $("#phone-error").textContent = "请输入正确的 11 位手机号"; return; }
    $("#phone-error").textContent = "";
    const btn = $("#send-code-btn"); btn.disabled = true; btn.textContent = "发送中…";
    const sent = await cloud.auth.sendOtp({ phone }); btn.disabled = false;
    if (sent.error) { $("#code-hint").textContent = sent.error.message || "验证码发送失败，请重试"; btn.textContent = "获取验证码"; return; }
    pendingOtp = { phone, ...sent.data };
    $("#code-hint").textContent = "验证码已发送，请注意查收短信"; startCooldown();
  });
  $("#phone-login-btn").addEventListener("click", async () => {
    const phone = $("#phone-input").value.trim(), code = $("#code-input").value.trim();
    $("#login-error").textContent = "";
    if (!pendingOtp || pendingOtp.phone !== phone) { $("#login-error").textContent = "请先获取该手机号的验证码"; return; }
    if (!code) { $("#login-error").textContent = "请输入验证码"; return; }
    const btn = $("#phone-login-btn"); btn.disabled = true; btn.textContent = "登录中…";
    const done = await cloud.auth.verifyOtp({ phone: pendingOtp.phone, verificationId: pendingOtp.verificationId, isExistingUser: pendingOtp.isExistingUser, token: code });
    btn.disabled = false; btn.textContent = "登录 / 注册";
    if (done.error) { $("#login-error").textContent = done.error.message || "登录失败"; return; }
    pendingOtp = null; state.session = done.data; await enterApp();
  });
  $("#wechat-login-btn").addEventListener("click", async () => {
    $("#login-error").textContent = "";
    const back = new URL(location.href); back.pathname = "/";
    for (const k of ["code", "state", "provider"]) back.searchParams.delete(k);
    const { data, error } = await cloud.auth.signInWithOAuth({ provider: "wechat", redirectTo: back.toString() });
    if (error) { $("#login-error").textContent = error.message || "微信登录发起失败"; return; }
    location.assign(data.url);
  });
  $("#logout-btn").addEventListener("click", async () => { await cloud.auth.signOut(); state.session = null; location.reload(); });
}
function startCooldown() {
  codeCooldown = 60; const btn = $("#send-code-btn");
  const timer = setInterval(() => {
    btn.textContent = `${codeCooldown}s 后重发`; btn.disabled = true; codeCooldown--;
    if (codeCooldown < 0) { clearInterval(timer); btn.textContent = "获取验证码"; btn.disabled = false; }
  }, 1000);
}

/* ============================================================
   数据层
   ============================================================ */
const DB = {
  async loadAll() {
    const [tasks, settings, notes, favs, videos, ebooks, handouts] = await Promise.all([
      cloud.database.from("tasks").select("*").order("task_date", { ascending: false }).order("created_at", { ascending: false }),
      cloud.database.from("user_settings").select("*").maybeSingle(),
      cloud.database.from("news_notes").select("*").order("created_at", { ascending: false }),
      cloud.database.from("course_favorites").select("*"),
      cloud.database.from("videos").select("*").order("created_at", { ascending: false }),
      cloud.database.from("ebooks").select("*").order("created_at", { ascending: false }),
      cloud.database.from("handouts").select("*").order("created_at", { ascending: false })
    ]);
    state.tasks = unwrap(tasks, "加载日程失败");
    state.settingsObj = unwrap(settings, "加载设置失败");
    state.notes = unwrap(notes, "加载素材失败");
    state.favs = unwrap(favs, "加载收藏失败");
    state.videos = unwrap(videos, "加载视频失败");
    state.ebooks = unwrap(ebooks, "加载电子书失败");
    state.handouts = unwrap(handouts, "加载讲义失败");
    if (!state.settingsObj) {
      const created = await cloud.database.from("user_settings").insert({ exam_name: "国家公务员考试", daily_goal_minutes: 180, focus_lock: false }).select();
      state.settingsObj = unwrap(created, "初始化设置失败")[0];
    }
  },
  async addTask(task) { const row = unwrap(await cloud.database.from("tasks").insert(task).select(), "添加任务失败")[0]; state.tasks.push(row); return row; },
  async updateTask(id, patch) { const a = unwrap(await cloud.database.from("tasks").update(patch).eq("id", id).select(), "更新任务失败"); if (a.length) { const i = state.tasks.findIndex(t => t.id === id); if (i >= 0) state.tasks[i] = a[0]; } return a[0]; },
  async deleteTask(id) { const r = unwrap(await cloud.database.from("tasks").delete().eq("id", id).select(), "删除任务失败"); if (r.length) state.tasks = state.tasks.filter(t => t.id !== id); return r.length; },
  async saveSettings(patch) { const a = unwrap(await cloud.database.from("user_settings").update(patch).eq("id", state.settingsObj.id).select(), "保存设置失败"); if (a.length) state.settingsObj = a[0]; return state.settingsObj; },
  async addNote(note) { const row = unwrap(await cloud.database.from("news_notes").insert(note).select(), "保存素材失败")[0]; state.notes.unshift(row); return row; },
  async updateNote(id, patch) { const a = unwrap(await cloud.database.from("news_notes").update(patch).eq("id", id).select(), "更新素材失败"); if (a.length) { const i = state.notes.findIndex(n => n.id === id); if (i >= 0) state.notes[i] = a[0]; } return a[0]; },
  async deleteNote(id) { const r = unwrap(await cloud.database.from("news_notes").delete().eq("id", id).select(), "删除素材失败"); if (r.length) state.notes = state.notes.filter(n => n.id !== id); return r.length; },
  async addVideo(rec) { const row = unwrap(await cloud.database.from("videos").insert(rec).select(), "添加视频失败")[0]; state.videos.unshift(row); return row; },
  async updateVideo(id, patch) { const a = unwrap(await cloud.database.from("videos").update(patch).eq("id", id).select(), "更新视频失败"); if (a.length) { const i = state.videos.findIndex(v => v.id === id); if (i >= 0) state.videos[i] = a[0]; } return a[0]; },
  async deleteVideo(id) { const r = unwrap(await cloud.database.from("videos").delete().eq("id", id).select(), "删除视频失败"); if (r.length) state.videos = state.videos.filter(v => v.id !== id); return r.length; },
  async addEbook(rec) { const row = unwrap(await cloud.database.from("ebooks").insert(rec).select(), "添加电子书失败")[0]; state.ebooks.unshift(row); return row; },
  async updateEbook(id, patch) { const a = unwrap(await cloud.database.from("ebooks").update(patch).eq("id", id).select(), "更新电子书失败"); if (a.length) { const i = state.ebooks.findIndex(e => e.id === id); if (i >= 0) state.ebooks[i] = a[0]; } return a[0]; },
  async deleteEbook(id) { const r = unwrap(await cloud.database.from("ebooks").delete().eq("id", id).select(), "删除电子书失败"); if (r.length) state.ebooks = state.ebooks.filter(e => e.id !== id); return r.length; },
  async addHandout(rec) { const row = unwrap(await cloud.database.from("handouts").insert(rec).select(), "添加讲义失败")[0]; state.handouts.unshift(row); return row; },
  async updateHandout(id, patch) { const a = unwrap(await cloud.database.from("handouts").update(patch).eq("id", id).select(), "更新讲义失败"); if (a.length) { const i = state.handouts.findIndex(h => h.id === id); if (i >= 0) state.handouts[i] = a[0]; } return a[0]; },
  async deleteHandout(id) { const r = unwrap(await cloud.database.from("handouts").delete().eq("id", id).select(), "删除讲义失败"); if (r.length) state.handouts = state.handouts.filter(h => h.id !== id); return r.length; }
};

/* ============================================================
   内置申论素材（站内直接阅读）
   ============================================================ */
const BUILTIN_MATERIALS = [
  { cat: "金句表述", title: "基层治理", content: "治国之道，富民为始；富民之要，在于为民。基层是政策落实的\"最后一公里\"，唯有把群众的小事当成心头大事，方能筑牢社会治理的根基。" },
  { cat: "金句表述", title: "实干担当", content: "空谈误国，实干兴邦。为政之道，贵在实干；干事创业，重在日常。既要在关键时刻站得出来，更要在平凡岗位上持之以恒。" },
  { cat: "金句表述", title: "改革创新", content: "苟日新，日日新，又日新。改革从来不是一蹴而就的坦途，而是在破解一个个具体难题中不断向前，以创新之钥开发展之锁。" },
  { cat: "金句表述", title: "生态文明", content: "绿水青山就是金山银山。良好生态环境是最普惠的民生福祉，守护好自然生态，就是守护好发展的未来。" },
  { cat: "人物事例", title: "黄文秀 · 扶贫干部", content: "北京师范大学硕士毕业后放弃大城市工作，回到家乡担任驻村第一书记，带领群众发展产业脱贫致富，在暴雨夜返回岗位途中不幸牺牲，年仅30岁。无偿奉献、扎根基层的典范。" },
  { cat: "人物事例", title: "张桂梅 · 燃灯校长", content: "创办全国第一所免费女子高中，十几年如一日帮助2000多名山区女孩圆梦大学。身患多种疾病仍坚守讲台，用教育阻断贫困代际传递。" },
  { cat: "人物事例", title: "袁隆平 · 杂交水稻之父", content: "一生致力于杂交水稻研究，从\"吃饱饭\"到\"吃好饭\"，把功勋写在大地上。九十岁高龄仍下田察看稻穗，诠释了科学家的赤子之心。" },
  { cat: "人物事例", title: "王亚平 · 航天员", content: "中国首位出舱活动的女航天员，两次执行载人飞行任务，在太空授课播撒科学种子。以坚韧与专业，诠释新时代女性的担当。" },
  { cat: "社会热点", title: "数字政府与政务服务", content: "从\"最多跑一次\"到\"一网通办\"，数字技术正重塑政务服务。要点：简政放权、数据共享、便民利企，同时需关注数字鸿沟与个人隐私保护。" },
  { cat: "社会热点", title: "新质生产力", content: "以科技创新为主导、摆脱传统增长路径的生产力形态。要点：创新驱动、产业升级、绿色低碳，强调因地制宜发展，避免一哄而上。" },
  { cat: "社会热点", title: "银发经济与养老", content: "人口老龄化背景下的新增长点。要点：居家社区机构相协调、医养康养相结合，兼顾适老化改造与老年人力资源开发。" },
  { cat: "社会热点", title: "乡村全面振兴", content: "产业、人才、文化、生态、组织\"五大振兴\"协同推进。要点：守住粮食安全底线、发展特色产业、改善农村人居环境、健全治理体系。" },
  { cat: "政策理论", title: "以人民为中心", content: "把人民对美好生活的向往作为奋斗目标，在发展中保障和改善民生，做到发展为了人民、发展依靠人民、发展成果由人民共享。" },
  { cat: "政策理论", title: "全过程人民民主", content: "民主不只体现在投票环节，更贯穿于选举、协商、决策、管理、监督的全链条，保障人民依法享有广泛而真实的民主权利。" },
  { cat: "政策理论", title: "高质量发展", content: "从\"有没有\"转向\"好不好\"，是全面建设社会主义现代化国家的首要任务。强调质量优先、效益优先，统筹发展与安全。" },
  { cat: "政策理论", title: "法治政府建设", content: "法定职责必须为、法无授权不可为。推进政府机构、职能、权限、程序、责任法定化，严格规范公正文明执法。" }
];

const QUOTES = [
  "自律即自由，上岸靠积累。", "不积跬步，无以至千里；不积小流，无以成江海。",
  "你今天的努力，是幸运的伏笔。", "看似不起眼的日复一日，会在某天让你看到坚持的意义。",
  "将来的你，一定会感谢现在拼命的自己。", "每一次落笔，都在靠近那个上岸的自己。", "慢一点没关系，只要一直在往前走。"
];

/* ============================================================
   渲染：备考总览
   ============================================================ */
function renderDashboard() {
  const s = state.settingsObj || {}, examName = s.exam_name || "考试";
  $("#cd-exam-name").textContent = examName.length > 8 ? examName.slice(0, 8) + "…" : examName;
  $("#hero-exam-name").textContent = examName;
  const days = daysBetween(s.exam_date);
  $("#countdown-days").textContent = days === null ? "--" : days;
  $("#hero-days").textContent = days === null ? "--" : days;
  $("#hero-date").textContent = s.exam_date ? `考试日期：${s.exam_date}${days !== null && days >= 0 ? ` · 加油，还有 ${days} 天` : ""}` : "请在设置中设置考试日期";
  const today = todayStr(), todayTasks = state.tasks.filter(t => t.task_date === today);
  const doneCount = todayTasks.filter(t => t.completed).length;
  const pct = todayTasks.length ? Math.round(doneCount / todayTasks.length * 100) : 0;
  $("#progress-pct").textContent = pct + "%";
  $("#hero-ring-fg").style.strokeDashoffset = String(326.7 * (1 - pct / 100));
  $("#stat-today").textContent = `${doneCount}/${todayTasks.length}`;
  $("#stat-minutes").textContent = todayTasks.filter(t => t.completed).reduce((a, t) => a + (Number(t.duration_min) || 0), 0);
  $("#stat-total").textContent = state.tasks.filter(t => t.completed).length;
  $("#stat-streak").textContent = calcStreak();
  const d = new Date(), weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  $("#today-str").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekNames[d.getDay()]}`;
  renderDashTasks(todayTasks); renderReminder(todayTasks); renderWeekChart();
  $("#daily-quote").textContent = QUOTES[d.getDate() % QUOTES.length];
  applyFocusLock();
}
function calcStreak() {
  const doneDates = new Set(state.tasks.filter(t => t.completed).map(t => t.task_date));
  let streak = 0; const cur = new Date(); cur.setHours(0, 0, 0, 0);
  if (!doneDates.has(todayStr(cur))) cur.setDate(cur.getDate() - 1);
  while (doneDates.has(todayStr(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
  return streak;
}
function renderDashTasks(tasks) {
  const el = $("#dash-task-list");
  if (!tasks.length) { el.innerHTML = `<div class="empty-state"><span class="big-ico">📝</span>今天还没有任务，点击右上角添加一条吧</div>`; return; }
  el.innerHTML = [...tasks].sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99")).map(t => taskItemHtml(t)).join("");
  bindTaskClicks(el);
}
function taskItemHtml(t) {
  const subj = t.subject || "综合", meta = [`<span class="tag tag-${subj}">${escapeHtml(subj)}</span>`];
  if (t.start_time) meta.push(`<span>🕐 ${escapeHtml(t.start_time)}</span>`);
  if (t.duration_min) meta.push(`<span>⏱ ${t.duration_min} 分钟</span>`);
  if (t.source === "auto") meta.push(`<span>🤖 视频排程</span>`);
  if (t.note) meta.push(`<span>📌 ${escapeHtml(t.note)}</span>`);
  return `<div class="task-item ${t.completed ? "done" : ""}" data-id="${t.id}">
    <div class="task-check ${t.completed ? "checked" : ""}" data-act="toggle">${t.completed ? "✓" : ""}</div>
    <div class="task-body"><div class="task-title">${escapeHtml(t.title)}</div><div class="task-meta">${meta.join("")}</div></div>
    <div class="task-actions"><button class="mini-btn" data-act="edit" title="编辑">✏️</button></div></div>`;
}
function bindTaskClicks(container) {
  container.querySelectorAll(".task-check").forEach(el => el.addEventListener("click", () => {
    const id = Number(el.closest(".task-item").dataset.id), task = state.tasks.find(t => t.id === id);
    if (task) toggleTask(task);
  }));
  container.querySelectorAll('[data-act="edit"]').forEach(el => el.addEventListener("click", () => openTaskModal(Number(el.closest(".task-item").dataset.id))));
}
async function toggleTask(task) {
  const newVal = !task.completed;
  await DB.updateTask(task.id, { completed: newVal, completed_at: newVal ? new Date().toISOString() : null });
  renderDashboard(); renderSchedule();
  if (newVal) showToast("完成一项，离上岸又近一步 🎉");
}
function renderReminder(todayTasks) {
  const unfinished = todayTasks.filter(t => !t.completed), time = state.settingsObj?.remind_time || "20:00";
  $("#reminder-status").textContent = `每天 ${time} 提醒你完成当天任务（需保持页面打开并已授权通知）`;
  const box = $("#reminder-unfinished");
  if (!unfinished.length) box.innerHTML = `<div class="reminder-empty">✓ 今日任务已全部完成，太棒了！</div>`;
  else box.innerHTML = unfinished.slice(0, 4).map(t => `<div class="reminder-item"><span>⏳</span>${escapeHtml(t.title)}</div>`).join("") +
    (unfinished.length > 4 ? `<div class="reminder-item"><span>⋯</span>还有 ${unfinished.length - 4} 项</div>` : "");
}
function renderWeekChart() {
  const el = $("#week-chart"), weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  const today = new Date(); today.setHours(0, 0, 0, 0); const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i); const ds = todayStr(d);
    data.push({ label: `周${weekNames[d.getDay()]}`, done: state.tasks.filter(t => t.task_date === ds && t.completed).length, total: state.tasks.filter(t => t.task_date === ds).length });
  }
  const max = Math.max(1, ...data.map(x => x.total));
  el.innerHTML = data.map(x => `<div class="week-bar-wrap"><div class="week-num">${x.done || ""}</div>
    <div class="week-bar ${x.done === 0 ? "zero" : ""}" style="height:${x.done ? Math.max(Math.round(x.done / max * 100), 6) : 4}px"></div>
    <div class="week-label">${x.label}</div></div>`).join("");
}

/* ============================================================
   渲染：每日日程
   ============================================================ */
function renderSchedule() {
  const ds = state.currentScheduleDate; $("#schedule-date").value = ds;
  const tasks = state.tasks.filter(t => t.task_date === ds), done = tasks.filter(t => t.completed).length;
  $("#schedule-summary").innerHTML = `${ds} · 共 <b>${tasks.length}</b> 项任务，已完成 <b style="color:var(--success)">${done}</b> 项，还剩 <b style="color:var(--danger)">${tasks.length - done}</b> 项`;
  const el = $("#schedule-task-list");
  if (!tasks.length) { el.innerHTML = `<div class="empty-state"><span class="big-ico">🗓️</span>这一天还没有安排，点击「新建任务」开始规划</div>`; return; }
  el.innerHTML = [...tasks].sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99")).map(t => taskItemHtml(t)).join("");
  bindTaskClicks(el);
}

/* ============================================================
   站内视频模块（B站官方播放器嵌入，站内直接播放）
   ============================================================ */
function renderVideos() {
  const el = $("#video-grid");
  if (!state.videos.length) {
    el.innerHTML = `<div class="empty-state card"><span class="big-ico">▶️</span>还没有添加视频。粘贴 B站链接，课程就会出现在站内，点击即可播放。</div>`;
    return;
  }
  el.innerHTML = state.videos.map(v => {
    const subj = v.subject || "综合";
    return `<div class="video-card">
      <div class="video-card-head">
        <span class="tag tag-${subj}">${escapeHtml(subj)}</span>
        <div class="video-card-actions">
          <button class="mini-btn" data-act="v-schedule" data-id="${v.id}" title="加入日程">📅</button>
          <button class="mini-btn" data-act="v-play" data-id="${v.id}" title="播放">▶️</button>
          <button class="mini-btn" data-act="v-del" data-id="${v.id}" title="删除">🗑️</button>
        </div>
      </div>
      <div class="video-card-title" data-act="v-play" data-id="${v.id}">${escapeHtml(v.title || "未命名视频")}</div>
      <div class="video-card-meta">${v.teacher ? "👤 " + escapeHtml(v.teacher) : ""} <span>${escapeHtml(v.bvid || "")}</span></div>
    </div>`;
  }).join("");
  el.querySelectorAll('[data-act="v-play"]').forEach(b => b.addEventListener("click", () => openVideoPlayer(Number(b.dataset.id))));
  el.querySelectorAll('[data-act="v-del"]').forEach(b => b.addEventListener("click", async () => {
    if (!confirm("确定删除这个视频吗？")) return; await DB.deleteVideo(Number(b.dataset.id)); renderVideos(); showToast("已删除");
  }));
  el.querySelectorAll('[data-act="v-schedule"]').forEach(b => b.addEventListener("click", async () => {
    const v = state.videos.find(x => x.id === Number(b.dataset.id)); const d = new Date(); d.setDate(d.getDate() + 1);
    await DB.addTask({ title: `观看视频：${v.title || v.bvid}`, subject: v.subject || "综合", category: "video", task_date: todayStr(d),
      start_time: "20:00", duration_min: 60, completed: false, source: "auto", note: "站内视频自动排程" });
    showToast(`已加入 ${todayStr(d)} 的日程 ⏰`); renderSchedule();
  }));
}

let currentPlayingVideoId = null;
function openVideoPlayer(id) {
  const v = state.videos.find(x => x.id === id); if (!v) return;
  currentPlayingVideoId = id;
  $("#reader-title").textContent = v.title || "视频播放";
  $("#reader-download").classList.add("hidden");
  $("#reader-nav").classList.add("hidden");
  $("#reader-content").innerHTML = `<div class="video-player-wrap">
    <iframe src="https://player.bilibili.com/player.html?bvid=${encodeURIComponent(v.bvid)}&page=1&high_quality=1&danmaku=0"
      scrolling="no" frameborder="0" allowfullscreen="true" class="bili-iframe"></iframe>
    <div class="video-player-tip">若显示 B站提示页，说明该视频设置了禁止嵌入或需要登录，属平台限制。可用浏览器打开原视频观看。</div>
  </div>`;
  $("#reader-modal").classList.remove("hidden");
}

/* ============================================================
   文件上传（讲义 / 电子书）
   ============================================================ */
function openUploadModal(kind, id = null) {
  state.uploadKind = kind; state.editingUploadId = id;
  const isBook = kind === "ebook";
  $("#upload-modal-title").textContent = isBook ? (id ? "编辑电子书" : "上传电子书") : (id ? "编辑讲义" : "上传讲义");
  const rec = id ? (isBook ? state.ebooks : state.handouts).find(x => x.id === id) : null;
  $("#up-title").value = rec ? rec.title : "";
  $("#up-subject").value = rec ? rec.subject : "行测";
  $("#up-teacher").value = rec ? (rec.teacher || "") : "";
  $("#up-note").value = rec ? (rec.note || "") : "";
  $("#up-file").value = "";
  $("#up-progress").textContent = rec && rec.file_name ? `当前文件：${rec.file_name}` : "请选择要上传的文件（PDF / EPUB / TXT / 图片 / Word / PPT）";
  $("#up-delete").classList.toggle("hidden", !id);
  $("#upload-modal").classList.remove("hidden");
}

async function saveUploadModal() {
  const title = $("#up-title").value.trim();
  if (!title) { showToast("请填写标题"); return; }
  const isBook = state.uploadKind === "ebook";
  const file = $("#up-file").files[0];
  let filePath = null, fileName = null, fileType = null;
  if (file) {
    $("#up-progress").textContent = "正在上传，请稍候…";
    const safeExt = fileExt(file.name).replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const path = cloud.storage.userPath(state.session.user.id, `${isBook ? "ebooks" : "handouts"}/${crypto.randomUUID()}.${safeExt}`);
    const res = await cloud.storage.upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (res && res.error) { $("#up-progress").textContent = "上传失败：" + (res.error.message || "未知错误"); return; }
    filePath = path; fileName = file.name; fileType = file.type || "";
  }
  const payload = { title, subject: $("#up-subject").value, teacher: $("#up-teacher").value.trim() || null,
    note: $("#up-note").value.trim() || null };
  if (filePath) { payload.file_path = filePath; payload.file_name = fileName; payload.file_type = fileType; }
  try {
    if (state.editingUploadId) {
      const table = isBook ? "ebooks" : "handouts", arr = isBook ? state.ebooks : state.handouts;
      const a = unwrap(await cloud.database.from(table).update(payload).eq("id", state.editingUploadId).select(), "更新失败");
      if (a.length) { const i = arr.findIndex(x => x.id === state.editingUploadId); if (i >= 0) arr[i] = a[0]; }
      showToast("已更新");
    } else {
      if (isBook) await DB.addEbook(payload); else await DB.addHandout(payload);
      showToast(file ? "上传成功，已保存到云端 ☁️" : "已保存");
    }
    closeAllModals(); renderHandouts(); renderEbooks();
  } catch (e) { showToast(e.message || "保存失败"); }
}

async function deleteUploadModal() {
  if (!state.editingUploadId) return; if (!confirm("确定删除这个文件吗？云端文件也会一并删除。")) return;
  const isBook = state.uploadKind === "ebook", rec = (isBook ? state.ebooks : state.handouts).find(x => x.id === state.editingUploadId);
  if (rec && rec.file_path) { try { await cloud.storage.remove([rec.file_path]); } catch (e) {} }
  if (isBook) await DB.deleteEbook(state.editingUploadId); else await DB.deleteHandout(state.editingUploadId);
  closeAllModals(); renderHandouts(); renderEbooks(); showToast("已删除");
}

/* ============================================================
   文件列表 + 站内阅读器
   ============================================================ */
function renderFileList(kind) {
  const isBook = kind === "ebook", arr = isBook ? state.ebooks : state.handouts;
  const el = isBook ? $("#ebook-list") : $("#handout-list");
  if (!arr.length) {
    el.innerHTML = `<div class="empty-state"><span class="big-ico">${isBook ? "📚" : "📄"}</span>${isBook ? "书架还是空的，上传你的第一本电子书吧" : "还没有讲义，上传文件后即可站内阅读"}</div>`;
    return;
  }
  el.innerHTML = arr.map(f => {
    const ext = fileExt(f.file_name);
    const canRead = ["pdf", "epub", "txt", "md", "png", "jpg", "jpeg", "webp", "gif"].includes(ext);
    return `<div class="file-card">
      <div class="file-icon">${isBook ? "📕" : "📄"}</div>
      <div class="file-info">
        <div class="file-title">${escapeHtml(f.title)}</div>
        <div class="file-meta"><span class="tag tag-${f.subject || "综合"}">${escapeHtml(f.subject || "综合")}</span>
          ${f.teacher ? `<span>👤 ${escapeHtml(f.teacher)}</span>` : ""}
          ${f.file_name ? `<span class="file-badge">${escapeHtml(ext.toUpperCase())}</span>` : "<span>无文件</span>"}</div>
        ${f.note ? `<div class="file-note">${escapeHtml(f.note)}</div>` : ""}
      </div>
      <div class="file-actions">
        ${f.file_path && canRead ? `<button class="btn btn-primary btn-sm" data-act="read" data-id="${f.id}">阅读</button>` : ""}
        <button class="mini-btn" data-act="edit" data-id="${f.id}">✏️</button>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll('[data-act="read"]').forEach(b => b.addEventListener("click", () => openReader(kind, Number(b.dataset.id))));
  el.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener("click", () => openUploadModal(kind, Number(b.dataset.id))));
}
function renderHandouts() { renderFileList("handout"); }
function renderEbooks() { renderFileList("ebook"); }

async function openReader(kind, id) {
  const isBook = kind === "ebook", rec = (isBook ? state.ebooks : state.handouts).find(x => x.id === id);
  if (!rec || !rec.file_path) { showToast("该文件没有可阅读的内容"); return; }
  const ext = fileExt(rec.file_name);
  $("#reader-title").textContent = rec.title;
  $("#reader-download").classList.remove("hidden");
  $("#reader-download").onclick = () => downloadFile(rec);
  const content = $("#reader-content");
  content.innerHTML = `<div class="reader-loading">正在打开文件…</div>`;
  $("#reader-nav").classList.add("hidden");
  if (state.reader) { try { state.reader.destroy(); } catch (e) {} state.reader = null; }
  try {
    if (ext === "pdf") {
      const url = await getSignedUrl(rec.file_path);
      content.innerHTML = `<iframe src="${url}" class="pdf-iframe"></iframe>`;
    } else if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      const url = await getSignedUrl(rec.file_path);
      content.innerHTML = `<div class="img-reader"><img src="${url}" alt="${escapeHtml(rec.title)}" /></div>`;
    } else if (["txt", "md"].includes(ext)) {
      const dl = await cloud.storage.download(rec.file_path);
      if (dl.error) throw new Error(dl.error.message || "下载失败");
      const text = await dl.data.text();
      content.innerHTML = `<pre class="text-reader">${escapeHtml(text)}</pre>`;
    } else if (ext === "epub") {
      content.innerHTML = `<div id="epub-viewer" class="epub-viewer"></div>`;
      $("#reader-nav").classList.remove("hidden");
      const dl = await cloud.storage.download(rec.file_path);
      if (dl.error) throw new Error(dl.error.message || "下载失败");
      const book = ePub(dl.data);
      const rendition = book.renderTo("epub-viewer", { width: "100%", height: "100%" });
      await rendition.display();
      state.reader = { destroy: () => book.destroy() };
      const updatePage = async () => {
        try {
          const loc = await rendition.currentLocation();
          const prog = await book.progress();
          $("#reader-page").textContent = Math.round(prog * 100) + "% · " + (loc?.start?.label || "");
        } catch (e) {}
      };
      $("#reader-prev").onclick = () => { rendition.prev().then(updatePage); };
      $("#reader-next").onclick = () => { rendition.next().then(updatePage); };
      await updatePage();
    } else {
      const url = await getSignedUrl(rec.file_path);
      content.innerHTML = `<div class="reader-loading">此格式无法在线预览，请点击下方按钮下载后查看。<br/><a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">下载文件</a></div>`;
    }
  } catch (e) {
    content.innerHTML = `<div class="reader-loading">打开文件失败：${escapeHtml(e.message || "未知错误")}</div>`;
  }
  $("#reader-modal").classList.remove("hidden");
}

async function getSignedUrl(path) {
  const res = await cloud.storage.createSignedUrl(path, 3600);
  if (res && res.error) throw new Error(res.error.message || "获取文件链接失败");
  const d = res.data;
  return typeof d === "string" ? d : (d && d.signedUrl);
}
async function downloadFile(rec) {
  try {
    const url = await getSignedUrl(rec.file_path);
    const a = document.createElement("a"); a.href = url; a.download = rec.file_name || rec.title; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { showToast("下载失败：" + e.message); }
}

/* ============================================================
   申论素材：内置素材 + 我的笔记
   ============================================================ */
function renderMaterials() {
  let list = BUILTIN_MATERIALS;
  if (state.materialFilter !== "全部") list = list.filter(m => m.cat === state.materialFilter);
  $("#builtin-material-list").innerHTML = list.map(m => `<div class="material-card">
    <div class="material-head"><span class="tag tag-申论">${escapeHtml(m.cat)}</span><b>${escapeHtml(m.title)}</b></div>
    <div class="material-body">${escapeHtml(m.content)}</div>
    <button class="material-copy" data-act="copy-material" data-text="${escapeHtml(m.content)}">📋 复制</button>
  </div>`).join("");
  $("#builtin-material-list").querySelectorAll('[data-act="copy-material"]').forEach(b => b.addEventListener("click", async () => {
    const text = b.dataset.text;
    try { await navigator.clipboard.writeText(text); showToast("已复制到剪贴板"); }
    catch (e) { showToast("复制失败，请手动选择文字"); }
  }));
  renderNotes();
}
function renderNotes() {
  const el = $("#news-note-list");
  if (!state.notes.length) { el.innerHTML = `<div class="empty-state"><span class="big-ico">📝</span>还没有素材笔记，点击「记一条」开始积累</div>`; return; }
  el.innerHTML = state.notes.map(n => `<div class="note-card">
    <div class="note-head"><span class="tag tag-申论">${escapeHtml(n.topic || "申论素材")}</span>
      <span class="note-title">${escapeHtml(n.title)}</span><span class="note-date">${escapeHtml(n.note_date)}</span></div>
    <div class="note-content">${escapeHtml(n.content)}</div>
    <div class="note-foot"><div class="spacer"></div>
      <button class="mini-btn" data-act="edit-note" data-id="${n.id}">✏️</button>
      <button class="mini-btn" data-act="del-note" data-id="${n.id}">🗑️</button></div></div>`).join("");
  el.querySelectorAll('[data-act="edit-note"]').forEach(b => b.addEventListener("click", () => openNoteModal(Number(b.dataset.id))));
  el.querySelectorAll('[data-act="del-note"]').forEach(b => b.addEventListener("click", async () => {
    if (!confirm("确定删除这条素材吗？")) return; await DB.deleteNote(Number(b.dataset.id)); renderNotes(); showToast("已删除");
  }));
}

/* ============================================================
   弹窗：任务 / 笔记
   ============================================================ */
function closeAllModals() { $$(".modal").forEach(m => m.classList.add("hidden")); }
function openTaskModal(id = null) {
  state.editingTaskId = id; const t = id ? state.tasks.find(x => x.id === id) : null;
  $("#task-modal-title").textContent = t ? "编辑任务" : "新建任务";
  $("#tm-title").value = t ? t.title : ""; $("#tm-subject").value = t ? t.subject : "行测";
  $("#tm-date").value = t ? t.task_date : (state.currentScheduleDate || todayStr());
  $("#tm-time").value = t && t.start_time ? t.start_time : "";
  $("#tm-duration").value = t && t.duration_min != null ? t.duration_min : 60;
  $("#tm-note").value = t ? (t.note || "") : "";
  $("#tm-delete").classList.toggle("hidden", !t); $("#task-modal").classList.remove("hidden");
}
async function saveTaskModal() {
  const title = $("#tm-title").value.trim(); if (!title) { showToast("请填写任务内容"); return; }
  const payload = { title, subject: $("#tm-subject").value, task_date: $("#tm-date").value || todayStr(),
    start_time: $("#tm-time").value || null, duration_min: Number($("#tm-duration").value) || 0, note: $("#tm-note").value.trim() || null };
  if (state.editingTaskId) { await DB.updateTask(state.editingTaskId, payload); showToast("已更新任务"); }
  else { await DB.addTask({ ...payload, category: "self", completed: false, source: "manual" }); showToast("已添加任务"); }
  closeAllModals(); state.currentScheduleDate = payload.task_date; renderAll();
}
async function deleteTaskModal() {
  if (!state.editingTaskId) return; if (!confirm("确定删除这条任务吗？")) return;
  await DB.deleteTask(state.editingTaskId); closeAllModals(); renderAll(); showToast("已删除");
}
function openNoteModal(id = null) {
  state.editingNoteId = id; const n = id ? state.notes.find(x => x.id === id) : null;
  $("#note-modal-title").textContent = n ? "编辑素材" : "记一条素材";
  $("#nm-title").value = n ? n.title : ""; $("#nm-topic").value = n ? (n.topic || "申论素材") : "申论素材";
  $("#nm-content").value = n ? (n.content || "") : "";
  $("#nm-delete").classList.toggle("hidden", !n); $("#note-modal").classList.remove("hidden");
}
async function saveNoteModal() {
  const title = $("#nm-title").value.trim(), content = $("#nm-content").value.trim();
  if (!title || !content) { showToast("请填写标题和内容"); return; }
  const payload = { title, content, topic: $("#nm-topic").value, note_date: todayStr() };
  if (state.editingNoteId) { await DB.updateNote(state.editingNoteId, payload); showToast("已更新素材"); }
  else { await DB.addNote(payload); showToast("已保存素材"); }
  closeAllModals(); renderNotes();
}
async function deleteNoteModal() {
  if (!state.editingNoteId) return; if (!confirm("确定删除这条素材吗？")) return;
  await DB.deleteNote(state.editingNoteId); closeAllModals(); renderNotes(); showToast("已删除");
}

/* ============================================================
   提醒 / 专注锁 / 设置
   ============================================================ */
let reminderFiredDate = "";
function initReminder() { setInterval(checkReminder, 60 * 1000); setTimeout(checkReminder, 3000); }
function checkReminder() {
  if (!state.settingsObj) return; const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const target = state.settingsObj.remind_time || "20:00", today = todayStr();
  if (hm < target || reminderFiredDate === today) return;
  const unfinished = state.tasks.filter(t => t.task_date === today && !t.completed);
  if (!unfinished.length) return; reminderFiredDate = today;
  const msg = `还有 ${unfinished.length} 项任务未完成：${unfinished.slice(0, 3).map(t => t.title).join("、")}`;
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification("上岸计划 · 今日任务提醒", { body: msg, tag: "gongkao-reminder" }); } catch (e) {}
  }
  showToast("⏰ " + msg, 8000);
}
async function requestNotify() {
  if (!("Notification" in window)) { showToast("当前浏览器不支持通知"); return; }
  const perm = await Notification.requestPermission();
  showToast(perm === "granted" ? "已开启提醒，到点会通知你 🔔" : "未授权通知，将只在页面内提醒");
}
function applyFocusLock() {
  $$(".focus-lock-banner").forEach(b => b.remove()); document.body.classList.remove("focus-locked");
  if (!state.settingsObj?.focus_lock) return;
  const unfinished = state.tasks.filter(t => t.task_date === todayStr() && !t.completed).length;
  if (unfinished > 0) {
    document.body.classList.add("focus-locked");
    const banner = document.createElement("div"); banner.className = "focus-lock-banner";
    banner.innerHTML = `🔒 专注模式：今天还有 <b>${unfinished}</b> 项任务未完成，完成后自动解锁本站`;
    document.body.appendChild(banner);
  }
}
function loadSettingsForm() {
  const s = state.settingsObj || {};
  $("#set-exam-name").value = s.exam_name || ""; $("#set-exam-date").value = s.exam_date || "";
  $("#set-goal").value = s.daily_goal_minutes ?? 180; $("#set-remind-time").value = s.remind_time || "20:00";
  $("#set-focus-lock").checked = !!s.focus_lock;
}
async function saveSettings() {
  const payload = { exam_name: $("#set-exam-name").value.trim() || "国家公务员考试", exam_date: $("#set-exam-date").value || null,
    daily_goal_minutes: Number($("#set-goal").value) || 180, remind_time: $("#set-remind-time").value || "20:00", focus_lock: $("#set-focus-lock").checked };
  await DB.saveSettings(payload); reminderFiredDate = ""; renderAll(); showToast("设置已保存 ✓");
}

/* ============================================================
   导航 / 事件 / 启动
   ============================================================ */
function switchSection(name) {
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.section === name));
  $$(".section").forEach(s => s.classList.toggle("active", s.id === `section-${name}`));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function bindEvents() {
  $$(".nav-item").forEach(n => n.addEventListener("click", () => switchSection(n.dataset.section)));
  $("#quick-add-btn").addEventListener("click", () => openTaskModal());
  $("#schedule-add-btn").addEventListener("click", () => openTaskModal());
  $("#tm-save").addEventListener("click", saveTaskModal);
  $("#tm-delete").addEventListener("click", deleteTaskModal);
  $("#news-add-btn").addEventListener("click", () => openNoteModal());
  $("#nm-save").addEventListener("click", saveNoteModal);
  $("#nm-delete").addEventListener("click", deleteNoteModal);
  $("#handout-add-btn").addEventListener("click", () => openUploadModal("handout"));
  $("#ebook-add-btn").addEventListener("click", () => openUploadModal("ebook"));
  $("#up-save").addEventListener("click", saveUploadModal);
  $("#up-delete").addEventListener("click", deleteUploadModal);
  $("#print-handouts-btn").addEventListener("click", () => window.print());
  $$("[data-close-modal]").forEach(el => el.addEventListener("click", closeAllModals));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAllModals(); });
  $("#schedule-date").addEventListener("change", e => { state.currentScheduleDate = e.target.value; renderSchedule(); });
  $("#material-filter").addEventListener("click", e => {
    const tab = e.target.closest(".filter-tab"); if (!tab) return;
    $$("#material-filter .filter-tab").forEach(t => t.classList.remove("active")); tab.classList.add("active");
    state.materialFilter = tab.dataset.cat; renderMaterials();
  });
  // 添加站内视频
  $("#video-add-btn").addEventListener("click", async () => {
    const raw = $("#video-url-input").value.trim();
    const bvid = parseBvid(raw);
    if (!bvid) { $("#video-hint").textContent = bvid === null && /b23\.tv/.test(raw) ? "短链无法自动识别，请在B站打开视频后复制完整链接或 BV 号。" : "没有识别到 BV 号，请粘贴 B站视频链接（含 BV 号）或 BV 号本身。"; return; }
    $("#video-hint").textContent = "";
    await DB.addVideo({ title: $("#video-title-input").value.trim() || bvid, bvid,
      teacher: $("#video-teacher-input").value.trim() || null, subject: "行测", note: null });
    $("#video-url-input").value = ""; $("#video-title-input").value = ""; $("#video-teacher-input").value = "";
    renderVideos(); showToast("视频已添加到站内 ▶️");
  });
  $("#video-url-input").addEventListener("keydown", e => { if (e.key === "Enter") $("#video-add-btn").click(); });
  $("#notify-btn").addEventListener("click", requestNotify);
  $("#enable-notify-btn").addEventListener("click", requestNotify);
  $("#save-settings-btn").addEventListener("click", saveSettings);
}
function renderAll() {
  renderDashboard(); renderSchedule(); renderVideos(); renderHandouts(); renderEbooks(); renderMaterials(); loadSettingsForm();
}
async function enterApp() {
  $("#boot-loading").classList.remove("hidden"); $("#login-view").classList.add("hidden");
  try {
    await DB.loadAll();
    const u = state.session?.user || {}, name = u.name || "备考人";
    $("#user-name").textContent = name; $("#user-avatar").textContent = name.slice(0, 1);
    $("#app-view").classList.remove("hidden"); renderAll(); bindEvents(); initReminder();
  } catch (e) {
    console.error("进入应用失败", e); showToast("加载数据失败，请刷新重试"); $("#login-view").classList.remove("hidden");
  } finally { $("#boot-loading").classList.add("hidden"); }
}
async function boot() {
  $("#boot-loading").classList.remove("hidden");
  const ok = await restoreAuth(); initLogin();
  if (ok) await enterApp();
  else { $("#boot-loading").classList.add("hidden"); $("#login-view").classList.remove("hidden"); }
}
boot();
