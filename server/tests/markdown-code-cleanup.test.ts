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
  ['paragraph-leading long inline delimiters', '<p><code>a`b``c</code> (opens in a new window).</p>', '```a`b``c```'],
  ['quoted-looking content in a fence', '<pre><code>&gt; ```\nconst hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['nested quote-looking content in a quoted fence', '<blockquote><pre><code>&gt; ```\nconst hint = "(opens in a new tab)";</code></pre></blockquote>', 'const hint = "(opens in a new tab)";'],
  ['indented fence-looking content', '<pre><code>    ```\nconst hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['nested list containers', '<ul><li><ul><li><pre><code>&gt; ```\nconst hint = "(opens in a new tab)";</code></pre></li></ul></li></ul>', 'const hint = "(opens in a new tab)";'],
  ['one-space fence content', '<pre><code> ```\nconst hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['two-space fence content', '<pre><code>  ```\nconst hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['three-space fence content', '<pre><code>   ```\nconst hint = "(opens in a new tab)";</code></pre>', 'const hint = "(opens in a new tab)";'],
  ['links inside code', '<p><code><a href="#hint">(opens in a new tab)</a></code></p>', '`(opens in a new tab)`'],
  ['language hints', '<pre><code class="language-typescript extra">const count = 1;</code></pre>', '```typescript\nconst count = 1;\n```'],
  ['image syntax in linked heading code', '<a href="https://example.test"><h2>Use <code>![x](image.png)</code> here</h2></a>', '`![x](image.png)`'],
  ['spaces in linked heading code', '<a href="https://example.test"><h2>Use <code>a  b</code> here</h2></a>', '`a  b`'],
  ['URI backticks before code', '<p><a href="https://example.test/a`b">API</a> then <code>(opens in a new tab)</code>.</p>', '`(opens in a new tab)`'],
  ['nested code elements', '<p><code>a <code>b</code> c</code></p>', '``a `b` c``'],
  ['inline code spaces', '<p>Keep <code>a  b</code> literally.</p>', '`a  b`'],
  ['inline code edge spaces', '<p>Keep <code> a </code> literally.</p>', '`  a  `'],
] as const;

for (const [name, content, expected] of cases) {
  test(`Markdown cleanup preserves ${name}`, async () => {
    const output = await parseMarkdown(`<article><h1>Code examples</h1><p>These examples document the exact source text to copy into a program. Its literal strings and whitespace must remain intact.</p>${content}<p>Read more (opens in a new window).</p></article>`);
    assert.ok(output.includes(expected), output);
    assert.ok(!output.includes('(opens in a new window)'), output);
    assert.ok(!output.includes('\uE000'), output);
  });
}

test('Markdown cleanup still removes prose-only accessibility and edit hints', async () => {
  const output = await parseMarkdown('<article><h1>Guide</h1><p>Read <a href="https://example.test">the documentation (opens in a new tab)</a> (opens in a new window).</p><p><a href="#edit">[edit]</a></p></article>');
  assert.ok(output.includes('[the documentation](https://example.test).'), output);
  assert.ok(!output.includes('[edit]'), output);
});

test('Markdown cleanup keeps ordinary code and adjacent prose spacing', async () => {
  const output = await parseMarkdown('<article><p>Run <code>hello()</code> now.</p><pre><code>const count = 1;</code></pre></article>');
  assert.equal(output, 'Run `hello()` now.\n\n```\nconst count = 1;\n```');
});

test('concurrent conversions keep code protection and base URLs isolated', async () => {
  const outputs = await Promise.all([
    parseMarkdown('<article><p><a href="/guide">Guide</a> <code>(opens in a new tab)</code></p></article>', 'https://first.test/start'),
    parseMarkdown('<article><p><a href="/guide">Guide</a> <code>[edit]</code></p></article>', 'https://second.test/start'),
  ]);
  assert.equal(outputs[0], '[Guide](https://first.test/guide) `(opens in a new tab)`');
  assert.equal(outputs[1], '[Guide](https://second.test/guide) `[edit]`');
});

test('generated fences exceed fence-looking code content', async () => {
  for (const prefix of ['', ' ', '  ', '   ', '    ', '> ']) {
    const code = `${prefix}\`\`\`\nconst hint = "(opens in a new tab)";`;
    const html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const output = await parseMarkdown(`<pre><code>${html}</code></pre>`);
    assert.equal(output, `\`\`\`\`\n${code}\n\`\`\`\``);
  }
});
