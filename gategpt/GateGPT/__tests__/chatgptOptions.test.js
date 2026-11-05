/** @jest-environment node */

describe('askChatGPT GPT-5 options', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test('passes configured options to GPT-5 requests', async () => {
    process.env.CHATGPT_MODEL = 'gpt-5-mini';
    process.env.CHATGPT_EFFORT = 'minimal';
    process.env.CHATGPT_VERBOSITY = 'HIGH';

    const openaiMock = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] })
        }
      }
    };

    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);

    const { askChatGPT } = require('../chatgpt');

    await askChatGPT([{ body: 'hello', fromMe: false }]);

    expect(openaiMock.chat.completions.create).toHaveBeenCalledTimes(1);
    const request = openaiMock.chat.completions.create.mock.calls[0][0];
    expect(request.reasoning_effort).toBe('minimal');
    expect(request.verbosity).toBe('high');
  });

  test('does not offer or execute gate control without both webhooks', async () => {
    process.env.GATE_OPEN_URL = '';
    process.env.GATE_CLOSE_URL = '';

    const openaiMock = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '', tool_calls: [
              { function: { name: 'open_gate', arguments: '{}' } }
            ] } }]
          })
        }
      }
    };
    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);

    const { askChatGPT } = require('../chatgpt');
    const result = await askChatGPT([{ body: 'Please open the gate', fromMe: false }]);
    const request = openaiMock.chat.completions.create.mock.calls[0][0];

    expect(request.tools.map(tool => tool.function.name)).not.toContain('open_gate');
    expect(request.messages[0].content).toContain('Gate control is unavailable.');
    expect(result.actions).toEqual([]);
  });

  test('uses Responses for Terra reasoning, images and function tools', async () => {
    process.env.CHATGPT_MODEL = 'gpt-5.6-terra';
    process.env.CHATGPT_EFFORT = 'medium';
    process.env.GATE_OPEN_URL = '';
    process.env.GATE_CLOSE_URL = '';
    process.env.CHATGPT_SYSTEM_PROMPT = 'Use only the configured destination.';
    const openaiMock = {
      responses: { create: jest.fn().mockResolvedValue({
        status: 'completed', model: 'gpt-5.6-terra', output: [
          { type: 'reasoning', summary: [] },
          { type: 'function_call', name: 'send_location', arguments: '{}' },
          { type: 'function_call', name: 'associate_tracking_number', arguments: '{"tracking_number":"ABC123"}' },
          { type: 'function_call', name: 'open_gate', arguments: '{}' },
          { type: 'message', content: [{ type: 'output_text', text: 'That address is not the current destination.' }] }
        ]
      }) },
      chat: { completions: { create: jest.fn() } }
    };
    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);
    const { askChatGPT } = require('../chatgpt');

    const result = await askChatGPT([
      { body: 'Please check this address', fromMe: false, images: ['aW1hZ2U='] },
      { body: 'Previous manual reply', fromMe: true, images: ['cmVmZXJlbmNl'] }
    ]);
    const request = openaiMock.responses.create.mock.calls[0][0];
    expect(openaiMock.chat.completions.create).not.toHaveBeenCalled();
    expect(request.model).toBe('gpt-5.6-terra');
    expect(request.reasoning).toEqual({ effort: 'medium' });
    expect(request.store).toBe(false);
    expect(request.instructions).toContain('Use only the configured destination.');
    expect(request.input[0].content).toContainEqual({
      type: 'input_image', image_url: 'data:image/jpeg;base64,aW1hZ2U=', detail: 'auto'
    });
    expect(request.input[1]).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'Previous manual reply' }] });
    expect(request.input[2].role).toBe('user');
    expect(request.input[2].content[0].text).toContain('not by the courier');
    expect(request.input[2].content[1].type).toBe('input_image');
    expect(request.tools.map(tool => tool.name)).not.toContain('open_gate');
    expect(request.tools.find(tool => tool.name === 'send_location')).toMatchObject({ type: 'function', strict: false });
    expect(result).toEqual({
      reply: 'That address is not the current destination.',
      actions: [{ name: 'send_location', args: {} }, { name: 'associate_tracking_number', args: { tracking_number: 'ABC123' } }]
    });
  });

  test('completes tool-only turns with real results and never repeats actions', async () => {
    process.env.CHATGPT_MODEL = 'gpt-5.6-terra';
    process.env.CHATGPT_EFFORT = 'medium';
    const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' };
    const call = { type: 'function_call', call_id: 'call1', name: 'send_location', arguments: '{}' };
    const openaiMock = { responses: { create: jest.fn()
      .mockResolvedValueOnce({ status: 'completed', model: 'gpt-5.6-terra', output: [reasoning, call] })
      .mockResolvedValueOnce({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: 'This is the wrong location.' }] }
      ] }) } };
    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);
    const execute = jest.fn().mockResolvedValue({ sent: true });
    const { askChatGPT } = require('../chatgpt');
    const result = await askChatGPT([{ body: 'Check this address', fromMe: false }], execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ name: 'send_location', args: {} });
    expect(openaiMock.responses.create).toHaveBeenCalledTimes(2);
    const continuation = openaiMock.responses.create.mock.calls[1][0];
    expect(continuation.tool_choice).toBe('none');
    expect(continuation.store).toBe(false);
    expect(continuation.reasoning).toEqual({ effort: 'medium' });
    expect(continuation.input).toEqual(expect.arrayContaining([
      reasoning, call, { type: 'function_call_output', call_id: 'call1', output: '{"sent":true}' }
    ]));
    expect(result.reply).toBe('This is the wrong location.');
  });

  test('propagates handler errors without claiming success or retrying actions', async () => {
    process.env.CHATGPT_MODEL = 'gpt-5.6-terra';
    const openaiMock = { responses: { create: jest.fn().mockResolvedValue({
      status: 'completed', output: [{ type: 'function_call', call_id: 'call1', name: 'send_location', arguments: '{}' }]
    }) } };
    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);
    const execute = jest.fn().mockRejectedValue(new Error('delivery failed'));
    const { askChatGPT } = require('../chatgpt');
    await expect(askChatGPT([{ body: 'location please', fromMe: false }], execute)).rejects.toThrow('delivery failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(openaiMock.responses.create).toHaveBeenCalledTimes(1);
  });

  test('does not execute partial Responses output', async () => {
    process.env.CHATGPT_MODEL = 'gpt-5.6-terra';
    const openaiMock = { responses: { create: jest.fn().mockResolvedValue({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'function_call', name: 'send_otp', arguments: '{}' }]
    }) } };
    jest.resetModules();
    jest.doMock('../openaiClient', () => openaiMock);
    const { askChatGPT } = require('../chatgpt');
    const execute = jest.fn();
    await expect(askChatGPT([{ body: 'OTP please', fromMe: false }], execute))
      .rejects.toThrow('AI response not completed: incomplete (max_output_tokens)');
    expect(execute).not.toHaveBeenCalled();
  });
});
