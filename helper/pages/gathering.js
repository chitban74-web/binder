(() => {
  const pages = window.__bthPageModules || (window.__bthPageModules = Object.create(null));
  pages.gathering = {
    data: {
      maps: {
        tree: {1:['southvale_field','valebrook','whispering_woods','riverside','honeyrill'],2:['bracken_sink','verdigris_rise','sunfield_plains'],3:['ashford','gloomroot_forest','pitchwood','peatcut_bog'],4:['stormwall_city','frostpeak_slopes','sledrun_gully','brinecrust_shoals'],5:['howling_steppes','sanctum','kitewind_terraces']},
        rock: {1:['southvale_field','valebrook','riverside','honeyrill'],2:['old_quarry','ancient_ruins','bracken_sink','verdigris_rise','sunfield_plains'],3:['ashford','ember_hollow','mistmire_swamp','duskgate_pass','pitchwood','yellowlick_flats'],4:['stormwall_city','frostpeak_slopes','frozen_mere','sledrun_gully','brinecrust_shoals'],5:['howling_steppes','cloudspire_ruins','sanctum','shattered_vale','umbral_depths','kitewind_terraces','glasswrack','marrowdeep','rustbell_barracks']},
        herb: {1:['southvale_field','valebrook','whispering_woods','riverside','honeyrill'],2:['old_quarry','ancient_ruins','bracken_sink','verdigris_rise','sunfield_plains'],3:['ashford','gloomroot_forest','ember_hollow','mistmire_swamp','duskgate_pass','pitchwood','yellowlick_flats','peatcut_bog'],4:['stormwall_city','frostpeak_slopes','frozen_mere','sledrun_gully','brinecrust_shoals'],5:['howling_steppes','cloudspire_ruins','sanctum','shattered_vale','umbral_depths','throne_of_warden','kitewind_terraces','glasswrack','marrowdeep','rustbell_barracks']},
        fish: {1:['valebrook','riverside','honeyrill'],2:['valebrook','old_quarry','ancient_ruins','sunfield_plains'],3:['ashford','mistmire_swamp','yellowlick_flats','peatcut_bog'],4:['stormwall_city','frozen_mere','brinecrust_shoals'],5:['sanctum','howling_steppes','kitewind_terraces','glasswrack']},
      },
      fishPoints: {southvale_field:[{x:26,y:40},{x:44.5,y:15}],valebrook:[{x:33.5,y:31.5},{x:32.5,y:38}],whispering_woods:[{x:21,y:20.5},{x:40,y:22.5}],riverside:[{x:25,y:21.5},{x:47,y:24},{x:8,y:21},{x:32,y:22}],ancient_ruins:[{x:43.5,y:39.5}],mistmire_swamp:[{x:14,y:15},{x:34,y:20},{x:21,y:40}],frozen_mere:[{x:28,y:21}]},
      levels: {southvale_field:1,valebrook:1,whispering_woods:4,riverside:6,honeyrill:3,old_quarry:10,ancient_ruins:14,bracken_sink:9,verdigris_rise:14,sunfield_plains:18,ashford:18,gloomroot_forest:24,ember_hollow:28,mistmire_swamp:34,duskgate_pass:40,pitchwood:24,yellowlick_flats:30,peatcut_bog:36,stormwall_city:45,frostpeak_slopes:45,frozen_mere:52,sledrun_gully:47,brinecrust_shoals:54,howling_steppes:58,cloudspire_ruins:64,sanctum:70,shattered_vale:70,umbral_depths:80,throne_of_warden:90,kitewind_terraces:64,glasswrack:72,marrowdeep:82,rustbell_barracks:92},
      pvpMaps: ['shattered_vale','umbral_depths','throne_of_warden','glasswrack','marrowdeep','rustbell_barracks'],
    },
    markup: () => `<section class="bth-section bth-page" role="tabpanel" data-bth-page="gathering" hidden>
      <div class="bth-section-title"><small>GATHERING</small><span>ค้นหาแหล่งเก็บเกี่ยว</span></div>
      <label class="bth-field"><span>ชนิดทรัพยากร</span><select id="bthgtype"><option value="tree">ไม้</option><option value="rock">แร่</option><option value="herb">สมุนไพร</option><option value="fish">ปลา</option></select></label>
      <label class="bth-field"><span>Tier</span><select id="bthgtier">${[1,2,3,4,5].map(t => `<option value="${t}">Tier ${t}</option>`).join('')}</select></label>
      <label class="bth-field"><span>แมพแรกที่ค้นหา</span><select id="bthgmap"></select></label>
      <label class="bth-switch"><input id="bthgchannels" type="checkbox"><span class="bth-switch-ui"></span><span>ค้นหาข้าม Channel อัตโนมัติ</span></label>
      <label class="bth-switch"><input id="bthgmapsweep" type="checkbox"><span class="bth-switch-ui"></span><span>ไปแมพถัดไปเมื่อค้นหาไม่พบ</span></label>
      <label class="bth-switch"><input id="bthgpvp" type="checkbox"><span class="bth-switch-ui"></span><span>รวมแมพ PvP ในการค้นหา</span></label>
      <label class="bth-switch"><input id="bthggold" type="checkbox"><span class="bth-switch-ui"></span><span>ต้องเป็น node ทอง</span></label>
      <div id="bthgmaps" class="bth-note"></div>
      <button id="bthgrun" type="button" style="width:100%"></button>
      <div class="bth-note" id="bthghelp">ตั้งค่าการวน CH และการเปลี่ยนแมพแยกกันได้ · เมืองก่อน แล้วเรียงตามระดับแมพ</div>
    </section>`,
    render: ({ $, cfg, TOWN_IDS, GATHER_MAPS, GATHER_MAP_LEVEL, GATHER_PVP_MAPS, MAP_NAMES, gatherMaps }) => {
      $('#bthgrun').textContent = cfg.running && cfg.gathering.enabled ? '■ หยุด Gathering' : '▶ เริ่ม Gathering';
      $('#bthgtype').value = cfg.gathering.type; $('#bthgtier').value = cfg.gathering.tier; $('#bthgpvp').checked = !!cfg.gathering.pvp; $('#bthggold').checked = !!cfg.gathering.gold; $('#bthgchannels').checked = !!cfg.gathering.scanChannels; $('#bthgmapsweep').checked = !!cfg.gathering.rotateMaps;
      const townMaps = new Set(Object.values(TOWN_IDS || {}));
      const orderMaps = (a,b) => Number(townMaps.has(b)) - Number(townMaps.has(a)) || (GATHER_MAP_LEVEL[a]||999)-(GATHER_MAP_LEVEL[b]||999);
      const mapChoices = [...new Set((GATHER_MAPS[cfg.gathering.type] || {})[+cfg.gathering.tier] || [])].filter(id => cfg.gathering.pvp || !GATHER_PVP_MAPS.has(id)).sort(orderMaps);
      if (cfg.gathering.preferredMap && !mapChoices.includes(cfg.gathering.preferredMap)) cfg.gathering.preferredMap = '';
      $('#bthgmap').innerHTML = `<option value="">ระดับแมพต่ำสุดก่อน (อัตโนมัติ)</option>${mapChoices.map(id => `<option value="${id}">${MAP_NAMES[id] || id}</option>`).join('')}`;
      $('#bthgmap').value = cfg.gathering.preferredMap;
      $('#bthgmaps').textContent = gatherMaps().filter(id => cfg.gathering.pvp || !GATHER_PVP_MAPS.has(id)).map(id => MAP_NAMES[id] || id).join(' → ') || 'ไม่มีแมพตามตัวเลือก';
      const fish = cfg.gathering.type === 'fish';
      for (const id of ['bthgchannels','bthggold']) $('#' + id).closest('label').style.display = fish ? 'none' : '';
      $('#bthgmapsweep').closest('label').style.display = '';
      $('#bthghelp').textContent = fish ? 'เดินหา node ปลาในแมพและตกให้อัตโนมัติ · เมืองก่อน แล้วไปแมพถัดไปตาม Tier' : 'ตั้งค่าการวน CH และการเปลี่ยนแมพแยกกันได้ · เมืองก่อน แล้วเรียงตามระดับแมพ';
    },
    bind: ({ $, updateGather, updatePreferredMap, toggleGather }) => {
      for (const id of ['bthgtype','bthgtier','bthgpvp','bthggold','bthgchannels','bthgmapsweep']) $('#' + id).onchange = updateGather;
      $('#bthgmap').onchange = updatePreferredMap;
      $('#bthgrun').onclick = toggleGather;
    },
  };
})();
