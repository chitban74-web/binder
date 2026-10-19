(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.farm = {
    markup: () => `<section class="bth-section bth-page active" role="tabpanel" data-bth-page="farm">
      <div class="bth-section-title"><small>FARM</small><span>จุดฟาร์ม</span></div>
      <div class="bth-map"><b id="bthmap"></b><button id="bthset" type="button" title="เลือกจุดฟาร์ม: เปิดแผนที่ใหญ่ แล้วแตะจุดที่จะฟาร์ม" aria-label="เลือกจุดฟาร์มบนแผนที่"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-mob"/></svg></button></div>
      <label class="bth-inline" for="bthwait"><span>รอก่อนกลับมาเกิด</span><span><input id="bthwait" type="number" min="0" max="60"> วินาที</span></label>
      <label class="bth-switch"><input id="bthboss" type="checkbox"><span class="bth-switch-ui"></span><span>เจอ Boss / Mini-boss ในแมพ ไปตีก่อน</span></label>
      <label class="bth-switch"><input id="bthwb" type="checkbox"><span class="bth-switch-ui"></span><span>เข้า World Boss อัตโนมัติ (ตีจนจบ แล้วกลับมาฟาร์ม)</span></label>
      <div class="bth-note" id="bthwbinfo"></div>
      <label class="bth-switch" id="bthmobiconrow"><input id="bthmobicon" type="checkbox"><span class="bth-switch-ui"></span><span>แสดงรูปมอนบนมินิแมพ</span></label>
      <button id="bthrun" type="button" style="width:100%"></button>
    </section>`,
    render: ({ $, cfg, mobIcons }) => {
      $('#bthmap').textContent = cfg.farmMap ? cfg.farmMap + (cfg.farmSpot ? ` (${cfg.farmSpot.x.toFixed(0)}, ${cfg.farmSpot.y.toFixed(0)})` : '') : '(ยังไม่ตั้ง)';
      $('#bthwait').value = cfg.deathWaitMs / 1000; $('#bthboss').checked = !!cfg.bossHunt; $('#bthwb').checked = cfg.worldBoss !== false; $('#bthmobicon').checked = cfg.mobIcons !== false;
      $('#bthrun').textContent = cfg.running && !cfg.gathering.enabled ? '■ หยุดฟาร์ม' : '▶ เริ่มฟาร์ม';
      if (!mobIcons) $('#bthmobiconrow').style.display = 'none';
    },
    bind: ({ $, cfg, save, log, toggleFarm, onPickFarm }) => {
      $('#bthset').onclick = onPickFarm;
      $('#bthwait').onchange = e => { cfg.deathWaitMs = Math.max(0, +e.target.value || 0) * 1000; save(); };
      $('#bthboss').onchange = e => { cfg.bossHunt = e.target.checked; save(); };
      $('#bthwb').onchange = e => { cfg.worldBoss = e.target.checked; save(); };
      $('#bthmobicon').onchange = e => { cfg.mobIcons = e.target.checked; save(); };
      $('#bthrun').onclick = toggleFarm;
    },
  };
})();
