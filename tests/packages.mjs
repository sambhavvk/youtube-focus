import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { extensionFiles, manifestForBrowser, root } from "../scripts/extension.mjs";

for (const browser of ["firefox", "chromium"]) {
  test(`${browser} package has the correct manifest, native icons and only runtime files`, async () => {
    const manifest = await manifestForBrowser(browser);
    const filename = browser === "firefox"
      ? `youtube-focus-${manifest.version}.zip`
      : `youtube-focus-chromium-${manifest.version}.zip`;
    const result = spawnSync("python", ["-c", "import base64,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({f:base64.b64encode(z.read(f)).decode() for f in z.namelist()}))", resolve(root, "artifacts", filename)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const files = new Map(Object.entries(JSON.parse(result.stdout)).map(([name, data]) => [name, Buffer.from(data, "base64")]));
    assert.deepEqual([...files.keys()].sort(), extensionFiles(manifest).sort());
    assert.deepEqual(JSON.parse(files.get("manifest.json")), manifest);
    assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);
    assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*"]);
    assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.youtube.com/*"]);
    if (browser === "firefox") {
      assert.equal(manifest.browser_specific_settings.gecko.id, "{0964b1ee-ea8b-4426-b3c6-3428cd8b5804}");
      assert.equal(manifest.minimum_chrome_version, undefined);
    } else {
      assert.equal(manifest.browser_specific_settings, undefined);
      assert.equal(manifest.minimum_chrome_version, "120");
    }
    for (const [size, path] of Object.entries(manifest.icons)) {
      const image = files.get(path);
      assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(image.readUInt32BE(16), Number(size));
      assert.equal(image.readUInt32BE(20), Number(size));
    }
    for (const [name, contents] of files) {
      if (name !== "manifest.json") assert.deepEqual(contents, await readFile(resolve(root, name)), `${name} must ship unchanged`);
      if (browser === "chromium") assert.deepEqual(contents, await readFile(resolve(root, "artifacts/youtube-focus-chromium", name)), `${name} must match the unpacked build`);
    }
  });
}

test("unsupported build targets are rejected", async () => {
  await assert.rejects(manifestForBrowser("unknown"), /Unknown browser/);
});
