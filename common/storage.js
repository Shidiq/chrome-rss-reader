// Helper chrome.storage.local.
// Skema:
//   feeds            : [{id, url, title, siteUrl, addedAt, lastFetched, lastError}]
//   items:<feedId>   : [{id, title, link, author, published, summary, read}]
//                      terbaru dulu, maksimal MAX_ITEMS_PER_FEED

const MAX_ITEMS_PER_FEED = 100;

export async function getFeeds() {
  const { feeds = [] } = await chrome.storage.local.get('feeds');
  return feeds;
}

export async function addFeed({ url, title, siteUrl }) {
  const feeds = await getFeeds();
  if (feeds.some((f) => f.url === url)) {
    throw new Error('Feed sudah ada');
  }
  const feed = {
    id: crypto.randomUUID(),
    url,
    title: title || url,
    siteUrl: siteUrl || '',
    addedAt: Date.now(),
    lastFetched: null,
    lastError: null,
  };
  await chrome.storage.local.set({ feeds: [...feeds, feed] });
  return feed;
}

export async function removeFeed(feedId) {
  const feeds = await getFeeds();
  await chrome.storage.local.set({ feeds: feeds.filter((f) => f.id !== feedId) });
  await chrome.storage.local.remove(itemsKey(feedId));
}

export async function updateFeed(feedId, patch) {
  const feeds = await getFeeds();
  const next = feeds.map((f) => (f.id === feedId ? { ...f, ...patch } : f));
  await chrome.storage.local.set({ feeds: next });
}

export async function getItems(feedId) {
  const key = itemsKey(feedId);
  const { [key]: items = [] } = await chrome.storage.local.get(key);
  return items;
}

// Merge item hasil fetch ke storage: item baru masuk sebagai unread,
// item lama pertahankan status read. Return jumlah item baru.
export async function mergeItems(feedId, parsedItems) {
  const existing = await getItems(feedId);
  const readById = new Map(existing.map((i) => [i.id, i.read]));
  const existingIds = new Set(existing.map((i) => i.id));

  const incoming = parsedItems.map((i) => ({ ...i, read: readById.get(i.id) ?? false }));
  const incomingIds = new Set(incoming.map((i) => i.id));
  // Pertahankan item lama yang sudah hilang dari feed (feed hanya berisi N terbaru).
  const kept = existing.filter((i) => !incomingIds.has(i.id));

  const merged = [...incoming, ...kept]
    .sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
    .slice(0, MAX_ITEMS_PER_FEED);

  await chrome.storage.local.set({ [itemsKey(feedId)]: merged });
  return incoming.filter((i) => !existingIds.has(i.id)).length;
}

export async function markRead(feedId, itemId, read = true) {
  const items = await getItems(feedId);
  const next = items.map((i) => (i.id === itemId ? { ...i, read } : i));
  await chrome.storage.local.set({ [itemsKey(feedId)]: next });
}

export async function markAllRead(feedId) {
  const items = await getItems(feedId);
  await chrome.storage.local.set({
    [itemsKey(feedId)]: items.map((i) => ({ ...i, read: true })),
  });
}

export async function getUnreadCounts() {
  const feeds = await getFeeds();
  const counts = {};
  let total = 0;
  for (const feed of feeds) {
    const items = await getItems(feed.id);
    const n = items.filter((i) => !i.read).length;
    counts[feed.id] = n;
    total += n;
  }
  return { counts, total };
}

function itemsKey(feedId) {
  return `items:${feedId}`;
}
