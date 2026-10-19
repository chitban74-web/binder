// Binder Town manager — web dashboard on http://localhost:3889
//  • opens each saved game profile in its own persistent Chrome / Edge / Brave data directory
//  • loads helper/binder_helper.js and its per-menu modules in every game tab
//  • shows each tab's helper status, start / stop / reload helper from the web
//  • updates from Git clones or GitHub ZIP installs; after an update the manager restarts itself
// usage: node manager/server.js   (Start_Binder.bat does this)
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto'), { execFile } = require('child_process');
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
const CHECK_MS = 3000, UPDATE_CHECK_MS = 3 * 60e3;
// main machine (has the git-ignored file .binder-main): pushes, never fetches / pulls by itself.
// every other machine follows it: fetch every 3 minutes and pull as soon as there is a new commit.
const IS_MAIN = fs.existsSync(path.join(ROOT, '.binder-main'));
const AUTO_PULL = !IS_MAIN && process.env.BINDER_AUTO_UPDATE !== '0';
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
  if (resumeMode === 'gathering') await t.tab.eval(`window.__bth && !window.__bth.cfg.gathering.enabled && document.querySelector('#bthgrun')?.click()`);
  else if (resumeMode === 'farm') await t.tab.eval(`window.__bth && !window.__bth.cfg.running && window.__bth.toggle()`);
  log(`[${t.browser}] ${t.id.slice(0, 6)}: โหลด helper แล้ว (${r})`);
}
async function reloadHelper(t) {
  const resumeMode = await t.tab.eval(`(() => { const c = window.__bth && window.__bth.cfg; const m = c && (c.mode || (c.gathering?.enabled ? 'gathering' : c.running ? 'farm' : 'stopped')); if (window.__bth) { window.__bth.stop(); window.__bth.remove(); } return m; })()`);
  t.state = 'world';
  await inject(t, resumeMode);
}

async function checkTab(key, target, mode) {
  let t = tabs.get(target.id);
  if (!t || t.tab.closed) {
    if (!target.webSocketDebuggerUrl) return;
    t = { id: target.id, tab: new Tab(target), browser: key, mode, state: 'loading', status: null, injecting: false };
    tabs.set(target.id, t);
  }
  if (mode) t.mode = mode;
  t.url = target.url; t.title = target.title; t.seen = Date.now();
  if (t.injecting) return;
  const s = await t.tab.eval(STATE_JS);
  t.clientId = s.clientId || t.clientId || '';
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
        try { await checkTab('shared', target, mode); } catch (e) { if (!/closed|timeout|connect/.test(e.message)) log(`[${profileId}] ตรวจแท็บไม่ได้:`, e.message); }
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
async function isGitInstall() {
  const top = await git('rev-parse', '--show-toplevel');
  return top.ok && path.resolve(top.out).toLowerCase() === path.resolve(ROOT).toLowerCase();
}
const UPDATE_REPO_URL = 'https://github.com/chitban74-web/binder.git';
const UPDATE_REPO_API = 'https://api.github.com/repos/chitban74-web/binder';
const ZIP_VERSION_FILE = path.join(DATA_ROOT, 'profiles', '.binder-zip-version.json');
const update = { isRepo: false, branch: '', commit: '', date: '', behind: 0, incoming: [], checkedAt: 0, error: '' };
async function latestZipCommit() {
  const r = await fetch(`${UPDATE_REPO_API}/commits/main`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Binder-Town-Updater' } });
  if (!r.ok) throw new Error(`GitHub API ตอบกลับ HTTP ${r.status}`);
  const c = await r.json();
  if (!/^[a-f0-9]{40}$/i.test(c.sha || '')) throw new Error('อ่าน commit ล่าสุดจาก GitHub ไม่สำเร็จ');
  return { sha: c.sha, date: c.commit?.committer?.date || c.commit?.author?.date || '' };
}
async function checkZipUpdate() {
  update.isRepo = false;
  update.source = 'zip';
  update.branch = 'main';
  update.behind = 0;
  update.incoming = [];
  update.error = '';
  try {
    const latest = await latestZipCommit();
    let installed = '';
    try { installed = JSON.parse(fs.readFileSync(ZIP_VERSION_FILE, 'utf8')).sha || ''; } catch { }
    update.commit = latest.sha.slice(0, 7);
    update.date = latest.date ? latest.date.slice(0, 16).replace('T', ' ') : '';
    update.behind = installed === latest.sha ? 0 : 1;
    update.incoming = update.behind ? [`${latest.sha.slice(0, 7)} GitHub ZIP update`] : [];
    update.error = '';
  } catch (e) {
    update.error = 'เช็ก ZIP อัปเดตจาก GitHub ไม่สำเร็จ: ' + e.message;
  }
  update.checkedAt = Date.now();
  return update;
}
function runPowerShell(args, env) {
  return new Promise((resolve, reject) => execFile('powershell.exe', args, { windowsHide: true, timeout: 120000, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
    err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout).trim())));
}
function copyZipFiles(source, destination, backupRoot) {
  const preserve = new Set(['.git', '.binder-main', 'bin', 'profiles', 'raw', 'data']);
  let copied = 0, backedUp = 0;
  function visit(src, rel = '') {
    const name = path.basename(src);
    const nextRel = rel ? path.join(rel, name) : name;
    const parts = nextRel.split(path.sep);
    if (parts.some(p => preserve.has(p)) || /^Binder-Town-Manager\.exe$/i.test(name) || (parts[0] === 'manager' && name === 'server.log')) return;
    const dst = path.join(destination, nextRel);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const child of fs.readdirSync(src)) visit(path.join(src, child), nextRel);
      return;
    }
    if (!st.isFile()) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) {
      const old = fs.readFileSync(dst), incoming = fs.readFileSync(src);
      if (!old.equals(incoming)) {
        const backup = path.join(backupRoot, nextRel);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(dst, backup);
        backedUp++;
      }
    }
    fs.copyFileSync(src, dst);
    copied++;
  }
  for (const child of fs.readdirSync(source)) visit(path.join(source, child));
  return { copied, backedUp };
}
async function pullZipUpdate() {
  let tempDir = '';
  try {
    const latest = await latestZipCommit();
    let installed = '';
    try { installed = JSON.parse(fs.readFileSync(ZIP_VERSION_FILE, 'utf8')).sha || ''; } catch { }
    if (installed === latest.sha) return { ok: true, msg: 'เป็นเวอร์ชันล่าสุดแล้ว' };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-town-update-'));
    const response = await fetch(`https://codeload.github.com/chitban74-web/binder/zip/${latest.sha}`, { headers: { 'User-Agent': 'Binder-Town-Updater' } });
    if (!response.ok) throw new Error(`ดาวน์โหลด ZIP ไม่สำเร็จ (HTTP ${response.status})`);
    const archive = path.join(tempDir, 'source.zip');
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const extracted = path.join(tempDir, 'extracted');
    fs.mkdirSync(extracted);
    await runPowerShell(['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BINDER_UPDATE_ARCHIVE -DestinationPath $env:BINDER_UPDATE_EXTRACTED -Force'], {
      BINDER_UPDATE_ARCHIVE: archive, BINDER_UPDATE_EXTRACTED: extracted,
    });
    const root = fs.readdirSync(extracted).map(n => path.join(extracted, n)).find(p => fs.statSync(p).isDirectory());
    if (!root || !fs.existsSync(path.join(root, 'manager', 'server.js'))) throw new Error('ZIP ไม่มีไฟล์ Binder Town ที่คาดไว้');
    const backupRoot = path.join(DATA_ROOT, 'profiles', 'zip-update-backup', new Date().toISOString().replace(/[:.]/g, '-'));
    const result = copyZipFiles(root, ROOT, backupRoot);
    fs.mkdirSync(path.dirname(ZIP_VERSION_FILE), { recursive: true });
    fs.writeFileSync(ZIP_VERSION_FILE, JSON.stringify({ sha: latest.sha, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    setTimeout(() => { log('ตัวจัดการถูกอัปเดตจาก ZIP — รีสตาร์ต'); process.exit(RESTART_CODE); }, 800);
    return { ok: true, msg: `อัปเดตจาก GitHub ZIP แล้ว (${result.copied} ไฟล์)` + (result.backedUp ? ` · สำรองไฟล์เดิม ${result.backedUp} ไฟล์ไว้ใน profiles/zip-update-backup` : '') , restart: true };
  } catch (e) {
    return { ok: false, msg: 'อัปเดตจาก GitHub ZIP ไม่สำเร็จ: ' + e.message };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
async function checkUpdate(fetchFirst = true) {
  update.isRepo = await isGitInstall();
  if (!update.isRepo) return checkZipUpdate();
  update.source = 'git';
  update.branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).out;
  const head = await git('log', '-1', '--format=%h|%cd', '--date=format:%Y-%m-%d %H:%M');
  [update.commit, update.date] = head.out.split('|');
  if (fetchFirst) {
    // Always use the public repository URL and ignore saved credentials; no token is needed.
    const remote = await git('remote', 'set-url', 'origin', UPDATE_REPO_URL);
    if (!remote.ok) {
      update.error = 'ตั้งค่า GitHub URL ไม่สำเร็จ: ' + remote.err;
      update.checkedAt = Date.now();
      return update;
    }
    const f = await git('-c', 'credential.helper=', 'fetch', '--quiet', 'origin');
    const auth = /could not read Username|Invalid username or token|Authentication failed|terminal prompts disabled/i.test(f.err);
    update.error = f.ok ? '' : auth ? 'ดาวน์โหลดไม่ได้ — ตรวจว่า repository เปิดเป็นสาธารณะ: ' + UPDATE_REPO_URL : 'git fetch ไม่สำเร็จ: ' + f.err;
  }
  const up = await git('rev-list', '--count', 'HEAD..@{u}');
  update.behind = up.ok ? +up.out || 0 : 0;
  const inc = update.behind ? await git('log', '--format=%h %s', 'HEAD..@{u}') : { out: '' };
  update.incoming = inc.out ? inc.out.split('\n') : [];
  update.checkedAt = Date.now();
  return update;
}
async function pullUpdate() {
  if (!(await isGitInstall())) return pullZipUpdate();
  const before = (await git('rev-parse', 'HEAD')).out;
  const st = await git('status', '--porcelain', '--untracked-files=no');
  if (st.out && !IS_MAIN) {
    // Preserve child-machine edits in a stash, then allow the update to continue.
    const saved = await git('stash', 'push', '-m', 'Binder Town auto-update backup');
    if (!saved.ok) return { ok: false, msg: 'บันทึกไฟล์ที่แก้ในเครื่องลง Git stash ไม่สำเร็จ — อัปเดตไม่ได้:\n' + saved.err };
  } else if (st.out) {
    return { ok: false, msg: 'มีไฟล์ที่แก้ในเครื่องยังไม่ได้ commit — อัปเดตไม่ได้:\n' + st.out };
  }
  const p = await git('-c', 'credential.helper=', 'pull', '--ff-only');
  if (!p.ok) return { ok: false, msg: 'git pull ไม่สำเร็จ: ' + p.err };
  const after = (await git('rev-parse', 'HEAD')).out;
  if (before === after) return { ok: true, msg: 'เป็นเวอร์ชันล่าสุดแล้ว' };
  const changed = (await git('diff', '--name-only', before, after)).out.split('\n').filter(Boolean);
  await checkUpdate(false);
  // new helper -> reload it in every tab (keeps ▶ state)
  let reloaded = 0;
  if (changed.some(f => f.startsWith('helper/'))) for (const t of tabs.values()) if (t.state === 'helper') { try { await reloadHelper(t); reloaded++; } catch { } }
  const restart = changed.some(f => f.startsWith('manager/'));
  if (restart) setTimeout(() => { log('ตัวจัดการถูกอัปเดต — รีสตาร์ต'); process.exit(RESTART_CODE); }, 800);
  return { ok: true, msg: `อัปเดตแล้ว ${before.slice(0, 7)} → ${after.slice(0, 7)} (${changed.length} ไฟล์)` + (reloaded ? ` · โหลด helper ใหม่ ${reloaded} แท็บ` : '') + (restart ? ' · ตัวจัดการกำลังรีสตาร์ต' : ''), changed, restart };
}

// ---------------- http ----------------
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

function statusBody() {
  const findBrowser = kind => exeOf(kind);
  return {
    update: { ...update, main: IS_MAIN, autoPull: AUTO_PULL },
    gameProfiles: readGameProfiles(),
      browserMode: { kind: browserPrefs.kind, name: ({ edge: 'Microsoft Edge', brave: 'Brave', chrome: 'Google Chrome' })[browserPrefs.kind],
      path: findBrowser(browserPrefs.kind) || '',
      installed: !!findBrowser(browserPrefs.kind), running: sharedTabs().some(t => !t.tab.closed), port: 'แยกตามโปรไฟล์',
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
        created.push({ id: crypto.randomUUID(), name: profileName, createdAt: Date.now() + i });
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
      saveGameProfiles(profiles.filter(p => p.id !== profileId));
      return json(res, 200, { ok: true, profiles: readGameProfiles() });
    }
    // other files of the page (style.css, …): plain names inside manager/public only
    const sf = req.method === 'GET' && url.pathname.match(/^\/([\w-]+\.(css|js|png|svg|ico))$/);
    if (sf && fs.existsSync(path.join(PUBLIC, sf[1]))) {
      const type = { css: 'text/css', js: 'text/javascript', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' }[sf[2]];
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
        // all listings (the game's "ประกาศทั้งหมด"): 100 per page, page index p; the game pages by row offset `off`
        // (it ignores `p` and always answers the first 100)
        : url.pathname === '/api/market/listings' ? { type: 'marketQuery', ...filters, off: num('p', 10000) * 100,
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
    // characters that can buy from the market: every game tab with the helper (name + Gold)
    if (req.method === 'GET' && url.pathname === '/api/market/buyers') {
      const list = [];
      for (const t of tabs.values()) if (t.state === 'helper' && !t.tab.closed) {
        try {
          const r = await t.tab.eval(`(() => { const room = window.__bthRoom; const me = room && room.state && room.state.players && room.state.players.get(room.sessionId);
            return me ? { name: me.name, gold: Number(me.silver ?? me.gold ?? 0) } : null; })()`);
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
      return json(res, 200, await mode.launch(profile.id));
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
    if ((m = url.pathname.match(/^\/api\/tab\/([\w-]+)\/(toggle|reload)$/))) {
      const t = tabs.get(m[1]);
      if (!t) return json(res, 404, { ok: false, msg: 'ไม่เจอแท็บนี้' });
      if (m[2] === 'toggle') { await t.tab.eval(`window.__bth ? (window.__bth.toggle(), window.__bth.cfg.running) : null`); return json(res, 200, { ok: true }); }
      await reloadHelper(t); return json(res, 200, { ok: true, msg: 'โหลด helper ใหม่แล้ว' });
    }
    if (url.pathname === '/api/update/check') return json(res, 200, { ok: true, update: { ...await checkUpdate(true), main: IS_MAIN, autoPull: AUTO_PULL } });
    if (url.pathname === '/api/update/pull') return json(res, 200, await pullUpdate());
    return json(res, 404, { error: 'not found' });
  } catch (e) { return json(res, 500, { ok: false, msg: e.message }); }
});

(async () => {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') { log('Node รุ่นนี้เก่าเกินไป (ต้อง 22 ขึ้นไป)'); process.exit(1); }
  server.on('error', e => { log(e.code === 'EADDRINUSE' ? `port ${PORT} ถูกใช้อยู่ — เปิดตัวจัดการซ้ำอยู่หรือเปล่า?` : e.message); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => log(`ตัวจัดการ Binder Town: http://localhost:${PORT}`));
  if (IS_MAIN) log('เครื่องหลัก (.binder-main) — ไม่ pull อัตโนมัติ');
  const autoPull = async () => {
    const u = await checkUpdate(true);
    if (!u.behind) return;
    const r = await pullUpdate();
    log(r.ok ? 'อัปเดตอัตโนมัติ: ' + r.msg : 'อัปเดตอัตโนมัติไม่สำเร็จ: ' + r.msg);
  };
  if (AUTO_PULL) { autoPull(); setInterval(() => autoPull().catch(e => log('อัปเดตอัตโนมัติ error: ' + e.message)), UPDATE_CHECK_MS); }
  else checkUpdate(false);
  for (const profile of readGameProfiles()) browserModeForProfile(profile.id).start().catch(e => log(`เริ่มจัดการจอ ${profile.name} ไม่สำเร็จ:`, e.message));
  loop();
})();
