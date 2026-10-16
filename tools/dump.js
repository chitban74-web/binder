// One-shot dump of the live Binder Town client: download -> evaluate -> classify -> data/ + protocol.
// usage (from tools/): npm install   then   node dump.js
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const BASE = 'https://play.bindertowngame.com';
const ROOT = path.resolve(__dirname, '..'), RAW = path.join(ROOT, 'raw'), WORK = path.join(RAW, '_work');

async function get(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer()); if (file) fs.writeFileSync(file, buf); return buf.toString('utf8');
}

function runWorker(file) {
  return new Promise((resolve) => {
    const ctx = { console, setTimeout, clearTimeout, performance, URL };
    ctx.self = ctx; ctx.postMessage = m => resolve(m && m.ok ? m.data : null);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { timeout: 60000 });
    if (typeof ctx.onmessage === 'function') ctx.onmessage({ data: 0 }); else resolve(null);
    setTimeout(() => resolve(null), 30000);
  });
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const html = await get(BASE + '/', path.join(RAW, 'index.html'));
  const mainUrl = (html.match(/\/assets\/main-[\w-]+\.js/) || [])[0];
  if (!mainUrl) throw new Error('main-*.js not found in index.html');
  const main = await get(BASE + mainUrl, path.join(RAW, 'main.js'));
  const build = (main.match(/patch-notes\.json\?b=\$\{encodeURIComponent\("([\w-]+)"\)/) || main.match(/\b(20\d{6}-\d{6})\b/) || [])[1] || '';
  for (const u of new Set(html.match(/\/assets\/vendor-[\w-]+\.js/g) || [])) await get(BASE + u, path.join(RAW, 'vendor.js'));
  const workerUrl = (main.match(/\/assets\/dropindex\.worker-[\w-]+\.js/) || [])[0];
  if (workerUrl) await get(BASE + workerUrl, path.join(RAW, 'dropindex.worker.js'));
  await get(`${BASE}/patch-notes.json${build ? '?b=' + build : ''}`, path.join(RAW, 'patch-notes.json')).catch(() => {});
  console.log('main', mainUrl, 'build', build || '?');

  const vars = path.join(WORK, 'vars.json'), drops = path.join(WORK, 'dropindex.json');
  execFileSync(process.execPath, [path.join(__dirname, 'sandbox.js'), path.join(RAW, 'main.js'), vars], { stdio: 'inherit' });
  const di = workerUrl ? await runWorker(path.join(RAW, 'dropindex.worker.js')) : null;
  fs.writeFileSync(drops, JSON.stringify(di || { drops: [], spawns: [] }));
  console.log('drop index', di ? di.drops.length + ' items' : 'not available');

  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), vars, drops, path.join(ROOT, 'data'), `${mainUrl} ${build}`], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(__dirname, 'proto.js'), path.join(RAW, 'main.js'), path.join(ROOT, 'protocol', 'protocol.json')], { stdio: 'inherit' });
  fs.writeFileSync(path.join(RAW, 'BUILD.txt'), `${mainUrl}\n${build}\n${new Date().toISOString()}\n`);
})().catch(e => { console.error(e); process.exit(1); });
