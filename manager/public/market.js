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
  const AUTOS = [[0, 'ปิด'], [1, 'ทุก 1 นาที'], [2, 'ทุก 2 นาที'], [5, 'ทุก 5 นาที'], [10, 'ทุก 10 นาที'], [15, 'ทุก 15 นาที'], [30, 'ทุก 30 นาที']];
  // sub-types and affixes as the game's market window lists them (weapon names from the game's class table)
  const SUBS = { weapon: [["sword", "ดาบ"], ["greatsword", "ดาบสองมือ"], ["mace", "กระบอง"], ["dagger", "มีดสั้น"], ["bow", "ธนู"], ["staff", "ไม้เท้า"], ["wand", "ไม้กายสิทธิ์"], ["rod", "คทา"], ["book", "ตำรา"], ["spear", "หอก"], ["axe", "ขวาน"], ["crossbow", "หน้าไม้"], ["orb", "ลูกแก้วเวท"], ["hand_crossbow", "หน้าไม้มือ"], ["javelin", "หลาว"], ["sling", "สลิง"], ["pike", "ทวน"], ["lance", "หอกทหารม้า"], ["knuckles", "สนับมือ"], ["flail", "ลูกตุ้มโซ่"], ["rapier", "เรเปียร์"], ["throwing_knives", "มีดบิน"], ["greatstaff", "ไม้เท้ายาว"], ["spellstaff", "ไม้เท้าศึก"], ["maul", "ค้อนศักดิ์สิทธิ์"], ["lightstaff", "ไม้เท้าแสง"], ["scythe", "เคียวใหญ่"], ["chain_sickle", "เคียวโซ่"]], gear: [["armor", "เกราะ"], ["headgear", "หมวก"], ["face", "หน้า"], ["mouth", "ปาก"], ["boots", "รองเท้า"], ["offhand", "มือรอง / โล่"], ["accessory", "เครื่องประดับ"], ["necklace", "สร้อยคอ"], ["belt", "เข็มขัด"]] };
  const AFFIXES = [["desperate", "ดาเมจตอนเลือดคุณต่ำกว่า 35%"], ["vsdebuff", "ดาเมจใส่มอนที่ติดสตัน/ตรึง/สโล%"], ["opener", "ดาเมจใส่มอนที่เลือดยังเกิน 90%"], ["bossbane", "ดาเมจใส่ Boss%"], ["castspd", "ร่ายไว%"], ["aspd", "สปีดตี%"], ["agi", "AGI"], ["atk", "ATK"], ["atkpct", "ATK%"], ["block", "Block%"], ["bossres", "Boss Resist%"], ["p_bulwark", "Bulwark (Trigger)"], ["p_chain", "Chain Spark (Trigger)"], ["crit", "CRIT%"], ["critdmg", "Crit DMG%"], ["p_nova", "Death Burst (Trigger)"], ["guard", "DEF"], ["dex", "DEX"], ["p_echo", "Echo Strike (Trigger)"], ["evasive", "FLEE"], ["p_haste", "Frenzy (Trigger)"], ["p_frost", "Frostbite (Trigger)"], ["mending", "Heal power"], ["hit", "HIT"], ["regen", "HP regen/s"], ["int", "INT"], ["p_barrier", "Lifeline (Trigger)"], ["leech", "Lifesteal%"], ["luk", "LUK"], ["manatide", "Mana Tide: MP ที่ใช้กับสกิลเวท"], ["matk", "MATK"], ["matkpct", "MATK%"], ["hp", "Max HP"], ["hppct", "Max HP%"], ["mp", "Max MP"], ["move", "Move speed%"], ["p_bleed", "Rend (Trigger)"], ["p_renew", "Second Wind (Trigger)"], ["p_siphon", "Siphon (Trigger)"], ["cdr", "Skill CDR%"], ["p_gust", "Slipstream (Trigger)"], ["sturdy", "Soft DEF"], ["spellamp", "Spell Amp%"], ["str", "STR"], ["p_expose", "Sunder (Trigger)"], ["p_thorns", "Thorns (Trigger)"], ["p_vigor", "Vigor (Trigger)"], ["vit", "VIT"]];
  let st = { lsel: null, buyers: [], buyerTab: '', capF: 0, lall: null, lprog: '', view: 'board', lsort: 'def', lpage: 0, ltotal: 0, listings: [], lloading: false, lerror: '', req: 0, q: '', rarity: '', progress: '', cat: '', sub: 'all', lvMin: 0, lvMax: 0, affix: '', tierMin: 0, counts: null, sort: 'def', rows: [], total: 0, page: 0, loading: false, error: '', sel: null, item: null, range: '7d', itemLoading: false, at: 0, want: [], auto: 5, lat: 0 };
  // wanted options ("เช็คออปชัน") and the auto-update interval are remembered in this browser
  const PREF = 'bt.market.prefs';
  try { const p = JSON.parse(localStorage.getItem(PREF) || '{}');
    if (Array.isArray(p.want)) st.want = p.want.filter(w => w && typeof w.id === 'string').map(w => ({ id: w.id, t: Math.max(1, Math.min(8, Number(w.t) || 1)) })).slice(0, 6);
    if (AUTOS.some(([v]) => v === p.auto)) st.auto = p.auto; } catch (e) { }
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify({ want: st.want, auto: st.auto })); } catch (e) { } };

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
  // item level = max(base level, the level each option's tier needs); cap tier = tiers unlocked at that level
  const TIER_LV = [1, 12, 26, 40, 55, 70, 82, 92];
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
    const ilvl = eq ? Math.max(eq[0] || 1, ...opts.map(o => TIER_LV[Math.min(8, o.tier) - 1] || 0)) : 0;
    const cap = eq ? TIER_LV.filter(x => x <= ilvl).length : 0;
    return { core, name: [...pre, base, ...suf].join(' '), rarity, lv: eq ? eq[0] : 0, atk: eq && eq[1] ? eq[1] * 3 : 0, opts, tierName, insight, ilvl, cap };
  }
  // per-row tier odds of an item whose cap is `cap` (the game's H3/Fj: +1 tier 3 %, the cap ~25-50 %, lower tiers falling off)
  function tierOdds(cap, tiers = 8) {
    const up = 0.03, s = Math.max(0, cap - 1), want = 0.25 + 0.25 * Math.max(0, Math.min(1, (cap - 1) / 7));
    const a = u => { let p = 0; for (let h = 0; h <= s; h++) p += u ** h; return (1 - up) / p; };
    let lo = 0.3, hi = 0.8;
    if (a(hi) >= want) lo = hi; else if (a(lo) <= want) hi = lo; else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; a(m) > want ? lo = m : hi = m; }
    const l = (lo + hi) / 2, c = a(l), out = new Map();
    for (const [o, ch] of [[1, up], ...Array.from({ length: s + 1 }, (_, u) => [-u, c * l ** u])]) { const t = Math.max(1, Math.min(tiers, cap + o)); out.set(t, (out.get(t) || 0) + ch); }
    return [...out].sort((x, y) => y[0] - x[0]);
  }
  // one listing as the game's item tooltip: name, type / hand, level, classes, base stats, options with tier and the
  // game's own text (window.BT_TIP), weapon properties, the cap tier box; price / seller / buy under it
  const PCT_STAT = /Pct|crit|cdr|move|lifesteal|aspd|block|bossRes|spellAmp|manaToHp/i;
  function tipCard(l) {
    const it = listingItem(l.itemId), eq = (window.BT_EQUIP || {})[it.core], T = window.BT_TIP, W = window.BT_WEAPON;
    const unit = Math.round(l.price / Math.max(1, l.qty));
    const foot = `<div class="tip-foot"><b>${g(unit)}<small> G${l.qty > 1 ? '/ชิ้น' : ''}</small></b>${l.qty > 1 ? `<span>×${g(l.qty)} = ${g(l.price)} G</span>` : ''}
      <span class="mk-seller">${esc(l.seller)} · ${ago(l.at)}</span>${buyBtn(l)}</div>`;
    const name = `<div class="tip-name r-${it.rarity || 'common'}">${esc(it.name)}</div>`;
    if (!eq || !T || !W) return `<div class="tip">${name}${foot}</div>`;
    const wt = (eq[7] === 'weapon' || eq[7] === 'offhand') && eq[2] !== eq[7] ? eq[2] : '';
    const hand = eq[7] === 'offhand' ? 'มือรอง' : eq[7] !== 'weapon' ? '' : T.twoHand.has(wt) ? 'สองมือ' : 'มือเดียว';
    const sub = [it.rarity ? `<i class="r-${it.rarity}">${RAR[it.rarity]}</i>` : '', esc(T.slots[eq[7]] || eq[7]), wt ? esc(W.names[wt] || wt) : '', hand ? `<b>${hand}</b>` : ''].filter(Boolean).join(' · ');
    const jobs = wt && W.classes[wt] ? W.classes[wt].map(j => W.jobs[j] || j).join(' / ') : '';
    const line = (k, v, big) => `<div class="tip-l${big ? ' big' : ''}"><span>${esc(k)}</span> : <b>${v}</b></div>`;
    const base = [['ATK', eq[1]], ['MATK', eq[3]], ['DEF', eq[4]]].filter(x => x[1]).map(([k, v]) => line(k, g(v * T.scale), 1)).join('')
      + Object.entries(eq[5] || {}).map(([k, v]) => line(k.toUpperCase(), `+${v}`)).join('')
      + Object.entries(eq[6] || {}).map(([k, v]) => line((T.gear[k] || [k])[0], `+${g(T.stat(k, v))}${PCT_STAT.test(k) ? '%' : ''}`)).join('');
    const aff = window.BT_AFFIX || {}, mult = T.focus[it.opts.filter(o => aff[o.id]).length] || 1;
    const opts = it.opts.map(o => { const a = aff[o.id], mod = a && a[2] || {};
      return `<div class="tip-aff${mod.t === 'proc' ? ' proc' : ''}"><u class="tb t${Math.min(8, o.tier)}">T${o.tier}</u><i>/T${it.cap}</i> ${esc(mod.t ? T.affixText(mod, o.value, mult) : optText(o))} <small>${esc(it.tierName(o))}</small></div>`; }).join('');
    const focused = mult !== 1 && it.opts.some(o => ((aff[o.id] || [])[2] || {}).t !== 'proc') ? `<div class="tip-aff perk">◆ Focused ×${mult} <small>(Affix ${it.opts.length} แถว — ค่าด้านบนคูณแล้ว)</small></div>` : '';
    const props = eq[7] === 'weapon' ? (W.props[eq[8]] || []).map(p => `<div class="tip-aff perk">⚙ <b>${esc(T.propNames[p] || p)}</b> · ${esc(T.props[p] || '')}</div>`).join('') : '';
    const ins = it.insight ? `<div class="tip-aff perk ins">✒ <b>Inscription</b> · ${esc(it.insight)}</div>` : '';
    const odds = tierOdds(it.cap).map(([t, c]) => `<i><u class="tb t${t}">T${t}</u> ${Math.round(c * 100)}%</i>`).join('');
    const ladder = TIER_LV.map((lv, i) => `<i class="${i < it.cap ? 'on' : ''}">T${i + 1} Lv ${lv}</i>`).join('');
    return `<div class="tip">${name}<div class="tip-sub">${sub}</div>
      <div class="tip-top"><span class="mk-ico r-${it.rarity || 'common'}">${icon(it.core)}</span><div>${it.lv > 1 ? `<p>เลเวล ${it.lv}</p>` : ''}${jobs ? `<p>${esc(jobs)}</p>` : ''}</div></div>
      ${base}${opts ? `<div class="tip-gap"></div>${opts}` : ''}${focused}${props}${ins}
      <details class="ib-tier"><summary>Tier Affix สูงสุดของชิ้นนี้: <u class="tb t${it.cap}">T${it.cap}</u>${it.cap < 8 ? ` <small>(ลุ้น T${it.cap + 1} 1%)</small>` : ''}</summary>
        <div class="ib-odds">โอกาสแต่ละแถว: ${odds}</div>
        <p>Affix ${it.opts.length} แถว (จำนวนแถวตายตัวตามความหายาก) · เลเวลไอเทม ${it.ilvl} — ดรอปจากมอนเลเวลสูงกว่า = Tier สูงกว่า · Reroll ที่ Smith สุ่มได้ถึง Tier เดียวกัน</p>
        <div class="ib-ladder">${ladder}</div></details>
      ${foot}</div>`;
  }
  // "ประกาศทั้งหมด" right panel: the picked listing as a full item inspector (same data as tipCard, larger layout)
  function inspCard(l) {
    const it = listingItem(l.itemId), eq = (window.BT_EQUIP || {})[it.core], T = window.BT_TIP, W = window.BT_WEAPON;
    const unit = Math.round(l.price / Math.max(1, l.qty)), rc = `r-${it.rarity || 'common'}`;
    const full = eq && T && W;
    const wt = full && (eq[7] === 'weapon' || eq[7] === 'offhand') && eq[2] !== eq[7] ? eq[2] : '';
    const hand = !full ? '' : eq[7] === 'offhand' ? 'มือรอง' : eq[7] !== 'weapon' ? '' : T.twoHand.has(wt) ? 'สองมือ' : 'มือเดียว';
    const chips = [it.rarity ? `<i class="mk-rar ${rc}">${RAR[it.rarity]}</i>` : '', full ? `<span>${esc(T.slots[eq[7]] || eq[7])}</span>` : '', wt ? `<span>${esc(W.names[wt] || wt)}</span>` : '', hand ? `<span class="hand">${hand}</span>` : '', it.cap ? `<span class="mk-cap t${it.cap}">สูงสุด T${it.cap}</span>` : ''].filter(Boolean).join('');
    const jobs = wt && W.classes[wt] ? W.classes[wt].map(j => W.jobs[j] || j).join(' / ') : '';
    const hero = `<div class="ins-hero ${rc}"><span class="mk-ico huge ${rc}">${icon(it.core)}</span>
      <div class="ins-hd"><b class="ins-name">${esc(it.name)}</b><div class="ins-chips">${chips}</div>
        ${it.lv > 1 || jobs ? `<div class="ins-req">${it.lv > 1 ? `<span>เลเวล <b>${it.lv}</b></span>` : ''}${jobs ? `<span>${esc(jobs)}</span>` : ''}</div>` : ''}</div></div>`;
    const price = `<div class="ins-price"><div><small>ราคา${l.qty > 1 ? 'ต่อชิ้น' : ''}</small><b>${g(unit)}<em> G</em></b>${l.qty > 1 ? `<span>×${g(l.qty)} = ${g(l.price)} G</span>` : ''}</div>
      <div class="ins-seller"><small>ผู้ขาย</small><b>${esc(l.seller)}</b><span>${ago(l.at)}</span></div>${buyBtn(l).replace('class="mk-buy"', 'class="mk-buy big"')}</div>`;
    if (!full) return `<div class="mk-insp">${hero}${price}</div>`;
    const tile = (k, v, big) => `<div class="ins-stat${big ? ' big' : ''}"><small>${esc(k)}</small><b>${v}</b></div>`;
    const stats = [['ATK', eq[1]], ['MATK', eq[3]], ['DEF', eq[4]]].filter(x => x[1]).map(([k, v]) => tile(k, g(v * T.scale), 1)).join('')
      + Object.entries(eq[5] || {}).map(([k, v]) => tile(k.toUpperCase(), `+${v}`)).join('')
      + Object.entries(eq[6] || {}).map(([k, v]) => tile((T.gear[k] || [k])[0], `+${g(T.stat(k, v))}${PCT_STAT.test(k) ? '%' : ''}`)).join('');
    const aff = window.BT_AFFIX || {}, mult = T.focus[it.opts.filter(o => aff[o.id]).length] || 1;
    const opts = it.opts.map(o => { const a = aff[o.id], mod = a && a[2] || {};
      return `<div class="ins-aff${mod.t === 'proc' ? ' proc' : ''}"><span class="ins-t"><u class="tb t${Math.min(8, o.tier)}">T${o.tier}</u><i>/T${it.cap}</i></span><span class="ins-txt">${esc(mod.t ? T.affixText(mod, o.value, mult) : optText(o))}</span><small>${esc(it.tierName(o))}</small></div>`; }).join('');
    const notes = [mult !== 1 && it.opts.some(o => ((aff[o.id] || [])[2] || {}).t !== 'proc') ? `<div>◆ <b>Focused ×${mult}</b> <small>Affix ${it.opts.length} แถว — ค่าด้านบนคูณแล้ว</small></div>` : '',
      ...(eq[7] === 'weapon' ? (W.props[eq[8]] || []).map(p => `<div>⚙ <b>${esc(T.propNames[p] || p)}</b> <span>${esc(T.props[p] || '')}</span></div>`) : []),
      it.insight ? `<div class="ins">✒ <b>Inscription</b> <span>${esc(it.insight)}</span></div>` : ''].filter(Boolean).join('');
    const odds = tierOdds(it.cap).map(([t, c]) => `<i><u class="tb t${t}">T${t}</u> ${Math.round(c * 100)}%</i>`).join('');
    const ladder = TIER_LV.map((lv, i) => `<i class="${i < it.cap ? 'on' : ''}">T${i + 1} Lv ${lv}</i>`).join('');
    return `<div class="mk-insp">${hero}${price}
      ${stats ? `<h5>ค่าพื้นฐาน</h5><div class="ins-stats">${stats}</div>` : ''}
      ${opts ? `<h5>Affix <small>${it.opts.length} แถว</small></h5><div class="ins-affs">${opts}</div>` : ''}
      ${notes ? `<div class="ins-notes">${notes}</div>` : ''}
      <details class="ib-tier"><summary>Tier Affix สูงสุดของชิ้นนี้: <u class="tb t${it.cap}">T${it.cap}</u>${it.cap < 8 ? ` <small>(ลุ้น T${it.cap + 1} 1%)</small>` : ''}</summary>
        <div class="ib-odds">โอกาสแต่ละแถว: ${odds}</div>
        <p>Affix ${it.opts.length} แถว (จำนวนแถวตายตัวตามความหายาก) · เลเวลไอเทม ${it.ilvl} — ดรอปจากมอนเลเวลสูงกว่า = Tier สูงกว่า · Reroll ที่ Smith สุ่มได้ถึง Tier เดียวกัน</p>
        <div class="ib-ladder">${ladder}</div></details></div>`;
  }
  // "เช็คออปชัน": a listing passes when it has every wanted option at (at least) its tier
  const wantHit = o => st.want.some(w => w.id === o.id && o.tier >= w.t);
  const wantOk = it => st.want.every(w => it.opts.some(o => o.id === w.id && o.tier >= w.t));
  const optRows = it => (it.opts.length || it.insight) ? `<div class="mk-lopts">${it.opts.map(o => `<div class="mk-lopt t${Math.min(8, o.tier)}${wantHit(o) ? ' hit' : ''}"><b>T${o.tier}</b><span>${esc(optText(o))}</span><small>${esc(it.tierName(o))}</small></div>`).join('')}${it.insight ? `<div class="mk-lopt ins"><b>✦</b><span>${esc(it.insight)}</span><small>insight</small></div>` : ''}</div>` : '';
  const buyBtn = l => `<button type="button" class="mk-buy" data-buy="${l.id}" title="ซื้อประกาศนี้ (ของส่งเข้าจดหมายในเกม)">ซื้อ</button>`;
  function listingCard(l) {
    const it = listingItem(l.itemId), unit = Math.round(l.price / Math.max(1, l.qty));
    return `<div class="mk-lcard r-${it.rarity || 'common'}${st.lsel && st.lsel.id === l.id ? ' sel' : ''}" data-lid="${l.id}" title="คลิกเพื่อดูรายละเอียดไอเทมนี้ทางขวา">
      <span class="mk-ico r-${it.rarity || 'common'}">${icon(it.core)}</span>
      <div class="mk-lmain"><b class="mk-lname r-${it.rarity || 'common'}">${esc(it.name)}</b>
        <div class="mk-lmeta">${it.rarity ? `<i class="mk-rar r-${it.rarity}">${RAR[it.rarity]}</i>` : ''}${it.lv ? `<span class="mk-pill">Lv ${it.lv}</span>` : ''}${it.cap ? `<span class="mk-cap t${it.cap}" title="Tier Affix สูงสุดของชิ้นนี้ · เลเวลไอเทม ${it.ilvl}">สูงสุด T${it.cap}</span>` : ''}</div>
        ${optRows(it)}</div>
      <div class="mk-lprice"><b>${g(unit)}<small> G${l.qty > 1 ? '/ชิ้น' : ''}</small></b>${l.qty > 1 ? `<span>×${g(l.qty)} = ${g(l.price)} G</span>` : ''}<span class="mk-seller">${esc(l.seller)}</span><small>${ago(l.at)}</small>${buyBtn(l)}</div>
    </div>`;
  }
  const MAX_ALL_PAGES = 80;   // "every page" stops here (8,000 listings) — narrow the filters for more
  async function listingsPage(page) {
    const p = filterParams(); p.set('sort', st.lsort); p.set('p', page);
    let err = null;
    for (let i = 0; i < 3; i++) {
      try { const r = await (await fetch('/api/market/listings?' + p)).json(); if (r.ok) return r; err = new Error(r.error || 'อ่านประกาศไม่สำเร็จ'); } catch (e) { err = e; }
      await new Promise(z => setTimeout(z, 2000 * (i + 1)));
    }
    throw err;
  }
  // who buys: a character of a game tab with the helper (the item goes to that character's mail)
  async function loadBuyers() {
    try { const r = await (await fetch('/api/market/buyers')).json(); st.buyers = r.ok ? r.buyers : []; } catch (e) { st.buyers = []; }
    if (!st.buyers.some(b => b.tabId === st.buyerTab)) st.buyerTab = st.buyers[0] ? st.buyers[0].tabId : '';
  }
  const buyer = () => st.buyers.find(b => b.tabId === st.buyerTab);
  function buyerBar() {
    if (!st.buyers.length) return `<div class="mk-buyer off">ซื้อไม่ได้: ไม่มีแท็บเกมที่โหลด helper</div>`;
    return `<div class="mk-buyer">ซื้อด้วย ${st.buyers.length > 1 ? `<select class="mk-input" id="mk-buyer">${st.buyers.map(b => `<option value="${esc(b.tabId)}" ${b.tabId === st.buyerTab ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : `<b>${esc(buyer().name)}</b>`}
      <span>Gold <b class="gold">${g(buyer().gold)}</b></span><small>ของที่ซื้อส่งเข้าจดหมายในเกม</small></div>`;
  }
  async function buyListing(l) {
    await loadBuyers();
    const b = buyer();
    if (!b) return alert('ซื้อไม่ได้: ไม่มีแท็บเกมที่โหลด helper');
    const it = listingItem(l.itemId);
    if (l.price > b.gold) return alert(`Gold ไม่พอ: ต้องใช้ ${g(l.price)} G แต่ ${b.name} มี ${g(b.gold)} G`);
    if (!confirm(`ซื้อ ${it.name}${l.qty > 1 ? ` ×${l.qty}` : ''}\nราคา ${g(l.price)} G จาก ${l.seller}\n\nด้วยตัวละคร ${b.name}\nGold ${g(b.gold)} → ${g(b.gold - l.price)}\n\nของจะส่งเข้าจดหมายในเกม`)) return;
    const r = await (await fetch('/api/market/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: b.tabId, id: l.id }) })).json().catch(() => ({ ok: false, error: 'ส่งคำสั่งไม่สำเร็จ' }));
    if (r.ok && st.lsel && st.lsel.id === l.id) st.lsel = null;
    alert(r.ok ? `ซื้อสำเร็จ — ${it.name} ส่งเข้าจดหมายของ ${b.name} แล้ว` : `ซื้อไม่สำเร็จ: ${r.error || ''}`);
    await loadBuyers();
    if (st.sel) loadItem();
    if (st.view === 'list') { renderDetail(); loadListings(!!st.lall); }
  }
  async function loadListings(keepAll) {
    const my = ++st.req;
    st.lloading = true; st.lerror = ''; st.lprog = ''; renderListings();
    if (SUBS[st.cat] && !keepAll) loadCounts();
    try {
      if (!st.capF && !st.want.length) {
        st.lall = null;
        const r = await listingsPage(st.lpage);
        if (my !== st.req) return;
        st.listings = r.listings || []; st.ltotal = r.total || 0;
      } else {
        if (!keepAll || !st.lall) {
          const first = await listingsPage(0), pages = Math.min(MAX_ALL_PAGES, Math.ceil((first.total || 0) / 100));
          const all = [...(first.listings || [])];
          for (let pg = 1; pg < pages; pg++) {
            if (my !== st.req) return;
            st.lprog = `ดึงประกาศทุกหน้า… ${pg + 1}/${pages}`; renderListings();
            await new Promise(z => setTimeout(z, 350));
            all.push(...((await listingsPage(pg)).listings || []));
          }
          if (my !== st.req) return;
          st.lall = { rows: all, total: first.total || 0, cut: Math.ceil((first.total || 0) / 100) > MAX_ALL_PAGES };
        }
        const rows = st.lall.rows.filter(l => { const it = listingItem(l.itemId); return (!st.capF || it.cap === st.capF) && wantOk(it); });
        st.ltotal = rows.length; st.listings = rows.slice(st.lpage * 100, st.lpage * 100 + 100);
      }
      st.lat = Date.now();
    } catch (e) { if (my !== st.req) return; st.lerror = e.message; st.listings = []; }
    st.lloading = false; renderListings(); renderAt();
  }
  function renderListings() {
    if (st.view !== 'list') return;
    const pages = Math.max(1, Math.ceil(st.ltotal / 100));
    $('mk-count').textContent = st.lloading ? (st.lprog || 'กำลังโหลดประกาศ…') : st.lerror ? '⚠ ' + st.lerror
      : `${g(st.ltotal)} ประกาศ${st.capF || st.want.length ? `${st.capF ? ` ที่สูงสุด T${st.capF}` : ''}${st.want.length ? ` ที่ตรงออปชัน` : ''} (จาก ${g(st.lall ? st.lall.rows.length : 0)}${st.lall && st.lall.cut ? ` — ดึงแค่ ${MAX_ALL_PAGES} หน้าแรก กรองหมวดเพิ่มเพื่อให้ครบ` : ''})` : ''} · หน้า ${st.lpage + 1}/${pages} (หน้าละ 100)`;
    $('mk-lists').innerHTML = st.listings.length ? st.listings.map(listingCard).join('') : `<div class="mk-empty small">${st.lloading ? 'กำลังโหลด…' : 'ไม่มีประกาศ'}</div>`;
    const win = [...new Set([0, st.lpage - 2, st.lpage - 1, st.lpage, st.lpage + 1, st.lpage + 2, pages - 1])].filter(x => x >= 0 && x < pages).sort((a, b) => a - b);
    $('mk-pager').innerHTML = pages > 1 ? `<button type="button" data-lpg="${st.lpage - 1}" ${st.lpage ? '' : 'disabled'}>‹</button>`
      + win.map((x, i) => (i && x - win[i - 1] > 1 ? '<span class="mk-gap">…</span>' : '') + `<button type="button" data-lpg="${x}" class="${x === st.lpage ? 'on' : ''}">${x + 1}</button>`).join('')
      + `<button type="button" data-lpg="${st.lpage + 1}" ${st.lpage < pages - 1 ? '' : 'disabled'}>›</button>` : '';
  }
  const reload = () => (st.view === 'list' ? (st.lpage = 0, st.lall = null, loadListings()) : loadBoard());
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
          <label title="โหลดหน้าที่เปิดอยู่ใหม่เองตามเวลาที่ตั้ง (เฉพาะตอนเปิดแท็บตลาด)">อัพเดตอัตโนมัติ <select class="mk-input" id="mk-auto">${AUTOS.map(([v, l]) => `<option value="${v}" ${v === st.auto ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <span class="mk-at" id="mk-at"></span>
          <button type="button" class="mk-icon" id="mk-reload" title="โหลดใหม่">⟳</button></div>
        <div class="mk-capf" id="mk-capf" hidden><span>Tier สูงสุดของชิ้น</span><button type="button" data-cap="0" class="all on">ทุก T</button>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button type="button" data-cap="${n}" class="t${n}">T${n}</button>`).join('')}<small>กรองจากทุกหน้าของตัวกรองที่เลือก</small></div>
        <div class="mk-want" id="mk-want" hidden></div>
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
  // "เช็คออปชัน" panel: the wanted options (affix + minimum tier), a row to add one
  function renderWant() {
    const used = new Set(st.want.map(w => w.id));
    $('mk-want').innerHTML = `<span>เช็คออปชัน</span>${st.want.map((w, i) => `<span class="mk-wchip t${w.t}">${esc(AFFIX_NAME[w.id] || w.id)} <b>T${w.t}+</b><button type="button" data-wdel="${i}" title="เอาออก">×</button></span>`).join('')}
      ${st.want.length < 6 ? `<select class="mk-input" id="mk-wid"><option value="">+ เลือกออปชัน…</option>${AFFIXES.filter(([v]) => !used.has(v)).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <select class="mk-input" id="mk-wt">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">T${n}+</option>`).join('')}</select>
      <button type="button" data-wadd="1">เพิ่ม</button>` : ''}${st.want.length ? `<button type="button" data-wclear="1">ล้าง</button>` : ''}
      <small>${st.want.length ? 'แสดงเฉพาะประกาศที่มีครบทุกออปชัน · ' : ''}เช็คจากทุกหน้าของตัวกรองที่เลือก</small>`;
    $('mk-want').classList.toggle('active', !!st.want.length);
  }
  // when the open view was last loaded
  function renderAt() {
    const t = st.view === 'list' ? st.lat : st.at;
    $('mk-at').textContent = t ? `อัพเดต ${ago(t)}` : '';
    $('mk-at').title = t ? new Date(t).toLocaleTimeString('th-TH') : '';
  }

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
    st.loading = false; st.progress = ''; renderBoard(); renderAt();
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
    // "ประกาศทั้งหมด": the listing picked on the left as a full item inspector
    if (st.view === 'list') {
      el.innerHTML = st.lsel ? inspCard(st.lsel) + buyerBar() : '<div class="mk-empty"><span class="mk-empty-ico">⇠</span><b>เลือกไอเทมจากด้านซ้าย</b></div>';
      return;
    }
    if (!st.sel) { el.innerHTML = '<div class="mk-empty"><b>เลือกไอเทมทางซ้าย</b><span>เพื่อดูกราฟราคาและประกาศขาย</span></div>'; return; }
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
      ${buyerBar()}
      <div class="mk-tips">${(v.listings || []).length ? (v.listings || []).map(tipCard).join('') : '<div class="mk-empty small">ไม่มีประกาศขาย</div>'}</div>`;
  }

  // events
  let qTimer = null;
  $('mk-q').oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = e.target.value.trim(); reload(); }, 400); };
  $('mk-sort').onchange = e => {
    if (st.view === 'list') { st.lsort = e.target.value; st.lpage = 0; st.lall = null; loadListings(); return; }
    st.sort = e.target.value; st.rows = sortRows(st.rows); st.page = 0; renderBoard();
  };
  // view switch: price board / every listing
  $('mk-views').onclick = e => {
    const b = e.target.closest('button[data-view]'); if (!b || b.dataset.view === st.view) return;
    st.view = b.dataset.view; for (const x of $('mk-views').children) x.classList.toggle('on', x === b);
    $('mk-table').hidden = st.view === 'list'; $('mk-lists').hidden = st.view !== 'list'; $('mk-capf').hidden = st.view !== 'list'; $('mk-want').hidden = st.view !== 'list';
    $('mk-sort').innerHTML = (st.view === 'list' ? LSORTS : SORTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('mk-sort').value = st.view === 'list' ? st.lsort : st.sort;
    if (st.view === 'list') loadListings(); else renderBoard();
    renderDetail(); renderAt();
  };
  $('mk-want').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.wadd) { const id = $('mk-wid').value; if (!id) return $('mk-wid').focus(); st.want.push({ id, t: Number($('mk-wt').value) || 1 }); }
    else if (b.dataset.wdel) st.want.splice(Number(b.dataset.wdel), 1);
    else if (b.dataset.wclear) st.want = [];
    else return;
    savePrefs(); renderWant(); st.lpage = 0; loadListings(!!st.lall);   // the pages already loaded for the same filters are reused
  };
  $('mk-auto').onchange = e => { st.auto = Number(e.target.value) || 0; savePrefs(); };
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
  $('mk-pager').addEventListener('click', e => { const b = e.target.closest('button[data-lpg]'); if (!b || b.disabled) return; st.lpage = Number(b.dataset.lpg); loadListings(!!st.capF); $('mk-lists').scrollTop = 0; });
  $('mk-pager').onclick = e => { const b = e.target.closest('button[data-pg]'); if (!b || b.disabled) return; st.page = Number(b.dataset.pg); renderBoard(); };
  $('mk-rows').onclick = e => {
    const b = e.target.closest('.mk-row'); if (!b) return;
    st.sel = st.rows.find(r => r.key === b.dataset.key); st.item = null; renderBoard(); loadItem();
  };
  $('mk-capf').onclick = e => {
    const b = e.target.closest('button[data-cap]'); if (!b) return;
    st.capF = Number(b.dataset.cap); st.lpage = 0;
    for (const x of $('mk-capf').querySelectorAll('button')) x.classList.toggle('on', x === b);
    loadListings(!!st.lall);   // the pages already loaded for the same filters are reused
  };
  // a listing card shows that listing's item card on the right
  $('mk-lists').onclick = e => {
    const bb = e.target.closest('button[data-buy]');
    if (bb) { const l = st.listings.find(x => String(x.id) === bb.dataset.buy); if (l) buyListing(l); return; }
    const c = e.target.closest('.mk-lcard'); if (!c) return;
    const l = st.listings.find(x => String(x.id) === c.dataset.lid); if (!l) return;
    st.lsel = l;
    for (const x of $('mk-lists').children) x.classList.toggle('sel', x === c);
    renderDetail();
  };
  $('mk-detail').addEventListener('change', e => { if (e.target.id === 'mk-buyer') { st.buyerTab = e.target.value; renderDetail(); } });
  $('mk-detail').addEventListener('click', e => {
    const bb = e.target.closest('button[data-buy]'); if (!bb) return;
    const l = st.view === 'list' ? st.lsel : ((st.item && st.item.listings) || []).find(x => String(x.id) === bb.dataset.buy); if (l) buyListing(l);
  });
  $('mk-detail').onclick = e => { const b = e.target.closest('button[data-range]'); if (!b) return; st.range = b.dataset.range; st.item = null; loadItem(); };

  // first load when the tab is opened; while it is open the open view reloads itself every `st.auto` minutes
  // (a full read is many requests; a failed load waits the same interval before the next try)
  const open = () => pane.classList.contains('active');
  const boardLoad = () => { st.tried = Date.now(); loadBoard(); };
  document.querySelectorAll('.tab-btn[data-tab="market"]').forEach(b => b.addEventListener('click', () => { loadBuyers(); if (!st.at) boardLoad(); }));
  setInterval(() => {
    if (!open()) return;
    renderAt();
    if (!st.auto) return;
    const due = t => Date.now() - (t || 0) > st.auto * 60000;
    if (st.view === 'list') { if (!st.lloading && due(Math.max(st.lat, st.ltried || 0))) { st.ltried = Date.now(); loadListings(); } }
    else if (!st.loading && due(Math.max(st.at, st.tried || 0))) boardLoad();
  }, 5000);
  renderWant();
  if (open()) boardLoad();
})();
