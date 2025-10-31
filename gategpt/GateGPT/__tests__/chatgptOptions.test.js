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
    expect(request.reasoning).toEqual({ effort: 'minimal' });
    expect(request.response_format).toEqual({ type: 'text', verbosity: 'high' });
  });
});
