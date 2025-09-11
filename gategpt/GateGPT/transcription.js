const fs = require('fs');
const openai = require('./openaiClient');
async function transcribeWithWhisper(filePath) {
  const file = fs.createReadStream(filePath);
  const { text } = await openai.audio.transcriptions.create({ file, model: 'whisper-1' });
  return text;
}

module.exports = { transcribeWithWhisper };
