/**
 * AI Extract checks that need no browser: request validation, spec
 * normalisation, citation grounding, reply parsing and the workflow scope
 * check.
 */
import './helpers';
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { describe, it } from 'node:test';
import { checkAiExtractInput } from '../../src/sdk/aiExtract/target';
import { normalizeSpec } from '../../src/sdk/aiExtract/spec';
import { groundRows, SnapshotLine } from '../../src/sdk/aiExtract/extract';
import { createJsonLLM, parseJsonLoose } from '../../src/sdk/aiExtract/llmClient';
import { assertWorkflowInScope } from '../../src/sdk/aiExtract/pipeline';
import { documentKey, isSameSite } from '../../src/sdk/aiExtract/pageScope';

const PROMPT = "Extract the five men's basketball shoes with their names, prices, ratings, and product URLs.";

describe('AI Extract request validation', () => {
  it('rejects a request without a URL', () => {
    for (const url of [undefined, null, '', '   ']) {
      const result = checkAiExtractInput(url, PROMPT);
      assert.strictEqual(result.ok, false);
      assert.match((result as any).error, /"url" field is required/);
    }
  });

  it('rejects invalid URLs with a clear error', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not a url', /Invalid URL: "not a url" is not a valid URL/],
      ['ftp://example.com/file', /Invalid URL: Unsupported URL protocol "ftp:\/\/"/],
      ['file:///etc/passwd', /Invalid URL: Unsupported URL protocol "file:\/\/"/],
      ['https://nohost', /Invalid URL: "nohost" is not a reachable hostname/],
      [42, /"url" field is required/],
    ];
    for (const [url, error] of cases) {
      const result = checkAiExtractInput(url, PROMPT);
      assert.strictEqual(result.ok, false, String(url));
      assert.match((result as any).error, error);
    }
  });

  it('accepts a valid URL and prompt', () => {
    const result = checkAiExtractInput('  https://example.com/shoes ', `  ${PROMPT} `);
    assert.deepStrictEqual(result, { ok: true, url: 'https://example.com/shoes', prompt: PROMPT });
  });

  it('requires a prompt, and a detailed one unless the caller opts out', () => {
    assert.match((checkAiExtractInput('https://example.com', '') as any).error, /"prompt" field is required/);
    assert.match((checkAiExtractInput('https://example.com', 'prices') as any).error, /too short/);
    assert.match((checkAiExtractInput('https://example.com', 'Extract field_1 and field_2') as any).error, /placeholder/);
    assert.strictEqual(checkAiExtractInput('https://example.com', 'prices', { requireDetailedPrompt: false }).ok, true);
  });
});

describe('extraction spec', () => {
  it('keeps the requested fields, dedupes them and drops invalid ones', () => {
    const spec = normalizeSpec({
      shape: 'list',
      name: 'Shoes',
      fields: [{ name: 'Name', type: 'text' }, { name: 'Price', type: 'price' }, { name: 'name', type: 'text' }, { name: '', type: 'x' }],
      limit: 5,
    });
    assert.deepStrictEqual(spec.fields.map((f) => f.name), ['Name', 'Price']);
    assert.strictEqual(spec.limit, 5);
  });

  it('falls back to safe defaults and rejects a spec without fields', () => {
    assert.throws(() => normalizeSpec({ fields: [] }), /could not be turned into fields/);
    const spec = normalizeSpec({ shape: 'weird', fields: [{ name: 'A', type: 'nope' }], limit: -3 });
    assert.strictEqual(spec.shape, 'list');
    assert.strictEqual(spec.fields[0].type, 'text');
    assert.strictEqual(spec.limit, null);
  });
});

describe('citation grounding', () => {
  const spec = normalizeSpec({ fields: [{ name: 'Title', type: 'text' }, { name: 'Salary', type: 'price' }] });
  const lines: SnapshotLine[] = [
    { id: 'n1', tag: 'a', depth: 1, text: 'Senior Backend Engineer' },
    { id: 'n2', tag: 'span', depth: 1, text: '$160k – $190k per year' },
    { id: 'n3', tag: 'a', depth: 1, text: 'Product Designer' },
    { id: 'n4', tag: 'span', depth: 1, text: '€80k – €95k' },
  ];
  const ids = new Set(lines.map((l) => l.id));

  it('keeps cited values that are on the page and drops invented ones', () => {
    const rows = groundRows({ items: [
      { Title: { id: 'n1' }, Salary: { id: 'n2', value: '$160k – $190k' } },
      { Title: 'n3', Salary: { id: 'n4', value: 'made up value' } },
      { Title: { id: 'n99' }, Salary: { id: 'n77' } },
      { Title: { id: 'n1' }, Salary: { id: 'n2', value: '$160k – $190k' } },
      { Bogus: { id: 'n1' } },
    ] }, spec, lines, ids);
    assert.deepStrictEqual(rows, [
      { Title: { aid: 'n1' }, Salary: { aid: 'n2', value: '$160k – $190k' } },
      { Title: { aid: 'n3' } },
    ]);
  });

  it('locates plain values from models that skip ids', () => {
    const rows = groundRows({ jobs: [
      { job_title: 'Senior Backend Engineer', salary: '$160k – $190k' },
      { Title: 'Invented Role', Salary: '$1' },
    ] }, spec, lines, ids);
    assert.deepStrictEqual(rows, [{ Title: { aid: 'n1' }, Salary: { aid: 'n2', value: '$160k – $190k' } }]);
  });

  it('returns nothing when the page does not contain the requested data', () => {
    assert.deepStrictEqual(groundRows({ items: [] }, spec, lines, ids), []);
    assert.deepStrictEqual(groundRows({ items: [{ Title: 'Chief Astronaut', Salary: '$9m' }] }, spec, lines, ids), []);
    assert.deepStrictEqual(groundRows('garbage', spec, lines, ids), []);
  });
});

describe('model replies', () => {
  it('parses JSON wrapped in reasoning, prose or code fences', () => {
    assert.deepStrictEqual(parseJsonLoose('<think>hmm {not json}</think>\nSure! ```json\n{"a": {"b": 1}}\n```'), { a: { b: 1 } });
    assert.deepStrictEqual(parseJsonLoose('Answer: {"x": "}"} trailing'), { x: '}' });
    assert.throws(() => parseJsonLoose('no json here'));
  });

  it('authenticates to a hosted Ollama server and explains its errors', async () => {
    const seen: Array<{ auth?: string; model: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { model } = JSON.parse(body);
        seen.push({ auth: req.headers.authorization, model });
        if (model !== 'gpt-oss:20b') {
          res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `model '${model}' not found` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: { content: '{"ok": true}' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const saved = { key: process.env.OLLAMA_API_KEY, model: process.env.OLLAMA_MODEL };
    try {
      process.env.OLLAMA_API_KEY = 'cloud-key';
      delete process.env.OLLAMA_MODEL;
      const call = { label: 'spec', system: 's', user: 'u' };

      // No model configured: the local default is not on the server, and the error says so.
      await assert.rejects(createJsonLLM({ provider: 'ollama', baseUrl })(call), (error: any) => {
        assert.match(error.message, /ollama request failed with status 404 \(http:\/\/127\.0\.0\.1:\d+\/api\/chat\): model 'llama3\.2' not found\./);
        assert.match(error.message, /OLLAMA_MODEL/);
        return true;
      });

      process.env.OLLAMA_MODEL = 'gpt-oss:20b';
      const result = await createJsonLLM({ provider: 'ollama', baseUrl })(call);
      assert.deepStrictEqual(result.json, { ok: true });
      assert.deepStrictEqual(seen.map((r) => r.auth), ['Bearer cloud-key', 'Bearer cloud-key']);
      assert.strictEqual(seen[1].model, 'gpt-oss:20b');
    } finally {
      server.close();
      for (const [name, value] of [['OLLAMA_API_KEY', saved.key], ['OLLAMA_MODEL', saved.model]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('does not call the provider once the time budget is spent', async () => {
    const llm = createJsonLLM({ provider: 'ollama', baseUrl: 'http://127.0.0.1:9' });
    await assert.rejects(llm({ label: 'late', system: 's', user: 'u', deadline: Date.now() - 1 }), /time budget/);
  });
});

describe('page scope', () => {
  it('treats only a different path or query as a different page', () => {
    assert.strictEqual(documentKey('https://Example.com/shoes/#reviews'), documentKey('https://example.com/shoes'));
    assert.notStrictEqual(documentKey('https://example.com/shoes'), documentKey('https://example.com/shoes?page=2'));
    assert.notStrictEqual(documentKey('https://example.com/shoes'), documentKey('https://example.com/p/1'));
    assert.strictEqual(isSameSite('https://example.com/a', 'https://www.example.com/b'), true);
    assert.strictEqual(isSameSite('https://example.com/a', 'https://example.org/a'), false);
  });

  it('rejects a robot that would open another page or paginate without a requested count', () => {
    const url = 'https://example.com/shoes';
    const step = (what: any[]) => [{ where: { url }, what: [{ action: 'goto', args: [url] }, ...what] }];
    const list = (type: string) => ({ action: 'scrapeList', args: [{ fields: {}, listSelector: '//li', pagination: { type, selector: '.next' }, limit: 5 }] });

    assert.doesNotThrow(() => assertWorkflowInScope(step([list('none')]), url));
    assert.doesNotThrow(() => assertWorkflowInScope(step([list('scrollDown')]), url));
    for (const type of ['clickNext', 'clickLoadMore', 'scrollUp']) {
      assert.throws(() => assertWorkflowInScope(step([list(type)]), url), /would leave the extraction page/);
    }
    // Next-page pagination only for an explicit count, capped at that count.
    assert.doesNotThrow(() => assertWorkflowInScope(step([list('clickNext')]), url, { requestedCount: 5 }));
    assert.doesNotThrow(() => assertWorkflowInScope(step([list('clickLoadMore')]), url, { requestedCount: 5 }));
    assert.throws(() => assertWorkflowInScope(step([list('clickNext')]), url, { requestedCount: 50 }), /would leave/);
    assert.throws(() => assertWorkflowInScope(step([list('scrollUp')]), url, { requestedCount: 5 }), /would leave/);
    assert.throws(() => assertWorkflowInScope(step([{ action: 'goto', args: ['https://example.com/shoes?page=2'] }]), url), /not the extraction page/);
  });
});
