// Run against app + isolated Chromium CDP: node scripts/check_preset_library_browser.cjs [url]
const assert = require('node:assert/strict');
(async () => {
  const url = process.argv[2] || 'http://localhost:3000';
  const tab = await (await fetch(`http://localhost:9334/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const number = ++id; pending.set(number, { resolve, reject });
    ws.send(JSON.stringify({ id: number, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error('Timed out: ' + expression);
  };
  const label = 'Browser check ' + Date.now();
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url });
    await wait(`!!document.querySelector('nav[aria-label="Character categories"]')`);
    await evaluate(`(() => { const button = [...document.querySelectorAll('nav button')].find(e => /preset/i.test(e.textContent)); if (!button) throw Error('Preset category missing'); button.click(); })()`);
    await wait(`!![...document.querySelectorAll('button')].find(e => /save current character/i.test(e.textContent) && !e.disabled)`);
    await wait(`!!document.querySelector('canvas') && document.querySelector('canvas').width > 0`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => /save current character/i.test(e.textContent)); button.click(); })()`);
    await wait(`!!document.querySelector('dialog[open] input')`);
    await evaluate(`(() => { const input = document.querySelector('dialog[open] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(label)}); input.dispatchEvent(new Event('input', { bubbles:true })); })()`);
    await evaluate(`document.querySelector('dialog[open] form').requestSubmit()`);
    await wait(`!document.querySelector('dialog[open]') && document.body.textContent.includes(${JSON.stringify(label)})`);
    const record = await evaluate(`new Promise((resolve,reject)=>{ const r=indexedDB.open('lyra-preset-library',1); r.onerror=()=>reject(r.error); r.onsuccess=()=>{const db=r.result,t=db.transaction('presets'),q=t.objectStore('presets').getAll();q.onsuccess=()=>resolve(q.result.find(e=>e.label===${JSON.stringify(label)}));t.oncomplete=()=>db.close()}})`);
    assert.ok(record, 'saved record');
    assert.equal(record.preset.format, 'lyra-preset');
    assert.ok(record.thumbnail?.startsWith('data:image/'), 'composited thumbnail saved');
    const dimensions = await evaluate(`new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);const p=x.getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let n=0;n<p.length;n+=4) colors.add(p[n]+','+p[n+1]+','+p[n+2]);resolve([i.width,i.height,colors.size])};i.onerror=reject;i.src=${JSON.stringify(record.thumbnail)}})`);
    assert.deepEqual(dimensions.slice(0,2), [256,256]);
    assert.ok(dimensions[2] > 20, 'thumbnail not blank');
    await send('Page.reload');
    await wait(`!!document.querySelector('nav[aria-label="Character categories"]')`);
    await evaluate(`[...document.querySelectorAll('nav button')].find(e => /preset/i.test(e.textContent)).click()`);
    await wait(`document.body.textContent.includes(${JSON.stringify(label)})`);
    // Remove only this run's record; leave existing user presets untouched.
    await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('lyra-preset-library',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('presets','readwrite');t.objectStore('presets').delete(${JSON.stringify(record.id)});t.oncomplete=()=>{db.close();resolve(true)};t.onabort=()=>reject(t.error)}})`);
    console.log('PASS: UI save, IndexedDB commit, nonblank 256px thumbnail, reload persistence; test record removed');
    console.log('NOT ASSESSED: rename/update/delete confirmations, keyboard focus, visual likeness');
  } finally { await send('Page.close').catch(() => {}); ws.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
