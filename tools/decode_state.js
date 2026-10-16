const fs=require('fs'),{Reflection}=require('@colyseus/schema');
const f=JSON.parse(fs.readFileSync('frames.json','utf8'));
const h=Buffer.from(f.h,'base64'), s=Buffer.from(f.s,'base64');
let i=1; const tl=h[i++]; i+=tl; const sl=h[i++]; i+=sl;
const dec=Reflection.decode(h,{offset:i});
const ctx=dec.context; const nameOf=c=>{for(const [id,t] of Object.entries(ctx.types)) if(t===c) return 'T'+id; return c&&c.name;};
const types={};
for(const [id,c] of Object.entries(ctx.types)){const md=c[Symbol.metadata]||{};const fl={};for(const k of Object.keys(md)){if(isNaN(+k))continue;const m=md[k];let t=m.type;if(typeof t==='function')t=nameOf(t);else if(t&&typeof t==='object'){const [kind,inner]=Object.entries(t)[0];t=kind+'<'+(typeof inner==='function'?nameOf(inner):inner)+'>';}fl[m.name]=t;}types['T'+id]=fl;}
dec.decode(s,{offset:1});
const st=dec.state.toJSON();
const pick=o=>o&&Object.values(o)[0];
const out={types,root:'T'+Object.entries(ctx.types).find(([k,c])=>c===dec.state.constructor)[0],state:{mapId:st.mapId,dayTime:st.dayTime,worldTime:st.worldTime,pt:st.pt,counts:Object.fromEntries(Object.entries(st).filter(([k,v])=>v&&typeof v==='object').map(([k,v])=>[k,Object.keys(v).length])),player:pick(st.players),mob:pick(st.mobs),node:pick(st.nodes),loot:pick(st.loots),bossZone:pick(st.bossZones)}};
fs.writeFileSync('schema.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,0).slice(0,6000));
