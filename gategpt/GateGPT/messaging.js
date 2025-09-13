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
