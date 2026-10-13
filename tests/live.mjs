import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { By, Key } from "selenium-webdriver";
import { browserType, createDriver, extensionUrl } from "./helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(root, "artifacts", browserType === "chromium" ? "chromium-tests" : ".");
await mkdir(artifactDirectory, { recursive: true });
const extensionDirectory = resolve(root, "artifacts/youtube-focus-chromium");
const driver = await createDriver({ extensionDirectory });
let passed = 0;
try {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (browserType === "firefox") await driver.installAddon(resolve(root, `artifacts/youtube-focus-${manifest.version}.zip`), true);
  const popupUrl = await extensionUrl(driver, extensionDirectory);
  const videoTab = await driver.getWindowHandle();
  await driver.get("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  const js = (code, ...args) => driver.executeScript(code, ...args);
  const until = (code, label, timeout = 15000) => driver.wait(() => js(code), timeout, label, 150);
  const pass = label => { passed++; console.log(`PASS ${label}`); };
  const waitForLayoutEnd = async () => {
    let last;
    let stable = 0;
    await driver.wait(async () => {
      const current = await js("return JSON.stringify(['movie_player','yf-title','yf-recommendations'].map(id=>{const b=document.getElementById(id).getBoundingClientRect(); return [b.top+scrollY,b.width,b.height]}))");
      stable = current === last ? stable + 1 : 0;
      last = current;
      return stable >= 3;
    }, 7000, "YouTube layout did not settle", 150);
  };
  async function clickPlayerControl(selector) {
    await driver.actions().move({ origin: await driver.findElement(By.id("movie_player")) }).perform();
    await driver.wait(async () => (await driver.findElement(By.css(selector))).isDisplayed(), 5000, `Player control ${selector} is hidden`);
    await driver.findElement(By.css(selector)).click();
  }
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "Live YouTube layout did not initialize", 25000);
  await until("return !!document.querySelector('#yf-title #title, #yf-title h1')", "Live title did not move below the player", 25000);
  await until("return document.querySelectorAll('#yf-recommendations yt-lockup-view-model').length > 0", "Live recommendations did not load");
  // Fresh test profiles may receive YouTube's consent modal. Reject optional
  // cookies through its real control rather than removing overlays or bypassing checks.
  const rejectConsent = await driver.findElements(By.xpath("//button[normalize-space(.)='Reject all']"));
  if (rejectConsent.length && await rejectConsent[0].isDisplayed()) {
    await rejectConsent[0].click();
    await until("return !document.querySelector('tp-yt-iron-overlay-backdrop[opened]')", "YouTube consent dialog remained open");
  }
  const movedTitle = await js("return document.querySelector('#yf-title')?.textContent?.trim() || ''");
  assert.ok(movedTitle.length > 0 && (await js("return document.title")).includes(movedTitle), "the moved title should match the page title");
  await js("window.testOriginalPlayer = document.getElementById('movie_player'); document.querySelector('video').muted = true");
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  assert.equal(await js("return document.getElementById('yf-recommendations-title') === null"), true);
  await writeFile(resolve(artifactDirectory, "youtube-layout.png"), await driver.takeScreenshot(), "base64");
  pass(`actual YouTube watch page puts the title and headingless recommendation grid below the player in ${browserType}`);

  const titleBox = await js("const t=document.getElementById('yf-title').getBoundingClientRect(); const p=document.getElementById('player').getBoundingClientRect(); const r=document.getElementById('yf-recommendations').getBoundingClientRect(); return {title:t.toJSON(), player:p.toJSON(), grid:r.toJSON()}");
  assert.ok(titleBox.title.top >= titleBox.player.bottom - 1);
  assert.ok(Math.abs(titleBox.title.left - titleBox.player.left) < 2);
  assert.ok(titleBox.grid.top >= titleBox.title.bottom - 1);
  pass("the live video title sits below the player with the recommendation grid below it");

  const card = await js("const c=document.querySelector('#yf-recommendations yt-lockup-view-model'); return [c.querySelector('.ytLockupViewModelContentImage'), c.querySelector('.ytLockupViewModelMetadata')].map(n=>n.getBoundingClientRect().toJSON())");
  assert.ok(card[1].top >= card[0].bottom - 1);
  assert.ok(Math.abs(card[0].width - card[1].width) < 2);
  pass("current YouTube card thumbnails occupy the full grid-card width");

  // YouTube may start playback after consent; don't pause it while testing start.
  if (await js("return document.querySelector('video').paused")) {
    await driver.findElement(By.css(".ytp-play-button")).click();
  }
  await until("return !document.querySelector('video').paused && document.querySelector('video').currentTime > 0.1", "Native playback did not start");
  await driver.findElement(By.css(".ytp-play-button")).click();
  assert.equal(await js("return document.getElementById('movie_player') === window.testOriginalPlayer"), true);
  pass("native player starts and pauses without being recreated");

  const leftColumnPosition = () => js("return ['yf-title','yf-recommendations'].map(id=>document.getElementById(id).getBoundingClientRect().top+scrollY)");
  const [titleTop, gridTop] = await leftColumnPosition();
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await until("return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length > 0", "Live comments did not load", 20000);
  const openedPosition = await leftColumnPosition();
  assert.ok(Math.abs(openedPosition[0] - titleTop) < 2);
  assert.ok(Math.abs(openedPosition[1] - gridTop) < 2);
  assert.ok(await js("return document.getElementById('yf-recommendations').getBoundingClientRect().right < document.getElementById('secondary').getBoundingClientRect().left"));
  await writeFile(resolve(artifactDirectory, "youtube-comments.png"), await driver.takeScreenshot(), "base64");
  pass("real comments and reply controls load on demand without pushing the title or grid down");

  const commentBodySelector = "#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content";
  const commentBody = await driver.findElement(By.css(commentBodySelector));
  await js("document.querySelector(arguments[0]).scrollIntoView({block:'start'})", commentBodySelector);
  const readCommentPosition = () => js("const body=document.querySelector(arguments[0]); const last=[...body.querySelectorAll('ytd-comment-thread-renderer')].at(-1); return {top:body.scrollTop,height:body.clientHeight,page:scrollY,overflow:getComputedStyle(body).overflowY,bottom:body.getBoundingClientRect().bottom,lastBottom:last.getBoundingClientRect().bottom}", commentBodySelector);
  const beforeWheel = await readCommentPosition();
  assert.equal(beforeWheel.overflow, "visible");
  assert.ok(beforeWheel.lastBottom <= beforeWheel.bottom + 1, "the loaded comments should fit inside the expanded body");
  await driver.actions().scroll(0, 0, 0, 300, commentBody).perform();
  await driver.wait(async () => (await readCommentPosition()).page > beforeWheel.page, 5000, "Mouse wheel did not scroll the page over real comments", 100);
  const afterWheel = await readCommentPosition();
  assert.equal(afterWheel.top, 0);
  await js("document.querySelector(arguments[0]).focus({preventScroll:true})", commentBodySelector);
  await driver.actions().sendKeys(Key.PAGE_DOWN).perform();
  await driver.wait(async () => (await readCommentPosition()).page > afterWheel.page, 5000, "PageDown did not scroll the page over real comments", 100);
  assert.equal((await readCommentPosition()).top, 0);
  pass("wheel and keyboard scroll the page over expanded native comments");

  const loadedThreads = await js("return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length");
  const continuedHeight = (await readCommentPosition()).height;
  await js("const body=document.querySelector(arguments[0]); const continuation=[...body.querySelectorAll('ytd-continuation-item-renderer')].filter(node=>node.getBoundingClientRect().height>0).at(-1) || body.lastElementChild; continuation.scrollIntoView({block:'end'})", commentBodySelector);
  await until(`return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length > ${loadedThreads}`, "Additional comments did not load while scrolling", 20000);
  assert.ok((await readCommentPosition()).height > continuedHeight);
  assert.equal((await readCommentPosition()).top, 0);
  pass("page scrolling loads native comment continuations and grows the body");

  await js("window.scrollTo(0,0)");
  const expandDescription = await driver.findElements(By.css("#yf-details #description #expand"));
  if (expandDescription.length) {
    await expandDescription[0].click();
    await until("return document.querySelector('#yf-details #description #collapse')?.hidden === false", "Description did not expand");
    await js("document.querySelector(arguments[0]).scrollIntoView({block:'start'})", commentBodySelector);
    const expandedStart = await readCommentPosition();
    assert.ok(expandedStart.height > 40);
    await driver.actions().scroll(0, 0, 0, 300, commentBody).perform();
    await driver.wait(async () => (await readCommentPosition()).page > expandedStart.page, 5000, "The page did not scroll over comments with an expanded description", 100);
    const expandedEnd = await readCommentPosition();
    assert.equal(expandedEnd.top, 0);
    assert.equal(expandedEnd.overflow, "visible");
    await js("window.scrollTo(0,0)");
    await driver.findElement(By.css("#yf-details #description #collapse")).click();
    pass("expanded descriptions leave comments uncapped and page-scrollable");
  }

  const nativeClose = await driver.findElements(By.css("#yf-comments-panel #visibility-button button, #yf-comments-panel button[aria-label='Close']"));
  if (nativeClose.length) {
    await nativeClose[0].click();
    await until("return document.getElementById('yf-comments-panel').hidden", "Native comments close button did not synchronize");
    pass("YouTube's native comments close control stays synchronized");
  } else {
    await driver.findElement(By.id("yf-comments-toggle")).click();
  }

  await clickPlayerControl(".ytp-size-button");
  await until("return document.querySelector('ytd-watch-flexy').hasAttribute('theater')", "Native theatre mode did not activate");
  await waitForLayoutEnd();
  assert.equal(await js("return getComputedStyle(document.getElementById('primary')).display"), "none");
  assert.ok(await driver.findElement(By.css("#movie_player")).isDisplayed());
  const theaterBoxes = await js("const t=document.getElementById('yf-title').getBoundingClientRect(); const g=document.getElementById('yf-recommendations').getBoundingClientRect(); const s=document.getElementById('secondary').getBoundingClientRect(); return {title:t.toJSON(), grid:g.toJSON(), sidebar:s.toJSON(),page:scrollY}");
  assert.ok(theaterBoxes.grid.top >= theaterBoxes.title.bottom - 1, "theatre grid should sit below the title");
  assert.ok(theaterBoxes.grid.top <= theaterBoxes.title.bottom + 40, "theatre grid should hug the title, not wait for the sidebar");
  assert.ok(theaterBoxes.sidebar.bottom > theaterBoxes.grid.top, "theatre sidebar should extend alongside the grid");
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await until("return !document.getElementById('yf-comments-panel').hidden", "Theatre comments did not reopen");
  await waitForLayoutEnd();
  const theaterComments = await js("return {panel:document.getElementById('yf-comments-panel').getBoundingClientRect().toJSON(),grid:document.getElementById('yf-recommendations').getBoundingClientRect().toJSON(),title:document.getElementById('yf-title').getBoundingClientRect().toJSON(),overflow:getComputedStyle(document.querySelector(arguments[0])).overflowY,page:scrollY}", commentBodySelector);
  assert.equal(theaterComments.overflow, "visible");
  assert.ok(theaterComments.grid.top <= theaterComments.title.bottom + 40);
  const gridBefore = theaterBoxes.grid.top + theaterBoxes.page;
  const gridAfter = theaterComments.grid.top + theaterComments.page;
  assert.ok(Math.abs(gridAfter - gridBefore) < 2, `Theatre comments moved the grid from ${gridBefore} to ${gridAfter}`);
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await writeFile(resolve(artifactDirectory, "youtube-theatre.png"), await driver.takeScreenshot(), "base64");
  await clickPlayerControl(".ytp-size-button");
  await until("return !document.querySelector('ytd-watch-flexy').hasAttribute('theater')", "Native theatre mode did not exit");
  pass("native theatre mode keeps the full-width player and starts the grid right under the title");

  await driver.findElement(By.css("ytd-watch-flexy #movie_player")).sendKeys("f");
  await until("return !!document.fullscreenElement", "Native fullscreen did not activate");
  await until("return document.getElementById('movie_player').getBoundingClientRect().width >= innerWidth - 2", "Native fullscreen player did not fill the window");
  await driver.findElement(By.css("ytd-watch-flexy #movie_player")).sendKeys("f");
  await until("return !document.fullscreenElement", "Native fullscreen did not exit");
  pass("native fullscreen enters and exits normally");

  await driver.manage().window().setRect({ width: 900, height: 1000 });
  await until("return document.getElementById('secondary').getBoundingClientRect().top >= document.getElementById('primary').getBoundingClientRect().bottom", "Narrow native layout did not stack");
  assert.ok(await js("return document.documentElement.scrollWidth <= innerWidth + 1"));
  await writeFile(resolve(artifactDirectory, "youtube-narrow.png"), await driver.takeScreenshot(), "base64");
  await driver.manage().window().setRect({ width: 1640, height: 1100 });
  pass("actual watch page fits a narrow window without horizontal overflow");

  await driver.findElement(By.id("yf-comments-toggle")).click();
  await until("return !!document.querySelector('#yf-comments-panel #content-text')?.textContent.trim()", "Previous video's comments did not render before navigation");
  const readFirstComment = () => js("return document.querySelector('#yf-comments-panel #content-text')?.textContent.trim() || document.querySelector('#yf-comments-panel ytd-message-renderer')?.textContent.trim() || ''");
  const previousComment = await readFirstComment();
  await js("window.previousCommentsRenderer=document.querySelector('#yf-comments-panel > ytd-engagement-panel-section-list-renderer')");
  const previousVideo = await js("return new URLSearchParams(location.search).get('v')");
  await driver.findElement(By.css("#yf-recommendations yt-lockup-view-model a[href^='/watch']")).click();
  await driver.wait(async () => (await js("return new URLSearchParams(location.search).get('v')")) !== previousVideo, 15000, "Recommendation click did not navigate", 150);
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "Focus layout did not follow native navigation", 25000);
  // Native navigation can replace the controls again while its columns settle.
  // Locate/click the toggle only after that transition, not a transient button.
  await waitForLayoutEnd();
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  pass("clicking a real recommendation navigates and reapplies the layout with comments closed");
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await driver.wait(async () => {
    const comment = await readFirstComment();
    return comment !== '' && comment !== previousComment;
  }, 25000, "The new video kept the previous video's comments", 150);
  assert.equal(await js("return document.querySelectorAll('ytd-watch-flexy [target-id=engagement-panel-comments-section]').length"), 1);
  const currentComment = await readFirstComment();
  pass("reopening comments after a real recommendation displays the new video's thread");

  await driver.switchTo().newWindow("tab");
  await driver.get(popupUrl);
  await until("return document.getElementById('status').textContent !== 'Loading your settings…'", "Popup did not initialize");
  await driver.findElement(By.id("enabled")).click();
  await driver.switchTo().window(videoTab);
  await until("return !document.querySelector('.yf-active')", "Disabling did not restore YouTube");
  assert.ok(await js("return !!document.querySelector('#primary #below ytd-watch-metadata')"));
  assert.ok(await js("return !!document.querySelector('#primary #below ytd-watch-metadata #title h1, #primary #below ytd-watch-metadata h1')"));
  assert.ok(await js("return !!document.querySelector('#secondary #related')"));
  assert.ok(await js("return getComputedStyle(document.querySelector('#secondary #related')).display !== 'none'"));
  assert.ok(await js("return !!document.querySelector('#secondary [target-id=engagement-panel-comments-section] ytd-comments')"));
  pass("real popup restores the original YouTube layout, title and related videos");
  const popupTab = (await driver.getAllWindowHandles()).find(handle => handle !== videoTab);
  await driver.switchTo().window(popupTab);
  await driver.findElement(By.id("enabled")).click();
  await driver.switchTo().window(videoTab);
  await until("return !!document.querySelector('#yf-comments-toggle')", "Re-enabling the layout after navigation failed");
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await driver.wait(async () => (await readFirstComment()) === currentComment, 15000, "Re-enabling resurrected comments from the previous video", 150);
  assert.equal(await js("return document.querySelectorAll('ytd-watch-flexy [target-id=engagement-panel-comments-section]').length"), 1);
  pass("disable/re-enable after real navigation keeps only the current video's comments");
  console.log(`${passed} live checks passed in ${browserType} ${(await driver.getCapabilities()).get("browserVersion")}.`);
} catch (error) {
  await writeFile(resolve(artifactDirectory, "live-failure.png"), await driver.takeScreenshot(), "base64").catch(() => {});
  throw error;
} finally {
  await driver.quit();
}
