import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/run/robotNames.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { getCurrentRobotNames } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('renames replace group labels without creating or rewriting runs', () => {
  const runs = [{ name: 'Original name', robotMetaId: 'robot-1' }];
  const recordings = [{ recording_meta: { id: 'robot-1', name: 'Renamed robot' } }];
  assert.equal(getCurrentRobotNames(recordings).get(runs[0].robotMetaId), 'Renamed robot');
  recordings[0].recording_meta.name = 'Renamed again';
  assert.equal(getCurrentRobotNames(recordings).get(runs[0].robotMetaId), 'Renamed again');
  assert.equal(runs[0].name, 'Original name');
});

test('stable robot IDs keep equally named robots independent', () => {
  const names = getCurrentRobotNames([
    { recording_meta: { id: 'one', name: 'Shared' } },
    { recording_meta: { id: 'two', name: 'Other' } },
  ]);
  assert.equal(names.get('one'), 'Shared');
  assert.equal(names.get('two'), 'Other');
  assert.equal(names.get('deleted'), undefined);
});

test('unavailable and malformed metadata leaves historical fallback available', () => {
  for (const recordings of [[], [null, undefined, 'legacy', {}, { recording_meta: null }],
    [{ recording_meta: { id: 1, name: 'Bad id' } }, { recording_meta: { id: 'one', name: 2 } }]]) {
    assert.equal(getCurrentRobotNames(recordings).size, 0);
  }
});
