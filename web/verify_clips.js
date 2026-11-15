// Checks every demo clip in the manifest: footage loads and plays, the frame
// counter follows the video, and tracking data (when present) lists players.
// Usage: npm run build && npx vite preview --port 5173, then node verify_clips.js
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.APP_URL || 'http://localhost:5173/';
const SCREENSHOT = process.env.SCREENSHOT || '';

const manifest = JSON.parse(fs.readFileSync(new URL('./public/clips/clips.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;
function assert(name, condition, details = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}: ${name}${details ? ` (${details})` : ''}`);
  if (!condition) failed += 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#clip-picker button');
  const buttons = await page.$$eval('#clip-picker button', (els) => els.map((el) => el.dataset.clip));
  assert('clip picker lists every clip', buttons.length === manifest.clips.length, buttons.join(', '));

  for (const clip of manifest.clips.filter((c) => c.video)) {
    console.log(`\n[${clip.id}]`);
    await page.click(`#clip-picker button[data-clip="${clip.id}"]`);
    await page.waitForFunction(
      () => { const v = document.querySelector('video'); return v && v.readyState >= 2; },
      { timeout: 30000 }
    );
    const video = await page.$eval('video', (v) => ({ w: v.videoWidth, h: v.videoHeight, d: v.duration }));
    assert('footage decodes', video.w === clip.width && video.h === clip.height, `${video.w}x${video.h}`);
    assert('duration matches manifest', Math.abs(video.d - clip.frames / clip.fps) < 0.2,
      `${video.d.toFixed(2)}s vs ${(clip.frames / clip.fps).toFixed(2)}s`);

    await sleep(1500);
    const state = await page.evaluate(() => {
      const v = document.querySelector('video');
      const counter = document.querySelector('span.text-blue-400.font-bold')?.textContent ?? '';
      return { time: v.currentTime, paused: v.paused, counter: Number(counter.replace('F', '')) };
    });
    assert('autoplays', !state.paused && state.time > 0.5, `t=${state.time.toFixed(2)}s`);
    assert('frame counter follows video', Math.abs(state.counter - state.time * clip.fps) <= 3,
      `F${state.counter} at t=${state.time.toFixed(2)}s`);

    const tracked = (await page.$('#stream-notice')) === null;
    const rosterRows = await page.$$eval('div.w-72 button.w-full.flex', (els) => els.length);
    if (tracked) {
      assert('tracked clip lists players', rosterRows > 0, `${rosterRows} players`);
    } else {
      console.log('  INFO: no telemetry.json yet (tracking pending notice shown)');
    }
    assert('url reflects clip', page.url().includes(`clip=${clip.id}`));
    if (SCREENSHOT && clip === manifest.clips[0]) await page.screenshot({ path: SCREENSHOT });
  }

  assert('no uncaught exceptions', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
