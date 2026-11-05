const fs = require('fs');

const file = require.resolve('whatsapp-web.js/src/Client');
const source = fs.readFileSync(file, 'utf8');
const original = '        const requestedVersion = this.options.webVersion;';
// No cache means no snapshot capture. Upstream still installs an async response
// reader here; res.text() can reject during navigation and kill the process.
const patched = "        if (webCacheType === 'none') return;\n" + original;

if (!source.includes(patched)) {
  if (!source.includes(original)) {
    throw new Error('whatsapp-web.js cache initialization changed; review the no-cache patch');
  }
  fs.writeFileSync(file, source.replace(original, patched));
}
