import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../src/markdownify/markdown';

const destination = 'https://example.com/search?q=fish%26chips&path=manual%2Fpart&percent=100%25#results';
const wrappedLinks = [
  ['Safe Links', `https://nam01.safelinks.protection.outlook.com/?url=${encodeURIComponent(destination)}`],
  ['Google q', `https://www.google.com/url?q=${encodeURIComponent(destination)}`],
  ['Google url', `https://www.google.com/url?url=${encodeURIComponent(destination)}`],
  ['redirect_uri', `https://redirect.example.com/?redirect_uri=${encodeURIComponent(destination)}`],
  ['redirectUrl', `https://redirect.example.com/?redirectUrl=${encodeURIComponent(destination)}`],
];

for (const [name, wrapped] of wrappedLinks) {
  test(`preserves encoded destination query values when unwrapping ${name}`, async () => {
    const markdown = await parseMarkdown(`<p><a href="${wrapped}">Read the article</a></p>`);
    assert.equal(markdown, `[Read the article](${destination})`);
  });
}

test('keeps direct links with encoded query values', async () => {
  const markdown = await parseMarkdown(`<p><a href="${destination.replace(/&/g, '&amp;')}">Read the article</a></p>`);
  assert.equal(markdown, `[Read the article](${destination})`);
});

test('keeps a redirect link that has no destination parameter', async () => {
  const url = 'https://www.google.com/url?source=example';
  const markdown = await parseMarkdown(`<p><a href="${url}">Read the article</a></p>`);
  assert.equal(markdown, `[Read the article](${url})`);
});
