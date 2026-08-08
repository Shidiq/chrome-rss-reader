// Sanitasi HTML remote sebelum dirender di konteks extension:
// buang elemen/atribut eksekusi, absolutkan URL, dan pulihkan gambar lazy-load.

const BLOCKED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
  'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'SLOT', 'DIALOG',
]);

// Banyak situs menunda pemuatan gambar: atribut src diisi placeholder (GIF 1px,
// spacer, data: URI) sementara URL asli disimpan di atribut data-*, lalu ditukar
// oleh skrip situs. Skrip itu kita buang, jadi penukarannya dilakukan di sini.
const LAZY_SRC_ATTRS = [
  'data-pagespeed-lazy-src',
  'data-lazy-src',
  'data-src',
  'data-original',
  'data-actualsrc',
  'data-hi-res-src',
  'data-echo',
];

const LAZY_SRCSET_ATTRS = [
  'data-pagespeed-lazy-srcset',
  'data-lazy-srcset',
  'data-srcset',
];

const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster']);
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function renderSanitized(container, html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeTree(doc.body, baseUrl);
  container.replaceChildren(...doc.body.childNodes);
}

export function sanitizeTree(root, baseUrl) {
  const toRemove = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (BLOCKED_TAGS.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }

    const isMedia = el.tagName === 'IMG' || el.tagName === 'SOURCE' || el.tagName === 'VIDEO';
    if (isMedia) unlazy(el);

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name)) {
        sanitizeUrlAttr(el, attr.name, baseUrl, isMedia);
      }
    }

    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }

  for (const el of toRemove) el.remove();
}

// Promosikan URL asli dari atribut data-* ke src/srcset.
function unlazy(el) {
  for (const name of LAZY_SRCSET_ATTRS) {
    const value = el.getAttribute(name);
    if (value) {
      el.setAttribute('srcset', value);
      break;
    }
  }
  for (const name of LAZY_SRC_ATTRS) {
    const value = el.getAttribute(name);
    if (value) {
      el.setAttribute('src', value);
      break;
    }
  }
  for (const name of [...LAZY_SRC_ATTRS, ...LAZY_SRCSET_ATTRS]) {
    el.removeAttribute(name);
  }
}

function sanitizeUrlAttr(el, attrName, baseUrl, isMedia) {
  const value = el.getAttribute(attrName);
  if (!value) return;

  if (attrName.toLowerCase() === 'srcset') {
    sanitizeSrcset(el, attrName, value, baseUrl);
    return;
  }

  try {
    const abs = new URL(value, baseUrl);
    if (abs.protocol === 'data:') {
      // data:image/* aman untuk elemen media; skema data: lain dibuang.
      if (!(isMedia && /^data:image\//i.test(value.trim()))) el.removeAttribute(attrName);
      return;
    }
    if (!SAFE_PROTOCOLS.includes(abs.protocol)) {
      el.removeAttribute(attrName);
      return;
    }
    el.setAttribute(attrName, abs.href);
  } catch {
    el.removeAttribute(attrName);
  }
}

function sanitizeSrcset(el, attrName, value, baseUrl) {
  // srcset dipisah koma, tapi data: URI base64 juga mengandung koma —
  // biarkan apa adanya karena sudah absolut.
  if (/data:/i.test(value)) return;
  try {
    const rewritten = value
      .split(',')
      .map((part) => {
        const [url, ...descriptors] = part.trim().split(/\s+/);
        const abs = new URL(url, baseUrl);
        if (!SAFE_PROTOCOLS.includes(abs.protocol)) throw new Error('protokol tidak aman');
        return [abs.href, ...descriptors].join(' ');
      })
      .join(', ');
    el.setAttribute(attrName, rewritten);
  } catch {
    el.removeAttribute(attrName);
  }
}
