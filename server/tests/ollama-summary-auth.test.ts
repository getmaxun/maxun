import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { summarizeMarkdown } from '../src/utils/summarizer';

const cases = [
  { name: 'explicit key for a custom endpoint', key: 'explicit-fixture', expected: 'explicit-fixture' },
  { name: 'operator key for the default endpoint', operator: true, expected: 'operator-fixture' },
  { name: 'operator key for an explicitly selected operator endpoint', operator: true, explicitBase: true, expected: 'operator-fixture' },
  { name: 'operator endpoint with a trailing slash', operator: true, explicitBase: true, trailingSlash: true, expected: 'operator-fixture' },
  { name: 'explicit key overrides the operator key', operator: true, key: 'explicit-fixture', expected: 'explicit-fixture' },
  { name: 'operator key stays off a different endpoint', expected: undefined },
  { name: 'local endpoint needs no key', noOperatorKey: true, expected: undefined },
];

for (const scenario of cases) {
  test(`Ollama summary: ${scenario.name}`, async (t) => {
    const previousBase = process.env.OLLAMA_BASE_URL;
    const previousKey = process.env.OLLAMA_API_KEY;
    t.after(() => {
      if (previousBase === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = previousBase;
      if (previousKey === undefined) delete process.env.OLLAMA_API_KEY;
      else process.env.OLLAMA_API_KEY = previousKey;
    });

    let authorization: string | undefined;
    let path: string | undefined;
    let body = '';
    const expectedHeader = scenario.expected ? `Bearer ${scenario.expected}` : undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      path = request.url;
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        if (authorization !== expectedHeader) {
          response.writeHead(401);
          response.end(JSON.stringify({ error: 'Fixture credential did not match' }));
          return;
        }
        response.end(JSON.stringify({ message: { content: 'Fixture summary.' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.OLLAMA_BASE_URL = scenario.operator ? baseUrl + (scenario.trailingSlash ? '/' : '') : 'http://operator.example';
    if (scenario.noOperatorKey) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = 'operator-fixture';

    const summary = await summarizeMarkdown('Example page body.', {
      provider: 'ollama',
      model: 'fixture',
      apiKey: scenario.key,
      baseUrl: scenario.operator && !scenario.explicitBase ? undefined : baseUrl,
    });
    assert.equal(summary, 'Fixture summary.');
    assert.equal(authorization, expectedHeader);
    assert.equal(path, '/api/chat');
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'fixture');
    assert.equal(payload.stream, false);
    assert.equal(payload.think, false);
    assert.match(payload.messages[1].content, /Example page body/);
  });
}
