// Run: node scripts/diag_wwm_state.cjs http://localhost:3011
const fs = require('node:fs');
(async () => {
  const url = process.argv[2] || 'http://localhost:3011';
  const target = await (await fetch(`http://127.0.0.1:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, label) => {
    const until = Date.now() + 90000;
    while (Date.now() < until) { if (await evaluate(`Boolean(${expr})`)) return; await new Promise(r => setTimeout(r, 400)); }
    throw Error('Timed out: ' + label);
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor(`document.querySelector('nav[aria-label="Character categories"]')`, 'rail');
    const before = await evaluate(`(() => ({
      active: [...document.querySelectorAll('.creator-category')].map(b => b.getAttribute('aria-pressed') + ':' + b.textContent.trim()),
      panelText: (document.querySelector('#creator-editor')?.textContent || '').replace(/\\s+/g,' ').slice(0, 90)
    }))()`);
    await evaluate(`(() => { const b = [...document.querySelectorAll('.creator-category')].find(x => x.textContent.trim() === 'Outfit'); b.click(); })()`);
    await new Promise(r => setTimeout(r, 2500));
    const after = await evaluate(`(() => ({
      active: [...document.querySelectorAll('.creator-category')].map(b => b.getAttribute('aria-pressed') + ':' + b.textContent.trim()),
      panelText: (document.querySelector('#creator-editor')?.textContent || '').replace(/\\s+/g,' ').slice(0, 120),
      panelClass: document.querySelector('#creator-editor')?.className,
      cameraFraming: (() => { try { return window.__lyraCamera || 'n/a'; } catch { return 'n/a'; } })(),
    }))()`);
    console.log(JSON.stringify({ before, after }, null, 2));
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
