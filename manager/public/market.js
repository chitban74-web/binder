// Market tab — the game's market board in the web page (server: GET /api/market/board, /api/market/item).
(() => {
  const pane = document.getElementById('market-pane');
  if (!pane) return;
  const ICON = 'https://play.bindertowngame.com/sprites/icons/item/';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = n => (Number(n) || 0).toLocaleString('en-US');
  const ago = t => { if (!t) return '-'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'เมื่อกี้' : s < 3600 ? `${Math.round(s / 60)} นาทีก่อน` : s < 86400 ? `${Math.round(s / 3600)} ชม.ก่อน` : `${Math.round(s / 86400)} วันก่อน`; };
  const CATS = [['', 'ทั้งหมด'], ['weapon', 'อาวุธ'], ['gear', 'ของสวมใส่'], ['use', 'ของใช้'], ['mat', 'วัตถุดิบ'], ['card', 'การ์ด']];
  const SORTS = [['def', 'ลงล่าสุด'], ['vol', 'ซื้อขายเยอะสุด'], ['asc', 'ราคาต่ำ → สูง'], ['desc', 'ราคาสูง → ต่ำ'], ['up', 'ราคาขึ้นแรงสุด'], ['down', 'ราคาลงแรงสุด']];
  const RAR = { common: 'ธรรมดา', magic: 'Magic', rare: 'Rare', epic: 'Epic', unique: 'Unique', legendary: 'Legendary' };
  const PAGE = 15;
  let st = { q: '', cat: '', sort: 'def', rows: [], total: 0, page: 0, loading: false, error: '', sel: null, item: null, range: '7d', itemLoading: false, at: 0 };

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
  const icon = base => `<img src="${ICON}${encodeURIComponent(base)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const chg = c => c == null || !isFinite(c) ? '' : `<i class="mk-chg ${c > 0.05 ? 'up' : c < -0.05 ? 'down' : 'flat'}">${c > 0.05 ? '▲' : c < -0.05 ? '▼' : '•'} ${Math.abs(c).toFixed(1)}%</i>`;

  pane.innerHTML = `
    <div class="mk-wrap">
      <section class="mk-board">
        <div class="mk-tools">
          <input class="mk-input" id="mk-q" type="search" placeholder="🔍 ค้นหาไอเทม…">
          <div class="mk-cats" id="mk-cats">${CATS.map(([v, l]) => `<button type="button" data-cat="${v}" class="${v === '' ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="mk-bar"><span id="mk-count">กำลังโหลด…</span>
          <label>เรียง <select class="mk-input" id="mk-sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <button type="button" class="mk-icon" id="mk-reload" title="โหลดใหม่">⟳</button></div>
        <div class="mk-table">
          <div class="mk-head"><span>ไอเทม</span><span class="r">ราคาถูกสุด</span><span class="r">ในตลาด</span><span class="r">ขายล่าสุด</span></div>
          <div id="mk-rows"></div>
        </div>
        <div class="mk-pager" id="mk-pager"></div>
      </section>
      <section class="mk-detail" id="mk-detail"><div class="mk-empty"><b>เลือกไอเทมทางซ้าย</b><span>เพื่อดูกราฟราคาและประกาศขาย</span></div></section>
    </div>`;
  const $ = id => document.getElementById(id);

  async function loadBoard() {
    st.loading = true; st.error = ''; renderBoard();
    const p = new URLSearchParams({ sort: st.sort }); if (st.q) p.set('q', st.q); if (st.cat) p.set('cat', st.cat);
    try {
      const r = await (await fetch('/api/market/board?' + p)).json();
      if (!r.ok) throw new Error(r.error || 'อ่านตลาดไม่สำเร็จ');
      st.rows = r.rows || []; st.total = r.total || 0; st.page = 0; st.at = Date.now();
    } catch (e) { st.error = e.message; st.rows = []; }
    st.loading = false; renderBoard();
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
    $('mk-count').textContent = st.loading ? 'กำลังโหลด…' : st.error ? '⚠ ' + st.error
      : `${g(st.total)} ชนิดในตลาด${st.total > st.rows.length ? ` · แสดง ${st.rows.length} แรก` : ''}`;
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
          <b>${g(Math.round(l.price / Math.max(1, l.qty)))}<small> G/ชิ้น</small></b>
          <span>×${g(l.qty)}</span><span class="r">${g(l.price)} G</span><span class="mk-seller">${esc(l.seller)}</span><small>${ago(l.at)}</small></div>`).join('')
        : '<div class="mk-empty small">ไม่มีประกาศขาย</div>'}</div>`;
  }

  // events
  let qTimer = null;
  $('mk-q').oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = e.target.value.trim(); loadBoard(); }, 400); };
  $('mk-sort').onchange = e => { st.sort = e.target.value; loadBoard(); };
  $('mk-reload').onclick = loadBoard;
  $('mk-cats').onclick = e => { const b = e.target.closest('button[data-cat]'); if (!b) return; st.cat = b.dataset.cat; for (const x of $('mk-cats').children) x.classList.toggle('on', x === b); loadBoard(); };
  $('mk-pager').onclick = e => { const b = e.target.closest('button[data-pg]'); if (!b || b.disabled) return; st.page = Number(b.dataset.pg); renderBoard(); };
  $('mk-rows').onclick = e => {
    const b = e.target.closest('.mk-row'); if (!b) return;
    st.sel = st.rows.find(r => r.key === b.dataset.key); st.item = null; renderBoard(); loadItem();
  };
  $('mk-detail').onclick = e => { const b = e.target.closest('button[data-range]'); if (!b) return; st.range = b.dataset.range; st.item = null; loadItem(); };

  // first load when the tab is opened; refresh every 60 s while it is open
  const open = () => pane.classList.contains('active');
  document.querySelectorAll('.tab-btn[data-tab="market"]').forEach(b => b.addEventListener('click', () => { if (!st.at) loadBoard(); }));
  setInterval(() => { if (open() && Date.now() - st.at > 60000 && !st.loading) loadBoard(); }, 5000);
  if (open()) loadBoard();
})();
