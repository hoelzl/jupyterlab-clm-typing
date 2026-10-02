// Bundle the extension (and the integration test) with esbuild. The shared
// planner/player in ../src are pulled in by relative import.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

const builds = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' }
];
if (!production) {
  builds.push({
    ...common,
    entryPoints: ['tests/integration/run.ts', 'tests/integration/suite.ts'],
    outdir: 'out/test',
    external: ['vscode', '@vscode/test-electron']
  });
}

if (watch) {
  for (const b of builds) {
    await (await esbuild.context(b)).watch();
  }
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
}
