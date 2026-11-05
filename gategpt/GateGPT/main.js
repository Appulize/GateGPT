/*********************************************************************
 * This is GateGPT v1.5.11 first created by Maciej Swic on 2025-04-25.
 * Please see the LICENSE file.
*********************************************************************/

const fs = require('fs');
const path = require('path');

const { initLogging } = require('./logging');
const { getConfig, reloadConfig, CONFIG_PATH } = require('./config');
const { sendPushoverNotification } = require('./notifications');
const { transcribeWithWhisper } = require('./transcription');
const { downloadMessageMedia } = require('./mediaDownload');
const { askChatGPT } = require('./chatgpt');
const {
  initMessaging,
  sendAuto,
  isAutoMessage,
  getChatById,
  getChatForMessage,
  getPhoneJidForChatId
} = require('./messaging');
const { initServer } = require('./server');
const { sendLocation, openGate } = require('./actions');
const { mirrorIncomingMessage } = require('./whatsappMirror');
const {
  processOtpMessage,
  associateTracking,
  resolveOtp,
  sendOtp,
  getTrackingsForPhone
} = require('./otp');
const { setStatus } = require('./deliveryLog');
const { resolveChatPrimaryId, chatRawId, isGroupJid } = require('./chatIdentity');
const { enableInstantMode } = require('./instantMode');
const { isGateConfigured } = require('./gateConfig');
const {
  isChannelMessage,
  isChannelChatError,
  isStatusBroadcastMessage
} = require('./messageFilters');

initLogging();
initServer();

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
const serviceStartedAt = Math.floor(Date.now() / 1000);
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
  if (
    isAutoMessage(message) ||
    isChannelMessage(message) ||
    isStatusBroadcastMessage(message)
  ) return;
  // WhatsApp can replay old messages after a restart; do not answer a courier twice.
  if (!message.fromMe && message.timestamp < serviceStartedAt - 60) return;

  let chat;
  try {
    chat = await getChatForMessage(message);
  } catch (err) {
    if (isChannelChatError(err)) return;
    throw err;
  }
  await mirrorIncomingMessage(message, chat);
  const rawChatId = chatRawId(chat);
  const chatId = await resolveChatPrimaryId(chat, message, {
    resolvePhoneJid: getPhoneJidForChatId
  });
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

  if (message.type === 'ptt') {
    if (chat?.isMuted) {
      console.log(`🔇 Muted chat, skipping Whisper transcription: ${chatId}`);
      return;
    }
    let media;
    try {
      media = await downloadMessageMedia(message);
    } catch (err) {
      console.error('❌ Failed to download voice message:', err.message);
      if (!message.fromMe && message.timestamp >= serviceStartedAt - 60) {
        sendPushoverNotification('GateGPT', `❌ Failed to download voice message from ${chatId}: ${err.message}`);
        if (!ignoredChats.has(chatId) && !isGroupJid(rawChatId)) {
          await sendAuto(chat, "Sorry, I couldn't receive your voice message.");
          await chat.markUnread();
        }
      }
      return;
    }
    const binaryData = Buffer.from(media.data, 'base64');
    const filePath = path.resolve(DATA_DIR, 'temp_audio.ogg');
    fs.writeFileSync(filePath, binaryData);
    const transcription = await transcribeWithWhisper(filePath);
    if (!transcription) return;
    sendPushoverNotification('Whisper', transcription);
    message.body = transcription;
    message.type = 'chat';
  }

  if (ignoredChats.has(chatId) || isGroupJid(rawChatId)) {
    console.log(`🚫 Ignored chat or group: ${chatId}`);
    return;
  }

  if (shouldHandleOtp(message.body)) {
    await processOtpMessage(message);
    console.log(`🔐 Stored OTP message from ${chatId}`);
    return;
  }

  if (message.type === 'image') {
    try {
      const media = await downloadMessageMedia(message, { kind: 'image' });
      message.images = [media.data];
      message.body = (message.caption || '').trim();
      message.type = 'chat';
    } catch (err) {
      console.error('❌ Failed to download image:', err.message);
      if (!message.fromMe && message.timestamp >= serviceStartedAt - 60) {
        sendPushoverNotification('GateGPT', `❌ Failed to download image from ${chatId}: ${err.message}`);
        await sendAuto(chat, "Sorry, I couldn't receive your image.");
        await chat.markUnread();
      }
      return;
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
      delivering: false,
      chatId
    });
  }

  const convo = conversations.get(chatId);
  convo.chatId = chatId;
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
      // Nothing awaits this timer, so a rejection here would kill the add-on.
      try {
        await handleAIResponse(chat, convo);
      } catch (err) {
        console.error(`❌ Failed to reply to ${chatId}:`, err?.stack || err);
        sendPushoverNotification('GateGPT', `❌ Failed to reply to ${chatId}: ${err?.message || err}`);
      }
    }, getConfig('RESPONSE_DELAY_MS', 300000));
  }

  conversations.set(chatId, convo);
}

async function handleAIResponse(chat, convo) {
  console.log(`💬 Sending GPT reply to ${convo.chatId}`);
  const { reply } = await askChatGPT(convo.messages, async action => {
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
          associateTracking(convo.chatId, action.args.tracking_number);
        }
        break;
      case 'resolve_otp':
        await resolveOtp(chat, convo.chatId);
        break;
      case 'send_otp':
        if (action.args?.tracking_number) {
          await sendOtp(chat, action.args.tracking_number);
        }
        break;
    }
    return { handled: true, note: 'The handler sends its own messages and reports failures itself. Do not claim success or repeat its messages.' };
  });
  let trimmed = reply;
  if (!isGateConfigured() && trimmed === 'open_gate') {
    trimmed = "Sorry, I can't open the gate.";
  }

  if (trimmed && trimmed !== '...') {
    await sendAuto(chat, trimmed);
    await chat.markUnread();
    enableInstantMode(convo);
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
