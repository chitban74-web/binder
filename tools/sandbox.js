const fs=require('fs'),vm=require('vm'),acorn=require('acorn');
const [,,src,out]=process.argv;
const code=fs.readFileSync(src,"utf8").replace(/import.meta/g,"__IM");
const ast=acorn.parse(code,{ecmaVersion:'latest',sourceType:'module'});
const STUBS=new WeakSet();
function stub(){const f=function(){};const p=new Proxy(f,{
 get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k===Symbol.iterator)return function*(){};if(k==='then')return undefined;if(k==='length')return 0;if(k==='toString'||k==='valueOf')return()=>'';return stub();},
 set(){return true;},apply(){return stub();},construct(){return stub();},has(){return false;},deleteProperty(){return true;}});
 STUBS.add(p);return p;}
const noop=()=>0;
const ctx={console:{log:noop,warn:noop,error:noop,info:noop,debug:noop},setTimeout:noop,setInterval:noop,clearTimeout:noop,clearInterval:noop,requestAnimationFrame:noop,cancelAnimationFrame:noop,queueMicrotask:noop,
 document:stub(),navigator:{userAgent:'node',language:'th',maxTouchPoints:0,hardwareConcurrency:4},location:{hostname:'play.bindertowngame.com',href:'https://play.bindertowngame.com/',search:'',hash:'',pathname:'/',origin:'https://play.bindertowngame.com',protocol:'https:',host:'play.bindertowngame.com'},
 localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
 fetch:()=>new Promise(()=>{}),WebSocket:function(){return stub()},Image:function(){return stub()},Audio:function(){return stub()},AudioContext:function(){return stub()},
 matchMedia:()=>({matches:false,addEventListener:noop,addListener:noop}),addEventListener:noop,removeEventListener:noop,innerWidth:1280,innerHeight:720,devicePixelRatio:1,performance:{now:()=>0},
 HTMLElement:function(){},Element:function(){},Node:function(){},Event:function(){},CustomEvent:function(){},ResizeObserver:function(){return stub()},MutationObserver:function(){return stub()},IntersectionObserver:function(){return stub()},
 URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, BroadcastChannel:function(){return stub()},Worker:function(){return stub()},
};
ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
ctx.__IM={url:"https://play.bindertowngame.com/assets/main.js",env:{}};vm.createContext(ctx);const CM=vm.runInContext("Map",ctx),CS=vm.runInContext("Set",ctx),CO=vm.runInContext("Object.prototype",ctx),CA=vm.runInContext("Array",ctx);
const names=[];const pieces=[];const fns=[];
for(const st of ast.body){
 if(st.type==='ImportDeclaration'){for(const s of st.specifiers){ctx[s.local.name]=stub();}continue;}
 let n=st; if(n.type==='ExportNamedDeclaration'){if(!n.declaration)continue;n=n.declaration;}
 if(n.type==='FunctionDeclaration'){fns.push(code.slice(n.start,n.end));names.push(n.id.name);continue;}
 if(n.type==='ClassDeclaration'){pieces.push(`var ${n.id.name}=`+code.slice(n.start,n.end)+';');names.push(n.id.name);continue;}
 if(n.type==='VariableDeclaration'){
  for(const d of n.declarations){ if(d.id.type==='Identifier')names.push(d.id.name); else {/*destructuring*/ const s=code.slice(d.id.start,d.id.end); (s.match(/[A-Za-z_$][\w$]*/g)||[]).forEach(x=>names.push(x));} }
  // split declarators so one failure doesn't kill siblings
  for(const d of n.declarations) pieces.push('var '+code.slice(d.start,d.end)+';');
  continue;}
 pieces.push(code.slice(n.start,n.end));
}
let ok=0,fail=0;
try{vm.runInContext(fns.join('\n'),ctx,{timeout:5000});}catch(e){console.log('fn decl fail',e.message)}
for(const p of pieces){try{vm.runInContext(p,ctx,{timeout:3000});ok++;}catch(e){fail++;}}
console.log('statements ok',ok,'fail',fail,'names',names.length);
// serialize
function ser(v,depth,seen){
 if(v===null||typeof v==='number'||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='undefined')return undefined;
 if(typeof v==='bigint')return String(v);
 if(STUBS.has(v))return undefined;
 if(typeof v==='function')return undefined;
 if(typeof v!=='object')return undefined;
 if(seen.has(v))return '[circular]';
 if(depth>12)return '[deep]';
 seen.add(v);let r;
 try{
 if(Array.isArray(v))r=v.map(x=>{const s=ser(x,depth+1,seen);return s===undefined?null:s;});
 else if(v instanceof CM||v instanceof Map){r={};for(const [k,x] of v){const s=ser(x,depth+1,seen);if(s!==undefined)r[String(k)]=s;}}
 else if(v instanceof CS||v instanceof Set){r=[...v].map(x=>ser(x,depth+1,seen)).filter(x=>x!==undefined);}
 else {const proto=Object.getPrototypeOf(v);const plain=proto===null||proto===CO||proto===Object.prototype;
   if(!plain&&!(v instanceof CA)) {seen.delete(v);return undefined;}
   r={};for(const k of Object.keys(v)){let x;try{x=v[k]}catch{continue}const s=ser(x,depth+1,seen);if(s!==undefined)r[k]=s;}}
 }finally{seen.delete(v);}
 return r;
}
const res={};
for(const n of new Set(names)){let v;try{v=vm.runInContext(n,ctx)}catch{continue}
 const s=ser(v,0,new Set()); if(s===undefined)continue; if(typeof s!=='object'||s===null)continue;
 const len=JSON.stringify(s).length; if(len<30)continue; res[n]=s;}
fs.writeFileSync(out,JSON.stringify(res));
console.log('tables',Object.keys(res).length);
