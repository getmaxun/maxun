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
  ['path before italic text', 'Read _cache_/file.txt and _ready_.', 'Read _cache_/file.txt and ready.'],
  ['path before bold text', 'Read __cache__/file.txt and __Total__.', 'Read __cache__/file.txt and Total.'],
  ['Windows path before italic text', 'Read _cache_\\file.txt and _ready_.', 'Read _cache_\\file.txt and ready.'],
  ['Windows path before bold text', 'Read __cache__\\file.txt and __Total__.', 'Read __cache__\\file.txt and Total.'],
  ['single-emphasized URL with wrapped segments', '_https://example.test/_api_/v1_', 'https://example.test/_api_/v1'],
  ['double-emphasized URL with wrapped segments', '__https://example.test/__api__/v1__', 'https://example.test/__api__/v1'],
  ['emphasized URL query and fragment', '_https://example.test/_api_/v1?field=_user_#_anchor__', 'https://example.test/_api_/v1?field=_user_#_anchor_'],
  ['punctuated emphasized URL', '(__https://example.test/__api__/v1__).', '(https://example.test/__api__/v1).'],
  ['nested emphasized URL', '*__https://example.test/__api__/v1__*', 'https://example.test/__api__/v1'],
  ['emphasized absolute path', '__/srv/__cache__/data__', '/srv/__cache__/data'],
  ['emphasized Windows path', '_C:\\srv\\_cache_\\data_', 'C:\\srv\\_cache_\\data'],
  ['Unicode punctuation around emphasized URL', '（__https://example.test/__api__/v1__）。', '（https://example.test/__api__/v1）。'],
  ['emphasis containing URL and trailing words', '__See https://example.test/__api__/v1 for details__', 'See https://example.test/__api__/v1 for details'],
  ['emphasis containing URL at its end', '_See https://example.test/_api_/v1_', 'See https://example.test/_api_/v1'],
  ['combined emphasis around URL', '___https://example.test/__api__/v1___', 'https://example.test/__api__/v1'],
  ['astral identifiers', 'Keep 𐐀_key_name and 𐐀__key__name.', 'Keep 𐐀_key_name and 𐐀__key__name.'],
  ['single-emphasized bare relative path', '_docs/file.txt_', 'docs/file.txt'],
  ['double-emphasized bare relative path', '__docs/file.txt__', 'docs/file.txt'],
  ['single-emphasized slash text', '_and/or_', 'and/or'],
  ['double-emphasized slash text', '__and/or__', 'and/or'],
  ['literal URL suffix inside bold phrase', '__See https://example.test/__api__ for details__', 'See https://example.test/__api__ for details'],
  ['literal URL suffix inside italic phrase', '_See https://example.test/_api_ for details_', 'See https://example.test/_api_ for details'],
  ['literal URL suffix before final URL closer', '__See https://example.test/__api__ and https://second.test/__beta____', 'See https://example.test/__api__ and https://second.test/__beta__'],
  ['bold closer immediately after URL suffix', '__See https://example.test/__api____', 'See https://example.test/__api__'],
  ['italic closer immediately after URL suffix', '_See https://example.test/_api__', 'See https://example.test/_api_'],
  ['URL closer before separate emphasis', '__See https://example.test/v1__ and __Total__', 'See https://example.test/v1 and Total'],
  ['relative path starting italic phrase', '_docs/file.txt for details_', 'docs/file.txt for details'],
  ['relative path starting bold phrase', '__docs/file.txt for details__', 'docs/file.txt for details'],
  ['literal path before unmatched italic suffix', 'Read _cache_/file.txt and ready_.', 'Read _cache_/file.txt and ready_.'],
  ['literal path before unmatched bold suffix', 'Read __cache__/file.txt and Total__.', 'Read __cache__/file.txt and Total__.'],
  ['literal nested URL value', 'Read https://outer.test/?next=_https://inner.test/_api_/v1_ and _ready_.', 'Read https://outer.test/?next=_https://inner.test/_api_/v1_ and ready.'],
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
