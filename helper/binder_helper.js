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
  const mobAlive = m => !!m && m.state !== 'dead' && m.state !== 'return' && m.hp > 0 && !m.ownerId;
  const getMob = key => { const r = room(); const m = r && r.state.mobs && r.state.mobs.get(key); return mobAlive(m) ? m : null; };
  function findBoss() {
    const r = room(), me = myPos(); if (!r || !r.state.mobs || !me) return null;
    let best = null;
    r.state.mobs.forEach((m, key) => {
      if (!mobAlive(m) || !(BOSS_IDS.has(m.mobType) || MINIBOSS_IDS.has(m.mobType)) || (bossSkip.get(key) || 0) > Date.now()) return;
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
  async function walkToMob(key, near) {
    const deadline = Date.now() + 120e3;
    let lastSend = 0;
    while (Date.now() < deadline && cfg.running && !isDead()) {
      const m = getMob(key), p = myPos(), r = room();
      if (!m) return false;
      if (p && dist(p, m) <= near) return true;
      if (r && Date.now() - lastSend > 2500) { lastSend = Date.now(); r.send('input', { type: 'moveTo', x: m.x, y: m.y }); }
      await sleep(500);
    }
    return false;
  }
  async function fightBoss(b) {
    const label = `${b.boss ? 'Boss' : 'Mini-boss'} ${b.type}`;
    log(`เจอ ${label} ห่าง ${b.d.toFixed(0)} ช่อง — หยุดฟาร์มไปตีก่อน`);
    setPhase('ไปตี ' + label);
    setAuto(false); await sleep(500);
    const toggled = await allowInAuto(b.type);
    const deadline = Date.now() + 10 * 60e3;
    let killed = false;
    while (Date.now() < deadline && cfg.running && !isDead()) {
      if (!getMob(b.key)) { killed = true; break; }
      const p = myPos(), m = getMob(b.key);
      // AUTO only fights inside its area around where it was switched on -> (re)start it next to the boss
      if (!autoOn() || (p && m && dist(p, m) > 10)) {
        setAuto(false);
        if (!await walkToMob(b.key, 4)) { killed = !getMob(b.key); break; }
        setAuto(true);
      }
      setPhase(`ตี ${label} · HP ${m ? Math.round(m.hp) : 0}`);
      await sleep(1000);
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
    setAuto(true);
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

  // ---- small panel (same look as the web manager / Pelican Manager: dark navy glass, sky-blue accent) ----
  const css = document.createElement('style');
  css.id = 'bthcss';
  css.textContent = `
  .bthw { position: fixed; z-index: 99999; width: 268px; color: #eef3fc; font: 12.5px/1.45 'Plus Jakarta Sans', 'IBM Plex Sans Thai', Kanit, 'Segoe UI', sans-serif;
    background: rgba(10, 16, 32, .95); border: 1px solid rgba(148, 163, 184, .22); border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, .5); backdrop-filter: blur(12px); overflow: hidden; }
  .bthw * { box-sizing: border-box; font-family: inherit; letter-spacing: normal; text-transform: none; }
  .bthw .hd { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; cursor: move; user-select: none; touch-action: none; background: rgba(14, 165, 233, .08); border-bottom: 1px solid rgba(148, 163, 184, .14); }
  .bthw .hd b { font-size: 13px; font-weight: 800; white-space: nowrap; }
  .bthw .dot { width: 8px; height: 8px; border-radius: 50%; background: #5d6983; flex: none; }
  .bthw.on .dot { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, .2); }
  .bthw .mini { flex: 1; min-width: 0; color: #8d9ab5; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bthw .hb { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: #8d9ab5; cursor: pointer; font-size: 14px; line-height: 1; text-decoration: none; }
  .bthw .hb:hover { background: rgba(148, 163, 184, .16); color: #eef3fc; }
  .bthw .bd { padding: 10px 12px 12px; display: grid; gap: 10px; max-height: calc(100vh - 160px); overflow: auto; }
  .bthw .phase { padding: 8px 10px; border-radius: 10px; background: rgba(4, 8, 20, .55); border: 1px solid rgba(148, 163, 184, .12); color: #7dd3fc; font-weight: 600; min-height: 34px; }
  .bthw .sec { display: grid; gap: 6px; }
  .bthw .sec > h4 { margin: 0; font-size: 11.5px; font-weight: 700; color: #8d9ab5; }
  .bthw .row { display: flex; align-items: center; gap: 6px; min-height: 28px; }
  .bthw .row > span:first-child { flex: 1; color: #c7d0e2; }
  .bthw .farm { flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bthw input[type=number], .bthw select { height: 28px; padding: 0 6px; border-radius: 7px; border: 1px solid rgba(148, 163, 184, .22); background: rgba(4, 8, 20, .7); color: #eef3fc; font-size: 12.5px; outline: none; margin: 0; }
  .bthw input[type=number] { width: 58px; text-align: right; font-family: 'JetBrains Mono', Consolas, monospace; }
  .bthw select { width: 120px; }
  .bthw input:focus, .bthw select:focus { border-color: #0ea5e9; box-shadow: 0 0 0 2px rgba(14, 165, 233, .25); }
  .bthw .pot { display: grid; gap: 6px; padding: 7px 8px; border-radius: 10px; background: rgba(4, 8, 20, .45); border: 1px solid rgba(148, 163, 184, .1); }
  .bthw .pot select { width: 100%; }
  .bthw .pot .r { display: flex; align-items: center; gap: 5px; }
  .bthw .pot .r small { color: #8d9ab5; font-size: 11px; }
  .bthw .pot .r input { width: 52px; }
  .bthw .hint { color: #5d6983; font-size: 11px; margin: 0; }
  .bthw label.tg { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; color: #c7d0e2; padding: 3px 0; }
  .bthw label.tg input { appearance: none; -webkit-appearance: none; flex: none; width: 30px; height: 17px; margin: 1px 0 0; border-radius: 99px; background: rgba(148, 163, 184, .25); position: relative; cursor: pointer; transition: background .15s; }
  .bthw label.tg input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #eef3fc; transition: transform .15s; }
  .bthw label.tg input:checked { background: #0ea5e9; }
  .bthw label.tg input:checked::after { transform: translateX(13px); }
  .bthw button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 10px; margin: 0; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(148, 163, 184, .25); background: rgba(148, 163, 184, .1); color: #eef3fc; font-size: 12.5px; font-weight: 600; transition: background .15s; }
  .bthw button:hover { background: rgba(148, 163, 184, .2); }
  .bthw button:focus-visible, .bthw input:focus-visible { outline: 2px solid #0ea5e9; outline-offset: 1px; }
  .bthw button.big { width: 100%; height: 38px; font-size: 14px; font-weight: 700; color: #fff; border-color: rgba(52, 211, 153, .6); background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 14px rgba(16, 185, 129, .25); }
  .bthw.on button.big { border-color: rgba(248, 113, 113, .5); background: rgba(248, 113, 113, .14); color: #fecaca; box-shadow: none; }
  .bthw button.wide { width: 100%; }
  .bthw button.pri { border-color: rgba(56, 189, 248, .6); background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; }
  .bthw details { border-top: 1px solid rgba(148, 163, 184, .12); padding-top: 8px; }
  .bthw summary { cursor: pointer; color: #8d9ab5; font-size: 11.5px; font-weight: 700; }
  .bthw .log { margin-top: 6px; max-height: 110px; overflow: auto; color: #8d9ab5; font: 11px/1.55 'JetBrains Mono', Consolas, monospace; }
  .bthw .qlist { max-height: 230px; overflow: auto; display: grid; gap: 4px; }
  .bthw .qlist label { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 9px; background: rgba(4, 8, 20, .45); border: 1px solid rgba(148, 163, 184, .1); cursor: pointer; }
  .bthw .qlist small { color: #8d9ab5; }
  .bthw input[type=checkbox]:not(.tgi) { accent-color: #0ea5e9; margin: 2px 0 0; }
  @media (prefers-reduced-motion: reduce) { .bthw * { transition: none !important; } }`;
  document.head.appendChild(css);
  const box = document.createElement('div');
  box.id = 'bth';
  box.className = 'bthw';
  box.innerHTML = `<div id="bthbar" class="hd"><span class="dot"></span><b>Binder Helper</b><span id="bthmini" class="mini"></span>
     <a id="bthmin" class="hb" title="ย่อ / ขยาย">−</a><a id="bthx" class="hb" title="ซ่อน (เปิดใหม่จากเว็บ manager)">✕</a></div>
   <div id="bthbody" class="bd">
   <div id="bthphase" class="phase"></div>
   <button id="bthrun" class="big"></button>
   <div class="sec"><h4>จุดฟาร์ม</h4>
     <div class="row"><span id="bthmap" class="farm"></span><button id="bthset" title="จำแมพและพิกัดที่ยืนอยู่ตอนนี้">จำจุดนี้</button></div></div>
   <div class="sec"><h4>ขายของ / ตาย</h4>
     <div class="row"><span>เมืองขาย</span><select id="bthtown">${Object.keys(TOWN_IDS).map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
     <div class="row"><span>ขายเมื่อน้ำหนักถึง (%)</span><input id="bthpct" type="number" min="10" max="100"></div>
     <div class="row"><span>ตายแล้วรอก่อนเกิด (วิ)</span><input id="bthwait" type="number" min="0" max="60"></div></div>
   <div class="sec"><h4>ซื้อยา</h4>
     ${['hp', 'mp'].map(k => `<div class="pot"><select id="bth_${k}_item" aria-label="ยา ${k.toUpperCase()}">${Object.entries(POTIONS[k]).map(([id, n]) => `<option value="${id}">${k.toUpperCase()} · ${n}</option>`).join('')}</select>
       <div class="r"><small>ต่ำกว่า</small><input id="bth_${k}_min" type="number" min="0" max="9999" aria-label="ต่ำกว่า"><small>ซื้อให้ครบ</small><input id="bth_${k}_to" type="number" min="0" max="9999" aria-label="ซื้อให้ครบ"></div></div>`).join('')}
     <p class="hint">ใส่ 0 ที่ "ต่ำกว่า" = ไม่กลับไปซื้อ · ยาต้องอยู่ในช่องยา Q/E</p></div>
   <div class="sec"><h4>ตัวเลือก</h4>
     <label class="tg"><input id="bthlead" class="tgi" type="checkbox"><span>ไป CH เดียวกับหัวตี้ก่อน</span></label>
     <label class="tg"><input id="bthquiet" class="tgi" type="checkbox"><span>ไม่งั้นไป CH คนน้อยสุด (ไม่เข้า PvP)</span></label>
     <label class="tg"><input id="bthboss" class="tgi" type="checkbox"><span>เจอ Boss / Mini-boss ในแมพ ไปตีก่อน</span></label></div>
   <button id="bthbq" class="wide">🎯 ค่าหัววันนี้</button>
   <details><summary>บันทึก</summary><div id="bthlog" class="log"></div></details>
   </div>`;
  document.body.appendChild(box);
  // drag by the title bar (position kept), "−" collapses to the title bar
  const place = () => {
    const p = cfg.panel || DEF.panel;
    const x = Math.max(0, Math.min(innerWidth - 60, p.x)), y = Math.max(0, Math.min(innerHeight - 30, p.y));
    box.style.left = x + 'px'; box.style.top = y + 'px';
    $('#bthbody').style.display = p.min ? 'none' : ''; $('#bthmin').textContent = p.min ? '+' : '−';
    $('#bthmini').textContent = p.min ? '· ' + phase.slice(0, 24) : '';
  };
  $('#bthbar').addEventListener('pointerdown', e => {
    if (e.target.closest('a')) return;
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
  const logs = [];
  function log(t) { logs.unshift(new Date().toLocaleTimeString() + ' ' + t); logs.length = Math.min(logs.length, 30); $('#bthlog').innerHTML = logs.map(x => `<div>${x.replace(/</g, '&lt;')}</div>`).join(''); }
  function setPhase(t) { phase = t; $('#bthphase').textContent = t; $('#bthmini').textContent = (cfg.panel || {}).min ? '· ' + t.slice(0, 24) : ''; }
  function render() {
    $('#bthmap').textContent = cfg.farmMap ? cfg.farmMap + (cfg.farmSpot ? ` (${cfg.farmSpot.x.toFixed(0)}, ${cfg.farmSpot.y.toFixed(0)})` : '') : '(ยังไม่ตั้ง)';
    $('#bthtown').value = TOWN_IDS[cfg.town] ? cfg.town : 'Ashford'; $('#bthpct').value = cfg.sellPct; $('#bthwait').value = cfg.deathWaitMs / 1000; $('#bthquiet').checked = !!cfg.quietCh; $('#bthlead').checked = !!cfg.followLeader; $('#bthboss').checked = !!cfg.bossHunt;
    for (const k of ['hp', 'mp']) { const b = (cfg.buy || {})[k] || {}; $(`#bth_${k}_item`).value = b.item; $(`#bth_${k}_min`).value = b.min || 0; $(`#bth_${k}_to`).value = b.to || 0; }
    $('#bthrun').textContent = cfg.running ? '■ หยุด' : '▶ เริ่มฟาร์ม'; box.classList.toggle('on', !!cfg.running);
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
    cfg.running = !cfg.running; startCheck = cfg.running; save(); render(); log(cfg.running ? 'เริ่ม' : 'หยุด');
  };
  $('#bthx').onclick = () => { box.style.display = 'none'; };

  // ---- bounty window (separate, draggable) ----
  const qbox = document.createElement('div');
  qbox.id = 'bthq';
  qbox.className = 'bthw';
  qbox.style.cssText = 'width:310px;display:none';
  qbox.innerHTML = `<div id="bthqbar" class="hd"><b>🎯 ค่าหัววันนี้</b><span class="mini"></span><a id="bthqx" class="hb" title="ปิด">✕</a></div>
   <div class="bd">
   <div class="row"><span>Lv คุณ <b id="bthqlv">?</b> · แสดงแมพที่ Lv ต่ำสุดไม่เกิน Lv คุณ +</span><input id="bthqabove" type="number" min="0" max="30" style="width:48px"></div>
   <div id="bthqlist" class="qlist"></div>
   <p id="bthqnote" class="hint"></p>
   <div class="row"><button id="bthqref">↻ รีเฟรช</button><button id="bthqgo" class="pri" style="flex:1"></button></div>
   <p class="hint">ระหว่างทำ: Auto ตีเฉพาะมอนค่าหัวทั้งแมพ ครบแล้วรับรางวัลเอง ทำครบทุกตัวแล้วคืนค่า Auto และกลับไปฟาร์มแมพปกติ</p>
   </div>`;
  document.body.appendChild(qbox);
  for (const ev of ['pointerdown', 'mousedown', 'click', 'keydown', 'wheel']) qbox.addEventListener(ev, e => e.stopPropagation());
  const qplace = () => { const p = cfg.bqPanel || { x: 250, y: 120 }; qbox.style.left = Math.max(0, Math.min(innerWidth - 60, p.x)) + 'px'; qbox.style.top = Math.max(0, Math.min(innerHeight - 30, p.y)) + 'px'; };
  $('#bthqbar').addEventListener('pointerdown', e => {
    if (e.target.closest('a')) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = qbox.offsetLeft, oy = qbox.offsetTop;
    const move = ev => { cfg.bqPanel = { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy }; qplace(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); save(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  qplace();
  let bqAll = [], bqPick = new Set();
  const reachable = b => !b.claimed && b.lo <= myLevel() + (+bq.maxAbove || 0);
  function renderBq() {
    $('#bthqlv').textContent = myLevel() || '?';
    $('#bthqabove').value = bq.maxAbove;
    const cur = curBounty();
    if (bq.active) {
      $('#bthqlist').innerHTML = bq.list.map((b, i) => `<div style="padding:6px 8px;border-radius:9px;background:rgba(4,8,20,.45);${i === bq.i ? 'color:#7dd3fc;font-weight:700;border:1px solid rgba(14,165,233,.4)' : b.claimed ? 'color:#34d399' : ''}">${i < bq.i || b.claimed ? '✓' : i === bq.i ? '▶' : '·'} ${b.mob} ${b.prog}/${b.need} <small style="color:#8d9ab5">${b.mapName}</small></div>`).join('');
      $('#bthqnote').textContent = cur ? `กำลังทำ ${cur.mob} ที่ ${cur.mapName}` : '';
      $('#bthqgo').textContent = '■ หยุดค่าหัว';
      return;
    }
    const show = bqAll.filter(reachable), hidden = bqAll.filter(b => !reachable(b));
    $('#bthqlist').innerHTML = show.length ? show.map(b => `<label><input type="checkbox" data-bq="${b.id}" ${bqPick.has(b.id) ? 'checked' : ''}><span><b>${b.mob}</b> ${b.prog}/${b.need}<br><small>${b.mapName} · Lv ${b.lo}–${b.hi}</small></span></label>`).join('')
      : '<p class="hint">ไม่มีค่าหัวที่ไปได้ กด ↻ รีเฟรช</p>';
    $('#bthqnote').textContent = hidden.length ? `ซ่อน ${hidden.length} ตัว: ${hidden.map(b => b.claimed ? b.mob + ' (รับแล้ว)' : `${b.mob} (Lv ${b.lo}+)`).join(', ')}` : '';
    $('#bthqgo').textContent = '▶ เริ่มค่าหัว';
    for (const c of document.querySelectorAll('#bthqlist [data-bq]')) c.onchange = e => { e.target.checked ? bqPick.add(e.target.dataset.bq) : bqPick.delete(e.target.dataset.bq); };
  }
  async function refreshBq() {
    $('#bthqnote').textContent = 'กำลังอ่านค่าหัว…';
    bqAll = await readBounties();
    bqPick = new Set(bqAll.filter(reachable).map(b => b.id));
    renderBq();
  }
  $('#bthbq').onclick = () => { qbox.style.display = qbox.style.display === 'none' ? 'block' : 'none'; if (qbox.style.display === 'block' && !bq.active) refreshBq(); else renderBq(); };
  $('#bthqx').onclick = () => { qbox.style.display = 'none'; };
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
    remove: () => { cfg.running = false; clearInterval(timer); box.remove(); qbox.remove(); css.remove(); delete window.__bth; }, // running=false also ends a trip in progress
    toggle: () => $('#bthrun').click(), // same as pressing ▶ / ■ on the panel
    // read by the web manager (manager/server.js)
    status: () => {
      const b = curBounty(), r = room();
      return {
        running: cfg.running, phase, map: mapName(), channel: chOf(r), level: myLevel(), weight: weightPct(), auto: autoOn(), dead: isDead(),
        farmMap: cfg.farmMap, farmSpot: cfg.farmSpot, town: cfg.town,
        potions: potionPlans().map(p => ({ name: potName(p.item), have: p.have, min: p.min, to: p.to })),
        bounty: bq.active ? { done: bq.i, total: bq.list.length, mob: b && b.mob, map: b && b.mapName, prog: b && b.prog, need: b && b.need } : null,
        log: logs.slice(0, 8),
      };
    },
  };
  return 'helper loaded';
})();
