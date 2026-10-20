// Binder Town manager — web dashboard on http://localhost:3889
//  • opens each saved game profile in its own persistent Chrome / Edge / Brave data directory
//  • loads helper/binder_helper.js and its per-menu modules in every game tab
//  • shows each tab's helper status, start / stop / reload helper from the web
//  • updates from git (fetch / pull --ff-only); after a pull the helper is reloaded in every tab,
//    and if manager/ itself changed the server exits with code 3 so Start_Binder.bat restarts it
// usage: node manager/server.js   (Start_Binder.bat does this)
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), { execFile } = require('child_process');
const { GAME_URL, ROOT, exeOf, targets, Tab } = require('./browser');
const { createBrowserMode } = require('./browser_mode');

const PORT = +process.env.BINDER_PORT || 3889;
// Keep bundled application files read-only and store user profiles in a
// writable per-user directory when launched from the portable app.
const DATA_ROOT = process.env.BINDER_DATA_DIR || ROOT;
const HELPER = path.join(ROOT, 'helper', 'binder_helper.js');
const HELPER_PAGES = path.join(ROOT, 'helper', 'pages');
const PUBLIC = path.join(__dirname, 'public');
const BROWSER_PREFS = path.join(DATA_ROOT, 'profiles', '.manager-settings.json');
const GAME_PROFILES = path.join(DATA_ROOT, 'profiles', '.game-profiles.json');
const UPDATE_PREFS = path.join(DATA_ROOT, 'profiles', '.update-settings.json');
const CHECK_MS = 3000, UPDATE_CHECK_MS = 3 * 60e3;
const SERVER_STARTED_AT = Date.now();
// main machine (has the git-ignored file .binder-main): pushes, never fetches / pulls by itself.
// every other machine follows it: fetch every 3 minutes and pull as soon as there is a new commit.
const IS_MAIN = fs.existsSync(path.join(ROOT, '.binder-main'));
function readUpdatePrefs() {
  try { return JSON.parse(fs.readFileSync(UPDATE_PREFS, 'utf8')); } catch { return {}; }
}
const savedUpdatePrefs = readUpdatePrefs();
let AUTO_PULL = !IS_MAIN && (typeof savedUpdatePrefs.autoPull === 'boolean' ? savedUpdatePrefs.autoPull : process.env.BINDER_AUTO_UPDATE !== '0');
let AUTO_RELOAD_HELPERS = savedUpdatePrefs.autoReloadHelpers !== false;
let updateBusy = false;
const RESTART_CODE = 3;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readBrowserPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(BROWSER_PREFS, 'utf8'));
    return { kind: ['chrome', 'edge', 'brave'].includes(saved.kind) ? saved.kind : 'chrome' };
  } catch { return { kind: 'chrome' }; }
}
let browserPrefs = readBrowserPrefs();
const profileBrowserModes = new Map();
const profilePorts = new Map();
let gameWindowsParked = false;
function profilePort(profileId) {
  if (profilePorts.has(profileId)) return profilePorts.get(profileId);
  const occupied = new Set(profilePorts.values());
  let port = 12000 + (parseInt(crypto.createHash('sha256').update(profileId).digest('hex').slice(0, 8), 16) % 45000);
  while (occupied.has(port)) port = port >= 56999 ? 12000 : port + 1;
  profilePorts.set(profileId, port);
  return port;
}
function browserModeForProfile(profileId) {
  if (profileBrowserModes.has(profileId)) return profileBrowserModes.get(profileId);
  const mode = createBrowserMode({ getSettings: () => browserPrefs, rootDir: DATA_ROOT,
    port: profilePort(profileId), userDataDir: path.join(DATA_ROOT, 'profiles', 'game-windows', profileId) });
  profileBrowserModes.set(profileId, mode);
  return mode;
}
const allProfileModes = () => [...profileBrowserModes.values()];
function readGameProfiles() {
  try {
    const profiles = JSON.parse(fs.readFileSync(GAME_PROFILES, 'utf8'));
    return Array.isArray(profiles) ? profiles.filter(p => p && /^[\w-]{1,80}$/.test(p.id) && typeof p.name === 'string') : [];
  } catch { return []; }
}
function saveGameProfiles(profiles) {
  fs.mkdirSync(path.dirname(GAME_PROFILES), { recursive: true });
  fs.writeFileSync(GAME_PROFILES, JSON.stringify(profiles, null, 2), 'utf8');
}
function browserEntries() {
  // Present one logical browser group in the UI; each saved game profile has
  // its own persistent browser data and CDP port behind this group.
  const firstMode = allProfileModes()[0];
  return [['shared', { name: 'หน้าต่างเกมร่วม', port: firstMode ? firstMode.port : null }]];
}
const sharedTabs = () => [...tabs.values()].filter(t => t.browser === 'shared');

// ---------------- game tabs ----------------
let marketQueue = Promise.resolve(); // market requests through the game tab run one after another
const tabs = new Map(); // targetId -> { tab, browser, url, title, state, status, injecting }
let shutdownRequested = false;
// the loading screen's error bar "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง": its ลองใหม่ button reloads the page
const RETRY_BTN = `[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'ลองใหม่' && /เชื่อมต่อ/.test(b.parentElement.textContent))`;
const STATE_JS = `(() => ({ helper: !!window.__bth, inWorld: !!(document.getElementById('mapname') && document.getElementById('mapname').textContent.trim() && document.getElementById('autobig')),
  status: window.__bth && window.__bth.status ? window.__bth.status() : null,
  clientId: window.__bthClientId || (window.name.startsWith('bth-client:') ? window.name.slice(11) : ''),
  loadErr: !!${RETRY_BTN} }))()`;
const RETRY_JS = `(() => { const b = ${RETRY_BTN}; if (b) b.click(); return !!b; })()`;

async function inject(t, resumeMode) {
  // Menu modules run before the controller so they can register markup, renderers, and page-specific controls.
  const pageFiles = fs.readdirSync(HELPER_PAGES).filter(f => f.endsWith('.js')).sort();
  // Run each page module as a separate script so its registration is complete
  // before the main controller checks for the required menu modules.
  for (const file of pageFiles) {
    await t.tab.eval(fs.readFileSync(path.join(HELPER_PAGES, file), 'utf8'));
  }
  const r = await t.tab.eval(fs.readFileSync(HELPER, 'utf8'));
  const savedProfile = readGameProfiles().find(p => p.id === t.profileId);
  const savedPlan = savedProfile?.plan;
  if (savedPlan) await t.tab.eval(`window.__bth && window.__bth.applyPlan(${JSON.stringify(savedPlan)})`);
  if (savedProfile?.skillPlan) await t.tab.eval(`window.__bth && window.__bth.applySkillPlan(${JSON.stringify(savedProfile.skillPlan)})`);
  if (resumeMode === 'gathering') await t.tab.eval(`window.__bth && !window.__bth.cfg.gathering.enabled && document.querySelector('#bthgrun')?.click()`);
  else if (resumeMode === 'farm') await t.tab.eval(`window.__bth && !window.__bth.cfg.running && window.__bth.toggle()`);
  log(`[${t.browser}] ${t.id.slice(0, 6)}: โหลด helper แล้ว (${r})`);
}
async function reloadHelper(t) {
  const resumeMode = await t.tab.eval(`(() => { const c = window.__bth && window.__bth.cfg; const m = c && (c.mode || (c.gathering?.enabled ? 'gathering' : c.running ? 'farm' : 'stopped')); if (window.__bth) { window.__bth.stop(); window.__bth.remove(); } return m; })()`);
  t.state = 'world';
  await inject(t, resumeMode);
}

async function checkTab(key, target, mode, profileId) {
  let t = tabs.get(target.id);
  if (!t || t.tab.closed) {
    if (!target.webSocketDebuggerUrl) return;
    t = { id: target.id, tab: new Tab(target), browser: key, mode, profileId, state: 'loading', status: null, injecting: false };
    tabs.set(target.id, t);
  }
  if (mode) t.mode = mode;
  if (profileId && !t.profileId) t.profileId = profileId;
  t.url = target.url; t.title = target.title; t.seen = Date.now();
  if (t.injecting) return;
  const s = await t.tab.eval(STATE_JS);
  t.clientId = s.clientId || t.clientId || '';
  const matchedProfile = readGameProfiles().find(profile => profile.id === t.clientId);
  if (matchedProfile) t.profileId = matchedProfile.id;
  t.status = s.status;
  if (s.status) t.wasMode = s.status.mode || (s.status.gathering?.enabled ? 'gathering' : s.status.running ? 'farm' : 'stopped'); // kept over a page reload
  if (s.status && s.status.log) {
    // copy the helper's new log lines (newest first) to server.log, so why it stopped can be read afterwards
    const seen = s.status.log.indexOf(t.lastLog), fresh = s.status.log.slice(0, seen < 0 ? s.status.log.length : seen);
    for (const l of fresh.reverse()) log(`[${key}] ${t.id.slice(0, 6)} helper: ${l}`);
    if (s.status.log.length) t.lastLog = s.status.log[0];
  }
  const state = s.helper ? 'helper' : s.inWorld ? 'world' : 'loading';
  if (state !== t.state) log(`[${key}] ${t.id.slice(0, 6)}: ${state === 'helper' ? 'helper ทำงาน' : state === 'world' ? 'เข้าเกมแล้ว' : 'ยังไม่เข้าเกม'}`);
  t.state = state;
  if (s.loadErr) {
    // could not reach the server: press ลองใหม่ again and again, waiting 10 s more each time (at most 1 min)
    const wait = Math.min(60e3, 10e3 * ((t.retries || 0) + 1));
    if (Date.now() - (t.retryAt || 0) < wait) return;
    t.retries = (t.retries || 0) + 1; t.retryAt = Date.now();
    log(`[${key}] ${t.id.slice(0, 6)}: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กดลองใหม่ (ครั้งที่ ${t.retries})`);
    await t.tab.eval(RETRY_JS).catch(() => { });
    return;
  }
  if (state !== 'loading') t.retries = 0;
  if (state !== 'world') return;
  t.injecting = true;
  try { await inject(t, t.wasMode); t.state = 'helper'; } catch (e) { log('โหลด helper ไม่สำเร็จ:', e.message); } finally { t.injecting = false; }
}

const browserUp = {};
async function loop() {
  for (;;) {
    let anyProfileBrowserUp = false;
    for (const [profileId, mode] of profileBrowserModes) {
      const list = await targets(mode.port);
      anyProfileBrowserUp ||= !!list;
      if (!list) continue;
      for (const target of list) if (target.type === 'page' && String(target.url).startsWith(GAME_URL)) {
        try { await checkTab('shared', target, mode, profileId); } catch (e) { if (!/closed|timeout|connect/.test(e.message)) log(`[${profileId}] ตรวจแท็บไม่ได้:`, e.message); }
      }
    }
    browserUp.shared = anyProfileBrowserUp;
    for (const [id, t] of tabs) if (t.tab.closed || Date.now() - (t.seen || 0) > 15000) { t.tab.close(); tabs.delete(id); }
    await sleep(CHECK_MS);
  }
}

// ---------------- git update ----------------
const git = (...args) => new Promise(resolve => execFile('git', args, { cwd: ROOT, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) =>
  resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || (err && err.message) || '').trim() })));
const UPDATE_REMOTE = 'token';
const UPDATE_REF = 'refs/remotes/token/HEAD';
const UPDATE_REPO_URL = 'https://github.com/fledotexe/babybinder';
const update = { isRepo: false, branch: '', commit: '', date: '', remoteCommit: '', remoteDate: '', behind: 0, incoming: [], helperVersion: '', remoteHelperVersion: '', checkedAt: 0, error: '' };
async function checkUpdate(fetchFirst = true) {
  const repo = await git('rev-parse', '--is-inside-work-tree');
  update.isRepo = repo.ok && repo.out === 'true';
  if (!update.isRepo) { update.error = 'โฟลเดอร์นี้ไม่ใช่ git repo (clone มาจาก GitHub ก่อนถึงอัปเดตได้)'; return update; }
  update.branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).out;
  const head = await git('log', '-1', '--format=%h|%cd', '--date=format:%Y-%m-%d %H:%M');
  [update.commit, update.date] = head.out.split('|');
  if (fetchFirst) {
    const configured = await git('remote', 'get-url', UPDATE_REMOTE);
    if (!configured.ok) {
      update.error = 'ยังไม่ได้ตั้งแหล่ง Token — รัน set_token.bat ก่อน';
      update.checkedAt = Date.now();
      return update;
    }
    const safeRemoteUrl = configured.out.replace(/^https:\/\/[^/@]+@/i, 'https://').replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
    if (safeRemoteUrl !== UPDATE_REPO_URL) {
      update.error = 'แหล่งอัปเดตไม่ใช่ Git repo ที่กำหนด: fledotexe/babybinder';
      update.checkedAt = Date.now();
      return update;
    }
    // FETCH_HEAD is not needed (the updater reads the remote-tracking ref) and may be
    // locked by another Binder process. Avoid touching it so Token checks can proceed.
    // This Windows Git installation's Schannel backend cannot load the token credential.
    // OpenSSL honors the credential embedded by set_token.bat.
    const f = await git('-c', 'http.sslBackend=openssl', 'fetch', '--quiet', '--no-write-fetch-head', UPDATE_REMOTE);
    // The token remote is configured by set_token.bat; keep origin reserved for this checkout.
    const auth = /could not read Username|Invalid username or token|Authentication failed|terminal prompts disabled/i.test(f.err);
    update.error = f.ok ? '' : auth ? 'GitHub ปฏิเสธ Token — รัน set_token.bat แล้วตั้ง Token ใหม่' : 'ตรวจแหล่ง Token ไม่สำเร็จ: ' + f.err;
    if (!f.ok) { update.checkedAt = Date.now(); return update; }
    await git('remote', 'set-head', UPDATE_REMOTE, '-a');
  }
  const tokenHead = await git('rev-parse', '--verify', UPDATE_REF);
  if (!tokenHead.ok) {
    update.error = 'หา branch หลักของ Token ไม่พบ — ตรวจ remote ที่ตั้งด้วย set_token.bat';
    update.checkedAt = Date.now();
    return update;
  }
  const up = await git('rev-list', '--count', `HEAD..${UPDATE_REF}`);
  update.behind = up.ok ? +up.out || 0 : 0;
  const inc = update.behind ? await git('log', '--format=%h %s', `HEAD..${UPDATE_REF}`) : { out: '' };
  update.incoming = inc.out ? inc.out.split('\n') : [];
  const remoteHead = await git('log', '-1', '--format=%h|%cd', '--date=format:%Y-%m-%d %H:%M', UPDATE_REF);
  [update.remoteCommit, update.remoteDate] = remoteHead.ok ? remoteHead.out.split('|') : ['', ''];
  update.helperVersion = readHelperVersion();
  const remoteHelper = await git('show', `${UPDATE_REF}:helper/binder_helper.js`);
  const remoteVersion = remoteHelper.ok && remoteHelper.out.match(/\bconst BINDER_HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/);
  update.remoteHelperVersion = remoteVersion ? remoteVersion[1] : '';
  update.checkedAt = Date.now();
  return update;
}
async function stageTokenUpdate() {
  const checked = await checkUpdate(true);
  if (checked.error) return { ok: false, msg: checked.error };
  if (!checked.behind) return { ok: true, msg: 'เป็นเวอร์ชันล่าสุดแล้ว' };
  const rev = await git('rev-parse', UPDATE_REF);
  if (!rev.ok) return { ok: false, msg: 'อ่าน commit จาก Token ไม่สำเร็จ: ' + rev.err };
  if (!/^[0-9a-f]{40}$/i.test(rev.out)) return { ok: false, msg: 'รูปแบบ commit จาก Git ไม่ถูกต้อง' };
  const folder = path.join(ROOT, '.token-pulls', rev.out.slice(0, 12));
  if (fs.existsSync(folder)) {
    const marker = path.join(folder, 'TOKEN_PULL_INFO.txt');
    try {
      const info = fs.readFileSync(marker, 'utf8');
      if (info.includes(rev.out)) return { ok: true, msg: `มีสำเนา Git commit นี้อยู่แล้ว: ${folder}`, folder, commit: rev.out };
    } catch { }
    return { ok: false, msg: `ไม่สร้างทับ เพราะโฟลเดอร์มีอยู่แล้ว: ${folder}` };
  }
  const tempFolder = `${folder}.staging`;
  const archivePath = `${folder}.tar`;
  if (fs.existsSync(tempFolder) || fs.existsSync(archivePath)) return { ok: false, msg: 'พบไฟล์ staging เดิม จึงไม่เขียนทับ' };
  try { fs.mkdirSync(path.dirname(folder), { recursive: true }); }
  catch (e) { return { ok: false, msg: 'สร้างโฟลเดอร์เก็บ Git snapshot ไม่สำเร็จ: ' + e.message }; }
  const archived = await git('archive', '--format=tar', `--output=${archivePath}`, UPDATE_REF);
  if (!archived.ok) return { ok: false, msg: 'ส่งออกไฟล์จาก Git ไม่สำเร็จ: ' + archived.err };
  try { fs.mkdirSync(tempFolder); }
  catch (e) { return { ok: false, msg: 'สร้างโฟลเดอร์ staging ไม่สำเร็จ: ' + e.message }; }
  const extracted = await new Promise(resolve => execFile('tar', ['-xf', archivePath, '-C', tempFolder],
    { cwd: ROOT, windowsHide: true, timeout: 120000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, err: String(stderr || (err && err.message) || '').trim() })));
  if (!extracted.ok) return { ok: false, msg: `แตกไฟล์ snapshot ไม่สำเร็จ; ไฟล์ชั่วคราวอยู่ที่ ${tempFolder}: ${extracted.err}` };
  try {
    fs.writeFileSync(path.join(tempFolder, 'TOKEN_PULL_INFO.txt'), `Source: ${UPDATE_REPO_URL}.git\nCommit: ${rev.out}\nCreated: ${new Date().toISOString()}\n`, 'utf8');
    fs.unlinkSync(archivePath);
    fs.renameSync(tempFolder, folder);
  } catch (e) { return { ok: false, msg: `จัดเก็บ snapshot ไม่สำเร็จ: ${e.message}` }; }
  update.lastStaged = { at: Date.now(), commit: rev.out, folder };
  return { ok: true, msg: `เตรียม Git snapshot ${rev.out.slice(0, 7)} ไว้ในโฟลเดอร์แยกแล้ว: ${folder}`, folder, commit: rev.out };
}
async function runUpdateCycle() {
  if (updateBusy) return;
  updateBusy = true;
  try {
    const u = await checkUpdate(true);
    if (!AUTO_PULL || !u.behind) return;
    const r = await stageTokenUpdate();
    log(r.ok ? 'เตรียมไฟล์ Token อัตโนมัติ: ' + r.msg : 'เตรียมไฟล์ Token อัตโนมัติไม่สำเร็จ: ' + r.msg);
  } finally { updateBusy = false; }
}

// ---------------- http ----------------
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
function readHelperVersion() {
  try { return (fs.readFileSync(HELPER, 'utf8').match(/\bconst BINDER_HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || 'unknown'; }
  catch { return 'unknown'; }
}

function statusBody() {
  const findBrowser = kind => exeOf(kind);
  return {
    helperVersion: readHelperVersion(),
    update: { ...update, main: IS_MAIN, autoPull: AUTO_PULL, autoReloadHelpers: AUTO_RELOAD_HELPERS, busy: updateBusy, serverStartedAt: SERVER_STARTED_AT },
    gameProfiles: readGameProfiles(),
      browserMode: { kind: browserPrefs.kind, name: ({ edge: 'Microsoft Edge', brave: 'Brave', chrome: 'Google Chrome' })[browserPrefs.kind],
      path: findBrowser(browserPrefs.kind) || '',
      installed: !!findBrowser(browserPrefs.kind), running: sharedTabs().some(t => !t.tab.closed), port: 'แยกตามโปรไฟล์',
      gameWindowsParked,
      tabs: sharedTabs().length,
      choices: { chrome: !!findBrowser('chrome'), edge: !!findBrowser('edge'), brave: !!findBrowser('brave') } },
    browsers: browserEntries().map(([key, b]) => ({
      key, name: b.name, port: b.port, installed: !!findBrowser(browserPrefs.kind), running: !!browserUp[key],
      tabs: [...tabs.values()].filter(t => t.browser === key).map(t => ({ id: t.id, title: t.title, state: t.state, status: t.status, profileId: t.clientId || '' })),
    })),
  };
}

const server = http.createServer(async (req, res) => {
  // local only: refuse requests that come from other sites (CSRF) or other machines
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return json(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, 'http://localhost');
  // Accept both /api/profiles and /api/profiles/ (some embedded webviews append
  // a trailing slash when resolving relative API URLs).
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, statusBody());
    if (req.method === 'GET' && url.pathname === '/api/plan/maps') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'plan_maps.json')));
    }
    if (req.method === 'GET' && url.pathname === '/api/map-captures') {
      let maps;
      try { maps = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'plan_maps.json'), 'utf8')); }
      catch { return json(res, 500, { ok: false, error: 'อ่านรายชื่อแผนที่ไม่สำเร็จ' }); }
      const dir = path.join(PUBLIC, 'map_captures');
      let saved = {}; try { saved = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8')); } catch { }
      const captures = Object.fromEntries(maps.flatMap(m => {
        if (saved[m.id]?.invalid) return [];
        const filename = [`${m.id}_big.png`, `${m.id}.png`].find(f => fs.existsSync(path.join(dir, f)));
        return filename ? [[m.id, { filename, capturedAt: null, ...(saved[m.id] || {}) }]] : [];
      }));
      return json(res, 200, { ok: true, captures });
    }
    const planMapImage = url.pathname.match(/^\/api\/plan\/map-image\/([\w-]+)$/);
    if (req.method === 'GET' && planMapImage) {
      const id = planMapImage[1], dir = path.join(PUBLIC, 'map_captures');
      const file = path.join(dir, `${id}_big.png`);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'ยังไม่มีภาพแผนที่จริง' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    const captureMatch = url.pathname.match(/^\/api\/map-captures\/([\w-]+)$/);
    if (captureMatch && req.method === 'POST') {
      const mapId = captureMatch[1];
      let maps;
      try { maps = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'plan_maps.json'), 'utf8')); }
      catch { return json(res, 500, { ok: false, error: 'อ่านรายชื่อแผนที่ไม่สำเร็จ' }); }
      const map = maps.find(m => m.id === mapId);
      if (!map) return json(res, 404, { ok: false, error: 'ไม่พบแผนที่นี้' });
      const body = await new Promise(resolve => { let data = ''; req.on('data', c => { data += c; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); });
      const t = [...tabs.values()].find(x => x.profileId === String(body.profileId || '') && x.state === 'helper' && !x.tab.closed);
      if (!t) return json(res, 409, { ok: false, error: 'โปรไฟล์นี้ไม่มีแท็บเกมที่พร้อม' });
      let shot;
      try { shot = await t.tab.eval(`(async() => { const expected=${JSON.stringify(map.name)},box=document.querySelector('#mmbig'); let opened=false; const title=()=>document.querySelector('#mmbigname')?.textContent?.trim()||''; if(window.__bth?.status?.()?.map===expected&&title()!==expected){ if(box&&!box.hidden){document.querySelector('#mmbigx')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,80));} const mini=document.querySelector('#minimap'); if(box?.hidden&&mini){mini.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));opened=!box.hidden;if(opened)await new Promise(r=>setTimeout(r,700));} } const s=window.__bth?.status?.(),c=document.querySelector('#mmbigcv'),result={map:s?.map||document.querySelector('#mapname')?.textContent?.trim()||'',canvasMap:title(),data:c&&c.width>0&&c.height>0?c.toDataURL('image/png'):'',width:c?.width||0,height:c?.height||0}; if(opened&&box&&!box.hidden)document.querySelector('#mmbigx')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return result; })()`); }
      catch (e) { return json(res, 503, { ok: false, error: `อ่านภาพจากเกมไม่สำเร็จ: ${e.message}` }); }
      if (shot.map !== map.name) return json(res, 409, { ok: false, error: `ตอนนี้อยู่ ${shot.map || 'ไม่ทราบแมพ'} · ต้องอยู่ ${map.name} ก่อน` });
      if (shot.canvasMap !== map.name) return json(res, 409, { ok: false, error: `หัวแผนที่ในเกมยังเป็น ${shot.canvasMap || 'ไม่ทราบแมพ'} · รอแผนที่ ${map.name} โหลดให้เสร็จก่อน` });
      if (!shot.data || !shot.data.startsWith('data:image/png;base64,') || shot.data.length < 1000)
        return json(res, 409, { ok: false, error: 'ยังอ่านภาพแผนที่จริงจากเกมไม่ได้ เปิดแผนที่ใหญ่ในเกมแล้วลองอีกครั้ง' });
      const dir = path.join(PUBLIC, 'map_captures'), filename = `${map.id}_big.png`, file = path.join(dir, filename);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(shot.data.slice('data:image/png;base64,'.length), 'base64'));
        let progress = {}; try { progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8')); } catch { }
        progress[map.id] = { filename, capturedAt: new Date().toISOString(), width: shot.width, height: shot.height, invalid: false };
        fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(progress, null, 2), 'utf8');
      } catch (e) { return json(res, 500, { ok: false, error: `บันทึกภาพไม่สำเร็จ: ${e.message}` }); }
      return json(res, 200, { ok: true, map: map.name, filename, width: shot.width, height: shot.height });
    }
    const skillTreeMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/skill-tree$/);
    if (req.method === 'GET' && skillTreeMatch) {
      const profileId = skillTreeMatch[1];
      if (!readGameProfiles().some(p => p.id === profileId)) return json(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      const t = [...tabs.values()].find(x => x.profileId === profileId && x.state === 'helper' && !x.tab.closed);
      if (!t) return json(res, 409, { error: 'โปรไฟล์นี้ไม่มีแท็บเกมที่โหลด Helper อยู่' });
      try {
        const openedSkillUi = await t.tab.eval(`(() => { const root=document.querySelector('#skillrows'); if (root?.getClientRects().length) return false; const button=document.querySelector('#mbskill'); if (!button) return false; button.click(); return true; })()`);
        if (openedSkillUi) {
          // The game only populates #skillrows after its Skill menu is opened.
          // Wait briefly for that real UI to render before taking the snapshot.
          for (let attempt = 0; attempt < 12; attempt++) {
            await sleep(150);
            const ready = await t.tab.eval(`!!document.querySelector('#skillrows .skB-node[data-skill]')`);
            if (ready) break;
          }
        }
        const snapshot = await t.tab.eval(`(async () => {
          const root=document.querySelector('#skillrows'), room=window.__bthRoom, p=room?.state?.players?.get(room?.sessionId);
          if(!root||!p)return {error:'ยังอ่าน skill UI หรือสถานะตัวละครจากเกมไม่ได้'};
          const headers=[...root.querySelectorAll('.skB-head')].map((h,index)=>{const trait=h.querySelector('.skB-trait');return {index,className:h.className,name:h.querySelector(':scope > b')?.textContent?.trim()||'',summary:h.querySelector(':scope > small')?.textContent?.trim()||'',mastery:h.querySelector('.skB-mast span')?.textContent?.trim()||'',masteryPercent:Number(h.querySelector('.skB-mast u')?.style.width?.replace('%','')||0),traitLine:trait?.dataset.traitline||'',traitName:trait?.querySelector('.tr2tx small')?.textContent?.trim()||'',traitLocked:trait?.classList.contains('lock')||false,traitIcon:trait?.querySelector('img')?.src||'',traitProgress:trait?.querySelector('.tr2bar u')?.style.width||''};});
          const skills=[...root.querySelectorAll('.skB-node[data-skill]')].map(b=>{
            const aria=b.getAttribute('aria-label')||'', m=aria.match(/^(.*?)\\s+(\\d+)\\/(\\d+)/), cell=b.closest('.skB-cell');
            const col=(cell?.className.match(/\\bg(\\d+)\\b/)||[])[1], id=b.dataset.skill, lv=Number(p.skillLevels?.get?.(id)??m?.[2]??0), body=b.querySelector('.skB-bd');
            const labels=[...(body?.children||[])].filter(e=>e.tagName!=='B').map(e=>({tag:e.tagName,className:e.className,text:e.innerText.trim()})).filter(e=>e.text);
            const max=Number(m?.[3]||lv), mod=String(p.skillMods?.get?.(id)||'');
            return {id,name:body?.querySelector('b')?.textContent?.trim()||m?.[1]||id,level:lv,max,line:col==null?'':root.querySelector('.skB-head.g'+col+' > b')?.textContent?.trim()||'',column:col==null?null:Number(col),labels,aria,className:b.className,locked:b.classList.contains('locked'),unlockJobLevel:Number((aria.match(/ปลดล็อก Job Lv\\s*(\\d+)/)||[])[1]||0),icon:b.querySelector('.skB-ic img')?.src||'',currentEvolution:mod,evolutionAvailable:b.classList.contains('evo')||mod==='a'||mod==='b',evolutionLevel:Math.ceil(max/2)};
          });
          let traitState={};try{traitState=typeof p.traits==='string'?JSON.parse(p.traits):p.traits||{};}catch{}
          return {job:String(p.job||''),jobLevel:Number(p.jobLevel||0),skillPoints:Number(p.skillPoints||0),statPoints:Number(p.statPoints||0),stats:Object.fromEntries(['str','agi','vit','int','dex','luk'].map(k=>[k,Number(p[k]||0)])),traitState,headers,skills};
        })()`);
        if (snapshot?.error) return json(res, 409, { error: snapshot.error });
        return json(res, 200, snapshot);
      } catch (e) { return json(res, 503, { error: `อ่าน Skill UI จากเกมไม่สำเร็จ: ${e.message}` }); }
    }
    const skillPlanMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/skill-plan$/);
    const skillEvolutionMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/skill-evolution$/);
    const skillTraitMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/skill-trait$/);
    if (req.method === 'POST' && skillTraitMatch) {
      const profileId = skillTraitMatch[1], body = await new Promise(resolve => { let data = ''; req.on('data', c => { data += c; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } }); });
      const line = String(body?.line || ''), pick = String(body?.pick || '').toLowerCase();
      if (!['marksman','artillery','wind','assassin','trickery','shadow','destruction','runecraft','mind','judgment','mercy','covenant','spirits','souls','shards','fury','wounds','survival'].includes(line) || !['a','b'].includes(pick)) return json(res, 400, { error: 'สายหรือ Trait A/B ไม่ถูกต้อง' });
      if (!readGameProfiles().some(p => p.id === profileId)) return json(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      const t = [...tabs.values()].find(x => x.profileId === profileId && x.state === 'helper' && !x.tab.closed);
      if (!t) return json(res, 409, { error: 'โปรไฟล์นี้ไม่มีแท็บเกมที่พร้อม' });
      try {
        const result = await t.tab.eval(`(async()=>{const root=document.querySelector('#skillrows'),room=window.__bthRoom,p=room?.state?.players?.get(room?.sessionId),line=${JSON.stringify(line)},pick=${JSON.stringify(pick)};if(!root||!p)return {error:'อ่าน Skill UI จากเกมไม่ได้'};let traits={};try{traits=typeof p.traits==='string'?JSON.parse(p.traits):p.traits||{}}catch{};if(traits[line]===pick)return {ok:true,unchanged:true,pick};const button=root.querySelector('.skB-trait[data-traitline="'+line+'"]');if(!button)return {error:'ไม่พบ Trait ของสายนี้ในเกม'};if(button.classList.contains('lock'))return {error:'Trait จะเลือกได้เมื่อลงแต้มในสายนี้ครบ 10 แต้ม'};button.click();await new Promise(r=>setTimeout(r,60));const veil=document.querySelector('#buyconfirm'),title=document.querySelector('#bctitle')?.textContent?.trim()||'',yes=document.querySelector('#bcyes'),choice=document.querySelector('#bcbody [data-trc="'+pick+'"]');if(!veil||veil.hidden||!yes||!title.includes('Trait')||!choice)return {error:'เกมไม่เปิดหน้าต่างเลือก Trait A/B'};choice.click();const label=yes.textContent.trim();if(label==='ปิด'){yes.click();return {error:traits[line]?'เปลี่ยน Trait ที่เลือกอยู่ได้เฉพาะในเมือง':'เกมยังไม่ปลดล็อกการเลือก Trait'};}if(!label.includes('ใช้ Trait นี้'))return {error:'ปุ่มยืนยัน Trait ไม่ตรงกับเกม'};yes.click();await new Promise(r=>setTimeout(r,350));let updated={};try{updated=typeof p.traits==='string'?JSON.parse(p.traits):p.traits||{}}catch{};return {ok:true,pick:updated[line]||pick,current:updated[line]||traits[line]||''};})()`);
        if (result?.error) return json(res, 409, { error: result.error });
        return json(res, 200, result || { ok: false, error: 'เกมไม่ตอบกลับการเลือก Trait' });
      } catch (e) { return json(res, 503, { error: `เลือก Trait จาก UI เกมไม่สำเร็จ: ${e.message}` }); }
    }
    if (req.method === 'POST' && skillEvolutionMatch) {
      const profileId = skillEvolutionMatch[1], body = await new Promise(resolve => { let data = ''; req.on('data', c => { data += c; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } }); });
      const skillId = String(body?.skillId || ''), mod = String(body?.mod || '').toLowerCase();
      if (!/^[a-z0-9_]{1,80}$/.test(skillId) || !['a','b'].includes(mod)) return json(res, 400, { error: 'สกิลหรือ Evolution A/B ไม่ถูกต้อง' });
      if (!readGameProfiles().some(p => p.id === profileId)) return json(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      const t = [...tabs.values()].find(x => x.profileId === profileId && x.state === 'helper' && !x.tab.closed);
      if (!t) return json(res, 409, { error: 'โปรไฟล์นี้ไม่มีแท็บเกมที่พร้อม' });
      try {
        const result = await t.tab.eval(`(async()=>{const root=document.querySelector('#skillrows'),room=window.__bthRoom,p=room?.state?.players?.get(room?.sessionId),id=${JSON.stringify(skillId)},mod=${JSON.stringify(mod)};if(!root||!p)return {error:'อ่าน Skill UI จากเกมไม่ได้'};const node=root.querySelector('.skB-node[data-skill="'+id+'"]');if(!node||node.classList.contains('locked'))return {error:'สกิลนี้ยังเรียนไม่ได้'};const current=p.skillMods?.get?.(id)||'';if(current===mod)return {ok:true,unchanged:true,current};if(!node.classList.contains('evo')&&!current)return {error:'Evolution A/B ยังไม่ปลดล็อก · สกิลนี้ปลดล็อกที่ Lv '+Math.ceil((Number((node.getAttribute('aria-label')||'').match(/\\/(\\d+)/)?.[1]||1))/2)};const name=node.querySelector('.skB-bd>b')?.textContent?.trim()||id;if(!node.classList.contains('sel'))node.click();const choose=root.querySelector('.dk-evo [data-evo="'+mod+'"]');if(!choose)return {error:'ไม่พบปุ่ม Evolution '+mod.toUpperCase()+' ในหน้าสกิลเกม'};if(choose.disabled)return {error:'เกมยังไม่อนุญาตให้เลือก Evolution นี้'};choose.click();await new Promise(r=>setTimeout(r,80));const veil=document.querySelector('#buyconfirm'),title=document.querySelector('#bctitle')?.textContent?.trim()||'',yes=document.querySelector('#bcyes');if(!veil||veil.hidden||!yes||!title.includes(name))return {error:'เกมไม่เปิดหน้าต่างยืนยัน Evolution ของสกิลนี้'};const label=yes.textContent.trim();if(!/เลือก|เปลี่ยน/.test(label))return {error:'ปุ่มยืนยัน Evolution ไม่ตรงกับเกม'};if(label.includes('เปลี่ยน')&&!label.includes('ฟรี'))return {pending:true,message:'การเปลี่ยน Evolution นี้มีค่าใช้จ่าย · ตรวจและยืนยันในหน้าต่างเกม',title,label};yes.click();await new Promise(r=>setTimeout(r,350));const updated=room?.state?.players?.get(room?.sessionId)?.skillMods?.get?.(id)||'';return {ok:true,selected:updated||mod,current:updated||current};})()`);
        if (result?.error) return json(res, 409, { error: result.error });
        if (result?.pending) return json(res, 409, { error: result.message, pending: true });
        return json(res, 200, result || { ok: false, error: 'เกมไม่ตอบกลับการเลือก Evolution' });
      } catch (e) { return json(res, 503, { error: `เลือก Evolution จาก UI เกมไม่สำเร็จ: ${e.message}` }); }
    }
    if (skillPlanMatch && ['GET', 'PUT'].includes(req.method)) {
      const profileId = skillPlanMatch[1], profiles = readGameProfiles(), profile = profiles.find(p => p.id === profileId);
      if (!profile) return json(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      if (req.method === 'GET') return json(res, 200, { ok: true, skillPlan: profile.skillPlan || { enabled: false, job: '', items: [], jobs: {}, jobChange: { enabled: false, targetJob: 'scout', allowPaid: false }, statusPlan: { enabled: false, job: '', items: [] } } });
      const body = await new Promise(resolve => { let data = ''; req.on('data', c => { data += c; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } }); });
      if (!body || !Array.isArray(body.items) || body.items.length > 60) return json(res, 400, { error: 'รายการสกิลต้องมี 0–60 รายการ' });
      const items = [], seen = new Set();
      for (const [i, item] of body.items.entries()) {
        const skillId = String(item?.skillId || '');
        const target = Math.max(0, Math.min(30, Math.floor(Number(item?.target) || 0)));
        const baseLevel = Math.max(0, Math.min(30, Math.floor(Number(item?.baseLevel) || 0)));
        if (!/^[a-z0-9_]{1,80}$/.test(skillId) || seen.has(skillId)) return json(res, 400, { error: `รายการสกิลลำดับ ${i + 1} ไม่ถูกต้อง` });
        seen.add(skillId); items.push({ skillId, target, baseLevel });
      }
      const jobs = { ...(profile.skillPlan?.jobs || {}) };
      if (body.jobs && typeof body.jobs === 'object' && !Array.isArray(body.jobs)) {
        for (const [jobName, jobPlan] of Object.entries(body.jobs).slice(0, 20)) {
          if (!/^[a-z0-9_-]{1,40}$/i.test(jobName) || !Array.isArray(jobPlan?.items) || jobPlan.items.length > 60) continue;
          const seenJobSkills = new Set(), jobItems = [];
          for (const item of jobPlan.items) {
            const skillId = String(item?.skillId || '');
            if (!/^[a-z0-9_]{1,80}$/.test(skillId) || seenJobSkills.has(skillId)) continue;
            seenJobSkills.add(skillId);
            jobItems.push({ skillId, target: Math.max(0, Math.min(30, Math.floor(Number(item?.target) || 0))),
              baseLevel: Math.max(0, Math.min(30, Math.floor(Number(item?.baseLevel) || 0))) });
          }
          jobs[jobName] = { enabled: jobPlan.enabled === true && jobItems.length > 0, items: jobItems };
        }
      }
      const job = String(body.job || '').slice(0, 40);
      if (job) jobs[job] = { enabled: body.enabled === true && items.length > 0, items };
      const jobChange = body.jobChange || {};
      const targetJob = String(jobChange.targetJob || 'scout');
      if (!['knight','warrior','scout','rogue','mage','acolyte','summoner'].includes(targetJob)) return json(res, 400, { error: 'อาชีพปลายทางไม่ถูกต้อง' });
      const statusPlan = body.statusPlan || {}, validStats = ['str','agi','vit','int','dex','luk'], statusItems = [], seenStats = new Set();
      if (!Array.isArray(statusPlan.items) || statusPlan.items.length > 6) return json(res, 400, { error: 'รายการสเตตัสต้องมี 0–6 รายการ' });
      for (const item of statusPlan.items) {
        const stat = String(item?.stat || '').toLowerCase(), target = Math.max(0, Math.min(99, Math.floor(Number(item?.target) || 0)));
        if (!validStats.includes(stat) || seenStats.has(stat)) return json(res, 400, { error: 'ลำดับสเตตัสไม่ถูกต้อง' });
        seenStats.add(stat); statusItems.push({ stat, target });
      }
      profile.skillPlan = { enabled: body.enabled === true, job, items, jobs,
        jobChange: { enabled: jobChange.enabled === true, targetJob, allowPaid: jobChange.allowPaid === true },
        statusPlan: { enabled: statusPlan.enabled === true, job: String(statusPlan.job || '').slice(0, 40), items: statusItems } };
      saveGameProfiles(profiles);
      const results = await Promise.all([...tabs.values()].filter(t => t.profileId === profileId && t.state === 'helper' && !t.tab.closed)
        .map(async t => { try { return await t.tab.eval(`window.__bth && window.__bth.applySkillPlan(${JSON.stringify(profile.skillPlan)})`); } catch (e) { return { error: e.message }; } }));
      const failures = results.filter(r => r && r.error);
      return json(res, 200, { ok: true, skillPlan: profile.skillPlan, applied: results.length - failures.length, warning: failures.length ? 'บันทึกแล้ว แต่ส่ง Skill Plan ให้ Helper บางจอไม่สำเร็จ' : '' });
    }
    const planMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/plan$/);
    if (planMatch && ['GET', 'PUT'].includes(req.method)) {
      const profileId = planMatch[1], profiles = readGameProfiles(), profile = profiles.find(p => p.id === profileId);
      if (!profile) return json(res, 404, { ok: false, error: 'ไม่พบโปรไฟล์นี้' });
      if (req.method === 'GET') return json(res, 200, { ok: true, plan: profile.plan || { enabled: false, steps: [] } });
      const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } }); });
      if (!body || !Array.isArray(body.steps) || body.steps.length > 30) return json(res, 400, { ok: false, error: 'แผนต้องมีขั้น 0–30 ขั้น' });
      let maps;
      try { maps = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'plan_maps.json'), 'utf8')); } catch { return json(res, 500, { ok: false, error: 'อ่านข้อมูลแผนที่ไม่สำเร็จ' }); }
      const byMap = new Map(maps.map(m => [m.id, m]));
      const steps = [];
      let nextMinLevel = 1;
      for (const [i, s] of body.steps.entries()) {
        const map = byMap.get(String(s.map || ''));
        const minLevel = nextMinLevel;
        const maxLevel = Math.max(minLevel, Math.min(999, Math.floor(Number(s.maxLevel) || minLevel)));
        const x = Number(s.spot && s.spot.x), y = Number(s.spot && s.spot.y);
        if (!map || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > map.w || y > map.h)
          return json(res, 400, { ok: false, error: `ขั้น ${i + 1}: เลือกแมพและจุดฟาร์มในขอบเขตแผนที่ก่อน` });
        steps.push({ id: String(s.id || crypto.randomUUID()).slice(0, 80), name: String(s.name || `ขั้น ${i + 1}`).slice(0, 60),
          minLevel, maxLevel, map: map.id, spot: { x: +x.toFixed(2), y: +y.toFixed(2) }, mob: String(s.mob || '').slice(0, 80) });
        nextMinLevel = Math.min(999, maxLevel + 1);
      }
      profile.plan = { enabled: body.enabled === true, steps };
      if (profile.plan.enabled && steps.length) profile.farmMap = byMap.get(steps[0].map)?.name || profile.farmMap || '';
      saveGameProfiles(profiles);
      const applyResults = await Promise.all([...tabs.values()].filter(t => t.profileId === profileId && t.state === 'helper' && !t.tab.closed)
        .map(async t => { try { return await t.tab.eval(`window.__bth && window.__bth.applyPlan(${JSON.stringify(profile.plan)})`); } catch (e) { return { error: e.message }; } }));
      const failures = applyResults.filter(r => r && r.error);
      return json(res, 200, { ok: true, plan: profile.plan, applied: applyResults.length - failures.length, warning: failures.length ? 'บันทึกแล้ว แต่ส่งให้ Helper บางจอไม่สำเร็จ' : '' });
    }
    if (url.pathname === '/api/browser-mode' && req.method === 'GET') return json(res, 200, statusBody().browserMode);
    if (url.pathname === '/api/browser-mode' && req.method === 'POST') {
      const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); });
      if (!['chrome', 'edge', 'brave'].includes(body.kind)) return json(res, 400, { ok: false, error: 'เลือก Chrome, Edge หรือ Brave' });
      if ((await Promise.all(allProfileModes().map(mode => mode.isOpen()))).some(Boolean) && body.kind !== browserPrefs.kind) return json(res, 409, { ok: false, error: 'ปิดหน้าต่างเบราว์เซอร์ที่เปิดจากระบบนี้ก่อนเปลี่ยนตัวเลือก' });
      browserPrefs = { kind: body.kind };
      fs.mkdirSync(path.dirname(BROWSER_PREFS), { recursive: true });
      fs.writeFileSync(BROWSER_PREFS, JSON.stringify(browserPrefs, null, 2), 'utf8');
      return json(res, 200, { ok: true, ...statusBody().browserMode });
    }
    if (url.pathname === '/api/profiles' && req.method === 'POST') {
      const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); });
      const name = String(body.name || '').trim().slice(0, 48);
      if (!name) return json(res, 400, { ok: false, error: 'กรุณาตั้งชื่อโปรไฟล์ก่อนบันทึก' });
      const profiles = readGameProfiles();
      const count = Number.isInteger(Number(body.count)) ? Math.max(1, Math.min(50, Number(body.count))) : 1;
      const usedNames = new Set(profiles.map(p => p.name.trim().toLocaleLowerCase()));
      const created = [];
      for (let i = 0; i < count; i++) {
        const baseName = count === 1 ? name : `${name} ${String(i + 1).padStart(2, '0')}`;
        let profileName = baseName, suffix = 2;
        while (usedNames.has(profileName.toLocaleLowerCase())) {
          const tail = ` (${suffix++})`;
          profileName = `${baseName.slice(0, 48 - tail.length)}${tail}`;
        }
        usedNames.add(profileName.toLocaleLowerCase());
        created.push({ id: crypto.randomUUID(), name: profileName, createdAt: Date.now() + i, isMain: profiles.length === 0 && i === 0 });
      }
      profiles.push(...created); saveGameProfiles(profiles);
      return json(res, 201, { ok: true, profile: created[0], created, profiles });
    }
    const profileMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)$/);
    if (profileMatch && req.method === 'DELETE') {
      const profileId = profileMatch[1], profiles = readGameProfiles();
      if (!profiles.some(p => p.id === profileId)) return json(res, 404, { ok: false, error: 'ไม่พบโปรไฟล์นี้' });
      const mode = browserModeForProfile(profileId);
      if (mode && await mode.isProfileOpen(profileId)) return json(res, 409, { ok: false, error: 'ปิดหน้าต่างเกมของโปรไฟล์นี้ก่อนลบ' });
      try {
        await mode.removeProfile(profileId);
      } catch (error) {
        log(`[${profileId}] ลบข้อมูลเบราว์เซอร์ไม่สำเร็จ:`, error.message);
        return json(res, 500, { ok: false, error: 'ลบข้อมูลเบราว์เซอร์ของโปรไฟล์ไม่สำเร็จ จึงยังไม่ลบโปรไฟล์' });
      }
      mode.dispose(); profileBrowserModes.delete(profileId); profilePorts.delete(profileId);
      const remainingProfiles = profiles.filter(p => p.id !== profileId);
      if (profiles.find(p => p.id === profileId)?.isMain && remainingProfiles.length) remainingProfiles[0].isMain = true;
      saveGameProfiles(remainingProfiles);
      return json(res, 200, { ok: true, profiles: readGameProfiles() });
    }
    const mainProfileMatch = url.pathname.match(/^\/api\/profiles\/([\w-]+)\/main$/);
    if (mainProfileMatch && req.method === 'POST') {
      const profileId = mainProfileMatch[1], profiles = readGameProfiles();
      if (!profiles.some(p => p.id === profileId)) return json(res, 404, { ok: false, error: 'ไม่พบโปรไฟล์นี้' });
      const updated = profiles.map(p => ({ ...p, isMain: p.id === profileId }));
      saveGameProfiles(updated);
      return json(res, 200, { ok: true, profiles: updated });
    }
    // other files of the page (style.css, …): plain names inside manager/public only
    const sf = req.method === 'GET' && url.pathname.match(/^\/([\w-]+\.(css|js|json|png|svg|ico))$/);
    if (sf && fs.existsSync(path.join(PUBLIC, sf[1]))) {
      const type = { css: 'text/css', js: 'text/javascript', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' }[sf[2]];
      res.writeHead(200, { 'Content-Type': type + (/css|js/.test(sf[2]) ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, sf[1])));
    }
    // market (price board / one item) read through a game tab's own room — the same requests as the game's market window
    if (req.method === 'GET' && ['/api/market/board', '/api/market/item', '/api/market/counts', '/api/market/listings'].includes(url.pathname)) {
      const t = [...tabs.values()].find(x => x.state === 'helper' && !x.tab.closed);
      if (!t) return json(res, 503, { ok: false, error: 'ไม่มีแท็บเกมที่โหลด helper อยู่' });
      const qp = k => url.searchParams.get(k) || '';
      const num = (k, max) => Math.max(0, Math.min(max, Math.floor(Number(qp(k)) || 0)));
      // the same filters as the game's market window: search, category, sub-type, gear level range, affix, minimum tier
      const cat = ['weapon', 'gear', 'use', 'mat', 'card'].includes(qp('cat')) ? qp('cat') : 'all';
      const gearOnly = cat === 'all' || cat === 'weapon' || cat === 'gear';
      const filters = { q: qp('q').slice(0, 40), cat, sub: /^[a-z_]{1,30}$/.test(qp('sub')) ? qp('sub') : 'all',
        lvMin: gearOnly ? num('lvMin', 99) : 0, lvMax: gearOnly ? num('lvMax', 99) : 0,
        affix: gearOnly && /^[a-z_]{1,24}$/.test(qp('affix')) ? qp('affix') : '', tierMin: gearOnly ? num('tierMin', 8) : 0 };
      if (['normal', 'magic', 'rare', 'epic', 'unique'].includes(qp('rarity'))) filters.rarity = qp('rarity');
      const sort = ['def', 'vol', 'asc', 'desc', 'up', 'down'].includes(qp('sort')) ? qp('sort') : 'def';
      const msg = url.pathname === '/api/market/board' ? { type: 'marketBoard', ...filters, bsort: sort }
        : url.pathname === '/api/market/counts' ? { type: 'marketQuery', ...filters, sort: 'def' }
        // all listings (the game's "ประกาศทั้งหมด"): 100 per page, page index p
        : url.pathname === '/api/market/listings' ? { type: 'marketQuery', ...filters, p: num('p', 10000),
          sort: ['def', 'asc', 'desc', 'unit', 'tier', 'lvhi', 'lvlo'].includes(qp('sort')) ? qp('sort') : 'def' }
        : { type: 'marketItem', itemId: qp('id').slice(0, 300), range: ['7d', '30d'].includes(qp('range')) ? qp('range') : '7d' };
      const want = msg.type === 'marketQuery' ? 'market' : msg.type;
      // one market request at a time: replies are matched by type only, two in flight would swap their answers
      const prev = marketQueue; let release; marketQueue = new Promise(r => { release = r; });
      await prev;
      try {
        const r = await t.tab.eval(`(async () => {
          const room = window.__bthRoom; if (!room) return { ok: false, error: 'helper ยังไม่ได้จับห้องเกม' };
          const msg = ${JSON.stringify(msg)};
          const reply = await new Promise(res => { let off; const t = setTimeout(() => { off && off(); res(null); }, 6000);
            off = room.onMessage('server', m => { const e = (Array.isArray(m) ? m : [m]).find(x => x && x.type === ${JSON.stringify(want)}); if (e) { clearTimeout(t); off && off(); res(e); } });
            room.send('input', msg); });
          if (!reply) return { ok: false, error: 'ตลาดไม่ตอบ' };
          // counts only: the listings themselves are not needed (and can be big)
          if (reply.type === 'market' && !${JSON.stringify(url.pathname === '/api/market/listings')}) return { ok: true, type: 'counts', total: reply.total || 0, subCounts: reply.subCounts || null };
          return { ok: true, ...reply };
        })()`);
        return json(res, r && r.ok ? 200 : 502, r || { ok: false, error: 'อ่านไม่สำเร็จ' });
      } catch (e) { return json(res, 502, { ok: false, error: e.message }); } finally { release(); }
    }
    // Read live character wallet and base (non-job) EXP for profile dashboards and market.
    if (req.method === 'GET' && url.pathname === '/api/market/buyers') {
      const list = [];
      for (const t of tabs.values()) if (t.state === 'helper' && !t.tab.closed) {
        try {
          const r = await t.tab.eval(`(() => { const room = window.__bthRoom; const me = room && room.state && room.state.players && room.state.players.get(room.sessionId);
            if (!me) return null;
            const expKeys = ['exp', 'xp', 'experience', 'levelExp', 'levelXp', 'currentExp', 'currentXp', 'baseExp', 'baseXp', 'totalExp', 'totalXp', 'expNow', 'xpNow'];
            const expKey = expKeys.find(key => !/job/i.test(key) && typeof me[key] === 'number' && Number.isFinite(me[key]))
              || Object.keys(me).find(key => /^(?:base|level|current|total)?(?:exp|xp|experience)(?:now|current|total|progress)?$/i.test(key) && !/job/i.test(key) && typeof me[key] === 'number' && Number.isFinite(me[key]));
            const levelExpFields = Object.keys(me).filter(key => /exp|xp/i.test(key) && !/job/i.test(key)).map(key => ({ key, value: typeof me[key] === 'number' && Number.isFinite(me[key]) ? me[key] : null }));
            return { name: me.name, gold: Number(me.silver ?? me.gold ?? 0), level: Number(me.level ?? 0), levelExp: expKey ? me[expKey] : null, levelExpSource: expKey || null, levelExpFields }; })()`);
          if (r) list.push({ tabId: t.id, browser: t.browser, ...r });
        } catch { }
      }
      return json(res, 200, { ok: true, buyers: list });
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
    if (url.pathname === '/api/shutdown') {
      const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); });
      const closeBrowsers = body.closeBrowsers === true;
      json(res, 200, { ok: true, closingBrowsers: closeBrowsers });
      if (!shutdownRequested) {
        shutdownRequested = true;
        setTimeout(async () => {
          await Promise.all(allProfileModes().map(mode => closeBrowsers ? mode.shutdown().catch(() => {}) : Promise.resolve(mode.dispose())));
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 20000).unref();
        }, 150).unref();
      }
      return;
    }
    // buy one market listing with the character of a game tab (the game's own marketBuy; the item arrives by mail)
    if (url.pathname === '/api/market/buy') {
      const body = await new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r(null); } }); });
      const id = Math.floor(Number(body && body.id)), qty = Math.floor(Number(body && body.qty)) || 0;
      const t = body && tabs.get(String(body.tabId));
      if (!t || t.state !== 'helper' || !(id > 0)) return json(res, 400, { ok: false, error: 'ข้อมูลการซื้อไม่ครบ' });
      const prev = marketQueue; let release; marketQueue = new Promise(r => { release = r; });
      await prev;
      try {
        const msg = qty > 0 ? { type: 'marketBuy', id, qty } : { type: 'marketBuy', id };
        const r = await t.tab.eval(`(async () => {
          const room = window.__bthRoom; if (!room) return { ok: false, error: 'helper ยังไม่ได้จับห้องเกม' };
          const reply = await new Promise(res => { let off; const tm = setTimeout(() => { off && off(); res(null); }, 8000);
            off = room.onMessage('server', m => { const e = (Array.isArray(m) ? m : [m]).find(x => x && x.type === 'marketResult'); if (e) { clearTimeout(tm); off && off(); res(e); } });
            room.send('input', ${JSON.stringify(msg)}); });
          return reply ? { ok: !!reply.ok, error: reply.ok ? '' : (reply.reason || 'ซื้อไม่สำเร็จ') } : { ok: false, error: 'ตลาดไม่ตอบ (ไม่แน่ใจว่าซื้อได้หรือไม่ — ดูในจดหมาย / ประวัติ)' };
        })()`);
        return json(res, 200, r);
      } catch (e) { return json(res, 502, { ok: false, error: e.message }); } finally { release(); }
    }
    let m;
    if ((m = url.pathname.match(/^\/api\/browser\/shared\/open\/([\w-]+)$/)) && req.method === 'POST') {
      const profile = readGameProfiles().find(p => p.id === m[1]);
      if (!profile) return json(res, 404, { ok: false, error: 'บันทึกโปรไฟล์ก่อนเปิดหน้าต่างเกม' });
      const existing = [...tabs.values()].find(t => t.browser === 'shared' && t.clientId === profile.id && !t.tab.closed);
      if (existing) {
        await existing.mode?.windowAction(existing.id, 'focus').catch(() => {});
        return json(res, 200, { ok: true, msg: `โปรไฟล์ “${profile.name}” เปิดอยู่แล้ว`, targetId: existing.id });
      }
      const mode = browserModeForProfile(profile.id);
      await mode.start();
      try {
        return json(res, 200, await mode.launch(profile.id));
      } catch (primaryError) {
        // If Chromium cannot launch/attach the profile's dedicated process,
        // use another live CDP browser with a fresh isolated BrowserContext.
        // This keeps this profile's game cookies separate from other profiles.
        for (const otherMode of allProfileModes()) {
          if (otherMode === mode || !(await otherMode.isOpen().catch(() => false))) continue;
          try { return json(res, 200, await otherMode.launchIsolated(profile.id)); }
          catch (fallbackError) { log(`[${profile.id}] isolated browser fallback failed:`, fallbackError.message); }
        }
        throw primaryError;
      }
    }
    if (url.pathname === '/api/browser/shared/close-all' && req.method === 'POST') {
      const results = await Promise.all(allProfileModes().map(mode => mode.closeAll().catch(() => ({ count: 0 }))));
      return json(res, 200, { ok: true, count: results.reduce((sum, item) => sum + (item.count || 0), 0) });
    }
    if ((m = url.pathname.match(/^\/api\/browser\/shared\/close\/([\w-]+)$/)) && req.method === 'POST') {
      const tab = tabs.get(m[1]);
      if (!tab?.mode) return json(res, 404, { ok: false, error: 'ไม่พบหน้าต่างนี้' });
      await tab.mode.close(m[1]); return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/browser\/shared\/window\/([\w-]+)$/)) && req.method === 'POST') {
      const tab = tabs.get(m[1]);
      if (!tab?.mode) return json(res, 404, { ok: false, error: 'ไม่พบหน้าต่างนี้' });
      await tab.mode.windowAction(m[1], url.searchParams.get('action'), url.searchParams); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/window-layout' && req.method === 'POST') {
      const requestedLayout = url.searchParams.get('layout');
      const layout = ['compact', 'side', 'grid', 'custom'].includes(requestedLayout) ? requestedLayout : 'grid';
      const colsArg = Math.max(1, Math.min(10, Number.parseInt(url.searchParams.get('cols'), 10) || 3));
      const rowsArg = Math.max(1, Math.min(10, Number.parseInt(url.searchParams.get('rows'), 10) || 3));
      const orderedProfiles = readGameProfiles();
      const windows = orderedProfiles.map(profile => sharedTabs().find(tab => tab.clientId === profile.id && tab.mode && !tab.tab.closed)).filter(Boolean);
      if (!windows.length) return json(res, 409, { ok: false, error: 'ยังไม่มีหน้าต่างเกมที่เปิดอยู่' });
      const screenSize = await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output "$($a.Width),$($a.Height)"'], { windowsHide: true, timeout: 5000 }, (_error, stdout) => {
        const match = String(stdout || '').match(/(\d+)\s*,\s*(\d+)/);
        resolve(match ? { width: +match[1], height: +match[2] } : { width: 1920, height: 1040 });
      }));
      const { width, height } = screenSize, count = windows.length;
      const cols = layout === 'custom' ? colsArg : layout === 'side' ? count : layout === 'compact' ? Math.max(1, Math.floor(width / 640)) : (count <= 2 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4);
      const rows = layout === 'custom' ? rowsArg : layout === 'compact' ? Math.max(1, Math.floor(height / 520)) : Math.ceil(count / cols);
      const cellWidth = Math.max(320, Math.floor(width / cols)), cellHeight = Math.max(260, Math.floor(height / rows));
      const results = await Promise.all(windows.map((tab, index) => {
        const cell = index % (cols * rows);
        return tab.mode.windowAction(tab.id, 'set-bounds', { x: (cell % cols) * cellWidth, y: Math.floor(cell / cols) * cellHeight, w: cellWidth, h: cellHeight }).then(() => true, () => false);
      }));
      const moved = results.filter(Boolean).length;
      return json(res, moved ? 200 : 502, { ok: moved > 0, count: moved, total: windows.length, cols, rows, error: moved ? '' : 'จัดตำแหน่งหน้าต่างไม่สำเร็จ' });
    }
    if (url.pathname === '/api/window-visibility' && req.method === 'POST') {
      const windows = sharedTabs().filter(tab => tab.mode && !tab.tab.closed);
      if (!windows.length) return json(res, 409, { ok: false, error: 'ยังไม่มีหน้าต่างเกมที่เปิดอยู่' });
      const hide = !gameWindowsParked;
      const results = await Promise.all(windows.map(tab => tab.mode.windowAction(tab.id, hide ? 'park' : 'show').then(() => true, () => false)));
      gameWindowsParked = hide && results.some(Boolean);
      return json(res, 200, { ok: results.some(Boolean), gameWindowsParked, count: results.filter(Boolean).length });
    }
    if ((m = url.pathname.match(/^\/api\/tab\/([\w-]+)\/(toggle|reload|bank-test)$/))) {
      const t = tabs.get(m[1]);
      if (!t) return json(res, 404, { ok: false, msg: 'ไม่เจอแท็บนี้' });
      if (m[2] === 'toggle') { await t.tab.eval(`window.__bth ? (window.__bth.toggle(), window.__bth.cfg.running) : null`); return json(res, 200, { ok: true }); }
      if (m[2] === 'bank-test') {
        const result = await t.tab.eval(`window.__bth?.testBankDeposit ? window.__bth.testBankDeposit() : false`);
        return json(res, result ? 200 : 502, { ok: !!result, msg: result ? 'ทดสอบคลังเสร็จ' : 'ทดสอบคลังไม่สำเร็จ' });
      }
      await reloadHelper(t); return json(res, 200, { ok: true, msg: 'โหลด helper ใหม่แล้ว' });
    }
    if (url.pathname === '/api/update/settings' && req.method === 'POST') {
      const body = await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); });
      if (body.autoPull !== undefined && typeof body.autoPull !== 'boolean' || body.autoReloadHelpers !== undefined && typeof body.autoReloadHelpers !== 'boolean') return json(res, 400, { ok: false, error: 'ข้อมูลการตั้งค่าไม่ถูกต้อง' });
      if (IS_MAIN && body.autoPull === true) return json(res, 409, { ok: false, error: 'เครื่องหลักไม่ดึงอัปเดตอัตโนมัติ' });
      if (typeof body.autoPull === 'boolean') AUTO_PULL = body.autoPull;
      if (typeof body.autoReloadHelpers === 'boolean') AUTO_RELOAD_HELPERS = body.autoReloadHelpers;
      fs.mkdirSync(path.dirname(UPDATE_PREFS), { recursive: true });
      fs.writeFileSync(UPDATE_PREFS, JSON.stringify({ autoPull: AUTO_PULL, autoReloadHelpers: AUTO_RELOAD_HELPERS }, null, 2), 'utf8');
      return json(res, 200, { ok: true, autoPull: AUTO_PULL, autoReloadHelpers: AUTO_RELOAD_HELPERS });
    }
    if (url.pathname === '/api/update/check' && req.method === 'POST') {
      if (updateBusy) return json(res, 409, { ok: false, error: 'กำลังตรวจหรืออัปเดตอยู่ กรุณารอสักครู่' });
      updateBusy = true;
      try {
        const checked = await checkUpdate(true);
        if (AUTO_PULL && checked.behind) {
          const applied = await stageTokenUpdate();
          return json(res, 200, { ok: applied.ok, update: { ...update, main: IS_MAIN, autoPull: AUTO_PULL, autoReloadHelpers: AUTO_RELOAD_HELPERS, busy: false, serverStartedAt: SERVER_STARTED_AT }, applied });
        }
        return json(res, 200, { ok: true, update: { ...update, main: IS_MAIN, autoPull: AUTO_PULL, autoReloadHelpers: AUTO_RELOAD_HELPERS, busy: false, serverStartedAt: SERVER_STARTED_AT } });
      } finally { updateBusy = false; }
    }
    if ((url.pathname === '/api/update/stage' || url.pathname === '/api/update/pull') && req.method === 'POST') {
      if (updateBusy) return json(res, 409, { ok: false, msg: 'กำลังตรวจหรืออัปเดตอยู่ กรุณารอสักครู่' });
      updateBusy = true;
      try { return json(res, 200, await stageTokenUpdate()); } finally { updateBusy = false; }
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) { return json(res, 500, { ok: false, msg: e.message }); }
});

(async () => {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') { log('Node รุ่นนี้เก่าเกินไป (ต้อง 22 ขึ้นไป)'); process.exit(1); }
  server.on('error', e => { log(e.code === 'EADDRINUSE' ? `port ${PORT} ถูกใช้อยู่ — เปิดตัวจัดการซ้ำอยู่หรือเปล่า?` : e.message); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => log(`ตัวจัดการ Binder Town: http://localhost:${PORT}`));
  if (IS_MAIN) log('เครื่องหลัก (.binder-main) — ไม่ pull อัตโนมัติ');
  if (AUTO_PULL) runUpdateCycle();
  else checkUpdate(false);
  setInterval(() => runUpdateCycle().catch(e => log('อัปเดตอัตโนมัติ error: ' + e.message)), UPDATE_CHECK_MS);
  for (const profile of readGameProfiles()) browserModeForProfile(profile.id).start().catch(e => log(`เริ่มจัดการจอ ${profile.name} ไม่สำเร็จ:`, e.message));
  loop();
})();
