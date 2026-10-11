# YouTube Focus

YouTube Focus is a browser extension for Zen, Firefox 142+, and Chromium 120+ browsers such as Chrome, Brave, and Edge. On desktop YouTube watch pages, it places the large player on the left with the video title and the recommendation grid below it, and keeps YouTube's channel, actions, and description together on the right. The grid has no heading, so the page stays calm. Narrow windows use a responsive layout, and YouTube's theatre and fullscreen modes remain available.

Comments start closed and reset to closed when you move to another video. Open them from the video details or extension popup; close them with the native close control or Escape. The popup also enables or disables the layout and sets recommendation cards to compact, comfortable, or large. Settings stay in local browser storage; the extension has no telemetry, backend, or account key.

Comments grow downward in the sidebar without a height cap or an internal scrollbar. Scroll the page with the mouse wheel or PageDown to read the thread. On wide windows, the recommendation grid stays in the left column while comments are open so the thread cannot overlap it or push the video/title/grid down. Closing comments restores the normal full-width recommendation grid. Narrow windows keep their stacked layout, with recommendations after the expanded comments.

In theatre mode, recommendations start directly below the title in the left column while the details sidebar stays alongside them, without pushing the grid down.

![YouTube Focus layout with the player, title, recommendation grid, and details sidebar](docs/preview.png)

*Extension screenshot from the automated watch-page test fixture; the video and recommendations are sample content.*

## Install in Chrome, Brave, Edge, or Chromium (no store listing)

Download [`youtube-focus-chromium-1.4.0.zip`](https://github.com/sambhavvk/youtube-focus/releases/download/v1.4.0/youtube-focus-chromium-1.4.0.zip) and extract it into a folder you intend to keep, or build this source with `npm run build:chromium`.

1. Open `chrome://extensions` (Chrome/Chromium), `brave://extensions` (Brave), or `edge://extensions` (Edge).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder, or `artifacts/youtube-focus-chromium` after building (the folder containing `manifest.json`, not the ZIP or the repository root).
4. Open or refresh a YouTube video. Pin YouTube Focus from the browser's extensions menu if you want quick access to its popup.

Unpacked extensions stay installed across browser restarts, without store publication or Mozilla signing. Keep the selected folder at the same path; moving or deleting it can break the installation or give it a different ID. Browsers may show a developer-mode warning, and managed browsers may prohibit unpacked extensions. Updates are manual: replace the files in that same folder, click **Reload** on the extension card, then refresh YouTube. The stable build folder is reused by subsequent builds so you don't have to reinstall it for each version.

## Install temporarily in Firefox or Zen

Download [`youtube-focus-1.4.0.zip`](https://github.com/sambhavvk/youtube-focus/releases/download/v1.4.0/youtube-focus-1.4.0.zip), or build the Firefox ZIP from this source (see **Build and checks** below). Older builds are listed in [GitHub Releases](https://github.com/sambhavvk/youtube-focus/releases) and may use a different comments layout.

1. Open `about:debugging#/runtime/this-firefox` in Zen or Firefox.
2. Choose **Load Temporary Add-on…**.
3. Select the Firefox ZIP, `manifest.json` from this project, or `artifacts/youtube-focus-1.4.0.zip` after building.
4. Open or refresh a YouTube video.

Temporary add-ons are removed when the browser restarts. The Firefox ZIP is unsigned; permanent installation requires Mozilla signing. Do not submit the Chromium ZIP to Mozilla. Neither build is a public store listing.

## Install permanently in Firefox or Zen without a public listing

Submit `artifacts/youtube-focus-1.4.0.zip` through the [Mozilla Developer Hub](https://addons.mozilla.org/developers/addon/submit/) and choose **On your own** (unlisted), not **On this site**. Once Mozilla signs it, download the signed `.xpi` and install it through `about:addons` → gear icon → **Install Add-on From File…**. Mozilla receives the package for signing, but it is not publicly listed. If you already registered version 1.3.1, upload 1.4.0 through that existing entry rather than submitting a new add-on; its unique ID is unchanged.

Version 1.3.1 replaces the generic development ID with a unique UUID. Remove any older temporary YouTube Focus copy before loading this version to avoid running two copies. Browser settings do not carry over between different add-on IDs. Keep the new ID unchanged for future signed updates, and upload those versions through the existing add-on entry.

## Build and checks

Use Node.js 22 and Python, then run:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:chromium
npm run test:packages
npm run test:live
npm run test:live:chromium
```

`npm run build` creates the Firefox ZIP `artifacts/youtube-focus-1.4.0.zip`, Chromium ZIP `artifacts/youtube-focus-chromium-1.4.0.zip`, and loadable folder `artifacts/youtube-focus-chromium`. Use `build:firefox` or `build:chromium` to build just one target. Runtime JavaScript, HTML, CSS, and PNG icons are copied unchanged from an explicit allowlist; the Chromium manifest omits Firefox-specific fields and declares its minimum version. There is no bundling, minification, transpilation, remote code, or runtime dependency. The SVG icon originals are retained in `icons/`; checked-in PNG equivalents are used by both builds because Chromium does not accept SVG manifest icons.

The isolated browser tests use fresh profiles, not your existing sessions. `npm test` selects `/opt/zen-browser-bin/zen-bin` on Linux when available, then Firefox. Set `YF_BROWSER_BINARY` or `YF_GECKODRIVER` to provide explicit browser or GeckoDriver paths; otherwise GeckoDriver is taken from Selenium's cache when available. `npm run test:chromium` runs the same fixture suite in Chrome for Testing, downloaded to Selenium's cache on first use. Override it with `YF_CHROMIUM_BINARY` and `YF_CHROMEDRIVER` if needed; the chosen browser must support loading unpacked extensions through automation (use Chromium or Chrome for Testing, not branded Chrome versions that remove the loading flags).

`test:packages` checks both ZIPs, icon sizes, permissions, unchanged runtime files, and the Chromium loadable folder. The optional live tests request real YouTube pages; consent screens, anti-bot checks, account variants, or network restrictions may prevent them from running. A fixture pass does not prove every live YouTube variant works.

YouTube can change its page markup, and account or layout variants may need maintenance.
