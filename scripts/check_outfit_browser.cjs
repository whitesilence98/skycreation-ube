// Run: node scripts/check_outfit_browser.cjs [http://localhost:3000]
// Existing server + Chromium CDP :9334. Fresh browser context; never touches another tab's storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SESSION = 'lyra.character-session.v2';
const prefix = `Wardrobe ${Date.now()}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url, onEvent = () => {}) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data), job = pending.get(msg.id);
    if (job) { pending.delete(msg.id); clearTimeout(job.timer); msg.error ? job.reject(Error(msg.error.message)) : job.resolve(msg.result); }
    else onEvent(msg);
  };
  return {
    ws,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => { pending.delete(n); reject(Error(`CDP timeout: ${method}`)); }, 120000);
      pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }));
    }),
  };
}
(async () => {
  const url = process.argv[2] || 'http://localhost:3000';
  const version = await (await fetch('http://127.0.0.1:9334/json/version')).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  let context, target, page, originalSession, captured = false;
  const errors = [], metrics = [];
  const testIds = new Set();
  try {
    context = (await browser.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
    target = (await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context })).targetId;
    const tab = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(t => t.id === target);
    assert.ok(tab?.webSocketDebuggerUrl, 'isolated tab created');
    page = await connect(tab.webSocketDebuggerUrl, msg => {
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Page.javascriptDialogOpening') void page.send('Page.handleJavaScriptDialog', { accept: true });
    });
    const send = page.send;
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const end = Date.now() + 120000;
      do { if (await evaluate(`Boolean(${expression})`)) return; await pause(250); } while (Date.now() < end);
      throw Error(`Timed out: ${expression}; page=${await evaluate(`JSON.stringify({text:document.body.innerText.slice(0,1800),session:localStorage.getItem(${JSON.stringify(SESSION)})?.slice(0,600)})`)}; errors=${JSON.stringify(errors)}`);
    };
    const click = (label, root = 'document') => evaluate(`(() => {
      const e = [...(${root}).querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || [...e.children].some(c => !c.matches('.creator-key') && c.textContent.trim() === ${JSON.stringify(label)}));
      if (!e || e.disabled) throw Error('Missing/enabled button: ' + ${JSON.stringify(label)}); e.focus(); e.click();
    })()`);
    const rail = label => click(label, `document.querySelector('nav[aria-label="Character categories"]')`);
    const rows = () => evaluate(`new Promise((resolve,reject) => {
      const r = indexedDB.open('lyra-outfit-library',1);
      r.onerror = () => reject(r.error); r.onsuccess = () => { const db=r.result;
        const tx=db.transaction('outfits','readonly'); const q=tx.objectStore('outfits').getAll();
        let value; q.onsuccess=()=>{value=q.result}; tx.oncomplete=()=>{db.close();resolve(value)}; tx.onabort=()=>{db.close();reject(tx.error)};
      };
    })`);
    const stored = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(SESSION)})).state`);
    const key = async key => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === 'Escape' ? 'Escape' : 'Space', windowsVirtualKeyCode: key === 'Escape' ? 27 : 32 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'Escape' ? 'Escape' : 'Space', windowsVirtualKeyCode: key === 'Escape' ? 27 : 32 });
    };
    const importFile = (name, content) => evaluate(`(() => {
      const input=document.querySelector('input[aria-label="Import outfit JSON"]');
      const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:'application/json'}));
      input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await wait(`document.querySelector('nav[aria-label="Character categories"]') && localStorage.getItem(${JSON.stringify(SESSION)})`);
    originalSession = await evaluate(`localStorage.getItem(${JSON.stringify(SESSION)})`); captured = true;
    const seed = JSON.parse(originalSession);
    seed.state.equipment = { top:'wardrobe-check-top', feet:'wardrobe-check-feet' };
    seed.state.assetSelection.clothingMesh = 'wardrobe-check-independent';
    seed.state.primaryTab = 'EQUIPMENT'; seed.state.workspace = 'edit';
    const seedScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem(${JSON.stringify(SESSION)},${JSON.stringify(JSON.stringify(seed))})` });
    await send('Page.reload');
    await wait(`document.querySelector('.creator-wardrobe-tabs') && !document.querySelector('.creator-footer-outfit button:disabled')`);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScript.identifier });
    await wait(`document.querySelector('[aria-label="Saved outfit sets"]')`);
    await rail('Outfit');
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Wardrobe actions"]').length`), 1);
    const before = await stored();
    await click('Save outfit', `document.querySelector('footer')`);
    await wait(`document.querySelector('dialog[open] input[aria-label="Outfit label"]:not(:disabled)')`);
    await evaluate(`(() => { const e=document.querySelector('input[aria-label="Outfit label"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(prefix)});
      e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click('Save outfit', `document.querySelector('dialog[open]')`);
    await wait(`!document.querySelector('dialog[open]')`);
    let saved = (await rows()).find(r => r.label === prefix);
    assert.ok(saved, 'save commits to IndexedDB'); testIds.add(saved.id);
    assert.deepEqual(saved.equipment, before.equipment);
    assert.equal(saved.clothingMesh, before.assetSelection.clothingMesh, 'legacy selection is independent');
    assert.ok(!saved.thumbnail || saved.thumbnail.startsWith('data:image/'), 'optional captured thumbnail');
    await evaluate(`document.querySelector('.creator-outfit-more').open=true`);
    await click('Clear all gear', `document.querySelector('.creator-outfit-more')`);
    await wait(`Object.keys(JSON.parse(localStorage.getItem(${JSON.stringify(SESSION)})).state.equipment).length===0`);
    assert.equal((await stored()).assetSelection.clothingMesh, undefined);
    await evaluate(`document.querySelector('button[aria-label='+${JSON.stringify(JSON.stringify('Apply outfit ' + prefix))}+']').click()`);
    await wait(`Object.keys(JSON.parse(localStorage.getItem(${JSON.stringify(SESSION)})).state.equipment).length===2`);
    assert.deepEqual((await stored()).equipment, saved.equipment);
    assert.equal((await stored()).assetSelection.clothingMesh, saved.clothingMesh);
    // A modal owns Escape; the open wardrobe beneath it must survive.
    await evaluate(`document.querySelector('.creator-wardrobe-slot button').click()`);
    await wait(`document.querySelector('[aria-label="Studio properties"]')`);
    await click('Save outfit', `document.querySelector('footer')`);
    await wait(`document.querySelector('dialog[open]')`); await key('Escape');
    await wait(`!document.querySelector('dialog[open]')`);
    assert.ok(await evaluate(`!!document.querySelector('[aria-label="Studio properties"]')`), 'Escape does not close underlying drawer');
    assert.ok(await evaluate(`document.activeElement.textContent.includes('Save outfit')`), 'modal restores footer focus');
    await click('Return', `document.querySelector('footer')`);
    await evaluate(`(() => {const d=document.querySelector('.creator-outfit-more');d.open=true;d.querySelector('summary').focus()})()`);
    await key('Escape');
    assert.equal(await evaluate(`document.querySelector('.creator-outfit-more').open`), false);
    assert.equal(await evaluate(`document.activeElement.matches('.creator-outfit-more > summary')`), true);
    const untouched = await stored(); const count = (await rows()).length;
    for (const [name, value] of [['character.json','{"format":"lyra-preset","version":1}'], ['legacy.jslot','{}'], ['large.json',' '.repeat(32769)]]) {
      await importFile(name, value); await pause(200);
      assert.equal((await rows()).length, count, 'invalid import writes nothing');
      assert.deepEqual((await stored()).equipment, untouched.equipment, 'invalid import preserves gear');
    }
    const importedLabel = prefix + ' import';
    await importFile('outfit.json', JSON.stringify({ format:'lyra-outfit',version:1,label:importedLabel,equipment:{hands:'wardrobe-check-hands'},clothingMesh:'wardrobe-check-separate' }));
    await wait(`document.querySelector('.creator-toast')?.textContent.includes('IMPORTED')`);
    const imported = (await rows()).find(r => r.label === importedLabel); assert.ok(imported); testIds.add(imported.id);
    assert.deepEqual((await stored()).equipment, { hands:'wardrobe-check-hands' });
    assert.equal((await stored()).assetSelection.clothingMesh, 'wardrobe-check-separate');
    assert.deepEqual((await stored()).face, untouched.face, 'import preserves face');
    await send('Page.reload');
    await wait(`document.querySelector('button[aria-label='+${JSON.stringify(JSON.stringify('Apply outfit ' + importedLabel))}+']')`);
    assert.deepEqual((await stored()).equipment, imported.equipment, 'reload retains outfit');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-outfit-screens-'));
    for (const [width,height] of [[1440,900],[1024,768],[900,830],[830,830],[761,830],[390,844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:false }); await pause(200);
      const metric = await evaluate(`(() => {const e=document.querySelector('#creator-editor'),f=document.querySelector('footer'),t=document.querySelector('.creator-tools');
        const r=e.getBoundingClientRect(),fr=f.getBoundingClientRect(),tr=t.getBoundingClientRect();
        return {width:innerWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,editorOverflow:e.scrollWidth-e.clientWidth,
          editorBottom:r.bottom,footerTop:fr.top,toolsTop:tr.top,footerBottom:fr.bottom};})()`);
      assert.ok(metric.pageOverflow<=0, `page overflow at ${width}`); assert.equal(metric.editorOverflow,0,`editor overflow at ${width}`);
      assert.ok(metric.editorBottom<=metric.footerTop,`footer covers editor at ${width}`);
      assert.ok(metric.footerBottom<=height,`footer unreachable at ${width}`);
      await evaluate(`document.querySelector('.creator-wardrobe-slot button').click()`); await pause(100);
      if (width<=900) assert.ok(await evaluate(`document.querySelector('#creator-editor').hidden`),`drawer hides editor at ${width}`);
      await click('Return',`document.querySelector('footer')`);
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(dir,`${width}.png`),Buffer.from(shot.data,'base64')); metrics.push(metric);
    }
    for (const label of [prefix,importedLabel]) {
      await evaluate(`document.querySelector('button[aria-label='+${JSON.stringify(JSON.stringify('Actions for '+label))}+']').click()`);
      await wait(`document.querySelector('dialog[open]')`); await click('Delete',`document.querySelector('dialog[open]')`);
      await wait(`!document.querySelector('dialog[open]')`);
    }
    assert.equal((await rows()).some(r=>testIds.has(r.id)),false,'delete commits');
    assert.deepEqual(errors,[],'browser runtime exceptions');
    console.log(JSON.stringify({result:'PASS',checks:['save','clear','apply','independent clothingMesh','reload','delete','invalid import','valid import','responsive','focus','Escape isolation'],metrics,screenshots:dir,errors},null,2));
  } finally {
    if (page && captured) {
      const expression=`(async()=>{const r=indexedDB.open('lyra-outfit-library',1);await new Promise((resolve,reject)=>{r.onsuccess=resolve;r.onerror=reject});const db=r.result;
        if(db.objectStoreNames.contains('outfits')){const tx=db.transaction('outfits','readwrite');const s=tx.objectStore('outfits');for(const id of ${JSON.stringify([...testIds])})s.delete(id);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject})}db.close();
        ${originalSession === null ? `localStorage.removeItem(${JSON.stringify(SESSION)})` : `localStorage.setItem(${JSON.stringify(SESSION)},${JSON.stringify(originalSession)})`};})()`;
      await page.send('Runtime.evaluate',{expression,awaitPromise:true}).catch(error=>console.error('cleanup:',error.message));
    }
    if(target) await browser.send('Target.closeTarget',{targetId:target}).catch(()=>{});
    page?.ws.close();
    if(context) await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(()=>{});
    browser.ws.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1});
