import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { processRobotOutputFormats } from '../src/utils/output-post-processor';

for (const robotType of ['crawl', 'search']) {
  for (const outputFormats of [['summary'], ['links', 'summary'], ['text', 'summary'], ['markdown', 'summary']]) {
    test(`${robotType} generates a summary with ${outputFormats.join(', ')}`, async (t) => {
      const requests: any[] = [];
      const server = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        requests.push({ path: request.url, body: JSON.parse(body) });
        response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        response.end(JSON.stringify({ message: { content: 'Fixture summary.' } }));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

      const page: any = {
        text: 'The product supports offline document processing.',
        html: '<main><p>The product supports offline document processing.</p></main>',
        links: ['https://example.com/docs'],
      };
      const categorizedOutput = {
        crawl: robotType === 'crawl' ? { 'Crawl Results': [page] } : {},
        search: robotType === 'search' ? { 'Search Results': { mode: 'scrape', results: [page] } } : {},
      };
      const port = (server.address() as AddressInfo).port;

      await processRobotOutputFormats({
        robotType,
        outputFormats,
        categorizedOutput,
        llmConfig: { provider: 'ollama', model: 'fixture', baseUrl: `http://127.0.0.1:${port}` },
      });

      assert.equal(page.summary, 'Fixture summary.');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].path, '/api/chat');
      assert.match(requests[0].body.messages[1].content, /The product supports offline document processing\./);
      assert.equal(Boolean(page.text), outputFormats.includes('text'));
      assert.equal(Boolean(page.markdown), outputFormats.includes('markdown'));
    });
  }
}
