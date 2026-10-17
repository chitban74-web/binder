// Binder Town helper — runs inside the game page, on top of the game's own AUTO.
//  • bag full (weight >= sellPct or no free slot) → AUTO off → warp to town (500 G; walk if it can't) → (salvage low Normal / Magic gear, if on) → sell by your sell filter
//                                                → back to farm map → walk to the saved spot → AUTO on
//  • died → wait deathWaitMs → respawn in town → (sell if weight >= sellAfterDeathPct) → back to farm map → saved spot → AUTO on
//  • potion on the belt below its minimum → town → walk to the merchant → buy up to the target (vendorBuy, max 99 each)
//  • on ▶ and on every return to the farm map: the party leader's channel if the leader is on this map,
//    else the safe channel with the fewest players (never PvP CH10); with the channel lock on: only the channel picked
//  • the game's channel menu shows the player count of each channel on the right of its row
//  • the game refuses channel switches and warps in combat: both wait for combat to end (AUTO fights back only while hit, 60 s max)
//  • bounty window (🎯 ค่าหัว): today's bounties you can reach → each one: its map, AUTO targets = that mob only,
//    farm area = whole map, claim when done → next; at the end AUTO settings go back and you return to the farm spot
//  • elites: purple skull on the minimap / big map — faded at the spawn point (all maps, computed from the game's map
//    builder), bright at the live position from the server's census
//  • World Boss round open (server "worldBoss" message) → warp into the arena → AUTO until the boss is dead / gone →
//    leave → back to the farm spot (on by default, switch on the farm tab)
//  • boss / mini-boss alive on the farm map → AUTO off → walk to it → AUTO on next to it (its target chip on) → dies → back to the farm spot
//  • kicked for idling ("หลุดจากเกม · ไม่ได้เล่นนานเกินไป") → press เชื่อมต่อใหม่ → after the reload ▶ goes on (AUTO only, if no farm spot is saved yet)
//    (needs the manager, which loads the helper again after the reload)
// It presses the game's own buttons (warp, world map "go", respawn, sell, AUTO). The messages it sends itself go
// through the game's own Colyseus room and are the ones the game's UI sends: moveTo, channelQuery, switchChannel,
// socialQuery, vendorBuy, huntQuery, bountyClaim.
(() => {
  if (window.__bth) { window.__bth.show(); return 'already running'; }
  // a minimised / hidden tab runs page timers once a minute, so every step of a trip took minutes; a worker's timers
  // keep their pace, so the helper's own timers tick from one. Native timers until the worker has answered once
  // (a blocked worker then just leaves the helper on native timers).
  const { setTimeout, setInterval, clearTimeout, clearInterval, stopTimers, onWorker } = (() => {
    const nat = { set: window.setTimeout.bind(window), every: window.setInterval.bind(window), clear: window.clearTimeout.bind(window), clearEvery: window.clearInterval.bind(window) };
    const recs = new Map(); let n = 0, ready = false, w = null; // id -> { fn, ms, rep, nat: native id while not on the worker }
    const toWorker = (id, r) => { if (r.nat !== undefined) { (r.rep ? nat.clearEvery : nat.clear)(r.nat); delete r.nat; } w.postMessage([r.rep ? 'i' : 't', id, r.ms]); };
    try {
      const src = 'const t={};onmessage=e=>{const[k,id,ms]=e.data;if(k==="c"){clearTimeout(t[id]);clearInterval(t[id]);delete t[id];return}'
        + 't[id]=(k==="i"?setInterval:setTimeout)(()=>{if(k!=="i")delete t[id];postMessage(id)},ms)}';
      w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = e => {
        if (e.data === 'ping') { // the worker works: move the intervals started meanwhile onto it
          if (!ready) { ready = true; for (const [id, r] of recs) if (r.rep) toWorker(id, r); }
          return;
        }
        const r = recs.get(e.data); if (!r) return;
        if (!r.rep) recs.delete(e.data);
        try { r.fn(); } catch (err) { console.error('[Binder Helper]', err); }
      };
      w.postMessage(['t', 'ping', 0]);
    } catch { w = null; }
    const add = rep => (fn, ms = 0, ...a) => {
      const id = 'w' + ++n, r = { fn: () => fn(...a), ms, rep };
      recs.set(id, r);
      if (ready) toWorker(id, r);
      else r.nat = (rep ? nat.every : nat.set)(() => { if (!rep) recs.delete(id); r.fn(); }, ms);
      return id;
    };
    const clear = id => {
      const r = recs.get(id); if (!r) return;
      recs.delete(id);
      if (r.nat !== undefined) (r.rep ? nat.clearEvery : nat.clear)(r.nat); else if (w) w.postMessage(['c', id]);
    };
    return { setTimeout: add(false), setInterval: add(true), clearTimeout: clear, clearInterval: clear, stopTimers: () => { for (const id of [...recs.keys()]) clear(id); if (w) w.terminate(); }, onWorker: () => ready };
  })();
  const KEY = 'bth_cfg';
  const DEF = {
    farmMap: '', farmSpot: null, town: '', sellPct: 95, sellAfterDeathPct: 40, deathWaitMs: 3000,
    quietCh: true, followLeader: true, lockCh: false, lockChNum: 1, bossHunt: true, worldBoss: true, mobIcons: true,
    // town trip with selling: salvage Normal / Magic gear whose item level is below salvBelow first (off by default)
    salvOn: false, salvBelow: 30,
    // potions: below `min` (0 = off) -> trip to town; in town always top up to `to`
    buy: { hp: { item: 'hi_potion', min: 50, to: 200 }, mp: { item: 'mana_potion', min: 30, to: 150 } },
    panel: { x: 8, y: 120, min: false }, running: false,
  };
  const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { } };
  const cfg = load();
  // the saved flag is still true when the page went away while running (reload, game update, kick); ■ saves false
  const wasRunning = cfg.running;
  cfg.running = false; // start stopped; resumed below only when the last page was running a moment ago
  // +1 whenever you set a new farm map / spot: a trip still heading for the old one sees it and gives up
  let farmGen = 0;

  // ---- reading the game UI ----
  const $ = s => document.querySelector(s);
  const visible = e => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  // map name from the server's room state first: the HUD's #mapname is not redrawn while the tab is hidden, so after a
  // warp in a minimised window it still showed the old map (id -> name from data/maps/zones.csv; unknown ids: the HUD)
  const MAP_NAMES = {'southvale_field':'Southvale Field','valebrook':'Valebrook','whispering_woods':'Whispering Woods','riverside':'Riverside','old_quarry':'Old Quarry','ancient_ruins':'Ancient Ruins','sunfield_plains':'Sunfield Plains','ashford':'Ashford','gloomroot_forest':'Gloomroot Forest','ember_hollow':'Ember Hollow','mistmire_swamp':'Mistmire Swamp','duskgate_pass':'Duskgate Pass','stormwall_city':'Stormwall City','frostpeak_slopes':'Frostpeak Slopes','frozen_mere':'Frozen Mere','howling_steppes':'Howling Steppes','cloudspire_ruins':'Cloudspire Ruins','sanctum':'Sanctum','shattered_vale':'Shattered Vale','umbral_depths':'Umbral Depths','throne_of_warden':'Throne of the Warden','training_grounds':'Training Grounds','rootfall_barrow':'Rootfall Barrow','honeyrill':'Honeyrill','bracken_sink':'Bracken Sink','verdigris_rise':'Verdigris Rise','pitchwood':'Pitchwood','yellowlick_flats':'Yellowlick Flats','peatcut_bog':'Peatcut Bog','sledrun_gully':'Sledrun Gully','brinecrust_shoals':'Brinecrust Shoals','kitewind_terraces':'Kitewind Terraces','glasswrack':'Glasswrack','marrowdeep':'Marrowdeep','rustbell_barracks':'Rustbell Barracks'};
  const mapName = () => {
    const r = window.__bthRoom, id = r && r.state && r.connection && r.connection.isOpen !== false ? r.state.mapId : '';
    return MAP_NAMES[id] || (($('#mapname') || {}).textContent || '').trim();
  };
  const weightPct = () => { const m = (($('#wtwarn') || {}).textContent || '').match(/(\d+)\s*%/); return m ? +m[1] : 0; };
  // full = weight over the threshold, or the game's own bag alarm (weight 100% or no free slot)
  const slotsFull = () => { const b = $('#mbbag'); return !!b && b.classList.contains('alarm'); };
  const bagFull = () => weightPct() >= cfg.sellPct || slotsFull();
  const autoOn = () => document.body.classList.contains('auto-on');
  const isDead = () => visible($('#drespawn'));
  const dialogTitle = () => (($('#bctitle') || {}).textContent || '').trim();
  const dialogOpen = () => visible($('#bcyes'));
  // potion counts from the game's potion belt (#belt: each slot = item icon <img .../hi_potion.png> + count <em>)
  const POTIONS = {
    hp: { potion: 'โพชั่น', hi_potion: 'ไฮโพชั่น', mega_potion: 'เมก้าโพชั่น', elixir: 'อีลิกเซอร์', grand_elixir: 'อีลิกเซอร์หลวง' },
    mp: { mana_potion: 'ยามานา', ether: 'อีเทอร์', high_ether: 'อีเทอร์ชั้นสูง' },
  };
  const potName = id => POTIONS.hp[id] || POTIONS.mp[id] || id;
  const beltCount = id => {
    for (const s of document.querySelectorAll('#belt .bslot')) {
      const img = s.querySelector('img'); const m = img && (img.getAttribute('src') || '').match(/([a-z0-9_]+)\.(png|webp)/i);
      if (m && m[1] === id) { const t = ((s.querySelector('em') || {}).textContent || '').trim().replace(/,/g, ''); const k = t.match(/^([\d.]+)\s*[kK]$/); return k ? Math.round(+k[1] * 1000) : (+t || 0); }
    }
    return null; // not on the belt
  };
  const potionPlans = () => ['hp', 'mp'].map(k => ({ k, ...((cfg.buy || {})[k] || {}) })).filter(p => p.item && (p.min > 0 || p.to > 0)).map(p => ({ ...p, have: beltCount(p.item) }));
  const lowPotions = () => potionPlans().filter(p => p.min > 0 && p.have !== null && p.have < p.min);
  const respawnTown = () => { const m = (($('#drespawn') || {}).textContent || '').match(/เกิดใหม่ที่\s*(.+?)(\s*\(\d+\))?$/); return m ? m[1].trim() : ''; };

  // ---- the game's own Colyseus room (captured from Room.prototype.send of the game's vendor bundle) ----
  (async () => {
    try {
      const src = [...document.querySelectorAll('script[src],link[rel=modulepreload]')].map(e => e.src || e.href).find(u => /\/assets\/vendor-/.test(u));
      const { c } = await import(src);
      const RP = c && c.Room && c.Room.prototype;
      // re-wrap from the original send on every load, so a reloaded helper gets the outgoing messages too (window.__bthSendHook)
      if (RP) { const orig = RP.__bthSend || RP.send; RP.__bthSend = orig; RP.send = function () { window.__bthRoom = this; try { if (window.__bthSendHook) window.__bthSendHook(arguments[0], arguments[1]); } catch { } return orig.apply(this, arguments); }; }
      // incoming server events of every room, from its very first message (window.__bthOnServer — World Boss state)
      if (RP) { const od = RP.__bthDispatch || RP.dispatchMessage; RP.__bthDispatch = od; RP.dispatchMessage = function (type, msg) { if (type === 'server') { try { if (window.__bthOnServer) window.__bthOnServer(msg); } catch { } } return od.apply(this, arguments); }; }
    } catch (e) { console.warn('bth: room hook failed', e); }
  })();
  // ---- World Boss (Wraithroot Colossus, arena map rootfall_barrow) ----
  // The server sends "worldBoss" { view: { id, state: idle|live|dead|fled, startAt, endsAt, nextAt, frac, engaged }, mine, need }
  // when a map is joined and whenever the round changes (never on request). A round is open 20 min; the arena can be
  // entered 10 min before it starts. Rewards by damage rank (heal / tank count) come by mail.
  const WB_ARENA = 'rootfall_barrow', WB_OPEN_MS = 20 * 60e3, WB_SOON_MS = 10 * 60e3;
  const wb = { view: null, mine: 0, need: 0, at: 0, doneId: null };
  window.__bthOnServer = m => {
    for (const e of Array.isArray(m) ? m : [m]) if (e && e.type === 'worldBoss' && e.view) {
      wb.view = e.view; wb.at = Date.now();
      if (e.mine !== undefined) { wb.mine = Number(e.mine) || 0; wb.need = Number(e.need) || 0; }
    }
  };
  const wbOpen = () => {
    const v = wb.view, now = Date.now();
    if (!v) return false;
    if (v.state === 'live') return !v.endsAt || v.endsAt > now;
    return v.state === 'idle' && v.startAt > 0 && now >= v.startAt - WB_SOON_MS && now < v.startAt + WB_OPEN_MS;
  };
  const room = () => { const r = window.__bthRoom; return r && r.state && r.connection && r.connection.isOpen !== false ? r : null; };
  const myPos = () => { const r = room(); const p = r && r.state.players && r.state.players.get(r.sessionId); return p ? { x: +p.x.toFixed(2), y: +p.y.toFixed(2) } : null; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // walk back to the saved farm spot (server-side pathing, same message as click-to-move)
  async function walkToSpot(spot, still = () => true) {
    if (!spot) return true;
    const deadline = Date.now() + 90e3;
    let lastSend = 0, last = myPos(), lastMoveAt = Date.now();
    while (Date.now() < deadline && cfg.running) {
      if (!still()) return false;
      if (isDead()) return false;
      const p = myPos(), r = room();
      if (!p || !r) { await sleep(1000); continue; }
      if (dist(p, spot) <= 1.5) { log(`ถึงจุดฟาร์ม (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)})`); return true; }
      if (last && dist(p, last) > 0.3) { last = p; lastMoveAt = Date.now(); }
      if (Date.now() - lastSend > 8000 || Date.now() - lastMoveAt > 4000) {
        lastSend = Date.now(); lastMoveAt = Date.now();
        r.send('input', { type: 'moveTo', x: spot.x, y: spot.y });
        log(`เดินไปจุดฟาร์ม (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}) · ห่าง ${dist(p, spot).toFixed(1)}`);
      }
      await sleep(700);
    }
    log('เดินไปจุดฟาร์มไม่ถึงใน 90 วิ — เปิด AUTO ตรงนี้');
    return false;
  }

  // The game considers the local player in combat for 5 seconds after a hit, cast, or basic attack, and refuses
  // channel changes and warps meanwhile. Track the same server events so those can wait for combat to finish.
  let combatUntil = 0, hitMeAt = 0, combatRoom = null, combatOff = null;
  const watchCombat = () => {
    const r = room();
    if (r === combatRoom) return;
    if (combatOff) { try { combatOff(); } catch { } }
    combatRoom = r; combatOff = null;
    if (!r || typeof r.onMessage !== 'function') return;
    try {
      combatOff = r.onMessage('server', message => {
        for (const e of Array.isArray(message) ? message : [message]) {
          if (!e || !e.type) continue;
          const mine = e.type === 'hit'
            ? e.actorId === r.sessionId || e.targetId === r.sessionId
            : (e.type === 'cast' || e.type === 'basicAttack') && e.id === r.sessionId;
          if (mine) combatUntil = performance.now() + 5000;
          if (e.type === 'hit' && e.targetId === r.sessionId) hitMeAt = performance.now();
          if (e.type === 'census') onCensus(r, e);
        }
      });
    } catch { }
  };
  const combatTimer = setInterval(watchCombat, 250);
  const inCombat = () => { watchCombat(); return performance.now() < combatUntil; };
  // what = what has to wait ('ย้าย CH', 'วาร์ป'). AUTO on only while a mob is hitting us (fight back); otherwise
  // AUTO off, so it doesn't pull the next mob and keep us in combat forever. false = stopped, or still in combat after 60 s
  async function waitForCombatToFinish(what = 'ย้าย CH') {
    if (!inCombat()) return cfg.running;
    setPhase(`ต่อสู้ก่อน${what}`);
    log(`กำลังต่อสู้ — รอให้จบก่อน${what} (AUTO สู้กลับเฉพาะตอนโดนตี)`);
    const giveUpAt = Date.now() + 60e3;
    while (cfg.running && inCombat()) {
      if (Date.now() > giveUpAt) { log(`ต่อสู้ไม่จบใน 60 วิ — ข้าม${what}`); return false; }
      setAuto(performance.now() - hitMeAt < 2000);
      await sleep(300);
    }
    if (cfg.running) { log(`พ้นสถานะต่อสู้แล้ว — เตรียม${what}`); setAuto(false); }
    return cfg.running;
  }

  // player count of each channel on this map, read from the tooltip of the game's signal bars on that row
  // ("แมพนี้ 1/40 คน · ทั้ง Channel 236/300 คน") -> written into the empty right side of the row
  const paintChCounts = () => {
    for (const row of document.querySelectorAll('#chmenu .chrow')) {
      const m = ((row.querySelector('.chsig') || {}).title || '').match(/แมพนี้\s*(\d+)\//); if (!m) continue;
      let s = row.querySelector('.bthcnt');
      if (!s) { s = document.createElement('span'); s.className = 'bthcnt'; row.appendChild(s); }
      const t = `${m[1]} คน`;
      if (s.textContent !== t) s.textContent = t;
    }
  };
  const chObs = new MutationObserver(paintChCounts);
  paintChCounts(); // menu may already be open when the helper loads
  { const menu = document.getElementById('chmenu'); if (menu) chObs.observe(menu, { childList: true, subtree: true }); }
  // ---- channel: move to the least crowded safe channel of this map (same rules as the game's channel menu) ----
  const PVP_CH = 10, BASE_CH = 10, MAP_FULL = 40, SERVER_FULL = 300;
  const chOf = r => +(((r && r.name) || '').match(/_ch(\d+)$/) || [])[1] || 0;
  // send one game message and wait for the server reply that matches (server events can come batched in an array)
  function request(msg, match, timeout = 3000) {
    return new Promise(resolve => {
      const r = room(); if (!r) return resolve(null);
      let off = null;
      const t = setTimeout(() => { if (off) off(); resolve(null); }, timeout);
      off = r.onMessage('server', m => {
        const c = (Array.isArray(m) ? m : [m]).find(x => x && match(x));
        if (c) { clearTimeout(t); if (off) off(); resolve(c); }
      });
      r.send('input', msg);
    });
  }
  const queryChannels = () => request({ type: 'channelQuery' }, m => m.type === 'channels');
  const queryParty = async () => { const s = await request({ type: 'socialQuery' }, m => m.type === 'socialState'); return s && s.state ? s.state.party : undefined; };

  // party leader's channel when the leader is online on this map (and it isn't PvP); 0 = none
  async function leaderChannel(r, quiet) {
    const say = quiet ? () => { } : log;
    const party = await queryParty();
    if (party === undefined) { say('อ่านข้อมูลตี้ไม่ได้'); return 0; }
    if (!party) return 0;
    if (party.leaderId === r.sessionId) { say('เราเป็นหัวตี้ → ใช้ CH คนน้อยสุด'); return 0; }
    const L = (party.members || []).find(m => m.id === party.leaderId);
    if (!L || !L.online) { say('หัวตี้ออฟไลน์ → ใช้ CH คนน้อยสุด'); return 0; }
    if (L.mapId !== r.state.mapId) { say(`หัวตี้อยู่แมพอื่น (${L.mapId}) → ใช้ CH คนน้อยสุด`); return 0; }
    if (L.channel === PVP_CH) { say('หัวตี้อยู่ CH PvP → ไม่ตาม ใช้ CH คนน้อยสุด'); return 0; }
    return L.channel || 0;
  }
  async function switchTo(r, cur, ch, lock, why) {
    if (lock && lock.ms > 0) { log(`รอ ${Math.ceil(lock.ms / 1000)} วิ (ล็อกเพราะ ${lock.why})`); await sleep(lock.ms + 500); }
    if (!await waitForCombatToFinish()) return false;
    // the room may have changed while waiting
    r = room(); cur = chOf(r);
    if (!r || !cur || cur === ch) return cur === ch;
    log(`ย้าย CH${cur} → CH${ch} (${why})`);
    r.send('input', { type: 'switchChannel', channel: ch });
    for (let i = 0; i < 20 && cfg.running; i++) {
      await sleep(1000);
      const nr = room();
      if (nr && nr !== r && chOf(nr) === ch) { log(`อยู่ CH${ch} แล้ว`); await sleep(1500); return true; }
    }
    log('ย้าย CH ไม่สำเร็จ — อยู่ CH เดิม');
    return false;
  }
  // the channel to switch to: { ch, why, lock }, or null to stay (quiet = no log when staying)
  async function pickChannel(quiet) {
    const say = t => { chLast = t; if (!quiet) log(t); };
    const r = room(); const cur = chOf(r); if (!r || !cur) return null;
    const info = await queryChannels();
    // channel lock: only ever the channel picked in the panel, never the leader's or the quietest
    if (cfg.lockCh) {
      const ch = cfg.lockChNum;
      if (ch === cur) { say(`อยู่ CH${cur} ที่ล็อกไว้แล้ว`); return null; }
      if (info && info.counts && ch > info.counts.length) { say(`แมพนี้ไม่มี CH${ch} — อยู่ CH เดิม`); return null; }
      chLast = `ย้ายไป CH${ch} (ล็อก CH)`; return { ch, why: 'ล็อก CH', lock: info && info.lock };
    }
    if (cfg.followLeader) {
      const lc = await leaderChannel(r, quiet);
      if (lc) {
        if (lc === cur) { say(`อยู่ CH เดียวกับหัวตี้แล้ว (CH${cur})`); return null; }
        chLast = `ย้ายไป CH${lc} (ตามหัวตี้)`; return { ch: lc, why: 'ตามหัวตี้', lock: info && info.lock };
      }
    }
    if (!cfg.quietCh) return null;
    if (!info) { say('อ่านจำนวนคนแต่ละ CH ไม่ได้ — อยู่ CH เดิม'); return null; }
    const counts = info.counts || [], totals = info.totals || [];
    const n = ch => counts[ch - 1] || 0, tot = ch => totals[ch - 1] || 0;
    const others = ch => ch === cur ? Math.max(0, n(ch) - 1) : n(ch); // players besides me
    const cands = [];
    for (let ch = 1; ch <= counts.length; ch++) {
      if (ch === PVP_CH) continue;                                   // never the PvP channel
      if (ch > BASE_CH && !n(ch) && ch !== cur) continue;            // the game hides empty overflow channels
      if (ch !== cur && (n(ch) >= MAP_FULL || tot(ch) >= SERVER_FULL)) continue; // full
      cands.push(ch);
    }
    cands.sort((a, b) => others(a) - others(b) || tot(a) - tot(b));
    const best = cands[0];
    if (!best || best === cur || (cur !== PVP_CH && others(best) >= others(cur))) { say(`CH${cur} คนน้อยสุดแล้ว (${others(cur)} คน)`); return null; }
    chLast = `ย้ายไป CH${best} (คนน้อยกว่า: ${others(cur)} → ${others(best)} คน)`;
    return { ch: best, why: `คนน้อยสุด: ${others(cur)} → ${others(best)} คน`, lock: info.lock };
  }
  let chLast = '';
  const chPickOn = () => cfg.lockCh || cfg.quietCh || cfg.followLeader;
  async function moveToQuietChannel() {
    if (!chPickOn()) return;
    const p = await pickChannel();
    const r = room();
    if (p && r) await switchTo(r, chOf(r), p.ch, p.lock, p.why);
  }

  // where to farm right now: the bounty's map (whole map) while a bounty runs, else the saved farm map + spot
  async function backToFarm(t = tgt()) {
    if (!t.map) return false;
    const g = farmGen, still = () => g === farmGen;
    const changed = () => { if (still()) return false; log('เปลี่ยนจุดฟาร์มแล้ว — เลิกไปจุดเดิม'); return true; };
    setPhase('กลับไปฟาร์ม ' + t.map);
    if (!await travelTo(t.map, still)) { changed(); return false; }
    await sleep(1500);
    if (changed()) return false;
    setAuto(false);
    if (chPickOn()) { setPhase('เลือก CH'); await moveToQuietChannel(); }
    if (t.spot) { setPhase('เดินไปจุดฟาร์ม'); await walkToSpot(t.spot, still); await sleep(500); }
    if (changed()) return false;
    setAuto(true);
    return true;
  }

  // ===== bounty (ค่าหัว): farm today's bounties one by one, AUTO set to that mob only + whole map =====
  const BQ_KEY = 'bth_bq';
  const BQ_DEF = { active: false, list: [], i: 0, toggled: [], farmRBefore: null, setup: false, maxAbove: 3 };
  const bq = (() => { try { return { ...BQ_DEF, ...JSON.parse(localStorage.getItem(BQ_KEY) || '{}') }; } catch { return { ...BQ_DEF }; } })();
  const saveBq = () => { try { localStorage.setItem(BQ_KEY, JSON.stringify(bq)); } catch { } };
  const curBounty = () => (bq.active ? bq.list[bq.i] || null : null);
  function tgt() { const b = curBounty(); return b ? { map: b.mapName, spot: null } : { map: cfg.farmMap, spot: cfg.farmSpot }; }
  const myLevel = () => { const r = room(); const p = r && r.state.players && r.state.players.get(r.sessionId); return p ? p.level : 0; };
  const huntView = async () => { const h = await request({ type: 'huntQuery' }, m => m.type === 'hunt'); return h && h.view ? h.view.bounty : null; };

  // today's bounties from the game's own bounty window (#huntbody), progress from the server (huntQuery)
  async function readBounties() {
    const has = () => !!document.querySelector('#huntbody .hu1b [data-goto]');
    if (!has()) { click($('#openhunt'), 'เปิดหน้าค่าหัว'); await sleep(900); if ($('#huntwin') && $('#huntwin').style.display === 'block') click($('#openhunt'), 'ปิดหน้าค่าหัว'); }
    const v = await huntView();
    return [...document.querySelectorAll('#huntbody .hu1b')].map(c => {
      const go = c.querySelector('[data-goto]'), cl = c.querySelector('[data-claim]');
      if (!go || !cl || /#g:/.test(cl.dataset.claim)) return null; // gathering bounties are not mob hunts
      const head = ((c.querySelector('.hu1tx b') || {}).textContent || '').trim(), m = head.match(/^(.*?)\s*×\s*(\d+)$/) || [null, head, '0'];
      const info = ((c.querySelector('.hu1tx small') || {}).textContent || ''), lv = info.match(/Lv\s*(\d+)\s*[–-]\s*(\d+)/) || [];
      const id = cl.dataset.claim;
      return { id, mob: m[1].trim(), need: +m[2], mapId: go.dataset.goto, mapName: info.split('·')[0].trim(), lo: +lv[1] || 0, hi: +lv[2] || 0,
        prog: v ? Math.min(+m[2], v.prog[id] || 0) : 0, claimed: v ? v.claimed.includes(id) : c.classList.contains('claimed') };
    }).filter(Boolean);
  }

  // the game's AUTO settings window: "เป้าหมายในแมพนี้" chips (#au-targets .autg, class on) and farm area (#au-farm [data-farm])
  const refreshAutoUi = () => { for (let e = $('#au-targets'); e; e = e.parentElement) e.dispatchEvent(new Event('autoopen')); };
  const chips = () => [...document.querySelectorAll('#au-targets .autg')].map(b => ({ b, on: b.classList.contains('on'), name: ((b.querySelector('.autgn b') || {}).textContent || '').trim() }));
  const farmRNow = () => { const b = $('#au-farm [data-farm].on') || $('#au-farm [data-farm][aria-checked="true"]'); return b ? +b.dataset.farm : null; };
  const setFarmR = v => { if (farmRNow() !== v) click($(`#au-farm [data-farm="${v}"]`), v ? `พื้นที่ฟาร์ม ${v} ช่อง` : 'พื้นที่ฟาร์ม ทั้งแมพ'); };
  async function toggleChip(name) { refreshAutoUi(); await sleep(300); const c = chips().find(x => x.name === name); if (c) click(c.b, (c.on ? 'ปิดเป้าหมาย ' : 'เปิดเป้าหมาย ') + name); await sleep(200); }
  async function setupBountyAuto(b) {
    refreshAutoUi(); await sleep(600);
    if (bq.farmRBefore === null) bq.farmRBefore = farmRNow();
    setFarmR(0);
    const list = chips();
    if (!list.some(c => c.name === b.mob)) log(`ไม่เจอ "${b.mob}" ในเป้าหมาย Auto ของแมพนี้ — ใช้เป้าหมายเดิม`);
    else for (const c of list) if (c.on !== (c.name === b.mob)) { await toggleChip(c.name); bq.toggled.push(c.name); }
    bq.setup = true; saveBq();
    log(`ตั้ง Auto: ตีเฉพาะ ${b.mob} · ทั้งแมพ`);
  }
  async function revertBountyAuto() {
    for (const name of bq.toggled.splice(0)) await toggleChip(name); // back to what you had on this map
    saveBq();
  }
  async function finishBounty(why) {
    await revertBountyAuto();
    if (bq.farmRBefore !== null) { refreshAutoUi(); await sleep(300); setFarmR(bq.farmRBefore); bq.farmRBefore = null; }
    bq.active = false; bq.setup = false; saveBq(); renderBq();
    log(why);
    if (!cfg.farmMap) return stopWith('ค่าหัวเสร็จ', 'ยังไม่ได้ตั้งแมพฟาร์มปกติ — หยุด helper');
    setAuto(false); await backToFarm();
  }
  let bqCheckAt = 0;
  async function bountyStep() {
    const b = curBounty(); if (!b) return finishBounty('ค่าหัวครบแล้ว — กลับไปฟาร์มแมพปกติ');
    if (!bq.setup) { setAuto(false); await setupBountyAuto(b); setAuto(true); bqCheckAt = 0; }
    if (Date.now() - bqCheckAt > 15000) {
      bqCheckAt = Date.now();
      const v = await huntView();
      if (v) { b.prog = Math.min(b.need, v.prog[b.id] || 0); b.claimed = v.claimed.includes(b.id); saveBq(); renderBq(); }
      if (b.claimed || b.prog >= b.need) {
        if (!b.claimed) { const r = room(); if (r) r.send('input', { type: 'bountyClaim', id: b.id }); log(`ครบแล้ว — รับรางวัลค่าหัว ${b.mob}`); await sleep(1500); b.claimed = true; }
        await revertBountyAuto();
        bq.i++; bq.setup = false; saveBq(); renderBq();
        const nb = curBounty();
        if (!nb) return finishBounty('ค่าหัวครบทุกตัวแล้ว — กลับไปฟาร์มแมพปกติ');
        log(`ค่าหัวถัดไป: ${nb.mob} @ ${nb.mapName}`);
        setAuto(false); await backToFarm();
        return;
      }
    }
    setPhase(`ค่าหัว ${b.mob} ${b.prog}/${b.need} · ${b.mapName}`);
    if (!autoOn()) setAuto(true);
  }

  // ===== boss / mini-boss on the farm map: stop farming, walk to it, AUTO on there, back to the farm spot when it dies =====
  // mob ids with role "boss" / "mini-boss" in the game's mob table (data/bot/mobs.json; bosses = world_boss_spawns)
  const BOSS_IDS = new Set(['vale_warden', 'bloom_crowned_stag', 'prism_shell_sovereign', 'cinder_plume_roc', 'lotus_maw_matriarch',
    'aurora_antler_regent', 'tempest_kite_empress', 'opal_weaver_queen']);
  const MINIBOSS_IDS = new Set(['vale_keeper', 'dusk_herald', 'sky_sentinel']);
  const bossSkip = new Map(); // mob key -> ignore until (gave up on it)
  // the server only sends mobs within ~30 tiles; a boss that leashes back has state "return" (still alive, AUTO skips it)
  const mobAlive = m => !!m && m.state !== 'dead' && m.hp > 0 && !m.ownerId;
  const rawMob = key => { const r = room(); return (r && r.state.mobs && r.state.mobs.get(key)) || null; };
  const getMob = key => { const m = rawMob(key); return mobAlive(m) ? m : null; };
  function findBoss() {
    const r = room(), me = myPos(); if (!r || !r.state.mobs || !me) return null;
    let best = null;
    r.state.mobs.forEach((m, key) => {
      if (!mobAlive(m) || m.state === 'return' || !(BOSS_IDS.has(m.mobType) || MINIBOSS_IDS.has(m.mobType)) || (bossSkip.get(key) || 0) > Date.now()) return;
      const d = dist(me, m);
      if (!best || d < best.d) best = { key, type: m.mobType, boss: BOSS_IDS.has(m.mobType), d };
    });
    return best;
  }
  // AUTO target chip of this mob (#au-targets .autg with <img data-mob="id">); bosses are opt-in (bossesOn) in the game's AUTO
  async function allowInAuto(type) {
    refreshAutoUi(); await sleep(400);
    const c = chips().find(x => x.b.querySelector(`img[data-mob="${type}"]`));
    if (!c) { log(`ไม่เจอ ${type} ในเป้าหมาย Auto — เปิด AUTO ตามเดิม`); return false; }
    if (c.on) return false;
    click(c.b, 'เปิดเป้าหมาย ' + c.name); await sleep(200);
    return true;
  }
  // press AUTO until the game shows it on (a press right after moving can be swallowed)
  async function autoOnSure() {
    for (let i = 0; i < 4 && cfg.running && !isDead(); i++) {
      if (autoOn()) return true;
      setAuto(true); await sleep(1200);
    }
    if (!autoOn()) log('เปิด AUTO ไม่ติด');
    return autoOn();
  }
  // walk next to the boss; target = live position, or the last one seen while it is out of view
  async function walkToMob(key, near, last) {
    const deadline = Date.now() + 120e3;
    let lastSend = 0;
    while (Date.now() < deadline && cfg.running && !isDead()) {
      const m = getMob(key), p = myPos(), r = room();
      if (m) { last.x = m.x; last.y = m.y; }
      else if (rawMob(key)) return false; // seen dead
      if (p && dist(p, last) <= near) return true;
      if (r && Date.now() - lastSend > 2500) { lastSend = Date.now(); r.send('input', { type: 'moveTo', x: last.x, y: last.y }); }
      await sleep(500);
    }
    return false;
  }
  async function fightBoss(b) {
    const label = `${b.boss ? 'Boss' : 'Mini-boss'} ${b.type}`;
    const m0 = getMob(b.key), last = { x: m0 ? m0.x : 0, y: m0 ? m0.y : 0 };
    log(`เจอ ${label} ห่าง ${b.d.toFixed(0)} ช่อง — หยุดฟาร์มไปตีก่อน`);
    setPhase('ไปตี ' + label);
    setAuto(false); await sleep(500);
    const toggled = await allowInAuto(b.type);
    const deadline = Date.now() + 10 * 60e3;
    let killed = false, goneAt = 0, hpSeen = Infinity, hpDropAt = Date.now(), lastHit = 0;
    while (Date.now() < deadline && cfg.running && !isDead()) {
      const m = getMob(b.key), p = myPos(), r = room();
      if (!m) {
        if (rawMob(b.key)) { killed = true; break; }        // still listed but dead
        // not in view: died and was removed, or left our ~30 tile view -> go to where it was last seen
        if (p && dist(p, last) > 8) { setAuto(false); setPhase(`ตาม ${label} (หลุดระยะ)`); await walkToMob(b.key, 6, last); goneAt = 0; continue; }
        if (!goneAt) goneAt = Date.now();
        if (Date.now() - goneAt > 4000) { killed = true; break; } // standing where it was and it is gone
        await sleep(500); continue;
      }
      goneAt = 0; last.x = m.x; last.y = m.y;
      if (m.hp < hpSeen) { hpSeen = m.hp; hpDropAt = Date.now(); }
      const d = p ? dist(p, m) : 0;
      if (d > 10) { // AUTO only fights inside its area around where it was switched on -> (re)start it next to the boss
        setAuto(false); setPhase('เดินไปหา ' + label);
        await walkToMob(b.key, 4, last);
        hpDropAt = Date.now();
        continue;
      }
      if (m.state === 'return') { setPhase(`${label} กำลังวิ่งกลับ — รอ`); await sleep(1000); continue; }
      if (!autoOn()) await autoOnSure();
      // AUTO is on but the boss is not losing HP (AUTO busy with other mobs or skipping it) -> attack it ourselves
      if (r && Date.now() - hpDropAt > 6000 && d <= 8 && Date.now() - lastHit > 900) {
        if (!lastHit || Date.now() - lastHit > 10000) log(`AUTO ไม่ตี ${label} — สั่งตีบอสเอง`);
        lastHit = Date.now();
        r.send('input', { type: 'attack', x: m.x, y: m.y });
      }
      setPhase(`ตี ${label} · HP ${Math.round(m.hp)}/${Math.round(m.maxHp || m.hp)}`);
      await sleep(500);
    }
    if (toggled) { // put the chip back the way you had it
      setAuto(false); refreshAutoUi(); await sleep(400);
      const c = chips().find(x => x.b.querySelector(`img[data-mob="${b.type}"]`));
      if (c && c.on) click(c.b, 'ปิดเป้าหมาย ' + c.name + ' (คืนค่าเดิม)');
    }
    if (isDead() || !cfg.running) return;
    if (killed) log(`${label} ตายแล้ว — กลับจุดฟาร์ม`);
    else { bossSkip.set(b.key, Date.now() + 5 * 60e3); log(`ตี ${label} ไม่จบใน 10 นาที — ข้ามตัวนี้ 5 นาที แล้วกลับจุดฟาร์ม`); }
    setAuto(false);
    if (mapName() === cfg.farmMap) { setPhase('กลับจุดฟาร์ม'); await walkToSpot(cfg.farmSpot); await sleep(500); }
    await autoOnSure();
  }

  // ---- pressing the game's buttons ----
  const click = (e, why) => { if (!e) return false; e.click(); log('กด: ' + why); return true; };
  const setAuto = on => { if (autoOn() !== on) click($('#autobig'), on ? 'เปิด AUTO' : 'ปิด AUTO'); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- walking map to map ourselves while the tab is hidden ----
  // the world map's "เดินทางไป" walk did not move the character in a minimised window (01:52–01:53: pressed every 24 s,
  // still in Sanctum), so then walk exit to exit with moveTo, like walkToSpot. Exits from data/maps/zones.json
  // (map id -> [to, x, y] centre of the exit area). Not yet seen working: logs each step, gives up after 10 s at an exit.
  const EXITS = {'southvale_field':[['valebrook',29.5,2.0],['honeyrill',27.5,2.0]],'valebrook':[['southvale_field',21.5,42.5],['whispering_woods',21.5,2.0],['riverside',42.0,25.0],['old_quarry',2.0,30.0]],'whispering_woods':[['valebrook',27.5,54.0],['ancient_ruins',27.5,2.0],['bloomcrown_glade',42.5,2.0],['bracken_sink',32.5,54.0]],'riverside':[['valebrook',2.0,34.5],['honeyrill',2.0,26.0]],'old_quarry':[['valebrook',54.0,32.0],['verdigris_rise',2.0,28.0]],'ancient_ruins':[['whispering_woods',27.5,54.0],['sunfield_plains',27.5,2.0]],'sunfield_plains':[['ancient_ruins',27.5,54.0],['ashford',26.5,2.0],['gloomroot_forest',54.0,29.0],['bracken_sink',2.0,29.0]],'ashford':[['sunfield_plains',24.0,46.0],['gloomroot_forest',46.0,34.0],['ember_hollow',24.0,2.0],['mistmire_swamp',2.0,40.0],['duskgate_pass',45.5,2.0]],'gloomroot_forest':[['sunfield_plains',53.5,28.5],['ashford',26.5,54.0],['pitchwood',28.5,2.0]],'ember_hollow':[['ashford',25.5,54.0],['mistmire_swamp',2.0,26.5],['cinder_eyrie',54.0,22.5],['yellowlick_flats',54.0,28.0]],'mistmire_swamp':[['ashford',25.5,2.0],['ember_hollow',53.5,44.5],['duskgate_pass',40.5,2.0],['lotus_hollow',2.0,42.5],['peatcut_bog',2.0,28.0]],'duskgate_pass':[['mistmire_swamp',28.5,54.0],['stormwall_city',31.5,2.0],['ashford',12.0,2.0]],'stormwall_city':[['duskgate_pass',23.5,46.0],['frostpeak_slopes',2.0,28.0],['frozen_mere',24.0,2.0],['howling_steppes',46.0,23.0],['cloudspire_ruins',39.5,2.0]],'frostpeak_slopes':[['stormwall_city',54.0,27.5],['sledrun_gully',28.5,2.0]],'frozen_mere':[['stormwall_city',26.5,54.0],['aurora_hollow',2.0,24.5],['brinecrust_shoals',54.0,28.0]],'howling_steppes':[['stormwall_city',2.0,27.0],['cloudspire_ruins',42.5,2.0],['brinecrust_shoals',28.5,54.0]],'cloudspire_ruins':[['howling_steppes',26.5,54.0],['sanctum',26.5,2.0],['stormwall_city',2.0,12.0],['tempest_aerie',27.5,2.0],['kitewind_terraces',28.5,54.0]],'sanctum':[['cloudspire_ruins',22.0,42.5],['shattered_vale',2.0,26.0],['umbral_depths',22.0,2.0],['throne_of_warden',42.0,21.0],['rustbell_barracks',32.0,42.0]],'shattered_vale':[['sanctum',54.0,26.5],['opalweb_grotto',39.5,54.0],['glasswrack',2.0,28.0]],'umbral_depths':[['sanctum',27.5,54.0],['throne_of_warden',27.5,2.0],['marrowdeep',2.0,28.0]],'throne_of_warden':[['umbral_depths',24.5,46.0],['sanctum',32.0,2.0],['wardens_seat',24.5,46.0]],'training_grounds':[],'rootfall_barrow':[],'honeyrill':[['southvale_field',27.5,54.0],['riverside',54.0,26.0]],'bracken_sink':[['whispering_woods',28.5,2.0],['sunfield_plains',54.0,32.0]],'verdigris_rise':[['old_quarry',54.0,28.0]],'pitchwood':[['gloomroot_forest',28.5,54.0]],'yellowlick_flats':[['ember_hollow',2.0,28.0]],'peatcut_bog':[['mistmire_swamp',54.0,28.0]],'sledrun_gully':[['frostpeak_slopes',28.5,54.0]],'brinecrust_shoals':[['frozen_mere',2.0,28.0],['howling_steppes',28.5,2.0]],'kitewind_terraces':[['cloudspire_ruins',28.5,2.0]],'glasswrack':[['shattered_vale',54.0,28.0]],'marrowdeep':[['umbral_depths',54.0,28.0]],'rustbell_barracks':[['sanctum',28.5,2.0]]};
  const routeTo = (from, to) => {
    const prev = { [from]: null }, q = [from];
    while (q.length) { const m = q.shift(); if (m === to) break; for (const [n] of EXITS[m] || []) if (!(n in prev)) { prev[n] = m; q.push(n); } }
    if (!(to in prev)) return null;
    const path = []; for (let m = to; m; m = prev[m]) path.unshift(m); return path;
  };
  async function walkExits(name, still) {
    const target = Object.keys(MAP_NAMES).find(id => MAP_NAMES[id] === name);
    const r0 = room(); const from = r0 && r0.state.mapId;
    const path = target && from && routeTo(from, target);
    if (!path || path.length < 2) return false;
    const [, next] = path, ex = (EXITS[from] || []).find(e => e[0] === next), known = (exitsSeen[from] || {})[next];
    const spot = known || { x: ex[1], y: ex[2] }, key = from + '>' + next;
    if (Date.now() - (exitWalkFailed[key] || 0) < 10 * 60e3) return false; // this exit did not work a moment ago
    log(`หน้าต่างพับอยู่ — เดินเองไปทางออก ${MAP_NAMES[next] || next} (${spot.x}, ${spot.y}) · เส้นทาง ${path.map(m => MAP_NAMES[m] || m).join(' → ')}`);
    const deadline = Date.now() + 90e3; let lastSend = 0, atExit = 0;
    while (Date.now() < deadline && cfg.running && still()) {
      const r = room(), p = myPos();
      if (r && r.state.mapId !== from) return true; // next map: the caller's loop goes on from there
      if (!r || !p) { await sleep(1000); continue; }
      if (dist(p, spot) <= 1.2) {
        if (!atExit) atExit = Date.now();
        if (Date.now() - atExit > 10e3) {
          exitWalkFailed[key] = Date.now();
          log(`ถึงทางออก (${spot.x}, ${spot.y}) แล้วแต่แมพไม่เปลี่ยนใน 10 วิ${known ? '' : ' (จุดนี้มาจาก zones.json ยังไม่เคยเห็นเกมเดินผ่าน)'} — ใช้ปุ่มเดินทางของเกมแทน ไม่ลองทางออกนี้ 10 นาที`);
          return false;
        }
      } else if (Date.now() - lastSend > 4000) { lastSend = Date.now(); r.send('input', { type: 'moveTo', x: spot.x, y: spot.y }); }
      await sleep(700);
    }
    return false;
  }
  // per exit (from>to): a wrong exit must not stop the walk on the other legs (02:55: Glasswrack's failed, so the way
  // back Sanctum -> Shattered Vale, whose exit is known, waited on the game's slow hidden-tab walk)
  const exitWalkFailed = {};
  // where the game itself walks to leave a map (the last moveTo before the map changed to a neighbour): zones.json's exit
  // areas are out of date (Sanctum -> Shattered Vale: the game walks to (2, 15), zones.json says (2, 26)). Seeded with
  // what the log showed on 18 Oct, learned again on every map change, kept in localStorage.
  const EXITS_KEY = 'bth_exits';
  const exitsSeen = (() => { try { return JSON.parse(localStorage.getItem(EXITS_KEY) || 'null'); } catch { return null; } })()
    || { sanctum: { shattered_vale: { x: 2, y: 15 } }, shattered_vale: { glasswrack: { x: 2, y: 42 } } };
  let lastMove = null, lastMapId = '';
  const exitTimer = setInterval(() => {
    const r = room(), id = r && r.state && r.state.mapId; if (!id) return;
    if (lastMapId && id !== lastMapId && lastMove && lastMove.map === lastMapId && Date.now() - lastMove.at < 15e3
      && (EXITS[lastMapId] || []).some(e => e[0] === id)) {
      const was = (exitsSeen[lastMapId] || {})[id];
      if (!was || was.x !== lastMove.x || was.y !== lastMove.y) {
        exitsSeen[lastMapId] = { ...(exitsSeen[lastMapId] || {}), [id]: { x: lastMove.x, y: lastMove.y } };
        try { localStorage.setItem(EXITS_KEY, JSON.stringify(exitsSeen)); } catch { }
        log(`จำทางออก ${MAP_NAMES[lastMapId] || lastMapId} → ${MAP_NAMES[id] || id} ที่ (${lastMove.x}, ${lastMove.y})`);
      }
    }
    lastMapId = id;
  }, 500);
  async function travelTo(name, still = () => true) {
    if (mapName() === name) return true;
    const deadline = Date.now() + 6 * 60e3;
    let lastGo = 0, lastMap = mapName(), lastMapAt = Date.now();
    while (Date.now() < deadline && cfg.running && still()) {
      if (isDead()) return false;
      if (mapName() === name) return true;
      if (mapName() !== lastMap) { lastMap = mapName(); lastMapAt = Date.now(); }
      // game asks "วาร์ปไป <town> แล้วเดินต่อ?" when a nearer town has a warp point -> warp, then it walks on by itself
      if (dialogOpen() && /วาร์ป/.test(dialogTitle())) { click($('#bcyes'), 'วาร์ปแล้วเดินต่อ'); lastGo = lastMapAt = Date.now(); await sleep(2000); continue; }
      // hidden tab: walk exit to exit ourselves (unless that already failed in the last 10 min)
      if (document.hidden && Date.now() - lastMapAt > 8e3) {
        if (await walkExits(name, still)) { lastMap = mapName(); lastMapAt = Date.now(); continue; }
      }
      // (re)start the game's own route walk when nothing has changed for a while
      if (Date.now() - lastGo > 25e3 && Date.now() - lastMapAt > 8e3) {
        lastGo = Date.now();
        click($('#worldbtn'), 'แผนที่โลก'); await sleep(700);
        const spot = [...document.querySelectorAll('.atlasspot')].find(b => (b.getAttribute('aria-label') || '').startsWith(name + ' '));
        if (!spot) { log('ไม่เจอแมพ "' + name + '" บนแผนที่โลก'); return false; }
        click(spot, 'เลือก ' + name); await sleep(700);
        if (!click($('.wdgo'), 'เดินทางไป ' + name)) { log('ไม่มีปุ่มเดินทาง (อาจอยู่แมพนั้นแล้ว)'); }
      }
      await sleep(1000);
    }
    return mapName() === name;
  }

  // town warp (500 G, free with Premium): HUD warp button -> card "วาร์ป" of that town
  const TOWN_IDS = { 'Valebrook': 'valebrook', 'Ashford': 'ashford', 'Stormwall City': 'stormwall_city', 'Sanctum': 'sanctum' };
  async function warpToTown(name) {
    if (mapName() === name) return true;
    const id = TOWN_IDS[name];
    if (!id) return false;
    if (!await waitForCombatToFinish('วาร์ป')) return false; // the game does not warp while in combat
    click($('button[data-svc="warp"]'), 'เปิดเมนูวาร์ป'); await sleep(1200);
    const go = $(`.wp2go[data-warp="${id}"]`);
    if (!go || go.disabled) { log(`วาร์ปไป ${name} ไม่ได้ (${go ? go.textContent.trim() : 'ยังไม่ปลดล็อก'})`); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
    click(go, 'วาร์ปไป ' + name);
    for (let i = 0; i < 30 && cfg.running; i++) { if (mapName() === name) return true; await sleep(1000); }
    return mapName() === name;
  }

  // ---- town: walk to the merchant (game's own "walk to NPC" dialog) until the shop window (#sellwin) opens ----
  const shopOpen = () => { const w = $('#sellwin'); return !!w && w.style.display === 'block'; };
  async function openShop() {
    const deadline = Date.now() + 3 * 60e3;
    while (Date.now() < deadline && cfg.running) {
      if (isDead()) return false;
      if (shopOpen()) return true;
      if (dialogOpen() && /NPC/.test(dialogTitle())) { click($('#bcyes'), 'เดินไปหา NPC ร้านค้า'); await sleep(5000); continue; }
      click($('#wtwarn'), 'เปิดหน้าร้าน'); await sleep(1500);
    }
    log('เปิดหน้าร้านไม่ได้ภายใน 3 นาที');
    return false;
  }
  const closeShop = () => { if (shopOpen()) click($('#wtwarn'), 'ปิดหน้าร้าน'); };
  async function sellAll() {
    const before = weightPct(), b = $('#sellallmats');
    if (!visible(b)) { log('ไม่มีของตรงหมวดที่ติ๊กให้ขาย'); return; }
    click(b, 'ขายเลย (ตามหมวดที่ติ๊ก)'); await sleep(600);
    if (dialogOpen() && /ขาย/.test(dialogTitle())) click($('#bcyes'), 'ยืนยันขาย');
    await sleep(2000);
    log(`ขายแล้ว น้ำหนัก ${before}% → ${weightPct()}%`);
  }
  // ---- salvage (แยกชิ้น): bag → "เลือกแยกชิ้น" → tick Normal / Magic gear below cfg.salvBelow → แยกชิ้น → confirm ----
  // the game only marks gear it can salvage (.salvok: not locked / cash / no-trade); rarity is the slot's data-rar.
  // item level is read from the game's own tooltip ("เลเวล N", level-1 gear has no such line), so it follows game updates
  const SALV_RAR = ['normal', 'uncommon', 'magic']; // uncommon = Magic with 1 affix
  function itemLevel(cell) {
    if (typeof cell.onmouseenter !== 'function') return null;
    cell.onmouseenter();
    // gear of a slot you wear opens a compare tooltip: "ชิ้นนี้" (.tcmpcol.new) is the bag item
    const tip = $('#tip'), card = tip && (tip.querySelector('.tcmpcol.new .it3') || tip.querySelector('.it3'));
    const name = card && card.querySelector('.mxname'), own = cell.querySelector('.nm');
    // tooltip not opened for this slot (touch mode / a pinned tooltip) -> unknown
    const ok = !!name && !!own && !!own.textContent && name.textContent.includes(own.textContent);
    const req = ok ? [...card.querySelectorAll('.mxside p, .mxreq p')].map(p => (p.textContent || '').trim().match(/^เลเวล\s*(\d+)$/)).find(Boolean) : null;
    if (typeof cell.onmouseleave === 'function') cell.onmouseleave();
    return ok ? (req ? +req[1] : 1) : null;
  }
  async function salvageJunk() {
    if (!cfg.salvOn) return;
    const bagShown = () => visible($('#invitems')), wasOpen = bagShown();
    if (!wasOpen) { click($('#mbbag'), 'เปิดกระเป๋า'); await sleep(800); }
    const btn = $('#bagsalv');
    if (!bagShown() || !btn) { log('เปิดกระเป๋า / ปุ่มเลือกแยกชิ้นไม่ได้ — ข้ามการแยกชิ้น'); return; }
    if (btn.classList.contains('on')) { click(btn, 'เลิกเลือกแยกชิ้น (ล้างที่เลือกไว้)'); await sleep(400); }
    click(btn, 'เลือกแยกชิ้น'); await sleep(800);
    let n = 0, unknown = 0;
    for (const cell of document.querySelectorAll('#invitems .slot.salvok')) {
      if (!SALV_RAR.includes(cell.dataset.rar) || cell.querySelector('.rfn')) continue; // never refined gear
      const lv = itemLevel(cell);
      if (lv === null) { unknown++; continue; }
      if (lv < cfg.salvBelow) { cell.click(); n++; }
    }
    if (unknown) log(`อ่านเลเวลไอเทมไม่ได้ ${unknown} ชิ้น (ต้องเล่นด้วยเมาส์) — ไม่แยกชิ้นพวกนั้น`);
    if (!n) log(`ไม่มีอุปกรณ์ Normal / Magic เลเวลต่ำกว่า ${cfg.salvBelow} ให้แยกชิ้น`);
    else {
      const before = weightPct();
      click($('#salvbar [data-sv="go"]'), `แยกชิ้น ${n} ชิ้น`); await sleep(700);
      if (dialogOpen() && /แยกชิ้น/.test(dialogTitle())) click($('#bcyes'), 'ยืนยันแยกชิ้น');
      await sleep(2500);
      log(`แยกชิ้นแล้ว ${n} ชิ้น · น้ำหนัก ${before}% → ${weightPct()}%`);
    }
    if (btn.classList.contains('on')) click(btn, 'เลิกเลือกแยกชิ้น');
    if (!wasOpen && bagShown()) click($('#mbbag'), 'ปิดกระเป๋า');
    await sleep(400);
  }
  // top every potion plan up to its `to` (NPC sells max 99 per purchase; same message as the shop's buy button)
  async function buyPotions() {
    for (const p of potionPlans()) {
      if (p.have === null) { log(`${potName(p.item)} ไม่ได้อยู่ในช่องยา — ใส่ไว้ในช่อง Q/E ก่อน helper ถึงนับได้`); continue; }
      let need = (p.to || 0) - p.have, got = 0;
      while (need > 0 && cfg.running) {
        const q = Math.min(99, need), before = beltCount(p.item) || 0;
        // server messages that name this item: when the 'bought' reply doesn't come, log what came instead
        const r = room(), seen = new Set();
        const off = r && r.onMessage('server', m => { for (const x of Array.isArray(m) ? m : [m]) if (x && x.type && JSON.stringify(x).includes(p.item)) seen.add(x.type); });
        const res = await request({ type: 'vendorBuy', itemId: p.item, qty: q }, m => m.type === 'bought' && m.itemId === p.item, 5000);
        if (off) off();
        // the belt count is what counts: the purchase can go through even when the reply isn't recognised
        const added = res && res.ok ? res.qty || q : Math.max(0, (beltCount(p.item) || 0) - before);
        if (!res && seen.size) log(`ร้านตอบกลับแบบอื่น (${[...seen].join(', ')})`);
        if (!added) { log(`ซื้อ ${potName(p.item)} ไม่ได้: ${res ? res.reason || 'ไม่ทราบสาเหตุ' : 'ไม่มีคำตอบ'}`); break; }
        got += added; need -= added;
        await sleep(400);
      }
      if (got) log(`ซื้อ ${potName(p.item)} ×${got} (มี ${beltCount(p.item)})`);
    }
  }
  // one trip: town -> shop -> (sell) -> top up potions
  async function townTrip(why, sell) {
    setPhase(why); log(why); setAuto(false); await sleep(800);
    const town = cfg.town || 'Ashford';
    if (!TOWN_IDS[mapName()] && !(await warpToTown(town) || await travelTo(town))) { log('ไปเมืองไม่ได้'); return false; }
    if (sell && cfg.salvOn) { setPhase('แยกชิ้นอุปกรณ์'); await salvageJunk(); }
    setPhase('ที่ร้านค้า ' + mapName());
    if (!await openShop()) return false;
    if (sell) await sellAll();
    await buyPotions();
    closeShop();
    return true;
  }
  // World Boss round open: stop farming, warp into the arena, AUTO until the boss is dead / gone / time is up, leave,
  // back to the farm spot. Dying there costs nothing: respawn and go back in while the round is still open.
  const mapId = () => { const r = room(); return (r && r.state && r.state.mapId) || ''; };
  const wbLeft = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  async function wbEnter() {
    for (let i = 0; i < 3 && mapId() !== WB_ARENA && cfg.running; i++) {
      const r = room(); if (r) r.send('input', { type: 'worldBossWarp', enter: true });
      for (let k = 0; k < 20 && mapId() !== WB_ARENA && cfg.running; k++) await sleep(1000);
    }
    return mapId() === WB_ARENA;
  }
  // the boss in the arena (state key "wb_boss"); AUTO does not walk there from the entrance by itself
  const wbBoss = () => {
    const r = room(); if (!r || !r.state || !r.state.mobs) return null;
    let b = r.state.mobs.get ? r.state.mobs.get('wb_boss') : null;
    if (!b) r.state.mobs.forEach(m => { if (!b && m.mobType === 'wraithroot_colossus') b = m; });
    return b && b.state !== 'dead' ? b : null;
  };
  // damage share of the round: the server sends fractions of the boss HP (0.042 = 4.2 %)
  const wbPct = v => (Number(v) || 0) <= 1 ? `${((Number(v) || 0) * 100).toFixed(1)}%` : Number(v).toLocaleString();
  async function wbWalkToBoss() {
    const b = wbBoss(), p = myPos(), r = room();
    if (!b || !p || !r) return;
    if (dist(p, b) <= 5) return;
    setAuto(false);
    setPhase('World Boss: เดินไปหาบอส');
    for (let i = 0; i < 25 && cfg.running && mapId() === WB_ARENA && !isDead(); i++) {
      const bb = wbBoss(), pp = myPos(); if (!bb || !pp) break;
      if (dist(pp, bb) <= 3) break;
      if (i % 4 === 0) r.send('input', { type: 'moveTo', x: bb.x, y: bb.y });
      await sleep(500);
    }
    setAuto(true);
  }
  // Also resumes when the helper (re)starts while the character is already in the arena: without round data (it only
  // comes on a map join / round change) the round counts as over once the boss is gone for 20 s.
  async function worldBossTrip() {
    let id = wb.view ? wb.view.id : null, noBossSince = 0;
    if (mapId() !== WB_ARENA) {
      setPhase('World Boss: เข้าสนาม');
      log(`World Boss ${wb.view && wb.view.state === 'live' ? 'เกิดแล้ว' : 'กำลังจะมา'} — เข้าไปตี`);
      setAuto(false);
      if (!await waitForCombatToFinish('วาร์ป')) return;
      if (!await wbEnter()) { wb.doneId = id; log('เข้าสนาม World Boss ไม่ได้ — กลับไปฟาร์ม'); await backToFarm(); return; }
      await sleep(1500);
    } else log('อยู่ในสนาม World Boss อยู่แล้ว — ตีต่อ');
    await wbWalkToBoss(); setAuto(true);
    while (cfg.running) {
      const v = wb.view, now = Date.now();
      if (v && id === null) id = v.id;   // round data arrived while inside
      if (v) {
        if (v.id !== id || v.state === 'dead' || v.state === 'fled') break;
        if (v.state === 'live' && v.endsAt && now > v.endsAt + 5000) break;
        if (v.state === 'idle' && v.startAt && now > v.startAt + WB_OPEN_MS) break;
      } else if (mapId() === WB_ARENA) {
        if (wbBoss()) noBossSince = 0; else if (!noBossSince) noBossSince = now; else if (now - noBossSince > 20000) break;
      }
      if (isDead()) {
        setPhase('World Boss: ตาย — เกิดใหม่แล้วเข้าไปใหม่');
        for (let i = 0; i < 20 && isDead() && cfg.running; i++) { const b = $('#drespawn'); if (b && !b.disabled) click(b, 'เกิดใหม่'); await sleep(1500); }
        await sleep(2000);
        continue;
      }
      if (mapId() !== WB_ARENA) {   // respawned outside: back in while the round is open
        if (!wbOpen()) break;
        setAuto(false);
        if (!await wbEnter()) break;
        await sleep(1500); await wbWalkToBoss(); setAuto(true);
        continue;
      }
      if (!v || v.state === 'live') await wbWalkToBoss();   // drifted away (AUTO chased an add / just respawned): back to the boss
      if (!autoOn()) setAuto(true);
      setPhase(!v ? 'World Boss: ตี (ยังไม่มีข้อมูลรอบ)'
        : v.state === 'live'
          ? `World Boss: ตี · HP ${v.frac != null ? (v.frac * 100).toFixed(1) + '%' : '?'} · ดาเมจเรา ${wbPct(wb.mine)} (เกณฑ์รางวัล ${wbPct(wb.need)}) · เหลือ ${wbLeft(v.endsAt - now)}`
          : `World Boss: รอในสนาม · เริ่มใน ${wbLeft(v.startAt - now)}`);
      await sleep(2000);
    }
    wb.doneId = id;
    log(`World Boss จบ (${(wb.view && wb.view.state) || 'บอสหายไปแล้ว'}) · ดาเมจเรา ${wbPct(wb.mine)} (เกณฑ์ ${wbPct(wb.need)}) — ออกจากสนาม`);
    setAuto(false);
    if (mapId() === WB_ARENA) {
      const r = room(); if (r) r.send('input', { type: 'worldBossWarp', enter: false });
      for (let k = 0; k < 20 && mapId() === WB_ARENA && cfg.running; k++) await sleep(1000);
    }
    await sleep(1500);
    await backToFarm();
  }
  const stopWith = (why, msg) => { log(msg); cfg.running = false; save(); render(); setPhase('หยุด: ' + why); };

  // ---- main loop ----
  let busy = false, phase = 'stopped', startCheck = false;
  async function tick() {
    if (!cfg.running || busy) return;
    busy = true;
    let boss = null;
    try {
      if (isDead()) {
        setPhase('ตาย — รอ ' + cfg.deathWaitMs / 1000 + ' วิ');
        if (!cfg.town) cfg.town = respawnTown(), save();
        await sleep(cfg.deathWaitMs);
        for (let i = 0; i < 40 && isDead() && cfg.running; i++) { const b = $('#drespawn'); if (b && !b.disabled) click(b, 'เกิดใหม่ในเมือง'); await sleep(1500); }
        await sleep(3000);
        // already in town: sell if heavy, top up potions if below target
        const sell = weightPct() >= cfg.sellAfterDeathPct;
        if (sell || potionPlans().some(p => p.have !== null && p.have < (p.to || 0))) await townTrip('ในเมือง: ขายของ / ซื้อยา', sell);
        await backToFarm();
      } else if (cfg.worldBoss && (mapId() === WB_ARENA || (wbOpen() && wb.view.id !== wb.doneId))) {
        await worldBossTrip();   // also when the helper starts already inside the arena
      } else if (bagFull()) {
        await townTrip(`ของเต็ม (น้ำหนัก ${weightPct()}%${slotsFull() ? ' / ช่องเต็ม' : ''}) — กลับเมือง`, true);
        // still full after selling (sell filter keeps the rest) -> stop instead of warping again and again
        if (bagFull()) return stopWith('ขายแล้วของยังเต็ม', `ขายแล้วยังเต็ม (${weightPct()}%) — หยุด helper: ติ๊กหมวดขายเพิ่ม หรือฝาก Bank`);
        await backToFarm();
      } else if (mapName() === tgt().map && lowPotions().length) {
        const low = lowPotions().map(p => `${potName(p.item)} ${p.have}/${p.min}`).join(', ');
        const reached = await townTrip(`ยาใกล้หมด (${low}) — กลับเมืองซื้อ`, weightPct() >= cfg.sellAfterDeathPct);
        if (!reached && cfg.running) return stopWith('ไปร้านค้าไม่ได้', `ไปเมือง / เปิดหน้าร้านไม่ได้ เลยยังไม่ได้ซื้อยา (${low}) — หยุด helper`);
        // still below minimum (not enough Gold, item not sold here) -> stop instead of warping again and again
        if (lowPotions().length) return stopWith('ซื้อยาไม่ได้', `ซื้อยาแล้วยังต่ำกว่าขั้นต่ำ (${lowPotions().map(p => potName(p.item) + ' ' + p.have).join(', ')}) — Gold ไม่พอ? หยุด helper`);
        await backToFarm();
      } else if (bq.active && !curBounty()) {
        // bounty list done or stopped: put AUTO back while still on the bounty map, then go home
        await finishBounty('ค่าหัวจบแล้ว — กลับไปฟาร์มแมพปกติ');
      } else if (mapName() !== tgt().map) {
        // during a bounty the helper moves you between bounty maps itself
        if (startCheck || curBounty()) { startCheck = false; setAuto(false); await backToFarm(); } // you pressed ▶ elsewhere -> go there
        // not caused by the helper (its own trips return inside the same tick): you moved yourself -> pause, don't drag you back
        else if (mapName()) { cfg.running = false; save(); render(); setPhase('หยุดชั่วคราว: คุณย้ายแมพเอง'); log(`ย้ายไป ${mapName()} เอง — หยุดไว้ก่อน · กด "จำจุดนี้" ที่จุดใหม่ แล้วกด ▶`); }
      } else if (bq.active) {
        startCheck = false;
        await bountyStep();
      } else if (startCheck) {
        // just pressed ▶ on the farm map: quietest channel, then the saved spot
        startCheck = false;
        setAuto(false);
        if (chPickOn()) { setPhase('เลือก CH'); await moveToQuietChannel(); }
        const g = farmGen;
        setPhase('เดินไปจุดฟาร์ม'); await walkToSpot(cfg.farmSpot, () => g === farmGen); await sleep(500);
        if (g === farmGen) setAuto(true); // new spot picked meanwhile -> the next tick walks there
      } else if (cfg.bossHunt && (boss = findBoss())) {
        await fightBoss(boss);
      } else {
        const pots = potionPlans().filter(p => p.have !== null).map(p => `${potName(p.item)} ${p.have}`).join(' · ');
        setPhase(`ฟาร์ม · น้ำหนัก ${weightPct()}%${pots ? ' · ' + pots : ''}`);
        if (!autoOn()) setAuto(true);
      }
    } catch (e) { log('error: ' + e.message); } finally { busy = false; }
  }

  // ---- small panel ----
  const uiStyle = document.createElement('style');
  uiStyle.id = 'bth-style';
  uiStyle.textContent = `
    /* colours and font taken from the game's own windows (boss DPS meter): Kanit, navy glass, gold title, blue active tab */
    #bth { box-sizing:border-box; width:300px!important; max-width:calc(100vw - 16px); max-height:82vh; padding:0!important; overflow:hidden; border:1px solid rgba(255,255,255,.14); border-radius:10px!important; background:rgba(12,20,32,.5)!important; color:#fff!important; font:500 11.5px/1.45 Kanit,"Noto Sans Thai",system-ui,sans-serif!important; box-shadow:none!important; text-shadow:0 1px 2px rgba(0,0,0,.6); }
    #bthbar { box-sizing:border-box; display:flex; align-items:center; gap:7px; min-height:38px; margin:0!important; padding:6px 8px 6px 10px!important; border-radius:0!important; border-bottom:1px solid rgba(255,255,255,.1); background:transparent!important; color:#fff; }
    #bthbar::before { content:"⠿"; color:#8fa2bb; font-size:12px; }
    #bthbar b { flex:1; color:#ffd27a; font-size:12.5px; font-weight:600; }
    #bthmini { box-sizing:border-box; display:flex; flex:none; align-items:center; justify-content:flex-end; max-width:150px; min-width:0; margin-left:auto; overflow:hidden; color:#9fd0ff!important; font-size:11.5px; font-weight:600; line-height:1.6; text-overflow:ellipsis; white-space:nowrap; }
    #bthbody { display:grid; gap:8px; max-height:calc(82vh - 38px); overflow:auto; padding:8px; scrollbar-width:thin; scrollbar-color:rgba(143,162,187,.4) transparent; }
    #bth #bthbody { display:grid; gap:0; max-height:calc(82vh - 38px); overflow:auto; padding:0; }
    #bth-tabs { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:4px; padding:8px 8px 0; }
    #bth .bth-tab { min-height:26px; padding:3px 2px; border:1px solid rgba(255,255,255,.14); border-radius:6px; background:rgba(255,255,255,.06); color:#b9c8da; font-size:11px; font-weight:600; }
    #bth .bth-tab:hover { background:rgba(255,255,255,.12); color:#fff; }
    #bth .bth-tab[aria-selected="true"] { border-color:#2f74e0; background:#2f74e0; color:#fff; }
    #bth-pages { padding:8px; }
    #bth .bth-page { display:none; }
    #bth .bth-page.active { display:grid; }
    #bth button { box-sizing:border-box; min-height:28px; border:1px solid rgba(255,255,255,.2); border-radius:6px; padding:4px 10px; background:rgba(42,53,80,.8); color:#fff; font:600 11.5px Kanit,"Noto Sans Thai",system-ui,sans-serif; cursor:pointer; transition:background .15s,border-color .15s,transform .12s; }
    #bth button:hover { background:rgba(62,78,115,.9); border-color:rgba(159,208,255,.5); }
    #bth button:active { transform:translateY(1px); }
    #bth #bthrun, #bth #bthqgo { min-height:34px; background:#2f74e0; border-color:#2f74e0; color:#fff; font-size:12.5px; }
    #bth #bthrun:hover, #bth #bthqgo:hover { background:#3f84f0; border-color:#3f84f0; }
    #bth select, #bth input:not([type=checkbox]) { box-sizing:border-box; min-height:28px; border:1px solid rgba(255,255,255,.18); border-radius:6px; padding:3px 7px; background:rgba(5,10,18,.7); color:#fff; font:500 11.5px Kanit,"Noto Sans Thai",system-ui,sans-serif; }
    #bth select { max-width:100%; }
    #bth select option { background:#141c2b; color:#fff; }
    #bth input:focus, #bth select:focus { outline:2px solid rgba(47,116,224,.8); outline-offset:1px; }
    .bth-section { display:grid; gap:7px; padding:9px; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:linear-gradient(90deg,rgba(90,140,255,.14),rgba(90,140,255,.04)); }
    .bth-section-title { display:flex; align-items:center; gap:7px; color:#fff; font-weight:600; font-size:12px; }
    .bth-section-title small { color:#8fa2bb; font:600 9.5px Kanit,sans-serif; letter-spacing:.8px; }
    .bth-map { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; min-height:32px; }
    #bthmap { min-width:0; overflow-wrap:anywhere; color:#ffd27a; font-weight:600; }
    .bth-field { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; color:#b9c8da; }
    .bth-field select { width:140px; }
    .bth-inline { display:flex; align-items:center; justify-content:space-between; gap:8px; color:#b9c8da; }
    .bth-inline span:last-child { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
    .bth-inline input { width:60px; text-align:right; }
    .bth-potions { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .bth-potion { display:grid; gap:5px; min-width:0; padding:7px; border:1px solid rgba(255,255,255,.1); border-radius:7px; background:rgba(5,10,18,.25); }
    .bth-potion-title { color:#fff; font-size:11.5px; font-weight:600; }
    .bth-potion select { width:100%; }
    .bth-potion-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
    .bth-potion-grid label { display:grid; gap:2px; color:#8fa2bb; font-size:10.5px; }
    .bth-potion-grid input { width:100%; }
    .bth-switch { display:flex; align-items:center; gap:8px; color:#e3ebf5; cursor:pointer; }
    .bth-switch input { position:absolute; width:1px!important; height:1px!important; opacity:0; }
    .bth-switch-ui { position:relative; flex:none; width:30px; height:17px; border:1px solid rgba(255,255,255,.2); border-radius:99px; background:rgba(42,53,80,.9); transition:.15s; }
    .bth-switch-ui::after { content:""; position:absolute; top:2px; left:2px; width:11px; height:11px; border-radius:50%; background:#8fa2bb; transition:.15s; }
    .bth-switch input:checked + .bth-switch-ui { background:#2f74e0; border-color:#2f74e0; }
    .bth-switch input:checked + .bth-switch-ui::after { transform:translateX(13px); background:#fff; }
    .bth-switch input:focus-visible + .bth-switch-ui { outline:2px solid #9fd0ff; outline-offset:2px; }
    .bth-switch:has(input:disabled) { opacity:.4; cursor:not-allowed; pointer-events:none; }
    .bth-note { color:#8fa2bb; font-size:10.5px; }
    .bth-note b { color:#cfdcec; font-weight:600; }
    .bth-subnote { margin:-4px 0 4px 40px; }
    .bth-chinfo { padding:6px 8px; border-radius:6px; background:rgba(255,255,255,.06); font-size:11px; }
    #bthqnote { padding:7px 9px; border:1px solid rgba(255,210,122,.25); border-radius:6px; background:rgba(255,210,122,.07); color:#ffd27a!important; }
    #bthqlist { max-height:min(38vh,300px)!important; overflow:auto; scrollbar-width:thin; scrollbar-color:rgba(143,162,187,.4) transparent; }
    #bthqlist > div, #bthqlist label { padding:6px 8px!important; margin-bottom:3px; border-radius:6px; background:linear-gradient(90deg,rgba(90,140,255,.32),rgba(90,140,255,.08)); }
    #bth #bthset { display:grid; place-items:center; width:32px; min-height:32px; height:32px; padding:0; border-color:rgba(229,72,77,.65); background:rgba(229,72,77,.16); }
    #bth #bthset svg { width:20px; height:20px; fill:#e5484d; }
    #bth #bthset:hover { background:rgba(229,72,77,.3); }
    #bth #bthset.pick { background:#e5484d; border-color:#e5484d; animation:bthpick 1s ease-in-out infinite alternate; }
    #bth #bthset.pick svg { fill:#fff; }
    @keyframes bthpick { to { box-shadow:0 0 0 4px rgba(229,72,77,.35); } }
    #bthbar button { flex:none; width:24px; height:24px; min-height:24px; padding:0!important; border:1px solid rgba(255,255,255,.2)!important; border-radius:6px!important; background:rgba(42,53,80,.8)!important; color:#fff!important; font:600 12px/1 Kanit,system-ui,sans-serif!important; }
    #bthbar button:hover { background:rgba(62,78,115,.95)!important; }
    #chmenu .chrow { position:relative; padding-right:56px; }
    #chmenu .chrow .bthcnt { position:absolute; right:10px; top:7px; color:#000; font:700 11px var(--sans); }
    @media(max-width:420px) { #bth { width:min(300px,calc(100vw - 16px))!important; } .bth-potions { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(uiStyle);
  const box = document.createElement('div');
  box.id = 'bth';
  box.style.cssText = 'position:fixed;z-index:99999;background:rgba(20,24,34,.92);color:#e8ecf4;font:12px/1.4 Kanit,sans-serif;padding:8px 10px;border-radius:8px;width:230px;box-shadow:0 2px 10px #0008';
  box.innerHTML = `<div id="bthbar" style="cursor:move;user-select:none;touch-action:none">
     <b>Binder Helper</b> <span id="bthmini" style="color:#9fd"></span>
     <button id="bthmin" type="button" title="ย่อแผง" aria-label="ย่อแผง">−</button></div>
   <div id="bthbody">
   <div id="bth-tabs" role="tablist" aria-label="หมวดตั้งค่า">
     <button class="bth-tab" type="button" role="tab" data-bth-tab="farm" aria-selected="true">ฟาร์ม</button>
     <button class="bth-tab" type="button" role="tab" data-bth-tab="return" aria-selected="false">ขายของ</button>
     <button class="bth-tab" type="button" role="tab" data-bth-tab="supply" aria-selected="false">เติมยา</button>
     <button class="bth-tab" type="button" role="tab" data-bth-tab="travel" aria-selected="false">Channel</button>
     <button class="bth-tab" type="button" role="tab" data-bth-tab="bounty" aria-selected="false">ค่าหัว</button>
   </div>
   <div id="bth-pages">
     <section class="bth-section bth-page active" role="tabpanel" data-bth-page="farm">
       <div class="bth-section-title"><small>FARM</small><span>จุดฟาร์ม</span></div>
       <div class="bth-map"><b id="bthmap"></b><button id="bthset" type="button" title="เลือกจุดฟาร์ม: เปิดแผนที่ใหญ่ แล้วแตะจุดที่จะฟาร์ม" aria-label="เลือกจุดฟาร์มบนแผนที่"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-mob"/></svg></button></div>
       <label class="bth-inline" for="bthwait"><span>รอก่อนกลับมาเกิด</span><span><input id="bthwait" type="number" min="0" max="60"> วินาที</span></label>
       <label class="bth-switch"><input id="bthboss" type="checkbox"><span class="bth-switch-ui"></span><span>เจอ Boss / Mini-boss ในแมพ ไปตีก่อน</span></label>
       <label class="bth-switch"><input id="bthwb" type="checkbox"><span class="bth-switch-ui"></span><span>เข้า World Boss อัตโนมัติ (ตีจนจบ แล้วกลับมาฟาร์ม)</span></label>
       <div class="bth-note" id="bthwbinfo"></div>
       <label class="bth-switch" id="bthmobiconrow"><input id="bthmobicon" type="checkbox"><span class="bth-switch-ui"></span><span>แสดงรูปมอนบนมินิแมพ</span></label>
       <button id="bthrun" type="button" style="width:100%"></button>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="return" hidden>
       <div class="bth-section-title"><small>RETURN</small><span>กลับเมืองและจัดกระเป๋า</span></div>
       <label class="bth-field" for="bthtown"><span>เมืองที่จะกลับไป</span><select id="bthtown">${Object.keys(TOWN_IDS).map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
       <label class="bth-inline" for="bthpct"><span>ขายของเมื่อน้ำหนักถึง</span><span><input id="bthpct" type="number" min="10" max="100"> %</span></label>
       <label class="bth-switch"><input id="bthsalv" type="checkbox"><span class="bth-switch-ui"></span><span>แยกชิ้นอุปกรณ์ Normal / Magic ก่อนขาย</span></label>
       <label class="bth-inline" for="bthsalvlv"><span>เฉพาะเลเวลไอเทมต่ำกว่า</span><span>Lv <input id="bthsalvlv" type="number" min="2" max="99" style="width:48px"></span></label>
       <div class="bth-note">ไม่แยกชิ้น Rare / Epic / Unique / ของตีบวก / ของล็อก</div>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="supply" hidden>
       <div class="bth-section-title"><small>SUPPLY</small><span>เติมยาอัตโนมัติ</span></div>
       <div class="bth-potions">${['hp', 'mp'].map(k => `<div class="bth-potion"><div class="bth-potion-title">${k === 'hp' ? '♥ ยา HP' : '✦ ยา MP'}</div><select id="bth_${k}_item">${Object.entries(POTIONS[k]).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select><div class="bth-potion-grid"><label>ซื้อเมื่อ<input id="bth_${k}_min" type="number" min="0" max="9999"></label><label>เติมถึง<input id="bth_${k}_to" type="number" min="0" max="9999"></label></div></div>`).join('')}</div>
       <div class="bth-note">ตั้งค่า 0 เพื่อปิด · ยาต้องอยู่ในช่อง Q/E</div>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="travel" hidden>
       <div class="bth-section-title"><small>TRAVEL</small><span>การเลือก Channel</span></div>
       <div id="bthchinfo" class="bth-chinfo"></div>
       <label class="bth-switch"><input id="bthlockch" type="checkbox"><span class="bth-switch-ui"></span><span>ล็อก Channel</span></label>
       <label class="bth-inline" for="bthlockchnum"><span>อยู่เฉพาะ CH</span><span><button id="bthlockchcur" type="button">ใช้ CH ตอนนี้</button><input id="bthlockchnum" type="number" min="1" max="99" style="width:48px"></span></label>
       <div class="bth-note bth-subnote">เปิดอยู่ → ไม่ตามหัวตี้ ไม่ย้ายหา CH คนน้อย · ย้ายไป CH ที่ล็อกตอนกด ▶ และตอนกลับมาแมพฟาร์มเท่านั้น</div>
       <label class="bth-switch"><input id="bthlead" type="checkbox"><span class="bth-switch-ui"></span><span>ตาม Channel ของหัวตี้ก่อน</span></label>
       <div class="bth-note bth-subnote">หัวตี้ออนไลน์และอยู่แมพเดียวกัน → ย้ายไป CH เดียวกับหัวตี้ · ถ้าหัวตี้อยู่ CH PvP จะไม่ตาม</div>
       <label class="bth-switch"><input id="bthquiet" type="checkbox"><span class="bth-switch-ui"></span><span>ถ้าไม่เจอ ให้เลือก Channel คนน้อยสุด</span></label>
       <div class="bth-note bth-subnote">นับคนอื่นในแมพนี้ของแต่ละ CH · ย้ายเมื่อเจอ CH ที่คนน้อยกว่าจริง · คนเท่ากันเลือก CH ที่ทั้ง CH คนน้อยกว่า · ข้าม CH เต็ม (แมพ 40 / ทั้ง CH 300 คน)</div>
       <div class="bth-note"><b>เลือก CH เมื่อ</b> เข้าแมพฟาร์ม: กด ▶ · กลับมาแมพฟาร์ม (หลังตาย / เข้าเมือง / ค่าหัว) — ระหว่างฟาร์มไม่ย้าย CH</div>
       <div class="bth-note"><b>ติดต่อสู้</b> รอให้หลุดก่อนย้าย CH และก่อนวาป (AUTO สู้กลับเฉพาะตอนโดนตี) · เกิน 60 วิ: ไม่ย้าย CH รอบนั้น / วาปไม่ได้ก็เดินเข้าเมือง</div>
       <div class="bth-note">ไม่เลือก CH PvP (CH10) · เมนู Channel ของเกมแสดงจำนวนคนในแมพทางขวาของแต่ละแถว</div>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="bounty" hidden>
       <div class="bth-section-title"><small>DAILY</small><span>ค่าหัววันนี้</span></div>
       <label class="bth-inline" for="bthqabove"><span>เลเวลคุณ <b id="bthqlv">?</b></span><span>เผื่อเลเวล <input id="bthqabove" type="number" min="0" max="30" style="width:48px"></span></label>
       <div id="bthqlist" style="margin:2px 0;max-height:220px;overflow:auto"></div>
       <div id="bthqnote" style="color:#8fa2bb;font-size:11px"></div>
       <div style="display:flex;gap:7px;margin-top:2px"><button id="bthqgo" type="button" style="flex:2"></button><button id="bthqref" type="button" style="flex:1">↻ รีเฟรช</button></div>
       <div class="bth-note">Auto จะล่ามอนค่าหัวในทั้งแมพ เมื่อครบจะคืนค่าตั้งเดิมและกลับไปจุดฟาร์ม</div>
     </section>
   </div>
   </div>`;
  document.body.appendChild(box);
  const bthTabButtons = [...box.querySelectorAll('[data-bth-tab]')];
  const bthPages = [...box.querySelectorAll('[data-bth-page]')];
  let bqAll = [], bqPick = new Set(), bqLoaded = false;
  const selectBthTab = name => {
    for (const button of bthTabButtons) button.setAttribute('aria-selected', String(button.dataset.bthTab === name));
    for (const page of bthPages) { const active = page.dataset.bthPage === name; page.hidden = !active; page.classList.toggle('active', active); }
  };
  for (const button of bthTabButtons) button.onclick = () => {
    const tab = button.dataset.bthTab;
    selectBthTab(tab);
    if (tab === 'bounty') {
      if (!bqLoaded) { bqLoaded = true; refreshBq(); }
      else renderBq();
    }
  };
  selectBthTab('farm');
  // drag by the title bar (position kept), "−" collapses to the title bar
  const place = () => {
    const p = cfg.panel || DEF.panel;
    const x = Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, p.x)), y = Math.max(8, Math.min(innerHeight - box.offsetHeight - 8, p.y));
    box.style.left = x + 'px'; box.style.top = y + 'px';
    $('#bthbody').style.display = p.min ? 'none' : 'grid'; $('#bthmin').textContent = p.min ? '+' : '−';
    $('#bthmin').setAttribute('aria-label', p.min ? 'ขยายแผง' : 'ย่อแผง');
    $('#bthmin').title = p.min ? 'ขยายแผง' : 'ย่อแผง';
    showMini();
  };
  $('#bthbar').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = box.offsetLeft, oy = box.offsetTop;
    const move = ev => { cfg.panel = { ...(cfg.panel || DEF.panel), x: ox + ev.clientX - sx, y: oy + ev.clientY - sy }; place(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); save(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  // keep game input (click-to-move, hotkeys) from reacting to clicks / typing inside the panel
  for (const ev of ['pointerdown', 'mousedown', 'click', 'keydown', 'wheel']) box.addEventListener(ev, e => e.stopPropagation());
  $('#bthmin').onclick = () => { cfg.panel = { ...(cfg.panel || DEF.panel), min: !(cfg.panel || DEF.panel).min }; save(); place(); };
  addEventListener('resize', place);
  place();
  let stoppedLogged = false;
  const logs = [];
  function log(t) { logs.unshift(new Date().toLocaleTimeString() + ' ' + t); logs.length = Math.min(logs.length, 30); console.info('[Binder Helper]', t); }
  // minimized: the title bar shows the bag weight (refreshed every 2 s)
  function showMini() { const m = $('#bthmini'); if (m) m.textContent = (cfg.panel || {}).min ? `น้ำหนัก ${weightPct()}%` : ''; }
  const miniTimer = setInterval(showMini, 2000);

  // ---- monster pictures on the game's minimap (#minimap) and big map (#mmbigcv) instead of the red dots ----
  // The game draws each live mob as a red circle (fillStyle #e85a4a) in the order of state.mobs. We record those
  // circles per frame, fit tile -> canvas pixel from them, and draw the mob's own sprite on a canvas laid on top.
  const MOB_ICONS = false; // off for now: set true to turn the feature (and its switch on the farm tab) back on
  const MOB_DOT = '#e85a4a';
  const hooked = [];
  function hookMap(cv) {
    const ctx = cv && cv.getContext('2d');
    if (!ctx || ctx.__bthArc) return ctx;
    const arc = ctx.arc, clear = ctx.clearRect;
    ctx.__bthArc = arc; ctx.__bthClear = clear; ctx.__bthPts = []; ctx.__bthDraw = [];
    ctx.arc = function (x, y) { if (this.fillStyle === MOB_DOT) this.__bthDraw.push([x, y]); return arc.apply(this, arguments); };
    ctx.clearRect = function (x, y, w, h) { if (!x && !y && w === this.canvas.width) { this.__bthPts = this.__bthDraw; this.__bthDraw = []; } return clear.apply(this, arguments); };
    hooked.push(ctx);
    return ctx;
  }
  const unhookMaps = () => { for (const ctx of hooked.splice(0)) { ctx.arc = ctx.__bthArc; ctx.clearRect = ctx.__bthClear; delete ctx.__bthArc; } };
  // least squares px = a*x + b over pairs
  const fit = pairs => {
    const n = pairs.length; if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx; if (Math.abs(d) < 1e-6) return null;
    const a = (n * sxy - sx * sy) / d; return { a, b: (sy - a * sx) / n };
  };
  const sprites = new Map(); // mobType -> Image (null while loading / missing)
  function mobSprite(type) {
    if (sprites.has(type)) return sprites.get(type);
    sprites.set(type, null);
    const tries = [`sprites/mob/${type}/idle/0.png`, `sprites/mob/${type}/walk/0.png`];
    const img = new Image();
    img.onload = () => sprites.set(type, img);
    img.onerror = () => { const next = tries.shift(); if (next) img.src = next; };
    img.src = tries.shift();
    return null;
  }
  const overlays = new Map(); // game canvas -> our canvas
  function overlayFor(cv) {
    let o = overlays.get(cv);
    if (!o) { o = document.createElement('canvas'); o.className = 'bth-mobmap'; o.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483000'; document.body.appendChild(o); overlays.set(cv, o); }
    return o;
  }
  function drawMobIcons(cv, size) {
    const o = overlayFor(cv), r = room(), ctx = hookMap(cv);
    const rect = cv.getBoundingClientRect(), shown = cfg.mobIcons !== false && rect.width > 0 && cv.offsetParent !== null && r && r.state.mobs;
    o.style.display = shown ? '' : 'none';
    if (!shown || !ctx) return;
    const live = []; r.state.mobs.forEach(m => { if (m.state !== 'dead') live.push(m); });
    const pts = ctx.__bthPts.slice(0, live.length);
    const fx = fit(pts.map((p, i) => [live[i].x, p[0]])), fy = fit(pts.map((p, i) => [live[i].y, p[1]]));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    o.style.left = rect.left + 'px'; o.style.top = rect.top + 'px'; o.style.width = rect.width + 'px'; o.style.height = rect.height + 'px';
    const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
    const g = o.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (!fx || !fy) return;
    g.imageSmoothingEnabled = false;
    const kx = W / cv.width, ky = H / cv.height;
    for (const m of live) {
      const img = mobSprite(m.mobType); if (!img) continue;
      const boss = BOSS_IDS.has(m.mobType) || MINIBOSS_IDS.has(m.mobType), s = (boss ? size * 1.6 : size) * dpr;
      const x = (fx.a * m.x + fx.b) * kx, y = (fy.a * m.y + fy.b) * ky;
      if (boss) { g.beginPath(); g.arc(x, y, s * 0.55, 0, Math.PI * 2); g.fillStyle = 'rgba(255,210,122,.35)'; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#ffd27a'; g.stroke(); }
      g.drawImage(img, Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    }
  }
  const mobMapTimer = MOB_ICONS && setInterval(() => {
    try {
      const mm = $('#minimap'), big = $('#mmbigcv');
      if (mm) drawMobIcons(mm, 13);
      if (big) drawMobIcons(big, 24);
    } catch (e) { /* map not ready */ }
  }, 150);
  // ---- elites: purple skull on the game's minimap (#minimap) and big map (#mmbigcv) ----
  // Spawn points: the game moves each elite away from its layout rect (Ost: next to a cluster of normal mobs, 1-3 per
  // map), deterministically. ELITE_SPAWN was computed by running the game's own map builder (Co) on build 20261015
  // for every map: mapId -> { w, h, e: [[type, x, y], ...] } (tiles). Faded skull = spawn point; bright skull = the
  // live elite from the server's census (every mob on the current map, every ~2 s). Rebuild the table after a map update.
  const ELITE_SPAWN = {"southvale_field":{"w":81,"h":81,"e":[["elder_sprout",48,38]]},"whispering_woods":{"w":90,"h":90,"e":[["thicket_stag",52,49]]},"riverside":{"w":118,"h":73,"e":[["tide_brute",74,37]]},"old_quarry":{"w":76,"h":101,"e":[["brute",31,47],["quarry_brute",25,72]]},"ancient_ruins":{"w":98,"h":98,"e":[["remnant",69,36],["remnant",33,36],["remnant",33,53]]},"honeyrill":{"w":90,"h":81,"e":[["willow_brute",59,24]]},"bracken_sink":{"w":90,"h":90,"e":[["moss_brute",55,42]]},"verdigris_rise":{"w":81,"h":95,"e":[["copper_brute",42,68]]},"sunfield_plains":{"w":106,"h":81,"e":[["field_brute",72,48]]},"gloomroot_forest":{"w":90,"h":90,"e":[["corrupt_treant",68,26]]},"ember_hollow":{"w":95,"h":95,"e":[["cinder_brute",44,54]]},"mistmire_swamp":{"w":109,"h":76,"e":[["mire_elder",78,11]]},"duskgate_pass":{"w":73,"h":109,"e":[["dusk_remnant",47,49]]},"frostpeak_slopes":{"w":76,"h":106,"e":[["rime_brute",19,37]]},"frozen_mere":{"w":98,"h":98,"e":[["mere_lurker",62,56]]},"cloudspire_ruins":{"w":90,"h":90,"e":[["storm_remnant",50,39],["cloud_brute",60,53]]},"shattered_vale":{"w":95,"h":84,"e":[["vale_remnant",38,62],["shard_brute",36,34]]},"umbral_depths":{"w":87,"h":87,"e":[["umbral_horror",38,27]]},"throne_of_warden":{"w":70,"h":70,"e":[["throne_guard",46,38]]},"pitchwood":{"w":90,"h":90,"e":[["pitch_brute",32,33]]},"yellowlick_flats":{"w":98,"h":81,"e":[["salt_brute",44,57]]},"peatcut_bog":{"w":90,"h":87,"e":[["peat_elder",43,56]]},"sledrun_gully":{"w":73,"h":101,"e":[["gully_brute",31,10]]},"brinecrust_shoals":{"w":95,"h":87,"e":[["floe_brute",83,54]]},"kitewind_terraces":{"w":84,"h":95,"e":[["terrace_sentinel",55,46]]},"glasswrack":{"w":87,"h":81,"e":[["wrack_brute",34,15]]},"marrowdeep":{"w":81,"h":81,"e":[["marrow_horror",40,37]]},"rustbell_barracks":{"w":76,"h":76,"e":[["rust_captain",56,39]]}};
  const ELITE_LEVEL = {"elder_sprout":5,"thicket_stag":5,"tide_brute":13,"brute":15,"quarry_brute":17,"willow_brute":8,"moss_brute":15,"copper_brute":20,"pitch_brute":31,"salt_brute":37,"peat_elder":43,"gully_brute":54,"floe_brute":61,"terrace_sentinel":71,"wrack_brute":81,"marrow_horror":91,"rust_captain":99,"remnant":18,"field_brute":25,"corrupt_treant":31,"cinder_brute":37,"mire_elder":41,"dusk_remnant":44,"gate_brute":45,"rime_brute":53,"mere_lurker":59,"storm_remnant":67,"cloud_brute":71,"vale_remnant":80,"shard_brute":81,"umbral_horror":88,"depth_brute":91,"throne_guard":80,"golden_sentinel":67}; // elite mobType -> level
  let eliteLive = { map: '', list: [] };
  function onCensus(r, c) {
    const live = [];
    for (let i = 0; i + 4 < (c.m || []).length; i += 5) {
      const type = (c.t || [])[c.m[i + 2]];
      if (ELITE_LEVEL[type] !== undefined) live.push({ type, x: c.m[i], y: c.m[i + 1] });
    }
    eliteLive = { map: r.state.mapId, list: live };
  }
  const eliteOverlays = new Map(); // game canvas -> our canvas
  function drawSkull(g, x, y, s) {
    g.save(); g.translate(x, y);
    g.fillStyle = '#a855f7'; g.strokeStyle = 'rgba(20,6,32,.9)'; g.lineWidth = Math.max(1, s * 0.09);
    g.beginPath(); g.arc(0, -s * 0.08, s * 0.42, Math.PI * 0.85, Math.PI * 2.15); // cranium
    g.lineTo(s * 0.26, s * 0.42); g.lineTo(-s * 0.26, s * 0.42); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#1a0626';
    for (const ex of [-0.17, 0.17]) { g.beginPath(); g.arc(ex * s, -s * 0.06, s * 0.11, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(0, s * 0.1); g.lineTo(-s * 0.06, s * 0.2); g.lineTo(s * 0.06, s * 0.2); g.closePath(); g.fill();
    g.restore();
  }
  function drawElites(cv, size, big) {
    let o = eliteOverlays.get(cv);
    if (!o) { o = document.createElement('canvas'); o.className = 'bth-elitemap'; o.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483001'; document.body.appendChild(o); eliteOverlays.set(cv, o); }
    const r = room(), map = r && r.state.mapId, sp = map && ELITE_SPAWN[map], rect = cv.getBoundingClientRect();
    const live = eliteLive.map === map ? eliteLive.list : [];
    // spawn points whose elite is not alive nearby (the game keeps elites >= 18 tiles apart)
    const dead = sp ? sp.e.map(([type, x, y]) => ({ type, x, y })).filter(p => !live.some(e => e.type === p.type && Math.hypot(p.x - e.x, p.y - e.y) < 20)) : [];
    const shown = !!sp && rect.width > 0 && cv.offsetParent !== null;
    o.style.display = shown ? '' : 'none';
    if (!shown) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    o.style.left = rect.left + 'px'; o.style.top = rect.top + 'px'; o.style.width = rect.width + 'px'; o.style.height = rect.height + 'px';
    if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
    const g = o.getContext('2d'), kx = W / sp.w, ky = H / sp.h, s = size * dpr;
    g.clearRect(0, 0, W, H);
    const mark = (e, alive) => {
      const cx = (e.x + 0.5) * kx, cy = (e.y + 0.5) * ky;
      g.globalAlpha = alive ? 1 : 0.45; drawSkull(g, cx, cy, s); g.globalAlpha = 1;
      if (big) {
        g.font = `600 ${Math.round(10 * dpr)}px Kanit, sans-serif`; g.textAlign = 'center'; g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = alive ? '#e9d5ff' : '#b8a6cc';
        const t = `${e.type.replace(/_/g, ' ')} Lv${ELITE_LEVEL[e.type]}${alive ? '' : ' · จุดเกิด'}`;
        g.strokeText(t, cx, cy + s * 0.95); g.fillText(t, cx, cy + s * 0.95);
      }
    };
    for (const e of dead) mark(e, false);
    for (const e of live) mark(e, true);
  }
  const eliteTimer = setInterval(() => {
    try { const mm = $('#minimap'), bg = $('#mmbigcv'); if (mm) drawElites(mm, 11, false); if (bg) drawElites(bg, 20, true); } catch (e) { /* map not ready */ }
  }, 500);
  function miniPhaseText(t) {
    const farmWeight = t.match(/^ฟาร์ม\s*[·-]\s*น้ำหนัก\s*([^·]*)/);
    return farmWeight ? 'น้ำหนัก ' + farmWeight[1].trim() : t.slice(0, 24);
  }
  function setPhase(t) {
    phase = t;
    showMini();
    if (t === 'หยุดอยู่' && !stoppedLogged) { console.info('[Binder Helper]', t); stoppedLogged = true; }
    else if (t !== 'หยุดอยู่') stoppedLogged = false;
  }
  function render() {
    $('#bthmap').textContent = cfg.farmMap ? cfg.farmMap + (cfg.farmSpot ? ` (${cfg.farmSpot.x.toFixed(0)}, ${cfg.farmSpot.y.toFixed(0)})` : '') : '(ยังไม่ตั้ง)';
    $('#bthtown').value = TOWN_IDS[cfg.town] ? cfg.town : 'Ashford'; $('#bthpct').value = cfg.sellPct; $('#bthwait').value = cfg.deathWaitMs / 1000; $('#bthquiet').checked = !!cfg.quietCh; $('#bthlead').checked = !!cfg.followLeader; $('#bthlockch').checked = !!cfg.lockCh; $('#bthlockchnum').value = cfg.lockChNum; $('#bthlead').disabled = $('#bthquiet').disabled = !!cfg.lockCh; $('#bthboss').checked = !!cfg.bossHunt; $('#bthwb').checked = cfg.worldBoss !== false; $('#bthmobicon').checked = cfg.mobIcons !== false;
    $('#bthsalv').checked = !!cfg.salvOn; $('#bthsalvlv').value = cfg.salvBelow;
    for (const k of ['hp', 'mp']) { const b = (cfg.buy || {})[k] || {}; $(`#bth_${k}_item`).value = b.item; $(`#bth_${k}_min`).value = b.min || 0; $(`#bth_${k}_to`).value = b.to || 0; }
    $('#bthrun').textContent = cfg.running ? '■ หยุด' : '▶ เริ่ม';
    if (!cfg.running) setPhase('หยุดอยู่');
  }
  const remember = () => {
    if (TOWN_IDS[mapName()]) { log(`${mapName()} เป็นเมือง — ไปยืนที่จุดฟาร์มก่อนแล้วกด "จำจุดนี้"`); return; }
    cfg.farmMap = mapName(); cfg.farmSpot = myPos(); farmGen++; save(); render(); log(cfg.farmSpot ? `จำจุดฟาร์ม ${cfg.farmMap} (${cfg.farmSpot.x.toFixed(1)}, ${cfg.farmSpot.y.toFixed(1)})` : 'จำแมพแล้ว แต่ยังอ่านพิกัดไม่ได้ — ขยับตัวแล้วกดใหม่'); };
  // pick the farm spot on the game's big map: a tap there makes the game send moveTo {x, y} -> that is the new spot
  const bigMapOpen = () => { const m = $('#mmbig'); return !!m && !m.hidden; };
  let pickUntil = 0;
  const setPick = on => { pickUntil = on ? Date.now() + 60e3 : 0; $('#bthset').classList.toggle('pick', on); };
  // every kind of message sent to the server, logged the first time it shows up (with its content): to find what the
  // game sends when the character steps into a map exit, which the server needs before it changes the map
  const sentKinds = new Set();
  window.__bthSendHook = (type, msg) => {
    const kind = type + ':' + (msg && msg.type || '');
    // last walk target, for learning map exits (exitTimer)
    if (type === 'input' && msg && msg.type === 'moveTo') { const r = room(); lastMove = { map: r && r.state.mapId, x: +msg.x, y: +msg.y, at: Date.now() }; }
    if (!sentKinds.has(kind)) { sentKinds.add(kind); let j = ''; try { j = JSON.stringify(msg); } catch { } log(`ส่งถึงเซิร์ฟ (ครั้งแรก) ${kind} ${(j || '').slice(0, 160)}`); }
    if (!pickUntil || type !== 'input' || !msg || msg.type !== 'moveTo' || !bigMapOpen()) return;
    setPick(false);
    if (TOWN_IDS[mapName()]) { log(`${mapName()} เป็นเมือง — ไปแมพฟาร์มก่อนแล้วเลือกจุดใหม่`); return; }
    cfg.farmMap = mapName(); cfg.farmSpot = { x: +(+msg.x).toFixed(2), y: +(+msg.y).toFixed(2) }; farmGen++;
    log(`ตั้งจุดฟาร์ม ${cfg.farmMap} (${cfg.farmSpot.x.toFixed(1)}, ${cfg.farmSpot.y.toFixed(1)}) — เดินไปฟาร์ม`);
    cfg.running = true; startCheck = true; stoppedLogged = false; save(); render();
  };
  setInterval(() => { if (pickUntil && Date.now() > pickUntil) { setPick(false); log('ยกเลิกเลือกจุดฟาร์ม (เกิน 60 วิ)'); } }, 1000);
  $('#bthset').onclick = () => {
    if (pickUntil) { setPick(false); if (bigMapOpen()) click($('#mmbigx'), 'ปิดแผนที่ใหญ่'); log('ยกเลิกเลือกจุดฟาร์ม'); return; }
    if (TOWN_IDS[mapName()]) { log(`${mapName()} เป็นเมือง — ไปแมพฟาร์มก่อนแล้วเลือกจุด`); return; }
    setPick(true);
    if (!bigMapOpen()) { const mm = $('#minimap'); if (mm) mm.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 })); }
    log('แตะจุดบนแผนที่ใหญ่ที่จะฟาร์ม');
  };
  $('#bthtown').onchange = e => { cfg.town = e.target.value; save(); log('เมืองขาย: ' + cfg.town); };
  $('#bthpct').onchange = e => { cfg.sellPct = Math.max(10, Math.min(100, +e.target.value || 95)); save(); };
  $('#bthwait').onchange = e => { cfg.deathWaitMs = Math.max(0, +e.target.value || 0) * 1000; save(); };
  $('#bthsalv').onchange = e => { cfg.salvOn = e.target.checked; save(); log(cfg.salvOn ? `เปิดแยกชิ้น Normal / Magic เลเวลต่ำกว่า ${cfg.salvBelow}` : 'ปิดแยกชิ้น'); };
  $('#bthsalvlv').onchange = e => { cfg.salvBelow = Math.max(2, Math.min(99, Math.round(+e.target.value) || 30)); e.target.value = cfg.salvBelow; save(); };
  $('#bthquiet').onchange = e => { if (cfg.lockCh) { e.target.checked = !!cfg.quietCh; return; } cfg.quietCh = e.target.checked; save(); };
  $('#bthlead').onchange = e => { if (cfg.lockCh) { e.target.checked = !!cfg.followLeader; return; } cfg.followLeader = e.target.checked; save(); };
  $('#bthlockch').onchange = e => { cfg.lockCh = e.target.checked; save(); $('#bthlead').disabled = $('#bthquiet').disabled = cfg.lockCh; log(cfg.lockCh ? `ล็อก CH${cfg.lockChNum} · ปิดการย้าย CH อัตโนมัติ` : 'ปลดล็อก CH'); };
  $('#bthlockchnum').onchange = e => { cfg.lockChNum = Math.max(1, Math.min(99, Math.round(+e.target.value) || 1)); e.target.value = cfg.lockChNum; save(); if (cfg.lockCh) log(`ล็อก CH${cfg.lockChNum}`); };
  $('#bthlockchcur').onclick = () => { const ch = chOf(room()); if (!ch) return; $('#bthlockchnum').value = ch; $('#bthlockchnum').onchange({ target: $('#bthlockchnum') }); };
  $('#bthboss').onchange = e => { cfg.bossHunt = e.target.checked; save(); };
  $('#bthwb').onchange = e => { cfg.worldBoss = e.target.checked; save(); };
  if (!MOB_ICONS) $('#bthmobiconrow').style.display = 'none';
  $('#bthmobicon').onchange = e => { cfg.mobIcons = e.target.checked; save(); };
  for (const k of ['hp', 'mp']) {
    const upd = () => {
      const min = Math.max(0, +$(`#bth_${k}_min`).value || 0), to = Math.max(min, +$(`#bth_${k}_to`).value || 0);
      cfg.buy = { ...(cfg.buy || {}), [k]: { item: $(`#bth_${k}_item`).value, min, to } }; save();
      $(`#bth_${k}_to`).value = to;
    };
    for (const f of ['item', 'min', 'to']) $(`#bth_${k}_${f}`).onchange = upd;
  }
  $('#bthrun').onclick = () => {
    // first start: remember where we stand (never a town); later starts keep the saved spot
    if (!cfg.running && (!cfg.farmMap || (!cfg.farmSpot && mapName() === cfg.farmMap))) remember();
    if (!cfg.running && !cfg.farmMap) return;
    cfg.running = !cfg.running; startCheck = cfg.running; if (cfg.running) stoppedLogged = false; save(); render(); log(cfg.running ? 'เริ่ม' : 'หยุด');
  };

  const reachable = b => !b.claimed && b.lo <= myLevel() + (+bq.maxAbove || 0);
  function renderBq() {
    $('#bthqlv').textContent = myLevel() || '?';
    $('#bthqabove').value = bq.maxAbove;
    const cur = curBounty();
    if (bq.active) {
      $('#bthqlist').innerHTML = bq.list.map((b, i) => `<div style="padding:3px 0;${i === bq.i ? 'color:#ffd27a;font-weight:600' : b.claimed ? 'color:#9fd0ff' : ''}">${i < bq.i || b.claimed ? '✓' : i === bq.i ? '▶' : '·'} ${b.mob} ${b.prog}/${b.need} <small style="color:#8fa2bb">${b.mapName}</small></div>`).join('');
      $('#bthqnote').textContent = cur ? `กำลังทำ ${cur.mob} ที่ ${cur.mapName}` : '';
      $('#bthqgo').textContent = '■ หยุดค่าหัว';
      return;
    }
    const show = bqAll.filter(reachable), hidden = bqAll.filter(b => !reachable(b));
    $('#bthqlist').innerHTML = show.length ? show.map(b => `<label style="display:block;padding:3px 0"><input type="checkbox" data-bq="${b.id}" ${bqPick.has(b.id) ? 'checked' : ''}> <b>${b.mob}</b> ${b.prog}/${b.need} <small style="color:#8fa2bb">${b.mapName} · Lv ${b.lo}–${b.hi}</small></label>`).join('')
      : '<div style="color:#8fa2bb">ไม่มีค่าหัวที่ไปได้ (กด ↻ รีเฟรช)</div>';
    $('#bthqnote').textContent = hidden.length ? `ซ่อน ${hidden.length} ตัว: ${hidden.map(b => b.claimed ? b.mob + ' (รับแล้ว)' : `${b.mob} (Lv ${b.lo}+)`).join(', ')}` : '';
    $('#bthqgo').textContent = '▶ เริ่มล่าค่าหัว';
    for (const c of document.querySelectorAll('#bthqlist [data-bq]')) c.onchange = e => { e.target.checked ? bqPick.add(e.target.dataset.bq) : bqPick.delete(e.target.dataset.bq); };
  }
  async function refreshBq() {
    $('#bthqnote').textContent = 'กำลังอ่านค่าหัว…';
    bqAll = await readBounties();
    bqPick = new Set(bqAll.filter(reachable).map(b => b.id));
    renderBq();
  }
  $('#bthqref').onclick = () => { if (!bq.active) refreshBq(); else renderBq(); };
  $('#bthqabove').onchange = e => { bq.maxAbove = Math.max(0, +e.target.value || 0); saveBq(); if (!bq.active) { bqPick = new Set(bqAll.filter(reachable).map(b => b.id)); renderBq(); } };
  $('#bthqgo').onclick = () => {
    if (bq.active) { // stop: put AUTO back on the next tick and go home
      bq.list = bq.list.slice(0, bq.i); bq.i = bq.list.length; saveBq(); log('หยุดค่าหัว — คืนค่า Auto แล้วกลับแมพปกติ'); renderBq(); return;
    }
    const list = bqAll.filter(b => bqPick.has(b.id) && reachable(b));
    if (!list.length) { $('#bthqnote').textContent = 'ยังไม่ได้เลือกค่าหัว'; return; }
    if (!cfg.farmMap) log('ยังไม่ได้ตั้งแมพฟาร์มปกติ — ทำค่าหัวเสร็จแล้ว helper จะหยุด');
    Object.assign(bq, { active: true, list, i: 0, toggled: [], farmRBefore: null, setup: false }); saveBq();
    log(`เริ่มค่าหัว ${list.length} ตัว: ${list.map(b => b.mob).join(', ')}`);
    if (!cfg.running) { cfg.running = true; startCheck = false; save(); render(); }
    renderBq();
  };
  render();
  const timer = setInterval(tick, 1000);
  setTimeout(() => log(onWorker() ? 'ตัวจับเวลาทำงานเต็มความเร็วแม้พับหน้าต่าง' : 'ตัวจับเวลาแบบปกติ — พับหน้าต่างแล้วจะช้าลง'), 2000);
  // Farm tab: World Boss round as the server last told it
  const showWbInfo = () => {
    const el = $('#bthwbinfo'); if (!el) return;
    const v = wb.view, now = Date.now();
    const at = t => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const t = !v ? 'World Boss: ยังไม่มีข้อมูล (รู้เมื่อเปลี่ยนแมพ หรือเมื่อรอบเริ่ม)'
      : v.state === 'live' ? `World Boss เกิดแล้ว · เหลือ ${wbLeft(v.endsAt - now)} · HP ${v.frac != null ? (v.frac * 100).toFixed(1) + '%' : '?'}${v.id === wb.doneId ? ' · รอบนี้ตีแล้ว' : ''}`
      : v.state === 'idle' && v.startAt > now ? `World Boss รอบถัดไป ${at(v.startAt)} น. (อีก ${wbLeft(v.startAt - now)})`
      : v.nextAt ? `World Boss ${v.state === 'dead' ? 'ถูกปราบแล้ว' : 'จากไปแล้ว'} · กลับมา ${at(v.nextAt)} น.` : `World Boss: ${v.state}`;
    if (el.textContent !== t) el.textContent = t;
  };
  // Channel tab: current channel and what the last channel pick decided
  const showChInfo = () => {
    const el = $('#bthchinfo'); if (!el) return;
    const ch = chOf(room());
    const next = !cfg.running ? 'helper หยุดอยู่' : cfg.lockCh ? `ล็อก CH${cfg.lockChNum}` : !(cfg.quietCh || cfg.followLeader) ? 'ปิดการเลือก CH' : 'เลือก CH ตอนเข้าแมพฟาร์ม';
    const html = `<b>CH ${ch || '?'}</b> · ${next}${chLast ? `<br><small>ล่าสุด: ${chLast}</small>` : ''}`;
    if (el.innerHTML !== html) el.innerHTML = html;
  };
  const chInfoTimer = setInterval(() => { showChInfo(); showWbInfo(); }, 1000);

  // ---- kicked for idling: the game's window "หลุดจากเกม · ไม่ได้เล่นนานเกินไป" (close code 4007) ----
  // its button "เชื่อมต่อใหม่" reloads the page (the manager loads the helper again once back in the world and that
  // helper turns ▶ / AUTO on again from the note below) or reconnects in place (this helper turns it on again itself).
  // Other kicks (playing in another tab, staff) are left alone.
  const RESUME_KEY = 'bth_resume', ALIVE_KEY = 'bth_alive';
  let lastAuto = false, kickAt = 0, alive = true;
  // ▶ again if a farm spot is saved, else AUTO again
  const resume = why => {
    if (!alive) return;
    if (cfg.farmMap) { if (!cfg.running) $('#bthrun').click(); log(why + ' — เปิด helper ต่อ'); }
    else { setAuto(true); log(why + ' — เปิด AUTO ต่อ (ยังไม่ได้ตั้งจุดฟาร์ม)'); }
  };
  const kickTimer = setInterval(() => {
    if (cfg.running) try { localStorage.setItem(ALIVE_KEY, String(Date.now())); } catch { }
    const title = [...document.querySelectorAll('.wbveil .cwtitle')].find(e => /ไม่ได้เล่นนานเกินไป/.test(e.textContent));
    if (!title) {
      // the game reconnected in place (no page reload, so this helper is still here): turn it on again ourselves
      if (kickAt && mapName() && Date.now() - kickAt > 8e3) { kickAt = 0; try { localStorage.removeItem(RESUME_KEY); } catch { } setTimeout(() => resume('เชื่อมต่อใหม่แล้ว'), 3000); }
      else if (!kickAt) lastAuto = autoOn();
      return;
    }
    if (Date.now() - kickAt < 15e3) return; // reload already under way
    kickAt = Date.now();
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({ at: kickAt, running: cfg.running, auto: lastAuto })); } catch { }
    log('หลุดจากเกม (ไม่ได้เล่นนานเกินไป) — เชื่อมต่อใหม่แล้วเปิด helper ต่อ');
    cfg.running = false; // not saved: ends a trip in progress on the dead room
    const card = title.closest('.bcard'), btn = card && card.querySelector('.bcact button');
    if (!click(btn, 'เชื่อมต่อใหม่') && typeof window.__hardReload === 'function') window.__hardReload();
  }, 2000);
  // just reloaded after such a kick (note younger than 10 min): always ▶ (default on), or AUTO if no farm spot is saved yet.
  // Same after any other reload (game update, connection lost, the manager reloading the tab) while ▶ was on a moment ago.
  (() => {
    let r = null, at = 0;
    try { r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); localStorage.removeItem(RESUME_KEY); at = +localStorage.getItem(ALIVE_KEY) || 0; } catch { }
    const kicked = !!r && Date.now() - r.at < 10 * 60e3, reloaded = wasRunning && Date.now() - at < 10 * 60e3;
    if (kicked || reloaded) setTimeout(() => resume(kicked ? 'เชื่อมต่อใหม่แล้ว' : 'หน้าเกมโหลดใหม่'), 3000);
  })();

  window.__bth = {
    cfg, show: () => { box.style.display = 'block'; }, stop: () => { cfg.running = false; save(); render(); },
    remove: () => { cfg.running = false; clearInterval(timer); clearInterval(miniTimer); clearInterval(mobMapTimer); unhookMaps(); for (const o of overlays.values()) o.remove(); box.remove(); uiStyle.remove(); clearInterval(combatTimer); clearInterval(chInfoTimer); clearInterval(eliteTimer); clearInterval(kickTimer); clearInterval(exitTimer); stopTimers(); alive = false; for (const o of eliteOverlays.values()) o.remove(); chObs.disconnect(); document.querySelectorAll('#chmenu .bthcnt').forEach(e => e.remove()); delete window.__bthSendHook; delete window.__bthOnServer; delete window.__bth; }, // running=false also ends a trip in progress
    toggle: () => $('#bthrun').click(), // same as pressing ▶ / ■ on the panel
    // read by the web manager (manager/server.js)
    status: () => {
      const b = curBounty(), r = room();
      return {
        running: cfg.running, phase, map: mapName(), channel: chOf(r), level: myLevel(), weight: weightPct(), auto: autoOn(), dead: isDead(),
        farmMap: cfg.farmMap, farmSpot: cfg.farmSpot, town: cfg.town,
        potions: potionPlans().map(p => ({ k: p.k, name: potName(p.item), have: p.have, min: p.min, to: p.to })),
        bounty: bq.active ? { done: bq.i, total: bq.list.length, mob: b && b.mob, map: b && b.mapName, prog: b && b.prog, need: b && b.need } : null,
        log: logs.slice(0, 30), // the manager copies new lines to server.log every 3 s: 8 lost bursts
      };
    },
  };
  return 'helper loaded';
})();
