import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createJsonLLM, parseJsonLoose } from '../src/sdk/aiExtract/llmClient';

const expected = {
  rows: [{ example: { aid: 'L1', value: '```json\n{"enabled": true}\n```' } }],
};
const json = JSON.stringify(expected);

for (const [name, reply] of [
  ['plain JSON', json],
  ['JSON wrapped in a code fence', `\`\`\`json\n${json}\n\`\`\``],
  ['JSON with surrounding prose', `Extracted values:\n${json}\nDone.`],
  ['JSON after a reasoning block', `<think>Inspect the example.</think>\n${json}`],
]) {
  test(`preserves a captured code example in ${name}`, () => {
    assert.deepEqual(parseJsonLoose(reply), expected);
  });
}

for (const [name, reply] of [
  ['plain', '{"rows":[]}'],
  ['fenced', '```json\n{"rows":[]}\n```'],
  ['reasoning with braces', '<think>Consider {an example} first.</think>\n{"rows":[]}'],
]) {
  test(`still accepts ${name} model output`, () => {
    assert.deepEqual(parseJsonLoose(reply), { rows: [] });
  });
}

test('keeps the existing fenced array support', () => {
  assert.deepEqual(parseJsonLoose('```json\n[{"id":1}]\n```'), [{ id: 1 }]);
});

test('still rejects output with no JSON object', () => {
  assert.throws(() => parseJsonLoose('No extractable rows.'), /No JSON object/);
});

test('keeps code fences through the configured provider call', async (t) => {
  let path: string | undefined;
  const server = createServer((request, response) => {
    path = request.url;
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: json } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const llm = createJsonLLM({ provider: 'openai', model: 'fixture', apiKey: 'fixture-key', baseUrl });
  const result = await llm({ label: 'extract', system: 'Return JSON.', user: 'Extract the code example.' });
  assert.deepEqual(result.json, expected);
  assert.equal(result.provider, 'openai:fixture');
  assert.equal(path, '/v1/chat/completions');
});
