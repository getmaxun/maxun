import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  stdin: {
    contents: `import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {MemoryRouter} from 'react-router-dom';
      import {RunsTable} from './src/components/run/RunsTable';
      import {setRecordings} from './src/context/globalInfo';
      export function render(recordings) {
        setRecordings(recordings);
        return renderToStaticMarkup(<MemoryRouter><RunsTable
          currentInterpretationLog="" abortRunHandler={()=>{}}
          runId="" runningRecordingName="" /></MemoryRouter>);
      }`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'runs-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /context\/globalInfo|\.\/RunSettings|\.\/ColapsibleRow|utils\/browserSocket|^react-i18next$/ },
        ({ path }) => ({ path: path.includes("globalInfo") ? "globalInfo" : path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        resolveDir: root,
        contents: path.includes('globalInfo') ? `
          let recordings = [];
          export const setRecordings = value => { recordings = value; };
          export const useCachedRecordings = () => ({data: recordings});
          export const useCachedRuns = () => ({data: [{id: 1, name: 'Original robot',
            robotMetaId: 'one', startedAt: '2026-09-01T12:00:00Z', status: 'success', runId: 'r1'}]});
          export const useGlobalInfoStore = () => ({notify(){}, setRerenderRuns(){}});
          export const useCacheInvalidation = () => ({invalidateRuns(){}});
        ` : path === 'react-i18next' ? `export const useTranslation = () => ({t: key => key});`
          : path.includes('RunSettings') ? `export const RunSettings = () => null;`
          : path.includes('ColapsibleRow') ? `export const CollapsibleRow = () => null;`
          : `export const getOrCreateBrowserSocket = () => null; export const releaseBrowserSocket = () => {};`,
      }));
    },
  }],
});
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'maxun-runs-test-'));
let render;
try {
  const bundle = join(temporaryDirectory, 'fixture.cjs');
  await writeFile(bundle, result.outputFiles[0].text);
  ({ render } = createRequire(import.meta.url)(bundle));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

for (const name of ['Renamed robot', 'Renamed again']) {
  test(`Runs heading uses current metadata: ${name}`, () => {
    const markup = render([{ recording_meta: { id: 'one', name } }]);
    assert.match(markup, new RegExp(`<h6[^>]*>${name}</h6>`));
    assert.doesNotMatch(markup, /<h6[^>]*>Original robot<\/h6>/);
  });
}

test('Runs heading retains history when robot metadata is unavailable', () => {
  assert.match(render([]), /<h6[^>]*>Original robot<\/h6>/);
});
