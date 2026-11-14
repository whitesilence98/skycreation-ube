// Run: node scripts/check_animation_browser.cjs (app :3000, isolated Chromium CDP :9334)
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const unweighted = process.argv.includes('--unweighted');
  const target = await (await fetch('http://127.0.0.1:9334/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      const text = msg.params.args.map(a => a.value || a.description).join(' ');
      if (msg.params.type === 'error' || /PropertyBinding|animation|skeleton/i.test(text)) errors.push(text);
    }
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
  const delay = ms => evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
  const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.click()})()`);
  const setAnimation = value => evaluate(`(()=>{const s=document.querySelector('select[aria-label="Animation"]');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const sample = () => evaluate(`(()=>{const s=window.__animationScene;return ['NPC Spine2 [Spn2]','NPC Head [Head]','NPC L UpperArm [LUar]'].map(n=>{const b=s.getObjectByName(n);if(!b)throw Error('Missing bone '+n);return b.quaternion.toArray()}).flat()})()`);
  const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (unweighted) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const original=window.fetch;window.fetch=async function(input,init){const response=await original.call(this,input,init);const url=typeof input==='string'?input:input.url;if(/handsMesh-[^/]+\\.json/.test(url)){const mesh=await response.clone().json();delete mesh.bones;delete mesh.skinIndex;delete mesh.skinWeight;window.__strippedHands=true;return new Response(JSON.stringify(mesh),{status:200,headers:{'Content-Type':'application/json'}})}return response}})()` });
    }
    await send('Page.navigate', { url: 'http://localhost:3000' });
    await wait(`document.querySelector('canvas') && document.querySelector('button[aria-label="Poses workspace"]')`);
    await wait(`![...document.querySelectorAll('[aria-hidden="false"]')].some(e=>e.textContent.includes('LOADING ASSETS'))`);
    await click('Poses workspace');
    await wait(`document.querySelector('select[aria-label="Animation"]')`);
    await evaluate(`(()=>{const c=document.querySelector('canvas');let f=c[Object.keys(c).find(k=>k.startsWith('__reactFiber'))];for(;f;f=f.return){let h=f.memoizedState;for(let i=0;h&&i<60;i++,h=h.next){const v=h.memoizedState?.current;if(v?.scene?.isScene){window.__animationScene=v.scene;return true}}}throw Error('R3F scene not found')})()`);
    await wait(`window.__animationScene.getObjectByName('NPC Spine2 [Spn2]')`);
    if (unweighted) {
      await wait(`window.__strippedHands`);
      await wait(`(()=>{const out=[];window.__animationScene.traverse(o=>{if(/hands/i.test(o.name)&&o.isSkinnedMesh)out.push(o)});return out.length>0})()`);
      console.log('unweighted hands auto-rigged in live scene');
    }
    await click('REST (A-POSE)');
    await setAnimation('idle');
    if (await evaluate(`!!document.querySelector('button[aria-label="Play animation"]')`)) await click('Play animation');
    await delay(1200);
    const a = await sample(); await delay(600); const b = await sample();
    assert.ok(distance(a, b) > 1e-6, 'idle changes actual bone rotations');
    await click('Pause animation'); await delay(150);
    const frozen = await sample(); await delay(650);
    assert.ok(distance(frozen, await sample()) < 1e-7, 'pause freezes body rotations');
    for (const speed of [0.5, 2, 1]) {
      await evaluate(`(()=>{const s=document.querySelector('input[aria-label="Animation Speed"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'${speed}');s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      assert.equal(await evaluate(`Number(document.querySelector('input[aria-label="Animation Speed"]').value)`), speed);
    }
    await click('Play animation');
    await setAnimation('rest'); await delay(800);
    const still = await sample(); await delay(500);
    const handBefore = unweighted ? await evaluate(`(()=>{let m;window.__animationScene.traverse(o=>{if(/hands/i.test(o.name)&&o.isSkinnedMesh)m=o});const v=m.position.clone().fromBufferAttribute(m.geometry.getAttribute('position'),0);return m.applyBoneTransform(0,v).toArray()})()`) : null;
    assert.ok(distance(still, await sample()) < 1e-7, 'static mode holds pose');
    await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.title.startsWith('Relaxed Stance'));if(!b)throw Error('Relaxed pose tile missing');b.click()})()`);
    await delay(800);
    const posed = await sample();
    assert.ok(distance(still, posed) > 1e-4, 'pose tile changes actual bone rotations');
    if (unweighted) {
      const handAfter = await evaluate(`(()=>{let m;window.__animationScene.traverse(o=>{if(/hands/i.test(o.name)&&o.isSkinnedMesh)m=o});const v=m.position.clone().fromBufferAttribute(m.geometry.getAttribute('position'),0);return m.applyBoneTransform(0,v).toArray()})()`);
      assert.ok(distance(handBefore, handAfter) > 1e-5, 'auto-rigged vertex follows pose');
    }
    await delay(400);
    assert.ok(distance(posed, await sample()) < 1e-7, 'pose transition settles');
    await setAnimation('idle'); await delay(800);
    // Capture the normal export download in memory, leaving no browser filesystem dependency.
    await evaluate(`(()=>{const original=URL.createObjectURL;window.__exportBlobs=[];URL.createObjectURL=function(blob){window.__exportBlobs.push(blob);return original.call(this,blob)};window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return window.__anchorClick.call(this)}})()`);
    for (const animated of [true, false]) {
      await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='EXPORT STATIC GLB')?.disabled`);
      const before = await evaluate('window.__exportBlobs.length');
      await click(animated ? 'EXPORT ANIMATED GLB' : 'EXPORT STATIC GLB');
      await wait(`window.__exportBlobs.length>${before} || [...document.querySelectorAll('[role="status"]')].some(e=>/failed|error/i.test(e.textContent))`);
      const info = await evaluate(`(async()=>{const blob=window.__exportBlobs.at(-1);if(!blob)throw Error('Export produced no blob');const b=await blob.arrayBuffer(),v=new DataView(b);if(v.getUint32(0,true)!==0x46546c67)throw Error('Not GLB');const j=JSON.parse(new TextDecoder().decode(new Uint8Array(b,20,v.getUint32(12,true))));return {bytes:b.byteLength,animations:(j.animations||[]).map(a=>({name:a.name,channels:a.channels.length,samplers:a.samplers.length,moving:a.samplers.some(s=>{const x=j.accessors[s.output],bv=j.bufferViews[x.bufferView];if(x.componentType!==5126)return false;const width={SCALAR:1,VEC3:3,VEC4:4}[x.type];if(!width)return false;const binStart=28+v.getUint32(12,true),off=binStart+(bv.byteOffset||0)+(x.byteOffset||0),stride=bv.byteStride||width*4;for(let k=1;k<x.count;k++)for(let n=0;n<width;n++)if(Math.abs(v.getFloat32(off+k*stride+n*4,true)-v.getFloat32(off+n*4,true))>1e-6)return true;return false})})),skins:(j.skins||[]).length,external:(j.buffers||[]).some(b=>b.uri),nodes:(j.nodes||[]).length}})()`);
      assert.equal(await evaluate('window.__exportBlobs.length'), before + 1, 'new export created');
      assert.ok(info.skins > 0, 'export contains skins');
      assert.equal(info.external, false, 'GLB embeds buffers');
      assert.ok(animated ? info.animations.length >= 2 : info.animations.length === 0, 'animation option honored');
      assert.ok(info.animations.every(a => a.channels > 0 && a.samplers > 0));
      if (animated) assert.ok(info.animations.some(a => a.moving), 'GLB has genuinely changing keyframes');
      console.log(animated ? 'animated GLB' : 'static GLB', JSON.stringify(info));
    }
    await delay(300);
    const resumed = await sample(); await delay(600);
    assert.ok(distance(resumed, await sample()) > 1e-6, 'preview still animates after export');
    fs.mkdirSync('.impeccable/review', { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('.impeccable/review/animation-preview.png', Buffer.from(shot.data, 'base64'));
    assert.deepEqual(errors, [], 'runtime errors / animation binding warnings');
    console.log('preview motion, pause, speed controls, static mode, animated/static GLB: ok');
  } finally {
    ws.close(); await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
