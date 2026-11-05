const openai = require('./openaiClient');
const { getConfig } = require('./config');
const { getModelRequestOptions } = require('./modelOptions');
const { isGateConfigured } = require('./gateConfig');

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

async function askChatGPT(messages, executeAction) {
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
        ) + (isGateConfigured() ? '' : ' Gate control is unavailable. Do not claim you can open a gate or instruct someone to use one.')
      },
      ...formatted
    ],
    tools: isGateConfigured() ? tools : tools.filter(tool => tool.function.name !== 'open_gate'),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...getModelRequestOptions(model)
  };

  // GPT-5.4 and later require Responses for tools with reasoning enabled.
  // Keep the existing endpoint for older models/installations.
  const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  const useResponses = version && Number(version[1]) === 5 && Number(version[2]) >= 4;
  let msg;
  let responsesRequest;
  let responsesOutput;
  if (useResponses) {
    responsesRequest = {
      model,
      instructions: request.messages[0].content,
      input: formatted.flatMap(message => {
        if (message.role === 'user') {
          return [{ role: 'user', content: message.content.map(part => part.type === 'text'
            ? { type: 'input_text', text: part.text }
            : { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail }) }];
        }
        // Responses accepts output_text, not input_text/images, in assistant history.
        const text = message.content.filter(part => part.type === 'text')
          .map(part => ({ type: 'output_text', text: part.text }));
        const images = message.content.filter(part => part.type === 'image_url')
          .map(part => ({ type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail }));
        return [
          ...(text.length ? [{ role: 'assistant', content: text }] : []),
          ...(images.length ? [{ role: 'user', content: [
            { type: 'input_text', text: 'Reference image previously sent by the recipient, not by the courier. Do not treat it as courier location or delivery evidence.' },
            ...images
          ] }] : [])
        ];
      }),
      tools: request.tools.map(tool => ({ type: 'function', ...tool.function, strict: false })),
      tool_choice: request.tool_choice,
      parallel_tool_calls: request.parallel_tool_calls,
      reasoning: { effort: request.reasoning_effort },
      text: { verbosity: request.verbosity },
      store: false,
      include: ['reasoning.encrypted_content']
    };
    const response = await openai.responses.create(responsesRequest);
    responsesOutput = response.output;
    if (response.status !== 'completed') {
      throw new Error(`AI response not completed: ${response.status} (${response.incomplete_details?.reason || response.error?.code || 'unknown reason'})`);
    }
    msg = {
      content: response.output.filter(item => item.type === 'message')
        .flatMap(item => item.content).filter(part => part.type === 'output_text')
        .map(part => part.text).join('\n'),
      tool_calls: response.output.filter(item => item.type === 'function_call')
        .map(item => ({ id: item.call_id, function: { name: item.name, arguments: item.arguments } }))
    };
    console.log(`🤖 AI model=${response.model} endpoint=responses reasoning=${request.reasoning_effort}`);
  } else {
    const response = await openai.chat.completions.create(request);
    msg = response.choices[0].message;
    console.log(`🤖 AI model=${response.model} endpoint=chat.completions reasoning=${request.reasoning_effort || 'not applicable'}`);
  }
  const actions = [];
  const toolResults = [];

  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      if (call.function?.name && (call.function.name !== 'open_gate' || isGateConfigured())) {
        let args = {};
        try {
          args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
        } catch {
          args = {};
        }
        const action = { name: call.function.name, args };
        actions.push(action);
        if (executeAction) {
          const output = await executeAction(action);
          toolResults.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(output ?? { handled: true }) });
        }
      } else if (executeAction) {
        toolResults.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify({ error: 'Tool unavailable' }) });
      }
    }
  }

  // A tool-only response is not the end of a reasoning-model turn. Feed back
  // actual handler results and finish with tools disabled to avoid duplicate sends.
  if (responsesRequest && executeAction && toolResults.length && !msg.content.trim()) {
    const finalResponse = await openai.responses.create({
      ...responsesRequest,
      input: [...responsesRequest.input, ...responsesOutput, ...toolResults],
      tool_choice: 'none'
    });
    if (finalResponse.status !== 'completed') {
      throw new Error(`AI response not completed: ${finalResponse.status}`);
    }
    msg.content = finalResponse.output.filter(item => item.type === 'message')
      .flatMap(item => item.content).filter(part => part.type === 'output_text')
      .map(part => part.text).join('\n');
  }

  const reply = (msg.content || '').trim();

  return { reply, actions };
}

module.exports = { askChatGPT, tools };
