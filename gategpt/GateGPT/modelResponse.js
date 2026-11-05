const openai = require('./openaiClient');

// Normalize both endpoints for the courier and incoming-OTP tool consumers.
async function createModelResponse(request) {
  // GPT-5.4 and later require Responses for tools with reasoning enabled.
  // Keep the existing endpoint for older models/installations.
  const model = request.model;
  const formatted = request.messages.slice(1);
  const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  const useResponses = version && Number(version[1]) === 5 && Number(version[2]) >= 4;
  let msg;
  let responsesRequest;
  let responsesOutput;
  let complete;
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
    complete = async toolResults => {
      const response = await openai.responses.create({
        ...responsesRequest,
        input: [...responsesRequest.input, ...responsesOutput, ...toolResults],
        tool_choice: 'none'
      });
      if (response.status !== 'completed') {
        throw new Error(`AI response not completed: ${response.status}`);
      }
      return response.output.filter(item => item.type === 'message')
        .flatMap(item => item.content).filter(part => part.type === 'output_text')
        .map(part => part.text).join('\n');
    };

  } else {
    const response = await openai.chat.completions.create(request);
    msg = response.choices[0].message;
    console.log(`🤖 AI model=${response.model} endpoint=chat.completions reasoning=${request.reasoning_effort || 'not applicable'}`);
  }
  return { message: msg, complete };
}

module.exports = { createModelResponse };
