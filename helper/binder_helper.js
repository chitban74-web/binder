// Binder Town helper — runs inside the game page, on top of the game's own AUTO.
//  • bag full (weight >= sellPct or no free slot) → AUTO off → warp to town (500 G; walk if it can't) → sell by your sell filter
//                                                → back to farm map → walk to the saved spot → AUTO on
//  • died → wait deathWaitMs → respawn in town → (sell if weight >= sellAfterDeathPct) → back to farm map → saved spot → AUTO on
//  • potion on the belt below its minimum → town → walk to the merchant → buy up to the target (vendorBuy, max 99 each)
//  • on ▶ and on every return to the farm map: the party leader's channel if the leader is on this map,
//    else the safe channel with the fewest players (never PvP CH10)
//  • bounty window (🎯 ค่าหัว): today's bounties you can reach → each one: its map, AUTO targets = that mob only,
//    farm area = whole map, claim when done → next; at the end AUTO settings go back and you return to the farm spot
//  • boss / mini-boss alive on the farm map → AUTO off → walk to it → AUTO on next to it (its target chip on) → dies → back to the farm spot
// It presses the game's own buttons (warp, world map "go", respawn, sell, AUTO). The messages it sends itself go
// through the game's own Colyseus room and are the ones the game's UI sends: moveTo, channelQuery, switchChannel,
// socialQuery, vendorBuy, huntQuery, bountyClaim.
(() => {
  if (window.__bth) { window.__bth.show(); return 'already running'; }
  const KEY = 'bth_cfg';
  const DEF = {
    farmMap: '', farmSpot: null, town: '', sellPct: 95, sellAfterDeathPct: 40, deathWaitMs: 3000,
    quietCh: true, followLeader: true, bossHunt: true,
    // potions: below `min` (0 = off) -> trip to town; in town always top up to `to`
    buy: { hp: { item: 'hi_potion', min: 50, to: 200 }, mp: { item: 'mana_potion', min: 30, to: 150 } },
    panel: { x: 8, y: 120, min: false }, running: false,
  };
  const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { } };
  const cfg = load();
  cfg.running = false; // always start stopped; the user presses ▶

  // ---- reading the game UI ----
  const $ = s => document.querySelector(s);
  const visible = e => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const mapName = () => (($('#mapname') || {}).textContent || '').trim();
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
      if (RP && !RP.__bthSend) { const orig = RP.send; RP.__bthSend = orig; RP.send = function () { window.__bthRoom = this; return orig.apply(this, arguments); }; }
    } catch (e) { console.warn('bth: room hook failed', e); }
  })();
  const room = () => { const r = window.__bthRoom; return r && r.state && r.connection && r.connection.isOpen !== false ? r : null; };
  const myPos = () => { const r = room(); const p = r && r.state.players && r.state.players.get(r.sessionId); return p ? { x: +p.x.toFixed(2), y: +p.y.toFixed(2) } : null; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // walk back to the saved farm spot (server-side pathing, same message as click-to-move)
  async function walkToSpot(spot) {
    if (!spot) return true;
    const deadline = Date.now() + 90e3;
    let lastSend = 0, last = myPos(), lastMoveAt = Date.now();
    while (Date.now() < deadline && cfg.running) {
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
  async function leaderChannel(r) {
    const party = await queryParty();
    if (party === undefined) { log('อ่านข้อมูลตี้ไม่ได้'); return 0; }
    if (!party) return 0;
    if (party.leaderId === r.sessionId) { log('เราเป็นหัวตี้ → ใช้ CH คนน้อยสุด'); return 0; }
    const L = (party.members || []).find(m => m.id === party.leaderId);
    if (!L || !L.online) { log('หัวตี้ออฟไลน์ → ใช้ CH คนน้อยสุด'); return 0; }
    if (L.mapId !== r.state.mapId) { log(`หัวตี้อยู่แมพอื่น (${L.mapId}) → ใช้ CH คนน้อยสุด`); return 0; }
    if (L.channel === PVP_CH) { log('หัวตี้อยู่ CH PvP → ไม่ตาม ใช้ CH คนน้อยสุด'); return 0; }
    return L.channel || 0;
  }
  async function switchTo(r, cur, ch, lock, why) {
    if (lock && lock.ms > 0) { log(`รอ ${Math.ceil(lock.ms / 1000)} วิ (ล็อกเพราะ ${lock.why})`); await sleep(lock.ms + 500); }
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
  async function moveToQuietChannel() {
    if (!cfg.quietCh && !cfg.followLeader) return;
    const r = room(); const cur = chOf(r); if (!r || !cur) return;
    const info = await queryChannels();
    if (cfg.followLeader) {
      const lc = await leaderChannel(r);
      if (lc) {
        if (lc === cur) { log(`อยู่ CH เดียวกับหัวตี้แล้ว (CH${cur})`); return; }
        await switchTo(r, cur, lc, info && info.lock, 'ตามหัวตี้'); return;
      }
    }
    if (!cfg.quietCh) return;
    if (!info) { log('อ่านจำนวนคนแต่ละ CH ไม่ได้ — อยู่ CH เดิม'); return; }
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
    if (!best || best === cur || (cur !== PVP_CH && others(best) >= others(cur))) { log(`CH${cur} คนน้อยสุดแล้ว (${others(cur)} คน)`); return; }
    await switchTo(r, cur, best, info.lock, `คนน้อยสุด: ${others(cur)} → ${others(best)} คน`);
  }

  // where to farm right now: the bounty's map (whole map) while a bounty runs, else the saved farm map + spot
  async function backToFarm(t = tgt()) {
    if (!t.map) return false;
    setPhase('กลับไปฟาร์ม ' + t.map);
    if (!await travelTo(t.map)) return false;
    await sleep(1500);
    setAuto(false);
    if (cfg.quietCh || cfg.followLeader) { setPhase('เลือก CH'); await moveToQuietChannel(); }
    if (t.spot) { setPhase('เดินไปจุดฟาร์ม'); await walkToSpot(t.spot); await sleep(500); }
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
  const myLevel = () => { const r = room(); const p = r && r.state.players.get(r.sessionId); return p ? p.level : 0; };
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

  async function travelTo(name) {
    if (mapName() === name) return true;
    const deadline = Date.now() + 6 * 60e3;
    let lastGo = 0, lastMap = mapName(), lastMapAt = Date.now();
    while (Date.now() < deadline && cfg.running) {
      if (isDead()) return false;
      if (mapName() === name) return true;
      if (mapName() !== lastMap) { lastMap = mapName(); lastMapAt = Date.now(); }
      // game asks "วาร์ปไป <town> แล้วเดินต่อ?" when a nearer town has a warp point -> warp, then it walks on by itself
      if (dialogOpen() && /วาร์ป/.test(dialogTitle())) { click($('#bcyes'), 'วาร์ปแล้วเดินต่อ'); lastGo = lastMapAt = Date.now(); await sleep(2000); continue; }
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
  // top every potion plan up to its `to` (NPC sells max 99 per purchase; same message as the shop's buy button)
  async function buyPotions() {
    for (const p of potionPlans()) {
      if (p.have === null) { log(`${potName(p.item)} ไม่ได้อยู่ในช่องยา — ใส่ไว้ในช่อง Q/E ก่อน helper ถึงนับได้`); continue; }
      let need = (p.to || 0) - p.have, got = 0;
      while (need > 0 && cfg.running) {
        const q = Math.min(99, need);
        const res = await request({ type: 'vendorBuy', itemId: p.item, qty: q }, m => m.type === 'bought' && m.itemId === p.item, 5000);
        if (!res || !res.ok) { log(`ซื้อ ${potName(p.item)} ไม่ได้: ${res ? res.reason || 'ไม่ทราบสาเหตุ' : 'ไม่มีคำตอบ'}`); break; }
        got += res.qty || q; need -= res.qty || q;
        await sleep(400);
      }
      if (got) log(`ซื้อ ${potName(p.item)} ×${got} (มี ${beltCount(p.item)})`);
    }
  }
  // one trip: town -> shop -> (sell) -> top up potions
  async function townTrip(why, sell) {
    setPhase(why); setAuto(false); await sleep(800);
    const town = cfg.town || 'Ashford';
    if (!TOWN_IDS[mapName()] && !(await warpToTown(town) || await travelTo(town))) { log('ไปเมืองไม่ได้'); return false; }
    setPhase('ที่ร้านค้า ' + mapName());
    if (!await openShop()) return false;
    if (sell) await sellAll();
    await buyPotions();
    closeShop();
    return true;
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
      } else if (bagFull()) {
        await townTrip(`ของเต็ม (น้ำหนัก ${weightPct()}%${slotsFull() ? ' / ช่องเต็ม' : ''}) — กลับเมือง`, true);
        // still full after selling (sell filter keeps the rest) -> stop instead of warping again and again
        if (bagFull()) return stopWith('ขายแล้วของยังเต็ม', `ขายแล้วยังเต็ม (${weightPct()}%) — หยุด helper: ติ๊กหมวดขายเพิ่ม หรือฝาก Bank`);
        await backToFarm();
      } else if (mapName() === tgt().map && lowPotions().length) {
        const low = lowPotions().map(p => `${potName(p.item)} ${p.have}/${p.min}`).join(', ');
        await townTrip(`ยาใกล้หมด (${low}) — กลับเมืองซื้อ`, weightPct() >= cfg.sellAfterDeathPct);
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
        if (cfg.quietCh || cfg.followLeader) { setPhase('เลือก CH'); await moveToQuietChannel(); }
        setPhase('เดินไปจุดฟาร์ม'); await walkToSpot(cfg.farmSpot); await sleep(500);
        setAuto(true);
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
    .bth-note { color:#8fa2bb; font-size:10.5px; }
    #bthqnote { padding:7px 9px; border:1px solid rgba(255,210,122,.25); border-radius:6px; background:rgba(255,210,122,.07); color:#ffd27a!important; }
    #bthqlist { max-height:min(38vh,300px)!important; overflow:auto; scrollbar-width:thin; scrollbar-color:rgba(143,162,187,.4) transparent; }
    #bthqlist > div, #bthqlist label { padding:6px 8px!important; margin-bottom:3px; border-radius:6px; background:linear-gradient(90deg,rgba(90,140,255,.32),rgba(90,140,255,.08)); }
    #bthbar button { flex:none; width:24px; height:24px; min-height:24px; padding:0!important; border:1px solid rgba(255,255,255,.2)!important; border-radius:6px!important; background:rgba(42,53,80,.8)!important; color:#fff!important; font:600 12px/1 Kanit,system-ui,sans-serif!important; }
    #bthbar button:hover { background:rgba(62,78,115,.95)!important; }
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
       <div class="bth-map"><b id="bthmap"></b><button id="bthset" type="button">⌖ จำจุดนี้</button></div>
       <label class="bth-inline" for="bthwait"><span>รอก่อนกลับมาเกิด</span><span><input id="bthwait" type="number" min="0" max="60"> วินาที</span></label>
       <label class="bth-switch"><input id="bthboss" type="checkbox"><span class="bth-switch-ui"></span><span>เจอ Boss / Mini-boss ในแมพ ไปตีก่อน</span></label>
       <button id="bthrun" type="button" style="width:100%"></button>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="return" hidden>
       <div class="bth-section-title"><small>RETURN</small><span>กลับเมืองและจัดกระเป๋า</span></div>
       <label class="bth-field" for="bthtown"><span>เมืองที่จะกลับไป</span><select id="bthtown">${Object.keys(TOWN_IDS).map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
       <label class="bth-inline" for="bthpct"><span>ขายของเมื่อน้ำหนักถึง</span><span><input id="bthpct" type="number" min="10" max="100"> %</span></label>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="supply" hidden>
       <div class="bth-section-title"><small>SUPPLY</small><span>เติมยาอัตโนมัติ</span></div>
       <div class="bth-potions">${['hp', 'mp'].map(k => `<div class="bth-potion"><div class="bth-potion-title">${k === 'hp' ? '♥ ยา HP' : '✦ ยา MP'}</div><select id="bth_${k}_item">${Object.entries(POTIONS[k]).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select><div class="bth-potion-grid"><label>ซื้อเมื่อ<input id="bth_${k}_min" type="number" min="0" max="9999"></label><label>เติมถึง<input id="bth_${k}_to" type="number" min="0" max="9999"></label></div></div>`).join('')}</div>
       <div class="bth-note">ตั้งค่า 0 เพื่อปิด · ยาต้องอยู่ในช่อง Q/E</div>
     </section>
     <section class="bth-section bth-page" role="tabpanel" data-bth-page="travel" hidden>
       <div class="bth-section-title"><small>TRAVEL</small><span>การเลือก Channel</span></div>
       <label class="bth-switch"><input id="bthlead" type="checkbox"><span class="bth-switch-ui"></span><span>ตาม Channel ของหัวตี้ก่อน</span></label>
       <label class="bth-switch"><input id="bthquiet" type="checkbox"><span class="bth-switch-ui"></span><span>ถ้าไม่เจอ ให้เลือก Channel คนน้อยสุด</span></label>
       <div class="bth-note">ระบบจะไม่เลือก Channel PvP</div>
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
    $('#bthtown').value = TOWN_IDS[cfg.town] ? cfg.town : 'Ashford'; $('#bthpct').value = cfg.sellPct; $('#bthwait').value = cfg.deathWaitMs / 1000; $('#bthquiet').checked = !!cfg.quietCh; $('#bthlead').checked = !!cfg.followLeader; $('#bthboss').checked = !!cfg.bossHunt;
    for (const k of ['hp', 'mp']) { const b = (cfg.buy || {})[k] || {}; $(`#bth_${k}_item`).value = b.item; $(`#bth_${k}_min`).value = b.min || 0; $(`#bth_${k}_to`).value = b.to || 0; }
    $('#bthrun').textContent = cfg.running ? '■ หยุด' : '▶ เริ่ม';
    if (!cfg.running) setPhase('หยุดอยู่');
  }
  const remember = () => {
    if (TOWN_IDS[mapName()]) { log(`${mapName()} เป็นเมือง — ไปยืนที่จุดฟาร์มก่อนแล้วกด "จำจุดนี้"`); return; }
    cfg.farmMap = mapName(); cfg.farmSpot = myPos(); save(); render(); log(cfg.farmSpot ? `จำจุดฟาร์ม ${cfg.farmMap} (${cfg.farmSpot.x.toFixed(1)}, ${cfg.farmSpot.y.toFixed(1)})` : 'จำแมพแล้ว แต่ยังอ่านพิกัดไม่ได้ — ขยับตัวแล้วกดใหม่'); };
  $('#bthset').onclick = remember;
  $('#bthtown').onchange = e => { cfg.town = e.target.value; save(); log('เมืองขาย: ' + cfg.town); };
  $('#bthpct').onchange = e => { cfg.sellPct = Math.max(10, Math.min(100, +e.target.value || 95)); save(); };
  $('#bthwait').onchange = e => { cfg.deathWaitMs = Math.max(0, +e.target.value || 0) * 1000; save(); };
  $('#bthquiet').onchange = e => { cfg.quietCh = e.target.checked; save(); };
  $('#bthlead').onchange = e => { cfg.followLeader = e.target.checked; save(); };
  $('#bthboss').onchange = e => { cfg.bossHunt = e.target.checked; save(); };
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
  window.__bth = {
    cfg, show: () => { box.style.display = 'block'; }, stop: () => { cfg.running = false; save(); render(); },
    remove: () => { cfg.running = false; clearInterval(timer); clearInterval(miniTimer); box.remove(); uiStyle.remove(); delete window.__bth; }, // running=false also ends a trip in progress
    toggle: () => $('#bthrun').click(), // same as pressing ▶ / ■ on the panel
    // read by the web manager (manager/server.js)
    status: () => {
      const b = curBounty(), r = room();
      return {
        running: cfg.running, phase, map: mapName(), channel: chOf(r), level: myLevel(), weight: weightPct(), auto: autoOn(), dead: isDead(),
        farmMap: cfg.farmMap, farmSpot: cfg.farmSpot, town: cfg.town,
        potions: potionPlans().map(p => ({ k: p.k, name: potName(p.item), have: p.have, min: p.min, to: p.to })),
        bounty: bq.active ? { done: bq.i, total: bq.list.length, mob: b && b.mob, map: b && b.mapName, prog: b && b.prog, need: b && b.need } : null,
        log: logs.slice(0, 8),
      };
    },
  };
  return 'helper loaded';
})();
