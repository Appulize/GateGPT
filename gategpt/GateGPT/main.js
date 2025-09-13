/*********************************************************************
 * This is GateGPT v1.2.3 first created by Maciej Swic on 2025-04-25.
 * Please see the LICENSE file.
*********************************************************************/

const fs = require('fs');
const path = require('path');

const { initLogging } = require('./logging');
const { getConfig, reloadConfig, CONFIG_PATH } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const { transcribeWithWhisper } = require('./transcription');
const { askChatGPT } = require('./chatgpt');
const {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById
} = require('./messaging');
const { sendLocation, openGate } = require('./actions');
const {
  processOtpMessage,
  associateTracking,
  resolveOtp,
  sendOtp,
  getTrackingsForPhone
} = require('./otp');
const { setStatus } = require('./deliveryLog');

initLogging();

/* ──────────────────────── 🔧  CONFIG FILE HANDLING  ───────────────────────── */
const DATA_DIR = getConfig('SESSION_DIR', __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });

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

function shouldHandleOtp(msg) {
  const keywords = getConfig('OTP_TRIGGER_KEYWORDS', []);
  return keywords.some(r => new RegExp(r, 'i').test(msg));
}

async function handleMessage(message) {
  if (isAutoMessage(message)) return;

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

  if (shouldHandleOtp(message.body)) {
    await processOtpMessage(message);
    console.log(`🔐 Stored OTP message from ${chatId}`);
    return;
  }

  if (message.type === 'ptt') {
    const media = await message.downloadMedia();
    const binaryData = Buffer.from(media.data, 'base64');
    const filePath = path.resolve(DATA_DIR, 'temp_audio.ogg');
    fs.writeFileSync(filePath, binaryData);
    const transcription = await transcribeWithWhisper(filePath);
    if (!transcription) return;
    sendPushoverNotification('Whisper', transcription);
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
      triggered: false,
      sentLocation: false,
      delivering: false
    });
  }

  const convo = conversations.get(chatId);
  if (!message.fromMe && convo.sentLocation && !convo.delivering) {
    const trackings = getTrackingsForPhone(chatId);
    trackings.forEach(t => setStatus(t, 'delivering', chatId));
    convo.delivering = true;
  }
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
  const { reply, actions } = await askChatGPT(convo.messages);
  let trimmed = reply;

  for (const action of actions) {
    switch (action.name) {
      case 'send_location':
        await sendLocation(chat);
        convo.sentLocation = true;
        break;
      case 'open_gate':
        await openGate(chat, convo);
        break;
      case 'associate_tracking_number':
        if (action.args?.tracking_number) {
          associateTracking(chat.id._serialized, action.args.tracking_number);
        }
        break;
      case 'resolve_otp':
        await resolveOtp(chat);
        break;
      case 'send_otp':
        if (action.args?.tracking_number) {
          await sendOtp(chat, action.args.tracking_number);
        }
        break;
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
      convo.sentLocation = false;
      convo.delivering = false;
      console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
    }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
  }
}

loadIgnoreList();
initMessaging({
  onReady: () => sendPushoverNotification('GateGPT', '✅ GateGPT is ready!'),
  onCall: async call => {
    sendPushoverNotification('GateGPT', `📞 Rejecting call from ${call.peerJid}`);
    const chat = await getChatById(call.peerJid);
    await sendAuto(
      chat,
      getConfig(
        'MESSAGE_CALL',
        "Sorry, I can't answer calls. Please send a message instead."
      )
    );
    await chat.markUnread();
  },
  onMessage: handleMessage
});
