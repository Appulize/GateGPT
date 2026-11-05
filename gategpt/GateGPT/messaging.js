const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const { version: whatsappWebJsVersion } = require('whatsapp-web.js/package.json');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const state = require('./state');
const { createConnectionRecovery, withTimeout } = require('./connectionRecovery');

// Always load the current app, not a stale service-worker response. Advertise
// the installed Chromium version instead of the library's hardcoded Chrome 101.
class BrowserLocalAuth extends LocalAuth {
  async afterBrowserInitialized() {
    await super.afterBrowserInitialized();
    await this.client.pupPage.setBypassServiceWorker(true);
    const userAgent = await this.client.pupBrowser.userAgent();
    await this.client.pupPage.setUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/'));
  }
}

const autoMsgIds = new Set();
let client;
let ready = false;
let qrId = 0;
let startupError = null;
let recovery;

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
 * Current WhatsApp Web builds dropped the `_serialized` getter from the message
 * key class, while keeping `toString()`, which still returns the very same
 * `fromMe_remote_id` string. whatsapp-web.js reads `_serialized` all over the
 * place, so its absence broke three things at once: chat models asked
 * IndexedDB for the message with id `undefined` ("DataError: Failed to execute
 * 'get' on 'IDBObjectStore'"), every `getChatById()` call failed with it, and
 * `sendMessage()` returned undefined because it looks the sent message back up
 * by that same id. Putting the getter back fixes all of them at the source.
 *
 * The `getMessagesById` guard stays as a fallback: if a future build also
 * renames the key class or `toString()`, an undefined id would otherwise make
 * IndexedDB throw again and take every chat lookup with it.
 */
function installWhatsAppWebPatches() {
  const applied = { keyRestored: false, lookupGuarded: false };

  // whatsapp-web.js 1.34.7 reads the page's module registry instead of Store.
  const keyClass = window.Store?.MsgKey || window.require?.('WAWebMsgKey');
  const keyProto = keyClass?.prototype;
  if (
    keyProto &&
    typeof keyProto.toString === 'function' &&
    !Object.getOwnPropertyDescriptor(keyProto, '_serialized')
  ) {
    Object.defineProperty(keyProto, '_serialized', {
      get() {
        return this.toString();
      },
      configurable: true
    });
    applied.keyRestored = true;
  }

  const msgStore = window.Store?.Msg || window.require?.('WAWebCollections')?.Msg;
  if (msgStore && !msgStore.__gategptIdGuard) {
    const original = msgStore.getMessagesById.bind(msgStore);
    msgStore.getMessagesById = async ids => {
      const usable = (ids || []).filter(id => typeof id === 'string' && id);
      if (!usable.length) return { messages: [] };
      return original(usable);
    };
    msgStore.__gategptIdGuard = true;
    applied.lookupGuarded = true;
  }

  return applied;
}

/**
 * Applied lazily instead of once on `ready`, because WhatsApp Web replays
 * messages before the ready event fires and the page is re-injected whenever
 * it reloads.
 */
async function applyPageWorkarounds() {
  if (!client?.pupPage) return;

  try {
    const applied = await client.pupPage.evaluate(installWhatsAppWebPatches);
    if (applied.keyRestored) console.log('🩹 Restored WhatsApp Web message key serialisation');
    if (applied.lookupGuarded) console.log('🩹 Guarded WhatsApp Web message lookups');
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
    userAgent: false,
    webVersionCache: { type: webVersion ? 'local' : 'none' },
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

  recovery?.stop();
  let current;
  let notifiedReady = false;
  const seenMessages = new Map();
  let replayFloor = Math.floor(Date.now() / 1000) - 60;

  function active(record) {
    return current === record && !record.retiring;
  }

  function offline(record, reason, qr = false) {
    if (!active(record)) return;
    ready = false;
    recovery.offline(reason, qr);
    state.emit('update');
  }

  function launch() {
    ready = false;
    qrId = 0;
    startupError = null;
    const next = new Client({
      ...clientOptions,
      authStrategy: new BrowserLocalAuth({ dataPath: SESSION_DIR })
    });
    const record = { client: next, hadReady: false, retiring: false, settled: false };
    current = record;
    client = next;

    next.on('loading_screen', (percent, message) => {
      if (active(record)) console.log(`⏳ WhatsApp loading: ${percent}% - ${message}`);
    });
    next.on('change_state', waState => {
      if (!active(record)) return;
      console.log(`📶 WhatsApp state changed: ${waState}`);
      if (waState !== 'CONNECTED') offline(record, 'WhatsApp connection interrupted');
    });
    next.on('authenticated', () => {
      if (active(record)) console.log('🔐 WhatsApp authenticated');
    });
    next.on('auth_failure', () => {
      offline(record, 'WhatsApp authentication failed');
    });
    next.on('disconnected', () => {
      record.hadReady = false;
      offline(record, 'WhatsApp disconnected');
    });
    next.on('qr', async qr => {
      if (!active(record)) return;
      record.hadReady = false;
      startupError = null;
      qrcodeTerminal.generate(qr, { small: true });
      try {
        await qrcode.toFile(QR_PNG_PATH, qr, { type: 'png' });
      } catch (err) {
        console.warn('⚠️ Failed to write QR image:', err.message);
      }
      if (!active(record)) return;
      qrId++;
      offline(record, 'WhatsApp needs a QR login', true);
    });
    next.on('ready', () => {
      if (!active(record)) return;
      record.hadReady = true;
      ready = true;
      qrId = 0;
      startupError = null;
      recovery.online();
      console.log('✅ WhatsApp ready');
      state.emit('update');
      if (!notifiedReady) {
        notifiedReady = true;
        if (onReady) guardHandler('ready', onReady)();
      }
    });
    if (onCall) next.on('incoming_call', guardHandler('incoming_call', (...args) => {
      if (active(record)) return onCall(...args);
    }));
    if (onMessage) next.on('message_create', guardHandler('message_create', message => {
      if (!active(record)) return;
      // Retain IDs through long outages, not just an hour of wall-clock time.
      // If the bounded history fills, move the acceptance floor with eviction.
      const timestamp = Number(message.timestamp);
      if (Number.isFinite(timestamp) && timestamp < replayFloor) return;
      const key = messageKey(message);
      if (key && seenMessages.has(key)) return;
      if (key) seenMessages.set(key, Number.isFinite(timestamp) ? timestamp : replayFloor);
      if (seenMessages.size > 10000) {
        const oldest = Math.min(...seenMessages.values());
        replayFloor = Math.max(replayFloor, oldest + 1);
        for (const [id, time] of seenMessages) {
          if (time < replayFloor) seenMessages.delete(id);
        }
      }
      return onMessage(message);
    }));
    record.initialization = Promise.resolve().then(() => next.initialize()).catch(err => {
      if (!active(record)) return;
      startupError = 'WhatsApp failed to start. Automatic recovery is in progress; check the logs for details.';
      console.error('❌ WhatsApp startup failed:', err?.stack || err);
      offline(record, 'WhatsApp failed to start');
    }).finally(() => { record.settled = true; });
    state.emit('update');
  }

  async function restart() {
    const old = current;
    old.retiring = true;
    ready = false;
    qrId = 0;
    state.emit('update');
    const browser = old.client.pupBrowser;
    // Never run two initializers against the same LocalAuth profile.
    if (!browser && !old.settled) throw new Error('Waiting for the previous browser launch to finish');
    const process = browser?.process?.();
    try {
      await withTimeout(() => old.client.destroy());
    } catch (err) {
      if (!process || process.exitCode !== null || process.signalCode !== null) throw err;
      process.kill('SIGKILL'); // only this client's owned Chromium process
    }
    if (process && process.exitCode === null && process.signalCode === null) {
      const waitForExit = async () => {
        let listener;
        try {
          await withTimeout(() => new Promise(resolve => {
            listener = resolve;
            process.once('exit', listener);
          }));
        } finally {
          if (listener) process.removeListener('exit', listener);
        }
      };
      try {
        await waitForExit();
      } catch {
        process.kill('SIGKILL');
        if (process.exitCode === null && process.signalCode === null) {
          await waitForExit();
        }
      }
    }
    if (browser?.isConnected?.()) throw new Error('Previous browser is still connected');
    await withTimeout(() => old.initialization);
    old.client.removeAllListeners();
    launch();
  }

  recovery = createConnectionRecovery({
    file: path.join(DATA_DIR, 'whatsapp-recovery.json'),
    restart,
    notify: sendPushoverNotification,
    probe: async () => {
      const record = current;
      if (!record || record.retiring || !record.hadReady) return false;
      let connected;
      try {
        connected = await withTimeout(() => record.client.getState()) === 'CONNECTED';
      } catch (err) {
        if (active(record)) {
          ready = false;
          state.emit('update');
        }
        throw err;
      }
      if (!active(record) || !record.hadReady) return false;
      if (connected !== ready) {
        ready = connected;
        state.emit('update');
      }
      return connected;
    }
  });
  launch();
}

function getStatus() {
  return { ready, qrId, startupError };
}

module.exports = {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById,
  getChatForMessage,
  getPhoneJidForChatId,
  installWhatsAppWebPatches,
  Location,
  getStatus
};
