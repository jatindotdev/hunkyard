#!/usr/bin/env node
// Renders a URL in headless Chrome and reports what actually painted.
//
// `--virtual-time-budget` cannot be used for this app: it advances the main
// thread's clock but not a worker's, and the diff viewer is gated on the
// highlight worker pool reporting `initialized`. A local diff arrives in
// milliseconds, so under virtual time the page reaches `ready` before the pool
// ever boots and the viewer never appears -- an artifact that looks exactly
// like a broken viewer. So this waits in real time, over the DevTools Protocol.
//
//   node scripts/shoot.mjs <url> [out.png] [waitMs]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out = '/tmp/shot.png', waitMs = '9000'] = process.argv.slice(2);
if (!url) {
  console.error('usage: shoot.mjs <url> [out.png] [waitMs]');
  process.exit(2);
}

const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findWebSocketUrl() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // chrome is still starting
    }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a DevTools endpoint');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket error')));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry == null) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { ready, send, close: () => socket.close() };
}

try {
  const cdp = connect(await findWebSocketUrl());
  await cdp.ready;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const call = (method, params) => cdp.send(method, params, sessionId);

  await call('Page.enable');
  const consoleErrors = [];
  await call('Runtime.enable');
  await call('Log.enable');

  await call('Page.navigate', { url });
  // Real elapsed time, so workers get to run.
  await sleep(Number(waitMs));

  const probe = await call('Runtime.evaluate', {
    expression: `(() => {
      const shadowText = [...document.querySelectorAll('*')]
        .filter((el) => el.shadowRoot)
        .map((el) => el.shadowRoot.textContent ?? '')
        .join(' ');
      return JSON.stringify({
        title: document.title,
        bodyText: (document.body.innerText || '').slice(0, 400),
        shadowHosts: [...document.querySelectorAll('*')].filter((el) => el.shadowRoot).length,
        shadowSample: shadowText.replace(/\\s+/g, ' ').slice(0, 400),
      });
    })()`,
    returnByValue: true,
  });

  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(probe.result.value);
  console.log(`screenshot: ${out}`);
  if (consoleErrors.length > 0) console.log('console errors:', consoleErrors);
  cdp.close();
} finally {
  chrome.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
}
