// Mythos 0X Forge — Chrome MV3 service worker.
// Adds a right-click menu item on images. When clicked, fetches the image
// bytes, posts to api.mythos0x.com/v1/analyze, and opens a notification +
// the verdict page in a new tab.

const API = 'https://api.mythos0x.com';
const SITE = 'https://mythos0x.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mythos-forge-scan',
    title: 'Scan with Mythos 0X Forge',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'mythos-forge-scan' || !info.srcUrl) return;
  await scanUrl(info.srcUrl, tab?.id);
});

async function scanUrl(srcUrl, tabId) {
  // 1. Fetch image bytes (works for cross-origin since the SW has host_permissions)
  let blob;
  try {
    notify('Mythos', 'Fetching image…', 'info');
    const r = await fetch(srcUrl, { cache: 'no-store' });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    blob = await r.blob();
  } catch (e) {
    notify('Mythos', `Couldn't fetch image: ${e.message}`, 'error');
    return;
  }

  // 2. Validate type — only images supported in v0
  if (!blob.type.startsWith('image/')) {
    notify('Mythos', 'Not an image. Right-click an image to scan.', 'error');
    return;
  }
  // Cap size at 20 MB
  if (blob.size > 20 * 1024 * 1024) {
    notify('Mythos', 'Image too large (>20 MB).', 'error');
    return;
  }

  // 3. Post to /v1/analyze
  const filename = sanitizeName(srcUrl) || 'image.jpg';
  const file = new File([blob], filename, { type: blob.type });
  const form = new FormData();
  form.append('file', file);

  notify('Mythos', 'Forge Eye scanning…', 'info');
  let result;
  try {
    const res = await fetch(`${API}/v1/analyze`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    if (res.status === 402) {
      notify(
        'Mythos — daily limit',
        'Free 3/day reached. Click to upgrade.',
        'rate',
      );
      chrome.tabs.create({ url: `${SITE}/pricing` });
      return;
    }
    if (!res.ok) throw new Error(`api ${res.status}`);
    result = await res.json();
  } catch (e) {
    notify('Mythos', `Scan failed: ${e.message}`, 'error');
    return;
  }

  // 4. Notify with verdict + open verdict page
  const pct = Math.round((result.confidence ?? 0) * 100);
  const headline =
    result.verdict === 'synthetic'
      ? `🔥 ${pct}% AI-generated`
      : result.verdict === 'suspect'
      ? `⚠️ ${pct}% suspect`
      : `✅ ${pct}% — likely authentic`;
  notify('Mythos verdict', headline, result.verdict);

  if (result.shareSlug) {
    chrome.tabs.create({ url: `${SITE}/v/${result.shareSlug}` });
  }
  void tabId; // reserved for future in-page injection
}

function sanitizeName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || 'image';
    return last.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  } catch {
    return 'image';
  }
}

function notify(title, message, kind) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: kind === 'error' ? 2 : 1,
  });
}
