/**
 * Request bodies callAnthropicWithTool sends, checked against a local server
 * that answers like the Messages API: it rejects `temperature` and a forced
 * `tool_choice` for the models that reject them. The model lists below describe
 * the API, so they are deliberately not imported from the helper.
 */
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { after, before, describe, it } from 'node:test';
import { callAnthropicWithTool } from '../../src/sdk/anthropicToolHelper';

const REJECTS_SAMPLING = ['claude-fable-5', 'claude-mythos-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5-5'];
// claude-opus-6 stands in for a model released after the helper was written.
const REJECTS_FORCED_TOOL = ['claude-fable-5-1', 'claude-mythos-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-6'];
const SYSTEM = 'Name lists on web pages.';

const TOOL = {
  name: 'pick_label',
  description: 'Pick a label',
  input_schema: { type: 'object' as const, properties: { label: { type: 'string' } }, required: ['label'] },
};

let server: http.Server;
const requests: any[] = [];

function answer(body: any): [number, object] {
  const model: string = body.model;
  if (body.temperature !== undefined && REJECTS_SAMPLING.some((prefix) => model.startsWith(prefix))) {
    return [400, { type: 'error', error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' } }];
  }
  if (['tool', 'any'].includes(body.tool_choice?.type) && REJECTS_FORCED_TOOL.some((prefix) => model.startsWith(prefix))) {
    return [400, { type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice forcing is not supported for this model.' } }];
  }
  return [200, {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'tool_use', id: 'toolu_1', name: TOOL.name, input: { label: 'Products' } }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }];
}

async function call(model: string) {
  return callAnthropicWithTool<{ label: string }>({
    apiKey: 'test-key',
    model,
    maxTokens: 64,
    system: SYSTEM,
    userMessage: 'Name this list.',
    tool: TOOL,
  });
}

describe('callAnthropicWithTool request parameters', () => {
  before(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        requests.push(body);
        const [status, payload] = answer(body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('never sends temperature', async () => {
    for (const model of ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-sonnet-4-5']) {
      requests.length = 0;
      assert.deepStrictEqual(await call(model), { label: 'Products' });
      assert.strictEqual(requests.length, 1);
      assert.strictEqual('temperature' in requests[0], false);
    }
  });

  for (const model of ['claude-sonnet-5', 'claude-sonnet-5-20260101', 'claude-haiku-5-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022']) {
    it(`forces the tool for ${model}`, async () => {
      requests.length = 0;
      assert.deepStrictEqual(await call(model), { label: 'Products' });
      assert.deepStrictEqual(requests[0].tool_choice, { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true });
      assert.strictEqual(requests[0].system, SYSTEM);
    });
  }

  for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-opus-6']) {
    it(`asks ${model} for the tool in the system prompt instead of forcing it`, async () => {
      requests.length = 0;
      assert.deepStrictEqual(await call(model), { label: 'Products' });
      assert.deepStrictEqual(requests[0].tool_choice, { type: 'auto', disable_parallel_tool_use: true });
      assert.strictEqual(requests[0].system, `${SYSTEM}\n\nRespond by calling the \`${TOOL.name}\` tool.`);
    });
  }
});
