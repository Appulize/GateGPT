const openai = require('./openaiClient');
const { getConfig } = require('./config');
const { getModelRequestOptions } = require('./modelOptions');

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
      name: 'associate_tracking_number',
      description: 'Associate a tracking number with this chat for later OTP retrieval',
      parameters: {
        type: 'object',
        properties: {
          tracking_number: { type: 'string' }
        },
        required: ['tracking_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resolve_otp',
      description:
        'Send an OTP immediately if possible; otherwise send a list of available tracking numbers; try this before the send_otp tool',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_otp',
      description: 'Send the OTP for a know tracking number and remove it from storage, only use if tracking number is already known',
      parameters: {
        type: 'object',
        properties: {
          tracking_number: { type: 'string' }
        },
        required: ['tracking_number']
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

const DEFAULT_MODEL = 'gpt-5-mini';

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

  const model = getConfig('CHATGPT_MODEL', DEFAULT_MODEL);
  const request = {
    model,
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
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...getModelRequestOptions(model)
  };

  const response = await openai.chat.completions.create(request);

  const msg = response.choices[0].message;
  const actions = [];

  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      if (call.function?.name) {
        let args = {};
        try {
          args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
        } catch {
          args = {};
        }
        actions.push({ name: call.function.name, args });
      }
    }
  }

  const reply = (msg.content || '').trim();

  return { reply, actions };
}

module.exports = { askChatGPT, tools };
