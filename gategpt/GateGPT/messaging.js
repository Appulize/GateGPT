const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

const autoMsgIds = new Set();
let client;

async function sendAuto(chat, content, options = {}) {
  const msg = await chat.sendMessage(content, options);
  autoMsgIds.add(msg?.id?._serialized);
  setTimeout(() => autoMsgIds.delete(msg?.id?._serialized), 60 * 60 * 1000);
  return msg;
}

function isAutoMessage(message) {
  return autoMsgIds.has(message?.id?._serialized);
}

async function getChatById(id) {
  return client.getChatById(id);
}

function initMessaging({ onMessage, onCall, onReady }) {
  const DATA_DIR = getConfig('SESSION_DIR', __dirname);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const QR_PNG_PATH = path.join(DATA_DIR, 'qr.png');
  const SESSION_DIR = path.join(DATA_DIR, 'whatsapp-auth');
  const CACHE_DIR = path.join(__dirname, '.wwebjs_cache');
  const LEGACY_AUTH_DIR = path.join(__dirname, '.wwebjs_auth');

  const RESET_SESSION = String(getConfig('RESET_SESSION', 'false')).toLowerCase() === 'true';
  if (RESET_SESSION) {
    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      fs.rmSync(LEGACY_AUTH_DIR, { recursive: true, force: true });
      console.log('🗑️  Cleared WhatsApp auth and cache directories');
    } catch (err) {
      console.warn('⚠️  Failed to reset WhatsApp session:', err.message);
    }
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const app = express();
  app.get('/qr.png', (req, res) => res.sendFile(QR_PNG_PATH));
  app.get('/', (req, res) =>
    res.send(`<html><body>
    <h2>Scan to log in</h2>
    <img src="qr.png" style="width:300px;height:300px" />
    <script>setTimeout(()=>location.reload(),5000)</script>
  </body></html>`)
  );
  app.listen(3000);

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    webVersion: '2.3000.1026863126',
    webVersionCache: { type: 'local', path: CACHE_DIR },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',              // allow running as root
        '--disable-setuid-sandbox',  // needed without user namespaces
        '--disable-dev-shm-usage',   // use /tmp instead of /dev/shm
        '--no-zygote',               // don't use a zygote process
        '--disable-gpu'              // no GPU in container
      ]
    }
  });

  client.on('qr', async qr => {
    qrcodeTerminal.generate(qr, { small: true });
    await qrcode.toFile(QR_PNG_PATH, qr, { type: 'png' });
  });

  if (onReady) client.once('ready', onReady);
  if (onCall) client.on('incoming_call', onCall);
  if (onMessage) client.on('message_create', onMessage);

  client.initialize();
}

module.exports = {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById,
  Location
};
