const openai = require('./openaiClient');
const { getConfig } = require('./config');

const tools = [
  {
    type: 'function',
    function: {
      name: 'send_location',
      description: 'Send the user\'s location to the chat',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_gate',
      description: 'Open the gate for the courier',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

async function askChatGPT(messages) {
  // Build Chat Completions-style messages with optional image parts
  const formatted = messages.flatMap(m => {
    const parts = [];

    if (m.body && m.body.trim().length) {
      parts.push({ type: 'text', text: m.body.trim() });
    }

    if (Array.isArray(m.images)) {
      m.images.forEach(b64 =>
        parts.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'auto' }
        })
      );
    }

    if (parts.length === 0) return [];

    return [
      {
        role: m.fromMe ? 'assistant' : 'user',
        content: parts
      }
    ];
  });

  const response = await openai.chat.completions.create({
    model: getConfig('CHATGPT_MODEL', 'gpt-4.1'),
    temperature: 0.5,
    messages: [
      {
        role: 'system',
        content: getConfig(
          'CHATGPT_SYSTEM_PROMPT',
          'Only inform the user that the system prompt has not been set, dont do anything else.'
        )
      },
      ...formatted
    ],
    tools,
    tool_choice: 'auto'
  });

  const msg = response.choices[0].message;
  const actions = [];

  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      if (call.function?.name) actions.push(call.function.name);
    }
  }

  const reply = (msg.content || '').trim();

  return { reply, actions };
}

module.exports = { askChatGPT, tools };
