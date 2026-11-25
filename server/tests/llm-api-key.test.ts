import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { resolveOpenAiApiKey } from '../src/utils/llm-endpoint';
import { summarizeMarkdown } from '../src/utils/summarizer';

for (const [name, supplied, expected] of [
  ['trailing slash', 'fixture-key/', 'fixture-key/'],
  ['multiple trailing slashes', 'fixture-key//', 'fixture-key//'],
  ['surrounding whitespace', '  fixture-key/  ', 'fixture-key/'],
  ['ordinary key', 'fixture-key', 'fixture-key'],
]) {
  test(`keeps the configured credential with ${name}`, () => {
    assert.equal(resolveOpenAiApiKey(supplied, 'https://gateway.example/v1'), expected);
  });
}

test('keeps operator fallback scoped to configured endpoints', (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousURL = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = 'operator-fixture/';
  process.env.OPENAI_BASE_URL = 'https://operator.example/v1/';
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousURL === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousURL;
  });
  assert.equal(resolveOpenAiApiKey(undefined, 'https://operator.example/v1'), 'operator-fixture/');
  assert.equal(resolveOpenAiApiKey(undefined, 'https://other.example/v1'), '');
});

test('authenticates a summary request using the exact supplied key', async (t) => {
  let receivedAuthorization: string | undefined;
  const server = createServer((request, response) => {
    request.resume();
    receivedAuthorization = request.headers.authorization;
    response.setHeader('Content-Type', 'application/json');
    if (receivedAuthorization !== 'Bearer fixture-key/') {
      response.writeHead(401);
      response.end(JSON.stringify({ error: 'Fixture credential did not match' }));
      return;
    }
    response.end(JSON.stringify({ choices: [{ message: { content: 'Fixture summary.' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const summary = await summarizeMarkdown('Example page body.', {
    provider: 'openai', model: 'fixture', apiKey: 'fixture-key/', baseUrl: `http://127.0.0.1:${port}/v1`,
  });
  assert.equal(summary, 'Fixture summary.');
  assert.equal(receivedAuthorization, 'Bearer fixture-key/');
});
