// Auto-update panel adapted from Aetheria's Manager UI for Binder Town's Git updater.
(function () {
  'use strict';

  const STATE_LABEL = {
    'up-to-date': ['', 'พร้อมใช้งาน'],
    done: ['', 'โหลด helper ใหม่แล้ว'],
    outdated: ['', 'มีอัปเดต'],
    waiting: ['⏳', 'รอจังหวะ'],
    reloading: ['', 'กำลังโหลด helper ใหม่'],
    resuming: ['▶', 'กำลังทำงานต่อ'],
    error: ['', 'มีปัญหา'],
    offline: ['', 'ปิดอยู่']
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ago = ts => {
    if (!ts) return '--';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} ชม.ที่แล้ว` : `${Math.round(h / 24)} วันที่แล้ว`;
  };

  let status = null;
  let firstSeen = null;
  let reloadPending = false;
  let activeFilter = 'all';
  let panel, pill, wrap;

  function mount() {
    const actions = document.querySelector('.header-actions');
    pill = document.getElementById('btn-update');
    if (!actions || !pill || panel) return;
    wrap = document.createElement('div');
    wrap.className = 'bu-wrap';
    actions.insertBefore(wrap, pill);
    wrap.appendChild(pill);
    panel = document.createElement('div');
    panel.className = 'bu-panel';
    panel.hidden = true;
    wrap.appendChild(panel);
    pill.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) load();
    }, true);
    document.addEventListener('click', event => { if (!wrap.contains(event.target)) panel.hidden = true; });
    panel.addEventListener('click', onPanelClick);
  }

  async function load() {
    try {
      const response = await fetch('/api/status');
      const body = await response.json();
      if (!body.update) return;
      const liveTabs = (body.browsers || []).flatMap(browser => browser.tabs || []);
      const expectedVersion = body.helperVersion || 'unknown';
      const profiles = body.gameProfiles || [];
      const clients = (profiles.length ? profiles : liveTabs.map(tab => ({ id: tab.profileId || tab.id, name: tab.title || 'โปรไฟล์' }))).map(profile => {
        const tab = liveTabs.find(item => item.profileId === profile.id || (!profiles.length && item.id === profile.id));
        const ready = !!tab && tab.state === 'helper' && !!tab.status;
        const version = tab?.status?.version || '';
        const outdated = ready && (!version || (expectedVersion !== 'unknown' && version !== expectedVersion));
        const state = !tab ? 'offline' : !ready ? 'waiting' : outdated ? 'outdated' : 'up-to-date';
        const note = state === 'offline' ? 'ปิดอยู่ · จะตรวจเวอร์ชันเมื่อเปิดโปรไฟล์'
          : state === 'waiting' ? 'เปิดอยู่ · กำลังรอ Helper รายงานเวอร์ชัน'
            : outdated ? `เวอร์ชัน ${version || 'ไม่ระบุ'} · ต้อง sync เป็น ${expectedVersion}`
              : `Binder Helper v${version} · sync แล้ว`;
        return {
          id: tab?.id || '',
          profileId: profile.id,
          version,
          expectedVersion,
          name: profile.name || tab?.title || 'โปรไฟล์เกม',
          state,
          note
        };
      });
      status = { ...body.update, helperVersion: expectedVersion, clients };
      watchForNewBuild();
      render();
    } catch (e) { }
  }

  function userBusy() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    if (document.querySelector('.modal-overlay.active, .im-market, .modal.active')) return true;
    const modal = document.getElementById('char-detail-modal');
    return Boolean(modal && modal.style.display && modal.style.display !== 'none');
  }

  function watchForNewBuild() {
    if (!firstSeen) { firstSeen = { commit: status.commit, serverStartedAt: status.serverStartedAt }; return; }
    if (status.commit === firstSeen.commit && status.serverStartedAt === firstSeen.serverStartedAt) return;
    reloadPending = true;
    if (!userBusy() && !document.querySelector('.bu-reload-toast')) {
      document.body.insertAdjacentHTML('beforeend', '<div class="bu-reload-toast"> Binder Town อัปเดตแล้ว — กำลังโหลดหน้าใหม่...</div>');
      setTimeout(() => location.reload(), 1500);
    }
  }

  function renderManagerCard() {
    const pending = Number(status.behind) || 0;
    return `
      <div class="bu-card ${pending || reloadPending ? 'bu-card-warn' : ''}">
        <div class="bu-card-head">
          <div class="bu-card-title">
            <span> ตัวโปรแกรม Binder Town</span>
            <span class="bu-badge ${pending || reloadPending ? 'warn' : 'ok'}">
              ${reloadPending ? ' รอโหลดหน้าใหม่' : pending ? ` มีอัปเดต ${pending} commit` : ' ล่าสุดแล้ว'}
            </span>
          </div>
          <button type="button" class="bu-switch ${status.autoPull ? 'on' : ''}" data-bu="mtoggle" title="เปิด/ปิด Auto-update ของ Binder Town" ${status.main ? 'disabled' : ''}><span></span></button>
        </div>
        <div class="bu-card-body">
          <div class="bu-commit-line"><code>${esc(status.commit || '—')}</code><span>${esc(status.date || '')}</span></div>
          <div class="bu-meta-line">
            ${pending
              ? `<span class="bu-pending-list">${(status.incoming || []).slice(0, 5).map(esc).join('<br>')}${(status.incoming || []).length > 5 ? '<br>…' : ''}</span>`
              : `<span>${status.main ? 'เครื่องหลัก · ไม่ดึงอัปเดตอัตโนมัติ' : 'ตรวจ GitHub ทุก 3 นาที · อัปเดตแบบ fast-forward เท่านั้น'}</span>`}
            ${status.lastApplied ? `<span>· อัปเดตล่าสุด ${ago(status.lastApplied.at)}</span>` : ''}
          </div>
          ${status.error ? `<div class="bu-error"> ${esc(status.error)}</div>` : ''}
          ${pending ? `<div class="bu-card-actions"><button type="button" class="bu-action-btn primary" data-bu="mapply">⬇ อัปเดต Binder Town ตอนนี้</button></div>` : ''}
        </div>
      </div>`;
  }

  function render() {
    if (!pill || !status) return;
    if (reloadPending && !userBusy() && !document.querySelector('.bu-reload-toast')) watchForNewBuild();
    const clients = status.clients || [];
    const pendingClients = clients.filter(c => ['outdated', 'waiting', 'reloading', 'resuming'].includes(c.state));
    const okClients = clients.filter(c => ['up-to-date', 'done'].includes(c.state));
    const errClients = clients.filter(c => c.state === 'error');
    const pending = pendingClients.length;
    const hasError = errClients.length > 0 || Boolean(status.error);
    const tone = !status.autoPull ? 'off' : hasError ? 'err' : (status.busy || pending || status.behind) ? 'busy' : 'ok';
    pill.className = `btn btn-ghost bu-pill ${tone}`;
    pill.querySelector('.bu-text').textContent =
      !status.autoPull ? 'Auto-update ปิด'
        : hasError ? 'Auto-update มีปัญหา'
          : status.busy || pending ? `กำลังอัปเดต (${pending || 1})`
            : status.behind ? `มีอัปเดต (${status.behind})`
              : reloadPending ? 'มีหน้าเว็บเวอร์ชันใหม่'
                : 'Auto-update';

    if (panel.hidden) return;
    const filesPending = Number(status.behind) || 0;
    const filteredClients = activeFilter === 'pending' ? pendingClients : activeFilter === 'ok' ? okClients : activeFilter === 'error' ? errClients : clients;
    panel.innerHTML = `
      <div class="bu-top-bar">
        <div class="bu-top-title"><b> ระบบอัปเดตอัตโนมัติ</b><small>เช็กล่าสุด ${ago(status.checkedAt)}</small></div>
        <div class="bu-top-actions">
          <button type="button" class="bu-action-btn primary" data-bu="check" title="เช็กเวอร์ชันล่าสุดและติดตั้งตามการตั้งค่า"> เช็กและอัปเดตตอนนี้</button>
          <button type="button" class="bu-close-btn" data-bu="close" title="ปิดหน้าต่าง"></button>
        </div>
      </div>
      <div class="bu-card">
        <div class="bu-card-head">
          <div class="bu-card-title"><span> Binder Helper ในหน้าต่างเกม <em class="bu-ver">v${esc(status.helperVersion || '—')}</em></span>
            <span class="bu-badge ${status.autoReloadHelpers ? 'ok' : 'warn'}">${status.autoReloadHelpers ? ' โหลดเวอร์ชันใหม่อัตโนมัติ' : '⏸ โหลดเอง'}</span>
          </div>
          <button type="button" class="bu-switch ${status.autoReloadHelpers ? 'on' : ''}" data-bu="toggle" title="เปิด/ปิดการโหลด Helper ใหม่หลังอัปเดต"><span></span></button>
        </div>
        <div class="bu-card-body">
          <div class="bu-meta-line">อ่านเวอร์ชันจาก Helper ที่กำลังทำงานในแต่ละโปรไฟล์ แล้วเทียบกับไฟล์ในโค้ด v${esc(status.helperVersion || '—')}</div>
          <div class="bu-meta-line">เมื่อมีการเปลี่ยนไฟล์ helper/ ใน Git ระบบจะโหลด Helper ใหม่ในหน้าต่างเกมที่เปิดอยู่ โดยคงสถานะบอทไว้</div>
          ${filesPending && !status.autoPull ? `<div class="bu-meta-line" style="color:#fcd34d;">มี ${filesPending} commit รอติดตั้งก่อนโหลด Helper</div>` : ''}
          ${(pending > 0 || errClients.length > 0) ? `<div class="bu-card-actions"><button type="button" class="bu-action-btn warn" data-bu="force-all"> โหลด Helper ใหม่ทุกจอที่เปิดอยู่ (${clients.filter(c => c.id).length} จอ)</button></div>` : ''}
        </div>
      </div>
      ${renderManagerCard()}
      <div class="bu-filter-bar">
        <button type="button" class="bu-filter-tab ${activeFilter === 'all' ? 'active' : ''}" data-bu-filter="all">ทั้งหมด <span>${clients.length}</span></button>
        <button type="button" class="bu-filter-tab ${activeFilter === 'pending' ? 'active' : ''} ${pending ? 'has-warn' : ''}" data-bu-filter="pending">รออัปเดต <span>${pending}</span></button>
        <button type="button" class="bu-filter-tab ${activeFilter === 'ok' ? 'active' : ''}" data-bu-filter="ok">พร้อมใช้งาน <span>${okClients.length}</span></button>
        ${errClients.length ? `<button type="button" class="bu-filter-tab ${activeFilter === 'error' ? 'active' : ''} has-err" data-bu-filter="error">มีปัญหา <span>${errClients.length}</span></button>` : ''}
      </div>
      <div class="bu-clients">
        ${filteredClients.length ? filteredClients.map(c => {
          const [icon, label] = STATE_LABEL[c.state] || ['•', c.state];
          return `<div class="bu-client ${esc(c.state)}" title="${esc(c.note || label)}"><div class="bu-client-main"><span class="bu-client-name">${icon} ${esc(c.name)}</span><small class="bu-client-note">${esc(c.note || label)}</small></div>${c.id ? `<button type="button" class="bu-client-reload" data-bu="reload-one" data-id="${esc(c.id)}" title="โหลด Helper ใหม่ใน ${esc(c.name)}"></button>` : ''}</div>`;
        }).join('') : `<div class="bu-muted" style="grid-column:1/-1;text-align:center;padding:16px 8px;">ไม่มีรายการจอในหมวดนี้</div>`}
      </div>
      <div class="bu-foot"><small> กดปุ่ม  ท้ายรายชื่อเพื่อโหลด Helper ใหม่เฉพาะจอนั้น</small><button type="button" class="btn btn-ghost btn-sm" data-bu="check">เช็กตอนนี้</button></div>`;
  }

  async function reloadClient(id, button) {
    if (!id) return;
    if (button) { button.disabled = true; button.textContent = '⏳'; }
    try { await fetch(`/api/tab/${encodeURIComponent(id)}/reload`, { method: 'POST' }); }
    finally { setTimeout(load, 800); }
  }

  async function onPanelClick(event) {
    const filterBtn = event.target.closest('[data-bu-filter]');
    if (filterBtn) { event.stopPropagation(); activeFilter = filterBtn.dataset.buFilter || 'all'; render(); return; }
    const button = event.target.closest('[data-bu]');
    if (!button) return;
    event.stopPropagation();
    const action = button.dataset.bu;
    if (action === 'close') panel.hidden = true;
    else if (action === 'toggle' || action === 'mtoggle') {
      button.disabled = true;
      const body = action === 'toggle'
        ? { autoReloadHelpers: !status.autoReloadHelpers }
        : { autoPull: !status.autoPull };
      const response = await fetch('/api/update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      if (response && !response.ok) { const result = await response.json().catch(() => ({})); alert(result.error || 'บันทึกการตั้งค่าไม่สำเร็จ'); }
      await load();
    } else if (action === 'check') {
      button.disabled = true; button.textContent = '⏳ กำลังเช็ก...';
      await fetch('/api/update/check', { method: 'POST' }).catch(() => null);
      setTimeout(load, 1200); setTimeout(load, 3200);
    } else if (action === 'force-all') {
      button.disabled = true; button.textContent = '⏳ กำลังโหลด Helper ใหม่...';
      await Promise.all((status.clients || []).filter(client => client.id).map(client => fetch(`/api/tab/${encodeURIComponent(client.id)}/reload`, { method: 'POST' }).catch(() => null)));
      setTimeout(load, 1000); setTimeout(load, 3000);
    } else if (action === 'reload-one') await reloadClient(button.dataset.id, button);
    else if (action === 'mapply') {
      if (!confirm('อัปเดต Binder Town ตอนนี้? ตัวจัดการอาจรีสตาร์ต (หน้าต่างเกมไม่ปิด)')) return;
      button.disabled = true; button.textContent = '⏳ กำลังอัปเดต...';
      const result = await fetch('/api/update/pull', { method: 'POST' }).then(r => r.json()).catch(() => null);
      if (result && !result.ok) alert(result.msg || 'อัปเดตไม่สำเร็จ');
      setTimeout(load, 2500);
    } else if (action === 'reload') location.reload();
  }

  mount();
  load();
  setInterval(load, 10000);
})();
