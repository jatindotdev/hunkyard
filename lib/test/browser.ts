// A small Chrome DevTools Protocol client, so browser checks can be written as
// `bun test` cases rather than a script whose output someone reads.
//
// Bun's own DOM testing recommendation is happy-dom, and it is the right tool
// for a component in isolation, but not for this app: happy-dom has no layout
// engine, so getBoundingClientRect returns 0x0. The diff surface is virtualized
// and measures item heights, and selecting lines means dragging over a gutter at
// a coordinate. Both need a real browser. (Workers, by contrast, do run under
// happy-dom, since Bun provides real ones.)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Where Chrome is, in the order worth trying. CHROME_PATH wins, which is what
// CI sets. The runners ship google-chrome under /usr/bin.
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export async function findChrome(): Promise<string | null> {
  const configured = process.env.CHROME_PATH;
  if (configured != null && configured !== '') {
    return (await Bun.file(configured).exists()) ? configured : null;
  }
  for (const candidate of CANDIDATES) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

// Whether these tests can run at all. Skipping is better than failing on a
// machine with no Chrome, and better than pretending they passed -- except in
// CI, where a skip would quietly stop covering the UI, so there it is a failure.
export async function chromeAvailable(): Promise<boolean> {
  const found = await findChrome();
  if (found == null && process.env.CI === 'true') {
    throw new Error(
      'No Chrome found, and CI must not silently skip the browser tests. ' +
        'Set CHROME_PATH.'
    );
  }
  return found != null;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

// Chrome wants a key identifier, a code and a virtual key code; `text` alone is
// not enough for a listener reading `event.key`.
const NAMED_KEYS: Record<string, { code: string; keyCode: number; text?: string }> =
  {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Escape: { code: 'Escape', keyCode: 27 },
    // No text: these edit or move rather than produce a character, and sending
    // their name as text is rejected as an invalid parameter.
    Backspace: { code: 'Backspace', keyCode: 8 },
    Tab: { code: 'Tab', keyCode: 9 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    '?': { code: 'Slash', keyCode: 191, text: '?' },
  };
const MODIFIER_BITS: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};

export class Browser {
  private constructor(
    private readonly chrome: ChildProcess,
    private readonly socket: WebSocket,
    private readonly profile: string,
    private readonly sessionId: string,
    private readonly pending: Map<number, Pending>,
    private nextId: { value: number }
  ) {}

  static async launch(): Promise<Browser> {
    const port = 9222 + Math.floor(Math.random() * 500);
    const profile = mkdtempSync(join(tmpdir(), 'hunk-browser-'));
    const executable = await findChrome();
    if (executable == null) throw new Error('No Chrome found; set CHROME_PATH.');
    const chrome = spawn(
      executable,
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

    const wsUrl = await Browser.findWebSocket(port);
    const socket = new WebSocket(wsUrl);
    const pending = new Map<number, Pending>();
    const nextId = { value: 1 };
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('socket error')));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        error?: unknown;
        result?: unknown;
      };
      if (message.id == null) return;
      const entry = pending.get(message.id);
      if (entry == null) return;
      pending.delete(message.id);
      if (message.error != null) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });

    const send = (method: string, params: unknown = {}, sessionId?: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId.value++;
        pending.set(id, {
          resolve: (value) => resolve(value as Record<string, unknown>),
          reject,
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });

    const target = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = String(attached.sessionId);

    const browser = new Browser(chrome, socket, profile, sessionId, pending, nextId);
    await browser.call('Page.enable');
    await browser.call('Runtime.enable');
    return browser;
  }

  private static async findWebSocket(port: number): Promise<string> {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const info = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (info.webSocketDebuggerUrl != null) return info.webSocketDebuggerUrl;
      } catch {
        // chrome is still starting
      }
      await Bun.sleep(250);
    }
    throw new Error('Chrome did not expose a DevTools endpoint');
  }

  private call(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = this.nextId.value++;
      this.pending.set(id, {
        resolve: (value) => resolve(value as Record<string, unknown>),
        reject,
      });
      this.socket.send(
        JSON.stringify({ id, method, params, sessionId: this.sessionId })
      );
    });
  }

  // Waits in real elapsed time. `--virtual-time-budget` cannot be used here: it
  // advances the main thread's clock but not a worker's, and the viewer is gated
  // on the highlight pool reporting ready, so under virtual time the page
  // reaches ready before the pool exists and the diff never appears.
  async open(url: string, settleMs = 11_000): Promise<void> {
    await this.call('Page.navigate', { url });
    await Bun.sleep(settleMs);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (result.exceptionDetails != null) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'evaluate threw'
      );
    }
    return result.result?.value as T;
  }

  async press(spec: string): Promise<void> {
    const parts = spec.split('+');
    const key = parts.pop() as string;
    const modifiers = parts.reduce(
      (bits, name) => bits | (MODIFIER_BITS[name] ?? 0),
      0
    );
    const named = NAMED_KEYS[key];
    // `text` has to be the character the key produces, or nothing. Escape
    // produces none, and passing its name is rejected outright as an invalid
    // parameter. A modified chord produces none either, and sending one makes an
    // input swallow the shortcut as typing.
    const character = named != null ? named.text : key;
    const descriptor = {
      key,
      code: named?.code ?? `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: named?.keyCode ?? key.toUpperCase().charCodeAt(0),
      text: modifiers === 0 ? character : undefined,
      modifiers,
    };
    await this.call('Input.dispatchKeyEvent', { type: 'keyDown', ...descriptor });
    await this.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...descriptor,
      text: undefined,
    });
    await Bun.sleep(400);
  }

  // Selecting lines means a real drag: the diff lives in shadow DOM, so there is
  // nothing to click by selector.
  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    const mouse = (type: string, x: number, y: number) =>
      this.call('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
      });
    await mouse('mousePressed', from.x, from.y);
    await mouse('mouseMoved', to.x, to.y);
    await mouse('mouseReleased', to.x, to.y);
    await Bun.sleep(700);
  }

  async screenshot(path: string): Promise<void> {
    const shot = (await this.call('Page.captureScreenshot', { format: 'png' })) as {
      data: string;
    };
    await Bun.write(path, Buffer.from(shot.data, 'base64'));
  }

  async close(): Promise<void> {
    this.socket.close();
    this.chrome.kill('SIGKILL');
    rmSync(this.profile, { recursive: true, force: true });
  }
}
