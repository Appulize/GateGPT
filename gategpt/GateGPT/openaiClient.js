const { OpenAI } = require('openai');
const { getConfig } = require('./config');

const key = getConfig('OPENAI_API_KEY');
const openai = new OpenAI({ apiKey: key });

module.exports = openai;
