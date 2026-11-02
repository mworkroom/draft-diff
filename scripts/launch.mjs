import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = 'http://127.0.0.1:4173/';
async function ready() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok && (await response.text()).includes('DraftDiff · Word Comparison');
  } catch { return false; }
}
async function main() {
  await access(new URL('../dist/index.html', import.meta.url)).catch(() => {
    throw new Error('Build files are missing. Run npm ci and npm run build in the project folder first.');
  });
  if (!(await ready())) {
    const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      detached: true, windowsHide: true, stdio: 'ignore',
    });
    server.unref();
    for (let i = 0; i < 30 && !(await ready()); i++) await new Promise(resolve => setTimeout(resolve, 200));
    if (!(await ready())) throw new Error('Could not start DraftDiff. Check whether another app is using port 4173.');
  }
  console.log(`DraftDiff is running at ${url}`);
  if (process.argv.includes('--no-open')) return;
  const browser = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${url} in a browser.`));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
