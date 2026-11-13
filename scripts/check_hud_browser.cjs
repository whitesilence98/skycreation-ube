// Run: node scripts/check_hud_browser.cjs [baseline]
// Requires app on localhost:3000 and isolated Chromium CDP on localhost:9334.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const baseline = process.argv[2] === 'baseline';
  const target = await (await fetch('http://127.0.0.1:9334/json/new?http://localhost:3000', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || JSON.stringify(msg.params.exceptionDetails));
    if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression) => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Timed out: ' + expression);
  };
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://localhost:3000' });
    await wait(`document.querySelector('canvas') && document.querySelector('nav[aria-label="Primary"]')`);
    await wait(`![...document.querySelectorAll('[aria-hidden="false"]')].some(e => e.textContent.includes('LOADING ASSETS'))`);
    await evaluate(`document.fonts.ready.then(() => true)`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const dir = path.resolve('.impeccable/review');
    fs.mkdirSync(dir, { recursive: true });
    const summaries = [];
    for (const [name, width, height] of [['desktop', 1440, 900], ['compact', 1024, 768], ['mobile', 390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate(`new Promise(r=>setTimeout(r,600))`);
      const metrics = await evaluate(`(() => {
        const visible = e => {
          const r = e.getBoundingClientRect();
          return e.getClientRects().length && !e.closest('[aria-hidden="true"], [inert]') && getComputedStyle(e).visibility !== 'hidden' && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        };
        const tiny = [...document.querySelectorAll('button,input,select,label,span,p,h1,h2,h3,dt,dd')].filter(e => visible(e) && (e.textContent.trim() || e.matches('input,select')) && parseFloat(getComputedStyle(e).fontSize)<10).map(e=>({text:e.textContent.trim().slice(0,60),size:getComputedStyle(e).fontSize}));
        return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,tiny:tiny.slice(0,20),canvas:!!document.querySelector('canvas'),buttons:[...document.querySelectorAll('button')].filter(visible).map(e=>e.getAttribute('aria-label')||e.textContent.trim()).slice(0,60)};
      })()`);
      summaries.push({ name, ...metrics });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(dir, `${baseline ? 'baseline-' : ''}${name}.png`), Buffer.from(shot.data, 'base64'));
      if (!baseline) {
        assert.ok(metrics.canvas, 'canvas missing');
        assert.ok(metrics.scrollWidth <= width, `${name}: horizontal page overflow`);
        assert.deepEqual(metrics.tiny, [], `${name}: text below 10px`);
      }
    }
    fs.writeFileSync(path.join(dir, `${baseline ? 'baseline-' : ''}metrics.json`), JSON.stringify({ summaries, errors }, null, 2));
    console.log(JSON.stringify({ summaries, errors }, null, 2));
    if (!baseline) assert.deepEqual(errors, [], 'runtime exceptions');
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
