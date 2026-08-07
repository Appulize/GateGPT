const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const { version: whatsappWebJsVersion } = require('whatsapp-web.js/package.json');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const state = require('./state');

const autoMsgIds = new Set();
let client;
let ready = false;
let qrId = 0;

/**
 * Current WhatsApp Web builds no longer populate `_serialized` on message keys,
 * so reading it yields undefined for every message. Storing that in
 * `autoMsgIds` used to make `isAutoMessage()` true for everything, and GateGPT
 * went deaf the moment it sent its first reply. Rebuild the key from the parts
 * that are still there, in WhatsApp's own `fromMe_remote_id` format.
 */
function messageKey(message) {
  const id = message?.id;
  if (!id) return null;
  if (typeof id._serialized === 'string' && id._serialized) return id._serialized;
  if (id.remote === undefined || id.id === undefined) return null;
  return `${Boolean(id.fromMe)}_${id.remote}_${id.id}`;
}

function rememberAutoMessage(msg) {
  const key = messageKey(msg);
  if (!key) {
    console.warn('⚠️ Sent message has no usable id; it may be mistaken for a manual reply');
    return;
  }
  autoMsgIds.add(key);
  setTimeout(() => autoMsgIds.delete(key), 60 * 60 * 1000);
}

async function sendAuto(chat, content, options = {}) {
  try {
    const msg = await chat.sendMessage(content, options);
    rememberAutoMessage(msg);
    return msg;
  } catch (err) {
    const chatId = chat?.id?._serialized ?? chat?.id;
    if (!chatId) {
      throw err;
    }

    const msg = await client.sendMessage(chatId, content, {
      ...options,
      sendSeen: false
    });
    rememberAutoMessage(msg);
    return msg;
  }
}

function isAutoMessage(message) {
  const key = messageKey(message);
  return key !== null && autoMsgIds.has(key);
}

/**
 * Runs inside the WhatsApp Web page, so it must be self-contained: puppeteer
 * serialises the source and evaluates it in the browser.
 *
 * whatsapp-web.js (up to and including 1.34.7) builds its chat model from
 * `chat.lastReceivedKey._serialized`. Current WhatsApp Web builds leave that
 * `_serialized` undefined, so the library asks IndexedDB for the message with
 * id `undefined` and the request rejects with "DataError: Failed to execute
 * 'get' on 'IDBObjectStore': No key or key range specified" — which makes
 * every single `getChatById()` call fail. Drop unusable ids before they reach
 * IndexedDB; `messages` is the only field callers read off the result.
 */
function installMessageIdGuard() {
  const msgStore = window.Store && window.Store.Msg;
  if (!msgStore || msgStore.__gategptIdGuard) return false;

  const original = msgStore.getMessagesById.bind(msgStore);
  msgStore.getMessagesById = async ids => {
    const usable = (ids || []).filter(id => typeof id === 'string' && id);
    if (!usable.length) return { messages: [] };
    return original(usable);
  };
  msgStore.__gategptIdGuard = true;
  return true;
}

/**
 * Applied lazily instead of once on `ready`, because WhatsApp Web replays
 * messages before the ready event fires and the page is re-injected whenever
 * it reloads.
 */
async function applyPageWorkarounds() {
  if (!client?.pupPage) return;

  try {
    const applied = await client.pupPage.evaluate(installMessageIdGuard);
    if (applied) console.log('🩹 Applied WhatsApp Web message lookup workaround');
  } catch (err) {
    console.warn('⚠️ Failed to apply WhatsApp Web workaround:', err.message);
  }
}

async function getChatById(id) {
  await applyPageWorkarounds();
  return client.getChatById(id);
}

async function getChatForMessage(message) {
  await applyPageWorkarounds();
  return message.getChat();
}

/**
 * whatsapp-web.js ignores the promise returned by its listeners, so an
 * unhandled rejection here takes the whole add-on down. One unprocessable
 * message must never do that.
 */
function guardHandler(event, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error(`❌ Failed to handle ${event}:`, err?.stack || err);
      sendPushoverNotification('GateGPT', `❌ Failed to handle ${event}: ${err?.message || err}`);
    }
  };
}

async function getPhoneJidForChatId(id) {
  if (!client || typeof client.getContactLidAndPhone !== 'function') return null;
  const [mapping] = await client.getContactLidAndPhone([id]);
  return mapping?.pn || null;
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
  if (onCall) client.on('incoming_call', guardHandler('incoming_call', onCall));
  if (onMessage) client.on('message_create', guardHandler('message_create', onMessage));

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
  getChatForMessage,
  getPhoneJidForChatId,
  installMessageIdGuard,
  Location,
  getStatus
};
