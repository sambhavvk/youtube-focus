import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { By, Key } from "selenium-webdriver";
import { createDriver, extensionUrl } from "./helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const driver = await createDriver();
let passed = 0;
try {
  await driver.installAddon(resolve(root, "artifacts/youtube-focus-1.2.1.zip"), true);
  const popupUrl = await extensionUrl(driver);
  const videoTab = await driver.getWindowHandle();
  await driver.get("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  const js = (code, ...args) => driver.executeScript(code, ...args);
  const until = (code, label, timeout = 15000) => driver.wait(() => js(code), timeout, label, 150);
  const pass = label => { passed++; console.log(`PASS ${label}`); };
  async function clickPlayerControl(selector) {
    await driver.actions().move({ origin: await driver.findElement(By.id("movie_player")) }).perform();
    await driver.wait(async () => (await driver.findElement(By.css(selector))).isDisplayed(), 5000, `Player control ${selector} is hidden`);
    await driver.findElement(By.css(selector)).click();
  }
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "Live YouTube layout did not initialize", 25000);
  await until("return !!document.querySelector('#yf-title #title, #yf-title h1')", "Live title did not move below the player", 25000);
  await until("return document.querySelectorAll('#yf-recommendations yt-lockup-view-model').length > 0", "Live recommendations did not load");
  const movedTitle = await js("return document.querySelector('#yf-title')?.textContent?.trim() || ''");
  assert.ok(movedTitle.length > 0 && (await js("return document.title")).includes(movedTitle), "the moved title should match the page title");
  await js("window.testOriginalPlayer = document.getElementById('movie_player'); document.querySelector('video').muted = true");
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  assert.equal(await js("return document.getElementById('yf-recommendations-title') === null"), true);
  await writeFile(resolve(root, "artifacts/youtube-layout.png"), await driver.takeScreenshot(), "base64");
  pass("actual YouTube watch page puts the title and headingless recommendation grid below the player in Zen");

  const titleBox = await js("const t=document.getElementById('yf-title').getBoundingClientRect(); const p=document.getElementById('player').getBoundingClientRect(); const r=document.getElementById('yf-recommendations').getBoundingClientRect(); return {title:t.toJSON(), player:p.toJSON(), grid:r.toJSON()}");
  assert.ok(titleBox.title.top >= titleBox.player.bottom - 1);
  assert.ok(Math.abs(titleBox.title.left - titleBox.player.left) < 2);
  assert.ok(titleBox.grid.top >= titleBox.title.bottom - 1);
  pass("the live video title sits below the player with the recommendation grid below it");

  const card = await js("const c=document.querySelector('#yf-recommendations yt-lockup-view-model'); return [c.querySelector('.ytLockupViewModelContentImage'), c.querySelector('.ytLockupViewModelMetadata')].map(n=>n.getBoundingClientRect().toJSON())");
  assert.ok(card[1].top >= card[0].bottom - 1);
  assert.ok(Math.abs(card[0].width - card[1].width) < 2);
  pass("current YouTube card thumbnails occupy the full grid-card width");

  await driver.findElement(By.css(".ytp-play-button")).click();
  await until("return !document.querySelector('video').paused && document.querySelector('video').currentTime > 0.1", "Native playback did not start");
  await driver.findElement(By.css(".ytp-play-button")).click();
  assert.equal(await js("return document.getElementById('movie_player') === window.testOriginalPlayer"), true);
  pass("native player starts and pauses without being recreated");

  const titleTop = await js("return document.getElementById('yf-title').getBoundingClientRect().top");
  const gridTop = await js("return document.getElementById('yf-recommendations').getBoundingClientRect().top");
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await until("return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length > 0", "Live comments did not load", 20000);
  assert.ok((await js("return document.getElementById('yf-title').getBoundingClientRect().top")) <= titleTop + 2);
  assert.ok((await js("return document.getElementById('yf-recommendations').getBoundingClientRect().top")) <= gridTop + 2);
  await writeFile(resolve(root, "artifacts/youtube-comments.png"), await driver.takeScreenshot(), "base64");
  pass("real comments and reply controls load on demand without pushing the title or grid down");

  const commentBodySelector = "#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content";
  const commentBody = await driver.findElement(By.css(commentBodySelector));
  const readCommentPosition = () => js("const body=document.querySelector(arguments[0]); return {top:body.scrollTop,height:body.clientHeight,total:body.scrollHeight,page:scrollY,header:body.previousElementSibling.getBoundingClientRect().top}", commentBodySelector);
  const beforeWheel = await readCommentPosition();
  assert.ok(beforeWheel.total > beforeWheel.height);
  await driver.actions().scroll(0, 0, 0, 300, commentBody).perform();
  await driver.wait(async () => (await readCommentPosition()).top > beforeWheel.top, 5000, "Mouse wheel did not scroll the real comment body", 100);
  const afterWheel = await readCommentPosition();
  assert.equal(afterWheel.page, beforeWheel.page);
  assert.ok(Math.abs(afterWheel.header - beforeWheel.header) < 1);
  await commentBody.sendKeys(Key.PAGE_DOWN);
  await driver.wait(async () => (await readCommentPosition()).top > afterWheel.top, 5000, "PageDown did not scroll the real comment body", 100);
  assert.equal((await readCommentPosition()).page, beforeWheel.page);
  pass("wheel and keyboard scroll real comments independently while the header stays visible");

  const loadedThreads = await js("return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length");
  await driver.actions().scroll(0, 0, 0, 10000, commentBody).perform();
  await until(`return document.querySelectorAll('#yf-comments-panel ytd-comment-thread-renderer').length > ${loadedThreads}`, "Additional comments did not load while scrolling", 20000);
  pass("scrolling to the end of the loaded thread fetches additional native comments");

  const expandDescription = await driver.findElements(By.css("#yf-details #description #expand"));
  if (expandDescription.length) {
    await expandDescription[0].click();
    await until("return document.querySelector('#yf-details #description #collapse')?.hidden === false", "Description did not expand");
    await js("document.querySelector(arguments[0]).scrollTop=0", commentBodySelector);
    const expandedStart = await readCommentPosition();
    assert.ok(expandedStart.height > 40);
    await driver.actions().scroll(0, 0, 0, 300, commentBody).perform();
    await driver.wait(async () => (await readCommentPosition()).top > 0, 5000, "Comments did not scroll with an expanded description", 100);
    const expandedEnd = await readCommentPosition();
    assert.equal(expandedEnd.page, expandedStart.page);
    assert.ok(Math.abs(expandedEnd.header - expandedStart.header) < 1);
    await driver.findElement(By.css("#yf-details #description #collapse")).click();
    pass("comments keep a usable independent scrolling area with the description expanded");
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
  assert.equal(await js("return getComputedStyle(document.getElementById('primary')).display"), "none");
  assert.ok(await driver.findElement(By.css("#movie_player")).isDisplayed());
  const theaterBoxes = await js("const t=document.getElementById('yf-title').getBoundingClientRect(); const g=document.getElementById('yf-recommendations').getBoundingClientRect(); const s=document.getElementById('secondary').getBoundingClientRect(); return {title:t.toJSON(), grid:g.toJSON(), sidebar:s.toJSON()}");
  assert.ok(theaterBoxes.grid.top >= theaterBoxes.title.bottom - 1, "theatre grid should sit below the title");
  assert.ok(theaterBoxes.grid.top <= theaterBoxes.title.bottom + 40, "theatre grid should hug the title, not wait for the sidebar");
  assert.ok(theaterBoxes.sidebar.bottom > theaterBoxes.grid.top, "theatre sidebar should extend alongside the grid");
  await writeFile(resolve(root, "artifacts/youtube-theatre.png"), await driver.takeScreenshot(), "base64");
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
  await writeFile(resolve(root, "artifacts/youtube-narrow.png"), await driver.takeScreenshot(), "base64");
  await driver.manage().window().setRect({ width: 1640, height: 1100 });
  pass("actual watch page fits a narrow Zen window without horizontal overflow");

  const previousVideo = await js("return new URLSearchParams(location.search).get('v')");
  await driver.findElement(By.css("#yf-recommendations yt-lockup-view-model a[href^='/watch']")).click();
  await driver.wait(async () => (await js("return new URLSearchParams(location.search).get('v')")) !== previousVideo, 15000, "Recommendation click did not navigate", 150);
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "Focus layout did not follow native navigation", 25000);
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  pass("clicking a real recommendation navigates and reapplies the layout with comments closed");

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
  console.log(`${passed} live checks passed in Zen ${(await driver.getCapabilities()).get("browserVersion")}.`);
} catch (error) {
  await writeFile(resolve(root, "artifacts/live-failure.png"), await driver.takeScreenshot(), "base64").catch(() => {});
  throw error;
} finally {
  await driver.quit();
}
