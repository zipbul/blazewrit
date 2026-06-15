import { chromium } from 'playwright';

/** Headless screenshot of the running FE — lets the agent see and iterate on the UI. */
const url = process.argv[2] ?? 'http://localhost:4200/';
const out = process.argv[3] ?? '/tmp/bw-shot.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 900 } });
// NOTE: not 'networkidle' — the app holds an SSE stream open, so the network never idles.
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000); // let Angular render + signals/animations settle
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`shot -> ${out}`);
