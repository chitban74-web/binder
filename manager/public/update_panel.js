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
  const versionIsNewer = (remote, local) => {
    const a = String(remote || '').split('.').map(Number), b = String(local || '').split('.').map(Number);
    if (!a.length || !b.length || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  };
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
  let notifiedVersion = '';
  let activeFilter = 'all';
  let panel, pill, wrap, tokenPanel, tokenWrap, tokenButton;
  let tokenActionMessage = '';

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
    tokenWrap = document.getElementById('token-pull-wrap');
    tokenButton = document.getElementById('btn-pull-token');
    tokenPanel = document.getElementById('token-pull-panel');
    if (tokenWrap && tokenButton && tokenPanel) {
      tokenButton.addEventListener('click', event => {
        event.preventDefault(); event.stopImmediatePropagation();
        panel.hidden = true;
        tokenPanel.hidden = !tokenPanel.hidden;
        if (!tokenPanel.hidden) { tokenActionMessage = ''; load(); renderTokenPanel(); }
      }, true);
      tokenPanel.addEventListener('click', onTokenPanelClick);
    }
    pill.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      panel.hidden = !panel.hidden;
      if (tokenPanel) tokenPanel.hidden = true;
      if (!panel.hidden) load();
    }, true);
    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) panel.hidden = true;
      if (tokenWrap && !tokenWrap.contains(event.target) && tokenPanel) tokenPanel.hidden = true;
    });
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
      notifyNewHelperVersion();
      watchForNewBuild();
      render();
      renderTokenPanel();
    } catch (e) { }
  }

  function renderTokenPanel() {
    if (!tokenPanel || !status) return;
    const remote = status.remoteCommit || 'ไม่พบ';
    const local = status.commit || 'ไม่ทราบ';
    const behind = Number(status.behind) || 0;
    const incoming = (status.incoming || []).slice(0, 6);
    tokenPanel.innerHTML = `
      <div class="bu-top-bar">
        <div class="bu-top-title"><b>อัปเดตจาก Token</b><small>เช็กล่าสุด ${ago(status.checkedAt)}</small></div>
        <div class="bu-top-actions">
          <button type="button" class="bu-action-btn primary" data-token-action="check">เช็กและอัปเดตตอนนี้</button>
          <button type="button" class="bu-close-btn" data-token-action="close" aria-label="ปิด">×</button>
        </div>
      </div>
      <div class="bu-card ${behind ? 'bu-card-warn' : ''}">
        <div class="bu-card-head"><div class="bu-card-title">Git commit</div><span class="bu-badge ${behind ? 'warn' : 'ok'}">${behind ? `มีอัปเดต ${behind} commit` : 'ตรงกันแล้ว'}</span></div>
        <div class="bu-token-versions">
          <div><small>จาก Token</small><b>${esc(remote)}</b><time>${esc(status.remoteDate || 'เวลาไม่ระบุ')}</time></div>
          <div><small>ในเครื่องนี้</small><b>${esc(local)}</b><time>${esc(status.date || 'เวลาไม่ระบุ')}</time></div>
        </div>
      </div>
      <div class="bu-card ${behind ? 'bu-card-warn' : ''}">
        <div class="bu-card-head"><div class="bu-card-title">ตัวโปรแกรม Binder Town</div><span class="bu-badge ${behind ? 'warn' : 'ok'}">${behind ? `มีอัปเดต ${behind} commit` : 'ล่าสุดแล้ว'}</span></div>
        <div class="bu-commit-line"><code>${esc(status.commit || '—')}</code><span>${esc(status.date || '')}</span></div>
        ${incoming.length ? `<div class="bu-token-incoming">${incoming.map(esc).join('<br>')}${status.incoming.length > incoming.length ? '<br>…' : ''}</div>` : '<div class="bu-meta-line">Token ตรวจทุก 3 นาที · เตรียมสำเนาไว้ในโฟลเดอร์แยก</div>'}
        ${status.error ? `<div class="bu-error">${esc(status.error)}</div>` : ''}
        ${tokenActionMessage ? `<div class="bu-meta-line bu-token-message">${esc(tokenActionMessage)}</div>` : ''}
        <div class="bu-card-actions"><button type="button" class="bu-action-btn ${behind ? 'primary' : ''}" data-token-action="pull" ${behind ? '' : 'disabled'}>${behind ? '⬇ เตรียมไฟล์จาก Token ในโฟลเดอร์แยก' : 'เป็นเวอร์ชันล่าสุดแล้ว'}</button></div>
      </div>
      <div class="bu-foot"><small>อ่านเวอร์ชันจาก repo ที่ Token อนุญาต · ไม่ push ข้อมูล</small><button type="button" class="btn btn-ghost btn-sm" data-token-action="check">เช็กตอนนี้</button></div>`;
  }

  async function onTokenPanelClick(event) {
    const button = event.target.closest('[data-token-action]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const action = button.dataset.tokenAction;
    if (action === 'close') { tokenPanel.hidden = true; return; }
    if (action === 'check') {
      button.disabled = true; button.textContent = 'กำลังเช็ก…';
      try {
        const response = await fetch('/api/update/check', { method: 'POST' });
        const result = await response.json();
        if (!response.ok || result.update?.error) tokenActionMessage = result.update?.error || result.error || 'เช็ก Token ไม่สำเร็จ';
        else tokenActionMessage = result.update?.behind ? `พบอัปเดต ${result.update.behind} commit จาก Token` : `เช็กแล้ว · Token ${result.update?.remoteCommit || '—'} · ${result.update?.remoteDate || ''}`;
        if (result.applied?.restart) setTimeout(() => location.reload(), 5000);
      } catch (error) { tokenActionMessage = `เช็ก Token ไม่สำเร็จ: ${error.message}`; }
      await load();
      return;
    }
    if (action === 'pull') {
      if (!confirm('ดาวน์โหลดไฟล์จาก Token ไปไว้ในโฟลเดอร์ .token-pulls แยกต่างหากหรือไม่? จะไม่เปลี่ยนไฟล์ในโฟลเดอร์หลัก')) return;
      button.disabled = true; button.textContent = 'กำลังเตรียมโฟลเดอร์…';
      try {
        const response = await fetch('/api/update/stage', { method: 'POST' });
        const result = await response.json();
        tokenActionMessage = result.msg || (result.ok ? 'เตรียมสำเนาสำเร็จ' : 'เตรียมสำเนาไม่สำเร็จ');
        if (!result.ok) tokenActionMessage = `เตรียมไม่สำเร็จ: ${tokenActionMessage}`;
      } catch (error) { tokenActionMessage = `เตรียมไม่สำเร็จ: ${error.message}`; }
      await load();
    }
  }

  function notifyNewHelperVersion() {
    const remote = status && status.remoteHelperVersion;
    if (!versionIsNewer(remote, status && status.helperVersion) || notifiedVersion === remote) return;
    notifiedVersion = remote;
    const toast = document.createElement('div');
    toast.className = 'bu-reload-toast';
    toast.textContent = `มี Binder Helper เวอร์ชันใหม่ v${remote}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
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
    const versionUpdate = versionIsNewer(status.remoteHelperVersion, status.helperVersion);
    return `
      <div class="bu-card ${pending || reloadPending ? 'bu-card-warn' : ''}">
        <div class="bu-card-head">
          <div class="bu-card-title">
            <span> ตัวโปรแกรม Binder Town</span>
            <span class="bu-badge ${pending || reloadPending || versionUpdate ? 'warn' : 'ok'}">
              ${reloadPending ? ' รอโหลดหน้าใหม่' : versionUpdate ? ` Helper v${esc(status.remoteHelperVersion)} ใหม่` : pending ? ` มีอัปเดต ${pending} commit` : ' ล่าสุดแล้ว'}
            </span>
          </div>
          <button type="button" class="bu-switch ${status.autoPull ? 'on' : ''}" data-bu="mtoggle" title="เปิด/ปิด Auto-update ของ Binder Town" ${status.main ? 'disabled' : ''}><span></span></button>
        </div>
        <div class="bu-card-body">
          <div class="bu-commit-line"><code>${esc(status.commit || '—')}</code><span>${esc(status.date || '')}</span></div>
          <div class="bu-meta-line">
            ${pending
              ? `<span class="bu-pending-list">${(status.incoming || []).slice(0, 5).map(esc).join('<br>')}${(status.incoming || []).length > 5 ? '<br>…' : ''}</span>`
              : `<span>${status.main ? 'เครื่องหลัก · ไม่เตรียมไฟล์อัตโนมัติ' : 'ตรวจ Token ทุก 3 นาที · เตรียมสำเนาในโฟลเดอร์แยก'}</span>`}
            ${status.lastApplied ? `<span>· อัปเดตล่าสุด ${ago(status.lastApplied.at)}</span>` : ''}
          </div>
          ${status.remoteHelperVersion ? `<div class="bu-meta-line">เวอร์ชันใน repo จาก token: <b>v${esc(status.remoteHelperVersion)}</b>${versionUpdate ? ' · มีอัปเดตใหม่' : ''}</div>` : ''}
          ${status.error ? `<div class="bu-error"> ${esc(status.error)}</div>` : ''}
          ${pending ? `<div class="bu-card-actions"><button type="button" class="bu-action-btn primary" data-bu="mapply">⬇ เตรียมสำเนา Token ตอนนี้</button></div>` : ''}
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
    const versionUpdate = versionIsNewer(status.remoteHelperVersion, status.helperVersion);
    const tone = versionUpdate ? 'busy' : !status.autoPull ? 'off' : hasError ? 'err' : (status.busy || pending || status.behind) ? 'busy' : 'ok';
    pill.className = `btn btn-ghost bu-pill ${tone}`;
    pill.querySelector('.bu-text').textContent =
      versionIsNewer(status.remoteHelperVersion, status.helperVersion) ? `มี Helper v${status.remoteHelperVersion} ใหม่`
        : !status.autoPull ? 'Auto-update ปิด'
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
      if (!confirm('เตรียมไฟล์ Token ไว้ในโฟลเดอร์แยกโดยไม่เปลี่ยนไฟล์หลักหรือไม่?')) return;
      button.disabled = true; button.textContent = '⏳ กำลังอัปเดต...';
      const result = await fetch('/api/update/stage', { method: 'POST' }).then(r => r.json()).catch(() => null);
      if (result) alert(result.msg || (result.ok ? 'เตรียมสำเนาแล้ว' : 'เตรียมสำเนาไม่สำเร็จ'));
      setTimeout(load, 2500);
    } else if (action === 'reload') location.reload();
  }

  mount();
  load();
  setInterval(load, 10000);
  window.BinderUpdatePanel = { update: value => { if (value && status) { status = { ...status, ...value }; renderTokenPanel(); } } };
})();
