window.__HCR_APP_JS_LOADED = true;
// DeveloperHCR:AI Agent — v2.0-beta — frontend
// Desktop shell + window manager + built-in apps.
// New apps are added by pushing into APPS[] — existing apps are never
// removed/rewritten to add a new one (matches the project's modular rule).

const BOOT_STEPS = [
  "Initializing DeveloperHCR core...",
  "Checking local AI runtimes...",
  "Preparing desktop environment...",
  "Ready.",
];

let ws = null;
let zTop = 10;
let currentUser = null; // set after login - {id, username, role, status, created_at}
let currentFeatures = { plan: "FREE", features: ["notes","calculator","games","basic_ai"] };
let appSettings = { sound_enabled: true, sound_volume: 0.45 };
let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch (_) {}
}
["pointerdown", "touchstart", "keydown"].forEach(evt =>
  document.addEventListener(evt, unlockAudio, { once: true, passive: true })
);

function playUISound(kind = "open") {
  if (appSettings.sound_enabled === false) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = { boot:[220,330], login:[440,660], open:[520,760], click:[380,460], success:[520,780], error:[220,150] };
    const pair = tones[kind] || tones.open;
    const vol = Math.max(0.05, Math.min(0.5, Number(appSettings.sound_volume) || 0.45));
    const fire = () => {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(pair[0], now);
      osc.frequency.exponentialRampToValueAtTime(pair[1], now + 0.09);
      gain.gain.setValueAtTime(vol * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.2);
    };
    // On mobile, a suspended context produces total silence even though no
    // error is thrown - resume() first (this call happens inside a user
    // gesture almost every time playUISound is used) and only fire once
    // it's actually running, instead of firing blind.
    if (audioCtx.state === "suspended") {
      audioCtx.resume().then(fire).catch(() => {});
    } else {
      fire();
    }
  } catch (_) {}
}
const openWindows = {}; // appId -> element

async function api(path, opts = {}) {
  // All ordinary JSON requests get a hard timeout so a broken/local server
  // can never freeze the desktop. Streaming AI uses fetch() directly.
  const timeoutMs = Number(opts.timeoutMs || 5000);
  const clean = { ...opts };
  delete clean.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { credentials: "same-origin", ...clean, signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch (_) { return { error: text || `HTTP ${res.status}` }; }
  } catch (e) {
    return { error: e?.name === "AbortError" ? "Request timed out." : (e?.message || "Network request failed.") };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Boot sequence ----------------
async function boot() {
  // The inline boot in index.html owns the visible 5-second timer.
  // This function only starts non-blocking AI runtime observation when needed.
  if (window.__HCR_INLINE_BOOT_ACTIVE__) return;
  const screen=document.getElementById("boot-screen"), login=document.getElementById("login-form");
  const show=()=>{ if(screen){screen.style.display="none";screen.style.pointerEvents="none";} document.getElementById("auth-screen")?.style.setProperty("display","flex"); login?.classList.remove("hidden"); };
  const started=performance.now();
  const tick=()=>{ if(performance.now()-started>=5000){show();return;} requestAnimationFrame(tick); };
  tick();
}

// ---------------- v0.2: Auth gate (setup / login) ----------------
async function runAuthGate() {
  const authScreen = document.getElementById("auth-screen");
  if (authScreen) authScreen.style.display = "flex";
  const login = document.getElementById("login-form");
  login?.classList.remove("hidden");
  // Each wiring call is isolated: if one throws (e.g. a missing element),
  // the others still run instead of the whole auth gate silently failing,
  // and the failure is reported instead of hidden.
  const wireErrors = [];
  for (const [name, fn] of [["login", wireLoginForm], ["guest", wireGuestButtons], ["agreementPreview", wireAgreementPreview]]) {
    try { fn(); } catch (e) { wireErrors.push(`${name}: ${e?.message || e}`); }
  }
  if (wireErrors.length) {
    const msg = wireErrors.join("; ");
    if (typeof window.__HCR_SHOW_STARTUP_ERROR__ === "function") window.__HCR_SHOW_STARTUP_ERROR__(msg);
    else { const errEl = document.getElementById("login-error"); if (errEl) errEl.textContent = "Startup issue: " + msg + " — try Reload."; }
  }
  // First run: the user chooses the Admin username/password. Internal control
  // state is never shown in the login UI.
  // Robust first-run Admin detection: retry briefly instead of silently falling
  // back to the login form when the local server is still warming up.
  const setupHint = document.getElementById("login-error");
  if (setupHint) setupHint.textContent = "Checking Admin setup…";
  for (let attempt=0; attempt<8; attempt++) {
    try {
      const authStatus = await api("/api/auth/status", {timeoutMs:2500});
      if (authStatus && authStatus.admin_configured === false) { if (setupHint) setupHint.textContent = "First launch: create your Admin account using Create Admin. The login screen is ready."; return; }
      if (authStatus && authStatus.admin_configured === true) { if (setupHint) setupHint.textContent = ""; break; }
    } catch (_) {}
    await new Promise(r=>setTimeout(r,500));
  }
  try {
    const [me, settings] = await Promise.all([
      api("/api/auth/me", { timeoutMs: 1200 }),
      api("/api/settings", { timeoutMs: 1200 }),
    ]);
    if (settings && !settings.error) appSettings = settings;
    if (me && me.logged_in) {
      enterDesktop(me.user);
      return;
    }
    if (me && me.error && !wireErrors.length) {
      // Server unreachable is a different problem than a broken UI — say so.
      const errEl = document.getElementById("login-error");
      if (errEl && !errEl.textContent) errEl.textContent = "Note: couldn't reach the local server yet (" + me.error + "). You can still try logging in once it's running.";
    }
  } catch (_) {}
}

function enterDesktop(user) {
  window.__HCR_DESKTOP_ENTERED__ = true;
  currentUser = user;
  const authScreen=document.getElementById("auth-screen");
  if(authScreen){authScreen.style.display="none";authScreen.style.pointerEvents="none";}
  const desktop=document.getElementById("desktop");
  if(desktop) desktop.style.display="block";
  // Desktop is visible immediately; optional initialization can finish in the background.
  try { const p=initDesktop(); if(p && typeof p.catch==='function') p.catch(()=>{}); } catch (_) {}
  // Admin users get a visible Windows-style Admin Control Center immediately
  // after login so the Admin screen can never appear to be missing.
  if (user && user.role === "ADMIN") {
    setTimeout(() => { try { if (!openWindows.admin) openApp("admin"); } catch (_) {} }, 350);
  }
  // v1.0 BETA fix: this consent flow (privacy mode + optional Admin sync)
  // already existed in JS and on the server, but the HTML for the screen it
  // shows was missing and nothing ever called it, so it silently never ran.
  showAgreementIfNeeded().catch(()=>{});
}


function showAdminSetup(){
  const login=document.getElementById("login-form"); if(!login)return;
  login.innerHTML=`<div class="note-card"><b>First Admin Setup</b><div class="dim">Create the main Admin account for this installation. This screen appears automatically when no user-facing Admin exists. No password is preconfigured.</div></div><input id="admin-setup-username" autocomplete="username" placeholder="Create Admin username"><input id="admin-setup-password" type="password" autocomplete="new-password" placeholder="Create Admin password"><input id="admin-setup-confirm" type="password" autocomplete="new-password" placeholder="Confirm Admin password"><button class="btn primary" id="admin-setup-submit">Create Admin & Continue</button><button class="btn" id="admin-setup-back">Back to Login</button><div id="login-error" class="auth-error"></div>`;
  const submit=async()=>{const u=document.getElementById('admin-setup-username').value.trim(),p=document.getElementById('admin-setup-password').value,c=document.getElementById('admin-setup-confirm').value,e=document.getElementById('login-error');if(u.length<3||p.length<8||p!==c){e.textContent='Username must be 3+ characters; password 8+ characters and both passwords must match.';return;}const r=await api('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p}),timeoutMs:7000});if(r.error){e.textContent=r.error;return;}currentUser=r.user;showAccessSetup();};
  document.getElementById('admin-setup-submit').onclick=submit;
  document.getElementById('admin-setup-back').onclick=()=>location.reload();
}

function showAccessSetup(){
  const login=document.getElementById("login-form"); if(!login)return;
  login.innerHTML=`<div class="note-card"><b>Access Setup</b><div class="dim">Configure Friends Only and Subscribers Only access. Passwords are stored as salted hashes. Internal system control stays hidden.</div></div><input id="access-friend-name" autocomplete="off" placeholder="Friends Only name (e.g. Friends)"><input id="access-friend-password" type="password" autocomplete="new-password" placeholder="Friends Only password"><input id="access-subscriber-password" type="password" autocomplete="new-password" placeholder="Subscribers Only password"><div class="row"><button class="btn primary" id="access-setup-submit">Save Access & Continue</button><button class="btn" id="access-setup-skip">Skip for now</button></div><div id="login-error" class="auth-error"></div>`;
  const done=()=>{enterDesktop(currentUser);};
  document.getElementById('access-setup-submit').onclick=async()=>{
    const e=document.getElementById('login-error');
    const payload={friend_name:document.getElementById('access-friend-name').value.trim(),friend_password:document.getElementById('access-friend-password').value,subscriber_password:document.getElementById('access-subscriber-password').value};
    const r=await api('/api/auth/setup-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),timeoutMs:7000});
    if(r.error){e.textContent=r.error;return;} done();
  };
  document.getElementById('access-setup-skip').onclick=done;
}

function wireSetupForm() {
  // Kept as a compatibility no-op for older callers. Admin setup is not shown once a packaged owner exists.
}

// v3.8: public self-signup (wireSignupForm) removed - there is no more
// NORMAL_USER tier. Only the Admin (first run) and Admin accounts the
// Admin creates from the Admin Dashboard can log in.


function wireAgreementPreview(){
  const b=document.getElementById("show-agreement");
  if(!b || b.dataset.wired==="1") return;
  b.dataset.wired="1";
  b.onclick=()=>{ const s=document.getElementById("agreement-screen"); if(s) s.style.display="flex"; };
  const closeBtn=document.getElementById("agreement-close");
  if(closeBtn && !closeBtn.dataset.wired){
    closeBtn.dataset.wired="1";
    closeBtn.onclick=()=>{ const s=document.getElementById("agreement-screen"); if(s) s.style.display="none"; };
  }
}

function wireLoginForm() {
  if (window.__hcrLoginWired) return;
  const btn = document.getElementById("login-submit");
  const userEl = document.getElementById("login-username");
  const passEl = document.getElementById("login-password");
  if (!btn || !userEl || !passEl) return;
  window.__HCR_MAIN_LOGIN__ = enterDesktop;
  const submit = async (event) => {
    event?.preventDefault?.();
    const username = (userEl.value || "").trim();
    const password = passEl.value || "";
    const rememberEl = document.getElementById("login-remember");
    const errEl = document.getElementById("login-error");
    if (!username) { if (errEl) errEl.textContent = "Username is required."; userEl.focus(); return; }
    if (!password) { if (errEl) errEl.textContent = "Password is required."; passEl.focus(); return; }
    if (errEl) errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember: rememberEl ? !!rememberEl.checked : true }),
        timeoutMs: 7000,
      });
      if (res.error) { if (errEl) errEl.textContent = res.error; return; }
      currentUser = res.user;
      window.__hcrLoginWired = true;
      playUISound("login");
      enterDesktop(res.user);
    } catch (e) {
      if (errEl) errEl.textContent = e?.message || "Could not connect to the local server.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Start";
    }
  };
  window.__hcrLoginWired = true;
  const quickBtn = document.getElementById("login-quick-unlock");
  if(quickBtn) quickBtn.onclick = async () => {
    const errEl = document.getElementById("login-error");
    const uname = (userEl.value || "").trim() || window.prompt("Username for Quick Unlock:");
    if (!uname) return;
    const st = await api("/api/auth/quick-status?username=" + encodeURIComponent(uname), { timeoutMs: 4000 });
    if (!st || st.error || !st.enabled) { if (errEl) errEl.textContent = "Quick Unlock isn't enabled for that account yet — turn it on first in Security Center."; return; }
    const pin = window.prompt("Enter your Quick Unlock PIN:");
    if (!pin) return;
    const r = await api("/api/auth/quick-unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: uname, pin }), timeoutMs: 7000 });
    if (r.error) { if (errEl) errEl.textContent = r.error; return; }
    currentUser = r.user;
    playUISound("login");
    enterDesktop(r.user);
  };
  btn.onclick = submit;
  const resetBtn = document.getElementById("login-factory-reset");
  if (resetBtn) resetBtn.onclick = async () => {
    const yes = window.confirm("Reset DeveloperHCR system data?\n\nClick OK / Yes to confirm and continue to the final confirmation. NO will cancel and change nothing.\n\nThis does not format the device or delete the application source.");
    if (!yes) { const e=document.getElementById("login-error"); if(e)e.textContent="Reset cancelled — nothing was changed."; return; }
    const phrase = window.prompt("Final confirmation\n\nType YES exactly to confirm the system reset.\n\nNo password is required for this reset confirmation.");
    if ((phrase || "").trim().toUpperCase() !== "YES") { const e=document.getElementById("login-error"); if(e)e.textContent="Reset cancelled — you must type YES exactly."; return; }
    resetBtn.disabled=true; resetBtn.textContent="Resetting…";
    try {
      const r=await api("/api/auth/factory-reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirm:"YES"}),timeoutMs:20000});
      if(r.error){const e=document.getElementById("login-error");if(e)e.textContent=r.error;return;}
      try{localStorage.clear();sessionStorage.clear();}catch(_){}
      window.alert("System reset complete. First Admin Setup will now appear.");
      location.reload();
    } catch(e) { const err=document.getElementById("login-error"); if(err)err.textContent=e?.message||"Factory reset failed."; }
    finally { resetBtn.disabled=false; resetBtn.textContent="Reset System"; }
  };
  const createAdminBtn=document.getElementById("login-create-admin");
  if(createAdminBtn) createAdminBtn.onclick=async()=>{
    // Always expose the First Admin form from the login screen. The server is
    // the final authority and rejects duplicate Admin creation. This avoids a
    // missing-setup UI when startup/status checks are delayed or cached.
    showAdminSetup();
  };
  [userEl, passEl].forEach(el => el.addEventListener("keydown", e => {
    if (e.key === "Enter") submit(e);
  }));
}


function showJyotishGuestIntro(){
  const old=document.getElementById("jyotish-guest-intro"); if(old)old.remove();
  const box=document.createElement("div"); box.id="jyotish-guest-intro"; box.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px";
  box.innerHTML=`<div style="width:min(560px,94vw);background:#171b23;border:1px solid #39404d;border-radius:18px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.5);color:#fff"><h2 style="margin:0 0 12px">Jyotish</h2><div class="dim" style="margin-bottom:18px">Friends Only access</div><div style="white-space:pre-wrap;line-height:1.6;margin-bottom:20px">Temporary guest access is active for 10 minutes. Your guest data is removed when the session ends.</div><div class="row" style="justify-content:flex-end"><button class="btn" id="jyotish-exit">Exit</button><button class="btn primary" id="jyotish-yes">Yes, I am</button></div></div>`;
  document.body.appendChild(box);
  box.querySelector("#jyotish-exit").onclick=async()=>{await api("/api/guest/exit",{method:"POST"});location.reload();};
  box.querySelector("#jyotish-yes").onclick=()=>box.remove();
}

async function startGuestMode(mode){
  const label = mode === "friends_only" ? "Friends Only" : "Subscribers Only";
  const profile = mode === "friends_only" ? (window.prompt("Friends Only name", "Friends") || "Friends") : "Subscribers Only";
  const password = window.prompt(`${label} password`);
  if (!password) return;
  const r = await api("/api/guest/start", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,profile,password}),timeoutMs:7000});
  if(r.error){ const e=document.getElementById("login-error"); if(e)e.textContent=r.error; return; }
  currentUser=r.user;
  playUISound("login");
  enterDesktop(r.user);
  startGuestTimer(Number(r.minutes||10), r.expires_at);
  if(mode === "friends_only") showJyotishGuestIntro();
}
function startGuestTimer(minutes, expiresAt){
  if(window.__guestTimer)clearInterval(window.__guestTimer);
  const tick=()=>{
    const ms=Math.max(0,new Date(expiresAt).getTime()-Date.now());
    const m=Math.floor(ms/60000), sec=Math.floor((ms%60000)/1000);
    const el=document.getElementById("user-widget"); if(el)el.textContent=`Guest · ${m}:${String(sec).padStart(2,"0")}`;
    if(ms<=0){clearInterval(window.__guestTimer); api("/api/guest/exit",{method:"POST"}).catch(()=>{}); location.reload();}
  };
  tick(); window.__guestTimer=setInterval(tick,1000);
}
function wireGuestButtons(){
  const a=document.getElementById("guest-friends"), b=document.getElementById("guest-subscribers");
  if(a&&!a.dataset.wired){a.dataset.wired="1";a.onclick=()=>startGuestMode("friends_only");}
  if(b&&!b.dataset.wired){b.dataset.wired="1";b.onclick=()=>startGuestMode("subscription_only");}
  // v1.0 BETA fix: #guest-status existed in the HTML but nothing ever wrote
  // to it, so the "only one guest at a time" occupancy rule was invisible
  // until after someone typed a password and got rejected.
  const statusEl=document.getElementById("guest-status");
  if(statusEl){
    api("/api/guest/status",{timeoutMs:1500}).then(r=>{
      if(r && !r.error && r.occupied) statusEl.textContent="Guest access (Friends/Subscribers Only) is currently in use by someone else. Try again in a few minutes.";
    }).catch(()=>{});
  }
}

function startOptionalAdminSync(){
  if(window.__hcrSyncTimer) clearInterval(window.__hcrSyncTimer);
  window.__hcrSyncTimer=setInterval(async()=>{
    try{ const st=await api("/api/agreements/status"); if(st.accepted&&st.sync_consent&&st.privacy_mode==="standard"){ await api("/api/sync/flush",{method:"POST"}); } }catch(_){}
  },30000);
}

async function showAgreementIfNeeded(){
  try{
    const st=await api("/api/agreements/status");
    if(st.accepted) return;
    const screen=document.getElementById("agreement-screen"); if(!screen)return;
    screen.style.display="flex";
    const privacy=document.getElementById("agreement-privacy"); if(privacy) privacy.value=st.privacy_mode||"standard";
    document.getElementById("agreement-accept").onclick=async()=>{
      const r=await api("/api/agreements/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sync_consent:document.getElementById("agreement-sync").checked,privacy_mode:privacy.value})});
      if(r.error){document.getElementById("agreement-error").textContent=r.error;return;}
      screen.style.display="none";
      playUISound("success");
    };
  }catch(e){ console.warn("agreement check failed",e); }
}

let __hcrAiMonitorTimer = null;
let __hcrControlMonitorTimer = null;
function startControlCenterMonitor(){
  if(__hcrControlMonitorTimer) return;
  const check=async()=>{try{const r=await api('/api/system',{timeoutMs:1800});const el=document.getElementById('net-status');if(el){el.textContent=r.online?'● Online':'● Offline';el.title=`CPU ${r.cpu_percent??'n/a'}% · RAM ${r.ram_used_percent??'n/a'}%`;el.dataset.health=r.online?'ok':'offline';}}catch(_){}};
  void check(); __hcrControlMonitorTimer=setInterval(check,20000);
}

function startAiRuntimeMonitor() {
  if (__hcrAiMonitorTimer) return;
  const check = async () => {
    try {
      const st = await api("/api/ai/providers", {timeoutMs: 1800});
      const active = Object.entries(st || {}).filter(([,v]) => v && (v.running || v.generating)).map(([k]) => k);
      document.body.dataset.aiRuntime = active.join(",") || "idle";
      const el = document.getElementById("net-status");
      if (el && active.length) el.title = `AI runtime active: ${active.join(", ")}`;
    } catch (_) {}
  };
  void check();
  __hcrAiMonitorTimer = setInterval(check, 10000);
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
}

// ---------------- Platform-specific UI ----------------
function initPlatformUI() {
  const ua = navigator.userAgent || "";
  const android = /Android/i.test(ua) || /Termux/i.test(ua);
  const windows = /Windows NT/i.test(ua);
  document.body.classList.toggle("android-ui", android);
  document.body.classList.toggle("windows-ui", windows);
  document.body.dataset.platformUi = android ? "android" : (windows ? "windows" : "desktop");
}

// ---------------- Desktop shell ----------------
async function initDesktop() {
  initPlatformUI();
  try {
    const [settings, features] = await Promise.all([
      api("/api/settings", {timeoutMs:900}),
      api("/api/access/features", {timeoutMs:900})
    ]);
    if (settings && !settings.error) appSettings = settings;
    if (features && !features.error) currentFeatures = features;
  } catch (_) {}
  buildLauncher();
  buildDesktopIcons();

  // Start-menu outside-click handling is owned by installFinalShellController().
  // Keeping a second document click handler here caused touch/click event races.

  updateClock();
  setInterval(updateClock, 1000);
  refreshNetStatus();
  setInterval(refreshNetStatus, 15000);

  const userWidget = document.getElementById("user-widget");
  const visibleIdentity = escapeHtml(currentUser.username);
  const roleBadge = '<span class="badge">ADMIN</span>';
  userWidget.innerHTML = `${visibleIdentity} ${roleBadge} <button class="btn" id="logout-btn" style="padding:2px 8px; margin-left:4px;">Logout</button>`;
  document.getElementById("logout-btn").onclick = logout;

  connectEvents();
  loadTheme();
  buildDesktopIcons();
  initZoomControls();
  initCustomCursor();
  initThemeToggle();
  initFullscreen();
  initVirtualMouse();
  applyDesktopPrefs();
  const keyboardBtn = document.getElementById("keyboard-btn");
  if (keyboardBtn && !keyboardBtn.dataset.hcrWired) { keyboardBtn.dataset.hcrWired = "1"; keyboardBtn.onclick = openVirtualKeyboard; }
  const landscapeBtn = document.getElementById("landscape-btn");
  if (landscapeBtn && !landscapeBtn.dataset.hcrWired) { landscapeBtn.dataset.hcrWired = "1"; landscapeBtn.onclick = async () => { document.body.classList.toggle("landscape-mode"); try { await screen.orientation?.lock?.("landscape"); } catch (_) {} }; }
  // v1.0 BETA: Start/Search are wired by the final delegated shell controller below.
  const quickRail = document.getElementById("hcr-quick-rail");
  if (quickRail && !quickRail.dataset.wired) {
    quickRail.dataset.wired="1";
    ["files","terminal","aichat","jarvis","settings","control"].forEach(id=>{const app=APPS.find(a=>a.id===id);if(!app)return;const b=document.createElement("button");b.type="button";b.className="quick-launch";b.title=app.name;b.setAttribute("aria-label",app.name);b.innerHTML=`<span>${app.glyph}</span>`;b.onclick=()=>openApp(id);quickRail.appendChild(b);});
  }


  startOptionalAdminSync();
  startControlCenterMonitor(); startAiRuntimeMonitor();
  if (!document.body.dataset.soundWired) {
    document.body.dataset.soundWired = "1";
    document.addEventListener("click", (e) => {
      const el = e.target.closest("button, .app-icon, .tray-item");
      if (el && !["sound-test"].includes(el.id)) playUISound("click");
    });
  }
}

// ---------------- v1.0: Desktop icons ----------------
// (the actual implementation is buildDesktopIcons() further down, which
// supports pinning/removing shortcuts via drag — see initLauncherDrag)

// ---------------- v1.0: UI Zoom (manual only, never automatic) ----------------
function initZoomControls() {
  let zoom = parseFloat(localStorage.getItem("hcr-zoom") || "1");
  applyZoom(zoom);
}
function currentZoom() {
  return parseFloat(document.documentElement.style.getPropertyValue("--ui-zoom") || "1");
}
function applyZoom(z) {
  z = Math.round(z * 100) / 100;
  document.documentElement.style.setProperty("--ui-zoom", z);
  localStorage.setItem("hcr-zoom", z);
  const label = document.getElementById("zoom-level");
  if (label) label.textContent = Math.round(z * 100) + "%";
}
function initFullscreen() {
  const b=document.getElementById("fullscreen-btn"); if(!b)return;
  const restore=document.getElementById("fullscreen-restore-btn");
  const sync=()=>{
    const fs=!!document.fullscreenElement || document.body.classList.contains("app-fullscreen-fallback");
    b.title=fs?"Exit full screen":"Full screen";
    document.body.classList.toggle("desktop-fullscreen",fs);document.body.classList.toggle("fullscreen-taskbar-visible",fs && localStorage.getItem("hcr-show-taskbar-fullscreen")!=="0");
    if(restore) restore.setAttribute("aria-hidden",fs?"false":"true");
  };
  const toggle=async()=>{
    try {
      if(!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch(e) { document.body.classList.toggle("app-fullscreen-fallback"); sync(); }
  };
  b.onclick=toggle;
  restore?.addEventListener("click",toggle);
  document.addEventListener("fullscreenchange",sync); sync();
}

// ---------------- v1.0: Custom mouse cursor (dot -> text-beam over text) ----------------
function initCustomCursor() {
  // Native OS/browser cursor is the only cursor in BETA. The old glowing
  // circle cursor caused lag and pointer desynchronisation on Android/PC.
  document.body.classList.remove("custom-cursor-mode");
  document.body.classList.remove("virtual-mouse");
  document.documentElement.style.cursor = "auto";
}

function initVirtualMouse() {
  const btn = document.getElementById("mouse-mode-btn");
  if (btn && !btn.dataset.hcrWired) {
    btn.dataset.hcrWired = "1";
    btn.onclick = () => toggleVirtualMousePanel();
  }
}
function setCustomCursorEnabled(on) {
  localStorage.setItem("hcr-custom-cursor", on ? "on" : "off");
  localStorage.setItem("hcr-virtual-mouse", on ? "on" : "off");
  document.body.classList.toggle("custom-cursor-mode", !!on);
  document.body.classList.toggle("virtual-mouse", !!on);
}
function toggleVirtualMousePanel() {
  let panel = document.getElementById("hcr-virtual-mouse-panel");
  if (panel) { panel.classList.toggle("hidden"); return; }
  panel = document.createElement("div");
  panel.id = "hcr-virtual-mouse-panel"; panel.className = "input-helper-panel mouse-panel";
  panel.innerHTML = `<div class="input-helper-title"><b>🖱 Virtual Mouse</b><button class="btn" data-mouse-close>✕</button></div>
    <div class="mouse-pad" data-mouse-pad><span class="mouse-cross">✦</span></div>
    <div class="mouse-buttons"><button class="btn" data-mouse-left>Left Click</button><button class="btn" data-mouse-right>Right Click</button><button class="btn" data-mouse-up>▲ Scroll</button><button class="btn" data-mouse-down>▼ Scroll</button></div>`;
  document.body.appendChild(panel);
  let cursor=document.getElementById('custom-cursor');
  if(!cursor){cursor=document.createElement('div');cursor.id='custom-cursor';cursor.setAttribute('aria-hidden','true');document.body.appendChild(cursor);}
  const cx=Number(localStorage.getItem('hcr-cursor-x'))||innerWidth/2, cy=Number(localStorage.getItem('hcr-cursor-y'))||innerHeight/2;
  cursor.style.left=cx+'px';cursor.style.top=cy+'px';
  setCustomCursorEnabled(true);
  const pad=panel.querySelector('[data-mouse-pad]');
  const move=(dx,dy)=>{
    const x=Math.max(2,Math.min(innerWidth-2,(Number(localStorage.getItem('hcr-cursor-x'))||innerWidth/2)+dx));
    const y=Math.max(2,Math.min(innerHeight-2,(Number(localStorage.getItem('hcr-cursor-y'))||innerHeight/2)+dy));
    localStorage.setItem('hcr-cursor-x',x); localStorage.setItem('hcr-cursor-y',y);
    let c=document.getElementById('custom-cursor'); if(c){c.style.left=x+'px';c.style.top=y+'px';}
  };
  let last=null; pad.onpointerdown=e=>{pad.setPointerCapture?.(e.pointerId);last={x:e.clientX,y:e.clientY};};
  pad.onpointermove=e=>{if(!last)return;move((e.clientX-last.x)*1.7,(e.clientY-last.y)*1.7);last={x:e.clientX,y:e.clientY};};
  pad.onpointerup=()=>{last=null;}; pad.onpointercancel=()=>{last=null;};
  panel.querySelector('[data-mouse-left]').onclick=()=>virtualClick(false);
  panel.querySelector('[data-mouse-right]').onclick=()=>virtualClick(true);
  panel.querySelector('[data-mouse-up]').onclick=()=>window.scrollBy({top:-350,behavior:'smooth'});
  panel.querySelector('[data-mouse-down]').onclick=()=>window.scrollBy({top:350,behavior:'smooth'});
  panel.querySelector('[data-mouse-close]').onclick=()=>{panel.remove();setCustomCursorEnabled(false);};
}
function virtualClick(right=false){
  const x=Number(localStorage.getItem('hcr-cursor-x'))||innerWidth/2, y=Number(localStorage.getItem('hcr-cursor-y'))||innerHeight/2;
  const el=document.elementFromPoint(x,y);
  if(!el)return;
  if(!right && typeof el.click==='function'){el.click();return;}
  el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y,button:right?2:0}));
  el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y,button:right?2:0}));
  if(!right) el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y,button:0}));
}

// ---------------- v1.0: Quick theme-switch button (taskbar) ----------------
function initThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  btn.onclick = () => {
    const isLight = document.body.classList.contains("theme-light");
    setTheme(isLight ? "dark" : "light");
  };
}

// ---------------- v1.0: apply saved desktop prefs (force-landscape, icons) ----------------
async function applyDesktopPrefs() {
  const settings = await api("/api/settings", {timeoutMs: 1800});
  const orientation = settings && !settings.error ? (settings.desktop_orientation || "portrait") : "portrait";
  const forceLandscape = false;
  document.body.classList.toggle("landscape-mode", orientation === "landscape");
  document.body.classList.remove("force-landscape");
  // Do not force the physical phone orientation. Android browsers often reject
  // orientation.lock unless fullscreen is active; the responsive desktop must
  // remain usable in both portrait and landscape.
  const iconsWrap = document.getElementById("desktop-icons");
  // Desktop shortcuts are a core shell feature in BETA. A saved preference
  // must never make the desktop look empty after an update.
  if (iconsWrap) { iconsWrap.style.display = "grid"; iconsWrap.classList.add("has-shortcuts"); }
}

function updateClock() {
  const now = new Date();
  const clock = document.getElementById("clock-widget");
  const date = document.getElementById("date-widget");
  if (clock) clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (date) date.textContent = now.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function refreshNetStatus() {
  try {
    const sys = await api("/api/system");
    const el = document.getElementById("net-status");
    el.classList.toggle("offline", !sys.online);
    el.title = sys.online ? "Online" : "Offline (core features still work)";
  } catch (e) { /* server not reachable yet */ }
}

function connectEvents() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/events`);
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === "notes-updated" && openWindows["notes"]) {
      renderNotesApp(openWindows["notes"].querySelector(".win-body"));
    }
    // v0.3: reflect AI activity (started elsewhere - GUI or Terminal) into
    // any other open window, e.g. terminal tray badge + open AI Chat window.
    if (data.type && data.type.startsWith("ai-")) {
      const termTray = document.getElementById("tray-terminal");
      if (termTray && data.status) termTray.title = `AI: ${data.status}`;
      if (openWindows["aichat"] && data.conversation_id === aiChatState.conversationId && data.status) {
        const statusEl = openWindows["aichat"].querySelector("#chat-status");
        if (statusEl) statusEl.textContent = data.status;
      }
    }
  };
  ws.onclose = () => setTimeout(connectEvents, 3000);
}

function broadcast(type, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

// v3.3: Windows-style System Search and real environment setup
function renderSystemSearchApp(body){
  body.innerHTML=`<div class="stack"><h3>🔎 System Search</h3><div class="dim">Search installed DeveloperHCR apps, settings and developer tools.</div><input id="system-search-q" placeholder="Type to search…" autofocus><div id="system-search-results"></div></div>`;
  const q=body.querySelector('#system-search-q'), box=body.querySelector('#system-search-results');
  const rows=()=>{const x=q.value.trim().toLowerCase();const items=APPS.filter(a=>!a.roleMin || currentUser?.role===a.roleMin || (a.roleMin==='ADMIN' && currentUser?.role==='ADMIN')).map(a=>({kind:'App',name:a.name,id:a.id,glyph:a.glyph})).filter(a=>!x||(`${a.name} ${a.id}`).toLowerCase().includes(x));box.innerHTML=items.map(a=>`<div class="note-card"><b>${a.glyph} ${escapeHtml(a.name)}</b><div class="dim">Application · ${escapeHtml(a.id)}</div><button class="btn" data-open="${escapeHtml(a.id)}">Open</button></div>`).join('')||'<div class="dim">No matching app.</div>';box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openApp(b.dataset.open));};
  q.addEventListener('input',rows); rows();
}

async function renderEnvironmentSetupApp(body){
  body.innerHTML=`<div class="stack"><h3>🧰 Environment Setup</h3><div class="dim">Real local detection. Installations use your operating system package manager and may require administrator permission and internet access.</div><div class="row"><button class="btn" id="env-refresh">Refresh</button><button class="btn" id="env-install-all">Install Missing Developer Tools</button><button class="btn" id="env-wine">🍷 Install / Check Wine</button></div><div id="env-status" class="dim"></div><div id="env-list"></div></div>`;
  const list=body.querySelector('#env-list'), status=body.querySelector('#env-status');
  async function load(){const r=await api('/api/toolchains'); if(r.error){status.textContent=r.error;return;} list.innerHTML=(r.toolchains||[]).map(t=>`<div class="note-card"><b>${escapeHtml(t.name)}</b><div class="dim">${escapeHtml(t.description)} · ${t.installed?'Installed':'Not installed'}</div><button class="btn" data-tool="${escapeHtml(t.id)}" ${t.installed?'disabled':''}>${t.installed?'Installed ✓':'Install'}</button></div>`).join('');list.querySelectorAll('[data-tool]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Installing…';const x=await api('/api/toolchains/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.tool})});status.textContent=x.ok?(x.message||'Installed.'):(x.error||x.output||'Installation failed.');load();});}
  body.querySelector('#env-refresh').onclick=load;
  body.querySelector('#env-install-all').onclick=async()=>{if(!confirm('Install all missing supported developer tools? This may download packages and request administrator permission.'))return;const r=await api('/api/toolchains/install-all',{method:'POST'});status.textContent=r.message||r.error||'Finished.';load();};
  body.querySelector('#env-wine').onclick=async()=>{if(!confirm('Install Wine using the system package manager? Internet access and administrator permission may be required.'))return;const r=await api('/api/exe/install-wine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});status.textContent=r.ok?(r.note||'Wine is ready.'):(r.error||'Wine installation failed.');};
  load();
}

// v2.9 Wallpaper Changer
function renderThemeApp(body){ renderWallpaperApp(body); }

function renderWallpaperApp(body){
  const presets=[
    ['Aurora','url("/static/wallpapers/aurora.svg") center/cover fixed no-repeat'],
    ['Midnight','url("/static/wallpapers/midnight.svg") center/cover fixed no-repeat'],
    ['Sunset','url("/static/wallpapers/sunset.svg") center/cover fixed no-repeat'],
    ['Ocean','url("/static/wallpapers/ocean.svg") center/cover fixed no-repeat'],
    ['Graphite','url("/static/wallpapers/graphite.svg") center/cover fixed no-repeat'],
    ['Violet Grid','url("/static/wallpapers/violet-grid.svg") center/cover fixed no-repeat'],
    ['Cyber Grid HD','url("/static/wallpapers/hd/cyber-grid-hd.png") center/cover fixed no-repeat'],
    ['Deep Space HD','url("/static/wallpapers/hd/deep-space-hd.png") center/cover fixed no-repeat'],
    ['Aurora Neon','url("/static/assets/wallpapers/aurora-neon.png") center/cover fixed no-repeat'],
    ['Deep Space','url("/static/assets/wallpapers/deep-space.png") center/cover fixed no-repeat'],
    ['Cyber Blue','url("/static/assets/wallpapers/cyber-blue.png") center/cover fixed no-repeat'],
    ['Violet Matrix','url("/static/assets/wallpapers/violet-matrix.png") center/cover fixed no-repeat'],
    ['Sunset Horizon','url("/static/assets/wallpapers/sunset-horizon.png") center/cover fixed no-repeat'],
    ['Ocean Pulse','url("/static/assets/wallpapers/ocean-pulse.png") center/cover fixed no-repeat'],
    ['Graphite Wave','url("/static/assets/wallpapers/graphite-wave.png") center/cover fixed no-repeat'],
    ['Emerald Circuit','url("/static/assets/wallpapers/emerald-circuit.png") center/cover fixed no-repeat']
    ,['Aurora Lattice','url("/static/assets/v21/aurora-lattice.png") center/cover fixed no-repeat']
    ,['Neon City','url("/static/assets/v21/neon-city.png") center/cover fixed no-repeat']
    ,['Deep Ocean','url("/static/assets/v21/deep-ocean.png") center/cover fixed no-repeat']
    ,['Solar Flare','url("/static/assets/v21/solar-flare.png") center/cover fixed no-repeat']
    ,['Quantum Grid','url("/static/assets/v21/quantum-grid.png") center/cover fixed no-repeat']
    ,['Crystal Night','url("/static/assets/v21/crystal-night.png") center/cover fixed no-repeat']
    ,['Midnight Circuit','url("/static/assets/v22/midnight-circuit.png") center/cover fixed no-repeat']
    ,['Emerald Horizon','url("/static/assets/v22/emerald-horizon.png") center/cover fixed no-repeat']
    ,['Violet Orbit','url("/static/assets/v22/violet-orbit.png") center/cover fixed no-repeat']
    ,['Solar Vector','url("/static/assets/v22/solar-vector.png") center/cover fixed no-repeat']
    ,['Arctic Glass','url("/static/assets/v22/arctic-glass.png") center/cover fixed no-repeat']
    ,['Crimson Night','url("/static/assets/v22/crimson-night.png") center/cover fixed no-repeat']
    ,['Quantum Rain 4K','url("/static/assets/wallpapers/v23/01-quantum-rain-4k.jpg") center/cover fixed no-repeat']
    ,['Neon Aurora 4K','url("/static/assets/wallpapers/v23/02-neon-aurora-4k.jpg") center/cover fixed no-repeat']
    ,['Cyber Valley 4K','url("/static/assets/wallpapers/v23/03-cyber-valley-4k.jpg") center/cover fixed no-repeat']
  ];
  body.innerHTML=`<div class="stack wallpaper-app"><h3>🖼️ Wallpaper</h3>
    <div class="dim">Choose a built-in wallpaper or select your own image. Wallpaper is stored locally on this device.</div>
    <div id="wallpaper-grid" class="wallpaper-grid"></div>
    <div class="row" style="flex-wrap:wrap"><label class="btn" for="wallpaper-file">📁 Choose image</label><input id="wallpaper-file" type="file" accept="image/*" hidden>
      <select id="wallpaper-fit"><option value="cover">Fill screen</option><option value="contain">Fit image</option><option value="100% 100%">Stretch</option></select>
      <button class="btn" id="wallpaper-apply-url">Apply URL</button><button class="btn secondary" id="wallpaper-reset">Reset</button></div>
    <div class="row"><input id="wallpaper-url" placeholder="Image URL (optional)" style="flex:1;min-width:180px"></div>
    <div class="row"><label>Dim <input id="wallpaper-dim" type="range" min="0" max="70" value="0"></label><span id="wallpaper-dim-value">0%</span></div>
    <div id="wallpaper-status" class="dim"></div></div>`;
  const grid=body.querySelector('#wallpaper-grid');
  const apply=(bg,name,fit='cover')=>{
    document.body.style.background=bg;
    document.body.style.backgroundSize=fit;
    localStorage.setItem('hcr-wallpaper',bg);
    localStorage.setItem('hcr-wallpaper-fit',fit);
    body.querySelector('#wallpaper-status').textContent='Applied: '+name;
  };
  presets.forEach(([name,bg])=>{const b=document.createElement('button');b.className='wallpaper-card';b.style.background=bg;b.textContent=name;b.onclick=()=>apply(bg,name,body.querySelector('#wallpaper-fit').value);grid.appendChild(b);});
  const savedFit=localStorage.getItem('hcr-wallpaper-fit')||'cover'; body.querySelector('#wallpaper-fit').value=savedFit;
  body.querySelector('#wallpaper-fit').onchange=()=>{document.body.style.backgroundSize=body.querySelector('#wallpaper-fit').value;localStorage.setItem('hcr-wallpaper-fit',body.querySelector('#wallpaper-fit').value);};
  body.querySelector('#wallpaper-file').onchange=()=>{
    const f=body.querySelector('#wallpaper-file').files?.[0]; if(!f)return;
    if(!f.type.startsWith('image/')) return;
    if(f.size>6*1024*1024){body.querySelector('#wallpaper-status').textContent='Image is too large. Choose an image up to 6 MB.';return;}
    const reader=new FileReader();
    reader.onload=()=>apply(`url("${String(reader.result).replace(/"/g,'\\"')}") center/cover fixed no-repeat`,f.name,body.querySelector('#wallpaper-fit').value);
    reader.readAsDataURL(f);
  };
  body.querySelector('#wallpaper-apply-url').onclick=()=>{const u=body.querySelector('#wallpaper-url').value.trim();if(!/^https?:\/\//i.test(u)){body.querySelector('#wallpaper-status').textContent='Enter a valid HTTP/HTTPS image URL.';return;}apply(`url("${u.replace(/"/g,'')}") center/cover fixed no-repeat`,'URL wallpaper',body.querySelector('#wallpaper-fit').value);};
  const dim=body.querySelector('#wallpaper-dim'), dimValue=body.querySelector('#wallpaper-dim-value');
  const savedDim=Number(localStorage.getItem('hcr-wallpaper-dim')||0); dim.value=savedDim; dimValue.textContent=savedDim+'%';
  dim.oninput=()=>{localStorage.setItem('hcr-wallpaper-dim',dim.value);dimValue.textContent=dim.value+'%';document.body.style.setProperty('--hcr-wallpaper-dim',dim.value/100);};
  body.querySelector('#wallpaper-reset').onclick=()=>{document.body.style.background='';document.body.style.backgroundSize='';localStorage.removeItem('hcr-wallpaper');localStorage.removeItem('hcr-wallpaper-fit');body.querySelector('#wallpaper-status').textContent='Wallpaper reset.';};
}
// ================= APP: Windows-style system locations =================
async function renderSystemLocationApp(target, title, body){
  body.innerHTML=`<div class="stack system-location-app"><div class="system-location-hero"><div class="system-location-icon">${target==="recycle_bin"?'🗑️':target==="this_pc"?'🖥️':target==="network"?'🌐':'ᛒ'}</div><div><h3>${escapeHtml(title)}</h3><div class="dim">Windows-style desktop shortcut</div></div></div><div class="note-card"><b>Open on this computer</b><div class="dim">DeveloperHCR will ask the operating system to open the corresponding built-in location/settings page. No arbitrary command is executed.</div><button class="btn primary" id="system-location-open">Open ${escapeHtml(title)}</button><div id="system-location-status" class="dim"></div></div></div>`;
  body.querySelector('#system-location-open').onclick=async()=>{const r=await api('/api/system/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target})});body.querySelector('#system-location-status').textContent=r.ok?'Opened in the operating system.':(r.error||'Could not open this location.');};
}
function renderRecycleBinApp(body){ renderSystemLocationApp('recycle_bin','Recycle Bin',body); }

// ================= APP: Camera Monitor =================
// Camera access is always explicit and visibly indicated. The app stops the
// camera when closed/re-rendered; browsers/Android must show their permission UI.
function renderCameraApp(body) {
  body.innerHTML = `<div class="stack camera-app">
    <h3>📷 Camera Monitor</h3>
    <div class="dim">Camera access is explicit. Keep this app open to keep the preview active; the app never starts the camera secretly in the background.</div>
    <div class="camera-status" id="camera-status">Camera is off.</div>
    <video id="camera-preview" autoplay playsinline muted></video>
    <div class="row"><button class="btn primary" id="camera-start">Start Camera</button><button class="btn" id="camera-stop">Stop</button></div>
  </div>`;
  const video=body.querySelector('#camera-preview'), status=body.querySelector('#camera-status');
  let stream=null;
  const stop=()=>{ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;} video.srcObject=null; status.textContent='Camera is off.'; };
  body.querySelector('#camera-start').onclick=async()=>{
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='Camera is not supported in this Android/browser runtime.';return;}
    try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false}); video.srcObject=stream; status.textContent='● CAMERA ACTIVE — visible preview is running.'; }
    catch(e){status.textContent='Camera permission blocked or unavailable: '+(e?.message||e);}
  };
  body.querySelector('#camera-stop').onclick=stop;
  body.closest('.win')?.querySelector('.win-close')?.addEventListener('click',stop,{once:true});
}

// Compatibility renderer: the privileged control surface uses the existing Admin renderer.
function renderOwnerApp(body) { return renderOwnerControlApp(body); }

async function renderAppHealthApp(body){
  body.innerHTML=`<div class="stack"><div class="cp-header"><div><h3>🩺 App Health Center</h3><div class="dim">Check services, apps and project files. File Checkup is OFF by default and never changes files.</div></div><button class="btn primary" id="health-run">Run Full Check</button></div><div class="note-card"><label class="remember-me"><input id="health-file-enable" type="checkbox"> <span>Enable startup file checkup <b>(OFF by default)</b></span></label><div class="dim">When enabled, a Skip button can stop the scan and automatically turn it back OFF.</div><div class="row" style="margin-top:8px"><button class="btn" id="health-file-run">Run File Checkup Now</button><button class="btn" id="health-file-skip" disabled>Skip Checkup</button></div></div><div id="health-summary" class="note-card">Ready to check.</div><div id="health-list" class="stack"></div><div class="row"><button class="btn" data-health-open="control">Control Centre</button><button class="btn" data-health-open="troubleshoot">Troubleshooting</button><button class="btn" data-health-open="aimodels">AI Models</button><button class="btn" data-health-open="store">HCR Store</button></div></div>`;
  const list=body.querySelector('#health-list'), summary=body.querySelector('#health-summary');
  async function run(){
    summary.textContent='Checking…'; list.innerHTML='';
    const r=await api('/api/app-health',{timeoutMs:10000});
    if(r.error){summary.textContent=r.error;return;}
    summary.innerHTML=`<b>${r.healthy}/${r.total} checks healthy</b><div class="dim">${escapeHtml(r.generated_at||'')}</div>`;
    list.innerHTML=(r.checks||[]).map(c=>`<div class="note-card"><b>${c.ok?'✅':'⚠️'} ${escapeHtml(c.name)}</b><div class="dim">${escapeHtml(c.detail)}</div></div>`).join('');
  }
  body.querySelector('#health-run').onclick=run;
  const toggle=body.querySelector('#health-file-enable'), fileRun=body.querySelector('#health-file-run'), skip=body.querySelector('#health-file-skip');
  toggle.checked=!!appSettings?.startup_file_checkup_enabled;
  toggle.onchange=async()=>{await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startup_file_checkup_enabled:!!toggle.checked})});};
  let abort=false;
  skip.onclick=()=>{abort=true;skip.disabled=true;toggle.checked=false;api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startup_file_checkup_enabled:false})});summary.textContent='File checkup skipped and disabled again.';};
  fileRun.onclick=async()=>{abort=false;skip.disabled=false;summary.textContent='Scanning project files…';const r=await api('/api/system/file-checkup',{timeoutMs:30000});if(abort)return;skip.disabled=true;toggle.checked=false;await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startup_file_checkup_enabled:false})});if(r.error){summary.textContent=r.error;return;}summary.innerHTML=`<b>${r.ok?'✅':'⚠️'} ${r.checked} files checked</b><div class="dim">${escapeHtml(r.message||'')}</div>`;list.innerHTML=(r.issues||[]).map(c=>`<div class="note-card"><b>${c.ok?'✅':'⚠️'} ${escapeHtml(c.path)}</b><div class="dim">${escapeHtml(c.detail)}</div></div>`).join('');};
  body.querySelectorAll('[data-health-open]').forEach(b=>b.onclick=()=>openApp(b.dataset.healthOpen));
  run();
}


// ================= V2.1 EXPANSION: Offline power-user apps =================
function renderDevToolkitApp(body){
  body.innerHTML=`<div class="stack"><h3>🧰 Developer Toolkit</h3><div class="row"><select id="dt-op"><option value="b64e">Base64 Encode</option><option value="b64d">Base64 Decode</option><option value="urlenc">URL Encode</option><option value="urldec">URL Decode</option><option value="sha256">SHA-256 Hash</option><option value="uuid">UUID v4</option></select><button class="btn primary" id="dt-run">Run</button></div><textarea id="dt-in" rows="7" placeholder="Enter text…"></textarea><pre id="dt-out" class="term-log" style="white-space:pre-wrap"></pre><div class="dim">All operations run locally in your browser.</div></div>`;
  const op=body.querySelector('#dt-op'),input=body.querySelector('#dt-in'),out=body.querySelector('#dt-out');
  async function run(){try{const v=input.value;let r='';if(op.value==='b64e')r=btoa(unescape(encodeURIComponent(v)));else if(op.value==='b64d')r=decodeURIComponent(escape(atob(v)));else if(op.value==='urlenc')r=encodeURIComponent(v);else if(op.value==='urldec')r=decodeURIComponent(v);else if(op.value==='uuid')r=crypto.randomUUID();else{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));r=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}out.textContent=r||'Done.';}catch(e){out.textContent='Error: '+e.message;}}
  body.querySelector('#dt-run').onclick=run;
}
function renderTextToolsApp(body){
  body.innerHTML=`<div class="stack"><h3>🔤 Text Tools</h3><textarea id="tt-in" rows="9" placeholder="Paste text here…"></textarea><div class="row" style="flex-wrap:wrap"><button class="btn" data-tt="upper">UPPER</button><button class="btn" data-tt="lower">lower</button><button class="btn" data-tt="title">Title Case</button><button class="btn" data-tt="trim">Trim Lines</button><button class="btn" data-tt="sort">Sort Lines</button><button class="btn" data-tt="dedupe">Remove Duplicates</button><button class="btn" data-tt="slug">Slugify</button></div><div class="note-card" id="tt-stats"></div></div>`;
  const t=body.querySelector('#tt-in'),stats=body.querySelector('#tt-stats');
  function draw(){const x=t.value;stats.textContent=`${x.length} characters · ${x.trim()?x.trim().split(/\s+/).length:0} words · ${x?x.split(/\n/).length:0} lines`;}
  body.querySelectorAll('[data-tt]').forEach(b=>b.onclick=()=>{const x=t.value,op=b.dataset.tt;if(op==='upper')t.value=x.toUpperCase();if(op==='lower')t.value=x.toLowerCase();if(op==='title')t.value=x.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());if(op==='trim')t.value=x.split(/\n/).map(s=>s.trim()).join('\n');if(op==='sort')t.value=x.split(/\n/).sort((a,b)=>a.localeCompare(b)).join('\n');if(op==='dedupe')t.value=[...new Set(x.split(/\n/))].join('\n');if(op==='slug')t.value=x.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');draw();});t.oninput=draw;draw();
}
function renderRegexTesterApp(body){
  body.innerHTML=`<div class="stack"><h3>🔎 Regex Tester</h3><input id="rx-pattern" placeholder="Regular expression, e.g. \\b\\d+\\b"><input id="rx-flags" value="gi" placeholder="Flags"><textarea id="rx-text" rows="9" placeholder="Test text…"></textarea><div id="rx-out" class="note-card"></div></div>`;
  const p=body.querySelector('#rx-pattern'),f=body.querySelector('#rx-flags'),t=body.querySelector('#rx-text'),o=body.querySelector('#rx-out');
  function run(){try{const r=new RegExp(p.value,f.value);const m=[...t.value.matchAll(r)];o.innerHTML=`<b>${m.length} match(es)</b><div class="dim">${escapeHtml(m.map(x=>x[0]).join(' · ')||'No matches')}</div>`;}catch(e){o.textContent='Invalid regex: '+e.message;}}[p,f,t].forEach(x=>x.oninput=run);run();
}
function renderColorLabApp(body){
  body.innerHTML=`<div class="stack"><h3>🎨 Color Lab</h3><div class="row"><input id="cl-color" type="color" value="#3b82f6"><input id="cl-hex" value="#3b82f6" style="flex:1"><button class="btn" id="cl-copy">Copy HEX</button></div><div class="note-card" id="cl-info"></div><div class="row" id="cl-swatches"></div></div>`;
  const c=body.querySelector('#cl-color'),h=body.querySelector('#cl-hex'),info=body.querySelector('#cl-info'),sw=body.querySelector('#cl-swatches');
  function rgb(hex){const x=hex.replace('#','');const n=parseInt(x.length===3?x.split('').map(a=>a+a).join(''):x,16);return[(n>>16)&255,(n>>8)&255,n&255]}
  function draw(){let hex=h.value.trim();if(!/^#[0-9a-f]{6}$/i.test(hex))return;const [r,g,b]=rgb(hex);const mx=Math.max(r,g,b)/255,mn=Math.min(r,g,b)/255,d=mx-mn,l=(mx+mn)/2;let s=0;if(d)s=d/(1-Math.abs(2*l-1));let hh=0;if(d){if(mx===r)hh=((g-b)/255/d)%6;else if(mx===g)hh=(b-r)/255/d+2;else hh=(r-g)/255/d+4;hh=Math.round(hh*60);if(hh<0)hh+=360;}info.innerHTML=`<b>RGB:</b> ${r}, ${g}, ${b}<br><b>HSL:</b> ${hh}°, ${Math.round(s*100)}%, ${Math.round(l*100)}%`;sw.innerHTML=[-30,0,30].map(d=>{const n=[r+d,g+d,b+d].map(x=>Math.max(0,Math.min(255,x)));const hx='#'+n.map(x=>x.toString(16).padStart(2,'0')).join('');return `<button class="btn" style="background:${hx};min-width:90px" data-color="${hx}">${hx}</button>`}).join('');sw.querySelectorAll('[data-color]').forEach(x=>x.onclick=()=>{h.value=x.dataset.color;c.value=x.dataset.color;draw()});}
  c.oninput=()=>{h.value=c.value;draw()};h.oninput=()=>{if(/^#[0-9a-f]{6}$/i.test(h.value))c.value=h.value;draw()};body.querySelector('#cl-copy').onclick=()=>navigator.clipboard?.writeText(h.value);draw();
}
function renderCsvToolsApp(body){
  body.innerHTML=`<div class="stack"><h3>📊 CSV Tools</h3><textarea id="csv-in" rows="10" placeholder="name,score\nAlice,92\nBob,88"></textarea><div class="row"><button class="btn primary" id="csv-parse">Preview</button><button class="btn" id="csv-copy">Copy TSV</button></div><div id="csv-out" style="overflow:auto"></div></div>`;
  const i=body.querySelector('#csv-in'),o=body.querySelector('#csv-out');let tsv='';
  function parse(){const rows=i.value.split(/\r?\n/).filter(Boolean).map(r=>r.split(','));tsv=rows.map(r=>r.join('\t')).join('\n');o.innerHTML=rows.length?`<table><tbody>${rows.map((r,ri)=>`<tr>${r.map(c=>ri===0?`<th>${escapeHtml(c)}</th>`:`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="dim">No rows.</div>';}
  body.querySelector('#csv-parse').onclick=parse;body.querySelector('#csv-copy').onclick=()=>navigator.clipboard?.writeText(tsv);parse();
}
function renderSecureLockerApp(body){
  body.innerHTML=`<div class="stack"><h3>🔒 Local Secure Locker</h3><div class="dim">Encrypt a small note locally with WebCrypto. The key is derived from your password and never sent to DeveloperHCR.</div><input id="sl-pass" type="password" placeholder="Locker password"><textarea id="sl-text" rows="9" placeholder="Private note…"></textarea><div class="row"><button class="btn primary" id="sl-save">Encrypt & Save</button><button class="btn" id="sl-open">Decrypt Saved Note</button><button class="btn danger" id="sl-clear">Delete</button></div><div id="sl-status" class="dim"></div></div>`;
  const pass=body.querySelector('#sl-pass'),text=body.querySelector('#sl-text'),status=body.querySelector('#sl-status');
  async function key(p,s){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
  body.querySelector('#sl-save').onclick=async()=>{if(!pass.value||!text.value)return status.textContent='Password and note are required.';const iv=crypto.getRandomValues(new Uint8Array(12)),k=await key(pass.value,iv);const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(text.value));localStorage.setItem('hcr-secure-locker',JSON.stringify({iv:[...iv],data:[...new Uint8Array(enc)]}));status.textContent='Encrypted note saved locally.'};
  body.querySelector('#sl-open').onclick=async()=>{try{const x=JSON.parse(localStorage.getItem('hcr-secure-locker')||'null');if(!x)throw Error('No saved note.');const iv=new Uint8Array(x.iv),k=await key(pass.value,iv),dec=await crypto.subtle.decrypt({name:'AES-GCM',iv},k,new Uint8Array(x.data));text.value=new TextDecoder().decode(dec);status.textContent='Note decrypted locally.'}catch(e){status.textContent='Unable to decrypt: wrong password or corrupted data.'}};
  body.querySelector('#sl-clear').onclick=()=>{localStorage.removeItem('hcr-secure-locker');text.value='';status.textContent='Saved locker data deleted.'};
}
function renderPasswordAuditApp(body){
  body.innerHTML=`<div class="stack"><h3>🛡️ Password Audit</h3><input id="pa-pass" type="password" placeholder="Test a password locally"><div class="note-card" id="pa-out">Enter a password. Nothing is uploaded.</div></div>`;
  const p=body.querySelector('#pa-pass'),o=body.querySelector('#pa-out');p.oninput=()=>{const x=p.value,score=(x.length>=12?2:0)+(x.length>=16?1:0)+(/[a-z]/.test(x)?1:0)+(/[A-Z]/.test(x)?1:0)+(/\d/.test(x)?1:0)+(/[^A-Za-z0-9]/.test(x)?1:0);const level=score>=7?'Strong':score>=5?'Good':score>=3?'Weak':'Very weak';o.innerHTML=`<b>${level}</b> · ${x.length} characters<br><span class="dim">Use a unique passphrase and enable MFA where available.</span>`};
}
function renderBase64ImageApp(body){
  body.innerHTML=`<div class="stack"><h3>🖼️ Image → Data URL</h3><input id="bi-file" type="file" accept="image/*"><textarea id="bi-out" rows="8" readonly placeholder="Select an image…"></textarea><button class="btn" id="bi-copy">Copy Data URL</button></div>`;
  const f=body.querySelector('#bi-file'),o=body.querySelector('#bi-out');f.onchange=()=>{const x=f.files?.[0];if(!x)return;if(x.size>4*1024*1024){o.value='Image must be 4 MB or smaller.';return;}const r=new FileReader();r.onload=()=>o.value=r.result;r.readAsDataURL(x)};body.querySelector('#bi-copy').onclick=()=>navigator.clipboard?.writeText(o.value);
}
function renderRandomToolsApp(body){
  body.innerHTML=`<div class="stack"><h3>🎲 Random Tools</h3><div class="row"><input id="rt-min" type="number" value="1"><input id="rt-max" type="number" value="100"><button class="btn primary" id="rt-roll">Generate</button></div><div class="price" id="rt-out">—</div><div class="row"><input id="rt-list" placeholder="apple, banana, orange" style="flex:1"><button class="btn" id="rt-pick">Pick Item</button></div><div id="rt-item" class="note-card"></div></div>`;
  const min=body.querySelector('#rt-min'),max=body.querySelector('#rt-max'),out=body.querySelector('#rt-out');body.querySelector('#rt-roll').onclick=()=>{let a=Number(min.value),b=Number(max.value);if(a>b)[a,b]=[b,a];out.textContent=String(Math.floor(Math.random()*(b-a+1))+a)};body.querySelector('#rt-pick').onclick=()=>{const a=body.querySelector('#rt-list').value.split(',').map(x=>x.trim()).filter(Boolean);body.querySelector('#rt-item').textContent=a.length?a[Math.floor(Math.random()*a.length)]:'Enter comma-separated items.'};
}

// ---------------- App registry ----------------
try { const savedWallpaper=localStorage.getItem("hcr-wallpaper"); if(savedWallpaper) document.body.style.background=savedWallpaper; const fit=localStorage.getItem("hcr-wallpaper-fit"); if(fit) document.body.style.backgroundSize=fit; const dim=Number(localStorage.getItem("hcr-wallpaper-dim")||0); document.body.style.setProperty("--hcr-wallpaper-dim",dim/100); } catch(_) {}

const APPS = [
  // Core launcher apps — these are installed/visible by default.
  { id: "files", name: "File Manager", glyph: "📁", render: renderFilesApp },
  { id: "jarvis", name: "HCR AI Agent", glyph: "🧠", render: renderJarvisApp },
  { id: "aichat", name: "AI Chat", glyph: "💬", render: renderAiChatApp, feature: "basic_ai" },
  { id: "notes", name: "Notes", glyph: "📝", render: renderNotesApp },
  { id: "calc", name: "Calculator", glyph: "🧮", render: renderCalcApp },
  { id: "terminal", name: "Terminal", glyph: "💻", render: renderTerminalApp },
  { id: "browser", name: "Web Browser", glyph: "🌐", render: renderBrowserApp, feature: "browser" },
  { id: "settings", name: "Settings", glyph: "⚙️", render: renderSettingsApp },
  { id: "store", name: "HCR Store", glyph: "🛍️", render: renderStoreApp },
  { id: "app-installer", name: "App Installer", glyph: "📦", render: renderAppInstallerApp },
  { id: "systeminfo", name: "System Info", glyph: "🖥️", render: renderSystemInfoApp },
  { id: "apphealth", name: "App Health Center", glyph: "🩺", render: renderAppHealthApp },
  { id: "help", name: "Help Center", glyph: "❓", render: renderHelpApp },
  { id: "search", name: "System Search", glyph: "🔎", render: renderSystemSearchApp },
  { id: "commander", name: "Command Center", glyph: "🎙️", render: renderCommanderApp },
  { id: "repo", name: "DevApps Repository", glyph: "📦", render: renderRepositoryApp },

  // Restored legacy/built-in catalog. These stay in HCR Store rather than
  // cluttering the default launcher, but every renderer is wired back in.
  { id: "screenshot", name: "Screenshot Tool", glyph: "📸", render: renderScreenshotApp },
  { id: "control", name: "Control Panel", glyph: "🎛️", render: renderControlPanelApp },
  { id: "camera", name: "Camera Monitor", glyph: "📷", render: renderCameraApp },
  { id: "clock", name: "Clock / Timer", glyph: "⏱️", render: renderClockApp },
  { id: "calendar", name: "Calendar", glyph: "📅", render: renderCalendarApp },
  { id: "downloads", name: "Downloads", glyph: "⬇️", render: renderDownloadsApp },
  { id: "archive", name: "Archive Manager", glyph: "🗜️", render: renderArchiveManagerApp },
  { id: "backup", name: "Backup & Restore", glyph: "💾", render: renderBackupApp },
  { id: "imageviewer", name: "Image Viewer", glyph: "🖼️", render: renderImageViewerApp },
  { id: "media", name: "Media Player", glyph: "🎵", render: renderMediaPlayerApp },
  { id: "sysmon", name: "System Monitor", glyph: "📊", render: renderSysMonApp, feature: "system_monitor" },
  { id: "aimodels", name: "AI Models", glyph: "🤖", render: renderAiModelsApp, feature: "ai_models" },
  { id: "unitconv", name: "Unit Converter", glyph: "📏", render: renderUnitConverterApp },
  { id: "passgen", name: "Password Generator", glyph: "🔑", render: renderPasswordGeneratorApp, feature: "security" },
  { id: "markdown", name: "Markdown Viewer", glyph: "📝", render: renderMarkdownViewerApp },
  { id: "pomodoro", name: "Pomodoro Focus", glyph: "🍅", render: renderPomodoroApp },
  { id: "jsonformat", name: "JSON Formatter", glyph: "🧾", render: renderJsonFormatterApp },
  { id: "devtoolkit", name: "Developer Toolkit", glyph: "🧰", render: renderDevToolkitApp },
  { id: "texttools", name: "Text Tools", glyph: "🔤", render: renderTextToolsApp },
  { id: "regextester", name: "Regex Tester", glyph: "🔎", render: renderRegexTesterApp },
  { id: "colorlab", name: "Color Lab", glyph: "🎨", render: renderColorLabApp },
  { id: "csvtools", name: "CSV Tools", glyph: "📊", render: renderCsvToolsApp },
  { id: "securelocker", name: "Local Secure Locker", glyph: "🔒", render: renderSecureLockerApp, feature: "security" },
  { id: "passwordaudit", name: "Password Audit", glyph: "🛡️", render: renderPasswordAuditApp, feature: "security" },
  { id: "base64image", name: "Image Data URL", glyph: "🖼️", render: renderBase64ImageApp },
  { id: "randomtools", name: "Random Tools", glyph: "🎲", render: renderRandomToolsApp },
  { id: "textdiff", name: "Text Diff", glyph: "🧩", render: renderTextDiffApp },
  { id: "timestamp", name: "Timestamp Converter", glyph: "🕒", render: renderTimestampApp },
  { id: "diagnostics", name: "System Diagnostics", glyph: "🧪", render: renderDiagnosticsApp },
  { id: "filehash", name: "File Hash Checker", glyph: "#️⃣", render: renderFileHashApp },
  { id: "colorcontrast", name: "Contrast Checker", glyph: "◐", render: renderContrastCheckerApp },
  { id: "games", name: "HCR Games", glyph: "🎮", render: renderGamesApp },
  { id: "game-voxel", name: "HCR Voxel World", glyph: "🧱", render: renderVoxelWorldApp },
  { id: "game-snake", name: "Snake 2D", glyph: "🐍", render: body => renderStandaloneGameApp(body, "snake") },
  { id: "game-pong", name: "Pong 2D", glyph: "🏓", render: body => renderStandaloneGameApp(body, "pong") },
  { id: "game-tetris", name: "Block Drop 2D", glyph: "🧱", render: body => renderStandaloneGameApp(body, "tetris") },
  { id: "game-memory", name: "Memory Match 2D", glyph: "🧠", render: body => renderStandaloneGameApp(body, "memory") },
  { id: "game-ttt", name: "Tic-Tac-Toe 2D", glyph: "⭕", render: body => renderStandaloneGameApp(body, "ttt") },
  { id: "game-reflex", name: "Reflex Challenge", glyph: "⚡", render: body => renderStandaloneGameApp(body, "reflex") },
  { id: "game-cube", name: "Cube 3D", glyph: "🧊", render: body => renderStandaloneGameApp(body, "cube") },
  { id: "game-orbit", name: "Orbit 3D", glyph: "🪐", render: body => renderStandaloneGameApp(body, "orbit") },
  { id: "game-dice", name: "Dice Roller", glyph: "🎲", render: body => renderStandaloneGameApp(body, "dice") },
  { id: "game-guess", name: "Guess the Number", glyph: "🔢", render: body => renderStandaloneGameApp(body, "guess") },
  { id: "game-breakout", name: "Breakout 2D", glyph: "🧱", render: body => renderStandaloneGameApp(body, "breakout") },
  { id: "game-mines", name: "Minesweeper 2D", glyph: "💣", render: body => renderStandaloneGameApp(body, "mines") },
  { id: "game-flappy", name: "Flappy 2D", glyph: "🐦", render: body => renderStandaloneGameApp(body, "flappy") },
  { id: "game-maze", name: "Maze 2D", glyph: "🌀", render: body => renderStandaloneGameApp(body, "maze") },
  { id: "game-starfield", name: "Starfield 3D", glyph: "🌌", render: body => renderStandaloneGameApp(body, "starfield") },
  { id: "game-solar", name: "Solar System 3D", glyph: "☀️", render: body => renderStandaloneGameApp(body, "solar") },
  { id: "trading", name: "Practice Trading", glyph: "📈", render: renderTradingApp, feature: "friends_trading" },
  { id: "wallpaper", name: "Wallpaper Changer", glyph: "🌄", render: renderWallpaperApp, feature: "personalization" },
  { id: "theme", name: "Theme Manager", glyph: "🎨", render: renderThemeApp, feature: "personalization" },
  { id: "environment", name: "Environment Setup", glyph: "🧰", render: renderEnvironmentSetupApp, feature: "developer_tools" },
  { id: "network", name: "Network Tools", glyph: "🌐", render: renderNetworkToolsApp, feature: "network_tools" },
  { id: "jsonviewer", name: "JSON Viewer", glyph: "{}", render: renderJsonViewerApp, feature: "developer_tools" },
  { id: "editor", name: "Text / Code Editor", glyph: "📝", render: renderTextEditorApp, feature: "developer_tools" },
  { id: "quicktext", name: "Quick Text Viewer", glyph: "📄", render: renderQuickTextViewerApp },
  { id: "colorpicker", name: "Color Picker", glyph: "🎨", render: renderColorPickerApp, feature: "design" },
  { id: "stopwatch", name: "Stopwatch", glyph: "⏱️", render: renderStopwatchApp },
  { id: "clipboard", name: "Clipboard Manager", glyph: "📋", render: renderClipboardApp, feature: "productivity_plus" },
  { id: "processes", name: "Process Manager", glyph: "🖥️", render: renderProcessManagerApp, feature: "system_admin" },
  { id: "security", name: "Security Center", glyph: "🔐", render: renderSecurityCenterApp, feature: "system_admin" },
  { id: "toolchains", name: "Developer Toolchains", glyph: "🛠️", render: renderToolchainsApp, feature: "developer_tools" },
  { id: "playground", name: "Code Playground", glyph: "💻", render: renderCodePlaygroundApp, feature: "developer_tools" },
  { id: "feedback", name: "Feedback & Support", glyph: "💬", render: renderFeedbackApp, feature: "feedback" },
  { id: "access", name: "Friends Only", glyph: "👥", render: renderAccessApp },
  { id: "subscriptions", name: "Subscription Center", glyph: "💳", render: renderSubscriptionApp },
  { id: "updates", name: "Update Center", glyph: "⬆️", render: renderUpdatesApp },
  { id: "exe", name: "EXE / Wine", glyph: "🪟", render: renderExeApp, feature: "exe_support" },
  { id: "troubleshoot", name: "Troubleshooting", glyph: "🔧", render: renderTroubleshootApp },
  { id: "about", name: "About / DeveloperHCR v1.0", glyph: "ℹ️", render: renderAboutApp },
  { id: "pdfviewer", name: "PDF Viewer", glyph: "📕", render: renderPdfViewerApp, feature: "media" },
  { id: "passwords", name: "Password Vault", glyph: "🔑", render: renderPasswordVaultApp, feature: "security" },
  { id: "qr", name: "QR & Share", glyph: "🔳", render: renderQrShareApp },
  { id: "recyclebin", name: "Recycle Bin", glyph: "🗑️", render: renderRecycleBinApp },
  { id: "thispc", name: "This PC", glyph: "🖥️", render: renderSystemLocationApp.bind(null, "this_pc", "This PC") },
  { id: "networkshortcut", name: "Network", glyph: "🌐", render: renderSystemLocationApp.bind(null, "network", "Network") },
  { id: "bluetooth", name: "Bluetooth", glyph: "ᛒ", render: renderSystemLocationApp.bind(null, "bluetooth", "Bluetooth") },
  { id: "admin", name: "Admin Dashboard", glyph: "🧰", render: renderAdminApp, roleMin: "ADMIN" },
];

// Paid access map: Free users see these apps in HCR Store but they remain disabled until the required feature/plan is active.
// Only these apps are installed/visible in the default launcher.
// The complete catalog remains available from HCR Store, including icons,
// descriptions, versions, permissions and locks.
const CORE_APP_IDS = new Set([
  "files", "jarvis", "aichat", "notes", "calc", "terminal", "apphealth",
  "browser", "settings", "store", "systeminfo", "help",
  "clock", "calendar", "downloads", "screenshot", "imageviewer",
  "pdfviewer", "media", "sysmon", "aimodels", "games", "trading",
  "editor", "jsonviewer", "clipboard", "processes", "security",
  "devtoolkit", "texttools", "regextester", "colorlab", "csvtools", "securelocker", "passwordaudit", "base64image", "randomtools",
  "toolchains", "playground", "network", "wallpaper", "theme",
  "textdiff", "timestamp", "diagnostics", "filehash", "colorcontrast",
  "environment", "recyclebin", "thispc", "networkshortcut", "bluetooth",
  "game-voxel", "game-snake", "game-pong", "game-tetris", "game-memory", "game-ttt", "game-reflex", "game-cube", "game-orbit", "game-dice", "game-guess",
  "updates", "troubleshoot", "about", "archive", "backup"
]);

const APP_PAID_FEATURES = {
  browser:"browser", aimodels:"ai_models", jarvis:"ai_models", trading:"friends_trading", feedback:"feedback", exe:"exe_support",
  editor:"developer_tools", toolchains:"developer_tools", playground:"developer_tools", environment:"developer_tools", network:"network_tools",
  processes:"system_admin", security:"system_admin", media:"media", calendar:"productivity_plus", clipboard:"productivity_plus",
  imageviewer:"media", pdfviewer:"media", colorpicker:"design", jsonviewer:"developer_tools", appinstaller:"store_plus"
};
APPS.forEach(a=>{ if(!a.feature && APP_PAID_FEATURES[a.id]) a.feature=APP_PAID_FEATURES[a.id]; });

function visibleApps() {
  return APPS.filter(a => {
    const roleOk = !a.roleMin || (currentUser && (currentUser.role === a.roleMin || (a.roleMin === "ADMIN" && currentUser.role === "ADMIN")));
    const core = CORE_APP_IDS.has(a.id);
    const privileged = a.roleMin === "ADMIN";
    return roleOk && (core || privileged) && appAllowed(a);
  });
}
function appAllowed(app) {
  // BETA desktop: installed/built-in apps must remain launchable. Feature
  // locks are still represented in Store for non-admin access, but an Admin
  // workspace never loses its installed applications.
  if (currentUser?.role === "ADMIN" || currentUser?.role === "OWNER") return true;
  if (!app.feature || !currentFeatures || currentFeatures.features?.includes("all")) return true;
  return currentFeatures.features.includes(app.feature) || (app.feature === "basic_ai" && currentFeatures.features.includes("all_basic"));
}

function buildLauncher() {
  const grid = document.getElementById("launcher-grid");
  if (!grid) return;
  const search = document.getElementById("launcher-search");
  const q = (search?.value || "").trim().toLowerCase();
  const candidates = APPS.filter(a => {
    const roleOk = !a.roleMin || (currentUser && (currentUser.role === a.roleMin || (a.roleMin === "ADMIN" && currentUser.role === "ADMIN")));
    return roleOk && (!q || `${a.name} ${a.id}`.toLowerCase().includes(q));
  });
  grid.innerHTML = candidates.length ? candidates.map(app => {
    const locked = !appAllowed(app);
    return `<button type="button" class="app-icon${locked ? " app-locked" : ""}" data-app="${escapeHtml(app.id)}" title="Open ${escapeHtml(app.name)}"><span class="glyph app-logo" aria-hidden="true">${app.glyph}</span><span class="app-label">${escapeHtml(app.name)}</span>${locked ? "<small>🔒 Restricted</small>" : "<small>Open</small>"}</button>`;
  }).join("") : `<div class="launcher-empty">No app found for <b>${escapeHtml(q)}</b>. Try another name.</div>`;
  // Activation is intentionally delegated to installFinalShellController() below.
  // Do not attach per-button click + pointerup handlers here: on touch devices
  // browsers synthesize click after pointer activation, which used to double-toggle
  // the Start menu and make apps appear to open/close immediately.
  // v1.0 BETA fix: this was defined but never called anywhere, so dragging
  // an app icon from the Start menu onto the desktop to pin a shortcut did
  // nothing at all. initLauncherDrag() guards itself with dataset.dragReady
  // so it's safe to call every time buildLauncher() re-renders the grid.
  initLauncherDrag();initDesktopClearButton();
  if (search && !search.dataset.wired) {
    search.dataset.wired = "1";
    search.addEventListener("input", () => buildLauncher());
    search.addEventListener("keydown", e => {
      if (e.key === "Escape") { search.value = ""; buildLauncher(); search.blur(); }
      if (e.key === "Enter") { const first = grid.querySelector("[data-app]"); if (first) first.click(); }
    });
  }
}

// V2.0 BETA+: per-app local lock. This is a UI/app lock, not an OS-level lock.
async function hcrDigest(value){
  try{const bytes=new TextEncoder().encode(value),buf=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');}catch(_){return btoa(unescape(encodeURIComponent(value)));}}
function hcrLockedApps(){try{return JSON.parse(localStorage.getItem('hcr-locked-apps')||'[]')}catch(_){return[]}}
async function hcrUnlockApp(id){const locks=hcrLockedApps();if(!locks.includes(id))return true;const pin=window.prompt('This app is locked. Enter the app PIN:');if(pin===null)return false;const hash=await hcrDigest(pin);const saved=localStorage.getItem('hcr-app-lock-hash');if(!saved||hash!==saved){alert('Incorrect app PIN.');return false;}return true;}
async function hcrConfigureAppLock(id){
  if(!id||['settings','security','store'].includes(id)) return;
  const locks=hcrLockedApps(),idx=locks.indexOf(id);
  if(idx>=0){locks.splice(idx,1);localStorage.setItem('hcr-locked-apps',JSON.stringify(locks));return false;}
  let hash=localStorage.getItem('hcr-app-lock-hash');
  if(!hash){const pin=window.prompt('Create an App Lock PIN (4+ characters):');if(!pin||pin.length<4)throw new Error('PIN must be at least 4 characters.');const confirmPin=window.prompt('Confirm App Lock PIN:');if(pin!==confirmPin)throw new Error('PIN confirmation did not match.');hash=await hcrDigest(pin);localStorage.setItem('hcr-app-lock-hash',hash);}
  locks.push(id);localStorage.setItem('hcr-locked-apps',JSON.stringify(locks));return true;
}

// ---------------- Window manager ----------------
async function openApp(id) {
  if (openWindows[id]) {
    focusWindow(openWindows[id]);
    return;
  }
  const app = APPS.find(a => a.id === id);
  if (!app) { console.warn("DeveloperHCR: app not found", id); return; }
  if (!(await hcrUnlockApp(id))) return;
  if (!appAllowed(app)) {
    const fallback = APPS.find(a => a.id === "subscriptions");
    if (fallback && id !== "subscriptions") return openApp("subscriptions");
    return;
  }
  const win = document.createElement("div");
  win.className = "win";
  win.dataset.app = id;
  win.style.left = (60 + Object.keys(openWindows).length * 24) + "px";
  win.style.top = (40 + Object.keys(openWindows).length * 24) + "px";
  const layerRect=document.getElementById("windows-layer").getBoundingClientRect();
  const narrow = layerRect.width < 720;
  const minWidth = Math.max(280, Math.min(560, layerRect.width - (narrow ? 12 : 24)));
  const targetWidth = narrow ? Math.max(280, Math.min(680, layerRect.width - 12)) : Math.max(560, Math.min(760, Math.round(layerRect.width*0.62)));
  const targetHeight = narrow ? Math.max(240, Math.min(620, layerRect.height - 12)) : Math.max(320, Math.min(560, Math.round(layerRect.height*0.68)));
  win.style.minWidth = minWidth + "px";
  win.style.width = targetWidth + "px";
  win.style.height = targetHeight + "px";
  win.style.left = narrow ? "6px" : win.style.left;
  win.style.top = narrow ? "6px" : win.style.top;
  win.innerHTML = `
    <div class="win-titlebar">
      <span class="win-title">${app.glyph} ${app.name}</span>
      <span class="win-controls">
        <button class="win-min" title="Minimize">—</button>
        <button class="win-max" title="Maximize / Restore">⛶</button>
        <button class="win-close" title="Close">✕</button>
      </span>
    </div>
    <div class="win-body"></div>
    <div class="win-resize"></div>
  `;
  document.getElementById("windows-layer").appendChild(win);
  openWindows[id] = win;
  document.getElementById("desktop")?.classList.add("windows-open");

  makeDraggable(win);
  makeResizable(win);
  win.addEventListener("mousedown", () => focusWindow(win));

  win.querySelector(".win-close").onclick = () => closeApp(id);
  win.querySelector(".win-min").onclick = () => { win.classList.add("minimized"); };
  win.querySelector(".win-max").onclick = () => toggleMaximize(win);
  win.querySelector(".win-titlebar").ondblclick = () => toggleMaximize(win);

  addTrayItem(id, app);
  focusWindow(win);
  playUISound("open");
  const appBody = win.querySelector(".win-body");
  Promise.resolve().then(() => app.render(appBody)).catch(err => {
    appBody.innerHTML = `<div class="note-card"><b>App failed to load</b><div class="dim">${escapeHtml(String(err?.message || err))}</div><button class="btn" data-retry>Retry</button></div>`;
    appBody.querySelector("[data-retry]")?.addEventListener("click", () => { appBody.innerHTML="<div class='dim'>Loading…</div>"; Promise.resolve().then(()=>app.render(appBody)).catch(e=>appBody.innerHTML=`<div class='note-card'><b>Retry failed</b><div class='dim'>${escapeHtml(String(e?.message||e))}</div></div>`); });
  });
  api(`/api/usage/${id}`, { method: "POST" }).catch(() => {});
}

function closeApp(id) {
  if (openWindows[id]) {
    openWindows[id].remove();
    delete openWindows[id];
  }
  const tray = document.getElementById(`tray-${id}`);
  if (tray) tray.remove();
  if (!Object.keys(openWindows).length) document.getElementById("desktop")?.classList.remove("windows-open");
}

function addTrayItem(id, app) {
  const tray = document.getElementById("open-apps-tray");
  const item = document.createElement("div");
  item.className = "tray-item";
  item.id = `tray-${id}`;
  item.innerHTML = `<span class="tray-logo">${app.glyph}</span><span>${app.name}</span>`;
  item.onclick = () => {
    const win = openWindows[id];
    win.classList.remove("minimized");
    focusWindow(win);
  };
  tray.appendChild(item);
}

function toggleMaximize(win) {
  if (win.classList.contains("maximized")) {
    win.classList.remove("maximized");
    if (win.dataset.preLeft !== undefined) {
      win.style.left = win.dataset.preLeft;
      win.style.top = win.dataset.preTop;
      win.style.width = win.dataset.preWidth;
      win.style.height = win.dataset.preHeight;
    }
  } else {
    win.dataset.preLeft = win.style.left;
    win.dataset.preTop = win.style.top;
    win.dataset.preWidth = win.style.width;
    win.dataset.preHeight = win.style.height;
    win.classList.add("maximized");
  }
  focusWindow(win);
}

function focusWindow(win) {
  if (!win || !win.isConnected) return;
  zTop = Math.max(zTop + 1, 100);
  document.querySelectorAll("#windows-layer .win").forEach(w => {
    w.classList.toggle("window-active", w === win);
    if (w !== win) w.style.zIndex = Math.max(30, Number(w.style.zIndex || 30));
  });
  win.style.zIndex = zTop;
  document.querySelectorAll(".tray-item").forEach(t => t.classList.remove("active"));
  const id = Object.keys(openWindows).find(k => openWindows[k] === win);
  if (id) document.getElementById(`tray-${id}`)?.classList.add("active");
}

function makeDraggable(win) {
  const bar = win.querySelector(".win-titlebar");
  let dragging=false, sx=0, sy=0, ox=0, oy=0, pid=null;
  const move = e => {
    if(!dragging || (pid!==null && e.pointerId!==pid)) return;
    e.preventDefault();
    const layer=document.getElementById("windows-layer");
    const rect=layer.getBoundingClientRect();
    let x=ox + e.clientX - sx, y=oy + e.clientY - sy;
    x=Math.max(0, Math.min(x, Math.max(0, rect.width-win.offsetWidth)));
    y=Math.max(0, Math.min(y, Math.max(0, rect.height-win.offsetHeight)));
    win.style.left=x+"px"; win.style.top=y+"px";
  };
  const up = e => {
    if(pid!==null && e.pointerId!==pid) return;
    dragging=false; pid=null;
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
  };
  bar.addEventListener("pointerdown", e => {
    if(e.target.closest("button")) return;
    if(win.classList.contains("maximized")) return;
    dragging=true; pid=e.pointerId; sx=e.clientX; sy=e.clientY; ox=win.offsetLeft; oy=win.offsetTop;
    try{bar.setPointerCapture(e.pointerId);}catch(_){ }
    focusWindow(win); e.preventDefault();
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
  });
}

function makeResizable(win) {
  const handle = win.querySelector(".win-resize");
  let resizing=false, sx=0, sy=0, ow=0, oh=0, pid=null;
  const move=e=>{ if(!resizing || (pid!==null&&e.pointerId!==pid))return; e.preventDefault(); win.style.width=Math.max(320,ow+e.clientX-sx)+"px"; win.style.height=Math.max(220,oh+e.clientY-sy)+"px"; };
  const up=e=>{ if(pid!==null&&e.pointerId!==pid)return; resizing=false;pid=null;document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",up,true); };
  handle.addEventListener("pointerdown",e=>{ if(win.classList.contains("maximized"))return; resizing=true;pid=e.pointerId;sx=e.clientX;sy=e.clientY;ow=win.offsetWidth;oh=win.offsetHeight;try{handle.setPointerCapture(e.pointerId);}catch(_){} e.preventDefault();e.stopPropagation();document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",up,true); });
}

// Windows-style desktop shortcuts with safe default limit and long-press placement.
const DEFAULT_DESKTOP_APPS=["files","browser","aichat","jarvis","terminal","settings","store","notes","calc","games"];
function desktopShortcutLimit(){
  const v=localStorage.getItem("hcr-desktop-app-limit");
  const explicit=localStorage.getItem("hcr-desktop-app-limit-explicit")==="1";
  if(!explicit && (v===null || v==="10")){ localStorage.setItem("hcr-desktop-app-limit","unlimited"); return Infinity; }
  return v==="unlimited"?Infinity:10;
}
function autoReturnHomeAfterPin(){return localStorage.getItem("hcr-auto-home-after-pin")!=="0";}
function closeLauncher(){const l=document.getElementById("app-launcher");if(l){l.classList.add("hidden");l.setAttribute("aria-hidden","true");}}
function clearAllDesktopShortcuts(){if(!confirm("Clear all apps from the desktop? Apps will remain installed in App Menu."))return;Object.keys(openWindows||{}).forEach(id=>{try{closeApp(id)}catch(_){}});document.querySelectorAll(".drag-ghost").forEach(n=>n.remove());localStorage.removeItem("hcr-desktop-apps");localStorage.removeItem("hcr-desktop-positions");buildDesktopIcons();}
function desktopShortcutIds(){try{const raw=localStorage.getItem("hcr-desktop-apps");if(raw!==null){const saved=JSON.parse(raw);if(Array.isArray(saved)){const valid=saved.filter(x=>APPS.some(a=>a.id===x));return valid.length?valid.slice(0,desktopShortcutLimit()):DEFAULT_DESKTOP_APPS.filter(x=>APPS.some(a=>a.id===x));}}}catch(_){}return DEFAULT_DESKTOP_APPS.filter(x=>APPS.some(a=>a.id===x)).slice(0,desktopShortcutLimit());}
function saveDesktopShortcutIds(ids){const limit=desktopShortcutLimit();localStorage.setItem("hcr-desktop-apps",JSON.stringify([...new Set(ids)].slice(0,limit===Infinity?999:limit)));}
function desktopIconSize(){return localStorage.getItem("hcr-desktop-icon-size")||"medium";}
function desktopPositions(){try{return JSON.parse(localStorage.getItem("hcr-desktop-positions")||"{}")}catch(_){return {}}}
function saveDesktopPosition(id,left,top){const p=desktopPositions();p[id]={left:Math.max(4,Math.round(left)),top:Math.max(4,Math.round(top))};localStorage.setItem("hcr-desktop-positions",JSON.stringify(p));}
function addDesktopShortcut(id){const ids=desktopShortcutIds();if(!ids.includes(id)){const limit=desktopShortcutLimit();if(limit!==Infinity&&ids.length>=limit){alert("Desktop limit reached (10 apps). Open Settings → Desktop → App limit → Unlimited.");return false;}ids.push(id);saveDesktopShortcutIds(ids);}buildDesktopIcons();if(autoReturnHomeAfterPin())closeLauncher();return true;}
function removeDesktopShortcut(id){saveDesktopShortcutIds(desktopShortcutIds().filter(x=>x!==id));const p=desktopPositions();delete p[id];localStorage.setItem("hcr-desktop-positions",JSON.stringify(p));buildDesktopIcons();}
function buildDesktopIcons(){const wrap=document.getElementById("desktop-icons");if(!wrap)return;wrap.innerHTML="";const ids=desktopShortcutIds(),pos=desktopPositions(),size=desktopIconSize();wrap.classList.toggle("has-shortcuts",ids.length>0);wrap.style.display=ids.length?"block":"none";const rect=wrap.getBoundingClientRect();const cols=Math.max(1,Math.floor(Math.max(280,(rect.width||innerWidth)-20)/92));ids.forEach((id,index)=>{const app=APPS.find(a=>a.id===id);if(!app)return;const el=document.createElement("div");el.className="desktop-icon";el.dataset.app=id;el.dataset.moved="0";el.dataset.size=size;const p=pos[id]||{left:8+(index%cols)*86,top:8+Math.floor(index/cols)*92};el.style.left=Math.max(4,p.left)+"px";el.style.top=Math.max(4,p.top)+"px";el.innerHTML=`<span class="glyph app-logo">${app.glyph}</span><span>${escapeHtml(app.name)}</span>`;let downAt=0;el.addEventListener("pointerdown",e=>{if(e.button!==0)return;downAt=Date.now();makeShortcutDraggable(el,e);});el.addEventListener("pointerup",()=>{if(el.dataset.moved!=="1"&&Date.now()-downAt<650)openApp(id);});el.addEventListener("dblclick",()=>openApp(id));el.addEventListener("contextmenu",e=>{e.preventDefault();if(confirm("Remove this desktop shortcut?"))removeDesktopShortcut(id);});wrap.appendChild(el);});}
function makeShortcutDraggable(el,start){const sx=start.clientX,sy=start.clientY,ol=parseFloat(el.style.left)||0,ot=parseFloat(el.style.top)||0,pid=start.pointerId;let moved=false;const move=e=>{if(e.pointerId!==pid)return;const dx=e.clientX-sx,dy=e.clientY-sy;if(!moved&&Math.hypot(dx,dy)<8)return;moved=true;el.dataset.moved="1";const wrap=document.getElementById("desktop-icons");const maxX=Math.max(4,(wrap?.clientWidth||innerWidth)-el.offsetWidth-4),maxY=Math.max(4,(wrap?.clientHeight||innerHeight)-el.offsetHeight-4);el.style.left=Math.min(maxX,Math.max(4,ol+dx))+"px";el.style.top=Math.min(maxY,Math.max(4,ot+dy))+"px";};const up=e=>{if(e.pointerId!==pid)return;document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",up,true);if(moved)saveDesktopPosition(el.dataset.app,parseFloat(el.style.left)||0,parseFloat(el.style.top)||0);setTimeout(()=>el.dataset.moved="0",350);};document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",up,true);try{el.setPointerCapture?.(pid)}catch(_){} }
function initLauncherDrag(){
  const grid=document.getElementById("launcher-grid");
  if(!grid||grid.dataset.dragReady)return;
  grid.dataset.dragReady="1";
  // Touch scrolling must never create a drag ghost. Mouse/pen pin-drag remains available.
  let drag=null,timer=null;
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}drag?.ghost?.remove();document.querySelectorAll('.drag-ghost').forEach(n=>n.remove());drag=null;};
  const touch=e=>e.pointerType==='touch'||e.pointerType==='unknown';
  grid.addEventListener("pointerdown",e=>{
    const el=e.target.closest(".app-icon"); if(!el||touch(e))return;
    const id=el.dataset.app,app=APPS.find(a=>a.id===id);if(!app)return;
    drag={el,id,sx:e.clientX,sy:e.clientY,pid:e.pointerId,moved:false,ghost:null};
    timer=setTimeout(()=>{if(!drag)return;drag.longPressed=true;drag.moved=true;const ok=addDesktopShortcut(id);el.dataset.suppressClick="1";el.setAttribute("aria-label",ok?"Added to desktop":"Desktop limit reached");setTimeout(()=>delete el.dataset.suppressClick,500);},650);
    try{el.setPointerCapture?.(e.pointerId)}catch(_){}
  });
  const onMove=e=>{if(!drag||e.pointerId!==drag.pid)return;const d=Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy);if(d>8&&!drag.longPressed){if(timer){clearTimeout(timer);timer=null;}drag.moved=true;if(!drag.ghost){drag.ghost=document.createElement("div");drag.ghost.className="drag-ghost";drag.ghost.textContent=APPS.find(a=>a.id===drag.id)?.glyph||"📦";document.body.appendChild(drag.ghost);}}if(drag?.ghost){drag.ghost.style.left=e.clientX+"px";drag.ghost.style.top=e.clientY+"px";e.preventDefault();}};
  const onUp=e=>{if(!drag||e.pointerId!==drag.pid)return;const d=drag;clear();if(d.longPressed||!d.moved)return;const desk=document.getElementById("desktop"),r=desk?.getBoundingClientRect();if(r&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom-46){if(addDesktopShortcut(d.id)){saveDesktopPosition(d.id,e.clientX-r.left-34,e.clientY-r.top-38);buildDesktopIcons();}}d.el.dataset.suppressClick="1";setTimeout(()=>delete d.el.dataset.suppressClick,250);};
  document.addEventListener("pointermove",onMove,true);document.addEventListener("pointerup",onUp,true);document.addEventListener("pointercancel",clear,true);document.addEventListener("lostpointercapture",clear,true);window.addEventListener("blur",clear);grid.addEventListener("scroll",clear,{passive:true});
}
function initDesktopClearButton(){const b=document.getElementById("desktop-clear-btn");if(!b||b.dataset.wired)return;b.dataset.wired="1";b.onclick=clearAllDesktopShortcuts;}


// ================= APP: HCR AI Agent (v0.8 Level 8) =================
async function renderJarvisApp(body) {
  const st = await api('/api/jarvis/status');
  const settings = await api('/api/settings');
  const name = settings.assistant_name || 'HCR AI Agent';
  body.innerHTML = `
    <div class="jarvis-shell level8">
      <div class="row jarvis-top"><div><b id="assistant-title">${escapeHtml(name)}</b> <span class="badge">LEVEL 8 · offline-first</span></div><button class="btn" id="jarvis-landscape">🌐 Landscape</button></div>
      <div class="jarvis-orb-wrap"><div class="jarvis-orb" id="jarvis-orb"><img src="/static/developerhcr-logo.jpg" alt="DeveloperHCR"><span class="orb-ring"></span></div><div class="voice-dots" id="voice-dots">${Array.from({length:10},(_,i)=>`<i style="--i:${i}"></i>`).join("")}</div></div>
      <div id="jarvis-status" class="dim">Ready — safe voice actions can run without repeated confirmation.</div>
      <div class="assistant-state-row"><span id="assistant-state-dot"></span><span id="assistant-state">IDLE</span><span id="recording-badge" class="recording-badge hidden">● RECORDING LOCALLY</span></div>
      <div class="row" style="margin:8px 0; flex-wrap:wrap;">
        <button class="btn" id="jarvis-listen">🎙️ Listen</button>
        <button class="btn" id="jarvis-say">🔊 Speak</button>
        <button class="btn" id="jarvis-screen">🖥️ See Screen</button>
        <button class="btn" id="jarvis-record-start">⏺ Start Training Record</button>
        <button class="btn" id="jarvis-record-stop">⏹ Stop Record</button>
        <button class="btn" id="jarvis-system">📡 System</button>
        <button class="btn" id="jarvis-ai">🤖 AI Runtimes</button><button class="btn" id="jarvis-refresh-runtimes">↻ Refresh Runtimes</button>
      </div>
      <textarea id="jarvis-input" rows="3" placeholder="Speak/type: open calculator, show system, ask local AI..."></textarea>
      <div class="row" style="margin-top:6px;"><button class="btn" id="jarvis-run">Run / Ask</button><span id="jarvis-result" class="dim"></span></div>
      <div id="jarvis-ai-view" class="ai-runtime-panel"></div>
      <div id="jarvis-screen-wrap" class="jarvis-screen-wrap hidden"><img id="jarvis-screen-img" alt="Current screen snapshot"></div>
      <pre id="jarvis-system-view" class="term-log" style="height:140px;"></pre>
      <div class="dim" style="font-size:.72rem; margin-top:6px;">Screen training capture is explicit, visible and local-only. OS microphone/screen permissions cannot be bypassed.</div>
    </div>`;
  const status=body.querySelector('#jarvis-status'), input=body.querySelector('#jarvis-input'), result=body.querySelector('#jarvis-result'), orb=body.querySelector('#jarvis-orb'), state=body.querySelector('#assistant-state'), badge=body.querySelector('#recording-badge');
  const dots=body.querySelector('#voice-dots');
  if(dots) dots.innerHTML=Array.from({length:42},(_,i)=>`<i style="--i:${i}"></i>`).join('');
  const setState=(x)=>{state.textContent=x; orb.classList.toggle('jarvis-active',x!=='IDLE'); dots?.classList.toggle('voice-active', ['LISTENING','PROCESSING','SPEAKING','GENERATING','RECORDING'].includes(x));};
  // v1.0 BETA fix: recording state was purely local to this render, so
  // closing and reopening the Jarvis app while a recording was still running
  // always showed the badge as hidden/IDLE even though it was still active.
  api('/api/jarvis/recording/status').then(rs=>{ if(rs && rs.running){ badge.classList.remove('hidden'); setState('RECORDING'); status.textContent='Full-screen training capture is running locally.'; } }).catch(()=>{});
  const browserSpeak=text=>{try{if(!('speechSynthesis' in window))return false;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=.98;u.pitch=1.0;u.onend=()=>setState('IDLE');u.onerror=()=>setState('IDLE');window.speechSynthesis.speak(u);return true;}catch(_){return false;}};
  const say=async text=>{ if(!text)return; setState('SPEAKING'); if(browserSpeak(text)){result.textContent='Speaking through device voice.';return;} const r=await api('/api/jarvis/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); setState('IDLE'); result.textContent=r.ok?'Spoken locally.':(r.error||'TTS unavailable'); };
  body.querySelector('#jarvis-listen').onclick=async()=>{
    setState('LISTENING'); status.textContent='Requesting microphone permission…';
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SpeechRecognition){
      try{const rec=new SpeechRecognition();rec.lang=navigator.language||'en-IN';rec.interimResults=false;rec.maxAlternatives=1;rec.continuous=false;let heard='';rec.onresult=e=>{heard=e.results?.[0]?.[0]?.transcript||'';input.value=heard;};rec.onerror=e=>{status.textContent='Microphone/voice error: '+(e.error||'permission denied');setState('IDLE');};rec.onend=async()=>{if(heard){status.textContent='Heard: '+heard;await runJarvis(heard);}else if(state.textContent==='LISTENING'){status.textContent='No speech detected.';setState('IDLE');}};rec.start();return;}
      catch(e){status.textContent='Browser voice unavailable; trying local voice engine…';}
    }
    const r=await api('/api/jarvis/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:5}),timeoutMs:9000}); if(r.ok){input.value=r.text||'';status.textContent=r.text?'Heard: '+r.text:'No speech detected.';if(r.text)await runJarvis(r.text);}else status.textContent=r.error||'Offline voice unavailable.';setState('IDLE');
  };
  body.querySelector('#jarvis-say').onclick=()=>say(input.value || result.textContent);
  body.querySelector('#jarvis-screen').onclick=async()=>{ const img=body.querySelector('#jarvis-screen-img'); img.src='/api/jarvis/screen?ts='+Date.now(); body.querySelector('#jarvis-screen-wrap').classList.remove('hidden'); status.textContent='Current screen snapshot loaded.'; };
  body.querySelector('#jarvis-record-start').onclick=async()=>{ setState('RECORDING'); const ss=await api('/api/settings').catch(()=>({})); const fps=ss.jarvis_capture_quality==='high'?8:(ss.jarvis_capture_quality==='low'?2:4); const r=await api('/api/jarvis/recording/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fps,quality:ss.jarvis_capture_quality||'medium',size:ss.jarvis_capture_size||'full'})}); if(r.ok){badge.classList.remove('hidden'); status.textContent='Full-screen training capture is running locally.';} else status.textContent=r.error||'Recording unavailable.'; setState(r.ok?'RECORDING':'IDLE'); };
  body.querySelector('#jarvis-record-stop').onclick=async()=>{ const r=await api('/api/jarvis/recording/stop',{method:'POST'}); badge.classList.add('hidden'); setState('IDLE'); status.textContent=r.ok?'Recording stopped and saved locally.':(r.error||'Unable to stop recording.'); };
  body.querySelector('#jarvis-system').onclick=async()=>{ const r=await api('/api/jarvis/system'); body.querySelector('#jarvis-system-view').textContent=JSON.stringify(r,null,2); };
  body.querySelector('#jarvis-ai').onclick=async()=>{ const r=await api('/api/jarvis/ai-runtimes'); body.querySelector('#jarvis-ai-view').innerHTML=Object.entries(r).map(([k,v])=>`<div class="runtime-card"><b>${escapeHtml(k)}</b> · installed ${v.installed?'YES':'NO'} · running ${v.running?'YES':'NO'}<div class="dim">${(v.models||[]).map(m=>escapeHtml(m.name||'unknown')).join(' · ')||'No models detected'}</div></div>`).join(''); };
  body.querySelector('#jarvis-refresh-runtimes').onclick=()=>body.querySelector('#jarvis-ai').click();
  body.querySelector('#jarvis-landscape').onclick=async()=>{document.body.classList.add('landscape-mode');document.body.classList.remove('force-landscape');localStorage.setItem('hcr-orientation','landscape');try{await screen.orientation?.lock?.('landscape');}catch(_){};await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({desktop_orientation:'landscape',force_landscape_rotate:false})});status.textContent='Landscape layout enabled. Android controls physical rotation.';};
  body.querySelector('#jarvis-run').onclick=()=>runJarvis(input.value);
  async function runJarvis(text){
    text=(text||'').trim(); if(!text)return; setState('PROCESSING');
    const p=await api('/api/jarvis/command/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:text})});
    if(p.allowed){ const r=await api('/api/jarvis/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:p.action})}); result.textContent=r.ok?'Action completed: '+p.action:(r.error||'Action failed'); await say(r.ok?'Done. '+p.action.replaceAll('_',' '):'I could not complete that action.'); setState('IDLE'); return; }
    status.textContent='Asking local AI...'; const a=await api('/api/jarvis/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); result.textContent=a.ok?a.text:(a.error||'AI unavailable'); if(a.ok) await say(a.text); setState('IDLE');
  }
}

// ================= APP: Command Center =================
async function renderCommanderApp(body) {
  body.innerHTML=`<div class="stack command-center">
    <div class="row"><div><h3 style="margin:0">🎙️ Command Center</h3><div class="dim">Simple safe commands — fewer buttons, clearer actions.</div></div><span id="cmd-state" class="badge">IDLE</span></div>
    <div class="note-card"><div class="row"><input id="cmd-input" style="flex:1" placeholder="Try: open calculator, show system, open games…"><button class="btn primary" id="cmd-run">Run</button><button class="btn" id="cmd-mic">🎙 Mic</button></div><div id="cmd-status" class="dim" style="margin-top:6px">Ready.</div></div>
    <div class="note-card"><b>Quick commands</b><div class="row" style="flex-wrap:wrap;margin-top:8px"><button class="btn" data-cmd="open calculator">🧮 Calculator</button><button class="btn" data-cmd="open games">🎮 Games</button><button class="btn" data-cmd="open files">📁 Files</button><button class="btn" data-cmd="open settings">⚙️ Settings</button><button class="btn" data-cmd="show system">🖥️ System</button></div></div>
    <div class="note-card"><b>Safety</b><div class="dim">Commands go through the same safe command preview used by HCR AI. Destructive commands are not executed here.</div></div>
  </div>`;
  const input=body.querySelector('#cmd-input'),status=body.querySelector('#cmd-status'),state=body.querySelector('#cmd-state');
  const run=async(text)=>{text=(text||'').trim();if(!text){status.textContent='Enter a command first.';return;}state.textContent='PROCESSING';status.textContent='Checking command…';try{const p=await api('/api/jarvis/command/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:text})});if(!p.allowed){status.textContent=p.reason||'Command not allowed. Use HCR AI for natural-language help.';state.textContent='BLOCKED';return;}const r=await api('/api/jarvis/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:p.action})});status.textContent=r.ok?'Done: '+p.action.replaceAll('_',' '):(r.error||'Action failed.');state.textContent=r.ok?'DONE':'ERROR';}catch(e){status.textContent='Command failed: '+(e.message||e);state.textContent='ERROR';}setTimeout(()=>state.textContent='IDLE',1200);};
  body.querySelector('#cmd-run').onclick=()=>run(input.value);
  body.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{input.value=b.dataset.cmd;run(b.dataset.cmd);});
  body.querySelector('#cmd-mic').onclick=async()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){status.textContent='Microphone speech recognition is unavailable in this browser.';return;}const rec=new SR();rec.lang=navigator.language||'en-IN';rec.interimResults=false;rec.maxAlternatives=1;state.textContent='LISTENING';status.textContent='Listening…';rec.onresult=e=>{input.value=e.results?.[0]?.[0]?.transcript||'';};rec.onerror=e=>{status.textContent='Microphone error: '+(e.error||'unknown');state.textContent='ERROR';};rec.onend=()=>{if(input.value.trim())run(input.value);else state.textContent='IDLE';};try{rec.start();}catch(e){status.textContent='Microphone could not start.';state.textContent='ERROR';}};
}

// ================= APP: Notes =================
async function renderNotesApp(body) {
  const data = await api("/api/notes");
  body.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <input id="note-input" placeholder="Write a note and press Add..." style="flex:1;">
      <button class="btn" id="note-add">Add</button>
    </div>
    <div id="notes-list"></div>
  `;
  const list = body.querySelector("#notes-list");
  function draw(notes) {
    list.innerHTML = notes.map((n, i) => `
      <div class="note-card">
        <div>${escapeHtml(n.text)}</div>
        <div class="dim" style="font-size:0.7rem; display:flex; justify-content:space-between; margin-top:4px;">
          <span>${new Date(n.ts).toLocaleString()}</span>
          <button class="btn" data-i="${i}" style="padding:2px 6px;">Delete</button>
        </div>
      </div>
    `).join("") || `<div class="dim">No notes yet.</div>`;
    list.querySelectorAll("button[data-i]").forEach(b => {
      b.onclick = async () => {
        notes.splice(parseInt(b.dataset.i), 1);
        await api("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) });
        broadcast("notes-updated", {});
        draw(notes);
      };
    });
  }
  let notes = data.notes;
  draw(notes);
  body.querySelector("#note-add").onclick = async () => {
    const input = body.querySelector("#note-input");
    if (!input.value.trim()) return;
    notes.unshift({ text: input.value.trim(), ts: Date.now() });
    input.value = "";
    await api("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) });
    broadcast("notes-updated", {});
    draw(notes);
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ================= v2.8: extra local utility apps =================
function renderSystemInfoApp(body){
  body.innerHTML=`<div class="stack"><h3>🖥️ System Information</h3><div class="note-card"><b>DeveloperHCR</b><div class="dim">Browser runtime: ${escapeHtml(navigator.userAgent)}</div><div class="dim">Language: ${escapeHtml(navigator.language||"unknown")}</div><div class="dim">Screen: ${screen.width} × ${screen.height}</div><div class="dim">Viewport: ${innerWidth} × ${innerHeight}</div><div class="dim">Online: ${navigator.onLine?"Yes":"No"}</div><div class="dim">CPU threads: ${navigator.hardwareConcurrency||"N/A"}</div><div class="dim">Memory: ${navigator.deviceMemory?navigator.deviceMemory+" GB":"N/A"}</div></div></div>`;
}
function renderDownloadsApp(body){
  body.innerHTML=`<div class="stack"><h3>⬇️ HCR Download Manager</h3><div class="note-card"><b>Real HTTPS download</b><div class="dim">Downloads are started only when you press the button. The local server saves them in DeveloperHCR/data/downloads and reports the real progress/result.</div><div class="row"><input id="dl-url" style="flex:1" placeholder="https://example.com/file.zip"><button class="btn primary" id="dl-start">⬇️ Download</button></div><div id="dl-status" class="dim"></div></div><div class="note-card"><b>Downloaded files</b><button class="btn" id="dl-refresh">↻ Refresh</button><div id="dl-list" class="stack"></div></div><div class="note-card"><b>Browser downloads</b><button class="btn" id="open-downloads">Open browser downloads</button></div></div>`;
  const status=body.querySelector('#dl-status'), list=body.querySelector('#dl-list');
  async function refresh(){const r=await api('/api/downloads/files'); list.innerHTML=(r.files||[]).map(f=>`<div class="note-card"><b>${escapeHtml(f.name)}</b><div class="dim">${Number(f.size||0).toLocaleString()} bytes</div></div>`).join('')||'<div class="dim">No DeveloperHCR downloads yet.</div>'; }
  body.querySelector('#dl-start').onclick=async()=>{const url=body.querySelector('#dl-url').value.trim(); if(!url){status.textContent='Enter an HTTPS URL.';return;} const b=body.querySelector('#dl-start'); b.disabled=true; status.textContent='Starting download…'; const r=await api('/api/downloads/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),timeoutMs:8000}); if(r.error){status.textContent=r.error;b.disabled=false;return;} const id=r.job.id; const poll=async()=>{const x=await api('/api/downloads/status/'+id,{timeoutMs:4000}); if(x.error){status.textContent=x.error;b.disabled=false;return;} status.textContent=x.status==='complete'?`Completed: ${x.name}`:x.status==='error'?`Download failed: ${x.error}`:`Downloading… ${x.progress==null?'':x.progress+'%'} · ${Number(x.bytes||0).toLocaleString()} bytes`; if(x.status==='complete'||x.status==='error'){b.disabled=false;await refresh();return;} setTimeout(poll,500);}; poll(); };
  body.querySelector('#dl-refresh').onclick=refresh; body.querySelector('#open-downloads').onclick=()=>{try{window.open('chrome://downloads/','_blank');}catch(_){ } status.textContent='Use your browser menu → Downloads if the internal page is blocked.';}; refresh();
}
function renderAppInstallerApp(body){
  body.innerHTML=`<div class="stack"><h3>📦 App Installer</h3><div class="dim">Install a package only after explicit confirmation. HCR Store remains the recommended source.</div><input id="pkg-url" placeholder="HTTPS package URL (ZIP)"/><button class="btn" id="pkg-install">Validate & Install</button><div id="pkg-status" class="dim"></div></div>`;
  body.querySelector('#pkg-install').onclick=async()=>{const url=body.querySelector('#pkg-url').value.trim(),st=body.querySelector('#pkg-status');if(!/^https:\/\//i.test(url)){st.textContent='Only HTTPS package URLs are allowed.';return;}st.textContent='Submitting package for validation…';const r=await api('/api/store/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:url,version:'latest',app_id:'remote-package'})});st.textContent=r.ok?'Package accepted for installation.':'Installation not completed: '+(r.error||'validation failed');};
}
function renderQuickTextViewerApp(body){
  body.innerHTML=`<div class="stack"><h3>📃 Quick Text Viewer</h3><input id="txt-file" type="file" accept=".txt,.md,.json,.log,.py,.js,.css,.html,text/plain,application/json"/><pre id="txt-out" class="term-log" style="max-height:55vh;overflow:auto;white-space:pre-wrap">Choose a local text file.</pre></div>`;
  body.querySelector('#txt-file').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>body.querySelector('#txt-out').textContent=String(r.result||'');r.readAsText(f);};
}
function renderColorPickerApp(body){
  body.innerHTML=`<div class="stack"><h3>🎨 Color Picker</h3><input id="cp" type="color" value="#4f8cff" style="width:100%;height:90px"><div class="note-card"><b id="cpv">#4f8cff</b><button class="btn" id="cpcopy">Copy</button></div></div>`;
  const cp=body.querySelector('#cp'),v=body.querySelector('#cpv');cp.oninput=()=>v.textContent=cp.value;body.querySelector('#cpcopy').onclick=()=>navigator.clipboard?.writeText(cp.value);
}
function renderJsonViewerApp(body){
  body.innerHTML=`<div class="stack"><h3>{} JSON Viewer</h3><textarea id="json-in" rows="9" placeholder='Paste JSON here'></textarea><button class="btn" id="json-format">Format & Validate</button><pre id="json-out" class="term-log" style="white-space:pre-wrap"></pre></div>`;
  body.querySelector('#json-format').onclick=()=>{const out=body.querySelector('#json-out');try{out.textContent=JSON.stringify(JSON.parse(body.querySelector('#json-in').value),null,2);}catch(e){out.textContent='Invalid JSON: '+e.message;}};
}
function renderStopwatchApp(body){
  body.innerHTML=`<div class="stack"><h3>⏱️ Stopwatch</h3><div id="sw-time" style="font-size:2.5rem;font-variant-numeric:tabular-nums">00:00.0</div><div class="row"><button class="btn" id="sw-start">Start</button><button class="btn" id="sw-reset">Reset</button></div></div>`;
  let t=0,run=false,last=0,raf=0;const out=body.querySelector('#sw-time');const tick=(ts)=>{if(!run)return;if(!last)last=ts;t+=ts-last;last=ts;out.textContent=(t/1000).toFixed(1).padStart(4,'0');raf=requestAnimationFrame(tick);};body.querySelector('#sw-start').onclick=()=>{run=!run;body.querySelector('#sw-start').textContent=run?'Pause':'Start';if(run){last=0;raf=requestAnimationFrame(tick)}else{cancelAnimationFrame(raf);last=0;}};body.querySelector('#sw-reset').onclick=()=>{t=0;run=false;last=0;cancelAnimationFrame(raf);out.textContent='00:00.0';body.querySelector('#sw-start').textContent='Start';};
}

// ================= APP: Calculator =================
function renderCalcApp(body) {
  let expr = "";
  body.innerHTML = `
    <div class="calc-display" id="calc-disp">0</div>
    <div class="grid-2" id="calc-grid"></div>
  `;
  const buttons = ["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+","C","(",")","%"];
  const grid = body.querySelector("#calc-grid");
  const disp = body.querySelector("#calc-disp");
  buttons.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = b;
    btn.onclick = () => {
      if (b === "C") { expr = ""; }
      else if (b === "=") {
        try {
          // Only allow safe arithmetic characters before evaluating.
          if (/^[0-9+\-*/().%\s]+$/.test(expr)) {
            expr = String(Function(`"use strict"; return (${expr})`)());
          } else {
            expr = "Error";
          }
        } catch { expr = "Error"; }
      } else {
        expr += b;
      }
      disp.textContent = expr || "0";
    };
    grid.appendChild(btn);
  });
}

// ================= APP: File Manager =================
async function renderFilesApp(body, path = "") {
  body.innerHTML = `<div class="dim">Loading...</div>`;
  const [data, sys] = await Promise.all([api(`/api/files?path=${encodeURIComponent(path)}`), api("/api/system", {timeoutMs:2000})]);
  if (data.error) { body.innerHTML = `<div class="dim">Error: ${data.error}</div>`; return; }
  const upDisabled = data.path === "" ? "disabled" : "";
  const mainDisk = (sys.disks||[]).find(d=>d.is_main) || (sys.disks||[])[0];
  const otherDisks = (sys.disks||[]).filter(d=>d!==mainDisk);
  body.innerHTML = `
    ${mainDisk ? `<div class="dim" style="margin-bottom:6px;">💾 ${mainDisk.device||mainDisk.mount} (System): ${mainDisk.free_gb ?? "?"} GB free of ${mainDisk.total_gb} GB${otherDisks.length ? " · " + otherDisks.map(d=>`${d.device||d.mount}${d.likely_external?" (External)":""}: ${d.free_gb ?? "?"} GB free`).join(" · ") : ""} <a href="#" id="open-sysmon-link">View all drives</a></div>` : ""}
    <div class="row" style="margin-bottom:8px;">
      <button class="btn" id="up-btn" ${upDisabled}>⬆ Up</button>
      <span class="dim">~/${data.path}</span>
    </div>
    <table><thead><tr><th>Name</th><th>Size</th><th>Modified</th></tr></thead>
    <tbody>${data.items.map(it => `
      <tr class="file-row" data-name="${escapeHtml(it.name)}" data-dir="${it.is_dir}" style="cursor:pointer;">
        <td>${it.is_dir ? "📁" : "📄"} ${escapeHtml(it.name)}</td>
        <td>${it.size != null ? (it.size/1024).toFixed(1) + " KB" : "-"}</td>
        <td class="dim">${new Date(it.modified).toLocaleDateString()}</td>
      </tr>`).join("")}</tbody></table>
  `;
  body.querySelector("#open-sysmon-link")?.addEventListener("click", (e) => { e.preventDefault(); openApp("sysmon"); });
  body.querySelectorAll(".file-row").forEach(row => {
    row.ondblclick = () => {
      const name=row.dataset.name||"";
      if(row.dataset.dir === "true"){const newPath=data.path?`${data.path}/${name}`:name;renderFilesApp(body,newPath);return;}
      const full=data.path?`${data.path}/${name}`:name; const ext=name.toLowerCase().split(".").pop();
      if(["bat","cmd","ps1","sh"].includes(ext)){openBatchRunner(full,name);return;}
      if(["html","htm"].includes(ext)){openApp("browser");return;}
      if(["txt","md","json","py","js","css"].includes(ext)){openApp("editor");return;}
    };
    row.onclick=()=>row.classList.toggle("file-row-selected");
  });
  body.querySelector("#up-btn").onclick = () => {
    const parts = data.path.split("/").filter(Boolean);
    parts.pop();
    renderFilesApp(body, parts.join("/"));
  };
}


// ================= APP: System Monitor =================
function renderSysMonApp(body) {
  body.innerHTML = `<div id="sysmon-content" class="stack"></div>`;
  const content = body.querySelector("#sysmon-content");
  async function tick() {
    if (!document.body.contains(body)) return; // window closed
    const sys = await api("/api/system");
    content.innerHTML = `
      <div><b>OS:</b> ${sys.os} ${sys.os_release} (${sys.arch})</div>
      <div><b>CPU:</b> ${sys.cpu_percent != null ? sys.cpu_percent + "%" : "n/a"} across ${sys.cpu_cores || "?"} cores</div>
      <div><b>RAM:</b> ${sys.ram_used_percent != null ? sys.ram_used_percent + "% used" : "n/a"} of ${sys.ram_total_gb ?? "?"} GB</div>
      <div><b>Network:</b> ${sys.online ? "Online" : "Offline"}</div>
      <div><b>Uptime:</b> ${Math.floor(sys.uptime_seconds)}s</div>
      <div><b>Storage / Drives:</b><ul>${(sys.disks||[]).map(d => {
        const label = d.is_main ? `${d.device || d.mount} (System)` : `${d.device || d.mount}${d.likely_external ? " (External / Removable)" : ""}`;
        return `<li><b>${label}</b> — ${d.used_percent}% used, ${d.free_gb ?? "?"} GB free of ${d.total_gb} GB${d.fstype ? " · " + d.fstype : ""}</li>`;
      }).join("") || "<li class=dim>No drives detected.</li>"}</ul></div>
    `;
    setTimeout(tick, 2000);
  }
  tick();
}

// ================= Windows Batch Runner =================
function openBatchRunner(path,name){
  const id="batch-runner"; if(openWindows[id]){focusWindow(openWindows[id]);return;}
  const win=document.createElement("div");win.className="win";win.style.left="80px";win.style.top="70px";win.style.width="760px";win.style.height="500px";
  win.innerHTML=`<div class="win-titlebar"><span class="win-title">🪟 Windows Batch Runner — ${escapeHtml(name)}</span><span class="win-controls"><button class="win-max">⛶</button><button class="win-close">✕</button></span></div><div class="win-body"><div class="note-card"><b>Batch file detected</b><div class="dim">${escapeHtml(path)}</div><div class="dim" style="margin-top:6px">A browser cannot execute a .BAT/.CMD file itself. On Windows, DeveloperHCR hands it to the local command processor in a separate console.</div></div><div class="row"><button class="btn primary" id="batch-run">▶ Run in Windows Terminal</button><button class="btn" id="batch-open-terminal">💻 Open DeveloperHCR Terminal</button></div><pre class="term-log" id="batch-log" style="margin-top:10px;min-height:180px;white-space:pre-wrap"></pre></div>`;
  document.getElementById("windows-layer").appendChild(win);openWindows[id]=win;focusWindow(win);
  win.querySelector(".win-close").onclick=()=>closeApp(id);win.querySelector(".win-max").onclick=()=>toggleMaximize(win);win.querySelector("#batch-open-terminal").onclick=()=>openApp("terminal");
  win.querySelector("#batch-run").onclick=async()=>{const log=win.querySelector("#batch-log");if(!confirm(`Run ${name} in the local Windows command processor?`))return;log.textContent="Starting…";const r=await api("/api/batch/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path,confirm:true})});log.textContent=r.ok?(r.output||"Batch file started in a new console."):(r.error||"Batch file could not be started.");};
}

// ================= APP: Terminal =================
const TERM_LOCAL_CMDS = ["help", "clear", "history", "whoami", "date", "ver", "dir", "bat"];
function renderTerminalApp(body) {
  body.innerHTML = `
    <div class="term-toolbar">
      <button class="btn" id="term-clear-btn" title="Clear screen">🧹 Clear</button>
      <button class="btn" id="term-help-btn" title="Show help">❓ Help</button>
      <span class="dim" style="font-size:.7rem;align-self:center;">↑/↓ = history · Tab = autocomplete</span>
    </div>
    <div style="position:relative;">
      <div class="term-log" id="term-log">DeveloperHCR safe-mode terminal. Type 'help' for system commands, '/help' for AI chat commands.\n</div>
      <div class="term-suggest" id="term-suggest"></div>
    </div>
    <div class="row"><input id="term-input" style="flex:1;" placeholder="type a command..." autocomplete="off"></div>
  `;
  const log = body.querySelector("#term-log");
  const input = body.querySelector("#term-input");
  const suggestBox = body.querySelector("#term-suggest");
  printLine(`Logged in as: ${currentUser?.username || "unknown"} · Role: ${currentUser?.role || "GUEST"}`);
  printLine(currentUser?.role === "ADMIN" ? "Admin console access: enabled for this account." : "Standard terminal access: safe commands only.");
  const historyKey = "hcr-term-history";
  let history = JSON.parse(localStorage.getItem(historyKey) || "[]");
  let histIdx = history.length;

  function printLine(text, cls) {
    const span = document.createElement("div");
    if (cls) span.className = cls;
    span.textContent = text;
    log.appendChild(span);
    log.scrollTop = log.scrollHeight;
  }

  async function runCommand(cmd) {
    printLine(`> ${cmd}`);
    if (cmd === "clear") { log.innerHTML = ""; return; }
    if (cmd === "history") { printLine(history.join("\n") || "(empty)"); return; }
    if (cmd === "help") {
      printLine("System commands run through the safe command layer (confirmation-gated for anything risky).");
      printLine("Type '/help' for AI chat commands. 'clear' clears this screen. 'history' shows past commands.");
      printLine("On Windows, double-click a .bat/.cmd in File Manager or use Batch Runner to launch it in a new console.");
      return;
    }
    broadcast("terminal-command", { command: cmd });
    try {
      const res = await api("/api/terminal/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: cmd })
      });
      printLine(res.output || "", res.error ? "term-err" : "term-ok");
    } catch (err) {
      printLine("Error: could not reach server.", "term-err");
    }
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      if (!input.value.trim()) return;
      const cmd = input.value.trim();
      history.push(cmd);
      if (history.length > 200) history.shift();
      localStorage.setItem(historyKey, JSON.stringify(history));
      histIdx = history.length;
      input.value = "";
      suggestBox.style.display = "none";
      await runCommand(cmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx > 0) { histIdx -= 1; input.value = history[histIdx] || ""; }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx < history.length) { histIdx += 1; input.value = history[histIdx] || ""; }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const partial = input.value.trim();
      if (!partial) return;
      const matches = TERM_LOCAL_CMDS.filter(c => c.startsWith(partial));
      if (matches.length === 1) { input.value = matches[0]; suggestBox.style.display = "none"; }
      else if (matches.length > 1) {
        suggestBox.innerHTML = matches.map(m => `<div>${m}</div>`).join("");
        suggestBox.style.display = "block";
      }
    } else {
      suggestBox.style.display = "none";
    }
  });

  body.querySelector("#term-clear-btn").onclick = () => { log.innerHTML = ""; };
  body.querySelector("#term-help-btn").onclick = () => runCommand("help");
}

// ================= APP: Clock / Timer / Alarm =================
function renderClockApp(body) {
  body.innerHTML = `
    <div class="stack">
      <div style="font-size:2rem;" id="clock-big">--:--:--</div>
      <hr style="border-color:var(--border); width:100%;">
      <div><b>Timer</b></div>
      <div class="row">
        <input id="timer-secs" type="number" placeholder="seconds" style="width:100px;">
        <button class="btn" id="timer-start">Start</button>
        <span id="timer-display" class="dim"></span>
      </div>
    </div>
  `;
  const big = body.querySelector("#clock-big");
  function tickClock() {
    if (!document.body.contains(body)) return;
    big.textContent = new Date().toLocaleTimeString();
    setTimeout(tickClock, 1000);
  }
  tickClock();

  let timerHandle = null;
  body.querySelector("#timer-start").onclick = () => {
    let remaining = parseInt(body.querySelector("#timer-secs").value || "0", 10);
    if (!remaining) return;
    if (timerHandle) clearInterval(timerHandle);
    const disp = body.querySelector("#timer-display");
    timerHandle = setInterval(() => {
      disp.textContent = `${remaining}s remaining`;
      remaining -= 1;
      if (remaining < 0) {
        clearInterval(timerHandle);
        disp.textContent = "Time's up!";
        if (Notification && Notification.permission === "granted") {
          new Notification("DeveloperHCR Timer", { body: "Time's up!" });
        }
      }
    }, 1000);
  };
  if (window.Notification && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ================= V2.0 BETA+: Utility apps =================
function renderUnitConverterApp(body){
  const units={length:{m:1,km:1000,cm:.01,mm:.001,ft:.3048,inch:.0254},weight:{kg:1,g:.001,lb:.453592},time:{sec:1,min:60,hour:3600,day:86400}};
  body.innerHTML=`<div class="stack"><h3>📏 Unit Converter</h3><div class="row"><select id="uc-type"><option value="length">Length</option><option value="weight">Weight</option><option value="time">Time</option></select><input id="uc-value" type="number" value="1" style="flex:1"></div><div class="row"><select id="uc-from"></select><span>→</span><select id="uc-to"></select></div><div id="uc-out" class="note-card"></div></div>`;
  const type=body.querySelector('#uc-type'),from=body.querySelector('#uc-from'),to=body.querySelector('#uc-to'),val=body.querySelector('#uc-value'),out=body.querySelector('#uc-out');
  function refreshUnits(){const names=Object.keys(units[type.value]);from.innerHTML=names.map(x=>`<option>${x}</option>`).join('');to.innerHTML=names.map(x=>`<option>${x}</option>`).join('');to.selectedIndex=Math.min(1,names.length-1);calc();}
  function calc(){const n=Number(val.value);const a=units[type.value][from.value],b=units[type.value][to.value];out.innerHTML=Number.isFinite(n)?`<b>${n} ${from.value} = ${(n*a/b).toLocaleString(undefined,{maximumFractionDigits:8})} ${to.value}</b>`:'Enter a number.';}
  type.onchange=refreshUnits;from.onchange=calc;to.onchange=calc;val.oninput=calc;refreshUnits();
}
function renderPasswordGeneratorApp(body){
  body.innerHTML=`<div class="stack"><h3>🔑 Password Generator</h3><div class="row"><label>Length <input id="pg-len" type="number" min="8" max="128" value="20" style="width:90px"></label><label><input id="pg-upper" type="checkbox" checked> A-Z</label><label><input id="pg-num" type="checkbox" checked> 0-9</label><label><input id="pg-symbol" type="checkbox" checked> Symbols</label></div><div class="row"><input id="pg-out" readonly style="flex:1"><button class="btn primary" id="pg-gen">Generate</button><button class="btn" id="pg-copy">Copy</button></div><div id="pg-status" class="dim">Generated locally; password is not sent to the server.</div></div>`;
  const out=body.querySelector('#pg-out'),status=body.querySelector('#pg-status');
  const gen=()=>{const len=Math.max(8,Math.min(128,Number(body.querySelector('#pg-len').value)||20));let chars='abcdefghijklmnopqrstuvwxyz';if(body.querySelector('#pg-upper').checked)chars+='ABCDEFGHIJKLMNOPQRSTUVWXYZ';if(body.querySelector('#pg-num').checked)chars+='0123456789';if(body.querySelector('#pg-symbol').checked)chars+='!@#$%^&*()-_=+[]{}';const a=new Uint32Array(len);crypto.getRandomValues(a);out.value=[...a].map(x=>chars[x%chars.length]).join('');status.textContent='Generated locally; password is not sent to the server.';};
  body.querySelector('#pg-gen').onclick=gen;body.querySelector('#pg-copy').onclick=async()=>{try{await navigator.clipboard.writeText(out.value);status.textContent='Copied to clipboard.';}catch(_){status.textContent='Clipboard permission unavailable; copy manually.';}};gen();
}
function renderMarkdownViewerApp(body){
  body.innerHTML=`<div class="stack"><h3>📝 Markdown Viewer</h3><textarea id="md-input" rows="10" placeholder="# DeveloperHCR\nWrite Markdown here..."></textarea><div class="note-card markdown-preview" id="md-preview"></div></div>`;
  const input=body.querySelector('#md-input'),preview=body.querySelector('#md-preview');
  function render(){let x=escapeHtml(input.value);x=x.replace(/^### (.*)$/gm,'<h4>$1</h4>').replace(/^## (.*)$/gm,'<h3>$1</h3>').replace(/^# (.*)$/gm,'<h2>$1</h2>').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');preview.innerHTML=x||'<span class="dim">Preview appears here.</span>';}
  input.oninput=render;render();
}
function renderPomodoroApp(body){
  body.innerHTML=`<div class="stack"><h3>🍅 Pomodoro Focus</h3><div class="price" id="pom-time">25:00</div><div class="row"><button class="btn primary" id="pom-start">Start</button><button class="btn" id="pom-pause">Pause</button><button class="btn" id="pom-reset">Reset</button></div><div id="pom-status" class="dim">Focus session · 25 minutes</div></div>`;
  let remaining=1500,timer=null;const t=body.querySelector('#pom-time'),status=body.querySelector('#pom-status');const draw=()=>t.textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;body.querySelector('#pom-start').onclick=()=>{if(timer)return;status.textContent='Focus timer running…';timer=setInterval(()=>{remaining=Math.max(0,remaining-1);draw();if(!remaining){clearInterval(timer);timer=null;status.textContent='Session complete!';playUISound('success');}},1000)};body.querySelector('#pom-pause').onclick=()=>{if(timer){clearInterval(timer);timer=null;status.textContent='Paused.';}};body.querySelector('#pom-reset').onclick=()=>{if(timer)clearInterval(timer);timer=null;remaining=1500;draw();status.textContent='Focus session · 25 minutes';};draw();
}
function renderJsonFormatterApp(body){
  body.innerHTML=`<div class="stack"><h3>🧾 JSON Formatter</h3><textarea id="jf-input" rows="10" placeholder='{"hello":"DeveloperHCR"}'></textarea><div class="row"><button class="btn primary" id="jf-format">Format</button><button class="btn" id="jf-minify">Minify</button></div><pre id="jf-output" class="term-log"></pre></div>`;
  const input=body.querySelector('#jf-input'),out=body.querySelector('#jf-output');const run=(space)=>{try{const v=JSON.parse(input.value);out.textContent=JSON.stringify(v,null,space);}catch(e){out.textContent='Invalid JSON: '+e.message;}};body.querySelector('#jf-format').onclick=()=>run(2);body.querySelector('#jf-minify').onclick=()=>run(0);
}

// ================= V2.0 BETA+: useful offline utility apps =================
function renderTextDiffApp(body){
  body.innerHTML=`<div class="stack"><h3>🧩 Text Diff</h3><div class="row"><button class="btn primary" id="diff-run">Compare</button><button class="btn" id="diff-clear">Clear</button></div><div class="grid-2" style="grid-template-columns:1fr 1fr"><div><b>Original</b><textarea id="diff-a" rows="12" style="width:100%"></textarea></div><div><b>Changed</b><textarea id="diff-b" rows="12" style="width:100%"></textarea></div></div><pre id="diff-out" class="term-log" style="white-space:pre-wrap"></pre></div>`;
  const a=body.querySelector('#diff-a'),b=body.querySelector('#diff-b'),out=body.querySelector('#diff-out');
  body.querySelector('#diff-run').onclick=()=>{const aa=a.value.split(/\r?\n/),bb=b.value.split(/\r?\n/),n=Math.max(aa.length,bb.length);let changed=0,lines=[];for(let i=0;i<n;i++){if(aa[i]===bb[i])lines.push(`  ${String(i+1).padStart(3)}  ${aa[i]??''}`);else{changed++;if(aa[i]!==undefined)lines.push(`- ${String(i+1).padStart(3)}  ${aa[i]}`);if(bb[i]!==undefined)lines.push(`+ ${String(i+1).padStart(3)}  ${bb[i]}`);}}out.textContent=`${changed} changed line(s)\n\n`+lines.join('\n');};
  body.querySelector('#diff-clear').onclick=()=>{a.value='';b.value='';out.textContent='';};
}
function renderTimestampApp(body){
  body.innerHTML=`<div class="stack"><h3>🕒 Timestamp Converter</h3><div class="row"><button class="btn primary" id="ts-now">Now</button><input id="ts-value" placeholder="Epoch milliseconds or ISO date" style="flex:1"></div><div class="note-card" id="ts-out"></div><div class="dim">Supports epoch seconds, milliseconds and ISO dates.</div></div>`;
  const v=body.querySelector('#ts-value'),o=body.querySelector('#ts-out');const run=()=>{const x=v.value.trim();let d;if(!x)d=new Date();else if(/^\d{10}$/.test(x))d=new Date(Number(x)*1000);else if(/^\d{13}$/.test(x))d=new Date(Number(x));else d=new Date(x);if(Number.isNaN(d.getTime())){o.textContent='Invalid timestamp/date.';return;}o.innerHTML=`<b>ISO:</b> ${escapeHtml(d.toISOString())}<br><b>Epoch seconds:</b> ${Math.floor(d.getTime()/1000)}<br><b>Epoch milliseconds:</b> ${d.getTime()}<br><b>Local:</b> ${escapeHtml(d.toLocaleString())}`;};
  body.querySelector('#ts-now').onclick=()=>{v.value=String(Date.now());run();};v.oninput=run;run();
}
async function renderDiagnosticsApp(body){
  body.innerHTML=`<div class="stack"><div class="cp-header"><div><h3>🧪 System Diagnostics</h3><div class="dim">Read-only browser, storage, viewport and server diagnostics.</div></div><button class="btn primary" id="diag-run">Run Diagnostics</button></div><div id="diag-out" class="stack"><div class="dim">Ready.</div></div></div>`;
  const out=body.querySelector('#diag-out');const run=async()=>{out.innerHTML='<div class="dim">Running diagnostics…</div>';const r=await api('/api/app-health',{timeoutMs:10000});let storage='OK';try{localStorage.setItem('__hcr_diag','1');localStorage.removeItem('__hcr_diag')}catch(_){storage='Unavailable';}const rows=[['Browser',navigator.userAgent],['Viewport',`${innerWidth} × ${innerHeight}`],['Online',navigator.onLine?'YES':'NO'],['Local storage',storage],['Server health',r.error?'Unavailable':`${r.healthy}/${r.total} checks healthy`]];out.innerHTML=rows.map(x=>`<div class="note-card"><b>${escapeHtml(x[0])}</b><div class="dim">${escapeHtml(String(x[1]))}</div></div>`).join('');};body.querySelector('#diag-run').onclick=run;run();
}
async function renderFileHashApp(body){
  body.innerHTML=`<div class="stack"><h3>#️⃣ File Hash Checker</h3><input id="fh-file" type="file"><div class="note-card" id="fh-out">Choose a file to calculate SHA-256 locally.</div></div>`;
  body.querySelector('#fh-file').onchange=async e=>{const f=e.target.files?.[0],o=body.querySelector('#fh-out');if(!f)return;o.textContent='Calculating…';try{const b=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());const h=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');o.innerHTML=`<b>${escapeHtml(f.name)}</b><div class="dim">${f.size.toLocaleString()} bytes</div><code style="word-break:break-all">${h}</code>`;}catch(err){o.textContent='Hash failed: '+(err?.message||err);}};
}
function renderContrastCheckerApp(body){
  body.innerHTML=`<div class="stack"><h3>◐ Contrast Checker</h3><div class="row"><label>Text <input id="cc-fg" type="color" value="#ffffff"></label><label>Background <input id="cc-bg" type="color" value="#171a21"></label></div><div id="cc-preview" class="note-card" style="padding:24px;font-size:1.2rem">DeveloperHCR readable text</div><div id="cc-out" class="note-card"></div></div>`;
  const fg=body.querySelector('#cc-fg'),bg=body.querySelector('#cc-bg'),p=body.querySelector('#cc-preview'),o=body.querySelector('#cc-out');const lum=h=>{const a=h.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4));return .2126*a[0]+.7152*a[1]+.0722*a[2]};const run=()=>{p.style.color=fg.value;p.style.background=bg.value;const a=lum(fg.value.slice(1)),b=lum(bg.value.slice(1)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);o.innerHTML=`<b>Contrast ratio: ${ratio.toFixed(2)}:1</b><div class="dim">${ratio>=7?'AAA normal text · excellent':ratio>=4.5?'AA normal text · good':ratio>=3?'AA large text only':'Low contrast · consider stronger colors'}</div>`};[fg,bg].forEach(x=>x.oninput=run);run();
}

// ================= APP: Settings (v1.0 — organized into tabs) =================
const FEATURE_CATALOG=["notes","calculator","files","system_monitor","terminal","clock","browser","control_panel","ai_models","basic_ai","jarvis","store","games","feedback","access","updates","exe","editor","imageviewer","pdfviewer","media","calendar","clipboard","network","processes","security","help","friends_trading"];
const SETTINGS_TABS = [
  { id: "general",    label: "🎨 General"  },
  { id: "account",    label: "👤 Account"  },
  { id: "desktop",    label: "🖥️ Desktop"  },
  { id: "display",    label: "📐 Display"  },
  { id: "assistant",  label: "🧠 Assistant" },
  { id: "ai",         label: "🤖 AI"        },
  { id: "voice",      label: "🎙️ Voice"     },
  { id: "access",     label: "👥 Access"    },
  { id: "friendsfeatures", label: "🔑 Friends Only Features" },
  { id: "store",      label: "🛍️ Store"     },
  { id: "updates",    label: "🔄 Updates"   },
  { id: "support",    label: "🆘 Support"   },
  { id: "security",   label: "🔐 Security"  },
  { id: "data",       label: "💾 Data & Sync" },
  { id: "subscription", label: "💳 Subscription" },
  { id: "sound",     label: "🔊 Sounds" },
  { id: "system",     label: "🖥️ System"    },
  { id: "about",      label: "ℹ️ About"     },
];
async function renderSettingsApp(body) {
  const settings = await api("/api/settings");
  body.innerHTML = `
    <div class="settings-shell">
      <div class="settings-tabs">
        ${SETTINGS_TABS.map((t,i) => `<button data-tab="${t.id}" class="${i===0?'active':''}">${t.label}</button>`).join("")}
      </div>
      <div class="settings-panel">

        <div class="pane active" data-pane="general">
          <div><b>Theme</b></div>
          <div class="row">
            <button class="btn" id="theme-dark">🌙 Dark</button>
            <button class="btn" id="theme-light">☀️ Light</button>
          </div>
          <div class="dim" style="margin-top:6px;">A quick theme toggle is also on the taskbar (🌓).</div>
        </div>

        <div class="pane" data-pane="account">
          <div><b>Account & Login</b></div>
          <div class="dim">Change your username or password. Passwords are stored as salted hashes. Username matching is case-insensitive and duplicates are blocked.</div>
          <div class="note-card"><b>Current user</b><div id="account-current-username" class="dim"></div><div class="dim">Role: ${escapeHtml(currentUser?.role || "UNKNOWN")}</div></div>
          <div class="row"><label style="min-width:130px">New username</label><input id="account-new-username" autocomplete="username" style="flex:1"></div>
          <div class="row"><label style="min-width:130px">Current password</label><input id="account-current-password" type="password" autocomplete="current-password" style="flex:1"></div>
          <div class="row"><label style="min-width:130px">New password</label><input id="account-new-password" type="password" autocomplete="new-password" style="flex:1" placeholder="Leave blank to keep password"></div>
          <button class="btn" id="account-save">Save Account Changes</button>
          <div id="account-status" class="dim"></div>
          <hr>
          <div><b>Session</b></div>
          <div class="row"><button class="btn" id="account-logout">Log Out</button><button class="btn" id="account-fullscreen">⛶ Full Screen</button></div>
        </div>

        <div class="pane" data-pane="desktop">
          <div><b>Layout &amp; Interaction</b></div>
          <div class="row settings-row"><label>Desktop orientation</label><select id="desktop-orientation"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></div>
          <div class="row settings-row"><label>Force landscape on phones</label><input id="force-landscape" type="checkbox"></div>
          <div class="dim" style="font-size:.72rem;">Choose the DeveloperHCR workspace layout. Android and PC support both modes.</div>
          <div class="row settings-row"><label>Show desktop icons</label><input id="show-desktop-icons" type="checkbox"></div>
          <div class="row settings-row"><label>Desktop icon size</label><select id="desktop-icon-size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
          <div class="row settings-row"><label>Desktop app limit</label><select id="desktop-app-limit"><option value="unlimited">Unlimited</option><option value="10">10 apps</option></select></div>
          <div class="row settings-row"><label>After adding app, return to Desktop</label><input id="auto-home-after-pin" type="checkbox"></div>
          <div class="row settings-row"><label>Show taskbar in Full Screen</label><input id="show-taskbar-fullscreen" type="checkbox"></div>
          <div class="row settings-row"><label>Desktop cleanup</label><button class="btn" id="settings-clear-desktop">🧹 Clear all desktop apps</button></div>
          <div class="row settings-row"><label>Windows-style native cursor</label><input id="custom-cursor-toggle" type="checkbox" checked disabled></div>
          <div class="dim" style="font-size:.72rem;">A round dot cursor that turns into a text-beam over text fields. Off automatically on touch screens.</div>
          <div class="row settings-row"><label>UI zoom</label>
            <div class="row"><button class="tbtn" id="settings-zoom-out" type="button">−</button><span id="settings-zoom-label">100%</span><button class="tbtn" id="settings-zoom-in" type="button">+</button><button class="tbtn" id="settings-zoom-reset" type="button">100</button></div>
          </div>
          <div class="row settings-row"><label>Screen size</label>
            <select id="screen-size">
              <option value="0.85">Small · 85%</option>
              <option value="1">Standard · 100%</option>
              <option value="1.1">Large · 110%</option>
              <option value="1.2">Extra large · 120%</option>
            </select>
          </div>
          <div class="row settings-row"><label>Display mode</label><select id="display-mode"><option value="windowed">Windowed</option><option value="fullscreen">Full screen</option></select></div>
          <div class="row settings-row"><label>Taskbar</label><select id="taskbar-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
          <div class="dim" style="font-size:.72rem;">Screen size changes the complete DeveloperHCR interface without changing the device's physical resolution.</div>
          <button class="btn" id="desktop-settings-save">Save Desktop Settings</button>
          <div id="desktop-settings-status" class="dim"></div>
        </div>

        <div class="pane" data-pane="display">
          <div><b>Display &amp; Screen Size</b></div>
          <div class="row settings-row"><label>Screen size</label><select id="display-screen-size"><option value="0.85">Small · 85%</option><option value="1">Standard · 100%</option><option value="1.1">Large · 110%</option><option value="1.2">Extra large · 120%</option></select></div>
          <div class="row settings-row"><label>Fullscreen</label><button class="btn" id="display-fullscreen">⛶ Toggle Fullscreen</button></div>
          <div class="row settings-row"><label>Taskbar density</label><select id="display-taskbar-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
          <div class="row settings-row"><label>Animations</label><select id="display-animations"><option value="full">Full</option><option value="reduced">Reduced</option><option value="off">Off</option></select></div>
          <div class="row settings-row"><label>UI contrast</label><select id="display-contrast"><option value="normal">Normal</option><option value="high">High</option></select></div>
          <button class="btn" id="display-save">Save Display Settings</button><div id="display-status" class="dim"></div>
        </div>

        <div class="pane" data-pane="assistant">
          <div><b>HCR AI Agent</b></div>
          <div class="row settings-row"><label>Assistant name</label><input id="assistant-name" style="flex:1;" placeholder="HCR AI Agent"></div>
          <div class="row settings-row"><label>Logo click action</label><select id="logo-click-action"><option value="launcher">Open App Menu</option><option value="hcr">Open HCR AI Agent</option><option value="desktop">Show Desktop</option></select></div>
          <div class="row settings-row"><label>HCR keyboard shortcut</label><input id="hcr-shortcut" placeholder="Alt+Space" style="flex:1;"><button class="btn" id="hcr-shortcut-test">Test</button></div>
          <div class="dim">Example: Alt+Space, Ctrl+Shift+H, or Meta+Space. The shortcut is local to DeveloperHCR.</div>
          <div class="row settings-row"><label>Auto-run safe voice</label><input id="auto-safe-voice" type="checkbox"></div>
          <div class="row settings-row"><label>Persistent action log</label><input id="persistent-log" type="checkbox"></div>
          <div class="row settings-row"><label>Local training capture</label><input id="training-capture" type="checkbox"></div>
          <div class="row settings-row"><label>Capture quality</label><select id="capture-quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div class="row settings-row"><label>Capture size</label><select id="capture-size"><option value="full">Full screen</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="window">Active window</option></select></div>
          <div class="row settings-row"><label>Assistant animations</label><input id="assistant-animation" type="checkbox"></div>
          <button class="btn" id="assistant-settings-save">Save Assistant Settings</button>
          <div id="assistant-settings-status" class="dim"></div>
        </div>

        <div class="pane" data-pane="ai">
          <div><b>AI Settings</b> <span class="dim">(global for all users on this device for now)</span></div>
          <div class="row settings-row"><label>Default provider</label>
            <select id="ai-provider">
              <option value="ollama">Ollama</option>
              <option value="gguf">GGUF (llama.cpp)</option>
            </select>
          </div>
          <div class="row settings-row"><label>Default model</label>
            <input id="ai-model" placeholder="e.g. llama3" style="flex:1;"></div>
          <div class="row settings-row"><label>Temperature</label>
            <input id="ai-temp" type="number" step="0.1" min="0" max="2" style="width:80px;"></div>
          <div class="row settings-row"><label>Context length</label>
            <input id="ai-ctx" type="number" style="width:100px;"></div>
          <div class="row settings-row"><label>Max history msgs</label>
            <input id="ai-maxhist" type="number" style="width:80px;"></div>
          <div class="row settings-row"><label>Generation timeout (s)</label>
            <input id="ai-timeout" type="number" style="width:80px;"></div>
          <div class="row settings-row"><label>Streaming</label>
            <input id="ai-streaming" type="checkbox"></div>
          <div><label>System prompt</label></div>
          <textarea id="ai-sysprompt" rows="3" style="width:100%;"></textarea>
          <button class="btn" id="ai-settings-save">Save AI Settings</button>
          <div id="ai-settings-status" class="dim"></div>
        </div>

        <div class="pane" data-pane="voice">
          <div><b>Voice Model</b></div>
          <div class="voice-model-card" id="voice-model-card">Loading...</div>
        </div>

        <div class="pane" data-pane="access">
          <div><b>Friends Only / Subscription</b></div>
          <div class="row settings-row"><label>Enable Friends Only</label><input id="friends-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>Enable Subscription</label><input id="subscription-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>EXE/Wine support</label><input id="exe-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>Access mode</label><select id="access-mode"><option value="friends_or_subscription">Friends OR Subscription</option><option value="friends_only">Friends Only</option><option value="subscription_only">Subscription Only</option></select></div>
          <button class="btn" id="access-save">Save Access Settings</button><div id="access-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="friendsfeatures">
          <div><b>Friends Only Features</b></div>
          <div class="dim">Only ADMIN can add/change these named profiles. Passwords are stored as salted hashes. To change an existing profile's password, delete it and add it again with the new password.</div>
          <div id="friend-profiles-panel"></div>
          <div id="friend-profile-editor"></div>
          <div style="margin-top:14px"><b>Subscribers Only password</b></div>
          <div class="dim">Passwords are one-way hashes and can never be looked up again once set — if it's forgotten, set a new one here.</div>
          <div class="row settings-row"><input id="subscriber-guest-password" type="password" placeholder="New Subscribers Only password (4+ characters)"><button class="btn" id="subscriber-guest-password-save">Set Password</button></div>
          <div id="subscriber-guest-password-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="store">
          <div><b>HCR Store</b></div>
          <div class="row settings-row"><label>Store enabled</label><input id="store-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>Remote catalog URL (HTTPS)</label><input id="store-index-url" style="flex:1" placeholder="https://.../store.json"></div>
          <button class="btn" id="store-settings-save">Save Store Settings</button><div id="store-settings-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="updates">
          <div><b>Update Channel</b></div>
          <div class="row settings-row"><label>Updates enabled</label><input id="update-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>GitHub account</label><input id="update-owner"></div>
          <div class="row settings-row"><label>GitHub repository</label><input id="update-repo"></div>
          <div class="row settings-row"><label>Channel</label><select id="update-channel"><option>stable</option><option>beta</option></select></div>
          <button class="btn" id="update-settings-save">Save Update Settings</button>
          <button class="btn" id="update-check-settings">Check Now</button><div id="update-settings-status" class="dim"></div>
          <div class="note-card" id="owner-update-announcement-box">
            <b>Admin Update Message</b>
            <div class="dim">Only ADMIN can publish the optional update message shown to users.</div>
            <input id="update-ann-title" placeholder="Update title" style="width:100%;margin:5px 0">
            <textarea id="update-ann-message" rows="4" placeholder="Write what changed..."></textarea>
            <div class="row"><button class="btn" id="update-ann-send">Publish Message</button><button class="btn" id="update-ann-clear">Remove Message</button></div>
            <div id="update-ann-status" class="dim"></div>
          </div>
        </div>
        <div class="pane" data-pane="support">
          <div><b>Feedback & Support</b></div>
          <div class="dim">24×7 support for bugs, suggestions, UI issues, AI issues, performance and security reports. Reports are stored locally for Admin review.</div>
          <div class="note-card support-contact-card">
            <b>DeveloperHCR Support Team</b>
            <div class="dim">Official support contacts — fixed in this release. Admin credentials and Admin configuration are not changed by support settings.</div>
            <div class="row support-contact-row"><span>📧 Email</span><a href="mailto:developerhcr@gmail.com">developerhcr@gmail.com</a></div>
            <div class="row support-contact-row"><span>📸 Instagram</span><a href="https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw" target="_blank" rel="noopener">@developerhcr — Support Team</a></div>
            <div class="row support-contact-row"><span>📦 GitHub</span><a href="https://github.com/DevevoperHCR/HCRAPP" target="_blank" rel="noopener">DeveloperHCR/HCRAPP</a></div>
            <div class="dim">No WhatsApp support is included in v2.0 BETA.</div>
          </div>
          <button class="btn primary" id="support-save">Save Support Preferences</button><div id="support-status" class="dim">Official support contacts are fixed; your feedback preferences are local.</div>
        </div>
        <div class="pane" data-pane="security">
          <div><b>Security & Privacy</b></div>
          <div class="dim">Private mode hides personal content from Admin/Admin dashboards. E2EE is only claimed when an actual encryption/key-management backend is configured.</div>
          <div class="row"><select id="settings-privacy"><option value="standard">Standard</option><option value="private">Private</option></select><input id="settings-pin" type="password" inputmode="numeric" placeholder="Optional quick PIN"><label><input id="settings-quick" type="checkbox"> Quick Unlock</label><button class="btn" id="settings-security-save">Save</button></div><div id="settings-security-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="data">
          <div><b>Data, Local Storage & Optional Admin Sync</b></div>
          <div class="dim">Local-first is the default. Optional Admin Sync requires the user agreement and never accepts passwords, tokens, private chats, search history or file contents.</div>
          <div class="row settings-row"><label>Admin sync enabled</label><input id="admin-sync-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>Admin HTTPS sync endpoint</label><input id="admin-sync-endpoint" style="flex:1" placeholder="https://your-server.example/sync"></div>
          <div class="row settings-row"><label>Include diagnostics</label><input id="admin-sync-diagnostics" type="checkbox"></div>
          <button class="btn" id="admin-sync-save">Save Data Sync Settings</button><div id="admin-sync-status" class="dim"></div>
          <div class="note-card"><b>Privacy rule</b><div class="dim">The app does not silently upload user data. A user must opt in. Private / E2EE mode blocks Admin Sync.</div></div>
        </div>
        <div class="pane" data-pane="subscription">
          <div><b>Subscription Plans</b></div>
          <div id="settings-plans"></div>
          <div id="owner-plan-editor" class="stack"></div>
          <div class="dim">Admin can set the price, name and feature list for every plan. Payment remains unverified until a real payment provider is connected.</div>
        </div>
        <div class="pane" data-pane="startup">
          <div><b>Startup</b></div>
          <div class="row settings-row"><label>Fast startup check</label><input id="startup-fast-check" type="checkbox" checked></div>
          <div class="row settings-row"><label>Remember last desktop layout</label><input id="startup-remember-layout" type="checkbox" checked></div>
          <div class="row settings-row"><label>Boot sound</label><input id="startup-boot-sound" type="checkbox" checked></div>
          <button class="btn" id="startup-save">Save Startup Preferences</button>
          <button class="btn" id="startup-reset">Reset Startup Preferences</button>
          <div id="startup-status" class="dim"></div>
          <div class="dim">Startup verification stays short; full diagnostics are available in Troubleshooting and never block login.</div>
        </div>
        <div class="pane" data-pane="storage">
          <div><b>Local Storage</b></div>
          <div class="note-card"><b>Browser storage estimate</b><div id="storage-estimate" class="dim">Calculating…</div></div>
          <div class="row"><button class="btn" id="storage-refresh">Refresh</button><button class="btn" id="storage-export">Export UI Preferences</button><button class="btn" id="storage-clear-layout">Clear Desktop Layout</button></div>
          <div class="dim">Clearing browser storage may remove local preferences. Server-side account data remains in the local DeveloperHCR database.</div>
        </div>
        <div class="pane" data-pane="performance">
          <div><b>Performance</b></div>
          <div class="row"><button class="btn" id="perf-refresh">Refresh System Stats</button><button class="btn" id="perf-open-monitor">Open System Monitor</button></div>
          <div id="perf-stats" class="control-grid"></div>
          <div class="dim">Use lower AI context/history and medium capture quality on low-memory devices for faster responses.</div>
        </div>
        <div class="pane" data-pane="system">
          <div><b>System / Server</b></div><div class="dim">Local server, CPU/RAM/storage, battery, platform, browser and optional runtime capabilities are detected at runtime.</div><button class="btn" id="open-control-panel">Open Control Panel</button><button class="btn" id="open-troubleshooting">Run Troubleshooting</button>
        </div>
        <div class="pane" data-pane="sound">
          <div><b>Sounds & Notifications</b></div>
          <div class="row settings-row"><label>App / boot sounds</label><input id="sound-enabled" type="checkbox"></div>
          <div class="row settings-row"><label>Sound volume</label><input id="sound-volume" type="range" min="0" max="1" step="0.05"></div>
          <div class="dim">Sounds play on boot, login, app open and important UI actions. You can disable them at any time.</div>
          <button class="btn" id="sound-test">Test Sound</button><button class="btn" id="sound-save">Save Sound Settings</button><div id="sound-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="notifications">
          <div><b>Notifications</b></div>
          <div class="row settings-row"><label>Desktop notifications</label><input id="notify-desktop" type="checkbox"></div>
          <div class="row settings-row"><label>Update alerts</label><input id="notify-updates" type="checkbox" checked></div>
          <div class="row settings-row"><label>Sound on important alerts</label><input id="notify-sound" type="checkbox" checked></div>
          <button class="btn" id="notify-save">Save Notification Settings</button><div id="notify-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="accessibility">
          <div><b>Accessibility</b></div>
          <div class="row settings-row"><label>Large UI text</label><input id="a11y-large" type="checkbox"></div>
          <div class="row settings-row"><label>Reduce animations</label><input id="a11y-reduce" type="checkbox"></div>
          <div class="row settings-row"><label>High contrast borders</label><input id="a11y-contrast" type="checkbox"></div>
          <button class="btn" id="a11y-save">Save Accessibility</button><div id="a11y-status" class="dim"></div>
        </div>
        <div class="pane" data-pane="workspace">
          <div><b>Workspace Tools</b></div>
          <div class="row"><button class="btn" id="workspace-add-notes">Open Notes</button><button class="btn" id="workspace-open-browser">Open Browser</button><button class="btn" id="workspace-open-terminal">Open Terminal</button></div>
          <div class="row"><button class="btn" id="workspace-install-store">Open HCR Store</button><button class="btn" id="workspace-games">Open Games</button><button class="btn" id="workspace-ai">Open HCR AI Agent</button></div>
          <div class="dim">These are quick actions for the tools most often used in DeveloperHCR.</div>
        </div>
        <div class="pane" data-pane="environment"><div><b>🧰 Environment & Developer Setup</b></div><div class="dim">Open Environment Setup to detect/install Python, C/C++, Node.js, Rust, Go, Java, Git, Make, cURL, Wget, OpenSSH and other supported tools. Installations use the OS package manager when available.</div><div class="row"><button class="btn" id="settings-open-env">Open Environment Setup</button><button class="btn" id="settings-open-exe">Open EXE / Wine</button><button class="btn" id="settings-open-repo">Open DevApps Repository</button></div><div id="settings-env-status" class="dim"></div></div>
        <div class="pane" data-pane="network"><div><b>🌐 Network</b></div><div class="row"><button class="btn" id="network-check-now">Check Internet</button><button class="btn" id="network-open-browser">Open Browser</button></div><div id="network-status-detail" class="dim">Network state is checked only when requested or by the status indicator.</div><div class="note-card"><b>Internet usage</b><div class="dim">Browser, model downloads, toolchain installation, Wine installation and updates may use the internet. HCR does not silently download packages.</div></div></div>
        <div class="pane" data-pane="privacy"><div><b>🛡️ Privacy & Data</b></div><div class="row settings-row"><label>Private mode</label><input id="privacy-private" type="checkbox"></div><div class="row settings-row"><label>Allow optional diagnostics</label><input id="privacy-diagnostics" type="checkbox"></div><button class="btn" id="privacy-save">Save Privacy Settings</button><div id="privacy-status" class="dim"></div><div class="dim">Private mode prevents optional Admin Sync. Secrets and private content are not intentionally uploaded by the local sync feature.</div></div>
        <div class="pane" data-pane="power"><div><b>🔋 Power & Performance</b></div><div class="row settings-row"><label>Performance mode</label><select id="power-mode"><option value="balanced">Balanced</option><option value="performance">Performance</option><option value="battery">Battery Saver</option></select></div><div class="row settings-row"><label>Reduce background polling</label><input id="power-polling" type="checkbox"></div><button class="btn" id="power-save">Save Power Settings</button><div id="power-status" class="dim"></div></div>

        <div class="pane" data-pane="about">
          <div class="dim">DeveloperHCR v1.0 settings are modular. Future settings can be added without replacing existing features.</div>
        </div>

      </div>
    </div>
  `;

  // ---- extra settings ----
  // ---- display / screen-size settings ----
  const screenSize = localStorage.getItem("hcr-screen-size") || "1";
  const autoHome = body.querySelector('#auto-home-after-pin'); if(autoHome) autoHome.checked = autoReturnHomeAfterPin();
  const showFsTaskbar = body.querySelector('#show-taskbar-fullscreen'); if(showFsTaskbar) showFsTaskbar.checked = localStorage.getItem('hcr-show-taskbar-fullscreen') !== '0';
  body.querySelector('#settings-clear-desktop')?.addEventListener('click',()=>clearAllDesktopShortcuts());
  const taskbarDensity = localStorage.getItem("hcr-taskbar-density") || "comfortable";
  const animMode = localStorage.getItem("hcr-animation-mode") || "full";
  const contrastMode = localStorage.getItem("hcr-contrast-mode") || "normal";
  ["#screen-size","#display-screen-size"].forEach(sel=>{const el=body.querySelector(sel); if(el) el.value=screenSize;});
  const dl=body.querySelector('#desktop-app-limit'); if(dl) dl.value=localStorage.getItem('hcr-desktop-app-limit')||'10';
  ["#taskbar-density","#display-taskbar-density"].forEach(sel=>{const el=body.querySelector(sel); if(el) el.value=taskbarDensity;});
  const da=body.querySelector('#display-animations'), dc=body.querySelector('#display-contrast'); if(da)da.value=animMode;if(dc)dc.value=contrastMode;
  function applyScreenSize(v){const z=Math.max(.75,Math.min(1.3,Number(v)||1));document.documentElement.style.setProperty('--ui-zoom',z);localStorage.setItem('hcr-screen-size',String(z));}
  function applyDisplayPrefs(){const td=localStorage.getItem('hcr-taskbar-density')||'comfortable';document.body.classList.toggle('taskbar-compact',td==='compact');const am=localStorage.getItem('hcr-animation-mode')||'full';document.body.classList.toggle('reduce-motion',am!=='full');document.body.classList.toggle('no-motion',am==='off');document.body.classList.toggle('a11y-contrast',localStorage.getItem('hcr-contrast-mode')==='high');}
  applyScreenSize(screenSize); applyDisplayPrefs();
  const ss1=body.querySelector('#screen-size'), td1=body.querySelector('#taskbar-density'); ss1?.addEventListener('change',()=>applyScreenSize(ss1.value)); td1?.addEventListener('change',()=>{localStorage.setItem('hcr-taskbar-density',td1.value);applyDisplayPrefs();});
  body.querySelector('#display-save')?.addEventListener('click',()=>{const ds=body.querySelector('#display-screen-size'),dt=body.querySelector('#display-taskbar-density'),da2=body.querySelector('#display-animations'),dc2=body.querySelector('#display-contrast');applyScreenSize(ds?.value||'1');localStorage.setItem('hcr-taskbar-density',dt?.value||'comfortable');localStorage.setItem('hcr-animation-mode',da2?.value||'full');localStorage.setItem('hcr-contrast-mode',dc2?.value||'normal');applyDisplayPrefs();body.querySelector('#display-status').textContent='Display settings saved.';});
  body.querySelector('#display-fullscreen')?.addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>{});});

  const notify={desktop:localStorage.getItem("hcr-notify-desktop")==="1",updates:localStorage.getItem("hcr-notify-updates")!=="0",sound:localStorage.getItem("hcr-notify-sound")!=="0"};
  const nd=body.querySelector("#notify-desktop"),nu=body.querySelector("#notify-updates"),ns=body.querySelector("#notify-sound"); if(nd)nd.checked=notify.desktop;if(nu)nu.checked=notify.updates;if(ns)ns.checked=notify.sound;
  body.querySelector("#notify-save")?.addEventListener("click",()=>{localStorage.setItem("hcr-notify-desktop",nd.checked?"1":"0");localStorage.setItem("hcr-notify-updates",nu.checked?"1":"0");localStorage.setItem("hcr-notify-sound",ns.checked?"1":"0");body.querySelector("#notify-status").textContent="Notification settings saved.";});
  const a11y={large:localStorage.getItem("hcr-a11y-large")==="1",reduce:localStorage.getItem("hcr-a11y-reduce")==="1",contrast:localStorage.getItem("hcr-a11y-contrast")==="1"};
  const al=body.querySelector("#a11y-large"),ar=body.querySelector("#a11y-reduce"),ac=body.querySelector("#a11y-contrast"); if(al)al.checked=a11y.large;if(ar)ar.checked=a11y.reduce;if(ac)ac.checked=a11y.contrast;
  body.querySelector("#a11y-save")?.addEventListener("click",()=>{document.body.classList.toggle("a11y-large",al.checked);document.body.classList.toggle("reduce-motion",ar.checked);document.body.classList.toggle("a11y-contrast",ac.checked);localStorage.setItem("hcr-a11y-large",al.checked?"1":"0");localStorage.setItem("hcr-a11y-reduce",ar.checked?"1":"0");localStorage.setItem("hcr-a11y-contrast",ac.checked?"1":"0");body.querySelector("#a11y-status").textContent="Accessibility settings saved.";});
  body.querySelector("#workspace-add-notes")?.addEventListener("click",()=>openApp("notes"));body.querySelector("#workspace-open-browser")?.addEventListener("click",()=>openApp("browser"));body.querySelector("#workspace-open-terminal")?.addEventListener("click",()=>openApp("terminal"));body.querySelector("#workspace-install-store")?.addEventListener("click",()=>openApp("store"));body.querySelector("#workspace-games")?.addEventListener("click",()=>openApp("games"));body.querySelector("#workspace-ai")?.addEventListener("click",()=>openApp("jarvis"));
  body.querySelector('#settings-open-env')?.addEventListener('click',()=>openApp('environment')); body.querySelector('#settings-open-exe')?.addEventListener('click',()=>openApp('exe')); body.querySelector('#settings-open-repo')?.addEventListener('click',()=>openApp('repo'));
  body.querySelector('#network-check-now')?.addEventListener('click',async()=>{const x=await api('/api/system');body.querySelector('#network-status-detail').textContent=x.online?'Internet: Online':'Internet: Offline';}); body.querySelector('#network-open-browser')?.addEventListener('click',()=>openApp('browser'));
  const pv=body.querySelector('#privacy-private'),pd=body.querySelector('#privacy-diagnostics'); if(pv)pv.checked=localStorage.getItem('hcr-private-mode')==='1'; if(pd)pd.checked=localStorage.getItem('hcr-allow-diagnostics')==='1'; body.querySelector('#privacy-save')?.addEventListener('click',()=>{localStorage.setItem('hcr-private-mode',pv.checked?'1':'0');localStorage.setItem('hcr-allow-diagnostics',pd.checked?'1':'0');body.querySelector('#privacy-status').textContent='Privacy settings saved.';});
  const pm=body.querySelector('#power-mode'),pp=body.querySelector('#power-polling'); if(pm)pm.value=localStorage.getItem('hcr-power-mode')||'balanced'; if(pp)pp.checked=localStorage.getItem('hcr-power-polling')==='1'; body.querySelector('#power-save')?.addEventListener('click',()=>{localStorage.setItem('hcr-power-mode',pm.value);localStorage.setItem('hcr-power-polling',pp.checked?'1':'0');body.querySelector('#power-status').textContent='Power settings saved.';});

  // ---- tab switching ----
  body.querySelectorAll(".settings-tabs button").forEach(btn => {
    btn.onclick = () => {
      body.querySelectorAll(".settings-tabs button").forEach(b => b.classList.remove("active"));
      body.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
      const target = body.querySelector(`.pane[data-pane="${btn.dataset.tab}"]`);
      if (!target) return;
      btn.classList.add("active");
      target.classList.add("active");
    };
  });

  // ---- Account / credentials wiring ----
  const acctCurrent = body.querySelector("#account-current-username");
  const acctNew = body.querySelector("#account-new-username");
  if (acctCurrent) { acctCurrent.textContent = currentUser?.username || ""; if (acctCurrent.tagName === "INPUT") acctCurrent.value = currentUser?.username || ""; }
  if (acctNew) acctNew.value = currentUser?.username || "";
  body.querySelector("#account-save").onclick = async () => {
    const status = body.querySelector("#account-status");
    const currentPassword = body.querySelector("#account-current-password").value;
    const newUsername = body.querySelector("#account-new-username").value.trim();
    const newPassword = body.querySelector("#account-new-password").value;
    if (!currentPassword) { status.textContent = "Enter your current password first."; return; }
    const r = await api("/api/account/credentials", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({current_password:currentPassword,new_username:newUsername,new_password:newPassword})});
    if (r.error) { status.textContent = r.error; return; }
    currentUser = r.user;
    acctCurrent.value = currentUser.username;
    acctNew.value = currentUser.username;
    body.querySelector("#account-current-password").value = "";
    body.querySelector("#account-new-password").value = "";
    status.textContent = r.message || "Credentials updated.";
    updateUserWidget();
  };

  // ---- Account / startup / storage / performance controls ----
  body.querySelector("#account-logout")?.addEventListener("click", logout);
  body.querySelector("#account-fullscreen")?.addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.(); });
  const startupKey="hcr-startup-prefs";
  let startupPrefs={fast_check:true,remember_layout:true,boot_sound:true};
  try{startupPrefs={...startupPrefs,...JSON.parse(localStorage.getItem(startupKey)||"{}")};}catch(_){}
  const sf=body.querySelector("#startup-fast-check"), sr=body.querySelector("#startup-remember-layout"), sb=body.querySelector("#startup-boot-sound");
  if(sf)sf.checked=startupPrefs.fast_check!==false; if(sr)sr.checked=startupPrefs.remember_layout!==false; if(sb)sb.checked=startupPrefs.boot_sound!==false;
  body.querySelector("#startup-save")?.addEventListener("click",()=>{startupPrefs={fast_check:sf.checked,remember_layout:sr.checked,boot_sound:sb.checked};localStorage.setItem(startupKey,JSON.stringify(startupPrefs));body.querySelector("#startup-status").textContent="Startup preferences saved.";});
  body.querySelector("#storage-export")?.addEventListener("click",()=>{const data={zoom:localStorage.getItem("hcr-ui-zoom"),theme:localStorage.getItem("hcr-theme"),desktopShortcuts:localStorage.getItem("hcr-desktop-shortcuts"),startup:localStorage.getItem(startupKey),virtualMouse:localStorage.getItem("hcr-virtual-mouse")};const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="developerhcr-ui-preferences.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);});
  body.querySelector("#storage-clear-layout")?.addEventListener("click",()=>{localStorage.removeItem("hcr-desktop-apps");localStorage.removeItem("hcr-desktop-positions");localStorage.removeItem("hcr-window-layouts");body.querySelector("#storage-estimate").textContent="Desktop layout preferences cleared.";});
  async function refreshPerf(){const r=await api("/api/system",{timeoutMs:2000});const out=body.querySelector("#perf-stats");if(!out)return;out.innerHTML=[[`CPU`,r.cpu_percent==null?"n/a":r.cpu_percent+"%"],[`RAM`,r.ram_used_percent==null?"n/a":r.ram_used_percent+"%"],[`Battery`,r.battery_percent==null?"n/a":r.battery_percent+"%"],[`Network`,r.online?"Online":"Offline"],[`Python`,r.python||"n/a"]].map(([a,b])=>`<div class="note-card"><b>${a}</b><div>${escapeHtml(String(b))}</div></div>`).join("");}
  body.querySelector("#perf-refresh")?.addEventListener("click",refreshPerf); body.querySelector("#perf-open-monitor")?.addEventListener("click",()=>openApp("sysmon")); refreshPerf();

  // ---- Desktop tab wiring ----
  const desktopOrientation = settings.desktop_orientation || "portrait";
  const forceLandscapeDefault = false;
  body.querySelector("#desktop-orientation").value = desktopOrientation;
  body.querySelector("#force-landscape").checked = forceLandscapeDefault;
  body.querySelector("#show-desktop-icons").checked = settings.show_desktop_icons !== false;
  const iconSizeEl=body.querySelector("#desktop-icon-size"); if(iconSizeEl) iconSizeEl.value=desktopIconSize();
  const appLimitEl=body.querySelector("#desktop-app-limit"); if(appLimitEl) appLimitEl.value=localStorage.getItem("hcr-desktop-app-limit")||"unlimited";
  const autoHomeEl=body.querySelector("#auto-home-after-pin"); if(autoHomeEl) autoHomeEl.checked=autoReturnHomeAfterPin();
  const fsTaskbarEl=body.querySelector("#show-taskbar-fullscreen"); if(fsTaskbarEl) fsTaskbarEl.checked=localStorage.getItem("hcr-show-taskbar-fullscreen")!=="0";
  body.querySelector("#settings-clear-desktop")?.addEventListener("click",()=>clearAllDesktopShortcuts());
  body.querySelector("#custom-cursor-toggle").checked = true;
  const zLabel = body.querySelector("#settings-zoom-label");
  if (zLabel) zLabel.textContent = Math.round(currentZoom() * 100) + "%";
  body.querySelector("#settings-zoom-in")?.addEventListener("click", () => { applyZoom(Math.min(1.6, currentZoom() + 0.1)); if(zLabel) zLabel.textContent = Math.round(currentZoom() * 100) + "%"; });
  body.querySelector("#settings-zoom-out")?.addEventListener("click", () => { applyZoom(Math.max(0.6, currentZoom() - 0.1)); if(zLabel) zLabel.textContent = Math.round(currentZoom() * 100) + "%"; });
  body.querySelector("#settings-zoom-reset")?.addEventListener("click", () => { applyZoom(1); if(zLabel) zLabel.textContent = "100%"; });
  body.querySelector("#custom-cursor-toggle").onchange = () => setCustomCursorEnabled(false);
  body.querySelector("#desktop-settings-save").onclick = async () => {
    const payload = {
      desktop_orientation: body.querySelector("#desktop-orientation").value,
      force_landscape_rotate: body.querySelector("#force-landscape").checked,
      show_desktop_icons: body.querySelector("#show-desktop-icons").checked,
    };
    applyZoom(parseFloat(body.querySelector("#screen-size")?.value || currentZoom()));
    const saved = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (saved.error) { body.querySelector("#desktop-settings-status").textContent = saved.error; return; }
    document.body.classList.remove("force-landscape");
    document.body.classList.toggle("landscape-mode", payload.desktop_orientation === "landscape");
    localStorage.setItem("hcr-desktop-icon-size", body.querySelector("#desktop-icon-size")?.value || "medium");
    localStorage.setItem("hcr-desktop-app-limit", body.querySelector("#desktop-app-limit")?.value || "unlimited");
    localStorage.setItem("hcr-desktop-app-limit-explicit","1");
    localStorage.setItem("hcr-auto-home-after-pin", body.querySelector("#auto-home-after-pin")?.checked ? "1" : "0");
    localStorage.setItem("hcr-show-taskbar-fullscreen", body.querySelector("#show-taskbar-fullscreen")?.checked ? "1" : "0");
    document.body.classList.toggle("fullscreen-taskbar-visible", !!document.fullscreenElement && localStorage.getItem("hcr-show-taskbar-fullscreen") !== "0");
    const limited=desktopShortcutIds(); saveDesktopShortcutIds(limited);
    buildDesktopIcons();
    const iconsWrap = document.getElementById("desktop-icons");
    if (iconsWrap) iconsWrap.style.display = payload.show_desktop_icons === false ? "none" : "";
    body.querySelector("#desktop-settings-status").textContent = "Saved.";
    setTimeout(() => { const el = body.querySelector("#desktop-settings-status"); if (el) el.textContent = ""; }, 2000);
  };

  // ---- Voice tab wiring ----
  renderVoiceModelCard(body.querySelector("#voice-model-card"), settings);

  body.querySelector("#assistant-name").value = settings.assistant_name || "HCR AI Agent";
  const logoAction=body.querySelector("#logo-click-action"); if(logoAction) logoAction.value=localStorage.getItem("hcr-logo-click-action")||"launcher";
  const shortcutInput=body.querySelector("#hcr-shortcut"); if(shortcutInput) shortcutInput.value=localStorage.getItem("hcr-hcr-shortcut")||"Alt+Space";
  body.querySelector("#desktop-orientation").value = settings.desktop_orientation || "auto";
  body.querySelector("#auto-safe-voice").checked = settings.jarvis_auto_run_safe_voice !== false;
  body.querySelector("#persistent-log").checked = settings.jarvis_persistent_action_log !== false;
  body.querySelector("#training-capture").checked = settings.jarvis_training_capture_local_only !== false;
  body.querySelector("#assistant-animation").checked = settings.jarvis_animation !== false;
  body.querySelector("#capture-quality").value = settings.jarvis_capture_quality || "medium";
  body.querySelector("#capture-size").value = settings.jarvis_capture_size || "full";
  document.body.classList.toggle("landscape-mode", (settings.desktop_orientation || "auto") === "landscape");
  body.querySelector("#assistant-settings-save").onclick = async () => {
    const payload={assistant_name:body.querySelector("#assistant-name").value.trim() || "HCR AI Agent", desktop_orientation:body.querySelector("#desktop-orientation").value, jarvis_auto_run_safe_voice:body.querySelector("#auto-safe-voice").checked, jarvis_persistent_action_log:body.querySelector("#persistent-log").checked, jarvis_training_capture_local_only:body.querySelector("#training-capture").checked, jarvis_capture_quality:body.querySelector("#capture-quality").value, jarvis_capture_size:body.querySelector("#capture-size").value, jarvis_animation:body.querySelector("#assistant-animation").checked};
    await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    document.body.classList.toggle("landscape-mode",payload.desktop_orientation === "landscape");
    localStorage.setItem("hcr-logo-click-action", logoAction?.value||"launcher"); localStorage.setItem("hcr-hcr-shortcut", shortcutInput?.value.trim()||"Alt+Space");
    body.querySelector("#assistant-settings-status").textContent="Saved.";
  };
  body.querySelector("#hcr-shortcut-test")?.addEventListener("click",()=>openApp("jarvis"));
  body.querySelector("#theme-dark").onclick = () => setTheme("dark");
  body.querySelector("#theme-light").onclick = () => setTheme("light");

  body.querySelector("#ai-provider").value = settings.ai_default_provider || "ollama";
  body.querySelector("#ai-model").value = settings.ai_default_model || "";
  body.querySelector("#ai-temp").value = settings.ai_temperature ?? 0.7;
  body.querySelector("#ai-ctx").value = settings.ai_context_length ?? 2048;
  body.querySelector("#ai-maxhist").value = settings.ai_max_history_messages ?? 20;
  body.querySelector("#ai-timeout").value = settings.ai_generation_timeout ?? 120;
  body.querySelector("#ai-streaming").checked = settings.ai_streaming !== false;
  body.querySelector("#ai-sysprompt").value = settings.ai_system_prompt || "";

  body.querySelector("#ai-settings-save").onclick = async () => {
    const payload = {
      ai_default_provider: body.querySelector("#ai-provider").value,
      ai_default_model: body.querySelector("#ai-model").value.trim(),
      ai_temperature: parseFloat(body.querySelector("#ai-temp").value),
      ai_context_length: parseInt(body.querySelector("#ai-ctx").value, 10),
      ai_max_history_messages: parseInt(body.querySelector("#ai-maxhist").value, 10),
      ai_generation_timeout: parseInt(body.querySelector("#ai-timeout").value, 10),
      ai_streaming: body.querySelector("#ai-streaming").checked,
      ai_system_prompt: body.querySelector("#ai-sysprompt").value,
    };
    await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    body.querySelector("#ai-settings-status").textContent = "Saved.";
    setTimeout(() => { const el = body.querySelector("#ai-settings-status"); if (el) el.textContent = ""; }, 2000);

  // v1.6 data/sync settings
  body.querySelector("#admin-sync-enabled").checked=settings.admin_sync_enabled !== false;
  body.querySelector("#admin-sync-endpoint").value=settings.admin_sync_endpoint||"";
  body.querySelector("#admin-sync-diagnostics").checked=!!settings.admin_sync_include_diagnostics;
  body.querySelector("#admin-sync-save").onclick=async()=>{
    const payload={admin_sync_enabled:body.querySelector("#admin-sync-enabled").checked,admin_sync_endpoint:body.querySelector("#admin-sync-endpoint").value.trim(),admin_sync_include_diagnostics:body.querySelector("#admin-sync-diagnostics").checked};
    const r=await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    body.querySelector("#admin-sync-status").textContent=r.error||"Saved.";
  };
  // v1.1 access/store/update/support settings
  body.querySelector("#friends-enabled").checked = settings.friends_only_enabled !== false;
  body.querySelector("#subscription-enabled").checked = settings.subscription_enabled !== false;
  body.querySelector("#access-mode").value = settings.friends_subscription_mode || "friends_or_subscription";
  body.querySelector("#exe-enabled").checked = settings.exe_support_enabled !== false;
  body.querySelector("#access-save").onclick = async () => {
    const payload={friends_only_enabled:body.querySelector("#friends-enabled").checked,subscription_enabled:body.querySelector("#subscription-enabled").checked,friends_subscription_mode:body.querySelector("#access-mode").value,exe_support_enabled:body.querySelector("#exe-enabled").checked};
    await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    body.querySelector("#access-status").textContent="Saved.";
  };
  // ---- Friends Only named feature profiles ----
  const fpPanel = body.querySelector("#friend-profiles-panel");
  const fpEditor = body.querySelector("#friend-profile-editor");
  if (currentUser && currentUser.role === "ADMIN") {
    const fr = await api("/api/owner/friend-profiles");
    fpPanel.innerHTML = (fr.profiles||[]).map(p=>`<div class="note-card"><b>${escapeHtml(p.name)}</b><div class="dim">Enabled: ${p.enabled?"Yes":"No"} · password protected · ${escapeHtml(p.created_at||"")}</div>${p.name==="Jyotish"?"<span class='badge'>Default profile</span>":""}<button class="btn" data-del-profile="${p.id}">Delete</button></div>`).join("") || '<div class="dim">No profiles.</div>';
    fpEditor.innerHTML = `<div class="row"><input id="new-fp-name" placeholder="Feature name, e.g. Jyotish"><input id="new-fp-password" type="password" placeholder="Password"><button class="btn" id="new-fp-save">Add Feature</button></div><div id="fp-status" class="dim"></div>`;
    body.querySelector("#new-fp-save").onclick=async()=>{const name=body.querySelector("#new-fp-name").value.trim(),password=body.querySelector("#new-fp-password").value;if(!name||password.length<4){body.querySelector("#fp-status").textContent="Name + 4 character password required.";return;}const r=await api("/api/owner/friend-profiles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,password})});body.querySelector("#fp-status").textContent=r.error||"Feature added.";if(!r.error)renderSettingsApp(body);};
    body.querySelectorAll("[data-del-profile]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this Friends Only feature?"))return;await api("/api/owner/friend-profiles/"+b.dataset.delProfile,{method:"DELETE"});renderSettingsApp(body);});
  } else {
    fpPanel.innerHTML = '<div class="dim">Only ADMIN can add or change Friends Only feature profiles.</div>';
  }
  // ---- Subscribers Only guest password ----
  const sgpBtn = body.querySelector("#subscriber-guest-password-save");
  if (sgpBtn) {
    if (currentUser && currentUser.role === "ADMIN") {
      sgpBtn.onclick = async () => {
        const pwEl = body.querySelector("#subscriber-guest-password");
        const statusEl = body.querySelector("#subscriber-guest-password-status");
        const password = pwEl.value;
        if (password.length < 4) { statusEl.textContent = "Password must be at least 4 characters."; return; }
        const r = await api("/api/owner/subscriber-password", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({password})});
        statusEl.textContent = r.error || r.message || "Updated.";
        if (!r.error) pwEl.value = "";
      };
    } else {
      sgpBtn.disabled = true;
      body.querySelector("#subscriber-guest-password-status").textContent = "Only ADMIN can change the Subscribers Only password.";
    }
  }

  body.querySelector("#store-enabled").checked = settings.store_enabled !== false;
  body.querySelector("#store-index-url").value = settings.store_index_url || "";
  body.querySelector("#store-settings-save").onclick = async () => {
    const payload={store_enabled:body.querySelector("#store-enabled").checked,store_index_url:body.querySelector("#store-index-url").value.trim()};
    await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    body.querySelector("#store-settings-status").textContent="Saved.";
  };
  body.querySelector("#update-enabled").checked = settings.update_enabled !== false;
  body.querySelector("#update-owner").value = settings.update_repo_owner || "DevevoperHCR";
  body.querySelector("#update-repo").value = settings.update_repo_name || "HCRAPP";
  body.querySelector("#update-channel").value = settings.update_channel || "stable";
  if (currentUser.role !== "ADMIN") {
    ["update-enabled","update-owner","update-repo","update-channel","update-settings-save","support-save","friends-enabled","subscription-enabled","access-mode","exe-enabled","access-save","store-enabled","store-index-url","store-settings-save","admin-sync-enabled","admin-sync-endpoint","admin-sync-diagnostics","admin-sync-save"].forEach(id=>{const el=body.querySelector("#"+id);if(el)el.disabled=true;});
  }
  body.querySelector("#update-settings-save").onclick = async () => {
    const payload={update_enabled:body.querySelector("#update-enabled").checked,update_repo_owner:body.querySelector("#update-owner").value.trim(),update_repo_name:body.querySelector("#update-repo").value.trim(),update_channel:body.querySelector("#update-channel").value};
    const r=await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    body.querySelector("#update-settings-status").textContent=r.error||"Saved.";
  };
  body.querySelector("#update-check-settings").onclick = async () => {
    const r=await api("/api/updates/check"); body.querySelector("#update-settings-status").textContent=r.error||(!r.configured?"Repository not configured.":(r.available?"Update available: "+r.latest:"Already up to date."));
  };
  const annBox=body.querySelector("#owner-update-announcement-box");
  if (annBox) {
    if (currentUser.role !== "ADMIN") annBox.innerHTML='<div class="dim">Only ADMIN can publish update messages.</div>';
    else {
      const ar=await api("/api/updates/announcement");
      if(ar.announcement){body.querySelector("#update-ann-title").value=ar.announcement.title||"";body.querySelector("#update-ann-message").value=ar.announcement.message||"";}
      body.querySelector("#update-ann-send").onclick=async()=>{const r=await api("/api/owner/updates/announcement",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:body.querySelector("#update-ann-title").value,message:body.querySelector("#update-ann-message").value})});body.querySelector("#update-ann-status").textContent=r.error||"Update message published.";};
      body.querySelector("#update-ann-clear").onclick=async()=>{const r=await api("/api/owner/updates/announcement",{method:"DELETE"});body.querySelector("#update-ann-status").textContent=r.error||"Message removed.";};
    }
  }
  body.querySelector('#support-save').onclick=async()=>{const rr=await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp_group:'',whatsapp_channel:'',support_email:'developerhcr@gmail.com',support_instagram:'https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw'})});body.querySelector('#support-status').textContent=rr.error||'Support preferences saved.';};
  const sec=await api('/api/security/settings');
  body.querySelector('#settings-quick').checked=!!sec.quick_unlock_enabled; body.querySelector('#settings-privacy').value=sec.privacy_mode||'standard';
  body.querySelector('#settings-security-save').onclick=async()=>{const r=await api('/api/security/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quick_unlock_enabled:body.querySelector('#settings-quick').checked,pin:body.querySelector('#settings-pin').value,privacy_mode:body.querySelector('#settings-privacy').value})});body.querySelector('#settings-security-status').textContent=r.ok?'Saved.':(r.error||'Failed');};
  const plans=await api('/api/plans');
  body.querySelector('#settings-plans').innerHTML=(plans.plans||[]).map(p=>`<div class="note-card"><b>${escapeHtml(p.label)}</b> · ₹${p.price_inr}<div class="dim">${(p.features||[]).join(' · ')}</div></div>`).join('');
  const planEditor = body.querySelector("#owner-plan-editor");
  if (currentUser && currentUser.role === "ADMIN" && planEditor) {
    planEditor.innerHTML = `<b>Admin Plan Editor</b>` + (plans.plans||[]).map((p,i)=>`
      <div class="note-card plan-edit-row" data-index="${i}">
        <div class="row"><input class="plan-id" value="${escapeHtml(p.id)}" placeholder="ID"><input class="plan-label" value="${escapeHtml(p.label)}" placeholder="Name"><input class="plan-price" type="number" min="0" value="${Number(p.price_inr)||0}" style="width:90px"></div>
        <input class="plan-features" value="${escapeHtml((p.features||[]).join(', '))}" placeholder="features: notes, calculator, browser">
        <button class="btn plan-select-all" type="button">☑ Select all features</button>
      </div>`).join('') +
      `<div class="row"><label>Future prices ₹</label><input id="future-prices" style="flex:1" value="${escapeHtml((plans.future_prices_inr||[]).join(', '))}" placeholder="500, 1000, 5000"></div>
       <button class="btn" id="save-plan-config">Save Subscription Configuration</button><div id="plan-config-status" class="dim"></div>`;
    body.querySelectorAll(".plan-select-all").forEach(btn=>btn.onclick=()=>{
      const row=btn.closest('.plan-edit-row');
      row.querySelector('.plan-features').value=FEATURE_CATALOG.join(', ');
    });
    body.querySelector("#save-plan-config").onclick = async () => {
      const out=[...body.querySelectorAll(".plan-edit-row")].map(row=>({id:row.querySelector(".plan-id").value,label:row.querySelector(".plan-label").value,price_inr:Number(row.querySelector(".plan-price").value),features:row.querySelector(".plan-features").value.split(",").map(x=>x.trim()).filter(Boolean)}));
      const future=(body.querySelector("#future-prices").value||"").split(",").map(x=>Number(x.trim())).filter(x=>Number.isFinite(x));
      const r=await api("/api/owner/subscription-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plans:out,future_prices_inr:future})});
      body.querySelector("#plan-config-status").textContent=r.error||"Subscription configuration saved.";
      if(!r.error) playUISound("success");
    };
  } else if (planEditor) {
    planEditor.innerHTML = `<div class="dim">Only ADMIN can change plan prices and feature lists.</div>`;
  }
  appSettings.sound_enabled = settings.sound_enabled !== false;
  appSettings.sound_volume = Number(settings.sound_volume ?? 0.45);
  const soundEnabledEl = body.querySelector("#sound-enabled");
  const soundVolumeEl = body.querySelector("#sound-volume");
  if (soundEnabledEl) soundEnabledEl.checked = appSettings.sound_enabled;
  if (soundVolumeEl) soundVolumeEl.value = appSettings.sound_volume;
  body.querySelector("#sound-test").onclick = () => { appSettings.sound_enabled = true; playUISound("success"); };
  body.querySelector("#sound-save").onclick = async () => {
    const payload = {sound_enabled: soundEnabledEl.checked, sound_volume: Number(soundVolumeEl.value)};
    const r = await api("/api/settings", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if (!r.error) { appSettings = {...appSettings, ...payload}; playUISound("success"); }
    body.querySelector("#sound-status").textContent = r.error || "Saved.";
  };
  body.querySelector('#open-control-panel').onclick=()=>openApp('control'); body.querySelector('#open-troubleshooting').onclick=()=>openApp('troubleshoot');

  body.querySelector("#support-save").onclick=()=>{
    body.querySelector("#support-status").textContent="24×7 Feedback & Support is active. No external messaging configuration is required.";
  };
  };
}

// ---- v1.0: Voice model download card ----
// Honesty note: this tracks download/ready state for the configured voice
// model and persists it via the existing settings API. Wiring it to an
// actual model file fetch just means pointing voice_model_url at a real
// download URL later — the on/off state and UI here are real, not mocked.
async function renderVoiceModelCard(el, settings) {
  if (!el) return;
  const r=await api('/api/jarvis/status').catch(()=>({}));
  const pyttsx=!!r.tts_available, stt=!!r.stt_available, model=!!r.stt_model_available;
  el.innerHTML=`<div><b>Kausar Voice Engine</b></div>
    <div class="dim" style="margin:6px 0">TTS: ${pyttsx?'✅ available':'❌ pyttsx3 missing'} · STT: ${stt?'✅ available':'❌ sounddevice/vosk missing'} · Local model: ${model?'✅ found':'❌ not found'}</div>
    <div class="row"><button class="btn" id="voice-test">🔊 Test Voice</button><button class="btn" id="voice-listen-test">🎙️ Test Listening</button></div>
    <div id="voice-test-status" class="dim" style="margin-top:6px"></div>
    <div class="dim" style="font-size:.72rem;margin-top:6px">No fake download state is used. Put a compatible Vosk model in data/jarvis/vosk-model or set JARVIS_VOSK_MODEL.</div>`;
  el.querySelector('#voice-test').onclick=async()=>{const x=await api('/api/jarvis/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'HCR AI Agent voice test successful.'})});el.querySelector('#voice-test-status').textContent=x.ok?'Voice test completed.':(x.error||'TTS unavailable.');};
  el.querySelector('#voice-listen-test').onclick=async()=>{const x=await api('/api/jarvis/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:3})});el.querySelector('#voice-test-status').textContent=x.ok?'Heard: '+(x.text||'(nothing detected)'):(x.error||'Listening unavailable.');};
}

async function setTheme(theme) {
  theme = theme === "light" ? "light" : "dark";
  // v1.0 BETA fix: do NOT overwrite body.className wholesale — that was wiping
  // every other shell class (android-ui/windows-ui, custom-cursor-mode,
  // virtual-mouse, landscape-mode, desktop-fullscreen, force-landscape, ...)
  // every time the theme changed, which is what broke the app menu layout,
  // the mouse cursor, and virtual keyboard/mouse state after a theme switch.
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add("theme-" + theme);
  localStorage.setItem("hcr-theme", theme);
  await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) });
}

async function loadTheme() {
  let saved = localStorage.getItem("hcr-theme") || "dark";
  try {
    const remote = appSettings?.theme;
    if (remote === "light" || remote === "dark") saved = remote;
  } catch (_) {}
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add("theme-" + saved);
}

// ================= APP: AI Models (v0.3 - richer status via /api/ai/providers) =================
async function renderAiModelsApp(body) {
  body.innerHTML = `<div class="dim">Scanning for local AI runtimes...</div>`;
  const status = await api("/api/ai/providers");
  const ollama = status.ollama;
  const gguf = status.gguf;
  body.innerHTML = `
    <div class="stack">
      <div><b>Ollama</b> — Installed: ${ollama.installed ? "Yes" : "No"} · Running: ${ollama.running ? "Yes" : "No"}</div>
      ${ollama.error ? `<div class="dim">${escapeHtml(ollama.error)}</div>` : ""}
      ${ollama.models.length ? `<table><tr><th>Model</th><th>Size</th><th>Status</th></tr>${ollama.models.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${m.size_gb ?? "N/A"} GB</td><td>${m.status}</td></tr>`).join("")}</table>` : `<div class="dim">No models installed.</div>`}
      ${ollama.installed ? `<div class="row"><input id="ollama-pull-model" placeholder="e.g. llama3.2:3b" style="flex:1"><button class="btn" id="ollama-pull-btn">⬇️ Download Model</button></div><div id="ollama-pull-status" class="dim"></div>` : ""}
      <hr style="border-color:var(--border); width:100%;">
      <div><b>GGUF</b> — Runtime (llama-cpp-python) available: ${gguf.installed ? "Yes" : "No"}</div>
      ${gguf.error ? `<div class="dim">${escapeHtml(gguf.error)}</div>` : ""}
      ${gguf.models.length ? `<table><tr><th>Name</th><th>Size</th><th>Status</th></tr>${gguf.models.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${m.size_gb} GB</td><td>${m.status}</td></tr>`).join("")}</table>` : `<div class="dim">No GGUF files found in scanned folders.</div>`}
      <hr style="border-color:var(--border); width:100%;">
      <div class="dim">To use a model: open Settings → AI Settings, set provider + model name exactly as shown above, or select it directly in AI Chat.</div>
      <div class="dim">Model directories are scanned from common per-OS locations automatically. Ollama downloads are explicit and run through the local Ollama CLI.</div>
    </div>
  `;
  const pull=body.querySelector("#ollama-pull-btn"); if(pull) pull.onclick=async()=>{const model=body.querySelector("#ollama-pull-model").value.trim();const st=body.querySelector("#ollama-pull-status");if(!model){st.textContent="Enter a model name.";return;}pull.disabled=true;pull.textContent="Downloading...";const r=await api("/api/ai/models/pull",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:"ollama",model})});st.textContent=r.ok?"Model downloaded successfully.":(r.error||"Download failed");pull.disabled=false;pull.textContent="⬇️ Download Model";};
}

// ================= APP: AI Chat (v0.3) =================
const aiChatState = { conversationId: null, provider: "ollama", model: "", eventSource: null, generating: false };

async function renderAiChatApp(body) {
  const settings = await api("/api/settings", { timeoutMs: 3000 });
  aiChatState.provider = settings.ai_default_provider || "ollama";
  aiChatState.model = settings.ai_default_model || "";

  let providerStatus = {};
  async function refreshProviders() {
    const r = await api("/api/ai/providers", { timeoutMs: 3500 });
    if (r && !r.error) providerStatus = r;
    return providerStatus;
  }
  await refreshProviders();

  function providerModels(provider) {
    return providerStatus?.[provider]?.models || [];
  }
  function chooseRunnableModel(preferredProvider, preferredModel) {
    const candidates = [preferredProvider, "ollama", "gguf"].filter((v,i,a)=>v && a.indexOf(v)===i);
    for (const provider of candidates) {
      const models = providerModels(provider);
      if (!models.length || providerStatus?.[provider]?.running === false) continue;
      const exact = models.find(m => m.name === preferredModel);
      return { provider, model: exact?.name || models[0].name };
    }
    return { provider: preferredProvider || "ollama", model: preferredModel || "" };
  }
  ({provider: aiChatState.provider, model: aiChatState.model} = chooseRunnableModel(aiChatState.provider, aiChatState.model));

  body.innerHTML = `
    <div class="stack ai-chat-shell" style="height:100%;">
      <div class="row ai-chat-toolbar">
        <select id="chat-provider" style="width:110px;"><option value="ollama">Ollama</option><option value="gguf">GGUF</option></select>
        <select id="chat-model" style="flex:1;min-width:150px;"><option value="">Detecting model…</option></select>
        <button class="btn" id="chat-refresh-models" title="Refresh installed models">↻</button>
        <button class="btn" id="chat-new">New</button>
        <button class="btn" id="chat-web-search">🔎 Search</button>
        <button class="btn" id="chat-history-toggle">History</button>
        <span id="chat-status" class="dim">IDLE</span>
      </div>
      <div id="chat-runtime-hint" class="ai-runtime-hint"></div>
      <div id="chat-history-panel" class="hidden" style="max-height:120px; overflow-y:auto; border:1px solid var(--border); border-radius:6px; padding:6px;"></div>
      <div id="chat-log" class="ai-chat-log" style="flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px; padding:8px; min-height:160px;"></div>
      <div class="row ai-chat-input-row">
        <input id="chat-input" placeholder="Type a message..." style="flex:1;">
        <button class="btn" id="chat-send">Send</button>
        <button class="btn" id="chat-stop" disabled>Stop</button>
        <button class="btn" id="chat-clear">Clear</button>
      </div>
    </div>
  `;

  const providerEl = body.querySelector("#chat-provider");
  const modelEl = body.querySelector("#chat-model");
  const hintEl = body.querySelector("#chat-runtime-hint");
  const log = body.querySelector("#chat-log");
  const statusEl = body.querySelector("#chat-status");
  const sendBtn = body.querySelector("#chat-send");
  const stopBtn = body.querySelector("#chat-stop");

  function setModelOptions(preferred) {
    const models = providerModels(providerEl.value);
    modelEl.innerHTML = models.length
      ? models.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join("")
      : `<option value="">No runnable model detected</option>`;
    if (preferred && models.some(m => m.name === preferred)) modelEl.value = preferred;
    else if (models[0]) modelEl.value = models[0].name;
    aiChatState.provider = providerEl.value;
    aiChatState.model = modelEl.value;
    const p = providerStatus?.[providerEl.value];
    hintEl.textContent = models.length
      ? `✓ Model ready: ${aiChatState.model} · ${providerEl.value}${p?.running ? " · runtime active" : ""}`
      : `No runnable ${providerEl.value} model detected. Open AI Models to install/start one.`;
    sendBtn.disabled = !modelEl.value;
  }

  function setStatus(s) {
    statusEl.textContent = s;
    aiChatState.generating = (s === "GENERATING" || s === "CONNECTING");
    stopBtn.disabled = !aiChatState.generating;
    sendBtn.disabled = aiChatState.generating || !modelEl.value;
  }
  function appendMsg(role, text) {
    const div = document.createElement("div");
    div.className = "note-card ai-message " + role;
    div.innerHTML = `<b>${role === "user" ? "You" : "AI"}:</b> <span class="msg-text">${escapeHtml(text)}</span>`;
    log.appendChild(div); log.scrollTop = log.scrollHeight;
    return div.querySelector(".msg-text");
  }

  providerEl.value = aiChatState.provider;
  setModelOptions(aiChatState.model);

  async function loadHistory() {
    const res = await api("/api/ai/conversations");
    const panel = body.querySelector("#chat-history-panel");
    panel.innerHTML = (res.conversations||[]).map(c => `<div class="row" style="justify-content:space-between;padding:2px 0;"><span style="cursor:pointer;" data-open="${c.id}">${escapeHtml(c.title)} <span class="dim">(${escapeHtml(c.provider)}/${escapeHtml(c.model)})</span></span><button class="btn" data-del="${c.id}" style="padding:1px 6px;">✕</button></div>`).join("") || `<div class="dim">No conversations yet.</div>`;
    panel.querySelectorAll("[data-open]").forEach(el=>el.onclick=()=>openConversation(parseInt(el.dataset.open,10)));
    panel.querySelectorAll("[data-del]").forEach(el=>el.onclick=async(e)=>{e.stopPropagation();await api(`/api/ai/conversations/${el.dataset.del}`,{method:"DELETE"});if(aiChatState.conversationId===parseInt(el.dataset.del,10)){aiChatState.conversationId=null;log.innerHTML="";}loadHistory();});
  }
  async function openConversation(id) {
    const res=await api(`/api/ai/conversations/${id}`);
    if(res.error){appendMsg("ai",res.error);return;}
    aiChatState.conversationId=id; aiChatState.provider=res.conversation.provider; aiChatState.model=res.conversation.model;
    providerEl.value=aiChatState.provider; setModelOptions(aiChatState.model); log.innerHTML=""; (res.messages||[]).forEach(m=>appendMsg(m.role,m.content)); setStatus((res.conversation.status||"idle").toUpperCase());
  }

  body.querySelector("#chat-history-toggle").onclick=()=>{const p=body.querySelector("#chat-history-panel");p.classList.toggle("hidden");if(!p.classList.contains("hidden"))loadHistory();};
  body.querySelector("#chat-refresh-models").onclick=async()=>{setStatus("SCANNING");await refreshProviders();const choice=chooseRunnableModel(providerEl.value,modelEl.value);providerEl.value=choice.provider;setModelOptions(choice.model);setStatus("IDLE");};
  providerEl.onchange=()=>{setModelOptions(""); aiChatState.conversationId=null; log.innerHTML=""; setStatus("IDLE");};
  modelEl.onchange=()=>{aiChatState.model=modelEl.value;};
  body.querySelector("#chat-new").onclick=async()=>{const provider=providerEl.value,model=modelEl.value.trim();if(!model){appendMsg("ai","No runnable model is available. Start/install an AI model first.");return;}const res=await api("/api/ai/conversations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,model})});if(res.error){appendMsg("ai",res.error);return;}aiChatState.conversationId=res.id;aiChatState.provider=provider;aiChatState.model=model;log.innerHTML="";setStatus("IDLE");};
  body.querySelector("#chat-web-search").onclick=()=>{const q=body.querySelector("#chat-input")?.value.trim();if(!q){body.querySelector("#chat-status").textContent="Type a search query first.";return;}const url="https://www.google.com/search?q="+encodeURIComponent(q);window.open(url,"_blank","noopener");body.querySelector("#chat-status").textContent="Search opened in the browser.";};
  body.querySelector("#chat-clear").onclick=async()=>{if(!aiChatState.conversationId)return;await api(`/api/ai/conversations/${aiChatState.conversationId}/clear`,{method:"POST"});log.innerHTML="";};
  body.querySelector("#chat-stop").onclick=async()=>{if(aiChatState.conversationId)await api(`/api/ai/chat/stop/${aiChatState.conversationId}`,{method:"POST"});};

  async function ensureConversation() {
    if (aiChatState.conversationId) return true;
    await refreshProviders();
    const choice=chooseRunnableModel(providerEl.value,modelEl.value);
    providerEl.value=choice.provider; setModelOptions(choice.model);
    if(!modelEl.value) return false;
    const res=await api("/api/ai/conversations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:providerEl.value,model:modelEl.value,title:"New Chat"})});
    if(res.error){appendMsg("ai",res.error);return false;}
    aiChatState.conversationId=res.id; aiChatState.provider=providerEl.value; aiChatState.model=modelEl.value; return true;
  }

  async function sendMessage() {
    if(aiChatState.generating)return;
    const input=body.querySelector("#chat-input"), text=input.value.trim(); if(!text)return;
    if(!(await ensureConversation())){appendMsg("ai","AI is not ready. No runnable model was detected.");return;}
    input.value=""; appendMsg("user",text); const aiSpan=appendMsg("ai",""); setStatus("CONNECTING");
    try {
      const resp=await fetch("/api/ai/chat/stream",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({conversation_id:aiChatState.conversationId,message:text})});
      if(!resp.ok||!resp.body){const err=await resp.json().catch(()=>({}));aiSpan.textContent=err.error||`AI server error (HTTP ${resp.status}).`;setStatus("ERROR");await refreshProviders();setModelOptions("");return;}
      setStatus("GENERATING"); const reader=resp.body.getReader(),decoder=new TextDecoder();let buffer="",accumulated="";
      while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n\n");buffer=lines.pop();for(const line of lines){if(!line.startsWith("data: "))continue;let evt;try{evt=JSON.parse(line.slice(6));}catch(_){continue;}if(evt.type==="chunk"){accumulated+=evt.text;aiSpan.textContent=accumulated;log.scrollTop=log.scrollHeight;}else if(evt.type==="error"){aiSpan.textContent=(accumulated?accumulated+"\n\n":"")+"[error] "+evt.message;setStatus("ERROR");}else if(evt.type==="stopped"){setStatus("STOPPED");}else if(evt.type==="done"){const meta=[];if(evt.tokens_per_sec)meta.push(`${evt.tokens_per_sec}${evt.tokens_approximate?"~":""} tok/s`);if(evt.elapsed_sec)meta.push(`${evt.elapsed_sec}s`);if(meta.length)aiSpan.textContent=accumulated+`\n\n(${meta.join(" · ")})`;setStatus("COMPLETED");}}}
      if(statusEl.textContent==="GENERATING")setStatus("COMPLETED");
    } catch(e) { aiSpan.textContent=`AI connection failed: ${e?.message||"unknown error"}`;setStatus("ERROR");await refreshProviders();setModelOptions(""); }
  }
  sendBtn.onclick=sendMessage;
  body.querySelector("#chat-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}});
}

// ================= APP: Admin Dashboard (v0.2 - OWNER only, server-enforced) =================
// v1.0 BETA fix: this was previously also named renderAdminApp, which meant
// JS silently kept only the LAST declaration with that name (see the legacy
// renderAdminApp further down) and this entire richer dashboard — Create
// Admin Account, per-user Friend/plan/credential management, Store feature
// locks — was unreachable dead code. Renamed so both dashboards exist.
async function renderOwnerControlApp(body) {
  body.innerHTML = `<div class="dim">Loading admin control dashboard...</div>`;
  const [dash, usersRes, accessRes, plans, subRequests] = await Promise.all([
    api("/api/owner/dashboard"), api("/api/owner/users"), api("/api/owner/access"), api("/api/plans"), api("/api/subscriptions/requests")
  ]);
  if (dash.error) { body.innerHTML = `<div class="dim">${escapeHtml(dash.error)}</div>`; return; }
  const planOptions = (plans.plans||[]).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)} · ₹${p.price_inr}</option>`).join("");
  body.innerHTML = `
    <div class="stack">
      <div class="row">
        <div><b>${dash.total_users}</b> users</div><div><b>${dash.active_sessions}</b> active sessions</div>
        <div><b>${dash.open_feedback}</b> open feedback</div>
      </div>
      <div><b>System:</b> ${escapeHtml(dash.system.os)} · CPU ${dash.system.cpu_percent ?? "n/a"}% · RAM ${dash.system.ram_used_percent ?? "n/a"}%</div>
      <div><b>AI:</b> Ollama ${dash.ai.ollama.running ? "running" : "offline"} · ${dash.ai.ollama.models.length} models · GGUF ${dash.ai.gguf.installed ? "ready" : "unavailable"}</div>
      <div class="dim">Privacy rule: private user content is not exposed. Only aggregate usage, security, support and system data is shown.</div>
      <hr style="border-color:var(--border); width:100%;">
      <div><b>Create Admin Account</b></div>
      <div class="dim">Only Admin accounts can be created (plus the one Admin). There is no other role.</div>
      <div class="row">
        <input id="new-user-name" placeholder="username" style="width:120px;"><input id="new-user-pass" placeholder="password" type="password" style="width:120px;">
        <button class="btn" id="create-user-btn">Create Admin</button>
      </div>
      <div id="owner-error" class="auth-error"></div>
      <div><b>Users</b></div>
      <table id="owner-access-table"><tr><th>User</th><th>Role</th><th>Status</th><th>Plan</th><th>Friend</th><th>Approval</th><th>Actions</th></tr></table>
      <hr style="border-color:var(--border); width:100%;">
      <div><b>HCR Store — feature passwords</b></div>
      <div class="dim">Each Store item can have its own password, separate from account login. Leave blank and save to remove a lock.</div>
      <div id="owner-store-locks" class="stack"></div>
      <hr style="border-color:var(--border); width:100%;">
      <div><b>Subscription requests</b></div><div id="owner-sub-requests" class="stack"></div>
      <hr style="border-color:var(--border); width:100%;">
      <div><b>Recent audit</b></div>
      <table>${dash.recent_audit.map(a => `<tr><td class="dim">${escapeHtml(a.ts)}</td><td>${escapeHtml(a.username||"-")}</td><td>${escapeHtml(a.action)}</td></tr>`).join("")}</table>
    </div>`;
  const table=body.querySelector("#owner-access-table");
  (accessRes.users||[]).filter(u=>u.role!=="OWNER").forEach(u=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.status)}</td>
      <td><select class="plan-select">${planOptions}</select></td>
      <td>${u.friend?"YES":"NO"}</td><td>${escapeHtml(u.sub_status)}</td>
      <td><button class="btn grant-plan">Apply Plan</button>
      <button class="btn friend-btn">${u.friend?"Remove Friend":"Add Friend"}</button>
      <button class="btn friend-pass">Friend Password</button><button class="btn feature-pass">Feature Access</button><button class="btn credentials-pass">Username / Password</button>
      <button class="btn role-change">Change Role</button><button class="btn status-toggle">${u.status==="disabled"?"Enable":"Disable"} Account</button></td>`;
    tr.querySelector(".plan-select").value=u.plan||"FREE";
    tr.querySelector(".grant-plan").onclick=async()=>{
      const plan=tr.querySelector(".plan-select").value;
      const r=await api(`/api/owner/subscriptions/${u.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan,status:"active",feature_permissions:{}})});
      if(r.error) alert(r.error); else {playUISound("success");renderOwnerControlApp(body);}
    };
    tr.querySelector(".friend-btn").onclick=async()=>{
      const rr=await api(`/api/owner/friends/${u.id}`,{method:u.friend?"DELETE":"POST"});
      if(rr.error) alert(rr.error); else {playUISound("success");renderOwnerControlApp(body);}
    };
    tr.querySelector(".friend-pass").onclick=async()=>{
      const name=prompt("Friends Only display name:",u.username); if(name===null)return;
      const pass=prompt("Set Friends Only password (min 4 chars):",""); if(pass===null)return;
      const rr=await api(`/api/owner/friends/${u.id}/credentials`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name:name,password:pass})});
      alert(rr.error||"Friends Only credentials saved.");
    };
    tr.querySelector(".credentials-pass").onclick=async()=>{
      const name=prompt("New username (must be unique):",u.username); if(name===null)return;
      const pass=prompt("New password (leave blank to keep current):",""); if(pass===null)return;
      const rr=await api(`/api/owner/users/${u.id}/credentials`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({new_username:name,new_password:pass})});
      alert(rr.error||"Username/password updated. Existing sessions for this user were signed out.");
      if(!rr.error) renderOwnerControlApp(body);
    };
    tr.querySelector(".feature-pass").onclick=async()=>{
      const feature=prompt("Feature key to grant (e.g. browser, ai_models, store, feedback):","");
      if(!feature)return;
      const rr=await api(`/api/owner/users/${u.id}/features`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feature,enabled:true})});
      alert(rr.error||`Feature "${feature}" granted.`);
    };
    tr.querySelector(".role-change").onclick=async()=>{
      const role=prompt("New role for "+u.username+" (ADMIN, or a legacy access role: FRIENDS_ONLY, NORMAL_USER, APPROVED_USER, SUBSCRIBER):",u.role);
      if(!role)return;
      const rr=await api(`/api/owner/users/${u.id}/role`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:role.trim().toUpperCase()})});
      if(rr.error) alert(rr.error); else {playUISound("success");renderOwnerControlApp(body);}
    };
    tr.querySelector(".status-toggle").onclick=async()=>{
      const newStatus=u.status==="disabled"?"active":"disabled";
      if(newStatus==="disabled" && !confirm(`Disable ${u.username}'s account? Their current sessions will be signed out immediately.`))return;
      const rr=await api(`/api/owner/users/${u.id}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:newStatus})});
      if(rr.error) alert(rr.error); else {playUISound("success");renderOwnerControlApp(body);}
    };
    table.appendChild(tr);
  });
  const reqBox=body.querySelector("#owner-sub-requests");
  reqBox.innerHTML=(subRequests.requests||[]).map(x=>`<div class="note-card"><b>#${x.id} ${escapeHtml(x.username)}</b> · ${escapeHtml(x.plan_id)} · ₹${x.price_inr} · <b>${escapeHtml(x.status)}</b><div class="dim">${escapeHtml(x.created_at||'')} · WhatsApp: ${x.whatsapp_url?'configured':'not configured'}</div>${x.status==='pending'?`<div class="row"><button class="btn owner-req-approve" data-id="${x.id}">Approve</button><button class="btn owner-req-reject" data-id="${x.id}">Reject</button></div>`:''}</div>`).join('')||'<div class="dim">No subscription requests.</div>';
  body.querySelectorAll('.owner-req-approve').forEach(b=>b.onclick=async()=>{const rr=await api(`/api/subscriptions/requests/${b.dataset.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve:true})});if(rr.error)alert(rr.error);else{playUISound('success');renderOwnerControlApp(body);}});
  body.querySelectorAll('.owner-req-reject').forEach(b=>b.onclick=async()=>{const rr=await api(`/api/subscriptions/requests/${b.dataset.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve:false})});if(rr.error)alert(rr.error);else renderOwnerControlApp(body);});
  body.querySelector("#create-user-btn").onclick=async()=>{
    const payload={username:body.querySelector("#new-user-name").value.trim(),password:body.querySelector("#new-user-pass").value};
    const r=await api("/api/owner/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(r.error) body.querySelector("#owner-error").textContent=r.error; else {playUISound("success");renderOwnerControlApp(body);}
  };
  // Store feature locks: list every Store app_id and let the Admin set/clear
  // its own separate password.
  const [storeCat, currentLocks] = await Promise.all([api("/api/store"), api("/api/owner/store/locks")]);
  const lockedSet = new Set(currentLocks.locked || []);
  const storeItems = (storeCat.apps || []).filter(a => a.app_id);
  const locksBox = body.querySelector("#owner-store-locks");
  locksBox.innerHTML = storeItems.map(a => `
    <div class="row" data-app="${escapeHtml(a.app_id)}">
      <span style="width:160px;">${lockedSet.has(a.app_id) ? "🔒" : "🔓"} ${escapeHtml(a.name || a.app_id)}</span>
      <input type="password" class="lock-pw-input" placeholder="${lockedSet.has(a.app_id) ? "new password (blank = remove lock)" : "set a password to lock"}" style="flex:1">
      <button class="btn lock-save-btn">Save</button>
    </div>`).join("");
  locksBox.querySelectorAll("[data-app]").forEach(row => {
    row.querySelector(".lock-save-btn").onclick = async () => {
      const appId = row.dataset.app;
      const password = row.querySelector(".lock-pw-input").value;
      const rr = await api("/api/owner/store/locks", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({app_id: appId, password})});
      if (rr.error) { alert(rr.error); return; }
      playUISound("success");
      renderOwnerControlApp(body);
    };
  });
}

// ================= v1.2: Browser =================
function renderBrowserApp(body) {
  body.innerHTML=`<div class="browser-shell"><div class="row"><button class="btn" id="browser-back">←</button><button class="btn" id="browser-forward">→</button><button class="btn" id="browser-home">⌂</button><input id="browser-url" style="flex:1" value="https://www.google.com" placeholder="https://..."><button class="btn" id="browser-go">Go</button><button class="btn" id="browser-external">↗</button></div><iframe id="browser-frame" title="DeveloperHCR Browser" sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe><div class="dim" style="font-size:.7rem">Some websites block embedded browsers with security headers. Use ↗ to open them in your system browser.</div></div>`;
  const frame=body.querySelector('#browser-frame'), url=body.querySelector('#browser-url');
  const go=()=>{let u=url.value.trim(); if(!/^https?:\/\//i.test(u))u='https://www.google.com/search?q='+encodeURIComponent(u); url.value=u; frame.src=u;};
  body.querySelector('#browser-go').onclick=go; body.querySelector('#browser-home').onclick=()=>{url.value='https://www.google.com';go();};
  body.querySelector('#browser-external').onclick=()=>window.open(url.value,'_blank','noopener');
  body.querySelector('#browser-back').onclick=()=>{try{frame.contentWindow.history.back()}catch(_){}}; body.querySelector('#browser-forward').onclick=()=>{try{frame.contentWindow.history.forward()}catch(_) {}}; go();
}

// ================= v1.2: Control Panel =================
async function renderControlPanelApp(body){
  const [sys,sec]=await Promise.all([api('/api/system',{timeoutMs:2000}),api('/api/security/settings',{timeoutMs:2000})]);
  body.innerHTML=`<div class="stack control-panel-pro">
    <div class="cp-header"><div><h3>🛡️ HCR Control Centre</h3><div class="dim">Always-local system health, network diagnostics, device capabilities and recovery controls.</div></div><button class="btn" id="cp-refresh">↻ Refresh</button></div>
    <div class="control-grid" id="cp-stats"></div>
    <div class="note-card"><b>Live Device Health</b><div class="control-grid" id="cp-health-grid"></div><div id="cp-health-detail" class="dim">Loading live diagnostics…</div></div>
    <div class="note-card"><b>System & Device</b><div class="system-control-grid">
      <button class="system-control" data-open-system="this_pc"><span>🖥️</span><b>This PC</b><small>Files & drives</small></button>
      <button class="system-control" data-open-system="recycle_bin"><span>🗑️</span><b>Recycle Bin</b><small>Open trash</small></button>
      <button class="system-control" data-open-system="network"><span>🌐</span><b>Network</b><small>Network locations</small></button>
      <button class="system-control" data-open-system="bluetooth"><span>ᛒ</span><b>Bluetooth</b><small>Bluetooth settings</small></button>
      <button class="system-control" data-open-system="network_settings"><span>📶</span><b>Network Settings</b><small>Wi-Fi / Ethernet</small></button>
      <button class="system-control" data-open-system="display"><span>🖥️</span><b>Display</b><small>Screen settings</small></button>
      <button class="system-control" data-open-system="sound"><span>🔊</span><b>Sound</b><small>Audio settings</small></button>
      <button class="system-control" data-open-system="control_panel"><span>🎛️</span><b>Control Panel</b><small>System settings</small></button>
      <button class="system-control" data-open-system="task_manager"><span>📊</span><b>Task Manager</b><small>Processes</small></button>
      <button class="system-control" data-open-system="date_time"><span>🕒</span><b>Date & Time</b><small>Clock settings</small></button>
    </div><div id="system-control-status" class="dim"></div></div>
    <div class="note-card"><b>Bluetooth</b><div class="dim" id="cp-bt-status">Checking Bluetooth capability…</div><div class="row"><button class="btn" id="cp-bt-refresh">↻ Refresh</button><button class="btn" id="cp-bt-on">Bluetooth ON</button><button class="btn" id="cp-bt-off">Bluetooth OFF</button><button class="btn" id="cp-bt-settings">⚙️ Open Bluetooth Settings</button></div></div>
    <div class="note-card"><b>Network Recovery</b><div class="dim">Checks internet, DNS, interfaces and latency before any recovery action. Destructive adapter resets are never run silently.</div><div class="row" style="flex-wrap:wrap"><button class="btn" id="cp-network-reset">↻ Network Reset</button><button class="btn" id="cp-net-diagnostics">🩺 Full Network Check</button></div><div id="network-reset-status" class="dim"></div><pre id="cp-net-details" class="term-log" style="height:150px;margin-top:8px"></pre></div>
    <div class="note-card"><b>Workspace</b><div class="row" style="flex-wrap:wrap"><button class="btn" id="cp-fullscreen">⛶ Full Screen</button><button class="btn" id="cp-landscape">↔ Landscape Layout</button><button class="btn" id="cp-settings">⚙️ Settings</button><button class="btn" id="cp-monitor">📊 Monitor</button><button class="btn" id="cp-files">📁 Files</button><button class="btn" id="cp-network">🌐 Network Tools</button><button class="btn" id="cp-help">❓ Help</button><button class="btn" id="cp-downloads">⬇️ Downloads</button><button class="btn" id="cp-export-diagnostics">🧾 Export Diagnostics</button></div></div>
    <div class="note-card"><b>Security & Privacy</b><div class="row" style="flex-wrap:wrap"><label><input id="quick-enabled" type="checkbox"> Quick Unlock</label><input id="quick-pin" type="password" inputmode="numeric" maxlength="12" placeholder="PIN (off by default)"><select id="privacy-mode"><option value="standard">Standard</option><option value="private">Private</option></select><button class="btn" id="security-save">Save Security</button></div><div id="security-status" class="dim"></div></div>
    <div class="note-card"><b>Session</b><div class="row"><span class="dim">${escapeHtml(currentUser?.username||'Unknown')} · ${escapeHtml(currentUser?.role||'')}</span><button class="btn" id="cp-logout">Log Out</button></div></div>
  </div>`;
  const stats=body.querySelector('#cp-stats'); const health=body.querySelector('#cp-health-grid');
  const drawStats=r=>{stats.innerHTML=[["CPU",r.cpu_percent==null?'n/a':r.cpu_percent+'%'],["RAM",r.ram_used_percent==null?'n/a':r.ram_used_percent+'%'],["Battery",r.battery_percent==null?'n/a':r.battery_percent+'%'],["Internet",r.online?'Online':'Offline']].map(([a,b])=>`<div class="note-card"><b>${a}</b><div>${escapeHtml(String(b))}</div></div>`).join('');};
  const drawHealth=r=>{const items=[["Internet",r.internet?'✅ Online':'❌ Offline'],["Ping",r.ping?.ok?`${r.ping.latency_ms} ms`:'❌ Failed'],["DNS",(r.dns||[]).length?`${r.dns.length} server(s)`:'⚠️ Unknown'],["Bluetooth",r.bluetooth?.available?(r.bluetooth.powered==null?'Available':(r.bluetooth.powered?'ON':'OFF')):'Unavailable'],["Interfaces",String((r.interfaces||[]).length)], ["EXE",r.capabilities?.exe_runner?'Ready':'Unavailable']]; health.innerHTML=items.map(([a,b])=>`<div class="note-card"><b>${a}</b><div>${escapeHtml(String(b))}</div></div>`).join(''); const bm=r.background_monitor||{}; body.querySelector('#cp-health-detail').textContent=(r.bluetooth?.detail||'Diagnostics refreshed.') + ` · Background monitor: ${bm.status||'starting'}${bm.updated_at?' · '+bm.updated_at:''}`; body.querySelector('#cp-net-details').textContent=JSON.stringify({dns:r.dns,interfaces:r.interfaces,ping:r.ping,bluetooth:r.bluetooth,capabilities:r.capabilities},null,2);};
  drawStats(sys);
  let controlData=null; const refreshControl=async()=>{const r=await api('/api/control-center',{timeoutMs:7000}); if(r.error){body.querySelector('#cp-health-detail').textContent=r.error;return;} controlData=r; drawHealth(r); const sr=await api('/api/system',{timeoutMs:2500}); drawStats(sr);};
  await refreshControl(); const cpMonitor=setInterval(()=>{if(!body.isConnected){clearInterval(cpMonitor);return;} refreshControl();},12000); body.querySelector('#quick-enabled').checked=!!sec.quick_unlock_enabled; body.querySelector('#privacy-mode').value=sec.privacy_mode||'standard';
  body.querySelector('#security-save').onclick=async()=>{const r=await api('/api/security/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quick_unlock_enabled:body.querySelector('#quick-enabled').checked,pin:body.querySelector('#quick-pin').value,privacy_mode:body.querySelector('#privacy-mode').value})});body.querySelector('#security-status').textContent=r.ok?'Saved.':(r.error||'Failed');};
  body.querySelector('#cp-fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>{});};
  body.querySelector('#cp-landscape').onclick=()=>{document.body.classList.toggle('landscape-mode');try{screen.orientation?.lock?.('landscape');}catch(_){};};
  body.querySelector('#cp-settings').onclick=()=>openApp('settings'); body.querySelector('#cp-monitor').onclick=()=>openApp('sysmon'); body.querySelector('#cp-files').onclick=()=>openApp('files'); body.querySelector('#cp-network').onclick=()=>openApp('network'); body.querySelector('#cp-help').onclick=()=>openApp('help'); body.querySelector('#cp-downloads').onclick=()=>openApp('downloads'); body.querySelector('#cp-logout').onclick=logout;
  body.querySelector('#cp-export-diagnostics').onclick=async()=>{const r=await api('/api/control-center',{timeoutMs:8000});const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),version:'2.0-beta',control_center:r},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='DeveloperHCR-control-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);};
  body.querySelectorAll('[data-open-system]').forEach(b=>b.onclick=async()=>{const target=b.dataset.openSystem;const r=await api('/api/system/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target})});body.querySelector('#system-control-status').textContent=r.ok?`Opened ${target.replaceAll('_',' ')}.`:(r.error||'Could not open system control.');});
  const btStatus=body.querySelector('#cp-bt-status'); const btAction=async(action)=>{const r=await api('/api/control-center/bluetooth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});btStatus.textContent=r.error||r.output||`Bluetooth ${action} requested.`;await refreshControl();}; body.querySelector('#cp-bt-refresh').onclick=refreshControl; body.querySelector('#cp-bt-on').onclick=()=>btAction('on'); body.querySelector('#cp-bt-off').onclick=()=>btAction('off'); body.querySelector('#cp-bt-settings').onclick=async()=>{const r=await api('/api/system/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'bluetooth'})});btStatus.textContent=r.error||r.note||'Bluetooth settings requested.';};
  body.querySelector('#cp-network-reset').onclick=async()=>{if(!confirm('Refresh the local DNS/network cache?'))return;const phrase=prompt('Type RESET NETWORK to confirm:');if(phrase!=='RESET NETWORK'){body.querySelector('#network-reset-status').textContent='Reset cancelled.';return;}const r=await api('/api/system/network-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:phrase})});body.querySelector('#network-reset-status').textContent=r.error||r.output||r.note||'Network cache refreshed.';await refreshControl();};
  body.querySelector('#cp-net-diagnostics').onclick=refreshControl;
  body.querySelector('#cp-refresh').onclick=refreshControl;
}

// ================= v1.2: Subscriptions =================
async function renderTradingApp(body){
  const live=await api('/api/trading/live/status',{timeoutMs:5000});
  const state=await api('/api/trading/practice/state');
  const safeState=state.error?{balance:100000,pnl:0,positions:{}}:state;
  const liveReady=!!live.connected && !!live.enabled;
  body.innerHTML=`<div class="stack"><h3>📈 DeveloperHCR Trading</h3>
    <div class="note-card"><b>Broker:</b> Zerodha Kite Connect · <b>Mode:</b> <span id="trade-mode">${liveReady?'LIVE':'PRACTICE'}</span>
      <div class="dim">${live.connected ? (live.enabled?'Live trading is enabled. Real orders require a final confirmation.':'Broker connected, but live order execution is disabled.') : 'No broker session connected. Practice mode remains available.'}</div>
      <div class="row"><button class="btn" id="broker-connect">Connect Broker</button><button class="btn" id="broker-refresh">Refresh</button></div><div id="broker-msg" class="dim"></div></div>
    <div class="trading-dashboard"><div class="note-card"><b>Practice Balance</b><div class="price">₹<span id="paper-balance">${Number(safeState.balance||100000).toFixed(2)}</span></div></div><div class="note-card"><b>Practice P/L</b><div class="price">₹<span id="paper-pnl">${Number(safeState.pnl||0).toFixed(2)}</span></div></div><div class="note-card"><b>Live Account</b><div class="price">${liveReady?'CONNECTED':'OFFLINE'}</div></div></div>
    <div class="note-card"><b>🔴 Live Quote</b><div class="row"><input id="live-symbol" value="RELIANCE" placeholder="NSE symbol"><button class="btn" id="live-quote">Get Live Quote</button></div><pre id="live-quote-out" class="term-log" style="height:130px;">Live market data appears here when broker is connected.</pre></div>
    <div class="note-card"><b>⚠️ Real Order</b><div class="dim">Real-money execution is broker-backed and intentionally gated. You must verify every field and confirm within 120 seconds.</div>
      <div class="row"><input id="live-order-symbol" value="RELIANCE" placeholder="Symbol"><select id="live-side"><option>BUY</option><option>SELL</option></select><input id="live-qty" type="number" value="1" min="1"><select id="live-type"><option>LIMIT</option><option>MARKET</option></select><input id="live-price" type="number" step="0.05" placeholder="Price for LIMIT"><button class="btn" id="live-prepare">Prepare REAL Order</button></div><div id="live-order-msg" class="dim"></div></div>
    <div class="note-card"><b>Live Orders</b><button class="btn" id="live-orders-refresh">Refresh Orders</button><pre id="live-orders" class="term-log" style="height:180px;">Connect broker to view orders.</pre></div>
    <div class="note-card"><b>Practice Trading</b><div class="dim">Practice mode is separate from the live broker and never sends orders to an exchange.</div><div class="row"><input id="trade-symbol" value="RELIANCE"><input id="trade-price" type="number" value="2948.20" step="0.01"><input id="trade-qty" type="number" value="1" min="1"><button class="btn" id="trade-buy">Buy</button><button class="btn" id="trade-sell">Sell</button><button class="btn" id="trade-reset">Reset</button></div><pre id="trade-positions" class="term-log" style="min-height:100px;">${escapeHtml(JSON.stringify(safeState.positions||{},null,2))}</pre></div>
  </div>`;

  body.querySelector('#broker-connect').onclick=async()=>{const r=await api('/api/trading/live/login-url');const msg=body.querySelector('#broker-msg');if(r.error){msg.textContent=r.error;return;}window.open(r.url,'_blank','noopener');msg.textContent='Complete broker login in the opened page, then press Refresh.';};
  body.querySelector('#broker-refresh').onclick=()=>renderTradingApp(body);
  body.querySelector('#live-quote').onclick=async()=>{const sym=body.querySelector('#live-symbol').value.trim().toUpperCase();const r=await api('/api/trading/live/quote?exchange=NSE&symbol='+encodeURIComponent(sym));body.querySelector('#live-quote-out').textContent=JSON.stringify(r,null,2);};
  body.querySelector('#live-prepare').onclick=async()=>{const msg=body.querySelector('#live-order-msg');const order={exchange:'NSE',tradingsymbol:body.querySelector('#live-order-symbol').value.trim().toUpperCase(),transaction_type:body.querySelector('#live-side').value,quantity:Number(body.querySelector('#live-qty').value),order_type:body.querySelector('#live-type').value,product:'CNC',validity:'DAY',price:Number(body.querySelector('#live-price').value)||undefined};const r=await api('/api/trading/live/order/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order)});if(r.error){msg.textContent=r.error;return;}if(!confirm('REAL ORDER\n'+order.transaction_type+' '+order.tradingsymbol+' x '+order.quantity+' @ '+(order.price||'MARKET')+'\nThis can use real money. Continue?')){msg.textContent='Cancelled before broker submission.';return;}const c=await api('/api/trading/live/order/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation_token:r.confirmation_token})});msg.textContent=c.error||('Submitted. Broker order ID: '+c.order_id);};
  body.querySelector('#live-orders-refresh').onclick=async()=>{const r=await api('/api/trading/live/orders');body.querySelector('#live-orders').textContent=JSON.stringify(r,null,2);};
  async function trade(side){const r=await api('/api/trading/practice/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({side,symbol:body.querySelector('#trade-symbol').value,price:Number(body.querySelector('#trade-price').value),qty:Number(body.querySelector('#trade-qty').value)})});if(r.error){body.querySelector('#trade-positions').textContent=r.error;return;}body.querySelector('#paper-balance').textContent=Number(r.balance).toFixed(2);body.querySelector('#paper-pnl').textContent=Number(r.pnl).toFixed(2);body.querySelector('#trade-positions').textContent=JSON.stringify(r.positions||{},null,2);}
  body.querySelector('#trade-buy').onclick=()=>trade('BUY'); body.querySelector('#trade-sell').onclick=()=>trade('SELL'); body.querySelector('#trade-reset').onclick=async()=>{await api('/api/trading/practice/reset',{method:'POST'});renderTradingApp(body);};
}

async function renderSubscriptionApp(body){
  const [r,my]=await Promise.all([api('/api/plans'),api('/api/subscriptions/my-requests')]);
  body.innerHTML=`<div class="stack"><h3>Subscription</h3>
    <div class="dim">Choose a plan. Paid requests go to the configured WhatsApp group/channel for confirmation. An Admin/Admin must approve the request before paid access becomes active.</div>
    <div id="plans-grid" class="plans-grid"></div>
    <div class="note-card"><b>My requests</b><div id="my-sub-requests" class="stack"></div></div>
    <div class="dim">Admin/Admin access is always free with all features. No payment is marked successful automatically.</div></div>`;
  const grid=body.querySelector('#plans-grid');
  grid.innerHTML=(r.plans||[]).map(p=>`<div class="note-card plan-card"><h4>${escapeHtml(p.label)} · ${escapeHtml(p.id)}</h4><div class="price">₹${p.price_inr}</div><div class="dim">${(p.features||[]).map(escapeHtml).join(' · ')}</div><button class="btn sub-request" data-plan="${escapeHtml(p.id)}" data-price="${Number(p.price_inr)||0}">${Number(p.price_inr)===0?'Activate Free':'Request Subscription'}</button><div class="dim sub-status" data-status-for="${escapeHtml(p.id)}"></div></div>`).join('')+`<div class="note-card"><b>Coming tiers</b><div class="dim">${(r.future_prices_inr||[]).map(x=>'₹'+x).join(' · ')||'Admin can add more later.'}</div></div>`;
  const drawRequests=(items)=>{body.querySelector('#my-sub-requests').innerHTML=(items||[]).map(x=>`<div class="note-card"><b>${escapeHtml(x.plan_id)}</b> · ₹${x.price_inr} · <b>${escapeHtml(x.status)}</b><div class="dim">${escapeHtml(x.created_at||'')}${x.reviewed_at?' · reviewed '+escapeHtml(x.reviewed_at):''}</div></div>`).join('')||'<div class="dim">No subscription requests yet.</div>';};
  drawRequests(my.requests||[]);
  body.querySelectorAll('.sub-request').forEach(btn=>btn.onclick=async()=>{
    btn.disabled=true; const status=body.querySelector(`[data-status-for="${CSS.escape(btn.dataset.plan)}"]`);
    const rr=await api('/api/subscriptions/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_id:btn.dataset.plan})});
    if(rr.error){status.textContent=rr.error;btn.disabled=false;return;}
    if(Number(btn.dataset.price)===0){status.textContent='Free plan activated.';playUISound('success');return;}
    status.textContent='Request created. Opening WhatsApp…';
    if(rr.whatsapp_url){window.open(rr.whatsapp_url,'_blank','noopener');status.textContent='Request pending. Confirm payment/details in WhatsApp, then wait for Admin/Admin approval.';}
    else status.textContent='Request pending, but no WhatsApp group/channel is configured yet. Ask the Admin to configure it in Settings → Support.';
    const mine=await api('/api/subscriptions/my-requests');drawRequests(mine.requests||[]);btn.disabled=false;
  });
}

// ================= v1.2: Troubleshooting =================
async function renderTroubleshootApp(body){const r=await api('/api/diagnostics');body.innerHTML=`<div class="stack"><h3>Troubleshooting</h3><div class="dim">Quick diagnostics run here. A full project-file scan is manual so startup never blocks.</div><div id="diag-list"></div><div class="row"><button class="btn" id="diag-refresh">Run Again</button><button class="btn" id="full-file-scan">Scan All Project Files</button></div><div id="full-scan-status" class="dim"></div></div>`;body.querySelector('#diag-list').innerHTML=(r.checks||[]).map(x=>`<div class="note-card"><b>${x.ok?'✅':'⚠️'} ${escapeHtml(x.name)}</b><div class="dim">${escapeHtml(x.detail||'')}</div></div>`).join('');body.querySelector('#diag-refresh').onclick=()=>renderTroubleshootApp(body);body.querySelector('#full-file-scan').onclick=async()=>{const b=body.querySelector('#full-file-scan'),st=body.querySelector('#full-scan-status');b.disabled=true;b.textContent='Scanning…';const x=await api('/api/startup/full-scan');st.textContent=x.error||`Scanned ${x.scanned||0} files · missing ${x.missing_count||0} · ${x.duration_ms||0} ms`;b.disabled=false;b.textContent='Scan All Project Files';};}

async function renderAdminApp(body){
  body.innerHTML=`<div class="stack admin-control-center">
    <div class="admin-hero"><div><div class="admin-kicker">DEVELOPERHCR</div><h2 style="margin:.15rem 0">Admin Control Center</h2><div class="dim">Windows-style system administration · local-first · BETA v2.0</div></div><button class="btn" id="admin-refresh">↻ Refresh</button></div>
    <div id="admin-summary" class="admin-card-grid"><div class="note-card">Loading…</div></div>
    <div class="admin-card-grid">
      <div class="note-card"><b>System Health</b><div id="admin-system" class="dim">Checking…</div></div>
      <div class="note-card"><b>Support Team</b><div id="admin-support" class="dim">Checking feedback…</div><div id="admin-support-contacts" class="admin-contact-list">Loading contacts…</div></div><div class="note-card"><b>GitHub Update</b><div id="admin-update" class="dim">Checking…</div></div>
      <div class="note-card"><b>AI Runtime</b><div id="admin-ai" class="dim">Checking runtime…</div></div>
      <div class="note-card"><b>Security</b><div class="dim">RBAC active · local authentication · audit logging</div></div>
    </div>
    <div class="note-card"><b>Quick Actions</b><div class="row" style="flex-wrap:wrap;margin-top:8px"><button class="btn" data-admin-open="settings">⚙ Settings</button><button class="btn" data-admin-open="apphealth">🩺 App Health</button><button class="btn" data-admin-open="feedback">💬 Feedback & Support</button><button class="btn" data-admin-open="security">🔐 Security Center</button><button class="btn" data-admin-open="updates">⬆ Update Center</button><button class="btn" data-admin-open="troubleshoot">🔧 Troubleshooting</button></div></div>
    <div class="note-card"><b>Users & Access</b><div class="table-scroll"><table id="admin-users-table"><tr><th>User</th><th>Role</th><th>Status</th><th>Plan</th><th>Request</th></tr></table></div></div>
    <div class="note-card"><b>Paid Store Apps</b><div class="dim">Create/update paid apps here. Data is stored in the persistent local DeveloperHCR database.</div><div class="row" style="flex-wrap:wrap"><input id="admin-store-id" placeholder="app-id"><input id="admin-store-name" placeholder="App name"><input id="admin-store-price" type="number" min="0" placeholder="Price ₹" style="width:110px"><input id="admin-store-version" placeholder="1.0.0" style="width:90px"><input id="admin-store-source" placeholder="HTTPS ZIP URL" style="min-width:220px;flex:1"><button class="btn primary" id="admin-store-add">Add / Save Paid App</button></div><div id="admin-store-status" class="dim"></div><div id="admin-store-list"></div></div><div class="note-card"><b>Subscription Requests</b><div id="admin-sub-requests"></div></div>
    <div class="note-card"><b>Create Access User</b><div class="row"><input id="admin-new-name" placeholder="username"><input id="admin-new-pass" type="password" placeholder="password"><select id="admin-new-role"><option>NORMAL_USER</option><option>APPROVED_USER</option><option>SUBSCRIBER</option><option>FRIENDS_ONLY</option></select><button class="btn primary" id="admin-create-user">Create</button></div><div id="admin-create-status" class="dim"></div></div>
  </div>`;
  const load=async()=>{
    const [r,users,requests,health,ai]=await Promise.all([api('/api/admin/dashboard'),api('/api/admin/users'),api('/api/subscriptions/requests'),api('/api/app-health'),api('/api/ai/models')]);
    if(r.error){body.querySelector('#admin-summary').innerHTML=`<div class="auth-error">${escapeHtml(r.error)}</div>`;return;}
    body.querySelector('#admin-summary').innerHTML=`<div class="note-card"><b>${r.open_feedback||0}</b><div class="dim">Open Support</div></div><div class="note-card"><b>${r.system.cpu_percent??'n/a'}%</b><div class="dim">CPU</div></div><div class="note-card"><b>${r.system.ram_used_percent??'n/a'}%</b><div class="dim">RAM</div></div><div class="note-card"><b>${(users.users||[]).length}</b><div class="dim">Accounts</div></div>`;
    body.querySelector('#admin-system').textContent=`${r.system.os||''} · ${r.system.arch||''} · ${health.ok?'Core checks OK':'Review App Health'}`;
    body.querySelector('#admin-support').textContent=`${r.open_feedback||0} open item(s). Feedback & Support is available 24×7 from the app.`;
    body.querySelector('#admin-ai').textContent=ai.error?'Runtime unavailable':`Models: ${(ai.models||[]).length} · local AI status available`;
    const up=await api('/api/updates/check'); const st=await api('/api/settings');
    body.querySelector('#admin-update').textContent=up.error ? ('GitHub check failed: '+up.error) : (up.available ? `Update available: ${up.latest||'new release'} · ${up.name||''}` : `Up to date · ${up.latest||up.current||'current'}`);
    body.querySelector('#admin-support-contacts').innerHTML=`<div>📧 <a href="mailto:developerhcr@gmail.com">developerhcr@gmail.com</a></div><div>📸 <a href="https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw" target="_blank" rel="noopener">@developerhcr — Support Team</a></div><div>📦 <a href="https://github.com/DevevoperHCR/HCRAPP" target="_blank" rel="noopener">GitHub Repository</a></div><div class="dim">No WhatsApp support in this release.</div>`;
    const cat=await api('/api/admin/store/apps'); body.querySelector('#admin-store-list').innerHTML=(cat.apps||[]).map(a=>`<div class="note-card"><b>${escapeHtml(a.icon||'📦')} ${escapeHtml(a.name)}</b> · ₹${Number(a.price_inr)||0} · ${escapeHtml(a.version)}<div class="dim">${escapeHtml(a.id)} · ${escapeHtml(a.description||'')}</div><button class="btn" data-del-store="${escapeHtml(a.id)}">Delete</button></div>`).join('')||'<div class="dim">No custom Store apps yet.</div>';
    body.querySelectorAll('[data-del-store]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this custom Store app?'))return;const rr=await api('/api/admin/store/apps/'+encodeURIComponent(b.dataset.delStore),{method:'DELETE'});if(rr.error)alert(rr.error);else load();});
    body.querySelector('#admin-users-table').innerHTML='<tr><th>User</th><th>Role</th><th>Status</th><th>Plan</th><th>Request</th></tr>'+(users.users||[]).map(u=>`<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.status)}</td><td>${escapeHtml(u.plan||'FREE')}</td><td>${escapeHtml(u.latest_request_status||'-')}</td></tr>`).join('');
    body.querySelector('#admin-sub-requests').innerHTML=(requests.requests||[]).map(x=>`<div class="note-card"><b>#${x.id} ${escapeHtml(x.username)}</b> · ${escapeHtml(x.plan_id)} · ₹${x.price_inr} · <b>${escapeHtml(x.status)}</b><div class="dim">${escapeHtml(x.created_at||'')}</div>${x.status==='pending'?`<div class="row"><button class="btn req-approve" data-id="${x.id}">Approve</button><button class="btn req-reject" data-id="${x.id}">Reject</button></div>`:''}</div>`).join('')||'<div class="dim">No subscription requests.</div>';
  };
  body.querySelector('#admin-refresh').onclick=load;
  body.querySelectorAll('[data-admin-open]').forEach(b=>b.onclick=()=>openApp(b.dataset.adminOpen));
  body.querySelector('#admin-store-add').onclick=async()=>{const id=body.querySelector('#admin-store-id').value.trim(),name=body.querySelector('#admin-store-name').value.trim(),price=Number(body.querySelector('#admin-store-price').value)||0,version=body.querySelector('#admin-store-version').value.trim()||'1.0.0',source=body.querySelector('#admin-store-source').value.trim();const rr=await api('/api/admin/store/apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,price_inr:price,version,source,description:'Admin-managed Store application'})});body.querySelector('#admin-store-status').textContent=rr.error||'Paid app saved.';if(!rr.error){['#admin-store-id','#admin-store-name','#admin-store-price','#admin-store-source'].forEach(x=>body.querySelector(x).value='');playUISound('success');load();}};
  body.querySelector('#admin-create-user').onclick=async()=>{const rr=await api('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:body.querySelector('#admin-new-name').value.trim(),password:body.querySelector('#admin-new-pass').value,role:body.querySelector('#admin-new-role').value})});body.querySelector('#admin-create-status').textContent=rr.error||'User created.';if(!rr.error){playUISound('success');load();}};
  body.querySelector('#admin-sub-requests').addEventListener('click',async(e)=>{const b=e.target.closest('.req-approve,.req-reject');if(!b)return;const approve=b.classList.contains('req-approve');const rr=await api(`/api/subscriptions/requests/${b.dataset.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve})});if(rr.error)alert(rr.error);else load();});
  await load();
}

// ================= APP: About =================
// ================= v1.4: Expanded built-in app suite =================
function renderTextEditorApp(body){
  body.innerHTML=`<div class="stack"><h3>Text / Code Editor</h3>
    <div class="row"><input id="ed-file" type="file" accept=".txt,.md,.py,.js,.json,.html,.css,.csv"><button class="btn" id="ed-new">New</button><button class="btn" id="ed-download">Save / Download</button></div>
    <input id="ed-name" value="untitled.txt" placeholder="filename">
    <textarea id="ed-text" rows="18" style="width:100%;font-family:Consolas,monospace"></textarea>
    <div id="ed-status" class="dim">Local editor — files are read only after you select them.</div></div>`;
  const text=body.querySelector("#ed-text"), name=body.querySelector("#ed-name"), status=body.querySelector("#ed-status");
  body.querySelector("#ed-file").onchange=e=>{const f=e.target.files?.[0];if(!f)return;name.value=f.name;const r=new FileReader();r.onload=()=>{text.value=r.result||"";status.textContent=`Loaded ${f.name} (${f.size} bytes).`};r.readAsText(f);};
  body.querySelector("#ed-new").onclick=()=>{text.value="";name.value="untitled.txt";status.textContent="New local document.";};
  body.querySelector("#ed-download").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text.value],{type:"text/plain;charset=utf-8"}));a.download=name.value||"untitled.txt";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);status.textContent="Saved to Downloads.";};
}

function renderImageViewerApp(body){
  body.innerHTML=`<div class="stack"><h3>Image Viewer</h3><input id="img-file" type="file" accept="image/*"><div class="row"><button class="btn" id="img-zoom-out">➖</button><button class="btn" id="img-zoom-in">➕</button><button class="btn" id="img-reset">Reset</button></div><div style="overflow:auto;text-align:center;background:#050505;border:1px solid var(--border);min-height:260px"><img id="img-view" style="max-width:none;transform-origin:center;display:inline-block" alt=""></div><div id="img-status" class="dim"></div></div>`;
  let zoom=1; const img=body.querySelector("#img-view"), status=body.querySelector("#img-status");
  const draw=()=>img.style.transform=`scale(${zoom})`;
  body.querySelector("#img-file").onchange=e=>{const f=e.target.files?.[0];if(!f)return;img.src=URL.createObjectURL(f);zoom=1;draw();status.textContent=`${f.name} · ${f.size} bytes`;};
  body.querySelector("#img-zoom-in").onclick=()=>{zoom=Math.min(4,zoom+.25);draw()}; body.querySelector("#img-zoom-out").onclick=()=>{zoom=Math.max(.25,zoom-.25);draw()}; body.querySelector("#img-reset").onclick=()=>{zoom=1;draw()};
}

function renderArchiveManagerApp(body){
  body.innerHTML=`<div class="stack"><h3>🗜️ Archive Manager</h3>
    <div class="dim">Inspect ZIP archives locally. Extraction is available through the local DeveloperHCR server and is protected against path traversal.</div>
    <div class="row"><input id="arc-file" type="file" accept=".zip"><button class="btn" id="arc-list">List Archive</button></div>
    <div id="arc-status" class="dim"></div><div id="arc-listing"></div></div>`;
  const file=body.querySelector('#arc-file'), status=body.querySelector('#arc-status'), listing=body.querySelector('#arc-listing');
  body.querySelector('#arc-list').onclick=async()=>{
    if(!file.files?.[0]){status.textContent='Select a ZIP archive first.';return;}
    const f=file.files[0];
    if(!f.name.toLowerCase().endsWith('.zip')){status.textContent='Only ZIP archives are supported in BETA.';return;}
    const form=new FormData(); form.append('archive',f,f.name);
    status.textContent='Reading archive…'; listing.innerHTML='';
    const r=await api('/api/archive/list',{method:'POST',body:form,timeoutMs:30000});
    if(r.error){status.textContent=r.error;return;}
    status.textContent=`${r.count} entries · ${f.name}`;
    listing.innerHTML=(r.entries||[]).map(e=>`<div class="note-card"><b>${escapeHtml(e.name)}</b><div class="dim">${e.directory?'Directory':'File'} · ${e.size} bytes</div></div>`).join('')||'<div class="dim">Archive is empty.</div>';
  };
}

function renderBackupApp(body){
  body.innerHTML=`<div class="stack"><h3>💾 Backup & Restore</h3>
    <div class="dim">Create a local backup of DeveloperHCR settings and user data. Secrets are not exported as plaintext. Restore requires an explicit confirmation.</div>
    <div class="row"><button class="btn primary" id="backup-create">Create Backup</button><input id="backup-file" type="file" accept=".json,.zip"><button class="btn" id="backup-restore">Restore Backup</button></div>
    <div id="backup-status" class="dim"></div></div>`;
  const status=body.querySelector('#backup-status');
  body.querySelector('#backup-create').onclick=async()=>{
    status.textContent='Creating backup…';
    const r=await api('/api/backup/create',{timeoutMs:60000});
    if(r.error){status.textContent=r.error;return;}
    const blob=new Blob([JSON.stringify(r.backup,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=r.filename||'DeveloperHCR-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
    status.textContent='Backup created and downloaded locally.';
  };
  body.querySelector('#backup-restore').onclick=async()=>{
    const f=body.querySelector('#backup-file').files?.[0];
    if(!f){status.textContent='Select a backup JSON file first.';return;}
    if(!confirm('Restore this backup? Current settings may be replaced.')) return;
    try{const data=JSON.parse(await f.text()); const r=await api('/api/backup/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup:data})});status.textContent=r.error||'Backup restored. Restart DeveloperHCR to apply all settings.';}
    catch(e){status.textContent='Invalid backup file.';}
  };
}

function renderPdfViewerApp(body){
  body.innerHTML=`<div class="stack"><h3>PDF Viewer</h3><input id="pdf-file" type="file" accept="application/pdf"><iframe id="pdf-frame" style="width:100%;height:420px;border:1px solid var(--border);background:white"></iframe><div class="dim">Select a local PDF. The browser's PDF renderer handles viewing/searching where supported.</div></div>`;
  body.querySelector("#pdf-file").onchange=e=>{const f=e.target.files?.[0];if(f)body.querySelector("#pdf-frame").src=URL.createObjectURL(f)};
}

function renderMediaPlayerApp(body){
  body.innerHTML=`<div class="stack"><h3>Media Player</h3><input id="media-file" type="file" accept="audio/*,video/*"><video id="media-video" controls style="width:100%;max-height:360px;display:none"></video><audio id="media-audio" controls style="width:100%;display:none"></audio><div id="media-status" class="dim"></div></div>`;
  body.querySelector("#media-file").onchange=e=>{const f=e.target.files?.[0];if(!f)return;const u=URL.createObjectURL(f),v=body.querySelector("#media-video"),a=body.querySelector("#media-audio");v.style.display=f.type.startsWith("video/")?"block":"none";a.style.display=f.type.startsWith("audio/")?"block":"none";(v.style.display==="block"?v:a).src=u;body.querySelector("#media-status").textContent=`Playing ${f.name}`;};
}

function renderCalendarApp(body){
  const key="hcr-calendar-events";
  let events=[]; try{events=JSON.parse(localStorage.getItem(key)||"[]")}catch(_){}
  const draw=()=>{body.querySelector("#cal-list").innerHTML=events.map((e,i)=>`<div class="note-card"><b>${escapeHtml(e.date)}</b> — ${escapeHtml(e.title)} <button class="btn" data-del="${i}">Delete</button></div>`).join("")||'<div class="dim">No reminders.</div>';body.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{events.splice(Number(b.dataset.del),1);localStorage.setItem(key,JSON.stringify(events));draw()})};
  body.innerHTML=`<div class="stack"><h3>Calendar & Reminders</h3><div class="row"><input id="cal-date" type="date"><input id="cal-title" placeholder="Reminder" style="flex:1"><button class="btn" id="cal-add">Add</button></div><div id="cal-list"></div></div>`; draw();
  body.querySelector("#cal-add").onclick=()=>{const d=body.querySelector("#cal-date").value,t=body.querySelector("#cal-title").value.trim();if(!d||!t)return;events.push({date:d,title:t});events.sort((a,b)=>a.date.localeCompare(b.date));localStorage.setItem(key,JSON.stringify(events));body.querySelector("#cal-title").value="";draw()};
}

function renderClipboardApp(body){
  body.innerHTML=`<div class="stack"><h3>Clipboard Manager</h3><textarea id="clip-text" rows="10" style="width:100%" placeholder="Paste or type text here..."></textarea><div class="row"><button class="btn" id="clip-read">Read Clipboard</button><button class="btn" id="clip-copy">Copy</button><button class="btn" id="clip-clear">Clear</button></div><div id="clip-status" class="dim">Browser clipboard permission is required for system clipboard access.</div></div>`;
  const t=body.querySelector("#clip-text"),s=body.querySelector("#clip-status");
  body.querySelector("#clip-read").onclick=async()=>{try{t.value=await navigator.clipboard.readText();s.textContent="Clipboard read."; }catch(e){s.textContent="Clipboard permission unavailable.";}}; body.querySelector("#clip-copy").onclick=async()=>{try{await navigator.clipboard.writeText(t.value);s.textContent="Copied."; }catch(e){s.textContent="Clipboard permission unavailable.";}}; body.querySelector("#clip-clear").onclick=()=>{t.value=""};
}

function renderNetworkToolsApp(body){
  body.innerHTML=`<div class="stack"><h3>🌐 HCR Network Tools</h3><div class="row"><button class="btn primary" id="net-refresh">🩺 Full Diagnostics</button><button class="btn" id="net-open-settings">⚙️ Network Settings</button></div><pre id="net-out" class="term-log" style="height:300px"></pre><div class="dim">Checks internet, latency, DNS, local interfaces and Bluetooth capability. It does not bypass firewalls or scan networks without authorization.</div></div>`;
  body.querySelector("#net-refresh").onclick=async()=>{const b=body.querySelector('#net-refresh');b.disabled=true;b.textContent='Checking…';const r=await api("/api/control-center",{timeoutMs:8000});body.querySelector("#net-out").textContent=JSON.stringify(r,null,2);b.disabled=false;b.textContent='🩺 Full Diagnostics';};
  body.querySelector('#net-open-settings').onclick=async()=>{const r=await api('/api/system/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'network_settings'})});body.querySelector('#net-out').textContent=r.error||r.note||'Network settings requested.';};
  body.querySelector("#net-refresh").click();
}

function renderProcessManagerApp(body){
  body.innerHTML=`<div class="stack"><h3>Process Manager</h3><button class="btn" id="proc-refresh">Refresh</button><table id="proc-table"><tr><th>PID</th><th>Name</th><th>CPU</th><th>Memory</th><th>Action</th></tr></table><div id="proc-status" class="dim"></div></div>`;
  const refresh=async()=>{const r=await api("/api/processes");const t=body.querySelector("#proc-table");t.innerHTML="<tr><th>PID</th><th>Name</th><th>CPU</th><th>Memory</th><th>Action</th></tr>"+(r.processes||[]).map(p=>`<tr><td>${p.pid}</td><td>${escapeHtml(p.name||"")}</td><td>${p.cpu_percent??"N/A"}</td><td>${p.memory_percent??"N/A"}%</td><td><button class="btn" data-kill="${p.pid}">Stop</button></td></tr>`).join("");t.querySelectorAll("[data-kill]").forEach(b=>b.onclick=async()=>{if(!confirm("Stop process "+b.dataset.kill+"?"))return;const x=await api("/api/processes/"+b.dataset.kill+"/kill",{method:"POST"});body.querySelector("#proc-status").textContent=x.error||"Command sent.";refresh()})};body.querySelector("#proc-refresh").onclick=refresh;refresh();
}

function renderSecurityCenterApp(body){
  const esc=escapeHtml;
  body.innerHTML=`<div class="stack"><h3>🔐 Security Center</h3><div class="note-card"><b>App Lock</b><div class="dim">Lock individual DeveloperHCR apps with a local PIN. This protects apps inside HCR; it is not Android/Windows OS encryption.</div><div class="row"><select id="sec-app-select" style="flex:1"></select><button class="btn primary" id="sec-lock-toggle">Lock / Unlock</button></div><div id="sec-lock-status" class="dim"></div></div><div class="note-card"><b>Account Security</b><div class="row"><button class="btn" id="sec-refresh">Refresh Security Summary</button><button class="btn" id="sec-quick">Open Quick Unlock Settings</button></div><pre id="sec-out" class="term-log"></pre></div></div>`;
  const sel=body.querySelector('#sec-app-select'),status=body.querySelector('#sec-lock-status');
  const lockable=APPS.filter(a=>!['settings','security','store'].includes(a.id));
  sel.innerHTML=lockable.map(a=>`<option value="${esc(a.id)}">${esc(a.glyph)} ${esc(a.name)}</option>`).join('');
  const refreshLocks=()=>{const locks=hcrLockedApps();status.textContent=locks.length?`Locked: ${locks.map(id=>APPS.find(a=>a.id===id)?.name||id).join(', ')}`:'No app locks configured.';};
  body.querySelector('#sec-lock-toggle').onclick=async()=>{try{const locked=await hcrConfigureAppLock(sel.value);status.textContent=locked?'App locked.':'App unlocked.';refreshLocks();}catch(e){status.textContent=e.message||String(e);}};
  body.querySelector('#sec-refresh').onclick=async()=>{const m=await api('/api/auth/me');body.querySelector('#sec-out').textContent=JSON.stringify({user:m.user,locked_apps:hcrLockedApps(),note:'App Lock is local UI protection; server authentication remains authoritative.'},null,2);refreshLocks();};
  body.querySelector('#sec-quick').onclick=()=>openApp('settings');
  refreshLocks();body.querySelector('#sec-refresh').click();
}

async function renderToolchainsApp(body) {
  const r = await api('/api/toolchains');
  body.innerHTML = `<div class="stack"><h3>🧰 Developer Toolchains</h3><div class="dim">Install real language/compiler toolchains using the operating system package manager. Installation is explicit and may require administrator permission.</div><div id="toolchain-list"></div><div id="toolchain-status" class="dim"></div></div>`;
  const list=body.querySelector('#toolchain-list'), status=body.querySelector('#toolchain-status');
  list.innerHTML=(r.toolchains||[]).map(t=>`<div class="note-card toolchain-card"><div class="row"><b>${escapeHtml(t.name)}</b><span class="badge">${escapeHtml(t.id)}</span><span class="dim">${t.installed?'Installed':'Not installed'}</span></div><div class="dim">${escapeHtml(t.description)}</div><div class="dim">Command: ${escapeHtml(t.command||'—')}</div><button class="btn" data-install-toolchain="${escapeHtml(t.id)}">${t.installed?'Re-check':'Install / Download'}</button></div>`).join('');
  list.querySelectorAll('[data-install-toolchain]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Installing…';const x=await api('/api/toolchains/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.installToolchain}) ,timeoutMs:120000});status.textContent=x.error||x.message||'Installation finished.';b.disabled=false;b.textContent='Re-check';if(x.ok)playUISound('success');});
}

async function renderRepositoryApp(body) {
  body.innerHTML=`<div class="stack"><h3>📦 DevApps Repository</h3><div class="dim">Connected repository for future HCR Store app publications. New apps are shown when the public repository publishes an apps.json/store.json/manifest.json catalog.</div><div id="repo-status" class="note-card">Checking repository…</div><div id="repo-apps"></div><button class="btn" id="repo-refresh">↻ Refresh Repository</button></div>`;
  async function refresh(){const out=body.querySelector('#repo-status'),apps=body.querySelector('#repo-apps');out.textContent='Checking…';const r=await api('/api/repository/status',{timeoutMs:8000});if(!r.ok){out.textContent='Repository unavailable right now: '+(r.error||'offline');apps.innerHTML='';return;}out.innerHTML=`<b>Connected:</b> ${escapeHtml(r.repository)}<div class="dim">${r.apps_manifest?`Catalog: ${escapeHtml(r.apps_manifest)}`:'No app manifest published yet.'}</div>`;const list=Array.isArray(r.apps)?r.apps:[];apps.innerHTML=list.length?list.map(a=>`<div class="note-card"><b>${escapeHtml(a.name||a.id||'Unnamed app')}</b><div class="dim">${escapeHtml(a.description||'Repository app')}</div></div>`).join(''):'<div class="dim">Repository is connected. Publish apps.json to populate Store automatically.</div>'; }
  body.querySelector('#repo-refresh').onclick=refresh; refresh();
}

function renderCodePlaygroundApp(body) {
  const langs=[['python','Python'],['cpp','C++'],['javascript','JavaScript'],['typescript','TypeScript'],['rust','Rust'],['go','Go'],['java','Java'],['c','C']];
  body.innerHTML=`<div class="stack"><h3>🧪 Code Playground</h3><div class="row"><select id="play-lang">${langs.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select><button class="btn" id="play-run">Run</button><button class="btn" id="play-save">Download Source</button></div><textarea id="play-code" rows="14" spellcheck="false">print("Hello from DeveloperHCR")</textarea><pre id="play-out" class="term-log" style="height:150px;"></pre><div class="dim">Only locally supported runtimes can execute. Unsupported languages can still be edited/downloaded; install them from Developer Toolchains first.</div></div>`;
  const code=body.querySelector('#play-code'), out=body.querySelector('#play-out'), lang=body.querySelector('#play-lang');
  const samples={python:'print("Hello from DeveloperHCR")',cpp:'#include <iostream>\nint main(){ std::cout << "Hello from DeveloperHCR\\n"; }',javascript:'console.log("Hello from DeveloperHCR")',typescript:'console.log("Hello from DeveloperHCR")',rust:'fn main(){ println!("Hello from DeveloperHCR"); }',go:'package main\nimport "fmt"\nfunc main(){fmt.Println("Hello from DeveloperHCR")}',java:'class Main { public static void main(String[] args){ System.out.println("Hello from DeveloperHCR"); }}',c:'#include <stdio.h>\nint main(){ puts("Hello from DeveloperHCR"); }'};
  lang.onchange=()=>code.value=samples[lang.value]||'';
  body.querySelector('#play-run').onclick=async()=>{out.textContent='Running locally…';const r=await api('/api/toolchains/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:lang.value,code:code.value}),timeoutMs:20000});out.textContent=r.output||r.error||'No output.';};
  body.querySelector('#play-save').onclick=()=>{const ext={python:'py',cpp:'cpp',javascript:'js',typescript:'ts',rust:'rs',go:'go',java:'java',c:'c'}[lang.value]||'txt';const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([code.value],{type:'text/plain'}));a.download=`main.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);};
}

function renderHelpApp(body){
  body.innerHTML=`<div class="stack"><h3>Help Center</h3><div class="note-card"><b>AI</b><div>Use AI Chat after Ollama/GGUF is available. No model means no fake response.</div></div><div class="note-card"><b>Updates</b><div>ADMIN configures the GitHub repository. Update announcements appear in Update Center.</div></div><div class="note-card"><b>Privacy</b><div>Private user content is not exposed by Admin/Admin dashboards by default.</div></div><div class="note-card"><b>Keyboard</b><div>Window titlebar: drag · double-click: maximize · corner: resize · taskbar: restore.</div></div></div>`;
}

async function renderAboutApp(body) {
  const sys = await api("/api/system");
  body.innerHTML = `<div class="stack"><div style="font-size:1.25rem"><b>DeveloperHCR:AI Agent</b> — BETA</div><div class="dim">Version ${escapeHtml(sys.app_version)} · V2.0 BETA</div><hr><div><b>Purpose:</b> AI Agent + Local AI Studio + Desktop Environment + Browser + Store + Developer Tools.</div><div><b>Desktop:</b> Full-screen, landscape-first, movable, resizable, minimizable and maximizable windows with taskbar zoom controls.</div><div><b>AI:</b> HCR AI Agent supports configured Ollama/GGUF runtimes. Models are detected honestly; explicit Ollama model download is available from AI Models.</div><div><b>Access:</b> Free, ₹1, ₹10 and ₹100 tiers are defined. Admin/Admin are free with all features. Paid access is not treated as paid until a real payment provider/server verification is integrated.</div><div><b>Privacy:</b> Admin/Admin dashboards use aggregate usage/security/support data. Private/E2EE mode is never represented as implemented encryption unless the actual encryption boundary is configured.</div><div><b>Store:</b> HCR Store supports explicit app/plugin installation with HTTPS and archive path validation.</div><div><b>Updates:</b> Admin chooses the repository in Settings; the app checks releases and can download/validate an update archive. Apply/restart remains controlled.</div><div><b>Platform:</b> ${escapeHtml(sys.os)} ${escapeHtml(sys.os_release)} · ${escapeHtml(sys.arch)} · Python ${escapeHtml(sys.python)}</div><div class="dim">Existing modular features are preserved; V2.0 BETA remains a test release; later improvements are additive. Unsupported capabilities are labelled instead of shown as fake working buttons.</div></div>`;
}

boot();


// ================= v1.1: HCR Store =================
const unlockedFeatures = new Set(JSON.parse(localStorage.getItem("hcr-unlocked-features") || "[]"));
async function renderStoreApp(body) {
  const [r, settings] = await Promise.all([api("/api/store"), api("/api/settings")]);
  if(r.error){body.innerHTML=`<div class="dim">${escapeHtml(r.error)}</div>`;return;}
  body.innerHTML=`<div class="stack"><h3>HCR Store</h3><div class="dim">Built-in apps are already included. Optional remote apps install only after explicit user action and HTTPS validation. Items marked 🔒 need their own password (separate from your login) — ask the Admin if you don't have it.</div><div id="store-list"></div></div>`;
  const localStore = APPS.map(a=>({app_id:a.id,name:a.name,version:"1.0.0",category:(a.feature?"Premium / Feature locked":"Built-in"),description:(a.feature?`Requires ${a.feature} access.`:"DeveloperHCR built-in app"),builtin:true,feature:a.feature||"",roleMin:a.roleMin||""}));
  localStore.push({app_id:"camera",name:"HCR Camera Monitor",version:"1.0.0",category:"Utilities / Camera",description:"Visible camera preview with explicit Android/PC permission; camera stops when the app closes.",builtin:true,feature:"",roleMin:"",available:true,renderer:"camera"});
  const storeApps = [...(r.apps||[])];
  const seen = new Set(storeApps.map(a=>a.app_id||a.id));
  localStore.forEach(a=>{if(!seen.has(a.app_id)) storeApps.push(a);});
  if (["ADMIN","GUEST"].includes(currentUser?.role)) { for (const a of storeApps) { if (Number(a.price_inr) > 0) a.owner_free = true; } }
  body.querySelector("#store-list").innerHTML=storeApps.map(a=>{
    const key = a.app_id || a.id;
    const roleLocked=(a.feature && !appAllowed(a)) || (a.roleMin && !(currentUser && (currentUser.role===a.roleMin)));
    const passwordLocked = !!a.locked && !unlockedFeatures.has(key) && !["ADMIN","GUEST"].includes(currentUser?.role);
    const paid = Number(a.price_inr || 0) > 0;
    let action;
    if (passwordLocked && paid) {
      action = `<div class="stack store-lock-box" data-key="${escapeHtml(key)}">
        <div class="row" style="justify-content:space-between"><span class="badge">🔒 PAID / LOCKED</span><b>₹${Number(a.price_inr)}</b></div>
        <div class="row"><input type="password" class="store-pw-input" placeholder="Activation password" style="flex:1"><button class="btn store-unlock-btn">🔓 Unlock</button></div>
        <div class="store-pw-error auth-error"></div>
        <button class="btn store-paid-request" data-id="${escapeHtml(a.id || key)}" data-name="${escapeHtml(a.name||key)}" data-price="${Number(a.price_inr)}">Pay / Request ₹${Number(a.price_inr)}</button>
        <div class="dim">Payment/request and activation are separate. After approval, use the app's activation password. Use the official Support Team contacts in Feedback & Support.</div>
      </div>`;
    } else if (passwordLocked) {
      action = `<div class="stack store-lock-box" data-key="${escapeHtml(key)}">
        <div class="row"><input type="password" class="store-pw-input" placeholder="Feature password" style="flex:1"><button class="btn store-unlock-btn">🔒 Unlock</button></div>
        <div class="store-pw-error auth-error"></div>
        ${whatsapp ? `<a href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener" class="dim">Don't have the password? Ask on WhatsApp →</a>` : `<div class="dim">Don't have the password? Ask the Admin directly.</div>`}
      </div>`;
    } else if (roleLocked) {
      action = `<button class="btn" disabled>🔒 Disabled — upgrade / permission required</button>`;
    } else if (a.builtin) {
      action = `<div class="row"><button class="btn" data-open="${escapeHtml(key)}">Open</button></div>`;
    } else if (a.available === false) {
      action = `<button class="btn" disabled>Not published yet</button>`;
    } else if (Number(a.price_inr) > 0) {
      if (["ADMIN","GUEST"].includes(currentUser?.role)) {
        action = `<div class="owner-free-badge">✓ FREE — no payment required in this access mode</div><div class="dim">External package must still be published/installed before it can run.</div>`;
      } else {
        action = `<button class="btn store-paid-request" data-id="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name||a.id)}" data-price="${Number(a.price_inr)}">Pay / Request ₹${Number(a.price_inr)}</button><div class="dim">First, you will enter the reason for this app. Then WhatsApp opens for payment/confirmation. Support: ${escapeHtml(supportEmail)}</div>`;
      }
    } else {
      action = `<button class="btn" data-id="${escapeHtml(a.id)}" data-v="${escapeHtml(a.version||"1.0.0")}" data-src="${escapeHtml(a.source||"")}">Install</button>`;
    }
    return `<div class="note-card"><b>${a.locked?"🔒 ":""}${escapeHtml(a.name||a.id)}</b> · v${escapeHtml(a.version||"?")}<div class="dim">${escapeHtml(a.category||"App")} — ${escapeHtml(a.description||"")}</div>${action}</div>`;
  }).join("");
  body.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openApp(b.dataset.open));
  body.querySelectorAll(".store-paid-request").forEach(b=>b.onclick=async()=>{
    const reason = window.prompt("Aap yah app kis kaaran se lena chahte hain?", "Main is app ko DeveloperHCR mein use karna chahta/chahti hoon.");
    if (!reason || !reason.trim()) return;
    b.disabled = true; b.textContent = "Creating request…";
    const rr = await api("/api/store/request", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({app_id:b.dataset.id,app_name:b.dataset.name,price_inr:Number(b.dataset.price),note:reason})});
    if (rr.error) { b.disabled=false; b.textContent=`Pay / Request ₹${Number(b.dataset.price)}`; alert(rr.error); return; }
    if (rr.whatsapp_url) window.open(rr.whatsapp_url, "_blank", "noopener");
    b.textContent = "Request sent ✓";
    playUISound("success");
  });
  body.querySelectorAll("[data-id]").forEach(b=>b.onclick=async()=>{
    const rr=await api("/api/store/install",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:b.dataset.id,version:b.dataset.v,source:b.dataset.src})});
    b.textContent=rr.ok?"Installed":"Failed: "+(rr.error||"");
    if(rr.ok){
      // Built-in/registered apps become desktop shortcuts immediately after
      // an explicit Store install. Remote plugins still require their own
      // runtime/manifest before they can be launched.
      if(APPS.some(a=>a.id===rr.app_id)){
        addDesktopShortcut(rr.app_id);
        buildLauncher();
      }
      playUISound("success");
    }
  });
  body.querySelectorAll(".store-lock-box").forEach(box=>{
    const key = box.dataset.key;
    const input = box.querySelector(".store-pw-input");
    const err = box.querySelector(".store-pw-error");
    const submit = async () => {
      const pw = input.value;
      if (!pw) { err.textContent = "Enter the feature password."; return; }
      const rr = await api("/api/store/unlock", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({app_id:key, password:pw})});
      if (rr.error) { err.textContent = rr.error; playUISound("error"); return; }
      unlockedFeatures.add(key);
      localStorage.setItem("hcr-unlocked-features", JSON.stringify([...unlockedFeatures]));
      playUISound("success");
      renderStoreApp(body);
    };
    box.querySelector(".store-unlock-btn").onclick = submit;
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  });
}


// ================= V2.0 BETA+: Standalone game windows =================
function renderVoxelWorldApp(body) {
  body.innerHTML=`<div class="stack voxel-app"><div class="row"><div><h3 style="margin:0">🧱 HCR Voxel World</h3><div class="dim">Original block-building sandbox inspired by voxel survival games.</div></div><span class="badge">3D-style</span></div>
  <div class="note-card"><canvas id="voxel-canvas" width="900" height="520" style="width:100%;height:auto;border-radius:12px;display:block;background:#111"></canvas><div class="row" style="justify-content:space-between;margin-top:8px"><span class="dim">WASD / arrows: move · Click/tap block: place · Right-click/long press: remove</span><button class="btn" id="voxel-reset">Reset World</button></div></div>
  <div class="row voxel-controls"><button class="btn" data-v="up">▲</button><button class="btn" data-v="left">◀</button><button class="btn" data-v="down">▼</button><button class="btn" data-v="right">▶</button><button class="btn" id="voxel-add">➕ Block</button><button class="btn" id="voxel-remove">➖ Block</button></div></div>`;
  const c=body.querySelector('#voxel-canvas'),ctx=c.getContext('2d'),cols=24,rows=16,world=[];let px=12,py=8,mode='add';
  const palette=['#55a34a','#8b6b3e','#6c757d','#3d8fd1','#d4a24c'];
  const seed=()=>{world.length=0;for(let y=0;y<rows;y++){world[y]=[];for(let x=0;x<cols;x++){const edge=x<2||y<2||x>cols-3||y>rows-3;world[y][x]=edge?1:(Math.random()<.10?Math.floor(Math.random()*palette.length):0);}}px=12;py=8;draw();};
  function draw(){const cw=c.width/cols,ch=c.height/rows;ctx.clearRect(0,0,c.width,c.height);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const b=world[y][x]||0;ctx.fillStyle=palette[b]||palette[0];ctx.fillRect(x*cw,y*ch,cw-2,ch-2);if(b){ctx.fillStyle='rgba(255,255,255,.13)';ctx.fillRect(x*cw,y*ch,cw-2,Math.max(3,ch*.16));ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(x*cw,y*ch+ch*.82,cw-2,ch*.16);} }ctx.strokeStyle='rgba(255,255,255,.07)';for(let x=0;x<=cols;x++){ctx.beginPath();ctx.moveTo(x*cw,0);ctx.lineTo(x*cw,c.height);ctx.stroke();}for(let y=0;y<=rows;y++){ctx.beginPath();ctx.moveTo(0,y*ch);ctx.lineTo(c.width,y*ch);ctx.stroke();}ctx.fillStyle='#fff';ctx.beginPath();ctx.arc((px+.5)*cw,(py+.5)*ch,Math.min(cw,ch)*.28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#111';ctx.fillText('P',(px+.38)*cw,(py+.63)*ch);}
  function move(dx,dy){const nx=Math.max(0,Math.min(cols-1,px+dx)),ny=Math.max(0,Math.min(rows-1,py+dy));if(world[ny][nx]===0){px=nx;py=ny;draw();}}
  function cell(e){const r=c.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/r.width*cols),y=Math.floor((e.clientY-r.top)/r.height*rows);if(x<0||y<0||x>=cols||y>=rows)return;if(mode==='remove')world[y][x]=0;else if(world[y][x]===0)world[y][x]=1+Math.floor(Math.random()*4);draw();}
  c.addEventListener('click',e=>cell(e));c.addEventListener('contextmenu',e=>{e.preventDefault();mode='remove';cell(e);mode='add';});
  window.addEventListener('keydown',e=>{if(!body.isConnected)return;const k=e.key.toLowerCase();if(k==='w'||k==='arrowup')move(0,-1);else if(k==='s'||k==='arrowdown')move(0,1);else if(k==='a'||k==='arrowleft')move(-1,0);else if(k==='d'||k==='arrowright')move(1,0);});
  body.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{const m=b.dataset.v;move(m==='left'?-1:m==='right'?1:0,m==='up'?-1:m==='down'?1:0);});
  body.querySelector('#voxel-add').onclick=()=>mode='add';body.querySelector('#voxel-remove').onclick=()=>mode='remove';body.querySelector('#voxel-reset').onclick=seed;seed();
}

function renderStandaloneGameApp(body, gameId) {
  const titles={snake:"🐍 Snake 2D",pong:"🏓 Pong 2D",tetris:"🧱 Block Drop 2D",memory:"🧠 Memory Match 2D",ttt:"⭕ Tic-Tac-Toe 2D",reflex:"⚡ Reflex Challenge",cube:"🧊 Cube 3D",orbit:"🪐 Orbit 3D",dice:"🎲 Dice Roller",guess:"🔢 Guess the Number",breakout:"🧱 Breakout 2D",mines:"💣 Minesweeper 2D",flappy:"🐦 Flappy 2D",maze:"🌀 Maze 2D",starfield:"🌌 Starfield 3D",solar:"☀️ Solar System 3D"};
  body.innerHTML=`<div class="stack"><div class="row" style="justify-content:space-between"><h3>${titles[gameId]||"HCR Game"}</h3><span class="badge">Standalone Game</span></div><div id="standalone-game-stage" class="game-stage"></div><div class="row"><button class="btn" id="game-restart">↻ Restart</button><button class="btn" id="game-exit">✕ Close Game</button></div><div id="game-status" class="dim">Ready.</div></div>`;
  const stage=body.querySelector('#standalone-game-stage'),status=body.querySelector('#game-status');
  let cleanup=()=>{};
  const setCleanup=fn=>{try{cleanup();}catch(_){}cleanup=fn||(()=>{});};
  const start=()=>{
    setCleanup(); stage.innerHTML='';
    if(gameId==='cube'){
      stage.innerHTML='<div class="cube-scene"><div class="cube3d"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="dim">Local CSS 3D demo.</div>';status.textContent='Running 3D cube demo.';return;
    }
    if(gameId==='orbit'){
      stage.innerHTML='<div class="orbit-scene"><div class="orbit-star"></div><div class="orbit-ring orbit-a"></div><div class="orbit-ring orbit-b"></div><div class="orbit-planet"></div></div><div class="dim">Local CSS 3D orbit demo.</div>';status.textContent='Running 3D orbit demo.';return;
    }
    if(gameId==='starfield'){
      stage.innerHTML='<canvas id="sg-starfield" width="520" height="300" class="game-canvas"></canvas><div class="dim">Interactive local 3D-style starfield. Drag/touch to steer.</div>';const c=stage.querySelector('#sg-starfield'),ctx=c.getContext('2d');let stars=Array.from({length:90},()=>({x:Math.random()*520-260,y:Math.random()*300-150,z:Math.random()*500+1})),run=true,px=0,py=0,timer;const draw=()=>{ctx.fillStyle='#050811';ctx.fillRect(0,0,c.width,c.height);for(const s of stars){s.z-=3;if(s.z<1){s.x=Math.random()*520-260;s.y=Math.random()*300-150;s.z=500;}const k=260/s.z,x=c.width/2+s.x*k+px,y=c.height/2+s.y*k+py,r=Math.max(.5,3*k);ctx.fillStyle='#fff';ctx.fillRect(x,y,r,r)}timer=requestAnimationFrame(draw)};const steer=e=>{const r=c.getBoundingClientRect();px=Math.max(-60,Math.min(60,(e.clientX-r.left-r.width/2)*.2));py=Math.max(-40,Math.min(40,(e.clientY-r.top-r.height/2)*.2));};c.addEventListener('pointermove',steer);draw();status.textContent='Running Starfield 3D demo.';return()=>{run=false;cancelAnimationFrame(timer);c.removeEventListener('pointermove',steer);};
    }
    if(gameId==='solar'){
      stage.innerHTML='<div class="solar-scene"><div class="solar-sun"></div><div class="solar-orbit o1"><div class="solar-planet p1"></div></div><div class="solar-orbit o2"><div class="solar-planet p2"></div></div><div class="solar-orbit o3"><div class="solar-planet p3"></div></div></div><div class="dim">Local CSS 3D solar-system animation.</div>';status.textContent='Running Solar System 3D demo.';return()=>{};
    }
    if(gameId==='breakout'){
      stage.innerHTML='<canvas id="sg-breakout" width="520" height="300" class="game-canvas" tabindex="0"></canvas><div class="dim">Move the paddle with touch/mouse. Clear all blocks.</div>';const c=stage.querySelector('#sg-breakout'),ctx=c.getContext('2d');let x=250,y=250,vx=3,vy=-3,pad=70,px=225,blocks=Array.from({length:35},(_,i)=>({x:10+(i%7)*72,y:20+Math.floor(i/7)*22,on:true})),run=true,timer;const move=e=>{const r=c.getBoundingClientRect();px=Math.max(0,Math.min(520-pad,(e.clientX-r.left)/r.width*520-pad/2));};const loop=()=>{if(!run)return;x+=vx;y+=vy;if(x<5||x>515)vx*=-1;if(y<5)vy=Math.abs(vy);if(y>245&&y<270&&x>px&&x<px+pad)vy=-Math.abs(vy);for(const b of blocks){if(b.on&&x>b.x&&x<b.x+60&&y>b.y&&y<b.y+14){b.on=false;vy*=-1;break;}}if(y>300){status.textContent='Game over — press Restart.';return;}ctx.fillStyle='#07101d';ctx.fillRect(0,0,520,300);blocks.forEach(b=>{if(b.on){ctx.fillStyle='#4f8cff';ctx.fillRect(b.x,b.y,60,14)}});ctx.fillStyle='#fff';ctx.fillRect(px,275,pad,10);ctx.beginPath();ctx.arc(x,y,7,0,7);ctx.fill();timer=requestAnimationFrame(loop);};c.addEventListener('pointermove',move);loop();status.textContent='Running Breakout 2D.';return()=>{run=false;cancelAnimationFrame(timer);c.removeEventListener('pointermove',move);};
    }
    if(gameId==='mines'){
      stage.innerHTML='<div id="mine-grid" class="memory-grid"></div><div class="dim">Tap cells to reveal. Avoid 10 hidden mines.</div>';const grid=stage.querySelector('#mine-grid');const N=36,M=10;let mines=new Set();while(mines.size<M)mines.add(Math.floor(Math.random()*N));let done=false;const count=i=>{const x=i%6,y=Math.floor(i/6);let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx>=0&&nx<6&&ny>=0&&ny<6&&mines.has(ny*6+nx))n++;}return n;};grid.innerHTML=Array.from({length:N},(_,i)=>`<button class="btn memory-card mine-cell" data-i="${i}">?</button>`).join('');grid.querySelectorAll('.mine-cell').forEach(b=>b.onclick=()=>{if(done||b.disabled)return;const i=Number(b.dataset.i);if(mines.has(i)){b.textContent='💣';done=true;status.textContent='Mine hit — press Restart.';grid.querySelectorAll('.mine-cell').forEach(x=>{const j=Number(x.dataset.i);if(mines.has(j))x.textContent='💣';x.disabled=true;});return;}b.textContent=String(count(i)||'');b.disabled=true;if([...grid.querySelectorAll('.mine-cell')].filter(x=>!x.disabled).length===M){done=true;status.textContent='You cleared the board!';}});status.textContent='Running Minesweeper 2D.';return()=>{};
    }
    if(gameId==='flappy'){
      stage.innerHTML='<canvas id="sg-flappy" width="420" height="300" class="game-canvas" tabindex="0"></canvas><button class="btn" id="flap">Flap</button><div class="dim">Tap Flap or press Space.</div>';const c=stage.querySelector('#sg-flappy'),ctx=c.getContext('2d'),flap=stage.querySelector('#flap');let birdY=140,vy=0,pipeX=420,gap=110,score=0,run=true,timer;const jump=()=>{vy=-6};flap.onclick=jump;const key=e=>{if(e.code==='Space'){e.preventDefault();jump();}};window.addEventListener('keydown',key);const loop=()=>{if(!run)return;vy+=.28;birdY+=vy;pipeX-=2.4;if(pipeX<-60){pipeX=420;gap=70+Math.random()*140;score++;}if(birdY<0||birdY>290||(pipeX<55&&pipeX>0&&(birdY<gap-50||birdY>gap+50))){status.textContent='Game over — press Restart.';return;}ctx.fillStyle='#0b1725';ctx.fillRect(0,0,420,300);ctx.fillStyle='#58c878';ctx.fillRect(pipeX,0,55,gap-50);ctx.fillRect(pipeX,gap+50,55,300);ctx.fillStyle='#ffd66b';ctx.beginPath();ctx.arc(55,birdY,12,0,7);ctx.fill();ctx.fillStyle='#fff';ctx.fillText('Score '+score,10,18);timer=requestAnimationFrame(loop);};loop();status.textContent='Running Flappy 2D.';return()=>{run=false;cancelAnimationFrame(timer);window.removeEventListener('keydown',key);};
    }
    if(gameId==='maze'){
      stage.innerHTML='<canvas id="sg-maze" width="420" height="300" class="game-canvas" tabindex="0"></canvas><div class="dim">Reach the green goal with arrow keys or WASD.</div>';const c=stage.querySelector('#sg-maze'),ctx=c.getContext('2d');const map=['111111111111111','100000000000001','101111011111101','100001010000001','111101011111101','100001000000001','101111111110101','100000000010001','101111111011101','100000000000001','111111111111111'];let p=[1,1],goal=[13,9],run=true;const draw=()=>{ctx.clearRect(0,0,420,300);const cw=28,ch=27;map.forEach((row,y)=>[...row].forEach((v,x)=>{ctx.fillStyle=v==='1'?'#172238':'#08111d';ctx.fillRect(x*cw,y*ch,cw-1,ch-1)}));ctx.fillStyle='#4f8cff';ctx.fillRect(p[0]*cw+5,p[1]*ch+5,18,18);ctx.fillStyle='#62d77a';ctx.fillRect(goal[0]*cw+5,goal[1]*ch+5,18,18);};const key=e=>{const k=e.key.toLowerCase(),d={arrowup:[0,-1],w:[0,-1],arrowdown:[0,1],s:[0,1],arrowleft:[-1,0],a:[-1,0],arrowright:[1,0],d:[1,0]}[k];if(!d)return;const nx=p[0]+d[0],ny=p[1]+d[1];if(map[ny]?.[nx]==='0')p=[nx,ny];draw();if(p[0]===goal[0]&&p[1]===goal[1])status.textContent='Maze solved!';};window.addEventListener('keydown',key);draw();status.textContent='Running Maze 2D.';return()=>window.removeEventListener('keydown',key);
    }
    if(gameId==='snake'){
      stage.innerHTML='<canvas id="sg-snake" width="420" height="260" class="game-canvas" tabindex="0"></canvas><div class="row game-pad"><button class="btn" data-k="ArrowUp">↑</button><button class="btn" data-k="ArrowLeft">←</button><button class="btn" data-k="ArrowDown">↓</button><button class="btn" data-k="ArrowRight">→</button></div>';
      const c=stage.querySelector('#sg-snake'),ctx=c.getContext('2d');let snake=[[10,10],[9,10],[8,10]],dir=[1,0],food=[15,8],score=0,alive=true,timer;
      const setDir=k=>{if(k==='ArrowUp'&&dir[1]!==1)dir=[0,-1];if(k==='ArrowDown'&&dir[1]!==-1)dir=[0,1];if(k==='ArrowLeft'&&dir[0]!==1)dir=[-1,0];if(k==='ArrowRight'&&dir[0]!==-1)dir=[1,0];};
      const key=e=>setDir(e.key); c.addEventListener('keydown',key); stage.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>setDir(b.dataset.k)); c.focus();
      const draw=()=>{ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#111';ctx.fillRect(0,0,c.width,c.height);snake.forEach((p,i)=>{ctx.fillStyle=i?'#4f8cff':'#7fd77f';ctx.fillRect(p[0]*20,p[1]*20,18,18)});ctx.fillStyle='#ff5252';ctx.fillRect(food[0]*20,food[1]*20,18,18);ctx.fillStyle='#fff';ctx.fillText('Score '+score,8,14);};
      const loop=()=>{if(!alive)return;const h=[snake[0][0]+dir[0],snake[0][1]+dir[1]];if(h[0]<0||h[0]>=21||h[1]<0||h[1]>=13||snake.some(p=>p[0]===h[0]&&p[1]===h[1])){alive=false;status.textContent='Game over — press Restart.';draw();return;}snake.unshift(h);if(h[0]===food[0]&&h[1]===food[1]){score++;do{food=[Math.floor(Math.random()*21),Math.floor(Math.random()*13)]}while(snake.some(p=>p[0]===food[0]&&p[1]===food[1]));}else snake.pop();draw();timer=setTimeout(loop,120);};draw();loop();setCleanup(()=>{alive=false;clearTimeout(timer);c.removeEventListener('keydown',key);});return;
    }
    if(gameId==='pong'){
      stage.innerHTML='<canvas id="sg-pong" width="520" height="280" class="game-canvas" tabindex="0"></canvas><div class="dim">Move the left paddle with mouse/touch or ↑/↓.</div>';
      const c=stage.querySelector('#sg-pong'),ctx=c.getContext('2d');let py=110,ballX=260,ballY=140,vx=4,vy=3,score=0,alive=true,timer;
      const move=e=>{const r=c.getBoundingClientRect();py=Math.max(0,Math.min(220,((e.clientY-r.top)/r.height)*280-30));};const key=e=>{if(e.key==='ArrowUp')py=Math.max(0,py-14);if(e.key==='ArrowDown')py=Math.min(220,py+14);};c.addEventListener('pointermove',move);c.addEventListener('pointerdown',move);c.addEventListener('keydown',key);c.focus();
      const loop=()=>{if(!alive)return;ballX+=vx;ballY+=vy;if(ballY<8||ballY>272)vy*=-1;if(ballX<24&&ballX>12&&ballY>py-8&&ballY<py+68)vx=Math.abs(vx);if(ballX>496){vx=-Math.abs(vx);score++;}if(ballX<0){ballX=260;ballY=140;score=0;}ctx.clearRect(0,0,520,280);ctx.fillStyle='#111';ctx.fillRect(0,0,520,280);ctx.fillStyle='#fff';ctx.fillRect(10,py,10,60);ctx.fillRect(500,110,10,60);ctx.beginPath();ctx.arc(ballX,ballY,7,0,Math.PI*2);ctx.fill();ctx.fillText('Score '+score,230,20);timer=setTimeout(loop,16);};loop();status.textContent='Running Pong.';setCleanup(()=>{alive=false;clearTimeout(timer);c.removeEventListener('pointermove',move);c.removeEventListener('pointerdown',move);c.removeEventListener('keydown',key);});return;
    }
    if(gameId==='ttt'){
      stage.innerHTML='<div class="ttt-grid">'+Array(9).fill(0).map((_,i)=>`<button class="btn ttt-cell" data-i="${i}" style="font-size:1.8rem;min-height:64px"></button>`).join('')+'</div><div id="ttt-status" class="dim">Player X</div>';
      const cells=[...stage.querySelectorAll('.ttt-cell')],st=stage.querySelector('#ttt-status');let board=Array(9).fill(''),turn='X',done=false;const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];const draw=()=>{cells.forEach((c,i)=>c.textContent=board[i]);const w=wins.find(x=>board[x[0]]&&board[x[0]]===board[x[1]]&&board[x[1]]===board[x[2]]);if(w){done=true;st.textContent=`Player ${board[w[0]]} wins!`;return;}if(board.every(Boolean)){done=true;st.textContent='Draw!';return;}st.textContent=`Player ${turn}`};cells.forEach((c,i)=>c.onclick=()=>{if(done||board[i])return;board[i]=turn;turn=turn==='X'?'O':'X';draw();});draw();return;
    }
    if(gameId==='reflex'){
      stage.innerHTML='<div class="note-card"><b id="rx-msg">Press Start, then wait for GO…</b><div id="rx-time" class="price">—</div><button class="btn" id="rx-start">Start</button></div>';let timer=null,startAt=0,armed=false;const b=stage.querySelector('#rx-start'),m=stage.querySelector('#rx-msg');b.onclick=()=>{if(armed){clearTimeout(timer);m.textContent='Great!';stage.querySelector('#rx-time').textContent=(Date.now()-startAt)+' ms';armed=false;b.textContent='Try Again';return;}armed=true;b.disabled=true;m.textContent='Wait…';timer=setTimeout(()=>{startAt=Date.now();b.disabled=false;b.textContent='CLICK!';m.textContent='GO!';},800+Math.random()*2200);};setCleanup(()=>clearTimeout(timer));return;
    }
    if(gameId==='memory'){
      const vals=['🍎','🚀','🌟','🐱','🎵','⚽','🌈','🔥'];let cards=[...vals,...vals].sort(()=>Math.random()-.5),open=[],matched=0;stage.innerHTML='<div class="memory-grid">'+cards.map((_,i)=>`<button class="btn memory-card" data-i="${i}">?</button>`).join('')+'</div>';const btns=[...stage.querySelectorAll('.memory-card')];btns.forEach((b,i)=>b.onclick=()=>{if(open.length>=2||b.textContent!=='?')return;b.textContent=cards[i];open.push(i);if(open.length===2){const [a,z]=open;if(cards[a]===cards[z]){btns[a].disabled=btns[z].disabled=true;open=[];matched+=2;if(matched===cards.length)status.textContent='You matched every pair!';}else setTimeout(()=>{btns[a].textContent='?';btns[z].textContent='?';open=[];},650);}});status.textContent='Match all pairs.';return;
    }
    if(gameId==='tetris'){
      stage.innerHTML='<canvas id="sg-tetris" width="240" height="480" class="game-canvas" tabindex="0"></canvas><div class="dim">Lightweight block-drop demo. Use ← → and ↓.</div>';const c=stage.querySelector('#sg-tetris'),ctx=c.getContext('2d');let x=4,y=0,alive=true,timer;const draw=()=>{ctx.clearRect(0,0,240,480);ctx.fillStyle='#111';ctx.fillRect(0,0,240,480);ctx.fillStyle='#4f8cff';ctx.fillRect(x*24,y*24,48,48);ctx.fillStyle='#fff';ctx.fillText('Block Drop',8,15);};const key=e=>{if(e.key==='ArrowLeft')x=Math.max(0,x-1);if(e.key==='ArrowRight')x=Math.min(8,x+1);if(e.key==='ArrowDown')y=Math.min(19,y+1);draw();};c.addEventListener('keydown',key);c.focus();const loop=()=>{if(!alive)return;y++;if(y>19){y=0;x=Math.floor(Math.random()*9)}draw();timer=setTimeout(loop,450)};loop();setCleanup(()=>{alive=false;clearTimeout(timer);c.removeEventListener('keydown',key);});return;
    }
    if(gameId==='dice'){ stage.innerHTML='<div class="note-card"><b>Roll dice</b><div class="row"><input id="dice-count" type="number" min="1" max="6" value="2"><button class="btn primary" id="dice-roll">Roll</button></div><pre id="dice-out" class="term-log"></pre></div>';const roll=async()=>{const r=await api('/api/games/dice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:Number(stage.querySelector('#dice-count').value)||2})});stage.querySelector('#dice-out').textContent=r.error||JSON.stringify(r,null,2)};stage.querySelector('#dice-roll').onclick=roll;roll();return;}
    if(gameId==='guess'){ stage.innerHTML='<div class="note-card"><b>Guess a number from 1 to 20</b><div class="row"><input id="guess-value" type="number" min="1" max="20" value="10"><button class="btn primary" id="guess-go">Guess</button></div><div id="guess-out" class="dim"></div></div>';const secret=Math.floor(Math.random()*20)+1,go=async()=>{const r=await api('/api/games/guess_number',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guess:Number(stage.querySelector('#guess-value').value)||1,secret})});stage.querySelector('#guess-out').textContent=r.error||r.result};stage.querySelector('#guess-go').onclick=go;return;}
  };
  body.querySelector('#game-restart').onclick=start; body.querySelector('#game-exit').onclick=()=>{const id='game-'+gameId;if(openWindows[id])closeApp(id);}; start();
}

// ================= v1.1: Python Games + 2D/3D =================
async function renderGamesApp(body) {
  const r=await api("/api/games");
  body.innerHTML=`<div class="stack"><h3>🎮 HCR Games Hub</h3>
    <div class="dim">Local games. No real-money gambling. Every game has a visible reset/stop path.</div>
    <div class="games-grid">
      <div class="note-card"><b>🐍 Snake 2D</b><div class="dim">Keyboard + touch controls.</div><button class="btn" data-open-game="game-snake">Open Game</button></div>
      <div class="note-card"><b>🏓 Pong 2D</b><div class="dim">Mouse + touch paddle.</div><button class="btn" data-open-game="game-pong">Open Game</button></div>
      <div class="note-card"><b>🧊 Cube 3D</b><div class="dim">Lightweight local visual demo.</div><button class="btn" data-open-game="game-cube">Open Game</button></div>
      <div class="note-card" style="border-color:var(--accent)"><b>🧱 HCR Voxel World</b><div class="dim">Original block-building sandbox: explore, place/remove blocks, WASD + touch.</div><button class="btn primary" data-open-game="game-voxel">Open Voxel World</button></div>
      <div class="note-card"><b>⭕ Tic-Tac-Toe</b><div class="dim">Two-player local strategy.</div><button class="btn" data-open-game="game-ttt">Open Game</button></div>
      <div class="note-card"><b>⚡ Reflex Challenge</b><div class="dim">Reaction-time challenge.</div><button class="btn" data-open-game="game-reflex">Open Game</button></div>
      <div class="note-card"><b>🧱 Block Drop 2D</b><div class="dim">Simple keyboard block-drop challenge.</div><button class="btn" data-open-game="game-tetris">Open Game</button></div>
      <div class="note-card"><b>🧠 Memory Match 2D</b><div class="dim">Match all pairs.</div><button class="btn" data-open-game="game-memory">Open Game</button></div>
      <div class="note-card"><b>🪐 Orbit 3D</b><div class="dim">Lightweight 3D space visual.</div><button class="btn" data-open-game="game-orbit">Open Game</button></div>
      <div class="note-card"><b>🎲 Dice Roller</b><div class="dim">Python-backed dice game.</div><button class="btn" data-open-game="game-dice">Open Game</button></div>
      <div class="note-card"><b>🔢 Guess the Number</b><div class="dim">Python-backed number game.</div><button class="btn" data-open-game="game-guess">Open Game</button></div>
      <div class="note-card"><b>🧱 Breakout 2D</b><div class="dim">Arcade paddle and bricks.</div><button class="btn" data-open-game="game-breakout">Open Game</button></div>
      <div class="note-card"><b>💣 Minesweeper 2D</b><div class="dim">Grid puzzle.</div><button class="btn" data-open-game="game-mines">Open Game</button></div>
      <div class="note-card"><b>🐦 Flappy 2D</b><div class="dim">Tap-to-fly challenge.</div><button class="btn" data-open-game="game-flappy">Open Game</button></div>
      <div class="note-card"><b>🌀 Maze 2D</b><div class="dim">Keyboard maze puzzle.</div><button class="btn" data-open-game="game-maze">Open Game</button></div>
      <div class="note-card"><b>🌌 Starfield 3D</b><div class="dim">Interactive 3D-style starfield.</div><button class="btn" data-open-game="game-starfield">Open Game</button></div>
      <div class="note-card"><b>☀️ Solar System 3D</b><div class="dim">Animated 3D solar scene.</div><button class="btn" data-open-game="game-solar">Open Game</button></div>
      ${(r.games||[]).filter(g=>!['dice','guess_number','snake_2d','pong_2d','tetris_2d','memory_2d','tic_tac_toe','reflex','cube_3d','orbit_3d','breakout_2d','minesweeper_2d','flappy_2d','maze_2d','starfield_3d','solar_3d'].includes(g.id)).map(g=>`<div class="note-card"><b>🎲 ${escapeHtml(g.name)}</b><div class="dim">${escapeHtml(g.description)}</div><button class="btn" data-open-game="games">Open Game</button></div>`).join("")}
    </div><div class="row"><button class="btn secondary" id="game-stop">Stop Game</button><button class="btn" id="game-reset">Reset</button></div><div id="game-stage" class="game-stage"></div><div id="game-output" class="term-log"></div></div>`;
  const stage=body.querySelector('#game-stage'); let cleanup=()=>{};
  const stop=()=>{try{cleanup();}catch(_){} cleanup=()=>{}; stage.innerHTML='<div class="dim">Choose a game and press Play.</div>';};
  body.querySelector('#game-stop').onclick=stop; body.querySelector('#game-reset').onclick=stop;
  const play=(fn)=>{stop();cleanup=fn()||(()=>{});};
  body.querySelectorAll('[data-open-game]').forEach(b=>b.onclick=()=>openApp(b.dataset.openGame));
  body.querySelectorAll('[data-game]').forEach(b=>b.onclick=async()=>{stop();if(b.dataset.game==='dice'){const n=prompt('How many dice?','2');const rr=await api('/api/games/dice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:Number(n)||2})});body.querySelector('#game-output').textContent=rr.error||JSON.stringify(rr,null,2);}else if(b.dataset.game==='guess_number'){const secret=Math.floor(Math.random()*20)+1;const guess=prompt('Guess 1-20');const rr=await api('/api/games/guess_number',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guess:Number(guess)||1,secret})});body.querySelector('#game-output').textContent=rr.error||rr.result+' (Python engine)';}});
  stop();
}
// ================= v1.1: Feedback & Support =================
async function renderFeedbackApp(body) {
  // Feedback app is intentionally self-contained: no external `support` variable or
  // WhatsApp integration is required. This prevents the old ReferenceError from
  // appearing when a cached V1/V2 script is opened on Android.
  const repoUrl="https://github.com/DevevoperHCR/HCRAPP";
  body.innerHTML=`<div class="stack"><h3>Feedback & Support</h3>
    <div class="note-card"><b>Need help?</b><div class="dim">24×7 Feedback & Support. Send a report below or open the official project repository. No WhatsApp dependency is required.</div>
      <div class="row"><button class="btn" id="fb-open-settings">⚙️ Support Settings</button><a class="btn" href="${repoUrl}" target="_blank" rel="noopener">📦 GitHub Repository</a></div>
      <div id="support-links" class="row"></div></div>
    <select id="fb-cat"><option>Bug</option><option>Suggestion</option><option>UI Issue</option><option>AI Issue</option><option>Performance</option><option>Security</option><option>Other</option></select>
    <textarea id="fb-msg" rows="7" placeholder="Describe the issue or idea..."></textarea>
    <button class="btn primary" id="fb-send">Send Feedback</button><div id="fb-status" class="dim"></div></div>`;
  body.querySelector("#support-links").innerHTML=`<span class="dim">🟢 24×7 Feedback & Support</span><a class="btn" href="mailto:developerhcr@gmail.com">📧 Email Support</a><a class="btn" href="https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw" target="_blank" rel="noopener">📸 Instagram Support</a>`;
  body.querySelector("#fb-open-settings").onclick=()=>openApp("settings");
  body.querySelector("#fb-send").onclick=async()=>{
    const msg=body.querySelector("#fb-msg").value.trim(),status=body.querySelector("#fb-status");
    if(!msg){status.textContent="Please describe the issue first.";return;}
    status.textContent="Sending…";
    try {
      const r=await api("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:body.querySelector("#fb-cat").value,message:msg})});
      status.textContent=r.ok?"Feedback sent successfully.":"Error: "+(r.error||"Unable to send feedback.");
      if(r.ok){body.querySelector("#fb-msg").value=""; if(typeof playUISound==="function") playUISound("success");}
    } catch(e) {
      status.textContent="Feedback could not be sent: "+String(e?.message||e);
    }
  };
}

// ================= v1.1: Friends / Subscription =================
async function renderAccessApp(body) {
  const r=await api("/api/access/status");
  body.innerHTML=`<div class="stack"><h3>Friends Only / Subscribers Only</h3><div>Mode: <b>${r.guest?escapeHtml(r.friends_only?"Friends Only":"Subscribers Only"):escapeHtml(r.friends_only?"Friends Approved":(r.subscription?"Subscriber":"None"))}</b></div><div>Access: <b>${r.allowed?"Allowed":"Restricted"}</b></div>${r.guest?`<div class="note-card"><b>⏱ Temporary Guest Session</b><div class="dim">One person at a time · 10 minutes maximum · guest data is deleted when the session ends.</div><div id="guest-countdown"></div><button class="btn" id="guest-exit">Exit</button></div>`:`<div class="dim">Admin controls friend approvals and subscription permissions from Admin Dashboard.</div>`}</div>`;
  if(r.guest){ const e=body.querySelector("#guest-exit"); e.onclick=async()=>{await api("/api/guest/exit",{method:"POST"});location.reload();}; }
}

// ================= v1.1: Updates =================
async function renderUpdatesApp(body) {
  const [r,ann]=await Promise.all([api("/api/updates/check"),api("/api/updates/announcement")]);
  const hasUpdate=!!(r.available&&r.assets&&r.assets.length);
  body.innerHTML=`<div class="stack"><h3>HCR Update Center</h3>
    ${ann.announcement?`<div class="note-card"><b>${escapeHtml(ann.announcement.title)}</b><div style="white-space:pre-wrap;margin-top:5px">${escapeHtml(ann.announcement.message)}</div></div>`:""}
    <div id="update-info">${r.error?escapeHtml(r.error):(!r.configured?"Admin has not configured a repository.":`Current: ${escapeHtml(r.current)} · Latest: ${escapeHtml(r.latest||"unknown")} · ${r.available?"Optional update available":"Up to date"}`)}</div>
    <div class="dim">${escapeHtml(r.body||"")}</div>
    <div class="row"><button class="btn" id="update-check">Check Again</button>${hasUpdate?`<button class="btn" id="update-download" data-url="${escapeHtml(r.assets[0].url)}" data-version="${escapeHtml(r.latest)}">Download & Validate</button>`:""}</div>
    <div id="update-command-box"></div>
    <div class="dim">The Update button does not open a random website. It prepares the official release archive, then gives the exact command for the current DeveloperHCR folder. Copy it to the DeveloperHCR terminal and confirm the apply step.</div>
  </div>`;
  body.querySelector("#update-check").onclick=()=>renderUpdatesApp(body);
  const b=body.querySelector("#update-download");
  if(b)b.onclick=async()=>{
    b.disabled=true;b.textContent="Preparing...";
    const p=await api("/api/updates/prepare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({asset_url:b.dataset.url,version:b.dataset.version})});
    const box=body.querySelector("#update-command-box");
    if(p.ok){
      const cmd=`python updater.py --apply "${p.archive}"`;
      box.innerHTML=`<div class="note-card"><b>Update ready</b><div class="dim">Validated archive: ${escapeHtml(p.archive)}</div><div class="row"><input id="update-cmd" value="${escapeHtml(cmd)}" style="flex:1" readonly><button class="btn" id="copy-update-cmd">Copy to Terminal</button></div><div id="copy-update-status" class="dim"></div></div>`;
      body.querySelector("#copy-update-cmd").onclick=async()=>{try{await navigator.clipboard.writeText(cmd);body.querySelector("#copy-update-status").textContent="Copied. Paste it into the DeveloperHCR terminal."; }catch(_){body.querySelector("#copy-update-status").textContent="Clipboard permission unavailable; select and copy the command manually.";}};
      b.textContent="Prepared";
    }else{body.querySelector("#update-info").textContent=p.error||"Update preparation failed.";b.disabled=false;b.textContent="Download & Validate";}
  };
}
// ================= v1.1: EXE/Wine =================
async function renderExeApp(body) {
  const r=await api("/api/exe/status");
  const canInstall=currentUser && currentUser.role === "ADMIN";
  body.innerHTML=`<div class="stack"><h3>EXE / Wine Compatibility</h3><div>OS: ${escapeHtml(r.os)} · Wine: ${escapeHtml(r.wine||"not found")} · Supported: ${r.supported?"YES":"NO"}</div><div class="dim">EXE files are never silently executed. Admin permission is required. On Android/Linux, Windows EXE files need a compatible Wine/translation layer; DeveloperHCR reports that honestly instead of pretending they work.</div><div class="row"><button class="btn" id="wine-install" ${canInstall?"":"disabled"}>🍷 Install / Check Wine</button><button class="btn" id="exe-scan">🔎 Scan Storage</button><span id="wine-status" class="dim"></span></div><input id="exe-path" placeholder="Full path to .exe"><button class="btn primary" id="exe-run">▶ Run EXE</button><div id="exe-files" class="stack"></div><div id="exe-status" class="dim"></div></div>`;
  body.querySelector("#wine-install").onclick=async()=>{if(!confirm("Install Wine using the official system package manager? This may request administrator permission."))return;const b=body.querySelector("#wine-install");b.disabled=true;b.textContent="Installing...";const x=await api("/api/exe/install-wine",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirm:true})});body.querySelector("#wine-status").textContent=x.ok?(x.note||("Wine ready: "+x.wine)):(x.error||"Installation failed");b.disabled=false;b.textContent="🍷 Install / Check Wine";};
  const run=async(p)=>{if(!p)return; if(!confirm("Run this EXE now?"))return;const x=await api("/api/exe/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:p})});body.querySelector("#exe-status").textContent=x.ok?`Started: ${p}`:(x.error||"Failed");};
  body.querySelector("#exe-run").onclick=()=>run(body.querySelector("#exe-path").value.trim());
  body.querySelector("#exe-scan").onclick=async()=>{const x=await api('/api/exe/list');const box=body.querySelector('#exe-files');box.innerHTML=(x.files||[]).map(f=>`<div class="note-card"><b>🪟 ${escapeHtml(f.name)}</b><div class="dim">${escapeHtml(f.path)} · ${Number(f.size||0).toLocaleString()} bytes</div><button class="btn" data-run-exe="${escapeHtml(f.path)}">▶ Run</button></div>`).join('')||'<div class="dim">No .exe files found in the supported storage locations.</div>';box.querySelectorAll('[data-run-exe]').forEach(b=>b.onclick=()=>run(b.dataset.runExe));};
}

// ================= v3.6: Password Vault (fixes a dead HCR Store entry) =================
async function renderPasswordVaultApp(body) {
  body.innerHTML = `<div class="stack">
    <h3>🔑 Password Vault</h3>
    <div class="dim">Stored locally on this device only, in the app's own database — never uploaded or synced. This is plain local storage, not strong encryption, so avoid your most sensitive banking passwords here.</div>
    <div class="note-card">
      <div class="row"><input id="vault-title" placeholder="Title (e.g. Gmail)"><input id="vault-username" placeholder="Username/email"></div>
      <div class="row"><input id="vault-password" type="password" placeholder="Password"><input id="vault-url" placeholder="URL (optional)"></div>
      <textarea id="vault-notes" rows="2" placeholder="Notes (optional)"></textarea>
      <button class="btn" id="vault-add">Add Entry</button>
      <div id="vault-error" class="auth-error"></div>
    </div>
    <div id="vault-list"></div>
  </div>`;
  async function load() {
    const res = await api("/api/vault");
    body.querySelector("#vault-list").innerHTML = (res.items || []).map(e => `
      <div class="note-card" data-row="${e.id}">
        <b>${escapeHtml(e.title)}</b> ${e.site_username ? "· " + escapeHtml(e.site_username) : ""}
        <div class="dim" style="font-size:.75rem;">${e.url ? escapeHtml(e.url) : ""}</div>
        <div class="row"><button class="btn" data-reveal="${e.id}">Show</button><button class="btn" data-del="${e.id}">Delete</button></div>
        <div class="dim" data-revealed="${e.id}"></div>
      </div>`).join("") || `<div class="dim">No saved entries yet.</div>`;
    body.querySelectorAll("[data-reveal]").forEach(btn => btn.onclick = async () => {
      const r = await api(`/api/vault/${btn.dataset.reveal}/reveal`);
      const el = body.querySelector(`[data-revealed="${btn.dataset.reveal}"]`);
      if (el) el.textContent = r.error ? r.error : `Password: ${r.site_password || "(empty)"}${r.notes ? " · " + r.notes : ""}`;
    });
    body.querySelectorAll("[data-del]").forEach(btn => btn.onclick = async () => {
      if (!confirm("Delete this entry?")) return;
      await api(`/api/vault/${btn.dataset.del}/delete`, { method: "POST" });
      load();
    });
  }
  body.querySelector("#vault-add").onclick = async () => {
    const title = body.querySelector("#vault-title").value.trim();
    if (!title) { body.querySelector("#vault-error").textContent = "Title is required."; return; }
    await api("/api/vault", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, username: body.querySelector("#vault-username").value,
        password: body.querySelector("#vault-password").value,
        url: body.querySelector("#vault-url").value, notes: body.querySelector("#vault-notes").value,
      }),
    });
    ["vault-title","vault-username","vault-password","vault-url","vault-notes"].forEach(id => body.querySelector("#"+id).value = "");
    body.querySelector("#vault-error").textContent = "";
    load();
  };
  load();
}

// ================= v3.6: Screenshot Tool (fixes a dead HCR Store entry) =================
function renderScreenshotApp(body) {
  body.innerHTML = `<div class="stack">
    <h3>📸 Screenshot Tool</h3>
    <div class="dim">Uses your browser's native screen-capture permission — DeveloperHCR never captures your screen silently, and this only works where the browser/OS supports it (not inside every embedded webview).</div>
    <button class="btn" id="ss-capture">Capture Screen…</button>
    <div id="ss-status" class="dim"></div>
    <div id="ss-preview"></div>
  </div>`;
  body.querySelector("#ss-capture").onclick = async () => {
    const status = body.querySelector("#ss-status");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      status.textContent = "Screen capture isn't supported in this browser/webview.";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      let dataUrl;
      if (window.ImageCapture) {
        const capture = new ImageCapture(track);
        const bitmap = await capture.grabFrame();
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        dataUrl = canvas.toDataURL("image/png");
      } else {
        // Fallback for browsers without ImageCapture: grab one frame via a hidden <video>.
        const video = document.createElement("video");
        video.srcObject = stream; video.muted = true; await video.play();
        await new Promise(r => setTimeout(r, 150));
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        dataUrl = canvas.toDataURL("image/png");
      }
      track.stop();
      body.querySelector("#ss-preview").innerHTML = `<img src="${dataUrl}" style="max-width:100%;border-radius:8px;margin-top:8px;"><div><a class="btn" download="screenshot.png" href="${dataUrl}">Download PNG</a></div>`;
      status.textContent = "Captured.";
    } catch (e) {
      status.textContent = "Capture cancelled or blocked: " + (e?.message || e);
    }
  };
}

// ================= v3.6: QR & Share (fixes a dead HCR Store entry) =================
function renderQrShareApp(body) {
  body.innerHTML = `<div class="stack">
    <h3>🔳 QR & Share</h3>
    <div class="dim">Generates a QR code for any text/link so you can share it to another device. Rendering the code image needs internet access (it calls a public QR image service — no data besides the text you enter is sent, and nothing is generated for blank input).</div>
    <textarea id="qr-text" rows="2" placeholder="Text or URL to share"></textarea>
    <button class="btn" id="qr-generate">Generate QR</button>
    <div id="qr-output"></div>
  </div>`;
  body.querySelector("#qr-generate").onclick = () => {
    const text = body.querySelector("#qr-text").value.trim();
    const out = body.querySelector("#qr-output");
    if (!text) { out.innerHTML = `<div class="dim">Enter some text first.</div>`; return; }
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text)}`;
    out.innerHTML = `<img src="${url}" alt="QR code" style="margin-top:8px;border-radius:8px;background:#fff;padding:8px;">`;
  };
}



/* v1.0 BETA — FINAL SHELL CONTROLLER
   A single delegated controller owns Start/Search/app-menu interactions so
   touch, pointer and mouse events cannot race each other. Existing app
   renderers and window manager remain untouched. */
(function installFinalShellController(){
  function ready(){
    const btn=document.getElementById('launcher-btn');
    const panel=document.getElementById('app-launcher');
    const grid=document.getElementById('launcher-grid');
    const taskInput=document.getElementById('taskbar-search-input');
    const taskBtn=document.getElementById('taskbar-search-btn');
    const menuInput=document.getElementById('launcher-search');
    if(!btn || !panel || !grid) return false;

    const openMenu=(seed='')=>{
      panel.classList.remove('hidden');
      panel.style.display='block';
      btn.setAttribute('aria-expanded','true');
      if(menuInput) menuInput.value=seed;
      buildLauncher();
      if(menuInput){ setTimeout(()=>{ try{menuInput.focus(); menuInput.setSelectionRange(menuInput.value.length,menuInput.value.length);}catch(_){} },0); }
    };
    const closeMenu=()=>{
      panel.classList.add('hidden');
      panel.style.display='none';
      btn.setAttribute('aria-expanded','false');
    };
    const toggleMenu=(e)=>{
      if(e){e.preventDefault();e.stopPropagation();}
      if(panel.classList.contains('hidden') || panel.style.display==='none') openMenu('');
      else closeMenu();
    };

    // One activation path only. Browsers already synthesize a click for
    // touch/pointer activation; having pointerup + touchend + click here
    // caused the menu to toggle 2-3 times and appear not to open.
    btn.onclick=(e)=>{const action=localStorage.getItem("hcr-logo-click-action")||"launcher";if(action==="hcr"){e.preventDefault();e.stopPropagation();openApp("jarvis");return;}if(action==="desktop"){document.querySelectorAll(".win").forEach(w=>w.classList.add("minimized"));return;}toggleMenu(e);};
    btn.onpointerup=null;
    btn.ontouchend=null;

    if(taskBtn) taskBtn.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); openMenu(taskInput?.value||''); };

    if(taskInput){
      taskInput.onfocus=()=>openMenu(taskInput.value||'');
      taskInput.oninput=()=>openMenu(taskInput.value||'');
      taskInput.onkeydown=(e)=>{
        if(e.key==='Enter'){
          e.preventDefault();
          openMenu(taskInput.value||'');
          const first=grid.querySelector('[data-app]');
          if(first) first.click();
        } else if(e.key==='Escape') { taskInput.value=''; closeMenu(); taskInput.blur(); }
      };
    }

    if(menuInput){
      menuInput.oninput=()=>buildLauncher();
      menuInput.onkeydown=(e)=>{
        if(e.key==='Enter'){
          e.preventDefault();
          const first=grid.querySelector('[data-app]');
          if(first) first.click();
        } else if(e.key==='Escape') { menuInput.value=''; buildLauncher(); closeMenu(); }
      };
    }

    grid.onclick=(e)=>{
      const target=e.target && e.target.closest ? e.target.closest('[data-app]') : null;
      if(!target || !grid.contains(target)) return;
      if(target.dataset.suppressClick === "1") { delete target.dataset.suppressClick; return; }
      e.preventDefault(); e.stopPropagation();
      const id=target.getAttribute('data-app');
      if(id){ openApp(id); closeMenu(); }
    };

    document.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); openMenu(''); return; } const combo=(localStorage.getItem('hcr-hcr-shortcut')||'Alt+Space').toLowerCase(); const parts=combo.split('+').map(x=>x.trim()).filter(Boolean),key=(e.key||'').toLowerCase(),want=parts[parts.length-1]; const mods={alt:e.altKey,ctrl:e.ctrlKey,control:e.ctrlKey,shift:e.shiftKey,meta:e.metaKey,cmd:e.metaKey}; if(want===key&&parts.slice(0,-1).every(m=>mods[m])){e.preventDefault();const action=localStorage.getItem('hcr-logo-click-action')||'launcher';if(action==='hcr')openApp('jarvis');else if(action==='desktop')document.querySelectorAll('.win').forEach(w=>w.classList.add('minimized'));else openMenu('');} });

    document.addEventListener('pointerdown',(e)=>{
      if(panel.classList.contains('hidden')) return;
      const inside=panel.contains(e.target) || btn.contains(e.target);
      if(!inside) closeMenu();
    }, true);

    window.__HCR_SHELL_READY__=true;
    return true;
  }
  if(!ready()){
    const timer=setInterval(()=>{ if(ready()) clearInterval(timer); },250);
    setTimeout(()=>clearInterval(timer),15000);
  }
})();
