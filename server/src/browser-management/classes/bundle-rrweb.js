const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['rrweb-entry.js'],
  bundle: true,
  minify: true,
  outfile: 'rrweb-bundle.js',
  format: 'iife', // so that rrwebSnapshot is available on window
  globalName: 'rrwebSnapshotBundle'
}).catch(() => process.exit(1));
