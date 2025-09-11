const { OpenAI } = require('openai');
const { getConfig } = require('./config');

const openai = new OpenAI({ apiKey: getConfig('OPENAI_API_KEY') });

module.exports = openai;
