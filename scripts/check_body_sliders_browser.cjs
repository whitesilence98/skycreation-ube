// Run against a running app + isolated Chromium CDP: node scripts/check_body_sliders_browser.cjs [url]
const assert = require('node:assert/strict');
(async () => {
  const url = process.argv[2] || 'http://localhost:3000';
  const tab = await (await fetch(`http://localhost:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 300));
    }
    throw Error('Timed out: ' + expression);
  };
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url });
    await wait(`!!document.querySelector('nav[aria-label="Character categories"]')`);
    await evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Character categories"] button')].find(e => /body/i.test(e.textContent)); if (!b) throw Error('Body category missing'); b.click(); })()`);
    await wait(`!![...document.querySelectorAll('input[type="range"]')].find(e => /head size/i.test(e.getAttribute('aria-label') || ''))`);
    const controls = await evaluate(`([...document.querySelectorAll('input[type="range"]')].map(e => ({label:e.getAttribute('aria-label'), min:e.min, max:e.max, value:e.value, disabled:e.disabled})))`);
    for (const name of ['Head size', 'Standing height', 'Body fat', 'Shoulder width', 'Chest size', 'Waist size', 'Hip width', 'Arm length', 'Leg length']) {
      assert.ok(controls.some(c => c.label?.toLowerCase().includes(name.toLowerCase()) && !c.disabled), name + ' missing/disabled');
    }
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('PASS: nine body controls rendered/enabled; no runtime exceptions');
    console.log('NOT ASSESSED: visual deformation, grounding, GLB viewer appearance');
  } finally {
    await send('Page.close').catch(() => {});
    ws.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
