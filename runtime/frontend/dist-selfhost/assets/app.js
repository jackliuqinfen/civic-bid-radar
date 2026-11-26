const QUAL_CHIPS = [
  "建筑工程", "市政公用", "水利水电", "公路交通", "机电安装",
  "装饰装修", "园林绿化", "一级资质", "二级资质", "安许证", "建造师", "专面向中小企业",
];

const ROLES = {
  lead: { name: "负责人", focus: "整体机会判断、选公司、分工与需介入变更" },
  bidder: { name: "投标员", focus: "已选标段的制标准备、资料核对与递交跟进" },
  delegate: { name: "授权委托人", focus: "现场/远程开标安排、本人接单确认与回传" },
  finance: { name: "财务", focus: "保证金与费用要求、支付核实与退款催退" },
};

// Crisp linear SVG icons (no emoji, status always pairs icon + text)
const ICONS = {
  home: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>`,
  radar: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/></svg>`,
  bell: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  shield: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 3 4 7v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V7l-8-4Z"/></svg>`,
  users: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>`,
  file: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>`,
  check: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`,
  alert: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>`,
  clock: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  x: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  info: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  ext: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>`,
  lock: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
};

const state = {
  user: null,
  employees: [],
  companies: [],
  settings: { requireAssigneeOnSelect: false },
  perspective: localStorage.getItem("br-role") || "lead",
  dark: localStorage.getItem("br-theme") === "dark",
  route: location.pathname + location.search,
  openAlerts: 0,
  syncMeta: null,
};

function applyTheme() {
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
}
applyTheme();

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightEsc(text, kw) {
  const safe = esc(text);
  const k = String(kw || "").trim();
  if (!k) return safe;
  const escapedKw = esc(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(escapedKw, "gi"), (m) => `<mark class="hl">${m}</mark>`);
}

let activeToastTimer = null;
const dialogStack = [];
const dialogDisposers = new WeakMap();

function mountDialog(wrap, { initial, trigger = document.activeElement, onEscape, onClose, onRouteExit } = {}) {
  document.querySelectorAll(".dialog-exiting").forEach((leaving) => leaving.remove());
  const panel = wrap.querySelector('[role="dialog"]');
  if (!panel.hasAttribute("aria-label") && !panel.hasAttribute("aria-labelledby")) {
    panel.setAttribute("aria-label", panel.querySelector("h2, h3")?.textContent || "操作窗口");
  }
  panel.tabIndex = -1;
  const previous = dialogStack.at(-1);
  const root = document.getElementById("root");
  if (previous) previous.inert = true;
  else {
    root.inert = true;
    document.documentElement.classList.add("dialog-open");
  }
  dialogStack.push(wrap);
  wrap.dataset.managedDialog = "";
  wrap.style.zIndex = String(100 + dialogStack.length);
  document.body.appendChild(wrap);
  (wrap.querySelector(initial || "[autofocus]") || panel).focus({ preventScroll: true });
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll("a[href], button, input, textarea, select, [tabindex]")]
      .filter((control) => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || document.activeElement === panel || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last || panel : first || panel).focus();
    }
  });
  const close = (immediate = false) => {
    const index = dialogStack.indexOf(wrap);
    if (index < 0) return;
    const wasTop = index === dialogStack.length - 1;
    dialogStack.splice(index, 1);
    onClose?.();
    wrap.inert = true;
    wrap.classList.add("dialog-exiting");
    if (immediate || matchMedia("(prefers-reduced-motion: reduce)").matches) wrap.remove();
    else {
      const exit = wrap.animate([{ opacity: getComputedStyle(wrap).opacity }, { opacity: 0 }], {
        duration: 120,
        easing: "ease-out",
        fill: "forwards",
      });
      exit.finished.then(() => wrap.remove(), () => wrap.remove());
    }
    if (!wasTop) return;
    const active = dialogStack.at(-1);
    if (active) active.inert = false;
    else {
      document.getElementById("root").inert = false;
      document.documentElement.classList.remove("dialog-open");
    }
    const fallback = active?.querySelector('[role="dialog"]') || root.querySelector("#main-content");
    if (!immediate) (trigger?.isConnected && !trigger.closest("[inert]") ? trigger : fallback)?.focus({ preventScroll: true });
  };
  dialogDisposers.set(wrap, () => {
    close(true);
    onRouteExit?.();
  });
  return () => close();
}

function closeRouteDialogs() {
  for (const wrap of [...dialogStack].reverse()) dialogDisposers.get(wrap)?.();
  document.body.querySelectorAll(":scope > .modal-backdrop, :scope > .dialog-exiting").forEach((wrap) => wrap.remove());
}

function setSubmitPending(button, busy) {
  button.disabled = busy;
  button.toggleAttribute("data-pending", busy);
  button.setAttribute("aria-busy", String(busy));
}

function showToast(msg, opts = {}) {
  clearTimeout(activeToastTimer);
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", opts.error ? "alert" : "status");
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (opts.actionLabel && typeof opts.onAction === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      clearTimeout(activeToastTimer);
      el.remove();
      try {
        await opts.onAction();
      } catch (err) {
        showToast(err?.message || "撤回失败", { error: true });
      }
    });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  const ms = opts.duration || (opts.actionLabel ? 5800 : 2800);
  activeToastTimer = setTimeout(() => el.remove(), ms);
}

// Clean themed confirmation dialog (replaces native window.confirm)
function openConfirmModal({ title = "确认操作", message = "", confirmLabel = "确认", danger = false, onConfirm }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px;">
      <h3 style="margin:0 0 8px;">${esc(title)}</h3>
      ${message ? `<p class="muted" style="margin:0 0 14px;font-size:13px;line-height:1.6;">${esc(message)}</p>` : ""}
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn" id="cfm-cancel">取消</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" id="cfm-ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;
  const btn = wrap.querySelector("#cfm-ok");
  const cancel = wrap.querySelector("#cfm-cancel");
  const dismiss = () => { if (!btn.disabled) close(); };
  const close = mountDialog(wrap, { initial: danger ? "#cfm-cancel" : "#cfm-ok", onEscape: dismiss });
  cancel.addEventListener("click", dismiss);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) dismiss(); });
  btn.addEventListener("click", async () => {
    setSubmitPending(btn, true);
    cancel.disabled = true;
    wrap.firstElementChild.focus();
    try {
      await onConfirm?.();
      close();
    } catch (err) {
      showToast(err?.message || "操作失败", { error: true });
      setSubmitPending(btn, false);
      cancel.disabled = false;
      btn.focus();
    }
  });
}

// Clean themed input dialog (replaces native window.prompt)
function openInputModal({ title = "填写信息", message = "", label = "输入内容", defaultValue = "", placeholder = "", confirmLabel = "确认", danger = false, onConfirm }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:460px;">
      <h3 style="margin:0 0 8px;">${esc(title)}</h3>
      ${message ? `<p class="muted" style="margin:0 0 10px;font-size:12.5px;line-height:1.55;">${esc(message)}</p>` : ""}
      <form id="inpm-form">
        <div class="field">
          <label for="inpm-val">${esc(label)}</label>
          <input id="inpm-val" class="input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" required />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn" id="inpm-cancel">取消</button>
          <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}" id="inpm-ok">${esc(confirmLabel)}</button>
        </div>
      </form>
    </div>`;
  const inp = wrap.querySelector("#inpm-val");
  const btn = wrap.querySelector("#inpm-ok");
  const cancel = wrap.querySelector("#inpm-cancel");
  const dismiss = () => { if (!btn.disabled) close(); };
  const close = mountDialog(wrap, { initial: "#inpm-val", onEscape: dismiss });
  inp.select();
  cancel.addEventListener("click", dismiss);
  wrap.querySelector("#inpm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = inp.value.trim();
    if (!val || btn.disabled) return;
    setSubmitPending(btn, true);
    inp.readOnly = true;
    cancel.disabled = true;
    try {
      await onConfirm?.(val);
      close();
    } catch (err) {
      showToast(err?.message || "操作失败", { error: true });
      setSubmitPending(btn, false);
      inp.readOnly = false;
      cancel.disabled = false;
      inp.focus();
    }
  });
}

function confirmAsync(message, title = "确认操作", danger = true, action = "确认") {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:440px;">
        <h3 style="margin:0 0 8px;">${esc(title)}</h3>
        <p class="muted" style="margin:0 0 14px;font-size:13px;line-height:1.6;">${esc(message)}</p>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn" id="ca-no">取消</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" id="ca-yes">${esc(action)}</button>
        </div>
      </div>`;
    const done = (v) => { close(); resolve(v); };
    const close = mountDialog(wrap, { initial: danger ? "#ca-no" : "#ca-yes", onEscape: () => done(false), onRouteExit: () => resolve(false) });
    wrap.querySelector("#ca-no").addEventListener("click", () => done(false));
    wrap.querySelector("#ca-yes").addEventListener("click", () => done(true));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
  });
}

function promptAsync(message, defaultValue = "", title = "填写说明") {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:460px;">
        <h3 style="margin:0 0 8px;">${esc(title)}</h3>
        <form id="pa-form">
          <div class="field">
            <label for="pa-inp">${esc(message)}</label>
            <input id="pa-inp" class="input" value="${esc(defaultValue)}" />
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="btn" id="pa-no">取消</button>
            <button type="submit" class="btn btn-primary" id="pa-yes">确认</button>
          </div>
        </form>
      </div>`;
    const inp = wrap.querySelector("#pa-inp");
    const done = (v) => { close(); resolve(v); };
    const close = mountDialog(wrap, { initial: "#pa-inp", onEscape: () => done(null), onRouteExit: () => resolve(null) });
    inp.select();
    wrap.querySelector("#pa-no").addEventListener("click", () => done(null));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    wrap.querySelector("#pa-form").addEventListener("submit", (e) => { e.preventDefault(); done(inp.value); });
  });
}

async function renderKeepScroll() {
  const y = window.scrollY;
  const route = state.route;
  const activeId = document.activeElement?.id;
  const committed = await render();
  if (!committed || route !== state.route) return;
  if (activeId && document.activeElement === document.body) {
    document.getElementById(activeId)?.focus({ preventScroll: true });
  }
  window.scrollTo(0, y);
}

function renderSystemTabs(activeKey) {
  const isAdmin = state.user?.role === "admin";
  if (!isAdmin) return "";
  return `
    <div class="tabs" role="tablist" aria-label="系统管理分组" style="margin-bottom:12px;">
      <button type="button" class="tab ${activeKey === "settings" ? "active" : ""}" data-go="/settings">岗位首页、默认财务与字段</button>
      <button type="button" class="tab ${activeKey === "admin-accounts" ? "active" : ""}" data-go="/admin/accounts">账号与授权管理</button>
      <button type="button" class="tab ${activeKey === "admin-audit" ? "active" : ""}" data-go="/admin/audit">操作审计日志</button>
    </div>
  `;
}

// Accessible confirmation modal (supports both destructive danger & non-destructive verify actions)
function openRiskDialog({
  title,
  targetLabel = "",
  riskWarning = "",
  desc = "",
  reasonLabel = "必填原因（将记入不可篡改审计日志）",
  confirmLabel = "",
  confirmText = "",
  danger = true,
  requireReason = true,
  triggerEl = null,
  onConfirm,
}) {
  const warningText = riskWarning || desc || "";
  const btnText = confirmLabel || confirmText || "确认执行";
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rk-title">
      <h3 id="rk-title" style="margin:0 0 8px;">${esc(title)}</h3>
      ${targetLabel ? `<div class="muted" style="margin-bottom:10px;">操作对象：<strong>${esc(targetLabel)}</strong></div>` : ""}
      ${warningText ? `<div class="notice-box ${danger ? "danger" : "info"}" style="margin-bottom:12px;">${danger ? ICONS.alert : ICONS.info}<span>${esc(warningText)}</span></div>` : ""}
      <form id="rk-form">
        <div class="field">
          <label for="rk-reason">${esc(reasonLabel)}</label>
          <input id="rk-reason" class="input" name="reason" placeholder="请输入具体依据或说明…" />
          <div id="rk-err" class="inline-err dialog-error" role="alert"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn" id="rk-cancel">取消</button>
          <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}" id="rk-submit" ${requireReason ? "disabled" : ""}>${esc(btnText)}</button>
        </div>
      </form>
    </div>`;
  const inp = wrap.querySelector("#rk-reason");
  const sub = wrap.querySelector("#rk-submit");
  const err = wrap.querySelector("#rk-err");
  const cancel = wrap.querySelector("#rk-cancel");
  const dismiss = () => { if (!sub.hasAttribute("data-pending")) close(); };
  const close = mountDialog(wrap, { initial: "#rk-reason", trigger: triggerEl || document.activeElement, onEscape: dismiss });
  inp.addEventListener("input", () => {
    const ok = !requireReason || inp.value.trim().length > 0;
    sub.disabled = !ok;
    if (ok) err.textContent = "";
  });
  cancel.addEventListener("click", dismiss);
  wrap.querySelector("#rk-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sub.hasAttribute("data-pending")) return;
    const reason = inp.value.trim();
    if (requireReason && !reason) {
      err.textContent = "原因不能为空，请填写后提交。";
      return;
    }
    setSubmitPending(sub, true);
    inp.readOnly = true;
    cancel.disabled = true;
    try {
      await onConfirm(reason);
      close();
    } catch (ex) {
      err.textContent = ex.message || "提交失败，请重试。";
      setSubmitPending(sub, false);
      inp.readOnly = false;
      cancel.disabled = false;
      inp.focus();
    }
  });
}

async function api(path, body) {
  const opts = { cache: "no-store" };
  if (body !== undefined) {
    opts.method = "POST";
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch("/api" + path, opts);
  } catch {
    throw new Error("网络连接失败，请检查连接后重试。");
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/session" && !path.startsWith("/auth/")) {
      state.user = null;
      render();
    }
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || `请求未能处理（状态码 ${res.status}），请稍后重试。`);
  }
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : null;
}

const fmtDateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai",
});

function fmtBeijing(nsStr, textFallback) {
  if (nsStr && nsStr !== "0") {
    try {
      const value = String(nsStr);
      const ms = /^\d+$/.test(value) ? Number(BigInt(value) / 1000000n) : Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(" ","T")+"Z" : value);
      if (ms && !Number.isNaN(ms)) {
        return fmtDateTime.format(new Date(ms)).replaceAll("/", "-") + " 北京时间";
      }
    } catch {}
  }
  return textFallback ? `${textFallback} 北京时间` : "未标注";
}

// Strict currency format: 元 with 2 decimals, tabular-nums
function fmtFen(fen) {
  const n = Number(fen || 0) / 100;
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`;
}

function fmtYuan(yuanStr) {
  if (yuanStr === null || yuanStr === undefined || yuanStr === "" || !/^-?\d+$/.test(String(yuanStr))) {
    return "";
  }
  const n = Number(yuanStr);
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`;
}

// Smart Chinese tender budget formatting: >= 1亿 -> 亿元, >= 1万 -> 万元, < 1万 -> 元
function fmtSmartBudget(yuanStr) {
  if (yuanStr === null || yuanStr === undefined || yuanStr === "" || Number.isNaN(Number(yuanStr))) {
    return "";
  }
  const n = Number(yuanStr);
  if (n <= 0) return "";
  if (n >= 100_000_000) {
    return `${(n / 100_000_000).toFixed(2).replace(/\.?0+$/, "")} 亿元`;
  }
  if (n >= 10_000) {
    return `${(n / 10_000).toFixed(2).replace(/\.?0+$/, "")} 万元`;
  }
  return `${Math.round(n).toLocaleString("zh-CN")} 元`;
}

function getDeadlineUrgency(nsStr) {
  if (!nsStr || nsStr === "0") return { tier: "none", diffH: null };
  const value = String(nsStr);
      const ms = /^\d+$/.test(value) ? Number(BigInt(value) / 1000000n) : Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(" ","T")+"Z" : value);
  const diffH = (ms - Date.now()) / 3600000;
  if (diffH <= 0) return { tier: "expired", diffH };
  if (diffH <= 24) return { tier: "critical", diffH };
  if (diffH <= 72) return { tier: "urgent", diffH };
  if (diffH <= 168) return { tier: "soon", diffH };
  return { tier: "calm", diffH };
}

function renderEstimatedDealPriceCard(edp) {
  if (!edp || !edp.estMidYuan) return "";
  const midStr = fmtSmartBudget(edp.estMidYuan);
  const lowStr = fmtSmartBudget(edp.estLowYuan);
  const highStr = fmtSmartBudget(edp.estHighYuan);
  const midFloatPct = Math.max(0, (1 - Number(edp.p50Ratio || 1)) * 100).toFixed(2);
  const minFloatPct = Math.max(0, (1 - Number(edp.p90Ratio || 1)) * 100).toFixed(1);
  const maxFloatPct = Math.max(0, (1 - Number(edp.p10Ratio || 1)) * 100).toFixed(1);
  return `
    <div class="est-price-card">
      <div class="est-price-main">
        <span style="font-size:13px;font-weight:700;color:var(--text);">预估成交价：</span>
        <span class="est-price-val">${esc(midStr)}</span>
        <span class="badge badge-warn">中位下浮率 ${esc(midFloatPct)}%</span>
        <span class="badge badge-info">历史推算区间 ${esc(lowStr)} ~ ${esc(highStr)}（下浮 ${esc(minFloatPct)}% ~ ${esc(maxFloatPct)}%）</span>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px;line-height:1.55;">
        ${esc(edp.scopeLabel)} ${edp.sampleCount} 个已成交项目的 P10~P90，实测覆盖约 ${edp.coveragePct || 75}%。预算 × ${esc(edp.scopeLabel)}历史中标价中位（与「历史报价库」报价带同一口径，${edp.sampleCount} 个样本）。实测误差中位 ${edp.medianErrPct}%、10% 的项目偏差超 ${edp.p90ErrPct}%，仅作量级参考，不可作为报价依据。
      </div>
    </div>
  `;
}

function formatOfficialNoticeHtml(rawBody) {
  const txt = String(rawBody || "").trim();
  if (!txt) return `<div class="empty-state"><strong>原文暂未完整缓存</strong><div>请点击「官方网页原排版快照」或「打开官方原页面」核验。</div></div>`;
  const lines = txt.replace(/\r\n/g, "\n").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const kvRows = [];
  const bodyBlocks = [];
  const kvKeys = /^(项目编号|招标编号|项目名称|预算金额|最高限价|最高投标限价|招标控制价|工程合同估算价|合同估算价|采购需求|招标人|采购人|招标代理机构|代理机构|投标截止时间|开标时间|递交截止时间|开标地点|工期|计划工期|资金来源)[（(][^）)]{0,12}[）)]?[：:](.+)$/;
  for (const ln of lines) {
    const kv = ln.match(kvKeys);
    if (kv && kv[2].trim().length <= 80 && kvRows.length < 12) {
      kvRows.push({ k: kv[1], v: kv[2].trim() });
    }
    if (/^(?:[一二三四五六七八九十]+[、.．]|[1-9]\.[0-9]?\s*[\u4e00-\u9fa5])/.test(ln) && ln.length <= 48) {
      bodyBlocks.push(`<h3>${esc(ln)}</h3>`);
    } else {
      let safe = esc(ln);
      safe = safe.replace(/(202\d[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:\s*(?:上午|下午)?\s*\d{1,2}[:：时点]\d{0,2}分?)?)/g, `<strong style="color:var(--danger);">$1</strong>`);
      safe = safe.replace(/([\d,]+(?:\.\d+)?\s*(?:亿元|万元))/g, `<strong style="color:var(--accent);">$1</strong>`);
      bodyBlocks.push(`<p>${safe}</p>`);
    }
  }
  const kvHtml = kvRows.length ? `
    <div class="official-kv-grid">
      ${kvRows.map((r) => `<div><span class="muted" style="font-size:11.5px;">${esc(r.k)}</span><div style="font-weight:600;font-size:13px;">${esc(r.v)}</div></div>`).join("")}
    </div>
  ` : "";
  return `<div class="official-doc-paper">${kvHtml}${bodyBlocks.join("")}</div>`;
}

function badge(tone, iconKey, text) {
  return `<span class="badge badge-${tone}">${ICONS[iconKey] || ""}<span>${esc(text)}</span></span>`;
}

function deadlineBadge(nsStr, textFallback) {
  if (!nsStr || nsStr === "0") {
    return textFallback
      ? `<span class="dl-pill dl-pill-expired">${esc(textFallback)}</span>`
      : `<span class="dl-pill dl-pill-expired">未标注</span>`;
  }
  const { tier, diffH } = getDeadlineUrgency(nsStr);
  const label = textFallback ? `${textFallback}` : fmtBeijing(nsStr).replace(" 北京时间", "");
  if (tier === "expired") {
    return `<div><span class="dl-pill dl-pill-expired">已截止</span></div><div class="muted num" style="font-size:11px;margin-top:2px;">${esc(label)}</div>`;
  }
  if (tier === "critical") {
    return `<div><span class="dl-pill dl-pill-critical">剩 ${Math.max(1, Math.round(diffH))} 小时 · 1天内开标</span></div><div class="num" style="font-size:11.5px;color:#d92d20;font-weight:600;margin-top:2px;">${esc(label)}</div>`;
  }
  if (tier === "urgent") {
    return `<div><span class="dl-pill dl-pill-urgent">剩 ${Math.ceil(diffH / 24)} 天（${Math.round(diffH)}h）</span></div><div class="muted num" style="font-size:11px;margin-top:2px;">${esc(label)}</div>`;
  }
  if (tier === "soon") {
    return `<div><span class="dl-pill dl-pill-soon">剩 ${Math.ceil(diffH / 24)} 天</span></div><div class="muted num" style="font-size:11px;margin-top:2px;">${esc(label)}</div>`;
  }
  return `<div><span class="dl-pill dl-pill-calm">剩 ${Math.ceil(diffH / 24)} 天</span></div><div class="muted num" style="font-size:11px;margin-top:2px;">${esc(label)}</div>`;
}

function stageBadge(stage, label) {
  if (stage === "tender") return badge("info", "radar", label || "招标公告");
  if (stage === "amendment") return badge("danger", "alert", label || "更正/答疑");
  if (stage === "intent") return badge("warn", "info", label || "采购意向");
  if (stage === "result") return badge("good", "check", label || "中标/结果");
  if (stage === "terminated") return badge("quiet", "x", label || "终止/流标");
  return badge("quiet", "file", label || "其他公告");
}

function decisionBadge(dec) {
  if (dec === "bidding") return badge("good", "check", "已选定参投");
  if (dec === "watching") return badge("info", "clock", "已选定跟进");
  if (dec === "declined") return badge("quiet", "x", "不参与");
  return badge("quiet", "info", "未选定");
}

const routeScroll = new Map();
const routeTabAttributes = ["data-tab", "data-rev-view", "data-rper", "data-mper", "data-ek",
  "data-fin-tab", "data-switch-co", "data-proj-step", "data-proj-co", "data-dec", "data-opp-view",
  "data-pflt", "data-sample-trade"];
const routeTabSelector = routeTabAttributes.map((name) => `button[${name}]`).join(",");
history.scrollRestoration = "manual";

async function renderNavigation(previousPath, scrollY) {
  const route = state.route;
  const focused = document.activeElement;
  const tabAttribute = [...routeTabAttributes, "data-go"].find((name) => focused?.hasAttribute(name));
  const fieldSelector = focused?.id
    ? `#${CSS.escape(focused.id)}`
    : focused?.name && focused.form?.id
      ? `#${CSS.escape(focused.form.id)} [name="${CSS.escape(focused.name)}"]`
      : tabAttribute
        ? `[${tabAttribute}="${CSS.escape(focused.getAttribute(tabAttribute))}"]`
        : null;
  const selection = focused instanceof HTMLInputElement && focused.selectionStart !== null
    ? [focused.selectionStart, focused.selectionEnd]
    : null;
  const companyTab = tabAttribute === "data-switch-co";
  const focusPage = !companyTab && previousPath.split("?")[0] !== route.split("?")[0];
  const nextScroll = scrollY ?? (focusPage ? 0 : window.scrollY);
  const committed = await render();
  if (!committed || state.route !== route) return;
  const content = document.getElementById("main-content");
  if (!content) return;
  window.scrollTo(0, nextScroll);
  if (!dialogStack.length && document.activeElement === document.body) {
    const field = !focusPage && fieldSelector ? document.querySelector(fieldSelector) : null;
    (field || content).focus({ preventScroll: true });
    if (selection && field instanceof HTMLInputElement && field.selectionStart !== null) {
      field.setSelectionRange(...selection);
    }
  }
}

function navigate(path) {
  if (path === state.route) return;
  const doNav = () => {
    state.formDirty = false;
    closeRouteDialogs();
    const previous = state.route;
    if (path !== previous) {
      routeScroll.set(committedRoute, window.scrollY);
      history.pushState(null, "", path);
      state.route = path;
    }
    renderNavigation(committedRoute);
  };
  if (state.formDirty && path !== state.route) {
    openConfirmModal({
      title: "有未保存的表单修改",
      message: "当前页面表单有尚未保存的更改，离开后这些修改将会丢失，确认离开吗？",
      confirmLabel: "放弃修改并离开",
      danger: true,
      onConfirm: doNav,
    });
    return;
  }
  doNav();
}

window.addEventListener("popstate", () => {
  closeRouteDialogs();
  state.formDirty = false;
  routeScroll.set(committedRoute, window.scrollY);
  state.route = location.pathname + location.search;
  renderNavigation(committedRoute, routeScroll.get(state.route) ?? 0);
});

// ================= UNIVERSAL UPLOAD DROPZONE (Click Multi / Drag&Drop / Ctrl+V Paste) =================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function attachUniversalDropzone(container, opts = {}) {
  const {
    multiple = true,
    accept = "application/pdf,.pdf,image/*,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif,.docx,.xlsx,.csv,.txt",
    title = "点击选择、拖拽文件至此，或直接 Ctrl+V 粘贴截图/文件",
    hint = multiple ? "支持多文档多选 · PDF / 各类图片(PNG/JPG/WEBP/BMP/TIFF) / DOCX / XLSX / TXT（≤15MB）" : "支持拖拽或 Ctrl+V 粘贴 · PDF / 各类图片 / DOCX / XLSX / TXT",
    pasteScope = container,
    onFilesChange = () => {},
  } = opts;
  let files = [];

  container.innerHTML = `
    <div class="uz-dropzone" tabindex="0" role="button" aria-label="${esc(title)}">
      <div class="uz-head">
        <div>
          <div class="uz-title">${esc(title)}</div>
          <div class="uz-hint">${esc(hint)}</div>
        </div>
        <button type="button" class="btn btn-sm uz-pick-btn">${multiple ? "多选文件" : "选择文件"}</button>
      </div>
      <input type="file" class="uz-input" ${multiple ? "multiple" : ""} accept="${esc(accept)}" style="display:none;" />
      <div class="uz-file-list"></div>
    </div>
  `;

  const dz = container.querySelector(".uz-dropzone");
  const input = container.querySelector(".uz-input");
  const listEl = container.querySelector(".uz-file-list");

  const renderList = () => {
    if (!files.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = files.map((f, idx) => {
      const isImg = /^image\//.test(f.type);
      const sizeKb = Math.max(1, Math.round(f.size / 1024));
      return `<span class="uz-file-chip" title="${esc(f.name)}">
        <span class="muted">[${isImg ? "图" : "文"}]</span>
        <span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
        <span class="muted" style="font-size:11px;">(${sizeKb}KB)</span>
        <button type="button" data-uz-rm="${idx}" aria-label="移除">&times;</button>
      </span>`;
    }).join("");
    listEl.querySelectorAll("[data-uz-rm]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const idx = Number(btn.getAttribute("data-uz-rm"));
        files.splice(idx, 1);
        renderList();
        onFilesChange([...files]);
      });
    });
  };

  const addFiles = (incoming) => {
    const arr = Array.from(incoming || []).filter((f) => f && f.size > 0);
    if (!arr.length) return;
    if (!multiple) {
      files = [arr[0]];
    } else {
      for (const f of arr) {
        if (!files.some((ex) => ex.name === f.name && ex.size === f.size)) {
          files.push(f);
        }
      }
    }
    renderList();
    onFilesChange([...files]);
  };

  dz.addEventListener("click", (e) => {
    if (e.target.closest("[data-uz-rm]")) return;
    input.click();
  });
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("is-dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("is-dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("is-dragover");
    addFiles(e.dataTransfer?.files);
  });

  const onPaste = (e) => {
    if (!document.body.contains(dz)) {
      pasteScope?.removeEventListener?.("paste", onPaste);
      return;
    }
    const items = e.clipboardData?.items || [];
    const pasted = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) {
          const ext = f.type === "image/png" ? "png" : f.type === "image/jpeg" ? "jpg" : f.type === "application/pdf" ? "pdf" : "bin";
          const named = f.name && f.name !== "image.png" ? f : new File([f], `剪贴板粘贴_${Date.now()}_${pasted.length + 1}.${ext}`, { type: f.type });
          pasted.push(named);
        }
      }
    }
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
      showToast(`已从剪贴板粘贴 ${pasted.length} 个文件`);
    }
  };
  (pasteScope || dz).addEventListener("paste", onPaste);

  return {
    getFiles: () => [...files],
    clear: () => { files = []; renderList(); onFilesChange([]); },
    destroy: () => { pasteScope?.removeEventListener?.("paste", onPaste); },
  };
}

// ================= 1. LOGIN & FIRST PASSWORD CHANGE =================
function renderAuth(root) {
  const u = state.user;
  const unapproved = u && u.approval !== "approved";
  const heading = unapproved
    ? (u.approval === "pending" ? "账号等待管理员审批" : "账号未获批准")
    : "欢迎回到投标雷达";

  root.innerHTML = `
    <div class="auth-page">
      <aside class="auth-side">
        <div>
          <div class="brand">
            <span class="product-mark" aria-hidden="true">标</span>
            <div><strong style="color:#fff;font-size:15px;">Civic Bid Radar · 投标雷达</strong><small style="color:rgba(255,255,255,0.72);">Enterprise Bidding OS</small></div>
          </div>
          <h2 class="auth-hero-title">工程招投标协同台账</h2>
          <p class="auth-hero-sub">面向工程投标、资金财务与现场委托团队的内部业务系统：从商机去重研判、7 阶段标段推进、保证金直推财务打款，到公司资质 OCR 建档与下浮率复盘。</p>
          <div class="auth-feature-grid">
            <div class="auth-feature-item">
              <strong>按岗定制首页，全员负责人级协同</strong>
              <span>进入系统直达当日核心任务，岗位首页视图由管理员统一配置。</span>
            </div>
            <div class="auth-feature-item">
              <strong>保证金打款任务与回执闭环</strong>
              <span>阶段 3 自动提取账户金额并推送财务，上传回执后自动入账并推进流程。</span>
            </div>
            <div class="auth-feature-item">
              <strong>高清中文 OCR 与云端原件留痕</strong>
              <span>支持粘贴、拖拽与多选上传，原件云端加密留痕，操作全程审计。</span>
            </div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;">
          <span>投标雷达自托管工作台</span>
          <span>HTTPS 加密 · 操作留痕审计</span>
        </div>
      </aside>
      <main class="auth-main">
        <div class="auth-card">
          <h1>${esc(heading)}</h1>
          <p class="muted" style="margin:0 0 20px;font-size:13px;">${
            unapproved ? "请联系管理员核对审批状态后再登录。"
            : "请使用企业内部账号与密码登录工作台。"
          }</p>
          <div id="auth-err" class="notice-box danger" style="display:none;margin-bottom:14px;" role="alert"></div>
          ${unapproved ? "" : `
            <div class="auth-tab-bar" role="tablist">
              <button type="button" class="auth-tab-btn active" id="auth-tab-login">账号密码登录</button>
              <button type="button" class="auth-tab-btn" id="auth-tab-help">账号与权限说明</button>
            </div>
            <div id="auth-panel-login">
              <form id="login-form">
                <div class="field">
                  <label for="lg-user">企业账号</label>
                  <input id="lg-user" class="input" name="username" required autocomplete="username" spellcheck="false" placeholder="例如 demo_admin" />
                </div>
                <div class="field">
                  <label for="lg-pass" style="display:flex;justify-content:space-between;">
                    <span>登录密码</span>
                    <button type="button" id="toggle-pw-vis" style="border:none;background:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0;">显示密码</button>
                  </label>
                  <input id="lg-pass" class="input" type="password" name="password" required autocomplete="current-password" placeholder="请输入密码" />
                </div>
                <button class="btn btn-primary" style="width:100%;height:40px;font-size:14px;margin-top:6px;" type="submit" id="btn-login-submit">登录工作台</button>
              </form>
            </div>
            <div id="auth-panel-help" style="display:none;font-size:12.5px;color:var(--text-muted);line-height:1.7;">
              <div class="notice-box info" style="margin-bottom:10px;">
                <span>您的<strong>岗位首页视图</strong>由管理员在「系统管理」中统一指定。</span>
              </div>
              <p style="margin:0 0 6px;">• 忘记密码或需开通新员工账号，请联系管理员重置初始密码。</p>
              <p style="margin:0;">• 首次登录后建议点击右上角「改密」修改个人密码。</p>
            </div>
          `}
          ${u ? `<button id="btn-logout" class="btn btn-ghost" style="width:100%;margin-top:10px;">退出当前账号</button>` : ""}
        </div>
      </main>
    </div>
  `;

  const errEl = root.querySelector("#auth-err");
  const showErr = (m) => { errEl.innerHTML = `${ICONS.alert}<span>${esc(m)}</span>`; errEl.style.display = "flex"; };

  const tabLogin = root.querySelector("#auth-tab-login");
  const tabHelp = root.querySelector("#auth-tab-help");
  const panelLogin = root.querySelector("#auth-panel-login");
  const panelHelp = root.querySelector("#auth-panel-help");
  tabLogin?.addEventListener("click", () => {
    tabLogin.classList.add("active"); tabHelp?.classList.remove("active");
    if (panelLogin) panelLogin.style.display = ""; if (panelHelp) panelHelp.style.display = "none";
  });
  tabHelp?.addEventListener("click", () => {
    tabHelp.classList.add("active"); tabLogin?.classList.remove("active");
    if (panelHelp) panelHelp.style.display = ""; if (panelLogin) panelLogin.style.display = "none";
  });

  root.querySelector("#toggle-pw-vis")?.addEventListener("click", (e) => {
    const inp = root.querySelector("#lg-pass");
    if (!inp) return;
    const isPw = inp.type === "password";
    inp.type = isPw ? "text" : "password";
    e.target.textContent = isPw ? "隐藏密码" : "显示密码";
  });

  root.querySelector("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = root.querySelector("#btn-login-submit");
    if (!btn || btn.disabled) return;
    setSubmitPending(btn, true);
    const fd = new FormData(e.target);
    try {
      await api("/auth/sign-in/username", { username: String(fd.get("username")).trim(), password: String(fd.get("password")) });
      await bootSession();
    } catch (err) {
      showErr(err.message);
      setSubmitPending(btn, false);
      btn.focus({ preventScroll: true });
    }
  });

  root.querySelector("#btn-logout")?.addEventListener("click", async () => {
    await api("/auth/sign-out", {}).catch(() => {});
    state.user = null;
    render();
  });
}

// ================= APP SHELL (Desktop 1440 + Mobile 390) =================
function renderShell(root, activeKey, crumbs, contentHtml) {
  const u = state.user;
  state.perspective = (u && ROLES[u.perspective]) ? u.perspective : "lead";
  const roleInfo = ROLES[state.perspective] || ROLES.lead;
  const initials = (u.name || u.username || "U").slice(-2);
  const collapsed = localStorage.getItem("br-side-collapsed") === "1";
  const sysActive = ["settings", "admin-accounts", "admin-audit"].includes(activeKey);
  const okSrc = state.syncMeta ? (state.syncMeta.enabledSources - state.syncMeta.unhealthySources) : 0;
  const totalSrc = state.syncMeta ? state.syncMeta.enabledSources : 0;

  root.innerHTML = `
    <div class="shell ${collapsed ? "is-collapsed" : ""}">
      <aside class="sidebar" aria-label="主导航">
        <div class="sidebar-brand-box" style="cursor:pointer;" id="brand-home" title="Civic Bid Radar · 投标雷达">
          <span class="product-mark" aria-hidden="true">标</span>
          <div>
            <strong>Civic Bid Radar · 投标雷达</strong>
            <small>${esc(roleInfo.name)}工作台</small>
          </div>
        </div>

        <nav class="nav-section">
          <span class="nav-label">工作台与商机</span>
          <button class="nav-item ${activeKey === "home" ? "active" : ""}" data-go="/" title="岗位首页">
            <span class="nav-item-left">${ICONS.home}<span>岗位首页</span></span>
          </button>
          <button class="nav-item ${activeKey === "opportunities" ? "active" : ""}" data-go="/opportunities" title="机会池">
            <span class="nav-item-left">${ICONS.radar}<span>机会池</span></span>
          </button>
          <button class="nav-item ${activeKey === "review" ? "active" : ""}" data-go="/review" title="复盘与下浮率统计">
            <span class="nav-item-left">${ICONS.check}<span>复盘与下浮率统计</span></span>
          </button>
          <button class="nav-item ${activeKey === "entities" ? "active" : ""}" data-go="/entities" title="企查与主体画像">
            <span class="nav-item-left">${ICONS.users}<span>企查与主体画像</span></span>
          </button>
        </nav>

        <nav class="nav-section">
          <span class="nav-label">标段与资金执行</span>
          <button class="nav-item ${["projects", "matrix", "opening", "estimate", "outcomes"].includes(activeKey) ? "active" : ""}" data-go="/projects" title="项目库">
            <span class="nav-item-left">${ICONS.check}<span>项目库</span></span>
          </button>
          <button class="nav-item ${activeKey === "finance" ? "active" : ""}" data-go="/finance" title="资金台账与打款">
            <span class="nav-item-left">${ICONS.file}<span>资金台账与打款</span></span>
            ${state.pendingPayCount > 0 ? `<span class="nav-count">${state.pendingPayCount}</span>` : ""}
          </button>
          <button class="nav-item ${activeKey === "schedule" ? "active" : ""}" data-go="/schedule" title="日程与现场">
            <span class="nav-item-left">${ICONS.clock}<span>日程与现场</span></span>
          </button>
          <button class="nav-item ${activeKey === "alerts" ? "active" : ""}" data-go="/alerts" title="提醒中心">
            <span class="nav-item-left">${ICONS.bell}<span>提醒中心</span></span>
            ${state.openAlerts > 0 ? `<span class="nav-count">${state.openAlerts}</span>` : ""}
          </button>
        </nav>

        <nav class="nav-section">
          <span class="nav-label">档案与系统</span>
          <button class="nav-item ${activeKey === "companies" || activeKey === "gaps" ? "active" : ""}" data-go="/companies" title="公司与资料库">
            <span class="nav-item-left">${ICONS.users}<span>公司与资料库</span></span>
          </button>
          <button class="nav-item ${activeKey === "sources" ? "active" : ""}" data-go="/sources" title="来源与同步核验">
            <span class="nav-item-left">${ICONS.shield}<span>来源与同步核验</span></span>
            ${state.syncMeta?.unhealthySources > 0 ? `<span class="nav-count warn">${state.syncMeta.unhealthySources}</span>` : ""}
          </button>
          <button class="nav-item ${sysActive ? "active" : ""}" data-go="/settings" title="系统管理">
            <span class="nav-item-left">${ICONS.info}<span>系统管理</span></span>
          </button>
        </nav>

        <div class="sidebar-foot">
          <div class="sidebar-user-card" title="${esc(u.name)} · ${esc(roleInfo.name)}首页">
            <div class="sidebar-avatar">${esc(initials)}</div>
            <div style="min-width:0;flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
                <span>${esc(roleInfo.name)}首页</span>
                <span>·</span>
                <span>${u.role === "admin" ? "管理员" : "全权限成员"}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main-col">
        <header class="topbar">
          <div class="topbar-left">
            <button type="button" class="topbar-icon-btn" id="btn-toggle-side" aria-label="${collapsed ? "展开侧边导航" : "收起侧边导航"}" title="${collapsed ? "展开侧边导航" : "收起侧边导航"}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
            </button>
            <nav class="topbar-crumbs" aria-label="当前位置">
              ${crumbs.map((c, idx) => idx === crumbs.length - 1
                ? `<span class="crumb-current">${esc(c.label)}</span>`
                : `<a href="${esc(c.href)}" data-go="${esc(c.href)}">${esc(c.label)}</a><span class="crumb-sep">/</span>`).join("")}
            </nav>
          </div>
          <div class="topbar-right">
            <button type="button" class="cmd-trigger" id="btn-cmd-palette" aria-label="打开全局命令与搜索面板">
              <span style="display:inline-flex;align-items:center;gap:6px;min-width:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span class="cmd-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">搜索公告、主体、项目…</span>
              </span>
              <kbd>⌘K</kbd>
            </button>
            ${state.syncMeta ? `
              <button type="button" class="sync-dot-pill" data-go="/sources" title="最近同步：${esc(fmtBeijing(state.syncMeta.observedAt))}${state.syncMeta.unhealthySources > 0 ? ` · ${state.syncMeta.unhealthySources} 个源异常` : " · 全部健康"}">
                <span class="sync-dot ${state.syncMeta.unhealthySources > 0 ? "warn" : ""}"></span>
                <span class="num">源 ${okSrc}/${totalSrc}</span>
              </button>
            ` : ""}
            <button type="button" class="topbar-icon-btn" data-go="/alerts" aria-label="提醒中心" title="提醒中心（${state.openAlerts || 0} 条待处理）">
              ${ICONS.bell}
              ${state.openAlerts > 0 ? `<span class="topbar-badge-dot">${state.openAlerts > 99 ? "99+" : state.openAlerts}</span>` : ""}
            </button>
            <button type="button" class="topbar-icon-btn" id="btn-theme" aria-label="暗色模式" aria-pressed="${state.dark}" title="${state.dark ? "切换为亮色模式" : "切换为暗色模式"}">
              <svg class="theme-sun" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              <svg class="theme-moon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <div class="topbar-user-wrap">
              <button type="button" class="topbar-user-btn" id="btn-user-menu" aria-haspopup="true" aria-expanded="false">
                <span class="topbar-avatar">${esc(initials)}</span>
                <span class="topbar-user-name">${esc(u.name)}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="topbar-popover" id="topbar-user-pop" role="menu">
                <div class="topbar-popover-head">
                  <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(u.name)}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(roleInfo.name)}工作台 · ${u.role === "admin" ? "管理员" : "全权限成员"}</div>
                </div>
                <button type="button" class="topbar-popover-item" id="btn-my-pw" role="menuitem"><span>修改登录密码</span></button>
                <button type="button" class="topbar-popover-item" data-go="/settings" role="menuitem"><span>系统管理与诊断</span></button>
                <button type="button" class="topbar-popover-item danger" id="btn-signout" role="menuitem"><span>退出登录</span></button>
              </div>
            </div>
          </div>
        </header>

        <main class="content" id="main-content" tabindex="-1" aria-label="${esc(crumbs.at(-1)?.label || "工作台")}">
          <div class="route-loading" id="route-loading" role="status" hidden></div>
          <div id="main-slot">${contentHtml}</div>
        </main>
      </div>
    </div>

    <nav class="mobile-nav" aria-label="移动端底部导航">
      <button class="${activeKey === "home" ? "active" : ""}" data-go="/">${ICONS.home}<span>首页</span></button>
      <button class="${activeKey === "opportunities" ? "active" : ""}" data-go="/opportunities">${ICONS.radar}<span>机会池</span></button>
      <button class="${activeKey === "finance" ? "active" : ""}" data-go="/finance">${ICONS.file}<span>资金${state.pendingPayCount > 0 ? `(${state.pendingPayCount})` : ""}</span></button>
      <button class="${activeKey === "alerts" ? "active" : ""}" data-go="/alerts">${ICONS.bell}<span>提醒${state.openAlerts > 0 ? `(${state.openAlerts})` : ""}</span></button>
    </nav>
  `;

  root.querySelector("#brand-home")?.addEventListener("click", () => navigate("/"));
  root.querySelector("#btn-toggle-side")?.addEventListener("click", () => {
    const next = localStorage.getItem("br-side-collapsed") === "1" ? "0" : "1";
    localStorage.setItem("br-side-collapsed", next);
    root.querySelector(".shell")?.classList.toggle("is-collapsed", next === "1");
    const b = root.querySelector("#btn-toggle-side");
    if (b) {
      b.setAttribute("aria-label", next === "1" ? "展开侧边导航" : "收起侧边导航");
      b.setAttribute("title", next === "1" ? "展开侧边导航" : "收起侧边导航");
    }
  });
  const userBtn = root.querySelector("#btn-user-menu");
  const userPop = root.querySelector("#topbar-user-pop");
  userBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = userPop?.classList.toggle("open");
    userBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  if (!window.__brGlobalUiBound) {
    window.__brGlobalUiBound = true;
    document.addEventListener("click", (e) => {
      const pop = document.querySelector("#topbar-user-pop.open");
      if (pop && !e.target.closest(".topbar-user-wrap")) {
        pop.classList.remove("open");
        document.querySelector("#btn-user-menu")?.setAttribute("aria-expanded", "false");
      }
      if (e.target.matches?.(".modal-backdrop:not([data-locked], [data-managed-dialog])")) {
        e.target.remove();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const pop = document.querySelector("#topbar-user-pop.open");
        if (pop) {
          pop.classList.remove("open");
          document.querySelector("#btn-user-menu")?.setAttribute("aria-expanded", "false");
          return;
        }
        if (dialogStack.length) return;
        const modals = document.querySelectorAll(".modal-backdrop:not([data-locked], [data-managed-dialog])");
        if (modals.length) modals[modals.length - 1].remove();
      }
    });
  }
  root.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.getAttribute("data-go"));
    });
  });
  const mainSlot = root.querySelector("#main-slot");
  mainSlot?.addEventListener("click", (event) => {
    const tab = event.target.closest(routeTabSelector);
    const currentTab = tab?.classList.contains("active");
    if (currentTab && !mainSlot.hasAttribute("data-route-pending")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!mainSlot.hasAttribute("data-route-pending")) return;
    if (tab || event.target.closest('[data-go], #flt-match-co')) return;
    if (!event.target.closest("button, input, select, textarea, a[href], [role=button]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  for (const type of ["submit", "beforeinput", "input", "change", "drop", "paste", "keydown"]) {
    mainSlot?.addEventListener(type, (event) => {
      if (!mainSlot.hasAttribute("data-route-pending")) return;
      if (event.target.id === "flt-match-co" && ["input", "change", "keydown"].includes(type)) return;
      if (type === "keydown" && event.target.closest(`${routeTabSelector}, [data-go]`)) return;
      if (type !== "keydown" || ["Enter", " "].includes(event.key) && event.target.closest("button, input, select, textarea, a[href], [role=button]")) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    }, true);
  }
  mainSlot?.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const goEl = e.target.closest("[data-go]");
    if (goEl) { e.preventDefault(); navigate(goEl.getAttribute("data-go")); return; }
    const pvEl = e.target.closest("[data-preview-file]");
    if (pvEl) { e.preventDefault(); openFilePreviewModal(pvEl.getAttribute("data-preview-file"), pvEl.getAttribute("data-fname"), pvEl); return; }
  });
  root.querySelector("#btn-cmd-palette")?.addEventListener("click", openCommandPalette);
  root.querySelectorAll(".nav-item.active, .mobile-nav .active").forEach((button) => {
    button.setAttribute("aria-current", "page");
  });
  root.querySelector("#btn-theme")?.addEventListener("click", (event) => {
    state.dark = !state.dark;
    localStorage.setItem("br-theme", state.dark ? "dark" : "light");
    applyTheme();
    event.currentTarget.setAttribute("aria-pressed", String(state.dark));
    event.currentTarget.title = state.dark ? "切换为亮色模式" : "切换为暗色模式";
  });
  root.querySelector("#btn-my-pw")?.addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="修改个人密码">
        <h3 style="margin:0 0 12px;">修改个人登录密码</h3>
        <form id="self-pw-form">
          <div class="field"><label>当前密码</label><input class="input" type="password" name="cur" required autocomplete="current-password" /></div>
          <div class="field"><label>新密码（8–128 位）</label><input class="input" type="password" name="n1" required minlength="8" autocomplete="new-password" /></div>
          <div class="field"><label>再次输入新密码</label><input class="input" type="password" name="n2" required minlength="8" autocomplete="new-password" /></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="spw-cancel">取消</button><button type="submit" class="btn btn-primary">确认修改</button></div>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#spw-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#self-pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get("n1") !== fd.get("n2")) { showToast("两次输入的新密码不一致。"); return; }
      try {
        await api("/password", { currentPassword: String(fd.get("cur")), newPassword: String(fd.get("n1")) });
        wrap.remove();
        state.user = null;
        showToast("密码已修改，请使用新密码重新登录。");
        render();
      } catch (err) { showToast(err.message); }
    });
  });
  root.querySelector("#btn-signout")?.addEventListener("click", async () => {
    await api("/auth/sign-out", {}).catch(() => {});
    state.user = null;
    render();
  });
  return root.querySelector("#main-slot");
}

// ================= 2. FOUR ROLE HOMEPAGES (/) =================
async function renderHome(root) {
  const role = ROLES[state.perspective] || ROLES.lead;
  const slot = renderShell(root, "home", [{ label: "岗位首页" }], `<div class="card">正在读取${esc(role.name)}工作台数据…</div>`);
  try {
    const data = await api("/workbench/home");
    if (!isCurrentRender(root)) return;
    state.companies = data.companies || [];
    state.syncMeta = data.syncMeta || state.syncMeta;
    state.openAlerts = data.stats?.openAlertCount ?? 0;
    const pendingPayTasks = data.pendingPayTasks || [];
    state.pendingPayCount = pendingPayTasks.length;

    const hr = new Date().getHours();
    const greeting = hr < 11 ? "上午好" : hr < 14 ? "中午好" : hr < 18 ? "下午好" : "晚上好";
    const nowMs = Date.now();
    const urgentProjects = (data.selectedProjects || []).filter((p) => {
      const dl = Number(p.deadline || 0) / 1e6;
      return dl > nowMs && (dl - nowMs) <= 72 * 3600_000;
    });
    const matchedList = data.matchedOpportunities || [];

    slot.innerHTML = `
      <!-- 飞书式早间行动欢迎栏 -->
      <div class="fs-hero">
        <div>
          <h2 class="fs-hero-title">
            ${greeting}，${esc(state.user?.name || "同事")}
            ${badge("info", "radar", `${role.name}首页`)}
            ${urgentProjects.length > 0 ? badge("danger", "alert", `${urgentProjects.length} 个已选标段 72h 内截止`) : ""}
          </h2>
          <div class="fs-hero-sub">
            ${esc(role.focus)} · 当前库内在招未截止 <strong>${data.stats.openTenders}</strong> 标，经档案比对有依据 <strong>${matchedList.length}</strong> 标，待办提醒 <strong>${data.stats.openAlertCount}</strong> 条。
          </div>
        </div>
        <div class="fs-hero-actions">
          <button type="button" class="btn btn-primary btn-sm" id="hero-go-opp">前往机会池扫新标</button>
          <button type="button" class="btn btn-sm" id="hero-go-proj">进入项目库跟进 (${data.stats.selectedCount})</button>
          <button type="button" class="btn btn-sm" id="hero-go-rev">复盘与下浮率统计</button>
        </div>
      </div>

      ${state.perspective === "finance" ? `
        <div class="card" style="border:1px solid var(--accent-border);margin-bottom:14px;">
          <div class="card-head">
            <div>
              <h2 style="margin:0;">财务专属待办：保证金打款与在途催退</h2>
              <div class="muted" style="font-size:12px;">待打款 ${pendingPayTasks.length} 笔 · 在途未退保证金 ${(data.overdueDeposits || []).length} 个项目</div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-go="/finance?tab=paytasks">进入资金台账执行打款</button>
          </div>
          ${pendingPayTasks.length ? `
            <div class="table-wrap" style="margin-bottom:10px;">
              <table class="tbl">
                <thead><tr><th>项目标段 / 公司</th><th>收款户名 / 账号 / 开户行</th><th class="amount">需打款金额</th><th>操作</th></tr></thead>
                <tbody>
                  ${pendingPayTasks.slice(0, 5).map((t) => `
                    <tr>
                      <td><a class="row-title" href="/projects/${esc(t.notice_id)}" data-go="/projects/${esc(t.notice_id)}">${esc(t.notice_title || t.notice_id)}</a><div class="muted" style="font-size:11.5px;">${esc(t.company_name || "默认公司")} · ${esc(t.deposit_method || "")}</div></td>
                      <td style="font-size:12px;"><strong>${esc(t.payee_name || "未填")}</strong><div class="muted num">${esc(t.payee_account || "未填")} ${t.payee_bank ? `· ${esc(t.payee_bank)}` : ""}</div></td>
                      <td class="amount num" style="font-weight:700;color:var(--danger);">${esc(fmtFen(t.amount_fen))}</td>
                      <td><button type="button" class="btn btn-sm btn-primary" data-go="/finance?tab=paytasks">打款并传回执</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="muted" style="margin-bottom:10px;">当前无待打款保证金任务。</div>`}
          ${(data.overdueDeposits || []).length ? `
            <div style="border-top:1px solid var(--border);padding-top:10px;">
              <div style="font-size:12.5px;font-weight:600;margin-bottom:6px;">在途待退保证金重点追踪（按打款时间最早排序）</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${data.overdueDeposits.slice(0, 4).map((od) => `
                  <a class="quick-pill" href="/finance?tab=recovery" data-go="/finance?tab=recovery" style="padding:5px 10px;">
                    ${esc((od.noticeTitle || "").slice(0, 22))} · <strong style="color:var(--danger);">${esc(fmtFen(od.outFen))}</strong>
                  </a>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      ` : state.perspective === "delegate" ? `
        <div class="card" style="border:1px solid var(--accent-border);margin-bottom:14px;">
          <div class="card-head">
            <div>
              <h2 style="margin:0;">授权委托人专属：近期开标日程与现场物资核对</h2>
              <div class="muted" style="font-size:12px;">出发前请逐项核对：CA 锁、法人授权委托书原件、身份证原件及密封标书</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-primary btn-sm" data-go="/opening">上传现场唱标表</button>
              <button type="button" class="btn btn-sm" data-go="/schedule">完整日程排班</button>
            </div>
          </div>
          ${(data.upcomingSchedules || []).length ? `
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>开标时间 / 地点</th><th>项目标段</th><th>指派委托人与携带物资</th><th>快捷入口</th></tr></thead>
                <tbody>
                  ${data.upcomingSchedules.slice(0, 5).map((s) => `
                    <tr>
                      <td class="num" style="font-size:12.5px;"><strong>${esc(s.open_time || s.submit_time || "待定")}</strong><div class="muted">${esc(s.venue || "详见公告地点")}</div></td>
                      <td><a class="row-title" href="/projects/${esc(s.notice_id)}" data-go="/projects/${esc(s.notice_id)}">${esc(s.notice_title)}</a></td>
                      <td style="font-size:12px;"><strong>${esc(s.delegate_name || "待指派")}</strong>（${esc(s.open_mode || "现场")}）<div class="muted">${esc(s.note || "携带：CA锁、授权委托书、身份证原件")}</div></td>
                      <td><button type="button" class="btn btn-sm" data-go="/projects/${esc(s.notice_id)}">进标段工作台</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="muted">当前暂无已排期的开标日程，可在项目库「阶段 4」指派委托人后自动同步至此处。</div>`}
        </div>
      ` : pendingPayTasks.length > 0 ? `
        <div class="card" style="border:1px solid var(--danger-border);background:var(--danger-bg);margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div>
              <strong style="font-size:14px;color:var(--danger);">有 ${pendingPayTasks.length} 笔投标保证金待财务打款任务</strong>
              <div class="muted" style="font-size:12.5px;margin-top:3px;">
                ${pendingPayTasks.slice(0, 2).map((t) => `「${esc((t.notice_title || t.notice_id).slice(0, 26))}」${esc(fmtFen(t.amount_fen))}（指派：${esc(t.assignee_name || "未指定财务负责人")}）`).join("；")}${pendingPayTasks.length > 2 ? ` 等共 ${pendingPayTasks.length} 笔` : ""}
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-go="/finance?tab=paytasks">前往资金台账执行打款并上传回执 →</button>
          </div>
        </div>
      ` : ""}

      <!-- TDesign 4大核心行动 KPI 卡 -->
      <div class="td-stat-row">
        <div class="td-stat-card is-link" data-go="/projects" role="button" tabindex="0">
          <div class="td-stat-label">项目库在跟进 / 参投标段</div>
          <div class="td-stat-value">${data.stats.selectedCount} <span style="font-size:13px;font-weight:400;" class="muted">个（参投 ${data.stats.biddingCount}）</span></div>
          <div class="td-stat-foot"><span>${urgentProjects.length > 0 ? `${urgentProjects.length} 个标段 3 天内截止` : "点击进入 7 阶段全流程跟进"}</span></div>
        </div>
        <div class="td-stat-card ${matchedList.length > 0 ? "td-good" : ""} is-link" id="kpi-go-qual" role="button" tabindex="0">
          <div class="td-stat-label">按公司档案筛选新标</div>
          <div class="td-stat-value" style="color:var(--good);">${matchedList.length} <span style="font-size:13px;font-weight:400;" class="muted">条有档案支持</span></div>
          <div class="td-stat-foot"><span>全库在招未截止共 ${data.stats.openTenders} 条 · 查看所匹配证据</span></div>
        </div>
        <div class="td-stat-card ${data.stats.openAlertCount > 0 ? "td-warn" : ""} is-link" data-go="/alerts" role="button" tabindex="0">
          <div class="td-stat-label">待处理站内提醒（更正 / 接力）</div>
          <div class="td-stat-value" style="${data.stats.openAlertCount > 0 ? "color:var(--warn);" : ""}">${data.stats.openAlertCount} <span style="font-size:13px;font-weight:400;" class="muted">条</span></div>
          <div class="td-stat-foot"><span>指派给本人 ${data.stats.myAlertCount} 条 · 点击进入提醒中心</span></div>
        </div>
        <div class="td-stat-card ${data.syncMeta.unhealthySources > 0 ? "td-danger" : ""} is-link" data-go="/sources" role="button" tabindex="0">
          <div class="td-stat-label">官方招采来源健康度</div>
          <div class="td-stat-value">${data.syncMeta.enabledSources - data.syncMeta.unhealthySources} <span style="font-size:14px;font-weight:500;" class="muted">/ ${data.syncMeta.enabledSources} 正常</span></div>
          <div class="td-stat-foot"><span>${data.syncMeta.unhealthySources > 0 ? `${data.syncMeta.unhealthySources} 个源受限，点击核验` : "已启用官方源均正常采集"}</span></div>
        </div>
      </div>

      <div class="wb-layout">
        <div>
          <!-- 模块1：按公司资质精准推送（支持行内一键速览与直接参投） -->
          <div class="card">
            <div class="card-head">
              <div>
                <h2 style="margin:0 0 2px;">新标待核清单</h2>
                <div class="muted">无需翻找大海，直接在此「速览」或一键「选定参投」送入项目库。</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                ${badge("good", "check", `有档案支持 ${matchedList.length} 条`)}
                <button class="btn btn-sm" id="go-qual-pool">去机会池查看全部</button>
              </div>
            </div>
            ${matchedList.length ? `
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th style="min-width:300px;">招标项目与资质命中依据</th>
                      <th class="amount" style="width:130px;">控制价（元）</th>
                      <th style="width:150px;">递交截止</th>
                      <th style="width:140px;">快捷决策</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${matchedList.map((m) => `
                      <tr>
                        <td>
                          <a class="row-title" href="/opportunities/${esc(m.id)}" data-open="${esc(m.id)}">${esc(m.title)}</a>
                          <div class="meta-row" style="margin-bottom:4px;">
                            ${m.region ? `<span class="prov">${esc(m.region)}</span>` : ""}
                            ${m.tradeType ? `<span class="prov">${esc(m.tradeType)}</span>` : ""}
                            <span>招标人：${esc(m.tenderer || "详见公告")}</span>
                          </div>
                          <div class="meta-row">
                            ${m.matchedCompanies.map((mc) => `
                              ${badge("good", "check", mc.companyName)}
                              <span class="muted">${esc(mc.reasons[0] || "")}</span>
                              ${mc.warnings?.length ? badge("warn", "alert", mc.warnings[0]) : ""}
                            `).join("")}
                          </div>
                        </td>
                        <td class="amount">${fmtYuan(m.budgetYuan) ? `<span class="opp-budget-big">${esc(fmtYuan(m.budgetYuan))}</span>` : `<span class="muted">${esc(m.budgetText || "按清单控制价")}</span>`}</td>
                        <td>${deadlineBadge(m.deadline, m.deadlineText)}</td>
                        <td>
                          <div class="opp-row-actions" style="margin-top:0;">
                            <button type="button" class="quick-pill" data-home-peek="${esc(m.id)}">速览</button>
                            <button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;" data-home-bid="${esc(m.id)}">+ 参投</button>
                          </div>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty-state">
                <strong>暂无匹配的在招项目（或尚未登记公司资质）</strong>
                <div>请在「公司与资料库」为参投公司登记资质（如“建筑工程施工总承包三级”“市政公用工程施工总承包二级”等），系统将自动匹配最近未截止且资质等级符合的招标项目并在此推送。</div>
                <div style="margin-top:10px;"><button class="btn btn-sm btn-primary" data-go="/companies">前往登记公司资质</button></div>
              </div>
            `}
          </div>

          <!-- 模块2：项目库在途标段作战台 -->
          <div class="card">
            <div class="card-head">
              <div>
                <h2 style="margin:0 0 2px;">项目库在途作战标段（${esc(role.name)}视角）</h2>
                <div class="muted">点击项目标题直达 7 阶段全流程跟进详情页（标书 / 保证金 / 开标 / 预测 / 退保）。</div>
              </div>
              <button class="btn btn-sm btn-primary" id="go-pool">去机会池选新标</button>
            </div>
            ${data.selectedProjects.length ? `
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>已选项目公告</th>
                      <th style="width:130px;">决策与责任人</th>
                      <th class="amount" style="width:130px;">控制价（元）</th>
                      <th style="width:155px;">报名 / 递交截止</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.selectedProjects.map((p) => `
                      <tr>
                        <td>
                          <a class="row-title" href="/projects/${esc(p.id)}" data-go="/projects/${esc(p.id)}">${esc(p.title)}</a>
                          <div class="meta-row">
                            ${stageBadge(p.stage, p.stageLabel)}
                            ${p.region ? `<span class="prov">${esc(p.region)}</span>` : ""}
                            ${p.amendmentCount > 0 ? badge("danger", "alert", `含 ${p.amendmentCount} 条更正`) : ""}
                          </div>
                        </td>
                        <td>
                          ${decisionBadge(p.decision)}
                          <div class="muted">负责人：${esc(p.assigneeName || "待指定")}</div>
                        </td>
                        <td class="amount">${fmtYuan(p.budgetYuan) ? `<span class="num" style="font-weight:600;">${esc(fmtYuan(p.budgetYuan))}</span>` : `<span class="muted">未标注</span>`}</td>
                        <td>${deadlineBadge(p.deadline, p.deadlineText)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty-state">
                <strong>尚未选定任何参投或跟进标段</strong>
                <div>下一步：前往「机会池」查看公告和公司档案，再决定是否选定参投，或在项目库直接粘贴外部公告链接录入。</div>
                <div style="margin-top:12px;"><button class="btn btn-primary" id="go-pool-empty">进入机会池筛选</button></div>
              </div>
            `}
          </div>

          <!-- 模块3：站内提醒与跨岗位接力待办 -->
          <div class="card">
            <div class="card-head">
              <h2>站内提醒与跨岗位接力待办</h2>
              <a href="/alerts" data-go="/alerts" class="btn btn-sm">全部提醒</a>
            </div>
            ${data.openAlerts.length ? `
              <div class="table-wrap">
                <table class="tbl">
                  <thead><tr><th style="width:95px;">类型</th><th>提醒事项（点击直达标段）</th><th style="width:95px;">责任人</th></tr></thead>
                  <tbody>
                    ${data.openAlerts.map((a) => `
                      <tr>
                        <td>${a.kind === "amendment" ? badge("danger", "alert", "更正变更") : a.kind === "deadline" ? badge("warn", "clock", "临近截止") : a.kind === "todo" ? badge("info", "file", "接力待办") : badge("info", "bell", "订阅命中")}</td>
                        <td>
                          <a class="row-title" href="/projects/${esc(a.noticeId)}" data-go="/projects/${esc(a.noticeId)}">${esc(a.title)}</a>
                          <div class="muted">${esc(a.detail)}</div>
                        </td>
                        <td>${esc(a.assigneeName || "待指派")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty-state">
                <strong>当前无待处理提醒</strong>
                <div>当已选项目出现更正、临近截止，或跨岗位推进阶段（如通知财务打保证金/催退保证金）时，将自动在此推送提醒。</div>
              </div>
            `}
          </div>
        </div>

        <!-- 右侧协同与高频入口栏 -->
        <div>
          <div class="card">
            <div class="card-head"><h3>高频作战直达</h3></div>
            <div class="fs-shortcut-grid">
              <a class="fs-shortcut-btn" href="/opportunities?tab=biddable&onlyOpen=1&sort=deadline_asc" data-go="/opportunities?tab=biddable&onlyOpen=1&sort=deadline_asc">
                <strong>临期急标扫雷</strong>
                <span>按截止时间从近到远</span>
              </a>
              <a class="fs-shortcut-btn" href="/review" data-go="/review">
                <strong>下浮率与报价沙盘</strong>
                <span>县区 P25–P75 甜点区</span>
              </a>
              <a class="fs-shortcut-btn" href="/projects?decision=pending_refund" data-go="/projects?decision=pending_refund">
                <strong>待退保证金催收</strong>
                <span>盯紧在途资金回笼</span>
              </a>
              <a class="fs-shortcut-btn" href="/matrix" data-go="/matrix">
                <strong>资格匹配矩阵</strong>
                <span>要求 × 公司逐项核验</span>
              </a>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>已授权参投公司与资质库</h3><a href="/companies" data-go="/companies" class="btn btn-sm">管理资料</a></div>
            ${data.companyCapabilities?.length ? `
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${data.companyCapabilities.map((cc) => `
                  <div style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                      <div>
                        <a href="/companies/${esc(cc.id)}" data-go="/companies/${esc(cc.id)}" style="font-size:13px;font-weight:600;color:var(--text);text-decoration:none;">${esc(cc.name)}</a>
                        <span class="muted" style="font-size:11.5px;margin-left:6px;">已传证书原件 ${cc.withFileCount ?? 0} / ${cc.docCount ?? 0} 份</span>
                      </div>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        ${cc.pendingCount > 0 && cc.withFileCount > 0 ? `<button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;" data-home-ai-verify="${esc(cc.id)}">AI 核验待核证件 (${cc.pendingCount})</button>` : ""}
                        <a href="/opportunities?tab=biddable&amp;onlyOpen=0&amp;matchCompanyId=${esc(encodeURIComponent(cc.id))}" data-go="/opportunities?tab=biddable&amp;onlyOpen=0&amp;matchCompanyId=${esc(encodeURIComponent(cc.id))}" class="quick-pill" style="color:var(--accent);">按公司资质查看相关公告</a>
                      </div>
                    </div>
                    <div class="meta-row">
                      ${cc.labels?.length ? cc.labels.map((l) => `<span class="prov prov-verified">${esc(l)}</span>`).join("") : `<span class="muted">尚未登记资质条目（共 ${cc.docCount} 份）</span>`}
                    </div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted">当前账号尚未授权可见公司，请联系管理员分配。</div>`}
          </div>
        </div>
      </div>
    `;

    slot.querySelector("#hero-go-opp")?.addEventListener("click", () => navigate("/opportunities?tab=biddable&onlyOpen=1"));
    slot.querySelector("#hero-go-proj")?.addEventListener("click", () => navigate("/projects"));
    slot.querySelector("#hero-go-rev")?.addEventListener("click", () => navigate("/review"));
    slot.querySelector("#go-pool")?.addEventListener("click", () => navigate("/opportunities"));
    const jumpQualPool = () => {
      navigate("/opportunities");
    };
    slot.querySelector("#go-qual-pool")?.addEventListener("click", jumpQualPool);
    slot.querySelector("#kpi-go-qual")?.addEventListener("click", jumpQualPool);
    slot.querySelector("#go-pool-empty")?.addEventListener("click", () => navigate("/opportunities"));
    slot.querySelectorAll("[data-home-peek]").forEach((btn) => btn.addEventListener("click", () => openOpportunityPeekDrawer(btn.getAttribute("data-home-peek"), btn)));
    slot.querySelectorAll("[data-home-bid]").forEach((btn) => btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-home-bid");
      btn.disabled = true;
      btn.textContent = "处理中…";
      try {
        await api(`/opportunities/${nid}/follow`, { decision: "bidding", assigneeId: null, note: "待核清单手动选定参投" });
        showToast("已选定参投并转入项目库！");
        navigate("/projects/" + nid);
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = "+ 参投";
      }
    }));
    slot.querySelectorAll("[data-home-ai-verify]").forEach((btn) => btn.addEventListener("click", async () => {
      const cid = btn.getAttribute("data-home-ai-verify");
      if (!cid) return;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "AI 核验中…";
      try {
        const res = await api(`/companies/${encodeURIComponent(cid)}/ai-verify-all`, {});
        showToast(`核验完成：自动通过 ${res.verifiedCount || 0} 份，发现过期 ${res.expiredCount || 0} 份，保留待补 ${res.skippedCount || 0} 份。`);
        renderKeepScroll();
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    }));
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
    slot.querySelectorAll("[data-go]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); });
      a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(a.getAttribute("data-go")); } });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>读取岗位首页异常：${esc(err.message)}</span></div>`;
  }
}

// ================= 3. OPPORTUNITIES POOL (/opportunities) =================
async function renderOpportunities(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const flt = {
    tab: qs.get("tab") || "biddable",
    onlyOpen: qs.has("onlyOpen") ? qs.get("onlyOpen") : (qs.get("tab") && qs.get("tab") !== "biddable" ? "0" : "1"),
    flags: qs.get("flags") || "",
    matchCompanyId: qs.get("matchCompanyId") || "",
    matchStatus: qs.get("matchCompanyId") ? qs.get("matchStatus") || "hints" : "",
    region: qs.get("region") || "",
    tradeType: qs.get("tradeType") || "",
    qual: qs.get("qual") || "",
    q: qs.get("q") || "",
    minBudget: qs.get("minBudget") || "",
    sort: qs.get("sort") || "published_desc",
    page: Number(qs.get("page") || 1) || 1,
  };
  const activeFlagSet = new Set((flt.flags || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (flt.onlyOpen === "1") activeFlagSet.add("open");
  const PRACTICAL_FLAGS = [
    { key: "open", label: "报名未截止" },
    { key: "sme", label: "面向中小企业" },
    { key: "doc_read", label: "已有附件正文" },
    { key: "no_perf", label: "原文明示无业绩要求" },
    { key: "consortium", label: "接受联合体" },
    { key: "no_deposit", label: "免投标保证金" },
    { key: "price_50", label: "价格分 ≥ 50%" },
    { key: "lowest_price", label: "最低价中标" },
  ];

  const slot = renderShell(root, "opportunities", [
    { label: "岗位首页", href: "/" },
    { label: "机会池" },
  ], `
    <div class="ws-sheet" aria-busy="true" aria-label="正在加载机会池">
      <div class="ws-sec"><div class="skeleton-bar" style="width:45%;"></div></div>
      ${Array.from({ length: 6 }).map(() => `<div class="skeleton-row"><div class="skeleton-bar" style="width:48%;"></div><div class="skeleton-bar" style="width:14%;"></div><div class="skeleton-bar" style="width:16%;"></div><div class="skeleton-bar" style="width:14%;"></div></div>`).join("")}
    </div>
  `);

  function applyFilter(patch) {
    const next = { ...flt, ...patch };
    if (!next.matchCompanyId) next.matchStatus = "";
    if (!("page" in patch)) next.page = 1;
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) p.set(k, String(v)); });
    navigate("/opportunities?" + p.toString());
  }

  function comparisonRow(item) {
    const result = item.companyMatch;
    if (!result) return "";
    const labels = {
      supported: "资质与证照符合",
      partial: "核心资质符合 · 待配建造师/业绩",
      archive_pending: "已有对应资质 · 档案待核",
      pending: "暂未命中明确条件",
      non_conform: "已核定不满足",
    };
    const toneMap = { supported: "good", partial: "warn", archive_pending: "info", pending: "quiet", non_conform: "danger" };
    const proof = result.proofs?.[0];
    const companyDocs = proof?.documents?.join("、");
    const pendingIds = (result.proofs || []).flatMap((p) => p.pendingDocIds || []).filter(Boolean);
    return `<div class="meta-row" style="margin-top:4px;">
      ${badge(toneMap[result.status] || "quiet", result.status === "supported" ? "check" : result.status === "non_conform" ? "x" : "info", labels[result.status] || "待核")}
      ${result.aiExtracted ? `<span class="prov prov-auto">AI 已精炼</span>` : ""}
      ${companyDocs ? `<span style="font-size:12px;">${esc(companyDocs)}</span>` : ""}
      ${(result.aiSummary || proof?.reason) ? `<span class="muted" style="font-size:12px;">${esc(result.aiSummary || proof.reason)}</span>` : ""}
      ${pendingIds.length && flt.matchCompanyId ? `<button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;" data-ai-verify-co="${esc(flt.matchCompanyId)}" data-ai-verify-doc="${esc(pendingIds[0])}">AI 识图核验该证</button>` : ""}
      ${!result.aiExtracted ? `<button type="button" class="quick-pill" data-ai-extract-one="${esc(item.id)}">AI 提炼条件</button>` : ""}
      <a href="/matrix?noticeId=${esc(item.id)}" data-go="/matrix?noticeId=${esc(item.id)}">核对原文与档案</a>
    </div>`;
  }

  try {
    const apiQs = new URLSearchParams();
    Object.entries(flt).forEach(([k, v]) => { if (v !== "") apiQs.set(k, String(v)); });
    const [data, savedFilters] = await Promise.all([
      api("/opportunities?" + apiQs.toString()),
      api("/saved-filters"),
    ]);
    if (!isCurrentRender(root)) return;
    state.openAlerts = data.openAlerts ?? state.openAlerts;
    state.syncMeta = data.syncMeta ?? state.syncMeta;

    const tc = data.tabCounts || {};
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const nowMs = Date.now();
    const isFresh24h = (pubNsStr) => {
      const ms = Number(pubNsStr || 0) / 1e6;
      return ms > 0 && (nowMs - ms) <= 36 * 3600_000;
    };
    const isUrgent72h = (dlNsStr) => {
      const ms = Number(dlNsStr || 0) / 1e6;
      return ms > nowMs && (ms - nowMs) <= 72 * 3600_000;
    };

    // Active filter pills for instant visibility & single-click removal
    const activePills = [];
    if (flt.matchCompanyId) {
      const coName = data.matchSummary?.companyName || flt.matchCompanyId;
      activePills.push({ key: "matchCompanyId", label: `公司：${coName}` });
    }
    if (flt.q) activePills.push({ key: "q", label: `关键词：${flt.q}` });
    if (flt.region) activePills.push({ key: "region", label: `地区：${flt.region}` });
    if (flt.tradeType) activePills.push({ key: "tradeType", label: `行业：${flt.tradeType}` });
    if (flt.qual) activePills.push({ key: "qual", label: `资格：${flt.qual}` });
    if (flt.minBudget) activePills.push({ key: "minBudget", label: `预算 ≥ ${flt.minBudget} 万` });

    slot.innerHTML = `
      <div class="ws-sheet">
        ${savedFilters.length ? `
          <div class="ws-sec" style="background:var(--surface-3);padding:8px 16px;">
            <div class="meta-row">
              <strong style="color:var(--text);">我的订阅方案：</strong>
              ${savedFilters.map((sf) => `
                <span class="chip ${sf.subscribed ? "active" : ""}" data-apply-sf="${esc(sf.id)}" title="负责人：${esc(sf.assigneeName)}">
                  ${esc(sf.name)}（<span class="num">${sf.matchCount}</span>）${sf.subscribed ? " · 订阅中" : ""}
                  ${sf.isOwner ? `<button class="btn-ghost" style="border:none;padding:0 4px;cursor:pointer;font-size:11px;" data-toggle-sf="${esc(sf.id)}" data-sub="${sf.subscribed ? "0" : "1"}">${sf.subscribed ? "停订" : "订阅"}</button>
                  <button class="btn-ghost" style="border:none;padding:0 3px;cursor:pointer;font-size:11px;color:var(--danger);" data-del-sf="${esc(sf.id)}">移除</button>` : ""}
                </span>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="ws-sec">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
            <div class="tabs" role="tablist" aria-label="公告阶段分桶" style="margin:0;">
              <button class="tab ${flt.tab === "biddable" ? "active" : ""}" data-tab="biddable">招标公告 <span class="tab-num">${tc.openBiddable ?? 0}</span></button>
              <button class="tab ${flt.tab === "amendments" ? "active" : ""}" data-tab="amendments">更正与答疑 <span class="tab-num">${tc.amendments ?? 0}</span></button>
              <button class="tab ${flt.tab === "intent" ? "active" : ""}" data-tab="intent">采购意向 <span class="tab-num">${tc.intent ?? 0}</span></button>
              <button class="tab ${flt.tab === "results" ? "active" : ""}" data-tab="results">中标与流标 <span class="tab-num">${tc.results ?? 0}</span></button>
              <button class="tab ${flt.tab === "followed" ? "active" : ""}" data-tab="followed">已选定标段 <span class="tab-num">${tc.followed ?? 0}</span></button>
              <button class="tab ${flt.tab === "all" ? "active" : ""}" data-tab="all">全部公告 <span class="tab-num">${tc.all ?? 0}</span></button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-sm" type="button" id="btn-save-flt">存为订阅方案</button>
              <button class="btn btn-ghost btn-sm" type="button" id="btn-share-flt">复制筛选链接</button>
            </div>
          </div>

          <!-- 精简主筛选栏 + 按需展开「更多筛选」（此刻没用的不占首屏） -->
          ${(() => {
            const extraFlagCnt = [...activeFlagSet].filter((k) => k !== "open").length;
            const secCount = (flt.tradeType ? 1 : 0) + (flt.qual ? 1 : 0) + (flt.minBudget ? 1 : 0) + extraFlagCnt;
            const autoOpenMore = secCount > 0 || state.oppMoreOpen === true;
            return `
          <form id="filter-form" style="display:flex;flex-direction:column;gap:8px;">
            <div class="filter-bar" style="gap:8px;">
              <select class="select" name="matchCompanyId" id="flt-match-co" aria-label="按公司档案筛选" style="border-color:var(--accent);font-weight:600;min-width:196px;">
                <option value="">按公司档案筛选（全部）</option>
                ${(data.companyOptions || []).map((c) => `<option value="${esc(c.id)}" ${flt.matchCompanyId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
              </select>
              <input class="input" name="q" value="${esc(flt.q)}" aria-label="关键词检索" placeholder="输入项目名称、招标单位、地区或关键词（按回车或点搜索）…" style="flex:1;min-width:220px;" />
              <button class="btn btn-sm btn-primary" type="submit" id="btn-opp-search">搜索</button>
              <select class="select" name="region" aria-label="地区筛选">
                <option value="">全部地区</option>
                ${(data.facets?.regions || []).map((r) => `<option value="${esc(r.value)}" ${flt.region === r.value ? "selected" : ""}>${esc(r.value)} (${r.cnt})</option>`).join("")}
              </select>
              <select class="select" name="sort" aria-label="排序方式">
                <option value="published_desc" ${flt.sort === "published_desc" ? "selected" : ""}>最新发布</option>
                <option value="deadline_asc" ${flt.sort === "deadline_asc" ? "selected" : ""}>截止最急</option>
                <option value="budget_desc" ${flt.sort === "budget_desc" ? "selected" : ""}>金额最高</option>
              </select>
              <button class="btn btn-sm ${autoOpenMore ? "btn-primary" : ""}" type="button" id="btn-toggle-more-flt" aria-expanded="${autoOpenMore ? "true" : "false"}">更多筛选${secCount > 0 ? ` (${secCount})` : ""}</button>
              ${(activePills.length || extraFlagCnt > 0) ? `<button class="btn btn-ghost btn-sm" type="button" id="btn-reset">清空筛选</button>` : `<button class="btn btn-ghost btn-sm" type="button" id="btn-reset" style="display:none;">清空筛选</button>`}
            </div>

            <div id="opp-more-flt-panel" style="display:${autoOpenMore ? "flex" : "none"};flex-direction:column;gap:8px;padding:10px 12px;border-radius:var(--radius);background:var(--surface-2);border:1px solid var(--border);">
              <div class="filter-bar" style="gap:8px;">
                <select class="select" name="tradeType" aria-label="行业筛选">
                  <option value="">全部行业类型</option>
                  ${(data.facets?.tradeTypes || []).map((t) => `<option value="${esc(t.value)}" ${flt.tradeType === t.value ? "selected" : ""}>${esc(t.value)} (${t.cnt})</option>`).join("")}
                </select>
                <input class="input" name="qual" value="${esc(flt.qual)}" aria-label="资格标签关键词" placeholder="资格标签关键词（如：市政二级）" style="width:170px;" />
                <input class="input num" name="minBudget" type="number" step="any" min="0" value="${esc(flt.minBudget)}" aria-label="最低预算万元" placeholder="控制价下限（万元）" style="width:145px;" />
                <label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer;">
                  <input type="checkbox" name="onlyOpen" ${flt.onlyOpen === "1" ? "checked" : ""} /> 仅看已知递交截止时间且未到期
                </label>
                <button class="btn btn-sm btn-primary" type="submit" style="margin-left:auto;">应用条件</button>
              </div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="muted" style="font-size:12px;">附加条件：</span>
                ${PRACTICAL_FLAGS.filter((pf) => pf.key !== "open").map((pf) => `
                  <button type="button" class="opp-preset-btn ${activeFlagSet.has(pf.key) ? "active" : ""}" data-toggle-flag="${esc(pf.key)}">
                    ${activeFlagSet.has(pf.key) ? "✓ " : ""}${esc(pf.label)}
                  </button>
                `).join("")}
              </div>
              ${state.settings?.showOppTags !== false ? `
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span class="muted" style="font-size:12px;">常见资质：</span>
                  ${QUAL_CHIPS.map((c) => `<button type="button" class="chip ${flt.qual === c ? "active" : ""}" data-qual="${esc(c)}">${esc(c)}</button>`).join("")}
                </div>
              ` : ""}
            </div>
          </form>
            `;
          })()}
          <div id="flt-val-err" class="inline-err" style="display:none;"></div>

          <!-- 快捷找标：公司可投一键切换 + 常用预算/紧急度 + 来源与导出 -->
          <div class="opp-preset-bar" style="padding-top:8px;">
            <span class="muted" style="font-size:12px;">快捷找标：</span>
            ${(data.companyOptions || []).map((co) => `
              <button type="button" class="co-elig-badge ${flt.matchCompanyId === co.id ? "active" : ""}" style="${flt.matchCompanyId === co.id ? "background:#00a87e;color:#fff;border-color:#00a87e;" : ""}" data-match-co="${esc(co.id)}" title="${flt.matchCompanyId === co.id ? "再次点击取消该公司筛选" : `按${co.name}资质筛选公告`}">${esc(co.shortName)}</button>
            `).join("")}
            <button type="button" class="opp-preset-btn ${flt.sort === "deadline_asc" && flt.onlyOpen === "1" ? "active" : ""}" data-preset="urgent">临期急标</button>
            <button type="button" class="opp-preset-btn ${flt.minBudget === "100" ? "active" : ""}" data-preset="100w">100万+</button>
            <button type="button" class="opp-preset-btn ${flt.minBudget === "500" ? "active" : ""}" data-preset="500w">500万+</button>
            <button type="button" class="opp-preset-btn ${flt.sort === "budget_desc" && flt.onlyOpen === "1" ? "active" : ""}" data-preset="big">大额优先</button>
            <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
              <button type="button" class="quick-pill" id="btn-opp-add-source" style="border-color:var(--accent-border);color:var(--accent);font-weight:600;">+ 添加来源</button>
              <button type="button" class="quick-pill" id="btn-export-opp-csv">导出表格</button>
            </div>
          </div>

          ${state.settings?.showWatchKeywords !== false ? `
          <!-- 关注词高亮与快筛（再点同一词立即收回筛选，可在系统管理关闭） -->
          <div class="opp-preset-bar" style="padding-top:6px;gap:6px;" id="opp-watch-kw-bar">
            <span class="muted" style="font-size:12px;">关注词：</span>
            ${(() => {
              let kws = ["房建", "市政", "水利", "装修", "绿化", "EPC", "钢结构", "消防", "道路", "学校", "医院"];
              try {
                const saved = JSON.parse(localStorage.getItem("br-watch-keywords") || "null");
                if (Array.isArray(saved) && saved.length) kws = saved;
              } catch {}
              return kws.map((kw) => `
                <span class="opp-active-pill" style="${flt.q === kw ? "background:var(--accent);color:#fff;border-color:var(--accent);" : ""}">
                  <button type="button" data-watch-kw="${esc(kw)}" style="border:none;background:transparent;color:inherit;cursor:pointer;padding:0;font:inherit;">${esc(kw)}</button>
                  <button type="button" data-del-watch-kw="${esc(kw)}" title="移除关注词" style="margin-left:3px;opacity:0.7;color:inherit;">×</button>
                </span>
              `).join("");
            })()}
            <button type="button" class="quick-pill" id="btn-add-watch-kw">+ 关注词</button>
          </div>
          ` : ""}

          ${activePills.length ? `
            <div class="opp-active-bar">
              <span class="muted">当前生效条件：</span>
              ${activePills.map((p) => `<span class="opp-active-pill">${esc(p.label)} <button type="button" data-clear-flt="${esc(p.key)}" title="移除此条件">×</button></span>`).join("")}
            </div>
          ` : ""}

          ${data.matchSummary ? `
            <div class="notice-box" style="margin-top:10px;margin-bottom:0;justify-content:space-between;flex-wrap:wrap;gap:8px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <label>比对结果
                  <select class="select" id="flt-match-status">
                    ${Object.entries({ hints: "资质相关（含可投）", supported: "资质与证照符合", partial: "核心资质符合 · 待配人员/业绩", archive_pending: "已有对应资质 · 档案待核", pending: "暂未命中明确条件", non_conform: "已核定不满足" }).map(([value,label]) => `<option value="${value}" ${data.matchSummary.filter === value ? "selected" : ""}>${label}</option>`).join("")}
                  </select>
                </label>
                ${(data.matchSummary.pendingDocCount || 0) > 0 ? `<button type="button" class="btn btn-sm btn-primary" data-ai-verify-co="${esc(flt.matchCompanyId)}">AI 一键核验待核证件 (${data.matchSummary.pendingDocCount})</button>` : ""}
                <button type="button" class="btn btn-sm" id="btn-opp-ai-batch">AI 精炼本页资质条件</button>
                ${!data.matchSummary.hasSearchableArchives ? `<a data-go="/companies/${esc(encodeURIComponent(flt.matchCompanyId))}" href="/companies/${esc(encodeURIComponent(flt.matchCompanyId))}">登记企业资质后可查相关公告</a>` : ""}
              </div>
              <span class="muted" style="font-size:12px;">系统自动读取正文换行条款与 AI 精炼结果，减少「待核实」人工逐条翻找</span>
            </div>
          ` : ""}
        </div>

        <div id="batch-partial-msg" style="display:none;"></div>

        <!-- 顶部工具栏：未勾选时不展示灰置批量按钮（此刻没用的不出现），勾选后自动浮现操作条 -->
        <div class="bulk-bar">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" id="chk-all-rows" /> 全选本页
            </label>
            <div id="bulk-action-group" class="bulk-sel-bar" style="display:none;">
              <strong id="sel-count-label" style="color:var(--accent);font-size:12px;">已选 0 项</strong>
              <button class="btn btn-sm btn-primary" type="button" id="bulk-bid">批量参投</button>
              <button class="btn btn-sm" type="button" id="bulk-watch">批量跟进</button>
              <button class="btn btn-sm" type="button" id="bulk-decline">不参与</button>
              <button class="btn btn-sm btn-danger" type="button" id="bulk-delete">批量移除</button>
              <button class="btn btn-sm btn-ghost" type="button" id="bulk-clear-sel">取消选择</button>
            </div>
            <div id="batch-partial-msg" role="status" style="display:none;"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="seg-group" role="tablist" aria-label="视图切换" style="margin:0;">
              <button type="button" class="seg-btn ${(localStorage.getItem("br-opp-view") || "bento") === "bento" ? "active" : ""}" data-opp-view="bento">卡片视图</button>
              <button type="button" class="seg-btn ${(localStorage.getItem("br-opp-view") || "bento") === "table" ? "active" : ""}" data-opp-view="table">列表视图</button>
            </div>
            <span class="num muted">共 ${data.total} 条 · 第 ${data.page} / ${totalPages} 页</span>
            <button class="btn btn-sm" id="pg-prev-top" ${data.page <= 1 ? "disabled" : ""}>上一页</button>
            <button class="btn btn-sm" id="pg-next-top" ${data.page >= totalPages ? "disabled" : ""}>下一页</button>
          </div>
        </div>

        ${data.items.length ? ((localStorage.getItem("br-opp-view") || "bento") === "bento" ? `
          <div class="bento-grid">
            ${data.items.map((item) => {
              const isSel = item.decision === "bidding" || item.decision === "watching";
              const urg = getDeadlineUrgency(item.deadline);
              const smartB = fmtSmartBudget(item.budgetYuan);
              const cardUrgClass = urg.tier === "critical" ? "is-critical" : urg.tier === "urgent" ? "is-urgent" : "is-calm";
              return `
                <article class="bento-card ${cardUrgClass}">
                  <div>
                    <div class="bento-top">
                      <label style="display:inline-flex;align-items:center;margin-top:2px;cursor:pointer;">
                        <input type="checkbox" class="row-chk" value="${esc(item.id)}" aria-label="选择 ${esc(item.title)}" />
                      </label>
                      <a class="bento-title" style="flex:1;" href="/opportunities/${esc(item.id)}" data-peek="${esc(item.id)}">
                        ${isFresh24h(item.published) ? `<span class="opp-tag-new">新发</span>` : ""}${highlightEsc(item.title, flt.q)}
                      </a>
                    </div>
                    ${comparisonRow(item)}
                    ${(!item.companyMatch && item.eligibleCompanies?.length) ? `
                      <div class="opp-tags-row">
                        ${item.eligibleCompanies.map((ec) => `
                          <button type="button" class="co-elig-badge" data-match-co="${esc(ec.id)}" title="${esc(ec.name)} · ${esc((ec.reasons || []).join("；"))}">${esc(ec.shortName)} · 档案支持</button>
                        `).join("")}
                      </div>
                    ` : ""}
                    <div class="opp-tags-row">
                      ${stageBadge(item.stage, item.stageLabel)}
                      ${item.region ? `<span class="tag-chip tag-region">${esc(item.region)}</span>` : ""}
                      ${item.tradeType ? `<span class="tag-chip tag-trade">${esc(item.tradeType)}</span>` : ""}
                      ${(item.extraSources && item.extraSources.length) ? `<span class="tag-chip tag-multi" title="多站收录：${esc(item.allSources.map((x) => x.source).join(" / "))}">多站(${item.allSources.length})</span>` : ""}
                    </div>
                    <!-- 第2行标签：资格门槛 / 更正预警 / 时间线 -->
                    ${(item.qualTags?.length || item.amendmentCount > 0 || item.timelineCount > 1) ? `
                      <div class="opp-tags-row">
                        ${item.qualTags.slice(0, 3).map((t) => `<span class="tag-chip tag-qual">${esc(t)}</span>`).join("")}
                        ${item.amendmentCount > 0 ? `<span class="tag-chip tag-danger">含 ${item.amendmentCount} 条更正</span>` : ""}
                        ${item.timelineCount > 1 ? `<span class="tag-chip tag-slate">时间线 ${item.timelineCount}</span>` : ""}
                      </div>
                    ` : ""}
                  </div>
                  <div class="bento-metrics">
                    <div>
                      <div class="bento-metric-label">预算 / 控制价</div>
                      <div class="bento-metric-val">${smartB ? esc(smartB) : `<span class="muted" style="font-size:12.5px;font-weight:500;">${esc(item.budgetText || "按清单控制价")}</span>`}</div>
                    </div>
                    <div>
                      <div class="bento-metric-label">报名 / 递交截止</div>
                      <div style="margin-top:2px;">${deadlineBadge(item.deadline, item.deadlineText)}</div>
                    </div>
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">${item.tenderer ? `<a class="entity-link" href="/entities?kind=tenderer&name=${encodeURIComponent(item.tenderer)}" data-entity="/entities?kind=tenderer&name=${encodeURIComponent(item.tenderer)}">${highlightEsc(item.tenderer, flt.q)}</a>` : "详见公告主体"}</span>
                    <span>${esc(item.source)}</span>
                  </div>
                  <div class="bento-foot">
                    <div>${decisionBadge(item.decision)}</div>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;flex:1;justify-content:flex-end;">
                      <button type="button" class="quick-pill" data-peek="${esc(item.id)}">查看原文</button>
                      ${isSel
                        ? `<a class="quick-pill" style="color:var(--accent);font-weight:600;" href="/projects/${esc(item.id)}" data-go="/projects/${esc(item.id)}">进项目库 →</a>
                           <button type="button" class="quick-pill" data-row-unfollow="${esc(item.id)}" title="取消选定状态">撤回</button>`
                        : `<button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;" data-row-bid="${esc(item.id)}" data-pref-co="${esc(item.eligibleCompanies?.length === 1 ? item.eligibleCompanies[0].id : "")}">+ 参投</button>
                           <button type="button" class="quick-pill" data-row-watch="${esc(item.id)}">跟进</button>`}
                      <button type="button" class="row-del-quiet" data-row-del="${esc(item.id)}" data-del-title="${esc(item.title)}" title="从机会池移除（支持一键撤回）">移除</button>
                    </div>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
          <div class="bulk-bar bottom">
            <span class="num muted">共 ${data.total} 条匹配公告 · 第 ${data.page} / ${totalPages} 页</span>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm" id="pg-prev" ${data.page <= 1 ? "disabled" : ""}>上一页</button>
              <button class="btn btn-sm" id="pg-next" ${data.page >= totalPages ? "disabled" : ""}>下一页</button>
            </div>
          </div>
        ` : `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:34px;"></th>
                  <th style="min-width:340px;">公告标题 / 分层标签（第1行定位 · 第2行资格与预警）</th>
                  <th class="amount" style="width:135px;">预算 / 控制价</th>
                  <th style="width:165px;">报名 / 递交截止</th>
                  <th style="width:160px;">招标人 / 来源</th>
                  <th style="width:165px;">选定状态 / 快捷决策</th>
                </tr>
              </thead>
              <tbody>
                ${data.items.map((item) => {
                  const isSel = item.decision === "bidding" || item.decision === "watching";
                  const smartB = fmtSmartBudget(item.budgetYuan);
                  return `
                  <tr>
                    <td><input type="checkbox" class="row-chk" value="${esc(item.id)}" aria-label="选择 ${esc(item.title)}" /></td>
                    <td>
                      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                        <a class="row-title" href="/opportunities/${esc(item.id)}" data-peek="${esc(item.id)}" style="flex:1;">
                          ${isFresh24h(item.published) ? `<span class="opp-tag-new">新发</span>` : ""}${(() => {
                            let html = highlightEsc(item.title, flt.q);
                            if (!flt.q && state.settings?.showWatchKeywords !== false) {
                              let kws = ["房建", "市政", "水利", "装修", "绿化", "EPC", "钢结构", "消防", "道路", "学校", "医院"];
                              try { const sv = JSON.parse(localStorage.getItem("br-watch-keywords") || "null"); if (Array.isArray(sv) && sv.length) kws = sv; } catch {}
                              for (const kw of kws) {
                                if (!kw || kw.length < 2) continue;
                                const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
                                html = html.replace(re, `<mark style="background:var(--accent-soft);color:var(--accent);padding:0 3px;border-radius:3px;font-weight:600;">$1</mark>`);
                              }
                            }
                            return html;
                          })()}
                        </a>
                        <button type="button" class="quick-pill" data-peek="${esc(item.id)}" title="居中弹窗阅读官方排版原文">查看原文</button>
                      </div>
                      ${comparisonRow(item)}
                    ${(!item.companyMatch && item.eligibleCompanies?.length) ? `
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;">
                          ${item.eligibleCompanies.map((ec) => `
                            <button type="button" class="co-elig-badge" data-match-co="${esc(ec.id)}" title="${esc(ec.name)} · ${esc((ec.reasons || []).join("；"))}">${esc(ec.shortName)} · 档案支持</button>
                          `).join("")}
                          <span class="muted" style="font-size:11.5px;">${esc(item.eligibleCompanies[0]?.reasons?.[0] || "")}</span>
                        </div>
                      ` : ""}
                      ${state.settings?.showOppTags !== false ? `
                      <div class="opp-tags-row">
                        ${stageBadge(item.stage, item.stageLabel)}
                        ${item.region ? `<span class="tag-chip tag-region">${esc(item.region)}</span>` : ""}
                        ${item.tradeType ? `<span class="tag-chip tag-trade">${esc(item.tradeType)}</span>` : ""}
                        ${(item.extraSources && item.extraSources.length) ? `<span class="tag-chip tag-multi" title="已自动去重合并多站收录：${esc(item.allSources.map((x) => x.source).join(" / "))}">多站同步(${item.allSources.length})：${esc(item.extraSources.map((x) => x.source).join("、"))}</span>` : ""}
                      </div>
                      ${(item.qualTags?.length || item.amendmentCount > 0 || item.timelineCount > 1) ? `
                        <div class="opp-tags-row">
                          ${item.qualTags.slice(0, 3).map((t) => `<span class="tag-chip tag-qual">${esc(t)}</span>`).join("")}
                          ${item.amendmentCount > 0 ? `<span class="tag-chip tag-danger">含 ${item.amendmentCount} 条更正</span>` : ""}
                          ${item.timelineCount > 1 ? `<span class="tag-chip tag-slate">时间线 ${item.timelineCount} 条</span>` : ""}
                        </div>
                      ` : ""}
                      ` : ""}
                      ${item.matchReasons?.length ? `<div class="meta-row" style="margin-top:4px;">${badge("good", "check", "资质匹配")}<span class="muted">${esc(item.matchReasons.join("；"))}</span>${item.matchWarnings?.length ? badge("warn", "alert", item.matchWarnings[0]) : ""}</div>` : ""}
                    </td>
                    <td class="amount">
                      ${smartB
                        ? `<div class="opp-budget-big">${esc(smartB)}</div>`
                        : `<span class="muted">${esc(item.budgetText || "按清单控制价")}</span>`}
                      ${item.evalMethod ? `<div class="muted" style="font-size:11px;">${esc(item.evalMethod)}</div>` : ""}
                    </td>
                    <td>${deadlineBadge(item.deadline, item.deadlineText)}</td>
                    <td>
                      <div style="font-size:13px;">${item.tenderer ? `<a class="entity-link" href="/entities?kind=tenderer&name=${encodeURIComponent(item.tenderer)}" data-entity="/entities?kind=tenderer&name=${encodeURIComponent(item.tenderer)}">${highlightEsc(item.tenderer, flt.q)}</a>` : "详见公告主体"}</div>
                      <div class="muted" style="font-size:11px;">${esc(item.source)}</div>
                    </td>
                    <td>
                      ${decisionBadge(item.decision)}
                      ${item.assigneeName ? `<div class="muted" style="font-size:11px;">负责人：${esc(item.assigneeName)}</div>` : ""}
                      <div class="opp-row-actions" style="align-items:center;">
                        ${isSel
                          ? `<a class="quick-pill" style="color:var(--accent);font-weight:600;" href="/projects/${esc(item.id)}" data-go="/projects/${esc(item.id)}">进项目库 →</a>
                             <button type="button" class="quick-pill" data-row-unfollow="${esc(item.id)}" title="取消选定状态">撤回</button>`
                          : `<button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;" data-row-bid="${esc(item.id)}" data-pref-co="${esc(item.eligibleCompanies?.length === 1 ? item.eligibleCompanies[0].id : "")}">+ 参投</button>
                             <button type="button" class="quick-pill" data-row-watch="${esc(item.id)}">跟进</button>`}
                        <button type="button" class="row-del-quiet" data-row-del="${esc(item.id)}" data-del-title="${esc(item.title)}" title="从机会池移除（支持一键撤回）">移除</button>
                      </div>
                    </td>
                  </tr>
                `;
                }).join("")}
              </tbody>
            </table>
          </div>
          <div class="bulk-bar bottom">
            <span class="num muted">共 ${data.total} 条匹配公告 · 第 ${data.page} / ${totalPages} 页</span>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm" id="pg-prev" ${data.page <= 1 ? "disabled" : ""}>上一页</button>
              <button class="btn btn-sm" id="pg-next" ${data.page >= totalPages ? "disabled" : ""}>下一页</button>
            </div>
          </div>
        `) : `
          <div class="empty-state">
            <strong>当前筛选条件下无匹配公告</strong>
            <div style="margin-bottom:10px;">${flt.matchCompanyId ? "可以更换上方的比对结果，或调整日期、地区等条件继续查找。" : "可以调整日期、地区或关键词继续查找。"}</div>
            ${activeFlagSet.has("open") ? `<button type="button" class="btn btn-sm" id="btn-empty-dates">包含日期未知及已截止公告</button>` : ""}
            <button type="button" class="btn btn-sm" id="btn-empty-reset">清除全部条件</button>
          </div>
        `}
      </div>
    `;

    slot.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      const t = b.getAttribute("data-tab");
      applyFilter({ tab: t, onlyOpen: t === "biddable" ? "1" : "0" });
    }));
    slot.querySelector("#flt-match-co")?.addEventListener("change", (e) => {
      applyFilter({ matchCompanyId: e.target.value });
    });
    slot.querySelector("#flt-match-status")?.addEventListener("change", e => applyFilter({ matchStatus: e.target.value }));
    slot.querySelectorAll("[data-ai-verify-co]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cid = btn.getAttribute("data-ai-verify-co");
        const docId = btn.getAttribute("data-ai-verify-doc") || "";
        if (!cid) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = "AI 核验中…";
        try {
          const res = await api(`/companies/${encodeURIComponent(cid)}/ai-verify-all`, docId ? { docId } : {});
          showToast(`AI 识图核验完成：自动通过 ${res.verifiedCount || 0} 份，过期标记 ${res.expiredCount || 0} 份，保留待补 ${res.skippedCount || 0} 份。`);
          await renderKeepScroll();
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
    });
    slot.querySelectorAll("[data-ai-extract-one]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nid = btn.getAttribute("data-ai-extract-one");
        if (!nid) return;
        btn.disabled = true;
        btn.textContent = "提炼中…";
        try {
          const res = await api(`/opportunities/${encodeURIComponent(nid)}/ai-extract`, {});
          showToast(res.extract?.summary ? `AI 提炼完成：${res.extract.summary}` : "已完成 AI 资质条件提炼。");
          await renderKeepScroll();
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
          btn.textContent = "AI 提炼条件";
        }
      });
    });
    slot.querySelector("#btn-opp-ai-batch")?.addEventListener("click", async () => {
      const btn = slot.querySelector("#btn-opp-ai-batch");
      const targetIds = (data.items || []).filter((it) => !it.companyMatch?.aiExtracted).slice(0, 10).map((it) => it.id);
      if (!targetIds.length) {
        showToast("当前页公告均已完成 AI 资质条件精炼。");
        return;
      }
      btn.disabled = true;
      btn.textContent = `AI 正在精炼 ${targetIds.length} 条…`;
      try {
        const res = await api("/opportunities/ai-batch-extract", { ids: targetIds });
        showToast(`AI 批量精炼完成：新提炼 ${res.extracted || 0} 条，命中缓存 ${res.cached || 0} 条。`);
        await renderKeepScroll();
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = "AI 精炼本页资质条件";
      }
    });
    slot.querySelector("#btn-empty-dates")?.addEventListener("click", () => {
      const flags = [...activeFlagSet].filter(flag => flag !== "open").join(",");
      applyFilter({ onlyOpen: "0", flags });
    });
    slot.querySelector("#btn-empty-reset")?.addEventListener("click", () => navigate("/opportunities?tab=all&onlyOpen=0"));
    // Instant auto-filter on dropdown/checkbox change; text inputs only search on Enter (after IME commit) or Search button click
    const filterForm = slot.querySelector("#filter-form");
    const submitFilterNow = () => filterForm?.requestSubmit?.();
    ["region", "tradeType", "sort", "onlyOpen"].forEach((nm) => {
      filterForm?.querySelector(`[name="${nm}"]`)?.addEventListener("change", submitFilterNow);
    });
    ["q", "qual"].forEach((nm) => {
      filterForm?.querySelector(`[name="${nm}"]`)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
      });
    });
    slot.querySelector("#filter-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const minB = String(fd.get("minBudget") || "").trim();
      const errEl = slot.querySelector("#flt-val-err");
      if (minB !== "" && (Number.isNaN(Number(minB)) || Number(minB) < 0)) {
        errEl.textContent = "预算下限须为非负数字（万元）。";
        errEl.style.display = "block";
        return;
      }
      errEl.style.display = "none";
      applyFilter({
        matchCompanyId: String(fd.get("matchCompanyId") || ""),
        q: String(fd.get("q") || "").trim(),
        region: String(fd.get("region") || ""),
        tradeType: String(fd.get("tradeType") || ""),
        qual: String(fd.get("qual") || "").trim(),
        minBudget: minB,
        sort: String(fd.get("sort") || "published_desc"),
        onlyOpen: fd.get("onlyOpen") ? "1" : "0",
      });
    });

    // Batch selection & actions (progressive disclosure: only show batch buttons when >=1 checked)
    const rowChks = Array.from(slot.querySelectorAll(".row-chk"));
    const allChk = slot.querySelector("#chk-all-rows");
    const selLabel = slot.querySelector("#sel-count-label");
    const bulkGroup = slot.querySelector("#bulk-action-group");
    function syncBulkUI() {
      const ids = rowChks.filter((c) => c.checked).map((c) => c.value);
      if (selLabel) selLabel.textContent = `已选 ${ids.length} 项`;
      if (bulkGroup) bulkGroup.style.display = ids.length > 0 ? "flex" : "none";
      if (allChk) allChk.checked = rowChks.length > 0 && ids.length === rowChks.length;
    }
    slot.querySelector("#bulk-clear-sel")?.addEventListener("click", () => {
      rowChks.forEach((c) => { c.checked = false; });
      syncBulkUI();
    });
    slot.querySelector("#btn-toggle-more-flt")?.addEventListener("click", () => {
      const panel = slot.querySelector("#opp-more-flt-panel");
      const btn = slot.querySelector("#btn-toggle-more-flt");
      if (!panel) return;
      const open = panel.style.display === "none";
      panel.style.display = open ? "flex" : "none";
      state.oppMoreOpen = open;
      btn?.classList.toggle("btn-primary", open);
      btn?.setAttribute("aria-expanded", open ? "true" : "false");
    });

    slot.querySelectorAll("[data-toggle-flag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fk = btn.getAttribute("data-toggle-flag");
        const nextSet = new Set(activeFlagSet);
        if (nextSet.has(fk)) nextSet.delete(fk);
        else nextSet.add(fk);
        const nextOnlyOpen = nextSet.has("open") ? "1" : "0";
        const otherFlags = [...nextSet].filter((x) => x !== "open").join(",");
        applyFilter({ onlyOpen: nextOnlyOpen, flags: otherFlags });
      });
    });

    slot.querySelector("#bulk-delete")?.addEventListener("click", () => {
      const ids = rowChks.filter((c) => c.checked).map((c) => c.value);
      if (!ids.length) return;
      openConfirmModal({
        title: `批量移除 ${ids.length} 条机会`,
        message: "移除后这些公告将不再显示在机会池与首页中，可在提示条中一键撤回。",
        confirmLabel: "确认批量移除",
        danger: true,
        onConfirm: async () => {
          await api("/opportunities/delete", { ids });
          await renderKeepScroll();
          showToast(`已从机会池移除 ${ids.length} 条机会`, {
            actionLabel: "撤回",
            onAction: async () => {
              await api("/opportunities/restore", { ids });
              showToast(`已恢复 ${ids.length} 条机会。`);
              renderKeepScroll();
            },
          });
        },
      });
    });

    slot.querySelectorAll("[data-match-co]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute("data-match-co") || "";
        applyFilter({ matchCompanyId: flt.matchCompanyId === cid ? "" : cid, page: 1 });
      });
    });
    slot.querySelectorAll("[data-watch-kw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kw = btn.getAttribute("data-watch-kw") || "";
        applyFilter({ q: flt.q === kw ? "" : kw, page: 1 });
      });
    });
    slot.querySelectorAll("[data-del-watch-kw]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const kw = btn.getAttribute("data-del-watch-kw");
        let kws = ["房建", "市政", "水利", "装修", "绿化", "EPC", "钢结构", "消防", "道路", "学校", "医院"];
        try { const sv = JSON.parse(localStorage.getItem("br-watch-keywords") || "null"); if (Array.isArray(sv) && sv.length) kws = sv; } catch {}
        kws = kws.filter((x) => x !== kw);
        localStorage.setItem("br-watch-keywords", JSON.stringify(kws));
        renderKeepScroll();
      });
    });
    slot.querySelector("#btn-add-watch-kw")?.addEventListener("click", async () => {
      const kw = await promptAsync("输入新的关注关键词（如：改造、管网、光伏、机电）：");
      if (!kw || !kw.trim()) return;
      let kws = ["房建", "市政", "水利", "装修", "绿化", "EPC", "钢结构", "消防", "道路", "学校", "医院"];
      try { const sv = JSON.parse(localStorage.getItem("br-watch-keywords") || "null"); if (Array.isArray(sv) && sv.length) kws = sv; } catch {}
      const clean = kw.trim().slice(0, 20);
      if (!kws.includes(clean)) kws.push(clean);
      localStorage.setItem("br-watch-keywords", JSON.stringify(kws));
      showToast(`已添加关注高亮词「${clean}」。`);
      renderKeepScroll();
    });
    slot.querySelector("#btn-opp-add-source")?.addEventListener("click", () => {
      openAddCustomSourceModal(() => renderKeepScroll());
    });
    slot.querySelector("#btn-export-opp-csv")?.addEventListener("click", () => {
      const rows = (data.items || []).map((it) => [
        it.title, it.stageLabel || it.stage, it.region || "", it.tradeType || "",
        it.budgetYuan ? `${(it.budgetYuan / 10000).toFixed(2)}万` : (it.budgetText || ""),
        it.deadlineText || "", it.tenderer || "", it.source || "", it.url || "",
      ]);
      downloadCsvFile(
        `机会池当前筛选_${new Date().toISOString().slice(0, 10)}.csv`,
        ["公告标题", "类型", "地区", "行业", "预算/控制价", "截止时间", "招标人", "来源", "原文链接"],
        rows
      );
    });

    slot.querySelectorAll("[data-row-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nid = btn.getAttribute("data-row-del");
        const title = (btn.getAttribute("data-del-title") || nid).slice(0, 26);
        btn.disabled = true;
        try {
          await api("/opportunities/delete", { ids: [nid] });
          await renderKeepScroll();
          showToast(`已移除「${title}…」`, {
            actionLabel: "撤回",
            onAction: async () => {
              await api("/opportunities/restore", { ids: [nid] });
              showToast("已恢复该机会。");
              renderKeepScroll();
            },
          });
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
        }
      });
    });
    allChk?.addEventListener("change", () => {
      rowChks.forEach((c) => { c.checked = allChk.checked; });
      syncBulkUI();
    });
    rowChks.forEach((c) => c.addEventListener("change", syncBulkUI));

    let batchFollowPending = false;
    async function runBatchFollow(decision, note = "") {
      const ids = rowChks.filter((c) => c.checked).map((c) => c.value);
      if (!ids.length || batchFollowPending) return;
      const controls = [...slot.querySelectorAll("#bulk-bid, #bulk-watch, #bulk-decline, #bulk-delete")];
      const pendingButton = decision === "bidding" ? "#bulk-bid" : "#bulk-watch";
      batchFollowPending = true;
      controls.forEach((button) => { button.disabled = true; });
      const active = decision === "declined" ? null : slot.querySelector(pendingButton);
      if (active) setSubmitPending(active, true);
      let res;
      try {
        res = await api("/opportunities/batch-follow", { ids, decision, note });
      } finally {
        batchFollowPending = false;
        controls.forEach((button) => { button.disabled = false; });
        if (active) setSubmitPending(active, false);
      }
      if (res.failed?.length) {
        const box = slot.querySelector("#batch-partial-msg");
        box.className = "notice-box warn";
        box.style.display = "flex";
        box.innerHTML = `${ICONS.alert}<span>部分失败：成功 ${res.succeeded} 条，失败 ${res.failed.length} 条（${esc(res.failed.map((f) => f.id).join(", "))}）。</span>`;
      } else {
        await renderKeepScroll();
        showToast(`批量更新完成：${res.succeeded} 条已生效`, {
          actionLabel: "撤回",
          onAction: async () => {
            await api("/opportunities/batch-follow", { ids, decision: "none" });
            showToast("已撤回刚才的批量选定。");
            renderKeepScroll();
          },
        });
      }
    }
    const reportBatchError = (error) => showToast(error.message, { error: true });
    slot.querySelector("#bulk-bid")?.addEventListener("click", () => runBatchFollow("bidding").catch(reportBatchError));
    slot.querySelector("#bulk-watch")?.addEventListener("click", () => runBatchFollow("watching").catch(reportBatchError));
    slot.querySelector("#bulk-decline")?.addEventListener("click", () => {
      const cnt = rowChks.filter((c) => c.checked).length;
      openRiskDialog({
        title: "批量标记为「不参与」",
        targetLabel: `已选 ${cnt} 条标讯`,
        riskWarning: "批量标记不参与将关闭这些标段关联的待处理提醒，操作保留审计历史。",
        confirmLabel: "确认批量不参与",
        onConfirm: (reason) => runBatchFollow("declined", reason),
      });
    });

    slot.querySelector("#pg-prev-top")?.addEventListener("click", () => applyFilter({ page: Math.max(1, flt.page - 1) }));
    slot.querySelector("#pg-next-top")?.addEventListener("click", () => applyFilter({ page: Math.min(totalPages, flt.page + 1) }));
    slot.querySelector("#btn-reset").addEventListener("click", () => navigate("/opportunities?tab=biddable&onlyOpen=1"));
    slot.querySelectorAll("[data-qual]").forEach((c) => c.addEventListener("click", () => {
      const val = c.getAttribute("data-qual");
      applyFilter({ qual: flt.qual === val ? "" : val });
    }));
    slot.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-preset");
      if (p === "urgent") applyFilter({ tab: "biddable", onlyOpen: "1", sort: "deadline_asc" });
      else if (p === "100w") applyFilter({ tab: "biddable", onlyOpen: "1", minBudget: flt.minBudget === "100" ? "" : "100" });
      else if (p === "500w") applyFilter({ tab: "biddable", onlyOpen: "1", minBudget: flt.minBudget === "500" ? "" : "500" });
      else if (p === "big") applyFilter({ tab: "biddable", onlyOpen: "1", sort: "budget_desc" });
    }));
    slot.querySelectorAll("[data-clear-flt]").forEach((btn) => btn.addEventListener("click", () => {
      applyFilter({ [btn.getAttribute("data-clear-flt")]: "" });
    }));
    slot.querySelectorAll("[data-row-bid]").forEach((btn) => btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-row-bid");
      const prefCo = btn.getAttribute("data-pref-co") || "";
      btn.disabled = true;
      btn.textContent = "处理中…";
      try {
        const res = await api(`/opportunities/${nid}/follow`, { decision: "bidding", companyId: prefCo, assigneeId: null, note: "机会池快捷参投" });
        await renderKeepScroll();
        showToast(`已选定参投并转入项目库${res.inferredCompanyName ? `（自动关联：${res.inferredCompanyName}）` : ""}`, {
          actionLabel: "撤回",
          onAction: async () => {
            await api(`/opportunities/${nid}/follow`, { decision: "none" });
            showToast("已撤回参投选定。");
            renderKeepScroll();
          },
        });
      } catch (err) { showToast(err.message); btn.disabled = false; btn.textContent = "+ 参投"; }
    }));
    slot.querySelectorAll("[data-row-watch]").forEach((btn) => btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-row-watch");
      btn.disabled = true;
      try {
        await api(`/opportunities/${nid}/follow`, { decision: "watching", assigneeId: null, note: "机会池快捷跟进" });
        await renderKeepScroll();
        showToast("已加入跟进并归入项目库", {
          actionLabel: "撤回",
          onAction: async () => {
            await api(`/opportunities/${nid}/follow`, { decision: "none" });
            showToast("已撤回跟进状态。");
            renderKeepScroll();
          },
        });
      } catch (err) { showToast(err.message); btn.disabled = false; }
    }));
    slot.querySelectorAll("[data-row-unfollow]").forEach((btn) => btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-row-unfollow");
      btn.disabled = true;
      try {
        await api(`/opportunities/${nid}/follow`, { decision: "none" });
        await renderKeepScroll();
        showToast("已撤回选定状态，恢复为未选定。");
      } catch (err) { showToast(err.message); btn.disabled = false; }
    }));
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        renderKeepScroll();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
    slot.querySelector("#pg-prev")?.addEventListener("click", () => applyFilter({ page: Math.max(1, flt.page - 1) }));
    slot.querySelector("#pg-next")?.addEventListener("click", () => applyFilter({ page: Math.min(totalPages, flt.page + 1) }));

    slot.querySelector("#btn-share-flt").addEventListener("click", async () => {
      const url = location.origin + state.route;
      try { await navigator.clipboard.writeText(url); showToast("已复制当前筛选链接。"); }
      catch { showToast("筛选链接：" + url); }
    });

    slot.querySelectorAll("[data-apply-sf]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const sf = savedFilters.find((x) => x.id === el.getAttribute("data-apply-sf"));
        if (!sf) return;
        const p = new URLSearchParams();
        Object.entries(sf.filters || {}).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) p.set(k, String(v)); });
        navigate("/opportunities?" + p.toString());
      });
    });
    slot.querySelectorAll("[data-toggle-sf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/saved-filters/${btn.getAttribute("data-toggle-sf")}/update`, { subscribed: btn.getAttribute("data-sub") === "1" });
        showToast("已更新订阅设置。");
        render();
      });
    });
    slot.querySelectorAll("[data-del-sf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmAsync("确认移除该已保存筛选方案？")) return;
        await api(`/saved-filters/${btn.getAttribute("data-del-sf")}/delete`, {});
        showToast("已移除筛选方案。");
        render();
      });
    });

    slot.querySelector("#btn-save-flt").addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="保存筛选方案">
          <h3 style="margin:0 0 12px;font-size:16px;">保存或订阅当前筛选方案</h3>
          <form id="sf-form">
            <div class="field"><label for="sf-name">方案名称</label><input id="sf-name" class="input" name="name" required placeholder="例如：盐城市政工程-报名未截止" /></div>
            <div class="field">
              <label for="sf-assign">新标命中后指派负责人</label>
              <select id="sf-assign" class="select" name="assigneeId">
                ${state.employees.map((e) => `<option value="${esc(e.id)}" ${e.id === state.user.id ? "selected" : ""}>${esc(e.name)} (${esc(e.username)})</option>`).join("")}
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" name="subscribed" checked /> 开启站内订阅提醒（仅对后续新入库且命中的公告生成提醒）
            </label>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:14px;font-size:13px;cursor:pointer;">
              <input type="checkbox" name="shared" checked /> 团队内共享此方案
            </label>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" class="btn" id="sf-cancel">取消</button>
              <button type="submit" class="btn btn-primary">确认保存</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(wrap);
      wrap.querySelector("#sf-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#sf-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const f = { ...flt };
        delete f.page;
        try {
          await api("/saved-filters", {
            name: String(fd.get("name")).trim(),
            filters: f,
            subscribed: !!fd.get("subscribed"),
            shared: !!fd.get("shared"),
            assigneeId: String(fd.get("assigneeId") || ""),
          });
          wrap.remove();
          showToast("筛选方案已保存。");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>加载机会池失败：${esc(err.message)}</span></div>`;
  }
}

async function openOpportunityPeekDrawer(id, triggerEl) {
  if (document.querySelector(".center-modal-backdrop[data-opportunity-peek]:not(.dialog-exiting)")) return;
  const overlay = document.createElement("div");
  overlay.className = "center-modal-backdrop";
  overlay.dataset.opportunityPeek = "";
  overlay.innerHTML = `
    <div class="center-modal" role="dialog" aria-modal="true" aria-label="机会详情大弹窗">
      <div class="center-modal-head">
          <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;" id="pk-badges">
            <span class="badge badge-info">机会详情</span>
          </div>
          <h2 style="margin:0;font-size:17px;line-height:1.35;" id="pk-title">正在读取公告详情…</h2>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;" id="pk-actions">
          <button type="button" class="btn btn-sm" id="pk-close">关闭 (ESC)</button>
        </div>
      </div>
      <div class="center-modal-body" id="pk-body" aria-busy="true">
        <div class="card">
          <div class="skeleton-bar" style="width:65%;margin-bottom:8px;"></div>
          <div class="skeleton-bar" style="width:90%;margin-bottom:8px;"></div>
          <div class="skeleton-bar" style="width:80%;"></div>
        </div>
      </div>
    </div>
  `;
  let pending = false;
  const dismiss = () => { if (!pending) close(); };
  const close = mountDialog(overlay, { initial: "#pk-close", trigger: triggerEl, onEscape: dismiss });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
  overlay.querySelector("#pk-close").addEventListener("click", close);

  try {
    const d = await api("/opportunities/" + id);
    if (!overlay.isConnected || overlay.classList.contains("dialog-exiting")) return;
    const restoreCloseFocus = document.activeElement === overlay.querySelector("#pk-close");
    const fb = d.lifecycle?.localFloatBenchmark || {};
    const edp = d.lifecycle?.estimatedDealPrice || null;
    const isSel = d.follow?.decision === "bidding" || d.follow?.decision === "watching";

    overlay.querySelector("#pk-badges").innerHTML = `
      ${stageBadge(d.stage, d.stageLabel)}
      ${decisionBadge(d.follow?.decision)}
      ${d.region ? `<span class="tag-chip tag-region">${esc(d.region)}</span>` : ""}
      ${d.tradeType ? `<span class="tag-chip tag-trade">${esc(d.tradeType)}</span>` : ""}
      ${d.source ? `<span class="tag-chip tag-slate">${esc(d.source)}</span>` : ""}
    `;
    overlay.querySelector("#pk-title").textContent = d.title;
    overlay.querySelector("#pk-actions").innerHTML = `
      ${isSel
        ? `<button type="button" class="btn btn-primary btn-sm" id="pk-proj">进入项目库 →</button>
           <button type="button" class="btn btn-sm" id="pk-unfollow" title="取消选定状态">撤回选定</button>`
        : `<button type="button" class="btn btn-primary btn-sm" id="pk-bid">+ 参投</button>
           <button type="button" class="btn btn-sm" id="pk-watch">跟进</button>`}
      ${d.url ? `<a class="btn btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">官方原文 ${ICONS.ext}</a>` : ""}
      <button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger);" id="pk-del">移除</button>
      <button type="button" class="btn btn-sm" id="pk-close-2">关闭</button>
    `;
    const closeButton = overlay.querySelector("#pk-close-2");
    closeButton.addEventListener("click", dismiss);
    if (restoreCloseFocus) closeButton.focus({ preventScroll: true });
    overlay.querySelector("#pk-proj")?.addEventListener("click", () => {
      if (pending) return;
      close();
      navigate("/projects/" + id);
    });
    function bindMutation(selector, action) {
      const button = overlay.querySelector(selector);
      button?.addEventListener("click", async () => {
        if (pending) return;
        pending = true;
        setSubmitPending(button, true);
        closeButton.focus({ preventScroll: true });
        try {
          await action();
        } catch (error) {
          showToast(error.message, { error: true });
          setSubmitPending(button, false);
          if (overlay.isConnected && !overlay.classList.contains("dialog-exiting")) {
            button.focus({ preventScroll: true });
          }
        } finally {
          pending = false;
        }
      });
    }
    bindMutation("#pk-bid", async () => {
      const res = await api(`/opportunities/${id}/follow`, { decision: "bidding", assigneeId: null, note: "" });
      close();
      showToast(`已选定参投并转入项目库${res.inferredCompanyName ? `（自动关联：${res.inferredCompanyName}）` : ""}。`);
      navigate("/projects/" + id);
    });
    bindMutation("#pk-watch", async () => {
      await api(`/opportunities/${id}/follow`, { decision: "watching", assigneeId: null, note: "" });
      close();
      await renderKeepScroll();
      showToast("已加入跟进并归入项目库", {
        actionLabel: "撤回",
        onAction: async () => {
          await api(`/opportunities/${id}/follow`, { decision: "none" });
          showToast("已撤回跟进状态。");
          renderKeepScroll();
        },
      });
    });
    bindMutation("#pk-unfollow", async () => {
      await api(`/opportunities/${id}/follow`, { decision: "none" });
      close();
      await renderKeepScroll();
      showToast("已撤回选定状态。");
    });
    bindMutation("#pk-del", async () => {
      await api("/opportunities/delete", { ids: [id] });
      close();
      await renderKeepScroll();
      showToast(`已移除「${d.title.slice(0, 24)}…」`, {
        actionLabel: "撤回",
        onAction: async () => {
          await api("/opportunities/restore", { ids: [id] });
          showToast("已恢复该机会。");
          renderKeepScroll();
        },
      });
    });

    const smartB = fmtSmartBudget(d.budgetYuan);
    overlay.querySelector("#pk-body").innerHTML = `
      <div class="decision-grid" style="margin-bottom:12px;">
        <div class="metric-box">
          <div class="metric-head"><span>预算 / 控制价</span></div>
          <div class="metric-val" style="color:var(--accent);font-size:18px;">${smartB ? esc(smartB) : esc(d.budgetText || "按清单控制价")}</div>
          ${d.budgetText && smartB ? `<div class="muted" style="font-size:11px;">原文：${esc(d.budgetText)}</div>` : ""}
        </div>
        <div class="metric-box">
          <div class="metric-head"><span>报名 / 递交截止</span></div>
          <div>${deadlineBadge(d.deadline, d.deadlineText)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-head"><span>招标人 / 代理</span></div>
          <div style="font-size:13px;font-weight:600;">${esc(d.tenderer || "详见正文")}</div>
          <div class="muted" style="font-size:11.5px;">${esc(d.agency || "")}</div>
        </div>
        <div class="metric-box">
          <div class="metric-head"><span>评标办法 / 保证金</span></div>
          <div style="font-size:13px;font-weight:600;">${esc(d.evalMethod || "详见招标文件")}</div>
          <div class="muted" style="font-size:11.5px;">${esc(d.depositText || "保证金按文件约定")}</div>
        </div>
      </div>

      ${renderEstimatedDealPriceCard(edp)}

      <div class="ws-sheet">
        <div class="td-main-tabs" role="tablist">
          <button type="button" class="td-main-tab active" data-pk-tab="doc">官方公告原文（公文排版）</button>
          <button type="button" class="td-main-tab" data-pk-tab="snap">官方网页原排版快照</button>
          <button type="button" class="td-main-tab" data-pk-tab="meta">资质门槛、附件与时间线 (${(d.attachments?.length || 0) + (d.timeline?.length || 0)})</button>
        </div>
        <div class="ws-sec" id="pk-tab-doc">
          ${formatOfficialNoticeHtml(d.body)}
        </div>
        <div class="ws-sec" id="pk-tab-snap" style="display:none;">
          <div id="pk-snap-host"><div class="muted">正在拉取官方网页原排版快照…</div></div>
        </div>
        <div class="ws-sec" id="pk-tab-meta" style="display:none;">
          ${renderNoticeEvidence(d.evidence, id)}
          <div class="card" style="margin-bottom:10px;">
            <strong style="display:block;margin-bottom:6px;">历史中标平均下浮率参考（${esc(fb.district || d.region || "本区")}）</strong>
            <div class="muted">本县/区平均下浮率：<strong>${fb.districtAvgFloatPct !== null && fb.districtAvgFloatPct !== undefined ? `${fb.districtAvgFloatPct}%（${fb.districtSampleCount}个样本）` : "暂无配对样本"}</strong> · 该招标人历史平均下浮率：<strong>${fb.tendererAvgFloatPct !== null && fb.tendererAvgFloatPct !== undefined ? `${fb.tendererAvgFloatPct}%（${fb.tendererSampleCount}个样本）` : "暂无样本"}</strong></div>
          </div>
          ${(d.timeline || []).length ? `
            <div class="card" style="margin-bottom:0;">
              <strong style="display:block;margin-bottom:6px;">同项目全周期时间线（${d.timeline.length} 条）</strong>
              ${d.timeline.map((t) => `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12.5px;">${stageBadge(t.stage, t.stageLabel)} <strong>${esc(t.title)}</strong> <span class="muted">${esc(fmtBeijing(t.published))}</span></div>`).join("")}
            </div>
          ` : ""}
        </div>
      </div>
    `;

    let snapLoaded = false;
    overlay.querySelectorAll("[data-pk-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.getAttribute("data-pk-tab");
        overlay.querySelectorAll("[data-pk-tab]").forEach((b) => b.classList.toggle("active", b === btn));
        ["doc", "snap", "meta"].forEach((k) => {
          const el = overlay.querySelector(`#pk-tab-${k}`);
          if (el) el.style.display = k === key ? "" : "none";
        });
        if (key === "snap" && !snapLoaded) {
          snapLoaded = true;
          const host = overlay.querySelector("#pk-snap-host");
          try {
            const res = await api(`/opportunities/${id}/official-snapshot`);
            if (res.ok && res.html) {
              host.innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:8px;">来源：${esc(res.sourceUrl)} · 快照时间：${esc(res.fetchedAt || "")}</div><div class="official-doc-paper">${res.html}</div>`;
            } else {
              host.innerHTML = `<div class="notice-box warn">${esc(res.message || "暂无法抓取官方网页快照。")}</div>`;
            }
          } catch (err) {
            host.innerHTML = `<div class="notice-box warn">${esc(err.message)}</div>`;
          }
        }
      });
    });
  } catch (err) {
    overlay.querySelector("#pk-title").textContent = "读取公告失败";
    overlay.querySelector("#pk-body").innerHTML = `<div class="notice-box danger" role="alert">${esc(err.message)}</div>`;
  } finally {
    overlay.querySelector("#pk-body").removeAttribute("aria-busy");
  }
}

// ================= 4. LOT WORKBENCH (/opportunities/:id & /projects/:id) =================
function renderNoticeEvidence(evidence, noticeId, showCompare = true) {
  if (!evidence) return "";
  const sourceLink = (label, url) => /^https?:\/\//i.test(url || "")
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
  const excerpts = entries => entries.map(entry => `<li><strong>${sourceLink(entry.source, entry.url)}</strong> · ${entry.page ? `第 ${esc(entry.page)} 页 · ` : ""}第 ${esc(entry.paragraph)} 段<br>${esc(entry.excerpt)}</li>`).join("");
  const fields = Object.values(evidence.fields || {});
  const missingFields = fields.filter(field => !field.entries?.length);
  const missingRequirements = evidence.requirements.filter(req => !req.entries?.length);
  const pendingSources = Object.entries(evidence.completeness || {}).filter(([, complete]) => !complete)
    .map(([key]) => ({ body: "公告正文", amendments: "更正公告", attachments: "附件" })[key]).filter(Boolean);
  const aiEx = evidence.aiExtract;
  return `<section class="card" data-ev-host="${esc(noticeId)}" data-ev-compare="${showCompare ? "1" : "0"}">
    <div class="card-head">
      <h3>公告证据与准入核验</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${aiEx ? "" : "btn-primary"}" data-ai-extract-detail="${esc(noticeId)}" data-ai-force="${aiEx ? "1" : "0"}">${aiEx ? "AI 重新精炼" : "AI 深度提炼准入条件"}</button>
        ${showCompare ? `<a class="btn btn-sm" href="/matrix?noticeId=${esc(noticeId)}" data-go="/matrix?noticeId=${esc(noticeId)}">按公司比对</a>` : ""}
      </div>
    </div>
    ${aiEx ? `
      <div class="notice-box info" style="flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="prov prov-auto">AI 结构化精炼</span>
          <strong>${esc(aiEx.summary || "已自动提取结构化准入条件")}</strong>
        </div>
        ${(aiEx.qualGroups || []).length ? `<div style="font-size:12.5px;">资质要求：${aiEx.qualGroups.map((g) => `【${(g.logic === "AND" || g.logic === "all") ? "同时具备" : "满足其一"}：${((g.specs || g.items) || []).map((x) => x.name || x).join(" / ")}】`).join(" 且 ")}</div>` : ""}
        <div class="muted" style="font-size:12px;">
          ${aiEx.pmRequirement?.required ? `建造师：${esc([...(aiEx.pmRequirement.specialties || []), aiEx.pmRequirement.minGrade].filter(Boolean).join(" ") || aiEx.pmRequirement.rawQuote || "见原文")}${aiEx.pmRequirement.safetyB ? "（须安全B证）" : ""}` : "建造师：未见明确要求或免配"}
          ${aiEx.requiresSafetyLicense ? " · 须安全生产许可证" : ""}
          ${aiEx.consortiumPolicy === "not_allowed" ? " · 不接受联合体" : aiEx.consortiumPolicy === "allowed" ? " · 允许联合体" : ""}
        </div>
        ${(aiEx.specialRestrictions || []).length ? `<div style="font-size:12px;color:var(--warn);">限制/注意事项：${esc(aiEx.specialRestrictions.join("；"))}</div>` : ""}
      </div>
    ` : ""}
    ${evidence.operationalDeadline ? `<p class="notice-box">${evidence.operationalDeadline==="0" ? "递交截止时间待核，已移出未截止筛选。" : "按补遗办理的递交截止时间："+esc(fmtBeijing(evidence.operationalDeadline))}</p>` : ""}
    ${evidence.availabilityChange ? `<p class="notice-box warn">发布方已更新本标段状态。 ${sourceLink(evidence.availabilityChange.title,evidence.availabilityChange.url)}</p>` : ""}
    ${pendingSources.length ? `<p class="muted">${esc(pendingSources.join("、"))}待取得或核实</p>` : ""}
    ${fields.filter(field => field.entries?.length).map(field => `<details><summary>${esc(field.label)} · ${field.state === "conflict" ? "版本冲突，待核" : field.entries?.length ? esc(field.entries[0].value) : "可读原文未写明"}</summary>${field.entries?.length ? `<ul>${excerpts(field.entries)}</ul>` : ""}</details>`).join("")}
    ${missingFields.length ? `<details><summary>可读原文中尚未找到的字段（${missingFields.length}）</summary><p>${esc(missingFields.map(field=>field.label).join("、"))}</p></details>` : ""}
    <h4>准入条件</h4>
    ${missingRequirements.length ? `<details><summary>尚无明确条款（${missingRequirements.length}）</summary><p>${esc(missingRequirements.map(req=>req.title).join("、"))}</p></details>` : ""}
    ${evidence.requirements.filter(req=>req.entries?.length).map(req => {
      const stance = { mandatory: "原文要求", prohibited: "原文禁止或限制", allowed: "原文允许", exception: "有适用例外", exempt: "原文明示免除", mixed: "含多项限制" }[req.stance];
      const status = req.state === "conflict" ? "版本冲突，待核" : stance || (req.state === "unavailable" ? "正文或附件待取得" : "可读原文未写明");
      return `<details><summary>${esc(req.title)} · ${esc(status)}</summary>${req.entries.length ? `<ul>${excerpts(req.entries)}</ul>` : ""}</details>`;
    }).join("")}
    ${evidence.scoring?.length ? `<details><summary>评分条款（${evidence.scoring.length} 条）</summary><ul>${excerpts(evidence.scoring)}</ul></details>` : ""}
    ${evidence.attachments?.length ? `<details><summary>附件取证（${evidence.attachments.length} 份）</summary><ul>${evidence.attachments.map(item => `<li>${sourceLink(item.label, item.url)} · ${item.readable ? "原生文本已读取" : item.pages?.some(page => page.status === "ocr_review") ? "OCR 待核" : "正文待取得或核实"}${item.pages?.filter(page => page.status === "ocr_review" && page.excerpt).map(page => `<div>第 ${esc(page.number)} 页识别摘录 · ${esc(page.excerpt)}</div>`).join("") || ""}</li>`).join("")}</ul></details>` : ""}
  </section>`;
}

if (!window.__brAiExtractBound) {
  window.__brAiExtractBound = true;
  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-ai-extract-detail]");
    if (!btn) return;
    const nid = btn.getAttribute("data-ai-extract-detail");
    const force = btn.getAttribute("data-ai-force") === "1";
    const host = btn.closest("[data-ev-host]");
    if (!nid) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "AI 提炼中…";
    try {
      await api(`/opportunities/${encodeURIComponent(nid)}/ai-extract`, { force });
      if (state.route.startsWith("/matrix")) {
        showToast("已完成 AI 准入条件深度提炼，已同步刷新比对矩阵。");
        renderKeepScroll();
        return;
      }
      const detail = await api(`/opportunities/${encodeURIComponent(nid)}`);
      if (host && detail?.evidence) {
        const showCompare = host.getAttribute("data-ev-compare") !== "0";
        host.outerHTML = renderNoticeEvidence(detail.evidence, nid, showCompare);
      }
      showToast("已完成 AI 准入条件深度提炼。");
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

async function renderDetail(root, id, isProjectView = false) {
  const slot = renderShell(root, isProjectView ? "projects" : "opportunities", isProjectView ? [
    { label: "岗位首页", href: "/" },
    { label: "项目库", href: "/projects" },
    { label: "已选项目全流程跟进详情" },
  ] : [
    { label: "岗位首页", href: "/" },
    { label: "机会池与标段", href: "/opportunities" },
    { label: "机会池公告研判详情" },
  ], `<div class="ws-sheet" aria-busy="true" aria-label="正在加载工作台">
    <div class="ws-sec"><div class="skeleton-bar" style="width:45%;"></div><div class="skeleton-bar" style="width:70%;margin-top:8px;"></div></div>
    <div class="ws-sec"><div class="skeleton-row"><div class="skeleton-bar" style="width:18%;"></div><div class="skeleton-bar" style="width:18%;"></div><div class="skeleton-bar" style="width:18%;"></div><div class="skeleton-bar" style="width:18%;"></div><div class="skeleton-bar" style="width:18%;"></div></div></div>
  </div>`);

  try {
    const d = await api("/opportunities/" + id);
    const budgetYuanStr = fmtYuan(d.budgetYuan);
    const hasAmendments = (d.timeline || []).some((x) => x.isAmendment && !x.isCurrent);
    const src = d.sourceHealth;
    const srcBad = src && (src.failures > 0 || src.reason);
    const lc = d.lifecycle || {};
    const wf = lc.workflow || {};
    const finSum = lc.financeSummary || { depositPaidFen: 0, depositRefundedFen: 0, depositOutstandingFen: 0, guaranteeFen: 0, expenseFen: 0, entries: [] };
    const sch = lc.schedule || {};
    const opn = lc.opening || { bids: [] };
    const out = lc.outcome || {};
    const stepIdx = lc.computedStep || (d.stage === "result" ? 7 : d.follow?.decision === "bidding" ? 2 : 1);
    if (!state.lotStepView) state.lotStepView = {};
    const viewStep = state.lotStepView[id] || stepIdx;
    const steps = [
      "1. 购买标书",
      "2. 制作投标文件",
      "3. 保证金付款",
      "4. 现场指派参加",
      "5. 开标记录表回传",
      "6. 记录表分析与预测",
      "7. 中标签合同 / 退保证金",
    ];
    const defaultCoId = wf.company_id || state.companies[0]?.id || "";
    // Convert "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM" for native <input type="datetime-local">
    const toDtLocal = (s) => {
      const m = String(s || "").trim().match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
      return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")}` : "";
    };
    const nowDtLocal = () => {
      const dt = new Date(Date.now() + 8 * 3600_000);
      return dt.toISOString().slice(0, 16);
    };
    const dlLocal = toDtLocal(d.deadlineText || d.openTimeText || "");
    const fdDicts = state.settings?.fieldDicts || {};
    const optDocBuy = fdDicts.docBuyStatuses?.length ? fdDicts.docBuyStatuses : ["未获取", "已下载免费标书", "已付费购买标书", "需CA锁平台下载", "已放弃获取"];
    const optPrep = fdDicts.prepStatuses?.length ? fdDicts.prepStatuses : ["未开始", "编制中", "商务标已完成", "技术标已完成", "内审与21项自检完成", "已定稿待签章", "已加密上传/封装"];
    const optDepMethods = fdDicts.depositMethods?.length ? fdDicts.depositMethods : [
      "基本户网银转账（现金保证金）",
      "现金（信封密封现场递交）",
      "银行支票 / 汇票 / 本票",
      "电子保函（交易平台线上出函）",
      "银行纸质保函",
      "投标保证保险（电子保单）",
      "免缴（信用承诺书 / 政采或小微免缴）",
    ];
    const optDepStatuses = fdDicts.depositStatuses?.length ? fdDicts.depositStatuses : [
      "已汇出待核验",
      "已到账确认（子账号已匹配）",
      "现金信封已封装待带往现场",
      "已出保函 / 保单生效",
      "免缴（已附信用承诺书）",
      "财务审批 / 待打款中",
    ];
    const optRefund = fdDicts.refundStatuses?.length ? fdDicts.refundStatuses : ["未进入退保", "待申请退回", "已申请催退中", "保证金已全额退回", "电子保函已释放", "现金信封现场已退回", "免缴无需退保"];

    const edp = lc.estimatedDealPrice || null;
    const smartBudgetTop = fmtSmartBudget(d.budgetYuan);
    const openAlertCnt = (d.alerts || []).filter((a) => a.status === "open").length;

    slot.innerHTML = `
      <div class="${isProjectView ? "cockpit-shell" : ""}">
      <div class="${isProjectView ? "cockpit-top" : "ws-sheet"}" style="${isProjectView ? "" : "margin-bottom:12px;"}">
        <div class="${isProjectView ? "" : "ws-sec"}">
          <div class="cockpit-head-row">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px;">
                ${stageBadge(d.stage, d.stageLabel)}
                ${decisionBadge(d.follow?.decision)}
                ${d.region ? `<span class="tag-chip tag-region">${esc(d.region)}</span>` : ""}
                ${d.tradeType ? `<span class="tag-chip tag-trade">${esc(d.tradeType)}</span>` : ""}
                <span class="muted" style="font-size:12px;">招标人：${d.tenderer ? `<a class="entity-link" href="/entities?kind=tenderer&name=${encodeURIComponent(d.tenderer)}" data-go="/entities?kind=tenderer&name=${encodeURIComponent(d.tenderer)}"><strong>${esc(d.tenderer)}</strong></a>` : "未标注"}</span>
              </div>
              <h1 class="cockpit-title">${esc(d.title)}</h1>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              ${isProjectView ? `
                <button type="button" class="btn btn-sm" data-peek="${esc(id)}">查看原文</button>
                <a class="btn btn-sm btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">官方原文 ${ICONS.ext}</a>
                <button type="button" class="btn btn-sm" style="color:var(--danger);border-color:var(--danger-border);" id="btn-proj-abandon">放弃参投</button>
              ` : `
                ${(d.follow?.decision === "bidding" || d.follow?.decision === "watching") ? `
                  <a class="btn btn-primary" href="/projects/${esc(id)}" data-go="/projects/${esc(id)}">${ICONS.check}<span>进入项目库 →</span></a>
                ` : ""}
                <button class="btn ${d.follow?.decision === "bidding" ? "" : (d.follow?.decision ? "" : "btn-primary")}" id="btn-sel-bid" type="button" title="${d.follow?.decision === "bidding" ? "再次点击可撤回参投状态" : ""}">${ICONS.check}<span>${d.follow?.decision === "bidding" ? "已参投（再点撤回）" : "+ 参投（转入项目库）"}</span></button>
                <button class="btn ${d.follow?.decision === "watching" ? "btn-primary" : ""}" id="btn-sel-watch" type="button" title="${d.follow?.decision === "watching" ? "再次点击可撤回跟进状态" : ""}">${ICONS.clock}<span>${d.follow?.decision === "watching" ? "跟进中（再点撤回）" : "跟进"}</span></button>
                <button class="btn btn-sm btn-ghost" style="color:var(--danger);" id="btn-sel-decline" type="button" title="需填写原因确认">${ICONS.x}<span>不参与</span></button>
                <a class="btn btn-sm btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">官方原文 ${ICONS.ext}</a>
              `}
            </div>
          </div>

          ${isProjectView ? `
            <!-- 首屏 5 维精简 KPI 速览条（含预估成交价，点击直达右侧 AI 口径说明） -->
            <div class="cockpit-kpi-ribbon">
              <div class="cockpit-kpi-cell">
                <div class="cockpit-kpi-label"><span>预算 / 控制价</span></div>
                <div class="cockpit-kpi-val" style="color:var(--accent);">${smartBudgetTop ? esc(smartBudgetTop) : esc(d.budgetText || "按清单控制价")}</div>
                <div class="cockpit-kpi-sub">${esc(d.evalMethod || "评标办法详见原文")}</div>
              </div>
              <div class="cockpit-kpi-cell is-accent" style="cursor:pointer;" data-rail-jump="ai" title="点击在右侧查看完整预估成交价统计口径与误差说明">
                <div class="cockpit-kpi-label"><span>预估成交价</span><span style="color:var(--accent);font-weight:600;">${edp ? `下浮 ${Math.max(0, (1 - Number(edp.p50Ratio || 1)) * 100).toFixed(2)}%` : "口径"} ▸</span></div>
                <div class="cockpit-kpi-val" style="color:var(--accent);">${edp ? esc(fmtSmartBudget(edp.estMidYuan)) : "暂无配对样本"}</div>
                <div class="cockpit-kpi-sub">${edp ? `区间 ${esc(fmtSmartBudget(edp.estLowYuan))}~${esc(fmtSmartBudget(edp.estHighYuan))}（下浮 ${Math.max(0, (1 - Number(edp.p90Ratio || 1)) * 100).toFixed(1)}%~${Math.max(0, (1 - Number(edp.p10Ratio || 1)) * 100).toFixed(1)}%）` : "按历史成交中位推算"}</div>
              </div>
              <div class="cockpit-kpi-cell">
                <div class="cockpit-kpi-label"><span>报名 / 递交截止</span></div>
                <div style="margin-top:2px;">${deadlineBadge(d.deadline, d.deadlineText)}</div>
              </div>
              <div class="cockpit-kpi-cell">
                <div class="cockpit-kpi-label"><span>在途保证金</span></div>
                <div class="cockpit-kpi-val" style="color:${finSum.depositOutstandingFen > 0 ? "var(--danger)" : "var(--good)"};">${finSum.depositOutstandingFen > 0 ? esc(fmtFen(finSum.depositOutstandingFen)) : "无占用"}</div>
                <div class="cockpit-kpi-sub">${esc(d.depositText || "保证金按文件约定")}</div>
              </div>
              <div class="cockpit-kpi-cell">
                <div class="cockpit-kpi-label"><span>拟派项目经理</span></div>
                <div class="cockpit-kpi-val" style="font-size:13.5px;">${esc(wf.prep_pm_name || "待指定")}</div>
                <div class="cockpit-kpi-sub">进度：阶段 ${stepIdx}/7 · ${openAlertCnt > 0 ? `${openAlertCnt}条提醒` : "无未决提醒"}</div>
              </div>
            </div>

            <nav class="stepper" aria-label="项目库7阶段全流程跟进（点击任意阶段切换面板）" style="margin-top:10px;border-radius:var(--radius);border:1px solid var(--border);">
              ${steps.map((s, idx) => {
                const num = idx + 1;
                const cls = num < stepIdx ? "is-done" : num === stepIdx ? "is-active" : "";
                const vCls = num === viewStep ? "viewing" : "";
                return `${idx > 0 ? `<span class="step-sep" aria-hidden="true">›</span>` : ""}<button type="button" class="step-pill ${cls} ${vCls}" data-lc-step="${num}">${num < stepIdx ? "✓ " : ""}${esc(s)}</button>`;
              }).join("")}
            </nav>
          ` : ""}
        </div>

        ${hasAmendments ? `
          <div class="ws-sec" style="background:var(--danger-bg);margin-top:${isProjectView ? "8px" : "0"};border-radius:${isProjectView ? "8px" : "0"};">
            <div style="display:flex;align-items:center;gap:8px;color:var(--danger);font-size:13px;" role="alert">
              ${ICONS.alert}
              <div><strong>检测到同项目更正 / 答疑公告：</strong>请先核对右侧「提醒与时间线」中的最新变更版本，核对截止时间、控制价与条款变动后再作判断。</div>
            </div>
          </div>
        ` : ""}

        ${!isProjectView ? `
        <div class="ws-sec">
          <div class="decision-grid" style="margin-bottom:0;">
            <div class="metric-box ${budgetYuanStr || d.budgetText ? "" : "muted-box"}">
              <div class="metric-head"><span>预算 / 控制价</span><span class="prov ${budgetYuanStr ? "prov-auto" : ""}">${budgetYuanStr ? "自动提取值" : "条款规定"}</span></div>
              <div class="metric-val amount" style="text-align:left;">${smartBudgetTop ? esc(smartBudgetTop) : `<span style="font-size:14px;">${esc(d.budgetText || "按招标清单控制价")}</span>`}</div>
              <div class="muted">${d.budgetText && smartBudgetTop ? `原文表述：${esc(d.budgetText)}` : "依据官方原文提取"}</div>
            </div>

            <div class="metric-box ${d.deadline && d.deadline !== "0" ? "" : "muted-box"}">
              <div class="metric-head"><span>报名 / 递交截止</span><span class="prov ${d.deadline && d.deadline !== "0" ? "prov-auto" : ""}">${d.deadline && d.deadline !== "0" ? "自动提取值" : "未标注"}</span></div>
              <div>${deadlineBadge(d.deadline, d.deadlineText)}</div>
              <div class="muted">开标时间：${esc(d.openTimeText ? d.openTimeText + " 北京时间" : "未标注")}</div>
            </div>

            <div class="metric-box ${d.qualifications?.length || d.qualTags?.length || d.evidence?.aiExtract?.summary ? "" : "muted-box"}">
              <div class="metric-head"><span>准入条件</span>${d.evidence?.aiExtract?.summary ? `<span class="prov prov-auto">AI 精炼</span>` : ""}</div>
              <div class="${d.evidence?.aiExtract?.summary ? "" : "muted"}" style="${d.evidence?.aiExtract?.summary ? "font-size:12.5px;font-weight:500;" : ""}">${esc(d.evidence?.aiExtract?.summary || (d.evidence?.requirements?.find(req => req.state === "conflict") ? "发现版本冲突，须核对原文" : d.evidence?.requirements?.find(req => req.state === "stated")?.entries[0]?.excerpt || "可读原文未写明，待核对招标文件"))}</div>
              <a href="/matrix?noticeId=${esc(id)}" data-go="/matrix?noticeId=${esc(id)}">按公司比对</a>
            </div>

            <div class="metric-box ${d.depositText ? "" : "muted-box"}">
              <div class="metric-head"><span>资金要求（保证金）</span><span class="prov ${d.depositText ? "prov-auto" : ""}">${d.depositText ? "自动提取值" : "未标注"}</span></div>
              <div style="font-size:13px;font-weight:500;">${d.depositText ? esc(d.depositText) : `<span class="muted">按招标文件约定</span>`}</div>
              <div class="muted">实际缴退在银行/平台办理</div>
            </div>

            <div class="metric-box ${d.evalMethod ? "" : "muted-box"}">
              <div class="metric-head"><span>评标办法</span><span class="prov ${d.evalMethod ? "prov-auto" : ""}">${d.evalMethod ? "自动提取值" : "未标注"}</span></div>
              <div class="metric-val" style="font-size:15px;">${d.evalMethod ? esc(d.evalMethod) : `<span class="muted">详见原文条款</span>`}</div>
              <div class="muted">${d.winner ? `公示结果：${esc(d.winner)}` : "条件不足时不推断"}</div>
            </div>
          </div>
          ${renderEstimatedDealPriceCard(lc.estimatedDealPrice)}
        </div>
        ` : ""}
      </div>

      ${isProjectView ? `<div class="cockpit-grid"><div class="cockpit-main">` : ""}

        <!-- 7阶段全流程跟进指挥台（仅在「项目库」已选项目详情页 /projects/:id 展示） -->
        ${isProjectView ? `
        <div class="card" id="lc-hub" style="margin-bottom:0;background:var(--surface);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
            <div class="meta-row">
              <strong style="font-size:14px;color:var(--text);">标段全流程跟进工作台 · 当前查看：${esc(steps[viewStep - 1])}</strong>
              ${badge("info", "radar", `整体进度：阶段 ${stepIdx} / 7`)}
              ${wf.updated_at ? `<span class="muted">最近更新：${esc(wf.updated_by_name || "")} · ${esc(wf.updated_at)}</span>` : ""}
            </div>
            <div class="meta-row">
              <span class="muted">参投主体：</span>
              <select id="lc-company" class="select" style="height:30px;font-size:12px;">
                ${state.companies.map((c) => `<option value="${esc(c.id)}" ${defaultCoId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
              </select>
            </div>
          </div>

          ${viewStep === 1 ? `
            <form id="lc-form-1" class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 1：购买 / 获取招标文件</h3>
                <div class="meta-row">
                  ${wf.doc_buy_file_id ? `<button type="button" class="btn btn-sm" data-preview-file="${esc(wf.doc_buy_file_id)}" data-fname="${esc(wf.doc_buy_file_name || "招标文件.pdf")}">预览原件</button>` : ""}
                  <button type="button" class="btn btn-sm" data-lot-upload="doc_buy">${wf.doc_buy_file_id ? "更换招标文件" : "上传招标文件"}</button>
                </div>
              </div>
              <div class="lc-grid">
                <div class="field" style="margin:0;"><label>标书获取状态</label><select class="select" name="docBuyStatus">${optDocBuy.map((s) => `<option value="${esc(s)}" ${wf.doc_buy_status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;"><label>标书/平台费用（元）</label><input class="input num" type="number" step="0.01" min="0" name="docBuyFeeYuan" value="${wf.doc_buy_fee_fen ? (wf.doc_buy_fee_fen / 100).toFixed(2) : "0"}" /></div>
                <div class="field" style="margin:0;">
                  <label style="display:flex;justify-content:space-between;"><span>获取时间（北京时间）</span><button type="button" class="btn-ghost" style="border:none;padding:0;font-size:11px;color:var(--accent);cursor:pointer;" data-fill-now="docBuyAt">填此刻</button></label>
                  <input class="input" type="datetime-local" name="docBuyAt" value="${esc(toDtLocal(wf.doc_buy_at))}" />
                </div>
                <div class="field" style="margin:0;"><label>备注（平台账号/清单说明）</label><input class="input" name="docBuyNote" value="${esc(wf.doc_buy_note || "")}" placeholder="如：CA锁已下载招标工程量清单" /></div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;">
                <span class="muted" style="font-size:12px;">记账规则：标书/平台费用 &gt; 0 元时，保存后将<strong>自动计入资金台账</strong>（同标段自动去重不重复记账）。</span>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${stepIdx > 1 ? `<button type="button" class="btn btn-sm" style="color:var(--warn);" data-rollback-step="1">撤回整体进度回阶段 1</button>` : ""}
                  <button type="submit" class="btn" data-adv="1">保存本阶段</button>
                  <button type="submit" class="btn btn-primary" data-adv="2">保存并进入「2. 制作投标文件」 →</button>
                </div>
              </div>
            </form>
          ` : ""}

          ${viewStep === 2 ? `
            <form id="lc-form-2" class="card" style="margin-bottom:0;">
              <div class="card-head" style="margin-bottom:10px;">
                <div>
                  <h3 style="margin:0;">阶段 2：制作投标文件</h3>
                  <div class="muted" style="font-size:12px;margin-top:2px;">标书制作完成后可选择上传定稿留档，也可不上传直接进入下一步「保证金付款」。</div>
                </div>
                <div class="meta-row">
                  ${wf.prep_file_id ? `<button type="button" class="btn btn-sm" data-preview-file="${esc(wf.prep_file_id)}" data-fname="${esc(wf.prep_file_name || "投标文件定稿.pdf")}">预览原件</button>` : ""}
                  <button type="button" class="btn btn-sm btn-primary" data-lot-upload="prep">${wf.prep_file_id ? "更换投标文件" : "上传投标文件定稿（可选）"}</button>
                  <button type="button" class="btn btn-sm" id="btn-jump-21chk">21 项自检清单</button>
                </div>
              </div>
              <input type="hidden" name="prepStatus" value="已定稿" />
              <div class="lc-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">
                <div class="field" style="margin:0;">
                  <label>拟派项目经理 / 建造师（选填，自动联动锁证校验）</label>
                  <select class="select" name="prepPmPersonId" id="lc-pm-select">
                    <option value="">暂不指定 / 无需绑定人员</option>
                    ${(lc.companyPeople || []).map((p) => {
                      const warnTag = p.lockStatus === "locked" ? "【在建锁定】" : p.socialStatus === "待补缴" ? "【社保待补】" : p.activeBidCount > 0 ? `【在投${p.activeBidCount}个项目】` : "【可用】";
                      return `<option value="${esc(p.id)}" ${wf.prep_pm_person_id === p.id ? "selected" : ""}>${esc(warnTag)} ${esc(p.name)} · ${esc(p.certLevel || p.roleTitle || "专职")}（社保：${esc(p.socialStatus || "未标注")}）</option>`;
                    }).join("")}
                  </select>
                </div>
                <div class="field" style="margin:0;"><label>备注（选填）</label><input class="input" name="prepNote" value="${esc(wf.prep_note || "")}" placeholder="如：技术标/商务标已定稿、签章说明等" /></div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" data-rollback-step="1">← 撤回至阶段 1</button>
                <div style="display:flex;gap:8px;">
                  <button type="submit" class="btn" data-adv="2">仅保存</button>
                  <button type="submit" class="btn btn-primary" data-adv="3">完成标书制作，进入「3. 保证金付款」 →</button>
                </div>
              </div>
            </form>
          ` : ""}

          ${viewStep === 3 ? `
            <div class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 3：投标保证金付款 / 推送财务打款 / 保函办理</h3>
                <div class="meta-row">
                  ${badge(finSum.depositPaidFen > 0 || finSum.guaranteeFen > 0 ? "good" : "warn", "check", `已缴现金：${fmtFen(finSum.depositPaidFen)} · 保函/保险面额：${fmtFen(finSum.guaranteeFen)}`)}
                  ${finSum.depositOutstandingFen > 0 ? badge("info", "clock", `在途待退：${fmtFen(finSum.depositOutstandingFen)}`) : ""}
                </div>
              </div>

              <div style="padding:14px;border-radius:var(--radius);background:var(--accent-soft);border:1px solid var(--accent-border);margin-bottom:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                  <div>
                    <strong style="font-size:13.5px;color:var(--accent);">推送保证金打款任务给财务（默认指派：${esc(lc.defaultFinance?.name || state.settings?.defaultFinanceUserName || "未指定财务负责人")}）</strong>
                    <div class="muted" style="font-size:12px;" id="dep-auto-hint">系统已自动尝试从公告原文提取保证金金额与收款账户；核对无误后一键推送，财务上传回执后将自动入账并推进至阶段 4。</div>
                  </div>
                  <button type="button" class="btn btn-sm" id="btn-ai-extract-deposit">重新提取保证金信息</button>
                </div>
                <form id="lc-push-fin-form">
                  <div class="lc-grid">
                    <div class="field" style="margin:0;">
                      <label>缴纳 / 担保形式</label>
                      <select class="select" name="depositMethod">
                        ${optDepMethods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
                      </select>
                    </div>
                    <div class="field" style="margin:0;"><label>打款金额（元）*</label><input class="input num" type="number" step="0.01" min="0" name="amountYuan" required placeholder="例如 50000" /></div>
                    <div class="field" style="margin:0;"><label>收款户名（交易中心/代理机构）</label><input class="input" name="payeeName" placeholder="例如 盐城市公共资源交易中心" /></div>
                    <div class="field" style="margin:0;"><label>收款账号 / 虚拟子账号</label><input class="input num" name="payeeAccount" placeholder="输入基本户打款目标账号" /></div>
                    <div class="field" style="margin:0;"><label>开户银行</label><input class="input" name="payeeBank" placeholder="例如 中国银行盐城分行营业部" /></div>
                    <div class="field" style="margin:0;"><label>要求打款截止时间</label><input class="input" type="datetime-local" name="dueTime" value="${esc(dlLocal || "")}" /></div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
                    <input class="input" name="note" style="flex:1;min-width:220px;" placeholder="附言 / 标段编号 / 现金信封交接说明（选填）" />
                    <button type="submit" class="btn btn-primary">推送打款任务给财务（${esc(lc.defaultFinance?.name || state.settings?.defaultFinanceUserName || "未指定财务负责人")}）</button>
                  </div>
                </form>
              </div>

              ${(lc.payTasks || []).length ? `
                <div style="margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;background:var(--surface-2);">
                  <div style="font-size:12.5px;font-weight:600;margin-bottom:8px;">已推送的财务打款任务（${lc.payTasks.length} 笔）</div>
                  <div class="table-wrap">
                    <table class="tbl">
                      <thead><tr><th>状态</th><th>指派财务</th><th class="amount">金额</th><th>收款户名 / 账号 / 开户行</th><th>财务打款回执</th></tr></thead>
                      <tbody>
                        ${lc.payTasks.map((pt) => `
                          <tr>
                            <td>${pt.status === "paid" ? badge("good", "check", "财务已打款") : badge("warn", "clock", "待财务打款")}</td>
                            <td><strong>${esc(pt.assignee_name || "未指定财务负责人")}</strong><div class="muted" style="font-size:11px;">${esc(pt.deposit_method || "")}</div></td>
                            <td class="amount"><span class="num">${esc(fmtFen(pt.amount_fen))}</span></td>
                            <td style="font-size:12px;">
                              <div><strong>${esc(pt.payee_name || "未填户名")}</strong></div>
                              <div class="muted num">${esc(pt.payee_account || "未填账号")} ${pt.payee_bank ? `· ${esc(pt.payee_bank)}` : ""}</div>
                              ${pt.due_time ? `<div class="muted" style="font-size:11px;">截止：${esc(pt.due_time)}</div>` : ""}
                            </td>
                            <td>
                              ${(pt.receiptFiles || []).length
                                ? pt.receiptFiles.map((rf) => `<button type="button" class="btn btn-sm" style="margin:2px 4px 2px 0;" data-preview-file="${esc(rf.fileId)}" data-fname="${esc(rf.fileName || "回执凭据.png")}">${esc(rf.fileName || "回执")}</button>`).join("")
                                : (pt.status === "paid" ? `<span class="muted">已打款（无附件）</span>` : `<button type="button" class="btn btn-sm" data-go="/finance">去资金台账执行打款</button>`)}
                            </td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              ` : ""}

              <details style="margin-top:8px;">
                <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);padding:6px 0;">▸ 或手动直接补录保证金流水 / 免缴承诺（无需财务打款时使用）</summary>
                <form id="lc-form-3" style="margin-top:10px;">
                  <div class="lc-grid">
                    <div class="field" style="margin:0;">
                      <label>保证金缴纳 / 担保形式（可在系统设置增删）</label>
                      <select class="select" name="depositMethod" id="lc-dep-method">
                        ${optDepMethods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
                      </select>
                    </div>
                    <div class="field" style="margin:0;"><label>本次登记金额（元，免缴填 0）</label><input class="input num" id="lc-dep-amt" type="number" step="0.01" min="0" name="amountYuan" placeholder="输入金额（不新增流水可留空）" /></div>
                    <div class="field" style="margin:0;">
                      <label>办理 / 到账状态</label>
                      <select class="select" name="payStatus" id="lc-dep-status">
                        ${optDepStatuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
                      </select>
                    </div>
                    <div class="field" style="margin:0;"><label>预计退回 / 保函到期日</label><input class="input" type="date" name="dueDate" /></div>
                    <div class="field" style="margin:0;"><label>回单号 / 保函编号 / 子账号备注</label><input class="input" name="note" placeholder="如：基本户网银回单号 / 电子保函编号" /></div>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-sm" data-rollback-step="2">← 撤回至阶段 2 修改</button>
                    <div style="display:flex;gap:8px;">
                      <button type="submit" class="btn" data-adv="3">登记保证金流水</button>
                      <button type="submit" class="btn btn-primary" data-adv="4">保存并进入「4. 现场指派参加」 →</button>
                    </div>
                  </div>
                </form>
              </details>
              ${finSum.entries.length ? `
                <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
                  <div class="muted" style="margin-bottom:6px;">本标段已登记资金流水（${finSum.entries.length} 条 · 填错可直接点右侧「冲销撤回」）：</div>
                  <div class="table-wrap">
                    <table class="tbl">
                      <thead><tr><th>时间</th><th>类型</th><th class="amount">金额</th><th>状态与备注</th><th style="width:88px;">操作</th></tr></thead>
                      <tbody>
                        ${finSum.entries.map((fe) => `
                          <tr style="${fe.reversed ? "opacity:0.5;" : ""}">
                            <td class="muted num">${esc(fe.created_at)}</td>
                            <td><span class="prov">${esc(fe.category === "guarantee" ? "保函/保险" : fe.category === "expense" ? "标书/代理费" : "现金保证金")}</span> · ${esc(fe.entry_type === "refund_received" ? "退回到账" : fe.entry_type === "urge" ? "催退记录" : "实缴/出函")}</td>
                            <td class="amount"><span class="num">${esc(fmtFen(fe.amount_fen))}</span></td>
                            <td class="muted">${esc(fe.pay_status)} ${fe.note ? `· ${esc(fe.note)}` : ""}</td>
                            <td>${!fe.reversed ? `<button type="button" class="quick-pill" style="color:var(--danger);" data-lc-rev-fin="${esc(fe.id)}">冲销撤回</button>` : `<span class="muted">已冲销</span>`}</td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              ` : ""}
            </div>
          ` : ""}

          ${viewStep === 4 ? `
            <form id="lc-form-4" class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 4：现场 / 不见面开标指派参加</h3>
                ${sch.delegateName ? badge("good", "check", `已指派委托人：${sch.delegateName}`) : badge("warn", "clock", "待指派参会委托人")}
              </div>
              <div class="lc-grid">
                <div class="field" style="margin:0;"><label>开标方式</label><select class="select" name="openMode">${["现场", "远程", "混合"].map((m) => `<option value="${m}" ${sch.open_mode === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;"><label>指派授权委托人</label><select class="select" name="delegateId"><option value="">待指定</option>${state.employees.map((e) => `<option value="${esc(e.id)}" ${sch.delegate_id === e.id ? "selected" : ""}>${esc(e.name)} (${esc(e.username)})</option>`).join("")}</select></div>
                <div class="field" style="margin:0;">
                  <label style="display:flex;justify-content:space-between;"><span>递交截止时间</span>${dlLocal ? `<button type="button" class="btn-ghost" style="border:none;padding:0;font-size:11px;color:var(--accent);cursor:pointer;" data-fill-dl="submitTime">沿用公告截止</button>` : ""}</label>
                  <input class="input" type="datetime-local" name="submitTime" value="${esc(toDtLocal(sch.submit_time || d.deadlineText))}" />
                </div>
                <div class="field" style="margin:0;"><label>解密时段</label><input class="input" name="decryptWindow" value="${esc(sch.decrypt_window || "")}" placeholder="如：09:00-09:30" /></div>
                <div class="field" style="margin:0;">
                  <label style="display:flex;justify-content:space-between;"><span>开标时间</span>${dlLocal ? `<button type="button" class="btn-ghost" style="border:none;padding:0;font-size:11px;color:var(--accent);cursor:pointer;" data-fill-dl="openTime">沿用公告截止</button>` : ""}</label>
                  <input class="input" type="datetime-local" name="openTime" value="${esc(toDtLocal(sch.open_time || d.openTimeText || d.deadlineText))}" />
                </div>
                <div class="field" style="margin:0;"><label>开标地点 / 不见面大厅地址</label><input class="input" name="venue" value="${esc(sch.venue || "")}" placeholder="如：盐城市公共资源交易中心 402 开标室" /></div>
                <div class="field" style="margin:0;"><label>出发占用时间（防撞车）</label><input class="input" type="datetime-local" name="departAt" value="${esc(toDtLocal(sch.depart_at))}" /></div>
                <div class="field" style="margin:0;"><label>结束返程时间（防撞车）</label><input class="input" type="datetime-local" name="untilAt" value="${esc(toDtLocal(sch.until_at))}" /></div>
              </div>
              <div class="field" style="margin-top:10px;margin-bottom:0;">
                <label>携带资料与现场注意事项（点击下方胶囊快速勾选填入）</label>
                <div class="meta-row" style="margin-bottom:6px;">
                  ${["兴业/江苏CA锁", "法人授权委托书原件2份", "委托人身份证原件", "密封纸质标书正副本", "企业资质/业绩原件备查"].map((tag) => `<button type="button" class="quick-pill" data-append-note="${esc(tag)}">+ ${esc(tag)}</button>`).join("")}
                </div>
                <input class="input" id="lc4-note" name="note" value="${esc(sch.note || "")}" placeholder="点击上方标签或直接填写现场注意事项" />
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" data-rollback-step="3">← 撤回至阶段 3 修改</button>
                <div style="display:flex;gap:8px;">
                  <button type="submit" class="btn" data-adv="4">保存指派安排</button>
                  <button type="submit" class="btn btn-primary" data-adv="5">保存并进入「5. 开标记录表回传」 →</button>
                </div>
              </div>
            </form>
          ` : ""}

          ${viewStep === 5 ? `
            <form id="lc-form-5" class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 5：开标记录表回传与各家唱标录入</h3>
                <div class="meta-row">
                  ${wf.opening_sheet_file_id ? `<button type="button" class="btn btn-sm btn-primary" data-preview-file="${esc(wf.opening_sheet_file_id)}" data-fname="${esc(wf.opening_sheet_file_name || "开标记录表.pdf")}">预览原件</button>` : ""}
                  <button type="button" class="btn btn-sm" id="btn-lc5-ocr">拍照 / PDF 识别唱标表</button>
                  <button type="button" class="btn btn-sm" data-lot-upload="opening_sheet">${wf.opening_sheet_file_id ? "更换开标记录表" : "上传开标记录表"}</button>
                </div>
              </div>
              <div id="lc5-ocr-out" style="display:none;margin-bottom:10px;"></div>
              <div class="lc-grid">
                <div class="field" style="margin:0;"><label>开标方式</label><select class="select" name="openMode">${["现场", "远程", "混合"].map((m) => `<option value="${m}" ${(opn.open_mode || sch.open_mode) === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;">
                  <label style="display:flex;justify-content:space-between;"><span>签到/解密完成时间</span><button type="button" class="btn-ghost" style="border:none;padding:0;font-size:11px;color:var(--accent);cursor:pointer;" data-fill-now="arriveTime">填此刻</button></label>
                  <input class="input" type="datetime-local" name="arriveTime" value="${esc(toDtLocal(opn.arrive_time))}" />
                </div>
                <div class="field" style="margin:0;"><label>开标室 / 现场对接人</label><input class="input" name="venue" value="${esc(opn.venue || sch.venue || "")}" placeholder="开标室或交易大厅" /></div>
                <div class="field" style="margin:0;"><label>现场核验材料与异常情况</label><input class="input" name="note" value="${esc(opn.note || "")}" placeholder="如：共 12 家解密成功，某单位未按时解密" /></div>
              </div>
              <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                  <div>
                    <strong style="font-size:13px;">开标记录表 · 各家投标单位唱标报价明细（自动换算相对控制价下浮率）</strong>
                    <span class="muted" style="margin-left:8px;">取消勾选「有效」可剔除废标单位；点击右侧「×」可删行。</span>
                  </div>
                  <button type="button" class="btn btn-sm" id="lc-add-bid-row">+ 增加唱标单位行</button>
                </div>
                <div id="lc-bids-list" style="display:flex;flex-direction:column;gap:6px;">
                  ${((opn.bids && opn.bids.length) ? opn.bids : [
                    { rank: 1, bidder: state.companies.find((c) => c.id === defaultCoId)?.name || "本方公司", amountYuan: "", valid: true, remark: "我方报价" },
                    { rank: 2, bidder: "", amountYuan: "", valid: true, remark: "" },
                  ]).map((b, i) => {
                    const ctrlNum = Number(d.budgetYuan || 0);
                    const amtNum = Number(b.amountYuan || 0);
                    const flPct = ctrlNum > 0 && amtNum > 0 && ctrlNum >= amtNum ? (((ctrlNum - amtNum) / ctrlNum) * 100).toFixed(2) + "%" : "—";
                    return `
                      <div class="filter-bar lc-bid-row">
                        <span class="num muted" style="width:24px;">#${i + 1}</span>
                        <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;" title="是否有效唱标（废标或未解密请取消勾选）">
                          <input type="checkbox" data-bk="valid" ${b.valid !== false ? "checked" : ""} /> 有效
                        </label>
                        <input class="input" data-bk="bidder" value="${esc(b.bidder)}" placeholder="投标单位名称" style="flex:1;min-width:170px;" />
                        <input class="input num" data-bk="amountYuan" type="number" step="0.01" value="${esc(b.amountYuan)}" placeholder="唱标报价（元）" style="width:155px;" />
                        <span class="prov num" data-bk-float style="min-width:86px;justify-content:center;">下浮 ${esc(flPct)}</span>
                        <input class="input" data-bk="remark" value="${esc(b.remark || "")}" placeholder="工期/废标原因/备注" style="width:130px;" />
                        <button type="button" class="btn btn-ghost btn-sm" data-del-bid-row title="删除该行" style="color:var(--danger);padding:0 6px;">×</button>
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" data-rollback-step="4">← 撤回至阶段 4 修改</button>
                <div style="display:flex;gap:8px;">
                  <button type="submit" class="btn" data-adv="5">保存开标记录表</button>
                  <button type="submit" class="btn btn-primary" data-adv="6">保存并进入「6. 记录表分析与预测」 →</button>
                </div>
              </div>
            </form>
          ` : ""}

          ${viewStep === 6 ? `
            <form id="lc-form-6" class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 6：开标记录表分析与中标预测</h3>
                <div class="meta-row">
                  <select id="pred-algo" class="select" style="height:28px;font-size:12px;" aria-label="选择评标基准价测算规则">
                    <option value="trimmed_avg">规则1：有效报价去最高最低算术均价（≥5家去极值）</option>
                    <option value="full_avg">规则2：全部有效唱标算术平均价</option>
                    <option value="ctrl_compound">规则3：控制价下浮5%与有效均价各50%复合基准价</option>
                  </select>
                  <button type="button" class="btn btn-sm btn-primary" id="btn-auto-calc-pred">按开标记录表一键测算</button>
                  <a class="btn btn-sm btn-ghost" href="/review" data-go="/review">查看全库下浮率大数据</a>
                </div>
              </div>
              <div class="notice-box" style="margin-bottom:10px;">
                ${ICONS.radar}
                <div>
                  <strong>过往公告大数据参照（${esc(lc.localFloatBenchmark?.district || d.region || "本区")}）：</strong>
                  同县/区历史平均中标下浮率：<strong style="color:var(--accent);">${lc.localFloatBenchmark?.districtAvgFloatPct !== null && lc.localFloatBenchmark?.districtAvgFloatPct !== undefined ? `${lc.localFloatBenchmark.districtAvgFloatPct}%（${lc.localFloatBenchmark.districtSampleCount}个历史项目）` : "暂无配对样本"}</strong>
                  · 该招标单位（${esc(d.tenderer || "业主")}）历史平均中标下浮率：<strong style="color:var(--accent);">${lc.localFloatBenchmark?.tendererAvgFloatPct !== null && lc.localFloatBenchmark?.tendererAvgFloatPct !== undefined ? `${lc.localFloatBenchmark.tendererAvgFloatPct}%（${lc.localFloatBenchmark.tendererSampleCount}个历史项目）` : "暂无该单位配对样本"}</strong>
                </div>
              </div>
              <div class="lc-grid">
                <div class="field" style="margin:0;"><label>我方唱标报价（元）</label><input class="input num" id="pred-our" type="number" step="0.01" name="ourQuoteYuan" value="${wf.predict_our_quote_fen ? (wf.predict_our_quote_fen / 100).toFixed(2) : ""}" placeholder="自动或手动输入（元）" /></div>
                <div class="field" style="margin:0;"><label>测算评标基准价 / 均价（元）</label><input class="input num" id="pred-bench" type="number" step="0.01" name="benchmarkYuan" value="${wf.predict_benchmark_fen ? (wf.predict_benchmark_fen / 100).toFixed(2) : ""}" placeholder="基准价或有效算术平均价" /></div>
                <div class="field" style="margin:0;"><label>我方相对控制价/基准下浮率</label><input class="input num" id="pred-float" name="floatRate" value="${esc(wf.predict_float_rate || "")}" placeholder="如：下浮 6.82%" /></div>
                <div class="field" style="margin:0;"><label>预测价格/综合排名</label><input class="input" id="pred-rank" name="predictRank" value="${esc(wf.predict_rank || "")}" placeholder="如：第 1 名 / 前 3 候选" /></div>
                <div class="field" style="margin:0;"><label>中标预测结论</label><select class="select" name="predictStatus">${["待分析", "高概率第一候选人", "进入前三候选范围", "报价偏离较大/待综合评分", "预计未入围"].map((s) => `<option value="${s}" ${wf.predict_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
              </div>
              <div class="field" style="margin-top:10px;margin-bottom:0;"><label>开标记录表分析依据与竞争对手报价特征说明</label><input class="input" id="pred-note" name="predictNote" value="${esc(wf.predict_note || "")}" placeholder="如：有效唱标11家，去掉最高最低后均价 468.5 万，我方报价最接近基准价" /></div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" data-rollback-step="5">← 撤回至阶段 5 修改</button>
                <div style="display:flex;gap:8px;">
                  <button type="submit" class="btn" data-adv="6">保存预测分析</button>
                  <button type="submit" class="btn btn-primary" data-adv="7">保存并进入「7. 中标签合同 / 退保证金」 →</button>
                </div>
              </div>
            </form>
          ` : ""}

          ${viewStep === 7 ? `
            <form id="lc-form-7" class="card" style="margin-bottom:0;">
              <div class="card-head">
                <h3>阶段 7：结果落地 — 中标签合同 / 未中标退回投标保证金</h3>
                <div class="meta-row">
                  ${badge(out.final_result === "中标" ? "good" : out.final_result === "未中标" ? "warn" : "info", "check", `当前定性：${out.final_result || "未标注"}`)}
                  ${badge(wf.refund_track_status === "保证金已全额退回" || wf.refund_track_status === "电子保函已释放" ? "good" : "info", "clock", `保证金回收：${wf.refund_track_status || "未进入退保"}`)}
                </div>
              </div>
              <div class="lc-split">
                <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);">
                  <strong style="display:block;margin-bottom:8px;color:var(--accent);">路径 A：评标结果公示与中标签合同移交</strong>
                  <div class="lc-grid">
                    <div class="field" style="margin:0;"><label>公示候选状态</label><select class="select" name="candidateStatus">${["未标注", "第一候选人", "第二候选人", "第三候选人", "未入围", "公示异议中"].map((s) => `<option value="${s}" ${out.candidate_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
                    <div class="field" style="margin:0;"><label>最终中标结果</label><select class="select" name="finalResult">${["未标注", "中标", "未中标", "流标或终止"].map((s) => `<option value="${s}" ${out.final_result === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
                    <div class="field" style="margin:0;"><label>中标金额（元，中标填写）</label><input class="input num" type="number" step="0.01" name="awardAmountYuan" value="${out.award_amount_fen ? (out.award_amount_fen / 100).toFixed(2) : ""}" placeholder="0.00" /></div>
                    <div class="field" style="margin:0;"><label>中标通知书状态</label><select class="select" name="noticeLetterStatus">${["未下达", "已下达待签收", "已签收"].map((s) => `<option value="${s}" ${out.notice_letter_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
                    <div class="field" style="margin:0;"><label>履约担保办理</label><select class="select" name="guaranteeStatus">${["未标注", "免缴(附依据)", "履约保函已办", "履约现金已缴"].map((s) => `<option value="${s}" ${out.guarantee_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
                    <div class="field" style="margin:0;"><label>合同签署与工程移交</label><select class="select" name="contractStatus">${["未签署", "审核中", "已签署", "已移交启动"].map((s) => `<option value="${s}" ${out.contract_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
                  </div>
                  <div class="field" style="margin-top:8px;margin-bottom:0;"><label>移交工程接收部门/项目经理及合同备注</label><input class="input" name="handoverTo" value="${esc(out.handover_to || "")}" placeholder="如：已移交市政工程一部（张经理）施工进场" /></div>
                </div>

                <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);">
                  <strong style="display:block;margin-bottom:8px;color:var(--warn);">路径 B：未中标 / 签合同后取回投标保证金跟踪</strong>
                  <div class="muted" style="margin-bottom:8px;">当前本标段已缴现金保证金：<strong>${esc(fmtFen(finSum.depositPaidFen))}</strong> · 已退回：<strong>${esc(fmtFen(finSum.depositRefundedFen))}</strong> · 待退余额：<strong style="color:var(--danger);">${esc(fmtFen(finSum.depositOutstandingFen))}</strong></div>
                  <div class="lc-grid">
                    <div class="field" style="margin:0;"><label>保证金退回进度</label><select class="select" name="refundTrackStatus">${optRefund.map((s) => `<option value="${esc(s)}" ${wf.refund_track_status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
                    <div class="field" style="margin:0;"><label>预计应退日期</label><input class="input" type="date" name="refundExpectedDate" value="${esc(wf.refund_expected_date || "")}" /></div>
                    <div class="field" style="margin:0;"><label>实际退回到账日期</label><input class="input" type="date" name="refundReceivedDate" value="${esc(wf.refund_received_date || "")}" /></div>
                    <div class="field" style="margin:0;"><label>同步登记资金台账动作</label><select class="select" name="recordRefundType"><option value="">仅更新状态（不记新流水）</option><option value="refund_received">登记「保证金退回基本户到账」</option><option value="urge">登记「向交易中心/代理催退记录」</option></select></div>
                    <div class="field" style="margin:0;"><label>本次退回到账/催退金额（元）</label><input class="input num" type="number" step="0.01" min="0" name="refundAmountYuan" value="${finSum.depositOutstandingFen > 0 ? (finSum.depositOutstandingFen / 100).toFixed(2) : ""}" /></div>
                    <div class="field" style="margin:0;"><label>退保回单号 / 催退联系记录</label><input class="input" name="refundNote" value="${esc(wf.refund_note || "")}" placeholder="如：交易中心已原路退回基本户" /></div>
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" data-rollback-step="6">← 撤回至阶段 6 修改</button>
                <button type="submit" class="btn btn-primary" data-adv="7">保存结果与保证金退回闭环</button>
              </div>
            </form>
          ` : ""}

          <!-- 折叠式 7 阶段台账总览（默认折叠不占首屏，一键展开） -->
          <details class="cockpit-accordion" style="margin-top:12px;">
            <summary>
              <span>7 阶段全流程执行台账一表总览（点击展开 / 切换任意阶段）</span>
              <span class="muted" style="font-size:11.5px;font-weight:400;">原件留痕 · 点击展开 ▾</span>
            </summary>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th style="width:155px;">流程阶段</th>
                    <th style="width:140px;">当前状态</th>
                    <th>责任人 / 拟派建造师 / 关键信息</th>
                    <th class="amount" style="width:155px;">涉及金额 / 下浮率</th>
                    <th style="width:170px;">原件与操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="${viewStep === 1 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>1. 购买标书</strong></td>
                    <td>${badge(wf.doc_buy_status && wf.doc_buy_status !== "未获取" ? "good" : "quiet", "check", wf.doc_buy_status || "未获取")}</td>
                    <td class="muted">${esc(wf.doc_buy_at ? `获取时间：${wf.doc_buy_at}` : "尚未登记获取时间")} ${wf.doc_buy_note ? `· ${esc(wf.doc_buy_note)}` : ""}</td>
                    <td class="amount"><span class="num">${wf.doc_buy_fee_fen ? esc(fmtFen(wf.doc_buy_fee_fen)) : "0.00 元"}</span></td>
                    <td>
                      ${wf.doc_buy_file_id ? `<button type="button" class="btn btn-sm" data-preview-file="${esc(wf.doc_buy_file_id)}" data-fname="${esc(wf.doc_buy_file_name || "招标文件.pdf")}">预览原件</button>` : ""}
                      <button type="button" class="btn btn-sm btn-ghost" data-lc-step="1">编辑</button>
                    </td>
                  </tr>
                  <tr style="${viewStep === 2 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>2. 制作投标文件</strong></td>
                    <td>${badge(wf.prep_status && wf.prep_status !== "未开始" ? "good" : "quiet", "file", wf.prep_status || "未开始")}</td>
                    <td class="muted">
                      ${wf.prep_pm_name ? `拟派建造师：<strong>${esc(wf.prep_pm_name)}</strong> · ` : "未绑定建造师 · "}
                      ${wf.prep_deadline ? `定稿截止：${esc(wf.prep_deadline)}` : ""} ${wf.prep_note ? `· ${esc(wf.prep_note)}` : ""}
                    </td>
                    <td class="amount"><span class="muted">21项合规核验</span></td>
                    <td>
                      ${wf.prep_file_id ? `<button type="button" class="btn btn-sm" data-preview-file="${esc(wf.prep_file_id)}" data-fname="${esc(wf.prep_file_name || "投标文件.pdf")}">预览原件</button>` : ""}
                      <button type="button" class="btn btn-sm btn-ghost" data-lc-step="2">编辑</button>
                    </td>
                  </tr>
                  <tr style="${viewStep === 3 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>3. 保证金付款</strong></td>
                    <td>${badge(finSum.depositPaidFen > 0 || finSum.guaranteeFen > 0 ? "good" : "warn", "check", finSum.depositPaidFen > 0 ? "已缴现金保证金" : finSum.guaranteeFen > 0 ? "已出电子保函" : "待办理")}</td>
                    <td class="muted">现金实缴：${esc(fmtFen(finSum.depositPaidFen))} · 保函：${esc(fmtFen(finSum.guaranteeFen))}</td>
                    <td class="amount"><span class="num">${esc(fmtFen(finSum.depositPaidFen || finSum.guaranteeFen))}</span></td>
                    <td><button type="button" class="btn btn-sm btn-ghost" data-lc-step="3">登记流水</button></td>
                  </tr>
                  <tr style="${viewStep === 4 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>4. 现场指派参加</strong></td>
                    <td>${badge(sch.delegateName ? "good" : "warn", "clock", sch.delegateName ? `已派：${sch.delegateName}` : "待指派委托人")}</td>
                    <td class="muted">${esc(sch.open_mode || "未定方式")} · ${esc(sch.open_time || d.openTimeText || "时间详见公告")} · ${esc(sch.venue || "地点待填")}</td>
                    <td class="amount"><span class="muted">—</span></td>
                    <td><button type="button" class="btn btn-sm btn-ghost" data-lc-step="4">指派/修改</button></td>
                  </tr>
                  <tr style="${viewStep === 5 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>5. 开标记录表回传</strong></td>
                    <td>${badge((opn.bids && opn.bids.length) || wf.opening_sheet_file_id ? "good" : "quiet", "file", (opn.bids && opn.bids.length) ? `已录 ${opn.bids.length} 家唱标` : wf.opening_sheet_file_id ? "已传记录表原件" : "待回传")}</td>
                    <td class="muted">${esc(opn.arrive_time ? `签到：${opn.arrive_time}` : "开标后回传记录表并录入各家唱标价")} ${opn.note ? `· ${esc(opn.note)}` : ""}</td>
                    <td class="amount"><span class="num">${opn.bids?.[0]?.amountYuan ? esc(fmtYuan(Math.round(opn.bids[0].amountYuan))) : "—"}</span></td>
                    <td>
                      ${wf.opening_sheet_file_id ? `<button type="button" class="btn btn-sm btn-primary" data-preview-file="${esc(wf.opening_sheet_file_id)}" data-fname="${esc(wf.opening_sheet_file_name || "开标记录表.pdf")}">预览记录表</button>` : ""}
                      <button type="button" class="btn btn-sm btn-ghost" data-lc-step="5">回传/录入</button>
                    </td>
                  </tr>
                  <tr style="${viewStep === 6 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>6. 记录表分析预测</strong></td>
                    <td>${badge(wf.predict_status && wf.predict_status !== "待分析" ? "info" : "quiet", "radar", wf.predict_status || "待分析")}</td>
                    <td class="muted">${esc(wf.predict_rank || "尚未测算名次")} ${wf.predict_note ? `· ${esc(wf.predict_note)}` : ""}</td>
                    <td class="amount"><span class="num">${esc(wf.predict_float_rate || "—")}</span></td>
                    <td><button type="button" class="btn btn-sm btn-ghost" data-lc-step="6">分析预测</button></td>
                  </tr>
                  <tr style="${viewStep === 7 ? "background:var(--accent-soft);" : ""}">
                    <td><strong>7. 签合同 / 退保证金</strong></td>
                    <td>
                      ${badge(out.final_result === "中标" ? "good" : out.final_result === "未中标" ? "warn" : "quiet", "check", out.final_result || "结果待定")}
                      ${finSum.depositOutstandingFen > 0 ? badge("danger", "alert", `待退保 ${fmtFen(finSum.depositOutstandingFen)}`) : wf.refund_track_status === "保证金已全额退回" ? badge("good", "check", "保证金已退回") : ""}
                    </td>
                    <td class="muted">合同：${esc(out.contract_status || "未签署")} · 退保进度：${esc(wf.refund_track_status || "未进入退保")} ${out.handover_to ? `· 移交：${esc(out.handover_to)}` : ""}</td>
                    <td class="amount"><span class="num">${out.award_amount_fen ? esc(fmtFen(out.award_amount_fen)) : finSum.depositOutstandingFen > 0 ? `待退 ${esc(fmtFen(finSum.depositOutstandingFen))}` : "—"}</span></td>
                    <td><button type="button" class="btn btn-sm btn-ghost" data-lc-step="7">结果/退保</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <!-- 折叠式 21 项合规自检（默认折叠不占首屏） -->
        <details class="cockpit-accordion">
          <summary>
            <span>标段 21 项废标与合规自检清单（点击展开核对）</span>
            <span class="muted" style="font-size:11.5px;font-weight:400;">规则提取 + 人工核实 ▾</span>
          </summary>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
            <select id="chk-company" class="select" aria-label="选择对照参投公司">
              <option value="">不限定公司（仅按公告核对）</option>
              ${state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}
            </select>
            <button class="btn btn-sm btn-primary" id="btn-load-checks" type="button">载入 21 项自检清单</button>
          </div>
          <div id="checks-container" class="muted">点击上方「载入 21 项自检清单」展开逐项核对。</div>
        </details>
      </div>

      <!-- 右侧吸顶参谋栏：边填左侧表单、边查官方原文/快照/AI/预估成交价/提醒，零来回滚动 -->
      <aside class="cockpit-rail" aria-label="项目随行参谋与原文对照栏">
        <div class="cockpit-rail-tabs" role="tablist">
          <button type="button" class="cockpit-rail-tab active" data-rail-tab="doc">原文</button>
          <button type="button" class="cockpit-rail-tab" data-rail-tab="ai">AI/估价</button>
          <button type="button" class="cockpit-rail-tab" data-rail-tab="qual">附件资质</button>
          <button type="button" class="cockpit-rail-tab" data-rail-tab="alerts">提醒${openAlertCnt > 0 ? `(${openAlertCnt})` : ""}</button>
        </div>
        <div class="cockpit-rail-body">
          <div id="rail-pane-doc">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
              <strong style="font-size:12.5px;">官方公告原文（对照填表）</strong>
              <button type="button" class="btn btn-sm" id="btn-load-snap-inline">原排版快照</button>
            </div>
            <div id="official-doc-host">${formatOfficialNoticeHtml(d.body)}</div>
          </div>

          <div id="rail-pane-ai" style="display:none;">
            ${renderEstimatedDealPriceCard(edp)}
            <div style="margin-bottom:10px;">
              <strong style="font-size:12.5px;display:block;margin-bottom:6px;">AI 辅助解读与废标排查</strong>
              <div class="chips" style="margin:0 0 8px;">
                <button type="button" class="chip" data-ai-quick="请对照公告原文列出潜在废标风险点，原文未载项明确标为「未标注」。">梳理废标风险点</button>
                <button type="button" class="chip" data-ai-quick="请对照公告原文整理企业资质、项目经理及业绩要求清单，原文未载项标为「未标注」。">整理资质清单</button>
                <button type="button" class="chip" data-ai-quick="请提取本公告中保证金金额、收款户名、账号、开户行及截止时间。">提取保证金账户</button>
              </div>
              <form id="lot-ai-form" class="filter-bar">
                <input id="lot-ai-input" class="input" placeholder="针对本标段提问…" style="flex:1;min-width:140px;" />
                <button type="submit" class="btn btn-primary btn-sm" id="lot-ai-send">问 AI</button>
              </form>
              <div id="lot-ai-out" style="margin-top:8px;"></div>
            </div>
          </div>

          <div id="rail-pane-qual" style="display:none;">
            <strong style="font-size:12.5px;display:block;margin-bottom:6px;">资格硬门槛摘录</strong>
            <div style="margin-bottom:12px;">
              ${d.qualifications?.length ? d.qualifications.map((q) => `<div style="padding:5px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:5px;font-size:12px;">• ${esc(q)}</div>`).join("") : `<div class="muted">原文未提取到单独资质条款，请查看「原文」标签。</div>`}
            </div>
            <strong style="font-size:12.5px;display:block;margin-bottom:6px;">官方公告附件（${(d.attachments || []).length}）</strong>
            ${(d.attachments || []).length ? d.attachments.map((att, idx) => {
              const cached = (lc.cachedAttachments || []).find((c) => Number(c.attIdx) === idx);
              return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:5px;font-size:12px;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(att.name || `附件${idx + 1}`)}</span>
                ${cached ? `<a class="btn btn-sm" href="/api/notice-attachments/${esc(cached.id)}" target="_blank">查看</a>` : `<a class="btn btn-sm" href="${esc(att.url)}" target="_blank" rel="noopener">原链</a>`}
              </div>`;
            }).join("") : `<div class="muted">本公告无附带下载附件。</div>`}
          </div>

          <div id="rail-pane-alerts" style="display:none;">
            <strong style="font-size:12.5px;display:block;margin-bottom:6px;">关联提醒与待办（${(d.alerts || []).length}）</strong>
            ${(d.alerts || []).length ? d.alerts.map((a) => {
              const canConfirm = !a.assigneeId || a.assigneeId === state.user.id;
              return `<div style="padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:6px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                  <strong>${esc(a.title)}</strong>
                  ${a.status === "open" ? `<button class="btn btn-sm btn-primary" data-confirm-alert="${esc(a.id)}" ${canConfirm ? "" : "disabled"}>确认</button>` : badge("good", "check", a.status === "done" ? "已确认" : "已清除")}
                </div>
                <div class="muted" style="margin-top:3px;">${esc(a.detail)}</div>
              </div>`;
            }).join("") : `<div class="muted" style="margin-bottom:12px;">暂无关联提醒。</div>`}

            ${(d.timeline || []).length ? `
              <strong style="font-size:12.5px;display:block;margin:10px 0 6px;">项目全周期时间线（${d.timeline.length}）</strong>
              ${d.timeline.map((t) => `<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;">
                ${stageBadge(t.stage, t.stageLabel)}
                <a href="/opportunities/${esc(t.id)}" data-jump="${esc(t.id)}" style="margin-left:4px;">${esc(t.title)}</a>
                <div class="muted" style="font-size:11px;">${esc(fmtBeijing(t.published))}</div>
              </div>`).join("")}
            ` : ""}
          </div>
        </div>
      </aside>
      </div>
        ` : ""}
      </div>

      ${!isProjectView ? `
      <div class="wb-layout">
        <div>
          ${d.alerts?.length ? `
            <div class="card" style="padding:12px 14px;">
              <div class="card-head" style="margin-bottom:8px;">
                <h3>本标段关联提醒与待办（${d.alerts.length}）</h3>
                <a href="/projects" data-go="/projects" class="btn btn-sm">进入项目库</a>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                ${d.alerts.map((a) => {
                  const canConfirm = !a.assigneeId || a.assigneeId === state.user.id;
                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);flex-wrap:wrap;">
                      <div>
                        ${a.kind === "amendment" ? badge("danger", "alert", "更正变更") : a.kind === "deadline" ? badge("warn", "clock", "临近截止") : badge("info", "file", "待办")}
                        <strong style="font-size:13px;margin-left:6px;">${esc(a.title)}</strong>
                        <div class="muted">${esc(a.detail)} · ${a.assigneeName ? `责任人：${esc(a.assigneeName)} · ` : ""}${a.status === "open" ? "待确认" : a.status === "done" ? "本人已确认" : "已作废（历史保留）"}</div>
                      </div>
                      ${a.status === "open" ? `
                        <button class="btn btn-sm btn-primary" data-confirm-alert="${esc(a.id)}" ${canConfirm ? "" : "disabled"}>${canConfirm ? "本人确认" : "不可代确认"}</button>
                      ` : badge("good", "check", a.status === "done" ? "本人已确认" : "已作废")}
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          ` : ""}

          ${renderNoticeEvidence(d.evidence, id)}

          ${d.checklist?.length ? `
            <div class="card">
              <div class="card-head"><h3>结构化核对要点</h3><span class="prov prov-auto">自动提取值</span></div>
              ${d.checklist.map((g) => `
                <details style="margin-bottom:6px;">
                  <summary style="cursor:pointer;font-weight:600;font-size:13px;padding:4px 0;">${esc(g.dim)}（${(g.items || []).length} 条）</summary>
                  <ul style="margin:4px 0 0;padding-left:18px;font-size:13px;">
                    ${(g.items || []).slice(0, 15).map((it) => `<li>${esc(typeof it === "string" ? it : it.text)}</li>`).join("")}
                  </ul>
                </details>
              `).join("")}
            </div>
          ` : ""}

          ${isProjectView ? `` : `
            <div class="split-pane">
              <div class="card" style="margin-bottom:0;">
                <div class="card-head">
                  <h2>官方公告原文（公文排版）</h2>
                  <div class="meta-row">
                    <button type="button" class="btn btn-sm" id="btn-load-snap-inline">加载官方网页原排版快照</button>
                    <a class="btn btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">打开官方原页面 ${ICONS.ext}</a>
                  </div>
                </div>
                ${d.originalStatus !== "captured" || !d.body ? `
                  <div class="notice-box warn" role="status">
                    ${ICONS.info}
                    <div><strong>原文暂未完整缓存（状态：${esc(d.originalStatus || "uncached")}）：</strong>请点击「加载官方网页原排版快照」或「打开官方原页面」核验。</div>
                  </div>
                ` : `<div id="official-doc-host" style="max-height:640px;overflow:auto;">${formatOfficialNoticeHtml(d.body)}</div>`}
              </div>

              <!-- AI 辅助解读与草稿（通过服务端 /api/ai/chat 代理，前端不接触密钥） -->
              <div class="card" style="margin-bottom:0;">
                <div class="card-head">
                  <h2>AI 辅助解读与草稿（待人工核实）</h2>
                  <span class="prov prov-auto">AI 辅助草稿 · 待审</span>
                </div>
                <p class="muted" style="margin:0 0 8px;">仅基于本公告已抓取原文辅助梳理，不编造原文未载内容；输出均须人工对照官方原文复核。</p>
                <div class="chips" style="margin:0 0 10px;">
                  <button type="button" class="chip" data-ai-quick="请对照公告原文列出潜在废标风险点，原文未载项明确标为「未标注」。">梳理废标风险点</button>
                  <button type="button" class="chip" data-ai-quick="请对照公告原文整理企业资质、项目经理及业绩要求清单，原文未载项标为「未标注」。">整理资质与业绩清单</button>
                  <button type="button" class="chip" data-ai-quick="请基于公告原文起草投标文件章节大纲草稿（标注待审）。">生成投标大纲草稿</button>
                </div>
                <form id="lot-ai-form" class="filter-bar">
                  <input id="lot-ai-input" class="input" placeholder="输入针对本标段的问题（由服务端代理调用 TokenHub）" style="flex:1;min-width:180px;" />
                  <button type="submit" class="btn btn-primary" id="lot-ai-send">发送</button>
                </form>
                <div id="lot-ai-out" style="margin-top:10px;"></div>
              </div>
            </div>
          `}

          ${d.amendmentDiff?.items?.length ? `
            <div class="card">
              <div class="card-head">
                <h3>更正关键字段差异对比（${esc(d.amendmentDiff.direction)}）</h3>
                <a class="btn btn-sm" href="/opportunities/${esc(d.amendmentDiff.comparedId)}" data-jump="${esc(d.amendmentDiff.comparedId)}">查看对照版本</a>
              </div>
              <div class="table-wrap">
                <table class="tbl">
                  <thead><tr><th>对比维度</th><th>对照版本（${esc(d.amendmentDiff.comparedStageLabel)}）</th><th>当前版本</th><th>变更状态</th></tr></thead>
                  <tbody>
                    ${d.amendmentDiff.items.map((it) => `
                      <tr style="${it.changed ? "background:var(--warn-bg);" : ""}">
                        <td><strong>${esc(it.field)}</strong></td>
                        <td class="muted">${esc(it.base)}</td>
                        <td><strong>${esc(it.curr)}</strong></td>
                        <td>${it.changed ? badge("warn", "alert", "已变更") : badge("quiet", "check", "未变")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ""}

          ${(d.timeline || []).length > 1 ? `
            <div class="card">
              <div class="card-head"><h3>同项目公告版本与更正并排差异对比</h3><span class="prov prov-raw">保留历史版本</span></div>
              <div class="table-wrap">
                <table class="tbl">
                  <thead><tr><th>阶段</th><th>公告标题</th><th>发布时间</th><th>截止时间</th><th class="amount">预算表述</th></tr></thead>
                  <tbody>
                    ${d.timeline.map((t) => `
                      <tr style="${t.isCurrent ? "background:var(--accent-soft);" : ""}">
                        <td>${stageBadge(t.stage, t.stageLabel)}</td>
                        <td><a href="/opportunities/${esc(t.id)}" data-jump="${esc(t.id)}"><strong>${esc(t.title)}</strong></a></td>
                        <td class="muted num">${esc(fmtBeijing(t.published))}</td>
                        <td class="muted num">${esc(t.deadlineText ? t.deadlineText + " 北京时间" : "未标注")}</td>
                        <td class="amount muted num">${esc(t.budgetText || "未标注")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ""}
        </div>

        <!-- 关联对象侧栏（采购方画像、公司、标段、时间线、来源核验、附件） -->
        <aside aria-label="关联对象">
          ${d.buyerIntel ? `
            <div class="card">
              <div class="card-head">
                <h3>采购方画像与发标规律</h3>
                <a class="btn btn-sm" href="/entities?kind=tenderer&name=${encodeURIComponent(d.buyerIntel.tenderer)}" data-go="/entities?kind=tenderer&name=${encodeURIComponent(d.buyerIntel.tenderer)}">企查画像</a>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
                <div><span class="muted">采购主体：</span><strong>${esc(d.buyerIntel.tenderer)}</strong></div>
                <div class="meta-row">
                  <span class="prov num">累计公告 ${d.buyerIntel.totalNotices}</span>
                  <span class="prov num">招标 ${d.buyerIntel.tenderCount}</span>
                  <span class="prov num">中标结果 ${d.buyerIntel.resultCount}</span>
                  <span class="prov num">更正 ${d.buyerIntel.amendmentCount}</span>
                </div>
                <div><span class="muted">累计公开预算：</span><span class="num">${Number(d.buyerIntel.totalBudgetYuan) > 0 ? esc(fmtYuan(d.buyerIntel.totalBudgetYuan)) : "未标注"}</span></div>
                ${d.buyerIntel.topAgencies?.length ? `
                  <div>
                    <span class="muted">常合作代理机构：</span>
                    <div class="meta-row" style="margin-top:4px;">
                      ${d.buyerIntel.topAgencies.map((ag) => `<a class="chip" href="/entities?kind=agency&name=${encodeURIComponent(ag.name)}" data-go="/entities?kind=agency&name=${encodeURIComponent(ag.name)}">${esc(ag.name)} (${ag.cnt})</a>`).join("")}
                    </div>
                  </div>
                ` : ""}
                ${d.buyerIntel.recentNotices?.length ? `
                  <div style="border-top:1px solid var(--border);padding-top:8px;">
                    <div class="muted" style="margin-bottom:4px;">该业主近期其他项目：</div>
                    ${d.buyerIntel.recentNotices.slice(0, 3).map((rn) => `
                      <div style="margin-bottom:4px;">
                        <a href="/opportunities/${esc(rn.id)}" data-jump="${esc(rn.id)}" style="font-size:12px;display:block;">${esc(rn.title)}</a>
                        <span class="muted" style="font-size:11px;">${esc(rn.stageLabel)} · ${esc(rn.budgetText || "详见原文")}</span>
                      </div>
                    `).join("")}
                  </div>
                ` : ""}
                ${d.buyerIntel.recentResults?.length ? `
                  <div style="border-top:1px solid var(--border);padding-top:8px;">
                    <div class="muted" style="margin-bottom:4px;">该业主近期中标公示参考（${d.buyerIntel.recentResults.length}）：</div>
                    ${d.buyerIntel.recentResults.map((rr) => `
                      <div style="margin-bottom:6px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
                        <a href="/opportunities/${esc(rr.id)}" data-jump="${esc(rr.id)}" style="font-size:12px;display:block;font-weight:600;">${esc(rr.title)}</a>
                        <div class="muted" style="font-size:11px;">中标人：<strong>${esc(rr.winner)}</strong> · 控制价/预算：${esc(rr.budgetText)}</div>
                      </div>
                    `).join("")}
                  </div>
                ` : ""}
              </div>
            </div>
          ` : ""}

          <div class="card">
            <div class="card-head">
              <h3>区域与业主历史中标下浮率参照</h3>
              <a class="btn btn-sm" href="/review" data-go="/review">复盘与统计中心</a>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
              <div><span class="muted">细化所属县/区：</span><strong>${esc(lc.localFloatBenchmark?.district || d.region || "盐城市")}</strong></div>
              <div><span class="muted">该县/区历史平均中标下浮率：</span><strong style="color:var(--accent);">${lc.localFloatBenchmark?.districtAvgFloatPct !== null && lc.localFloatBenchmark?.districtAvgFloatPct !== undefined ? `${lc.localFloatBenchmark.districtAvgFloatPct}%（${lc.localFloatBenchmark.districtSampleCount} 个配对项目）` : "暂无配对样本"}</strong></div>
              <div><span class="muted">该招标人历史平均中标下浮率：</span><strong style="color:var(--accent);">${lc.localFloatBenchmark?.tendererAvgFloatPct !== null && lc.localFloatBenchmark?.tendererAvgFloatPct !== undefined ? `${lc.localFloatBenchmark.tendererAvgFloatPct}%（${lc.localFloatBenchmark.tendererSampleCount} 个配对项目）` : "暂无该单位配对样本"}</strong></div>
            </div>
          </div>

          ${isProjectView ? `
            <div class="card" style="border-color:rgba(0,82,217,0.35);background:linear-gradient(180deg,rgba(0,82,217,0.03),var(--surface));">
              <div class="card-head">
                <h3 style="color:var(--accent);">AI 推荐下浮率与报价策略</h3>
                <button type="button" class="btn btn-sm btn-primary" id="btn-ai-float-rec">一键 AI 测算推荐</button>
              </div>
              <div id="ai-float-rec-box" style="font-size:13px;display:flex;flex-direction:column;gap:8px;">
                <div class="muted">综合同县/区（${esc(lc.localFloatBenchmark?.district || d.region || "盐城市")}）、同公告类型、同控制价体量与同招标人历史真实配对数据，由 AI 造价顾问生成本标段「保守 / 推荐中枢 / 激进」三档下浮率与策略建议。</div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h3>项目库跟进关联信息</h3></div>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
                <div><span class="muted">关联项目键：</span><span>${esc(d.projectKey || "未标注")}</span></div>
                <div><span class="muted">当前责任人：</span><span>${esc(d.follow?.assigneeName || "待指定")}</span></div>
                <div><span class="muted">拟派建造师：</span><span>${esc(wf.prep_pm_name || "待在阶段 2 绑定")}</span></div>
              </div>
            </div>
          ` : ""}

          <div class="card">
            <div class="card-head"><h3>项目时间线与更正</h3><span class="prov num">${(d.timeline || []).length} 条</span></div>
            ${(d.timeline || []).length > 1 ? `
              <div class="timeline">
                ${d.timeline.map((t) => `
                  <div class="tl-node ${t.isAmendment ? "amend" : ""} ${t.isCurrent ? "current" : ""}" data-jump="${esc(t.id)}">
                    <div class="meta-row" style="margin-bottom:4px;">
                      ${stageBadge(t.stage, t.stageLabel)}
                      ${t.isAmendment ? badge("danger", "alert", "新增变更") : ""}
                      ${t.isCurrent ? badge("info", "info", "当前查看") : ""}
                    </div>
                    <div style="font-size:13px;font-weight:600;">${esc(t.title)}</div>
                    <div class="muted num">${esc(fmtBeijing(t.published))}</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted">暂未检索到同项目的其他阶段公告；如后续出现更正、答疑、结果或流标公告，将自动归入此时间线。</div>`}
          </div>

          <div class="card">
            <div class="card-head"><h3>来源与核验信息</h3></div>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
              <div><span class="muted">官方来源：</span><strong>${esc(d.source)}</strong></div>
              <div><span class="muted">采集状态：</span>${!src ? badge("quiet", "info", "未标注") : srcBad ? badge("warn", "alert", `异常（${src.reason || "受限"}）`) : badge("good", "check", "正常")}</div>
              ${srcBad && src.lastError ? `<div class="notice-box warn" style="margin:0;padding:8px;font-size:12px;"><span>${esc(src.lastError)}</span></div>` : ""}
              <div><span class="muted">最近更新时间：</span><span class="num">${esc(d.sourceUpdatedAt ? d.sourceUpdatedAt + " 北京时间" : fmtBeijing(d.syncMeta?.observedAt))}</span></div>
              <div><span class="muted">官方原文入口：</span><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all;">${esc(d.url)}</a></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>官方公告附件</h3>
              <div class="meta-row">
                <span class="prov num">${(d.attachments || []).length} 个</span>
                ${(d.attachments || []).length ? `<button type="button" class="btn btn-sm" id="btn-cache-notice-atts">一键归档附件</button>` : ""}
              </div>
            </div>
            ${(d.attachments || []).length ? `
              <ul style="margin:0;padding-left:16px;font-size:13px;display:flex;flex-direction:column;gap:8px;">
                ${d.attachments.map((a, idx) => {
                  const cached = (lc.cachedAttachments || []).find((c) => Number(c.attIdx) === idx);
                  return `
                    <li>
                      <div style="font-weight:500;">${esc(a.name || `公告附件 #${idx + 1}`)}</div>
                      <div class="meta-row" style="margin-top:3px;">
                        ${cached ? `
                          ${badge("good", "check", `已归档 · 保留至 ${String(cached.expiresAt || "").slice(0, 10)}`)}
                          <button type="button" class="quick-pill" data-preview-natt="${esc(cached.id)}" data-fname="${esc(cached.filename)}">预览原件</button>
                          <a class="quick-pill" href="/api/notice-attachments/${encodeURIComponent(cached.id)}?download=1" download="${esc(cached.filename)}">下载原件</a>
                        ` : `<span class="prov">可点击上方「一键归档附件」保存副本</span>`}
                        <a class="quick-pill" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">官方源链 ${ICONS.ext}</a>
                      </div>
                    </li>
                  `;
                }).join("")}
              </ul>
            ` : `<div class="muted">当前页面未解析到公开直链附件；部分交易平台需持 CA 锁在原站下载招标文件。</div>`}
          </div>
        </aside>
      </div>
      ` : ""}
      </div>
    `;

    const switchRailTab = (key) => {
      slot.querySelectorAll("[data-rail-tab]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-rail-tab") === key));
      ["doc", "ai", "qual", "alerts"].forEach((k) => {
        const el = slot.querySelector(`#rail-pane-${k}`);
        if (el) el.style.display = k === key ? "" : "none";
      });
    };
    slot.querySelectorAll("[data-rail-tab]").forEach((b) => b.addEventListener("click", () => switchRailTab(b.getAttribute("data-rail-tab"))));
    slot.querySelectorAll("[data-rail-jump]").forEach((b) => b.addEventListener("click", () => switchRailTab(b.getAttribute("data-rail-jump"))));
    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));

    slot.querySelectorAll("[data-jump]").forEach((el) => el.addEventListener("click", () => navigate("/opportunities/" + el.getAttribute("data-jump"))));
    slot.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); navigate(el.getAttribute("data-go")); }));
    slot.querySelector("#btn-proj-abandon")?.addEventListener("click", (e) => {
      openRiskDialog({
        title: "放弃参投 / 移出项目库",
        targetLabel: d.title,
        riskWarning: "放弃后该项目将移出项目库（标记为不参与），并自动关闭关联未处理提醒；已登记的历史流水与审计记录将完整保留。",
        confirmLabel: "确认放弃并移出",
        requireReason: true,
        reasonLabel: "放弃原因（如：资质不符 / 控制价偏低 / 人员锁证冲突）",
        danger: true,
        triggerEl: e.currentTarget,
        onConfirm: async (reason) => {
          await api(`/opportunities/${id}/follow`, { decision: "declined", assigneeId: null, note: `放弃参投：${reason}` });
          showToast("已放弃该项目并移出项目库。");
          navigate("/projects");
        },
      });
    });

    slot.querySelector("#lc-hub")?.addEventListener("input", () => { state.formDirty = true; });
    slot.querySelector("#lc-hub")?.addEventListener("change", () => { state.formDirty = true; });
    slot.querySelector("#lc-hub")?.addEventListener("submit", () => { state.formDirty = false; });

    // 7-stage lifecycle step switcher, COS upload, auto-calc prediction & form submission
    slot.querySelectorAll("[data-lc-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextSt = Number(btn.getAttribute("data-lc-step"));
        const doSwitch = () => {
          state.formDirty = false;
          if (!state.lotStepView) state.lotStepView = {};
          state.lotStepView[id] = nextSt;
          renderKeepScroll();
        };
        if (state.formDirty) {
          openConfirmModal({
            title: "当前阶段表单有未保存修改",
            message: "切换阶段将放弃当前表单未保存的改动，确认切换吗？",
            confirmLabel: "放弃并切换阶段",
            danger: true,
            onConfirm: doSwitch,
          });
          return;
        }
        doSwitch();
      });
    });

    slot.querySelectorAll("[data-preview-file]").forEach((b) => {
      b.addEventListener("click", () => openFilePreviewModal(b.getAttribute("data-preview-file"), b.getAttribute("data-fname"), b));
    });

    slot.querySelectorAll("[data-preview-natt]").forEach((b) => {
      b.addEventListener("click", () => {
        const nattId = b.getAttribute("data-preview-natt");
        const fname = b.getAttribute("data-fname") || "attachment.pdf";
        const url = `/api/notice-attachments/${encodeURIComponent(nattId)}`;
        const isPdfOrImg = /\.(pdf|png|jpe?g)$/i.test(fname);
        if (!isPdfOrImg) {
          window.open(`${url}?download=1`, "_blank");
          return;
        }
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" style="max-width:960px;width:92vw;height:86vh;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <h3 style="margin:0;font-size:15px;">公告附件预览 · ${esc(fname)}</h3>
              <div style="display:flex;gap:8px;">
                <a class="btn btn-sm" href="${url}?download=1" download="${esc(fname)}">下载原件</a>
                <button type="button" class="btn btn-sm btn-primary" id="natt-close">关闭</button>
              </div>
            </div>
            <div style="flex:1;min-height:0;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
              <iframe src="${url}" title="${esc(fname)}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#natt-close").addEventListener("click", () => wrap.remove());
      });
    });

    slot.querySelector("#btn-cache-notice-atts")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "正在归档附件…";
      try {
        const res = await api(`/opportunities/${id}/cache-attachments`, {});
        showToast(`附件已归档 ${res.cachedCount || 0}/${res.total || 0} 份，${res.ok ? "正文已提取" : "部分内容仍待核对"}。`);
        renderKeepScroll();
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = "一键归档附件";
      }
    });

    slot.querySelector("#btn-ai-float-rec")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const box = slot.querySelector("#ai-float-rec-box");
      btn.disabled = true;
      btn.textContent = "AI 测算分析中…";
      if (box) box.innerHTML = `<div class="muted">正在匹配同县/区、同公告类型、同控制价体量与同招标人历史配对样本，并由 AI 造价顾问综合研判…</div>`;
      try {
        const res = await api(`/projects/${id}/ai-float-recommend`, {});
        const q = res.quantitative || {};
        const fmtWan = (y) => y > 0 ? `${(y / 10000).toFixed(2)} 万` : "待补控制价";
        if (box) {
          box.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
              <div style="padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);">
                <div class="muted" style="font-size:11px;">保守下浮(P25)</div>
                <div class="num" style="font-size:15px;font-weight:700;">${q.conservativePct ?? "—"}%</div>
                <div class="muted num" style="font-size:11px;">${fmtWan(q.conservativeQuoteYuan)}</div>
              </div>
              <div style="padding:8px;border:1px solid var(--accent);border-radius:var(--radius);background:rgba(0,82,217,0.06);">
                <div style="font-size:11px;color:var(--accent);font-weight:600;">AI 推荐中枢</div>
                <div class="num" style="font-size:16px;font-weight:700;color:var(--accent);">${q.recommendedPct ?? "—"}%</div>
                <div class="muted num" style="font-size:11px;">${fmtWan(q.recommendedQuoteYuan)}</div>
              </div>
              <div style="padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);">
                <div class="muted" style="font-size:11px;">激进冲标(P75)</div>
                <div class="num" style="font-size:15px;font-weight:700;color:var(--warn);">${q.aggressivePct ?? "—"}%</div>
                <div class="muted num" style="font-size:11px;">${fmtWan(q.aggressiveQuoteYuan)}</div>
              </div>
            </div>
            <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);white-space:pre-wrap;line-height:1.6;font-size:12px;">${esc(res.aiAnalysis || "")}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <span class="prov">引擎：${esc(res.aiModel || "量化+AI")}</span>
              <button type="button" class="quick-pill" id="btn-apply-ai-float">一键带入阶段 6 报价预测</button>
            </div>
          `;
          box.querySelector("#btn-apply-ai-float")?.addEventListener("click", () => {
            if (!state.lotStepView) state.lotStepView = {};
            state.lotStepView[id] = 6;
            render().then(() => {
              const ourInp = document.querySelector("#pred-our");
              const flInp = document.querySelector("#pred-float");
              const noteInp = document.querySelector("#pred-note");
              if (ourInp && q.recommendedQuoteYuan > 0) ourInp.value = q.recommendedQuoteYuan;
              if (flInp && q.recommendedPct !== undefined) flInp.value = `下浮 ${q.recommendedPct}%（AI 推荐区间 ${q.conservativePct}%~${q.aggressivePct}%）`;
              if (noteInp) noteInp.value = String(res.aiAnalysis || "").slice(0, 260);
              showToast(`已将 AI 推荐下浮率 ${q.recommendedPct}% 带入阶段 6 预测表单。`);
            });
          });
        }
        btn.disabled = false;
        btn.textContent = "重新测算";
      } catch (err) {
        if (box) box.innerHTML = `<div class="notice-box danger" style="margin:0;">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
        btn.disabled = false;
        btn.textContent = "一键 AI 测算推荐";
      }
    });

    async function runExtractDeposit(silent = false) {
      const btn = slot.querySelector("#btn-ai-extract-deposit");
      const form = slot.querySelector("#lc-push-fin-form");
      const hintEl = slot.querySelector("#dep-auto-hint");
      if (!form) return;
      if (btn && !silent) { btn.disabled = true; btn.textContent = "正在提取保证金信息…"; }
      try {
        const res = await api(`/opportunities/${id}/extract-deposit`, {});
        if (!document.body.contains(form)) return;
        const amtEl = form.querySelector('[name="amountYuan"]');
        const nameEl = form.querySelector('[name="payeeName"]');
        const accEl = form.querySelector('[name="payeeAccount"]');
        const bankEl = form.querySelector('[name="payeeBank"]');
        const dueEl = form.querySelector('[name="dueTime"]');
        const noteEl = form.querySelector('[name="note"]');
        let filledAny = false;
        if (res.amountYuan !== undefined && res.amountYuan !== "" && (!silent || !amtEl.value)) { amtEl.value = res.amountYuan; filledAny = true; }
        if (res.payeeName && (!silent || !nameEl.value)) { nameEl.value = res.payeeName; filledAny = true; }
        if (res.payeeAccount && (!silent || !accEl.value)) { accEl.value = res.payeeAccount; filledAny = true; }
        if (res.payeeBank && (!silent || !bankEl.value)) { bankEl.value = res.payeeBank; filledAny = true; }
        if (res.dueTime) {
          const dt = toDtLocal(res.dueTime);
          if (dt && (!silent || !dueEl.value)) { dueEl.value = dt; filledAny = true; }
        }
        if (res.depositMethod) {
          const sel = form.querySelector('[name="depositMethod"]');
          if (sel && [...sel.options].some((o) => o.value === res.depositMethod)) sel.value = res.depositMethod;
        }
        if (res.note && (!silent || !noteEl.value)) noteEl.value = res.note;
        if (silent) {
          if (filledAny && hintEl) {
            hintEl.innerHTML = `<strong style="color:var(--good);">已从公告原文自动填入保证金要素</strong>，请核对账号与金额后一键推送给财务。`;
          }
        } else {
          state.formDirty = true;
          showToast("已自动填充保证金打款表单，请核对后推送财务。");
        }
      } catch (err) {
        if (!silent) showToast(err.message);
      } finally {
        if (btn && !silent) { btn.disabled = false; btn.textContent = "重新提取保证金信息"; }
      }
    }
    slot.querySelector("#btn-ai-extract-deposit")?.addEventListener("click", () => runExtractDeposit(false));
    if (isProjectView && viewStep === 3 && !(lc.payTasks || []).length) {
      runExtractDeposit(true);
    }

    slot.querySelector("#lc-push-fin-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const companyId = slot.querySelector("#lc-company")?.value || defaultCoId;
      try {
        const res = await api("/finance/pay-tasks", {
          noticeId: id,
          companyId,
          depositMethod: String(fd.get("depositMethod") || ""),
          amountYuan: Number(fd.get("amountYuan") || 0),
          payeeName: String(fd.get("payeeName") || "").trim(),
          payeeAccount: String(fd.get("payeeAccount") || "").trim(),
          payeeBank: String(fd.get("payeeBank") || "").trim(),
          dueTime: String(fd.get("dueTime") || "").replace("T", " "),
          note: String(fd.get("note") || "").trim(),
        });
        state.pendingPayCount = (state.pendingPayCount || 0) + 1;
        showToast(`已推送保证金打款任务给财务（${res.assigneeName || "未指定财务负责人"}），等待财务打款并上传回执。`);
        render();
      } catch (err) { showToast(err.message); }
    });

    slot.querySelectorAll("[data-lot-upload]").forEach((b) => {
      b.addEventListener("click", () => {
        const slotKey = b.getAttribute("data-lot-upload");
        const companyId = slot.querySelector("#lc-company")?.value || defaultCoId;
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" style="max-width:520px;">
            <h3 style="margin:0 0 8px;">上传标段文件至腾讯云 COS</h3>
            <p class="muted" style="margin:0 0 12px;font-size:12.5px;">支持点击多选、拖拽文件进入虚线框，或直接按 <kbd>Ctrl+V</kbd> / <kbd>⌘V</kbd> 粘贴截图与文档。</p>
            <div id="lot-uz-host"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
              <button type="button" class="btn" id="lot-uz-cancel">取消</button>
              <button type="button" class="btn btn-primary" id="lot-uz-submit">确认上传</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const uz = attachUniversalDropzone(wrap.querySelector("#lot-uz-host"), {
          multiple: true,
          accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp",
          pasteScope: wrap,
        });
        wrap.querySelector("#lot-uz-cancel").addEventListener("click", () => { uz.destroy(); wrap.remove(); });
        wrap.querySelector("#lot-uz-submit").addEventListener("click", async () => {
          const picked = uz.getFiles();
          if (!picked.length) { showToast("请先选择、拖拽或粘贴至少 1 个文件。"); return; }
          const subBtn = wrap.querySelector("#lot-uz-submit");
          subBtn.disabled = true; subBtn.textContent = `正在上传 (${picked.length})…`;
          try {
            for (const file of picked) {
              const dataBase64 = await fileToBase64(file);
              await api(`/opportunities/${id}/files`, {
                slot: slotKey,
                companyId,
                filename: file.name,
                dataBase64,
              });
            }
            uz.destroy();
            wrap.remove();
            showToast(`已成功加密上传 ${picked.length} 个文件至腾讯云 COS。`);
            render();
          } catch (err) {
            showToast(err.message);
            subBtn.disabled = false; subBtn.textContent = "确认上传";
          }
        });
      });
    });

    slot.querySelector("#btn-jump-21chk")?.addEventListener("click", () => {
      slot.querySelector("#btn-load-checks")?.click();
      slot.querySelector("#checks-container")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    // Quick fill "now" or "announcement deadline" into datetime-local inputs
    slot.querySelectorAll("[data-fill-now]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-fill-now");
        const inp = slot.querySelector(`input[name="${name}"]`);
        if (inp) inp.value = nowDtLocal();
      });
    });
    slot.querySelectorAll("[data-fill-dl]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-fill-dl");
        const inp = slot.querySelector(`input[name="${name}"]`);
        if (inp && dlLocal) inp.value = dlLocal;
      });
    });

    // Rollback progress to an earlier stage
    slot.querySelectorAll("[data-rollback-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetStep = Number(btn.getAttribute("data-rollback-step") || 1);
        openConfirmModal({
          title: `撤回进度至阶段 ${targetStep}`,
          message: "撤回后将切换至该阶段以便重新修改，历史资金流水与上传记录不会丢失。",
          confirmLabel: "确认撤回",
          danger: false,
          onConfirm: async () => {
            await api(`/opportunities/${id}/workflow`, {
              step: targetStep,
              nextStep: targetStep,
              allowRollback: true,
              rollbackOnly: true,
              companyId: slot.querySelector("#lc-company")?.value || defaultCoId,
            });
            state.formDirty = false;
            if (!state.lotStepView) state.lotStepView = {};
            state.lotStepView[id] = targetStep;
            showToast(`已将进度撤回至阶段 ${targetStep}，可直接修改并重新保存。`);
            renderKeepScroll();
          },
        });
      });
    });

    // Stage 3: auto-sync exempt deposit method & inline finance reversal
    slot.querySelector("#lc-dep-method")?.addEventListener("change", (e) => {
      const val = e.target.value;
      const amtInp = slot.querySelector("#lc-dep-amt");
      const stSel = slot.querySelector("#lc-dep-status");
      if (/免缴/.test(val)) {
        if (amtInp) amtInp.value = "0";
        if (stSel) stSel.value = "免缴（已附承诺书）";
      } else if (/保函|保险/.test(val)) {
        if (stSel) stSel.value = "已出保函/保单";
      } else {
        if (stSel) stSel.value = "已汇出待核验";
      }
    });
    slot.querySelectorAll("[data-lc-rev-fin]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openInputModal({
          title: "冲销撤回保证金流水",
          message: "冲销后该笔流水不再计入在途余额，原始记录永久保留供审计。",
          label: "冲销原因（必填）",
          defaultValue: "金额填写有误，冲销重录",
          confirmLabel: "确认冲销",
          danger: true,
          onConfirm: async (reason) => {
            await api(`/finance/${btn.getAttribute("data-lc-rev-fin")}/reverse`, { reason });
            showToast("已冲销该笔保证金流水，可重新登记。");
            renderKeepScroll();
          },
        });
      });
    });

    // Stage 4: quick-append checklist pills into note
    slot.querySelectorAll("[data-append-note]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inp = slot.querySelector("#lc4-note");
        const tag = btn.getAttribute("data-append-note");
        if (!inp || !tag) return;
        const cur = inp.value.trim();
        if (!cur.includes(tag)) inp.value = cur ? `${cur} + ${tag}` : tag;
      });
    });

    // Stage 5: OCR recognition for opening record sheet (PDF or photo)
    slot.querySelector("#btn-lc5-ocr")?.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/pdf,.pdf,image/png,image/jpeg";
      inp.addEventListener("change", async () => {
        const file = inp.files?.[0];
        if (!file) return;
        const out = slot.querySelector("#lc5-ocr-out");
        if (out) {
          out.style.display = "block";
          out.innerHTML = `<div class="notice-box" style="margin:0;">${ICONS.radar}<span>正在对「${esc(file.name)}」执行中文 OCR 识别，请稍候…</span></div>`;
        }
        try {
          const dataBase64 = await readFileAsBase64(file);
          const res = await api("/ocr/extract", { mode: "doc", filename: file.name, dataBase64 });
          if (out) {
            out.innerHTML = `
              <div class="notice-box" style="margin:0;flex-direction:column;align-items:stretch;gap:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <strong>OCR 识别完成（${esc(res.engine)} · ${res.charCount} 字）— 可直接对照下方文字录入唱标报价：</strong>
                  <button type="button" class="btn btn-sm" id="lc5-ocr-close">收起</button>
                </div>
                <textarea class="input" rows="5" readonly style="font-size:12px;">${esc(res.rawText || "未识别到有效文字")}</textarea>
              </div>`;
            out.querySelector("#lc5-ocr-close")?.addEventListener("click", () => { out.style.display = "none"; });
          }
        } catch (err) {
          if (out) out.innerHTML = `<div class="notice-box danger" style="margin:0;">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
        }
      });
      inp.click();
    });

    function wireBidFloatLive(row) {
      const inp = row.querySelector('[data-bk="amountYuan"]');
      const pill = row.querySelector('[data-bk-float]');
      if (inp && pill) {
        const update = () => {
          const amt = Number(inp.value || 0);
          const ctrl = Number(d.budgetYuan || 0);
          const pct = ctrl > 0 && amt > 0 ? (((ctrl - amt) / ctrl) * 100).toFixed(2) : null;
          pill.textContent = pct !== null ? `下浮 ${pct}%` : "待填报价";
          pill.style.color = pct !== null && Number(pct) < 0 ? "var(--danger)" : "";
        };
        inp.addEventListener("input", update);
      }
      row.querySelector("[data-del-bid-row]")?.addEventListener("click", () => {
        const list = slot.querySelector("#lc-bids-list");
        if (list && list.querySelectorAll(".lc-bid-row").length > 1) {
          row.remove();
        } else {
          showToast("至少保留 1 行唱标单位。");
        }
      });
    }
    slot.querySelectorAll(".lc-bid-row").forEach(wireBidFloatLive);

    slot.querySelector("#btn-load-snap-inline")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const host = slot.querySelector("#official-doc-host");
      if (!host) return;
      btn.disabled = true; btn.textContent = "正在拉取官方原排版快照…";
      try {
        const res = await api(`/opportunities/${id}/official-snapshot`);
        if (res.ok && res.html) {
          host.innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:8px;">官方网页快照 · 来源：${esc(res.sourceUrl)}</div><div class="official-doc-paper">${res.html}</div>`;
          btn.textContent = "✓ 已加载官方原排版快照";
        } else {
          showToast(res.message || "暂无法抓取官方网页快照。");
          btn.disabled = false; btn.textContent = "重试加载官方快照";
        }
      } catch (err) {
        showToast(err.message);
        btn.disabled = false; btn.textContent = "重试加载官方快照";
      }
    });

    slot.querySelector("#lc-add-bid-row")?.addEventListener("click", () => {
      const list = slot.querySelector("#lc-bids-list");
      if (!list) return;
      const idx = list.querySelectorAll(".lc-bid-row").length + 1;
      const row = document.createElement("div");
      row.className = "filter-bar lc-bid-row";
      row.innerHTML = `
        <span class="num muted" style="width:24px;">#${idx}</span>
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;"><input type="checkbox" data-bk="valid" checked /> 有效</label>
        <input class="input" data-bk="bidder" placeholder="投标单位名称" style="flex:1;min-width:170px;" />
        <input class="input num" data-bk="amountYuan" type="number" step="0.01" placeholder="唱标报价（元）" style="width:155px;" />
        <span class="prov num" data-bk-float style="min-width:86px;justify-content:center;">待填报价</span>
        <input class="input" data-bk="remark" placeholder="工期/废标原因/备注" style="width:130px;" />
        <button type="button" class="btn btn-ghost btn-sm" data-del-bid-row title="删除该行" style="color:var(--danger);padding:0 6px;">×</button>
      `;
      list.appendChild(row);
      wireBidFloatLive(row);
    });

    function runAutoCalcPred(silent = false) {
      const bids = (opn.bids || []).filter((b) => Number(b.amountYuan) > 0 && b.valid !== false);
      if (!bids.length) {
        if (!silent) showToast("尚未在「阶段 5：开标记录表回传」中录入有效唱标报价，请先录入并保存或手动填写。");
        return;
      }
      const algo = slot.querySelector("#pred-algo")?.value || "trimmed_avg";
      const sorted = [...bids].sort((a, b) => Number(a.amountYuan) - Number(b.amountYuan));
      let trimmed = sorted;
      if (sorted.length >= 5) trimmed = sorted.slice(1, -1);
      const trimmedAvg = trimmed.reduce((s, x) => s + Number(x.amountYuan), 0) / trimmed.length;
      const fullAvg = sorted.reduce((s, x) => s + Number(x.amountYuan), 0) / sorted.length;
      const ctrl = Number(d.budgetYuan || 0) || trimmedAvg;
      let bench = trimmedAvg;
      let algoLabel = sorted.length >= 5 ? "去最高最低算术均价" : "有效标算术均价";
      if (algo === "full_avg") {
        bench = fullAvg;
        algoLabel = "全体有效标算术均价";
      } else if (algo === "ctrl_compound") {
        bench = ctrl * 0.5 + trimmedAvg * 0.5;
        algoLabel = "控制价50%+有效均价50%复合基准";
      }
      const myCoName = state.companies.find((c) => c.id === (slot.querySelector("#lc-company")?.value || defaultCoId))?.name || "本方";
      const myRow = sorted.find((b) => b.bidder.includes(myCoName) || (b.remark || "").includes("我方")) || sorted[0];
      const myQuote = Number(myRow.amountYuan);
      const floatPct = ctrl > 0 ? (((ctrl - myQuote) / ctrl) * 100).toFixed(2) : "0.00";
      const benchFloatPct = ctrl > 0 ? (((ctrl - bench) / ctrl) * 100).toFixed(2) : "0.00";
      const byCloseness = [...sorted].sort((a, b) => Math.abs(Number(a.amountYuan) - bench) - Math.abs(Number(b.amountYuan) - bench));
      const rankIdx = byCloseness.findIndex((b) => b === myRow) + 1;

      slot.querySelector("#pred-our").value = myQuote.toFixed(2);
      slot.querySelector("#pred-bench").value = bench.toFixed(2);
      slot.querySelector("#pred-float").value = `下浮 ${floatPct}%（基准下浮 ${benchFloatPct}%）`;
      slot.querySelector("#pred-rank").value = `基准价接近度第 ${rankIdx} 名（共 ${sorted.length} 家有效标）`;
      slot.querySelector("#pred-note").value = `采用【${algoLabel}】，共 ${sorted.length} 家有效唱标，评标基准价 ${(bench / 10000).toFixed(2)} 万元（下浮 ${benchFloatPct}%），我方报价 ${(myQuote / 10000).toFixed(2)} 万元（下浮 ${floatPct}%，接近度排名 #${rankIdx}）。`;
      if (!silent) showToast(`已按【${algoLabel}】完成基准价、下浮率与接近度排名测算。`);
    }
    slot.querySelector("#btn-auto-calc-pred")?.addEventListener("click", () => runAutoCalcPred(false));
    slot.querySelector("#pred-algo")?.addEventListener("change", () => runAutoCalcPred(false));
    if (isProjectView && viewStep === 6 && !wf.predict_our_quote_fen && !wf.predict_benchmark_fen && (opn.bids || []).some((b) => Number(b.amountYuan) > 0)) {
      runAutoCalcPred(true);
    }

    [1, 2, 3, 4, 5, 6, 7].forEach((sNum) => {
      const form = slot.querySelector(`#lc-form-${sNum}`);
      if (!form) return;
      let nextStepTarget = sNum;
      form.querySelectorAll("[data-adv]").forEach((btn) => {
        btn.addEventListener("click", () => { nextStepTarget = Number(btn.getAttribute("data-adv") || sNum); });
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = Object.fromEntries(fd.entries());
        payload.step = sNum;
        payload.nextStep = nextStepTarget;
        payload.companyId = slot.querySelector("#lc-company")?.value || defaultCoId;
        payload.recordExpense = fd.get("recordExpense") === "1";
        if (sNum === 5) {
          const rows = [...form.querySelectorAll(".lc-bid-row")];
          payload.bids = rows.map((r, i) => ({
            rank: i + 1,
            bidder: r.querySelector('[data-bk="bidder"]')?.value?.trim() || "",
            amountYuan: Number(r.querySelector('[data-bk="amountYuan"]')?.value || 0),
            valid: r.querySelector('[data-bk="valid"]') ? Boolean(r.querySelector('[data-bk="valid"]').checked) : true,
            remark: r.querySelector('[data-bk="remark"]')?.value?.trim() || "",
          })).filter((x) => x.bidder);
        }
        try {
          await api(`/opportunities/${id}/workflow`, payload);
          if (!state.lotStepView) state.lotStepView = {};
          state.lotStepView[id] = nextStepTarget;
          showToast(nextStepTarget > sNum ? `阶段 ${sNum} 已保存，已进入阶段 ${nextStepTarget}。` : `阶段 ${sNum} 跟进记录已保存。`);
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    async function selectProject(decision) {
      // Pressing an already-active decision button retracts it ("按下去有回应，再按能收回")
      if (d.follow?.decision === decision && (decision === "bidding" || decision === "watching")) {
        try {
          await api(`/opportunities/${id}/follow`, { decision: "none" });
          await renderKeepScroll();
          showToast("已撤回选定状态，恢复为未选定。");
        } catch (err) { showToast(err.message); }
        return;
      }
      if (decision === "declined") {
        openRiskDialog({
          title: "标记为「不参与」",
          targetLabel: d.title,
          riskWarning: "标记为不参与后将自动关闭本项目关联的待处理提醒，操作保留审计历史。",
          confirmLabel: "确认不参与",
          onConfirm: async (reason) => {
            await api(`/opportunities/${id}/follow`, { decision: "declined", assigneeId: null, note: reason });
            await renderKeepScroll();
            showToast("已标记为不参与", {
              actionLabel: "撤回",
              onAction: async () => {
                await api(`/opportunities/${id}/follow`, { decision: "none" });
                showToast("已撤回不参与标记。");
                renderKeepScroll();
              },
            });
          },
        });
        return;
      }
      // If setting requireAssigneeOnSelect is OFF (default), select immediately without asking for assignee!
      if (!state.settings.requireAssigneeOnSelect) {
        try {
          const res = await api(`/opportunities/${id}/follow`, { decision, assigneeId: null, note: d.follow?.note || "" });
          if (decision === "bidding") {
            showToast(`已选定参投并转入项目库${res.inferredCompanyName ? `（自动关联：${res.inferredCompanyName}）` : ""}。`);
            navigate("/projects/" + id);
          } else {
            await renderKeepScroll();
            showToast("已加入跟进并归入项目库", {
              actionLabel: "撤回",
              onAction: async () => {
                await api(`/opportunities/${id}/follow`, { decision: "none" });
                showToast("已撤回跟进状态。");
                renderKeepScroll();
              },
            });
          }
        } catch (err) { showToast(err.message); }
        return;
      }
      // Optional assignee modal when enabled in Settings
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3 style="margin:0 0 12px;">${decision === "bidding" ? "选定参投并指定对接人" : "选定跟进并指定对接人"}</h3>
          <form id="sel-assign-form">
            <div class="field">
              <label>对接负责人</label>
              <select class="select" name="assigneeId">
                <option value="">暂不指定</option>
                ${state.employees.map((e) => `<option value="${esc(e.id)}" ${d.follow?.assigneeId === e.id ? "selected" : ""}>${esc(e.name)} (${esc(e.username)})</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>备注（可选）</label><input class="input" name="note" value="${esc(d.follow?.note || "")}" /></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="sa-cancel">取消</button><button type="submit" class="btn btn-primary">确认选定</button></div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#sa-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#sel-assign-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api(`/opportunities/${id}/follow`, { decision, assigneeId: String(fd.get("assigneeId") || "") || null, note: String(fd.get("note") || "") });
          wrap.remove();
          if (decision === "bidding") {
            showToast("已选定参投并加入「项目库」，已为您打开项目库全流程跟进详情页。");
            navigate("/projects/" + id);
          } else {
            showToast("已选定并加入「项目库」。");
            render();
          }
        } catch (err) { showToast(err.message); }
      });
    }

    slot.querySelector("#btn-sel-bid")?.addEventListener("click", () => selectProject("bidding"));
    slot.querySelector("#btn-sel-watch")?.addEventListener("click", () => selectProject("watching"));
    slot.querySelector("#btn-sel-decline")?.addEventListener("click", () => selectProject("declined"));
    slot.querySelectorAll("[data-confirm-alert]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/alerts/${encodeURIComponent(btn.getAttribute("data-confirm-alert"))}/update`, { status: "done" });
          showToast("本人已确认并留痕。");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    // 21-item compliance self-check loader & updater
    async function loadChecks() {
      const box = slot.querySelector("#checks-container");
      const cid = slot.querySelector("#chk-company")?.value || "";
      box.innerHTML = "正在运行 21 项规则核对…";
      try {
        const res = await api(`/opportunities/${id}/checks?companyId=${encodeURIComponent(cid)}`);
        const statusBadge = (s) => s === "conform" ? badge("good", "check", "满足")
          : s === "non_conform" ? badge("danger", "x", "不满足")
          : s === "na" ? badge("quiet", "info", "不适用")
          : badge("quiet", "clock", "未标注");
        box.innerHTML = `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th style="width:95px;">维度</th><th>核对项与自动提取提示</th><th style="width:95px;">核实状态</th><th style="width:175px;">人工核实</th></tr></thead>
              <tbody>
                ${res.checks.map((item) => `
                  <tr>
                    <td><span class="prov">${esc(item.dim)}</span></td>
                    <td>
                      <div style="font-weight:600;font-size:13px;">${esc(item.title)} ${item.severity === "hard" ? `<span class="prov prov-raw">硬门槛</span>` : `<span class="prov">评审项</span>`}</div>
                      <div class="muted" style="${item.autoFlag === "warn" ? "color:var(--danger);" : ""}">${esc(item.autoExcerpt)}</div>
                      ${item.basis ? `<div class="muted"><strong>人工依据：</strong>${esc(item.basis)}（${esc(item.updatedBy)}）</div>` : ""}
                    </td>
                    <td>${statusBadge(item.status)}</td>
                    <td>
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        <button class="btn btn-sm" data-chk-code="${esc(item.code)}" data-chk-st="conform">满足</button>
                        <button class="btn btn-sm btn-danger" data-chk-code="${esc(item.code)}" data-chk-st="non_conform">不满足</button>
                        <button class="btn btn-sm btn-ghost" data-chk-code="${esc(item.code)}" data-chk-st="na">不适用</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
        box.querySelectorAll("[data-chk-code]").forEach((b) => {
          b.addEventListener("click", async () => {
            const code = b.getAttribute("data-chk-code");
            const st = b.getAttribute("data-chk-st");
            const needBasis = st === "non_conform" || st === "na";
            const basis = await promptAsync(needBasis ? "标记为「不满足」或「不适用」必须填写核实依据（留痕）：" : "可选填写核实依据（如证书编号/页码）：");
            if (basis === null) return;
            if (needBasis && !basis.trim()) return;
            try {
              await api(`/opportunities/${id}/checks`, { ruleCode: code, companyId: cid, status: st, basis: basis.trim() });
              showToast("已保存人工核实结果并留痕。");
              loadChecks();
            } catch (err) {
              showToast(err.message);
            }
          });
        });
      } catch (err) {
        box.innerHTML = `<div class="notice-box danger">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
      }
    }
    slot.querySelector("#btn-load-checks")?.addEventListener("click", loadChecks);
    slot.querySelector("#chk-company")?.addEventListener("change", loadChecks);

    // Lot-level AI assistant handler
    async function askLotAi(question) {
      const out = slot.querySelector("#lot-ai-out");
      const btn = slot.querySelector("#lot-ai-send");
      if (!question.trim()) return;
      btn.disabled = true;
      out.innerHTML = `<div class="shimmer-box">正在梳理官方公告原文要点，请稍候…</div>`;
      try {
        const res = await api("/ai/chat", {
          noticeId: id,
          messages: [{ role: "user", content: question.trim() }],
        });
        out.innerHTML = `
          <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
            <div class="meta-row" style="margin-bottom:6px;">
              ${badge("warn", "info", "AI 辅助草稿 · 待人工核实")}
              <span class="muted">模型：${esc(res.model)}</span>
            </div>
            <div class="source-body" style="max-height:360px;background:var(--surface);">${esc(res.content)}</div>
          </div>`;
      } catch (err) {
        out.innerHTML = `<div class="notice-box danger">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
      } finally {
        btn.disabled = false;
      }
    }
    slot.querySelector("#lot-ai-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = slot.querySelector("#lot-ai-input");
      askLotAi(inp.value);
    });
    slot.querySelectorAll("[data-ai-quick]").forEach((c) => {
      c.addEventListener("click", () => {
        const q = c.getAttribute("data-ai-quick");
        slot.querySelector("#lot-ai-input").value = q;
        askLotAi(q);
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>无法读取该标段记录：${esc(err.message)}</span></div>`;
  }
}

// ================= 5. ALERTS CENTER (/alerts) =================
async function renderAlerts(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const kind = qs.get("kind") || "all";
  const status = qs.get("status") || "open";
  const mine = qs.get("mine") || "0";

  const slot = renderShell(root, "alerts", [
    { label: "岗位首页", href: "/" },
    { label: "提醒中心" },
  ], `<div class="card">正在读取站内提醒…</div>`);

  try {
    const data = await api(`/alerts?status=${encodeURIComponent(status)}&kind=${encodeURIComponent(kind)}&mine=${encodeURIComponent(mine)}`);
    if (!isCurrentRender(root)) return;
    const c = data.counts || {};
    state.openAlerts = c.open ?? 0;

    function goFlt(patch) {
      const p = new URLSearchParams({ kind, status, mine, ...patch });
      navigate("/alerts?" + p.toString());
    }

    slot.innerHTML = `
      <div class="notice-box">
        ${ICONS.info}
        <div><strong>提醒规则与渠道说明：</strong>仅针对<strong>已选定标段</strong>的更正变更/临近截止、<strong>已开启订阅方案</strong>的新标命中及<strong>人工派单待办</strong>生成提醒；未选定项目不推送提醒。外部群推送渠道当前状态：<strong>未接入</strong>（站内列表中不显示任何敏感字段）。</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>站内提醒与责任待办</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm ${mine === "1" ? "btn-primary" : ""}" id="btn-mine">仅看指派给本人（${c.mineOpen ?? 0}）</button>
            <select class="select" id="alert-status" aria-label="提醒状态">
              <option value="open" ${status === "open" ? "selected" : ""}>待处理</option>
              <option value="done" ${status === "done" ? "selected" : ""}>已确认</option>
              <option value="dismissed" ${status === "dismissed" ? "selected" : ""}>已归档与作废</option>
            </select>
          </div>
        </div>
        <div class="tabs" style="margin-bottom:0;border-bottom:none;padding-bottom:0;">
          <button class="tab ${kind === "all" ? "active" : ""}" data-k="all">全部 <span class="tab-num" title="待处理数量">${c.open ?? 0}</span></button>
          <button class="tab ${kind === "expiry" ? "active" : ""}" data-k="expiry">资料到期预警 <span class="tab-num">${c.expiry ?? 0}</span></button>
          <button class="tab ${kind === "amendment" ? "active" : ""}" data-k="amendment">更正变更 <span class="tab-num">${c.amendment ?? 0}</span></button>
          <button class="tab ${kind === "deadline" ? "active" : ""}" data-k="deadline">临近截止 <span class="tab-num">${c.deadline ?? 0}</span></button>
          <button class="tab ${kind === "subscription" ? "active" : ""}" data-k="subscription">订阅命中 <span class="tab-num">${c.subscription ?? 0}</span></button>
          <button class="tab ${kind === "todo" ? "active" : ""}" data-k="todo">人工待办 <span class="tab-num">${c.todo ?? 0}</span></button>
        </div>
      </div>

      <div class="card" style="padding:0;">
        ${data.items.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:110px;">类型</th>
                  <th>事项与直达对象</th>
                  <th style="width:140px;">责任人</th>
                  <th style="width:120px;">来源 / 送达</th>
                  <th style="width:180px;">责任确认 / 处置</th>
                </tr>
              </thead>
              <tbody>
                ${data.items.map((a) => {
                  const canConfirm = !a.assigneeId || a.assigneeId === state.user.id;
                  const isExp = a.kind === "expiry";
                  const targetHref = isExp ? `/companies/${encodeURIComponent(a.companyId || "")}` : `/opportunities/${encodeURIComponent(a.noticeId || "")}`;
                  return `
                    <tr>
                      <td>${isExp ? badge(a.tier === "expired" ? "danger" : "warn", "clock", a.tier === "expired" ? "证件已过期" : a.tier === "7d" ? "7天到期" : "30天到期") : a.kind === "amendment" ? badge("danger", "alert", "更正变更") : a.kind === "deadline" ? badge("warn", "clock", "临近截止") : a.kind === "todo" ? badge("info", "file", "人工待办") : badge("info", "bell", "订阅命中")}</td>
                      <td>
                        <a class="row-title" href="${targetHref}" ${isExp ? `data-go="${targetHref}"` : `data-open="${esc(a.noticeId)}"`}>${esc(a.title)}</a>
                        <div class="muted">${esc(a.detail)}</div>
                      </td>
                      <td>
                        <select class="select" style="width:100%;" aria-label="调整责任人" data-assign="${esc(a.id)}">
                          <option value="">待指定</option>
                          ${state.employees.map((e) => `<option value="${esc(e.id)}" ${a.assigneeId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
                        </select>
                      </td>
                      <td>
                        ${badge("quiet", "info", isExp ? "自动巡检" : "站内已生成")}
                        <div class="muted">${esc(isExp ? "资料库 30/7天规则" : "站内实时提醒")}</div>
                      </td>
                      <td>
                        ${a.status === "open" ? `
                          <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button class="btn btn-sm btn-primary" data-confirm="${esc(a.id)}" ${canConfirm ? "" : "disabled"} title="${canConfirm ? "由本人确认核实" : "责任项须由被指派人本人确认，负责人不可代确认"}">${canConfirm ? "本人确认" : "不可代确认"}</button>
                            <button class="btn btn-sm btn-danger" data-dismiss="${esc(a.id)}">作废</button>
                          </div>
                        ` : badge("quiet", "check", a.status === "done" ? "本人已确认" : a.recordedStatus === "open" ? "跟进已结束 · 已归档" : "已作废")}
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state">
            <strong>当前没有${status === "done" ? "已确认" : status === "dismissed" ? "已归档或作废" : "待处理"}的提醒</strong>
          </div>
        `}
      </div>
    `;

    slot.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => goFlt({ kind: b.getAttribute("data-k") })));
    slot.querySelector("#btn-mine").addEventListener("click", () => goFlt({ mine: mine === "1" ? "0" : "1" }));
    slot.querySelector("#alert-status").addEventListener("change", event => goFlt({ status: event.target.value }));
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
    slot.querySelectorAll("[data-assign]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        await api(`/alerts/${encodeURIComponent(sel.getAttribute("data-assign"))}/update`, { assigneeId: sel.value || null });
        showToast("已更新责任人并留痕。");
        render();
      });
    });
    slot.querySelectorAll("[data-confirm]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/alerts/${encodeURIComponent(btn.getAttribute("data-confirm"))}/update`, { status: "done" });
          showToast("本人已确认并记入审计日志。");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    slot.querySelectorAll("[data-dismiss]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reason = await promptAsync("作废提醒属于高风险操作，请填写原因（历史记录将保留，不会删除）：");
        if (!reason || !reason.trim()) return;
        try {
          await api(`/alerts/${encodeURIComponent(btn.getAttribute("data-dismiss"))}/update`, { status: "dismissed", reason: reason.trim() });
          showToast("已作废该提醒，历史记录已保留。");
          render();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>读取提醒中心异常：${esc(err.message)}</span></div>`;
  }
}

// ================= 6. SOURCES HEALTH (/sources) =================
function openAddCustomSourceModal(onSaved) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="添加自定义机会池来源" style="max-width:680px;width:95vw;max-height:90vh;overflow:auto;">
      <h3 style="margin:0 0 6px;">添加公告来源</h3>
      <div class="muted" style="font-size:12.5px;margin-bottom:12px;">
        粘贴公告栏目或单篇公告的网址，系统会识别名称并预览能采到的公告。
      </div>
      <form id="custom-src-form">
        <div class="field">
          <label>公告网址</label>
          <div style="display:flex;gap:8px;">
            <input class="input" name="listUrl" id="cs-url" required placeholder="https://www.example.com/zbgg/" style="flex:1;" />
            <button type="button" class="btn" id="btn-cs-probe">重新探测</button>
          </div>
        </div>
        <div id="cs-probe-out" style="margin-bottom:12px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="field"><label>来源名称（必填）</label><input class="input" name="name" id="cs-name" required placeholder="如：某国企招标采购专栏" /></div>
          <div class="field"><label>归属地区</label><input class="input" name="region" value="盐城市" placeholder="如：盐城市 / 江苏省" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="field"><label>默认行业类型</label><input class="input" name="tradeType" value="工程建设" placeholder="如：工程建设 / 政府采购" /></div>
          <div class="field"><label>关键词过滤（选填，逗号分隔）</label><input class="input" name="keywordFilter" id="cs-kw" placeholder="留空全量采集；如：施工,改造,装修" /></div>
        </div>
        <details style="margin-bottom:12px;">
          <summary class="muted" style="cursor:pointer;font-size:12px;">高级选项：自定义 CSS 链接选择器（一般留空由系统自动识别）</summary>
          <div class="field" style="margin-top:8px;">
            <input class="input" name="linkSelector" id="cs-sel" placeholder="如：.news-list li a（留空自动识别）" />
          </div>
        </details>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn" id="cs-cancel">取消</button>
          <button type="submit" class="btn btn-primary" id="cs-submit">添加并采集</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#cs-cancel").addEventListener("click", () => wrap.remove());

  const probeKey = () => JSON.stringify(["#cs-url", "#cs-kw", "#cs-sel"].map(id => wrap.querySelector(id).value.trim()));
  let lastProbe = "";
  let suggestedName = "";
  wrap.querySelector("#btn-cs-probe").addEventListener("click", async () => {
    const url = wrap.querySelector("#cs-url").value.trim();
    const keywordFilter = wrap.querySelector("#cs-kw").value.trim();
    const linkSelector = wrap.querySelector("#cs-sel").value.trim();
    if (!url) { showToast("请先输入目标公告列表网址。"); return; }
    const requested = probeKey();
    lastProbe = requested;
    const btn = wrap.querySelector("#btn-cs-probe");
    const out = wrap.querySelector("#cs-probe-out");
    btn.disabled = true;
    btn.textContent = "正在探测解析…";
    out.innerHTML = `<div class="notice-box info"><span>正在请求目标页面并尝试自动识别公告列表与公司资质匹配度…</span></div>`;
    try {
      const res = await api("/custom-sources/probe", { url, keywordFilter, linkSelector });
      const nameInp = wrap.querySelector("#cs-name");
      if (!wrap.isConnected || requested !== probeKey()) return;
      if ((!nameInp.value.trim() || nameInp.value === suggestedName) && res.pageTitle) {
        nameInp.value = suggestedName = res.pageTitle.split(/[-_|—]/)[0].trim().slice(0, 36) || res.host;
      }
      const matchHtml = (res.companyMatches || []).length
        ? `<div class="notice-box good" style="margin-bottom:8px;"><span>资质自动匹配命中：${res.companyMatches.map((m) => `<strong>${esc(m.companyName)}</strong>（命中 ${m.matchedCount} 条）`).join("、")}</span></div>`
        : `<div class="muted" style="font-size:12px;margin-bottom:6px;">当前样本标题未触发特定资质词，入池后仍可按关键词与条件筛选。</div>`;
      out.innerHTML = `
        <div class="notice-box ${res.totalFound > 0 ? "good" : "warn"}" style="margin-bottom:8px;">
          <span>探测成功：共识别到 <strong>${res.totalFound}</strong> 条公告链接（站点：${esc(res.host || url)}）。</span>
        </div>
        ${matchHtml}
        ${(res.samples || []).length ? `
          <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;">
            <table class="tbl">
              <thead><tr><th>识别到的公告样本（前 10 条）</th><th style="width:95px;">日期</th></tr></thead>
              <tbody>
                ${res.samples.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></td><td class="muted num">${esc(s.published || "-")}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}
      `;
    } catch (err) {
      if (requested === probeKey()) out.innerHTML = `<div class="notice-box danger"><span>${esc(err.message)}</span></div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "重新探测";
      if (wrap.isConnected && requested !== probeKey()) { out.textContent = ""; autoProbeIfValid(); }
    }
  });
  const autoProbeIfValid = () => {
    const v = wrap.querySelector("#cs-url")?.value?.trim() || "";
    if (/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(v) && probeKey() !== lastProbe && !wrap.querySelector("#btn-cs-probe")?.disabled) {
      wrap.querySelector("#btn-cs-probe")?.click();
    }
  };
  wrap.querySelector("#cs-url")?.addEventListener("paste", () => setTimeout(autoProbeIfValid, 80));
  for (const id of ["#cs-url", "#cs-kw", "#cs-sel"]) wrap.querySelector(id).addEventListener("change", autoProbeIfValid);

  wrap.querySelector("#custom-src-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = wrap.querySelector("#cs-submit");
    const fd = new FormData(e.target);
    btn.disabled = true;
    btn.textContent = "正在添加并采集入池…";
    try {
      const res = await api("/custom-sources", {
        listUrl: String(fd.get("listUrl") || "").trim(),
        name: String(fd.get("name") || "").trim(),
        region: String(fd.get("region") || "盐城市").trim(),
        tradeType: String(fd.get("tradeType") || "工程建设").trim(),
        keywordFilter: String(fd.get("keywordFilter") || "").trim(),
        linkSelector: String(fd.get("linkSelector") || "").trim(),
      });
      wrap.remove();
      showToast(res.ok ? `已添加「${res.name}」，新增 ${res.inserted || 0} 条公告。` : `已保存来源，首次采集未完成。${res.error || ""}`);
      if (typeof onSaved === "function") onSaved(res);
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
      btn.textContent = "添加并采集";
    }
  });
}

async function renderSources(root) {
  const slot = renderShell(root, "sources", [
    { label: "岗位首页", href: "/" },
    { label: "来源与同步核验" },
  ], `<div class="card">正在读取官方数据源核验状态…</div>`);

  try {
    const [data, customData] = await Promise.all([
      api("/sources/health"),
      api("/custom-sources"),
    ]);
    if (!isCurrentRender(root)) return;
    const sm = data.syncMeta || {};
    state.syncMeta = sm;
    const customItems = customData?.items || [];

    const customByKey = new Map(customItems.map(cs => [cs.key, cs]));
    const healthKeys = new Set(data.sources.map(s => s.key));
    const sources = [...data.sources, ...customItems.filter(cs => !healthKeys.has(cs.key))];
    const active = sources.filter(s => s.enabled);
    const bad = s => Boolean(s.failures || s.reason || s.lastError || customByKey.get(s.key)?.last_error);
    const failures = active.filter(bad).length;
    const rows = sources.map(source => {
      const cs = customByKey.get(source.key);
      const problem = source.lastError || cs?.last_error;
      const cv=cs?.coverage;
      const coverageLabel = {complete:"已核实本轮范围",surface_only:"已读列表，历史范围待核",window_pending:"尚有分页待补查",summary_only:"已读目录，正文待取得",partial_error:"部分采集失败"}[cv?.status];
      const status = !source.enabled ? badge("quiet","clock","已暂停")
        : bad(source) ? badge("warn","alert",problem || "本轮采集未完成")
        : cv ? badge(cv.status==="complete" ? "good" : "quiet",cv.status==="complete" ? "check":"clock",coverageLabel || "本轮未完成")
        : Number(source.lastOk) ? badge("quiet","check",cs ? "上次运行完成，范围待核" : "上次同步成功") : badge("quiet","clock","尚未覆盖");
      const toggle = state.user.role === "admin" ? `<button type="button" class="btn btn-sm" data-toggle-src="${esc(source.key)}" data-next-en="${source.enabled ? 0 : 1}">${cs ? (source.enabled ? "暂停采集" : "恢复采集") : (source.enabled ? "暂停同步" : "恢复同步")}</button>` : "";
      return `<tr><td><strong>${esc(source.name)}</strong><div class="muted">${cs ? `<a href="${esc(cs.list_url)}" target="_blank" rel="noopener">打开来源网页</a>` : "平台来源"}</div></td>
        <td>${status}${cv ? `<div class="muted">本轮读到 ${esc(cv.pages_read)} 页${cv.oldest_date && cv.newest_date ? ` · 公告日期 ${esc(cv.oldest_date)} 至 ${esc(cv.newest_date)}` : ""}${cv.status==="complete" && cs.last_count===0 ? " · 已核范围内无新公告" : ""}</div>` : ""}</td><td class="num" data-label="累计入池">${esc(source.noticeCount ?? 0)}</td>
        <td class="num" data-label="最近尝试">${Number(source.checked) ? esc(fmtBeijing(source.checked)) : "暂无记录"}</td>
        <td class="num" data-label="最近成功">${Number(source.lastOk) ? esc(fmtBeijing(source.lastOk)) : "暂无成功记录"}</td>
        <td>${cs && source.enabled ? `<button type="button" class="btn btn-sm" data-run-cs="${esc(cs.id)}">${bad(source) ? "重新采集" : "立即采集"}</button>` : ""} ${toggle}
          ${cs || source.strategy ? `<details><summary>更多</summary>
            ${cs ? `<div class="muted">${esc(cs.region)} · ${esc(cs.trade_type)}</div>${cs.keyword_filter ? `<div>仅收录含 ${esc(cs.keyword_filter)} 的公告</div>` : ""}
            <button type="button" class="btn btn-sm btn-danger" data-del-cs="${esc(cs.id)}" data-del-name="${esc(cs.name)}">移除来源</button>` : esc(source.strategy.strategySummary)}</details>` : ""}
        </td></tr>`;
    }).join("");
    slot.innerHTML = `<div class="card">
      <div class="card-head"><div><h2>公告来源</h2>
        <div class="muted">${active.length} 个来源已启用${failures ? `，${failures} 个本轮采集未完成` : ""}</div></div>
        <button type="button" class="btn btn-primary" id="btn-src-add-custom">添加来源</button></div>
      ${sources.length ? `<div class="table-wrap"><table class="tbl source-list"><thead><tr><th>来源</th><th>采集状态</th>
        <th>累计入池</th><th>最近尝试</th><th>最近成功</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="muted">添加公告网址后，系统会定期采集并更新机会池。</p>'}
      ${Number(sm.observedAt) ? `<p class="muted">上游最近同步于 ${esc(fmtBeijing(sm.observedAt))}，同步公告 ${esc(sm.imported)} 条。</p>` : ""}
      </div>`;

    slot.querySelector("#btn-src-add-custom")?.addEventListener("click", () => {
      openAddCustomSourceModal(() => renderKeepScroll());
    });
    slot.querySelectorAll("[data-run-cs]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-run-cs");
        btn.disabled = true;
        btn.textContent = "采集中…";
        try {
          const res = await api(`/custom-sources/${encodeURIComponent(id)}/run`, {});
          showToast(res.ok ? `本轮读取 ${res.totalFound} 条，新增 ${res.inserted} 条。${res.coverage?.status === "window_pending" ? "其余分页将继续补查。" : ""}` : `本轮未完成。${res.error || "请查看来源状态"}`);
          renderKeepScroll();
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
          btn.textContent = "立即采集";
        }
      });
    });
    slot.querySelectorAll("[data-del-cs]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-del-cs");
        const name = btn.getAttribute("data-del-name") || id;
        openConfirmModal({
          title: "删除自定义采集来源",
          message: `确认删除自定义来源「${name}」？已入池的历史公告将保留，后续不再自动抓取。`,
          confirmLabel: "确认删除",
          danger: true,
          onConfirm: async () => {
            await api(`/custom-sources/${encodeURIComponent(id)}/delete`, {});
            showToast(`已删除自定义来源「${name}」。`);
            renderKeepScroll();
          },
        });
      });
    });
    slot.querySelectorAll("[data-toggle-src]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.getAttribute("data-toggle-src");
        const enabled = btn.getAttribute("data-next-en") === "1";
        try {
          btn.disabled = true;
          await api("/sources/toggle", { key, enabled });
          showToast(enabled ? "已恢复，下一轮生效" : "已暂停，历史公告仍可查看");
          renderKeepScroll();
        } catch (err) { btn.disabled = false; showToast(err.message); }
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>读取来源状态异常：${esc(err.message)}</span></div>`;
  }
}

// ================= 6B. COMPANIES, DOCS & PERSONNEL (/companies, /companies/:id) =================
async function renderCompanies(root) {
  const slot = renderShell(root, "companies", [
    { label: "岗位首页", href: "/" },
    { label: "公司与资料库" },
  ], `<div class="card">正在读取已授权公司档案…</div>`);

  try {
    const list = await api("/companies");
    if (!isCurrentRender(root)) return;
    state.companies = list;
    const canCreate = state.user.role === "admin" || state.user.perspective === "lead";
    const qs = new URLSearchParams(state.route.split("?")[1] || "");
    const forceList = qs.get("all") === "1";

    // Feishu zero-extra-hop experience: clicking "公司与资料库" directly opens the last-viewed (or first) company workspace
    if (!forceList && list.length > 0) {
      const lastCid = localStorage.getItem("br-last-company-id") || "";
      const target = list.find((c) => c.id === lastCid) || list[0];
      return renderCompanyDetail(root, target.id);
    }

    slot.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>参投公司列表（仅显示当前账号已授权公司）</h2>
          ${canCreate ? `<button class="btn btn-primary btn-sm" id="btn-new-co">新建参投公司</button>` : ""}
        </div>
        ${list.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>公司名称</th>
                  <th class="amount">已登记资料</th>
                  <th class="amount">在册人员</th>
                  <th>缺口状态（仅表示登记状态）</th>
                  <th>当前权限</th>
                </tr>
              </thead>
              <tbody>
                ${list.map((c) => `
                  <tr>
                    <td><a class="row-title" href="/companies/${esc(c.id)}" data-open-co="${esc(c.id)}">${esc(c.name)}</a></td>
                    <td class="amount num">${c.docCount} 份</td>
                    <td class="amount num">${c.peopleCount} 人</td>
                    <td>
                      <div class="meta-row">
                        ${c.gapExpired > 0 ? badge("danger", "alert", `已过期 ${c.gapExpired}`) : ""}
                        ${c.gapExpiring > 0 ? badge("warn", "clock", `30天到期 ${c.gapExpiring}`) : ""}
                        ${c.gapMissing > 0 ? badge("warn", "info", `待补 ${c.gapMissing}`) : ""}
                        ${c.gapPending > 0 ? badge("quiet", "clock", `未标注 ${c.gapPending}`) : ""}
                        ${!c.gapExpired && !c.gapExpiring && !c.gapMissing && !c.gapPending ? badge("quiet", "info", c.docCount ? "暂无缺口提示" : "尚未登记") : ""}
                      </div>
                    </td>
                    <td class="muted">查看${c.edit ? " · 编辑" : ""}${c.verify ? " · 核实" : ""}${c.sensitiveDownload ? " · 敏感下载" : " · 敏感下载无权限"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state">
            <strong>当前账号暂无可见公司档案</strong>
            <div>未登记不代表不符合。${canCreate ? "可点击右上角「新建参投公司」开始建档，或在「账号与授权」中分配公司权限。" : "请联系管理员在「账号与授权」为您配置公司查看权限。"}</div>
          </div>
        `}
      </div>
    `;

    slot.querySelectorAll("[data-open-co]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/companies/" + a.getAttribute("data-open-co")); }));
    slot.querySelector("#btn-new-co")?.addEventListener("click", async () => {
      const name = await promptAsync("请输入新参投公司全称：");
      if (!name || !name.trim()) return;
      try {
        await api("/companies", { name: name.trim() });
        showToast("已创建参投公司并授予当前账号权限。");
        render();
      } catch (err) {
        showToast(err.message);
      }
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("未选择文件"));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("文件大小不能超过 10MB"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取本地文件失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadCompanyFile(cid, ownerType, ownerId, file) {
  const dataBase64 = await readFileAsBase64(file);
  return api(`/companies/${encodeURIComponent(cid)}/files`, {
    ownerType,
    ownerId,
    filename: file.name || "document.pdf",
    mimeType: file.type || "application/pdf",
    dataBase64,
  });
}

function openFilePreviewModal(fileId, fileName, triggerEl) {
  const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName || "");
  const url = `/api/files/${encodeURIComponent(fileId)}`;
  let scale = 1;
  let rot = 0;
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="原件在线预览" style="max-width:1020px;width:94vw;height:88vh;padding:0;display:flex;flex-direction:column;overflow:hidden;">
      <div class="lb-toolbar">
        <h3 style="margin:0;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:160px;">${esc(fileName || "原件预览")}</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${isImage ? `
            <button type="button" class="btn btn-sm" id="lb-zoom-out">缩小</button>
            <button type="button" class="btn btn-sm" id="lb-zoom-reset">100%</button>
            <button type="button" class="btn btn-sm" id="lb-zoom-in">放大</button>
            <button type="button" class="btn btn-sm" id="lb-rotate">旋转 90°</button>
          ` : ""}
          <a class="btn btn-sm" href="${url}" target="_blank" rel="noopener noreferrer">新窗口</a>
          <a class="btn btn-sm" href="${url}?download=1" download="${esc(fileName || "document.pdf")}">下载原件</a>
          <button type="button" class="btn btn-sm btn-primary" id="fp-close">关闭</button>
        </div>
      </div>
      <div class="lb-stage">
        ${isImage
          ? `<img id="lb-img" src="${url}" alt="${esc(fileName || "附件预览")}" />`
          : `<iframe src="${url}" title="${esc(fileName || "PDF 预览")}" style="width:100%;height:100%;min-height:70vh;border:0;background:#fff;border-radius:6px;"></iframe>`}
      </div>
    </div>`;
  const close = mountDialog(wrap, { initial: "#fp-close", trigger: triggerEl, onEscape: () => close() });
  const imgEl = wrap.querySelector("#lb-img");
  const applyTransform = () => {
    if (imgEl) imgEl.style.transform = `scale(${scale}) rotate(${rot}deg)`;
    const rst = wrap.querySelector("#lb-zoom-reset");
    if (rst) rst.textContent = `${Math.round(scale * 100)}%`;
  };
  wrap.querySelector("#lb-zoom-in")?.addEventListener("click", () => { scale = Math.min(3, +(scale + 0.25).toFixed(2)); applyTransform(); });
  wrap.querySelector("#lb-zoom-out")?.addEventListener("click", () => { scale = Math.max(0.5, +(scale - 0.25).toFixed(2)); applyTransform(); });
  wrap.querySelector("#lb-zoom-reset")?.addEventListener("click", () => { scale = 1; rot = 0; applyTransform(); });
  wrap.querySelector("#lb-rotate")?.addEventListener("click", () => { rot = (rot + 90) % 360; applyTransform(); });
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector("#fp-close").addEventListener("click", close);
}

async function renderCompanyDetail(root, cid) {
  const slot = renderShell(root, "companies", [
    { label: "岗位首页", href: "/" },
    { label: "公司与资料库" },
  ], `<div class="ws-sheet" aria-busy="true" aria-label="正在加载公司资料"><div class="ws-sec"><div class="skeleton-bar" style="width:35%;"></div></div><div class="ws-sec"><div class="skeleton-row"><div class="skeleton-bar" style="width:45%;"></div><div class="skeleton-bar" style="width:20%;"></div><div class="skeleton-bar" style="width:20%;"></div></div></div></div>`);

  try {
    const [data, allCompanies] = await Promise.all([
      api("/companies/" + encodeURIComponent(cid)),
      state.companies?.length ? Promise.resolve(state.companies) : api("/companies").catch(() => []),
    ]);
    if (!isCurrentRender(root)) return;
    try { localStorage.setItem("br-last-company-id", cid); } catch {}
    if (allCompanies?.length) state.companies = allCompanies;
    const canCreateCo = state.user.role === "admin" || state.user.perspective === "lead";
    const { company, profile = {}, grant, docs, people, history } = data;
    const daysLeftText = (dateStr) => {
      if (!dateStr) return "";
      const ms = Date.parse(dateStr + "T23:59:59+08:00");
      if (!Number.isFinite(ms)) return "";
      const days = Math.ceil((ms - Date.now()) / 86400_000);
      if (days < 0) return `<div style="font-size:11px;color:var(--danger);font-weight:600;">已超期 ${Math.abs(days)} 天</div>`;
      if (days <= 30) return `<div style="font-size:11px;color:var(--warn);font-weight:600;">剩 ${days} 天</div>`;
      if (days <= 90) return `<div style="font-size:11px;color:var(--text-muted);">剩 ${days} 天</div>`;
      return "";
    };
    const docFilter = state.companyDocFilter || "all"; // all | expiring | no_pdf | pending
    const docQ = (state.companyDocQ || "").trim().toLowerCase();
    const hideVoid = state.companyHideVoid !== false; // default hide void docs for clarity
    const applyDocFilter = (arr) => arr.filter((d) => {
      if (hideVoid && d.status === "void") return false;
      if (docFilter === "expiring" && d.expiryState !== "expired" && d.expiryState !== "expiring") return false;
      if (docFilter === "no_pdf" && !!d.file_id) return false;
      if (docFilter === "pending" && d.status !== "pending" && d.status !== "missing") return false;
      if (docQ) {
        const hay = `${d.category || ""} ${d.name || ""} ${d.issuer || ""} ${d.doc_no || ""} ${d.qual_items_json || ""} ${d.remark || ""}`.toLowerCase();
        if (!hay.includes(docQ)) return false;
      }
      return true;
    });
    const docStatusBadge = (d) => d.status === "void" ? badge("quiet", "x", "已作废（留存历史）")
      : d.status === "missing" ? badge("warn", "info", "待补（未登记）")
      : d.status === "verified" ? badge("good", "check", "已核实")
      : badge("quiet", "clock", "待核实");

    const activeTab = ["enterprise", "people", "social_security", "other"].includes(state.companyDocTab)
      ? state.companyDocTab
      : "enterprise";

    const entDocs = docs.filter((d) => (d.doc_group || "enterprise") === "enterprise");
    const ssDocs = docs.filter((d) => d.doc_group === "social_security");
    const otherDocs = docs.filter((d) => d.doc_group === "other");
    const cntActive = (arr) => arr.filter((d) => d.status !== "void").length;

    const dicts = state.settings?.fieldDicts || {};
    const entCategories = dicts.enterpriseCategories?.length ? dicts.enterpriseCategories : ["建筑业企业资质", "安全生产许可证", "营业执照", "信用证明", "质量/环境/安全管理体系"];

    const tabMeta = {
      enterprise: {
        label: "企业资质",
        count: cntActive(entDocs),
        cta: "+ 登记企业资质",
        hint: "按住建部标准集中管理建筑业企业资质（支持一证多项资质明细）、发证机关、证书编号、安全生产许可证与有效期预警。",
        categories: entCategories,
        namePlaceholder: "如：防水防腐保温工程专业承包贰级 / 安全生产许可证",
      },
      people: {
        label: "人员资质",
        count: people.length,
        cta: "+ 登记人员资质",
        hint: "管理建造师、技术负责人、安全员与授权委托人；支持记录在建锁证状态与个人社保缴纳月份。",
      },
      social_security: {
        label: "社保权益单",
        count: cntActive(ssDocs),
        cta: "+ 登记社保权益单",
        hint: "按月/季登记企业社保权益单与参保清册，便于开标前核验近 1/3/6 个月社保证明完备度。",
        categories: ["社保权益单", "人员社保清册"],
        namePlaceholder: "如：2026年11月企业社保权益单",
      },
      other: {
        label: "其他材料",
        count: cntActive(otherDocs),
        cta: "+ 登记其他材料",
        hint: "归档财务审计报告、类似业绩合同、开户许可/银行资信证明、法人授权模板等通用投标材料。",
        categories: ["财务审计", "业绩合同", "开户许可与资信", "法人授权模板", "其他材料"],
        namePlaceholder: "如：2025年度财务审计报告 / 某市政管网业绩合同",
      },
    };

    const renderDocTable = (list, emptyTitle, emptyDesc, mode) => {
      if (!list.length) return `<div class="empty-state"><strong>${esc(emptyTitle)}</strong><div>${esc(emptyDesc)}</div></div>`;
      if (mode === "enterprise") {
        return `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:48px;">序号</th>
                  <th style="width:130px;">资质类别</th>
                  <th style="width:165px;">发证机关</th>
                  <th style="width:165px;">证书编号</th>
                  <th style="min-width:260px;">资质名称与等级（一证多项明细）</th>
                  <th style="width:110px;">有效期</th>
                  <th style="width:90px;">状态</th>
                  <th style="width:190px;">操作</th>
                </tr>
              </thead>
              <tbody>
                ${list.map((d, idx) => {
                  let qItems = [];
                  try { qItems = JSON.parse(d.qual_items_json || "[]"); } catch {}
                  if (!Array.isArray(qItems) || !qItems.length) {
                    qItems = String(d.name || "").split(/\s*\/\s*|\n/).filter(Boolean).map((n) => ({ name: n, passLabel: d.status === "verified" ? "合格" : "" }));
                  }
                  const stateBadge = d.status === "void"
                    ? badge("quiet", "x", "已作废")
                    : d.expiryState === "expired"
                      ? badge("danger", "alert", "已过期")
                      : d.expiryState === "expiring"
                        ? badge("warn", "clock", "即将到期")
                        : badge("good", "check", "正常");
                  return `
                    <tr style="${d.status === "void" ? "opacity:0.55;" : ""}">
                      <td class="num muted">${idx + 1}</td>
                      <td><strong>${esc(d.category)}</strong></td>
                      <td class="muted">${esc(d.issuer || "待补发证机关")}</td>
                      <td class="num" style="font-weight:600;">${esc(d.doc_no || "待补编号")}</td>
                      <td>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                          ${qItems.map((qi) => `
                            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                              <span style="font-weight:500;">${esc(qi.name || qi)}</span>
                              ${d.expiryState === "expiring" ? `<span class="prov" style="color:var(--warn);border-color:var(--warn);">即将到期</span>` : ""}
                              ${d.expiryState === "expired" ? `<span class="prov" style="color:var(--danger);border-color:var(--danger);">已过期</span>` : ""}
                              ${(qi.passLabel || d.status === "verified") ? `<span class="prov prov-verified">${esc(qi.passLabel || "合格")}</span>` : ""}
                            </div>
                          `).join("")}
                          ${d.remark ? `<div class="muted" style="font-size:11px;">${esc(d.remark)}</div>` : ""}
                        </div>
                      </td>
                      <td class="num muted">${esc(d.valid_until || "—")}${daysLeftText(d.valid_until)}</td>
                      <td>${stateBadge}</td>
                      <td>
                        <div style="display:flex;gap:5px;flex-wrap:wrap;">
                          ${d.file_id ? `<button class="btn btn-sm" data-preview-file="${esc(d.file_id)}" data-fname="${esc(d.file_name || d.name + ".pdf")}">预览</button>` : ""}
                          ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" data-doc-edit="${esc(d.id)}">编辑</button>` : ""}
                          ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" data-upload-for="doc" data-oid="${esc(d.id)}">${d.file_id ? "换件" : "传件"}</button>` : ""}
                          ${grant.verify && d.status !== "void" ? `<button class="btn btn-sm btn-primary" data-doc-verify="${esc(d.id)}" data-dname="${esc(d.name)}" data-ver="${d.version}">核实</button>` : ""}
                          ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" style="color:var(--danger);border-color:var(--danger-border);" data-doc-void="${esc(d.id)}" data-dname="${esc(d.name)}" data-ver="${d.version}">作废</button>` : ""}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>`;
      }
      return `
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>类别 / 资料名称</th>
              <th>${mode === "social_security" ? "所属月份与参保说明" : "编号与有效期"}</th>
              <th>登记与核实状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((d) => `
              <tr>
                <td>
                  <span class="prov">${esc(d.category)}</span>
                  <strong style="margin-left:6px;">${esc(d.name)}</strong>
                  <span class="prov ${d.status === "verified" ? "prov-verified" : ""}" style="margin-left:4px;">v${d.version}</span>
                  ${d.remark && mode !== "social_security" ? `<div class="muted">${esc(d.remark)}</div>` : ""}
                  ${d.verify_basis ? `<div class="muted">核实依据：${esc(d.verify_basis)}（${esc(d.verified_by)}）</div>` : ""}
                </td>
                <td class="muted num">
                  ${mode === "social_security" ? `
                    <div>所属期次：<strong>${esc(d.period_month || "未填月份")}</strong>${d.doc_no ? ` · 编号 ${esc(d.doc_no)}` : ""}</div>
                    <div>${d.remark ? esc(d.remark) : "未填参保人数/说明"}${d.valid_until ? ` · 有效至 ${esc(d.valid_until)}` : ""}</div>
                  ` : `
                    <div>${esc(d.doc_no || "编号待补")}</div>
                    <div>有效期：${d.valid_until ? esc(d.valid_until) : "未标注"} ${d.expiryState === "expired" ? badge("danger", "alert", "已过期") : d.expiryState === "expiring" ? badge("warn", "clock", "30天内到期") : ""}</div>
                  `}
                </td>
                <td>${docStatusBadge(d)}</td>
                <td style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${d.file_id ? `<button class="btn btn-sm" data-preview-file="${esc(d.file_id)}" data-fname="${esc(d.file_name || d.name + ".pdf")}">预览</button>` : ""}
                  ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" data-doc-edit="${esc(d.id)}">编辑</button>` : ""}
                  ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" data-upload-for="doc" data-oid="${esc(d.id)}">${d.file_id ? "换件" : "传件"}</button>` : ""}
                  ${grant.verify && d.status !== "void" ? `<button class="btn btn-sm btn-primary" data-doc-verify="${esc(d.id)}" data-dname="${esc(d.name)}" data-ver="${d.version}">核实</button>` : ""}
                  ${grant.edit && d.status !== "void" ? `<button class="btn btn-sm" style="color:var(--danger);border-color:var(--danger-border);" data-doc-void="${esc(d.id)}" data-dname="${esc(d.name)}" data-ver="${d.version}">作废</button>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    };

    const curMeta = tabMeta[activeTab];
    const activeDocs = docs.filter((d) => d.status !== "void");
    const pendingDocsCnt = activeDocs.filter((d) => d.status === "pending").length;
    const expiredDocsCnt = activeDocs.filter((d) => d.expiryState === "expired").length;
    const expiringDocsCnt = activeDocs.filter((d) => d.expiryState === "expiring").length;
    const withPdfCnt = activeDocs.filter((d) => !!d.file_id).length;
    const availPeopleCnt = people.filter((p) => p.lock_status === "available").length;
    const lockedPeopleCnt = people.filter((p) => p.lock_status === "locked").length;
    const socialWarnPeopleCnt = people.filter((p) => p.social_status === "待补缴").length;
    const latestSsMonth = ssDocs.map((d) => d.period_month).filter(Boolean).sort().reverse()[0] || "未登记";
    const personFilter = state.companyPersonFilter || "all"; // all | available | locked | social_warn
    const filteredPeople = people.filter((p) => {
      if (personFilter === "available") return p.lock_status === "available";
      if (personFilter === "locked") return p.lock_status === "locked";
      if (personFilter === "social_warn") return p.social_status !== "正常连续缴纳";
      return true;
    });

    slot.innerHTML = `
      <!-- 飞书风格顶层公司秒切 Tab 栏（点左侧菜单直接进入，1键切换公司） -->
      <div class="td-main-tabs" role="tablist" aria-label="切换参投公司" style="border:1px solid var(--border);border-radius:var(--radius);justify-content:space-between;align-items:center;flex-wrap:wrap;padding-right:10px;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
          ${(state.companies || []).map((c) => {
            const isCur = c.id === company.id;
            const warnCnt = (c.gapExpired || 0) + (c.gapExpiring || 0);
            return `
              <button type="button" role="tab" aria-selected="${isCur}" class="td-main-tab ${isCur ? "active" : ""}" data-switch-co="${esc(c.id)}">
                <span>${esc(c.name)}</span>
                <span class="tab-num">${c.docCount ?? 0}</span>
                ${warnCnt > 0 ? `<span style="width:7px;height:7px;border-radius:50%;background:var(--danger);display:inline-block;" title="含 ${warnCnt} 项临期或过期证件"></span>` : ""}
              </button>
            `;
          }).join("")}
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding:6px 0;">
          ${canCreateCo ? `<button type="button" class="btn btn-sm" id="btn-new-co-inline">+ 新建公司</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" id="btn-all-co-overview">全部公司对比</button>
        </div>
      </div>

      <div class="td-stat-row">
        <div class="td-stat-card">
          <div class="td-stat-label">有效资质与原件 PDF 归档率</div>
          <div class="td-stat-value">${withPdfCnt} <span style="font-size:13px;font-weight:400;" class="muted">/ ${activeDocs.length} 份已传 PDF</span></div>
          <div class="td-stat-foot"><span>企业资质 ${cntActive(entDocs)} · 其他材料 ${cntActive(otherDocs)}</span></div>
        </div>
        <div class="td-stat-card ${expiredDocsCnt > 0 ? "td-danger" : expiringDocsCnt > 0 ? "td-warn" : "td-good"}">
          <div class="td-stat-label">证件有效期预警</div>
          <div class="td-stat-value" style="color:${expiredDocsCnt > 0 ? "var(--danger)" : expiringDocsCnt > 0 ? "var(--warn)" : "var(--good)"};">${expiredDocsCnt > 0 ? `${expiredDocsCnt} 份已过期` : expiringDocsCnt > 0 ? `${expiringDocsCnt} 份临期` : "全部有效"}</div>
          <div class="td-stat-foot"><span>30天内临期 ${expiringDocsCnt} 份 · 开标前请务必核验</span></div>
        </div>
        <div class="td-stat-card ${lockedPeopleCnt > 0 ? "td-warn" : "td-good"}">
          <div class="td-stat-label">建造师 / 人员在建锁证状态</div>
          <div class="td-stat-value"><span style="color:var(--good);">${availPeopleCnt} 可用</span> <span style="font-size:14px;font-weight:500;" class="muted">/ ${lockedPeopleCnt} 锁定</span></div>
          <div class="td-stat-foot"><span>登记总人数 ${people.length} 人${socialWarnPeopleCnt > 0 ? ` · ${socialWarnPeopleCnt} 人社保异常` : ""}</span></div>
        </div>
        <div class="td-stat-card">
          <div class="td-stat-label">最新企业社保权益单</div>
          <div class="td-stat-value">${esc(latestSsMonth)}</div>
          <div class="td-stat-foot"><span>已归档 ${cntActive(ssDocs)} 期 · 可查看有关公告和档案</span></div>
        </div>
      </div>

      <div class="ws-sheet">
        <div class="ws-sec">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <h2 style="margin:0 0 4px;">${esc(company.name)}</h2>
              <div class="muted">集中管理企业常用投标信息、资质证书、建造师锁证/社保状态与原件归档（腾讯云 COS 加密留痕）。</div>
            </div>
            <div class="meta-row">
              ${grant.edit ? `<button type="button" class="btn btn-sm" id="btn-edit-co-profile">编辑企业档案/基本户</button>` : ""}
              <button type="button" class="btn btn-sm" id="btn-export-co-zip">打包下载资质 (ZIP)</button>
              ${grant.edit ? `<button type="button" class="btn btn-sm" id="btn-import-co-zip">ZIP 一键整体更新</button>` : ""}
              <button type="button" class="btn btn-sm" id="btn-scan-co-expiry">巡检到期提醒</button>
              <button type="button" class="btn btn-sm" id="btn-copy-qual-summary">复制资质清单</button>
              <button type="button" class="btn btn-sm" id="btn-export-co-csv">导出台账 CSV</button>
              ${(grant.edit || state.user.role === "admin") && (state.companies || []).length > 1 ? `<button type="button" class="btn btn-sm btn-danger" id="btn-delete-co">删除本公司</button>` : ""}
              <a class="btn btn-sm btn-primary" href="/opportunities?tab=biddable&amp;onlyOpen=0&amp;matchCompanyId=${esc(encodeURIComponent(company.id))}" data-go="/opportunities?tab=biddable&amp;onlyOpen=0&amp;matchCompanyId=${esc(encodeURIComponent(company.id))}">按本公司档案筛选</a>
            </div>
          </div>

          <!-- 企业常用投标/基本户档案速查卡（点击字段值一键复制） -->
          <div style="margin-top:12px;padding:10px 12px;border-radius:var(--radius);background:var(--surface-2);border:1px solid var(--border);display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 14px;font-size:12.5px;">
            <div>
              <span class="muted" style="font-size:11px;">统一社会信用代码</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <strong class="num">${esc(profile.credit_code || "待补充")}</strong>
                ${profile.credit_code ? `<button type="button" class="quick-pill" style="padding:1px 6px;" data-copy-val="${esc(profile.credit_code)}">复制</button>` : ""}
              </div>
            </div>
            <div>
              <span class="muted" style="font-size:11px;">法定代表人 / 注册资本</span>
              <div style="margin-top:2px;"><strong>${esc(profile.legal_rep || "待补充")}</strong>${profile.reg_capital ? ` <span class="muted">· ${esc(profile.reg_capital)}</span>` : ""}</div>
            </div>
            <div>
              <span class="muted" style="font-size:11px;">基本户开户行</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <strong>${esc(profile.bank_name || "待补充")}</strong>
                ${profile.bank_name ? `<button type="button" class="quick-pill" style="padding:1px 6px;" data-copy-val="${esc(profile.bank_name)}">复制</button>` : ""}
              </div>
            </div>
            <div>
              <span class="muted" style="font-size:11px;">基本户账号（保证金专用）</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <strong class="num">${esc(profile.bank_account || "待补充")}</strong>
                ${profile.bank_account ? `<button type="button" class="quick-pill" style="padding:1px 6px;" data-copy-val="${esc(profile.bank_account)}">复制</button>` : ""}
              </div>
            </div>
            <div>
              <span class="muted" style="font-size:11px;">CA 锁有效期 / 联系人</span>
              <div style="margin-top:2px;" class="num"><strong>${esc(profile.ca_expiry || "待补充")}</strong>${profile.contact_name ? ` <span class="muted">· ${esc(profile.contact_name)} ${esc(profile.contact_phone || "")}</span>` : ""}</div>
            </div>
          </div>
        </div>

        <div class="ws-sec" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--surface-2);">
          <div class="seg-group" role="tablist" aria-label="公司资料分类">
            ${["enterprise", "people", "social_security", "other"].map((k) => `
              <button type="button" role="tab" aria-selected="${activeTab === k}" class="seg-btn ${activeTab === k ? "active" : ""}" data-doc-tab="${k}">
                ${esc(tabMeta[k].label)} (${tabMeta[k].count})
              </button>
            `).join("")}
          </div>
          ${grant.edit ? `
            <button class="btn btn-sm btn-primary" id="${activeTab === "people" ? "btn-add-person" : "btn-add-doc"}">${esc(curMeta.cta)}</button>
          ` : ""}
        </div>

        <div class="ws-sec">
          ${pendingDocsCnt > 0 && grant.edit ? `
            <div class="notice-box info" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
              <div>
                <strong>发现 ${pendingDocsCnt} 份证件处于「待核实」</strong>：系统可直接读取已上传的原件扫描件与证书号并核验有效期，免去人工逐条确认。
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="btn-co-ai-verify-all">AI 一键识图核验 (${pendingDocsCnt})</button>
            </div>
          ` : ""}
          ${activeTab !== "people" ? `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
              <div class="opp-preset-bar" style="margin:0;padding:0;border:none;gap:6px;">
                <button type="button" class="opp-preset-btn ${docFilter === "all" ? "active" : ""}" data-doc-flt="all">全部</button>
                <button type="button" class="opp-preset-btn ${docFilter === "expiring" ? "active" : ""}" data-doc-flt="expiring">临期/已过期 (${expiredDocsCnt + expiringDocsCnt})</button>
                <button type="button" class="opp-preset-btn ${docFilter === "no_pdf" ? "active" : ""}" data-doc-flt="no_pdf">缺原件 (${Math.max(0, activeDocs.length - withPdfCnt)})</button>
                <button type="button" class="opp-preset-btn ${docFilter === "pending" ? "active" : ""}" data-doc-flt="pending">待核实 (${pendingDocsCnt})</button>
                <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);cursor:pointer;margin-left:4px;">
                  <input type="checkbox" id="co-hide-void" ${hideVoid ? "checked" : ""} /> 隐藏已作废
                </label>
              </div>
              <input class="input" id="co-doc-search" value="${esc(state.companyDocQ || "")}" placeholder="搜资质名称、证书编号、发证机关…" style="width:240px;height:32px;font-size:12.5px;" />
            </div>
          ` : ""}
          ${activeTab === "enterprise" ? renderDocTable(applyDocFilter(entDocs), "当前筛选下暂无企业资质", "可切换上方状态快筛，或点击右上角「+ 登记企业资质」通过 OCR 一键录入。", "enterprise") : ""}
          ${activeTab === "social_security" ? renderDocTable(applyDocFilter(ssDocs), "当前筛选下暂无社保权益单", "点击右上角「+ 登记社保权益单」按月记录企业社保权益单及参保人数。", "social_security") : ""}
          ${activeTab === "other" ? renderDocTable(applyDocFilter(otherDocs), "当前筛选下暂无其他投标材料", "可归档财务审计报告、类似业绩合同、开户许可与银行资信证明等。", "other") : ""}
          ${activeTab === "people" ? `
            <div class="opp-preset-bar" style="margin-top:0;margin-bottom:10px;padding-top:0;border-top:none;">
              <span class="muted" style="font-size:12px;">快速筛选：</span>
              <button type="button" class="opp-preset-btn ${personFilter === "all" ? "active" : ""}" data-pflt="all">全部人员 (${people.length})</button>
              <button type="button" class="opp-preset-btn ${personFilter === "available" ? "active" : ""}" data-pflt="available">当前可用/无在建 (${availPeopleCnt})</button>
              <button type="button" class="opp-preset-btn ${personFilter === "locked" ? "active" : ""}" data-pflt="locked">在建锁定中 (${lockedPeopleCnt})</button>
              <button type="button" class="opp-preset-btn ${personFilter === "social_warn" ? "active" : ""}" data-pflt="social_warn">社保待核/异常</button>
            </div>
            ${filteredPeople.length ? `
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>姓名与岗位</th><th>证书等级与有效期</th><th>在建锁证状态（可一键切换）</th><th>个人社保状态</th><th>操作与敏感信息</th></tr></thead>
                <tbody>
                  ${filteredPeople.map((p) => `
                    <tr>
                      <td><strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role_title || "专职人员")}</span></td>
                      <td class="muted num">${esc(p.cert_level || "未标注")} · 有效期：${esc(p.cert_valid_until || "未标注")}</td>
                      <td>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                          ${p.lock_status === "locked" ? badge("warn", "lock", "在建锁定") : p.lock_status === "available" ? badge("good", "check", "当前可用") : badge("quiet", "clock", "未标注")}
                          ${grant.edit ? `<button type="button" class="quick-pill" data-toggle-lock="${esc(p.id)}" data-next-lock="${p.lock_status === "locked" ? "available" : "locked"}">${p.lock_status === "locked" ? "释放为可用" : "标为在建锁定"}</button>` : ""}
                        </div>
                      </td>
                      <td class="muted num">
                        ${p.social_status === "正常连续缴纳" ? badge("good", "check", "正常缴纳") : p.social_status === "待补缴" ? badge("warn", "alert", "待补缴") : badge("quiet", "clock", "未标注")}
                        ${p.social_until ? ` <span style="margin-left:4px;">至 ${esc(p.social_until)}</span>` : ""}
                      </td>
                      <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        ${p.file_id ? `<button class="btn btn-sm" data-preview-file="${esc(p.file_id)}" data-fname="${esc(p.file_name || p.name + "证书.pdf")}">预览 PDF</button>` : ""}
                        ${grant.edit ? `<button class="btn btn-sm" data-upload-for="person" data-oid="${esc(p.id)}">${p.file_id ? "更换附件" : "上传 PDF"}</button>` : ""}
                        ${grant.edit ? `<button class="btn btn-sm" data-edit-person="${esc(p.id)}">更新状态</button>` : ""}
                        <button class="btn btn-sm" data-reveal="${esc(p.id)}" data-pname="${esc(p.name)}">查看敏感信息</button>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state"><strong>当前筛选条件下无人员档案</strong><div>可点击「+ 登记人员资质」录入建造师、技术负责人与授权委托人。</div></div>`}` : ""}
        </div>
      </div>

      ${history.length ? `
        <div class="card" style="margin-top:12px;">
          <div class="card-head"><h3>资料变更与核实记录（保留全部历史）</h3></div>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>时间（北京时间）</th><th>资料</th><th>版本 / 操作</th><th>操作人</th><th>依据 / 原因</th></tr></thead>
              <tbody>
                ${history.map((h) => `
                  <tr>
                    <td class="muted num">${esc(h.at)}</td>
                    <td>${esc(h.doc_name)}</td>
                    <td><span class="prov">v${h.version}</span> ${esc(h.action)}</td>
                    <td>${esc(h.actor_name)}</td>
                    <td class="muted">${esc(h.reason)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      ` : ""}
    `;

    slot.querySelectorAll("[data-switch-co]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextId = btn.getAttribute("data-switch-co");
        if (nextId && nextId !== cid) navigate("/companies/" + encodeURIComponent(nextId));
      });
    });
    slot.querySelector("#btn-all-co-overview")?.addEventListener("click", () => navigate("/companies?all=1"));
    slot.querySelector("#btn-new-co-inline")?.addEventListener("click", async () => {
      const name = await promptAsync("请输入新参投公司全称：");
      if (!name || !name.trim()) return;
      try {
        const res = await api("/companies", { name: name.trim() });
        state.companies = await api("/companies").catch(() => state.companies);
        showToast("已创建参投公司并授予当前账号权限。");
        navigate(res?.id ? "/companies/" + encodeURIComponent(res.id) : "/companies");
      } catch (err) {
        showToast(err.message);
      }
    });
    slot.querySelectorAll("[data-doc-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.companyDocTab = btn.getAttribute("data-doc-tab");
        renderKeepScroll();
      });
    });
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-pflt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.companyPersonFilter = btn.getAttribute("data-pflt");
        renderKeepScroll();
      });
    });

    // 1. Copy profile field values
    slot.querySelectorAll("[data-copy-val]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const val = btn.getAttribute("data-copy-val") || "";
        if (!val) return;
        try {
          await navigator.clipboard.writeText(val);
          showToast(`已复制：${val}`);
        } catch {
          showToast("复制失败，请手动选中复制。");
        }
      });
    });

    // 2. Edit company common profile modal
    slot.querySelector("#btn-edit-co-profile")?.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="编辑公司投标基础档案" style="max-width:560px;width:94vw;max-height:90vh;overflow:auto;">
          <h3 style="margin:0 0 6px;">编辑公司投标基础档案</h3>
          <div class="muted" style="font-size:12px;margin-bottom:12px;">用于保函办理、保证金打款核对、CA 锁续期提醒与标书快速复制，修改将记入审计日志。</div>
          <form id="co-profile-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="field"><label>统一社会信用代码</label><input class="input" name="creditCode" value="${esc(profile.credit_code || "")}" placeholder="18位统一社会信用代码" /></div>
              <div class="field"><label>法定代表人</label><input class="input" name="legalRep" value="${esc(profile.legal_rep || "")}" placeholder="如：张三" /></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="field"><label>注册资本</label><input class="input" name="regCapital" value="${esc(profile.reg_capital || "")}" placeholder="如：5000万元人民币" /></div>
              <div class="field"><label>CA 锁有效期</label><input class="input" type="date" name="caExpiry" value="${esc(profile.ca_expiry || "")}" /></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="field"><label>基本户开户行</label><input class="input" name="bankName" value="${esc(profile.bank_name || "")}" placeholder="如：中国建设银行南京某某支行" /></div>
              <div class="field"><label>基本户账号</label><input class="input" name="bankAccount" value="${esc(profile.bank_account || "")}" placeholder="企业基本存款账户账号" /></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="field"><label>投标联系人</label><input class="input" name="contactName" value="${esc(profile.contact_name || "")}" placeholder="姓名" /></div>
              <div class="field"><label>联系电话</label><input class="input" name="contactPhone" value="${esc(profile.contact_phone || "")}" placeholder="手机号或座机" /></div>
            </div>
            <div class="field"><label>注册 / 办公地址</label><input class="input" name="address" value="${esc(profile.address || "")}" placeholder="营业执照住所或常用收件地址" /></div>
            <div class="field"><label>补充备注（选填）</label><input class="input" name="remark" value="${esc(profile.remark || "")}" placeholder="如：开票抬头注意事项、CA 锁存放人等" /></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
              <button type="button" class="btn" id="pf-cancel">取消</button>
              <button type="submit" class="btn btn-primary">保存基础档案</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#pf-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#co-profile-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api(`/companies/${encodeURIComponent(cid)}/profile`, {
            creditCode: String(fd.get("creditCode") || ""),
            legalRep: String(fd.get("legalRep") || ""),
            regCapital: String(fd.get("regCapital") || ""),
            caExpiry: String(fd.get("caExpiry") || ""),
            bankName: String(fd.get("bankName") || ""),
            bankAccount: String(fd.get("bankAccount") || ""),
            contactName: String(fd.get("contactName") || ""),
            contactPhone: String(fd.get("contactPhone") || ""),
            address: String(fd.get("address") || ""),
            remark: String(fd.get("remark") || ""),
          });
          wrap.remove();
          showToast("公司基础档案已更新。");
          renderKeepScroll();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    // 3. Copy active qualifications plain-text summary
    slot.querySelector("#btn-copy-qual-summary")?.addEventListener("click", async () => {
      const lines = [`【${company.name} · 投标常用资料与资质清单】`];
      if (profile.credit_code) lines.push(`统一社会信用代码：${profile.credit_code}`);
      if (profile.legal_rep) lines.push(`法定代表人：${profile.legal_rep}`);
      if (profile.reg_capital) lines.push(`注册资本：${profile.reg_capital}`);
      if (profile.bank_name || profile.bank_account) lines.push(`基本户：${profile.bank_name || "-"} / ${profile.bank_account || "-"}`);
      if (profile.ca_expiry) lines.push(`CA 锁有效期：${profile.ca_expiry}`);
      const activeDocs = docs.filter((d) => d.status !== "void");
      lines.push(`\n一、有效/在库证件与资质（共 ${activeDocs.length} 项）`);
      activeDocs.forEach((d, idx) => {
        let items = [];
        try { items = JSON.parse(d.qual_items_json || "[]"); } catch {}
        const itemStr = items.length ? ` [含：${items.map((x) => x.name).join("；")}]` : "";
        const validStr = d.valid_until ? `有效期至 ${d.valid_until}` : (d.period_month ? `参保月份 ${d.period_month}` : "有效期未标注");
        const stLabel = d.status === "verified" ? "已核实" : d.status === "missing" ? "待补" : "待核实";
        lines.push(`${idx + 1}. [${d.category}] ${d.name}${d.doc_no ? `（证号：${d.doc_no}）` : ""} — ${validStr}（${stLabel}）${itemStr}`);
      });
      if (people.length) {
        lines.push(`\n二、关键人员（共 ${people.length} 人，当前可用 ${availPeopleCnt} 人）`);
        people.forEach((p, idx) => {
          const lockLabel = p.lock_status === "locked" ? "在建锁定" : p.lock_status === "available" ? "当前可用" : "未标注";
          lines.push(`${idx + 1}. ${p.name}（${p.role_title || "专职人员"}）· ${p.cert_level || "未标注"} · ${lockLabel} · 社保：${p.social_status || "未标注"}`);
        });
      }
      const txt = lines.join("\n");
      try {
        await navigator.clipboard.writeText(txt);
        showToast("已复制资质与人员清单到剪贴板，可直接粘贴至微信或 Word。");
      } catch {
        showToast("复制失败，请检查浏览器剪贴板权限。");
      }
    });

    // 4. Export CSV ledger (docs + people, UTF-8 BOM)
    slot.querySelector("#btn-export-co-csv")?.addEventListener("click", () => {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [
        ["类型", "分类/岗位", "名称/姓名", "证书编号/等级", "发证机关/锁证状态", "有效期/参保月份", "核实/社保状态", "是否有原件", "备注/资质明细"].map(q).join(","),
      ];
      docs.forEach((d) => {
        let items = [];
        try { items = JSON.parse(d.qual_items_json || "[]"); } catch {}
        const detail = [items.map((x) => x.name).join("；"), d.remark || ""].filter(Boolean).join(" | ");
        const stMap = { verified: "已核实", pending: "待核实", missing: "待补", void: "已作废" };
        rows.push([
          "企业资料", d.category || "", d.name || "", d.doc_no || "", d.issuer || "",
          d.valid_until || d.period_month || "", stMap[d.status] || d.status,
          d.file_id ? "有附件" : "无附件", detail,
        ].map(q).join(","));
      });
      people.forEach((p) => {
        const lockMap = { available: "当前可用", locked: "在建锁定" };
        rows.push([
          "关键人员", p.role_title || "专职人员", p.name || "", p.cert_level || "",
          lockMap[p.lock_status] || "未标注", p.cert_valid_until || "",
          [p.social_status || "未标注", p.social_until ? `至 ${p.social_until}` : ""].filter(Boolean).join(" "),
          p.file_id ? "有附件" : "无附件", "",
        ].map(q).join(","));
      });
      const blob = new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${company.name}_资料与人员台账_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("已导出资料与人员台账表格。");
    });

    // 4B. One-click pack & download all active qualification files as ZIP
    slot.querySelector("#btn-export-co-zip")?.addEventListener("click", () => {
      showToast("正在打包全套资质原件、清单与台账（ZIP），请稍候…");
      const a = document.createElement("a");
      a.href = `/api/companies/${encodeURIComponent(cid)}/export-zip`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // 4C. One-click batch import / update via ZIP archive
    slot.querySelector("#btn-import-co-zip")?.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="ZIP 一键整体更新资质" style="max-width:580px;width:94vw;max-height:90vh;overflow:auto;">
          <h3 style="margin:0 0 6px;">标书资质一键上传整体更新（ZIP）</h3>
          <div class="muted" style="font-size:12.5px;margin-bottom:12px;">
            上传包含 PDF / 图片 / DOCX / XLSX 的 ZIP 压缩包（最大 60MB，单次最多 80 份）。系统将按文件名、证书号自动匹配现有资料并递增版本覆盖原件；未匹配的文件自动按目录分类新建建档并归档留痕。
          </div>
          <form id="co-zip-import-form">
            <div class="field">
              <label>选择 ZIP 压缩包</label>
              <input class="input" type="file" id="co-zip-file" accept=".zip,application/zip,application/x-zip-compressed" required />
              <span class="field-hint">支持按文件夹自动归类（如：01_企业资质、02_信用与安许、03_社保与证明、04_业绩合同）。</span>
            </div>
            <div id="co-zip-result" style="margin-bottom:12px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" class="btn" id="zip-cancel">关闭</button>
              <button type="submit" class="btn btn-primary" id="zip-submit">开始解析并批量更新</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#zip-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#co-zip-import-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = wrap.querySelector("#co-zip-file")?.files?.[0];
        if (!f) return;
        const btn = wrap.querySelector("#zip-submit");
        const out = wrap.querySelector("#co-zip-result");
        btn.disabled = true;
        btn.textContent = "正在解压并批量归档…";
        out.innerHTML = `<div class="notice-box info"><span>正在解析「${esc(f.name)}」并校验归档，请勿关闭窗口…</span></div>`;
        try {
          const dataBase64 = await readFileAsBase64(f);
          const res = await api(`/companies/${encodeURIComponent(cid)}/import-zip`, { filename: f.name, dataBase64 });
          out.innerHTML = `
            <div class="notice-box good" style="margin-bottom:8px;">
              <span>批量更新完成：匹配更新 <strong>${res.updated}</strong> 份，新建归档 <strong>${res.created}</strong> 份，跳过 ${res.skipped} 份。</span>
            </div>
            ${(res.details || []).length ? `
              <div style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;">
                <table class="tbl">
                  <thead><tr><th>文件</th><th>处理结果</th><th>对应资料</th></tr></thead>
                  <tbody>
                    ${res.details.map((it) => `
                      <tr>
                        <td>${esc(it.file)}</td>
                        <td>${it.action === "updated" ? badge("info", "check", `更新 v${it.version}`) : badge("good", "check", "新建建档")}</td>
                        <td>${esc(it.docName)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : ""}
          `;
          btn.textContent = "再次导入";
          btn.disabled = false;
          showToast(`ZIP 整体更新完成：更新 ${res.updated} 份，新建 ${res.created} 份。`);
          renderKeepScroll();
        } catch (err) {
          out.innerHTML = `<div class="notice-box danger"><span>${esc(err.message)}</span></div>`;
          btn.textContent = "重新尝试";
          btn.disabled = false;
        }
      });
    });

    // 4D. Trigger 30/7-day expiry reminders scan
    slot.querySelector("#btn-scan-co-expiry")?.addEventListener("click", async () => {
      try {
        const res = await api("/system/scan-expiry", {});
        state.openAlerts = (state.openAlerts || 0) + (res.created || 0);
        showToast(`到期巡检完成：扫描 ${res.scanned} 项，新写入 ${res.created} 条 30/7 天待办提醒，当前共 ${res.openTotal} 条资料到期预警。`);
      } catch (err) {
        showToast(err.message);
      }
    });

    slot.querySelector("#btn-co-ai-verify-all")?.addEventListener("click", async () => {
      const btn = slot.querySelector("#btn-co-ai-verify-all");
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "AI 识图核验中…";
      try {
        const res = await api(`/companies/${encodeURIComponent(cid)}/ai-verify-all`, {});
        showToast(`核验完成：自动通过 ${res.verifiedCount || 0} 份，发现过期 ${res.expiredCount || 0} 份，保留待补 ${res.skippedCount || 0} 份。`);
        state.companies = await api("/companies").catch(() => state.companies);
        renderKeepScroll();
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    });

    // 4E. Delete mistakenly created / unused company
    slot.querySelector("#btn-delete-co")?.addEventListener("click", () => {
      openRiskDialog({
        title: `删除参投公司「${company.name}」`,
        target: `${company.name}（当前含 ${docs.length} 份资料、${people.length} 名人员）`,
        riskWarning: "删除后将同步清理该公司下的基础档案、资料条目、人员档案及授权记录，且不可撤销；若该公司已有资金/保证金台账，系统会自动拦截保护。",
        confirmLabel: "确认永久删除",
        onConfirm: async (reason) => {
          await api(`/companies/${encodeURIComponent(cid)}/delete`, { reason });
          state.companies = await api("/companies").catch(() => (state.companies || []).filter((c) => c.id !== cid));
          showToast(`已删除公司「${company.name}」，操作已记入审计日志。`);
          const nextCo = (state.companies || [])[0];
          navigate(nextCo ? `/companies/${encodeURIComponent(nextCo.id)}` : "/companies");
        },
      });
    });

    // 5. Doc quick filters, hide-void toggle & real-time search
    slot.querySelectorAll("[data-doc-flt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.companyDocFilter = btn.getAttribute("data-doc-flt") || "all";
        renderKeepScroll();
      });
    });
    slot.querySelector("#co-hide-void")?.addEventListener("change", (e) => {
      state.companyHideVoid = !!e.target.checked;
      renderKeepScroll();
    });
    const docSearchInput = slot.querySelector("#co-doc-search");
    if (docSearchInput) {
      let isComposing = false;
      const applyDocSearchInPlace = () => {
        if (isComposing) return;
        const kw = docSearchInput.value.trim().toLowerCase();
        state.companyDocQ = docSearchInput.value;
        slot.querySelectorAll(".ws-sec tbody tr").forEach((tr) => {
          const hit = !kw || (tr.textContent || "").toLowerCase().includes(kw);
          tr.style.display = hit ? "" : "none";
        });
      };
      docSearchInput.addEventListener("compositionstart", () => { isComposing = true; });
      docSearchInput.addEventListener("compositionend", () => { isComposing = false; applyDocSearchInPlace(); });
      docSearchInput.addEventListener("input", (e) => { if (!e.isComposing && !isComposing) applyDocSearchInPlace(); });
      docSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing && !isComposing && e.keyCode !== 229) {
          e.preventDefault();
          applyDocSearchInPlace();
        }
      });
    }

    // 6. Edit existing doc metadata modal
    slot.querySelectorAll("[data-doc-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const docId = btn.getAttribute("data-doc-edit");
        const d = docs.find((x) => x.id === docId);
        if (!d) return;
        const grp = d.doc_group || activeTab;
        const m = tabMeta[grp] || tabMeta.enterprise;
        let itemsText = "";
        try {
          const arr = JSON.parse(d.qual_items_json || "[]");
          if (Array.isArray(arr)) itemsText = arr.map((x) => x.name).filter(Boolean).join("\n");
        } catch {}
        const catList = Array.from(new Set([...(m.categories || []), d.category].filter(Boolean)));
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-label="编辑资料条目" style="max-width:560px;width:94vw;max-height:90vh;overflow:auto;">
            <h3 style="margin:0 0 6px;">编辑资料 · ${esc(d.name)}</h3>
            <div class="muted" style="font-size:12px;margin-bottom:12px;">当前版本 v${d.version || 1}，保存后将自动递增版本号并写入历史变更记录。</div>
            <form id="doc-edit-form">
              <div class="field"><label>资料类别</label><select class="select" name="category">${catList.map((c) => `<option value="${esc(c)}" ${c === d.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
              <div class="field"><label>资料 / 证书简称</label><input class="input" name="name" required value="${esc(d.name || "")}" /></div>
              ${grp === "social_security" ? `
                <div class="field"><label>所属参保月份（YYYY-MM）</label><input class="input" type="month" name="periodMonth" value="${esc(d.period_month || "")}" /></div>
                <div class="field"><label>权益单编号 / 核验码</label><input class="input" name="docNo" value="${esc(d.doc_no || "")}" /></div>
                <div class="field"><label>参保人数与缴纳说明</label><input class="input" name="remark" value="${esc(d.remark || "")}" /></div>
              ` : `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  <div class="field"><label>发证机关</label><input class="input" name="issuer" value="${esc(d.issuer || "")}" /></div>
                  <div class="field"><label>证书编号</label><input class="input" name="docNo" value="${esc(d.doc_no || "")}" /></div>
                </div>
                ${grp === "enterprise" ? `
                  <div class="field"><label>包含的资质名称与等级（每行一条）</label><textarea class="input" name="qualItemsText" rows="4">${esc(itemsText)}</textarea></div>
                ` : ""}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  <div class="field"><label>有效期截止（YYYY-MM-DD）</label><input class="input" type="date" name="validUntil" value="${esc(d.valid_until || "")}" /></div>
                  <div class="field"><label>备注说明</label><input class="input" name="remark" value="${esc(d.remark || "")}" /></div>
                </div>
              `}
              <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
                <button type="button" class="btn" id="de-cancel">取消</button>
                <button type="submit" class="btn btn-primary">保存变更（v${(d.version || 1) + 1}）</button>
              </div>
            </form>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#de-cancel").addEventListener("click", () => wrap.remove());
        wrap.querySelector("#doc-edit-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            const payload = {
              category: String(fd.get("category") || d.category),
              name: String(fd.get("name") || d.name).trim(),
              issuer: String(fd.get("issuer") ?? d.issuer ?? ""),
              docNo: String(fd.get("docNo") ?? ""),
              validUntil: String(fd.get("validUntil") ?? d.valid_until ?? ""),
              periodMonth: String(fd.get("periodMonth") ?? d.period_month ?? ""),
              remark: String(fd.get("remark") ?? ""),
            };
            if (grp === "enterprise") payload.qualItemsText = String(fd.get("qualItemsText") || "");
            await api(`/docs/${encodeURIComponent(docId)}/edit`, payload);
            wrap.remove();
            showToast(`已更新「${payload.name}」并记录新版本。`);
            renderKeepScroll();
          } catch (err) {
            showToast(err.message);
          }
        });
      });
    });
    slot.querySelectorAll("[data-toggle-lock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pid = btn.getAttribute("data-toggle-lock");
        const nextLock = btn.getAttribute("data-next-lock");
        const p = people.find((x) => x.id === pid);
        if (!p) return;
        try {
          await api(`/people/${encodeURIComponent(pid)}/update`, {
            roleTitle: p.role_title || "",
            certLevel: p.cert_level || "",
            certValidUntil: p.cert_valid_until || "",
            lockStatus: nextLock,
            socialStatus: p.social_status || "",
            socialUntil: p.social_until || "",
          });
          showToast(`已将「${p.name}」状态切换为：${nextLock === "locked" ? "在建锁定" : "当前可用"}`);
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    // Add doc modal (tailored to activeTab + built-in PDF/Image OCR auto-fill & COS upload)
    slot.querySelector("#btn-add-doc")?.addEventListener("click", () => {
      const m = tabMeta[activeTab] || tabMeta.enterprise;
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(m.cta)}" style="max-width:580px;width:94vw;max-height:90vh;overflow:auto;">
          <h3 style="margin:0 0 10px;">${esc(m.label)} · 登记条目（支持 PDF / 图片 OCR 自动填表）</h3>
          <form id="doc-add-form">
            <input type="hidden" name="docGroup" value="${esc(activeTab)}" />
            <div style="padding:12px;border:1px solid var(--accent-border);border-radius:var(--radius);background:var(--accent-soft);margin-bottom:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <strong style="font-size:13px;color:var(--accent);">第 1 步：上传资质 / 证书 PDF 或图片（支持粘贴 / 拖拽 / 多文档多选 + 自动 OCR）</strong>
                <button type="button" class="btn btn-sm btn-primary" id="btn-doc-ocr">立即 OCR 识别填表</button>
              </div>
              <div id="doc-ocr-uz"></div>
              <div id="doc-ocr-status" class="muted" style="font-size:12px;margin-top:6px;">支持点击多选、拖拽或直接 Ctrl+V 粘贴截图/PDF，首份文件将自动触发中文 OCR 填表。</div>
              <details id="doc-ocr-raw-wrap" style="display:none;margin-top:8px;">
                <summary style="cursor:pointer;font-size:12px;color:var(--accent);font-weight:600;">查看 OCR 识别完整文字（可复制核对）</summary>
                <textarea class="input" id="doc-ocr-raw" rows="4" readonly style="margin-top:6px;font-size:12px;"></textarea>
              </details>
            </div>
            <div class="field"><label>资质类别</label><select class="select" name="category">${(m.categories || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
            <div class="field"><label>资料 / 证书简称</label><input class="input" name="name" required placeholder="${esc(m.namePlaceholder || "")}" /></div>
            ${activeTab === "social_security" ? `
              <div class="field"><label>所属参保月份（YYYY-MM）</label><input class="input" type="month" name="periodMonth" required /></div>
              <div class="field"><label>参保人数与缴纳说明</label><input class="input" name="remark" placeholder="如：在职参保 38 人，养老/医疗/工伤正常缴纳" /></div>
              <div class="field"><label>权益单编号 / 核验码（选填）</label><input class="input" name="docNo" placeholder="如江苏人社电子印章核验码" /></div>
            ` : `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="field"><label>发证机关</label><input class="input" name="issuer" placeholder="如：江苏省住房和城乡建设厅" /></div>
                <div class="field"><label>证书编号</label><input class="input" name="docNo" placeholder="如：D232D88528 / （苏）JZ安许证字…" /></div>
              </div>
              ${activeTab === "enterprise" ? `
                <div class="field"><label>证书包含的资质名称与等级（一证多项请每行一条，OCR 自动提取）</label><textarea class="input" name="qualItemsText" rows="3" placeholder="防水防腐保温工程专业承包贰级&#10;建筑装修装饰工程专业承包贰级&#10;特种工程（结构补强）专业承包不分等级"></textarea></div>
              ` : ""}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="field"><label>有效期截止（YYYY-MM-DD）</label><input class="input" type="date" name="validUntil" /></div>
                <div class="field"><label>备注说明（选填）</label><input class="input" name="remark" placeholder="原件存放位置或补充说明" /></div>
              </div>
            `}
            <div class="field"><label>核验与参与配标状态</label><select class="select" name="status"><option value="verified">自动核实并参与配标（已附原件或经 OCR 识别）</option><option value="pending">待核实（稍后核对）</option><option value="missing">待补（尚未取得原件，先建缺口台账）</option></select></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="m-cancel">取消</button><button type="submit" class="btn btn-primary">确认登记并归档原件</button></div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#m-cancel").addEventListener("click", () => wrap.remove());

      const form = wrap.querySelector("#doc-add-form");
      const ocrBtn = wrap.querySelector("#btn-doc-ocr");
      const ocrStatus = wrap.querySelector("#doc-ocr-status");
      let lastOcrFile = null;
      let ocrUsed = false;
      const docUz = attachUniversalDropzone(wrap.querySelector("#doc-ocr-uz"), {
        multiple: true,
        accept: "application/pdf,.pdf,image/*,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif,.docx,.xlsx,.csv,.txt",
        title: "点击多选、拖拽资质文件，或直接 Ctrl+V 粘贴截图",
        hint: "支持 PDF / 各类图片 / DOCX / XLSX / TXT · 首份文件自动高精度 OCR 填表，保存时一并归档 COS",
        pasteScope: wrap,
        onFilesChange: (flist) => {
          if (flist.length && flist[0] !== lastOcrFile) {
            lastOcrFile = flist[0];
            runDocOcr();
          }
        },
      });
      wrap.querySelector("#m-cancel").addEventListener("click", () => docUz.destroy());

      async function runDocOcr() {
        const file = docUz.getFiles()[0];
        if (!file) { showToast("请先选择、拖拽或粘贴 PDF / 图片文件。"); return; }
        ocrBtn.disabled = true;
        ocrBtn.textContent = "OCR 识别中…";
        ocrStatus.innerHTML = `<span style="color:var(--accent);">正在提取 PDF 文字 / 进行中文扫描件 OCR 识别，请稍候…</span>`;
        try {
          const dataBase64 = await readFileAsBase64(file);
          const res = await api("/ocr/extract", { mode: "doc", filename: file.name, dataBase64 });
          ocrUsed = true;
          const f = res.fields || {};
          if (f.category) {
            const catSel = form.querySelector('[name="category"]');
            if (catSel && [...catSel.options].some((o) => o.value === f.category)) catSel.value = f.category;
          }
          if (f.name && form.querySelector('[name="name"]')) form.querySelector('[name="name"]').value = f.name;
          if (f.issuer && form.querySelector('[name="issuer"]')) form.querySelector('[name="issuer"]').value = f.issuer;
          if (f.docNo && form.querySelector('[name="docNo"]')) form.querySelector('[name="docNo"]').value = f.docNo;
          if (f.qualItemsText && form.querySelector('[name="qualItemsText"]')) form.querySelector('[name="qualItemsText"]').value = f.qualItemsText;
          if (f.validUntil && form.querySelector('[name="validUntil"]')) form.querySelector('[name="validUntil"]').value = f.validUntil;
          if (f.periodMonth && form.querySelector('[name="periodMonth"]')) form.querySelector('[name="periodMonth"]').value = f.periodMonth;
          if (f.remark && form.querySelector('[name="remark"]')) form.querySelector('[name="remark"]').value = f.remark;
          const stSel = form.querySelector('[name="status"]');
          if (stSel && f.name) stSel.value = "verified";
          ocrStatus.innerHTML = `<span style="color:var(--good);font-weight:600;">✓ 识别成功（${esc(res.engine)}，提取 ${res.charCount} 字）— 已自动回填并设为自动核实！</span>`;
          if (res.rawText) {
            wrap.querySelector("#doc-ocr-raw-wrap").style.display = "block";
            wrap.querySelector("#doc-ocr-raw").value = res.rawText;
          }
        } catch (err) {
          ocrStatus.innerHTML = `<span style="color:var(--danger);">OCR 识别提示：${esc(err.message)}</span>`;
        } finally {
          ocrBtn.disabled = false;
          ocrBtn.textContent = "重新 OCR 识别";
        }
      }
      ocrBtn.addEventListener("click", runDocOcr);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const pickedFiles = docUz.getFiles();
        const payload = Object.fromEntries(fd.entries());
        if (ocrUsed || pickedFiles.length) payload.provenance = ocrUsed ? "ocr_ai" : "original";
        if (!pickedFiles.length && !ocrUsed && payload.status === "verified") payload.status = "pending";
        try {
          const created = await api(`/companies/${encodeURIComponent(cid)}/docs`, payload);
          if (pickedFiles.length && created?.id) {
            for (const f of pickedFiles) {
              await uploadCompanyFile(cid, "doc", created.id, f);
            }
            if (payload.status === "verified" || ocrUsed) {
              await api(`/companies/${encodeURIComponent(cid)}/ai-verify-all`, { docId: created.id }).catch(() => null);
            }
          }
          docUz.destroy();
          wrap.remove();
          showToast(pickedFiles.length ? `已登记并核验归档 ${pickedFiles.length} 份原件至 COS。` : "已登记资料并创建 v1 历史记录。");
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    slot.querySelectorAll("[data-preview-file]").forEach((b) => {
      b.addEventListener("click", () => {
        openFilePreviewModal(b.getAttribute("data-preview-file"), b.getAttribute("data-fname"), b);
      });
    });

    slot.querySelectorAll("[data-upload-for]").forEach((b) => {
      b.addEventListener("click", () => {
        const ownerType = b.getAttribute("data-upload-for");
        const ownerId = b.getAttribute("data-oid");
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" style="max-width:520px;">
            <h3 style="margin:0 0 8px;">上传 / 更新资质原件（支持粘贴、拖拽、多选）</h3>
            <div id="co-uz-host"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
              <button type="button" class="btn" id="co-uz-cancel">取消</button>
              <button type="button" class="btn btn-primary" id="co-uz-submit">确认上传</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const uz = attachUniversalDropzone(wrap.querySelector("#co-uz-host"), {
          multiple: true,
          accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp",
          pasteScope: wrap,
        });
        wrap.querySelector("#co-uz-cancel").addEventListener("click", () => { uz.destroy(); wrap.remove(); });
        wrap.querySelector("#co-uz-submit").addEventListener("click", async () => {
          const picked = uz.getFiles();
          if (!picked.length) { showToast("请先选择、拖拽或粘贴至少 1 个文件。"); return; }
          const subBtn = wrap.querySelector("#co-uz-submit");
          subBtn.disabled = true; subBtn.textContent = `正在上传 (${picked.length})…`;
          try {
            for (const f of picked) {
              await uploadCompanyFile(cid, ownerType, ownerId, f);
            }
            uz.destroy();
            wrap.remove();
            showToast(`已成功上传 ${picked.length} 份原件至腾讯云 COS。`);
            render();
          } catch (err) {
            showToast(err.message);
            subBtn.disabled = false; subBtn.textContent = "确认上传";
          }
        });
      });
    });

    // Verify & Void doc actions (accessible openRiskDialog)
    slot.querySelectorAll("[data-doc-verify]").forEach((b) => {
      b.addEventListener("click", () => {
        const docId = b.getAttribute("data-doc-verify");
        const dname = b.getAttribute("data-dname") || "该资料";
        const ver = Number(b.getAttribute("data-ver"));
        openRiskDialog({
          title: `核实资料「${dname}」`,
          desc: "核实资料属于高风险操作，请填写核实依据（如原件核对/四库一平台或人社核验结果），操作将永久留痕。",
          requireReason: true,
          reasonLabel: "核实依据（必填）",
          confirmText: "确认人工核实",
          danger: false,
          triggerEl: b,
          onConfirm: async (reason) => {
            await api(`/docs/${docId}/action`, { action: "verify", version: ver, reason });
            showToast("已完成人工核实并留痕。");
            render();
          },
        });
      });
    });
    slot.querySelectorAll("[data-doc-void]").forEach((b) => {
      b.addEventListener("click", () => {
        const docId = b.getAttribute("data-doc-void");
        const dname = b.getAttribute("data-dname") || "该资料";
        const ver = Number(b.getAttribute("data-ver"));
        openRiskDialog({
          title: `作废资料「${dname}」`,
          desc: "作废后该资料不再计入有效档案，历史版本仍完整保留以供审计。",
          requireReason: true,
          reasonLabel: "作废原因（必填）",
          confirmText: "确认作废",
          danger: true,
          triggerEl: b,
          onConfirm: async (reason) => {
            await api(`/docs/${docId}/action`, { action: "void", version: ver, reason });
            showToast("已作废该资料，历史记录已保留。");
            render();
          },
        });
      });
    });

    // Add person modal (with built-in PDF/Image OCR auto-fill for builder/safety certificates)
    slot.querySelector("#btn-add-person")?.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="登记人员资质档案" style="max-width:580px;width:94vw;max-height:90vh;overflow:auto;">
          <h3 style="margin:0 0 10px;">登记人员资质档案（支持建造师/安全员证书 PDF 一键 OCR 填表）</h3>
          <form id="per-add-form">
            <div style="padding:12px;border:1px solid var(--accent-border);border-radius:var(--radius);background:var(--accent-soft);margin-bottom:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <strong style="font-size:13px;color:var(--accent);">上传建造师证 / 安全员证 PDF 或图片（支持粘贴 / 拖拽 / 多选 + 自动 OCR）</strong>
                <button type="button" class="btn btn-sm btn-primary" id="btn-per-ocr">OCR 识别填表</button>
              </div>
              <div id="per-ocr-uz"></div>
              <div id="per-ocr-status" class="muted" style="font-size:12px;margin-top:6px;">支持点击多选、拖拽或 Ctrl+V 粘贴证书截图，首份文件将自动识别填充姓名、证书等级与身份证号。</div>
              <details id="per-ocr-raw-wrap" style="display:none;margin-top:8px;">
                <summary style="cursor:pointer;font-size:12px;color:var(--accent);font-weight:600;">查看 OCR 识别完整文字</summary>
                <textarea class="input" id="per-ocr-raw" rows="4" readonly style="margin-top:6px;font-size:12px;"></textarea>
              </details>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="field"><label>姓名</label><input class="input" name="name" required /></div>
              <div class="field"><label>岗位角色</label><input class="input" name="roleTitle" placeholder="如：项目经理 / 专职安全员" /></div>
              <div class="field"><label>证书等级</label><input class="input" name="certLevel" placeholder="如：一级建造师(市政)" /></div>
              <div class="field"><label>证书有效期</label><input class="input" type="date" name="certValidUntil" /></div>
              <div class="field"><label>在建锁证状态</label><select class="select" name="lockStatus"><option value="available">当前可用（无在建）</option><option value="locked">在建锁定</option><option value="pending">未标注</option></select></div>
              <div class="field"><label>个人社保状态</label><select class="select" name="socialStatus"><option value="正常连续缴纳">正常连续缴纳</option><option value="待补缴">待补缴</option><option value="未标注">未标注</option></select></div>
              <div class="field"><label>社保已缴至月份（YYYY-MM）</label><input class="input" type="month" name="socialUntil" /></div>
              <div class="field"><label>联系电话（受控敏感字段）</label><input class="input" name="phone" /></div>
              <div class="field"><label>身份证号（受控敏感字段）</label><input class="input" name="idCard" /></div>
              <div class="field"><label>证书编号（受控敏感字段）</label><input class="input" name="certNo" /></div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;"><button type="button" class="btn" id="p-cancel">取消</button><button type="submit" class="btn btn-primary">保存人员并归档附件</button></div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#p-cancel").addEventListener("click", () => wrap.remove());

      const pForm = wrap.querySelector("#per-add-form");
      const pOcrBtn = wrap.querySelector("#btn-per-ocr");
      const pOcrStatus = wrap.querySelector("#per-ocr-status");
      let lastPerOcrFile = null;
      const perUz = attachUniversalDropzone(wrap.querySelector("#per-ocr-uz"), {
        multiple: true,
        accept: "application/pdf,.pdf,image/*,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif,.docx,.xlsx,.csv,.txt",
        title: "点击多选、拖拽证书文件，或直接 Ctrl+V 粘贴截图",
        hint: "支持 PDF / 各类图片 / DOCX / XLSX / TXT · 首份文件自动高精度 OCR 填表",
        pasteScope: wrap,
        onFilesChange: (flist) => {
          if (flist.length && flist[0] !== lastPerOcrFile) {
            lastPerOcrFile = flist[0];
            runPerOcr();
          }
        },
      });
      wrap.querySelector("#p-cancel").addEventListener("click", () => perUz.destroy());

      async function runPerOcr() {
        const file = perUz.getFiles()[0];
        if (!file) { showToast("请先选择、拖拽或粘贴证书 PDF / 图片文件。"); return; }
        pOcrBtn.disabled = true;
        pOcrBtn.textContent = "OCR 识别中…";
        pOcrStatus.innerHTML = `<span style="color:var(--accent);">正在识别证书文字，请稍候…</span>`;
        try {
          const dataBase64 = await readFileAsBase64(file);
          const res = await api("/ocr/extract", { mode: "person", filename: file.name, dataBase64 });
          const f = res.fields || {};
          if (f.name) pForm.querySelector('[name="name"]').value = f.name;
          if (f.roleTitle) pForm.querySelector('[name="roleTitle"]').value = f.roleTitle;
          if (f.certLevel) pForm.querySelector('[name="certLevel"]').value = f.certLevel;
          if (f.certValidUntil) pForm.querySelector('[name="certValidUntil"]').value = f.certValidUntil;
          if (f.idCard) pForm.querySelector('[name="idCard"]').value = f.idCard;
          if (f.certNo) pForm.querySelector('[name="certNo"]').value = f.certNo;
          pOcrStatus.innerHTML = `<span style="color:var(--good);font-weight:600;">✓ 识别成功（${esc(res.engine)}，提取 ${res.charCount} 字）— 已自动填充人员信息，请核对后保存！</span>`;
          if (res.rawText) {
            wrap.querySelector("#per-ocr-raw-wrap").style.display = "block";
            wrap.querySelector("#per-ocr-raw").value = res.rawText;
          }
        } catch (err) {
          pOcrStatus.innerHTML = `<span style="color:var(--danger);">OCR 识别提示：${esc(err.message)}</span>`;
        } finally {
          pOcrBtn.disabled = false;
          pOcrBtn.textContent = "重新 OCR 识别";
        }
      }
      pOcrBtn.addEventListener("click", runPerOcr);

      pForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const pickedFiles = perUz.getFiles();
        try {
          const created = await api(`/companies/${encodeURIComponent(cid)}/people`, Object.fromEntries(fd.entries()));
          if (pickedFiles.length && created?.id) {
            for (const f of pickedFiles) {
              await uploadCompanyFile(cid, "person", created.id, f);
            }
          }
          perUz.destroy();
          wrap.remove();
          showToast(pickedFiles.length ? `已登记人员资质并加密上传 ${pickedFiles.length} 份附件至 COS。` : "已登记人员资质档案。");
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    // Update person lock / social status modal
    slot.querySelectorAll("[data-edit-person]").forEach((b) => {
      b.addEventListener("click", () => {
        const pid = b.getAttribute("data-edit-person");
        const p = people.find((x) => x.id === pid);
        if (!p) return;
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-label="更新人员状态">
            <h3 style="margin:0 0 12px;">更新「${esc(p.name)}」资质与社保状态</h3>
            <form id="per-edit-form">
              <div class="field"><label>岗位角色</label><input class="input" name="roleTitle" value="${esc(p.role_title || "")}" /></div>
              <div class="field"><label>证书等级</label><input class="input" name="certLevel" value="${esc(p.cert_level || "")}" /></div>
              <div class="field"><label>证书有效期</label><input class="input" type="date" name="certValidUntil" value="${esc(p.cert_valid_until || "")}" /></div>
              <div class="field"><label>在建锁证状态</label><select class="select" name="lockStatus"><option value="available" ${p.lock_status === "available" ? "selected" : ""}>当前可用（无在建）</option><option value="locked" ${p.lock_status === "locked" ? "selected" : ""}>在建锁定</option><option value="pending" ${p.lock_status === "pending" ? "selected" : ""}>未标注</option></select></div>
              <div class="field"><label>个人社保状态</label><select class="select" name="socialStatus"><option value="正常连续缴纳" ${p.social_status === "正常连续缴纳" ? "selected" : ""}>正常连续缴纳</option><option value="待补缴" ${p.social_status === "待补缴" ? "selected" : ""}>待补缴</option><option value="未标注" ${!p.social_status || p.social_status === "未标注" ? "selected" : ""}>未标注</option></select></div>
              <div class="field"><label>社保已缴至月份（YYYY-MM）</label><input class="input" type="month" name="socialUntil" value="${esc(p.social_until || "")}" /></div>
              <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="pe-cancel">取消</button><button type="submit" class="btn btn-primary">保存更新</button></div>
            </form>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#pe-cancel").addEventListener("click", () => wrap.remove());
        wrap.querySelector("#per-edit-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            await api(`/people/${encodeURIComponent(pid)}/update`, Object.fromEntries(new FormData(e.target).entries()));
            wrap.remove();
            showToast("人员资质与社保状态已更新。");
            render();
          } catch (err) { showToast(err.message); }
        });
      });
    });

    // Sensitive info reveal modal (accessible openRiskDialog, closes & wipes immediately)
    slot.querySelectorAll("[data-reveal]").forEach((b) => {
      b.addEventListener("click", () => {
        const pid = b.getAttribute("data-reveal");
        const pname = b.getAttribute("data-pname");
        openRiskDialog({
          title: `查看「${pname}」受控敏感信息`,
          desc: "查看身份证、电话与证书编号属于受控审计操作，必须填写查看事由。",
          requireReason: true,
          reasonLabel: "查看事由（必填）",
          confirmText: "申请查看",
          danger: false,
          triggerEl: b,
          onConfirm: async (reason) => {
            const sec = await api(`/people/${pid}/reveal`, { reason });
            const wrap = document.createElement("div");
            wrap.className = "modal-backdrop";
            wrap.innerHTML = `
              <div class="modal" role="dialog" aria-modal="true">
              <h3 style="margin:0 0 8px;">敏感信息临时查看（${esc(sec.name)}）</h3>
              <div class="notice-box warn">${ICONS.lock}<span><strong>本次查看已留痕。</strong>明文仅在当前对话框内显示，关闭后立即清除。</span></div>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:16px;">
                <div><span class="muted">身份证号：</span><code class="num">${esc(sec.idCard)}</code></div>
                <div><span class="muted">联系电话：</span><code class="num">${esc(sec.phone)}</code></div>
                <div><span class="muted">证书编号：</span><code class="num">${esc(sec.certNo)}</code></div>
              </div>
              <div style="display:flex;justify-content:flex-end;"><button type="button" class="btn btn-primary" id="rev-close">关闭并清除显示</button></div>
            </div>`;
            document.body.appendChild(wrap);
            wrap.querySelector("#rev-close").addEventListener("click", () => wrap.remove());
          },
        });
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6C. GAPS BOARD (/gaps) =================
async function renderGaps(root) {
  const slot = renderShell(root, "gaps", [
    { label: "岗位首页", href: "/" },
    { label: "缺口看板" },
  ], `<div class="card">正在汇总各公司资料缺口…</div>`);

  try {
    const data = await api("/gaps");
    const gapBadge = (t) => t === "expired" ? badge("danger", "alert", "已过期")
      : t === "expiring" ? badge("warn", "clock", "30天内临近到期")
      : t === "missing" ? badge("warn", "info", "待补（未登记）")
      : badge("quiet", "clock", "未标注");

    slot.innerHTML = `
      <div class="notice-box">
        ${ICONS.info}
        <div><strong>口径声明：</strong>缺口仅表示资料登记状态，不构成资格判断；待补（未登记）不等于不符合。</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>按公司汇总缺口</h2><span class="muted">核查基准日：${esc(data.today)} 北京时间</span></div>
        ${data.summary.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>公司</th><th class="amount">已登记资料</th><th class="amount">待补</th><th class="amount">未标注</th><th class="amount">30天内到期</th><th class="amount">已过期</th></tr></thead>
              <tbody>
                ${data.summary.map((s) => `
                  <tr>
                    <td><a class="row-title" href="/companies/${esc(s.id)}" data-open-co="${esc(s.id)}">${esc(s.name)}</a></td>
                    <td class="amount num">${s.docCount}</td>
                    <td class="amount num">${s.missingCnt}</td>
                    <td class="amount num">${s.pendingCnt}</td>
                    <td class="amount num">${s.expiringCnt}</td>
                    <td class="amount num" style="${s.expiredCnt > 0 ? "color:var(--danger);font-weight:600;" : ""}">${s.expiredCnt}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>暂无可见公司数据</strong><div>请先在「公司与资料库」建立公司档案或联系管理员授权。</div></div>`}
      </div>

      <div class="card">
        <div class="card-head"><h3>缺口明细清单（${data.items.length} 条）</h3></div>
        ${data.items.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>公司</th><th>类别 / 资料名称</th><th>缺口类型</th><th>有效期</th></tr></thead>
              <tbody>
                ${data.items.map((it) => `
                  <tr>
                    <td><a href="/companies/${esc(it.companyId)}" data-open-co="${esc(it.companyId)}">${esc(it.companyName)}</a></td>
                    <td><span class="prov">${esc(it.category)}</span> ${esc(it.name)}</td>
                    <td>${gapBadge(it.gapType)}</td>
                    <td class="muted num">${esc(it.validUntil || "未标注")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>当前已授权公司无待补、未标注或临期缺口项</strong></div>`}
      </div>
    `;
    slot.querySelectorAll("[data-open-co]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/companies/" + a.getAttribute("data-open-co")); }));
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6D. PROJECTS LIBRARY (/projects) =================
async function renderProjects(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const decision = qs.get("decision") || "all";
  const companyId = qs.get("companyId") || "";
  const step = qs.get("step") || "";
  const q = qs.get("q") || "";

  const slot = renderShell(root, "projects", [
    { label: "岗位首页", href: "/" },
    { label: "项目库" },
  ], `<div class="card">正在读取已选定项目库…</div>`);

  try {
    const data = await api(`/projects?decision=${encodeURIComponent(decision)}&companyId=${encodeURIComponent(companyId)}&step=${encodeURIComponent(step)}&q=${encodeURIComponent(q)}`);
    const c = data.counts || {};
    const companyCounts = data.companyCounts || [];
    const stepCounts = data.stepCounts || {};
    const STEP_FUNNEL = [
      { k: "1", label: "1.购买标书" },
      { k: "2", label: "2.制作标书" },
      { k: "3", label: "3.保证金付款" },
      { k: "4", label: "4.指派参会" },
      { k: "5", label: "5.开标回传" },
      { k: "6", label: "6.分析预测" },
      { k: "7", label: "7.合同/退保" },
    ];
    function goP(patch) {
      const next = { decision, companyId, step, q, ...patch };
      const p = new URLSearchParams();
      Object.entries(next).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) p.set(k, String(v)); });
      navigate("/projects?" + p.toString());
    }

    slot.innerHTML = `
      <div class="ws-sheet">
        <div class="ws-sec">
          <div class="card-head" style="margin-bottom:8px;">
            <div>
              <h2 style="margin:0 0 2px;">项目库（全部已选定标段集中协同）</h2>
              <div class="muted">支持按参投公司 / 投标单位分组切换，支持粘贴外部招标公告链接一键自动抓取收录，单行直达 7 阶段全流程。</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-sm btn-primary" id="btn-import-url">粘贴网页链接录入项目</button>
              <button class="btn btn-sm" id="btn-go-opp">前往机会池选定新项目</button>
            </div>
          </div>

          <!-- 参投公司 / 投标单位 Tab 区分 -->
          <div class="opp-preset-bar" style="padding:0 0 10px;border-bottom:1px solid var(--border);margin-bottom:10px;gap:6px;">
            <span style="font-size:12px;font-weight:600;color:var(--text);">投标单位：</span>
            <button type="button" class="opp-preset-btn ${!companyId ? "active" : ""}" data-proj-co="">全部单位 (${c.all ?? 0})</button>
            ${state.companies.map((co) => {
              const hit = companyCounts.find((x) => x.companyId === co.id);
              const cnt = hit ? hit.cnt : 0;
              return `<button type="button" class="opp-preset-btn ${companyId === co.id ? "active" : ""}" data-proj-co="${esc(co.id)}">${esc(co.name)} (${cnt})</button>`;
            }).join("")}
            ${(() => {
              const un = companyCounts.find((x) => !x.companyId);
              return un && un.cnt > 0 ? `<button type="button" class="opp-preset-btn ${companyId === "__none__" ? "active" : ""}" data-proj-co="__none__">未指定投标单位 (${un.cnt})</button>` : "";
            })()}
          </div>

          <!-- 7 阶段数量漏斗快筛条 -->
          <div class="proj-funnel-bar" role="tablist" aria-label="按标段执行阶段筛选">
            <span style="font-size:12px;font-weight:600;color:var(--text);">阶段漏斗：</span>
            <button type="button" class="proj-funnel-item ${!step ? "active" : ""}" data-proj-step="">全部阶段 <span class="proj-funnel-cnt">${c.all ?? 0}</span></button>
            ${STEP_FUNNEL.map((sf) => `
              <button type="button" class="proj-funnel-item ${step === sf.k ? "active" : ""}" data-proj-step="${sf.k}">
                ${esc(sf.label)} <span class="proj-funnel-cnt">${stepCounts[sf.k] || 0}</span>
              </button>
            `).join("")}
          </div>

          <div class="tabs" style="margin-bottom:10px;">
            <button class="tab ${decision === "all" ? "active" : ""}" data-dec="all">全部已选 <span class="tab-num">${c.all ?? 0}</span></button>
            <button class="tab ${decision === "bidding" ? "active" : ""}" data-dec="bidding">已选定参投 <span class="tab-num">${c.bidding ?? 0}</span></button>
            <button class="tab ${decision === "watching" ? "active" : ""}" data-dec="watching">已选定跟进 <span class="tab-num">${c.watching ?? 0}</span></button>
            <button class="tab ${decision === "pending_refund" ? "active" : ""}" data-dec="pending_refund">待退回保证金 <span class="tab-num">${c.pendingRefund ?? 0}</span></button>
          </div>
          ${(c.pendingRefundTotalFen || 0) > 0 ? `
            <div class="notice-box warn" style="margin-bottom:10px;">
              ${ICONS.wallet}
              <div><strong>在途待退回保证金总额：${esc(fmtFen(c.pendingRefundTotalFen))}</strong>（共 ${c.pendingRefund || 0} 个项目）。未中标项目在结果公示期满后请及时催退，已中标项目在签订合同或置换履约保函后申请退还。</div>
            </div>
          ` : ""}
          <form id="proj-search" class="filter-bar">
            <input class="input" name="q" value="${esc(q)}" placeholder="检索已选项目名称、招标人或地区…" style="flex:1;min-width:220px;" />
            <button class="btn btn-primary" type="submit">检索</button>
          </form>
        </div>

        <div class="ws-sec" style="padding:0;">
          ${data.items.length ? `
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th style="min-width:340px;">已选项目 / 直达执行子区</th>
                    <th class="amount" style="width:145px;">预算 / 控制价（元）</th>
                    <th style="width:170px;">报名 / 递交截止</th>
                    <th style="width:150px;">选定类型 / 责任人</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.items.map((p) => `
                    <tr>
                      <td>
                        <a class="row-title" href="/projects/${esc(p.id)}" data-open-proj="${esc(p.id)}">${esc(p.title)}</a>
                        <div class="meta-row">
                          ${p.companyName ? `<span class="badge badge-info">${esc(p.companyName)}</span>` : `<span class="badge badge-quiet">未指定投标单位</span>`}
                          ${stageBadge(p.stage, p.stageLabel)}
                          ${badge("info", "radar", `阶段 ${p.workflowStep || 1}/7`)}
                          ${p.docBuyStatus && p.docBuyStatus !== "未获取" ? `<span class="prov prov-verified">标书：${esc(p.docBuyStatus)}</span>` : ""}
                          ${p.prepStatus && p.prepStatus !== "未开始" ? `<span class="prov prov-auto">制标：${esc(p.prepStatus)}</span>` : ""}
                          ${p.prepPmName ? `<span class="prov prov-verified">项目经理：${esc(p.prepPmName)}</span>` : ""}
                          ${p.predictStatus && p.predictStatus !== "待分析" ? `<span class="prov prov-raw">预测：${esc(p.predictStatus)}</span>` : ""}
                          ${p.depositOutstandingFen > 0 ? badge("danger", "wallet", `在途保证金 ${fmtFen(p.depositOutstandingFen)}`) : ""}
                          ${p.refundTrackStatus && p.refundTrackStatus !== "未进入退保" ? badge("warn", "clock", `退保：${p.refundTrackStatus}`) : ""}
                          ${p.region ? `<span class="prov">${esc(p.region)}</span>` : ""}
                          ${p.amendmentCount > 0 ? badge("danger", "alert", `含 ${p.amendmentCount} 条更正`) : ""}
                          ${p.openAlertCount > 0 ? badge("warn", "bell", `待处理提醒 ${p.openAlertCount}`) : ""}
                          <span>招标人：${esc(p.tenderer || "未标注")}</span>
                        </div>
                        <div class="quick-links-inline">
                          ${(() => {
                            const curSt = Math.min(7, Math.max(1, Number(p.workflowStep || 1)));
                            const curLabel = STEP_FUNNEL[curSt - 1]?.label || `${curSt}.当前阶段`;
                            const nextLabel = curSt < 7 ? STEP_FUNNEL[curSt]?.label : "";
                            return `
                              <a class="quick-pill" style="color:var(--accent);border-color:var(--accent-border);background:var(--accent-soft);font-weight:600;" href="/projects/${esc(p.id)}" data-open-step="${esc(p.id)}:${curSt}">当前阶段：${esc(curLabel)} · 去办理 →</a>
                              ${nextLabel ? `<a class="quick-pill" href="/projects/${esc(p.id)}" data-open-step="${esc(p.id)}:${curSt + 1}">下一阶段：${esc(nextLabel)}</a>` : ""}
                            `;
                          })()}
                        </div>
                      </td>
                      <td class="amount">${fmtYuan(p.budgetYuan) ? `<span class="num" style="font-weight:600;">${esc(fmtYuan(p.budgetYuan))}</span>` : `<span class="muted">未标注</span>`}</td>
                      <td>${deadlineBadge(p.deadline, p.deadlineText)}</td>
                      <td>
                        ${decisionBadge(p.decision)}
                        ${p.assigneeName ? `<div class="muted">对接人：${esc(p.assigneeName)}</div>` : ""}
                        ${p.note ? `<div class="muted">${esc(p.note)}</div>` : ""}
                        <div style="margin-top:6px;">
                          <button type="button" class="quick-pill" style="color:var(--danger);border-color:rgba(227,77,89,0.35);" data-abandon-proj="${esc(p.id)}" data-ptitle="${esc(p.title)}">放弃 / 移出项目库</button>
                        </div>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <strong>项目库暂无已选定项目</strong>
              <div>在「机会池」打开任意标段详情页，点击右上角「选定参投」或「选定跟进」即可直接加入项目库并开启更正与截止追踪。</div>
            </div>
          `}
        </div>
      </div>
    `;

    slot.querySelectorAll("[data-proj-co]").forEach((b) => b.addEventListener("click", () => goP({ companyId: b.getAttribute("data-proj-co") })));
    slot.querySelectorAll("[data-proj-step]").forEach((b) => b.addEventListener("click", () => goP({ step: b.getAttribute("data-proj-step") })));
    slot.querySelector("#btn-go-opp").addEventListener("click", () => navigate("/opportunities"));
    slot.querySelector("#btn-import-url")?.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="粘贴网页链接录入项目" style="max-width:680px;width:94vw;max-height:90vh;overflow:auto;">
          <h3 style="margin:0 0 6px;">粘贴招标公告网页链接录入项目库</h3>
          <div class="muted" style="font-size:12px;margin-bottom:12px;">粘贴网页链接后<strong>系统将自动提取项目信息并对比机会池查重</strong>；核对无误后点击底部「确认收录进入项目库」即可。</div>
          <form id="import-url-form">
            <div class="field">
              <label>招标公告网页链接（粘贴后自动解析）</label>
              <div style="display:flex;gap:8px;">
                <input class="input" id="imp-url-input" name="url" type="url" required placeholder="https://ggzy.yancheng.gov.cn/... 或任意交易平台公告链接" style="flex:1;" />
                <button type="button" class="btn" id="imp-parse-btn">重新解析</button>
              </div>
            </div>

            <div id="imp-dup-box" style="margin-bottom:10px;"></div>
            <div id="imp-warn-box" style="margin-bottom:10px;"></div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="field" style="grid-column:1 / -1;">
                <label>项目名称（必填，系统自动提取；若原站为动态渲染请直接粘贴真实项目名）</label>
                <input class="input" id="imp-title" name="title" required placeholder="如：盐城市某某道路改造工程施工招标公告（切勿填网站名）" />
              </div>
              <div class="field">
                <label>招标人 / 采购人</label>
                <input class="input" id="imp-tenderer" name="tenderer" placeholder="解析后自动回填，可修改" />
              </div>
              <div class="field">
                <label>控制价 / 预算（元）</label>
                <input class="input num" id="imp-budget" name="budgetYuan" type="number" step="0.01" placeholder="如 3500000" />
              </div>
              <div class="field">
                <label>递交 / 开标截止时间</label>
                <input class="input" id="imp-deadline" name="deadlineText" placeholder="如 2026-12-15 09:30" />
              </div>
              <div class="field">
                <label>所属县 / 区</label>
                <input class="input" id="imp-region" name="region" placeholder="如 盐城市东台市" />
              </div>
              <div class="field">
                <label>公告类型</label>
                <select class="select" id="imp-trade" name="tradeType">
                  <option value="工程建设">工程建设</option>
                  <option value="政府采购">政府采购</option>
                  <option value="交通工程">交通工程</option>
                  <option value="水利工程">水利工程</option>
                </select>
              </div>
              <div class="field">
                <label>纳入项目库状态</label>
                <select class="select" name="decision">
                  <option value="bidding" selected>已选定参投（进入 7 阶段跟进）</option>
                  <option value="watching">已选定跟进（重点观察）</option>
                </select>
              </div>
              <div class="field">
                <label>拟参投公司（可选）</label>
                <select class="select" name="companyId">
                  <option value="">暂不指定（进详情页再选）</option>
                  ${(state.companies || []).map((co) => `<option value="${esc(co.id)}">${esc(co.name)}</option>`).join("")}
                </select>
              </div>
              <div class="field">
                <label>立项备注</label>
                <input class="input" name="note" value="通过网页链接粘贴录入" />
              </div>
            </div>

            <details style="margin:4px 0 12px;border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;background:var(--surface-2);">
              <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text);">粘贴完整公告正文（若原站防爬/动态加载，粘贴正文后点上方「解析并查重」可自动提取所有字段）</summary>
              <div class="field" style="margin-top:8px;margin-bottom:0;"><textarea class="input" id="imp-body" name="bodyText" rows="4" placeholder="可直接 Ctrl+A / Ctrl+C 粘贴原网页公告正文，系统自动提取招标人、控制价、截止时间…"></textarea></div>
            </details>

            <div id="import-url-msg" style="margin-bottom:8px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" class="btn" id="imp-cancel">取消</button>
              <button type="submit" class="btn btn-primary" id="imp-submit">确认收录进入项目库</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#imp-cancel").addEventListener("click", () => wrap.remove());

      const formEl = wrap.querySelector("#import-url-form");
      const dupBox = wrap.querySelector("#imp-dup-box");
      const warnBox = wrap.querySelector("#imp-warn-box");
      const msgBox = wrap.querySelector("#import-url-msg");

      // Step 1: Parse URL & check duplicates in Opportunity Pool
      wrap.querySelector("#imp-parse-btn").addEventListener("click", async () => {
        const urlVal = wrap.querySelector("#imp-url-input").value.trim();
        if (!urlVal) { showToast("请先粘贴招标公告网页链接。"); return; }
        const pBtn = wrap.querySelector("#imp-parse-btn");
        pBtn.disabled = true;
        pBtn.textContent = "解析查重中…";
        dupBox.innerHTML = "";
        warnBox.innerHTML = "";
        msgBox.innerHTML = "";
        try {
          const res = await api("/projects/parse-url", {
            url: urlVal,
            title: wrap.querySelector("#imp-title").value.trim(),
            bodyText: wrap.querySelector("#imp-body").value.trim(),
          });
          const p = res.parsed || {};
          if (p.title) wrap.querySelector("#imp-title").value = p.title;
          if (p.tenderer) wrap.querySelector("#imp-tenderer").value = p.tenderer;
          if (p.budgetYuan > 0) wrap.querySelector("#imp-budget").value = p.budgetYuan;
          if (p.deadlineText) wrap.querySelector("#imp-deadline").value = p.deadlineText;
          if (p.region) wrap.querySelector("#imp-region").value = p.region;
          if (p.tradeType) wrap.querySelector("#imp-trade").value = p.tradeType;

          if (res.fetchWarning) {
            warnBox.innerHTML = `<div class="notice-box warn" style="margin:0;">${ICONS.alert}<span>${esc(res.fetchWarning)}</span></div>`;
          } else {
            warnBox.innerHTML = `<div class="notice-box" style="margin:0;">${ICONS.check}<span>已自动提取项目信息${p.attachmentCount ? `（含 ${p.attachmentCount} 个附件直链）` : ""}，请核对下方字段后点击确认收录。</span></div>`;
          }

          if (res.matchedOpportunities?.length) {
            dupBox.innerHTML = `
              <div class="notice-box" style="margin:0;border-color:var(--accent);background:rgba(0,82,217,0.06);flex-direction:column;align-items:stretch;gap:8px;">
                <div style="font-weight:700;color:var(--accent);">机会池中有 ${res.matchedOpportunities.length} 条相似公告。核对标段和招标轮次后，可关联已有记录。</div>
                ${res.matchedOpportunities.map((m) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);">
                    <div style="min-width:0;flex:1;">
                      <div style="font-weight:600;font-size:13px;">${esc(m.title)}</div>
                      <div class="muted" style="font-size:11px;">${esc(m.matchReason)} · 来源：${esc(m.source)} · 控制价：${m.budgetYuan ? esc(fmtYuan(m.budgetYuan)) : esc(m.budgetText || "未标注")}</div>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary" data-link-existing="${esc(m.id)}">直接转入项目库 →</button>
                  </div>
                `).join("")}
              </div>
            `;
            dupBox.querySelectorAll("[data-link-existing]").forEach((lb) => {
              lb.addEventListener("click", async () => {
                const exId = lb.getAttribute("data-link-existing");
                const fd = new FormData(formEl);
                lb.disabled = true;
                lb.textContent = "转入中…";
                try {
                  const r2 = await api("/projects/import-url", {
                    existingNoticeId: exId,
                    decision: fd.get("decision") || "bidding",
                    companyId: fd.get("companyId") || "",
                    note: fd.get("note") || "从粘贴链接关联机会池已有项目",
                  });
                  wrap.remove();
                  showToast(r2.message || "已将机会池原标段转入项目库！");
                  navigate("/projects/" + r2.id);
                } catch (err2) {
                  showToast(err2.message);
                  lb.disabled = false;
                  lb.textContent = "直接转入项目库 →";
                }
              });
            });
          }
        } catch (err) {
          warnBox.innerHTML = `<div class="notice-box danger" style="margin:0;">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
        } finally {
          pBtn.disabled = false;
          pBtn.textContent = "重新解析";
        }
      });
      let lastImpUrl = "";
      const autoParseImpUrl = () => {
        const u = wrap.querySelector("#imp-url-input")?.value?.trim() || "";
        if (/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(u) && u !== lastImpUrl && !wrap.querySelector("#imp-parse-btn")?.disabled) {
          lastImpUrl = u;
          wrap.querySelector("#imp-parse-btn")?.click();
        }
      };
      wrap.querySelector("#imp-url-input")?.addEventListener("paste", () => setTimeout(autoParseImpUrl, 80));
      wrap.querySelector("#imp-url-input")?.addEventListener("blur", autoParseImpUrl);
      wrap.querySelector("#imp-body")?.addEventListener("paste", () => setTimeout(() => {
        if (wrap.querySelector("#imp-url-input")?.value?.trim()) wrap.querySelector("#imp-parse-btn")?.click();
      }, 100));

      // Step 2: Confirm submit
      formEl.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = wrap.querySelector("#imp-submit");
        btn.disabled = true;
        btn.textContent = "正在查重并录入…";
        msgBox.innerHTML = "";
        try {
          const payload = Object.fromEntries(new FormData(formEl).entries());
          const res = await api("/projects/import-url", payload);
          wrap.remove();
          showToast(res.existed
            ? (res.message || `机会池已收录「${res.title}」，已直接转入项目库！`)
            : `已收录「${res.title}」进入项目库！`);
          navigate("/projects/" + res.id);
        } catch (err) {
          msgBox.innerHTML = `<div class="notice-box danger" style="margin:0;">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
          btn.disabled = false;
          btn.textContent = "确认收录进入项目库";
        }
      });
    });
    slot.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => goP({ decision: b.getAttribute("data-dec") })));
    slot.querySelector("#proj-search").addEventListener("submit", (e) => { e.preventDefault(); goP({ q: String(new FormData(e.target).get("q") || "").trim() }); });
    slot.querySelectorAll("[data-open-proj]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/projects/" + a.getAttribute("data-open-proj")); }));
    slot.querySelectorAll("[data-abandon-proj]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.getAttribute("data-abandon-proj");
        const ptitle = btn.getAttribute("data-ptitle") || pid;
        openRiskDialog({
          title: "放弃参投 / 移出项目库",
          targetLabel: ptitle,
          riskWarning: "放弃后该项目将从项目库移除（标记为不参与），并自动关闭关联未处理提醒；已登记的历史资金流水与审计记录将完整保留。",
          confirmLabel: "确认放弃并移出",
          requireReason: true,
          reasonLabel: "放弃原因（如：资质不符 / 控制价过低 / 人员锁证冲突）",
          danger: true,
          triggerEl: btn,
          onConfirm: async (reason) => {
            await api(`/opportunities/${pid}/follow`, { decision: "declined", assigneeId: null, note: `放弃参投：${reason}` });
            await renderKeepScroll();
            showToast("已移出项目库", {
              actionLabel: "撤回",
              onAction: async () => {
                await api(`/opportunities/${pid}/follow`, { decision: "bidding", assigneeId: null, note: "撤回放弃参投" });
                showToast("已恢复该项目至项目库。");
                renderKeepScroll();
              },
            });
          },
        });
      });
    });
    slot.querySelectorAll("[data-open-step]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const [nid, st] = (a.getAttribute("data-open-step") || "").split(":");
      if (!state.lotStepView) state.lotStepView = {};
      state.lotStepView[nid] = Number(st || 1);
      navigate("/projects/" + nid);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6E. FINANCE LEDGER & URGE (/finance) =================
async function renderFinance(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const slot = renderShell(root, "finance", [
    { label: "岗位首页", href: "/" },
    { label: "资金台账与打款" },
  ], `<div class="card">正在读取待打款任务、多口径资金台账与待退保证金汇总…</div>`);

  try {
    const data = await api("/finance");
    if (!isCurrentRender(root)) return;
    const b = data.balances;
    const payTasks = data.payTasks || [];
    const pendingPayTasks = payTasks.filter((t) => t.status === "pending");
    state.pendingPayCount = pendingPayTasks.length;
    const finTab = qs.get("tab") || (pendingPayTasks.length > 0 || state.perspective === "finance" ? "paytasks" : "recovery"); // paytasks | recovery | ledger
    const catName = { deposit: "现金保证金", guarantee: "投标保函", expense: "标书/代理费", performance_cash: "履约现金", performance_guarantee: "履约保函" };
    const typeName = { paid: "实缴", refund_received: "有效已到账退款", non_refund_deduct: "非退款核减", in_transit: "银行在途", transfer_in: "转入", transfer_out: "转出", guarantee_face: "保函面额", urge: "催退记录" };

    // Aggregate per-project deposit recovery tracker (实缴 / 已退 / 待退余额 / 占用天数 / 催退次数)
    const projMap = new Map();
    const nowMs = Date.now();
    for (const r of (data.entries || [])) {
      if (r.reversed) continue;
      if (r.category !== "deposit" && r.category !== "performance_cash") continue;
      const key = JSON.stringify([r.notice_id, r.company_id]);
      if (!projMap.has(key)) {
        projMap.set(key, {
          noticeId: r.notice_id,
          noticeTitle: r.noticeTitle || r.notice_id,
          category: r.category,
          lotRound: r.lot_round,
          companyId: r.company_id || "",
          companyName: r.companyName || "默认参投主体",
          paidFen: 0,
          refundedFen: 0,
          deductFen: 0,
          urgeCount: 0,
          firstPaidAt: "",
          lastUrgeAt: "",
          lastNote: "",
        });
      }
      const p = projMap.get(key);
      if (r.category !== p.category || r.lot_round !== p.lotRound) p.mixed = true;
      if (r.entry_type === "paid") {
        p.paidFen += Number(r.amount_fen || 0);
        if (!p.firstPaidAt || r.created_at < p.firstPaidAt) p.firstPaidAt = r.created_at;
      } else if (r.entry_type === "refund_received") {
        p.refundedFen += Number(r.amount_fen || 0);
      } else if (r.entry_type === "non_refund_deduct") {
        p.deductFen += Number(r.amount_fen || 0);
      } else if (r.entry_type === "urge") {
        p.urgeCount += 1;
        if (!p.lastUrgeAt || r.created_at > p.lastUrgeAt) p.lastUrgeAt = r.created_at;
        if (r.note) p.lastNote = r.note;
      }
    }
    const recoveryList = [...projMap.values()].map((p) => {
      const outFen = Math.max(0, p.paidFen - p.refundedFen - p.deductFen);
      const paidMs = p.firstPaidAt ? Date.parse(p.firstPaidAt.replace(" ", "T") + "Z") : 0;
      const holdDays = paidMs > 0 ? Math.max(0, Math.floor((nowMs - paidMs) / 86400_000)) : 0;
      return { ...p, outFen, holdDays };
    }).sort((a, b2) => b2.outFen - a.outFen || b2.holdDays - a.holdDays);
    const pendingProjects = recoveryList.filter((p) => p.outFen > 0);
    const overdueCount = pendingProjects.filter((p) => p.holdDays >= 30).length;

    slot.innerHTML = `
      <div class="td-stat-row">
        <div class="td-stat-card ${b.pendingRefundFen > 0 ? "td-danger" : "td-good"}">
          <div class="td-stat-label">在途待退现金保证金（仍占用）</div>
          <div class="td-stat-value" style="color:${b.pendingRefundFen > 0 ? "var(--danger)" : "var(--good)"};">${esc(fmtFen(b.pendingRefundFen))}</div>
          <div class="td-stat-foot"><span>共 ${pendingProjects.length} 个项目未退清${overdueCount > 0 ? ` · ${overdueCount} 个超 30 天` : ""}</span></div>
        </div>
        <div class="td-stat-card td-good">
          <div class="td-stat-label">有效已到账退款</div>
          <div class="td-stat-value" style="color:var(--good);">${esc(fmtFen(b.refundReceivedFen))}</div>
          <div class="td-stat-foot"><span>累计实缴现金：${esc(fmtFen(b.paidFen))}</span></div>
        </div>
        <div class="td-stat-card">
          <div class="td-stat-label">投标保函面额（不占现金）</div>
          <div class="td-stat-value">${esc(fmtFen(b.guaranteeFaceFen))}</div>
          <div class="td-stat-foot"><span>银行在途：${esc(fmtFen(b.inTransitFen))} · 核减：${esc(fmtFen(b.nonRefundDeductFen))}</span></div>
        </div>
        <div class="td-stat-card td-warn" style="justify-content:center;gap:8px;">
          <button class="btn btn-primary btn-sm" id="btn-add-fin">+ 登记保证金 / 催退 / 费用</button>
          <button class="btn btn-sm" id="btn-export-fin-csv">导出保证金对账表 CSV</button>
        </div>
      </div>

      <div class="ws-sheet">
        <div class="td-main-tabs" role="tablist">
          <button type="button" class="td-main-tab ${finTab === "paytasks" ? "active" : ""}" data-fin-tab="paytasks">
            财务待打款任务池 <span class="tab-num" style="${pendingPayTasks.length > 0 ? "background:var(--danger-bg);color:var(--danger);" : ""}">${pendingPayTasks.length} 待打款 / ${payTasks.length}</span>
          </button>
          <button type="button" class="td-main-tab ${finTab === "recovery" ? "active" : ""}" data-fin-tab="recovery">
            按项目催退回款看板 <span class="tab-num">${pendingProjects.length} 待退</span>
          </button>
          <button type="button" class="td-main-tab ${finTab === "ledger" ? "active" : ""}" data-fin-tab="ledger">
            全部资金流水明细 <span class="tab-num">${data.entries.length}</span>
          </button>
        </div>

        <div class="ws-sec" style="padding-top:6px;">
          ${finTab === "paytasks" ? (payTasks.length ? `
            <div class="muted" style="margin-bottom:10px;">投标员在项目阶段 3 推送的保证金打款任务会直达此处（默认指派给财务：<strong>${esc(state.settings?.defaultFinanceUserName || "未指定财务负责人")}</strong>）。打款后点击「确认打款并上传回执」，支持 <strong>Ctrl+V 粘贴回执截图 / 拖拽 / 多图上传</strong>，提交后自动入账并推进项目进度。</div>
            <div style="display:grid;gap:12px;">
              ${payTasks.map((pt) => {
                const isPending = pt.status === "pending";
                return `
                  <div class="card" style="margin:0;border-color:${isPending ? "var(--danger-border)" : "var(--good-border)"};background:${isPending ? "var(--surface)" : "var(--surface-2)"};">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                      <div style="min-width:260px;flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                          ${isPending ? badge("danger", "clock", "待财务打款") : badge("good", "check", "已打款并入账")}
                          <span class="prov">${esc(pt.deposit_method || "基本户转账")}</span>
                          <span class="muted" style="font-size:12px;">指派财务：<strong>${esc(pt.assignee_name || "未指定财务负责人")}</strong> · 发起人：${esc(pt.requester_name || "-")}</span>
                        </div>
                        <a class="row-title" style="font-size:15px;" href="/projects/${esc(pt.notice_id)}" data-go="/projects/${esc(pt.notice_id)}">${esc(pt.noticeTitle || pt.notice_id)}</a>
                        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;padding:10px 12px;border-radius:var(--radius);background:var(--surface-2);border:1px solid var(--border);font-size:12.5px;">
                          <div><span class="muted">参投公司：</span><strong>${esc(pt.companyName || "默认公司")}</strong></div>
                          <div><span class="muted">收款户名：</span><strong>${esc(pt.payee_name || "未填")}</strong></div>
                          <div>
                            <span class="muted">收款账号：</span><strong class="num">${esc(pt.payee_account || "未填")}</strong>
                            ${pt.payee_account ? `<button type="button" class="quick-pill" style="margin-left:6px;padding:1px 6px;" data-copy-txt="${esc(pt.payee_account)}">复制</button>` : ""}
                          </div>
                          <div><span class="muted">开户银行：</span><strong>${esc(pt.payee_bank || "未填")}</strong></div>
                          ${pt.due_time ? `<div><span class="muted">要求截止：</span><strong style="color:var(--danger);">${esc(pt.due_time)}</strong></div>` : ""}
                          ${pt.note ? `<div><span class="muted">附言/备注：</span>${esc(pt.note)}</div>` : ""}
                        </div>
                        ${(pt.receiptFiles || []).length ? `
                          <div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <span class="muted" style="font-size:12px;">已传回执凭据：</span>
                            ${pt.receiptFiles.map((rf) => `<button type="button" class="btn btn-sm" data-preview-file="${esc(rf.fileId)}" data-fname="${esc(rf.fileName || "回执凭据.png")}">${esc(rf.fileName || "回执截图")}</button>`).join("")}
                            ${pt.receipt_note ? `<span class="muted" style="font-size:12px;">（${esc(pt.receipt_note)}）</span>` : ""}
                          </div>
                        ` : ""}
                      </div>
                      <div style="text-align:right;min-width:170px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
                        <div>
                          <div class="muted" style="font-size:11.5px;">需打款金额</div>
                          <div class="num" style="font-size:20px;font-weight:700;color:${isPending ? "var(--danger)" : "var(--good)"};">${esc(fmtFen(pt.amount_fen))}</div>
                        </div>
                        ${isPending ? `
                          <button type="button" class="btn btn-primary" data-confirm-pay="${esc(pt.id)}">✓ 确认打款并上传回执</button>
                        ` : `<span class="muted" style="font-size:12px;">打款时间：${esc(pt.paid_at || "")}</span>`}
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          ` : `<div class="empty-state"><strong>暂无待财务打款任务</strong><div>在「项目库」任意项目详情页的「阶段 3：保证金付款」中填写账户与金额并推送给财务后，任务会实时出现在这里。</div></div>`)
          : finTab === "recovery" ? (recoveryList.length ? `
            <div class="muted" style="margin-bottom:10px;">自动按标段合并「实缴 vs 已退」，无需人工对流水；点击右侧即可一键登记催退记录或核销全额退回到账。</div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th style="min-width:280px;">项目标段 / 参投公司</th>
                    <th class="amount">累计实缴</th>
                    <th class="amount">已退到账</th>
                    <th class="amount">待退余额</th>
                    <th>占用时长与催退状态</th>
                    <th style="width:190px;">快捷催退 / 回款核销</th>
                  </tr>
                </thead>
                <tbody>
                  ${recoveryList.map((p) => `
                    <tr>
                      <td>
                        <a class="row-title" href="/projects/${esc(p.noticeId)}" data-go="/projects/${esc(p.noticeId)}">${esc(p.noticeTitle)}</a>
                        <div class="muted">${esc(p.companyName)} · ${p.mixed ? "多类或多轮资金合计" : esc(p.lotRound + " · " + catName[p.category])}${p.firstPaidAt ? ` · 首次打款：${esc(p.firstPaidAt.slice(0, 10))}` : ""}</div>
                      </td>
                      <td class="amount num">${esc(fmtFen(p.paidFen))}</td>
                      <td class="amount num" style="color:var(--good);">${esc(fmtFen(p.refundedFen))}</td>
                      <td class="amount num" style="font-weight:700;color:${p.outFen > 0 ? "var(--danger)" : "var(--good)"};">${p.outFen > 0 ? esc(fmtFen(p.outFen)) : "已退清"}</td>
                      <td>
                        ${p.outFen > 0
                          ? (p.holdDays >= 30 ? badge("danger", "alert", `已占用 ${p.holdDays} 天 · 建议立即催退`) : badge("warn", "clock", `已占用 ${p.holdDays} 天`))
                          : badge("good", "check", "回款闭环")}
                        ${p.urgeCount > 0 ? `<div class="muted" style="font-size:11px;margin-top:3px;">已催退 ${p.urgeCount} 次（最近 ${esc(p.lastUrgeAt.slice(0, 10))}）${p.lastNote ? `· ${esc(p.lastNote)}` : ""}</div>` : ""}
                      </td>
                      <td>
                        ${p.mixed && p.outFen > 0 ? `<a href="/finance?tab=ledger" data-go="/finance?tab=ledger">核对分笔流水</a>` : p.outFen > 0 ? `
                          <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button type="button" class="quick-pill" data-quick-urge="${esc(p.noticeId)}" data-co="${esc(p.companyId)}" data-category="${esc(p.category)}" data-round="${esc(p.lotRound)}" data-amt="${(p.outFen / 100).toFixed(2)}">登记催退</button>
                            <button type="button" class="quick-pill" style="color:var(--good);border-color:rgba(0,168,112,0.4);font-weight:600;" data-quick-refund="${esc(p.noticeId)}" data-co="${esc(p.companyId)}" data-category="${esc(p.category)}" data-round="${esc(p.lotRound)}" data-amt="${(p.outFen / 100).toFixed(2)}">✓ 已全额到账</button>
                          </div>
                        ` : `<a class="quick-pill" href="/projects/${esc(p.noticeId)}" data-go="/projects/${esc(p.noticeId)}">查看项目台账</a>`}
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state"><strong>当前暂无保证金打款记录</strong><div>在项目库详情页「阶段 3：保证金付款」或点击右上角「+ 登记保证金」后，系统将自动在此追踪每笔保证金的占用天数与回款进度。</div></div>`) : `
            ${data.entries.length ? `
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>时间 / 标段与公司</th>
                      <th>用途 / 口径</th>
                      <th class="amount">金额（元）</th>
                      <th>分维度状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.entries.map((r) => `
                      <tr style="${r.reversed ? "opacity:0.55;" : ""}">
                        <td>
                          <a class="row-title" href="/projects/${esc(r.notice_id)}" data-go="/projects/${esc(r.notice_id)}">${esc(r.noticeTitle || r.notice_id)}</a>
                          <div class="muted num">${esc(r.created_at)} 北京时间 · ${esc(r.companyName || "未指定公司")} · ${esc(r.lot_round)} · 经办：${esc(r.actor_name)}</div>
                          ${r.note ? `<div class="muted">备注：${esc(r.note)}</div>` : ""}
                          ${r.reversed ? `<div class="muted" style="color:var(--danger);">已冲销（保留历史）：${esc(r.reverse_reason)}</div>` : ""}
                        </td>
                        <td>
                          <span class="prov">${esc(catName[r.category] || r.category)}</span>
                          <div style="margin-top:4px;">${badge(r.entry_type === "refund_received" ? "good" : r.entry_type === "urge" ? "warn" : "info", "file", typeName[r.entry_type] || r.entry_type)}</div>
                        </td>
                        <td class="amount num" style="font-weight:600;">${esc(fmtFen(r.amount_fen))}</td>
                        <td class="muted">
                          <div>支付：${esc(r.pay_status)} · 到账：${esc(r.receive_status)}</div>
                          <div>退款条件：${esc(r.refund_cond)} · 退款：${esc(r.refund_status)}</div>
                          ${r.dispute_status && r.dispute_status !== "无争议" ? badge("danger", "alert", r.dispute_status) : ""}
                        </td>
                        <td>
                          ${!r.reversed ? `<button class="btn btn-sm btn-danger" data-rev="${esc(r.id)}">冲销</button>` : badge("quiet", "x", "已冲销")}
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="empty-state"><strong>暂无资金流水记录</strong><div>点击「+ 登记保证金 / 催退 / 费用」为项目库中的标段记录资金流水。</div></div>`}
          `}
        </div>
      </div>
    `;

    slot.querySelectorAll("[data-fin-tab]").forEach((btn) => btn.addEventListener("click", () => navigate("/finance?tab=" + btn.getAttribute("data-fin-tab"))));

    slot.querySelectorAll("[data-copy-txt]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const txt = btn.getAttribute("data-copy-txt") || "";
        try { await navigator.clipboard.writeText(txt); showToast("已复制收款账号：" + txt); } catch { showToast("账号：" + txt); }
      });
    });

    slot.querySelectorAll("[data-confirm-pay]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = btn.getAttribute("data-confirm-pay");
        const task = payTasks.find((t) => t.id === tid);
        if (!task) return;
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" style="max-width:560px;">
            <h3 style="margin:0 0 8px;">财务确认已打款并上传回执截图</h3>
            <div style="padding:10px 12px;border-radius:var(--radius);background:var(--surface-2);border:1px solid var(--border);font-size:12.5px;margin-bottom:12px;">
              <div><strong>${esc(task.noticeTitle || task.notice_id)}</strong></div>
              <div style="margin-top:4px;">打款金额：<strong style="color:var(--danger);">${esc(fmtFen(task.amount_fen))}</strong> · 形式：${esc(task.deposit_method || "")}</div>
              <div class="muted" style="margin-top:2px;">收款户名：${esc(task.payee_name || "-")} · 账号：${esc(task.payee_account || "-")} · 开户行：${esc(task.payee_bank || "-")}</div>
            </div>
            <form id="confirm-pay-form">
              <div class="field">
                <label>打款执行状态</label>
                <select class="select" name="payStatus">
                  <option value="已打款">已打款（网银/基本户已汇出）</option>
                  <option value="已出保函/保单">已出保函 / 电子保单</option>
                  <option value="已现金密封交接">已现金信封密封交接</option>
                </select>
              </div>
              <div class="field">
                <label>银行回单号 / 打款说明（选填）</label>
                <input class="input" name="receiptNote" placeholder="例如：工行网银流水号 20261124001 / 已核对子账号" />
              </div>
              <div class="field">
                <label>上传回执截图 / 电子回单 PDF（支持 Ctrl+V 粘贴截图、拖拽、多选）</label>
                <div id="pay-receipt-uz"></div>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                <button type="button" class="btn" id="cp-cancel">取消</button>
                <button type="submit" class="btn btn-primary" id="cp-submit">确认已打款并入账</button>
              </div>
            </form>
          </div>`;
        const uz = attachUniversalDropzone(wrap.querySelector("#pay-receipt-uz"), {
          multiple: true,
          accept: "image/png,image/jpeg,image/webp,application/pdf,.pdf",
          title: "点击多选、拖拽回执文件，或直接 Ctrl+V 粘贴银行打款截图",
          hint: "支持同时上传多张回执截图或 PDF 回单，将加密存入腾讯云 COS 并自动关联至本项目",
          pasteScope: wrap,
        });
        const subBtn = wrap.querySelector("#cp-submit");
        const ownerRoute = committedRoute;
        const isActive = () => wrap.isConnected && !wrap.classList.contains("dialog-exiting") && state.route === ownerRoute;
        const dismiss = () => { if (!subBtn.disabled) close(); };
        const close = mountDialog(wrap, { initial: "#cp-cancel", trigger: btn, onEscape: dismiss, onClose: () => uz.destroy() });
        wrap.querySelector("#cp-cancel").addEventListener("click", dismiss);
        wrap.addEventListener("click", (event) => { if (event.target === wrap) dismiss(); });
        wrap.querySelector("#confirm-pay-form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          if (!isActive() || subBtn.disabled) return;
          setSubmitPending(subBtn, true);
          try {
            const fd = new FormData(ev.target);
            const picked = uz.getFiles();
            const receipts = [];
            for (const f of picked) {
              receipts.push({ filename: f.name, dataBase64: await fileToBase64(f) });
            }
            if (!isActive()) return;
            await api(`/finance/pay-tasks/${tid}/confirm`, {
              payStatus: String(fd.get("payStatus") || "已打款"),
              receiptNote: String(fd.get("receiptNote") || "").trim(),
              receipts,
            });
            if (!isActive()) return;
            close();
            showToast(`已确认打款并上传 ${receipts.length} 份回执凭据，项目进度已自动推进！`);
            render();
          } catch (err) {
            if (!isActive()) return;
            showToast(err.message, { error: true });
            setSubmitPending(subBtn, false);
          }
        });
      });
    });
    slot.querySelector("#btn-export-fin-csv")?.addEventListener("click", () => {
      const rows = recoveryList.map((p) => [
        p.noticeTitle, p.companyName, p.mixed ? "合计" : p.lotRound, p.mixed ? "合计" : catName[p.category], (p.paidFen / 100).toFixed(2), (p.refundedFen / 100).toFixed(2),
        (p.outFen / 100).toFixed(2), `${p.holdDays}天`, p.urgeCount, p.lastNote || "",
      ]);
      downloadCsvFile(
        `投标保证金回款对账表_${new Date().toISOString().slice(0, 10)}.csv`,
        ["项目名称", "参投公司", "标段轮次", "资金类别", "实缴金额(元)", "已退到账(元)", "待退余额(元)", "占用天数", "已催退次数", "最近催退备注"],
        rows
      );
    });
    slot.querySelectorAll("[data-quick-urge]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const note = await promptAsync("请输入本次催退联系记录（如：已致电代理机构张工，预计本周五原路退回）：", "已联系交易中心/代理催退");
        if (!note || !note.trim()) return;
        try {
          await api("/finance", {
            noticeId: btn.getAttribute("data-quick-urge"),
            companyId: btn.getAttribute("data-co") || "",
            quickBalance: true,
            lotRound: btn.dataset.round,
            category: btn.dataset.category,
            entryType: "urge",
            amountYuan: Number(btn.getAttribute("data-amt") || 0),
            payStatus: "已扣款",
            receiveStatus: "未标注",
            refundCond: "已满足",
            refundStatus: "已申请",
            note: note.trim(),
          });
          showToast("已登记保证金催退记录并留痕。");
          render();
        } catch (err) { showToast(err.message); }
      });
    });
    slot.querySelectorAll("[data-quick-refund]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const amt = btn.getAttribute("data-amt");
        if (!await confirmAsync(`确认该标段待退保证金 ${amt} 元已全额退回基本户到账？`)) return;
        const note = await promptAsync("可选填写银行回单号或到账备注：", "交易中心已原路全额退回基本户");
        if (note === null) return;
        try {
          await api("/finance", {
            noticeId: btn.getAttribute("data-quick-refund"),
            companyId: btn.getAttribute("data-co") || "",
            quickBalance: true,
            lotRound: btn.dataset.round,
            category: btn.dataset.category,
            entryType: "refund_received",
            amountYuan: Number(amt || 0),
            payStatus: "已扣款",
            receiveStatus: "已核实到账",
            refundCond: "已满足",
            refundStatus: "退清",
            note: note.trim(),
          });
          showToast("已核销保证金全额退回到账！");
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
    slot.querySelectorAll("[data-rev]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reason = await promptAsync("冲销流水属于高风险操作，必须填写冲销原因（历史记录将保留，不会删除）：");
        if (!reason || !reason.trim()) return;
        try {
          await api(`/finance/${btn.getAttribute("data-rev")}/reverse`, { reason: reason.trim() });
          showToast("已冲销该笔流水，历史记录已保留。");
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    slot.querySelector("#btn-add-fin").addEventListener("click", () => {
      if (!data.selectedProjects.length) {
        showToast("请先在「机会池」选定至少一个项目加入项目库，再登记资金流水。");
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3 style="margin:0 0 10px;">登记资金流水或催退记录</h3>
          <div class="notice-box warn" style="font-size:12px;">${ICONS.info}<span>发起催办前请先核对当前待退余额（<strong>${esc(fmtFen(b.pendingRefundFen))}</strong>）；催办记录不改变退款到账状态。</span></div>
          <form id="fin-add-form">
            <div class="field"><label>关联项目（来自项目库）</label><select class="select" name="noticeId" required>${data.selectedProjects.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}</select></div>
            <div class="field"><label>参投公司</label><select class="select" name="companyId"><option value="">未指定</option>${state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
            <div class="field"><label>用途</label><select class="select" name="category"><option value="deposit">现金保证金</option><option value="guarantee">投标保函</option><option value="expense">标书/代理费</option><option value="performance_cash">履约现金</option><option value="performance_guarantee">履约保函</option></select></div>
            <div class="field"><label>记录口径</label><select class="select" name="entryType"><option value="paid">实缴现金</option><option value="refund_received">有效已到账退款</option><option value="in_transit">银行在途</option><option value="non_refund_deduct">非退款核减（必填原因）</option><option value="guarantee_face">保函面额</option><option value="transfer_in">转入</option><option value="transfer_out">转出</option><option value="urge">催退记录</option></select></div>
            <div class="field"><label>金额（元，两位小数）</label><input class="input num" type="number" step="0.01" min="0" name="amountYuan" required value="0.00" /></div>
            <div class="field"><label>支付与到账状态</label><div style="display:flex;gap:8px;"><select class="select" name="payStatus" style="flex:1;"><option>已扣款</option><option>申请中</option><option>银行在途</option><option>支付退回</option><option>已撤销</option></select><select class="select" name="receiveStatus" style="flex:1;"><option>未标注</option><option>已核实到账</option><option>到账异常</option></select></div></div>
            <div class="field"><label>退款条件与进度</label><div style="display:flex;gap:8px;"><select class="select" name="refundCond" style="flex:1;"><option>未核实</option><option>条件未明</option><option>条件待满足</option><option>已满足</option></select><select class="select" name="refundStatus" style="flex:1;"><option>未申请</option><option>已申请</option><option>对方受理</option><option>银行在途</option><option>部分到账</option><option>退清</option><option>退回重办</option></select></div></div>
            <div class="field"><label>依据 / 备注（非退款核减必填）</label><input class="input" name="note" placeholder="银行回单号、保函编号或催退反馈" /></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="fin-cancel">取消</button><button type="submit" class="btn btn-primary">确认登记</button></div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#fin-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#fin-add-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api("/finance", Object.fromEntries(new FormData(e.target).entries()));
          wrap.remove();
          showToast("已登记资金记录并留痕。");
          render();
        } catch (err) { showToast(err.message); }
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6F. SYSTEM SETTINGS (/settings) =================
async function renderSettings(root) {
  const slot = renderShell(root, "settings", [
    { label: "岗位首页", href: "/" },
    { label: "系统管理" },
  ], `<div class="card">正在读取系统配置…</div>`);

  try {
    const [s, diag] = await Promise.all([
      api("/settings"),
      api("/system/diagnostics").catch(() => null),
    ]);
    if (!isCurrentRender(root)) return;
    state.settings = s;
    const ai = s.ai || { baseUrl: "https://api.example.invalid/v1", defaultModel: "deepseek-v4.1-flash", hasApiKey: false, keySource: "none" };
    const dicts = s.fieldDicts || {};
    const isAdmin = state.user.role === "admin";
    const canConfigureRoles = isAdmin;
    const canEditDicts = true;
    const empList = s.employees || state.employees || [];
    const DICT_GROUPS = [
      { key: "depositMethods", label: "阶段 3 · 保证金缴纳 / 担保形式（含现金信封现场递交）" },
      { key: "depositStatuses", label: "阶段 3 · 保证金办理 / 到账状态" },
      { key: "docBuyStatuses", label: "阶段 1 · 标书获取状态" },
      { key: "prepStatuses", label: "阶段 2 · 标书制作进度状态" },
      { key: "refundStatuses", label: "阶段 7 · 保证金退回进度状态" },
      { key: "enterpriseCategories", label: "公司资料库 · 企业资质类别" },
    ];
    const fmtUptime = (sec) => {
      if (!sec) return "-";
      const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
      return d > 0 ? `${d}天 ${h}小时` : h > 0 ? `${h}小时 ${m}分` : `${m}分钟`;
    };

    slot.innerHTML = `
      ${renderSystemTabs("settings")}
      ${diag ? `
        <div class="card">
          <div class="card-head">
            <div>
              <h2>系统运行健康与性能诊断</h2>
              <div class="muted" style="font-size:12.5px;margin-top:2px;">服务端实时状态、数据库体量、采集源健康度与 30/7 天证件到期自动巡检调度。</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-primary" id="btn-sys-scan-expiry">立即巡检 30/7 天到期提醒</button>
              <button type="button" class="btn btn-sm" data-go="/sources">来源健康核验</button>
              <button type="button" class="btn btn-sm" data-go="/alerts?kind=expiry">查看资料到期待办 (${diag.counts?.expiryOpen ?? 0})</button>
            </div>
          </div>
          <div class="td-stat-row" style="margin-bottom:0;">
            <div class="td-stat-card ${diag.sources?.unhealthy > 0 ? "td-warn" : "td-good"}">
              <div class="td-stat-label">采集源健康状态</div>
              <div class="td-stat-value num">${diag.sources?.healthy ?? 0} / ${diag.sources?.enabled ?? 0}</div>
              <div class="td-stat-foot"><span>${diag.sources?.unhealthy > 0 ? `${diag.sources.unhealthy} 个源异常` : "全部启用源正常"} · ${diag.sources?.disabled ?? 0} 个已停用</span></div>
            </div>
            <div class="td-stat-card">
              <div class="td-stat-label">核心数据资产体量</div>
              <div class="td-stat-value num">${diag.counts?.notices ?? 0} <span style="font-size:13px;font-weight:400;" class="muted">条公告</span></div>
              <div class="td-stat-foot"><span>资料 ${diag.counts?.docs ?? 0} · 人员 ${diag.counts?.people ?? 0} · COS 原件 ${diag.counts?.files ?? 0}</span></div>
            </div>
            <div class="td-stat-card">
              <div class="td-stat-label">服务内存与库体积</div>
              <div class="td-stat-value num">${diag.memoryMb?.rss ?? 0} MB</div>
              <div class="td-stat-foot"><span>SQLite ${diag.dbSizeMb ?? 0} MB · 在线 ${fmtUptime(diag.uptimeSeconds)}</span></div>
            </div>
            <div class="td-stat-card td-good">
              <div class="td-stat-label">传输加速与安全加固</div>
              <div class="td-stat-value" style="font-size:16px;">Brotli + Gzip + ETag</div>
              <div class="td-stat-foot"><span>WAL 内存缓存 · ${diag.cosConfigured ? "COS 已就绪" : "COS 未配置"} · ${esc(diag.nodeVersion || "")}</span></div>
            </div>
          </div>
        </div>
      ` : ""}
      <div class="card">
        <div class="card-head">
          <div>
            <h2>成员岗位首页角色配置 &amp; 默认保证金财务指派</h2>
            <div class="muted" style="font-size:12.5px;margin-top:2px;">各成员不可自行切换岗位视角；各成员登录后看到的「岗位首页」类型仅由 管理员在此统一配置。</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${canConfigureRoles ? badge("good", "check", "管理员可配置") : badge("quiet", "lock", "仅 管理员可调整")}
            ${isAdmin ? `<button type="button" class="btn btn-sm" id="btn-go-accounts">账号与授权管理</button><button type="button" class="btn btn-sm" id="btn-go-audit">操作审计日志</button>` : ""}
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:var(--radius);background:var(--accent-soft);border:1px solid var(--accent-border);margin-bottom:14px;">
          <div>
            <strong style="font-size:13.5px;color:var(--accent);">默认保证金打款财务人员：${esc(s.defaultFinanceUserName || "未指定财务负责人")}</strong>
            <div class="muted" style="font-size:12px;margin-top:2px;">所有项目在阶段 3 发起「推送保证金打款任务」时，默认自动指派给该财务人员接收账户/金额详情并执行打款与回执上传。</div>
          </div>
          ${canConfigureRoles ? `
            <div style="display:flex;gap:8px;align-items:center;">
              <select class="select" id="sel-default-finance" style="height:34px;min-width:160px;">
                ${empList.map((e) => `<option value="${esc(e.id)}" ${e.id === s.defaultFinanceUserId ? "selected" : ""}>${esc(e.name)} (${esc(e.username)})</option>`).join("")}
              </select>
              <button type="button" class="btn btn-primary btn-sm" id="btn-save-default-fin">保存默认财务</button>
            </div>
          ` : ""}
        </div>

        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>成员姓名</th>
                <th>登录账号</th>
                <th>系统角色</th>
                <th>当前固定岗位首页</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${empList.map((emp) => {
                const curP = ROLES[emp.perspective] ? emp.perspective : "lead";
                return `
                  <tr>
                    <td><strong>${esc(emp.name)}</strong>${emp.id === s.defaultFinanceUserId ? ` <span class="badge badge-warn">默认财务</span>` : ""}</td>
                    <td class="num muted">${esc(emp.username)}</td>
                    <td>${emp.role === "admin" ? badge("info", "shield", "管理员") : badge("good", "check", "全权限成员")}</td>
                    <td>
                      ${canConfigureRoles ? `
                        <select class="select" data-emp-persp="${esc(emp.id)}" style="height:32px;min-width:150px;">
                          ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${curP === k ? "selected" : ""}>${esc(v.name)}首页</option>`).join("")}
                        </select>
                      ` : badge("info", "home", `${ROLES[curP]?.name || "负责人"}首页`)}
                    </td>
                    <td class="muted" style="font-size:12px;">${esc(ROLES[curP]?.focus || "")}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>项目选定、协作与界面标签设置</h2></div>
        <form id="settings-form" style="display:flex;flex-direction:column;gap:12px;">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
            <input type="checkbox" name="requireAssigneeOnSelect" ${s.requireAssigneeOnSelect ? "checked" : ""} style="margin-top:3px;" />
            <div>
              <strong>选定项目时指定对接负责人</strong>
              <div class="muted">默认关闭：在机会详情页右上角点击「选定参投 / 选定跟进」后直接进入「项目库」，不弹窗询问由谁对接。后期团队需要明确分工时可在此随时开启。</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
            <input type="checkbox" name="showWatchKeywords" ${s.showWatchKeywords !== false ? "checked" : ""} style="margin-top:3px;" />
            <div>
              <strong>显示机会池「关注词高亮与快筛标签栏」</strong>
              <div class="muted">取消勾选即可关闭：隐藏机会池顶部的关注词标签栏，并取消公告标题内的关注词高亮色块。</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
            <input type="checkbox" name="showOppTags" ${s.showOppTags !== false ? "checked" : ""} style="margin-top:3px;" />
            <div>
              <strong>显示机会池公告下方的分类与资格标签</strong>
              <div class="muted">取消勾选即可关闭：隐藏机会池「资格快选」标签以及每条公告下方的地区/行业/资质标签行，仅保留极简标题与关键数字。</div>
            </div>
          </label>
          <div><button class="btn btn-primary" type="submit">保存协作与显示设置</button></div>
        </form>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>业务表单字段与下拉选项配置（自由增删）</h2>
          ${canEditDicts ? badge("good", "check", "可编辑") : badge("quiet", "lock", "仅管理员/负责人可修改")}
        </div>
        <div class="muted" style="margin-bottom:12px;">可按公司实际投标流程自由新增或删除各阶段表单下拉选项（例如保证金“现金（信封密封现场递交）”等），保存后全系统表单即时生效。</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;">
          ${DICT_GROUPS.map((g) => {
            const arr = dicts[g.key] || [];
            return `
              <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);" data-dict-box="${esc(g.key)}">
                <strong style="font-size:13px;display:block;margin-bottom:8px;">${esc(g.label)}</strong>
                <div class="meta-row" style="margin-bottom:8px;gap:6px;" data-dict-list="${esc(g.key)}">
                  ${arr.map((item) => `
                    <span class="opp-active-pill">
                      ${esc(item)}
                      ${canEditDicts ? `<button type="button" data-dict-del="${esc(g.key)}" data-val="${esc(item)}" title="删除该选项">×</button>` : ""}
                    </span>
                  `).join("")}
                </div>
                ${canEditDicts ? `
                  <div style="display:flex;gap:6px;">
                    <input class="input" data-dict-inp="${esc(g.key)}" placeholder="输入新选项名称…" style="flex:1;height:30px;font-size:12px;" />
                    <button type="button" class="btn btn-sm btn-primary" data-dict-add="${esc(g.key)}">+ 新增</button>
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>江苏 TokenHub AI 接口配置（服务端代理）</h2>
          ${ai.hasApiKey ? badge("good", "check", `已配置密钥（来源：${ai.keySource === "settings" ? "系统设置" : "服务端环境变量"}）`) : badge("warn", "alert", "尚未配置密钥")}
        </div>
        <p class="muted" style="margin:0 0 12px;">
          密钥仅保存在服务端受控数据库（0600 权限），<strong>只写不回显</strong>，绝不下发至浏览器或日志。保存后立即生效，无需重启服务。
        </p>
        ${isAdmin ? `
          <form id="ai-settings-form">
            <div class="field">
              <label for="ai-base">API Base URL（OpenAI 兼容接口）</label>
              <input id="ai-base" class="input" name="baseUrl" value="${esc(ai.baseUrl)}" required placeholder="https://api.example.invalid/v1" />
            </div>
            <div class="field">
              <label for="ai-model">默认模型 ID</label>
              <input id="ai-model" class="input" name="defaultModel" value="${esc(ai.defaultModel)}" required placeholder="deepseek-v4.1-flash" />
              <span class="field-hint">默认使用 deepseek v4.1 flash；点击下方「测试连通并拉取模型」后可直接点选接口返回的精确模型 ID。</span>
            </div>
            <div class="field">
              <label for="ai-key">TokenHub API Key（只写不回显）</label>
              <input id="ai-key" class="input" type="password" name="apiKey" autocomplete="off" placeholder="${ai.hasApiKey ? "已配置密钥；如需更换请在此输入新密钥，留空保持不变" : "请输入江苏 TokenHub API Key"}" />
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <button class="btn btn-primary" type="submit">保存 AI 配置</button>
              <button class="btn" type="button" id="btn-test-ai">测试连通并拉取模型列表</button>
              ${ai.keySource === "settings" ? `<button class="btn btn-danger" type="button" id="btn-clear-ai-key">清除已存密钥</button>` : ""}
            </div>
          </form>
          <div id="ai-test-out" style="margin-top:12px;"></div>
        ` : `
          <div class="notice-box">${ICONS.lock}<span>仅管理员可修改 TokenHub API Key 与模型配置；当前接口地址：<code>${esc(ai.baseUrl)}</code>，默认模型：<code>${esc(ai.defaultModel)}</code>。</span></div>
        `}
      </div>
    `;

    slot.querySelector("#btn-go-accounts")?.addEventListener("click", () => navigate("/admin/accounts"));
    slot.querySelector("#btn-go-audit")?.addEventListener("click", () => navigate("/admin/audit"));
    slot.querySelector("#btn-sys-scan-expiry")?.addEventListener("click", async () => {
      try {
        const res = await api("/system/scan-expiry", {});
        showToast(`到期巡检完成：扫描 ${res.scanned} 项，新写入 ${res.created} 条待办，完结 ${res.resolved} 条，当前共 ${res.openTotal} 条资料到期预警。`);
        renderKeepScroll();
      } catch (err) { showToast(err.message); }
    });

    slot.querySelector("#btn-save-default-fin")?.addEventListener("click", async () => {
      const fid = slot.querySelector("#sel-default-finance")?.value || "";
      try {
        const res = await api("/settings", { defaultFinanceUserId: fid });
        state.settings = { ...state.settings, defaultFinanceUserId: res.defaultFinanceUserId, defaultFinanceUserName: res.defaultFinanceUserName };
        showToast(`默认保证金打款财务已更新为「${res.defaultFinanceUserName || "未指定"}」。`);
        render();
      } catch (err) { showToast(err.message); }
    });

    slot.querySelectorAll("[data-emp-persp]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const employeeId = sel.getAttribute("data-emp-persp");
        const perspective = sel.value;
        try {
          await api("/settings", { userPerspective: { employeeId, perspective } });
          if (employeeId === state.user.id) {
            state.user.perspective = perspective;
            state.perspective = perspective;
          }
          showToast(`已更新该成员岗位首页为「${ROLES[perspective]?.name || perspective}首页」。`);
          render();
        } catch (err) { showToast(err.message); }
      });
    });

    slot.querySelector("#settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const showWatchKeywords = !!fd.get("showWatchKeywords");
      const showOppTags = !!fd.get("showOppTags");
      const res = await api("/settings", {
        requireAssigneeOnSelect: !!fd.get("requireAssigneeOnSelect"),
        showWatchKeywords,
        showOppTags,
      });
      state.settings = {
        ...state.settings,
        requireAssigneeOnSelect: !!res.requireAssigneeOnSelect,
        showWatchKeywords,
        showOppTags,
        fieldDicts: res.fieldDicts || state.settings.fieldDicts,
      };
      showToast("协作与标签显示设置已保存，立即生效。");
    });

    async function saveDictChange(groupKey, nextArr) {
      if (!nextArr.length) { showToast("至少保留 1 个有效选项。"); return; }
      try {
        const res = await api("/settings", { fieldDicts: { [groupKey]: nextArr } });
        state.settings = { ...state.settings, fieldDicts: res.fieldDicts };
        showToast("业务字段选项已更新并全系统生效。");
        render();
      } catch (err) { showToast(err.message); }
    }
    slot.querySelectorAll("[data-dict-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-dict-add");
        const inp = slot.querySelector(`[data-dict-inp="${k}"]`);
        const val = inp?.value?.trim();
        if (!val) { showToast("请输入要新增的选项名称。"); return; }
        const cur = [...(dicts[k] || [])];
        if (!cur.includes(val)) cur.push(val);
        saveDictChange(k, cur);
      });
    });
    slot.querySelectorAll("[data-dict-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-dict-del");
        const val = btn.getAttribute("data-val");
        const cur = (dicts[k] || []).filter((x) => x !== val);
        saveDictChange(k, cur);
      });
    });

    slot.querySelector("#ai-settings-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api("/settings/ai", {
          baseUrl: String(fd.get("baseUrl") || "").trim(),
          defaultModel: String(fd.get("defaultModel") || "").trim(),
          apiKey: String(fd.get("apiKey") || "").trim(),
        });
        showToast("TokenHub AI 配置已保存并立即生效（已记入审计日志）。");
        render();
      } catch (err) {
        showToast(err.message);
      }
    });

    slot.querySelector("#btn-clear-ai-key")?.addEventListener("click", async () => {
      if (!await confirmAsync("确认清除系统设置中保存的 TokenHub API Key？")) return;
      try {
        await api("/settings/ai", { clearKey: true });
        showToast("已清除已存密钥。");
        render();
      } catch (err) { showToast(err.message); }
    });

    slot.querySelector("#btn-test-ai")?.addEventListener("click", async () => {
      const out = slot.querySelector("#ai-test-out");
      out.innerHTML = `<div class="muted">正在通过服务端测试 TokenHub 连通性并拉取 /v1/models…</div>`;
      try {
        const res = await api("/settings/ai/test", {});
        const chips = (res.deepseekModels?.length ? res.deepseekModels : res.models || []).slice(0, 20);
        out.innerHTML = `
          <div class="notice-box" style="flex-direction:column;">
            <div><strong>${esc(res.message)}</strong></div>
            ${chips.length ? `<div class="chips"><span class="muted">点击填入模型 ID：</span>${chips.map((m) => `<button type="button" class="chip" data-pick-model="${esc(m)}">${esc(m)}</button>`).join("")}</div>` : ""}
          </div>`;
        out.querySelectorAll("[data-pick-model]").forEach((c) => {
          c.addEventListener("click", () => {
            slot.querySelector("#ai-model").value = c.getAttribute("data-pick-model");
            showToast(`已填入模型 ID：${c.getAttribute("data-pick-model")}，请点击「保存 AI 配置」生效。`);
          });
        });
      } catch (err) {
        out.innerHTML = `<div class="notice-box danger">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
      }
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6G. OPENING RETURN (/opening, mobile-first) =================
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片格式不受支持"));
      img.onload = () => {
        const maxDim = 1400;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function renderOpening(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const initNoticeId = qs.get("noticeId") || "";
  const slot = renderShell(root, "opening", [
    { label: "岗位首页", href: "/" },
    { label: "开标回传" },
  ], `<div class="card">正在读取开标回传记录…</div>`);

  try {
    const data = await api("/opening" + (initNoticeId ? `?noticeId=${encodeURIComponent(initNoticeId)}` : ""));
    let photoData = "";
    let bidRows = [
      { bidder: "", amountYuan: "", isOurs: true, remark: "" },
      { bidder: "", amountYuan: "", isOurs: false, remark: "" },
      { bidder: "", amountYuan: "", isOurs: false, remark: "" },
    ];

    slot.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>现场 / 远程开标回传（手机优先 · 保留版本）</h2>
          <span class="prov prov-verified">人工核实值 · 留痕</span>
        </div>
        ${!data.selectedProjects.length ? `
          <div class="notice-box warn">${ICONS.info}<span>项目库中暂无已选定项目。请先在「机会池」右上角选定项目，再进行开标回传。</span></div>
        ` : `
          <form id="opening-form">
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:12px;">
              <div class="field" style="margin:0;">
                <label for="op-notice">关联标段（来自项目库）</label>
                <select id="op-notice" class="select" name="noticeId" required>
                  ${data.selectedProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === initNoticeId ? "selected" : ""}>${esc(p.title)}</option>`).join("")}
                </select>
              </div>
              <div class="field" style="margin:0;">
                <label for="op-mode">开标方式（属性）</label>
                <select id="op-mode" class="select" name="openMode">
                  <option value="现场">现场</option>
                  <option value="远程">远程</option>
                  <option value="混合">混合</option>
                  <option value="未标注">未标注</option>
                </select>
              </div>
              <div class="field" style="margin:0;">
                <label for="op-arrive">到场 / 开标时间（北京时间）</label>
                <input id="op-arrive" class="input" name="arriveTime" placeholder="如：2026-11-28 09:00" />
              </div>
              <div class="field" style="margin:0;">
                <label for="op-venue">完整地址与房间 / 线上入口</label>
                <input id="op-venue" class="input" name="venue" placeholder="如：盐城市公共资源交易中心 402 开标室" />
              </div>
              <div class="field" style="margin:0;">
                <label for="op-contact">现场联系人</label>
                <input id="op-contact" class="input" name="contact" placeholder="委托人或代理联系人" />
              </div>
              <div class="field" style="margin:0;">
                <label for="op-mat">携带材料清单与当前版本</label>
                <input id="op-mat" class="input" name="materialsVer" placeholder="如：CA锁、授权书v2、密封纸质正本" />
              </div>
            </div>

            <div class="field">
              <label>现场唱标表拍照 / 截图上传（支持点击多选、拖拽或 Ctrl+V 直接粘贴原图）</label>
              <div id="op-photo-uz"></div>
              <div id="op-photo-preview" style="margin-top:8px;"></div>
            </div>

            <div style="margin:12px 0;">
              <div class="card-head" style="margin-bottom:8px;">
                <h3>唱标报价明细（金额单位：元，两位小数）</h3>
                <button type="button" class="btn btn-sm" id="btn-add-bid-row">增加一行投标人</button>
              </div>
              <div id="op-unit-warn" class="notice-box danger" style="display:none;"></div>
              <div id="bid-rows-wrap" style="display:flex;flex-direction:column;gap:8px;"></div>
            </div>

            <div class="meta-row" style="margin:12px 0;">
              <span class="muted">异常与核验标记：</span>
              <label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" name="flag" value="照片模糊" /> 照片模糊</label>
              <label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" name="flag" value="缺页" /> 缺页</label>
              <label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" name="flag" value="单位待复核" /> 单位待复核</label>
              <label style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;"><input type="checkbox" name="verified" /> 已逐字段核对原图无误</label>
            </div>

            <div class="field"><label for="op-note">现场情况备注</label><input id="op-note" class="input" name="note" placeholder="如：解密延迟15分钟、某单位被否决等" /></div>
            <button type="submit" class="btn btn-primary">提交开标回传（生成新版本）</button>
          </form>
        `}
      </div>

      <div class="card" style="padding:0;">
        <div class="card-head" style="padding:14px 16px 0;"><h2>历史开标回传记录（${data.records.length} 条）</h2></div>
        ${data.records.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>标段 / 版本与方式</th><th>现场信息与回传人</th><th>唱标报价摘要（元）</th><th>核验与操作</th></tr></thead>
              <tbody>
                ${data.records.map((r) => `
                  <tr>
                    <td>
                      <a class="row-title" href="/opportunities/${esc(r.noticeId)}" data-open="${esc(r.noticeId)}">${esc(r.noticeTitle || r.noticeId)}</a>
                      <div class="meta-row">
                        <span class="prov prov-verified">v${r.version}</span>
                        ${badge("info", "clock", `方式：${r.openMode}`)}
                        ${r.qualityFlags.map((f) => badge("danger", "alert", f)).join("")}
                      </div>
                    </td>
                    <td class="muted">
                      <div>${esc(r.venue || "详见公告地点")} · ${esc(r.arriveTime ? r.arriveTime + " 北京时间" : "详见公告日程")}</div>
                      <div>回传人：${esc(r.actorName)} · ${esc(r.createdAt)} 北京时间</div>
                      ${r.note ? `<div>备注：${esc(r.note)}</div>` : ""}
                    </td>
                    <td>
                      ${r.bids.length ? r.bids.slice(0, 4).map((b) => `<div class="muted num">${b.isOurs ? "<strong>[我方] </strong>" : ""}${esc(b.bidder)}：<strong>${b.amountYuan !== null ? esc(Number(b.amountYuan).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " 元") : "未标注"}</strong></div>`).join("") : `<span class="muted">未录入报价明细</span>`}
                      ${r.bids.length > 4 ? `<div class="muted">等共 ${r.bids.length} 家</div>` : ""}
                    </td>
                    <td style="display:flex;flex-direction:column;gap:6px;">
                      <button class="btn btn-sm btn-primary" data-to-est="${esc(r.noticeId)}">带入评标测算</button>
                      ${r.hasPhoto ? `<button class="btn btn-sm" data-view-photo="${esc(r.id)}">查看现场原图</button>` : `<span class="muted">未上传照片</span>`}
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>暂无开标回传记录</strong></div>`}
      </div>
    `;

    function checkUnitMismatch() {
      const warnEl = slot.querySelector("#op-unit-warn");
      if (!warnEl) return;
      const nid = slot.querySelector("#op-notice")?.value;
      const proj = data.selectedProjects.find((p) => p.id === nid);
      const budget = proj?.budgetYuan ? Number(proj.budgetYuan) : 0;
      if (!budget) { warnEl.style.display = "none"; return; }
      const bad = bidRows.some((b) => {
        const v = Number(b.amountYuan);
        return v > 0 && (v / budget < 0.01 || v / budget > 100);
      });
      if (bad) {
        warnEl.innerHTML = `${ICONS.alert}<span><strong>单位错位预警：</strong>检测到某家报价与该项目控制价（${esc(fmtYuan(budget))}）相差超过 100 倍，请核实是否误将「万元」填成了「元」或相反！</span>`;
        warnEl.style.display = "flex";
      } else {
        warnEl.style.display = "none";
      }
    }

    function renderBidRows() {
      const wrap = slot.querySelector("#bid-rows-wrap");
      if (!wrap) return;
      wrap.innerHTML = bidRows.map((b, i) => `
        <div class="filter-bar" data-idx="${i}">
          <input class="input" data-k="bidder" value="${esc(b.bidder)}" placeholder="投标单位名称（第 ${i + 1} 家）" style="flex:1;min-width:180px;" />
          <input class="input num" data-k="amountYuan" type="number" step="0.01" value="${esc(b.amountYuan)}" placeholder="报价金额（元）" style="width:165px;" />
          <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;"><input type="checkbox" data-k="isOurs" ${b.isOurs ? "checked" : ""} /> 我方</label>
          <input class="input" data-k="remark" value="${esc(b.remark)}" placeholder="工期/备注" style="width:140px;" />
          <button type="button" class="btn btn-sm btn-ghost" data-rm="${i}">移除</button>
        </div>
      `).join("");
      wrap.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("input", () => {
          const i = Number(el.closest("[data-idx]").getAttribute("data-idx"));
          const k = el.getAttribute("data-k");
          bidRows[i][k] = el.type === "checkbox" ? el.checked : el.value;
          if (k === "amountYuan") checkUnitMismatch();
        });
      });
      wrap.querySelectorAll("[data-rm]").forEach((btn) => {
        btn.addEventListener("click", () => {
          bidRows.splice(Number(btn.getAttribute("data-rm")), 1);
          renderBidRows();
          checkUnitMismatch();
        });
      });
    }
    renderBidRows();

    slot.querySelector("#op-notice")?.addEventListener("change", checkUnitMismatch);
    slot.querySelector("#btn-add-bid-row")?.addEventListener("click", () => { bidRows.push({ bidder: "", amountYuan: "", isOurs: false, remark: "" }); renderBidRows(); });
    if (slot.querySelector("#op-photo-uz")) {
      attachUniversalDropzone(slot.querySelector("#op-photo-uz"), {
        multiple: true,
        accept: "image/*",
        title: "点击多选、拖拽唱标表照片，或直接 Ctrl+V 粘贴截图",
        hint: "支持原图压缩上传与放大核验",
        pasteScope: slot,
        onFilesChange: async (flist) => {
          const f = flist[0];
          if (!f) { photoData = ""; slot.querySelector("#op-photo-preview").innerHTML = ""; return; }
          try {
            photoData = await compressImage(f);
            slot.querySelector("#op-photo-preview").innerHTML = `<img src="${photoData}" alt="回传预览" style="max-height:180px;border-radius:var(--radius);border:1px solid var(--border);" />`;
          } catch (err) { showToast(err.message); }
        },
      });
    }

    slot.querySelector("#opening-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const flags = fd.getAll("flag");
      try {
        const res = await api("/opening", {
          noticeId: String(fd.get("noticeId")),
          openMode: String(fd.get("openMode")),
          venue: String(fd.get("venue") || ""),
          arriveTime: String(fd.get("arriveTime") || ""),
          contact: String(fd.get("contact") || ""),
          materialsVer: String(fd.get("materialsVer") || ""),
          note: String(fd.get("note") || ""),
          verified: !!fd.get("verified"),
          qualityFlags: flags,
          photoData,
          bids: bidRows.filter((b) => b.bidder.trim()),
        });
        showToast(`已提交开标回传 v${res.version} 并留痕。`);
        render();
      } catch (err) { showToast(err.message); }
    });

    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
    slot.querySelectorAll("[data-to-est]").forEach((b) => b.addEventListener("click", () => navigate("/estimate?noticeId=" + encodeURIComponent(b.getAttribute("data-to-est")))));
    slot.querySelectorAll("[data-view-photo]").forEach((b) => {
      b.addEventListener("click", () => {
        const rec = data.records.find((r) => r.id === b.getAttribute("data-view-photo"));
        if (!rec?.photoData) return;
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `<div class="modal" style="max-width:860px;"><div class="card-head"><h3>现场原图核验（v${rec.version}）</h3><button class="btn btn-sm" id="ph-close">关闭</button></div><img src="${rec.photoData}" style="width:100%;max-height:75vh;object-fit:contain;border-radius:var(--radius);" /></div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#ph-close").addEventListener("click", () => wrap.remove());
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6H. BID ESTIMATION / RESULT FORECAST (/estimate) =================
function computeBidEstimate({ ruleName, controlPrice, kPercent, dropHighLow, e1, e2, maxScore, bids }) {
  const steps = [];
  const valid = [];
  const disqualified = [];

  for (const b of bids) {
    const amt = Number(b.amountYuan);
    if (!b.bidder || Number.isNaN(amt) || amt <= 0) continue;
    if (controlPrice > 0 && amt > controlPrice) {
      disqualified.push({ ...b, amountYuan: amt, reason: `报价高于最高限价（${fmtYuan(controlPrice)}）` });
    } else {
      valid.push({ ...b, amountYuan: amt });
    }
  }

  if (valid.length === 0) {
    return { determinable: false, missingReason: "缺少有效投标报价（至少需录入 1 家有效报价）。", steps, ranked: [], disqualified };
  }
  if (ruleName === "合成基准价法" && (!controlPrice || controlPrice <= 0)) {
    return { determinable: false, missingReason: "缺少控制价/最高限价参数，无法计算基准价与下浮率（请核实原文控制价或填写假设参数）。", steps, ranked: [], disqualified };
  }

  steps.push(`共参与测算 ${valid.length + disqualified.length} 家，有效报价 ${valid.length} 家，超限价剔除 ${disqualified.length} 家。`);

  let benchmark = 0;
  let ranked = [];

  if (ruleName === "经评审的最低投标价法") {
    ranked = [...valid].sort((a, b) => a.amountYuan - b.amountYuan).map((b, idx) => ({
      ...b,
      rank: idx + 1,
      dropRate: controlPrice > 0 ? ((1 - b.amountYuan / controlPrice) * 100).toFixed(2) + "%" : "未标注",
      score: null,
    }));
    benchmark = ranked[0].amountYuan;
    steps.push(`按最低有效报价排序，最低有效报价为 ${benchmark.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元。`);
  } else if (ruleName === "政府采购综合评分法") {
    const sorted = [...valid].sort((a, b) => a.amountYuan - b.amountYuan);
    benchmark = sorted[0].amountYuan;
    steps.push(`评标基准价取最低有效报价：${benchmark.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元。`);
    steps.push(`价格分公式：${maxScore} × (基准价 / 投标报价)。`);
    ranked = sorted.map((b, idx) => ({
      ...b,
      rank: idx + 1,
      dropRate: controlPrice > 0 ? ((1 - b.amountYuan / controlPrice) * 100).toFixed(2) + "%" : "未标注",
      score: Number((maxScore * (benchmark / b.amountYuan)).toFixed(2)),
    }));
  } else {
    // 合成基准价法（合理低价 / 综合评估商务标）
    const sortedPrices = valid.map((v) => v.amountYuan).sort((a, b) => a - b);
    let pool = sortedPrices;
    if (dropHighLow && sortedPrices.length >= 5) {
      pool = sortedPrices.slice(1, -1);
      steps.push(`有效家数 ≥ 5，按假设参数去掉 1 个最高价与 1 个最低价，剩余 ${pool.length} 家参与均价计算。`);
    } else {
      steps.push(`全部 ${pool.length} 家有效报价参与算术平均计算。`);
    }
    const avg = pool.reduce((s, x) => s + x, 0) / pool.length;
    benchmark = avg * (kPercent / 100);
    steps.push(`有效报价算术均价 = ${avg.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元；乘以假设下浮系数 K (${kPercent}%) → 评标基准价 = ${benchmark.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元。`);
    steps.push(`偏离扣分规则：每高于基准价 1% 扣 ${e1} 分，每低于基准价 1% 扣 ${e2} 分（商务满分 ${maxScore} 分）。`);
    ranked = valid.map((b) => {
      const diffPct = ((b.amountYuan - benchmark) / benchmark) * 100;
      const penalty = diffPct >= 0 ? diffPct * e1 : Math.abs(diffPct) * e2;
      const score = Math.max(0, Number((maxScore - penalty).toFixed(2)));
      return {
        ...b,
        diffPct: (diffPct >= 0 ? "+" : "") + diffPct.toFixed(2) + "%",
        dropRate: controlPrice > 0 ? ((1 - b.amountYuan / controlPrice) * 100).toFixed(2) + "%" : "未标注",
        score,
      };
    }).sort((a, b) => b.score - a.score || a.amountYuan - b.amountYuan).map((b, idx) => ({ ...b, rank: idx + 1 }));
  }

  return { determinable: true, benchmark, steps, ranked, disqualified };
}

async function renderEstimate(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const initNoticeId = qs.get("noticeId") || "";
  const slot = renderShell(root, "estimate", [
    { label: "岗位首页", href: "/" },
    { label: "评标测算 / 结果预估" },
  ], `<div class="card">正在加载评标测算工作区…</div>`);

  try {
    const [estData, opnData] = await Promise.all([
      api("/estimates" + (initNoticeId ? `?noticeId=${encodeURIComponent(initNoticeId)}` : "")),
      api("/opening" + (initNoticeId ? `?noticeId=${encodeURIComponent(initNoticeId)}` : "")),
    ]);
    const selectedNoticeId = initNoticeId || estData.selectedProjects[0]?.id || "";
    const activeProj = estData.selectedProjects.find((p) => p.id === selectedNoticeId);
    const latestOpen = opnData.records.find((r) => r.noticeId === selectedNoticeId);

    let snapshotBids = latestOpen?.bids?.length
      ? latestOpen.bids.map((b) => ({ ...b }))
      : [
          { bidder: "我方参投单位（示例）", amountYuan: "", isOurs: true },
          { bidder: "竞争单位 A", amountYuan: "", isOurs: false },
          { bidder: "竞争单位 B", amountYuan: "", isOurs: false },
        ];
    let lastResult = null;

    slot.innerHTML = `
      <div class="notice-box">
        ${ICONS.info}
        <div><strong>测算口径声明：</strong>本模块仅作<strong>评标测算 / 结果预估</strong>，情景参数均标为「假设参数」，不替代评标委员会正式结果；条件不足时如实显示「无法确定」及缺失原因。</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>评标测算 / 结果预估</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="btn-load-opn" type="button">载入最新开标回传快照</button>
            <button class="btn btn-sm btn-primary" id="btn-save-est" type="button">保存当前测算版本</button>
          </div>
        </div>
        ${!estData.selectedProjects.length ? `
          <div class="empty-state"><strong>项目库暂无已选定项目</strong><div>请先在「机会池」右上角选定项目，再进行评标测算。</div></div>
        ` : `
          <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:12px;">
            <div class="field" style="margin:0;">
              <label for="est-notice">关联标段</label>
              <select id="est-notice" class="select">
                ${estData.selectedProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === selectedNoticeId ? "selected" : ""}>${esc(p.title)}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="margin:0;">
              <label for="est-rule">测算规则</label>
              <select id="est-rule" class="select">
                <option value="合成基准价法">合成基准价法（合理低价/综合评估）</option>
                <option value="经评审的最低投标价法">经评审的最低投标价法</option>
                <option value="政府采购综合评分法">政府采购综合评分法（低价优先）</option>
              </select>
            </div>
            <div class="field" style="margin:0;">
              <label for="est-ctrl">控制价（元）<span class="prov ${activeProj?.budgetYuan ? "prov-auto" : ""}">${activeProj?.budgetYuan ? "原文提取" : "假设参数"}</span></label>
              <input id="est-ctrl" class="input num" type="number" step="0.01" value="${activeProj?.budgetYuan ? esc(activeProj.budgetYuan) : ""}" placeholder="必填（元）" />
            </div>
            <div class="field" style="margin:0;">
              <label for="est-k">下浮系数 K（%）<span class="prov prov-auto">假设参数</span></label>
              <input id="est-k" class="input num" type="number" step="0.1" value="96" />
            </div>
            <div class="field" style="margin:0;">
              <label for="est-max">商务满分 <span class="prov prov-auto">假设参数</span></label>
              <input id="est-max" class="input num" type="number" step="1" value="80" />
            </div>
            <div class="field" style="margin:0;">
              <label>偏离扣分 E1(高)/E2(低) <span class="prov prov-auto">假设参数</span></label>
              <div style="display:flex;gap:6px;">
                <input id="est-e1" class="input num" type="number" step="0.1" value="0.9" style="width:50%;" aria-label="高于基准价扣分" />
                <input id="est-e2" class="input num" type="number" step="0.1" value="0.6" style="width:50%;" aria-label="低于基准价扣分" />
              </div>
            </div>
          </div>

          <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-bottom:10px;cursor:pointer;">
            <input type="checkbox" id="est-drop" checked /> 有效家数 ≥ 5 时去掉 1 个最高价与 1 个最低价（假设参数）
          </label>

          <div style="margin-bottom:12px;">
            <div class="card-head" style="margin-bottom:6px;"><h3>报价数据快照（元）</h3><button class="btn btn-sm" id="est-add-row" type="button">增加报价行</button></div>
            <div id="est-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
          </div>

          <div id="est-output"></div>
        `}
      </div>

      <div class="card" style="padding:0;">
        <div class="card-head" style="padding:14px 16px 0;"><h2>已保存测算版本与版本差异（${estData.estimates.length}）</h2></div>
        ${estData.estimates.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>标段 / 版本与规则</th><th>参数快照</th><th class="amount">预估基准价（元）</th><th>测算结论摘要</th></tr></thead>
              <tbody>
                ${estData.estimates.map((e, idx) => {
                  const prev = estData.estimates.slice(idx + 1).find((x) => x.noticeId === e.noticeId);
                  const diffBench = prev?.result?.benchmark && e.result?.benchmark
                    ? e.result.benchmark - prev.result.benchmark : null;
                  return `
                    <tr>
                      <td>
                        <a class="row-title" href="/opportunities/${esc(e.noticeId)}" data-open="${esc(e.noticeId)}">${esc(e.noticeTitle || e.noticeId)}</a>
                        <div class="meta-row"><span class="prov prov-verified">v${e.version}</span><span class="prov">${esc(e.ruleName)}</span><span class="muted">${esc(e.actorName)} · ${esc(e.createdAt)} 北京时间</span></div>
                      </td>
                      <td class="muted num">控制价 ${e.params?.controlPrice ? esc(fmtYuan(e.params.controlPrice)) : "未标注"} · K=${esc(e.params?.kPercent ?? "-")}%</td>
                      <td class="amount num">
                        <strong>${e.result?.benchmark ? esc(Number(e.result.benchmark).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " 元") : "无法确定"}</strong>
                        ${diffBench !== null ? `<div class="muted">较 v${prev.version}：${diffBench >= 0 ? "+" : ""}${diffBench.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</div>` : ""}
                      </td>
                      <td class="muted">
                        ${e.result?.determinable ? `第一名：<strong>${esc(e.result.ranked?.[0]?.bidder || "-")}</strong>（共 ${e.result.ranked?.length || 0} 家有效）` : badge("warn", "alert", "无法确定")}
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>暂无已保存测算版本</strong></div>`}
      </div>
    `;

    function runCalc() {
      const out = slot.querySelector("#est-output");
      if (!out) return;
      const params = {
        ruleName: slot.querySelector("#est-rule").value,
        controlPrice: Number(slot.querySelector("#est-ctrl").value || 0),
        kPercent: Number(slot.querySelector("#est-k").value || 100),
        maxScore: Number(slot.querySelector("#est-max").value || 80),
        e1: Number(slot.querySelector("#est-e1").value || 0.9),
        e2: Number(slot.querySelector("#est-e2").value || 0.6),
        dropHighLow: slot.querySelector("#est-drop").checked,
      };
      lastResult = { params, res: computeBidEstimate({ ...params, bids: snapshotBids }) };
      const r = lastResult.res;
      if (!r.determinable) {
        out.innerHTML = `<div class="notice-box warn">${ICONS.alert}<div><strong>结果预估：无法确定</strong><div class="muted">${esc(r.missingReason)}</div></div></div>`;
        return;
      }
      out.innerHTML = `
        <div class="card" style="background:var(--surface-2);margin-top:10px;">
          <div class="card-head"><h3>测算结果预估与计算步骤</h3><span class="prov prov-auto">基于当前假设参数</span></div>
          <ol style="margin:0 0 12px;padding-left:18px;font-size:13px;color:var(--text-muted);">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <div class="table-wrap">
            <table class="tbl" style="background:var(--surface);">
              <thead><tr><th>预估排名</th><th>投标单位</th><th class="amount">投标报价（元）</th><th class="amount">下浮率</th><th class="amount">偏离基准价</th><th class="amount">预估商务分</th></tr></thead>
              <tbody>
                ${r.ranked.map((row) => `
                  <tr style="${row.isOurs ? "background:var(--accent-soft);" : ""}">
                    <td class="num"><strong>#${row.rank}</strong></td>
                    <td>${row.isOurs ? badge("info", "check", "我方") + " " : ""}<strong>${esc(row.bidder)}</strong></td>
                    <td class="amount num">${esc(row.amountYuan.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} 元</td>
                    <td class="amount num">${esc(row.dropRate)}</td>
                    <td class="amount num">${esc(row.diffPct || "-")}</td>
                    <td class="amount num"><strong>${row.score !== null ? row.score.toFixed(2) : "-"}</strong></td>
                  </tr>
                `).join("")}
                ${r.disqualified.map((d) => `
                  <tr><td>${badge("danger", "x", "废标风险")}</td><td>${esc(d.bidder)}</td><td class="amount num">${esc(d.amountYuan.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} 元</td><td colspan="3" class="muted" style="color:var(--danger);">${esc(d.reason)}</td></tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    function renderRows() {
      const wrap = slot.querySelector("#est-rows");
      if (!wrap) return;
      wrap.innerHTML = snapshotBids.map((b, i) => `
        <div class="filter-bar" data-ei="${i}">
          <input class="input" data-ek="bidder" value="${esc(b.bidder)}" placeholder="投标单位" style="flex:1;min-width:180px;" />
          <input class="input num" data-ek="amountYuan" type="number" step="0.01" value="${esc(b.amountYuan)}" placeholder="报价（元）" style="width:165px;" />
          <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;"><input type="checkbox" data-ek="isOurs" ${b.isOurs ? "checked" : ""} /> 我方</label>
          <button type="button" class="btn btn-sm btn-ghost" data-erm="${i}">移除</button>
        </div>
      `).join("");
      wrap.querySelectorAll("[data-ek]").forEach((el) => {
        el.addEventListener("input", () => {
          const i = Number(el.closest("[data-ei]").getAttribute("data-ei"));
          const k = el.getAttribute("data-ek");
          snapshotBids[i][k] = el.type === "checkbox" ? el.checked : el.value;
          runCalc();
        });
      });
      wrap.querySelectorAll("[data-erm]").forEach((btn) => {
        btn.addEventListener("click", () => { snapshotBids.splice(Number(btn.getAttribute("data-erm")), 1); renderRows(); runCalc(); });
      });
    }
    renderRows();
    runCalc();

    ["#est-rule", "#est-ctrl", "#est-k", "#est-max", "#est-e1", "#est-e2", "#est-drop"].forEach((sel) => {
      slot.querySelector(sel)?.addEventListener("input", runCalc);
      slot.querySelector(sel)?.addEventListener("change", runCalc);
    });
    slot.querySelector("#est-notice")?.addEventListener("change", (e) => navigate("/estimate?noticeId=" + encodeURIComponent(e.target.value)));
    slot.querySelector("#est-add-row")?.addEventListener("click", () => { snapshotBids.push({ bidder: "", amountYuan: "", isOurs: false }); renderRows(); });
    slot.querySelector("#btn-load-opn")?.addEventListener("click", () => {
      if (!latestOpen?.bids?.length) { showToast("该标段暂无已录入的开标回传报价。"); return; }
      snapshotBids = latestOpen.bids.map((b) => ({ ...b }));
      renderRows();
      runCalc();
      showToast(`已载入开标回传 v${latestOpen.version} 的 ${snapshotBids.length} 家报价快照。`);
    });
    slot.querySelector("#btn-save-est")?.addEventListener("click", async () => {
      if (!lastResult) return;
      try {
        const res = await api("/estimates", {
          noticeId: slot.querySelector("#est-notice").value,
          ruleName: lastResult.params.ruleName,
          params: lastResult.params,
          snapshot: snapshotBids,
          result: lastResult.res,
        });
        showToast(`已保存评标测算版本 v${res.version} 并留痕。`);
        render();
      } catch (err) { showToast(err.message); }
    });
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6I. AI ASSISTANT (/ai) =================
async function renderAiPage(root) {
  const slot = renderShell(root, "ai", [
    { label: "岗位首页", href: "/" },
    { label: "AI 辅助助手" },
  ], `<div class="card">正在核验服务端 AI 通道状态…</div>`);

  const history = [];
  try {
    const info = await api("/ai/models");
    const models = info.models?.length ? info.models : [info.defaultModel || "deepseek-v4.1-flash"];

    slot.innerHTML = `
      <div class="notice-box ${info.configured ? "" : "warn"}">
        ${ICONS.info}
        <div>
          <strong>服务端代理模式（TokenHub）：</strong>所有请求经由本站服务端 <code>/api/ai/chat</code> 转发，浏览器不接触任何 API 密钥；输出均标为「AI 辅助草稿 · 待人工核实」。
          ${!info.configured ? `<div style="margin-top:4px;color:var(--danger);">当前状态：<strong>${esc(info.message || "服务端未配置 TOKENHUB_API_KEY")}</strong></div>` : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>招投标 AI 辅助对话</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            <label for="ai-model-sel" class="muted">模型</label>
            <select id="ai-model-sel" class="select">
              ${models.map((m) => `<option value="${esc(m)}" ${m === info.defaultModel ? "selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div id="ai-thread" style="display:flex;flex-direction:column;gap:10px;min-height:160px;max-height:520px;overflow-y:auto;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);margin-bottom:12px;">
          <div class="muted">可咨询招投标法规、资格条款核对思路、评分细则拆解或标书大纲起草。</div>
        </div>

        <form id="ai-chat-form" class="filter-bar">
          <input id="ai-chat-input" class="input" placeholder="输入问题，按回车发送…" style="flex:1;min-width:240px;" ${info.configured ? "" : "disabled"} />
          <button type="submit" class="btn btn-primary" id="ai-chat-btn" ${info.configured ? "" : "disabled"}>发送</button>
        </form>
      </div>
    `;

    function renderThread() {
      const box = slot.querySelector("#ai-thread");
      if (!history.length) return;
      box.innerHTML = history.map((m) => `
        <div style="padding:10px 12px;border-radius:var(--radius);border:1px solid var(--border);background:${m.role === "user" ? "var(--accent-soft)" : "var(--surface)"};">
          <div class="meta-row" style="margin-bottom:4px;">
            <strong>${m.role === "user" ? esc(state.user.name) : "AI 辅助草稿"}</strong>
            ${m.role === "assistant" ? badge("warn", "info", "待人工核实") : ""}
            ${m.model ? `<span class="muted">${esc(m.model)}</span>` : ""}
          </div>
          <div style="white-space:pre-wrap;word-break:break-word;font-size:13px;">${esc(m.content)}</div>
        </div>
      `).join("");
      box.scrollTop = box.scrollHeight;
    }

    slot.querySelector("#ai-chat-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inp = slot.querySelector("#ai-chat-input");
      const btn = slot.querySelector("#ai-chat-btn");
      const text = inp.value.trim();
      if (!text) return;
      const model = slot.querySelector("#ai-model-sel").value;
      history.push({ role: "user", content: text });
      inp.value = "";
      renderThread();
      btn.disabled = true;
      try {
        const res = await api("/ai/chat", {
          model,
          messages: history.map((h) => ({ role: h.role, content: h.content })),
        });
        history.push({ role: "assistant", content: res.content, model: res.model });
        renderThread();
      } catch (err) {
        history.push({ role: "assistant", content: `调用异常：${err.message}` });
        renderThread();
      } finally {
        btn.disabled = false;
      }
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6J. SCHEDULE & FIELD CONFLICTS (/schedule) =================
async function renderSchedule(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const initNoticeId = qs.get("noticeId") || "";
  const slot = renderShell(root, "schedule", [
    { label: "岗位首页", href: "/" },
    { label: "日程与现场" },
  ], `<div class="card">正在加载递交、解密、开标日程与行程冲突检测…</div>`);

  try {
    const data = await api("/schedules");
    const items = data.items || [];
    const conflicts = data.conflicts || [];
    const onsiteCnt = items.filter((x) => x.open_mode === "现场" || x.open_mode === "混合").length;
    const remoteCnt = items.filter((x) => x.open_mode === "远程").length;

    slot.innerHTML = `
      <div class="td-stat-row">
        <div class="td-stat-card">
          <div class="td-stat-label">已排开标日程总数</div>
          <div class="td-stat-value">${items.length} <span style="font-size:13px;font-weight:400;" class="muted">场</span></div>
          <div class="td-stat-foot"><span>覆盖项目库已选定参投标段</span></div>
        </div>
        <div class="td-stat-card td-warn">
          <div class="td-stat-label">现场 / 混合开标（需带原件）</div>
          <div class="td-stat-value">${onsiteCnt} <span style="font-size:13px;font-weight:400;" class="muted">场</span></div>
          <div class="td-stat-foot"><span>行内可核对 CA锁/授权书/身份证</span></div>
        </div>
        <div class="td-stat-card td-good">
          <div class="td-stat-label">远程不见面开标</div>
          <div class="td-stat-value">${remoteCnt} <span style="font-size:13px;font-weight:400;" class="muted">场</span></div>
          <div class="td-stat-foot"><span>请提前 30 分钟测试解密驱动</span></div>
        </div>
        <div class="td-stat-card ${conflicts.length > 0 ? "td-danger" : "td-good"}">
          <div class="td-stat-label">授权委托人行程撞车检测</div>
          <div class="td-stat-value" style="color:${conflicts.length > 0 ? "var(--danger)" : "var(--good)"};">${conflicts.length} <span style="font-size:13px;font-weight:400;" class="muted">处冲突</span></div>
          <div class="td-stat-foot"><span>${conflicts.length > 0 ? "请立即改派委托人！" : "当前所有人员排期无重叠"}</span></div>
        </div>
      </div>

      ${conflicts.length ? `
        <div class="notice-box danger" role="alert">
          ${ICONS.alert}
          <div>
            <strong>检测到授权委托人行程区间冲突（${conflicts.length} 处）：</strong>
            <ul style="margin:4px 0 0;padding-left:18px;">
              ${conflicts.map((c) => `<li><strong>${esc(c.delegateName)}</strong>：标段「${esc(c.aTitle)}」与「${esc(c.bTitle)}」行程重叠（${esc(c.window)} 北京时间）</li>`).join("")}
            </ul>
          </div>
        </div>
      ` : ""}

      <div class="card" style="padding:0;margin-bottom:14px;">
        <div class="card-head" style="padding:14px 16px 10px;border-bottom:1px solid var(--border);margin-bottom:0;">
          <div>
            <h2 style="margin:0 0 2px;">开标日程与现场作战台（${items.length} 场）</h2>
            <div class="muted">开标结束后点击行内「上传开标记录表」与「算中标预测」直接完成现场闭环。</div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-toggle-sch-form">+ 安排新开标行程</button>
        </div>

        <div id="sch-form-wrap" style="display:${initNoticeId || !items.length ? "block" : "none"};padding:14px 16px;background:var(--surface-2);border-bottom:1px solid var(--border);">
          ${!data.selectedProjects.length ? `
            <div class="empty-state"><strong>项目库暂无已选定项目</strong><div>请先在「机会池」选定项目或粘贴链接录入项目库后再安排日程。</div></div>
          ` : `
            <form id="sch-form">
              <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-bottom:10px;">
                <div class="field" style="margin:0;"><label>关联标段</label><select class="select" name="noticeId" required>${data.selectedProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === initNoticeId ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;"><label>参投公司</label><select class="select" name="companyId"><option value="">未指定</option>${state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;"><label>开标方式</label><select class="select" name="openMode"><option value="现场">现场</option><option value="远程">远程</option><option value="混合">混合</option><option value="未标注">未标注</option></select></div>
                <div class="field" style="margin:0;"><label>递交截止（北京时间）</label><input class="input" name="submitTime" placeholder="YYYY-MM-DD HH:MM" /></div>
                <div class="field" style="margin:0;"><label>远程/现场解密时段</label><input class="input" name="decryptWindow" placeholder="如：09:00-09:30" /></div>
                <div class="field" style="margin:0;"><label>开标时间（北京时间）</label><input class="input" name="openTime" placeholder="YYYY-MM-DD HH:MM" /></div>
                <div class="field" style="margin:0;"><label>开标地点/房间或不见面大厅</label><input class="input" name="venue" placeholder="完整地址与房间号" /></div>
                <div class="field" style="margin:0;"><label>现场/远程委托人</label><select class="select" name="delegateId"><option value="">待指定</option>${state.employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>
                <div class="field" style="margin:0;"><label>人员占用出发（防撞车）</label><input class="input" name="departAt" placeholder="2026-11-28 07:30" /></div>
                <div class="field" style="margin:0;"><label>人员占用结束（防撞车）</label><input class="input" name="untilAt" placeholder="2026-11-28 12:00" /></div>
              </div>
              <div class="field"><label>携带清单与注意事项（CA锁、授权委托书原件、身份证、纸质标书等）</label><input class="input" name="note" placeholder="如：兴业CA锁 + 法人授权委托书原件2份 + 身份证原件" /></div>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button class="btn btn-primary btn-sm" type="submit">保存日程并检测行程冲突</button>
              </div>
            </form>
          `}
        </div>

        ${items.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="min-width:250px;">标段 / 参投公司</th>
                  <th style="width:185px;">递交 / 解密 / 开标时间</th>
                  <th>地点、委托人与携带清单</th>
                  <th style="width:205px;">开标后直达闭环</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((r) => `
                  <tr>
                    <td>
                      <a class="row-title" href="/projects/${esc(r.notice_id)}" data-go="/projects/${esc(r.notice_id)}">${esc(r.noticeTitle || r.notice_id)}</a>
                      <div class="meta-row">
                        ${badge(r.open_mode === "现场" ? "warn" : "info", "clock", r.open_mode)}
                        <span class="muted">${esc(r.companyName || "参投主体")} · v${r.version}</span>
                      </div>
                    </td>
                    <td class="muted num">
                      <div>递交：<strong>${esc(r.submit_time || r.deadlineText || "未标注")}</strong></div>
                      <div>解密：${esc(r.decrypt_window || "未标注")}</div>
                      <div>开标：${esc(r.open_time || "未标注")}</div>
                    </td>
                    <td class="muted">
                      <div>${esc(r.venue || "详见公告地点")}</div>
                      <div>委托人：<strong>${esc(r.delegateName || "待指定")}</strong> ${r.depart_at && r.until_at ? `（占用 ${esc(r.depart_at)} ~ ${esc(r.until_at)}）` : ""}</div>
                      ${r.note ? `<div style="margin-top:3px;color:var(--text);">物资：${esc(r.note)}</div>` : `<div style="margin-top:3px;font-size:11px;">提醒：CA锁 · 法人授权书 · 身份证原件</div>`}
                    </td>
                    <td>
                      <div style="display:flex;flex-direction:column;gap:5px;">
                        <button type="button" class="quick-pill" style="color:var(--accent);border-color:rgba(0,82,217,0.35);font-weight:600;justify-content:center;" data-sch-step="${esc(r.notice_id)}:5">5. 上传开标记录表 →</button>
                        <button type="button" class="quick-pill" style="color:var(--good);border-color:rgba(0,168,112,0.35);justify-content:center;" data-sch-step="${esc(r.notice_id)}:6">6. 算基准价与中标预测 →</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>暂无已排日程</strong><div>请先点击上方表单为已选参投标段安排开标时间与授权委托人。</div></div>`}
      </div>
    `;
    slot.querySelector("#btn-toggle-sch-form")?.addEventListener("click", () => {
      const box = slot.querySelector("#sch-form-wrap");
      if (box) box.style.display = box.style.display === "none" ? "block" : "none";
    });
    slot.querySelectorAll("[data-sch-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [nid, st] = btn.getAttribute("data-sch-step").split(":");
        if (!state.lotStepView) state.lotStepView = {};
        state.lotStepView[nid] = Number(st || 5);
        navigate("/projects/" + nid);
      });
    });
    slot.querySelector("#sch-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/schedules", Object.fromEntries(new FormData(e.target).entries()));
        showToast("已保存日程并进行行程冲突校验。");
        render();
      } catch (err) { showToast(err.message); }
    });
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6K. RESULTS, NOTICE LETTER, CONTRACT & HANDOVER (/outcomes) =================
async function renderOutcomes(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const initNoticeId = qs.get("noticeId") || "";
  const slot = renderShell(root, "outcomes", [
    { label: "岗位首页", href: "/" },
    { label: "结果、通知书、合同与移交" },
  ], `<div class="card">正在加载结果与合同移交记录…</div>`);

  try {
    const data = await api("/outcomes");
    slot.innerHTML = `
      <div class="notice-box">
        ${ICONS.info}
        <div><strong>分维度独立记录规范：</strong>候选公示、正式结果结论、中标通知书下达与签收、履约担保、合同签署与移交启动分别独立记录，各参投公司结果独立，不以单一「已完成」替代。</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>登记或更新结果、通知书与合同移交</h2></div>
        ${!data.selectedProjects.length ? `
          <div class="empty-state"><strong>项目库暂无已选定项目</strong></div>
        ` : `
          <form id="out-form">
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:12px;">
              <div class="field" style="margin:0;"><label>关联标段</label><select class="select" name="noticeId" required>${data.selectedProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === initNoticeId ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></div>
              <div class="field" style="margin:0;"><label>参投公司（各公司独立）</label><select class="select" name="companyId"><option value="">默认主体</option>${state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
              <div class="field" style="margin:0;"><label>1. 候选公示状态</label><select class="select" name="candidateStatus"><option>未标注</option><option>第一候选人</option><option>第二候选人</option><option>第三候选人</option><option>未入围</option><option>公示异议中</option></select></div>
              <div class="field" style="margin:0;"><label>2. 正式结果结论</label><select class="select" name="finalResult"><option>未标注</option><option>中标</option><option>未中标</option><option>流标或终止</option></select></div>
              <div class="field" style="margin:0;"><label>中标金额（元，选填）</label><input class="input num" type="number" step="0.01" name="awardAmountYuan" placeholder="0.00" /></div>
              <div class="field" style="margin:0;"><label>3. 中标通知书</label><select class="select" name="noticeLetterStatus"><option>未下达</option><option>已下达待签收</option><option>已签收</option></select></div>
              <div class="field" style="margin:0;"><label>通知书签收日期</label><input class="input" type="date" name="noticeLetterDate" /></div>
              <div class="field" style="margin:0;"><label>4. 履约担保</label><select class="select" name="guaranteeStatus"><option>未标注</option><option>免缴(附依据)</option><option>履约保函已办</option><option>履约现金已缴</option></select></div>
              <div class="field" style="margin:0;"><label>5. 合同与移交状态</label><select class="select" name="contractStatus"><option>未签署</option><option>审核中</option><option>已签署</option><option>已移交启动</option></select></div>
              <div class="field" style="margin:0;"><label>移交接收部门/负责人</label><input class="input" name="handoverTo" placeholder="如：工程管理部" /></div>
            </div>
            <div class="field"><label>依据或异议备注</label><input class="input" name="note" /></div>
            <button class="btn btn-primary" type="submit">保存结果与移交状态</button>
          </form>
        `}
      </div>

      <div class="card" style="padding:0;">
        <div class="card-head" style="padding:14px 16px 0;"><h2>结果、通知书与合同台账（${data.items.length}）</h2></div>
        ${data.items.length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>标段 / 参投公司</th><th>候选公示与正式结论</th><th class="amount">中标金额（元）</th><th>通知书状态</th><th>履约担保 / 合同与移交</th></tr></thead>
              <tbody>
                ${data.items.map((r) => `
                  <tr>
                    <td><a class="row-title" href="/opportunities/${esc(r.notice_id)}" data-open="${esc(r.notice_id)}">${esc(r.noticeTitle || r.notice_id)}</a><div class="muted">${esc(r.companyName || "默认主体")} · 更新人：${esc(r.updated_by_name)}</div></td>
                    <td><div>候选：${badge("info", "info", r.candidate_status)}</div><div style="margin-top:4px;">结论：${badge(r.final_result === "中标" ? "good" : r.final_result === "未中标" ? "quiet" : "warn", "check", r.final_result)}</div></td>
                    <td class="amount num">${r.award_amount_fen !== null ? esc(fmtFen(r.award_amount_fen)) : `<span class="muted">未标注</span>`}</td>
                    <td class="muted">${badge(r.notice_letter_status === "已签收" ? "good" : "quiet", "file", r.notice_letter_status)}<div>${esc(r.notice_letter_date || "")}</div></td>
                    <td class="muted"><div>担保：${esc(r.guarantee_status)}</div><div>合同：<strong>${esc(r.contract_status)}</strong> ${r.handover_to ? `→ ${esc(r.handover_to)}` : ""}</div></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>暂无结果与合同记录</strong></div>`}
      </div>
    `;
    slot.querySelector("#out-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/outcomes", Object.fromEntries(new FormData(e.target).entries()));
        showToast("已保存结果与合同移交记录。");
        render();
      } catch (err) { showToast(err.message); }
    });
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-opp-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        localStorage.setItem("br-opp-view", btn.getAttribute("data-opp-view"));
        render();
      });
    });

    slot.querySelectorAll("[data-peek]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      openOpportunityPeekDrawer(btn.getAttribute("data-peek"), btn);
    }));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));
    slot.querySelectorAll("[data-entity]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-entity")); }));
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6L. ENTITY PROFILES & BUYER/AGENCY INTEL (/entities, bidxun.com style) =================
async function renderEntities(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const kind = qs.get("kind") || "tenderer";
  const q = qs.get("q") || "";
  const name = qs.get("name") || "";

  const slot = renderShell(root, "entities", [
    { label: "岗位首页", href: "/" },
    { label: "企查与主体画像", href: "/entities" },
    ...(name ? [{ label: name }] : []),
  ], `<div class="card">正在读取市场主体画像与发标规律数据…</div>`);

  try {
    const apiQs = new URLSearchParams({ kind, q, name });
    const data = await api("/entities?" + apiQs.toString());

    if (data.profile) {
      const p = data.profile;
      const partnerKind = p.kind === "agency" ? "tenderer" : "agency";
      const partnerLabel = p.kind === "agency" ? "常服务采购方 / 招标人" : "常合作招标代理机构";

      slot.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <div class="meta-row" style="margin-bottom:6px;">
                ${badge("info", "users", p.kind === "agency" ? "招标代理机构画像" : "采购方 / 招标单位画像")}
                <span class="prov prov-raw">基于 ${p.totalNotices} 条官方公开标讯聚合</span>
              </div>
              <h1 style="margin:0 0 6px;font-size:19px;">${esc(p.name)}</h1>
              <div class="meta-row">
                <span>主要区域：${p.regions.map((r) => `${esc(r.name)}(${r.cnt})`).join("、") || "未标注"}</span>
                <span>· 主要行业：${p.tradeTypes.map((t) => `${esc(t.name)}(${t.cnt})`).join("、") || "未标注"}</span>
              </div>
            </div>
            <button class="btn" id="btn-back-ent">返回主体名录</button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="metric-box"><div class="metric-head"><span>历史公开公告总数</span></div><div class="metric-val">${p.totalNotices} 条</div><div class="muted">采购意向 ${p.intentCount} 条</div></div>
          <div class="metric-box"><div class="metric-head"><span>累计公开预算规模</span></div><div class="metric-val amount" style="text-align:left;">${Number(p.totalBudgetYuan) > 0 ? esc(fmtYuan(p.totalBudgetYuan)) : "详见原文条款"}</div><div class="muted">仅统计原文已载明预算项目</div></div>
          <div class="metric-box"><div class="metric-head"><span>招标 / 采购公告</span></div><div class="metric-val">${p.tenderCount} 条</div><div class="muted">更正与答疑 ${p.amendmentCount} 条</div></div>
          <div class="metric-box"><div class="metric-head"><span>中标（成交）结果公告</span></div><div class="metric-val">${p.resultCount} 条</div><div class="muted">历史行情与中标记录</div></div>
        </div>

        <div class="wb-layout">
          <div class="card" style="padding:0;">
            <div class="card-head" style="padding:14px 16px 0;"><h2>该主体历史标讯全纪录（近 ${p.notices.length} 条）</h2></div>
            <div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>公告标题 / 阶段与区域</th><th class="amount">预算 / 控制价（元）</th><th>发布与截止（北京时间）</th><th>关联方</th></tr></thead>
                <tbody>
                  ${p.notices.map((n) => `
                    <tr>
                      <td>
                        <a class="row-title" href="/opportunities/${esc(n.id)}" data-open="${esc(n.id)}">${esc(n.title)}</a>
                        <div class="meta-row">${stageBadge(n.stage, n.stageLabel)}${n.region ? `<span class="prov">${esc(n.region)}</span>` : ""}${n.tradeType ? `<span class="prov">${esc(n.tradeType)}</span>` : ""}</div>
                      </td>
                      <td class="amount num">${fmtYuan(n.budgetYuan) ? `<strong>${esc(fmtYuan(n.budgetYuan))}</strong>` : `<span class="muted">未标注</span>`}</td>
                      <td class="muted num"><div>发布：${esc(fmtBeijing(n.published))}</div>${n.deadlineText ? `<div>截止：${esc(n.deadlineText)} 北京时间</div>` : ""}</td>
                      <td class="muted">${p.kind === "agency"
                        ? (n.tenderer ? `<a class="entity-link" href="/entities?kind=tenderer&name=${encodeURIComponent(n.tenderer)}" data-go="/entities?kind=tenderer&name=${encodeURIComponent(n.tenderer)}">${esc(n.tenderer)}</a>` : "未标注")
                        : (n.agency ? `<a class="entity-link" href="/entities?kind=agency&name=${encodeURIComponent(n.agency)}" data-go="/entities?kind=agency&name=${encodeURIComponent(n.agency)}">${esc(n.agency)}</a>` : "未载代理")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <aside>
            <div class="card">
              <div class="card-head"><h3>${esc(partnerLabel)}关系网</h3></div>
              ${p.partners.length ? `
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${p.partners.map((pt) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);">
                      <a class="entity-link" href="/entities?kind=${partnerKind}&name=${encodeURIComponent(pt.name)}" data-go="/entities?kind=${partnerKind}&name=${encodeURIComponent(pt.name)}">${esc(pt.name)}</a>
                      <span class="badge badge-info num">合作 ${pt.cnt} 次</span>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted">暂未提取到明确的合作关联方记录。</div>`}
            </div>
          </aside>
        </div>
      `;
      slot.querySelector("#btn-back-ent").addEventListener("click", () => navigate(`/entities?kind=${encodeURIComponent(p.kind)}`));
      slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
      slot.querySelectorAll("[data-go]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); });
      a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(a.getAttribute("data-go")); } });
    });
      return;
    }

    function goEnt(patch) {
      const p = new URLSearchParams({ kind, q, ...patch });
      navigate("/entities?" + p.toString());
    }

    slot.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>企查与市场主体画像（采购方发标规律 · 代理机构关系网）</h2>
        </div>
        <div class="tabs">
          <button class="tab ${kind === "tenderer" ? "active" : ""}" data-ek="tenderer">采购方 / 招标单位画像</button>
          <button class="tab ${kind === "agency" ? "active" : ""}" data-ek="agency">招标代理机构画像</button>
        </div>
        <form id="ent-search" class="filter-bar">
          <input class="input" name="q" value="${esc(q)}" placeholder="搜索单位名称（如：盐城城投、水利局、财政局…）" style="flex:1;min-width:240px;" />
          <button class="btn btn-primary" type="submit">检索主体</button>
        </form>
      </div>

      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>市场主体名称（点击查看关系网与历史标讯画像）</th>
                <th>主要地区 / 行业</th>
                <th class="amount">公告总数</th>
                <th class="amount">招标 / 结果 / 更正</th>
                <th class="amount">累计公开预算（元）</th>
                <th>最近发标时间</th>
              </tr>
            </thead>
            <tbody>
              ${data.items.map((it) => `
                <tr>
                  <td><a class="row-title" href="/entities?kind=${esc(kind)}&name=${encodeURIComponent(it.name)}" data-go="/entities?kind=${esc(kind)}&name=${encodeURIComponent(it.name)}">${highlightEsc(it.name, q)}</a></td>
                  <td><span class="prov">${esc(it.primaryRegion || "未标注")}</span> <span class="prov">${esc(it.primaryTradeType || "未标注")}</span></td>
                  <td class="amount num"><strong>${it.totalNotices}</strong></td>
                  <td class="amount muted num">${it.tenderCount} / ${it.resultCount} / ${it.amendmentCount}</td>
                  <td class="amount num">${Number(it.totalBudgetYuan) > 0 ? esc(fmtYuan(it.totalBudgetYuan)) : `<span class="muted">未标注</span>`}</td>
                  <td class="muted num">${esc(fmtBeijing(it.latestPublished))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    slot.querySelectorAll("[data-ek]").forEach((b) => b.addEventListener("click", () => goEnt({ kind: b.getAttribute("data-ek") })));
    slot.querySelector("#ent-search").addEventListener("submit", (e) => { e.preventDefault(); goEnt({ q: String(new FormData(e.target).get("q") || "").trim() }); });
    slot.querySelectorAll("[data-go]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); });
      a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(a.getAttribute("data-go")); } });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 6M. QUALIFICATION MATCH MATRIX (/matrix) =================
async function renderMatrix(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const initNoticeId = qs.get("noticeId") || "";
  const version = qs.get("version") || "";
  const slot = renderShell(root, "matrix", [
    { label: "岗位首页", href: "/" },
    { label: "资格匹配矩阵（要求×公司）" },
  ], `<div class="card">正在计算要求 × 公司资格匹配矩阵…</div>`);

  try {
    const data = await api("/matrix?" + new URLSearchParams({ noticeId: initNoticeId, version }));
    const allChoices = [...(data.selectedProjects || []), ...(data.recentTenders || []).filter((t) => !(data.selectedProjects || []).some((s) => s.id === t.id))];

    const cellBadge = (st) => {
      if (st === "conform") return badge("good", "check", "满足");
      if (st === "non_conform") return badge("danger", "x", "不满足");
      if (st === "na") return badge("quiet", "info", "不适用");
      if (st === "missing") return badge("warn", "info", "待补（未登记）");
      return badge("quiet", "clock", "待核");
    };

    slot.innerHTML = `
      <div class="notice-box">
        ${ICONS.info}
        <div><strong>资格匹配矩阵规范：</strong>逐项对比「项目要求 × 各参投公司」的档案登记与等级情况，<strong>不计算综合分、不出现“合格/通过”总标签，也不会因匹配而自动决定参投</strong>；待补（未登记）不等于不符合。</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>选择比对标段</h2>
          ${data.notice ? `<a class="btn btn-sm" href="/opportunities/${esc(data.notice.id)}" data-open="${esc(data.notice.id)}">打开该标段工作台</a>` : ""}
        </div>
        <div class="filter-bar">
          <select id="mtx-notice" class="select" aria-label="选择比对标段" style="flex:1;min-width:260px;">
            ${data.notice && !allChoices.some(project => project.id === data.notice.id) ? `<option value="${esc(data.notice.id)}" selected>${esc(data.notice.title)}</option>` : ""}
            ${allChoices.map((p) => `<option value="${esc(p.id)}" ${p.id === data.notice?.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}
          </select>
          ${data.versions?.length ? `<label>公告版本 <select id="mtx-version" class="select"><option value="">当前公告</option>${data.versions.map(item => `<option value="${esc(item.version)}" ${String(item.version) === version ? "selected" : ""}>版本 ${esc(item.version)} · ${esc(fmtBeijing(item.observedAt))}</option>`).join("")}</select></label>` : ""}
          ${version ? `<span class="muted">历史公告快照与当前公司档案比对</span>` : ""}
        </div>
      </div>

      ${data.notice ? renderNoticeEvidence(data.evidence, data.notice.id, false) : ""}
      ${(data.companies || []).filter(c=>(data.histories?.[c.id]?.length || 0)>1).map(c=>`<details class="card"><summary>${esc(c.name)} · 比对变化记录</summary>
        ${data.histories[c.id].map(h=>`<details><summary>${esc(fmtBeijing(h.at))} · ${esc([...h.changed.map(key=>data.requirements.find(r=>r.key===key)?.title || key),...h.fieldsChanged].join("、") || "当时的比对结果")}</summary>
          <ul>${Object.entries(h.cells).map(([key,cell])=>`<li>${esc(data.requirements.find(r=>r.key===key)?.title || key)} · ${cellBadge(cell.status)} · ${esc(cell.basis)}</li>`).join("")}</ul></details>`).join("")}</details>`).join("")}
      <div class="card" style="padding:0;">
        ${!data.companies.length ? `
          <div class="empty-state"><strong>暂无已授权参投公司</strong><div>请先在「公司与资料库」建立参投公司或联系管理员分配权限。</div></div>
        ` : !data.notice ? `
          <div class="empty-state"><strong>暂无可比对的招标项目</strong></div>
        ` : `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="min-width:260px;">资格要求项（逻辑关系）</th>
                  ${data.companies.map((c) => `<th style="min-width:200px;">${esc(c.name)} ${c.verify ? "" : `<span class="muted">(仅查看)</span>`}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${data.requirements.map((req) => `
                  <tr>
                    <td>
                      <div style="font-weight:600;margin-bottom:4px;">${esc(req.title)} <span class="prov prov-raw">${esc(req.logic)}</span></div>
                      <div class="muted">${esc(req.excerpt)}</div>
                    </td>
                    ${data.companies.map((c) => {
                      const cell = data.matrix[`${req.key}::${c.id}`] || { status: "missing", basis: "未登记", provenance: "自动提取值" };
                      return `
                        <td>
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
                            ${cellBadge(cell.status)}
                            <span class="prov ${cell.provenance === "人工核实值" ? "prov-verified" : "prov-auto"}">${esc(cell.provenance)}</span>
                          </div>
                          <div class="muted" style="margin-bottom:4px;">${esc(cell.basis)}</div>
                          ${cell.previousReview ? `<div class="notice-box warn">依据已变化，前次人工意见待复核：${esc(cell.previousReview.basis)}</div>` : ""}
                          ${cell.updatedBy ? `<div class="muted" style="font-size:11px;">核实人：${esc(cell.updatedBy)}</div>` : ""}
                          ${cell.documents?.length ? `<ul>${cell.documents.map(doc => `<li>${esc(doc.label)}${doc.validity ? ` · 有效期至 ${esc(doc.validity)}` : ""}</li>`).join("")}</ul>` : ""}
                          ${c.verify && !version ? `<button class="btn btn-sm" style="margin-top:4px;" data-mtx-edit="${esc(req.key)}" data-mtx-cid="${esc(c.id)}" data-mtx-cname="${esc(c.name)}" data-mtx-rtitle="${esc(req.title)}">核实结论</button>` : ""}
                        </td>
                      `;
                    }).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    slot.querySelector("#mtx-notice")?.addEventListener("change", (e) => {
      navigate("/matrix?noticeId=" + encodeURIComponent(e.target.value));
    });
    slot.querySelector("#mtx-version")?.addEventListener("change", (event) => {
      navigate("/matrix?" + new URLSearchParams({ noticeId: data.notice.id, version: event.target.value }));
    });
    slot.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate("/opportunities/" + a.getAttribute("data-open")); }));
    slot.querySelectorAll("[data-mtx-edit]").forEach((b) => {
      b.addEventListener("click", () => {
        const reqKey = b.getAttribute("data-mtx-edit");
        const companyId = b.getAttribute("data-mtx-cid");
        const cname = b.getAttribute("data-mtx-cname");
        const rtitle = b.getAttribute("data-mtx-rtitle");
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-label="人工核实资格匹配项">
            <h3 style="margin:0 0 8px;">人工核实：${esc(cname)}</h3>
            <div class="muted" style="margin-bottom:12px;">要求项：${esc(rtitle)}</div>
            <form id="mtx-verify-form">
              <div class="field">
                <label>核实结论</label>
                <select class="select" name="status">
                  <option value="conform">满足</option>
                  <option value="non_conform">不满足（必填依据）</option>
                  <option value="na">不适用（须附依据）</option>
                  <option value="missing">待补（未登记）</option>
                  <option value="pending">未核实</option>
                </select>
              </div>
              <div class="field">
                <label>核实依据（记入审计留痕）</label>
                <input class="input" name="basis" placeholder="填写证书编号、人员姓名或条款依据" />
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="mv-cancel">取消</button><button type="submit" class="btn btn-primary">保存核实结果</button></div>
            </form>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#mv-cancel").addEventListener("click", () => wrap.remove());
        wrap.querySelector("#mtx-verify-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api("/matrix/verify", {
              fingerprint: data.fingerprints[companyId],
              noticeId: data.notice.id,
              reqKey,
              companyId,
              status: String(fd.get("status")),
              basis: String(fd.get("basis") || "").trim(),
            });
            wrap.remove();
            showToast("已保存资格矩阵核实结论并留痕。");
            render();
          } catch (err) { showToast(err.message); }
        });
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= 7. ADMIN ACCOUNTS & AUDIT =================
async function renderAdminAccounts(root) {
  const slot = renderShell(root, "admin-accounts", [
    { label: "岗位首页", href: "/" },
    { label: "系统管理", href: "/settings" },
    { label: "账号与授权管理" },
  ], `<div class="card">正在读取企业成员名录…</div>`);

  try {
    const accounts = await api("/admin/accounts");
    const approvedCnt = accounts.filter((a) => a.approval === "approved").length;
    const onlineCnt = accounts.filter((a) => a.activeSessions > 0).length;

    slot.innerHTML = `
      ${renderSystemTabs("admin-accounts")}
      <div class="notice-box">
        ${ICONS.lock}
        <div><strong>现代企业权限治理原则：</strong>支持成员入职建档、岗位角色调整、一键批量公司授权与离职停用（停用立即踢下线且保留全部审计历史）。<strong>管理员不因此获得业务资料访问权</strong>。</div>
      </div>

      <div class="kpi-grid">
        <div class="metric-box"><div class="metric-head"><span>团队成员总数</span></div><div class="metric-val">${accounts.length} 人</div><div class="muted">正常启用 ${approvedCnt} 人</div></div>
        <div class="metric-box"><div class="metric-head"><span>当前在线会话</span></div><div class="metric-val">${onlineCnt} 人</div><div class="muted">支持单人会话强制撤销</div></div>
        <div class="metric-box"><div class="metric-head"><span>已分配公司授权</span></div><div class="metric-val">${accounts.filter((a) => a.grantCount > 0).length} 人</div><div class="muted">可按成员微调公司权限</div></div>
        <div class="metric-box" style="justify-content:center;"><button class="btn btn-primary" id="btn-new-member">+ 新建企业成员</button></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>团队成员与授权概览</h2>
        </div>
        <div id="admin-msg" style="margin-bottom:10px;"></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>姓名与登录账号</th><th>默认岗位视角</th><th>系统角色</th><th>账号状态</th><th class="amount">可见公司</th><th>管理操作（均留痕）</th></tr></thead>
            <tbody>
              ${accounts.map((a) => `
                <tr style="${a.approval !== "approved" ? "opacity:0.65;" : ""}">
                  <td>
                    <strong>${esc(a.name)}</strong> <span class="muted">(${esc(a.username)})</span>
                    ${a.activeSessions > 0 ? `<span class="prov prov-verified" style="margin-left:4px;">在线</span>` : ""}
                  </td>
                  <td><span class="prov">${esc(ROLES[a.perspective]?.name || a.perspective)}</span></td>
                  <td>${a.role === "admin" ? badge("info", "shield", "管理员") : `<span class="muted">成员</span>`}</td>
                  <td>
                    ${a.approval === "approved" ? badge("good", "check", "已启用") : a.approval === "pending" ? badge("warn", "clock", "待审批") : badge("danger", "x", "已停用")}
                  </td>
                  <td class="amount num">${a.grantCount} 家</td>
                  <td style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary" data-grants="${esc(a.id)}" data-aname="${esc(a.name)}">公司授权</button>
                    <button class="btn btn-sm" data-edit-m="${esc(a.id)}">编辑/停用</button>
                    <button class="btn btn-sm" data-account-name="${esc(a.username)}" data-reset="${esc(a.id)}">重置密码</button>
                    <button class="btn btn-sm btn-danger" data-account-name="${esc(a.username)}" data-revoke="${esc(a.id)}">退出所有设备</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div id="grants-panel"></div>
    `;
    const msg = slot.querySelector("#admin-msg");

    // + Create new member modal
    slot.querySelector("#btn-new-member").addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="新建企业成员">
          <h3 style="margin:0 0 12px;">新建企业成员账号</h3>
          <form id="new-member-form">
            <div class="field"><label>登录账号（英文/数字，3–30位）</label><input class="input" name="username" required pattern="[a-z0-9][a-z0-9._-]{2,29}" placeholder="如：zhangsan 或 bidder03" /></div>
            <div class="field"><label>真实姓名</label><input class="input" name="name" required placeholder="如：张三" /></div>
            <div class="field"><label>默认岗位视角</label><select class="select" name="perspective"><option value="bidder">投标员</option><option value="lead">负责人</option><option value="delegate">授权委托人</option><option value="finance">财务</option></select></div>
            <div class="field"><label>系统角色</label><select class="select" name="role"><option value="member">普通成员</option><option value="admin">系统管理员</option></select></div>
            <div class="field">
              <label>初始公司授权模板（免逐个勾选）</label>
              <select class="select" name="grantPreset">
                <option value="all_view">全集团只读（可查看全部公司标讯与档案）</option>
                <option value="all_work">全集团制标协作（全部公司查看 + 编辑）</option>
                <option value="all_full">全集团全权（查看 + 编辑 + 核实 + 敏感下载）</option>
                <option value="none">暂不分配（稍后按单个公司微调）</option>
              </select>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="nm-cancel">取消</button><button type="submit" class="btn btn-primary">创建并生成临时密码</button></div>
          </form>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector("#nm-cancel").addEventListener("click", () => wrap.remove());
      wrap.querySelector("#new-member-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const r = await api("/admin/members", Object.fromEntries(new FormData(e.target).entries()));
          wrap.remove();
          showToast(`成员 ${r.name}（${r.username}）已创建。`);
          await renderAdminAccounts(root);
          const m2 = root.querySelector("#admin-msg");
          if (m2) {
            m2.innerHTML = `<div class="notice-box warn">${ICONS.lock}<div><strong>新成员「${esc(r.name)}」初始密码（${esc(r.username)}）：</strong><code>${esc(r.password)}</code>，请受控交付本人，登录后可在右上角「改密」自行修改。</div></div>`;
          }
        } catch (err) { showToast(err.message); }
      });
    });

    // Edit / Enable / Disable member modal
    slot.querySelectorAll("[data-edit-m]").forEach((b) => {
      b.addEventListener("click", () => {
        const m = accounts.find((x) => x.id === b.getAttribute("data-edit-m"));
        if (!m) return;
        const wrap = document.createElement("div");
        wrap.className = "modal-backdrop";
        wrap.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true" aria-label="编辑成员">
            <h3 style="margin:0 0 12px;">编辑成员（${esc(m.username)}）</h3>
            <form id="edit-member-form">
              <div class="field"><label>姓名</label><input class="input" name="name" value="${esc(m.name)}" required /></div>
              <div class="field"><label>默认岗位视角</label><select class="select" name="perspective">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${m.perspective === k ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
              <div class="field"><label>系统角色</label><select class="select" name="role"><option value="member" ${m.role === "member" ? "selected" : ""}>普通成员</option><option value="admin" ${m.role === "admin" ? "selected" : ""}>系统管理员</option></select></div>
              <div class="field"><label>账号状态（停用将立即撤销全部登录会话）</label><select class="select" name="approval"><option value="approved" ${m.approval === "approved" ? "selected" : ""}>已启用（正常登录）</option><option value="pending" ${m.approval === "pending" ? "selected" : ""}>待审批</option><option value="rejected" ${m.approval === "rejected" ? "selected" : ""}>已停用（禁止登录）</option></select></div>
              <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn" id="em-cancel">取消</button><button type="submit" class="btn btn-primary">保存变更</button></div>
            </form>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector("#em-cancel").addEventListener("click", () => wrap.remove());
        wrap.querySelector("#edit-member-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            await api(`/admin/members/${encodeURIComponent(m.id)}/update`, Object.fromEntries(new FormData(e.target).entries()));
            wrap.remove();
            showToast("成员信息已更新并留痕。");
            render();
          } catch (err) { showToast(err.message); }
        });
      });
    });

    // Company Grant Matrix + One-Click Batch Presets
    slot.querySelectorAll("[data-grants]").forEach((b) => {
      b.addEventListener("click", async () => {
        const aid = b.getAttribute("data-grants");
        const aname = b.getAttribute("data-aname");
        const panel = slot.querySelector("#grants-panel");
        panel.innerHTML = `<div class="card">正在加载 ${esc(aname)} 的公司授权矩阵…</div>`;
        const rows = await api(`/admin/company-grants?account=${encodeURIComponent(aid)}`);
        panel.innerHTML = `
          <div class="card">
            <div class="card-head">
              <h3>公司 × 四维授权矩阵（${esc(aname)}）</h3>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm" data-batch="all_view">一键全集团只读</button>
                <button class="btn btn-sm" data-batch="all_work">一键全集团制标</button>
                <button class="btn btn-sm" data-batch="all_full">一键全集团全权</button>
                <button class="btn btn-sm btn-danger" data-batch="clear">清空授权</button>
                <button class="btn btn-sm btn-ghost" id="gp-close">关闭</button>
              </div>
            </div>
            ${rows.length ? `
              <div class="table-wrap">
                <table class="tbl">
                  <thead><tr><th>公司</th><th>查看</th><th>编辑</th><th>核实</th><th>敏感下载</th><th>操作</th></tr></thead>
                  <tbody>
                    ${rows.map((r) => `
                      <tr data-cid="${esc(r.id)}">
                        <td><strong>${esc(r.name)}</strong></td>
                        <td><input type="checkbox" data-f="view" ${r.view ? "checked" : ""} /></td>
                        <td><input type="checkbox" data-f="edit" ${r.edit ? "checked" : ""} /></td>
                        <td><input type="checkbox" data-f="verify" ${r.verify ? "checked" : ""} /></td>
                        <td><input type="checkbox" data-f="sensitiveDownload" ${r.sensitiveDownload ? "checked" : ""} /></td>
                        <td><button class="btn btn-sm btn-primary" data-save-g="${esc(r.id)}">保存授权</button></td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="muted">当前尚未创建参投公司，请先在「公司与资料库」中新建公司。</div>`}
          </div>`;
        panel.querySelector("#gp-close")?.addEventListener("click", () => { panel.innerHTML = ""; });
        panel.querySelectorAll("[data-batch]").forEach((bb) => {
          bb.addEventListener("click", async () => {
            await api("/admin/grants/batch", { account: aid, preset: bb.getAttribute("data-batch") });
            showToast("已完成批量公司授权并记入审计日志。");
            b.click();
          });
        });
        panel.querySelectorAll("[data-save-g]").forEach((sb) => {
          sb.addEventListener("click", async () => {
            const tr = sb.closest("tr");
            const payload = {
              account: aid,
              company: sb.getAttribute("data-save-g"),
              view: tr.querySelector('[data-f="view"]').checked,
              edit: tr.querySelector('[data-f="edit"]').checked,
              verify: tr.querySelector('[data-f="verify"]').checked,
              sensitiveDownload: tr.querySelector('[data-f="sensitiveDownload"]').checked,
            };
            await api("/admin/grants", payload);
            showToast("公司授权已保存并记入审计日志。");
          });
        });
      });
    });
    slot.querySelectorAll("[data-reset]").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!await confirmAsync(`重置「${b.dataset.accountName}」的密码后，该账号需要重新登录。`, "重置账号密码", true, "重置密码")) return;
        const r = await api("/admin/reset", { account: b.getAttribute("data-reset") });
        msg.innerHTML = `<div class="notice-box warn">${ICONS.lock}<div><strong>一次性临时密码（${esc(r.username)}）：</strong><code>${esc(r.password)}</code>，请通过受控渠道交付本人，离开页面后无法再次读取。</div></div>`;
      });
    });
    slot.querySelectorAll("[data-revoke]").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!await confirmAsync(`「${b.dataset.accountName}」在所有设备上都需要重新登录。`, "退出所有设备", true, "退出所有设备")) return;
        await api("/admin/revoke", { account: b.getAttribute("data-revoke") });
        showToast("已撤销该账号全部会话并留痕。");
      });
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

async function renderAdminAudit(root) {
  const slot = renderShell(root, "admin-audit", [
    { label: "岗位首页", href: "/" },
    { label: "系统管理", href: "/settings" },
    { label: "操作审计日志" },
  ], `<div class="card">正在读取操作审计日志…</div>`);

  try {
    const q = new URLSearchParams(location.search).get("q") || "";
    const rows = await api("/admin/audit" + (q ? `?q=${encodeURIComponent(q)}&limit=200` : "?limit=200"));
    slot.innerHTML = `
      ${renderSystemTabs("admin-audit")}
      <div class="card" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <form id="audit-search-form" style="display:flex;gap:8px;align-items:center;flex:1;min-width:240px;">
          <input class="input" id="audit-q" value="${esc(q)}" placeholder="按操作名称、目标对象、操作人或结果检索审计记录…" style="flex:1;max-width:420px;height:32px;" />
          <button type="submit" class="btn btn-sm btn-primary">检索</button>
          ${q ? `<button type="button" class="btn btn-sm" id="audit-clear">清空</button>` : ""}
        </form>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="muted" style="font-size:12px;">共 ${rows.length} 条记录</span>
          <button type="button" class="btn btn-sm" id="btn-export-audit-csv">导出审计日志 CSV</button>
        </div>
      </div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>时间（北京时间）</th><th>操作人 ID</th><th>操作</th><th>对象</th><th>结果</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td class="muted num">${esc(r.at)}</td>
                  <td class="muted">${esc(r.actor)}</td>
                  <td><strong>${esc(r.action)}</strong></td>
                  <td class="muted">${esc(r.target)}</td>
                  <td>${r.outcome === "已拦截" ? badge("danger", "alert", "已拦截") : badge("good", "check", r.outcome)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    slot.querySelector("#audit-search-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = slot.querySelector("#audit-q")?.value.trim() || "";
      navigate(v ? `/admin/audit?q=${encodeURIComponent(v)}` : "/admin/audit");
    });
    slot.querySelector("#audit-clear")?.addEventListener("click", () => navigate("/admin/audit"));
    slot.querySelector("#btn-export-audit-csv")?.addEventListener("click", () => {
      const qCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [
        ["时间", "操作人ID", "操作", "对象", "结果"].map(qCsv).join(","),
        ...rows.map((r) => [r.at, r.actor, r.action, r.target, r.outcome].map(qCsv).join(",")),
      ].join("\r\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `审计日志_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("已导出审计日志 CSV。");
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

function openCommandPalette() {
  if (dialogStack.length) return;
  const routes = [
    { label: "岗位首页", hint: "/", path: "/" },
    { label: "机会池（浏览招标公告）", hint: "/opportunities", path: "/opportunities" },
    { label: "资格匹配矩阵（要求×公司）", hint: "/matrix", path: "/matrix" },
    { label: "企查与市场主体画像", hint: "/entities", path: "/entities" },
    { label: "项目库（已选定项目）", hint: "/projects", path: "/projects" },
    { label: "提醒中心", hint: "/alerts", path: "/alerts" },
    { label: "日程与现场（冲突检测）", hint: "/schedule", path: "/schedule" },
    { label: "开标回传", hint: "/opening", path: "/opening" },
    { label: "评标测算 / 结果预估", hint: "/estimate", path: "/estimate" },
    { label: "结果、通知书与合同移交", hint: "/outcomes", path: "/outcomes" },
    { label: "投标复盘与历史下浮率统计", hint: "/review", path: "/review" },
    { label: "资金台账与催退", hint: "/finance", path: "/finance" },
    { label: "公司与资料库", hint: "/companies", path: "/companies" },
    { label: "缺口看板", hint: "/gaps", path: "/gaps" },
    { label: "AI 辅助助手", hint: "/ai", path: "/ai" },
    { label: "来源与同步核验", hint: "/sources", path: "/sources" },
    { label: "系统设置", hint: "/settings", path: "/settings" },
  ];
  const overlay = document.createElement("div");
  overlay.className = "cmd-overlay";
  overlay.innerHTML = `
    <div class="cmd-box" role="dialog" aria-modal="true" aria-label="全局命令与搜索面板">
      <div class="cmd-input-wrap">
        ${ICONS.radar}
        <input id="cmd-q" placeholder="输入关键词搜索公告/主体，或输入页面名称跳转…" autofocus />
        <kbd>ESC</kbd>
      </div>
      <div class="cmd-list" id="cmd-list"></div>
    </div>
  `;
  const close = mountDialog(overlay, { initial: "#cmd-q", onEscape: () => close() });
  const inp = overlay.querySelector("#cmd-q");
  const list = overlay.querySelector("#cmd-list");

  function renderCmds() {
    const q = inp.value.trim();
    const matched = routes.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()) || r.hint.includes(q.toLowerCase()));
    const html = [];
    if (q) {
      html.push(`<button type="button" class="cmd-item selected" data-cmd-go="/opportunities?tab=all&onlyOpen=0&q=${encodeURIComponent(q)}"><span>检索全部公告：「<strong>${esc(q)}</strong>」</span><kbd>Enter</kbd></button>`);
      html.push(`<button type="button" class="cmd-item" data-cmd-go="/entities?kind=tenderer&q=${encodeURIComponent(q)}"><span>检索采购方 / 招标单位画像：「<strong>${esc(q)}</strong>」</span><span class="muted">企查</span></button>`);
    }
    for (const r of matched.slice(0, 10)) {
      html.push(`<button type="button" class="cmd-item" data-cmd-go="${r.path}"><span>${esc(r.label)}</span><span class="muted">${esc(r.hint)}</span></button>`);
    }
    list.innerHTML = html.join("");
    list.querySelectorAll("[data-cmd-go]").forEach((btn) => {
      btn.addEventListener("click", () => {
        close();
        navigate(btn.getAttribute("data-cmd-go"));
      });
    });
  }
  renderCmds();
  inp.focus();
  let cmdComposing = false;
  inp.addEventListener("compositionstart", () => { cmdComposing = true; });
  inp.addEventListener("compositionend", () => { cmdComposing = false; renderCmds(); });
  inp.addEventListener("input", (e) => { if (!e.isComposing && !cmdComposing) renderCmds(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.isComposing || cmdComposing || e.keyCode === 229) return;
      e.preventDefault();
      list.querySelector(".cmd-item")?.click();
    }
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.user && state.user.approval === "approved") {
      openCommandPalette();
    }
  }
});

// ================= 9. REVIEW & HISTORICAL FLOAT-RATE ANALYTICS (/review) =================
function renderTdTrendSvg(trend) {
  if (!trend || !trend.length) {
    return `<div class="muted" style="padding:28px 0;text-align:center;">当前筛选条件下暂无月度趋势数据</div>`;
  }
  const W = 560, H = 190, padL = 38, padR = 18, padT = 20, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = trend.map((d) => Number(d.avgFloatPct || 0));
  const meds = trend.map((d) => Number(d.medianFloatPct || 0));
  const maxV = Math.max(20, Math.ceil(Math.max(...vals, ...meds) / 5) * 5);
  const xOf = (i) => trend.length === 1 ? padL + plotW / 2 : padL + (i / (trend.length - 1)) * plotW;
  const yOf = (v) => padT + plotH - (Math.min(maxV, Math.max(0, v)) / maxV) * plotH;

  const avgPoints = trend.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.avgFloatPct || 0).toFixed(1)}`).join(" ");
  const medPoints = trend.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.medianFloatPct || 0).toFixed(1)}`).join(" ");
  const areaPoints = `${xOf(0).toFixed(1)},${(padT + plotH).toFixed(1)} ${avgPoints} ${xOf(trend.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}`;
  const gridTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({ v: Math.round(maxV * r), y: yOf(maxV * r) }));

  return `
    <div class="td-svg-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近12个月中标下浮率趋势图">
        <defs>
          <linearGradient id="tdAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0052d9" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#0052d9" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        ${gridTicks.map((g) => `
          <line x1="${padL}" y1="${g.y.toFixed(1)}" x2="${W - padR}" y2="${g.y.toFixed(1)}" stroke="#e7e9ee" stroke-dasharray="3,3" />
          <text x="${padL - 6}" y="${(g.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#8b92a1">${g.v}%</text>
        `).join("")}
        <polygon points="${areaPoints}" fill="url(#tdAreaGrad)" />
        <polyline points="${medPoints}" fill="none" stroke="#00a870" stroke-width="1.8" stroke-dasharray="4,3" />
        <polyline points="${avgPoints}" fill="none" stroke="#0052d9" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
        ${trend.map((d, i) => {
          const cx = xOf(i), cy = yOf(d.avgFloatPct || 0);
          return `
            <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.8" fill="#ffffff" stroke="#0052d9" stroke-width="2">
              <title>${esc(d.month)}：平均下浮 ${d.avgFloatPct}% · 中位数 ${d.medianFloatPct}%（${d.sampleCount} 标）</title>
            </circle>
            <text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="#0052d9">${d.avgFloatPct}%</text>
            <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#646a73">${esc(d.month.slice(2))}</text>
          `;
        }).join("")}
      </svg>
    </div>
    <div class="meta-row" style="margin-top:6px;font-size:11px;">
      <span><span class="td-dot" style="background:#0052d9;margin-right:4px;"></span>实线：月度平均下浮率</span>
      <span><span class="td-dot" style="background:#00a870;margin-right:4px;"></span>虚线：月度中位数下浮率</span>
    </div>
  `;
}

function renderTdDonutSvg(won, lost, pending) {
  const total = Math.max(1, won + lost + pending);
  const r = 46, cx = 60, cy = 60, circ = 2 * Math.PI * r;
  const segs = [
    { val: won, color: "#00a870", label: "已中标" },
    { val: lost, color: "#e34d59", label: "未中标" },
    { val: pending, color: "#0052d9", label: "待定标/进行中" },
  ];
  let offset = 0;
  const winRate = (won + lost) > 0 ? ((won / (won + lost)) * 100).toFixed(1) : "—";
  return `
    <div class="td-donut-box">
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="参投结果环形分布">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e7e9ee" stroke-width="14" />
        ${segs.map((s) => {
          const len = (s.val / total) * circ;
          const el = len > 0
            ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`
            : "";
          offset += len;
          return el;
        }).join("")}
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--text)">${winRate}${winRate === "—" ? "" : "%"}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--text-muted)">定标胜率</text>
      </svg>
      <div class="td-donut-legend">
        ${segs.map((s) => `
          <div class="td-legend-row">
            <span><span class="td-dot" style="background:${s.color};margin-right:6px;"></span>${s.label}</span>
            <strong class="num">${s.val} 标（${((s.val / total) * 100).toFixed(0)}%）</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderTdRangeTrack(row, maxScale = 45) {
  if (row.p25FloatPct === null || row.p75FloatPct === null) return `<span class="muted">—</span>`;
  const clamp = (v) => Math.min(100, Math.max(0, (Number(v || 0) / maxScale) * 100));
  const left = clamp(row.p25FloatPct);
  const right = clamp(row.p75FloatPct);
  const width = Math.max(4, right - left);
  const med = clamp(row.medianFloatPct);
  const avg = clamp(row.avgFloatPct);
  return `
    <div class="td-range-wrap" title="P25: ${row.p25FloatPct}% · 中位数: ${row.medianFloatPct}% · 均值: ${row.avgFloatPct}% · P75: ${row.p75FloatPct}%">
      <div class="td-range-iqr" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;"></div>
      <div class="td-range-med" style="left:${med.toFixed(1)}%;"></div>
      <div class="td-range-avg" style="left:${avg.toFixed(1)}%;"></div>
    </div>
  `;
}

function downloadCsvFile(filename, headers, rows) {
  const escCsv = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + [headers.map(escCsv).join(","), ...rows.map((r) => r.map(escCsv).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function renderReview(root) {
  const qs = new URLSearchParams(state.route.split("?")[1] || "");
  const viewTab = qs.get("view") || "market"; // market | company | ledger
  const period = qs.get("period") || "all";
  const reviewPeriod = qs.get("reviewPeriod") || "all";
  const district = qs.get("district") || "all";
  const tradeType = qs.get("tradeType") || "all";
  const budgetTier = qs.get("budgetTier") || "all";
  const unitQuery = qs.get("unitQuery") || "";
  const companyId = qs.get("companyId") || "all";

  const slot = renderShell(root, "review", [
    { label: "岗位首页", href: "/" },
    { label: "复盘与历史下浮率统计" },
  ], `<div class="card">正在计算多维历史中标下浮率（P25–P75 甜点区 / 体量分档 / 月度走势）与本公司复盘数据…</div>`);

  try {
    const data = await api(`/analytics/review?period=${encodeURIComponent(period)}&reviewPeriod=${encodeURIComponent(reviewPeriod)}&district=${encodeURIComponent(district)}&tradeType=${encodeURIComponent(tradeType)}&budgetTier=${encodeURIComponent(budgetTier)}&unitQuery=${encodeURIComponent(unitQuery)}&companyId=${encodeURIComponent(companyId)}`);
    const rv = data.companyReview || {};
    const mkt = data.marketFloatStats || {};
    const cos = data.noticeAttachmentBucket || {};

    function goRev(patch) {
      const next = new URLSearchParams({
        view: viewTab,
        period,
        reviewPeriod,
        district,
        tradeType,
        budgetTier,
        unitQuery,
        companyId,
        ...patch,
      });
      navigate("/review?" + next.toString());
    }

    const maxHistCnt = Math.max(1, ...(mkt.distribution || []).map((d) => d.count));
    const maxDistAvg = Math.max(25, ...(mkt.byDistrict || []).map((d) => Number(d.p75FloatPct || d.avgFloatPct || 0)));

    const renderFilterBar = () => `
      <form id="mkt-filter-form" class="filter-bar" style="margin-bottom:14px;">
        <div class="tabs" style="margin:0;">
          <button type="button" class="tab ${period === "3m" ? "active" : ""}" data-mper="3m">近三月</button>
          <button type="button" class="tab ${period === "6m" ? "active" : ""}" data-mper="6m">近六月</button>
          <button type="button" class="tab ${period === "1y" ? "active" : ""}" data-mper="1y">近一年</button>
          <button type="button" class="tab ${period === "all" ? "active" : ""}" data-mper="all">全部历史</button>
        </div>
        <select class="select" name="district" id="mkt-dist-sel">
          <option value="all" ${district === "all" ? "selected" : ""}>全部县/区（盐城全域）</option>
          ${(mkt.availableDistricts || []).map((dName) => `<option value="${esc(dName)}" ${district === dName ? "selected" : ""}>${esc(dName)}</option>`).join("")}
        </select>
        <select class="select" name="tradeType" id="mkt-trade-sel">
          <option value="all" ${tradeType === "all" ? "selected" : ""}>全部公告类型</option>
          ${(mkt.availableTrades || []).map((tName) => `<option value="${esc(tName)}" ${tradeType === tName ? "selected" : ""}>${esc(tName)}</option>`).join("")}
        </select>
        <select class="select" name="budgetTier" id="mkt-tier-sel">
          <option value="all" ${budgetTier === "all" ? "selected" : ""}>全部控制价体量</option>
          ${(mkt.budgetTiers || []).map((t) => `<option value="${esc(t.key)}" ${budgetTier === t.key ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
        </select>
        <input class="input" name="unitQuery" value="${esc(unitQuery)}" placeholder="搜索某家单位（招标单位 / 中标对手 / 代理）…" style="flex:1;min-width:200px;" />
        <button class="btn btn-primary" type="submit">分析</button>
        ${(district !== "all" || tradeType !== "all" || budgetTier !== "all" || unitQuery || period !== "all") ? `<button class="btn" type="button" id="mkt-reset-btn">重置</button>` : ""}
      </form>
    `;

    // ---- TAB 1: 县区与体量下浮率可视化大盘 + 报价沙盘 ----
    const marketHtml = `
      ${renderFilterBar()}

      <!-- TDesign 4大核心统计卡 -->
      <div class="td-stat-row">
        <div class="td-stat-card">
          <div class="td-stat-label">有效配对标段样本</div>
          <div class="td-stat-value">${mkt.totalSamples ?? 0} <span style="font-size:13px;font-weight:400;" class="muted">个</span></div>
          <div class="td-stat-foot"><span>招标控制价 × 结果中标价精准配对</span></div>
        </div>
        <div class="td-stat-card td-good">
          <div class="td-stat-label">核心中标甜点区（P25 ~ P75）</div>
          <div class="td-stat-value" style="color:var(--good);">${mkt.p25FloatPct !== null && mkt.p75FloatPct !== null ? `${mkt.p25FloatPct}% ~ ${mkt.p75FloatPct}%` : "暂无样本"}</div>
          <div class="td-stat-foot"><span>市场上 50% 的中标价集中落在该下浮带</span></div>
        </div>
        <div class="td-stat-card">
          <div class="td-stat-label">平均中标下浮率 / 中位数</div>
          <div class="td-stat-value" style="color:var(--accent);">${mkt.avgFloatPct !== null ? `${mkt.avgFloatPct}%` : "—"} <span style="font-size:14px;font-weight:500;" class="muted">/ 中位 ${mkt.medianFloatPct !== null ? `${mkt.medianFloatPct}%` : "—"}</span></div>
          <div class="td-stat-foot"><span>极值范围：${mkt.minFloatPct ?? "—"}% ~ ${mkt.maxFloatPct ?? "—"}%</span></div>
        </div>
        <div class="td-stat-card td-warn">
          <div class="td-stat-label">公告附件云端归档（30天滚动保留）</div>
          <div class="td-stat-value">${cos.activeCount ?? 0} <span style="font-size:13px;font-weight:400;" class="muted">份在库</span></div>
          <div class="td-stat-foot"><span>保留 30 天自动清理 · 已清 ${cos.expiredCleanedCount ?? 0} 份</span></div>
        </div>
      </div>

      <!-- 新标报价沙盘（What-if 模拟器） -->
      <div class="td-sim-panel">
        <div class="td-card-head" style="margin-bottom:8px;">
          <h3 class="td-card-title">新标报价沙盘模拟器（按当前筛选的县区 / 类型 / 体量历史区间实时换算）</h3>
          <span class="prov prov-verified">当前参照：${esc(district === "all" ? "盐城全域" : district)} · ${esc(tradeType === "all" ? "全类型" : tradeType)} · ${mkt.totalSamples ?? 0} 个样本</span>
        </div>
        <div class="filter-bar">
          <label class="muted" style="font-size:12px;">拟投项目控制价（万元）：</label>
          <input class="input num" id="sim-ctrl-wan" type="number" step="0.01" value="500" style="width:140px;" />
          <label class="muted" style="font-size:12px;margin-left:8px;">拟测算我方下浮率（%）：</label>
          <input class="input num" id="sim-our-pct" type="number" step="0.1" value="${mkt.medianFloatPct ?? 10}" style="width:110px;" />
          <span class="muted" style="font-size:12px;" id="sim-diagnosis"></span>
        </div>
        <div class="td-sim-result" id="sim-result-box"></div>
      </div>

      <!-- TDesign 可视化双图：分布直方图 + 12个月走势折线图 -->
      <div class="td-chart-grid">
        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">中标下浮率区间分布直方图</h3>
            <span class="td-card-sub">绿色柱条标注最高发下浮带</span>
          </div>
          <div class="td-bar-list">
            ${(mkt.distribution || []).map((b) => {
              const pctW = Math.round((b.count / maxHistCnt) * 100);
              const isPeak = b.count === maxHistCnt && b.count > 0;
              return `
                <div class="td-bar-item">
                  <div class="td-bar-label">${esc(b.label)}</div>
                  <div class="td-bar-track">
                    <div class="td-bar-fill ${isPeak ? "sweet" : ""}" style="width:${pctW}%;"></div>
                  </div>
                  <div class="td-bar-val">${b.count} 标 (${b.ratioPct}%)</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">近 12 个月中标下浮率走势</h3>
            <span class="td-card-sub">观察市场竞争内卷度变化</span>
          </div>
          ${renderTdTrendSvg(mkt.monthlyTrend || [])}
        </div>
      </div>

      <!-- TDesign 标段体量分档（解决大小标均值失真） + 县/区四分位可视化对比 -->
      <div class="td-chart-grid">
        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">按控制价体量分档统计下浮率</h3>
            <span class="td-card-sub">点击体量档位可下钻过滤</span>
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>控制价体量档位</th>
                  <th class="amount">样本</th>
                  <th class="amount">均值 / 中位</th>
                  <th>P25–P75 分布带</th>
                </tr>
              </thead>
              <tbody>
                ${(mkt.byBudgetTier || []).map((t) => `
                  <tr style="${budgetTier === t.tierKey ? "background:var(--accent-soft);" : ""}">
                    <td><button type="button" class="quick-pill" data-pick-tier="${esc(t.tierKey)}"><strong>${esc(t.tierLabel)}</strong></button></td>
                    <td class="amount num">${t.sampleCount}</td>
                    <td class="amount num">${t.avgFloatPct !== null ? `<strong style="color:var(--accent);">${t.avgFloatPct}%</strong> <span class="muted">/ ${t.medianFloatPct}%</span>` : "—"}</td>
                    <td>${renderTdRangeTrack(t, maxDistAvg)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">按细化县 / 区中标下浮率分布对比</h3>
            <span class="td-card-sub">蓝框=P25~P75 · 绿点=均值 · 竖线=中位</span>
          </div>
          <div class="table-wrap" style="max-height:310px;overflow:auto;">
            <table class="tbl">
              <thead>
                <tr>
                  <th>细化县 / 区</th>
                  <th class="amount">样本</th>
                  <th class="amount">均值 / 中位</th>
                  <th>P25–P75 分布带</th>
                </tr>
              </thead>
              <tbody>
                ${(mkt.byDistrict || []).map((dRow) => `
                  <tr style="${district === dRow.district ? "background:var(--accent-soft);" : ""}">
                    <td><button type="button" class="quick-pill" data-pick-dist="${esc(dRow.district)}"><strong>${esc(dRow.district)}</strong></button></td>
                    <td class="amount num">${dRow.sampleCount}</td>
                    <td class="amount num"><strong style="color:var(--accent);">${dRow.avgFloatPct}%</strong> <span class="muted">/ ${dRow.medianFloatPct}%</span></td>
                    <td>${renderTdRangeTrack(dRow, maxDistAvg)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 按公告类型汇总 -->
      <div class="td-card">
        <div class="td-card-head">
          <h3 class="td-card-title">按项目 / 公告类型中标平均下浮率</h3>
          <span class="td-card-sub">点击任意类型联动上方图表与台账</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>公告类型</th>
                <th class="amount">配对样本</th>
                <th class="amount">平均下浮率</th>
                <th class="amount">P25 下浮</th>
                <th class="amount">中位数</th>
                <th class="amount">P75 下浮</th>
                <th>核心分布带</th>
              </tr>
            </thead>
            <tbody>
              ${(mkt.byTrade || []).map((tRow) => `
                <tr style="${tradeType === tRow.tradeType ? "background:var(--accent-soft);" : ""}">
                  <td><button type="button" class="quick-pill" data-pick-trade="${esc(tRow.tradeType)}"><strong>${esc(tRow.tradeType)}</strong></button></td>
                  <td class="amount num">${tRow.sampleCount}</td>
                  <td class="amount num" style="color:var(--accent);font-weight:700;">下浮 ${tRow.avgFloatPct}%</td>
                  <td class="amount num muted">${tRow.p25FloatPct ?? "—"}%</td>
                  <td class="amount num">${tRow.medianFloatPct}%</td>
                  <td class="amount num muted">${tRow.p75FloatPct ?? "—"}%</td>
                  <td>${renderTdRangeTrack(tRow, maxDistAvg)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // ---- TAB 2: 本公司投标复盘（中/未中下浮对比 + 环形图 + ROI + 报价偏差诊断 + 失标归因） ----
    const LOSS_OPTIONS = ["", "报价偏高", "报价偏低/偏离基准", "资审/业绩扣分", "技术标/方案失分", "战略陪跑/测水", "其他原因"];
    const companyHtml = `
      <div class="filter-bar" style="margin-bottom:14px;">
        <label class="muted" style="font-size:12px;">复盘主体公司：</label>
        <select class="select" id="rev-co-sel" style="min-width:230px;">
          <option value="all" ${companyId === "all" ? "selected" : ""}>全部已授权参投公司（汇总）</option>
          ${(rv.companies || state.companies || []).map((c) => `<option value="${esc(c.id)}" ${companyId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
        <label class="muted" style="font-size:12px;margin-left:8px;">复盘时间窗口：</label>
        <div class="tabs" style="margin:0;">
          <button type="button" class="tab ${reviewPeriod === "1m" ? "active" : ""}" data-rper="1m">近 1 个月</button>
          <button type="button" class="tab ${reviewPeriod === "3m" ? "active" : ""}" data-rper="3m">近 3 个月</button>
          <button type="button" class="tab ${reviewPeriod === "6m" ? "active" : ""}" data-rper="6m">近 6 个月</button>
          <button type="button" class="tab ${reviewPeriod === "1y" ? "active" : ""}" data-rper="1y">近 1 年</button>
          <button type="button" class="tab ${reviewPeriod === "all" ? "active" : ""}" data-rper="all">全部周期</button>
        </div>
        <button type="button" class="btn btn-sm" id="btn-export-company-csv" style="margin-left:auto;">导出复盘周报 CSV</button>
      </div>

      <div class="td-stat-row">
        <div class="td-stat-card">
          <div class="td-stat-label">累计参投 / 中标 / 未中标</div>
          <div class="td-stat-value">${rv.totalBids ?? 0} <span style="font-size:14px;font-weight:500;" class="muted">（<span style="color:var(--good);">中 ${rv.wonCount ?? 0}</span> / <span style="color:var(--danger);">未中 ${rv.lostCount ?? 0}</span>）</span></div>
          <div class="td-stat-foot"><span>待开标/评审中：${rv.pendingCount ?? 0} 个 · 定标胜率 ${rv.winRatePct !== null && rv.winRatePct !== undefined ? `${rv.winRatePct}%` : "—"}</span></div>
        </div>
        <div class="td-stat-card td-good">
          <div class="td-stat-label">中了的平均下浮率</div>
          <div class="td-stat-value" style="color:var(--good);">${rv.wonAvgFloatPct !== null && rv.wonAvgFloatPct !== undefined ? `下浮 ${rv.wonAvgFloatPct}%` : "暂无样本"}</div>
          <div class="td-stat-foot"><span>已中标合同总额：${esc(fmtFen(rv.totalWonContractFen || 0))}</span></div>
        </div>
        <div class="td-stat-card td-danger">
          <div class="td-stat-label">没中的平均下浮率</div>
          <div class="td-stat-value" style="color:var(--danger);">${rv.lostAvgFloatPct !== null && rv.lostAvgFloatPct !== undefined ? `下浮 ${rv.lostAvgFloatPct}%` : "暂无样本"}</div>
          <div class="td-stat-foot"><span>用于校准我方报价策略偏差</span></div>
        </div>
        <div class="td-stat-card td-warn">
          <div class="td-stat-label">投标费用支出 / 投入产出 ROI</div>
          <div class="td-stat-value">${esc(fmtFen(rv.totalExpenseFen || 0))}</div>
          <div class="td-stat-foot"><span>${rv.roiMultiple !== null && rv.roiMultiple !== undefined ? `中标合同 / 费用 = ${rv.roiMultiple} 倍` : "按已登记标书与代理费汇总"}</span></div>
        </div>
      </div>

      <div class="td-chart-grid">
        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">参投结构与胜率环形分布</h3>
            <span class="td-card-sub">一眼掌控投、中、失比例</span>
          </div>
          ${renderTdDonutSvg(rv.wonCount || 0, rv.lostCount || 0, rv.pendingCount || 0)}
        </div>

        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">失标主因分布 & 中/未中下浮对比</h3>
            <span class="td-card-sub">在下方明细表可直接打标归因</span>
          </div>
          <div class="td-bar-list" style="margin-bottom:10px;">
            <div class="td-bar-item">
              <div class="td-bar-label">中标平均下浮</div>
              <div class="td-bar-track"><div class="td-bar-fill sweet" style="width:${Math.min(100, (rv.wonAvgFloatPct || 0) * 3)}%;"></div></div>
              <div class="td-bar-val">${rv.wonAvgFloatPct !== null && rv.wonAvgFloatPct !== undefined ? `${rv.wonAvgFloatPct}%` : "—"}</div>
            </div>
            <div class="td-bar-item">
              <div class="td-bar-label">未中平均下浮</div>
              <div class="td-bar-track"><div class="td-bar-fill danger" style="width:${Math.min(100, (rv.lostAvgFloatPct || 0) * 3)}%;"></div></div>
              <div class="td-bar-val">${rv.lostAvgFloatPct !== null && rv.lostAvgFloatPct !== undefined ? `${rv.lostAvgFloatPct}%` : "—"}</div>
            </div>
          </div>
          ${(rv.lossReasons || []).length ? `
            <div class="meta-row">
              ${rv.lossReasons.map((lr) => `<span class="prov prov-raw">${esc(lr.reason)}：${lr.count} 标</span>`).join("")}
            </div>
          ` : `<div class="muted" style="font-size:12px;">暂无失标归因记录。</div>`}
        </div>
      </div>

      ${(rv.byCompany || []).length ? `
        <div class="td-card" style="margin-bottom:14px;">
          <div class="td-card-head"><h3 class="td-card-title">按参投公司汇总复盘</h3></div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>参投公司名称</th>
                  <th class="amount">参投总数</th>
                  <th class="amount">中标数</th>
                  <th class="amount">未中标数</th>
                  <th class="amount">待定标</th>
                  <th class="amount">定标胜率</th>
                  <th class="amount">中了的平均下浮率</th>
                  <th class="amount">没中的平均下浮率</th>
                </tr>
              </thead>
              <tbody>
                ${rv.byCompany.map((c) => `
                  <tr>
                    <td><strong>${esc(c.companyName)}</strong></td>
                    <td class="amount num">${c.totalBids}</td>
                    <td class="amount num" style="color:var(--good);font-weight:600;">${c.wonCount}</td>
                    <td class="amount num" style="color:var(--danger);font-weight:600;">${c.lostCount}</td>
                    <td class="amount num muted">${c.pendingCount}</td>
                    <td class="amount num">${c.winRatePct !== null ? `${c.winRatePct}%` : "—"}</td>
                    <td class="amount num" style="color:var(--good);font-weight:600;">${c.wonAvgFloatPct !== null ? `下浮 ${c.wonAvgFloatPct}%` : "—"}</td>
                    <td class="amount num" style="color:var(--danger);font-weight:600;">${c.lostAvgFloatPct !== null ? `下浮 ${c.lostAvgFloatPct}%` : "—"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      ` : ""}

      <div class="td-card">
        <div class="td-card-head">
          <h3 class="td-card-title">参投项目逐标复盘明细与报价偏差诊断（${(rv.items || []).length} 个标段）</h3>
          <span class="td-card-sub">失标归因下拉修改后即时保存</span>
        </div>
        ${(rv.items || []).length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>参投项目 / 所属县区与类型</th>
                  <th>参投公司 / 结果</th>
                  <th class="amount">控制价 / 我方报价</th>
                  <th class="amount">我方下浮率</th>
                  <th>报价偏差诊断（对比基准/中标价）</th>
                  <th style="width:170px;">失标归因打标</th>
                </tr>
              </thead>
              <tbody>
                ${rv.items.map((it) => {
                  const devHtml = it.deviationPct === null
                    ? `<span class="muted">待录基准/中标价</span>`
                    : it.deviationPct > 0.2
                      ? badge("danger", "alert", `报高 +${it.deviationPct}%`)
                      : it.deviationPct < -0.2
                        ? badge("warn", "info", `报低 ${it.deviationPct}%`)
                        : badge("good", "check", `精准贴合 (${it.deviationPct}%)`);
                  return `
                    <tr>
                      <td>
                        <a class="row-title" href="/projects/${esc(it.noticeId)}" data-go="/projects/${esc(it.noticeId)}">${esc(it.title)}</a>
                        <div class="meta-row">
                          <span class="prov">${esc(it.district)}</span>
                          <span class="prov">${esc(it.tradeType)}</span>
                          <span class="muted">招标人：${esc(it.tenderer || "未标注")}</span>
                        </div>
                      </td>
                      <td>
                        <div>${esc(it.companyName)}</div>
                        <div style="margin-top:4px;">${it.bucket === "won" ? badge("good", "check", it.outcomeStatus) : it.bucket === "lost" ? badge("danger", "alert", it.outcomeStatus) : badge("info", "clock", it.outcomeStatus)}</div>
                      </td>
                      <td class="amount num">
                        <div>控：${it.ctrlYuan > 0 ? esc(fmtYuan(it.ctrlYuan)) : "未标注"}</div>
                        <div class="muted">报：${it.ourQuoteYuan > 0 ? esc(fmtYuan(it.ourQuoteYuan)) : "未录入"}</div>
                      </td>
                      <td class="amount num" style="font-weight:700;color:${it.bucket === "won" ? "var(--good)" : it.bucket === "lost" ? "var(--danger)" : "var(--accent)"};">${it.floatPct !== null ? `下浮 ${it.floatPct}%` : "—"}</td>
                      <td>
                        ${devHtml}
                        ${it.refFloatPct !== null ? `<div class="muted" style="font-size:11px;margin-top:2px;">参照下浮 ${it.refFloatPct}%</div>` : ""}
                      </td>
                      <td>
                        <select class="select" data-loss-tag="${esc(it.noticeId)}" style="width:100%;font-size:12px;padding:4px 8px;">
                          ${LOSS_OPTIONS.map((opt) => `<option value="${esc(opt)}" ${it.lossReason === opt ? "selected" : ""}>${esc(opt || "— 选择复盘归因 —")}</option>`).join("")}
                        </select>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>当前筛选条件下暂无本公司参投项目记录</strong></div>`}
      </div>
    `;

    // ---- TAB 3: 招标单位 & 中标对手库 + 过往配对明细台账（含公告类型 Tab 切换 & CSV 导出） ----
    const ledgerHtml = `
      ${renderFilterBar()}

      <div class="td-chart-grid">
        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">按招标单位（业主）历史平均下浮率排行</h3>
            <span class="td-card-sub">共 ${(mkt.byTenderer || []).length} 家 · 点击单位钻取</span>
          </div>
          <div class="table-wrap" style="max-height:290px;overflow:auto;">
            <table class="tbl">
              <thead>
                <tr>
                  <th>招标单位（采购人/业主）</th>
                  <th class="amount">样本</th>
                  <th class="amount">平均下浮</th>
                  <th class="amount">P25~P75</th>
                </tr>
              </thead>
              <tbody>
                ${(mkt.byTenderer || []).map((uRow) => `
                  <tr>
                    <td><button type="button" class="quick-pill" data-pick-unit="${esc(uRow.unitName)}"><strong>${esc(uRow.unitName)}</strong></button></td>
                    <td class="amount num">${uRow.sampleCount}</td>
                    <td class="amount num" style="color:var(--accent);font-weight:700;">${uRow.avgFloatPct}%</td>
                    <td class="amount num muted">${uRow.p25FloatPct ?? "—"}% ~ ${uRow.p75FloatPct ?? "—"}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="td-card">
          <div class="td-card-head">
            <h3 class="td-card-title">常胜竞争对手（中标单位）习惯下浮率画像</h3>
            <span class="td-card-sub">Top 25 · 含主战场县/区</span>
          </div>
          <div class="table-wrap" style="max-height:290px;overflow:auto;">
            <table class="tbl">
              <thead>
                <tr>
                  <th>中标单位（对手）</th>
                  <th>常驻县区</th>
                  <th class="amount">中标数</th>
                  <th class="amount">惯用下浮</th>
                </tr>
              </thead>
              <tbody>
                ${(mkt.byWinner || []).map((wRow) => `
                  <tr>
                    <td><button type="button" class="quick-pill" data-pick-unit="${esc(wRow.unitName)}">${esc(wRow.unitName)}</button></td>
                    <td><span class="prov">${esc(wRow.topDistrict || "盐城")}</span></td>
                    <td class="amount num">${wRow.sampleCount}</td>
                    <td class="amount num" style="color:var(--good);font-weight:700;">${wRow.avgFloatPct}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="td-card">
        <div class="td-card-head" style="margin-bottom:8px;">
          <div>
            <h3 class="td-card-title">过往配对公告中标下浮率明细台账（前 ${(mkt.samples || []).length} 条）</h3>
            <div class="td-card-sub">展示招标控制价 vs 中标结果价真实配对记录，可一键按公告类型 Tab 切换或导出 CSV</div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-export-market-csv">导出当前台账 CSV</button>
        </div>
        <div class="tabs" style="margin-bottom:10px;flex-wrap:wrap;">
          <button type="button" class="tab ${tradeType === "all" ? "active" : ""}" data-sample-trade="all">全部类型 <span class="tab-num">${mkt.totalSamples ?? 0}</span></button>
          ${(mkt.availableTrades || []).map((tName) => {
            const stat = (mkt.byTrade || []).find((x) => x.tradeType === tName);
            return `<button type="button" class="tab ${tradeType === tName ? "active" : ""}" data-sample-trade="${esc(tName)}">${esc(tName)}${stat ? ` <span class="tab-num">${stat.sampleCount}</span>` : ""}</button>`;
          }).join("")}
        </div>
        ${(mkt.samples || []).length ? `
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>项目名称 / 招标单位</th>
                  <th>细化县/区</th>
                  <th>公告类型 / 体量</th>
                  <th class="amount">招标控制价（元）</th>
                  <th class="amount">中标金额（元）</th>
                  <th class="amount">中标下浮率</th>
                  <th>中标单位 / 定标日期</th>
                </tr>
              </thead>
              <tbody>
                ${mkt.samples.map((s) => `
                  <tr>
                    <td>
                      <a class="row-title" href="/opportunities/${esc(s.resultId)}" data-go="/opportunities/${esc(s.resultId)}">${esc(s.title)}</a>
                      <div class="muted">招标人：${esc(s.tenderer)}</div>
                    </td>
                    <td><span class="prov">${esc(s.district)}</span></td>
                    <td>
                      <span class="prov">${esc(s.tradeType)}</span>
                      <div class="muted" style="font-size:11px;margin-top:2px;">${esc(s.budgetTierLabel || "")}</div>
                    </td>
                    <td class="amount num">${esc(fmtYuan(s.controlYuan))}</td>
                    <td class="amount num">${esc(fmtYuan(s.winYuan))}</td>
                    <td class="amount num" style="color:var(--accent);font-weight:700;">下浮 ${s.floatPct}%</td>
                    <td>
                      <div><strong>${esc(s.winnerUnit)}</strong></div>
                      <div class="muted num">${esc(fmtBeijing(s.published))}</div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><strong>当前筛选条件下暂无配对下浮率样本</strong><div>请尝试切换时间周期为「全部历史」或切换上方公告类型 Tab。</div></div>`}
      </div>
    `;

    slot.innerHTML = `
      <div class="ws-sheet">
        <div class="td-main-tabs" role="tablist">
          <button type="button" class="td-main-tab ${viewTab === "market" ? "active" : ""}" data-rev-view="market">县区与体量下浮率大盘（可视化 + 报价沙盘）</button>
          <button type="button" class="td-main-tab ${viewTab === "company" ? "active" : ""}" data-rev-view="company">本公司投标复盘（胜率 / ROI / 偏差诊断）</button>
          <button type="button" class="td-main-tab ${viewTab === "ledger" ? "active" : ""}" data-rev-view="ledger">单位对手画像与配对明细台账</button>
        </div>
        <div class="ws-sec" style="padding-top:4px;">
          ${viewTab === "company" ? companyHtml : viewTab === "ledger" ? ledgerHtml : marketHtml}
        </div>
      </div>
    `;

    // Wire top view tabs
    slot.querySelectorAll("[data-rev-view]").forEach((b) => b.addEventListener("click", () => goRev({ view: b.getAttribute("data-rev-view") })));

    // Wire Quote Sandbox Simulator (What-if)
    function updateSimulator() {
      const box = slot.querySelector("#sim-result-box");
      const diag = slot.querySelector("#sim-diagnosis");
      if (!box) return;
      const ctrlWan = Math.max(0, Number(slot.querySelector("#sim-ctrl-wan")?.value || 0));
      const ourPct = Number(slot.querySelector("#sim-our-pct")?.value || 0);
      const p25 = mkt.p25FloatPct ?? 8;
      const med = mkt.medianFloatPct ?? 12;
      const p75 = mkt.p75FloatPct ?? 16;
      const calcWan = (pct) => (ctrlWan * (1 - pct / 100)).toFixed(2);
      if (diag) {
        if (ourPct < p25) diag.innerHTML = `<span style="color:var(--danger);font-weight:600;">偏保守（下浮低于历史 P25，报价高于市场主流，中标概率偏低）</span>`;
        else if (ourPct > p75) diag.innerHTML = `<span style="color:var(--warn);font-weight:600;">偏激进（下浮超过历史 P75，需严核成本底线与低价废标风险）</span>`;
        else diag.innerHTML = `<span style="color:var(--good);font-weight:600;">命中核心甜点区（P25 ${p25}% ~ P75 ${p75}%，兼顾得分与利润）</span>`;
      }
      box.innerHTML = `
        <div class="td-sim-tile">
          <div class="muted" style="font-size:12px;">稳健保守策略（按历史 P25 下浮 ${p25}%）</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;" class="num">${calcWan(p25)} 万元</div>
          <div class="muted" style="font-size:11px;">较控制价让利 ${(ctrlWan - Number(calcWan(p25))).toFixed(2)} 万元</div>
        </div>
        <div class="td-sim-tile highlight">
          <div style="font-size:12px;color:var(--accent);font-weight:600;">拟测算我方报价（下浮 ${ourPct}%）</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--accent);" class="num">${calcWan(ourPct)} 万元</div>
          <div class="muted" style="font-size:11px;">历史中位数报价参考：${calcWan(med)} 万元（下浮 ${med}%）</div>
        </div>
        <div class="td-sim-tile">
          <div class="muted" style="font-size:12px;">激进冲标策略（按历史 P75 下浮 ${p75}%）</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;" class="num">${calcWan(p75)} 万元</div>
          <div class="muted" style="font-size:11px;">较控制价让利 ${(ctrlWan - Number(calcWan(p75))).toFixed(2)} 万元</div>
        </div>
      `;
    }
    updateSimulator();
    slot.querySelector("#sim-ctrl-wan")?.addEventListener("input", updateSimulator);
    slot.querySelector("#sim-our-pct")?.addEventListener("input", updateSimulator);

    // Wire filters & drilldowns
    slot.querySelector("#rev-co-sel")?.addEventListener("change", (e) => goRev({ companyId: e.target.value }));
    slot.querySelectorAll("[data-rper]").forEach((b) => b.addEventListener("click", () => goRev({ reviewPeriod: b.getAttribute("data-rper") })));
    slot.querySelectorAll("[data-mper]").forEach((b) => b.addEventListener("click", () => goRev({ period: b.getAttribute("data-mper") })));
    slot.querySelector("#mkt-dist-sel")?.addEventListener("change", (e) => goRev({ district: e.target.value }));
    slot.querySelector("#mkt-trade-sel")?.addEventListener("change", (e) => goRev({ tradeType: e.target.value }));
    slot.querySelector("#mkt-tier-sel")?.addEventListener("change", (e) => goRev({ budgetTier: e.target.value }));
    slot.querySelector("#mkt-filter-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      goRev({
        district: String(fd.get("district") || "all"),
        tradeType: String(fd.get("tradeType") || "all"),
        budgetTier: String(fd.get("budgetTier") || "all"),
        unitQuery: String(fd.get("unitQuery") || "").trim(),
      });
    });
    slot.querySelector("#mkt-reset-btn")?.addEventListener("click", () => goRev({ period: "all", district: "all", tradeType: "all", budgetTier: "all", unitQuery: "" }));
    slot.querySelectorAll("[data-pick-dist]").forEach((b) => b.addEventListener("click", () => goRev({ district: b.getAttribute("data-pick-dist") })));
    slot.querySelectorAll("[data-pick-trade]").forEach((b) => b.addEventListener("click", () => goRev({ tradeType: b.getAttribute("data-pick-trade") })));
    slot.querySelectorAll("[data-pick-tier]").forEach((b) => b.addEventListener("click", () => goRev({ budgetTier: b.getAttribute("data-pick-tier") })));
    slot.querySelectorAll("[data-sample-trade]").forEach((b) => b.addEventListener("click", () => goRev({ tradeType: b.getAttribute("data-sample-trade") })));
    slot.querySelectorAll("[data-pick-unit]").forEach((b) => b.addEventListener("click", () => goRev({ view: "ledger", unitQuery: b.getAttribute("data-pick-unit") })));
    slot.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-go")); }));

    // Wire loss reason quick tagging
    slot.querySelectorAll("[data-loss-tag]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const nid = sel.getAttribute("data-loss-tag");
        try {
          await api("/analytics/review/tag", { noticeId: nid, lossReason: sel.value });
          showToast("已保存该标段复盘归因标签。");
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    // Wire CSV Exports
    slot.querySelector("#btn-export-market-csv")?.addEventListener("click", () => {
      const rows = (mkt.samples || []).map((s) => [
        s.title, s.tenderer, s.district, s.tradeType, s.budgetTierLabel || "",
        s.controlYuan, s.winYuan, `${s.floatPct}%`, s.winnerUnit, fmtBeijing(s.published),
      ]);
      downloadCsvFile(
        `历史中标下浮率台账_${new Date().toISOString().slice(0, 10)}.csv`,
        ["项目名称", "招标单位", "细化县区", "公告类型", "体量档位", "招标控制价(元)", "中标金额(元)", "中标下浮率", "中标单位", "定标日期"],
        rows
      );
    });
    slot.querySelector("#btn-export-company-csv")?.addEventListener("click", () => {
      const rows = (rv.items || []).map((it) => [
        it.title, it.companyName, it.district, it.tradeType, it.outcomeStatus,
        it.ctrlYuan, it.ourQuoteYuan, it.floatPct !== null ? `${it.floatPct}%` : "",
        it.deviationPct !== null ? `${it.deviationPct}%` : "", it.lossReason || "",
      ]);
      downloadCsvFile(
        `本公司投标复盘周报_${new Date().toISOString().slice(0, 10)}.csv`,
        ["项目名称", "参投公司", "细化县区", "公告类型", "结果状态", "控制价(元)", "我方报价(元)", "我方下浮率", "报价偏差", "失标归因"],
        rows
      );
    });
  } catch (err) {
    slot.innerHTML = `<div class="notice-box danger" role="alert">${ICONS.alert}<span>${esc(err.message)}</span></div>`;
  }
}

// ================= ROUTER & BOOT =================
let renderSequence = 0;
let committedRoute = state.route;
const renderRequests = new WeakMap();

function isCurrentRender(root) {
  return renderRequests.get(root) === renderSequence;
}

async function render() {
  const current = document.getElementById("root");
  const visibleSlot = current.querySelector("#main-slot");
  const approved = state.user?.approval === "approved";
  if (!approved) closeRouteDialogs();
  const stage = approved && visibleSlot && !visibleSlot.hasAttribute("data-first-load");
  const root = current.cloneNode(false);
  const route = state.route;
  renderRequests.set(root, ++renderSequence);
  const pending = renderPage(root);
  if (!stage) {
    root.inert = current.inert;
    current.replaceWith(root);
  }
  const slot = root.querySelector("#main-slot");
  if (!slot) {
    committedRoute = route;
    return true;
  }
  const liveSlot = stage ? visibleSlot : slot;
  if (!stage) slot.dataset.firstLoad = "";
  const progress = (stage ? current : root).querySelector("#route-loading");
  liveSlot.setAttribute("aria-busy", "true");
  if (stage) liveSlot.dataset.routePending = "";
  const timer = setTimeout(() => {
    if (!isCurrentRender(root) || !progress.isConnected) return;
    progress.hidden = false;
    progress.textContent = stage ? "正在切换页面…" : "正在加载页面…";
  }, 350);
  try {
    await pending;
    if (!isCurrentRender(root)) return false;
    slot.querySelectorAll(routeTabSelector).forEach((button) => {
      if (button.getAttribute("role") !== "tab") {
        button.setAttribute("aria-pressed", String(button.classList.contains("active")));
      }
    });
    const error = slot.firstElementChild;
    if (error?.matches(".notice-box.danger")) {
      error.setAttribute("role", "alert");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-sm";
      retry.textContent = "重试";
      retry.addEventListener("click", async () => {
        if (await render()) document.getElementById("main-content")?.focus({ preventScroll: true });
      });
      slot.appendChild(retry);
    }
    if (stage) {
      root.inert = current.inert;
      current.replaceWith(root);
    }
    committedRoute = route;
    return true;
  } finally {
    clearTimeout(timer);
    if (isCurrentRender(root)) {
      progress.hidden = true;
      liveSlot.removeAttribute("aria-busy");
      delete liveSlot.dataset.routePending;
      delete slot.dataset.firstLoad;
    }
  }
}

function renderPage(root) {
  if (!state.user || state.user.approval !== "approved") {
    return renderAuth(root);
  }
  const path = state.route.split("?")[0];
  const detailMatch = path.match(/^\/opportunities\/(\d+)$/);
  if (detailMatch) return renderDetail(root, detailMatch[1], false);
  const projDetailMatch = path.match(/^\/projects\/(\d+)$/);
  if (projDetailMatch) return renderDetail(root, projDetailMatch[1], true);
  const compMatch = path.match(/^\/companies\/([^/]+)$/);
  if (compMatch) return renderCompanyDetail(root, decodeURIComponent(compMatch[1]));
  if (path === "/companies") return renderCompanies(root);
  if (path === "/matrix") return renderMatrix(root);
  if (path === "/entities") return renderEntities(root);
  if (path === "/gaps") return renderGaps(root);
  if (path === "/projects") return renderProjects(root);
  if (path === "/review") return renderReview(root);
  if (path === "/finance") return renderFinance(root);
  if (path === "/schedule") return renderSchedule(root);
  if (path === "/opening") return renderOpening(root);
  if (path === "/estimate") return renderEstimate(root);
  if (path === "/outcomes") return renderOutcomes(root);
  if (path === "/ai") return renderAiPage(root);
  if (path === "/settings") return renderSettings(root);
  if (path === "/opportunities") return renderOpportunities(root);
  if (path === "/alerts") return renderAlerts(root);
  if (path === "/sources") return renderSources(root);
  if (path === "/admin/accounts" && state.user.role === "admin") return renderAdminAccounts(root);
  if (path === "/admin/audit" && state.user.role === "admin") return renderAdminAudit(root);
  return renderHome(root);
}

async function bootSession() {
  try {
    state.user = await api("/session");
    if (state.user && state.user.approval === "approved") {
      // Strictly bind homepage role to DB perspective (configured by admin)
      state.perspective = (state.user.perspective && ROLES[state.user.perspective]) ? state.user.perspective : "lead";
      localStorage.removeItem("br-role");
      const [emps, comps, sets, fin] = await Promise.all([
        api("/employees").catch(() => []),
        api("/companies").catch(() => []),
        api("/settings").catch(() => ({ requireAssigneeOnSelect: false })),
        api("/finance").catch(() => ({ payTasks: [] })),
      ]);
      state.employees = emps;
      state.companies = comps;
      state.settings = sets;
      state.pendingPayCount = (fin?.payTasks || []).filter((t) => t.status === "pending").length;
    }
  } catch {
    state.user = null;
  }
  render();
}

bootSession();
