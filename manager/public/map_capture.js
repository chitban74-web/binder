(() => {
  const $ = s => document.querySelector(s), modal = $('#map-capture-modal');
  let maps = [], profiles = [], captures = {}, currentMap = '', showAll = false, busy = false;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const profileId = () => $('#map-capture-profile').value;
  function render() {
    const todo = maps.filter(m => showAll || !captures[m.id]);
    const done = maps.length - Object.keys(captures).length;
    $('#map-capture-count').textContent = `${maps.length - done} / ${maps.length} แมพ`;
    $('#map-capture-list').innerHTML = todo.map(m => {
      const captured = !!captures[m.id], here = currentMap === m.name;
      return `<article class="map-capture-row ${captured ? 'captured' : ''}"><div><b>${esc(m.name)}</b><small>${captured ? `ถ่ายแล้ว${captures[m.id].capturedAt ? ` · ${new Date(captures[m.id].capturedAt).toLocaleString('th-TH')}` : ''}` : here ? 'อยู่แมพนี้ · พร้อมจับภาพ' : 'TODO · รอเดินไปแมพนี้'}</small></div><button class="btn btn-sm ${here ? 'btn-primary' : ''}" data-capture="${esc(m.id)}" ${!here || busy ? 'disabled' : ''}>${captured ? 'จับใหม่' : 'จับภาพ'}</button></article>`;
    }).join('') || '<p class="map-capture-empty">ครบทุกแมพแล้ว</p>';
  }
  async function refreshStatus() {
    try {
      const r = await fetch('/api/status'), s = await r.json();
      profiles = s.gameProfiles || [];
      const select = $('#map-capture-profile'), selected = select.value;
      if (select.options.length !== profiles.length) select.innerHTML = profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      if (profiles.some(p => p.id === selected)) select.value = selected;
      const tab = (s.browsers || []).flatMap(b => b.tabs || []).find(t => t.profileId === profileId() && t.state === 'helper');
      const nextMap = tab?.status?.map || '';
      const text = tab ? `โปรไฟล์ ${profiles.find(p => p.id === profileId())?.name || ''} · อยู่ ${nextMap || 'ยังไม่อยู่ในแมพ'}` : 'โปรไฟล์นี้ยังไม่มีเกมที่พร้อม';
      $('#map-capture-current').textContent = text;
      if (nextMap !== currentMap) { currentMap = nextMap; render(); }
    } catch { $('#map-capture-current').textContent = 'อ่านสถานะเกมไม่สำเร็จ'; }
  }
  async function open() {
    try {
      const [status, mapList, progress] = await Promise.all([fetch('/api/status').then(r => r.json()), fetch('/api/plan/maps').then(r => r.json()), fetch('/api/map-captures').then(r => r.json())]);
      profiles = status.gameProfiles || []; maps = mapList.slice().sort((a,b) => a.name.localeCompare(b.name)); captures = progress.captures || {};
      if (!profiles.length) throw Error('ยังไม่มีโปรไฟล์เกม');
      const select = $('#map-capture-profile');
      select.innerHTML = profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      const existing = (status.browsers || []).flatMap(b => b.tabs || []).find(t => profiles.some(p => p.id === t.profileId));
      if (existing) select.value = existing.profileId;
      showAll = false; $('#map-capture-todo').classList.add('active'); $('#map-capture-all').classList.remove('active');
      modal.hidden = false; modal.classList.add('active'); await refreshStatus(); render();
    } catch (e) { alert(e.message || 'เปิดรายการ TODO ไม่สำเร็จ'); }
  }
  $('#btn-map-capture').addEventListener('click', open);
  $('#map-capture-close').addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  $('#map-capture-profile').addEventListener('change', () => { currentMap = ''; refreshStatus(); });
  $('#map-capture-todo').addEventListener('click', () => { showAll = false; $('#map-capture-todo').classList.add('active'); $('#map-capture-all').classList.remove('active'); render(); });
  $('#map-capture-all').addEventListener('click', () => { showAll = true; $('#map-capture-all').classList.add('active'); $('#map-capture-todo').classList.remove('active'); render(); });
  $('#map-capture-list').addEventListener('click', async e => {
    const button = e.target.closest('[data-capture]'); if (!button || busy) return;
    busy = true; button.disabled = true; $('#map-capture-message').textContent = 'กำลังบันทึกภาพจากเกม…';
    try {
      const r = await fetch(`/api/map-captures/${encodeURIComponent(button.dataset.capture)}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({profileId: profileId()}) });
      const j = await r.json(); if (!r.ok || !j.ok) throw Error(j.error || 'จับภาพไม่สำเร็จ');
      captures[button.dataset.capture] = {filename:j.filename, capturedAt:new Date().toISOString()};
      $('#map-capture-message').textContent = `บันทึก ${j.map} แล้ว · ${j.width}×${j.height}`;
    } catch (err) { $('#map-capture-message').textContent = err.message; }
    busy = false; render();
  });
  setInterval(() => { if (modal.classList.contains('active')) refreshStatus(); }, 2500);
})();
