# Mythos 0X Forge — Browser Extension (v0.1)

Right-click any image on any page → forensic AI verdict in a new tab.

## Install (developer mode, while unpublished)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this `extension/` directory
5. Pin the Mythos icon to the toolbar

## What it does

- Adds **"Scan with Mythos 0X Forge"** to the right-click menu on `<img>` elements
- Fetches the image bytes, posts to `api.mythos0x.com/v1/analyze`
- Pops a verdict notification ("⚠️ 87% suspect", etc.)
- Opens `mythos0x.com/v/<slug>` in a new tab with the full breakdown

## Behavior with your account

- If you're signed in to mythos0x.com in this browser, the scan counts against your tier limits and saves to your history.
- Otherwise it's anonymous (3 scans/day per IP).

## Icon assets

Replace `icons/icon-{16,32,48,128}.png` before publishing. Current icons are
stubs — Chrome will refuse to load the unpacked extension if these are
missing or zero-byte. Use a 128×128 base render and downscale.

## Publishing checklist (Chrome Web Store)

- [ ] Real icons (16, 32, 48, 128 PNG)
- [ ] Two screenshots (1280×800 or 640×400)
- [ ] Privacy policy URL — point to `https://mythos0x.com/privacy`
- [ ] Justify `host_permissions` (analyze + verdict pages)
- [ ] Bump `version` in manifest.json
- [ ] `cd extension && zip -r ../mythos-extension-v0.1.zip . -x '*.md'`
- [ ] Upload to https://chrome.google.com/webstore/devconsole/
