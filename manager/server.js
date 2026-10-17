// Binder Town manager — web dashboard on http://localhost:3889
//  • opens Edge / Chrome / Brave / Vivaldi (own profile + debug port) on the game
//  • keeps helper/binder_helper.js loaded in every game tab (first load and every page reload)
//  • shows each tab's helper status, start / stop / reload helper from the web
//  • updates from git (fetch / pull --ff-only); after a pull the helper is reloaded in every tab,
//    and if manager/ itself changed the server exits with code 3 so Start_Binder.bat restarts it
// usage: node manager/server.js   (Start_Binder.bat does this)
const fs = require('fs'), path = require('path'), http = require('http'), { execFile } = require('child_process');
const { GAME_URL, ROOT, BROWSERS, exeOf, targets, openBrowser, Tab } = require('./browser');

const PORT = +process.env.BINDER_PORT || 3889;
const HELPER = path.join(ROOT, 'helper', 'binder_helper.js');
const PUBLIC = path.join(__dirname, 'public');
const CHECK_MS = 3000, UPDATE_CHECK_MS = 3 * 60e3;
// main machine (has the git-ignored file .binder-main): pushes, never fetches / pulls by itself.
// every other machine follows it: fetch every 3 minutes and pull as soon as there is a new commit.
const IS_MAIN = fs.existsSync(path.join(ROOT, '.binder-main'));
const AUTO_PULL = !IS_MAIN && process.env.BINDER_AUTO_UPDATE !== '0';
const RESTART_CODE = 3;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- game tabs ----------------
let marketQueue = Promise.resolve(); // market requests through the game tab run one after another
const tabs = new Map(); // targetId -> { tab, browser, url, title, state, status, injecting }
const STATE_JS = `(() => ({ helper: !!window.__bth, inWorld: !!(document.getElementById('mapname') && document.getElementById('mapname').textContent.trim() && document.getElementById('autobig')),
  status: window.__bth && window.__bth.status ? window.__bth.status() : null }))()`;

async function inject(t, keepRunning) {
  const code = fs.readFileSync(HELPER, 'utf8'); // read every time: updates apply on the next load
  const r = await t.tab.eval(code);
  if (keepRunning) await t.tab.eval(`window.__bth && !window.__bth.cfg.running && window.__bth.toggle()`);
  log(`[${t.browser}] ${t.id.slice(0, 6)}: โหลด helper แล้ว (${r})`);
}
async function reloadHelper(t) {
  const wasRunning = await t.tab.eval(`(() => { const r = !!(window.__bth && window.__bth.cfg.running); if (window.__bth) { window.__bth.stop(); window.__bth.remove(); } return r; })()`);
  t.state = 'world';
  await inject(t, wasRunning);
}

async function checkTab(key, target) {
  let t = tabs.get(target.id);
  if (!t || t.tab.closed) {
    if (!target.webSocketDebuggerUrl) return;
    t = { id: target.id, tab: new Tab(target), browser: key, state: 'loading', status: null, injecting: false };
    tabs.set(target.id, t);
  }
  t.url = target.url; t.title = target.title; t.seen = Date.now();
  if (t.injecting) return;
  const s = await t.tab.eval(STATE_JS);
  t.status = s.status;
  const state = s.helper ? 'helper' : s.inWorld ? 'world' : 'loading';
  if (state !== t.state) log(`[${key}] ${t.id.slice(0, 6)}: ${state === 'helper' ? 'helper ทำงาน' : state === 'world' ? 'เข้าเกมแล้ว' : 'ยังไม่เข้าเกม'}`);
  t.state = state;
  if (state !== 'world') return;
  t.injecting = true;
  try { await inject(t, false); t.state = 'helper'; } catch (e) { log('โหลด helper ไม่สำเร็จ:', e.message); } finally { t.injecting = false; }
}

const browserUp = {};
async function loop() {
  for (;;) {
    for (const [key, b] of Object.entries(BROWSERS)) {
      const list = await targets(b.port);
      browserUp[key] = !!list;
      if (!list) continue;
      for (const target of list) if (target.type === 'page' && String(target.url).startsWith(GAME_URL)) {
        try { await checkTab(key, target); } catch (e) { if (!/closed|timeout|connect/.test(e.message)) log('ตรวจแท็บไม่ได้:', e.message); }
      }
    }
    for (const [id, t] of tabs) if (t.tab.closed || Date.now() - (t.seen || 0) > 15000) { t.tab.close(); tabs.delete(id); }
    await sleep(CHECK_MS);
  }
}

// ---------------- git update ----------------
const git = (...args) => new Promise(resolve => execFile('git', args, { cwd: ROOT, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) =>
  resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || (err && err.message) || '').trim() })));
const update = { isRepo: false, branch: '', commit: '', date: '', behind: 0, incoming: [], checkedAt: 0, error: '' };
async function checkUpdate(fetchFirst = true) {
  const repo = await git('rev-parse', '--is-inside-work-tree');
  update.isRepo = repo.ok && repo.out === 'true';
  if (!update.isRepo) { update.error = 'โฟลเดอร์นี้ไม่ใช่ git repo (clone มาจาก GitHub ก่อนถึงอัปเดตได้)'; return update; }
  update.branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).out;
  const head = await git('log', '-1', '--format=%h|%cd', '--date=format:%Y-%m-%d %H:%M');
  [update.commit, update.date] = head.out.split('|');
  if (fetchFirst) {
    const f = await git('fetch', '--quiet', 'origin');
    // GitHub wants a login: this PC needs the read-only token (set_token.bat in the Binder_Town folder)
    const auth = /could not read Username|Invalid username or token|Authentication failed|terminal prompts disabled/i.test(f.err);
    update.error = f.ok ? '' : auth ? 'GitHub ต้องใช้ token — ดับเบิลคลิก set_token.bat ในโฟลเดอร์ Binder_Town แล้ววาง token' : 'git fetch ไม่สำเร็จ: ' + f.err;
  }
  const up = await git('rev-list', '--count', 'HEAD..@{u}');
  update.behind = up.ok ? +up.out || 0 : 0;
  const inc = update.behind ? await git('log', '--format=%h %s', 'HEAD..@{u}') : { out: '' };
  update.incoming = inc.out ? inc.out.split('\n') : [];
  update.checkedAt = Date.now();
  return update;
}
async function pullUpdate() {
  const before = (await git('rev-parse', 'HEAD')).out;
  const st = await git('status', '--porcelain', '--untracked-files=no');
  if (st.out) return { ok: false, msg: 'มีไฟล์ที่แก้ในเครื่องยังไม่ได้ commit — อัปเดตไม่ได้:\n' + st.out };
  const p = await git('pull', '--ff-only');
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
  return {
    update: { ...update, main: IS_MAIN, autoPull: AUTO_PULL },
    browsers: Object.entries(BROWSERS).map(([key, b]) => ({
      key, name: b.name, port: b.port, installed: !!exeOf(key), running: !!browserUp[key],
      tabs: [...tabs.values()].filter(t => t.browser === key).map(t => ({ id: t.id, title: t.title, state: t.state, status: t.status })),
    })),
  };
}

const server = http.createServer(async (req, res) => {
  // local only: refuse requests that come from other sites (CSRF) or other machines
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return json(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, statusBody());
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
    if ((m = url.pathname.match(/^\/api\/browser\/(\w+)\/open$/))) return json(res, 200, { ok: true, msg: await openBrowser(m[1]) });
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
  loop();
})();
