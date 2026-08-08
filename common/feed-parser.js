// Parser feed RSS 2.0 / Atom / RDF (RSS 1.0).
// Hanya bisa jalan di konteks yang punya DOMParser (offscreen document, side panel).

/**
 * @typedef {Object} ParsedItem
 * @property {string} id
 * @property {string} title
 * @property {string} link
 * @property {string} author
 * @property {number|null} published  epoch ms
 * @property {string} summary         HTML dari feed (belum disanitasi)
 *
 * @typedef {Object} ParsedFeed
 * @property {string} title
 * @property {string} siteUrl
 * @property {ParsedItem[]} items
 */

/**
 * @param {string} xmlText
 * @returns {ParsedFeed}
 * @throws {Error} jika bukan XML feed yang dikenali
 */
export function parseFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Bukan XML valid');
  }
  const root = doc.documentElement;
  const rootName = root.localName.toLowerCase();

  if (rootName === 'rss') return parseRss2(doc);
  if (rootName === 'feed') return parseAtom(doc);
  if (rootName === 'rdf') return parseRdf(doc);
  throw new Error(`Format feed tidak dikenali: <${rootName}>`);
}

function parseRss2(doc) {
  const channel = doc.querySelector('channel');
  if (!channel) throw new Error('RSS tanpa <channel>');
  const items = [...channel.getElementsByTagName('item')].map((item) => {
    const link = childText(item, 'link');
    return {
      id: childText(item, 'guid') || link,
      title: childText(item, 'title'),
      link,
      author: qualifiedText(item, 'dc', 'creator') || childText(item, 'author'),
      published: parseDate(childText(item, 'pubDate') || qualifiedText(item, 'dc', 'date')),
      summary: qualifiedText(item, 'content', 'encoded') || childText(item, 'description'),
    };
  });
  return {
    title: childText(channel, 'title'),
    siteUrl: childText(channel, 'link'),
    items: items.filter((i) => i.link),
  };
}

function parseAtom(doc) {
  const feed = doc.documentElement;
  const entries = [...feed.getElementsByTagName('entry')].map((entry) => {
    const link = atomLink(entry);
    return {
      id: childText(entry, 'id') || link,
      title: childText(entry, 'title'),
      link,
      author: textOf(entry.querySelector('author > name')),
      published: parseDate(childText(entry, 'published') || childText(entry, 'updated')),
      summary: childText(entry, 'content') || childText(entry, 'summary'),
    };
  });
  return {
    title: childText(feed, 'title'),
    siteUrl: atomLink(feed),
    items: entries.filter((i) => i.link),
  };
}

function parseRdf(doc) {
  const channel = doc.getElementsByTagName('channel')[0];
  const items = [...doc.getElementsByTagName('item')].map((item) => {
    const link = childText(item, 'link');
    return {
      id: item.getAttribute('rdf:about') || link,
      title: childText(item, 'title'),
      link,
      author: qualifiedText(item, 'dc', 'creator'),
      published: parseDate(qualifiedText(item, 'dc', 'date')),
      summary: qualifiedText(item, 'content', 'encoded') || childText(item, 'description'),
    };
  });
  return {
    title: channel ? childText(channel, 'title') : '',
    siteUrl: channel ? childText(channel, 'link') : '',
    items: items.filter((i) => i.link),
  };
}

// <link> Atom adalah atribut href; prioritaskan rel="alternate", lalu tanpa rel.
function atomLink(el) {
  let fallback = '';
  for (const link of el.children) {
    if (link.localName !== 'link') continue;
    const rel = link.getAttribute('rel');
    const href = link.getAttribute('href') || '';
    if (rel === 'alternate') return href;
    if (!rel && !fallback) fallback = href;
  }
  return fallback;
}

// Teks anak langsung dengan nama lokal tertentu (abaikan namespace prefix).
function childText(parent, localName) {
  for (const child of parent.children) {
    if (child.localName === localName) return textOf(child);
  }
  return '';
}

// Elemen ber-namespace seperti <content:encoded> / <dc:creator>: qualified name
// tergantung parser, jadi cocokkan prefix+localName maupun localName via NS lookup.
function qualifiedText(parent, prefix, localName) {
  const byQualified = parent.getElementsByTagName(`${prefix}:${localName}`);
  for (const el of byQualified) {
    if (el.parentNode === parent) return textOf(el);
  }
  for (const child of parent.children) {
    if (child.localName === localName && child.prefix === prefix) return textOf(child);
  }
  return '';
}

function textOf(el) {
  return el ? el.textContent.trim() : '';
}

function parseDate(str) {
  if (!str) return null;
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}
