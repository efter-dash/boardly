'use strict';
/* Boardly — a local-first visual board app. All data lives in this browser's IndexedDB. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now();

// ---------- icons ----------
const P = {
  note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  line: '<path d="M5 19L19 5"/><path d="M11 5h8v8"/>',
  board: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  column: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h6"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  sketch: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  swatch: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  template: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;

// ---------- storage (IndexedDB) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('boardly', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('boards', { keyPath: 'id' });
        d.createObjectStore('blobs', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  get(store, id) { return this.tx(store, 'readonly', s => s.get(id)); },
  put(store, v) { return this.tx(store, 'readwrite', s => s.put(v)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
};

const blobUrls = new Map();
async function putBlob(file) {
  const id = uid();
  await DB.put('blobs', { id, blob: file, name: file.name || 'file', type: file.type || '' });
  return id;
}
async function blobUrl(id) {
  if (!id) return '';
  if (blobUrls.has(id)) return blobUrls.get(id);
  const r = await DB.get('blobs', id);
  if (!r) return '';
  const u = URL.createObjectURL(r.blob);
  blobUrls.set(id, u);
  return u;
}
function hydrate(root) {
  $$('[data-blob]', root).forEach(async el => {
    const u = await blobUrl(el.dataset.blob);
    if (el.tagName === 'A') el.href = u; else el.src = u;
  });
}

// ---------- state ----------
const S = {
  boards: new Map(), board: null, sel: new Set(), selConn: null,
  view: { x: 0, y: 0, z: 1 }, editId: null, undo: [], redo: [], clip: null,
  spaceDown: false, tool: null, lineFrom: null, mouse: null, spawnN: 0,
  settings: { theme: 'system', snap: false },
};
const viewport = $('#viewport'), world = $('#world'), connSvg = $('#conns'), marquee = $('#marquee'), layer = $('#layer');

const CARD_COLORS = ['#fff3b0', '#ffd6a5', '#ffc6c6', '#f8c8e8', '#dcccff', '#c6dcff', '#c4f0d6', '#e3e3e3'];
const BOARD_COLORS = ['#9ec5ff', '#ffd27a', '#ff9f9f', '#b9a3ff', '#8fe0b5', '#ffb37a', '#f5a3d6', '#a6d8e8'];
const LINE_COLORS = ['#8b9097', '#2f6bf2', '#d93a3a', '#3aa76d', '#e08a1e', '#8a4fd8'];
const DEFAULT_W = { note: 240, heading: 360, todo: 240, link: 260, image: 280, file: 250, video: 360, board: 140, column: 270, swatch: 140, sketch: 280, comment: 240 };
const MIN_W = { board: 110, swatch: 100, heading: 120 };
const DEFAULTS = {
  note: () => ({ html: '' }),
  heading: () => ({ text: '' }),
  todo: () => ({ title: '', tasks: [{ text: '', done: false }] }),
  link: () => ({ url: '', title: '', desc: '' }),
  image: () => ({ blob: null, caption: '', ar: 0.66 }),
  file: () => ({ blob: null, name: 'file', size: 0, mime: '' }),
  video: () => ({ url: '', caption: '' }),
  board: () => ({ boardId: null }),
  column: () => ({ title: '' }),
  swatch: () => ({ hex: '#2f6bf2', name: '' }),
  sketch: () => ({ strokes: [], png: '', caption: '', ar: 0.6 }),
  comment: () => ({ text: '', author: 'You', time: now() }),
};

const itemById = (id, b = S.board) => b.items.find(i => i.id === id);
const cardEl = id => world.querySelector(`.card[data-id="${id}"]`);
const childrenOf = (colId, b = S.board) => b.items.filter(i => i.columnId === colId).sort((a, c) => a.ci - c.ci);
const topItems = (b = S.board) => b.items.filter(i => !i.columnId);
const nextZ = (b = S.board) => b.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1;

function makeItem(type, x, y, props = {}, b = S.board) {
  return { id: uid(), type, x: Math.round(x), y: Math.round(y), w: DEFAULT_W[type], color: null, z: nextZ(b), ...DEFAULTS[type](), ...props };
}
function newBoard(title, parentId, extra = {}) {
  const b = {
    id: uid(), title: title || 'Untitled board', parentId, color: BOARD_COLORS[S.boards.size % BOARD_COLORS.length],
    items: [], conns: [], view: null, created: now(), updated: now(), trashed: false, ...extra,
  };
  S.boards.set(b.id, b);
  touch(b);
  return b;
}

// ---------- saving ----------
const dirty = new Set();
let saveTimer;
function touch(b = S.board) {
  b.updated = now();
  dirty.add(b.id);
  setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
async function flushSave() {
  clearTimeout(saveTimer);
  const ids = [...dirty];
  dirty.clear();
  try {
    for (const id of ids) {
      const b = S.boards.get(id);
      if (b) await DB.put('boards', b); else await DB.del('boards', id);
    }
    setStatus('Saved locally');
  } catch (err) {
    console.error(err);
    setStatus('Save failed — storage full?');
    toast('Could not save: ' + err.message);
  }
}
function setStatus(t) { $('#saveStatus').textContent = t; }
async function saveSettings() { await DB.put('meta', { key: 'settings', value: S.settings }); }
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);

// ---------- history ----------
const snapshot = () => JSON.stringify({ items: S.board.items, conns: S.board.conns });
function checkpoint() {
  S.undo.push(snapshot());
  if (S.undo.length > 200) S.undo.shift();
  S.redo.length = 0;
}
function restore(json) {
  const d = JSON.parse(json);
  S.board.items = d.items;
  S.board.conns = d.conns;
  for (const it of S.board.items) {
    if (it.type === 'board') setTrashed(it.boardId, false);
  }
  for (const id of [...S.sel]) if (!itemById(id)) S.sel.delete(id);
  touch();
  renderBoard();
}
function undo() {
  exitEdit();
  if (!S.undo.length) return toast('Nothing to undo');
  S.redo.push(snapshot());
  restore(S.undo.pop());
}
function redo() {
  exitEdit();
  if (!S.redo.length) return toast('Nothing to redo');
  S.undo.push(snapshot());
  restore(S.redo.pop());
}

// ---------- view ----------
function screenToWorld(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - S.view.x) / S.view.z, y: (cy - r.top - S.view.y) / S.view.z };
}
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  viewport.style.backgroundSize = `${24 * z}px ${24 * z}px`;
  viewport.style.backgroundPosition = `${x}px ${y}px`;
  $('#zoomLabel').textContent = Math.round(z * 100) + '%';
  positionFormatBar();
  if (S.board) S.board.view = { ...S.view };
}
function zoomAt(cx, cy, factor) {
  const p = screenToWorld(cx, cy);
  const r = viewport.getBoundingClientRect();
  const z = clamp(S.view.z * factor, 0.1, 4);
  S.view = { x: cx - r.left - p.x * z, y: cy - r.top - p.y * z, z };
  applyView();
}
function zoomCenter(factor) {
  const r = viewport.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}
function contentBounds(items = topItems()) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const el = cardEl(it.id);
    if (!el) continue;
    minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + el.offsetWidth); maxY = Math.max(maxY, it.y + el.offsetHeight);
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function fitView(maxZoom = 1) {
  const r = viewport.getBoundingClientRect();
  const b = contentBounds();
  if (!b) { S.view = { x: 60, y: 50, z: 1 }; return applyView(); }
  const z = clamp(Math.min((r.width - 120) / b.w, (r.height - 120) / b.h, maxZoom), 0.1, 4);
  S.view = { x: (r.width - b.w * z) / 2 - b.x * z, y: (r.height - b.h * z) / 2 - b.y * z, z };
  applyView();
}
function worldRectOf(id) {
  const el = cardEl(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const p = screenToWorld(r.left, r.top);
  return { x: p.x, y: p.y, w: r.width / S.view.z, h: r.height / S.view.z };
}
function spawnPoint() {
  const r = viewport.getBoundingClientRect();
  const p = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  const n = S.spawnN++ % 8;
  return { x: p.x - 120 + n * 24, y: p.y - 80 + n * 24 };
}
function pastePoint() {
  if (S.mouse) return screenToWorld(S.mouse.x, S.mouse.y);
  return spawnPoint();
}

// ---------- rendering ----------
const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
function ytId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function embedUrl(url) {
  const y = ytId(url);
  if (y) return `https://www.youtube-nocookie.com/embed/${y}?autoplay=1`;
  const v = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (v) return `https://player.vimeo.com/video/${v[1]}?autoplay=1`;
  return null;
}
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const hashColor = s => BOARD_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % BOARD_COLORS.length];
const relTime = t => {
  const d = (now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return new Date(t).toLocaleDateString();
};

const CARD = {
  note: it => `<div class="rt note-body" data-edit="html" data-ph="Type something…">${it.html || ''}</div>
    <button class="card-btn" data-act="expand" title="Open as document">${ic('expand')}</button>`,
  heading: it => `<div class="heading-body" data-edit="text" data-ph="Heading">${esc(it.text)}</div>`,
  todo: it => {
    const done = it.tasks.filter(t => t.done).length, total = it.tasks.filter(t => t.text.trim()).length || it.tasks.length;
    return `<div class="todo-title" data-edit="title" data-ph="To-do list">${esc(it.title)}</div>
      <div class="todo-progress"><span style="width:${total ? Math.round(done / total * 100) : 0}%"></span></div>
      <ul class="tasks">${it.tasks.map((t, i) => `<li class="task ${t.done ? 'done' : ''}"><button class="chk" data-act="toggle" data-i="${i}" title="Toggle"></button><span data-edit="task" data-i="${i}" data-ph="Task">${esc(t.text)}</span></li>`).join('')}</ul>
      <button class="add-task" data-act="addtask">+ Add task</button>`;
  },
  link: it => {
    const d = domainOf(it.url);
    return `<div class="link-top"><div class="favicon" style="background:${hashColor(d)}">${esc((d[0] || '?').toUpperCase())}</div><div class="link-domain">${esc(d)}</div></div>
      <a class="card-btn" data-act="openlink" title="Open link" href="${esc(it.url)}" target="_blank" rel="noopener">${ic('external')}</a>
      <div class="link-title" data-edit="title" data-ph="Title">${esc(it.title)}</div>
      <div class="link-desc" data-edit="desc" data-ph="Add a description">${esc(it.desc)}</div>
      <div class="link-url" data-edit="url" data-ph="https://">${esc(it.url)}</div>`;
  },
  image: it => `<img data-blob="${esc(it.blob)}" alt="" draggable="false" style="aspect-ratio:${1 / (it.ar || 0.66)}">
    <div class="caption" data-edit="caption" data-ph="Add a caption">${esc(it.caption)}</div>`,
  sketch: it => `${it.png ? `<img src="${it.png}" alt="" draggable="false" style="aspect-ratio:${1 / (it.ar || 0.6)}">` : '<div class="sketch-empty">Double-click to draw</div>'}
    <button class="card-btn" data-act="sketch" title="Edit drawing">${ic('sketch')}</button>
    <div class="caption" data-edit="caption" data-ph="Add a caption">${esc(it.caption)}</div>`,
  file: it => {
    const ext = (it.name.split('.').pop() || 'file').slice(0, 4);
    const media = it.mime.startsWith('audio/') ? `<audio controls data-blob="${esc(it.blob)}"></audio>`
      : it.mime.startsWith('video/') ? `<video controls data-blob="${esc(it.blob)}"></video>` : '';
    return `<div class="file-row"><div class="file-ext">${esc(ext)}</div><div><div class="file-name">${esc(it.name)}</div><div class="muted">${fmtSize(it.size)}</div></div></div>
      <button class="card-btn" data-act="download" title="Download">${ic('download')}</button>${media}`;
  },
  video: it => {
    const y = ytId(it.url);
    return `<div class="video-bar">${ic('video')}<span>${esc(domainOf(it.url))}</span></div>
      <div class="video-frame">${y ? `<img src="https://i.ytimg.com/vi/${y}/hqdefault.jpg" alt="" draggable="false">` : ''}
      <button class="video-play" data-act="play" title="Play">${ic('play')}</button></div>
      <a class="card-btn" data-act="openlink" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open video">${ic('external')}</a>
      <div class="caption" data-edit="caption" data-ph="Add a caption">${esc(it.caption)}</div>`;
  },
  board: it => {
    const b = S.boards.get(it.boardId);
    const n = b ? b.items.length : 0;
    return `<div class="board-tile" style="background:${b ? b.color : '#ccc'}">${ic('board')}</div>
      <div class="board-name">${esc(b ? b.title : 'Missing board')}</div><div class="muted">${n} card${n === 1 ? '' : 's'}</div>`;
  },
  column: it => `<div class="col-head"><div class="col-title" data-edit="title" data-ph="Column title">${esc(it.title)}</div><span class="col-count">${childrenOf(it.id).length}</span></div><div class="col-body"></div>`,
  swatch: it => `<div class="swatch-color" data-act="pickcolor" style="background:${esc(it.hex)}" title="Pick colour"></div>
    <div class="swatch-hex" data-edit="hex">${esc(it.hex)}</div><div class="swatch-name" data-edit="name" data-ph="Name">${esc(it.name)}</div>`,
  comment: it => `<div class="cm-head"><span class="avatar">${esc((it.author || 'Y')[0].toUpperCase())}</span><b>${esc(it.author || 'You')}</b><span class="cm-time">${relTime(it.time)}</span></div>
    <div class="cm-text" data-edit="text" data-ph="Write a comment…">${esc(it.text)}</div>`,
};

function renderItem(it) {
  const el = document.createElement('div');
  el.className = `card t-${it.type}`;
  el.dataset.id = it.id;
  if (!it.columnId) {
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    el.style.zIndex = it.z;
  }
  if (it.w) el.style.width = it.w + 'px';
  if (it.color) { el.classList.add('has-color'); el.style.setProperty('--card-accent', it.color); }
  el.innerHTML = CARD[it.type](it) + '<div class="handle-connect" title="Drag to connect"></div>' + (it.type === 'board' ? '' : '<div class="handle-resize"></div>');
  if (it.type === 'column') {
    const body = $('.col-body', el);
    for (const c of childrenOf(it.id)) body.appendChild(renderItem(c));
  }
  if (S.sel.has(it.id)) el.classList.add('selected');
  hydrate(el);
  return el;
}
function renderBoard() {
  if (S.editId) exitEdit();
  $$('.card', world).forEach(e => e.remove());
  for (const it of topItems().sort((a, c) => a.z - c.z)) world.appendChild(renderItem(it));
  renderConns();
  renderCrumbs();
  updateEmptyHint();
}
function refreshItem(it, focusSel) {
  const old = cardEl(it.id);
  if (!old) return;
  const editing = S.editId === it.id;
  const el = renderItem(it);
  old.replaceWith(el);
  if (editing) {
    el.classList.add('editing');
    ownFields(el).forEach(f => f.setAttribute('contenteditable', f.dataset.edit === 'html' ? 'true' : 'plaintext-only'));
    const f = (focusSel && $(focusSel, el)) || ownFields(el)[0];
    if (f) { f.focus({ preventScroll: true }); caretEnd(f); }
  }
  if (it.columnId) {
    const col = cardEl(it.columnId);
    if (col) $('.col-count', col).textContent = childrenOf(it.columnId).length;
  }
  renderConnsSoon();
}
function updateEmptyHint() { $('#emptyHint').style.display = S.board.items.length ? 'none' : 'block'; }
function syncSelection() {
  $$('.card', world).forEach(el => el.classList.toggle('selected', S.sel.has(el.dataset.id)));
}

// connections
function edgePoint(r, toward) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? (r.w / 2 + 6) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + 6) / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}
function connPoints(c) {
  const a = worldRectOf(c.from), b = worldRectOf(c.to);
  if (!a || !b) return null;
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [edgePoint(a, cb), edgePoint(b, ca)];
}
function renderConns() {
  if (!S.board) return;
  const colors = [...new Set(S.board.conns.map(c => c.color || LINE_COLORS[0]))];
  let defs = '<defs>' + colors.map((col, i) => `<marker id="arr${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`).join('') + '</defs>';
  let html = '';
  for (const c of S.board.conns) {
    const p = connPoints(c);
    if (!p) continue;
    const [a, b] = p;
    const col = c.color || LINE_COLORS[0];
    const m = `url(#arr${colors.indexOf(col)})`;
    const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    html += `<g class="conn ${S.selConn === c.id ? 'sel' : ''}"><path class="conn-line" d="${d}" stroke="${col}" ${c.arrow !== false ? `marker-end="${m}"` : ''}/>
      <path class="conn-hit" data-cid="${c.id}" d="${d}"/>${c.label ? `<text class="conn-label" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2}">${esc(c.label)}</text>` : ''}</g>`;
  }
  connSvg.innerHTML = defs + html;
}
let connRaf = 0;
function renderConnsSoon() {
  if (connRaf) return;
  connRaf = requestAnimationFrame(() => { connRaf = 0; renderConns(); });
}
function addConn(from, to) {
  if (from === to) return;
  if (S.board.conns.some(c => (c.from === from && c.to === to) || (c.from === to && c.to === from))) return toast('Those cards are already connected');
  checkpoint();
  S.board.conns.push({ id: uid(), from, to, arrow: true, label: '', color: null });
  touch();
  renderConns();
}

// breadcrumbs
function renderCrumbs() {
  const chain = [];
  for (let b = S.board; b; b = S.boards.get(b.parentId)) chain.unshift(b);
  const nav = $('#crumbs');
  nav.innerHTML = chain.map((b, i) => i === chain.length - 1
    ? `<span class="crumb-current" contenteditable="plaintext-only" spellcheck="false" title="Rename board">${esc(b.title)}</span>`
    : `<a data-board="${b.id}">${esc(b.title)}</a><span class="sep">/</span>`).join('');
  document.title = `${S.board.title} — Boardly`;
}
$('#crumbs').addEventListener('click', e => {
  const a = e.target.closest('[data-board]');
  if (a) openBoard(a.dataset.board);
});
$('#crumbs').addEventListener('input', e => {
  if (!e.target.classList.contains('crumb-current')) return;
  S.board.title = e.target.innerText.trim() || 'Untitled board';
  document.title = `${S.board.title} — Boardly`;
  touch();
});
$('#crumbs').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
});

// ---------- boards ----------
function openBoard(id, focusId) {
  const b = S.boards.get(id);
  if (!b || b.trashed) return toast('That board is not available');
  exitEdit();
  cancelTool();
  S.board = b;
  S.sel.clear();
  S.selConn = null;
  S.undo = [];
  S.redo = [];
  renderBoard();
  if (b.view) { S.view = { ...b.view }; applyView(); } else fitView();
  if (focusId) focusItem(focusId);
  const h = id === 'home' ? '' : '#' + id;
  if (location.hash !== h) history.pushState(null, '', h || location.pathname);
  S.settings.lastBoard = id;
  saveSettings();
}
window.addEventListener('popstate', () => openBoard(location.hash.slice(1) || 'home'));
function focusItem(id) {
  const it = itemById(id);
  if (!it) return;
  const r = worldRectOf(id);
  if (!r) return;
  const vr = viewport.getBoundingClientRect();
  const z = Math.max(S.view.z, 0.8);
  S.view = { x: vr.width / 2 - (r.x + r.w / 2) * z, y: vr.height / 2 - (r.y + r.h / 2) * z, z };
  applyView();
  selectOnly(id);
  const el = cardEl(id);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function descendants(id, out = []) {
  for (const b of S.boards.values()) if (b.parentId === id) { out.push(b); descendants(b.id, out); }
  return out;
}
function setTrashed(id, val) {
  const b = S.boards.get(id);
  if (!b || b.trashed === val) return;
  for (const x of [b, ...descendants(id)]) { x.trashed = val; if (val) x.trashedAt = now(); touch(x); }
}
function copyBoardDeep(srcId, parentId) {
  const src = S.boards.get(srcId);
  if (!src) return null;
  const nb = { ...structuredClone(src), id: uid(), parentId, trashed: false, created: now(), updated: now() };
  S.boards.set(nb.id, nb);
  for (const it of nb.items) if (it.type === 'board') it.boardId = copyBoardDeep(it.boardId, nb.id);
  touch(nb);
  return nb.id;
}

// ---------- selection ----------
function selectOnly(id) {
  S.sel = new Set(id ? [id] : []);
  if (S.selConn) { S.selConn = null; renderConns(); }
  syncSelection();
}
function toggleSel(id) {
  S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
  syncSelection();
}
function clearSelection() {
  S.sel.clear();
  if (S.selConn) { S.selConn = null; renderConns(); }
  syncSelection();
}
function selectConn(id) {
  S.sel.clear();
  S.selConn = id;
  syncSelection();
  renderConns();
}

// ---------- editing ----------
function ownFields(el) { return $$('[data-edit]', el).filter(f => f.closest('.card') === el); }
function caretEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
function enterEdit(el, opt = {}) {
  const it = itemById(el.dataset.id);
  if (!it) return;
  const fields = ownFields(el);
  if (!fields.length) return;
  if (S.editId && S.editId !== it.id) exitEdit();
  if (S.editId !== it.id) {
    if (!opt.noCheckpoint) checkpoint();
    S.editId = it.id;
  }
  el.classList.add('editing');
  fields.forEach(f => f.setAttribute('contenteditable', f.dataset.edit === 'html' ? 'true' : 'plaintext-only'));
  let target = opt.focus ? $(opt.focus, el) : opt.target?.closest?.('[data-edit]');
  if (!target || !fields.includes(target)) target = fields[0];
  target.focus({ preventScroll: true });
  const ev = opt.event;
  const range = ev && document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
  if (range && target.contains(range.startContainer)) {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  } else caretEnd(target);
  showFormatBar();
}
function exitEdit() {
  if (!S.editId) return;
  const id = S.editId;
  S.editId = null;
  hideFormatBar();
  const el = cardEl(id), it = itemById(id);
  if (el) {
    el.classList.remove('editing');
    ownFields(el).forEach(f => f.removeAttribute('contenteditable'));
  }
  getSelection().removeAllRanges();
  if (!it) return;
  if (it._new) {
    delete it._new;
    if (it.type === 'note' && !plainText(it.html).trim() && !/<img/i.test(it.html)) {
      S.board.items = S.board.items.filter(i => i !== it);
      S.undo.pop();
      el?.remove();
      updateEmptyHint();
      return;
    }
  }
  if (S.undo.length && S.undo[S.undo.length - 1] === snapshot()) S.undo.pop();
  normalizeItem(it);
  refreshItem(it);
}
function normalizeItem(it) {
  if (it.type === 'swatch') it.hex = normHex(it.hex) || '#888888';
  if (it.type === 'link' && it.url && !/^[a-z]+:/i.test(it.url)) it.url = 'https://' + it.url.trim();
  if (it.type === 'todo' && it.tasks.length > 1) it.tasks = it.tasks.filter((t, i) => t.text.trim() || i === it.tasks.length - 1);
}
function normHex(s) {
  let h = String(s || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
}
function plainText(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.innerText || d.textContent || '';
}
function commitField(f) {
  const el = f.closest('.card');
  const it = el && itemById(el.dataset.id);
  if (!it) return;
  const k = f.dataset.edit;
  if (k === 'html') it.html = f.innerHTML;
  else if (k === 'task') it.tasks[+f.dataset.i].text = f.innerText.replace(/\n+$/, '');
  else it[k] = f.innerText.replace(/\n$/, '');
  if (it.type === 'swatch' && k === 'hex') {
    const h = normHex(f.innerText);
    if (h) $('.swatch-color', el).style.background = h;
  }
  if (it.type === 'column' && k === 'title') { /* nothing else to sync */ }
  touch();
  renderConnsSoon();
  positionFormatBar();
}
world.addEventListener('input', e => {
  const f = e.target.closest('[data-edit]');
  if (f) commitField(f);
});

// format bar
const FMT = [
  ['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['underline', '<u>U</u>', 'Underline'], ['strikeThrough', '<s>S</s>', 'Strikethrough'], '|',
  ['h1', 'H1', 'Large heading'], ['h2', 'H2', 'Heading'], ['p', '¶', 'Normal text'], '|',
  ['insertUnorderedList', '•', 'Bullet list'], ['insertOrderedList', '1.', 'Numbered list'], ['quote', '❝', 'Quote'], '|',
  ['link', '🔗', 'Link'], ['hilite', '<span style="background:#fde68a;color:#000;padding:0 3px">A</span>', 'Highlight'], ['code', '&lt;/&gt;', 'Code'], ['removeFormat', '⌫', 'Clear formatting'],
];
function makeFmtBar(onChange) {
  const bar = document.createElement('div');
  bar.className = 'fmt-bar';
  bar.innerHTML = FMT.map(f => f === '|' ? '<span class="fsep"></span>' : `<button data-cmd="${f[0]}" title="${f[2]}">${f[1]}</button>`).join('');
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('pointerdown', e => e.stopPropagation());
  bar.addEventListener('click', async e => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    document.execCommand('styleWithCSS', false, false);
    if (cmd === 'h1' || cmd === 'h2' || cmd === 'p') document.execCommand('formatBlock', false, cmd);
    else if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    else if (cmd === 'hilite') document.execCommand('hiliteColor', false, '#fde68a');
    else if (cmd === 'code') {
      const t = getSelection().toString();
      if (t) document.execCommand('insertHTML', false, `<code>${esc(t)}</code>`);
    } else if (cmd === 'link') {
      const sel = getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const url = await askText('Add link', 'https://example.com');
      if (!url || !range) return;
      const active = range.startContainer.parentElement?.closest('[contenteditable]');
      active?.focus();
      sel.removeAllRanges();
      sel.addRange(range);
      const href = /^[a-z]+:/i.test(url) ? url : 'https://' + url;
      if (range.collapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(url)}</a>`);
      else document.execCommand('createLink', false, href);
    } else document.execCommand(cmd, false, null);
    onChange();
  });
  return bar;
}
let fmtBar = null;
function showFormatBar() {
  const f = document.activeElement;
  if (!f || f.dataset?.edit !== 'html') return hideFormatBar();
  if (!fmtBar) {
    fmtBar = makeFmtBar(() => {
      const a = document.activeElement;
      if (a?.dataset?.edit) commitField(a);
    });
    layer.appendChild(fmtBar);
  }
  fmtBar.style.display = 'flex';
  positionFormatBar();
}
function hideFormatBar() { if (fmtBar) fmtBar.style.display = 'none'; }
function positionFormatBar() {
  if (!fmtBar || fmtBar.style.display === 'none' || !S.editId) return;
  const el = cardEl(S.editId);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const top = r.top - 46 < 58 ? r.bottom + 8 : r.top - 46;
  fmtBar.style.left = clamp(r.left, 84, window.innerWidth - fmtBar.offsetWidth - 8) + 'px';
  fmtBar.style.top = top + 'px';
}

// ---------- creating ----------
function addItem(type, pos, props = {}, edit = false) {
  checkpoint();
  const it = makeItem(type, pos.x, pos.y, props);
  if (S.settings.snap) { it.x = Math.round(it.x / 24) * 24; it.y = Math.round(it.y / 24) * 24; }
  S.board.items.push(it);
  touch();
  world.appendChild(renderItem(it));
  selectOnly(it.id);
  updateEmptyHint();
  if (edit) {
    if (type === 'note') it._new = true;
    enterEdit(cardEl(it.id), { noCheckpoint: true });
  }
  return it;
}
function randomColor() {
  const h = Math.floor(Math.random() * 360);
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = `hsl(${h} 65% 58%)`;
  return c.fillStyle;
}
async function createByTool(type, pos) {
  pos = pos || spawnPoint();
  switch (type) {
    case 'line':
      cancelTool();
      S.tool = 'line';
      viewport.classList.add('tool-line');
      $('.tool[data-tool="line"]')?.classList.add('active');
      return toast('Click the first card, then the card to connect it to. Esc cancels.');
    case 'image':
    case 'upload':
      return pickFiles(type === 'image' ? 'image/*' : '', files => addFiles(files, pos));
    case 'link': {
      const url = await askText('Add a link', 'Paste a web address');
      if (url) addUrlCard(url, pos);
      return;
    }
    case 'video': {
      const url = await askText('Add a video', 'YouTube or Vimeo address');
      if (url) addUrlCard(url, pos);
      return;
    }
    case 'board': {
      const name = await askText('New board', 'Board name', '');
      if (name === null) return;
      const nb = newBoard(name || 'Untitled board', S.board.id);
      return addItem('board', pos, { boardId: nb.id });
    }
    case 'template': return openTemplates(pos);
    case 'sketch': {
      const it = addItem('sketch', pos);
      return openSketch(it, true);
    }
    case 'swatch': return addItem('swatch', pos, { hex: randomColor() }, true);
    case 'comment': return addItem('comment', pos, { time: now() }, true);
    default: return addItem(type, pos, {}, true);
  }
}
function cancelTool() {
  S.tool = null;
  if (S.lineFrom) cardEl(S.lineFrom)?.classList.remove('line-from');
  S.lineFrom = null;
  viewport.classList.remove('tool-line');
  $$('.tool.active').forEach(t => t.classList.remove('active'));
}
function normUrl(s) {
  s = s.trim();
  return /^[a-z]+:\/\//i.test(s) ? s : 'https://' + s;
}
const looksLikeUrl = s => /^(https?:\/\/|www\.)\S+$/i.test(s.trim()) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s.trim());
function addUrlCard(raw, pos) {
  const url = normUrl(raw);
  if (embedUrl(url)) return addItem('video', pos, { url });
  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(url)) return addRemoteImage(url, pos);
  return addItem('link', pos, { url, title: domainOf(url) });
}
async function addRemoteImage(url, pos) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    const name = url.split('/').pop().split('?')[0] || 'image';
    return addFiles([new File([blob], name, { type: blob.type })], pos);
  } catch {
    return addItem('link', pos, { url, title: domainOf(url) });
  }
}
function imageSize(blob) {
  return new Promise(res => {
    const u = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { res({ w: im.naturalWidth || 300, h: im.naturalHeight || 200 }); URL.revokeObjectURL(u); };
    im.onerror = () => { res({ w: 300, h: 200 }); URL.revokeObjectURL(u); };
    im.src = u;
  });
}
async function addFiles(files, pos) {
  let i = 0;
  for (const f of files) {
    const p = { x: pos.x + i * 28, y: pos.y + i * 28 };
    i++;
    try {
      const id = await putBlob(f);
      if (f.type.startsWith('image/')) {
        const d = await imageSize(f);
        addItem('image', p, { blob: id, ar: d.h / d.w, w: clamp(d.w, 140, 320) });
      } else {
        addItem('file', p, { blob: id, name: f.name || 'file', size: f.size, mime: f.type || '' });
      }
    } catch (err) {
      toast(`Could not store ${f.name}: ${err.message}`);
    }
  }
}
function pickFiles(accept, cb) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  if (accept) inp.accept = accept;
  inp.onchange = () => { if (inp.files.length) cb([...inp.files]); };
  inp.click();
}

// ---------- deleting / duplicating / clipboard ----------
function deleteSelection() {
  if (S.selConn) {
    checkpoint();
    S.board.conns = S.board.conns.filter(c => c.id !== S.selConn);
    S.selConn = null;
    touch();
    return renderConns();
  }
  if (!S.sel.size) return;
  checkpoint();
  const ids = new Set(S.sel);
  for (const it of S.board.items) if (it.columnId && ids.has(it.columnId)) ids.add(it.id);
  for (const id of ids) {
    const it = itemById(id);
    if (it?.type === 'board') setTrashed(it.boardId, true);
  }
  S.board.items = S.board.items.filter(i => !ids.has(i.id));
  S.board.conns = S.board.conns.filter(c => !ids.has(c.from) && !ids.has(c.to));
  S.sel.clear();
  touch();
  renderBoard();
  if ([...ids].some(id => id)) toast(`Deleted ${ids.size} card${ids.size > 1 ? 's' : ''} — Ctrl/⌘ Z to undo`);
}
function serializeSel() {
  const ids = new Set(S.sel);
  for (const it of S.board.items) if (it.columnId && ids.has(it.columnId)) ids.add(it.id);
  const items = [];
  for (const id of ids) {
    const it = itemById(id);
    if (!it) continue;
    const copy = structuredClone(it);
    if (copy.columnId && !ids.has(copy.columnId)) {
      const r = worldRectOf(id);
      copy.columnId = null;
      Object.assign(copy, { x: r.x, y: r.y, w: Math.round(r.w) });
    }
    items.push(copy);
  }
  const conns = S.board.conns.filter(c => ids.has(c.from) && ids.has(c.to)).map(c => structuredClone(c));
  return { key: uid(), items, conns };
}
function pasteClip(clip, at) {
  if (!clip?.items.length) return;
  checkpoint();
  const map = new Map(clip.items.map(i => [i.id, uid()]));
  const tops = clip.items.filter(i => !i.columnId);
  const minX = Math.min(...tops.map(i => i.x)), minY = Math.min(...tops.map(i => i.y));
  const dx = at ? at.x - minX : 30, dy = at ? at.y - minY : 30;
  let z = nextZ();
  const fresh = [];
  for (const src of clip.items) {
    const it = structuredClone(src);
    it.id = map.get(src.id);
    if (it.columnId) it.columnId = map.get(it.columnId);
    else { it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy); it.z = z++; }
    if (it.type === 'board') it.boardId = copyBoardDeep(src.boardId, S.board.id);
    fresh.push(it);
  }
  S.board.items.push(...fresh);
  S.board.conns.push(...clip.conns.map(c => ({ ...c, id: uid(), from: map.get(c.from), to: map.get(c.to) })));
  S.sel = new Set(fresh.filter(i => !i.columnId).map(i => i.id));
  touch();
  renderBoard();
  return fresh;
}
function duplicateSelection() {
  if (!S.sel.size) return;
  pasteClip(serializeSel(), null);
}
const CLIP_MARK = '⟦boardly-cards⟧';
function isTypingTarget(t) {
  return t && (t.matches?.('input, textarea, select') || t.isContentEditable);
}
document.addEventListener('copy', e => {
  if (S.editId || isTypingTarget(e.target) || !S.sel.size || modalOpen()) return;
  S.clip = serializeSel();
  const text = S.clip.items.map(itemText).filter(Boolean).join('\n\n');
  e.clipboardData.setData('text/plain', `${CLIP_MARK}${S.clip.key}\n${text}`);
  e.preventDefault();
  toast(`Copied ${S.clip.items.length} card${S.clip.items.length > 1 ? 's' : ''}`);
});
document.addEventListener('cut', e => {
  if (S.editId || isTypingTarget(e.target) || !S.sel.size || modalOpen()) return;
  S.clip = serializeSel();
  e.clipboardData.setData('text/plain', `${CLIP_MARK}${S.clip.key}\n` + S.clip.items.map(itemText).join('\n\n'));
  e.preventDefault();
  // keep boards that were cut alive for pasting: copyBoardDeep reads trashed boards too
  deleteSelection();
});
document.addEventListener('paste', e => {
  if (modalOpen()) return;
  if (S.editId) {
    const active = document.activeElement;
    if (active?.dataset?.edit) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (text.startsWith(CLIP_MARK)) return;
      document.execCommand('insertText', false, text);
    }
    return;
  }
  if (isTypingTarget(e.target)) return;
  e.preventDefault();
  const pos = pastePoint();
  const files = [...e.clipboardData.files];
  if (files.length) return addFiles(files, pos);
  const text = e.clipboardData.getData('text/plain');
  if (text.startsWith(CLIP_MARK)) {
    if (S.clip && text.slice(CLIP_MARK.length).startsWith(S.clip.key)) pasteClip(S.clip, pos);
    return;
  }
  if (!text.trim()) return;
  if (looksLikeUrl(text)) return addUrlCard(text, pos);
  const html = esc(text.trim()).split(/\n/).map(l => `<div>${l || '<br>'}</div>`).join('');
  addItem('note', pos, { html });
});

function itemText(it) {
  switch (it.type) {
    case 'note': return plainText(it.html);
    case 'heading': return it.text;
    case 'todo': return [it.title, ...it.tasks.map(t => (t.done ? '[x] ' : '[ ] ') + t.text)].join('\n');
    case 'link': return [it.title, it.desc, it.url].filter(Boolean).join('\n');
    case 'column': return it.title;
    case 'comment': return it.text;
    case 'swatch': return `${it.hex} ${it.name || ''}`.trim();
    case 'file': return it.name;
    case 'image': case 'sketch': return it.caption || '';
    case 'video': return [it.caption, it.url].filter(Boolean).join('\n');
    case 'board': return S.boards.get(it.boardId)?.title || '';
    default: return '';
  }
}

// ---------- pointer interaction ----------
let drag = null;
document.addEventListener('pointerdown', e => {
  if (S.editId && !e.target.closest('.card.editing, .fmt-bar, .backdrop')) exitEdit();
}, true);

viewport.addEventListener('pointerdown', e => {
  hideMenu();
  if (e.button === 2) return;
  const t = e.target;
  if (e.button === 1 || S.spaceDown) return startPan(e);
  const card = t.closest('.card');
  if (S.tool === 'line') {
    e.preventDefault();
    if (!card) return cancelTool();
    const id = card.dataset.id;
    if (!S.lineFrom) { S.lineFrom = id; card.classList.add('line-from'); }
    else if (id !== S.lineFrom) { addConn(S.lineFrom, id); cancelTool(); }
    return;
  }
  const hit = t.closest('.conn-hit');
  if (hit) { e.preventDefault(); return selectConn(hit.dataset.cid); }
  if (!card) {
    if (!e.shiftKey) clearSelection();
    return startMarquee(e);
  }
  if (card.classList.contains('editing') && t.closest('[data-edit], a, input')) return;
  if (t.closest('.handle-resize')) return startResize(e, card);
  if (t.closest('.handle-connect')) return startConnect(e, card);
  if (t.closest('[data-act], audio, video, iframe')) return;
  const id = card.dataset.id;
  if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSel(id);
  else if (!S.sel.has(id)) selectOnly(id);
  drag = { mode: 'pending', sx: e.clientX, sy: e.clientY, card, id, target: t, shift: e.shiftKey || e.metaKey || e.ctrlKey };
  e.preventDefault();
});

function startPan(e) {
  e.preventDefault();
  drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
  document.body.classList.add('is-panning');
}
function startMarquee(e) {
  drag = { mode: 'marquee', sx: e.clientX, sy: e.clientY, base: new Set(e.shiftKey ? S.sel : []), moved: false };
}
function startResize(e, card) {
  e.preventDefault();
  e.stopPropagation();
  checkpoint();
  const it = itemById(card.dataset.id);
  drag = { mode: 'resize', it, el: card, sx: e.clientX, ow: card.offsetWidth };
}
function startConnect(e, card) {
  e.preventDefault();
  drag = { mode: 'connect', from: card.dataset.id };
}

function beginMove() {
  checkpoint();
  let detached = false;
  for (const id of S.sel) {
    const it = itemById(id);
    if (it?.columnId) {
      const r = worldRectOf(id);
      Object.assign(it, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), columnId: null });
      detached = true;
    }
  }
  let z = nextZ();
  const items = [...S.sel].map(id => itemById(id)).filter(Boolean);
  for (const it of items) it.z = z++;
  if (detached) renderBoard();
  drag.mode = 'move';
  drag.items = items.map(it => ({ it, ox: it.x, oy: it.y, el: cardEl(it.id) }));
  drag.items.forEach(d => { d.el.style.zIndex = d.it.z; });
  document.body.classList.add('dragging');
}

window.addEventListener('pointermove', e => {
  if (e.target.closest?.('#viewport')) S.mouse = { x: e.clientX, y: e.clientY };
  if (!drag) return;
  const z = S.view.z;
  switch (drag.mode) {
    case 'pending':
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      beginMove();
    // falls through
    case 'move': {
      const dx = (e.clientX - drag.sx) / z, dy = (e.clientY - drag.sy) / z;
      for (const d of drag.items) {
        let x = d.ox + dx, y = d.oy + dy;
        if (S.settings.snap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
        d.it.x = Math.round(x);
        d.it.y = Math.round(y);
        d.el.style.left = d.it.x + 'px';
        d.el.style.top = d.it.y + 'px';
      }
      highlightDrop(e);
      renderConnsSoon();
      break;
    }
    case 'pan':
      S.view.x = drag.vx + e.clientX - drag.sx;
      S.view.y = drag.vy + e.clientY - drag.sy;
      applyView();
      break;
    case 'marquee': {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      const vr = viewport.getBoundingClientRect();
      const x1 = Math.min(drag.sx, e.clientX), y1 = Math.min(drag.sy, e.clientY);
      const x2 = Math.max(drag.sx, e.clientX), y2 = Math.max(drag.sy, e.clientY);
      Object.assign(marquee.style, { display: 'block', left: x1 - vr.left + 'px', top: y1 - vr.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const a = screenToWorld(x1, y1), b = screenToWorld(x2, y2);
      S.sel = new Set(drag.base);
      for (const it of topItems()) {
        const el = cardEl(it.id);
        if (!el) continue;
        if (it.x < b.x && it.x + el.offsetWidth > a.x && it.y < b.y && it.y + el.offsetHeight > a.y) S.sel.add(it.id);
      }
      syncSelection();
      break;
    }
    case 'resize': {
      const w = Math.round(clamp(drag.ow + (e.clientX - drag.sx) / z, MIN_W[drag.it.type] || 140, 1800));
      drag.it.w = w;
      drag.el.style.width = w + 'px';
      renderConnsSoon();
      positionFormatBar();
      break;
    }
    case 'connect': {
      const a = worldRectOf(drag.from);
      const p = screenToWorld(e.clientX, e.clientY);
      const start = edgePoint(a, p);
      let tmp = $('.conn-temp', connSvg);
      if (!tmp) { tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tmp.setAttribute('class', 'conn-temp'); connSvg.appendChild(tmp); }
      tmp.setAttribute('d', `M${start.x},${start.y} L${p.x},${p.y}`);
      $$('.connect-target').forEach(x => x.classList.remove('connect-target'));
      cardUnder(e, drag.from)?.classList.add('connect-target');
      break;
    }
  }
});

window.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging', 'is-panning');
  switch (d.mode) {
    case 'pending': {
      const it = itemById(d.id);
      if (!it || d.shift) return;
      selectOnly(d.id);
      if (it.type === 'board') return openBoard(it.boardId);
      if (['note', 'heading', 'comment'].includes(it.type) || d.target.closest('[data-edit]')) enterEdit(d.card, { event: e, target: d.target });
      return;
    }
    case 'move': {
      const drop = dropTarget(e, d.items);
      clearDropHighlight();
      if (drop) insertIntoColumn(drop.col, d.items.map(x => x.it), drop.index);
      touch();
      renderConns();
      return;
    }
    case 'marquee':
      marquee.style.display = 'none';
      return;
    case 'resize':
      touch();
      return;
    case 'pan':
      touch();
      return;
    case 'connect': {
      $('.conn-temp', connSvg)?.remove();
      $$('.connect-target').forEach(x => x.classList.remove('connect-target'));
      const target = cardUnder(e, d.from);
      if (target) addConn(d.from, target.dataset.id);
      return;
    }
  }
});

function cardUnder(e, excludeId) {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const c = el.closest?.('.card');
    if (c && c.dataset.id !== excludeId && !c.closest(`.card[data-id="${excludeId}"]`)) return c;
  }
  return null;
}
function dropTarget(e, dragged) {
  const moving = new Set(dragged.map(x => x.it.id));
  if (dragged.some(x => x.it.type === 'column')) return null;
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const col = el.closest?.('.t-column');
    if (!col || moving.has(col.dataset.id)) continue;
    const kids = $$(':scope > .col-body > .card', col).filter(k => !moving.has(k.dataset.id));
    let index = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    return { col: itemById(col.dataset.id), el: col, index, kids };
  }
  return null;
}
function highlightDrop(e) {
  clearDropHighlight();
  const t = dropTarget(e, drag.items);
  if (!t) return;
  t.el.classList.add('drop-target');
  const line = document.createElement('div');
  line.className = 'drop-line';
  const body = $(':scope > .col-body', t.el);
  if (t.index < t.kids.length) body.insertBefore(line, t.kids[t.index]); else body.appendChild(line);
}
function clearDropHighlight() {
  $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
  $$('.drop-line').forEach(x => x.remove());
}
function insertIntoColumn(col, items, index) {
  const moving = items.filter(i => i.type !== 'column');
  const ids = new Set(moving.map(i => i.id));
  const kids = childrenOf(col.id).filter(k => !ids.has(k.id));
  kids.splice(index, 0, ...moving.sort((a, b) => a.y - b.y));
  kids.forEach((k, i) => { k.columnId = col.id; k.ci = i; });
  renderBoard();
  S.sel = new Set(moving.map(i => i.id));
  syncSelection();
}

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.002)));
  else {
    S.view.x -= e.deltaX;
    S.view.y -= e.deltaY;
    applyView();
  }
  clearTimeout(viewport._t);
  viewport._t = setTimeout(() => touch(), 400);
}, { passive: false });

viewport.addEventListener('dblclick', e => {
  const hit = e.target.closest('.conn-hit');
  if (hit) return editConnLabel(hit.dataset.cid);
  const card = e.target.closest('.card');
  if (!card) {
    const p = screenToWorld(e.clientX, e.clientY);
    return addItem('note', { x: p.x - 20, y: p.y - 20 }, {}, true);
  }
  const it = itemById(card.dataset.id);
  if (it.type === 'image') openLightbox(it);
  else if (it.type === 'sketch' && !e.target.closest('[data-edit]')) openSketch(it);
});

world.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const card = a.closest('.card');
  const it = card && itemById(card.dataset.id);
  if (!it) return;
  const act = a.dataset.act;
  if (act === 'openlink') return;
  e.preventDefault();
  if (act === 'toggle') {
    checkpoint();
    const t = it.tasks[+a.dataset.i];
    t.done = !t.done;
    touch();
    refreshItem(it);
  } else if (act === 'addtask') {
    checkpoint();
    it.tasks.push({ text: '', done: false });
    touch();
    refreshItem(it);
    enterEdit(cardEl(it.id), { focus: `[data-edit="task"][data-i="${it.tasks.length - 1}"]`, noCheckpoint: true });
  } else if (act === 'expand') openDocEditor(it);
  else if (act === 'download') downloadItemFile(it);
  else if (act === 'sketch') openSketch(it);
  else if (act === 'play') {
    const src = embedUrl(it.url);
    if (src) $('.video-frame', card).innerHTML = `<iframe src="${esc(src)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    else window.open(it.url, '_blank', 'noopener');
  } else if (act === 'pickcolor') {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = normHex(it.hex) || '#888888';
    let cp = false;
    inp.oninput = () => {
      if (!cp) { checkpoint(); cp = true; }
      it.hex = inp.value;
      $('.swatch-color', cardEl(it.id)).style.background = it.hex;
      $('.swatch-hex', cardEl(it.id)).textContent = it.hex;
      touch();
    };
    inp.click();
  }
});

async function downloadItemFile(it) {
  const r = await DB.get('blobs', it.blob);
  if (!r) return toast('File data is missing');
  download(r.blob, r.name || it.name || 'file');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// drag & drop from desktop / toolbar
viewport.addEventListener('dragover', e => {
  e.preventDefault();
  viewport.classList.add('drop-hover');
});
viewport.addEventListener('dragleave', e => {
  if (e.target === viewport) viewport.classList.remove('drop-hover');
});
viewport.addEventListener('drop', e => {
  e.preventDefault();
  viewport.classList.remove('drop-hover');
  const pos = screenToWorld(e.clientX, e.clientY);
  const tool = e.dataTransfer.getData('application/x-boardly-tool');
  if (tool) return createByTool(tool, { x: pos.x - 40, y: pos.y - 20 });
  const files = [...e.dataTransfer.files];
  if (files.length) return addFiles(files, pos);
  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (uri && looksLikeUrl(uri.split('\n')[0])) return addUrlCard(uri.split('\n')[0], pos);
  if (uri?.trim()) addItem('note', pos, { html: esc(uri) });
});

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (modalOpen()) {
    if (e.key === 'Escape') closeTopModal();
    return;
  }
  if (S.editId) return handleEditKeys(e);
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { S.spaceDown = true; viewport.classList.add('panning'); e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); S.sel = new Set(topItems().map(i => i.id)); syncSelection(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (mod && k === 'k') { e.preventDefault(); openSearch(); return; }
  if (mod && k === 'e') { e.preventDefault(); openExport(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomCenter(1.2); return; }
  if (mod && k === '-') { e.preventDefault(); zoomCenter(1 / 1.2); return; }
  if (mod && k === '0') { e.preventDefault(); zoomCenter(1 / S.view.z); return; }
  if (mod && k === '1') { e.preventDefault(); fitView(1.5); return; }
  if (mod) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') { cancelTool(); clearSelection(); hideMenu(); return; }
  if (e.key.startsWith('Arrow') && S.sel.size) {
    e.preventDefault();
    checkpoint();
    const step = e.shiftKey ? 24 : 2;
    const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    for (const id of S.sel) {
      const it = itemById(id);
      if (!it || it.columnId) continue;
      it.x += dx; it.y += dy;
      const el = cardEl(id);
      el.style.left = it.x + 'px';
      el.style.top = it.y + 'px';
    }
    touch();
    renderConns();
    return;
  }
  if (e.key === 'Enter' && S.sel.size === 1) {
    e.preventDefault();
    const it = itemById([...S.sel][0]);
    if (it.type === 'board') openBoard(it.boardId); else enterEdit(cardEl(it.id));
    return;
  }
  const keyTools = { n: 'note', t: 'todo', l: 'link', h: 'heading', c: 'column', b: 'board', m: 'comment', s: 'sketch', w: 'swatch', i: 'image', u: 'upload', v: 'video' };
  if (keyTools[k] && !e.altKey) { e.preventDefault(); createByTool(keyTools[k], S.mouse ? pastePoint() : null); }
});
document.addEventListener('keyup', e => {
  if (e.key === ' ') { S.spaceDown = false; viewport.classList.remove('panning'); }
});
function handleEditKeys(e) {
  const f = document.activeElement?.closest?.('[data-edit]');
  const it = itemById(S.editId);
  if (e.key === 'Escape') { e.preventDefault(); return exitEdit(); }
  if (!f || !it) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return exitEdit(); }
  const k = f.dataset.edit;
  if (k === 'task') {
    const i = +f.dataset.i;
    if (e.key === 'Enter') {
      e.preventDefault();
      it.tasks.splice(i + 1, 0, { text: '', done: false });
      touch();
      refreshItem(it, `[data-edit="task"][data-i="${i + 1}"]`);
    } else if (e.key === 'Backspace' && !f.innerText.trim() && it.tasks.length > 1) {
      e.preventDefault();
      it.tasks.splice(i, 1);
      touch();
      refreshItem(it, `[data-edit="task"][data-i="${Math.max(0, i - 1)}"]`);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = $(`[data-edit="task"][data-i="${i + (e.key === 'ArrowDown' ? 1 : -1)}"]`, cardEl(it.id));
      if (n) { e.preventDefault(); n.focus(); caretEnd(n); }
    }
    return;
  }
  if (e.key === 'Enter' && it.type === 'todo' && k === 'title') {
    e.preventDefault();
    const first = $('[data-edit="task"]', cardEl(it.id));
    first.focus();
    return caretEnd(first);
  }
  const multiline = k === 'html' || k === 'desc' || (it.type === 'comment' && k === 'text');
  if (e.key === 'Enter' && !e.shiftKey && !multiline) { e.preventDefault(); exitEdit(); }
}
document.addEventListener('focusin', e => {
  if (S.editId && e.target.dataset?.edit) showFormatBar();
});

// ---------- context menus ----------
let menuEl = null;
function hideMenu() { menuEl?.remove(); menuEl = null; }
function showMenu(x, y, entries) {
  hideMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  for (const en of entries) {
    if (!en) continue;
    if (en === '-') { menuEl.appendChild(document.createElement('hr')); continue; }
    if (en.palette) {
      const p = document.createElement('div');
      p.className = 'palette';
      p.innerHTML = (en.none ? '<button class="none" data-c="" title="None"></button>' : '') + en.palette.map(c => `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
      p.onclick = ev => { const b = ev.target.closest('[data-c]'); if (b) { en.pick(b.dataset.c || null); hideMenu(); } };
      menuEl.appendChild(p);
      continue;
    }
    const b = document.createElement('button');
    if (en.danger) b.className = 'danger';
    b.innerHTML = `${en.icon ? ic(en.icon) : ''}<span>${esc(en.label)}</span>${en.kbd ? `<span class="kbd">${en.kbd}</span>` : ''}`;
    b.onclick = () => { hideMenu(); en.action(); };
    menuEl.appendChild(b);
  }
  layer.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = clamp(x, 4, window.innerWidth - r.width - 4) + 'px';
  menuEl.style.top = clamp(y, 4, window.innerHeight - r.height - 4) + 'px';
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) hideMenu(); });

viewport.addEventListener('contextmenu', e => {
  if (S.editId && e.target.closest('[data-edit]')) return;
  e.preventDefault();
  const hit = e.target.closest('.conn-hit');
  if (hit) {
    selectConn(hit.dataset.cid);
    const c = S.board.conns.find(x => x.id === hit.dataset.cid);
    return showMenu(e.clientX, e.clientY, [
      { palette: LINE_COLORS, pick: col => { checkpoint(); c.color = col === LINE_COLORS[0] ? null : col; touch(); renderConns(); } },
      { label: c.arrow === false ? 'Show arrow' : 'Hide arrow', action: () => { checkpoint(); c.arrow = c.arrow === false; touch(); renderConns(); } },
      { label: 'Reverse direction', action: () => { checkpoint(); [c.from, c.to] = [c.to, c.from]; touch(); renderConns(); } },
      { label: c.label ? 'Edit label' : 'Add label', action: () => editConnLabel(c.id) },
      '-',
      { label: 'Delete line', icon: 'trash', danger: true, kbd: 'Del', action: deleteSelection },
    ]);
  }
  const card = e.target.closest('.card');
  if (!card) {
    const p = screenToWorld(e.clientX, e.clientY);
    return showMenu(e.clientX, e.clientY, [
      S.clip && { label: 'Paste', kbd: '⌘V', action: () => pasteClip(S.clip, p) },
      { label: 'Add note here', icon: 'note', action: () => createByTool('note', p) },
      { label: 'Add to-do here', icon: 'todo', action: () => createByTool('todo', p) },
      { label: 'Add column here', icon: 'column', action: () => createByTool('column', p) },
      { label: 'Add board here', icon: 'board', action: () => createByTool('board', p) },
      '-',
      { label: 'Select all', kbd: '⌘A', action: () => { S.sel = new Set(topItems().map(i => i.id)); syncSelection(); } },
      { label: 'Zoom to fit', icon: 'fit', kbd: '⌘1', action: () => fitView(1.5) },
    ]);
  }
  const id = card.dataset.id;
  if (!S.sel.has(id)) selectOnly(id);
  const it = itemById(id);
  const sel = [...S.sel].map(x => itemById(x)).filter(Boolean);
  const single = sel.length === 1;
  showMenu(e.clientX, e.clientY, [
    {
      palette: it.type === 'board' ? BOARD_COLORS : CARD_COLORS, none: it.type !== 'board',
      pick: col => {
        checkpoint();
        for (const s of sel) {
          if (s.type === 'board') { const b = S.boards.get(s.boardId); if (b && col) { b.color = col; touch(b); } }
          else s.color = col;
        }
        touch();
        renderBoard();
      },
    },
    single && it.type === 'board' && { label: 'Open board', icon: 'board', kbd: '↵', action: () => openBoard(it.boardId) },
    single && it.type === 'note' && { label: 'Open as document', icon: 'expand', action: () => openDocEditor(it) },
    single && it.type === 'sketch' && { label: 'Edit drawing', icon: 'sketch', action: () => openSketch(it) },
    single && it.type === 'image' && { label: 'View full size', icon: 'expand', action: () => openLightbox(it) },
    single && (it.type === 'image' || it.type === 'file') && { label: 'Download original', icon: 'download', action: () => downloadItemFile(it) },
    single && (it.type === 'link' || it.type === 'video') && { label: 'Open link', icon: 'external', action: () => window.open(it.url, '_blank', 'noopener') },
    single && it.columnId && { label: 'Move out of column', action: () => { beginDetach(it); } },
    '-',
    { label: sel.length > 1 ? `Export ${sel.length} selected cards…` : 'Export this card…', icon: 'download', action: () => openExport(sel.map(s => s.id)) },
    '-',
    { label: 'Duplicate', kbd: '⌘D', action: duplicateSelection },
    { label: 'Copy', kbd: '⌘C', action: () => { S.clip = serializeSel(); toast('Copied'); } },
    { label: 'Bring to front', action: () => { checkpoint(); let z = nextZ(); sel.forEach(s => s.z = z++); touch(); renderBoard(); } },
    { label: 'Send to back', action: () => { checkpoint(); let z = Math.min(...S.board.items.map(i => i.z || 0)) - sel.length; sel.forEach(s => s.z = z++); touch(); renderBoard(); } },
    '-',
    { label: sel.length > 1 ? `Delete ${sel.length} cards` : 'Delete', icon: 'trash', danger: true, kbd: 'Del', action: deleteSelection },
  ]);
});
function beginDetach(it) {
  checkpoint();
  const r = worldRectOf(it.id);
  Object.assign(it, { columnId: null, x: Math.round(r.x + r.w + 40), y: Math.round(r.y), w: Math.round(r.w), z: nextZ() });
  touch();
  renderBoard();
}
async function editConnLabel(cid) {
  const c = S.board.conns.find(x => x.id === cid);
  if (!c) return;
  const v = await askText('Line label', 'e.g. leads to', c.label || '');
  if (v === null) return;
  checkpoint();
  c.label = v.trim();
  touch();
  renderConns();
}

// ---------- modals ----------
const modalStack = [];
function modalOpen() { return modalStack.length > 0; }
function openModal({ title, body, foot, wide, onClose }) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="tb" data-close title="Close">✕</button></div><div class="modal-body"></div>${foot ? '<div class="modal-foot"></div>' : ''}</div>`;
  const m = { el: bd, onClose };
  if (typeof body === 'string') $('.modal-body', bd).innerHTML = body; else if (body) $('.modal-body', bd).appendChild(body);
  if (foot) foot.forEach(f => $('.modal-foot', bd).appendChild(f));
  bd.addEventListener('pointerdown', e => { if (e.target === bd) closeModal(m); });
  $('[data-close]', bd).onclick = () => closeModal(m);
  layer.appendChild(bd);
  modalStack.push(m);
  return m;
}
function closeModal(m) {
  const i = modalStack.indexOf(m);
  if (i < 0) return;
  modalStack.splice(i, 1);
  m.el.remove();
  m.onClose?.();
}
function closeTopModal() { if (modalStack.length) closeModal(modalStack[modalStack.length - 1]); }
function btn(label, cls, onclick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}
function askText(title, placeholder, initial = '') {
  return new Promise(res => {
    let done = false;
    const inp = document.createElement('input');
    inp.className = 'field';
    inp.placeholder = placeholder;
    inp.value = initial;
    const finish = v => { if (done) return; done = true; closeModal(m); res(v); };
    const m = openModal({
      title, body: inp,
      foot: [btn('Cancel', 'secondary', () => finish(null)), btn('OK', 'primary', () => finish(inp.value.trim()))],
      onClose: () => { if (!done) { done = true; res(null); } },
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(inp.value.trim()); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}
function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; closeModal(m); res(v); };
    const m = openModal({
      title, body: `<p style="margin:0;color:var(--muted)">${esc(text)}</p>`,
      foot: [btn('Cancel', 'secondary', () => finish(false)), btn(okLabel, danger ? 'primary danger-bg' : 'primary', () => finish(true))],
      onClose: () => { if (!done) { done = true; res(false); } },
    });
  });
}
let toastWrap = null;
function toast(msg, ms = 3200) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; document.body.appendChild(toastWrap); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toastWrap.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
  return t;
}

// lightbox
async function openLightbox(it) {
  const src = await blobUrl(it.blob);
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="">`;
  const m = { el: lb };
  lb.onclick = () => closeModal(m);
  layer.appendChild(lb);
  modalStack.push(m);
}

// document editor for notes
function openDocEditor(it) {
  exitEdit();
  checkpoint();
  const ed = document.createElement('div');
  ed.className = 'doc-editor';
  ed.innerHTML = `<div class="doc-head"><button class="secondary" data-back>${ic('back')} Back to board</button><div class="spacer"></div></div><div class="doc-scroll"><div class="doc-body rt" contenteditable="true">${it.html || ''}</div></div>`;
  const body = $('.doc-body', ed);
  const bar = makeFmtBar(() => { it.html = body.innerHTML; touch(); });
  $('.doc-head', ed).insertBefore(bar, $('.spacer', ed));
  body.addEventListener('input', () => { it.html = body.innerHTML; touch(); });
  const m = { el: ed, onClose: () => { if (S.undo[S.undo.length - 1] === snapshot()) S.undo.pop(); refreshItem(it); } };
  $('[data-back]', ed).onclick = () => closeModal(m);
  layer.appendChild(ed);
  modalStack.push(m);
  body.focus();
  caretEnd(body);
}

// sketch editor
function openSketch(it, isNew = false) {
  const W = 1000, H = 625;
  let strokes = structuredClone(it.strokes || []);
  let color = '#1f2328', size = 4, eraser = false, cur = null;
  const wrap = document.createElement('div');
  const colors = ['#1f2328', '#d93a3a', '#2f6bf2', '#3aa76d', '#e08a1e', '#8a4fd8', '#ec4899'];
  wrap.innerHTML = `<div class="sketch-tools">${colors.map(c => `<button class="dot ${c === color ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
    <span style="width:8px"></span>${[2, 4, 9, 18].map(s => `<button class="sz ${s === size ? 'on' : ''}" data-size="${s}">${s}px</button>`).join('')}
    <button class="sz" data-eraser>Eraser</button><span class="spacer"></span><button class="sz" data-undo>Undo</button><button class="sz" data-clear>Clear</button></div>
    <canvas class="sketch-canvas" width="${W}" height="${H}"></canvas>`;
  const cv = $('canvas', wrap), ctx = cv.getContext('2d');
  const drawStroke = s => {
    ctx.save();
    ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = s.s;
    ctx.lineCap = ctx.lineJoin = 'round';
    const p = s.p;
    ctx.beginPath();
    if (p.length === 1) { ctx.arc(p[0][0], p[0][1], s.s / 2, 0, 7); ctx.fill(); ctx.restore(); return; }
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    ctx.stroke();
    ctx.restore();
  };
  const redraw = () => { ctx.clearRect(0, 0, W, H); strokes.forEach(drawStroke); if (cur) drawStroke(cur); };
  const pt = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * W / r.width), Math.round((e.clientY - r.top) * H / r.height)]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); cur = { c: color, s: size, e: eraser, p: [pt(e)] }; redraw(); });
  cv.addEventListener('pointermove', e => { if (!cur) return; cur.p.push(pt(e)); redraw(); });
  cv.addEventListener('pointerup', () => { if (cur) strokes.push(cur); cur = null; redraw(); });
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.color) { color = b.dataset.color; eraser = false; }
    if (b.dataset.size) size = +b.dataset.size;
    if ('eraser' in b.dataset) eraser = !eraser;
    if ('undo' in b.dataset) strokes.pop();
    if ('clear' in b.dataset) strokes = [];
    $$('.dot', wrap).forEach(d => d.classList.toggle('on', !eraser && d.dataset.color === color));
    $$('[data-size]', wrap).forEach(d => d.classList.toggle('on', +d.dataset.size === size));
    $('[data-eraser]', wrap).classList.toggle('on', eraser);
    redraw();
  });
  redraw();
  let saved = false;
  const save = () => {
    saved = true;
    checkpoint();
    it.strokes = strokes;
    if (!strokes.length) { it.png = ''; }
    else {
      let x1 = W, y1 = H, x2 = 0, y2 = 0;
      for (const s of strokes) for (const [x, y] of s.p) { x1 = Math.min(x1, x - s.s); y1 = Math.min(y1, y - s.s); x2 = Math.max(x2, x + s.s); y2 = Math.max(y2, y + s.s); }
      const pad = 24;
      x1 = clamp(x1 - pad, 0, W); y1 = clamp(y1 - pad, 0, H); x2 = clamp(x2 + pad, 0, W); y2 = clamp(y2 + pad, 0, H);
      const out = document.createElement('canvas');
      out.width = Math.max(1, x2 - x1);
      out.height = Math.max(1, y2 - y1);
      const o = out.getContext('2d');
      o.fillStyle = '#fff';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(cv, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
      it.png = out.toDataURL('image/png');
      it.ar = out.height / out.width;
    }
    touch();
    closeModal(m);
    refreshItem(it);
  };
  const m = openModal({
    title: 'Sketch', body: wrap, wide: true,
    foot: [btn('Cancel', 'secondary', () => closeModal(m)), btn('Save drawing', 'primary', save)],
    onClose: () => {
      if (!saved && isNew && !it.png) {
        S.board.items = S.board.items.filter(i => i !== it);
        S.undo.pop();
        cardEl(it.id)?.remove();
        updateEmptyHint();
      }
    },
  });
}

// ---------- search ----------
function openSearch() {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<input class="field" placeholder="Search every board, card and task…"><div class="results"></div>';
  const inp = $('input', wrap), out = $('.results', wrap);
  let results = [], active = 0;
  const mark = (text, q) => {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text.slice(0, 120));
    const s = Math.max(0, i - 40);
    return (s ? '…' : '') + esc(text.slice(s, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, i + q.length + 80));
  };
  const run = () => {
    const q = inp.value.trim().toLowerCase();
    results = [];
    if (q) {
      for (const b of S.boards.values()) {
        if (b.trashed) continue;
        if (b.title.toLowerCase().includes(q)) results.push({ b, html: `<b>${mark(b.title, q)}</b><small>Board</small>` });
        for (const it of b.items) {
          const t = (it.type === 'board' ? '' : itemTextFor(it, b)).replace(/\s+/g, ' ');
          if (t.toLowerCase().includes(q)) results.push({ b, it, html: `${mark(t, q)}<small>${esc(it.type)} · in ${esc(b.title)}</small>` });
        }
        if (results.length > 80) break;
      }
    }
    active = 0;
    out.innerHTML = results.length ? results.map((r, i) => `<button class="result ${i === 0 ? 'active' : ''}" data-i="${i}">${r.html}</button>`).join('')
      : q ? '<p class="muted" style="padding:8px 10px">No matches</p>' : '<p class="muted" style="padding:8px 10px">Type to search across all your boards.</p>';
  };
  const go = i => {
    const r = results[i];
    if (!r) return;
    closeModal(m);
    openBoard(r.b.id, r.it?.id);
  };
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, results.length - 1);
      $$('.result', out).forEach((x, i) => x.classList.toggle('active', i === active));
      $$('.result', out)[active]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') go(active);
  });
  out.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); });
  const m = openModal({ title: 'Search', body: wrap });
  run();
  setTimeout(() => inp.focus(), 20);
}
function itemTextFor(it) { return itemText(it); }

// ---------- trash ----------
function openTrash() {
  const body = document.createElement('div');
  const render = () => {
    const roots = [...S.boards.values()].filter(b => b.trashed && !S.boards.get(b.parentId)?.trashed).sort((a, c) => (c.trashedAt || 0) - (a.trashedAt || 0));
    body.innerHTML = roots.length ? roots.map(b => `<div class="list-row"><div class="grow"><b>${esc(b.title)}</b><div class="muted">${b.items.length} cards · deleted ${relTime(b.trashedAt || b.updated)}</div></div>
      <button class="secondary" data-restore="${b.id}">Restore</button><button class="secondary danger-btn" data-purge="${b.id}">Delete forever</button></div>`).join('')
      : '<p class="muted">Trash is empty. Deleted boards appear here so you can restore them.</p>';
  };
  body.addEventListener('click', async e => {
    const r = e.target.closest('[data-restore]'), p = e.target.closest('[data-purge]');
    if (r) {
      const b = S.boards.get(r.dataset.restore);
      setTrashed(b.id, false);
      let parent = S.boards.get(b.parentId);
      if (!parent || parent.trashed) { parent = S.boards.get('home'); b.parentId = 'home'; touch(b); }
      if (!parent.items.some(i => i.type === 'board' && i.boardId === b.id)) {
        const maxY = parent.items.reduce((m, i) => Math.max(m, (i.y || 0) + 200), 60);
        parent.items.push(makeItem('board', 60, maxY, { boardId: b.id }, parent));
        touch(parent);
      }
      if (parent === S.board) renderBoard();
      toast(`Restored “${b.title}” to ${parent.title}`);
      render();
    }
    if (p) {
      const b = S.boards.get(p.dataset.purge);
      if (!(await confirmBox('Delete forever?', `“${b.title}” and its sub-boards will be permanently removed from this computer.`, 'Delete forever', true))) return;
      for (const x of [b, ...descendants(b.id)]) { S.boards.delete(x.id); dirty.add(x.id); }
      flushSave();
      render();
    }
  });
  render();
  openModal({ title: 'Trash', body });
}

// ---------- templates ----------
function tplBuilder(b) {
  let z = 0;
  const items = [], conns = [];
  const add = (type, x, y, props = {}) => {
    const it = { id: uid(), type, x, y, w: DEFAULT_W[type], color: null, z: ++z, ...DEFAULTS[type](), ...props };
    items.push(it);
    return it;
  };
  const inCol = (col, type, props = {}) => add(type, 0, 0, { columnId: col.id, ci: items.filter(i => i.columnId === col.id).length, ...props });
  const link = (a, c, label = '') => conns.push({ id: uid(), from: a.id, to: c.id, arrow: true, label, color: null });
  const sub = (title, x, y) => {
    const nb = { id: uid(), title, parentId: b.id, color: BOARD_COLORS[(z + 3) % BOARD_COLORS.length], items: [], conns: [], view: null, created: now(), updated: now(), trashed: false };
    S.boards.set(nb.id, nb);
    touch(nb);
    return add('board', x, y, { boardId: nb.id });
  };
  return { items, conns, add, inCol, link, sub };
}
const TEMPLATES = [
  {
    name: 'Moodboard', art: '🎨', bg: '#ffe4d1', desc: 'Images, colours and type for a visual direction.',
    build(t) {
      t.add('heading', 40, 20, { text: 'Moodboard', w: 420 });
      t.add('note', 40, 90, { html: '<b>Direction</b><div>Describe the feeling you want — 3 adjectives, references, what to avoid.</div>', w: 300 });
      ['#1f3b4d', '#e07a5f', '#f2cc8f', '#81b29a', '#f4f1de'].forEach((hex, i) => t.add('swatch', 40 + i * 150, 260, { hex, w: 140 }));
      const col = t.add('column', 380, 90, { title: 'Typography', w: 260 });
      t.inCol(col, 'note', { html: '<h2>Display — Serif</h2><div>Big, warm, editorial</div>' });
      t.inCol(col, 'note', { html: '<div>Body — clean sans-serif, 16px</div>' });
      t.add('note', 680, 90, { html: '<b>Inspiration</b><div>Drop images here ➜ drag them anywhere on the board.</div>', w: 260, color: CARD_COLORS[0] });
    },
  },
  {
    name: 'Project plan', art: '🗂️', bg: '#d8e8ff', desc: 'Kanban columns, milestones and notes.',
    build(t) {
      t.add('heading', 40, 20, { text: 'Project plan', w: 420 });
      const cols = ['To do', 'In progress', 'Done'].map((title, i) => t.add('column', 40 + i * 300, 100, { title, w: 280 }));
      t.inCol(cols[0], 'note', { html: 'Define scope and goals' });
      t.inCol(cols[0], 'note', { html: 'Research competitors' });
      t.inCol(cols[1], 'note', { html: 'First draft of designs', color: CARD_COLORS[0] });
      t.inCol(cols[2], 'note', { html: 'Kick-off meeting' });
      t.add('todo', 960, 100, { title: 'Milestones', tasks: [{ text: 'Brief approved', done: true }, { text: 'Design review', done: false }, { text: 'Launch', done: false }] });
    },
  },
  {
    name: 'Brainstorm', art: '💡', bg: '#fff3b0', desc: 'A central idea with connected thoughts.',
    build(t) {
      const c = t.add('note', 400, 260, { html: '<h2>Main idea</h2>', w: 220, color: CARD_COLORS[0] });
      const pos = [[100, 60], [400, 40], [700, 60], [80, 440], [400, 480], [720, 440]];
      pos.forEach(([x, y], i) => t.link(c, t.add('note', x, y, { html: `Idea ${i + 1}`, w: 200 })));
    },
  },
  {
    name: 'Weekly planner', art: '📅', bg: '#c4f0d6', desc: 'Seven columns, one per day.',
    build(t) {
      t.add('heading', 40, 20, { text: 'This week', w: 420 });
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d, i) => {
        const col = t.add('column', 40 + i * 260, 100, { title: d, w: 240 });
        t.inCol(col, 'todo', { title: 'Tasks', tasks: [{ text: '', done: false }] });
      });
    },
  },
  {
    name: 'Storyboard', art: '🎬', bg: '#dcccff', desc: 'Frames to sketch scenes with notes underneath.',
    build(t) {
      t.add('heading', 40, 20, { text: 'Storyboard', w: 420 });
      for (let i = 0; i < 6; i++) {
        const x = 40 + (i % 3) * 320, y = 100 + Math.floor(i / 3) * 330;
        t.add('sketch', x, y, { caption: `Scene ${i + 1}`, w: 290 });
        t.add('note', x, y + 230, { html: '<i>Action / dialogue…</i>', w: 290 });
      }
    },
  },
  {
    name: 'Meeting notes', art: '📝', bg: '#e3e3e3', desc: 'Agenda, notes and action items.',
    build(t) {
      t.add('heading', 40, 20, { text: 'Meeting — ' + new Date().toLocaleDateString(), w: 520 });
      t.add('note', 40, 100, { html: '<h2>Agenda</h2><ol><li>Updates</li><li>Decisions</li><li>Next steps</li></ol>', w: 280 });
      t.add('note', 350, 100, { html: '<h2>Notes</h2><div><br></div>', w: 320 });
      t.add('todo', 700, 100, { title: 'Action items', tasks: [{ text: '', done: false }] });
      t.add('comment', 700, 300, { text: 'Add questions for the next meeting here.' });
    },
  },
];
function openTemplates(pos) {
  const grid = document.createElement('div');
  grid.className = 'tpl-grid';
  grid.innerHTML = TEMPLATES.map((t, i) => `<button class="tpl" data-i="${i}"><div class="tpl-art" style="background:${t.bg}">${t.art}</div><div class="tpl-txt"><b>${t.name}</b><span>${t.desc}</span></div></button>`).join('');
  const m = openModal({ title: 'Start from a template', body: grid, wide: true });
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const tpl = TEMPLATES[+b.dataset.i];
    const nb = newBoard(tpl.name, S.board.id);
    const t = tplBuilder(nb);
    tpl.build(t);
    nb.items = t.items;
    nb.conns = t.conns;
    touch(nb);
    closeModal(m);
    addItem('board', pos || spawnPoint(), { boardId: nb.id });
    toast(`Created “${tpl.name}” — click it to open`);
  });
}

// ---------- backup ----------
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
async function exportBackup(rootId) {
  await flushSave();
  const boards = rootId ? [S.boards.get(rootId), ...descendants(rootId)] : [...S.boards.values()];
  const used = new Set();
  for (const b of boards) for (const it of b.items) if (it.blob) used.add(it.blob);
  const blobs = [];
  for (const r of await DB.all('blobs')) if (!rootId || used.has(r.id)) blobs.push({ id: r.id, name: r.name, type: r.type, data: await blobToDataURL(r.blob) });
  const out = { app: 'boardly', version: 1, exported: new Date().toISOString(), root: rootId || null, boards, blobs };
  const name = rootId ? slug(S.boards.get(rootId).title) : 'boardly-backup-' + new Date().toISOString().slice(0, 10);
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), name + '.json');
}
function importBackup() {
  pickFiles('application/json,.json', async ([file]) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'boardly' || !Array.isArray(data.boards)) throw new Error('This is not a Boardly backup file');
      const single = data.root && data.root !== 'home';
      if (!(await confirmBox('Import backup?', single
        ? `Adds the board “${data.boards[0]?.title}” (${data.boards.length} board(s)) to the current board.`
        : `Merges ${data.boards.length} boards into your local data. Boards with the same ID are replaced.`, 'Import'))) return;
      for (const r of data.blobs || []) await DB.put('blobs', { id: r.id, name: r.name, type: r.type, blob: await dataURLToBlob(r.data) });
      if (single) {
        const idMap = new Map(data.boards.map(b => [b.id, S.boards.has(b.id) ? uid() : b.id]));
        for (const b of data.boards) {
          const nb = { ...b, id: idMap.get(b.id), parentId: b.id === data.root ? S.board.id : idMap.get(b.parentId) || S.board.id, trashed: false };
          nb.items.forEach(it => { if (it.type === 'board') it.boardId = idMap.get(it.boardId) || it.boardId; });
          S.boards.set(nb.id, nb);
          touch(nb);
        }
        addItem('board', spawnPoint(), { boardId: idMap.get(data.root) });
      } else {
        for (const b of data.boards) { S.boards.set(b.id, b); touch(b); }
        renderBoard();
      }
      await flushSave();
      toast('Import complete');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  });
}
const slug = s => (String(s || 'board').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 80)) || 'board';

// ---------- settings menu ----------
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
async function openMainMenu(x, y) {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  showMenu(x, y, [
    { label: 'Trash', icon: 'trash', action: openTrash },
    { label: 'Keyboard shortcuts', action: openShortcuts },
    '-',
    { label: `Theme: ${S.settings.theme} (click to change)`, action: () => { S.settings.theme = { system: 'light', light: 'dark', dark: 'system' }[S.settings.theme]; applyTheme(); saveSettings(); } },
    { label: `Snap to grid: ${S.settings.snap ? 'on' : 'off'}`, action: () => { S.settings.snap = !S.settings.snap; saveSettings(); } },
    '-',
    { label: 'Back up all boards (.json)', icon: 'download', action: () => exportBackup(null) },
    { label: 'Import backup or board (.json)', icon: 'upload', action: importBackup },
    '-',
    { label: `Local storage: ${est ? fmtSize(est.usage || 0) : 'unknown'} used${persisted ? ' · protected' : ''}`, action: async () => {
      const ok = await navigator.storage?.persist?.();
      toast(ok ? 'Storage is protected from automatic browser clean-up' : 'The browser did not grant persistent storage — keep regular backups');
    } },
  ]);
}
function openShortcuts() {
  const rows = [
    ['Note / To-do / Link', 'N / T / L'], ['Heading / Column / Board', 'H / C / B'], ['Comment / Sketch / Colour', 'M / S / W'],
    ['Image / Upload / Video', 'I / U / V'], ['New note anywhere', 'Double-click canvas'], ['Pan', 'Space + drag, scroll, middle mouse'],
    ['Zoom', 'Ctrl/⌘ + scroll, pinch, Ctrl/⌘ + / −'], ['Zoom to fit / 100%', 'Ctrl/⌘ 1 / Ctrl/⌘ 0'], ['Undo / Redo', 'Ctrl/⌘ Z / Ctrl/⌘ Shift Z'],
    ['Duplicate', 'Ctrl/⌘ D'], ['Copy / Cut / Paste cards', 'Ctrl/⌘ C / X / V'], ['Select all', 'Ctrl/⌘ A'], ['Multi-select', 'Shift-click or drag a box'],
    ['Nudge', 'Arrow keys (Shift = bigger)'], ['Delete', 'Delete / Backspace'], ['Search everything', 'Ctrl/⌘ K'], ['Export', 'Ctrl/⌘ E'],
    ['Finish editing', 'Esc or Ctrl/⌘ Enter'],
  ];
  openModal({ title: 'Keyboard shortcuts', body: `<table class="kbd-table">${rows.map(r => `<tr><td>${r[0]}</td><td><kbd>${esc(r[1])}</kbd></td></tr>`).join('')}</table>` });
}

// ---------- toolbar & top bar ----------
const TOOLS = [
  ['note', 'Note'], ['link', 'Link'], ['todo', 'To-do'], ['line', 'Line'], ['board', 'Board'], ['column', 'Column'],
  ['comment', 'Comment'], ['heading', 'Heading'], '-', ['image', 'Image'], ['upload', 'Upload'], ['sketch', 'Sketch'],
  ['swatch', 'Colour'], ['video', 'Video'], '-', ['template', 'Templates'],
];
function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = TOOLS.map(t => t === '-' ? '<div class="tool-sep"></div>'
    : `<button class="tool" data-tool="${t[0]}" draggable="${t[0] !== 'line'}" title="${t[1]} — click to add, or drag onto the board">${ic(t[0])}<span>${t[1]}</span></button>`).join('')
    + `<button class="tool tool-bottom" data-trash title="Trash">${ic('trash')}<span>Trash</span></button>`;
  tb.addEventListener('click', e => {
    const b = e.target.closest('[data-tool]');
    if (b) return createByTool(b.dataset.tool);
    if (e.target.closest('[data-trash]')) openTrash();
  });
  tb.addEventListener('dragstart', e => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    e.dataTransfer.setData('application/x-boardly-tool', b.dataset.tool);
    e.dataTransfer.effectAllowed = 'copy';
  });
}
function bindTopbar() {
  $('#homeBtn').onclick = () => openBoard('home');
  $('#searchBtn').innerHTML = ic('search');
  $('#undoBtn').innerHTML = ic('undo');
  $('#redoBtn').innerHTML = ic('redo');
  $('#zoomFit').innerHTML = ic('fit');
  $('#menuBtn').innerHTML = ic('more');
  $('#searchBtn').onclick = openSearch;
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#zoomIn').onclick = () => zoomCenter(1.2);
  $('#zoomOut').onclick = () => zoomCenter(1 / 1.2);
  $('#zoomLabel').onclick = () => zoomCenter(1 / S.view.z);
  $('#zoomFit').onclick = () => fitView(1.5);
  $('#exportBtn').onclick = () => openExport();
  $('#menuBtn').onclick = e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMainMenu(r.right - 260, r.bottom + 6); };
}

// ---------- first run ----------
function seedHome() {
  const home = { id: 'home', title: 'Home', parentId: null, color: BOARD_COLORS[0], items: [], conns: [], view: null, created: now(), updated: now(), trashed: false };
  S.boards.set('home', home);
  const t = tplBuilder(home);
  t.add('heading', 60, 40, { text: 'Welcome to Boardly', w: 520 });
  const intro = t.add('note', 60, 120, {
    w: 300, html: '<b>Everything stays on this computer.</b><div>Boards, images and files are saved in this browser’s local storage — no account and no cloud.</div><ul><li>Double-click the board to write a note</li><li>Drag cards from the left toolbar, or drop images and files anywhere</li><li>Drag the blue dot on a card’s edge to connect cards</li><li>Drop cards into a column to stack them</li><li>Use <b>Export</b> (top right) for Word, PowerPoint or PDF</li></ul>',
  });
  const todo = t.add('todo', 400, 120, { title: 'Try these', tasks: [{ text: 'Open “My first board”', done: false }, { text: 'Add an image', done: false }, { text: 'Start a board from a template', done: false }, { text: 'Export this board to PowerPoint', done: false }] });
  t.link(intro, todo);
  const col = t.add('column', 700, 120, { title: 'Ideas', w: 260 });
  t.inCol(col, 'note', { html: 'Columns keep related cards together.', color: CARD_COLORS[0] });
  t.inCol(col, 'note', { html: 'Drag a card out to put it back on the board.' });
  t.sub('My first board', 400, 360);
  ['#2f6bf2', '#f2b33f', '#3aa76d'].forEach((hex, i) => t.add('swatch', 60 + i * 110, 470, { hex, w: 100 }));
  home.items = t.items;
  home.conns = t.conns;
  touch(home);
}

// ---------- start ----------
async function init() {
  try {
    await DB.open();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:40px">Boardly needs IndexedDB (browser local storage), which is unavailable here: ${esc(err.message)}. Try Chrome, Edge, Firefox or Safari without private browsing.</p>`;
    return;
  }
  for (const b of await DB.all('boards')) S.boards.set(b.id, b);
  const st = await DB.get('meta', 'settings');
  if (st) Object.assign(S.settings, st.value);
  applyTheme();
  if (!S.boards.has('home')) seedHome();
  buildToolbar();
  bindTopbar();
  const target = location.hash.slice(1);
  openBoard(S.boards.has(target) && !S.boards.get(target).trashed ? target : 'home');
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('resize', positionFormatBar);
}
init();
