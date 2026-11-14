// Run: node scripts/check_skin_browser.cjs (app :3000, isolated Chromium CDP :9334)
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const target = await (await fetch('http://127.0.0.1:9334/json/new?http://localhost:3000', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Timed out: ' + expression);
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://localhost:3000' });
    await wait(`document.querySelector('canvas') && document.querySelector('nav[aria-label="Primary"]')`);
    await wait(`![...document.querySelectorAll('[aria-hidden="false"]')].some(e => e.textContent.includes('LOADING ASSETS'))`);
    const buttons = await evaluate(`Array.from(document.querySelectorAll('button')).map(e=>({label:e.getAttribute('aria-label'),title:e.title,text:e.textContent.trim().slice(0,40)}))`);
    console.log('controls', JSON.stringify(buttons.filter(b=>/graphics|visual|camera/i.test(JSON.stringify(b)))));
    await evaluate(`document.querySelector('button[title^="Graphics & Shaders"]')?.click()`);
    const select = 'select[aria-label="Tone mapping"]';
    await wait(`document.querySelector('${select}')`);
    for (const mode of ['aces', 'agx', 'cineon', 'neutral']) {
      await evaluate(`(()=>{const s=document.querySelector('${select}');s.value='${mode}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await evaluate(`new Promise(r=>setTimeout(r,700))`);
      assert.equal(await evaluate(`document.querySelector('${select}').value`), mode);
    }
    for (const label of ['Skin detail', 'Skin sheen']) {
      for (const value of [0, 1, label === 'Skin detail' ? 0.45 : 0.2]) {
        await evaluate(`(()=>{const s=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'${value}');s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await evaluate(`new Promise(r=>setTimeout(r,500))`);
        assert.equal(await evaluate(`Number(document.querySelector('input[aria-label="${label}"]').value)`), value);
      }
    }
    await evaluate(`document.querySelector('button[title="Click to change skin texture"]').click()`);
    const skins = await evaluate(`Array.from(document.querySelectorAll('button')).filter(b=>b.querySelector('img') && b.textContent.trim().startsWith('[')).map(b=>b.textContent.trim())`);
    assert.ok(skins.length >= 7, 'skin families available');
    for (const name of [...skins.slice(1), skins[0]]) {
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.querySelector('img') && b.textContent.trim()===${JSON.stringify(name)}).click()`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='APPLY').click()`);
      await evaluate(`new Promise(r=>setTimeout(r,1800))`);
      await evaluate(`document.querySelector('button[title="Click to change skin texture"]').click()`);
    }
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='CANCEL').click()`);
    console.log('skin families', JSON.stringify(skins));
    const state = await evaluate(`(()=>{const c=document.querySelector('canvas');const r=c.__r3f;return {canvas:[c.width,c.height],r3fKeys:r?Object.keys(r):[]}})()`);
    console.log('render', JSON.stringify(state));
    fs.mkdirSync('.impeccable/review', { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('.impeccable/review/skin-realism.png', Buffer.from(shot.data, 'base64'));
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 740, y: 540, button: 'left', buttons: 1, clickCount: 1 });
    for (let x = 750; x <= 880; x += 10) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 540, button: 'left', buttons: 1 });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 880, y: 540, button: 'left', buttons: 0, clickCount: 1 });
    await evaluate(`new Promise(r=>setTimeout(r,1000))`);
    const profile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('.impeccable/review/skin-profile.png', Buffer.from(profile.data, 'base64'));
    assert.deepEqual(errors, [], 'browser errors');
    console.log('tone mapping interaction, skin screenshot and browser errors: ok');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
