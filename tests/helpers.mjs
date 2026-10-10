import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function createDriver() {
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

export async function extensionUrl(driver) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const uuid = await driver.executeScript(() => JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))["youtube-focus@local.extension"]);
    return `moz-extension://${uuid}/popup.html`;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
