import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import chrome from "selenium-webdriver/chrome.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const extensionId = manifest.browser_specific_settings.gecko.id;
export const browserType = process.env.YF_BROWSER || "firefox";
if (!["firefox", "chromium"].includes(browserType)) throw new Error(`Unknown browser: ${browserType}`);

export async function createDriver({ extensionDirectory } = {}) {
  if (browserType === "chromium") {
    if (!extensionDirectory) throw new Error("Chromium tests require an unpacked extension directory");
    const options = new chrome.Options().addArguments(
      "--headless=new", `--load-extension=${resolve(extensionDirectory)}`,
      `--disable-extensions-except=${resolve(extensionDirectory)}`
    );
    if (process.env.YF_CHROMIUM_BINARY) options.setChromeBinaryPath(process.env.YF_CHROMIUM_BINARY);
    else options.setBrowserVersion("stable"); // Selenium provisions Chrome for Testing.
    let builder = new Builder().forBrowser("chrome").setChromeOptions(options);
    if (process.env.YF_CHROMEDRIVER) builder = builder.setChromeService(new chrome.ServiceBuilder(process.env.YF_CHROMEDRIVER));
    const driver = await builder.build();
    await driver.manage().setTimeouts({ pageLoad: 30000, script: 15000 });
    await driver.manage().window().setRect({ width: 1640, height: 1100 });
    return driver;
  }
  const binary = process.env.YF_BROWSER_BINARY ||
    (existsSync("/opt/zen-browser-bin/zen-bin") ? "/opt/zen-browser-bin/zen-bin" : "/usr/bin/firefox");
  let driverPath = process.env.YF_GECKODRIVER;
  if (!driverPath) {
    const cache = join(homedir(), ".cache/selenium/geckodriver/linux64");
    const versions = await readdir(cache).catch(() => []);
    for (const version of versions.sort().reverse()) {
      const candidate = join(cache, version, "geckodriver");
      if (existsSync(candidate)) { driverPath = candidate; break; }
    }
  }
  const options = new firefox.Options().setBinary(binary).addArguments("-headless");
  let builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  if (driverPath) builder = builder.setFirefoxService(new firefox.ServiceBuilder(driverPath).addArguments("--allow-system-access"));
  else builder = builder.setFirefoxService(new firefox.ServiceBuilder().addArguments("--allow-system-access"));
  const driver = await builder.build();
  await driver.manage().setTimeouts({ pageLoad: 30000, script: 15000 });
  await driver.manage().window().setRect({ width: 1640, height: 1100 });
  return driver;
}

export async function extensionUrl(driver, extensionDirectory) {
  if (browserType === "chromium") {
    // Unpacked Chromium IDs are the first 128 bits of the absolute-path SHA256,
    // with hex digits mapped to a-p. No test-only background worker is necessary.
    const id = createHash("sha256").update(resolve(extensionDirectory)).digest("hex")
      .slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    return `chrome-extension://${id}/popup.html`;
  }
  await driver.setContext(firefox.Context.CHROME);
  try {
    const uuid = await driver.executeScript(id => JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))[id], extensionId);
    if (!uuid) throw new Error(`Firefox did not register extension ${extensionId}`);
    return `moz-extension://${uuid}/popup.html`;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
