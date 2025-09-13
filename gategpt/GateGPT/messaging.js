const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { getAllOtpData } = require('./otp');
const { listDeliveries } = require('./deliveryLog');
const state = require('./state');
const { logEmitter, getLogHistory } = require('./logging');

const autoMsgIds = new Set();
let client;
let ready = false;
let qrId = 0;

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
  const PUBLIC_DIR = path.join(__dirname, 'public');
  app.use(express.static(PUBLIC_DIR));
  app.use(
    '/bootstrap',
    express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist'))
  );
  app.use(
    '/bootstrap-icons',
    express.static(path.join(__dirname, 'node_modules', 'bootstrap-icons', 'font'))
  );
  app.get('/qr.png', (req, res) => res.sendFile(QR_PNG_PATH));
  const getState = () => ({
    ready,
    qrId,
    otps: getAllOtpData(),
    deliveries: listDeliveries()
  });
  app.get('/api/state', (req, res) => {
    res.json(getState());
  });
  app.get('/api/state-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = () =>
      res.write(`data: ${JSON.stringify(getState())}\n\n`);
    send();
    state.on('update', send);
    req.on('close', () => state.off('update', send));
  });
  app.get('/api/logs', (req, res) => {
    res.json(getLogHistory());
  });
  app.get('/api/log-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    getLogHistory().forEach(line => res.write(`data: ${line}\n\n`));
    const send = line => res.write(`data: ${line}\n\n`);
    logEmitter.on('log', send);
    req.on('close', () => logEmitter.off('log', send));
  });
  app.get('/api/settings', (req, res) => {
    const samplePath = path.join(__dirname, 'config.sample.json');
    const configPath = path.join(__dirname, 'config.json');
    let sample = {};
    let config = {};
    try {
      sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    } catch {}
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
    const keys = new Set([...Object.keys(sample), ...Object.keys(config), 'SESSION_DIR']);
    const settings = {};
    keys.forEach(k => {
      const val = process.env[k] !== undefined ? process.env[k] : config[k];
      if (val !== undefined) settings[k] = val;
    });
    const redacted = {};
    for (const [k, v] of Object.entries(settings)) {
      let val = v;
      if (typeof val === 'object') val = JSON.stringify(val);
      const isSecret =
        typeof val === 'string' &&
        (/(TOKEN|SECRET|PASSWORD)/i.test(k) ||
          (/KEY$/i.test(k) && !/KEYWORDS$/i.test(k)));
      if (isSecret) {
        const start = val.slice(0, 4);
        const end = val.slice(-4);
        redacted[k] = `${start}****${end}`;
      } else {
        redacted[k] = val;
      }
    }
    res.json(redacted);
  });
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
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

module.exports = {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById,
  Location
};
