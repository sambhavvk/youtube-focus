import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { extensionFiles, manifestForBrowser, root, stageExtension } from "./extension.mjs";

const target = process.argv[2] || "all";
if (!["all", "firefox", "chromium"].includes(target)) throw new Error(`Unknown browser: ${target}`);
await mkdir(resolve(root, "artifacts"), { recursive: true });
for (const browser of target === "all" ? ["firefox", "chromium"] : [target]) {
  const manifest = await manifestForBrowser(browser);
  const stage = browser === "chromium"
    ? resolve(root, "artifacts", "youtube-focus-chromium")
    : root;
  if (browser === "chromium") await stageExtension(stage, manifest);
  const filename = browser === "firefox"
    ? `youtube-focus-${manifest.version}.zip`
    : `youtube-focus-chromium-${manifest.version}.zip`;
  const destination = resolve(root, "artifacts", filename);
  const result = spawnSync("python", ["-c", "import sys,zipfile; root,destination,*files=sys.argv[1:]; z=zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED); [z.write(root+'/'+f,f) for f in files]; z.close()", stage, destination, ...extensionFiles(manifest)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Packaging ${browser} failed (${result.status})`);
  console.log(`Built ${destination}`);
  if (browser === "chromium") console.log(`Load unpacked: ${stage}`);
}
