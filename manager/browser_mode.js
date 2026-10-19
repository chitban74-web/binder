// Binder Town persistent per-game-profile Chromium window mode. Each saved profile
// gets its own browser data directory and CDP port while keeping the same manager controls.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { GAME_URL, ROOT, targets, exeOf } = require('./browser');
const SHARED_BROWSER_PORT = 9344;
function createBrowserMode({ getSettings, rootDir = ROOT, port = SHARED_BROWSER_PORT, userDataDir: configuredUserDataDir, gameUrl = GAME_URL }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_CDP_PORT');
  let ws = null, wsReady = null, nextId = 1, started = false, monitorTimer = null, reconnectDelay = 1000, reconnectTimer = null, browserStarting = null;
  const pending = new Map(), listeners = new Set(), crashed = new Map(), clients = new Map(), launching = new Map();
  // Persist cookies, local storage, IndexedDB and cache separately for each game profile.
  const userDataDir = configuredUserDataDir || path.join(rootDir, 'profiles', 'shared-browser');

  const findBrowser = kind => exeOf(['edge', 'brave'].includes(kind) ? kind : 'chrome');
  const isOpen = async () => !!(await targets(port));

  function send(method, params = {}, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error('Browser CDP is disconnected'));
      const id = nextId++;
      const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }

  async function connect() {
    if (ws && ws.readyState === 1) return;
    if (wsReady) return wsReady;
    wsReady = (async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
      const info = await response.json();
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(info.webSocketDebuggerUrl); ws = socket;
        const timer = setTimeout(() => { try { socket.close(); } catch {} reject(new Error('CDP connect timeout')); }, 5000);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP connect failed')); };
        socket.onmessage = event => {
          let message; try { message = JSON.parse(event.data); } catch { return; }
          if (message.id && pending.has(message.id)) {
            const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
            message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
          } else if (message.method) for (const listener of listeners) { try { listener(message); } catch {} }
        };
        socket.onclose = () => {
          if (ws !== socket) return;
          ws = null;
          for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP disconnected')); }
          pending.clear(); scheduleReconnect();
        };
      });
      await send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
    })();
    try { await wsReady; } finally { wsReady = null; }
  }

  function scheduleReconnect() {
    if (!started || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try { await connect(); reconnectDelay = 1000; }
      catch { reconnectDelay = Math.min(30000, reconnectDelay * 2); scheduleReconnect(); }
    }, reconnectDelay);
    reconnectTimer.unref?.();
  }

  async function ensureBrowser() {
    if (browserStarting) return browserStarting;
    browserStarting = (async () => {
      if (await isOpen()) {
        await connect();
        return;
      }
      const settings = getSettings() || {};
      const exe = findBrowser(settings.kind);
      const browserName = ({ edge: 'Microsoft Edge', brave: 'Brave', chrome: 'Google Chrome' })[settings.kind] || 'Google Chrome';
      if (!exe) throw new Error(`ไม่พบ ${browserName} ในเครื่อง`);
      fs.mkdirSync(userDataDir, { recursive: true });
      const awake = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion', '--max-active-webgl-contexts=64'];
      const browserProcess = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${userDataDir}`,
        '--no-first-run', '--no-default-browser-check', ...awake, 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: false });
      browserProcess.unref();
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        if (await isOpen()) {
          await connect();
          // Let Chromium finish creating its initial blank window before launch
          // decides whether it can reuse that window.
          for (let wait = 0; wait < 8; wait++) {
            const { targetInfos = [] } = await send('Target.getTargets').catch(() => ({ targetInfos: [] }));
            if (targetInfos.some(target => target.type === 'page')) break;
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          return;
        }
      }
      throw new Error('เปิดเบราว์เซอร์ไม่สำเร็จ');
    })();
    try { return await browserStarting; } finally { browserStarting = null; }
  }

  function namespaceScript(clientId) {
    return `(() => {
      const prefix = 'bth-client:';
      let sessionId = '';
      try { sessionId = sessionStorage.getItem('__bthClientId') || ''; } catch {}
      const id = window.name && window.name.startsWith(prefix) ? window.name.slice(prefix.length) : (sessionId || ${JSON.stringify(clientId)});
      window.name = prefix + id;
      window.__bthClientId = id;
      try { sessionStorage.setItem('__bthClientId', id); } catch {}
      const storage = Storage.prototype, get = storage.getItem, set = storage.setItem, remove = storage.removeItem;
      try {
        // Older builds stored one shared bth_* config. Import it once for the
        // first existing client only; copying it on every new tab made each
        // window inherit the first character's settings.
        const migratedKey = '__bth_client_storage_migrated_v1';
        if (get.call(localStorage, migratedKey) !== '1') {
          const oldKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const oldKey = localStorage.key(i);
            if (oldKey && oldKey.startsWith('bth_')) oldKeys.push(oldKey);
          }
          for (const oldKey of oldKeys) {
            if (get.call(localStorage, id + ':' + oldKey) === null) {
              set.call(localStorage, id + ':' + oldKey, get.call(localStorage, oldKey));
            }
          }
          set.call(localStorage, migratedKey, '1');
        }
      } catch {}
      const key = value => String(value).startsWith('bth_') ? id + ':' + value : value;
      storage.getItem = function(value) { return get.call(this, key(value)); };
      storage.setItem = function(value, content) { return set.call(this, key(value), content); };
      storage.removeItem = function(value) { return remove.call(this, key(value)); };
    })();`;
  }

  const isGameTarget = target => {
    try { return target.type === 'page' && new URL(target.url).origin === new URL(gameUrl).origin; } catch { return false; }
  };

  async function attachTarget(target) {
    if (clients.has(target.targetId)) return clients.get(target.targetId);
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    try {
      await send('Page.enable', {}, sessionId, 5000);
      await send('Runtime.enable', {}, sessionId, 5000);
      const probe = await send('Runtime.evaluate', { expression: `window.__bthClientId || (window.name.startsWith('bth-client:') ? window.name.slice(11) : null)`, returnByValue: true }, sessionId, 5000);
      const clientId = String(probe.result?.result?.value || target.clientId || target.targetId);
      const source = namespaceScript(clientId);
      await send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId, 5000);
      await send('Runtime.evaluate', { expression: source, returnByValue: true }, sessionId, 5000);
      const client = { targetId: target.targetId, sessionId, clientId };
      clients.set(target.targetId, client);
      return client;
    } catch (error) {
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
      throw error;
    }
  }

  function dropTarget(targetId) { clients.delete(targetId); crashed.delete(targetId); }

  function launch(clientId) {
    clientId = String(clientId || `client-${Date.now()}`);
    if (launching.has(clientId)) return launching.get(clientId);
    const pendingLaunch = launchOnce(clientId).finally(() => {
      if (launching.get(clientId) === pendingLaunch) launching.delete(clientId);
    });
    launching.set(clientId, pendingLaunch);
    return pendingLaunch;
  }

  async function launchOnce(clientId) {
    await ensureBrowser();
    // Like the reference manager, identify an existing window by its stable profile id
    // before creating another one. This also covers a second click before the UI refreshes.
    await monitor();
    const existing = [...clients.values()].find(client => client.clientId === clientId);
    if (existing) {
      await windowAction(existing.targetId, 'focus').catch(() => {});
      return { ok: true, msg: 'โปรไฟล์นี้เปิดอยู่แล้ว', targetId: existing.targetId, alreadyOpen: true };
    }
    // Reuse the browser's blank startup window when possible. Creating a new
    // window while leaving that blank open caused a second Brave taskbar window
    // after a game window was closed and reopened.
    const { targetInfos = [] } = await send('Target.getTargets');
    const blankTargets = targetInfos.filter(target => target.type === 'page'
      && (target.url === 'about:blank' || target.url === 'chrome://newtab/'));
    let target = blankTargets.shift();
    for (const extra of blankTargets) await send('Target.closeTarget', { targetId: extra.targetId }).catch(() => {});
    if (!target) {
      const result = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
      target = { targetId: result.targetId, type: 'page', url: 'about:blank' };
    }
    const client = await attachTarget({ ...target, clientId });
    await send('Page.navigate', { url: gameUrl }, client.sessionId, 10000);
    await new Promise(resolve => setTimeout(resolve, 250));
    const { targetInfos: remainingTargets = [] } = await send('Target.getTargets').catch(() => ({ targetInfos: [] }));
    for (const extra of remainingTargets) {
      if (extra.targetId !== target.targetId && extra.type === 'page'
          && (extra.url === 'about:blank' || extra.url === 'chrome://newtab/')) {
        await send('Target.closeTarget', { targetId: extra.targetId }).catch(() => {});
      }
    }
    return { ok: true, msg: 'เปิดหน้าต่างเกมใหม่แล้ว', targetId: target.targetId };
  }

  async function removeProfile(clientId) {
    const expectedParent = path.resolve(rootDir, 'profiles', 'game-windows');
    const targetDir = path.resolve(userDataDir);
    const profileId = String(clientId);
    // Only remove the exact per-profile Chromium directory. Never allow a
    // caller-supplied id or custom userDataDir to escape game-windows.
    if (path.dirname(targetDir) !== expectedParent || path.basename(targetDir) !== profileId) {
      throw new Error('Refusing to remove an unexpected browser profile directory');
    }
    await fs.promises.rm(targetDir, { recursive: true, force: true });
    return true;
  }

  async function isProfileOpen(clientId) {
    if (!(await isOpen())) return false;
    await connect();
    const { targetInfos } = await send('Target.getTargets');
    return [...clients.values()].some(client => client.clientId === String(clientId)
      && targetInfos.some(target => target.targetId === client.targetId && isGameTarget(target)));
  }

  async function close(targetId) {
    await connect();
    return send('Target.closeTarget', { targetId });
  }

  async function closeAll() {
    await connect();
    const { targetInfos } = await send('Target.getTargets');
    const gameTargets = targetInfos.filter(isGameTarget);
    const results = await Promise.all(gameTargets.map(target => send('Target.closeTarget', { targetId: target.targetId }).catch(() => false)));
    return { ok: true, count: results.filter(Boolean).length };
  }

  async function shutdown() {
    started = false;
    clearInterval(monitorTimer); clearTimeout(reconnectTimer);
    monitorTimer = reconnectTimer = null;
    if (await isOpen()) {
      try { await connect(); await send('Browser.close', {}, undefined, 5000); } catch {}
    }
    if (ws) { const socket = ws; ws = null; socket.close(); }
  }

  async function windowAction(targetId, action, bounds = {}) {
    await connect();
    const { windowId } = await send('Browser.getWindowForTarget', { targetId });
    if (['focus', 'top', 'show', 'restore'].includes(action)) {
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await send('Target.activateTarget', { targetId });
    } else if (action === 'minimize') await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    else if (action === 'set-bounds') await send('Browser.setWindowBounds', { windowId, bounds: { left: +bounds.x || 0, top: +bounds.y || 0, width: +bounds.w || 800, height: +bounds.h || 600 } });
  }

  async function recoverCrashedTarget(targetId) {
    const now = Date.now(), prev = crashed.get(targetId) || { count: 0, at: 0 };
    if (prev.count >= 3 && now - prev.at < 60000) return;
    crashed.set(targetId, { count: prev.count + 1, at: now });
    try {
      await connect();
      const current = clients.get(targetId);
      const sessionId = current ? current.sessionId : (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      try { await send('Page.enable', {}, sessionId, 5000); await send('Page.reload', { ignoreCache: false }, sessionId, 10000); }
      finally { if (!current) await send('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    } catch {}
  }

  listeners.add(message => {
    if (message.method === 'Target.targetCrashed') recoverCrashedTarget(message.params.targetId);
    if (message.method === 'Target.targetDestroyed') dropTarget(message.params.targetId);
    if (message.method === 'Target.detachedFromTarget') {
      for (const client of clients.values()) if (client.sessionId === message.params.sessionId) dropTarget(client.targetId);
      scheduleReconnect();
    }
  });

  async function monitor() {
    if (!(await isOpen())) return;
    await connect();
    const { targetInfos } = await send('Target.getTargets');
    const live = new Set(targetInfos.map(target => target.targetId));
    for (const targetId of clients.keys()) if (!live.has(targetId)) dropTarget(targetId);
    for (const target of targetInfos) if (isGameTarget(target) && !clients.has(target.targetId)) {
      await attachTarget(target).catch(() => {});
    }
  }

  async function start() {
    if (started) return; started = true;
    await monitor().catch(() => {});
    monitorTimer = setInterval(() => monitor().catch(scheduleReconnect), 5000);
    monitorTimer.unref?.();
    monitor().catch(() => {});
  }

  function dispose() {
    started = false; clearInterval(monitorTimer); clearTimeout(reconnectTimer);
    monitorTimer = reconnectTimer = null;
    if (ws) { const socket = ws; ws = null; socket.close(); }
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('BROWSER_MODE_DISPOSED')); }
    pending.clear();
  }

  return { launch, close, closeAll, shutdown, removeProfile, isProfileOpen, windowAction, start, dispose, findBrowser, isOpen, port };
}

module.exports = { createBrowserMode };
