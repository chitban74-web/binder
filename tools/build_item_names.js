// tools/build_item_names.js — item tables for the web manager's market tab (manager/public/item_names.js).
// The market sends raw item ids (e.g. "sword_t8|hit:4:13,desperate:5:38#uuid"); names, wear level, base ATK and the
// affix tier names come from the game's tables in the data dump.
// Run after a data dump of a new game build:  node tools/build_item_names.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const out = path.join(ROOT, 'manager', 'public', 'item_names.js');
const rows = f => {
  const x = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items', f), 'utf8'));
  return Array.isArray(x) ? x : Object.entries(x).map(([id, v]) => ({ id, ...v }));
};

const names = {};
for (const it of rows('items_all.json')) if (it && it.id && it.name) names[it.id] = it.name;
// equipment: wear level, base ATK / MATK / DEF (the game shows them x3), weapon type / slot, base stats, base bonuses
const equip = {};
for (const e of rows('equipment.json')) if (e && e.id) {
  const b = e.built || {};
  equip[e.id] = [e.lv || 0, b.atk || 0, e.weaponType || e.slot || '', b.matk || 0, b.def || 0, b.stats || {}, b.bonus || {}, e.slot || '', e.family || ''];
}
// affixes: prefix / suffix and the name of each tier (an item is named "<prefixes> <base> <first suffix>")
const affix = {};
for (const a of rows('affixes.json')) if (a && a.id) affix[a.id] = [a.kind === 'suffix' ? 's' : 'p', (a.tiers || []).map(t => t[3] || ''), a.mod || {}];

// item tooltip texts: the game's own code for them, cut out of the client (raw/main.js) by its definitions.
// The names are minified and change between builds — each piece is found by a text anchor next to it.
const main = fs.readFileSync(path.join(ROOT, 'raw', 'main.js'), 'utf8');
// the expression that starts at `i`, up to the first top-level "," / ";" (strings, templates and brackets skipped)
function exprAt(i) {
  const stack = [];
  for (let j = i; j < main.length; j++) {
    const c = main[j], top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') j++; else if (c === '`') stack.pop(); else if (c === '$' && main[j + 1] === '{') { stack.push('{'); j++; }
      continue;
    }
    if (c === '"' || c === "'") { for (j++; main[j] !== c; j++) if (main[j] === '\\') j++; continue; }
    if (c === '`') stack.push('`');
    else if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) { if (!stack.length) return main.slice(i, j); stack.pop(); if (!stack.length && c === '}' && main.startsWith('function', i)) return main.slice(i, j + 1); }
    else if ((c === ',' || c === ';') && !stack.length) return main.slice(i, j);
  }
  throw new Error('unterminated expression at ' + i);
}
// `name=` of a const / let list whose value starts with `starts`
function def(starts, label) {
  const at = main.indexOf(starts);
  if (at < 0) throw new Error(`raw/main.js: "${label}" not found — the game changed, update the anchor`);
  const head = main.slice(0, at).match(/([\w$]+)=$/);
  if (!head) throw new Error(`raw/main.js: "${label}" has no name`);
  return [head[1], exprAt(at)];
}
const fnDef = (anchor, label) => {   // a whole `function X(...){...}` that contains `anchor`
  const at = main.indexOf(anchor); if (at < 0) throw new Error(`raw/main.js: "${label}" not found`);
  const start = main.lastIndexOf('function ', at), src = exprAt(start);
  if (start + src.length < at) throw new Error(`raw/main.js: "${label}" is not inside one function`);
  return [src.match(/^function ([\w$]+)/)[1], src];
};
const pieces = {
  scale: def('3,CZ=new Set', 'stat scale'),                                  // ATK / DEF ... shown x3
  scaled: def('new Set(["atk","matk","def","mdef"', 'scaled stats'),
  procs: def('{chain:{name:"Chain Spark"', 'trigger table'),
  procNote: def('"On-hit = ตีธรรมดา', 'on-hit note'),
  conds: def('{boss:"+{v}% ดาเมจใส่ Boss', 'conditional affixes'),
  gear: def('{healPower:["Heal power"', 'gear stat labels'),
  focus: def('{1:1.8,2:1.35}', 'focused multiplier'),
  twoHand: def('new Set(["greatsword","bow"', 'two-handed weapons'),
  propNames: def('{reach:"Reach",heavy:"Heavy"', 'weapon property names'),
  propList: def('["reach","heavy","finesse","versatile"', 'weapon property list'),
  propCfg: def('{reach:{tiles:', 'weapon property numbers'),
  slots: def('{weapon:"weapon",offhand:"off-hand"', 'slot names'),
};
const chainCut = main.match(/×\$\{([\w$]+)\} ต่อเด้ง/)[1], critMul = fnDef('a.value*', 'affix text')[1].match(/a\.value\*([\w$]+)/)[1];
const tideCap = fnDef('a.value*', 'affix text')[1].match(/Math\.round\(([\w$]+)\*100\)/)[1];
const consts = [chainCut, critMul, tideCap].map(n => { const m = main.match(new RegExp(`(?:const |let |,)${n.replace('$', '\\$')}=([\\d.e-]+)[,;]`)); if (!m) throw new Error('constant ' + n); return [n, m[1]]; });
const [, procText] = fnDef('ติดซ้ำได้ทุก ${', 'trigger text');
const [ssName, ssSrc] = fnDef('{return Math.round(t*' + pieces.scale[0], 'stat scale fn');
const [a2Name, a2Src] = fnDef(`{return ${pieces.scaled[0]}.has(t)?`, 'scaled stat fn');
const [a5Name, a5Src] = fnDef('{return e===1?t:Number.isInteger(t)?Math.round(t*e)', 'focused value fn');
const propsAt = main.indexOf('weaponprops:()=>{'); if (propsAt < 0) throw new Error('weapon property texts');
const propsSrc = exprAt(propsAt + 'weaponprops:'.length);
const jobs = {}; { const at = main.indexOf('novice:{id:"novice",name:"'); for (const m of main.slice(at, at + 80000).matchAll(/(\w+):\{id:"(\w+)",name:"([^"]+)"/g)) if (m[1] === m[2] && !jobs[m[1]]) jobs[m[1]] = m[3]; }
const tipSrc = `(function(){${Object.values(pieces).map(([n, v]) => `const ${n}=${v};`).join('')}${consts.map(([n, v]) => `const ${n}=${v};`).join('')}
${ssSrc}${a2Src}${a5Src}${procText}const weaponprops=${propsSrc};
const props={};for(const p of weaponprops())props[p.key]=p.text;
return{scale:${pieces.scale[0]},scaled:${pieces.scaled[0]},procs:${pieces.procs[0]},procNote:${pieces.procNote[0]},gear:${pieces.gear[0]},focus:${pieces.focus[0]},twoHand:${pieces.twoHand[0]},
propNames:${pieces.propNames[0]},props,slots:${pieces.slots[0]},stat:(k,v)=>${a2Name}(k,v),
affixText(mod,v,mult=1){if(mod.t!=="proc"&&mult!==1)v=${a5Name}(v,mult);if(mod.t==="stat")return"+"+v+" "+mod.stat.toUpperCase();
if(mod.t==="gear"){const[l,p]=${pieces.gear[0]}[mod.key]||[mod.key,!1],c=mod.key==="critDmg"?Math.round(v*${critMul}*10)/10:v;
return mod.key==="manaToHp"?\`Mana Tide: MP ที่ใช้กับสกิลเวท \${c}% กลับเป็น HP (สูงสุด \${Math.round(${tideCap}*100)}% ของ HP สูงสุด/วิ · ไม่มีผลตอนสู้ผู้เล่น)\`:"+"+(p?c:${a2Name}(mod.key,v).toLocaleString("en-US"))+(p?"%":"")+" "+l}
if(mod.t==="cond")return ${pieces.conds[0]}[mod.cond].replace("{v}",String(v));return ${procText.match(/^function ([\w$]+)/)[1]}(mod.proc,v)}}})()`;
// check it runs and gives the texts the game shows
const tip = require('vm').runInNewContext(tipSrc);
if (!/Frenzy: สปีดตี \+20% นาน 5 วิ/.test(tip.affixText({ t: 'proc', proc: 'haste' }, 20)) || !tip.props.versatile) throw new Error('tooltip texts look wrong: ' + tip.affixText({ t: 'proc', proc: 'haste' }, 20));
const wdata = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items', f), 'utf8'));

fs.writeFileSync(out, '// generated by tools/build_item_names.js — do not edit\n'
  + 'window.BT_ITEM_NAMES = ' + JSON.stringify(names) + ';\n'
  + 'window.BT_EQUIP = ' + JSON.stringify(equip) + '; // id -> [wear level, ATK, weapon type / slot, MATK, DEF, stats, bonus, slot, family]\n'
  + 'window.BT_AFFIX = ' + JSON.stringify(affix) + '; // id -> [p|s, tier names, mod]\n'
  + '// the game\'s tooltip pieces: weapon type -> classes / properties / English name, class names, texts\n'
  + 'window.BT_WEAPON = ' + JSON.stringify({ classes: wdata('weapontable_AE.json'), props: wdata('weapontable_Det.json'), names: wdata('weapontable_Ltt.json'), jobs }) + ';\n'
  + 'window.BT_TIP = ' + tipSrc + ';\n');
console.log(`${Object.keys(names).length} names, ${Object.keys(equip).length} equipment, ${Object.keys(affix).length} affixes, ${Object.keys(tip.props).length} weapon texts -> ${path.relative(ROOT, out)}`);
