// Run: node scripts/check_editor_browser.cjs [http://localhost:3002]
// Requires isolated Chromium CDP at localhost:9334. Uses app's real HUD; missing source assets are reported.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const url = process.argv[2] || 'http://localhost:3002';
  const target = await (await fetch(`http://127.0.0.1:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); if (p) msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw Error('Timed out: ' + expression);
  };
  const click = async (label, category = false) => evaluate(`(() => { const root = ${category} ? document.querySelector('nav[aria-label="Character categories"]') : document; const e = [...root.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if (!e) throw Error('Missing button: ' + ${JSON.stringify(label)}); e.click(); })()`);
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await wait(`document.querySelector('nav[aria-label="Character categories"]')`);
    await click('Features', true);
    await wait(`document.querySelector('section[aria-label="Forehead adjustments"], section[aria-label="Nose adjustments"]')`);
    await click('Nose');
    await evaluate('document.fonts.ready');
    const dir = path.resolve('.impeccable/review'); fs.mkdirSync(dir, { recursive: true });
    const summaries = [];
    for (const [name, width, height] of [['redesign-desktop', 1440, 900], ['redesign-compact', 1024, 768], ['redesign-mobile', 390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(r => setTimeout(r, 400))');
      const metrics = await evaluate(`(() => {
        const visible = e => {const r=e.getBoundingClientRect();return !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility!=='hidden' && r.width>0 && r.height>0 && r.right>0 && r.left<innerWidth;};
        return { width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
          canvas:!!document.querySelector('canvas'), editor:document.querySelector('#creator-editor').getBoundingClientRect().toJSON(),
          editorScroll:document.querySelector('#creator-editor').scrollWidth - document.querySelector('#creator-editor').clientWidth,
          overlap: (() => { const e = document.querySelector('#creator-editor').getBoundingClientRect(); const t = document.querySelector('nav[aria-label="Studio tools"]').getBoundingClientRect(); return Math.max(0, Math.min(e.bottom, t.bottom) - Math.max(e.top, t.top)) * Math.max(0, Math.min(e.right, t.right) - Math.max(e.left, t.left)); })(),
          buttons:[...document.querySelectorAll('button')].filter(visible).map(e=>e.getAttribute('aria-label')||e.textContent.trim()),
          issues:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent.trim()) };
      })()`);
      assert.ok(metrics.canvas); assert.ok(metrics.scrollWidth <= width, name + ': horizontal overflow');
      assert.equal(metrics.editorScroll, 0, name + ': editor scrolls horizontally');
      assert.equal(metrics.overlap, 0, name + ': tools overlap editor');
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(shot.data, 'base64')); summaries.push({ name, ...metrics });
    }
    for (const label of ['Presets', 'Hair', 'Body', 'Outfit', 'Styling', 'Features']) {
      await click(label, true);
      await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      assert.equal(await evaluate(`document.querySelector('nav[aria-label="Character categories"] button[aria-pressed="true"]').textContent.trim()`), label);
    }
    // Studio tools must override, never be masked by the active category's properties.
    await evaluate(`document.querySelector('button[aria-label="Lighting"]').click()`);
    await wait(`document.querySelector('[aria-label="Studio properties"]')?.textContent.includes('LIGHTING')`);
    await click('Apply & preview');
    await wait(`![...document.querySelectorAll('nav[aria-label="Character categories"]')].length`);
    await click('Return to editor');
    await wait(`document.querySelector('nav[aria-label="Character categories"]')`);
    fs.writeFileSync(path.join(dir, 'redesign-metrics.json'), JSON.stringify({ summaries, errors }, null, 2));
    console.log(JSON.stringify({ summaries, errors }, null, 2));
    assert.deepEqual(errors, [], 'browser runtime exceptions');
    console.log('PASS: responsive shell, category routing, Lighting override, preview return');
    console.log('NOT ASSESSED: missing source assets/texture fidelity; inspect screenshots and source-asset diagnostics');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
