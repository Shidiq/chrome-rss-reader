// Service worker: polling feed berkala, merge item, badge unread.

import { getFeeds, updateFeed, mergeItems, getUnreadCounts } from './common/storage.js';

const POLL_ALARM = 'poll-feeds';
const POLL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  pollAllFeeds();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  pollAllFeeds();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollAllFeeds();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'background') return;
  if (message.type === 'refresh-all') {
    pollAllFeeds().then(() => sendResponse({ ok: true }));
    return true; // respons async
  }
  if (message.type === 'theme-changed') {
    applyThemeIcon(message.dark);
  }
});

// Badge selalu ikut isi storage — perubahan dari side panel (mark read,
// tambah/hapus feed) otomatis tercermin tanpa protokol message tambahan.
let badgeTimer = null;
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadge, 250);
});

async function pollAllFeeds() {
  const feeds = await getFeeds();
  await Promise.allSettled(feeds.map(pollFeed));
  await updateBadge();
}

async function pollFeed(feed) {
  try {
    const res = await fetch(feed.url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = await parseInOffscreen(xml);
    await mergeItems(feed.id, parsed.items);
    await updateFeed(feed.id, {
      lastFetched: Date.now(),
      lastError: null,
      title: feed.title || parsed.title,
    });
  } catch (err) {
    await updateFeed(feed.id, { lastError: err.message });
  }
}

async function parseInOffscreen(xml) {
  await ensureOffscreen();
  const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'parse-feed', xml });
  if (!reply?.ok) throw new Error(reply?.error || 'Gagal parse feed');
  return reply.feed;
}

let offscreenCreating = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER', 'MATCH_MEDIA'],
        justification:
          'Parsing XML feed RSS/Atom dan deteksi tema terang/gelap — DOMParser dan matchMedia tidak tersedia di service worker',
      })
      .finally(() => {
        offscreenCreating = null;
      });
  }
  await offscreenCreating;
}

// Chrome tidak mendukung varian icon per tema di manifest, jadi icon ditukar
// saat runtime: glif gelap untuk toolbar terang, glif putih untuk toolbar gelap.
function applyThemeIcon(dark) {
  const dir = dark ? 'dark' : 'light';
  return chrome.action.setIcon({
    path: {
      16: `icons/${dir}/16.png`,
      32: `icons/${dir}/32.png`,
      48: `icons/${dir}/48.png`,
      128: `icons/${dir}/128.png`,
    },
  });
}

// Dokumen offscreen bertahan melewati restart service worker, jadi pesan
// theme-changed miliknya tidak terkirim ulang — tanyakan langsung tiap SW bangun.
async function syncThemeIcon() {
  try {
    await ensureOffscreen();
    const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'get-theme' });
    if (reply?.ok) await applyThemeIcon(reply.dark);
  } catch {
    // biarkan icon default dari manifest
  }
}

async function updateBadge() {
  const { total } = await getUnreadCounts();
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
}

// Berjalan tiap service worker bangun, bukan hanya saat install/startup.
syncThemeIcon();
