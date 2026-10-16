// Locates data tables by their shape, so a new build (new minified var names) still lands in the same files.
// Each spec: [category, file, test(value) -> bool]. When several tables match one spec, the largest wins.
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const vals = v => (isObj(v) ? Object.values(v) : Array.isArray(v) ? v : []);
const first = v => vals(v)[0];
const n = v => vals(v).length;
const every = (v, f, min = 1) => n(v) >= min && vals(v).every(x => { try { return !!f(x); } catch { return false; } });
const keys = (v, ...ks) => isObj(v) && ks.every(k => k in v);

const SPECS = [
  // items
  ['items', 'items_all', v => isObj(v) && n(v) > 500 && 'wood' in v && 'potion' in v && every(v, x => keys(x, 'id', 'name'))],
  ['items', 'equipment', v => isObj(v) && n(v) > 300 && every(v, x => keys(x, 'id', 'family', 'tier', 'slot'))],
  ['items', 'equipment_bases', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'slot', 'name', 'legacy'), 10)],
  ['items', 'affixes', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'kind', 'slots', 'mod'), 10)],
  ['items', 'uniques', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'family', 'tier', 'lines'), 5)],
  ['items', 'headgear', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'slot', 'lv', 'stat'), 10)],
  ['items', 'costumes', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'name', 'slot') && !('lv' in x), 20) && v.some(x => x.slot === 'costume')],
  ['items', 'item_descriptions', v => isObj(v) && 'rename_ticket' in v && every(v, x => typeof x === 'string', 20)],
  ['items', 'sets', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'name', 'region', 'two'), 5)],
  ['items', 'pacts', v => isObj(v) && every(v, x => keys(x, 'id', 'name', 'perk') && String(x.id).startsWith('pact_'), 5)],
  ['items', 'oils', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'oil', 'buffMs'), 3)],
  ['items', 'pets', v => Array.isArray(v) && every(v, x => keys(x, 'key', 'name', 'nameTh', 'tier'), 5)],
  // recipes / shops
  ['recipes', 'cooking_brewing', v => Array.isArray(v) && n(v) > 50 && every(v, x => keys(x, 'id', 'station', 'result', 'mats'))],
  ['shops', 'npc_shop', v => Array.isArray(v) && every(v, x => keys(x, 'itemId', 'price', 'base'), 5)],
  // monsters
  ['monsters', 'stats', v => isObj(v) && n(v) > 50 && every(v, x => keys(x, 'hp', 'dmgMin', 'dmgMax', 'xp', 'species'))],
  ['monsters', 'visual', v => isObj(v) && n(v) > 50 && every(v, x => keys(x, 'sprite', 'role', 'gen'))],
  ['monsters', 'drops', v => isObj(v) && n(v) > 20 && every(v, x => Array.isArray(x) && x.every(d => keys(d, 'itemId', 'chance')))],
  ['monsters', 'elements', v => isObj(v) && every(v, x => keys(x, 'weak', 'resist'), 5)],
  ['monsters', 'archetypes', v => isObj(v) && every(v, x => keys(x, 'speed', 'aggroRange', 'attackRange') && !('hp' in x), 5)],
  ['monsters', 'mob_skills', v => isObj(v) && 'mob_stomp' in v],
  ['bosses', 'boss_skills', v => isObj(v) && n(v) > 50 && every(v, x => keys(x, 'id', 'name', 'shape', 'radius'))],
  ['bosses', 'world_boss_spawns', v => Array.isArray(v) && every(v, x => keys(x, 'type', 'map', 'species', 'level', 'arena'), 3)],
  // maps
  ['maps', 'layouts', v => isObj(v) && every(v, x => keys(x, 'route', 'mobs', 'nodes'), 10)],
  ['maps', 'towns', v => isObj(v) && every(v, x => keys(x, 'npc', 'buildings'), 2)],
  ['maps', 'descriptions', v => isObj(v) && n(v) > 20 && 'whispering_woods' in v && every(v, x => typeof x === 'string')],
  ['maps', 'world_positions', v => isObj(v) && n(v) > 20 && 'whispering_woods' in v && every(v, x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'number')],
  ['maps', 'connections', v => isObj(v) && n(v) > 20 && Object.keys(v).every(k => k.includes('|'))],
  ['maps', 'sub_areas', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'name', 'parent', 'camps'), 3)],
  ['maps', 'gather_events', v => isObj(v) && every(v, x => keys(x, 'line', 'title', 'perHead'), 2)],
  // npcs
  ['npcs', 'dialogue', v => isObj(v) && 'shop' in v && 'smith' in v && every(v, x => Array.isArray(x) && typeof x[0] === 'string')],
  // classes / skills
  ['classes', 'classes', v => isObj(v) && 'novice' in v && 'knight' in v && every(v, x => keys(x, 'id', 'name', 'desc'))],
  ['classes', 'specs', v => isObj(v) && 'blade' in v && every(v, x => keys(x, 'role', 'combo'))],
  ['classes', 'stats', v => isObj(v) && 'str' in v && 'agi' in v && every(v, x => keys(x, 'name', 'desc', 'per'))],
  ['classes', 'insights', v => isObj(v) && every(v, x => keys(x, 'id', 'name', 'perk') && String(x.id).startsWith('ins_'), 10)],
  ['skills', 'skills', v => isObj(v) && n(v) > 50 && every(v, x => keys(x, 'id', 'name', 'cdMs', 'kind', 'job'))],
  ['skills', 'status_effects', v => isObj(v) && 'stun' in v && every(v, x => keys(x, 'icon', 'name', 'desc'))],
  // progression
  ['progression', 'achievements', v => isObj(v) && 'lv10' in v && every(v, x => keys(x, 'id', 'cat', 'tier', 'name'))],
  ['progression', 'battlepass_rewards', v => Array.isArray(v) && n(v) > 20 && every(v, x => keys(x, 'free', 'prem'))],
  ['progression', 'events', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'title', 'tag', 'desc'), 3)],
  // misc
  ['misc', 'ui_help', v => isObj(v) && 'charwin:bag' in v],
  ['misc', 'keybinds', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'label', 'group', 'def'), 10)],
];

// Families with many small tables: every match is kept as <cat>/<prefix>_<var>.json
const MULTI = [
  ['recipes', 'recipe', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'mats') && ('result' in x || 'slot' in x), 3)],
  ['bosses', 'skillset', v => isObj(v) && every(v, x => Array.isArray(x) && x.length && x.every(s => keys(s, 'id', 'name', 'shape')), 2)],
  ['bosses', 'skills', v => Array.isArray(v) && every(v, x => keys(x, 'id', 'name', 'shape', 'radius'), 3)],
  ['monsters', 'traits', v => isObj(v) && every(v, x => keys(x, 'name', 'fx') || keys(x, 'color', 'fx'), 5)],
  ['monsters', 'mobtable', v => isObj(v) && n(v) > 40 && 'sprout' in v && 'skitter' in v],
  ['skills', 'skilltable', v => isObj(v) && n(v) > 20 && 'bash' in v && 'slam' in v],
  ['classes', 'classtable', v => isObj(v) && 'knight' in v && 'warrior' in v && 'mage' in v],
  ['classes', 'spectable', v => isObj(v) && 'blade' in v && 'bulwark' in v],
  ['items', 'itemtable', v => isObj(v) && n(v) > 3 && every(v, x => keys(x, 'id', 'name', 'color', 'price'))],
  ['items', 'equiptable', v => (isObj(v) || Array.isArray(v)) && n(v) > 3 && every(v, x => keys(x, 'family') || keys(x, 'fam', 'pieces'))],
  ['items', 'weapontable', v => isObj(v) && 'sword' in v && 'bow' in v && n(v) < 80],
  ['maps', 'zonetable', v => isObj(v) && n(v) > 15 && 'whispering_woods' in v && 'riverside' in v],
  ['progression', 'progress', v => Array.isArray(v) && every(v, x => keys(x, 'free', 'prem') || keys(x, 'item', 'qty'), 10)],
  ['misc', 'cosmetics', v => isObj(v) && ('witch_hat' in v || 'verdant_ronin' in v)],
  ['misc', 'pets', v => isObj(v) && 'biscuit_pup' in v],
];

const size = v => JSON.stringify(v).length;
const isZone = v => isObj(v) && keys(v, 'id', 'name', 'levelBand', 'w', 'h');

function classify(tables) {
  const picked = {}; // "cat/file" -> var name
  for (const [cat, file, test] of SPECS) {
    let best = null;
    for (const [name, v] of Object.entries(tables)) {
      let ok = false; try { ok = test(v); } catch { }
      if (ok && (!best || size(v) > size(tables[best]))) best = name;
    }
    if (best) picked[`${cat}/${file}`] = best; else console.warn('not found:', `${cat}/${file}`);
  }
  const zones = Object.entries(tables).filter(([, v]) => isZone(v)).map(([k]) => k);
  const multi = {}; // var -> "cat/prefix_var"
  const taken = new Set(Object.values(picked));
  for (const [cat, prefix, test] of MULTI) for (const [name, v] of Object.entries(tables)) {
    if (taken.has(name) || multi[name]) continue;
    let ok = false; try { ok = test(v); } catch { }
    if (ok) multi[name] = `${cat}/${prefix}_${name.replace(/\$/g, 'S')}`;
  }
  return { picked, zones, multi };
}
module.exports = { classify, SPECS, MULTI };
