const fs = require('fs');

const file = require.resolve('whatsapp-web.js/src/structures/Message');
const source = fs.readFileSync(file, 'utf8');
const original = '                        type: msg.type,\n                        signal: new AbortController().signal,';
const patched = '                        type: msg.type,\n                        mimetype: msg.mimetype,\n                        signal: new AbortController().signal,';

if (!source.includes(patched)) {
  if (!source.includes(original)) {
    throw new Error('whatsapp-web.js media download changed; review the MIME type patch');
  }
  fs.writeFileSync(file, source.replace(original, patched));
}
