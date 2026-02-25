const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const { version: whatsappWebJsVersion } = require('whatsapp-web.js/package.json');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const state = require('./state');

const autoMsgIds = new Set();
let client;
let ready = false;
let qrId = 0;

async function sendAuto(chat, content, options = {}) {
  try {
    const msg = await chat.sendMessage(content, options);
    autoMsgIds.add(msg?.id?._serialized);
    setTimeout(() => autoMsgIds.delete(msg?.id?._serialized), 60 * 60 * 1000);
    return msg;
  } catch (err) {
    const chatId = chat?.id?._serialized ?? chat?.id;
    if (!chatId) {
      throw err;
    }

    try {
      const msg = await client.sendMessage(chatId, content, {
        ...options,
        sendSeen: false
      });
      autoMsgIds.add(msg?.id?._serialized);
      setTimeout(() => autoMsgIds.delete(msg?.id?._serialized), 60 * 60 * 1000);
      return msg;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
  }
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
  const LEGACY_AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
  const CACHE_DIRS = Array.from(new Set([
    path.join(DATA_DIR, '.wwebjs_cache'),
    path.join(__dirname, '.wwebjs_cache'),
    path.join(process.cwd(), '.wwebjs_cache')
  ]));

  const RESET_SESSION = String(getConfig('RESET_SESSION', 'false')).toLowerCase() === 'true';
  if (RESET_SESSION) {
    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      fs.rmSync(LEGACY_AUTH_DIR, { recursive: true, force: true });
      CACHE_DIRS.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
      console.log('🗑️  Cleared WhatsApp auth and cache directories');
    } catch (err) {
      console.warn('⚠️  Failed to reset WhatsApp session:', err.message);
    }
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const webVersion = String(getConfig('WEB_VERSION', '')).trim();
  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
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
  };

  console.log(
    `🧩 whatsapp-web.js ${whatsappWebJsVersion} (WEB_VERSION=${webVersion || 'auto'})`
  );

  if (webVersion) {
    clientOptions.webVersion = webVersion;
  }

  client = new Client(clientOptions);

  client.on('loading_screen', (percent, message) => {
    console.log(`⏳ WhatsApp loading: ${percent}% - ${message}`);
  });

  client.on('change_state', waState => {
    console.log(`📶 WhatsApp state changed: ${waState}`);
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
  });

  client.on('auth_failure', msg => {
    ready = false;
    console.error(`❌ WhatsApp auth failure: ${msg}`);
    state.emit('update');
  });

  client.on('disconnected', reason => {
    ready = false;
    console.warn(`⚠️ WhatsApp disconnected: ${reason}`);
    state.emit('update');
  });

  client.on('qr', async qr => {
    qrcodeTerminal.generate(qr, { small: true });
    try {
      await qrcode.toFile(QR_PNG_PATH, qr, { type: 'png' });
    } catch (err) {
      console.warn('⚠️ Failed to write QR image:', err.message);
    }
    ready = false;
    qrId++;
    state.emit('update');
  });

  client.once('ready', () => {
    ready = true;
    state.emit('update');
    if (onReady) onReady();
  });
  if (onCall) client.on('incoming_call', onCall);
  if (onMessage) client.on('message_create', onMessage);

  client.initialize();
}

function getStatus() {
  return { ready, qrId };
}

module.exports = {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById,
  Location,
  getStatus
};
