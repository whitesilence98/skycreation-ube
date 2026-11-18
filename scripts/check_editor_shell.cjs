// Run: node scripts/check_editor_shell.cjs (no browser/assets).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id) }, { filename: file });
  return module.exports;
}
const ui = load('lib/faceControls'), anatomy = load('lib/anatomy/params');
const regions = load('lib/regions');
const displayed = regions.REGIONS.flatMap(r => ui.faceControlIds(r.id));
assert.equal(displayed.length, new Set(displayed).size);
assert.equal(JSON.stringify([...displayed].sort()), JSON.stringify(anatomy.ANATOMY_PARAMS.filter(p => p.status === 'wired').map(p => p.id).sort()));
for (const section of ui.FACE_SECTIONS) {
  for (const id of ui.storedFaceControlIds(section.id)) assert.equal(anatomy.ANATOMY_BY_ID[id].status, 'stored-only');
}
for (const [tab, category] of [['FACE SHAPE', 'face'], ['FACE', 'styling'], ['HAIR', 'hair'], ['BODY', 'body'], ['EQUIPMENT', 'outfit'], ['PRESET', 'preset']]) {
  assert.equal(ui.editorCategory(tab), category);
}
// Coverage is explicit: existing pickers/tools must remain routed, not simply counted.
const shell = fs.readFileSync('components/hud/LeftPanel.tsx', 'utf8') + fs.readFileSync('components/hud/Hud.tsx', 'utf8');
for (const component of ['PresetPanel', 'HairStyles', 'HairProperties', 'BodyPanel', 'BodyProperties', 'EquipmentPanel', 'WardrobeDrawer',
  'SkinPicker', 'SkinProperties', 'EyePicker', 'BrowsPicker', 'BrowProperties', 'MakeupPicker', 'MakeupProperties',
  'AssetPanel', 'HdrPanel', 'CameraPanel', 'GraphicsPanel', 'PosePanel', 'SettingsPanel']) assert.ok(shell.includes('<' + component), component + ' unreachable');
for (const file of ['TopBar.tsx', 'Footer.tsx', 'RightPanel.tsx', 'shell/CategoryRail.tsx', 'shell/SubList.tsx', 'shell/ToolStrip.tsx', 'shell/ControlColumn.tsx']) {
  const source = ts.createSourceFile(file, fs.readFileSync('components/hud/' + file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute).map(a => a.name.getText(source));
      assert.ok(attributes.some(a => a === 'onClick' || a === 'onPointerDown'), file + ': inert button');
      assert.ok(attributes.includes('type'), file + ': missing button type');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
console.log('PASS: category routing, wired/control coverage, existing picker/tool reachability, actionable buttons');
console.log('NOT ASSESSED: rendered spacing, keyboard focus flow, real asset availability');
