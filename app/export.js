'use strict';
/* Boardly exports: Word (.docx), PowerPoint (.pptx), PDF, PNG, Markdown and JSON. Libraries load on demand from ./vendor. */

const LIBS = {
  docx: ['vendor/docx.umd.js', () => window.docx],
  pptx: ['vendor/pptxgen.bundle.js', () => window.PptxGenJS],
  jspdf: ['vendor/jspdf.umd.min.js', () => window.jspdf],
  h2c: ['vendor/html2canvas.min.js', () => window.html2canvas],
};
function loadLib(key) {
  const [src, get] = LIBS[key];
  if (get()) return Promise.resolve(get());
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(get());
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

// ---------- content model shared by every exporter ----------
const BLOCK_TAGS = /^(p|div|h[1-6]|li|blockquote|pre|ul|ol)$/;
function htmlToBlocks(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  const blocks = [];
  let cur = null;
  const open = (type, extra) => (cur = { type, runs: [], ...extra }, blocks.push(cur), cur);
  const ensure = () => cur || open('p');
  function walk(node, st, list, blockType) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ');
        if (t.trim() || (cur && t)) ensure().runs.push({ text: t, ...st });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { ensure().runs.push({ br: true }); continue; }
      if (tag === 'ul' || tag === 'ol') { cur = null; walk(n, st, { ordered: tag === 'ol', level: list ? list.level + 1 : 0 }); cur = null; continue; }
      if (tag === 'li') { cur = null; open(list?.ordered ? 'oli' : 'li', { level: list?.level || 0 }); walk(n, st, list); cur = null; continue; }
      if (BLOCK_TAGS.test(tag)) {
        cur = null;
        const type = /^h[1-6]$/.test(tag) ? 'h' + Math.min(3, +tag[1]) : tag === 'blockquote' ? 'quote' : tag === 'pre' ? 'code' : blockType || 'p';
        open(type);
        walk(n, st, list, type === 'p' ? blockType : type);
        cur = null;
        continue;
      }
      const s = { ...st };
      if (tag === 'b' || tag === 'strong') s.b = true;
      if (tag === 'i' || tag === 'em') s.i = true;
      if (tag === 'u') s.u = true;
      if (tag === 's' || tag === 'strike' || tag === 'del') s.s = true;
      if (tag === 'code') s.code = true;
      if (tag === 'mark') s.mark = true;
      if (tag === 'a' && n.getAttribute('href')) s.link = n.getAttribute('href');
      if (tag === 'span' || tag === 'font') {
        const css = n.style;
        if (/bold|[6-9]00/.test(css.fontWeight)) s.b = true;
        if (css.fontStyle === 'italic') s.i = true;
        if (/underline/.test(css.textDecoration)) s.u = true;
        if (/line-through/.test(css.textDecoration)) s.s = true;
        if (css.backgroundColor && css.backgroundColor !== 'transparent') s.mark = true;
      }
      if (tag === 'img') continue;
      walk(n, s, list, blockType);
    }
  }
  walk(root, {}, null, null);
  for (const b of blocks) {
    while (b.runs.length && (b.runs[b.runs.length - 1].br || !b.runs[b.runs.length - 1].text?.trim() && !b.runs[b.runs.length - 1].br && b.runs.length > 1)) b.runs.pop();
    if (b.runs[0]?.text) b.runs[0] = { ...b.runs[0], text: b.runs[0].text.replace(/^\s+/, '') };
  }
  // drop leading/trailing and doubled empty paragraphs
  const out = [];
  for (const b of blocks) {
    const empty = !b.runs.some(r => r.text?.trim());
    if (empty && (!out.length || out[out.length - 1]._empty)) continue;
    b._empty = empty;
    out.push(b);
  }
  while (out.length && out[out.length - 1]._empty) out.pop();
  return out;
}
const txt = text => ({ text: String(text ?? '') });

function itemBlocks(it) {
  switch (it.type) {
    case 'note': return htmlToBlocks(it.html);
    case 'heading': return it.text ? [{ type: 'h2', runs: [txt(it.text)] }] : [];
    case 'todo': return [
      { type: 'h3', runs: [txt(it.title || 'To-do')] },
      ...it.tasks.filter(t => t.text.trim()).map(t => ({ type: 'task', done: t.done, runs: [txt(t.text)] })),
    ];
    case 'link': return [
      { type: 'p', runs: [{ text: it.title || it.url, link: it.url, b: true }] },
      ...(it.desc ? [{ type: 'p', runs: [txt(it.desc)] }] : []),
    ];
    case 'comment': return [{ type: 'quote', runs: [{ text: (it.author || 'You') + ': ', b: true }, txt(it.text)] }];
    case 'swatch': return [{ type: 'swatch', hex: it.hex, runs: [txt(`${(it.hex || '').toUpperCase()}${it.name ? ' — ' + it.name : ''}`)] }];
    case 'file': return [{ type: 'p', runs: [{ text: 'Attachment: ', b: true }, txt(`${it.name} (${fmtSize(it.size || 0)})`)] }];
    case 'video': return [
      { type: 'p', runs: [{ text: 'Video: ', b: true }, { text: it.url, link: it.url }] },
      ...(it.caption ? [{ type: 'p', runs: [{ text: it.caption, i: true }] }] : []),
    ];
    case 'image': case 'sketch':
      return (it.type === 'image' ? it.blob : it.png) ? [{ type: 'image', it, caption: it.caption }] : (it.caption ? [{ type: 'p', runs: [txt(it.caption)] }] : []);
    default: return [];
  }
}
function readingOrder(items) {
  const sorted = [...items].sort((a, c) => a.y - c.y);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.y - row.y0 < 80) row.items.push(it); else rows.push({ y0: it.y, items: [it] });
  }
  return rows.flatMap(r => r.items.sort((a, c) => a.x - c.x));
}
/* Flattens a board into sections and cards; nested boards become sub-sections when `nested` is set. */
function outline(board, nested, depth = 0, seen = new Set()) {
  seen.add(board.id);
  const out = [], subBoards = [];
  for (const it of readingOrder(topItems(board))) {
    if (it.type === 'column') {
      out.push({ kind: 'section', title: it.title || 'Column', depth: depth + 1 });
      for (const c of childrenOf(it.id, board)) out.push(...cardEntry(c, board, nested, depth + 1, seen));
    } else if (it.type === 'board' && nested) subBoards.push(it);
    else out.push(...cardEntry(it, board, nested, depth, seen));
  }
  // Nested boards go last so their headings don't swallow the cards that follow them.
  for (const it of subBoards) out.push(...cardEntry(it, board, nested, depth, seen));
  return out;
}
function cardEntry(it, board, nested, depth, seen) {
  if (it.type === 'board') {
    const sub = S.boards.get(it.boardId);
    if (!sub || sub.trashed) return [];
    if (nested && !seen.has(sub.id)) return [{ kind: 'section', title: sub.title, depth: depth + 1 }, ...outline(sub, nested, depth + 1, seen)];
    return [{ kind: 'card', depth, blocks: [{ type: 'p', runs: [{ text: 'Board: ', b: true }, txt(sub.title)] }] }];
  }
  const blocks = itemBlocks(it);
  return blocks.length ? [{ kind: 'card', depth, blocks, color: it.color }] : [];
}

async function loadImg(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
/* Rasterises an image or sketch card to a size-capped image for embedding. Opaque images become
   JPEG (PNG only when transparency is needed) so boards with hundreds of photos stay a sensible size.
   Results are cached per export so an image used on several slides or pages is only encoded once. */
const IMG_MAX = 1400;
let imageCache = new Map(), imageProgress = null;
function startImageExport(label) {
  imageCache = new Map();
  imageProgress = { label, done: 0, el: toast(label + '…', 0) };
}
function endImageExport() {
  imageProgress?.el.remove();
  imageProgress = null;
  imageCache = new Map();
}
function imageData(it, max = IMG_MAX) {
  const key = `${it.type === 'sketch' ? it.id + ':' + (it.png || '').length : it.blob}|${max}`;
  if (!imageCache.has(key)) imageCache.set(key, encodeImage(it, max).then(d => {
    if (imageProgress) imageProgress.el.textContent = `${imageProgress.label}… ${++imageProgress.done} image${imageProgress.done === 1 ? '' : 's'} prepared`;
    return d;
  }));
  return imageCache.get(key);
}
async function encodeImage(it, max) {
  const src = it.type === 'sketch' ? it.png : await blobUrl(it.blob);
  if (!src) return null;
  try {
    const img = await loadImg(src);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const png = hasTransparency(ctx, c.width, c.height);
    if (!png) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const dataURL = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
    return { dataURL, w: c.width, h: c.height, fmt: png ? 'PNG' : 'JPEG', bytes: dataURLToBytes(dataURL) };
  } catch {
    return null;
  }
}
function hasTransparency(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(d.length / 4 / 40000) * 4);
  for (let i = 3; i < d.length; i += step) if (d[i] < 250) return true;
  return false;
}
function dataURLToBytes(u) {
  const bin = atob(u.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const dateStr = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

// ---------- Word ----------
async function exportDOCX(board, opts) {
  const D = await loadLib('docx');
  const H = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const children = [
    new D.Paragraph({ text: board.title, heading: D.HeadingLevel.TITLE }),
    new D.Paragraph({ children: [new D.TextRun({ text: `Exported from Boardly · ${dateStr()}`, color: '888888', size: 18 })], spacing: { after: 240 } }),
  ];
  let listInstance = 0, prevType = null;
  const runs = rs => rs.map(r => {
    if (r.br) return new D.TextRun({ text: '', break: 1 });
    const o = { text: r.text, bold: r.b, italics: r.i, strike: r.s, underline: r.u ? {} : undefined, highlight: r.mark ? 'yellow' : undefined, font: r.code ? 'Consolas' : undefined };
    return r.link ? new D.ExternalHyperlink({ link: r.link, children: [new D.TextRun({ ...o, style: 'Hyperlink' })] }) : new D.TextRun(o);
  });
  async function block(bl, depth) {
    const type = bl.type;
    if (type === 'oli' && prevType !== 'oli') listInstance++;
    prevType = type;
    switch (type) {
      case 'h1': case 'h2': case 'h3':
        return [new D.Paragraph({ children: runs(bl.runs), heading: H[Math.min(5, depth + +type[1])] })];
      case 'li': return [new D.Paragraph({ children: runs(bl.runs), bullet: { level: Math.min(bl.level, 8) } })];
      case 'oli': return [new D.Paragraph({ children: runs(bl.runs), numbering: { reference: 'ol', level: Math.min(bl.level, 8), instance: listInstance } })];
      case 'task': return [new D.Paragraph({ children: [new D.TextRun({ text: bl.done ? '☑  ' : '☐  ' }), ...runs(bl.runs.map(r => ({ ...r, s: r.s || bl.done })))] })];
      case 'quote': return [new D.Paragraph({ children: runs(bl.runs.map(r => ({ ...r, i: true }))), indent: { left: 567 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'F2B33F', space: 8 } } })];
      case 'code': return [new D.Paragraph({ children: runs(bl.runs.map(r => ({ ...r, code: true }))), shading: { type: D.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } })];
      case 'swatch': return [new D.Paragraph({ children: [new D.TextRun({ text: ' '.repeat(10), shading: { type: D.ShadingType.CLEAR, fill: (bl.hex || '#888888').slice(1), color: 'auto' } }), new D.TextRun({ text: '  ' }), ...runs(bl.runs)] })];
      case 'image': {
        const d = await imageData(bl.it);
        if (!d) return [];
        const w = Math.min(560, d.w), h = Math.round(d.h * w / d.w);
        const out = [new D.Paragraph({ children: [new D.ImageRun({ data: d.bytes, transformation: { width: w, height: h } })] })];
        if (bl.caption) out.push(new D.Paragraph({ children: [new D.TextRun({ text: bl.caption, italics: true, color: '666666', size: 18 })] }));
        return out;
      }
      default: return [new D.Paragraph({ children: runs(bl.runs) })];
    }
  }
  for (const e of outline(board, opts.nested)) {
    if (e.kind === 'section') {
      prevType = null;
      children.push(new D.Paragraph({ text: e.title, heading: H[Math.min(5, e.depth - 1)], spacing: { before: 240 } }));
      continue;
    }
    for (const bl of e.blocks) children.push(...await block(bl, e.depth));
    children.push(new D.Paragraph({ text: '' }));
    prevType = null;
  }
  const doc = new D.Document({
    creator: 'Boardly', title: board.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'ol', levels: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(l => ({ level: l, format: D.LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) }] },
    sections: [{ children }],
  });
  download(await D.Packer.toBlob(doc), slug(board.title) + '.docx');
}

// ---------- PowerPoint ----------
const hex6 = c => {
  if (!c) return null;
  if (c.startsWith('#')) return (normHex(c) || '#888888').slice(1).toUpperCase();
  const m = c.match(/\d+/g);
  return m ? m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
};
function pptRuns(blocks, base, color = '1F2328') {
  const out = [];
  blocks.forEach((bl, bi) => {
    const para = { fontSize: base, color, fontFace: 'Calibri' };
    let prefix = '';
    if (bl.type === 'h1') Object.assign(para, { fontSize: base * 1.6, bold: true });
    if (bl.type === 'h2') Object.assign(para, { fontSize: base * 1.3, bold: true });
    if (bl.type === 'h3') Object.assign(para, { fontSize: base * 1.1, bold: true });
    if (bl.type === 'li') Object.assign(para, { bullet: true, indentLevel: bl.level || 0 });
    if (bl.type === 'oli') Object.assign(para, { bullet: { type: 'number' }, indentLevel: bl.level || 0 });
    if (bl.type === 'quote') para.italic = true;
    if (bl.type === 'code') para.fontFace = 'Consolas';
    if (bl.type === 'task') prefix = bl.done ? '☑ ' : '☐ ';
    if (bl.type === 'image') return;
    const pieces = [];
    if (bl.type === 'swatch') pieces.push({ text: '■ ', options: { ...para, color: hex6(bl.hex) } });
    if (prefix) pieces.push({ text: prefix, options: { ...para } });
    for (const r of bl.runs) {
      if (r.br) { pieces.push({ text: '', options: { ...para, softBreakBefore: false, breakLine: true } }); continue; }
      const o = { ...para };
      if (r.b) o.bold = true;
      if (r.i) o.italic = true;
      if (r.u) o.underline = { style: 'sng' };
      if (r.s || (bl.type === 'task' && bl.done)) o.strike = 'sngStrike';
      if (r.mark) o.highlight = 'FFF3A3';
      if (r.code) o.fontFace = 'Consolas';
      if (r.link) o.hyperlink = { url: r.link };
      pieces.push({ text: r.text, options: o });
    }
    if (!pieces.length) pieces.push({ text: ' ', options: { ...para } });
    if (bi < blocks.length - 1) pieces[pieces.length - 1].options.breakLine = true;
    out.push(...pieces);
  });
  return out;
}
async function exportPPTX(board) {
  const PptxGenJS = await loadLib('pptx');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = board.title;
  pptx.author = 'Boardly';
  const SW = 13.333, SH = 7.5;
  const textCount = board.items.length;

  // Title slide
  let s = pptx.addSlide();
  s.background = { color: 'F1EFEA' };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: SH, fill: { color: '2F6BF2' }, line: { color: '2F6BF2' } });
  s.addText(board.title, { x: 0.9, y: 2.5, w: 11.5, h: 1.3, fontSize: 44, bold: true, color: '1F2328', fontFace: 'Calibri' });
  s.addText(`${textCount} card${textCount === 1 ? '' : 's'} · ${dateStr()}`, { x: 0.9, y: 3.8, w: 11.5, h: 0.5, fontSize: 16, color: '6B6F76', fontFace: 'Calibri' });

  // Overview slide: the board's real layout, as editable shapes
  const tops = topItems(board);
  if (tops.length && board.id === S.board.id) {
    s = pptx.addSlide();
    s.background = { color: 'F1EFEA' };
    s.addText(board.title, { x: 0.4, y: 0.2, w: 12.5, h: 0.5, fontSize: 18, bold: true, color: '1F2328', fontFace: 'Calibri' });
    const byId = new Map(board.items.map(i => [i.id, i]));
    const els = $$('.card', world).map(el => ({ el, it: byId.get(el.dataset.id), r: worldRectOf(el.dataset.id) })).filter(x => x.it && x.r);
    const topEls = els.filter(x => !x.it.columnId);
    const bx = Math.min(...topEls.map(x => x.r.x)), by = Math.min(...topEls.map(x => x.r.y));
    const bw = Math.max(...topEls.map(x => x.r.x + x.r.w)) - bx, bh = Math.max(...topEls.map(x => x.r.y + x.r.h)) - by;
    const areaW = SW - 0.8, areaH = SH - 1.1;
    const k = Math.min(areaW / bw, areaH / bh, 0.02);
    const ox = 0.4 + (areaW - bw * k) / 2, oy = 0.85 + (areaH - bh * k) / 2;
    const P = r => ({ x: ox + (r.x - bx) * k, y: oy + (r.y - by) * k, w: Math.max(0.05, r.w * k), h: Math.max(0.05, r.h * k) });
    const base = clamp(Math.round(14 * k * 72 * 10) / 10, 4, 24);
    const frame = col => ({ fill: { color: col || 'FFFFFF' }, line: { color: 'DDDAD3', width: 0.75 }, rectRadius: 0.04 });
    const order = [...els].sort((a, c) => (a.it.type === 'column' ? 0 : 1) - (c.it.type === 'column' ? 0 : 1) || (a.it.z || 0) - (c.it.z || 0));
    for (const { el, it, r } of order) {
      const p = P(r);
      const bg = hex6(it.color);
      const textOpts = { ...p, valign: 'top', margin: Math.max(1, 6 * k * 72), fontFace: 'Calibri', fit: 'shrink', shape: pptx.ShapeType.roundRect, ...frame(bg) };
      if (it.type === 'column') {
        s.addShape(pptx.ShapeType.roundRect, { ...p, ...frame(bg || 'E7E4DE') });
        s.addText(it.title || 'Column', { x: p.x, y: p.y, w: p.w, h: Math.min(p.h, 40 * k), fontSize: base, bold: true, color: '1F2328', margin: Math.max(1, 6 * k * 72), valign: 'middle' });
      } else if (it.type === 'image' || it.type === 'sketch') {
        const img = $('img', el);
        const d = img ? await imageData(it) : null;
        if (d) {
          const ir = img.getBoundingClientRect(), z = S.view.z, tl = screenToWorld(ir.left, ir.top);
          s.addImage({ data: d.dataURL, ...P({ x: tl.x, y: tl.y, w: ir.width / z, h: ir.height / z }) });
          if (it.caption) s.addText(it.caption, { x: p.x, y: p.y + (ir.height / z) * k, w: p.w, h: Math.max(0.1, p.h - (ir.height / z) * k), fontSize: base * 0.9, color: '6B6F76', valign: 'top', margin: 2 });
        } else s.addText(it.caption || 'Sketch', { ...textOpts, fontSize: base });
      } else if (it.type === 'board') {
        const b = S.boards.get(it.boardId);
        s.addShape(pptx.ShapeType.roundRect, { ...p, ...frame('FFFFFF') });
        s.addShape(pptx.ShapeType.roundRect, { x: p.x + p.w * 0.07, y: p.y + p.h * 0.07, w: p.w * 0.86, h: p.h * 0.52, fill: { color: hex6(b?.color) || 'CCCCCC' }, line: { color: hex6(b?.color) || 'CCCCCC' }, rectRadius: 0.03 });
        s.addText(b?.title || 'Board', { x: p.x, y: p.y + p.h * 0.6, w: p.w, h: p.h * 0.4, fontSize: base, bold: true, align: 'center', valign: 'middle', color: '1F2328', margin: 1 });
      } else if (it.type === 'swatch') {
        s.addShape(pptx.ShapeType.roundRect, { ...p, ...frame('FFFFFF') });
        s.addShape(pptx.ShapeType.rect, { x: p.x, y: p.y, w: p.w, h: p.h * 0.62, fill: { color: hex6(it.hex) }, line: { color: hex6(it.hex) } });
        s.addText(`${(it.hex || '').toUpperCase()}${it.name ? '\n' + it.name : ''}`, { x: p.x, y: p.y + p.h * 0.62, w: p.w, h: p.h * 0.38, fontSize: base * 0.9, color: '1F2328', margin: 2, valign: 'middle' });
      } else if (it.type === 'heading') {
        s.addText(it.text || '', { ...p, fontSize: base * 2, bold: true, color: '1F2328', valign: 'top', margin: 1, fit: 'shrink' });
      } else {
        const runs = pptRuns(itemBlocks(it), base, '1F2328');
        s.addText(runs.length ? runs : ' ', textOpts);
      }
    }
    for (const c of board.conns) {
      const pts = connPoints(c);
      if (!pts) continue;
      const a = P({ x: pts[0].x, y: pts[0].y, w: 0, h: 0 }), b = P({ x: pts[1].x, y: pts[1].y, w: 0, h: 0 });
      const col = hex6(c.color || LINE_COLORS[0]);
      s.addShape(pptx.ShapeType.line, {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(0.01, Math.abs(b.x - a.x)), h: Math.max(0.01, Math.abs(b.y - a.y)),
        flipH: b.x < a.x, flipV: b.y < a.y, line: { color: col, width: 1.5, endArrowType: c.arrow === false ? undefined : 'triangle' },
      });
      if (c.label) s.addText(c.label, { x: (a.x + b.x) / 2 - 1, y: (a.y + b.y) / 2 - 0.15, w: 2, h: 0.3, fontSize: base, bold: true, align: 'center', color: '1F2328' });
    }
  }

  // Detail slides: one per column, grouped text slides, and one per image
  const titled = (title) => {
    const sl = pptx.addSlide();
    sl.background = { color: 'FFFFFF' };
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SW, h: 0.12, fill: { color: '2F6BF2' }, line: { color: '2F6BF2' } });
    sl.addText(title, { x: 0.6, y: 0.35, w: 12, h: 0.8, fontSize: 28, bold: true, color: '1F2328', fontFace: 'Calibri' });
    return sl;
  };
  const textBox = { x: 0.6, y: 1.3, w: 12.1, h: 5.8, valign: 'top', fontFace: 'Calibri', fit: 'shrink', paraSpaceAfter: 4 };
  const images = [];
  const flushText = (title, blocks) => {
    if (!blocks.length) return;
    const runs = pptRuns(blocks, 18);
    if (runs.length) titled(title).addText(runs, textBox);
  };
  const chunked = (title, cardsBlocks) => {
    let acc = [], len = 0, part = 0;
    const parts = [];
    for (const blocks of cardsBlocks) {
      const l = blocks.reduce((n, b) => n + b.runs?.reduce((m, r) => m + (r.text?.length || 0), 0) + 40, 0);
      if (acc.length && len + l > 900) { parts.push(acc); acc = []; len = 0; }
      acc.push(...blocks, { type: 'p', runs: [txt('')] });
      len += l;
    }
    if (acc.length) parts.push(acc);
    for (const p of parts) flushText(parts.length > 1 ? `${title} (${++part}/${parts.length})` : title, p.slice(0, -1));
  };
  const loose = [];
  for (const it of readingOrder(tops)) {
    if (it.type === 'column') {
      const kids = childrenOf(it.id, board);
      kids.filter(k => k.type === 'image' || k.type === 'sketch').forEach(k => images.push(k));
      chunked(it.title || 'Column', kids.filter(k => k.type !== 'image' && k.type !== 'sketch').map(k => k.type === 'board' ? [{ type: 'li', level: 0, runs: [txt('Board: ' + (S.boards.get(k.boardId)?.title || ''))] }] : itemBlocks(k)));
    } else if (it.type === 'image' || it.type === 'sketch') images.push(it);
    else if (it.type !== 'board' && it.type !== 'heading') loose.push(itemBlocks(it));
  }
  chunked('Notes', loose.filter(b => b.length));
  for (const it of images) {
    const d = await imageData(it);
    if (!d) continue;
    const sl = titled(it.caption || (it.type === 'sketch' ? 'Sketch' : 'Image'));
    const maxW = 12.1, maxH = 5.8, sc = Math.min(maxW / d.w, maxH / d.h);
    sl.addImage({ data: d.dataURL, x: 0.6 + (maxW - d.w * sc) / 2, y: 1.3 + (maxH - d.h * sc) / 2, w: d.w * sc, h: d.h * sc });
  }
  const subs = tops.filter(i => i.type === 'board').map(i => S.boards.get(i.boardId)).filter(b => b && !b.trashed);
  if (subs.length) {
    titled('Boards inside this board').addText(subs.map((b, i) => ({ text: `${b.title} — ${b.items.length} cards`, options: { bullet: true, fontSize: 20, color: '1F2328', breakLine: i < subs.length - 1 } })), textBox);
  }
  download(await pptx.write({ outputType: 'blob', compression: true }), slug(board.title) + '.pptx');
}

// ---------- snapshot (PDF & PNG) ----------
async function snapshotBoard(board) {
  const html2canvas = await loadLib('h2c');
  const ids = new Set(board.items.map(i => i.id));
  const rects = topItems(board).map(i => worldRectOf(i.id)).filter(Boolean);
  if (!rects.length) throw new Error('Nothing to export');
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const b = { x: x0, y: y0, w: Math.max(...rects.map(r => r.x + r.w)) - x0, h: Math.max(...rects.map(r => r.y + r.h)) - y0 };
  const pad = 40;
  const W = Math.ceil(b.w + pad * 2), H = Math.ceil(b.h + pad * 2);
  const host = document.createElement('div');
  const bg = getComputedStyle(viewport).backgroundColor;
  host.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;background:${bg};z-index:-1;pointer-events:none`;
  const clone = world.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.transform = `translate(${pad - b.x}px, ${pad - b.y}px)`;
  $$('.selected, .editing', clone).forEach(e => e.classList.remove('selected', 'editing'));
  $$('.handle-connect, .handle-resize, .card-btn, .video-play', clone).forEach(e => e.remove());
  $$('iframe', clone).forEach(f => f.replaceWith(Object.assign(document.createElement('div'), { style: 'position:absolute;inset:0;background:#111' })));
  $$('.add-task', clone).forEach(e => { e.style.visibility = 'hidden'; });
  $('svg', clone)?.remove();
  // Drop cards that aren't being exported. A column whose cards were picked individually stays as
  // an invisible placeholder so those cards keep their positions.
  $$(':scope > .card', clone).forEach(el => {
    if (ids.has(el.dataset.id)) return;
    const kids = $$(':scope > .col-body > .card', el);
    if (!kids.some(k => ids.has(k.dataset.id))) return el.remove();
    Object.assign(el.style, { visibility: 'hidden', background: 'transparent', borderColor: 'transparent', boxShadow: 'none' });
    kids.forEach(k => { k.style.visibility = ids.has(k.dataset.id) ? 'visible' : 'hidden'; });
  });
  // html2canvas misplaces box shadows on wide cards, so the copy uses a hairline border instead.
  $$('.card', clone).forEach(el => {
    el.style.boxShadow = 'none';
    if (!el.classList.contains('t-heading')) el.style.border = '1px solid rgba(0,0,0,.09)';
  });
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const scale = Math.min(2, 9000 / Math.max(W, H));
    const canvas = await html2canvas(host, {
      backgroundColor: bg, scale, useCORS: true, logging: false, width: W, height: H,
      // Only the off-screen copy belongs in the picture, not the live board, toolbars or messages.
      ignoreElements: el => el.classList?.contains('toast-wrap') || ['layer', 'viewport', 'toolbar', 'topbar'].includes(el.id),
    });
    drawConnections(canvas.getContext('2d'), board, (x, y) => [(x - b.x + pad) * scale, (y - b.y + pad) * scale], scale);
    return canvas;
  } finally {
    host.remove();
  }
}
/* html2canvas skips inline SVG, so connection lines are painted onto the snapshot directly. */
function drawConnections(ctx, board, map, scale) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const c of board.conns) {
    const pts = connPoints(c);
    if (!pts) continue;
    const [a, b] = pts.map(p => map(p.x, p.y));
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = c.color || LINE_COLORS[0];
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    if (c.arrow !== false) {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 11 * scale;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - L * Math.cos(ang - 0.42), b[1] - L * Math.sin(ang - 0.42));
      ctx.lineTo(b[0] - L * Math.cos(ang + 0.42), b[1] - L * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
    }
    if (c.label) {
      ctx.font = `600 ${12 * scale}px -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5 * scale;
      ctx.strokeStyle = getComputedStyle(viewport).backgroundColor;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      ctx.strokeText(c.label, mx, my);
      ctx.fillStyle = '#1f2328';
      ctx.fillText(c.label, mx, my);
    }
    ctx.restore();
  }
}
async function exportPNG(board) {
  const c = await snapshotBoard(board);
  c.toBlob(blob => download(blob, slug(board.title) + '.png'), 'image/png');
}

// ---------- PDF ----------
const pdfSafe = s => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[☑]/g, '[x]').replace(/[☐]/g, '[ ]').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF•]/g, '');
async function exportPDF(board, opts) {
  const { jsPDF } = await loadLib('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  let W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const M = 40;
  pdf.setProperties({ title: board.title, creator: 'Boardly' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(pdfSafe(board.title), M, M + 10);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(120);
  pdf.text(pdfSafe(`Exported from Boardly · ${dateStr()}`), M, M + 28);
  if (board.items.length) {
    const c = await snapshotBoard(board);
    const maxW = W - M * 2, maxH = H - M * 2 - 40;
    const sc = Math.min(maxW / c.width, maxH / c.height);
    pdf.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', M + (maxW - c.width * sc) / 2, M + 40, c.width * sc, c.height * sc);
  }

  // Text outline pages
  const entries = outline(board, opts.nested);
  if (!entries.length) return download(pdf.output('blob'), slug(board.title) + '.pdf');
  pdf.addPage('a4', 'portrait');
  W = pdf.internal.pageSize.getWidth();
  H = pdf.internal.pageSize.getHeight();
  const PM = 56;
  let y = PM;
  const ensure = h => { if (y + h > H - PM) { pdf.addPage('a4', 'portrait'); y = PM; } };
  const write = (text, { size = 11, bold = false, italic = false, color = [31, 35, 40], indent = 0, after = 4 } = {}) => {
    pdf.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lh = size * 1.4;
    for (const line of pdf.splitTextToSize(pdfSafe(text), W - PM * 2 - indent)) {
      ensure(lh);
      pdf.text(line, PM + indent, y + size);
      y += lh;
    }
    y += after;
  };
  write(board.title, { size: 20, bold: true, after: 10 });
  const runText = runs => runs.map(r => r.br ? '\n' : r.link && r.text !== r.link ? `${r.text} (${r.link})` : r.text || '').join('');
  let olCount = 0;
  for (const e of entries) {
    if (e.kind === 'section') {
      ensure(40);
      y += 8;
      write(e.title, { size: Math.max(12, 18 - e.depth * 2), bold: true, after: 6 });
      continue;
    }
    for (const bl of e.blocks) {
      const ind = Math.min(e.depth, 3) * 0;
      if (bl.type !== 'oli') olCount = 0;
      switch (bl.type) {
        case 'h1': write(runText(bl.runs), { size: 16, bold: true, indent: ind }); break;
        case 'h2': write(runText(bl.runs), { size: 14, bold: true, indent: ind }); break;
        case 'h3': write(runText(bl.runs), { size: 12, bold: true, indent: ind }); break;
        case 'li': write('•  ' + runText(bl.runs), { indent: ind + 14 + bl.level * 14, after: 2 }); break;
        case 'oli': write(`${++olCount}.  ` + runText(bl.runs), { indent: ind + 14 + bl.level * 14, after: 2 }); break;
        case 'task': write((bl.done ? '[x]  ' : '[  ]  ') + runText(bl.runs), { indent: ind + 6, color: bl.done ? [140, 140, 140] : [31, 35, 40], after: 2 }); break;
        case 'quote': write(runText(bl.runs), { italic: true, indent: ind + 14, color: [90, 90, 90] }); break;
        case 'code': pdf.setFont('courier'); write(runText(bl.runs), { indent: ind + 10 }); break;
        case 'swatch': {
          ensure(22);
          const rgb = (normHex(bl.hex) || '#888888').slice(1).match(/../g).map(h => parseInt(h, 16));
          pdf.setFillColor(...rgb);
          pdf.roundedRect(PM + ind, y + 2, 34, 16, 3, 3, 'F');
          const yy = y;
          y = yy;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(31, 35, 40);
          pdf.text(pdfSafe(runText(bl.runs)), PM + ind + 44, y + 14);
          y += 24;
          break;
        }
        case 'image': {
          const d = await imageData(bl.it, 1000);
          if (!d) break;
          const maxW = W - PM * 2, maxH = 360;
          const sc = Math.min(maxW / d.w, maxH / d.h, 1);
          ensure(d.h * sc + 8);
          pdf.addImage(d.dataURL, d.fmt, PM + ind, y, d.w * sc, d.h * sc, 'img-' + (bl.it.blob || bl.it.id), 'FAST');
          y += d.h * sc + 6;
          if (bl.caption) write(bl.caption, { size: 9, italic: true, color: [110, 110, 110] });
          break;
        }
        default: write(runText(bl.runs), { indent: ind });
      }
    }
    y += 8;
  }
  download(pdf.output('blob'), slug(board.title) + '.pdf');
}

// ---------- Markdown ----------
async function exportMD(board, opts) {
  const inline = runs => runs.map(r => {
    if (r.br) return '  \n';
    let t = r.text || '';
    if (!t.trim()) return t;
    if (r.code) t = '`' + t + '`';
    if (r.b) t = `**${t}**`;
    if (r.i) t = `*${t}*`;
    if (r.s) t = `~~${t}~~`;
    if (r.link) t = `[${t}](${r.link})`;
    return t;
  }).join('');
  const lines = [`# ${board.title}`, '', `_Exported from Boardly · ${dateStr()}_`, ''];
  let n = 0;
  for (const e of outline(board, opts.nested)) {
    if (e.kind === 'section') { lines.push('#'.repeat(Math.min(6, e.depth + 1)) + ' ' + e.title, ''); continue; }
    for (const bl of e.blocks) {
      if (bl.type !== 'oli') n = 0;
      const ind = '  '.repeat(bl.level || 0);
      switch (bl.type) {
        case 'h1': case 'h2': case 'h3': lines.push('#'.repeat(Math.min(6, e.depth + 1 + +bl.type[1])) + ' ' + inline(bl.runs)); break;
        case 'li': lines.push(`${ind}- ${inline(bl.runs)}`); break;
        case 'oli': lines.push(`${ind}${++n}. ${inline(bl.runs)}`); break;
        case 'task': lines.push(`- [${bl.done ? 'x' : ' '}] ${inline(bl.runs)}`); break;
        case 'quote': lines.push('> ' + inline(bl.runs)); break;
        case 'code': lines.push('```', bl.runs.map(r => r.br ? '\n' : r.text).join(''), '```'); break;
        case 'swatch': lines.push(`- 🎨 \`${bl.hex}\` ${inline(bl.runs).replace(bl.hex.toUpperCase(), '').replace(/^ — /, '')}`); break;
        case 'image': {
          const d = await imageData(bl.it, 1200);
          if (d) lines.push(`![${bl.caption || ''}](${d.dataURL})`);
          break;
        }
        default: lines.push(inline(bl.runs), '');
      }
    }
    lines.push('');
  }
  download(new Blob([lines.join('\n')], { type: 'text/markdown' }), slug(board.title) + '.md');
}

// ---------- export dialog ----------
/* A throwaway copy of a board holding only the chosen cards (plus the contents of chosen columns).
   Cards are cloned, so exporting a selection never changes the saved board. */
function selectionBoard(board, chosen) {
  const ids = new Set(chosen);
  for (const it of board.items) if (it.columnId && ids.has(it.columnId)) ids.add(it.id);
  const items = board.items.filter(i => ids.has(i.id)).map(i => {
    const c = structuredClone(i);
    if (c.columnId && !ids.has(c.columnId)) {
      const r = worldRectOf(c.id);
      c.columnId = null;
      if (r) Object.assign(c, { x: r.x, y: r.y });
    }
    return c;
  });
  const n = chosen.length;
  return { ...board, title: `${board.title} (${n} selected card${n === 1 ? '' : 's'})`, items, conns: board.conns.filter(c => ids.has(c.from) && ids.has(c.to)) };
}
const EXPORTS = [
  ['docx', 'Word document', 'Editable .docx — text, lists, tasks, links and images. Opens in Word, Pages and Google Docs.', '#2b579a', 'DOC'],
  ['pptx', 'PowerPoint', 'Editable .pptx — a slide with the board laid out as shapes, plus slides per column, notes and images.', '#c43e1c', 'PPT'],
  ['pdf', 'PDF', 'A visual snapshot of the board followed by a readable text outline.', '#d93a3a', 'PDF'],
  ['png', 'Image', 'A high-resolution .png picture of the whole board.', '#3aa76d', 'PNG'],
  ['md', 'Markdown', 'Plain-text .md with headings, lists and embedded images.', '#555b66', 'MD'],
  ['json', 'Boardly file', 'A .json copy of this board and its sub-boards that can be imported again.', '#8a4fd8', '{ }'],
];
function openExport(only) {
  exitEdit();
  const chosen = only?.length ? only : null;
  const board = chosen ? selectionBoard(S.board, chosen) : S.board;
  const formats = chosen ? EXPORTS.filter(f => f[0] !== 'json') : EXPORTS;
  const wrap = document.createElement('div');
  wrap.innerHTML = `${chosen ? `<p class="muted" style="margin:0 0 12px">Only the ${chosen.length} selected card${chosen.length === 1 ? '' : 's'} will be exported, so the file stays smaller.</p>` : ''}
    <div class="export-grid">${formats.map(([k, t, d, c, b]) => `<button class="export-opt" data-fmt="${k}"><span class="badge" style="background:${c}">${b}</span><div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div>
    <label class="check"><input type="checkbox" checked data-nested> Include boards inside ${chosen ? 'the selected board cards' : 'this board'} (Word, PDF, Markdown)</label>`;
  const m = openModal({ title: chosen ? `Export ${chosen.length} selected card${chosen.length === 1 ? '' : 's'}` : `Export “${board.title}”`, body: wrap });
  wrap.addEventListener('click', async e => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    const opts = { nested: $('[data-nested]', wrap).checked };
    closeModal(m);
    startImageExport('Preparing export');
    try {
      const sel = new Set(S.sel);
      clearSelection();
      await flushSave();
      switch (b.dataset.fmt) {
        case 'docx': await exportDOCX(board, opts); break;
        case 'pptx': await exportPPTX(board); break;
        case 'pdf': await exportPDF(board, opts); break;
        case 'png': await exportPNG(board); break;
        case 'md': await exportMD(board, opts); break;
        case 'json': await exportBackup(board.id); break;
      }
      S.sel = sel;
      syncSelection();
      toast('Export ready — check your downloads');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + err.message, 8000);
    } finally {
      endImageExport();
    }
  });
}
