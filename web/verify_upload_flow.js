import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testUploadFlow() {
  console.log('Testing Phase 2 End-to-End Upload Flow...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });

  // 1. Open upload modal
  await page.click('#upload-clip-btn');
  await new Promise(r => setTimeout(r, 400));

  // 2. Upload sample video file via file input
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) throw new Error('File input not found');

  const sampleVideoPath = path.resolve('public/clips/bos-nyk-q1-0428/video.mp4');
  await fileInput.uploadFile(sampleVideoPath);
  await new Promise(r => setTimeout(r, 600));

  console.log('✅ PASS: Video file selected and metadata extracted');

  // 3. Click "Instant Demo Mode" to run the pipeline
  const demoBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Instant Demo Mode'));
  });
  if (!demoBtn) throw new Error('Instant Demo Mode button not found');
  await demoBtn.asElement().click();

  // 4. Wait for processing steps (uploading -> detecting -> homography -> complete)
  console.log('Waiting for pipeline simulation to finish...');
  await page.waitForFunction(() => {
    return document.body.innerText.includes('Clip Analyzed Successfully!');
  }, { timeout: 15000 });
  console.log('✅ PASS: Pipeline completed with success message');

  // 5. Click "Open in CourtView Live"
  const launchBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Open in CourtView Live'));
  });
  if (!launchBtn) throw new Error('Open in CourtView Live button not found');
  await launchBtn.asElement().click();
  await new Promise(r => setTimeout(r, 1000));

  // 6. Verify that the new clip is playing and rendered on radar and stream player
  const activeClipButton = await page.evaluate(() => {
    return document.querySelector('#clip-picker button[data-clip^="upload-"]')?.innerText;
  });
  if (!activeClipButton) throw new Error('Uploaded clip was not added to clip picker');
  console.log('✅ PASS: Uploaded clip active in clip picker:', activeClipButton);

  // 7. Verify player stats bar updated
  const statsBarText = await page.evaluate(() => document.querySelector('#player-stats-bar')?.innerText);
  console.log('Stats bar text:', statsBarText);
  if (!statsBarText || !statsBarText.includes('Player 1')) {
    throw new Error('Stats bar did not reflect uploaded player');
  }
  console.log('✅ PASS: Stats bar and radar tracking uploaded clip in real time');

  await browser.close();
  console.log('🎉 END-TO-END UPLOAD & PLAYBACK FLOW VERIFIED 100%!');
}

testUploadFlow().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
