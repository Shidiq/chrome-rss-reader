// UI side panel: feed list → article list → reader view.
// Readability tersedia sebagai global dari lib/readability.js (classic script).

import { parseFeed } from './common/feed-parser.js';
import { renderSanitized } from './common/sanitize.js';
import {
  getFeeds,
  addFeed,
  removeFeed,
  updateFeed,
  getItems,
  mergeItems,
  markRead,
  markAllRead,
  getUnreadCounts,
} from './common/storage.js';

// Chrome side panel host memakai ResizeObserver untuk mengukur dokumen.
// Saat konten reader render (gambar selesai load, view berganti), observer bisa
// melewati satu frame dan browser melaporkan error benign ini ke halaman.
// Spec: notifikasi tetap terkirim di frame berikutnya, tidak ada state yang rusak.
// Layout sudah dikunci di sidepanel.css; sisa noise-nya dibungkam di sini saja.
const RO_BENIGN = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;

window.addEventListener(
  'error',
  (e) => {
    if (RO_BENIGN.test(e.message || '')) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  },
  true,
);

const $ = (id) => document.getElementById(id);

const views = {
  feeds: $('view-feeds'),
  articles: $('view-articles'),
  reader: $('view-reader'),
};

// state navigasi: {name:'feeds'} | {name:'articles', feedId} | {name:'reader', feedId, item}
let current = { name: 'feeds' };

// ---------- navigasi ----------

function show(state) {
  current = state;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== state.name;
  $('btn-back').hidden = state.name === 'feeds';
  $('btn-mark-all').hidden = state.name !== 'articles';
  if (state.name === 'feeds') {
    $('topbar-title').textContent = 'Feed';
    renderFeeds();
  } else if (state.name === 'articles') {
    renderArticles(state.feedId);
  } else if (state.name === 'reader') {
    openReader(state.feedId, state.item);
  }
}

$('btn-back').addEventListener('click', () => {
  show(current.name === 'reader' ? { name: 'articles', feedId: current.feedId } : { name: 'feeds' });
});

$('btn-refresh').addEventListener('click', async () => {
  $('btn-refresh').disabled = true;
  try {
    await chrome.runtime.sendMessage({ target: 'background', type: 'refresh-all' });
    if (current.name === 'feeds') renderFeeds();
    else if (current.name === 'articles') renderArticles(current.feedId);
  } finally {
    $('btn-refresh').disabled = false;
  }
});

$('btn-mark-all').addEventListener('click', async () => {
  if (current.name !== 'articles') return;
  await markAllRead(current.feedId);
  renderArticles(current.feedId);
});

// ---------- tampilan 1: daftar feed ----------

async function renderFeeds() {
  const [feeds, { counts }] = await Promise.all([getFeeds(), getUnreadCounts()]);
  const list = $('feed-list');
  list.replaceChildren();
  $('feeds-empty').hidden = feeds.length > 0;

  for (const feed of feeds) {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = feed.title;
    main.append(title);
    if (feed.lastError) {
      const err = document.createElement('span');
      err.className = 'row-sub feed-error';
      err.textContent = `Gagal fetch: ${feed.lastError}`;
      main.append(err);
    }
    li.append(main);

    const unread = counts[feed.id] ?? 0;
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(unread);
      li.append(badge);
    }

    const del = document.createElement('button');
    del.className = 'btn-delete';
    del.title = 'Hapus feed';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Hapus feed "${feed.title}"?`)) return;
      await removeFeed(feed.id);
      renderFeeds();
    });
    li.append(del);

    li.addEventListener('click', () => show({ name: 'articles', feedId: feed.id }));
    list.append(li);
  }
}

// ---------- tambah feed ----------

const addStatus = $('add-status');

function setAddStatus(text, isError = false) {
  addStatus.hidden = !text;
  addStatus.textContent = text || '';
  addStatus.classList.toggle('error', isError);
}

$('form-add-url').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('input-url').value.trim();
  if (!url) return;
  await subscribe(url);
  $('input-url').value = '';
});

$('btn-add-tab').addEventListener('click', addFromActiveTab);

async function addFromActiveTab() {
  setAddStatus('Mencari feed di tab aktif…');
  $('feed-candidates').hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
      throw new Error('Tab aktif bukan halaman web biasa');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectFeedsInPage,
    });

    let candidates = result ?? [];
    if (candidates.length === 0) {
      setAddStatus('Tidak ada <link> feed — mencoba path umum…');
      candidates = await probeCommonPaths(tab.url);
    }

    if (candidates.length === 0) {
      setAddStatus('Feed tidak ditemukan di situs ini. Coba tempel URL feed manual.', true);
    } else if (candidates.length === 1) {
      await subscribe(candidates[0].url);
    } else {
      showCandidates(candidates);
    }
  } catch (err) {
    setAddStatus(err.message, true);
  }
}

// Dieksekusi DI DALAM halaman via chrome.scripting — tidak boleh mengacu variabel luar.
function detectFeedsInPage() {
  const links = document.querySelectorAll(
    'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="xml"]'
  );
  const seen = new Set();
  const out = [];
  for (const link of links) {
    const url = new URL(link.getAttribute('href'), document.baseURI).href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: link.getAttribute('title') || url });
  }
  return out;
}

async function probeCommonPaths(pageUrl) {
  const origin = new URL(pageUrl).origin;
  for (const path of ['/feed', '/feed/', '/rss.xml', '/atom.xml', '/index.xml', '/rss']) {
    const url = origin + path;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) continue;
      const parsed = parseFeed(await res.text());
      return [{ url, title: parsed.title || url }];
    } catch {
      // bukan feed, lanjut path berikutnya
    }
  }
  return [];
}

function showCandidates(candidates) {
  setAddStatus('Ditemukan beberapa feed — pilih satu:');
  const box = $('feed-candidates');
  box.replaceChildren();
  box.hidden = false;
  for (const c of candidates) {
    const btn = document.createElement('button');
    btn.textContent = `${c.title}\n${c.url}`;
    btn.addEventListener('click', async () => {
      box.hidden = true;
      await subscribe(c.url);
    });
    box.append(btn);
  }
}

async function subscribe(url) {
  setAddStatus(`Memvalidasi ${url}…`);
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseFeed(await res.text());
    const feed = await addFeed({ url, title: parsed.title, siteUrl: parsed.siteUrl });
    await mergeItems(feed.id, parsed.items);
    await updateFeed(feed.id, { lastFetched: Date.now() });
    setAddStatus(`✓ "${feed.title}" ditambahkan (${parsed.items.length} artikel)`);
    renderFeeds();
  } catch (err) {
    setAddStatus(`Gagal menambah feed: ${err.message}`, true);
  }
}

// ---------- tampilan 2: daftar artikel ----------

async function renderArticles(feedId) {
  const feeds = await getFeeds();
  const feed = feeds.find((f) => f.id === feedId);
  if (!feed) return show({ name: 'feeds' });
  $('topbar-title').textContent = feed.title;

  const items = await getItems(feedId);
  const list = $('article-list');
  list.replaceChildren();
  $('articles-empty').hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement('li');
    li.classList.toggle('unread', !item.read);

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = item.title || '(tanpa judul)';
    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = [formatDate(item.published), snippet(item.summary)]
      .filter(Boolean)
      .join(' · ');
    main.append(title, sub);
    li.append(main);

    li.addEventListener('click', () => show({ name: 'reader', feedId, item }));
    list.append(li);
  }
}

function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function snippet(html, max = 90) {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------- tampilan 3: reader ----------

async function openReader(feedId, item) {
  $('topbar-title').textContent = 'Artikel';
  $('reader-title').textContent = item.title || '(tanpa judul)';
  $('reader-meta').textContent = [item.author, formatDate(item.published)].filter(Boolean).join(' · ');
  $('reader-original').href = item.link;
  $('reader-content').replaceChildren();

  const status = $('reader-status');
  status.hidden = false;
  status.classList.remove('error');
  status.textContent = 'Memuat artikel…';

  markRead(feedId, item.id); // tidak perlu ditunggu

  try {
    const article = await fetchAndExtract(item.link);
    status.hidden = true;
    if (article.byline) {
      $('reader-meta').textContent = [article.byline, formatDate(item.published)]
        .filter(Boolean)
        .join(' · ');
    }
    renderSanitized($('reader-content'), article.content, item.link);
  } catch (err) {
    // Fallback: konten dari feed
    if (item.summary) {
      status.textContent = 'Ekstraksi gagal — menampilkan isi dari feed.';
      renderSanitized($('reader-content'), item.summary, item.link);
    } else {
      status.classList.add('error');
      status.textContent = `Tidak bisa memuat artikel: ${err.message}`;
    }
  }
}

async function fetchAndExtract(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Base URL agar Readability & resolusi URL relatif benar
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);
  const article = new Readability(doc).parse();
  if (!article?.content) throw new Error('Konten tidak dapat diekstrak');
  return article;
}

// ---------- init ----------

show({ name: 'feeds' });
