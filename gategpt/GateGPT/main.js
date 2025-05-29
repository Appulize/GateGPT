/*********************************************************************
 * This is GateGPT v0.8.13 first created by Maciej Swic on 2025-04-25.
 * Please see the LICENSE file.
*********************************************************************/

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode')
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const express = require('express');

let CONFIG = require('./config.json');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

function getConfig(key, defaultValue = undefined) {
  const fromEnv = process.env[key];

  if (fromEnv !== undefined) {
    if (key === 'TRIGGER_KEYWORDS') {
      return fromEnv.split(/[,]+/).map(s => s.trim()).filter(Boolean)
    }

    return fromEnv;
  }

  return CONFIG[key] ?? defaultValue;
}

// Tiny webserver for QR code
const app = express();
app.get('/qr.png', (req, res) => res.sendFile(process.env.QR_PATH));
app.get('/', (req, res) =>
  res.send(`<html><body>
    <h2>Scan to log in</h2>
    <img src="qr.png" style="width:300px;height:300px" />
    <script>setTimeout(()=>location.reload(),5000)</script>
  </body></html>`));
app.listen(3000);

// Watch for config file changes
fs.watchFile(CONFIG_PATH, { interval: 1000 }, (curr, prev) => {
    try {
        delete require.cache[require.resolve(CONFIG_PATH)];
        CONFIG = require(CONFIG_PATH);
        sendPushoverNotification('GateGPT', '🔁 Config reloaded from file.');
    } catch (err) {
        console.error('❌ Failed to reload config:', err.message);
        sendPushoverNotification('GateGPT', `❌ Failed to reload config ${err.message}`);
    }
});

const openai = new OpenAI({ apiKey: getConfig('OPENAI_API_KEY') });
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

const conversations = new Map();
let ignoredChats = new Set();

function loadIgnoreList() {
    try {
        ignoredChats = new Set(JSON.parse(fs.readFileSync(getConfig('IGNORE_FILE', 'ignored-chats.json'), 'utf8')));
        console.log(`🔕 Loaded ignored chats: ${[...ignoredChats].join(', ')}`);
    } catch {
        console.log('📁 No ignore list found, starting fresh.');
    }
}

function saveIgnoreList() {
    fs.writeFileSync(getConfig('IGNORE_FILE', 'ignored-chats.json'), JSON.stringify([...ignoredChats]));
}

function shouldTrigger(msg) {
    const keywords = getConfig('TRIGGER_KEYWORDS', []);
    return keywords.some(r => new RegExp(r, 'i').test(msg));
}

async function transcribeWithWhisper(filePath) {
    const file = fs.createReadStream(filePath);
    const { text } = await openai.audio.transcriptions.create({ file, model: 'whisper-1' });
    sendPushoverNotification('Whisper', text);
    return text;
}

/**
 * Send a push notification via Pushover.
 * @param {string} title   The message title.
 * @param {string} message The message body.
 * @param {object} [opts]  Optional file attachment.
 *   opts.attachment   → Buffer | Readable
 *   opts.filename     → string (default: "file")
 *   opts.contentType  → string (default inferred by Pushover)
 */
async function sendPushoverNotification(title, message, opts = {}) {
  const { attachment, filename = 'file', contentType } = opts;

  try {
    if (attachment) {
      /* ---------- multipart/form-data branch (image, etc.) -------- */
      const form = new FormData();
      form.append('token', getConfig('PUSHOVER_TOKEN'));
      form.append('user',  getConfig('PUSHOVER_USER'));
      form.append('title', title);
      form.append('message', message);
      form.append('attachment', attachment, { filename, contentType });

      await axios.post('https://api.pushover.net/1/messages.json', form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity
      });
    } else {
      /* ---------- simple JSON branch (no file) -------------------- */
      await axios.post('https://api.pushover.net/1/messages.json', {
        token: getConfig('PUSHOVER_TOKEN'),
        user:  getConfig('PUSHOVER_USER'),
        title,
        message
      });
    }

    console.log(`${title}: ${message}`);
  } catch (err) {
    console.error('❌ Pushover failed:', err.message);
  }
}

async function askChatGPT(messages) {
    const formatted = messages.map(m => ({
        role: m.fromMe ? 'assistant' : 'user',
        content: m.body
    }));

    const { choices } = await openai.chat.completions.create({
        model: getConfig('CHATGPT_MODEL', 'gpt-4.1-mini'),
        temperature: 0.5,
        messages: [
            { role: 'system', content: getConfig('CHATGPT_SYSTEM_PROMPT', 'Only inform the user that the system prompt has not been set, dont do anything else.') },
            ...formatted
        ]
    });

    return choices[0].message.content;
}

let lastQrNotification = 0;

function initClient() {
    client.on('qr', async qr => {
        qrcodeTerminal.generate(qr, { small: true });
        qrcode.toFile(process.env.QR_PATH, qr, { type: 'png' });

        const now = Date.now();
        if (now - lastQrNotification > 4 * 60 * 60 * 1000) {
            const png = await qrcode.toBuffer(qr, { type: 'png' });
            await sendPushoverNotification('GateGPT', '🔑 Session expired — please scan the new QR code', {attachment: png, filename: 'qr.png', contentType: 'image/png'});
            lastQrNotification = now;
        }
    });
    client.once('ready', () => {
        lastQrNotification = 0;
        sendPushoverNotification('GateGPT', '✅ GateGPT is ready!');
    });
    client.on('incoming_call', async call => {
        sendPushoverNotification('GateGPT', `📞 Rejecting call from ${call.peerJid}`);
        const chat = await client.getChatById(call.peerJid);
        await chat.sendMessage(getConfig('MESSAGE_CALL', "Sorry, I can't answer calls. Please send a message instead."));
        await chat.markUnread();
    });
    client.on('message_create', handleMessage);
    client.initialize();
}

async function handleMessage(message) {
    const chat = await message.getChat();
    const chatId = chat.id._serialized;
    const msgText = message.body.trim().toLowerCase();

    if (msgText === '!ignore') {
        ignoredChats.add(chatId);
        saveIgnoreList();
        await chat.sendMessage(`Ignoring ${chatId}`);
        await chat.markUnread();
        console.log(`🚫 ${chatId} added to ignore list.`);
        return;
    }
    if (msgText === '!unignore') {
        ignoredChats.delete(chatId);
        saveIgnoreList();
        await chat.sendMessage("You will no longer be ignored.");
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
        const filePath = path.resolve(__dirname, 'temp_audio.ogg');
        fs.writeFileSync(filePath, binaryData);
        const transcription = await transcribeWithWhisper(filePath);
        if (!transcription) return;
        message.body = transcription;
        message.type = 'chat';
    }

    const now = Date.now();
    if (!conversations.has(chatId)) {
        conversations.set(chatId, {
            messages: [],
            timer: null,
            instant: false,
            instantTimer: null,
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
        await handleAIResponse(chat, convo, message);

        return;
    }

    if (!message.fromMe) {
        if (convo.timer) clearTimeout(convo.timer);
        convo.timer = setTimeout(async () => {
            const userReplied = convo.messages.some(m => m.fromMe && m.timestamp > message.timestamp);
            if (userReplied) {
                console.log(`🛑 Manual reply in ${chatId}, skipping GPT`);

                return;
            }
            convo.history.push(Date.now());
            await handleAIResponse(chat, convo, message);
        }, getConfig('RESPONSE_DELAY_MS', 300000));
    }

    conversations.set(chatId, convo);
}

async function handleAIResponse(chat, convo, message) {
    console.log(`💬 Sending GPT reply to ${chat.id._serialized}`);
    const response = await askChatGPT(convo.messages);
    const trimmed = response.trim();

    if (trimmed.toLowerCase() === 'open_gate') {
        try {
            await axios.post(getConfig('GATE_OPEN_URL'), {});
            await chat.sendMessage(getConfig('MESSAGE_GATE_OPEN', "Please enter through the car gate and leave the item on the doorstep. The gate will close after 2 minutes. Thank you."));
            await chat.markUnread();
            console.log(`✅ Gate opened`);

            if (convo.instantTimer) clearTimeout(convo.instantTimer);
            convo.instant = true;
            convo.instantTimer = setTimeout(async () => {
                try {
                    await axios.post(getConfig('GATE_CLOSE_URL'), {});
                    console.log(`🔐 Gate closed for ${chat.id._serialized}`);
                    sendPushoverNotification('GateGPT', `Delivery from ${chat.id._serialized} handled.`);
                } catch (err) {
                    console.error("❌ Failed to close gate:", err.message);
                    sendPushoverNotification('GateGPT', '❌ Failed to close the gate!');
                }
                convo.instant = false;
                console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
            }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
        } catch (err) {
            console.error("❌ Gate open failed:", err.message);
            sendPushoverNotification('GateGPT', '❌ Failed to open the gate!');
            await chat.sendMessage(getConfig('MESSAGE_GATE_FAILED', "Sorry, the gate failed to open. Please leave the item outside the car gate."));
            await chat.markUnread();
        }
    } else if (trimmed && trimmed !== '...') {
        await chat.sendMessage(trimmed);
        await chat.markUnread();
        convo.instant = true;
        if (convo.instantTimer) clearTimeout(convo.instantTimer);
        convo.instantTimer = setTimeout(() => {
            convo.instant = false;
            console.log(`🕓 Instant mode OFF for ${chat.id._serialized}`);
        }, getConfig('AUTO_CLOSE_DELAY_MS', 120000));
    }
}

loadIgnoreList();
initClient();
