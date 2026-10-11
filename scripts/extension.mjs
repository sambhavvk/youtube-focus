import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function manifestForBrowser(browser) {
  if (!["firefox", "chromium"].includes(browser)) throw new Error(`Unknown browser: ${browser}`);
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (browser === "chromium") {
    delete manifest.browser_specific_settings;
    manifest.minimum_chrome_version = "120";
  }
  return manifest;
}

export function extensionFiles(manifest) {
  // An explicit allowlist keeps tests, development dependencies and artifacts out.
  return [...new Set([
    "manifest.json", "content.js", "styles.css", "popup.html", "popup.css", "popup.js",
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)
  ])];
}

export async function stageExtension(destination, manifest) {
  await mkdir(resolve(destination, "icons"), { recursive: true });
  for (const file of extensionFiles(manifest)) {
    if (file !== "manifest.json") await copyFile(resolve(root, file), resolve(destination, file));
  }
  await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
