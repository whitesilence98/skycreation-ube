// Run: node scripts/check_face_browser.cjs [http://localhost:3000]
// Requires an isolated Chromium CDP endpoint at localhost:9334.
const assert = require('node:assert/strict');
(async () => {
  const url = process.argv[2] || 'http://localhost:3000';
  const target = await (await fetch(`http://127.0.0.1:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const job = pending.get(message.id);
    if (job) { pending.delete(message.id); message.error ? job.reject(Error(message.error.message)) : job.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    const end = Date.now() + 120000;
    do {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < end);
    throw Error('Timed out: ' + expression);
  };
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw Error('Missing button: ' + ${JSON.stringify(text)}); button.click();
  })()`);
  const stored = () => evaluate(`JSON.parse(localStorage.getItem('lyra.character-session.v2')).state`);
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await wait(`document.querySelector('nav[aria-label="Character categories"]')`);
    await evaluate(`localStorage.removeItem('lyra.character-session.v2')`);
    await send('Page.reload');
    await wait(`document.querySelector('nav[aria-label="Character categories"]')`);
    await click('Styling'); await click('Lashes');
    await wait(`document.querySelectorAll('button[aria-label^="Select lash shape"]').length === 18`);
    assert.equal(await evaluate(`[...document.querySelectorAll('nav[aria-label="Appearance categories"] button')].some(b => /Wrinkle/i.test(b.textContent))`), false);
    await evaluate(`document.querySelectorAll('button[aria-label^="Select lash shape"]')[1].click()`);
    await wait(`JSON.parse(localStorage.getItem('lyra.character-session.v2'))?.state.assetSelection.lashesMesh`);
    let state = await stored();
    assert.ok(state.assetSelection.lashes);
    const lashId = state.assetSelection.lashesMesh;
    await click('TEX');
    await wait(`document.querySelectorAll('button[aria-label^="Select lash atlas"]').length === 18`);
    await evaluate(`(() => { const input=document.querySelector('input[aria-label="Lash color"]'); input.closest('details').open=true;
      const slider=input.closest('details').querySelector('[role="slider"]');
      slider.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})); })()`);
    await wait(`JSON.parse(localStorage.getItem('lyra.character-session.v2')).state.lashesOpacity === 0`);
    await click('Mouth');
    await wait(`document.querySelectorAll('button[aria-label^="Select mouth shape"]').length === 1`);
    await evaluate(`document.querySelector('button[aria-label^="Select mouth shape"]').click()`);
    await wait(`JSON.parse(localStorage.getItem('lyra.character-session.v2'))?.state.assetSelection.mouthMesh`);
    state = await stored();
    const mouthId = state.assetSelection.mouthMesh;
    assert.equal(state.assetSelection.mouth, 'mouth-fcaa27b87cdf20eb');
    console.log('face browser: pairing and keyboard opacity OK');
    await click('Tattoos');
    await wait(`document.querySelectorAll('button[aria-label^="Add "]').length === 92`);
    await evaluate(`document.querySelectorAll('button[aria-label^="Add "]')[0].click()`);
    await wait(`JSON.parse(localStorage.getItem('lyra.character-session.v2'))?.state.overlayLayers.some(l => l.kind === 'tattoo')`);
    await wait(`document.querySelectorAll('button[aria-label^="Remove Warpaint"]').length >= 1`);
    state = await stored();
    const tattooId = state.overlayLayers.find(l => l.kind === 'tattoo').id;
    for (let count = state.overlayLayers.length; count < 8; count++) {
      const addedLabel = await evaluate(`(() => { const button=document.querySelector('button[aria-label^="Add "]'); const label=button.getAttribute('aria-label').replace(/^Add /, 'Remove '); button.click(); return label; })()`);
      await wait(`JSON.parse(localStorage.getItem('lyra.character-session.v2')).state.overlayLayers.length === ${count + 1}`);
      await wait(`document.querySelector('button[aria-label=' + ${JSON.stringify(JSON.stringify(addedLabel))} + ']')`);
    }
    const capped = JSON.stringify((await stored()).overlayLayers);
    await evaluate(`document.querySelector('button[aria-label^="Add "]').click()`);
    assert.equal(JSON.stringify((await stored()).overlayLayers), capped, 'ninth layer must not evict existing paint');
    // Seed legacy state in this isolated browser, then exercise real F5 hydration.
    await evaluate(`(() => { const key='lyra.character-session.v2'; const saved=JSON.parse(localStorage.getItem(key));
      saved.state.lashesColor='#123456'; saved.state.lashesOpacity=0.4;
      saved.state.subTab='WRINKLE'; saved.state.activeCategory='wrinkle';
      saved.state.overlayLayers.push({kind:'wrinkle',id:'legacy',color:'#123456',opacity:1});
      saved.state.assetSelection.wrinkle='legacy'; localStorage.setItem(key,JSON.stringify(saved)); })()`);
    await send('Page.reload');
    await wait(`document.querySelector('nav[aria-label="Appearance categories"] button[aria-pressed="true"]')?.textContent.trim() === 'Skin'`);
    await click('Lashes');
    await wait(`document.querySelectorAll('button[aria-label^="Select lash shape"]').length === 18`);
    state = await stored();
    assert.equal(state.lashesColor, '#123456'); assert.equal(state.lashesOpacity, 0.4);
    assert.equal(state.assetSelection.lashesMesh, lashId); assert.equal(state.assetSelection.mouthMesh, mouthId);
    assert.ok(state.overlayLayers.some(l => l.id === tattooId));
    assert.ok(!state.overlayLayers.some(l => l.kind === 'wrinkle'));
    assert.equal(state.assetSelection.wrinkle, undefined);
    assert.deepEqual(errors, []);
    console.log('face browser: Lashes/Mouth/Tattoos routing, pairing, F5 tint/selection, legacy cleanup OK');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
