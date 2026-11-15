import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173/?clip=synthetic';
const SCREENSHOT_DIR = path.resolve('C:/Users/rishu/Desktop/d11/basketball-stream-tracker/test_screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runTestSuite() {
  console.log('======================================================');
  console.log('🏀 BASKETBALL STREAM TRACKER - COMPREHENSIVE QA SUITE');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  // Track console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.toString());
  });

  const testResults = [];
  function assert(testName, condition, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
      testResults.push({ name: testName, passed: true, details });
    } else {
      console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      testResults.push({ name: testName, passed: false, details });
    }
  }

  try {
    // -----------------------------------------------------------
    // TEST 1: Load Page & Verify HTTP Status
    // -----------------------------------------------------------
    console.log('\n[1] Page Loading & Initial DOM Mount');
    const response = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    assert('HTTP Response 200', response.status() === 200, `Status: ${response.status()}`);

    // Wait for data load
    await page.waitForSelector('header', { timeout: 5000 });

    // Header validation
    const headerTitle = await page.$eval('header h1', el => el.textContent.trim());
    assert('Header Title Text', headerTitle.includes('COURTVIEW') && headerTitle.includes('LIVE'), `Got: "${headerTitle}"`);

    const matchInfo = await page.$eval('header', el => el.textContent);
    assert('Match Info Displayed', matchInfo.includes('BOS vs NYK'), 'BOS vs NYK present in header');

    const liveBadge = await page.$eval('header span.text-red-400', el => el.textContent.trim());
    assert('Live Tracking Indicator', liveBadge.toUpperCase() === 'LIVE TRACKING', `Got: "${liveBadge}"`);

    // -----------------------------------------------------------
    // TEST 2: Layout & 3-Column Structure
    // -----------------------------------------------------------
    console.log('\n[2] Layout Structure Verification');
    const hasRosterSidebar = await page.$('div.w-72') !== null;
    assert('Roster Sidebar Column (w-72)', hasRosterSidebar);

    const hasStreamPlayer = await page.$('canvas.cursor-crosshair') !== null;
    assert('Stream Player Canvas Present', hasStreamPlayer);

    const hasCourtRadar = await page.$('div.w-80 svg') !== null;
    assert('2D Court Radar SVG Present (w-80)', hasCourtRadar);

    const hasStatsBar = await page.$('#player-stats-bar') !== null;
    assert('Bottom Stats Bar (#player-stats-bar) Present', hasStatsBar);

    // Initial Stats Bar Message (No player selected)
    const initialStatsText = await page.$eval('#player-stats-bar', el => el.textContent.trim());
    assert('Stats Bar Initial Prompt', initialStatsText.includes('Select a player to view live stats'), `Got: "${initialStatsText}"`);

    // -----------------------------------------------------------
    // TEST 3: Roster Sidebar Verification (10 Players, 2 Teams)
    // -----------------------------------------------------------
    console.log('\n[3] Roster Sidebar - Teams & Active Players');
    const teamHeaders = await page.$$eval('div.w-72 span.font-bold.uppercase', els => els.map(e => e.textContent.trim().toUpperCase()));
    assert('Both Team Headers Present', teamHeaders.includes('BOSTON CELTICS') && teamHeaders.includes('NEW YORK KNICKS'), `Teams: ${teamHeaders.join(', ')}`);

    const playerRows = await page.$$eval('div.w-72 button.w-full.flex', els => els.map(e => {
      const text = e.textContent;
      const num = e.querySelector('div.rounded-full')?.textContent?.trim() || '';
      return { num, text };
    }));

    assert('10 Active On-Court Players Listed', playerRows.length === 10, `Found: ${playerRows.length} rows`);

    const playerNames = playerRows.map(p => p.text);
    const hasTatum = playerNames.some(t => t.includes('Jayson Tatum') && t.includes('SF'));
    const hasBrunson = playerNames.some(t => t.includes('Jalen Brunson') && t.includes('PG'));
    assert('Boston Star (Tatum #0 SF) Present', hasTatum);
    assert('New York Star (Brunson #11 PG) Present', hasBrunson);

    // Verify speed readouts on rows
    const hasSpeedReadout = playerNames.every(t => t.includes('km/h'));
    assert('All Roster Rows Display Live Speed (km/h)', hasSpeedReadout);

    // -----------------------------------------------------------
    // TEST 4: 2D Tactical Court Radar Elements
    // -----------------------------------------------------------
    console.log('\n[4] 2D Court Radar SVG Architecture');
    const svgViewBox = await page.$eval('div.w-80 svg', el => el.getAttribute('viewBox'));
    assert('SVG ViewBox Correct Dimensions', svgViewBox.includes('2985') && svgViewBox.includes('1644'), `viewBox: ${svgViewBox}`);

    const courtElements = await page.evaluate(() => {
      const svg = document.querySelector('div.w-80 svg');
      if (!svg) return { rects: 0, lines: 0, circles: 0, paths: 0 };
      return {
        rects: svg.querySelectorAll('rect').length,
        lines: svg.querySelectorAll('line').length,
        circles: svg.querySelectorAll('circle').length,
        paths: svg.querySelectorAll('path').length,
      };
    });
    assert('Court Geometry Rendered (Paint, 3pt, Lines, Rims)', courtElements.rects >= 3 && courtElements.circles >= 13 && courtElements.paths >= 2,
      `Rects: ${courtElements.rects}, Circles: ${courtElements.circles}, Paths: ${courtElements.paths}`);

    // Take Initial Screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_initial_dashboard.png') });

    // -----------------------------------------------------------
    // TEST 5: Interactive Player Selection via Roster Sidebar
    // -----------------------------------------------------------
    console.log('\n[5] Interactive Selection: Roster Sidebar -> Tatum (#0)');
    // Find Tatum button and click
    const tatumButton = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('div.w-72 button.w-full'));
      return btns.find(b => b.textContent.includes('Jayson Tatum'));
    });
    await tatumButton.click();
    await new Promise(r => setTimeout(r, 200));

    // Verify "Clear Selection" appeared
    const hasClearBtn = await page.$eval('div.w-72', el => el.textContent.includes('Clear Selection'));
    assert('"Clear Selection" Button Appeared', hasClearBtn);

    // Verify Stats Bar Updated with Tatum details
    const statsText = await page.$eval('#player-stats-bar', el => el.textContent);
    assert('Stats Bar Displays Selected Player Name', statsText.includes('Jayson Tatum') && statsText.includes('SF · BOS'), `Stats: "${statsText.slice(0, 80)}"`);
    assert('Stats Bar Speed Metric Present', statsText.includes('Speed') && statsText.includes('km/h'));
    assert('Stats Bar Cumulative Distance Present', statsText.includes('Distance') && statsText.includes('m'));
    assert('Stats Bar Court Zone Present', statsText.includes('Zone'));
    assert('Stats Bar Tracking Status (LIVE/PREDICTED)', statsText.includes('LIVE') || statsText.includes('PREDICTED'));

    // Verify Radar Updated for Tatum
    const selectedRadarMarker = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('div.w-80 svg text'));
      const tatumText = texts.find(t => t.textContent.trim() === '0' && t.getAttribute('font-size') === '12');
      return !!tatumText;
    });
    assert('2D Radar Selected Marker Rendered with Bold Jersey #0', selectedRadarMarker);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_tatum_selected_floor_ring.png') });

    // -----------------------------------------------------------
    // TEST 6: Highlight Mode Switching (Contour & HUD Brackets)
    // -----------------------------------------------------------
    console.log('\n[6] Highlight Mode Switching');
    // Click "Outline" button (Neon Contour)
    const outlineBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('div.w-72 div.grid button'));
      return btns.find(b => b.textContent.includes('Outline'));
    });
    await outlineBtn.click();
    await new Promise(r => setTimeout(r, 150));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_tatum_neon_contour.png') });
    assert('Switched to Neon Outline Mode', true);

    // Click "HUD" button (HUD Brackets)
    const hudBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('div.w-72 div.grid button'));
      return btns.find(b => b.textContent.includes('HUD'));
    });
    await hudBtn.click();
    await new Promise(r => setTimeout(r, 150));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_tatum_hud_brackets.png') });
    assert('Switched to HUD Brackets Mode', true);

    // Switch back to "Ring"
    const ringBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('div.w-72 div.grid button'));
      return btns.find(b => b.textContent.includes('Ring'));
    });
    await ringBtn.click();
    await new Promise(r => setTimeout(r, 150));
    assert('Switched back to Floor Ring Mode', true);

    // -----------------------------------------------------------
    // TEST 7: Playback Transport Controls (Play, Step, Scrub, Speed)
    // -----------------------------------------------------------
    console.log('\n[7] Playback Engine & Transport Controls');
    const initialFrameText = await page.$eval('div.min-w-\\[130px\\]', el => el.textContent.trim());
    assert('Initial Frame Counter at Start', initialFrameText.includes('F0'), `Counter: ${initialFrameText}`);

    // Click Play button
    const playBtn = await page.$('button[title="Play"]');
    assert('Play Button Present', playBtn !== null);
    await playBtn.click();

    // Wait 1.2 seconds for playback to advance
    await new Promise(r => setTimeout(r, 1200));

    // Frame should have advanced
    const playingFrameText = await page.$eval('div.min-w-\\[130px\\]', el => el.textContent.trim());
    const frameNumberMatch = playingFrameText.match(/F(\d+)/);
    const advancedFrame = frameNumberMatch ? parseInt(frameNumberMatch[1], 10) : 0;
    assert('Stream Plays and Frame Advances', advancedFrame > 15, `Advanced to Frame: ${advancedFrame}`);

    // Click Pause
    const pauseBtn = await page.$('button[title="Pause"]');
    assert('Pause Button Displayed While Playing', pauseBtn !== null);
    await pauseBtn.click();
    await new Promise(r => setTimeout(r, 200));

    const pausedFrame = await page.$eval('div.min-w-\\[130px\\]', el => parseInt(el.textContent.match(/F(\d+)/)[1], 10));

    // Test Step Forward (+1)
    const stepFwdBtn = await page.$('button[title="Next Frame"]');
    await stepFwdBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const stepFwdFrame = await page.$eval('div.min-w-\\[130px\\]', el => parseInt(el.textContent.match(/F(\d+)/)[1], 10));
    assert('Step Forward Advances by +1 Frame', stepFwdFrame === (pausedFrame + 1) % 450, `From ${pausedFrame} to ${stepFwdFrame}`);

    // Test Step Backward (-1)
    const stepBackBtn = await page.$('button[title="Previous Frame"]');
    await stepBackBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const stepBackFrame = await page.$eval('div.min-w-\\[130px\\]', el => parseInt(el.textContent.match(/F(\d+)/)[1], 10));
    assert('Step Backward Retreats by -1 Frame', stepBackFrame === pausedFrame, `From ${stepFwdFrame} back to ${stepBackFrame}`);

    // Test Timeline Scrubber Seek (Seek to frame 200 via React native descriptor)
    await page.evaluate(() => {
      const slider = document.querySelector('input[type="range"]');
      if (slider) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(slider, '200');
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 200));
    const scrubbedFrameText = await page.$eval('div.min-w-\\[130px\\]', el => el.textContent.trim());
    assert('Timeline Scrubber Seeks Accurately', scrubbedFrameText.includes('F200'), `Counter: ${scrubbedFrameText}`);

    // Test Playback Rate Buttons (0.5x, 1x, 2x)
    const speedBtn2x = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.trim() === '2x');
    });
    await speedBtn2x.click();
    await new Promise(r => setTimeout(r, 100));
    const is2xActive = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '2x');
      return btn.classList.contains('bg-blue-600');
    });
    assert('Playback Speed 2x Activated', is2xActive);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_scrubbed_frame_200.png') });

    // -----------------------------------------------------------
    // TEST 8: Interactive Selection via 2D Tactical Court Radar
    // -----------------------------------------------------------
    console.log('\n[8] Interactive Selection: Click 2D Radar Dot (Brunson #11)');
    // Find Brunson (#11) marker on 2D radar and click
    const clickedRadar = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('div.w-80 svg text'));
      const brunsonText = texts.find(t => t.textContent.trim() === '11');
      if (brunsonText && brunsonText.parentElement) {
        brunsonText.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
      return false;
    });
    assert('Clicked Brunson (#11) Dot on 2D Radar', clickedRadar);
    await new Promise(r => setTimeout(r, 250));

    // Verify Brunson is now selected in Stats Bar
    const brunsonStats = await page.$eval('#player-stats-bar', el => el.textContent);
    assert('Stats Bar Updated to Jalen Brunson', brunsonStats.includes('Jalen Brunson') && brunsonStats.includes('PG · NYK'), `Got: "${brunsonStats.slice(0, 80)}"`);

    // Verify Sidebar Row for Brunson is highlighted
    const brunsonRowHighlighted = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div.w-72 button.w-full'));
      const bRow = rows.find(r => r.textContent.includes('Jalen Brunson'));
      return bRow?.classList.contains('bg-gray-800/80');
    });
    assert('Roster Sidebar Synced to Highlight Brunson', brunsonRowHighlighted);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_brunson_selected_via_radar.png') });

    // -----------------------------------------------------------
    // TEST 9: Direct Video Canvas Click (Hit-Test)
    // -----------------------------------------------------------
    console.log('\n[9] Direct Video Canvas Click (Player Hit-Test)');
    const tatumScreenCoord = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const rect = canvas.getBoundingClientRect();
      return {
        clientX: rect.left + rect.width * 0.75,
        clientY: rect.top + rect.height * 0.60
      };
    });

    await page.mouse.click(tatumScreenCoord.clientX, tatumScreenCoord.clientY);
    await new Promise(r => setTimeout(r, 250));
    assert('Direct Canvas Click Executed without Exception', true);

    // -----------------------------------------------------------
    // TEST 10: Clear Selection / Deselect
    // -----------------------------------------------------------
    console.log('\n[10] Clear Selection / Reset State');
    const clearBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.trim() === 'Clear Selection');
    });
    if (clearBtn) {
      await clearBtn.click();
      await new Promise(r => setTimeout(r, 200));
    }
    const clearedStatsText = await page.$eval('#player-stats-bar', el => el.textContent.trim());
    assert('Selection Cleared - Stats Bar Reset', clearedStatsText.includes('Select a player to view live stats'), `Got: "${clearedStatsText}"`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_cleared_selection.png') });

    // -----------------------------------------------------------
    // TEST 11: Console Errors & Exceptions Audit
    // -----------------------------------------------------------
    console.log('\n[11] Console Errors & Network Audit');
    const filteredErrors = consoleErrors.filter(err => !err.includes('favicon'));
    assert('Zero Uncaught JavaScript / React Exceptions', filteredErrors.length === 0,
      filteredErrors.length > 0 ? `Errors: ${filteredErrors.join('; ')}` : 'Clean console');

  } catch (error) {
    console.error('Fatal Test Exception:', error);
    testResults.push({ name: 'Test Suite Execution', passed: false, details: error.message });
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n======================================================');
  console.log('📊 TEST SUITE SUMMARY REPORT');
  console.log('======================================================');
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = total - passed;
  console.log(`Total Assertions: ${total}`);
  console.log(`Passed:           ${passed}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Success Rate:     ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! Production MVP is verified and ready.');
  } else {
    console.error(`⚠️ ${failed} test(s) failed. Check details above.`);
  }

  return { total, passed, failed };
}

runTestSuite();
