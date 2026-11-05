const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { version, sha256, cachePath } = require('../whatsappWebVersion');

async function install() {
  const response = await fetch(
    `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${version}.html`,
    { signal: AbortSignal.timeout(30000) }
  );
  if (!response.ok) throw new Error(`WhatsApp Web download failed: HTTP ${response.status}`);
  const html = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(html).digest('hex') !== sha256) {
    throw new Error('WhatsApp Web snapshot checksum mismatch; refusing unreviewed HTML');
  }
  fs.mkdirSync(cachePath, { recursive: true });
  fs.writeFileSync(path.join(cachePath, `${version}.html`), html);
}

install().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
