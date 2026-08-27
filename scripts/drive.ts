#!/usr/bin/env bun
// Ad-hoc driving of the app in a real browser, for looking at something rather
// than asserting it. The assertions live in lib/test/ui.integration.test.ts and
// run under `bun test`; this shares their client so there is one implementation.
//
//   bun scripts/drive.ts http://hunkyard.localhost:4865/local eval:location.href
//
// Steps: eval:<expr>, key:<key>, drag:x1,y1,x2,y2, wait:<ms>, shot:<path>
import { Browser, findChrome } from '@/test/browser';

const [url, ...steps] = process.argv.slice(2);
if (url == null) {
  console.error('usage: drive.ts <url> [step...]');
  process.exit(2);
}
if ((await findChrome()) == null) {
  console.error('No Chrome found; set CHROME_PATH.');
  process.exit(1);
}

const browser = await Browser.launch();
try {
  await browser.open(url);
  for (const step of steps) {
    const separator = step.indexOf(':');
    const name = separator === -1 ? step : step.slice(0, separator);
    const arg = separator === -1 ? '' : step.slice(separator + 1);

    if (name === 'eval') {
      console.log(`${arg} => ${JSON.stringify(await browser.evaluate(arg))}`);
    } else if (name === 'key') {
      await browser.press(arg);
      console.log(`key: ${arg}`);
    } else if (name === 'drag') {
      const [x1, y1, x2, y2] = arg.split(',').map(Number);
      await browser.drag({ x: x1 ?? 0, y: y1 ?? 0 }, { x: x2 ?? 0, y: y2 ?? 0 });
      console.log(`drag: ${arg}`);
    } else if (name === 'wait') {
      await Bun.sleep(Number(arg));
    } else if (name === 'shot') {
      await browser.screenshot(arg);
      console.log(`screenshot: ${arg}`);
    } else {
      throw new Error(`unknown step: ${step}`);
    }
  }
} finally {
  await browser.close();
}
