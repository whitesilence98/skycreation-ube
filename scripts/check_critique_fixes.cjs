// Run: node scripts/check_critique_fixes.cjs http://localhost:3011
// Requires isolated Chromium CDP on 127.0.0.1:9334. Verifies the critique fixes in the live page.
const assert = require('node:assert/strict');
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
    const until = Date.now() + 90000;
    while (Date.now() < until) { if (await evaluate(`Boolean(${expr})`)) return; await new Promise(r => setTimeout(r, 400)); }
    throw Error('Timed out: ' + label);
  };
  const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw Error('missing: ' + ${JSON.stringify(text)}); b.click(); })()`);
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor(`document.querySelector('nav[aria-label="Character categories"]')`, 'rail');
    const dir = path.resolve('.impeccable/review'); fs.mkdirSync(dir, { recursive: true });

    // 1. Face panel is now a single column at the same width as every other category.
    await click('Features');
    await waitFor(`document.querySelector('#creator-editor')`, 'editor');
    const faceWidth = await evaluate(`Math.round(document.querySelector('#creator-editor').getBoundingClientRect().width)`);
    await click('Hair');
    await evaluate(`new Promise(r => setTimeout(r, 400))`);
    const hairWidth = await evaluate(`Math.round(document.querySelector('#creator-editor').getBoundingClientRect().width)`);
    assert.equal(faceWidth, hairWidth, `panel width differs: face ${faceWidth} vs hair ${hairWidth}`);

    // 2. Stored-only sliders are genuinely disabled.
    await click('Features');
    await evaluate(`new Promise(r => setTimeout(r, 400))`);
    const inert = await evaluate(`(() => {
      const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.startsWith('Not connected'));
      if (!d) return { found: false };
      d.open = true;
      const inputs = [...d.querySelectorAll('input[type=range]')];
      return { found: true, total: inputs.length, enabled: inputs.filter(i => !i.disabled).length };
    })()`);
    assert.ok(inert.found, 'Not connected section missing');
    assert.equal(inert.enabled, 0, `${inert.enabled} of ${inert.total} inert sliders are still enabled`);

    // 3. Footer labels are honest.
    const labels = await evaluate(`(() => {
      const t = [...document.querySelectorAll('footer button')].map(b => b.textContent.trim());
      return { compare: t.find(x => x.includes('compare')) || null, primary: t.find(x => x.includes('Preview')) || null };
    })()`);
    assert.ok(!/original/i.test(labels.compare || ''), `compare still says original: ${labels.compare}`);
    assert.ok(/compare point/i.test(labels.primary || ''), `primary action unclear: ${labels.primary}`);

    // 4. Drawer focus does not land on RESET, and the panel toggle hides while a drawer is open.
    await evaluate(`document.querySelector('button[aria-label="Camera"]').click()`);
    await waitFor(`document.querySelector('[aria-label="Studio properties"]')`, 'drawer');
    const focus = await evaluate(`(() => { const a = document.activeElement; return { tag: a.tagName, text: (a.textContent||'').trim().slice(0,20), isReset: (a.textContent||'').trim().toUpperCase() === 'RESET' }; })()`);
    assert.equal(focus.isReset, false, 'focus landed on RESET');
    const toggleHidden = await evaluate(`(() => { const b = document.querySelector('.creator-editor-toggle'); return b ? b.hidden : 'missing'; })()`);
    assert.equal(toggleHidden, true, 'panel toggle still reports state while the drawer is open');
    await click('Return');

    // 5. Contrast of the panel footer meta.
    const contrast = await evaluate(`(() => {
      const el = [...document.querySelectorAll('footer, div')].find(e => /UBE|ITEMS|SCULPT/i.test(e.textContent || '') && e.children.length === 0);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const parse = s => (s.match(/\\d+(\\.\\d+)?/g) || []).slice(0,3).map(Number);
      const lum = ([r,g,b]) => { const f = v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const fg = parse(cs.color), bg = [7,7,10];
      const [a,b2] = [lum(fg), lum(bg)].sort((x,y) => y-x);
      return { fg: cs.color, ratio: Math.round(((a+0.05)/(b2+0.05)) * 100) / 100 };
    })()`);

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(dir, 'critique-fixes.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ faceWidth, hairWidth, inert, labels, focus, toggleHidden, contrast, errors }, null, 2));
    assert.deepEqual(errors, [], 'runtime exceptions');
    console.log('PASS: panel parity, inert sliders disabled, honest labels, drawer focus, toggle visibility');
    console.log('NOT ASSESSED: subjective feel, mobile 390 layout, contrast on every panel variant');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
