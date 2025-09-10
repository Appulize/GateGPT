const fs = require('fs');
const openai = require('./openaiClient');
const { sendPushoverNotification } = require('./notifications');

async function transcribeWithWhisper(filePath) {
  const file = fs.createReadStream(filePath);
  const { text } = await openai.audio.transcriptions.create({ file, model: 'whisper-1' });
  sendPushoverNotification('Whisper', text);
  return text;
}

module.exports = { transcribeWithWhisper };
