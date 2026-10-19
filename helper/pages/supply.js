(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.supply = {
    markup: ({ POTIONS }) => `<section class="bth-section bth-page" role="tabpanel" data-bth-page="supply" hidden>
      <div class="bth-section-title"><small>SUPPLY</small><span>เติมยาอัตโนมัติ</span></div>
      <div class="bth-potions">${['hp', 'mp'].map(k => `<div class="bth-potion"><div class="bth-potion-title">${k === 'hp' ? '♥ ยา HP' : '✦ ยา MP'}</div><label class="bth-switch"><input id="bth_${k}_enabled" type="checkbox"><span class="bth-switch-ui"></span><span>เปิดเติมอัตโนมัติ</span></label><select id="bth_${k}_item">${Object.entries(POTIONS[k]).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select><div class="bth-potion-grid"><label>ซื้อเมื่อเหลือต่ำกว่า<input id="bth_${k}_min" type="number" min="1" max="9999"></label><label>เติมถึง<input id="bth_${k}_to" type="number" min="1" max="9999"></label></div></div>`).join('')}</div>
      <div class="bth-note">เปิด/ปิดการเติมแยกสำหรับ HP และ MP · ยาต้องอยู่ในช่อง Q/E</div>
    </section>`,
    render: ({ $, cfg }) => {
      for (const k of ['hp', 'mp']) { const b = (cfg.buy || {})[k] || {}; $(`#bth_${k}_enabled`).checked = b.enabled !== false; $(`#bth_${k}_item`).value = b.item; $(`#bth_${k}_min`).value = b.min || 1; $(`#bth_${k}_to`).value = b.to || 1; }
    },
    bind: ({ $, cfg, save, log }) => {
      for (const k of ['hp', 'mp']) {
        const upd = () => {
          const min = Math.max(1, +$(`#bth_${k}_min`).value || 1), to = Math.max(min, +$(`#bth_${k}_to`).value || min);
          cfg.buy = { ...(cfg.buy || {}), [k]: { ...((cfg.buy || {})[k] || {}), item: $(`#bth_${k}_item`).value, min, to } }; save();
          $(`#bth_${k}_min`).value = min; $(`#bth_${k}_to`).value = to;
        };
        for (const f of ['item', 'min', 'to']) $(`#bth_${k}_${f}`).onchange = upd;
        $(`#bth_${k}_enabled`).onchange = e => { cfg.buy[k].enabled = e.target.checked; save(); log(`${k === 'hp' ? 'ยา HP' : 'ยา MP'}${e.target.checked ? 'เปิด' : 'ปิด'}เติมอัตโนมัติ`); };
      }
    },
  };
})();
