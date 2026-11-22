const fs = require('fs');

function unescapeXml(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const xml = fs.readFileSync('public/assets/bodyslide/presets/UBE Necoco for Converting Outfits.xml', 'utf-8');

const presets = [];
const presetRegex = /<Preset\s+([^>]+)>([\s\S]*?)<\/Preset>/gi;
let match;
while ((match = presetRegex.exec(xml)) !== null) {
  const attrString = match[1];
  const bodyString = match[2];
  const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrString);
  const setMatch = /set\s*=\s*["']([^"']+)["']/i.exec(attrString);
  const name = nameMatch ? unescapeXml(nameMatch[1]) : 'Unnamed';
  const set = setMatch ? unescapeXml(setMatch[1]) : 'Default';

  const sliders = {};
  const sliderRegex = /<SetSlider\s+([^>]+)\/?>/gi;
  let sm;
  while ((sm = sliderRegex.exec(bodyString)) !== null) {
    const sAttrs = sm[1];
    const sNameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(sAttrs);
    const sValueMatch = /value\s*=\s*["']([^"']+)["']/i.exec(sAttrs);
    const sSizeMatch = /size\s*=\s*["']([^"']+)["']/i.exec(sAttrs);
    if (!sNameMatch || !sValueMatch) continue;
    const sName = unescapeXml(sNameMatch[1]);
    const sValue = parseFloat(sValueMatch[1]);
    const size = sSizeMatch ? sSizeMatch[1].toLowerCase() : 'big';
    if (size === 'small') {
      if (sliders[sName] === undefined) sliders[sName] = sValue;
    } else {
      sliders[sName] = sValue;
    }
  }
  presets.push({ name, set, slidersCount: Object.keys(sliders).length });
}
console.log('Result:', presets);
