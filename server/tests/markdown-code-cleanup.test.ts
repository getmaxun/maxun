import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../src/markdownify/markdown';

const cases = [
  ['string literals in fenced code', '<pre><code>const hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['edit text in fenced code', '<pre><code>[edit]</code></pre>', '\n[edit]\n'],
  ['blank lines in fenced code', '<pre><code>first\n\n\nlast</code></pre>', 'first\n\n\nlast'],
  ['trailing spaces in fenced code', '<pre><code>first  \nsecond</code></pre>', 'first  \nsecond'],
  ['inline code', '<p>Keep <code>(opens in a new tab)</code> literally.</p>', '`(opens in a new tab)`'],
  ['Markdown link examples', '<p>Use <code>[Skip to Content](#example)</code> in Markdown.</p>', '`[Skip to Content](#example)`'],
  ['linked inline code', '<p>See <a href="https://example.test"><code>(opens in a new tab)</code></a>.</p>', '[`(opens in a new tab)`](https://example.test)'],
  ['highlighted code', '<pre><code><span>Edit</span> the value</code></pre>', 'Edit the value'],
  ['quoted code blocks', '<blockquote><pre><code>first\n\n\n[edit]</code></pre></blockquote>', '> first\n> \n> \n> [edit]'],
  ['code blocks in lists', '<ul><li><pre><code>first\n\n\n[edit]</code></pre></li></ul>', 'first\n    \n    \n    [edit]'],
  ['embedded backticks', '<pre><code>```\nconst hint = "(opens in a new tab)";\n```</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['inline backticks', '<p>Keep <code>`(opens in a new tab)`</code> literally.</p>', '`` `(opens in a new tab)` ``'],
] as const;

for (const [name, content, expected] of cases) {
  test(`Markdown cleanup preserves ${name}`, async () => {
    const output = await parseMarkdown(`<article><h1>Code examples</h1><p>These examples document the exact source text to copy into a program. Its literal strings and whitespace must remain intact.</p>${content}</article>`);
    assert.ok(output.includes(expected), output);
  });
}

test('Markdown cleanup still removes prose-only accessibility and edit hints', async () => {
  const output = await parseMarkdown('<article><h1>Guide</h1><p>Read <a href="https://example.test">the documentation (opens in a new tab)</a> (opens in a new window).</p><p><a href="#edit">[edit]</a></p></article>');
  assert.ok(output.includes('[the documentation](https://example.test).'), output);
  assert.ok(!output.includes('[edit]'), output);
});

test('Markdown cleanup keeps ordinary code and adjacent prose spacing', async () => {
  const output = await parseMarkdown('<article><p>Run <code>hello()</code> now.</p><pre><code>const count = 1;</code></pre></article>');
  assert.ok(output.includes('Run `hello()` now.'), output);
  assert.ok(output.includes('```\nconst count = 1;\n```'), output);
});
