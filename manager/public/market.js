// Market tab — the game's market board in the web page (server: GET /api/market/board, /api/market/item).
(() => {
  const pane = document.getElementById('market-pane');
  if (!pane) return;
  const ICON = 'https://play.bindertowngame.com/sprites/icons/item/';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = n => (Number(n) || 0).toLocaleString('en-US');
  const ago = t => { if (!t) return '-'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'เมื่อกี้' : s < 3600 ? `${Math.round(s / 60)} นาทีก่อน` : s < 86400 ? `${Math.round(s / 3600)} ชม.ก่อน` : `${Math.round(s / 86400)} วันก่อน`; };
  const CATS = [['', 'ทั้งหมด'], ['weapon', 'อาวุธ'], ['gear', 'ของสวมใส่'], ['use', 'ของใช้'], ['mat', 'วัตถุดิบ'], ['card', 'การ์ด']];
  const LSORTS = [['def', 'ลงล่าสุด'], ['asc', 'ราคา ต่ำ→สูง'], ['desc', 'ราคา สูง→ต่ำ'], ['unit', 'ราคาต่อชิ้น ต่ำ→สูง'], ['tier', 'Tier Affix สูง→ต่ำ'], ['lvhi', 'เลเวลสวมใส่ สูง→ต่ำ'], ['lvlo', 'เลเวลสวมใส่ ต่ำ→สูง']];
  const SORTS = [['def', 'ลงล่าสุด'], ['vol', 'ซื้อขายเยอะสุด'], ['asc', 'ราคาต่ำ → สูง'], ['desc', 'ราคาสูง → ต่ำ'], ['up', 'ราคาขึ้นแรงสุด'], ['down', 'ราคาลงแรงสุด']];
  const RAR = { normal: 'Normal', common: 'Normal', uncommon: 'Magic', magic: 'Magic', rare: 'Rare', epic: 'Epic', unique: 'Unique', legendary: 'Legendary' };
  const RARS = [['', 'ทุกระดับ'], ['normal', 'Normal'], ['magic', 'Magic'], ['rare', 'Rare'], ['epic', 'Epic'], ['unique', 'Unique']];
  const PAGE = 15;
  // sub-types and affixes as the game's market window lists them (weapon names from the game's class table)
  const SUBS = { weapon: [["sword", "ดาบ"], ["greatsword", "ดาบสองมือ"], ["mace", "กระบอง"], ["dagger", "มีดสั้น"], ["bow", "ธนู"], ["staff", "ไม้เท้า"], ["wand", "ไม้กายสิทธิ์"], ["rod", "คทา"], ["book", "ตำรา"], ["spear", "หอก"], ["axe", "ขวาน"], ["crossbow", "หน้าไม้"], ["orb", "ลูกแก้วเวท"], ["hand_crossbow", "หน้าไม้มือ"], ["javelin", "หลาว"], ["sling", "สลิง"], ["pike", "ทวน"], ["lance", "หอกทหารม้า"], ["knuckles", "สนับมือ"], ["flail", "ลูกตุ้มโซ่"], ["rapier", "เรเปียร์"], ["throwing_knives", "มีดบิน"], ["greatstaff", "ไม้เท้ายาว"], ["spellstaff", "ไม้เท้าศึก"], ["maul", "ค้อนศักดิ์สิทธิ์"], ["lightstaff", "ไม้เท้าแสง"], ["scythe", "เคียวใหญ่"], ["chain_sickle", "เคียวโซ่"]], gear: [["armor", "เกราะ"], ["headgear", "หมวก"], ["face", "หน้า"], ["mouth", "ปาก"], ["boots", "รองเท้า"], ["offhand", "มือรอง / โล่"], ["accessory", "เครื่องประดับ"], ["necklace", "สร้อยคอ"], ["belt", "เข็มขัด"]] };
  const AFFIXES = [["desperate", "ดาเมจตอนเลือดคุณต่ำกว่า 35%"], ["vsdebuff", "ดาเมจใส่มอนที่ติดสตัน/ตรึง/สโล%"], ["opener", "ดาเมจใส่มอนที่เลือดยังเกิน 90%"], ["bossbane", "ดาเมจใส่ Boss%"], ["castspd", "ร่ายไว%"], ["aspd", "สปีดตี%"], ["agi", "AGI"], ["atk", "ATK"], ["atkpct", "ATK%"], ["block", "Block%"], ["bossres", "Boss Resist%"], ["p_bulwark", "Bulwark (Trigger)"], ["p_chain", "Chain Spark (Trigger)"], ["crit", "CRIT%"], ["critdmg", "Crit DMG%"], ["p_nova", "Death Burst (Trigger)"], ["guard", "DEF"], ["dex", "DEX"], ["p_echo", "Echo Strike (Trigger)"], ["evasive", "FLEE"], ["p_haste", "Frenzy (Trigger)"], ["p_frost", "Frostbite (Trigger)"], ["mending", "Heal power"], ["hit", "HIT"], ["regen", "HP regen/s"], ["int", "INT"], ["p_barrier", "Lifeline (Trigger)"], ["leech", "Lifesteal%"], ["luk", "LUK"], ["manatide", "Mana Tide: MP ที่ใช้กับสกิลเวท"], ["matk", "MATK"], ["matkpct", "MATK%"], ["hp", "Max HP"], ["hppct", "Max HP%"], ["mp", "Max MP"], ["move", "Move speed%"], ["p_bleed", "Rend (Trigger)"], ["p_renew", "Second Wind (Trigger)"], ["p_siphon", "Siphon (Trigger)"], ["cdr", "Skill CDR%"], ["p_gust", "Slipstream (Trigger)"], ["sturdy", "Soft DEF"], ["spellamp", "Spell Amp%"], ["str", "STR"], ["p_expose", "Sunder (Trigger)"], ["p_thorns", "Thorns (Trigger)"], ["p_vigor", "Vigor (Trigger)"], ["vit", "VIT"]];
  let st = { view: 'board', lsort: 'def', lpage: 0, ltotal: 0, listings: [], lloading: false, lerror: '', req: 0, q: '', rarity: '', progress: '', cat: '', sub: 'all', lvMin: 0, lvMax: 0, affix: '', tierMin: 0, counts: null, sort: 'def', rows: [], total: 0, page: 0, loading: false, error: '', sel: null, item: null, range: '7d', itemLoading: false, at: 0 };

  // item id -> base id, rarity, display name (gear ids carry "|rare|..." / "^insight", cards "|mob")
  const parse = (key, itemId) => {
    const k = String(key || itemId || '');
    const [head, tail] = k.split('|');
    const [core, grade] = head.split('^')[0].split('~');   // "star_shard~1" = grade ★1
    const base = core;
    const rarity = tail && RAR[tail] ? tail : '';
    const names = window.BT_ITEM_NAMES || {};
    let name = (names[base] || base) + (grade ? ` ★${grade}` : '');
    const sub = String(itemId || '').split('|')[1];
    if (base === 'spirit_card' && sub && !sub.includes(':')) name += ' · ' + sub.replace(/_/g, ' ');
    return { base, rarity, name };
  };
  // a listing's own item: "sword_t10^ins_x|p_nova:7:7,str:7:13#uuid" = random options affix:tier:value (+ insight)
  const AFFIX_NAME = Object.fromEntries(AFFIXES);
  const listingOpts = itemId => {
    const [head, rest = ''] = String(itemId || '').split('#')[0].split('|');
    const insight = (head.split('^')[1] || '').replace(/^ins_/, '').replace(/_/g, ' ');
    const opts = rest.split(',').map(x => x.split(':')).filter(a => a.length === 3 && AFFIX_NAME[a[0]] !== undefined || (a.length === 3 && /^[a-z_]+$/.test(a[0])))
      .map(([id, t, v]) => ({ id, tier: Number(t) || 0, value: Number(v) || 0 }));
    return { insight, opts };
  };
  const optText = o => { const l = AFFIX_NAME[o.id] || o.id.replace(/^p_/, '').replace(/_/g, ' ');
    // "ATK%" -> "ATK +5%"; a "%" that belongs to a number ("เกิน 90%") stays and the value goes after it
    return /[^\d\s]%$/.test(l) ? `${l.slice(0, -1).trim()} +${o.value}%` : `${l} +${o.value}${/%$/.test(l) ? '%' : ''}`; };
  const optChips = itemId => { const { insight, opts } = listingOpts(itemId);
    if (!opts.length && !insight) return '';
    const sum = opts.reduce((a, o) => a + o.tier, 0);
    return `<div class="mk-opts">${opts.map(o => `<span class="mk-opt t${Math.min(8, o.tier)}" title="Tier ${o.tier}"><b>T${o.tier}</b>${esc(optText(o))}</span>`).join('')}${insight ? `<span class="mk-opt ins">✦ ${esc(insight)}</span>` : ''}${opts.length ? `<span class="mk-tsum" title="Tier รวมของทุกออฟ">ΣT ${sum}</span>` : ''}</div>`; };
  // one listing as the game shows it: "<prefixes> <base> <first suffix>", rarity from the number of options,
  // wear level and ATK (base x3) of the equipment, every option with its tier
  const ITEM_EQUIP = () => window.BT_EQUIP || {}, ITEM_AFFIX = () => window.BT_AFFIX || {};
  function listingItem(itemId) {
    const raw = String(itemId || '').split('#')[0];
    const [head, rest = ''] = raw.split('|');
    const [core, grade] = head.split('^')[0].split('~');
    const names = window.BT_ITEM_NAMES || {};
    const eq = ITEM_EQUIP()[core];
    const opts = eq ? rest.split(',').map(x => x.split(':')).filter(a => a.length === 3).map(([id, t, v]) => ({ id, tier: Number(t) || 0, value: Number(v) || 0 })) : [];
    const aff = ITEM_AFFIX();
    const tierName = o => { const a = aff[o.id]; return a ? (a[1][o.tier - 1] || a[1][a[1].length - 1] || '') : ''; };
    const pre = opts.filter(o => (aff[o.id] || [])[0] === 'p').map(tierName).filter(Boolean);
    const suf = opts.filter(o => (aff[o.id] || [])[0] === 's').map(tierName).filter(Boolean).slice(0, 1);
    let base = (names[core] || core) + (grade ? ` ★${grade}` : '');
    if (core === 'spirit_card' && rest && !rest.includes(':')) base += ' · ' + rest.replace(/_/g, ' ');
    const rarity = !eq ? '' : opts.length >= 4 ? 'epic' : opts.length === 3 ? 'rare' : opts.length ? 'magic' : 'normal';
    const insight = (head.split('^')[1] || '').replace(/^ins_/, '').replace(/_/g, ' ');
    return { core, name: [...pre, base, ...suf].join(' '), rarity, lv: eq ? eq[0] : 0, atk: eq && eq[1] ? eq[1] * 3 : 0, opts, tierName, insight };
  }
  function listingCard(l) {
    const it = listingItem(l.itemId), unit = Math.round(l.price / Math.max(1, l.qty));
    return `<div class="mk-lcard r-${it.rarity || 'common'}" data-lid="${l.id}" title="ดูกราฟราคาของไอเทมชนิดนี้">
      <span class="mk-ico r-${it.rarity || 'common'}">${icon(it.core)}</span>
      <div class="mk-lmain">
        <b class="mk-lname">${esc(it.name)}</b>
        <div class="mk-lmeta">${it.rarity ? `<i class="mk-rar r-${it.rarity}">${RAR[it.rarity]}</i>` : ''}${it.lv ? `<span class="mk-pill">Lv ${it.lv}</span>` : ''}${it.atk ? `<span class="mk-pill">ATK ${g(it.atk)}</span>` : ''}${it.insight ? `<span class="mk-opt ins">✦ ${esc(it.insight)}</span>` : ''}</div>
        ${it.opts.length ? `<div class="mk-lopts">${it.opts.map(o => `<div class="mk-lopt t${Math.min(8, o.tier)}"><b>T${o.tier}</b><span>${esc(optText(o))}</span><small>${esc(it.tierName(o))}</small></div>`).join('')}</div>` : ''}
      </div>
      <div class="mk-lprice"><b>${g(unit)}<small> G${l.qty > 1 ? '/ชิ้น' : ''}</small></b>${l.qty > 1 ? `<span>×${g(l.qty)} = ${g(l.price)} G</span>` : ''}<span class="mk-seller">${esc(l.seller)}</span><small>${ago(l.at)}</small></div>
    </div>`;
  }
  async function loadListings() {
    const my = ++st.req;
    st.lloading = true; st.lerror = ''; renderListings();
    if (SUBS[st.cat]) loadCounts();
    const p = filterParams(); p.set('sort', st.lsort); p.set('p', st.lpage);
    try {
      const r = await (await fetch('/api/market/listings?' + p)).json();
      if (my !== st.req) return;
      if (!r.ok) throw new Error(r.error || 'อ่านประกาศไม่สำเร็จ');
      st.listings = r.listings || []; st.ltotal = r.total || 0;
    } catch (e) { if (my !== st.req) return; st.lerror = e.message; st.listings = []; }
    st.lloading = false; renderListings();
  }
  function renderListings() {
    if (st.view !== 'list') return;
    const pages = Math.max(1, Math.ceil(st.ltotal / 100));
    $('mk-count').textContent = st.lloading ? 'กำลังโหลดประกาศ…' : st.lerror ? '⚠ ' + st.lerror : `${g(st.ltotal)} ประกาศ · หน้า ${st.lpage + 1}/${pages} (หน้าละ 100)`;
    $('mk-lists').innerHTML = st.listings.length ? st.listings.map(listingCard).join('') : `<div class="mk-empty small">${st.lloading ? 'กำลังโหลด…' : 'ไม่มีประกาศ'}</div>`;
    const win = [...new Set([0, st.lpage - 2, st.lpage - 1, st.lpage, st.lpage + 1, st.lpage + 2, pages - 1])].filter(x => x >= 0 && x < pages).sort((a, b) => a - b);
    $('mk-pager').innerHTML = pages > 1 ? `<button type="button" data-lpg="${st.lpage - 1}" ${st.lpage ? '' : 'disabled'}>‹</button>`
      + win.map((x, i) => (i && x - win[i - 1] > 1 ? '<span class="mk-gap">…</span>' : '') + `<button type="button" data-lpg="${x}" class="${x === st.lpage ? 'on' : ''}">${x + 1}</button>`).join('')
      + `<button type="button" data-lpg="${st.lpage + 1}" ${st.lpage < pages - 1 ? '' : 'disabled'}>›</button>` : '';
  }
  const reload = () => (st.view === 'list' ? (st.lpage = 0, loadListings()) : loadBoard());
  const icon = base => `<img src="${ICON}${encodeURIComponent(base)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const chg = c => c == null || !isFinite(c) ? '' : `<i class="mk-chg ${c > 0.05 ? 'up' : c < -0.05 ? 'down' : 'flat'}">${c > 0.05 ? '▲' : c < -0.05 ? '▼' : '•'} ${Math.abs(c).toFixed(1)}%</i>`;

  pane.innerHTML = `
    <div class="mk-wrap">
      <section class="mk-board">
        <div class="mk-tools">
          <input class="mk-input" id="mk-q" type="search" placeholder="🔍 ค้นหาไอเทม…">
          <div class="mk-cats" id="mk-cats">${CATS.map(([v, l]) => `<button type="button" data-cat="${v}" class="${v === '' ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="mk-rars" id="mk-rars">${RARS.map(([v, l]) => `<button type="button" data-rar="${v}" class="r-${v || 'all'} ${v === '' ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="mk-subs" id="mk-subs" hidden></div>
          <div class="mk-gear" id="mk-gear">
            <label>Lv ใส่ <input class="mk-input" id="mk-lvmin" type="number" min="1" max="99" placeholder="1"> – <input class="mk-input" id="mk-lvmax" type="number" min="1" max="99" placeholder="99"></label>
            <label>Affix <select class="mk-input" id="mk-affix"><option value="">ทุก Affix</option>${AFFIXES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
            <span class="mk-tiers" id="mk-tiers"><span>Tier ขั้นต่ำ</span><button type="button" data-t="0" class="all on">ทุก Tier</button>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button type="button" data-t="${n}" class="t${n}">T${n}+</button>`).join('')}</span>
            <button type="button" class="mk-clear" id="mk-clear">ล้างตัวกรอง</button>
          </div>
        </div>
        <div class="mk-views" id="mk-views"><button type="button" data-view="board" class="on">กระดานราคา</button><button type="button" data-view="list">ประกาศทั้งหมด</button></div>
        <div class="mk-bar"><span id="mk-count">กำลังโหลด…</span>
          <label>เรียง <select class="mk-input" id="mk-sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <button type="button" class="mk-icon" id="mk-reload" title="โหลดใหม่">⟳</button></div>
        <div class="mk-lists" id="mk-lists" hidden></div>
        <div class="mk-table" id="mk-table">
          <div class="mk-head"><span>ไอเทม</span><span class="r">ราคาถูกสุด</span><span class="r">ในตลาด</span><span class="r">ขายล่าสุด</span></div>
          <div id="mk-rows"></div>
        </div>
        <div class="mk-pager" id="mk-pager"></div>
      </section>
      <section class="mk-detail" id="mk-detail"><div class="mk-empty"><b>เลือกไอเทมทางซ้าย</b><span>เพื่อดูกราฟราคาและประกาศขาย</span></div></section>
    </div>`;
  const $ = id => document.getElementById(id);

  const gearCat = () => st.cat === '' || st.cat === 'weapon' || st.cat === 'gear';
  function filterParams() {
    const p = new URLSearchParams();
    if (st.q) p.set('q', st.q); if (st.cat) p.set('cat', st.cat); if (st.rarity) p.set('rarity', st.rarity);
    if (SUBS[st.cat] && st.sub !== 'all') p.set('sub', st.sub);
    if (gearCat()) { if (st.lvMin) p.set('lvMin', st.lvMin); if (st.lvMax) p.set('lvMax', st.lvMax); if (st.affix) p.set('affix', st.affix); if (st.tierMin) p.set('tierMin', st.tierMin); }
    return p;
  }
  // listing counts per sub-type for the chips (the game's marketQuery answer)
  async function loadCounts() {
    const p = filterParams(); p.delete('sub');
    try { const r = await (await fetch('/api/market/counts?' + p)).json(); st.counts = r.ok ? r : null; } catch (e) { st.counts = null; }
    renderFilters();
  }
  function renderFilters() {
    const subs = SUBS[st.cat], el = $('mk-subs');
    el.hidden = !subs;
    if (subs) {
      const c = (st.counts && st.counts.subCounts) || {}, all = Object.values(c).reduce((a, b) => a + b, 0);
      el.innerHTML = [['all', 'ทั้งหมด'], ...subs].map(([v, l]) => { const n = v === 'all' ? all : c[v] || 0;
        return `<button type="button" data-sub="${v}" class="${st.sub === v ? 'on' : ''} ${st.counts && !n ? 'none' : ''}">${esc(l)}<em>${st.counts ? g(n) : '…'}</em></button>`; }).join('');
    }
    $('mk-gear').hidden = !gearCat();
    $('mk-gear').classList.toggle('active', !!(st.lvMin || st.lvMax || st.affix || st.tierMin));
  }
  // The game answers at most 120 kinds per request and has no paging, so a capped request is split
  // (category -> sub-type -> rarity -> level range; materials: low-to-high + high-to-low) until each piece fits.
  const LV_SPLITS = [[1, 20], [21, 40], [41, 60], [61, 80], [81, 99]];
  const sortRows = rows => {
    const k = { def: r => -(r.at || 0), vol: r => -(r.vol7 || 0), asc: r => r.low || 0, desc: r => -(r.low || 0), up: r => -(r.chg ?? -1e9), down: r => r.chg ?? 1e9 }[st.sort] || (r => -(r.at || 0));
    return rows.sort((a, b) => k(a) - k(b));
  };
  // the game drops board requests that come too fast: a short gap between requests, and retries with a pause
  let lastReq = 0;
  async function boardReq(f, sort) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== '' && v != null && v !== 0 && v !== 'all') p.set(k, v);
    p.set('sort', sort || st.sort);
    let err = null;
    for (let i = 0; i < 4; i++) {
      const wait = lastReq + (i ? 2500 * i : 450) - Date.now();
      if (wait > 0) await new Promise(z => setTimeout(z, wait));
      lastReq = Date.now();
      try {
        const r = await (await fetch('/api/market/board?' + p)).json();
        if (r.ok) return r;
        err = new Error(r.error || 'อ่านตลาดไม่สำเร็จ');
      } catch (e) { err = e; }
    }
    throw err;
  }
  async function fetchAll(base, rows, done) {
    if (done.my !== st.req) throw new Error('aborted');   // a newer search replaced this one
    const r = await boardReq(base);
    done.n++; st.progress = `กำลังดึงทั้งหมด… ${done.n} ครั้ง · ได้ ${g(rows.size + (r.rows || []).length)} ชนิด`; renderBoard();
    if (!(r.total > (r.rows || []).length)) { for (const x of r.rows || []) rows.set(x.key, x); return; }
    const gear = !base.cat || base.cat === 'weapon' || base.cat === 'gear';
    let parts = null;
    if (!base.cat) parts = CATS.slice(1).map(([c]) => ({ ...base, cat: c }));
    else if (SUBS[base.cat] && (!base.sub || base.sub === 'all')) parts = SUBS[base.cat].map(([v]) => ({ ...base, sub: v }));
    else if (gear && !base.rarity) parts = RARS.slice(1).map(([v]) => ({ ...base, rarity: v }));
    else if (gear && !base.lvMin && !base.lvMax) parts = LV_SPLITS.map(([a, b]) => ({ ...base, lvMin: a, lvMax: b }));
    else if (gear && base.lvMax - base.lvMin >= 1) { const m = Math.floor((base.lvMin + base.lvMax) / 2); parts = [{ ...base, lvMax: m }, { ...base, lvMin: m + 1 }]; }
    if (parts) { for (const f of parts) await fetchAll(f, rows, done); return; }
    // cannot split further (e.g. materials): both ends of the price order cover up to 240 kinds
    for (const x of r.rows || []) rows.set(x.key, x);
    for (const sort of ['asc', 'desc']) { const rr = await boardReq(base, sort); done.n++; for (const x of rr.rows || []) rows.set(x.key, x); }
  }
  async function loadBoard() {
    const my = ++st.req;
    st.loading = true; st.error = ''; st.progress = ''; renderBoard();
    if (SUBS[st.cat]) loadCounts();
    const f = Object.fromEntries(filterParams());
    for (const k of ['lvMin', 'lvMax', 'tierMin']) if (f[k]) f[k] = Number(f[k]);
    try {
      const rows = new Map(), done = { n: 0, my };
      await fetchAll(f, rows, done);
      if (my !== st.req) return;   // a newer search started meanwhile
      st.rows = sortRows([...rows.values()]); st.total = st.rows.length; st.page = 0; st.at = Date.now();
    } catch (e) { if (my !== st.req) return; st.error = e.message; st.rows = []; }
    st.loading = false; st.progress = ''; renderBoard();
  }
  async function loadItem() {
    if (!st.sel) return;
    st.itemLoading = true; renderDetail();
    try {
      const r = await (await fetch(`/api/market/item?id=${encodeURIComponent(st.sel.itemId)}&range=${st.range}`)).json();
      if (!r.ok) throw new Error(r.error || 'อ่านไอเทมไม่สำเร็จ');
      st.item = r.view;
    } catch (e) { st.item = { error: e.message }; }
    st.itemLoading = false; renderDetail();
  }

  function renderBoard() {
    if (st.view === 'list') return renderListings();
    $('mk-count').textContent = st.loading ? (st.progress || 'กำลังโหลด…') : st.error ? '⚠ ' + st.error : `${g(st.total)} ชนิดในตลาด (ครบทุกชนิด)`;
    const rows = st.rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
    $('mk-rows').innerHTML = rows.length ? rows.map(r => {
      const it = parse(r.key, r.itemId);
      return `<button type="button" class="mk-row ${st.sel && st.sel.key === r.key ? 'sel' : ''}" data-key="${esc(r.key)}">
        <span class="mk-it"><span class="mk-ico r-${it.rarity || 'common'}">${icon(it.base)}</span>
          <span class="mk-nm"><b>${esc(it.name)}</b><small>${it.rarity ? `<i class="mk-rar r-${it.rarity}">${RAR[it.rarity]}</i>` : ''}${g(r.n)} ประกาศ</small></span></span>
        <span class="r mk-price">${g(r.low)} <small>G</small></span>
        <span class="r">${g(r.stock)} <small>ชิ้น</small></span>
        <span class="r mk-last">${r.last ? `<b>${g(r.last)}</b> ${chg(r.chg)}<small>${ago(r.lastAt)}</small>` : '<small>ยังไม่มีคนซื้อ</small>'}</span>
      </button>`;
    }).join('') : `<div class="mk-empty small">${st.loading ? 'กำลังโหลด…' : st.error ? esc(st.error) : 'ไม่พบไอเทม'}</div>`;
    const pages = Math.ceil(st.rows.length / PAGE);
    $('mk-pager').innerHTML = pages > 1 ? `<button type="button" data-pg="${st.page - 1}" ${st.page ? '' : 'disabled'}>‹</button>`
      + Array.from({ length: pages }, (_, i) => `<button type="button" data-pg="${i}" class="${i === st.page ? 'on' : ''}">${i + 1}</button>`).join('')
      + `<button type="button" data-pg="${st.page + 1}" ${st.page < pages - 1 ? '' : 'disabled'}>›</button>` : '';
  }

  function chart(series) {
    const pts = (series || []).filter(p => p && p.avg > 0);
    if (pts.length < 2) return `<div class="mk-empty small">ข้อมูลราคายังไม่พอทำกราฟ</div>`;
    const W = 560, H = 180, P = 8;
    const xs = pts.map(p => p.t), lo = Math.min(...pts.map(p => p.min || p.avg)), hi = Math.max(...pts.map(p => p.max || p.avg));
    const x = t => P + (t - xs[0]) / Math.max(1, xs[xs.length - 1] - xs[0]) * (W - 2 * P);
    const y = v => H - P - (v - lo) / Math.max(1, hi - lo) * (H - 2 * P);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
    const band = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.max || p.avg).toFixed(1)}`).join(' ') + ' ' + pts.slice().reverse().map(p => `L${x(p.t).toFixed(1)},${y(p.min || p.avg).toFixed(1)}`).join(' ') + ' Z';
    return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${band}" class="band"/><path d="${line}" class="line"/>
      ${pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.avg).toFixed(1)}" r="3"><title>${new Date(p.t).toLocaleString('th-TH')} · เฉลี่ย ${g(p.avg)} (${g(p.min)}–${g(p.max)}) · ${p.vol} ชิ้น</title></circle>`).join('')}
    </svg><div class="mk-axis"><span>${g(hi)}</span><span>${g(lo)}</span></div>`;
  }

  function renderDetail() {
    const el = $('mk-detail');
    if (!st.sel) return;
    const it = parse(st.sel.key, st.sel.itemId), v = st.item;
    const head = `<div class="mk-dhead"><span class="mk-ico big r-${it.rarity || 'common'}">${icon(it.base)}</span>
      <div><b>${esc(it.name)}</b><small>${it.rarity ? `<i class="mk-rar r-${it.rarity}">${RAR[it.rarity]}</i>` : ''}<code>${esc(it.base)}</code></small></div>
      <div class="mk-ranges">${['7d', '30d'].map(r => `<button type="button" data-range="${r}" class="${r === st.range ? 'on' : ''}">${r === '7d' ? '7 วัน' : '30 วัน'}</button>`).join('')}</div></div>`;
    if (st.itemLoading && !v) { el.innerHTML = head + '<div class="mk-empty small">กำลังโหลด…</div>'; return; }
    if (!v || v.error) { el.innerHTML = head + `<div class="mk-empty small">⚠ ${esc((v && v.error) || 'ไม่มีข้อมูล')}</div>`; return; }
    el.innerHTML = head + `
      <div class="mk-kpis">
        <div><small>ขายล่าสุด</small><b>${v.last ? g(v.last) : '-'}</b>${chg(v.chg)}<small>${ago(v.lastAt)}</small></div>
        <div><small>ถูกสุดตอนนี้</small><b class="gold">${g(v.low)}</b><small>${g(v.stock)} ชิ้น · ${g(v.n)} ประกาศ</small></div>
        <div><small>เฉลี่ย ${esc(v.range)}</small><b>${g(v.avg7)}</b><small>${g(v.low7)} – ${g(v.high7)}</small></div>
        <div><small>ซื้อขาย ${esc(v.range)}</small><b>${g(v.trades7)}</b><small>${g(v.vol7)} ชิ้น</small></div>
      </div>
      <div class="mk-chartbox">${chart(v.series)}</div>
      <h4>ประกาศขาย (${(v.listings || []).length})</h4>
      <div class="mk-list">${(v.listings || []).length ? (v.listings || []).map(l => `<div class="mk-li">
          <div class="mk-li-row"><b>${g(Math.round(l.price / Math.max(1, l.qty)))}<small> G/ชิ้น</small></b>
          <span>×${g(l.qty)}</span><span class="r">${g(l.price)} G</span><span class="mk-seller">${esc(l.seller)}</span><small>${ago(l.at)}</small></div>
          ${optChips(l.itemId)}</div>`).join('')
        : '<div class="mk-empty small">ไม่มีประกาศขาย</div>'}</div>`;
  }

  // events
  let qTimer = null;
  $('mk-q').oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = e.target.value.trim(); reload(); }, 400); };
  $('mk-sort').onchange = e => {
    if (st.view === 'list') { st.lsort = e.target.value; st.lpage = 0; loadListings(); return; }
    st.sort = e.target.value; st.rows = sortRows(st.rows); st.page = 0; renderBoard();
  };
  // view switch: price board / every listing
  $('mk-views').onclick = e => {
    const b = e.target.closest('button[data-view]'); if (!b || b.dataset.view === st.view) return;
    st.view = b.dataset.view; for (const x of $('mk-views').children) x.classList.toggle('on', x === b);
    $('mk-table').hidden = st.view === 'list'; $('mk-lists').hidden = st.view !== 'list';
    $('mk-sort').innerHTML = (st.view === 'list' ? LSORTS : SORTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('mk-sort').value = st.view === 'list' ? st.lsort : st.sort;
    if (st.view === 'list') loadListings(); else renderBoard();
  };
  $('mk-reload').onclick = () => (st.view === 'list' ? loadListings() : loadBoard());
  $('mk-cats').onclick = e => { const b = e.target.closest('button[data-cat]'); if (!b) return; st.cat = b.dataset.cat; st.sub = 'all'; st.counts = null; for (const x of $('mk-cats').children) x.classList.toggle('on', x === b); renderFilters(); reload(); };
  $('mk-rars').onclick = e => { const b = e.target.closest('button[data-rar]'); if (!b) return; st.rarity = b.dataset.rar; for (const x of $('mk-rars').children) x.classList.toggle('on', x === b); reload(); };
  $('mk-subs').onclick = e => { const b = e.target.closest('button[data-sub]'); if (!b) return; st.sub = b.dataset.sub; renderFilters(); reload(); };
  const lv = id => Math.max(0, Math.min(99, Math.floor(Number($(id).value) || 0)));
  $('mk-lvmin').onchange = () => { st.lvMin = lv('mk-lvmin'); renderFilters(); reload(); };
  $('mk-lvmax').onchange = () => { st.lvMax = lv('mk-lvmax'); renderFilters(); reload(); };
  $('mk-affix').onchange = e => { st.affix = e.target.value; renderFilters(); reload(); };
  $('mk-tiers').onclick = e => { const b = e.target.closest('button[data-t]'); if (!b) return; st.tierMin = Number(b.dataset.t); for (const x of $('mk-tiers').querySelectorAll('button')) x.classList.toggle('on', x === b); renderFilters(); reload(); };
  $('mk-clear').onclick = () => { st.lvMin = st.lvMax = st.tierMin = 0; st.affix = ''; $('mk-lvmin').value = $('mk-lvmax').value = ''; $('mk-affix').value = '';
    for (const x of $('mk-tiers').querySelectorAll('button')) x.classList.toggle('on', x.dataset.t === '0'); renderFilters(); reload(); };
  $('mk-pager').addEventListener('click', e => { const b = e.target.closest('button[data-lpg]'); if (!b || b.disabled) return; st.lpage = Number(b.dataset.lpg); loadListings(); $('mk-lists').scrollTop = 0; });
  $('mk-pager').onclick = e => { const b = e.target.closest('button[data-pg]'); if (!b || b.disabled) return; st.page = Number(b.dataset.pg); renderBoard(); };
  $('mk-rows').onclick = e => {
    const b = e.target.closest('.mk-row'); if (!b) return;
    st.sel = st.rows.find(r => r.key === b.dataset.key); st.item = null; renderBoard(); loadItem();
  };
  // a listing card opens the price chart / listings of its kind on the right
  $('mk-lists').onclick = e => {
    const c = e.target.closest('.mk-lcard'); if (!c) return;
    const l = st.listings.find(x => String(x.id) === c.dataset.lid); if (!l) return;
    const it = listingItem(l.itemId);
    st.sel = { key: it.rarity ? `${it.core}|${it.rarity}` : it.core, itemId: l.itemId }; st.item = null;
    for (const x of $('mk-lists').children) x.classList.toggle('sel', x === c);
    loadItem();
  };
  $('mk-detail').onclick = e => { const b = e.target.closest('button[data-range]'); if (!b) return; st.range = b.dataset.range; st.item = null; loadItem(); };

  // first load when the tab is opened; refresh every 5 min while it is open (a full read is many requests)
  const open = () => pane.classList.contains('active');
  document.querySelectorAll('.tab-btn[data-tab="market"]').forEach(b => b.addEventListener('click', () => { if (!st.at) loadBoard(); }));
  setInterval(() => { if (open() && Date.now() - st.at > 300000 && !st.loading) loadBoard(); }, 5000);
  if (open()) loadBoard();
})();
