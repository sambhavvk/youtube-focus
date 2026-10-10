import { mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const files = ["manifest.json", "content.js", "styles.css", "popup.html", "popup.css", "popup.js", ...Object.values(manifest.icons)];
await mkdir(resolve(root, "artifacts"), { recursive: true });
const destination = resolve(root, "artifacts", `youtube-focus-${manifest.version}.zip`);
// Package an explicit allowlist: test files, dependencies and local artifacts never ship.
const result = spawnSync("python", ["-c", "import sys,zipfile; root,destination,*files=sys.argv[1:]; z=zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED); [z.write(root+'/'+f,f) for f in files]; z.close()", root, destination, ...new Set(files)], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Built ${destination}`);
