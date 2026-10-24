import assert from 'assert';
import { describe, it } from 'node:test';
import { expandSessionPlaceholder, newProxySessionId } from '../../src/utils/proxy-session';

describe('expandSessionPlaceholder', () => {
  it('returns usernames without the placeholder unchanged', () => {
    assert.strictEqual(expandSessionPlaceholder('customer-abc'), 'customer-abc');
    assert.strictEqual(expandSessionPlaceholder(null), null);
    assert.strictEqual(expandSessionPlaceholder(''), '');
  });

  it('uses the given session id for every occurrence', () => {
    assert.strictEqual(
      expandSessionPlaceholder('user-session-{session}-sid-{session}', 'abc123'),
      'user-session-abc123-sid-abc123'
    );
  });

  it('generates a fresh id when none is given', () => {
    const first = expandSessionPlaceholder('user-session-{session}');
    const second = expandSessionPlaceholder('user-session-{session}');
    assert.match(first!, /^user-session-[a-z0-9]{10}$/);
    assert.notStrictEqual(first, second);
  });
});

describe('newProxySessionId', () => {
  it('returns 10 lowercase alphanumeric characters', () => {
    for (let i = 0; i < 100; i++) {
      assert.match(newProxySessionId(), /^[a-z0-9]{10}$/);
    }
  });
});
