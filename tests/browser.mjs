import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { By, Key } from "selenium-webdriver";
import { browserType, createDriver, extensionUrl } from "./helpers.mjs";
import { manifestForBrowser, stageExtension } from "../scripts/extension.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await readFile(resolve(root, "tests/watch-fixture.html"));
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(request.url.includes("variant=unknown") ? "<!doctype html><title>Unknown layout</title><p>Unrecognized watch page</p>" : fixture);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const stage = await mkdtemp(resolve(tmpdir(), "youtube-focus-test-"));
const manifest = await manifestForBrowser(browserType);
// Localhost access exists only in this temporary test copy, never in the shipped add-on.
manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
manifest.host_permissions.push("http://127.0.0.1/*");
await stageExtension(stage, manifest);
const artifactDirectory = resolve(root, "artifacts", browserType === "chromium" ? "chromium-tests" : ".");
await mkdir(artifactDirectory, { recursive: true });
let driver;
let passed = 0;

try {
  driver = await createDriver({ extensionDirectory: stage });
  if (browserType === "firefox") await driver.installAddon(stage, true);
  const popupUrl = await extensionUrl(driver, stage);
  const js = (code, ...args) => driver.executeScript(code, ...args);
  const until = (code, message) => driver.wait(() => js(code), 7000, message, 100);
  const pass = name => { passed++; console.log(`PASS ${name}`); };
  const waitForScrollEnd = async () => {
    let last = await js("return scrollY");
    let stable = 0;
    await driver.wait(async () => {
      const current = await js("return scrollY");
      stable = current === last ? stable + 1 : 0;
      last = current;
      return stable >= 3;
    }, 5000, "page scrolling did not settle", 100);
  };
  const verifyCommentsPageScrolling = async (selector, description) => {
    await js("window.scrollTo(0,0)");
    await js("document.querySelector(arguments[0]).scrollIntoView({block:'start'})", selector);
    const target = await driver.findElement(By.css(selector));
    const before = await js("const el=document.querySelector(arguments[0]); const last=[...el.querySelectorAll('.comment')].at(-1); return {top:el.scrollTop,client:el.clientHeight,page:scrollY,overflow:getComputedStyle(el).overflowY,bottom:el.getBoundingClientRect().bottom,lastBottom:last.getBoundingClientRect().bottom}", selector);
    assert.equal(before.overflow, "visible", `${description}: comments must not have an inner scrollbar`);
    assert.ok(before.client > 600, `${description}: the thread should grow beyond its old height cap`);
    assert.ok(before.lastBottom <= before.bottom + 1, `${description}: all loaded comments must fit in the body`);

    await driver.actions().scroll(0, 0, 0, 320, target).perform();
    await driver.wait(() => js("return scrollY > arguments[0]", before.page), 5000, `${description}: wheel did not scroll the page`, 100);
    await waitForScrollEnd();
    const afterWheel = await js("return {top:document.querySelector(arguments[0]).scrollTop,page:scrollY}", selector);
    assert.equal(afterWheel.top, 0, `${description}: wheel scrolled an inner comments box`);

    await js("document.querySelector(arguments[0]).focus({preventScroll:true})", selector);
    await driver.actions().sendKeys(Key.PAGE_DOWN).perform();
    await driver.wait(() => js("return scrollY > arguments[0]", afterWheel.page), 5000, `${description}: PageDown did not scroll the page`, 100);
    await waitForScrollEnd();
    const afterKey = await js("return {top:document.querySelector(arguments[0]).scrollTop,page:window.scrollY}", selector);
    assert.equal(afterKey.top, 0, `${description}: PageDown scrolled an inner comments box`);

    // Aim at the last comment, not the document bottom: narrow layouts have
    // recommendations after the thread. Avoid racing Chromium's PageDown animation.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const last = await js("const box=[...document.querySelector(arguments[0]).querySelectorAll('.comment')].at(-1).getBoundingClientRect(); return {top:box.top,bottom:box.bottom,height:innerHeight}", selector);
      if (last.top >= 0 && last.bottom <= last.height) break;
      const delta = Math.max(-800, Math.min(800, Math.ceil(last.bottom - last.height + 24)));
      await driver.actions().scroll(100, 100, 0, delta).perform();
      await waitForScrollEnd();
    }
    await driver.wait(() => js("const last=[...document.querySelector(arguments[0]).querySelectorAll('.comment')].at(-1); const box=last.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight", selector), 5000, `${description}: the final comment cannot be reached through page scrolling`, 100);
    assert.equal(await js("return document.querySelector(arguments[0]).scrollTop", selector), 0);
    await js("window.scrollTo(0,0)");
  };
  const popupTab = await driver.getWindowHandle();
  await driver.get(popupUrl);
  await until("return document.getElementById('status').textContent !== 'Loading your settings…'", "popup did not initialize");
  await until("const icon=document.querySelector('.brand-icon'); return icon.complete && icon.naturalWidth === 32", "popup icon did not load");
  await driver.findElement(By.id("open-comments")).click();
  await until("return document.getElementById('status').textContent === 'Open a YouTube video first to show its comments.'", "popup did not handle a non-YouTube tab");
  pass("popup loads its PNG icon and handles non-YouTube tabs without an error");
  const existingHandles = new Set(await driver.getAllWindowHandles());
  // Zen's WebDriver newWindow('tab') makes a browser that is absent from tabs.query.
  // Open a real tab through the extension API so messaging tests exercise native tabs.
  await js("return (globalThis.browser || globalThis.chrome).tabs.create({url: arguments[0]})", `${origin}/watch?v=fixture01`);
  const watchTab = (await driver.getAllWindowHandles()).find(handle => !existingHandles.has(handle));
  assert.ok(watchTab, "The extension API did not create a browser tab");
  await driver.switchTo().window(watchTab);
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "focus layout did not initialize");

  assert.equal(await js("return document.querySelector('#movie_player') === window.originalPlayer"), true);
  assert.equal(await js("return !!document.querySelector('#columns > #primary')"), true);
  assert.equal(await js("return document.querySelector('#primary #below') === null"), true);
  assert.equal(await js("return document.querySelector('#yf-title h1').textContent"), "How to build a calmer, more focused workspace");
  assert.equal(await js("return document.getElementById('yf-recommendations-title') === null"), true);
  assert.equal(await js("return !!document.querySelector('#yf-recommendations #related [data-yf-grid]')"), true);
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  const rectangles = await js("return ['primary','secondary','yf-title','yf-recommendations'].map(id => document.getElementById(id).getBoundingClientRect().toJSON())");
  assert.ok(rectangles[1].left > rectangles[0].right);
  assert.ok(rectangles[2].top >= rectangles[0].bottom);
  assert.ok(Math.abs(rectangles[2].left - rectangles[0].left) < 2);
  assert.ok(Math.abs(rectangles[2].width - rectangles[0].width) < 2);
  assert.ok(rectangles[3].top >= rectangles[2].bottom);
  assert.ok(rectangles[3].width > rectangles[0].width);
  pass("desktop layout puts the title below the player and the headingless grid below the title");
  await writeFile(resolve(artifactDirectory, "fixture-desktop.png"), await driver.takeScreenshot(), "base64");

  const cardRectangles = await js("const c=document.querySelector('ytd-compact-video-renderer'); return [c.querySelector('#thumbnail'),c.querySelector('#details')].map(n=>n.getBoundingClientRect().toJSON())");
  assert.ok(cardRectangles[1].top >= cardRectangles[0].bottom);
  const lockupRectangles = await js("const c=document.querySelector('.ytLockupViewModelHost'); return [c.querySelector('.ytLockupViewModelContentImage'),c.querySelector('.ytLockupViewModelMetadata')].map(n=>n.getBoundingClientRect().toJSON())");
  assert.ok(lockupRectangles[1].top >= lockupRectangles[0].bottom);
  assert.equal(await js("return document.querySelector('ytd-continuation-item-renderer').hasAttribute('data-yf-wide')"), true);
  assert.equal(await js("return !!document.querySelector('#yf-title #title h1')"), true);
  pass("legacy and current thumbnail cards stack vertically; the native title keeps its wrapper");

  await driver.findElement(By.id("native-menu")).click();
  assert.equal(await js("return window.nativeMenuClicks"), 1);
  assert.equal(await js("return document.querySelector('.native-menu-panel').hidden"), false);
  await driver.findElement(By.id("native-menu")).click();
  pass("native menu listeners survive the layout changes");

  await driver.findElement(By.id("yf-comments-toggle")).click();
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), false);
  assert.equal(await driver.findElement(By.id("yf-comments-toggle")).getAttribute("aria-expanded"), "true");
  assert.ok(await driver.findElement(By.id("comment-entry")).isDisplayed());
  assert.ok((await js("return document.getElementById('yf-title').getBoundingClientRect().top")) <= rectangles[2].top + 2);
  const openRectangles = await js("return ['primary','secondary','yf-title','yf-recommendations','yf-comments-panel'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON())");
  assert.ok(Math.abs(openRectangles[2].top - rectangles[2].top) < 2, "comments must not push the title down");
  assert.ok(Math.abs(openRectangles[3].top - rectangles[3].top) < 2, "comments must not push the grid down");
  assert.ok(openRectangles[3].right < openRectangles[1].left, "the grid must not overlap the expanded sidebar");
  assert.ok(openRectangles[4].bottom > openRectangles[0].bottom, "comments should extend below the player");
  await verifyCommentsPageScrolling("#yf-comments-panel", "classic comments");
  pass("classic comments grow down the sidebar; wheel and PageDown scroll the page");
  await writeFile(resolve(artifactDirectory, "fixture-comments-expanded.png"), await driver.takeScreenshot(), "base64");

  const loadedComments = await js("window.enableCommentContinuation(); return document.querySelectorAll('#yf-comments-panel .comment').length");
  await js("document.querySelector('#fixture-comment-continuation').scrollIntoView({block:'end'})");
  await until(`return document.querySelectorAll('#yf-comments-panel .comment').length > ${loadedComments}`, "page scrolling did not load the comment continuation");
  const continued = await js("return {title:document.getElementById('yf-title').getBoundingClientRect().top+scrollY,grid:document.getElementById('yf-recommendations').getBoundingClientRect().top+scrollY}");
  assert.ok(Math.abs(continued.title - rectangles[2].top) < 2);
  assert.ok(Math.abs(continued.grid - rectangles[3].top) < 2);
  await js("window.scrollTo(0,0)");
  pass("page-visible comment continuations grow the thread without moving the left column");
  await driver.findElement(By.id("comment-entry")).sendKeys(Key.ESCAPE);
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  assert.equal(await js("return document.activeElement.id"), "yf-comments-toggle");
  assert.equal(await js("return !!document.querySelector('#columns > #primary')"), true);
  assert.ok(Math.abs((await js("return document.getElementById('yf-recommendations').getBoundingClientRect().width")) - rectangles[3].width) < 2);
  pass("Escape collapses comments and restores the full-width recommendation grid");

  await js("const list=document.querySelector('#related #items'); const node=list.querySelector('ytd-compact-video-renderer').cloneNode(true); node.id='late-card'; list.append(node)");
  await until("return document.getElementById('late-card').parentElement.hasAttribute('data-yf-grid')", "late recommendations did not enter grid");
  pass("additional recommendations are incorporated after initial loading");

  await driver.switchTo().window(popupTab);
  await until("return document.getElementById('status').textContent !== 'Loading your settings…'", "popup did not initialize");
  await driver.findElement(By.id("card-size")).sendKeys("Compact", Key.ENTER);
  await until("return (globalThis.browser || globalThis.chrome).storage.local.get('youtubeFocusSettings').then(s=>s.youtubeFocusSettings.cardSize === 'compact')", "card size was not saved");
  await driver.switchTo().window(watchTab);
  await until("return document.querySelector('ytd-watch-flexy').dataset.yfCardSize === 'compact'", "stored settings did not reach watch tab");
  pass("real popup saves settings and updates the watch page through extension storage");

  await driver.switchTo().window(popupTab);
  await driver.navigate().refresh();
  await until("return document.getElementById('card-size').value === 'compact'", "reopened popup did not restore saved settings");
  assert.equal(await driver.findElement(By.id("enabled")).isSelected(), true);
  pass("reopening the popup preserves saved settings");
  const opened = await js("const api=globalThis.browser || globalThis.chrome; return api.tabs.query({}).then(async tabs => {for(const tab of tabs) {try {return await api.tabs.sendMessage(tab.id, {type:'youtube-focus:open-comments'});} catch {}} throw new Error('No test content script found');})");
  assert.equal(opened.ok, true);
  const status = await js("const api=globalThis.browser || globalThis.chrome; return api.tabs.query({}).then(async tabs => {for(const tab of tabs) {try {return await api.tabs.sendMessage(tab.id, {type:'youtube-focus:get-status'});} catch {}} throw new Error('No test content script found');})");
  assert.deepEqual(status, { active: true, commentsOpen: true });
  pass("popup-to-page messaging opens comments and reports the active layout");

  await driver.switchTo().window(popupTab);
  await driver.findElement(By.id("enabled")).click();
  await driver.switchTo().window(watchTab);
  await until("return !document.querySelector('.yf-active')", "disable did not restore native layout");
  assert.equal(await js("return !!document.querySelector('#primary-inner > #below ytd-comments')"), true);
  assert.equal(await js("return !!document.querySelector('#columns > #primary')"), true);
  assert.equal(await js("return document.querySelector('ytd-watch-flexy').classList.contains('yf-comments-open')"), false);
  assert.equal(await js("return !!document.querySelector('#primary-inner > #below ytd-watch-metadata #title h1')"), true);
  assert.equal(await js("return !!document.querySelector('#secondary-inner > #related')"), true);
  assert.equal(await js("return getComputedStyle(document.querySelector('#secondary-inner > #related')).display !== 'none'"), true);
  assert.equal(await js("return document.querySelectorAll('[id^=yf-], [data-yf-grid], [data-yf-wide]').length"), 0);
  assert.equal(await js("return document.getElementById('movie_player') === window.originalPlayer"), true);
  pass("disabling restores the title, recommendations and removes all added UI");

  await driver.switchTo().window(popupTab);
  const disabled = await js("const api=globalThis.browser || globalThis.chrome; return api.tabs.query({}).then(async tabs => {for(const tab of tabs) {try {return await api.tabs.sendMessage(tab.id, {type:'youtube-focus:open-comments'});} catch {}} throw new Error('No test content script found');})");
  assert.equal(disabled.ok, false);
  assert.match(disabled.message, /Enable the focus layout/);
  pass("messaging reports a disabled layout instead of claiming comments opened");
  await driver.findElement(By.id("enabled")).click();
  await driver.switchTo().window(watchTab);
  await until("return !!document.querySelector('.yf-active')", "re-enable failed");
  await driver.findElement(By.id("yf-comments-toggle")).click();
  await js("document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=fixture02'); document.dispatchEvent(new Event('yt-navigate-finish'))");
  await until("return document.getElementById('yf-comments-panel')?.hidden === true", "comments remained open after navigation");
  assert.equal(await js("return document.querySelectorAll('#yf-details').length"), 1);
  pass("navigation between videos resets comments without duplicate controls");

  await js("window.replaceWatch()");
  await until("return !!document.querySelector('.yf-active #yf-details ytd-watch-metadata')", "replacement watch root was not handled");
  assert.equal(await js("return document.querySelectorAll('#yf-title').length"), 1);
  assert.equal(await js("return document.querySelectorAll('#yf-recommendations').length"), 1);
  assert.equal(await js("return !!document.querySelector('#yf-title #title h1')"), true);
  await js("window.replaceWatch(); window.useEngagementComments()");
  await until("return !!document.querySelector('#yf-comments-panel ytd-comments[engagement-panel]')", "real engagement comments were not selected");
  assert.equal(await js("return !!document.querySelector('#below ytd-comments[disable-upgrade][hidden]')"), true);
  await driver.findElement(By.id("yf-comments-toggle")).click();
  assert.ok(await driver.findElement(By.id("comment-entry")).isDisplayed());
  await verifyCommentsPageScrolling(
    "#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content",
    "native engagement comments"
  );
  pass("native engagement comments grow naturally and scroll with the page");
  await js("const description=document.querySelector('#yf-details #description'); window.originalDescription=description.innerHTML; description.innerHTML='<p>'+('Expanded description text. '.repeat(160))+'</p>'");
  const expanded = await js("return {title:document.getElementById('yf-title').getBoundingClientRect().top,grid:document.getElementById('yf-recommendations').getBoundingClientRect().top}");
  await verifyCommentsPageScrolling("#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content", "comments below an expanded description");
  assert.deepEqual(await js("return {title:document.getElementById('yf-title').getBoundingClientRect().top,grid:document.getElementById('yf-recommendations').getBoundingClientRect().top}"), expanded);
  await js("document.querySelector('#yf-details #description').innerHTML=window.originalDescription");
  await driver.findElement(By.css("#yf-comments-panel #visibility-button")).click();
  assert.equal(await js("return document.getElementById('yf-comments-panel').hidden"), true);
  await driver.findElement(By.id("yf-comments-toggle")).click();
  pass("expanded descriptions do not clip comments; native close and reopen stay synchronized");
  pass("watch-root replacement and newer engagement-panel comments are supported");

  await driver.manage().window().setRect({ width: 960, height: 1000 });
  const narrow = await js("return ['primary','yf-title','secondary','yf-recommendations'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON())");
  assert.ok(narrow[1].top >= narrow[0].bottom);
  assert.ok(narrow[2].top >= narrow[1].bottom);
  assert.ok(narrow[3].top >= narrow[2].bottom);
  assert.ok(await js("return document.documentElement.scrollWidth <= innerWidth+1"));
  await verifyCommentsPageScrolling("#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content", "narrow comments");
  await writeFile(resolve(artifactDirectory, "fixture-narrow.png"), await driver.takeScreenshot(), "base64");
  pass("narrow windows stack player, title, details and recommendations without horizontal overflow");

  await driver.manage().window().setRect({ width: 1640, height: 1100 });
  await js("document.querySelector('ytd-watch-flexy').setAttribute('theater', '')");
  await until("return getComputedStyle(document.getElementById('primary')).display === 'none'", "theatre layout did not switch");
  assert.ok(await js("return document.getElementById('yf-title').getBoundingClientRect().left < document.getElementById('secondary').getBoundingClientRect().left"));
  assert.ok(await js("return document.getElementById('yf-recommendations').getBoundingClientRect().left < document.getElementById('secondary').getBoundingClientRect().left"));
  const theater = await js("return ['yf-title','yf-recommendations','secondary'].map(id => document.getElementById(id).getBoundingClientRect().toJSON())");
  assert.ok(theater[1].top >= theater[0].bottom, "theatre grid should sit below the title");
  assert.ok(theater[1].top <= theater[0].bottom + 40, "theatre grid should hug the title, not wait for the sidebar");
  assert.ok(theater[2].bottom > theater[1].top, "theatre sidebar should extend alongside the grid");
  assert.ok(theater[1].right < theater[2].left, "theatre grid must not overlap comments");
  await verifyCommentsPageScrolling("#yf-comments-panel > ytd-engagement-panel-section-list-renderer > #content", "theatre comments");
  await writeFile(resolve(artifactDirectory, "fixture-theatre-comments.png"), await driver.takeScreenshot(), "base64");
  await js("document.querySelector('ytd-watch-flexy').removeAttribute('theater'); document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/'); document.dispatchEvent(new Event('yt-navigate-finish'))");
  await until("return !document.querySelector('.yf-active')", "leaving watch page did not restore layout");
  assert.equal(await js("return !!document.querySelector('[target-id=engagement-panel-comments-section] ytd-comments[engagement-panel]')"), true);
  assert.equal(await js("const body=document.querySelector('[target-id=engagement-panel-comments-section] > #content'); return ['tabindex','role','aria-label'].some(name=>body.hasAttribute(name))"), false);
  pass("theatre mode rearranges lower content; leaving a watch page restores native panels");

  await driver.get(`${origin}/watch?v=missing&variant=unknown`);
  assert.equal(await js("return document.querySelectorAll('[id^=yf-]').length"), 0);
  pass("unrecognized page structures stay usable and untouched");
  console.log(`${passed} browser integration checks passed in ${browserType} ${(await driver.getCapabilities()).get("browserVersion")}.`);
} catch (error) {
  if (driver) await writeFile(resolve(artifactDirectory, "test-failure.png"), await driver.takeScreenshot(), "base64").catch(() => {});
  throw error;
} finally {
  if (driver) await driver.quit();
  await new Promise(done => server.close(done));
  await rm(stage, { recursive: true, force: true });
}
