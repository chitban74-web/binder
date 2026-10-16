// Turns the sandbox output (vars.json) + drop index into data/ (categorized tables, CSVs, bot-ready files).
// usage: node build.js <vars.json> <dropindex.json> <outDir> [buildTag]
const fs = require('fs'), path = require('path');
const { classify } = require('./find');
const [, , varsFile, dropFile, outDir, buildTag = ''] = process.argv;
const d = JSON.parse(fs.readFileSync(varsFile, 'utf8'));
const di = fs.existsSync(dropFile) ? JSON.parse(fs.readFileSync(dropFile, 'utf8')) : { drops: [], spawns: [] };
const W = (rel, obj) => { const p = path.join(outDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1)); };
const csv = rows => '﻿' + rows.map(r => r.map(x => { x = x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\n');

fs.rmSync(outDir, { recursive: true, force: true });
const { picked, zones: zoneVars, multi } = classify(d);
const T = Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, d[v]]));
const used = new Set([...Object.values(picked), ...zoneVars, ...Object.keys(multi)]);
const index = [];
for (const [v, rel] of Object.entries(multi)) { W(rel + '.json', d[v]); index.push([rel, v, Array.isArray(d[v]) ? d[v].length : Object.keys(d[v]).length]); }
for (const [rel, v] of Object.entries(picked)) { W(rel + '.json', d[v]); index.push([rel, v, Array.isArray(d[v]) ? d[v].length : Object.keys(d[v]).length]); }

const items = T['items/items_all'] || {}, mobs = T['monsters/stats'] || {}, layouts = T['maps/layouts'] || {};
const desc = T['maps/descriptions'] || {}, wpos = T['maps/world_positions'] || {}, elements = T['monsters/elements'] || {};

// zones (merged with layout / description / world position)
const zones = {};
for (const v of zoneVars) { const z = d[v]; zones[z.id] = { ...z, description: desc[z.id], layout: layouts[z.id], worldPos: wpos[z.id] }; }
W('maps/zones.json', zones); index.push(['maps/zones', '(merged)', Object.keys(zones).length]);

// npcs
const npcs = []; for (const z of Object.values(zones)) for (const npc of (z.npcs || [])) npcs.push({ zone: z.id, zoneName: z.name, ...npc });
W('npcs/npcs.json', npcs); index.push(['npcs/npcs', '(from zones)', npcs.length]);
W('npcs/npcs.csv', csv([['zone', 'zoneName', 'id', 'name', 'kind', 'act', 'x', 'y'], ...npcs.map(x => [x.zone, x.zoneName, x.id, x.name, x.kind, x.act, x.x, x.y])]));

// drop index from the game's own worker: item -> [{map, band, mob, chance, rank, lv}]
const dropIdx = Object.fromEntries(di.drops);
W('monsters/drop_index.json', dropIdx); index.push(['monsters/drop_index', '(dropindex.worker)', di.drops.length]);
const mobDrops = {}; for (const [item, srcs] of di.drops) for (const s of srcs) (mobDrops[s.mob] = mobDrops[s.mob] || []).push({ item, chance: s.chance, map: s.map });

// ---- bot-ready files ----
const zoneName = Object.fromEntries(Object.values(zones).map(z => [z.id, z.name]));
// mob spawns: mob -> [{zone, rect, count}] (from layouts; generic types remapped per zone where the game does)
const remap = Object.values(d).find(v => v && typeof v === 'object' && !Array.isArray(v) && v.whispering_woods && v.whispering_woods.skitter && Array.isArray(v.whispering_woods.skitter)) || {};
const spawns = {};
for (const [zid, l] of Object.entries(layouts)) for (const m of (l.mobs || [])) {
  const r = (remap[zid] || {})[m.type]; const t = r ? r[0] : m.type;
  (spawns[t] = spawns[t] || []).push({ zone: zid, zoneName: zoneName[zid], rect: m.rect, count: m.count, center: [(m.rect.x0 + m.rect.x1) / 2, (m.rect.y0 + m.rect.y1) / 2] });
}
W('bot/mob_spawns.json', spawns);
// gather nodes: zone -> [{nodeType, rect, count}]
W('bot/gather_nodes.json', Object.fromEntries(Object.values(zones).map(z => [z.id, z.nodes || []])));
// zone graph + shortest routes (BFS on exits)
const graph = Object.fromEntries(Object.values(zones).map(z => [z.id, (z.exits || []).map(e => ({ to: e.to, side: e.side, rect: e.rect, center: [(e.rect.x0 + e.rect.x1) / 2, (e.rect.y0 + e.rect.y1) / 2] }))]));
const routes = {};
for (const a of Object.keys(graph)) {
  const prev = { [a]: null }, q = [a];
  while (q.length) { const u = q.shift(); for (const e of graph[u] || []) if (!(e.to in prev)) { prev[e.to] = u; q.push(e.to); } }
  routes[a] = {};
  for (const b of Object.keys(prev)) { if (b === a) continue; const p = []; for (let x = b; x; x = prev[x]) p.unshift(x); routes[a][b] = p; }
}
W('bot/zone_graph.json', graph); W('bot/zone_routes.json', routes);
// npcs by zone with role
W('bot/npcs_by_zone.json', Object.fromEntries(Object.values(zones).map(z => [z.id, (z.npcs || []).map(x => ({ id: x.id, name: x.name, kind: x.kind, act: x.act, x: x.x, y: x.y }))])));
// items: id -> {name, price, kind, slot, lv, sources}
const itemOut = {};
for (const [id, it] of Object.entries(items)) itemOut[id] = { name: it.name, price: it.price, kind: it.equip ? 'equip' : it.use ? 'consumable' : 'material', slot: it.equip && it.equip.slot, lv: it.equip && it.equip.lv, sources: (dropIdx[id] || []).map(s => `${s.mob}@${s.map}:${s.chance}`) };
W('bot/items.json', itemOut);
// mobs: id -> combat summary + where + drops
const mobOut = {};
for (const [id, m] of Object.entries(mobs)) { const el = elements[m.species] || {}; mobOut[id] = { level: m.level, role: m.role, species: m.species, temperament: m.temperament, hp: m.hp, dmg: [m.dmgMin, m.dmgMax], def: m.def, mdef: m.mdef, hit: m.hit, flee: m.flee, xp: m.xp, jobXp: m.jobXp, silver: [m.silverMin, m.silverMax], aggroRange: m.aggroRange, attackRange: m.attackRange, respawnMs: m.respawnMs, weak: el.weak, resist: el.resist, zones: [...new Set((spawns[id] || []).map(s => s.zone))], drops: mobDrops[id] || [] }; }
W('bot/mobs.json', mobOut);
// farming table: per zone, mobs with xp/hp ratio
const farm = [['zone', 'zoneName', 'levelMin', 'levelMax', 'mob', 'mobLv', 'role', 'count', 'hp', 'xp', 'jobXp', 'xpPerHp', 'weak']];
for (const [mob, list] of Object.entries(spawns)) for (const s of list) { const m = mobs[mob] || {}; const z = zones[s.zone] || {}; farm.push([s.zone, s.zoneName, (z.levelBand || [])[0], (z.levelBand || [])[1], mob, m.level, m.role, s.count, m.hp, m.xp, m.jobXp, m.hp ? +(m.xp / m.hp).toFixed(2) : '', (elements[m.species] || {}).weak]); }
W('bot/farming.csv', csv(farm));

// CSVs
W('items/items.csv', csv([['id', 'name', 'price', 'kind', 'slot', 'lv', 'sources'], ...Object.entries(itemOut).map(([id, x]) => [id, x.name, x.price, x.kind, x.slot, x.lv, x.sources.join(' ')])]));
W('monsters/monsters.csv', csv([['id', 'level', 'role', 'species', 'hp', 'dmgMin', 'dmgMax', 'def', 'mdef', 'xp', 'jobXp', 'weak', 'resist', 'zones', 'drops'], ...Object.entries(mobOut).map(([id, m]) => [id, m.level, m.role, m.species, m.hp, m.dmg[0], m.dmg[1], m.def, m.mdef, m.xp, m.jobXp, m.weak, m.resist, m.zones.join(' '), m.drops.map(x => `${x.item}:${x.chance}`).join(' ')])]));
W('maps/zones.csv', csv([['id', 'name', 'region', 'levelMin', 'levelMax', 'danger', 'w', 'h', 'exits'], ...Object.values(zones).map(z => [z.id, z.name, z.region, z.levelBand[0], z.levelBand[1], z.danger, z.w, z.h, (z.exits || []).map(e => e.to).join(' ')])]));

// the rest
const rest = {}; for (const [k, v] of Object.entries(d)) if (!used.has(k)) rest[k] = v;
W('other/_uncategorized_tables.json', rest);
W('_all_tables_raw.json', d);
W('INDEX.md', ['# Binder Town data dump', '', `Build: ${buildTag} · tables: ${Object.keys(d).length} · categorized: ${used.size} · uncategorized (other/): ${Object.keys(rest).length}`, '',
  'Tables are found by shape (tools/find.js), not by minified var name, so re-running after a game update keeps the same file names.', '',
  '| file | var | count |', '|---|---|---|', ...index.sort((a, c) => a[0].localeCompare(c[0])).map(r => `| ${r[0]}.json | \`${r[1]}\` | ${r[2]} |`), '',
  '## bot/', '- mob_spawns.json — mob → zones + spawn rect + count', '- gather_nodes.json — zone → gather nodes', '- zone_graph.json / zone_routes.json — exits and shortest zone path A→B',
  '- npcs_by_zone.json — NPC id/name/role/position', '- items.json — name, price, kind, drop sources', '- mobs.json — combat stats, weak/resist, zones, drops', '- farming.csv — per zone/mob xp, hp, xp per hp',
  '', 'CSV: items/items.csv, monsters/monsters.csv, maps/zones.csv, npcs/npcs.csv, bot/farming.csv'].join('\n'));
console.log('categorized', used.size, 'rest', Object.keys(rest).length, 'zones', Object.keys(zones).length, 'npcs', npcs.length, 'items', Object.keys(itemOut).length, 'mobs', Object.keys(mobOut).length, 'spawned mob types', Object.keys(spawns).length);
