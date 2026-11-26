import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { summarizeMarkdown } from '../src/utils/summarizer';

const cases = [
  ['plain identifiers', 'Keep order_item_count and user__display__name.', 'Keep order_item_count and user__display__name.'],
  ['URLs and paths', 'Docs: https://example.test/api_reference/version_1 and /srv/daily_logs/export_ready.json.', 'Docs: https://example.test/api_reference/version_1 and /srv/daily_logs/export_ready.json.'],
  ['Unicode identifiers', 'Keep 名称_用户_标识 and e\u0301_utilisateur_actif.', 'Keep 名称_用户_标识 and e\u0301_utilisateur_actif.'],
  ['identifier before italic text', 'Use snake_case and _friendly labels_.', 'Use snake_case and friendly labels.'],
  ['identifier before bold text', 'Use account__id and __display labels__.', 'Use account__id and display labels.'],
  ['underscore-wrapped URL and path segments', 'Keep https://example.test/_api_/v1 and /srv/__cache__/data.', 'Keep https://example.test/_api_/v1 and /srv/__cache__/data.'],
  ['URL query and fragment', 'Read https://example.test/_api_/v1?field=_user_#_anchor_.', 'Read https://example.test/_api_/v1?field=_user_#_anchor_.'],
  ['relative and Windows paths', 'Read ./_cache_/file and C:\\srv\\__cache__\\data.', 'Read ./_cache_/file and C:\\srv\\__cache__\\data.'],
  ['leading relative path segment', 'Read _cache_/file.txt.', 'Read _cache_/file.txt.'],
  ['emphasized URL', '__https://example.test/_api_/v1__', 'https://example.test/_api_/v1'],
  ['emphasis controls', '__Total__ is _ready_ and **stable** *now*.', 'Total is ready and stable now.'],
  ['emphasized identifiers', '_order_item_count_ uses __user_id__.', 'order_item_count uses user_id.'],
  ['punctuation boundaries', '(_ready_), [__done__], and “_确认_”.', '(ready), [done], and “确认”.'],
  ['fenced Markdown', '```markdown\n## __Status__\n\nUse order_item_count and _labels_.\n```', 'Status\n\nUse order_item_count and labels.'],
];

for (const [name, content, expected] of cases) {
  test(`summary keeps literal underscores in ${name}`, async (t) => {
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const summary = await summarizeMarkdown('Describe the identifiers in this page.', {
      provider: 'openai', model: 'fixture', apiKey: 'fixture-key', baseUrl,
    });
    assert.equal(summary, expected);
  });
}
