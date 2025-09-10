/*********************************************************************
 * This is GateGPT v1.1.0 first created by Maciej Swic on 2025-04-25.
 * Please see the LICENSE file.
*********************************************************************/

const { Client, LocalAuth, Location } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');

const { initLogging } = require('./logging');
const { getConfig, reloadConfig, CONFIG_PATH } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const { transcribeWithWhisper } = require('./transcription');
const { askChatGPT } = require('./chatgpt');

initLogging();

/* ─────────────── 🏠  Home-Assistant options → ENV  ─────────────── */
try {
  const HA_OPTIONS_PATH = '/data/options.json';
  if (fs.existsSync(HA_OPTIONS_PATH)) {
    const opts = JSON.parse(fs.readFileSync(HA_OPTIONS_PATH, 'utf8'));

    Object.entries(opts).forEach(([k, v]) => {
      const key = String(k).toUpperCase();
      if (process.env[key] === undefined) {
        process.env[key] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    });

    console.log(`🔧  Loaded ${Object.keys(opts).length} HA option(s) into env vars`);
  }
} catch (err) {
  console.warn('⚠️  Failed to read /data/options.json:', err.message);
}

/* ──────────────────────── 🔧  CONFIG FILE HANDLING  ───────────────────────── */
const DATA_DIR = getConfig('SESSION_DIR', __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });
const QR_PNG_PATH = path.join(DATA_DIR, 'qr.png');
const SESSION_DIR = path.join(getConfig('SESSION_DIR', __dirname), 'whatsapp-auth');
fs.mkdirSync(SESSION_DIR, { recursive: true });

/* ──────────────────────────── Globals ─────────────────────────── */
const autoMsgIds = new Set();

async function sendAuto(chat, content, options = {}) {
  const msg = await chat.sendMessage(content, options);
  autoMsgIds.add(msg?.id?._serialized);
  setTimeout(() => autoMsgIds.delete(msg?.id?._serialized), 60 * 60 * 1000);
  return msg;
}

/* ──────────────────────── Tiny webserver for QR code ─────────────────────── */
const app = express();
app.get('/qr.png', (req, res) => res.sendFile(QR_PNG_PATH));
app.get('/', (req, res) =>
  res.send(`<html><body>
    <h2>Scan to log in</h2>
    <img src="qr.png" style="width:300px;height:300px" />
    <script>setTimeout(()=>location.reload(),5000)</script>
  </body></html>`));
app.listen(3000);

/* ──────────────────────── Config file watcher ─────────────────────── */
fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => {
  try {
    reloadConfig();
    sendPushoverNotification('GateGPT', '🔁 Config reloaded from file.');
  } catch (err) {
    console.error('❌ Failed to reload config:', err.message);
    sendPushoverNotification('GateGPT', `❌ Failed to reload config ${err.message}`);
  }
});

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: SESSION_DIR
  }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

const conversations = new Map();
let ignoredChats = new Set();
const ignorePath = path.join(DATA_DIR, getConfig('IGNORE_FILE', 'ignored-chats.json'));

function loadIgnoreList() {
  try {
    ignoredChats = new Set(JSON.parse(fs.readFileSync(ignorePath, 'utf8')));
    console.log(`🔕 Loaded ignored chats: ${[...ignoredChats].join(', ')}`);
  } catch {
    console.log('📁 No ignore list found, starting fresh.');
  }
}

function saveIgnoreList() {
  fs.writeFileSync(ignorePath, JSON.stringify([...ignoredChats]));
}

function shouldTrigger(msg) {
  const keywords = getConfig('TRIGGER_KEYWORDS', []);
  return keywords.some(r => new RegExp(r, 'i').test(msg));
}

function initClient() {
  client.on('qr', async qr => {
    qrcodeTerminal.generate(qr, { small: true });
    await qrcode.toFile(QR_PNG_PATH, qr, { type: 'png' });
  });
  client.once('ready', () => {
    sendPushoverNotification('GateGPT', '✅ GateGPT is ready!');
  });
  client.on('incoming_call', async call => {
    sendPushoverNotification('GateGPT', `📞 Rejecting call from ${call.peerJid}`);
    const chat = await client.getChatById(call.peerJid);
    await sendAuto(
      chat,
      getConfig(
        'MESSAGE_CALL',
        "Sorry, I can't answer calls. Please send a message instead."
      )
    );
    await chat.markUnread();
  });
  client.on('message_create', handleMessage);
  client.initialize();
}

async function handleMessage(message) {
  if (autoMsgIds.has(message?.id?._serialized)) return;

  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  const msgText = (message.body || '').trim().toLowerCase();

  if (msgText === '!ignore') {
    ignoredChats.add(chatId);
    saveIgnoreList();
    await sendAuto(chat, `Ignoring ${chatId}`);
    await chat.markUnread();
    console.log(`🚫 ${chatId} added to ignore list.`);
    return;
  }
  if (msgText === '!unignore') {
    ignoredChats.delete(chatId);
    saveIgnoreList();
    await sendAuto(chat, 'You will no longer be ignored.');
    await chat.markUnread();
    console.log(`✅ ${chatId} removed from ignore list.`);
    return;
  }

  if (ignoredChats.has(chatId) || chat.id.server === 'g.us') {
    console.log(`🚫 Ignored chat or group: ${chatId}`);
    return;
  }

  if (message.type === 'ptt') {
    const media = await message.downloadMedia();
    const binaryData = Buffer.from(media.data, 'base64');
    const filePath = path.resolve(DATA_DIR, 'temp_audio.ogg');
    fs.writeFileSync(filePath, binaryData);
    const transcription = await transcribeWithWhisper(filePath);
    if (!transcription) return;
    message.body = transcription;
    message.type = 'chat';
  }

  if (message.type === 'image' && message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      message.images = [media.data];
      message.body = (message.caption || '').trim();
      message.type = 'chat';
    } catch (err) {
      console.error('❌ Failed to download image:', err.message);
    }
  }

  const now = Date.now();
  if (!conversations.has(chatId)) {
    conversations.set(chatId, {
      messages: [],
      timer: null,
      instant: false,
      instantTimer: null,
      gateCloseTimer: null,
      history: [],
      triggered: false
    });
  }

  const convo = conversations.get(chatId);
  convo.messages.push(message);
  if (convo.messages.length > 10) convo.messages = convo.messages.slice(-10);

  if (!convo.triggered && !message.fromMe) {
    convo.triggered = shouldTrigger(message.body);
    if (!convo.triggered) {
      console.log(`⛔ No trigger words for ${chatId}`);
      return;
    }
  }

  convo.history = convo.history.filter(ts => now - ts < 60 * 60 * 1000);
  if (convo.history.length >= getConfig('MAX_MESSAGES_PER_HOUR', 20)) {
    sendPushoverNotification('GateGPT', `⛔ Rate limit exceeded for ${chatId}`);
    return;
  }

  if (!message.fromMe && convo.instant) {
    convo.history.push(now);
    await handleAIResponse(chat, convo);
    return;
  }

  if (!message.fromMe) {
    if (convo.timer) clearTimeout(convo.timer);
    convo.timer = setTimeout(async () => {
      const userReplied = convo.messages.some(
        m => m.fromMe && m.timestamp > message.timestamp
      );
      if (userReplied) {
        console.log(`🛑 Manual reply in ${chatId}, skipping GPT`);
        return;
      }
      convo.history.push(Date.now());
      await handleAIResponse(chat, convo);
    }, getConfig('RESPONSE_DELAY_MS', 300000));
  }

  conversations.set(chatId, convo);
}

async function handleAIResponse(chat, convo) {
  console.log(`💬 Sending GPT reply to ${chat.id._serialized}`);
  const gptMessage = await askChatGPT(convo.messages);
  const trimmed = (gptMessage.content || '').trim();

  if (Array.isArray(gptMessage.tool_calls)) {
    for (const call of gptMessage.tool_calls) {
      switch (call.function.name) {
        case 'send_location':
          try {
            const lat = Number(getConfig('LOCATION_LAT'));
            const lon = Number(getConfig('LOCATION_LON'));
            const location = new Location(
              lat,
              lon,
              getConfig('LOCATION_TITLE'),
              getConfig('LOCATION_SUBTITLE')
            );
            await sendAuto(chat, location);
            await sendAuto(
              chat,
              getConfig(
                'MESSAGE_LOCATION',
                'Here is the location, please message me when you are outside.'
              )
            );
          } catch (err) {
            console.error('❌ Failed to send location:', err.message);
            sendPushoverNotification('GateGPT', '❌ Failed to send location!');
          }
          break;
        case 'open_gate':
          try {
            await axios.post(getConfig('GATE_OPEN_URL'), {});
            await sendAuto(
              chat,
              getConfig(
                'MESSAGE_GATE_OPEN',
                'Please enter through the car gate and leave the item on the doorstep. The gate will close after 2 minutes. Thank you.'
              )
            );
            await chat.markUnread();
            console.log(`✅ Gate opened`);

            convo.instant = true;

            if (convo.gateCloseTimer) clearTimeout(convo.gateCloseTimer);
            convo.gateCloseTimer = setTimeout(async () => {
              try {
                await axios.post(getConfig('GATE_CLOSE_URL'), {});
                console.log(`🔐 Gate closed for ${chat.id._serialized}`);
                sendPushoverNotification(
                  'GateGPT',
                  `Delivery from ${chat.id._serialized} handled.`
                );
              } catch (err) {
                console.error('❌ Failed to close gate:', err.message);
                sendPushoverNotification('GateGPT', '❌ Failed to close the gate!');
              }
              convo.instant = false;
              convo.triggered = false;
              convo.gateCloseTimer = null;
              console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
            }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));

            if (convo.instantTimer) clearTimeout(convo.instantTimer);
            convo.instantTimer = setTimeout(() => {
              convo.instant = false;
              convo.triggered = false;
              console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
            }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
          } catch (err) {
            console.error('❌ Gate open failed:', err.message);
            sendPushoverNotification('GateGPT', '❌ Failed to open the gate!');
            await sendAuto(
              chat,
              getConfig(
                'MESSAGE_GATE_FAILED',
                'Sorry, the gate failed to open. Please leave the item outside the car gate.'
              )
            );
            await chat.markUnread();
          }
          break;
      }
    }
  }

  if (trimmed && trimmed !== '...') {
    await sendAuto(chat, trimmed);
    await chat.markUnread();
    convo.instant = true;
    if (convo.instantTimer) clearTimeout(convo.instantTimer);
    convo.instantTimer = setTimeout(() => {
      convo.instant = false;
      convo.triggered = false;
      console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
    }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
  }
}

loadIgnoreList();
initClient();
