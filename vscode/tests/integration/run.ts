// Integration test launcher: downloads VS Code (cached in .vscode-test/),
// opens a scratch copy of ../examples and runs suite.ts in the extension
// host. Run with `npm run test:integration`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Bundled to out/test/run.js, so the extension root is two levels up.
  const extensionRoot = path.resolve(__dirname, '../..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'clm-typing-'));
  fs.cpSync(path.resolve(extensionRoot, '../examples'), workspace, {
    recursive: true
  });
  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION ?? 'stable',
      extensionDevelopmentPath: extensionRoot,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust'
      ]
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
