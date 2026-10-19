// Managed Chromium profiles, the shared-window browser mode, and a small CDP client.
// Legacy per-browser profiles stay readable so already-running game tabs remain managed.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const GAME_URL = 'https://play.bindertowngame.com/';
const ROOT = path.resolve(__dirname, '..');

// each browser gets its own debug port and profile folder, so several can run side by side
const BROWSERS = (() => {
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const j = path.join;
  return {
    edge: { name: 'Microsoft Edge', port: 9340, exe: [j(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), j(pf, 'Microsoft\\Edge\\Application\\msedge.exe'), j(local, 'Microsoft\\Edge\\Application\\msedge.exe')] },
    chrome: { name: 'Google Chrome', port: 9341, exe: [j(pf, 'Google\\Chrome\\Application\\chrome.exe'), j(pf86, 'Google\\Chrome\\Application\\chrome.exe'), j(local, 'Google\\Chrome\\Application\\chrome.exe')] },
    brave: { name: 'Brave', port: 9342, exe: [j(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'), j(pf86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'), j(local, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')] },
    vivaldi: { name: 'Vivaldi', port: 9343, exe: [j(local, 'Vivaldi\\Application\\vivaldi.exe'), j(pf, 'Vivaldi\\Application\\vivaldi.exe')] },
  };
})();
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const exeOf = key => (BROWSERS[key] && BROWSERS[key].exe.find(exists)) || null;
const profileOf = key => path.join(ROOT, 'profiles', key);

async function targets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// open the browser on the game; if it already runs with its debug port, open the game in a new tab instead
async function openBrowser(key) {
  const b = BROWSERS[key], exe = exeOf(key);
  if (!b || !exe) throw new Error(`ไม่เจอ ${b ? b.name : key} ในเครื่อง`);
  if (await targets(b.port)) {
    const r = await fetch(`http://127.0.0.1:${b.port}/json/new?${encodeURIComponent(GAME_URL)}`, { method: 'PUT' }).catch(() => null);
    return r && r.ok ? 'เปิดแท็บเกมใหม่แล้ว' : 'เบราว์เซอร์เปิดอยู่แล้ว';
  }
  fs.mkdirSync(profileOf(key), { recursive: true });
  // a minimised / hidden window slows the page's timers down to once a minute, so the helper takes minutes per step:
  // keep background tabs at full speed
  const keepAwake = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion'];
  spawn(exe, [`--remote-debugging-port=${b.port}`, '--remote-allow-origins=*', `--user-data-dir=${profileOf(key)}`, '--no-first-run', '--no-default-browser-check', ...keepAwake, GAME_URL], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await targets(b.port)) return 'เปิดแล้ว'; }
  throw new Error(`${b.name} ไม่ตอบที่ port ${b.port} — ถ้ามีหน้าต่างที่ใช้โปรไฟล์นี้เปิดอยู่ (ไม่ได้เปิดจากระบบนี้) ให้ปิดก่อน`);
}

// one CDP connection per page target
class Tab {
  constructor(t) {
    this.id = t.id; this.nextId = 1; this.pending = new Map();
    this.ws = new WebSocket(t.webSocketDebuggerUrl);
    this.ready = new Promise((ok, bad) => { this.ws.onopen = ok; this.ws.onerror = () => bad(new Error('connect failed')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data), p = m.id && this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    };
    this.ws.onclose = () => { this.closed = true; for (const p of this.pending.values()) p.reject(new Error('closed')); this.pending.clear(); };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('closed'));
      const id = this.nextId++; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('timeout')); }, 15000);
    });
  }
  async eval(expression) {
    await this.ready;
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch { } }
}

module.exports = { GAME_URL, ROOT, BROWSERS, exeOf, profileOf, targets, openBrowser, Tab };
