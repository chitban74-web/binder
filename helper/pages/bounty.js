(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.bounty = {
    markup: () => `<section class="bth-section bth-page" role="tabpanel" data-bth-page="bounty" hidden>
      <div class="bth-section-title"><small>DAILY</small><span>ค่าหัววันนี้</span></div>
      <label class="bth-inline" for="bthqabove"><span>เลเวลคุณ <b id="bthqlv">?</b></span><span>เผื่อเลเวล <input id="bthqabove" type="number" min="0" max="30" style="width:48px"></span></label>
      <div id="bthqlist" style="margin:2px 0;max-height:220px;overflow:auto"></div>
      <div id="bthqnote" style="color:#8fa2bb;font-size:11px"></div>
      <div style="display:flex;gap:7px;margin-top:2px"><button id="bthqgo" type="button" style="flex:2"></button><button id="bthqref" type="button" style="flex:1">↻ รีเฟรช</button></div>
      <div class="bth-note">Auto จะล่ามอนค่าหัวในทั้งแมพ เมื่อครบจะคืนค่าตั้งเดิมและกลับไปจุดฟาร์ม</div>
    </section>`,
    render: ({ $, bq, getBqAll, getBqPick, myLevel, reachable, curBounty }) => {
      const bqAll = getBqAll(), bqPick = getBqPick();
      $('#bthqlv').textContent = myLevel() || '?'; $('#bthqabove').value = bq.maxAbove;
      const cur = curBounty();
      if (bq.active) {
        $('#bthqlist').innerHTML = bq.list.map((b, i) => `<div style="padding:3px 0;${i === bq.i ? 'color:#ffd27a;font-weight:600' : b.claimed ? 'color:#9fd0ff' : ''}">${i < bq.i || b.claimed ? '✓' : i === bq.i ? '▶' : '·'} ${b.mob} ${b.prog}/${b.need} <small style="color:#8fa2bb">${b.mapName}</small></div>`).join('');
        $('#bthqnote').textContent = cur ? `กำลังทำ ${cur.mob} ที่ ${cur.mapName}` : '';
        $('#bthqgo').textContent = '■ หยุดค่าหัว'; return;
      }
      const show = bqAll.filter(reachable), hidden = bqAll.filter(b => !reachable(b));
      $('#bthqlist').innerHTML = show.length ? show.map(b => `<label style="display:block;padding:3px 0"><input type="checkbox" data-bq="${b.id}" ${bqPick.has(b.id) ? 'checked' : ''}> <b>${b.mob}</b> ${b.prog}/${b.need} <small style="color:#8fa2bb">${b.mapName} · Lv ${b.lo}–${b.hi}</small></label>`).join('')
        : '<div style="color:#8fa2bb">ไม่มีค่าหัวที่ไปได้ (กด ↻ รีเฟรช)</div>';
      $('#bthqnote').textContent = hidden.length ? `ซ่อน ${hidden.length} ตัว: ${hidden.map(b => b.claimed ? b.mob + ' (รับแล้ว)' : `${b.mob} (Lv ${b.lo}+)`).join(', ')}` : '';
      $('#bthqgo').textContent = '▶ เริ่มล่าค่าหัว';
      for (const c of document.querySelectorAll('#bthqlist [data-bq]')) c.onchange = e => { const picks = getBqPick(); e.target.checked ? picks.add(e.target.dataset.bq) : picks.delete(e.target.dataset.bq); };
    },
    bind: ({ $, bq, saveBq, reachable, getBqAll, setBqPick, refreshBq, renderBq, startBounty }) => {
      $('#bthqref').onclick = () => { if (!bq.active) refreshBq(); else renderBq(); };
      $('#bthqabove').onchange = e => { bq.maxAbove = Math.max(0, +e.target.value || 0); saveBq(); if (!bq.active) { setBqPick(new Set(getBqAll().filter(reachable).map(b => b.id))); renderBq(); } };
      $('#bthqgo').onclick = startBounty;
    },
  };
})();
