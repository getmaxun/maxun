import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../src/markdownify/markdown';

for (const display of ['inline', 'block']) {
  for (const source of ['annotation', 'alttext']) {
    test(`preserves less-than comparisons in ${display} MathML from ${source}`, async () => {
      const math = source === 'annotation'
        ? `<math display="${display}"><semantics><mi>x</mi><annotation encoding="application/x-tex">x&lt;y</annotation></semantics></math>`
        : `<math display="${display}" alttext="x&lt;y"></math>`;
      const html = display === 'inline' ? `<p>Before ${math} after.</p>` : math;
      const markdown = await parseMarkdown(html);
      assert.equal(markdown, display === 'inline' ? 'Before $x<y$ after.' : '$$x<y$$');
    });
  }
}

test('keeps ordinary formulas and surrounding text', async () => {
  assert.equal(await parseMarkdown('<p>Before <math alttext="x+y"></math> after.</p>'), 'Before $x+y$ after.');
});

test('preserves ampersands in the formula', async () => {
  assert.equal(await parseMarkdown('<p><math alttext="a &amp; b"></math></p>'), '$a & b$');
});
