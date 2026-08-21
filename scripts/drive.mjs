#!/usr/bin/env node
// Drives the app in headless Chrome over the DevTools Protocol and reports what
// actually happened, as a list of steps:
//
//   node scripts/drive.mjs nav:http://hunkyard.localhost:4865/local/worktree \
//     wait:9000 shot:/tmp/a.png key:j probe
//
// Steps:
//   nav:<url>        navigate, then settle (see `wait`)
//   reload           reload the page, then settle
//   wait:<ms>        sleep in real time
//   click:<text>     click the first button/tab whose text starts with <text>
//   key:<key>        dispatch a real keydown/keyup (e.g. j, Escape, Meta+Enter)
//   eval:<expr>      evaluate an expression and print the result
//   probe            print title, body text, shadow-DOM sample
//   shot:<path>      write a PNG
//
// Waits are real elapsed time, never `--virtual-time-budget`: that advances the
// main thread's clock but not a worker's, and the viewer is gated on the
// highlight pool reporting `initialized`. A local diff arrives in milliseconds,
// so under virtual time the page reaches `ready` before the pool boots and the
// viewer never appears -- an artifact that looks exactly like a broken viewer.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_SETTLE_MS = 9000;

const steps = process.argv.slice(2);
if (steps.length === 0) {
  console.error('usage: drive.mjs <step> [step...]   (see header for steps)');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'drive-'));
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

async function findWebSocketUrl() {
  for (let attempt = 0; attempt < 80; attempt++) {
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
  const listeners = [];
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket error')));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id == null) {
      for (const listener of listeners) listener(message.method, message.params);
      return;
    }
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
  return { ready, send, onEvent: (l) => listeners.push(l), close: () => socket.close() };
}

// Chrome wants a key identifier, a code and a windowsVirtualKeyCode; a plain
// `text` is not enough for a listener reading `event.key`.
const NAMED_KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9, text: '\t' },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  '?': { code: 'Slash', keyCode: 191, text: '?' },
};
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function describeKey(spec) {
  const parts = spec.split('+');
  const key = parts.pop();
  const modifiers = parts.reduce((bits, name) => bits | (MODIFIER_BITS[name] ?? 0), 0);
  const named = NAMED_KEYS[key];
  if (named != null) {
    return {
      key,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      text: named.text,
      modifiers,
    };
  }
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    // A modified chord produces no character, and sending one makes an input
    // swallow the shortcut as typing.
    text: modifiers === 0 ? key : undefined,
    modifiers,
  };
}

const PROBE = `(() => {
  const shadowHosts = [...document.querySelectorAll('*')].filter((el) => el.shadowRoot);
  return JSON.stringify({
    title: document.title,
    bodyText: (document.body.innerText || '').slice(0, 700),
    shadowHosts: shadowHosts.length,
    shadowSample: shadowHosts
      .map((el) => el.shadowRoot.textContent ?? '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .slice(0, 400),
  });
})()`;

// Much of the chrome is icon-only, so a title or aria-label is often the only
// text a control has.
const clickExpression = (text) => `(() => {
  const needle = ${JSON.stringify(text)};
  const label = (el) =>
    (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim();
  const el = [...document.querySelectorAll('button,[role=button],[role=tab],label')]
    .find((e) => label(e).startsWith(needle));
  if (el == null) return 'not found: ' + needle;
  el.click();
  return 'clicked: ' + label(el).slice(0, 50);
})()`;

try {
  const cdp = connect(await findWebSocketUrl());
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => cdp.send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');

  const consoleErrors = [];
  cdp.onEvent((method, params) => {
    if (
      method === 'Runtime.consoleAPICalled' &&
      ['error', 'warning'].includes(params.type)
    ) {
      consoleErrors.push(
        `[console.${params.type}] ` +
          params.args.map((a) => a.description ?? a.value ?? a.type).join(' ')
      );
    }
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      consoleErrors.push(
        `[uncaught] ${d.exception?.description ?? d.text} (${d.url ?? '?'}:${d.lineNumber ?? '?'})`
      );
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      consoleErrors.push(`[log] ${params.entry.text} ${params.entry.url ?? ''}`);
    }
  });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails != null) {
      return `threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`;
    }
    return result.result.value;
  };

  let settleMs = DEFAULT_SETTLE_MS;
  for (const step of steps) {
    const separator = step.indexOf(':');
    const name = separator === -1 ? step : step.slice(0, separator);
    const arg = separator === -1 ? '' : step.slice(separator + 1);

    if (name === 'nav') {
      await call('Page.navigate', { url: arg });
      await sleep(settleMs);
    } else if (name === 'reload') {
      await call('Page.reload');
      await sleep(settleMs);
    } else if (name === 'settle') {
      settleMs = Number(arg);
    } else if (name === 'wait') {
      await sleep(Number(arg));
    } else if (name === 'click') {
      console.log(await evaluate(clickExpression(arg)));
      await sleep(1200);
    } else if (name === 'key') {
      const key = describeKey(arg);
      await call('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...key, text: undefined });
      console.log(`key: ${arg}`);
      await sleep(600);
    } else if (name === 'eval') {
      console.log(`eval ${arg} => ${JSON.stringify(await evaluate(arg))}`);
    } else if (name === 'probe') {
      console.log(await evaluate(PROBE));
    } else if (name === 'shot') {
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(arg, Buffer.from(data, 'base64'));
      console.log(`screenshot: ${arg}`);
    } else {
      throw new Error(`unknown step: ${step}`);
    }
  }

  if (consoleErrors.length > 0) console.log('console errors:', consoleErrors);
  cdp.close();
} finally {
  chrome.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
}
