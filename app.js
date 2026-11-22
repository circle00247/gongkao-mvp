/* ============================================================
   上岸计划 · 考公备考站  —  应用主逻辑
   云服务：@tencent-ai/workbuddy-cloud-sdk (CDN 全局 WorkBuddyCloud)
   ============================================================ */

// 由 workbuddy_cloud_service 开通环境时返回的可公开配置
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

/* ---------------- 全局状态 ---------------- */
const state = {
  session: null,
  tasks: [],
  settings: null,
  prices: [],
  notes: [],
  favs: [],
  currentScheduleDate: todayStr(),
  editingTaskId: null,
  editingNoteId: null,
  editingBookTitle: null,
  courseFilter: "all",
  courseSearch: ""
};

/* ---------------- 工具函数 ---------------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
function todayStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showToast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function unwrap(res, ctx) {
  if (res.error) throw new Error(`${ctx}: ${res.error.message || res.error}`);
  return res.data;
}
function daysBetween(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/* ---------------- 鉴权：回调分发 + 会话恢复 ---------------- */
async function restoreAuth() {
  const url = new URL(location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    return await restoreSession();
  }
  const provider = url.searchParams.get("provider");
  if (provider !== "workbuddy" && provider !== "wechat") {
    showLoginErrorSafe("授权回调缺少有效的登录方式，请重新登录。");
    return false;
  }
  const handler = provider === "workbuddy" ? cloud.auth.handleWorkBuddyCallback : cloud.auth.handleWechatWebCallback;
  if (typeof handler !== "function") {
    showLoginErrorSafe("暂时无法使用此方式登录，请联系应用管理员。");
    return false;
  }
  const { data: session, error } = await handler.call(cloud.auth);
  if (error) { showLoginErrorSafe(error.message || "登录失败"); return false; }
  if (session) {
    for (const k of ["code", "state", "provider"]) url.searchParams.delete(k);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    state.session = session;
    return true;
  }
  return await restoreSession();
}

async function restoreSession() {
  const { data: session, error } = await cloud.auth.getSession();
  if (error || !session) return false;
  state.session = session;
  return true;
}

function showLoginErrorSafe(msg) {
  $("#boot-loading").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  const el = $("#login-error"); if (el) el.textContent = msg;
}

/* ---------------- 登录交互 ---------------- */
let pendingOtp = null; // { phone, verificationId, isExistingUser }
let codeCooldown = 0;

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
    if (!/^1\d{10}$/.test(phone)) {
      $("#phone-error").textContent = "请输入正确的 11 位手机号";
      return;
    }
    $("#phone-error").textContent = "";
    const btn = $("#send-code-btn");
    btn.disabled = true; btn.textContent = "发送中…";
    const sent = await cloud.auth.sendOtp({ phone });
    btn.disabled = false;
    if (sent.error) {
      $("#code-hint").textContent = sent.error.message || "验证码发送失败，请重试";
      btn.textContent = "获取验证码";
      return;
    }
    pendingOtp = { phone, ...sent.data };
    $("#code-hint").textContent = "验证码已发送，请注意查收短信";
    startCooldown();
  });

  $("#phone-login-btn").addEventListener("click", async () => {
    const phone = $("#phone-input").value.trim();
    const code = $("#code-input").value.trim();
    $("#login-error").textContent = "";
    if (!pendingOtp || pendingOtp.phone !== phone) {
      $("#login-error").textContent = "请先获取该手机号的验证码";
      return;
    }
    if (!code) { $("#login-error").textContent = "请输入验证码"; return; }
    const btn = $("#phone-login-btn");
    btn.disabled = true; btn.textContent = "登录中…";
    const done = await cloud.auth.verifyOtp({
      phone: pendingOtp.phone,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    });
    btn.disabled = false; btn.textContent = "登录 / 注册";
    if (done.error) { $("#login-error").textContent = done.error.message || "登录失败"; return; }
    pendingOtp = null;
    state.session = done.data;
    await enterApp();
  });

  $("#wechat-login-btn").addEventListener("click", async () => {
    $("#login-error").textContent = "";
    const back = new URL(location.href);
    back.pathname = "/";
    for (const k of ["code", "state", "provider"]) back.searchParams.delete(k);
    const { data, error } = await cloud.auth.signInWithOAuth({ provider: "wechat", redirectTo: back.toString() });
    if (error) { $("#login-error").textContent = error.message || "微信登录发起失败"; return; }
    location.assign(data.url);
  });

  $("#logout-btn").addEventListener("click", async () => {
    await cloud.auth.signOut();
    state.session = null;
    location.reload();
  });
}

function startCooldown() {
  codeCooldown = 60;
  const btn = $("#send-code-btn");
  const timer = setInterval(() => {
    btn.textContent = `${codeCooldown}s 后重发`;
    btn.disabled = true;
    codeCooldown--;
    if (codeCooldown < 0) { clearInterval(timer); btn.textContent = "获取验证码"; btn.disabled = false; }
  }, 1000);
}

/* ============================================================
   数据层：云数据库 CRUD
   ============================================================ */
const DB = {
  async loadAll() {
    const [tasks, settings, prices, notes, favs] = await Promise.all([
      cloud.database.from("tasks").select("*").order("task_date", { ascending: false }).order("created_at", { ascending: false }),
      cloud.database.from("user_settings").select("*").maybeSingle(),
      cloud.database.from("book_prices").select("*").order("updated_at", { ascending: false }),
      cloud.database.from("news_notes").select("*").order("created_at", { ascending: false }),
      cloud.database.from("course_favorites").select("*")
    ]);
    state.tasks = unwrap(tasks, "加载日程失败");
    state.settings = unwrap(settings, "加载设置失败");
    state.prices = unwrap(prices, "加载比价失败");
    state.notes = unwrap(notes, "加载素材失败");
    state.favs = unwrap(favs, "加载收藏失败");
    if (!state.settings) {
      const created = await cloud.database.from("user_settings").insert({ exam_name: "国家公务员考试", daily_goal_minutes: 180, focus_lock: false }).select();
      state.settings = unwrap(created, "初始化设置失败")[0];
    }
  },

  async addTask(task) {
    const rows = await cloud.database.from("tasks").insert(task).select();
    const row = unwrap(rows, "添加任务失败")[0];
    state.tasks.push(row); return row;
  },
  async updateTask(id, patch) {
    const rows = await cloud.database.from("tasks").update(patch).eq("id", id).select();
    const affected = unwrap(rows, "更新任务失败");
    if (affected.length) {
      const i = state.tasks.findIndex(t => t.id === id);
      if (i >= 0) state.tasks[i] = affected[0];
    }
    return affected[0];
  },
  async deleteTask(id) {
    const rows = await cloud.database.from("tasks").delete().eq("id", id).select();
    const removed = unwrap(rows, "删除任务失败");
    if (removed.length) state.tasks = state.tasks.filter(t => t.id !== id);
    return removed.length;
  },

  async saveSettings(patch) {
    const rows = await cloud.database.from("user_settings").update(patch).eq("id", state.settings.id).select();
    const affected = unwrap(rows, "保存设置失败");
    if (affected.length) state.settings = affected[0];
    return state.settings;
  },

  async addPrice(rec) {
    const rows = await cloud.database.from("book_prices").insert(rec).select();
    const row = unwrap(rows, "保存价格失败")[0];
    state.prices.push(row); return row;
  },
  async deletePricesByBook(bookTitle) {
    const rows = await cloud.database.from("book_prices").delete().eq("book_title", bookTitle).select();
    unwrap(rows, "删除价格失败");
    state.prices = state.prices.filter(p => p.book_title !== bookTitle);
  },

  async addNote(note) {
    const rows = await cloud.database.from("news_notes").insert(note).select();
    const row = unwrap(rows, "保存素材失败")[0];
    state.notes.unshift(row); return row;
  },
  async updateNote(id, patch) {
    const rows = await cloud.database.from("news_notes").update(patch).eq("id", id).select();
    const affected = unwrap(rows, "更新素材失败");
    if (affected.length) {
      const i = state.notes.findIndex(n => n.id === id);
      if (i >= 0) state.notes[i] = affected[0];
    }
    return affected[0];
  },
  async deleteNote(id) {
    const rows = await cloud.database.from("news_notes").delete().eq("id", id).select();
    const removed = unwrap(rows, "删除素材失败");
    if (removed.length) state.notes = state.notes.filter(n => n.id !== id);
    return removed.length;
  },

  async toggleFav(courseKey) {
    const existing = state.favs.find(f => f.course_key === courseKey);
    if (existing) {
      const rows = await cloud.database.from("course_favorites").delete().eq("id", existing.id).select();
      unwrap(rows, "取消收藏失败");
      state.favs = state.favs.filter(f => f.id !== existing.id);
      return false;
    }
    const rows = await cloud.database.from("course_favorites").insert({ course_key: courseKey }).select();
    const row = unwrap(rows, "收藏失败")[0];
    state.favs.push(row); return true;
  }
};

/* ============================================================
   静态示例数据：老师课程 / 新闻源
   （仅公开信息与官方入口；B 站搜索链接保证长期有效）
   ============================================================ */
const COURSES = [
  // 行测
  { key: "fenbi-xingce", name: "粉笔 · 行测系统班", org: "粉笔", subject: "行测", color: "#e11d48",
    desc: "言语、判断、资料、数量、常识分模块系统教学，配套题库与模考。",
    materials: "《行测的思维》《决战行测5000题》、粉笔APP题库",
    free: "https://search.bilibili.com/all?keyword=%E7%B2%89%E7%AC%94%E8%A1%8C%E6%B5%8B%E5%85%8D%E8%B4%B9%E8%AF%BE",
    live: "https://live.bilibili.com/search?keyword=%E7%B2%89%E7%AC%94%E5%85%AC%E8%80%83",
    paid: "https://www.fenbi.com/" },
  { key: "huatu-xingce", name: "华图 · 行测名师班", org: "华图教育", subject: "行测", color: "#dc2626",
    desc: "模块宝典体系，数量关系与判断推理讲解见长。",
    materials: "《模块宝典》《华图内部教案》",
    free: "https://search.bilibili.com/all?keyword=%E5%8D%8E%E5%9B%BE%E8%A1%8C%E6%B5%8B%E5%85%8D%E8%B4%B9",
    live: "https://live.bilibili.com/search?keyword=%E5%8D%8E%E5%9B%BE%E5%85%AC%E8%80%83",
    paid: "https://www.huatu.com/" },
  { key: "zhonggong-xingce", name: "中公 · 行测基础班", org: "中公教育", subject: "行测", color: "#b91c1c",
    desc: "全模块覆盖，适合零基础打基础，配套专项练习。",
    materials: "《中公公考一本通》《专项题库》",
    free: "https://search.bilibili.com/all?keyword=%E4%B8%AD%E5%85%AC%E8%A1%8C%E6%B5%8B%E5%85%8D%E8%B4%B9%E8%AF%BE",
    live: "https://live.bilibili.com/search?keyword=%E4%B8%AD%E5%85%AC%E5%85%AC%E8%80%83",
    paid: "https://www.offcn.com/" },
  { key: "peanut-shuliang", name: "花生十三 · 数量资料", org: "个人名师", subject: "行测", color: "#ea580c",
    desc: "数量关系与资料分析技巧流派，速算与秒杀技巧知名。",
    materials: "《花生十三数量/资料讲义》",
    free: "https://search.bilibili.com/all?keyword=%E8%8A%B1%E7%94%9F%E5%8D%81%E4%B8%89%E8%A1%8C%E6%B5%8B",
    live: "https://search.bilibili.com/all?keyword=%E8%8A%B1%E7%94%9F%E5%8D%81%E4%B8%89%E7%9B%B4%E6%92%AD",
    paid: "https://search.bilibili.com/all?keyword=%E8%8A%B1%E7%94%9F%E5%8D%81%E4%B8%89%E8%AF%BE%E7%A8%8B" },
  { key: "qilin-ziliao", name: "齐麟 · 资料分析", org: "个人名师", subject: "行测", color: "#0891b2",
    desc: "资料分析专项，速算技巧与刷题方法体系完整。",
    materials: "《齐麟资料分析》系列讲义",
    free: "https://search.bilibili.com/all?keyword=%E9%BD%90%E9%BA%9F%E8%B5%84%E6%96%99%E5%88%86%E6%9E%90",
    live: "https://search.bilibili.com/all?keyword=%E9%BD%90%E9%BA%9F%E7%9B%B4%E6%92%AD",
    paid: "https://search.bilibili.com/all?keyword=%E9%BD%90%E9%BA%9F%E8%AF%BE%E7%A8%8B" },
  { key: "niejia-panduan", name: "聂佳影 · 判断推理", org: "个人名师", subject: "行测", color: "#7c3aed",
    desc: "图形推理与逻辑判断方法讲解清晰，适合专项突破。",
    materials: "《判断推理专项讲义》",
    free: "https://search.bilibili.com/all?keyword=%E8%81%82%E4%BD%B3%E5%BD%B1%E5%88%A4%E6%96%AD%E6%8E%A8%E7%90%86",
    live: "https://search.bilibili.com/all?keyword=%E8%81%82%E4%BD%B3%E5%BD%B1%E7%9B%B4%E6%92%AD",
    paid: "https://search.bilibili.com/all?keyword=%E8%81%82%E4%BD%B3%E5%BD%B1%E8%AF%BE%E7%A8%8B" },
  // 申论
  { key: "fenbi-shenlun", name: "粉笔 · 申论系统班", org: "粉笔", subject: "申论", color: "#db2777",
    desc: "归纳概括、综合分析、贯彻执行的作答框架与批改体系。",
    materials: "《申论的规矩》、申论批改服务",
    free: "https://search.bilibili.com/all?keyword=%E7%B2%89%E7%AC%94%E7%94%B3%E8%AE%BA%E5%85%8D%E8%B4%B9%E8%AF%BE",
    live: "https://live.bilibili.com/search?keyword=%E7%B2%89%E7%AC%94%E7%94%B3%E8%AE%BA",
    paid: "https://www.fenbi.com/" },
  { key: "zhanzhang-shenlun", name: "站长 · 申论", org: "个人名师", subject: "申论", color: "#be185d",
    desc: "申论写作与材料提炼的经典课程，大作文立意与结构讲解深入。",
    materials: "《站长申论》讲义、范文精讲",
    free: "https://search.bilibili.com/all?keyword=%E7%AB%99%E9%95%BF%E7%94%B3%E8%AE%BA",
    live: "https://search.bilibili.com/all?keyword=%E7%AB%99%E9%95%BF%E7%94%B3%E8%AE%BA%E7%9B%B4%E6%92%AD",
    paid: "https://search.bilibili.com/all?keyword=%E7%AB%99%E9%95%BF%E7%94%B3%E8%AE%BA%E8%AF%BE%E7%A8%8B" },
  { key: "banliantan", name: "半月谈 · 申论热点", org: "半月谈", subject: "申论", color: "#059669",
    desc: "时政热点解读与申论素材积累，评论风格贴近考试。",
    materials: "《半月谈》杂志、申论热点手册",
    free: "https://search.bilibili.com/all?keyword=%E5%8D%8A%E6%9C%88%E8%B0%88%E7%94%B3%E8%AE%BA",
    live: "https://search.bilibili.com/all?keyword=%E5%8D%8A%E6%9C%88%E8%B0%88%E7%9B%B4%E6%92%AD",
    paid: "https://www.banyuetan.org/" },
  { key: "limengjiao-changshi", name: "李梦娇 · 常识速记", org: "华图教育", subject: "常识", color: "#d97706",
    desc: "常识判断口诀记忆法，法律、人文、科技考点覆盖。",
    materials: "《常识速记口诀88条》",
    free: "https://search.bilibili.com/all?keyword=%E6%9D%8E%E6%A2%A6%E5%A8%A5%E5%B8%B8%E8%AF%86",
    live: "https://search.bilibili.com/all?keyword=%E6%9D%8E%E6%A2%A6%E5%A8%A5%E7%9B%B4%E6%92%AD",
    paid: "https://search.bilibili.com/all?keyword=%E6%9D%8E%E6%A2%A6%E5%A8%A5%E8%AF%BE%E7%A8%8B" },
  // 面试
  { key: "fenbi-mianshi", name: "粉笔 · 面试系统班", org: "粉笔", subject: "面试", color: "#4f46e5",
    desc: "结构化面试题型拆解、答题框架与全真模拟。",
    materials: "《面试真题详解》、模拟练习",
    free: "https://search.bilibili.com/all?keyword=%E7%B2%89%E7%AC%94%E9%9D%A2%E8%AF%95%E5%85%8D%E8%B4%B9",
    live: "https://live.bilibili.com/search?keyword=%E7%B2%89%E7%AC%94%E9%9D%A2%E8%AF%95",
    paid: "https://www.fenbi.com/" }
];

const NEWS_SOURCES = [
  { name: "人民网 · 时政", desc: "权威时政要闻", ico: "🇨🇳", url: "http://politics.people.com.cn/" },
  { name: "新华网", desc: "国家通讯社资讯", ico: "📡", url: "http://www.news.cn/" },
  { name: "央视网 · 新闻", desc: "央视权威报道", ico: "📺", url: "https://news.cctv.com/" },
  { name: "半月谈", desc: "申论热点必备", ico: "📖", url: "https://www.banyuetan.org/" },
  { name: "学习强国", desc: "理论政策学习", ico: "⭐", url: "https://www.xuexi.cn/" },
  { name: "中国政府网", desc: "政策文件原文", ico: "🏛️", url: "https://www.gov.cn/" }
];

const QUOTES = [
  "自律即自由，上岸靠积累。",
  "不积跬步，无以至千里；不积小流，无以成江海。",
  "你今天的努力，是幸运的伏笔。",
  "看似不起眼的日复一日，会在某天让你看到坚持的意义。",
  "将来的你，一定会感谢现在拼命的自己。",
  "每一次落笔，都在靠近那个上岸的自己。",
  "慢一点没关系，只要一直在往前走。"
];

/* ============================================================
   渲染：备考总览
   ============================================================ */
function renderDashboard() {
  const s = state.settings || {};
  const examName = s.exam_name || "考试";
  $("#cd-exam-name").textContent = examName.length > 8 ? examName.slice(0, 8) + "…" : examName;
  $("#hero-exam-name").textContent = examName;

  const days = daysBetween(s.exam_date);
  $("#countdown-days").textContent = days === null ? "--" : days;
  $("#hero-days").textContent = days === null ? "--" : days;
  $("#hero-date").textContent = s.exam_date ? `考试日期：${s.exam_date}${days !== null && days >= 0 ? ` · 加油，还有 ${days} 天` : ""}` : "请在设置中设置考试日期";

  const today = todayStr();
  const todayTasks = state.tasks.filter(t => t.task_date === today);
  const doneCount = todayTasks.filter(t => t.completed).length;
  const pct = todayTasks.length ? Math.round(doneCount / todayTasks.length * 100) : 0;
  $("#progress-pct").textContent = pct + "%";
  $("#hero-ring-fg").style.strokeDashoffset = String(326.7 * (1 - pct / 100));

  $("#stat-today").textContent = `${doneCount}/${todayTasks.length}`;
  $("#stat-minutes").textContent = todayTasks.filter(t => t.completed).reduce((a, t) => a + (Number(t.duration_min) || 0), 0);
  $("#stat-total").textContent = state.tasks.filter(t => t.completed).length;
  $("#stat-streak").textContent = calcStreak();

  const d = new Date();
  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  $("#today-str").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekNames[d.getDay()]}`;

  renderDashTasks(todayTasks);
  renderReminder(todayTasks);
  renderWeekChart();
  $("#daily-quote").textContent = QUOTES[d.getDate() % QUOTES.length];
  applyFocusLock();
}

function calcStreak() {
  const doneDates = new Set(state.tasks.filter(t => t.completed).map(t => t.task_date));
  let streak = 0;
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  if (!doneDates.has(todayStr(cur))) cur.setDate(cur.getDate() - 1);
  while (doneDates.has(todayStr(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
  return streak;
}

function renderDashTasks(tasks) {
  const el = $("#dash-task-list");
  if (!tasks.length) {
    el.innerHTML = `<div class="empty-state"><span class="big-ico">📝</span>今天还没有任务，点击右上角添加一条吧</div>`;
    return;
  }
  const sorted = [...tasks].sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
  el.innerHTML = sorted.map(t => taskItemHtml(t)).join("");
  bindTaskClicks(el);
}

function taskItemHtml(t) {
  const subj = t.subject || "综合";
  const meta = [`<span class="tag tag-${subj}">${escapeHtml(subj)}</span>`];
  if (t.start_time) meta.push(`<span>🕐 ${escapeHtml(t.start_time)}</span>`);
  if (t.duration_min) meta.push(`<span>⏱ ${t.duration_min} 分钟</span>`);
  if (t.source === "auto") meta.push(`<span>🤖 课程排程</span>`);
  if (t.note) meta.push(`<span>📌 ${escapeHtml(t.note)}</span>`);
  return `<div class="task-item ${t.completed ? "done" : ""}" data-id="${t.id}">
    <div class="task-check ${t.completed ? "checked" : ""}" data-act="toggle">${t.completed ? "✓" : ""}</div>
    <div class="task-body"><div class="task-title">${escapeHtml(t.title)}</div><div class="task-meta">${meta.join("")}</div></div>
    <div class="task-actions"><button class="mini-btn" data-act="edit" title="编辑">✏️</button></div>
  </div>`;
}

function bindTaskClicks(container) {
  container.querySelectorAll(".task-check").forEach(el => el.addEventListener("click", () => {
    const id = Number(el.closest(".task-item").dataset.id);
    const task = state.tasks.find(t => t.id === id);
    if (task) toggleTask(task);
  }));
  container.querySelectorAll('[data-act="edit"]').forEach(el => el.addEventListener("click", () => {
    const id = Number(el.closest(".task-item").dataset.id);
    openTaskModal(id);
  }));
}

async function toggleTask(task) {
  const newVal = !task.completed;
  await DB.updateTask(task.id, { completed: newVal, completed_at: newVal ? new Date().toISOString() : null });
  renderDashboard();
  renderSchedule();
  if (newVal) showToast("完成一项，离上岸又近一步 🎉");
  checkFocusUnlock();
}

function renderReminder(todayTasks) {
  const unfinished = todayTasks.filter(t => !t.completed);
  const time = state.settings?.remind_time || "20:00";
  const box = $("#reminder-unfinished");
  const status = $("#reminder-status");
  status.textContent = `每天 ${time} 提醒你完成当天任务（需保持页面打开并已授权通知）`;
  if (!unfinished.length) {
    box.innerHTML = `<div class="reminder-empty">✓ 今日任务已全部完成，太棒了！</div>`;
  } else {
    box.innerHTML = unfinished.slice(0, 4).map(t => `<div class="reminder-item"><span>⏳</span>${escapeHtml(t.title)}</div>`).join("") +
      (unfinished.length > 4 ? `<div class="reminder-item"><span>⋯</span>还有 ${unfinished.length - 4} 项</div>` : "");
  }
}

function renderWeekChart() {
  const el = $("#week-chart");
  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = todayStr(d);
    const total = state.tasks.filter(t => t.task_date === ds).length;
    const done = state.tasks.filter(t => t.task_date === ds && t.completed).length;
    data.push({ label: `周${weekNames[d.getDay()]}`, total, done, isToday: i === 0 });
  }
  const max = Math.max(1, ...data.map(x => x.total));
  el.innerHTML = data.map(x => {
    const h = Math.round((x.done / max) * 100);
    return `<div class="week-bar-wrap">
      <div class="week-num">${x.done || ""}</div>
      <div class="week-bar ${x.done === 0 ? "zero" : ""}" style="height:${x.done ? Math.max(h, 6) : 4}px"></div>
      <div class="week-label">${x.label}</div>
    </div>`;
  }).join("");
}

/* ============================================================
   渲染：每日日程
   ============================================================ */
function renderSchedule() {
  const ds = state.currentScheduleDate;
  $("#schedule-date").value = ds;
  const tasks = state.tasks.filter(t => t.task_date === ds);
  const done = tasks.filter(t => t.completed).length;
  $("#schedule-summary").innerHTML = `${ds} · 共 <b>${tasks.length}</b> 项任务，已完成 <b style="color:var(--success)">${done}</b> 项，还剩 <b style="color:var(--danger)">${tasks.length - done}</b> 项`;
  const el = $("#schedule-task-list");
  if (!tasks.length) {
    el.innerHTML = `<div class="empty-state"><span class="big-ico">🗓️</span>这一天还没有安排，点击「新建任务」开始规划</div>`;
    return;
  }
  const sorted = [...tasks].sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
  el.innerHTML = sorted.map(t => taskItemHtml(t)).join("");
  bindTaskClicks(el);
}

/* ============================================================
   渲染：课程中心
   ============================================================ */
function renderCourses() {
  const grid = $("#course-grid");
  let list = COURSES;
  if (state.courseFilter !== "all") list = list.filter(c => c.subject === state.courseFilter);
  if (state.courseSearch.trim()) {
    const q = state.courseSearch.trim().toLowerCase();
    list = list.filter(c => (c.name + c.org + c.subject + c.desc).toLowerCase().includes(q));
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">没有找到匹配的课程</div>`;
    return;
  }
  grid.innerHTML = list.map(c => {
    const faved = state.favs.some(f => f.course_key === c.key);
    const initials = c.name.replace(/[^一-龥A-Za-z]/g, "").slice(0, 2);
    return `<div class="course-card">
      <div class="course-head">
        <div class="course-avatar" style="background:${c.color}">${escapeHtml(initials)}</div>
        <div><div class="course-name">${escapeHtml(c.name)}</div><div class="course-org">所属：${escapeHtml(c.org)}</div></div>
      </div>
      <div class="course-subjects"><span class="tag tag-${c.subject}">${escapeHtml(c.subject)}</span></div>
      <div class="course-desc">${escapeHtml(c.desc)}</div>
      <div class="course-materials"><b>配套资料：</b>${escapeHtml(c.materials)}</div>
      <div class="course-links">
        <a class="course-link link-free" href="${c.free}" target="_blank" rel="noopener">免费课</a>
        <a class="course-link link-live" href="${c.live}" target="_blank" rel="noopener">🔴 直播</a>
        <a class="course-link link-paid" href="${c.paid}" target="_blank" rel="noopener">官方付费课</a>
        <button class="course-link link-schedule" data-act="schedule" data-key="${c.key}">+ 加入日程</button>
        <button class="course-link link-fav ${faved ? "active" : ""}" data-act="fav" data-key="${c.key}">${faved ? "★ 已收藏" : "☆ 收藏"}</button>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll('[data-act="fav"]').forEach(btn => btn.addEventListener("click", async () => {
    await DB.toggleFav(btn.dataset.key);
    renderCourses();
  }));
  grid.querySelectorAll('[data-act="schedule"]').forEach(btn => btn.addEventListener("click", async () => {
    const c = COURSES.find(x => x.key === btn.dataset.key);
    // 自动安排在"明天"，作为提前一天提醒观看的任务
    const d = new Date(); d.setDate(d.getDate() + 1);
    const tomorrow = todayStr(d);
    await DB.addTask({
      title: `观看 ${c.name} 课程/直播`,
      subject: c.subject,
      category: "course",
      task_date: tomorrow,
      start_time: "20:00",
      duration_min: 90,
      completed: false,
      source: "auto",
      link: c.live,
      note: "课程中心自动排程（提前一天提醒）"
    });
    showToast(`已加入 ${tomorrow} 的日程 ⏰`);
    renderSchedule();
  }));
}

/* ============================================================
   渲染：书单比价
   ============================================================ */
const PLATFORMS = [
  { key: "京东", cls: "p-jd", search: q => `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}` },
  { key: "淘宝", cls: "p-taobao", search: q => `https://s.taobao.com/search?q=${encodeURIComponent(q)}` },
  { key: "拼多多", cls: "p-pdd", search: q => `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(q)}` },
  { key: "抖音", cls: "p-douyin", search: q => `https://www.douyin.com/search/${encodeURIComponent(q)}` }
];

function renderBooks() {
  const el = $("#book-list");
  const grouped = {};
  state.prices.forEach(p => {
    (grouped[p.book_title] = grouped[p.book_title] || {})[p.platform] = p;
  });
  const titles = Object.keys(grouped);
  if (!titles.length) {
    el.innerHTML = `<div class="empty-state"><span class="big-ico">📚</span>还没有书籍，先在上方添加一本书吧</div>`;
    return;
  }
  el.innerHTML = titles.map(title => {
    const searchLinks = PLATFORMS.map(p => `<a class="platform-link ${p.cls}" href="${p.search(title)}" target="_blank" rel="noopener">${p.key}搜</a>`).join("");
    const priceRows = PLATFORMS.map(p => {
      const rec = grouped[title][p.key];
      return `<div class="price-row"><span class="price-platform">${p.key}</span><span class="price-value">${rec && rec.price != null ? "¥" + Number(rec.price).toFixed(2) : "—"}</span></div>`;
    }).join("");
    const prices = PLATFORMS.map(p => grouped[title][p.key]).filter(r => r && r.price != null).map(r => Number(r.price));
    const lowest = prices.length ? Math.min(...prices) : null;
    return `<div class="book-card">
      <div class="book-header">
        <div class="book-icon">📕</div>
        <div class="book-title">${escapeHtml(title)}</div>
        <button class="book-del" data-act="del-book" data-title="${escapeHtml(title)}" title="删除">🗑️</button>
      </div>
      <div class="book-search-links">${searchLinks}</div>
      ${priceRows}
      ${lowest !== null ? `<div style="margin-top:8px;font-size:12px;color:var(--muted)">记住的最低价：<b class="price-lowest">¥${lowest.toFixed(2)}</b><span class="lowest-badge">参考</span></div>` : ""}
      <button class="book-price-edit" data-act="edit-price" data-title="${escapeHtml(title)}">💰 记录 / 更新各平台价格</button>
    </div>`;
  }).join("");

  el.querySelectorAll('[data-act="del-book"]').forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm(`确定删除「${btn.dataset.title}」及其价格记录吗？`)) return;
    await DB.deletePricesByBook(btn.dataset.title);
    renderBooks(); showToast("已删除");
  }));
  el.querySelectorAll('[data-act="edit-price"]').forEach(btn => btn.addEventListener("click", () => openPriceModal(btn.dataset.title)));
}

/* ============================================================
   渲染：申论素材
   ============================================================ */
function renderNews() {
  $("#news-sources").innerHTML = NEWS_SOURCES.map(n =>
    `<a class="news-source" href="${n.url}" target="_blank" rel="noopener">
      <span class="ns-ico">${n.ico}</span><div><b>${escapeHtml(n.name)}</b><small>${escapeHtml(n.desc)}</small></div>
    </a>`).join("");
  renderNotes();
}

function renderNotes() {
  const el = $("#news-note-list");
  if (!state.notes.length) {
    el.innerHTML = `<div class="empty-state"><span class="big-ico">📝</span>还没有素材笔记，点击「记一条」开始积累</div>`;
    return;
  }
  el.innerHTML = state.notes.map(n =>
    `<div class="note-card">
      <div class="note-head"><span class="tag tag-申论">${escapeHtml(n.topic || "申论素材")}</span><span class="note-title">${escapeHtml(n.title)}</span><span class="note-date">${escapeHtml(n.note_date)}</span></div>
      <div class="note-content">${escapeHtml(n.content)}</div>
      <div class="note-foot">
        ${n.url ? `<a class="note-url" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">🔗 来源链接</a>` : ""}
        <div class="spacer"></div>
        <button class="mini-btn" data-act="edit-note" data-id="${n.id}">✏️</button>
        <button class="mini-btn" data-act="del-note" data-id="${n.id}">🗑️</button>
      </div>
    </div>`).join("");
  el.querySelectorAll('[data-act="edit-note"]').forEach(b => b.addEventListener("click", () => openNoteModal(Number(b.dataset.id))));
  el.querySelectorAll('[data-act="del-note"]').forEach(b => b.addEventListener("click", async () => {
    if (!confirm("确定删除这条素材吗？")) return;
    await DB.deleteNote(Number(b.dataset.id));
    renderNotes(); showToast("已删除");
  }));
}

/* ============================================================
   弹窗：任务 / 笔记 / 价格
   ============================================================ */
function closeAllModals() { $$(".modal").forEach(m => m.classList.add("hidden")); }

function openTaskModal(id = null) {
  state.editingTaskId = id;
  const t = id ? state.tasks.find(x => x.id === id) : null;
  $("#task-modal-title").textContent = t ? "编辑任务" : "新建任务";
  $("#tm-title").value = t ? t.title : "";
  $("#tm-subject").value = t ? t.subject : "行测";
  $("#tm-date").value = t ? t.task_date : (state.currentScheduleDate || todayStr());
  $("#tm-time").value = t && t.start_time ? t.start_time : "";
  $("#tm-duration").value = t && t.duration_min != null ? t.duration_min : 60;
  $("#tm-note").value = t ? (t.note || "") : "";
  $("#tm-delete").classList.toggle("hidden", !t);
  $("#task-modal").classList.remove("hidden");
}

async function saveTaskModal() {
  const title = $("#tm-title").value.trim();
  if (!title) { showToast("请填写任务内容"); return; }
  const payload = {
    title,
    subject: $("#tm-subject").value,
    task_date: $("#tm-date").value || todayStr(),
    start_time: $("#tm-time").value || null,
    duration_min: Number($("#tm-duration").value) || 0,
    note: $("#tm-note").value.trim() || null
  };
  if (state.editingTaskId) {
    await DB.updateTask(state.editingTaskId, payload);
    showToast("已更新任务");
  } else {
    await DB.addTask({ ...payload, category: "self", completed: false, source: "manual" });
    showToast("已添加任务");
  }
  closeAllModals();
  state.currentScheduleDate = payload.task_date;
  renderAll();
}

async function deleteTaskModal() {
  if (!state.editingTaskId) return;
  if (!confirm("确定删除这条任务吗？")) return;
  await DB.deleteTask(state.editingTaskId);
  closeAllModals(); renderAll(); showToast("已删除");
}

function openNoteModal(id = null) {
  state.editingNoteId = id;
  const n = id ? state.notes.find(x => x.id === id) : null;
  $("#note-modal-title").textContent = n ? "编辑素材" : "记一条素材";
  $("#nm-title").value = n ? n.title : "";
  $("#nm-topic").value = n ? (n.topic || "申论素材") : "申论素材";
  $("#nm-content").value = n ? (n.content || "") : "";
  $("#nm-url").value = n ? (n.url || "") : "";
  $("#nm-delete").classList.toggle("hidden", !n);
  $("#note-modal").classList.remove("hidden");
}

async function saveNoteModal() {
  const title = $("#nm-title").value.trim();
  const content = $("#nm-content").value.trim();
  if (!title || !content) { showToast("请填写标题和内容"); return; }
  const payload = {
    title, content,
    topic: $("#nm-topic").value,
    url: $("#nm-url").value.trim() || null,
    note_date: todayStr()
  };
  if (state.editingNoteId) {
    await DB.updateNote(state.editingNoteId, payload);
    showToast("已更新素材");
  } else {
    await DB.addNote(payload);
    showToast("已保存素材");
  }
  closeAllModals(); renderNotes();
}

async function deleteNoteModal() {
  if (!state.editingNoteId) return;
  if (!confirm("确定删除这条素材吗？")) return;
  await DB.deleteNote(state.editingNoteId);
  closeAllModals(); renderNotes(); showToast("已删除");
}

function openPriceModal(bookTitle) {
  state.editingBookTitle = bookTitle;
  $("#price-book-name").textContent = bookTitle;
  const grouped = {};
  state.prices.filter(p => p.book_title === bookTitle).forEach(p => grouped[p.platform] = p);
  $("#price-platform-rows").innerHTML = PLATFORMS.map(p => {
    const rec = grouped[p.key];
    return `<div class="price-platform-row">
      <label>${p.key}</label>
      <input class="text-input price-input" data-platform="${p.key}" type="number" min="0" step="0.01" placeholder="未记录" value="${rec && rec.price != null ? rec.price : ""}" />
      <a class="mini-btn" href="${p.search(bookTitle)}" target="_blank" rel="noopener" title="去${p.key}搜索">🔍</a>
    </div>`;
  }).join("");
  $("#price-modal").classList.remove("hidden");
}

async function savePriceModal() {
  const bookTitle = state.editingBookTitle;
  if (!bookTitle) return;
  const inputs = $$(".price-input");
  // 先删除该书所有旧记录，再写入新记录（仅写入填了价格的平台）
  await DB.deletePricesByBook(bookTitle);
  for (const inp of inputs) {
    const val = inp.value.trim();
    if (val === "") continue;
    await DB.addPrice({ book_title: bookTitle, platform: inp.dataset.platform, price: Number(val) });
  }
  closeAllModals(); renderBooks(); showToast("价格已更新");
}

/* ============================================================
   提醒机制：浏览器通知 + 到点弹窗（页面打开时生效）
   ============================================================ */
let reminderFiredDate = "";

function initReminder() {
  // 每分钟检查一次是否到达提醒时间
  setInterval(checkReminder, 60 * 1000);
  setTimeout(checkReminder, 3000);
}

function checkReminder() {
  if (!state.settings) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const target = state.settings.remind_time || "20:00";
  const today = todayStr();
  if (hm < target || reminderFiredDate === today) return;

  const unfinished = state.tasks.filter(t => t.task_date === today && !t.completed);
  if (!unfinished.length) return;
  reminderFiredDate = today;

  const msg = `还有 ${unfinished.length} 项任务未完成：${unfinished.slice(0, 3).map(t => t.title).join("、")}`;
  // 浏览器通知
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification("上岸计划 · 今日任务提醒", { body: msg, tag: "gongkao-reminder" }); } catch (e) {}
  }
  // 页面内醒目提示
  showToast("⏰ " + msg, 8000);
}

async function requestNotify() {
  if (!("Notification" in window)) { showToast("当前浏览器不支持通知"); return; }
  const perm = await Notification.requestPermission();
  if (perm === "granted") { showToast("已开启提醒，到点会通知你 🔔"); }
  else { showToast("未授权通知，将只在页面内提醒"); }
}

/* ============================================================
   专注锁（仅站内心理约束）：未完成任务时变灰
   ============================================================ */
function applyFocusLock() {
  $$(".focus-lock-banner").forEach(b => b.remove());
  document.body.classList.remove("focus-locked");
  if (!state.settings?.focus_lock) return;
  const today = todayStr();
  const unfinished = state.tasks.filter(t => t.task_date === today && !t.completed).length;
  if (unfinished > 0) {
    document.body.classList.add("focus-locked");
    const banner = document.createElement("div");
    banner.className = "focus-lock-banner";
    banner.innerHTML = `🔒 专注模式：今天还有 <b>${unfinished}</b> 项任务未完成，完成后自动解锁本站`;
    document.body.appendChild(banner);
  }
}
function checkFocusUnlock() {
  // toggleTask 后会重新 renderDashboard → applyFocusLock 自动处理解锁
}

/* ============================================================
   设置
   ============================================================ */
function loadSettingsForm() {
  const s = state.settings || {};
  $("#set-exam-name").value = s.exam_name || "";
  $("#set-exam-date").value = s.exam_date || "";
  $("#set-goal").value = s.daily_goal_minutes ?? 180;
  $("#set-remind-time").value = s.remind_time || "20:00";
  $("#set-focus-lock").checked = !!s.focus_lock;
}

async function saveSettings() {
  const payload = {
    exam_name: $("#set-exam-name").value.trim() || "国家公务员考试",
    exam_date: $("#set-exam-date").value || null,
    daily_goal_minutes: Number($("#set-goal").value) || 180,
    remind_time: $("#set-remind-time").value || "20:00",
    focus_lock: $("#set-focus-lock").checked
  };
  await DB.saveSettings(payload);
  reminderFiredDate = "";
  renderAll();
  showToast("设置已保存 ✓");
}

/* ============================================================
   导航与事件绑定
   ============================================================ */
function switchSection(name) {
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.section === name));
  $$(".section").forEach(s => s.classList.toggle("active", s.id === `section-${name}`));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
  // 导航
  $$(".nav-item").forEach(n => n.addEventListener("click", () => switchSection(n.dataset.section)));

  // 任务弹窗
  $("#quick-add-btn").addEventListener("click", () => openTaskModal());
  $("#schedule-add-btn").addEventListener("click", () => openTaskModal());
  $("#tm-save").addEventListener("click", saveTaskModal);
  $("#tm-delete").addEventListener("click", deleteTaskModal);

  // 笔记弹窗
  $("#news-add-btn").addEventListener("click", () => openNoteModal());
  $("#nm-save").addEventListener("click", saveNoteModal);
  $("#nm-delete").addEventListener("click", deleteNoteModal);

  // 价格弹窗
  $("#pm-save").addEventListener("click", savePriceModal);

  // 关闭弹窗
  $$("[data-close-modal]").forEach(el => el.addEventListener("click", closeAllModals));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAllModals(); });

  // 添加书籍
  $("#book-add-btn").addEventListener("click", async () => {
    const title = $("#book-title-input").value.trim();
    if (!title) { showToast("请输入书名"); return; }
    $("#book-title-input").value = "";
    renderBooks();
    showToast(`已添加「${title}」，去各平台搜索并记下价格吧`);
    // 立即打开价格记录弹窗
    openPriceModal(title);
  });
  $("#book-title-input").addEventListener("keydown", e => { if (e.key === "Enter") $("#book-add-btn").click(); });

  // 日程日期切换
  $("#schedule-date").addEventListener("change", e => { state.currentScheduleDate = e.target.value; renderSchedule(); });

  // 课程筛选
  $("#course-filter").addEventListener("click", e => {
    const tab = e.target.closest(".filter-tab"); if (!tab) return;
    $$(".filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.courseFilter = tab.dataset.cat;
    renderCourses();
  });
  $("#course-search").addEventListener("input", e => { state.courseSearch = e.target.value; renderCourses(); });

  // 通知
  $("#notify-btn").addEventListener("click", requestNotify);
  $("#enable-notify-btn").addEventListener("click", requestNotify);

  // 设置
  $("#save-settings-btn").addEventListener("click", saveSettings);
}

/* ============================================================
   总渲染 / 启动
   ============================================================ */
function renderAll() {
  renderDashboard();
  renderSchedule();
  renderCourses();
  renderBooks();
  renderNews();
  loadSettingsForm();
}

async function enterApp() {
  $("#boot-loading").classList.remove("hidden");
  $("#login-view").classList.add("hidden");
  try {
    await DB.loadAll();
    const u = state.session?.user || {};
    const name = u.name || "备考人";
    $("#user-name").textContent = name;
    $("#user-avatar").textContent = name.slice(0, 1);
    $("#app-view").classList.remove("hidden");
    renderAll();
    bindEvents();
    initReminder();
  } catch (e) {
    console.error("进入应用失败", e);
    showToast("加载数据失败，请刷新重试");
    $("#login-view").classList.remove("hidden");
  } finally {
    $("#boot-loading").classList.add("hidden");
  }
}

async function boot() {
  $("#boot-loading").classList.remove("hidden");
  const ok = await restoreAuth();
  initLogin();
  if (ok) await enterApp();
  else {
    $("#boot-loading").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
}

boot();
