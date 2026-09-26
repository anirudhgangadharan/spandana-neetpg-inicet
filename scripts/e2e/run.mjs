import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const nextBin = new URL('../../node_modules/next/dist/bin/next', import.meta.url);
const playwrightBin = new URL('../../node_modules/@playwright/test/cli.js', import.meta.url);
const nextBinPath = fileURLToPath(nextBin);
const playwrightBinPath = fileURLToPath(playwrightBin);
// Keep Auth.js callbacks on the isolated harness server even when a developer's
// .env.local points AUTH_URL at the normal port or a deployed origin.
const env = { ...process.env, E2E_TEST_MODE: '1', AUTH_URL: 'http://127.0.0.1:3117' };

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${args[0]} exited on ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:3117/e2e-harness/module-attempt');
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for the local E2E server.');
}

function stopTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}

let server;
try {
  if (!process.argv.includes('--skip-build')) {
    const buildCode = await run(process.execPath, [nextBinPath, 'build']);
    if (buildCode !== 0) process.exitCode = buildCode;
  }
  if (process.exitCode === undefined) {
    server = spawn(process.execPath,
      [nextBinPath, 'start', '--hostname', '127.0.0.1', '--port', '3117'],
      // Ignore stdio so a Next.js worker cannot inherit the caller's terminal
      // and keep CI open after the parent process has been terminated.
      { cwd: root, env, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    server.unref();
    const serverError = new Promise((_, reject) => server.once('error', reject));
    await Promise.race([waitForServer(), serverError]);
    process.exitCode = await run(process.execPath, [playwrightBinPath, 'test', ...process.argv.slice(2).filter((arg) => arg !== '--skip-build')]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (server?.pid) stopTree(server.pid);
}
