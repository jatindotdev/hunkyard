// Screenshots after clicking an element, so tabbed UI can be verified.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, clickText, waitMs = '10000'] = process.argv.slice(2);
const port = 9800 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), 'click-'));
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars','--window-size=1600,1000',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 80 && !ws; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); ws = (await r.json()).webSocketDebuggerUrl; } catch {} if (!ws) await sleep(250); }
const sock = new WebSocket(ws); const pending = new Map(); let id = 1;
await new Promise((res, rej) => { sock.addEventListener('open', res); sock.addEventListener('error', rej); });
sock.addEventListener('message', e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const raw = (method, params={}, sessionId) => new Promise((resolve, reject) => { const i = id++; pending.set(i, { resolve, reject }); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
const call = (m, p) => raw(m, p, sessionId);
await call('Page.enable'); await call('Runtime.enable');
await call('Page.navigate', { url });
await sleep(Number(waitMs));
if (clickText) {
  const r = await call('Runtime.evaluate', { expression: `(() => {
    const el = [...document.querySelectorAll('button,[role=button],[role=tab]')]
      .find(e => (e.textContent||'').trim().startsWith(${JSON.stringify(clickText)}));
    if (el == null) return 'not found';
    el.click();
    return 'clicked: ' + (el.textContent||'').trim().slice(0,40);
  })()`, returnByValue: true });
  console.log(r.result.value);
  await sleep(1200);
}
const probe = await call('Runtime.evaluate', { expression: `(document.body.innerText||'').slice(0,600)`, returnByValue: true });
console.log('---\n' + probe.result.value);
const { data } = await call('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
sock.close(); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true });
