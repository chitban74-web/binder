(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.travel = {
    markup: () => `<section class="bth-section bth-page" role="tabpanel" data-bth-page="travel" hidden>
      <div class="bth-section-title"><small>TRAVEL</small><span>การเลือก Channel</span></div>
      <div id="bthchinfo" class="bth-chinfo"></div>
      <button id="bthrandomch" type="button" style="width:100%">สุ่ม CH (ข้าม PvP)</button>
      <label class="bth-switch"><input id="bthlockch" type="checkbox"><span class="bth-switch-ui"></span><span>ล็อก Channel</span></label>
      <label class="bth-inline" for="bthlockchnum"><span>อยู่เฉพาะ CH</span><span><button id="bthlockchcur" type="button">ใช้ CH ตอนนี้</button><input id="bthlockchnum" type="number" min="1" max="99" style="width:48px"></span></label>
      <div class="bth-note bth-subnote">เปิดอยู่ → ไม่ตามหัวตี้ ไม่ย้ายหา CH คนน้อย · ย้ายไป CH ที่ล็อกตอนกด ▶ และตอนกลับมาแมพฟาร์มเท่านั้น</div>
      <label class="bth-switch"><input id="bthlead" type="checkbox"><span class="bth-switch-ui"></span><span>ตาม Channel ของหัวตี้ก่อน</span></label>
      <div class="bth-note bth-subnote">หัวตี้ออนไลน์และอยู่แมพเดียวกัน → ย้ายไป CH เดียวกับหัวตี้ · ถ้าหัวตี้อยู่ CH PvP จะไม่ตาม</div>
      <label class="bth-switch"><input id="bthquiet" type="checkbox"><span class="bth-switch-ui"></span><span>ถ้าไม่เจอ ให้เลือก Channel คนน้อยสุด</span></label>
      <div class="bth-note bth-subnote">นับคนในแมพจากเมนู Channel · ถ้าไปไม่ได้ก็เดินเข้าเมือง</div>
      <div class="bth-note">ไม่เลือก CH PvP (CH10) · เมนู Channel ของเกมแสดงจำนวนคนในแมพทางขวาของแต่ละแถว</div>
    </section>`,
    render: ({ $, cfg }) => {
      $('#bthquiet').checked = !!cfg.quietCh; $('#bthlead').checked = !!cfg.followLeader; $('#bthlockch').checked = !!cfg.lockCh; $('#bthlockchnum').value = cfg.lockChNum;
      $('#bthlead').disabled = $('#bthquiet').disabled = !!cfg.lockCh;
    },
    bind: ({ $, cfg, save, log, room, chOf, randomChannel }) => {
      $('#bthquiet').onchange = e => { if (cfg.lockCh) { e.target.checked = !!cfg.quietCh; return; } cfg.quietCh = e.target.checked; save(); };
      $('#bthlead').onchange = e => { if (cfg.lockCh) { e.target.checked = !!cfg.followLeader; return; } cfg.followLeader = e.target.checked; save(); };
      $('#bthlockch').onchange = e => { cfg.lockCh = e.target.checked; save(); $('#bthlead').disabled = $('#bthquiet').disabled = cfg.lockCh; log(cfg.lockCh ? `ล็อก CH${cfg.lockChNum} · ปิดการย้าย CH อัตโนมัติ` : 'ปลดล็อก CH'); };
      $('#bthlockchnum').onchange = e => { cfg.lockChNum = Math.max(1, Math.min(99, Math.round(+e.target.value) || 1)); e.target.value = cfg.lockChNum; save(); if (cfg.lockCh) log(`ล็อก CH${cfg.lockChNum}`); };
      $('#bthlockchcur').onclick = () => { const ch = chOf(room()); if (!ch) return; $('#bthlockchnum').value = ch; $('#bthlockchnum').onchange({ target: $('#bthlockchnum') }); };
      $('#bthrandomch').onclick = () => randomChannel();
    },
  };
})();
