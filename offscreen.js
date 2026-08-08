// Offscreen document, dua tugas yang sama-sama mustahil di service worker:
//   1. parsing XML feed  — service worker tidak punya DOMParser
//   2. deteksi tema OS   — service worker tidak punya matchMedia

import { parseFeed } from './common/feed-parser.js';

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;

  if (message.type === 'parse-feed') {
    try {
      sendResponse({ ok: true, feed: parseFeed(message.xml) });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return;
  }

  if (message.type === 'get-theme') {
    sendResponse({ ok: true, dark: darkQuery.matches });
  }
});

// Service worker mungkin sedang tidur; pesan membangunkannya, dan kalaupun
// gagal terkirim, syncThemeIcon() akan menanyakan ulang saat SW bangun.
function reportTheme(dark) {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'theme-changed', dark })
    .catch(() => {});
}

darkQuery.addEventListener('change', (e) => reportTheme(e.matches));

// Beri tahu tema saat dokumen baru dibuat.
reportTheme(darkQuery.matches);
