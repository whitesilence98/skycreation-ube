// Run: node scripts/check_hud_interactions.cjs
// Requires app on localhost:3000 and isolated Chromium CDP on localhost:9334.
//
// Drives the real HUD with CDP input events: pointer clicks, Tab/Enter/Escape,
// wheel and drag on the canvas. Complements check_hud_browser.cjs, which only
// measures the settled layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const target = await (await fetch('http://127.0.0.1:9334/json/new?http://localhost:3000', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || JSON.stringify(msg.params.exceptionDetails));
    if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression) => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Timed out: ' + expression);
  };
  const settle = async (ms = 400) => evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ${ms}))))`);

  const button = (name) => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(name)})`;

  const centerOf = async (expr) => {
    const r = await evaluate(`(() => {
      const el = ${expr};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    })()`);
    assert.ok(r, 'element not found: ' + expr);
    return r;
  };

  const click = async (expr, label = expr) => {
    const r = await centerOf(expr);
    assert.ok(r.x > 0 && r.x < 2000 && r.y > 0 && r.y < 2000, `offscreen target ${label}: ${JSON.stringify(r)}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await settle();
  };

  const key = async (keyName, code, vk, text) => {
    const base = { key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await settle();
  };

  const activeLabel = () => evaluate(`(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return (a.getAttribute('aria-label') || a.textContent.trim() || a.tagName).slice(0, 60);
  })()`);
  const activeIn = (sel) => evaluate(`Boolean(document.activeElement && document.activeElement.closest(${JSON.stringify(sel)}))`);
  const railHidden = (which) => evaluate(`document.querySelector('#hud-${which}-rail')?.getAttribute('aria-hidden') ?? 'absent'`);
  const activePanel = () => evaluate(`document.querySelector('#hud-left-rail > div:last-child > div:not(.hidden)')?.getAttribute('data-workspace') ?? null`);

  const results = {};

  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://localhost:3000' });
    await wait(`document.querySelector('canvas') && document.querySelector('nav[aria-label="Primary"]')`);
    await wait(`![...document.querySelectorAll('[aria-hidden="false"]')].some(e => e.textContent.includes('LOADING ASSETS'))`);
    await evaluate(`document.fonts.ready.then(() => true)`);
    await settle(600);

    /* ── keyboard baseline ─────────────────────────────────────────── */
    await evaluate(`document.body.focus()`);
    assert.equal(await activeLabel(), 'BODY');
    await key('Tab', 'Tab', 9);
    results.firstTabStop = await activeLabel();
    assert.notEqual(results.firstTabStop, 'BODY', 'Tab did not move focus');

    /* ── default FACE/SKIN: no properties rail, Escape must still work ── */
    assert.equal(await railHidden('right'), 'absent', 'properties rail should be absent on FACE/SKIN');
    await click(`document.querySelector('#hud-left-rail button[aria-label="Collapse left workspace"]')`, 'collapse left');
    assert.equal(await railHidden('left'), 'true', 'left rail should be collapsed');
    results.collapseFocus = await activeLabel();
    assert.equal(results.collapseFocus, 'EDIT workspace', 'desktop collapse must return focus to the dock trigger');

    /* Enter on the focused trigger reopens the rail and moves focus inside. */
    await key('Enter', 'Enter', 13, '\r');
    assert.equal(await railHidden('left'), 'false', 'Enter on the dock trigger should reopen the rail');
    assert.ok(await activeIn('#hud-left-rail'), 'reopened rail should receive focus');

    /* Escape from inside the rail closes it and returns focus to the dock. */
    await key('Escape', 'Escape', 27);
    assert.equal(await railHidden('left'), 'true', 'Escape inside the rail should close it');
    assert.equal(await activeLabel(), 'EDIT workspace', 'Escape should return focus to the dock trigger');

    /* Escape with focus outside both rails: default FACE/SKIN, no right rail. */
    await click(button('EDIT workspace'), 'reopen edit');
    assert.equal(await railHidden('left'), 'false');
    await evaluate(`document.body.focus()`);
    await key('Escape', 'Escape', 27);
    assert.equal(await railHidden('left'), 'true', 'Escape from the page body should close the open rail');
    assert.equal(await activeLabel(), 'EDIT workspace');

    /* ── workspace switching keeps every panel mounted ────────────────── */
    await click(button('EDIT workspace'), 'reopen edit');
    /* scrollTop clamps to the panel's own max scroll, so compare against what
       the browser actually settled on rather than the requested offset. */
    const editScroll = await evaluate(`(() => { const b = document.querySelector('#hud-left-rail [data-workspace="edit"]'); b.scrollTop = 140; return b.scrollTop; })()`);
    assert.ok(editScroll > 20, 'edit panel should be scrollable for this check');
    await click(button('ASSETS workspace'), 'assets');
    assert.equal(await activePanel(), 'assets', 'assets workspace should be shown');
    assert.equal(await railHidden('left'), 'false', 'rail stays open when switching workspace');
    await click(button('EDIT workspace'), 'back to edit');
    assert.equal(await activePanel(), 'edit');
    results.editScrollTop = await evaluate(`document.querySelector('#hud-left-rail [data-workspace="edit"]').scrollTop`);
    assert.equal(results.editScrollTop, editScroll, 'edit scroll position must survive a workspace switch');

    await click(button('CAMERA workspace'), 'camera');
    assert.equal(await activePanel(), 'camera');
    assert.ok(await evaluate(`!!document.querySelector('canvas')`), 'canvas must stay mounted');

    /* ── canvas pass-through ─────────────────────────────────────────── */
    results.canvasAtCenter = await evaluate(`document.elementFromPoint(innerWidth/2, innerHeight/2)?.tagName`);
    assert.equal(results.canvasAtCenter, 'CANVAS', 'HUD overlay must not swallow the viewport centre');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 430, button: 'left' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 790, y: 430, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -120 });
    await settle(500);
    results.dragAndWheel = 'dispatched';

    /* ── properties rail ─────────────────────────────────────────────── */
    await click(button('HAIR'), 'HAIR tab');
    assert.equal(await railHidden('right'), 'false', 'HAIR should expose the properties rail');
    await click(`document.querySelector('#hud-right-rail button[aria-label="Collapse properties rail"]')`, 'collapse properties');
    assert.equal(await railHidden('right'), 'true');
    results.rightCollapseFocus = await activeLabel();
    assert.equal(results.rightCollapseFocus, 'Open properties rail', 'desktop collapse must return focus to the reopen trigger');

    await click(button('Open properties rail'), 'open properties');
    assert.equal(await railHidden('right'), 'false', 'trigger should reopen the properties rail');
    assert.ok(await activeIn('#hud-right-rail'), 'opening the rail must move focus into it');

    await key('Escape', 'Escape', 27);
    assert.equal(await railHidden('right'), 'true', 'Escape from inside the rail closes it');
    assert.equal(await activeLabel(), 'Open properties rail');

    /* ── preview ─────────────────────────────────────────────────────── */
    await click(button('Hide interface preview'), 'preview');
    assert.equal(await evaluate(`!!${button('EDIT workspace')}`), false, 'dock should hide in preview');
    await key('Escape', 'Escape', 27);
    assert.ok(await evaluate(`!!${button('EDIT workspace')}`), 'Escape should leave preview');
    results.previewExitFocus = await activeLabel();

    /* ── dock label fit ──────────────────────────────────────────────── */
    results.dockFit = await evaluate(`[...document.querySelectorAll('button[aria-label$="workspace"]')].map(b => ({ label: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), need: b.scrollWidth }))`);

    const dir = path.resolve('.impeccable/review');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['compact', 1024, 768]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await settle(600);
      const metrics = await evaluate(`(() => {
        const visible = e => {
          const r = e.getBoundingClientRect();
          return e.getClientRects().length && !e.closest('[aria-hidden="true"], [inert]') && getComputedStyle(e).visibility !== 'hidden' && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        };
        const tiny = [...document.querySelectorAll('button,input,select,label,span,p,h1,h2,h3,dt,dd')].filter(e => visible(e) && (e.textContent.trim() || e.matches('input,select')) && parseFloat(getComputedStyle(e).fontSize) < 10).map(e => ({ text: e.textContent.trim().slice(0, 60), size: getComputedStyle(e).fontSize }));
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, tiny: tiny.slice(0, 20), canvas: !!document.querySelector('canvas') };
      })()`);
      assert.ok(metrics.canvas, `${name}: canvas missing`);
      assert.ok(metrics.scrollWidth <= width, `${name}: horizontal page overflow`);
      assert.deepEqual(metrics.tiny, [], `${name}: text below 10px`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(dir, `interaction-${name}.png`), Buffer.from(shot.data, 'base64'));
    }

    /* ── mobile drawers ──────────────────────────────────────────────── */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await settle(700);
    assert.equal(await railHidden('left'), 'true', 'mobile must start with the drawer closed');
    assert.ok(await evaluate(`!document.querySelector('#hud-right-rail')`), 'FACE/SKIN keeps the properties rail absent on mobile');

    await click(button('EDIT workspace'), 'mobile open edit');
    assert.equal(await railHidden('left'), 'false', 'dock click should open the mobile drawer');
    results.mobileDockHit = await evaluate(`(() => {
      const b = document.querySelector('button[aria-label="EDIT workspace"]');
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!(hit && hit.closest('button[aria-label="EDIT workspace"]'));
    })()`);
    assert.equal(results.mobileDockHit, true, 'open drawer must not cover the dock');

    await click(button('ASSETS workspace'), 'mobile assets');
    assert.equal(await activePanel(), 'assets', 'dock switching works with the drawer open');
    await key('Escape', 'Escape', 27);
    assert.equal(await railHidden('left'), 'true', 'Escape closes the mobile drawer');
    assert.equal(await activeLabel(), 'EDIT workspace');

    /* Top-bar category reaches EQUIPMENT on the narrow viewport. */
    await click(button('EQUIPMENT'), 'EQUIPMENT tab');
    results.mobileEquipment = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'EQUIPMENT');
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), inView: r.left >= 0 && r.right <= innerWidth };
    })()`);
    assert.ok(results.mobileEquipment.inView, 'EQUIPMENT must be reachable without page overflow');

    /* Footer actions are visible and clickable at phone width. */
    results.mobileFooter = await evaluate(`(() => {
      const out = {};
      for (const name of ['IMPORT', 'CONFIRM & APPLY']) {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === name);
        if (!b) { out[name] = 'missing'; continue; }
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        out[name] = { inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, hit: hit === b || b.contains(hit) };
      }
      return out;
    })()`);
    for (const [name, v] of Object.entries(results.mobileFooter)) {
      assert.notEqual(v, 'missing', `${name} footer action missing`);
      assert.ok(v.inView, `${name} must fit the phone viewport`);
      assert.ok(v.hit, `${name} must be clickable on the phone viewport`);
    }

    const mobileShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(dir, 'interaction-mobile.png'), Buffer.from(mobileShot.data, 'base64'));

    assert.deepEqual(errors, [], 'runtime exceptions');
    fs.writeFileSync(path.join(dir, 'interactions.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:9334/json/close/${target.id}`).catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
