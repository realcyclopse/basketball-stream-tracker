import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testUploadModal() {
  console.log('Testing Phase 2 Upload Modal...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });

  // 1. Check Upload Clip button exists
  const uploadBtn = await page.$('#upload-clip-btn');
  if (!uploadBtn) throw new Error('#upload-clip-btn not found in header');
  console.log('✅ PASS: Upload Clip button present in header');

  // 2. Click Upload button
  await uploadBtn.click();
  await new Promise(r => setTimeout(r, 400));

  // 3. Verify modal opened
  const modalTitle = await page.evaluate(() => {
    return document.querySelector('#upload-modal-title')?.innerText;
  });
  if (!modalTitle || !modalTitle.includes('Analyze New Broadcast Clip')) {
    throw new Error('Upload modal did not open. Got title: ' + modalTitle);
  }
  console.log('✅ PASS: Upload Modal opened with title:', modalTitle);

  // 4. Verify settings inside modal
  const hasByteTrack = await page.evaluate(() => document.body.innerText.includes('ByteTrack'));
  const hasSam2 = await page.evaluate(() => document.body.innerText.includes('SAM 2'));
  const hasPresets = await page.evaluate(() => document.body.innerText.includes('BOS vs NYK'));
  const hasModalUrl = await page.evaluate(() => document.body.innerText.includes('Modal.com Endpoint URL'));

  if (!hasByteTrack || !hasSam2) throw new Error('Tracking engine options missing');
  if (!hasPresets) throw new Error('Team presets missing');
  if (!hasModalUrl) throw new Error('Modal URL config missing');

  console.log('✅ PASS: All Phase 2 controls verified (ByteTrack, SAM 2, Team presets, Modal URL)');

  // 5. Test close button
  const closeBtn = await page.$('button svg.lucide-x');
  if (closeBtn) {
    const parentBtn = await page.evaluateHandle(el => el.closest('button'), closeBtn);
    await parentBtn.asElement().click();
    await new Promise(r => setTimeout(r, 300));
    const isClosed = await page.evaluate(() => !document.querySelector('#upload-modal-title'));
    if (!isClosed) throw new Error('Modal did not close on X click');
    console.log('✅ PASS: Modal closes cleanly');
  }

  await browser.close();
  console.log('🎉 ALL UPLOAD MODAL CHECKS PASSED!');
}

testUploadModal().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
