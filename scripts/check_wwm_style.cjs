// Run: node scripts/check_wwm_style.cjs http://localhost:3011
// Captures the restyled editor at the reference's 1920x1080 for comp-diff.
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const url = process.argv[2] || 'http://localhost:3011';
  const target = await (await fetch(`http://127.0.0.1:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, label) => {
    const until = Date.now() + 120000;
    while (Date.now() < until) { if (await evaluate(`Boolean(${expr})`)) return; await new Promise(r => setTimeout(r, 400)); }
    throw Error('Timed out: ' + label);
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor(`document.querySelector('nav[aria-label="Character categories"]')`, 'rail');
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Outfit'); if (b) b.click(); })()`);
    await new Promise(r => setTimeout(r, 9000));
    const dir = path.resolve('.impeccable/review'); fs.mkdirSync(dir, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(dir, 'wwm-build.png'), Buffer.from(shot.data, 'base64'));
    const probe = await evaluate(`(() => {
      const g = s => getComputedStyle(document.querySelector(s) || document.body);
      return {
        canvas: !!document.querySelector('canvas'),
        rail: [...document.querySelectorAll('.creator-category')].map(b => ({ t: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color })),
        editor: g('#creator-editor').backgroundColor, editorColor: g('#creator-editor').color,
        footer: g('.creator-footer').backgroundImage.slice(0, 60),
        primary: (() => { const b = document.querySelector('.creator-primary-action'); return b ? { bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color, text: b.textContent.trim() } : null; })(),
      };
    })()`);
    console.log(JSON.stringify({ probe, errors }, null, 2));
    console.log('CAPTURED .impeccable/review/wwm-build.png');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
