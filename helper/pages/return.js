(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.return = {
    markup: ({ TOWN_IDS }) => `<section class="bth-section bth-page" role="tabpanel" data-bth-page="return" hidden>
      <div class="bth-section-title"><small>RETURN</small><span>กลับเมืองและจัดกระเป๋า</span></div>
      <label class="bth-field" for="bthtown"><span>เมืองที่จะกลับไป</span><select id="bthtown">${Object.keys(TOWN_IDS).map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
      <label class="bth-inline" for="bthpct"><span>ขายของเมื่อน้ำหนักถึง</span><span><input id="bthpct" type="number" min="10" max="100"> %</span></label>
      <label class="bth-switch"><input id="bthsalv" type="checkbox"><span class="bth-switch-ui"></span><span>แยกชิ้นอุปกรณ์ Normal / Magic ก่อนขาย</span></label>
      <label class="bth-inline" for="bthsalvlv"><span>เฉพาะเลเวลไอเทมต่ำกว่า</span><span>Lv <input id="bthsalvlv" type="number" min="2" max="99" style="width:48px"></span></label>
      <div class="bth-note">ไม่แยกชิ้น Rare / Epic / Unique / ของตีบวก / ของล็อก</div>
    </section>`,
    render: ({ $, cfg, TOWN_IDS }) => {
      $('#bthtown').value = TOWN_IDS[cfg.town] ? cfg.town : 'Ashford'; $('#bthpct').value = cfg.sellPct;
      $('#bthsalv').checked = !!cfg.salvOn; $('#bthsalvlv').value = cfg.salvBelow;
    },
    bind: ({ $, cfg, save, log }) => {
      $('#bthtown').onchange = e => { cfg.town = e.target.value; save(); log('เมืองขาย: ' + cfg.town); };
      $('#bthpct').onchange = e => { cfg.sellPct = Math.max(10, Math.min(100, +e.target.value || 95)); save(); };
      $('#bthsalv').onchange = e => { cfg.salvOn = e.target.checked; save(); log(cfg.salvOn ? `เปิดแยกชิ้น Normal / Magic เลเวลต่ำกว่า ${cfg.salvBelow}` : 'ปิดแยกชิ้น'); };
      $('#bthsalvlv').onchange = e => { cfg.salvBelow = Math.max(2, Math.min(99, Math.round(+e.target.value) || 30)); e.target.value = cfg.salvBelow; save(); };
    },
  };
})();
