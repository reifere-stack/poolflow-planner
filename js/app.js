/* ===== PoolFlow Planner — mobile-first rewrite =====
   Single Pointer Events handler for drag + multi-touch pinch/pan.
   Persistence via localStorage. PDF/JSON export. GitHub push (token modal).
*/

(() => {

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const world = $('world'), viewport = $('viewport'), canvasArea = $('canvasArea');
const edgeSvg = $('edgeSvg'), dimSvg = $('dimSvg');
const sheet = $('sheet'), sheetBody = $('sheetBody'), sheetTabs = $('sheetTabs');
const statusPill = $('statusPill');
const toastEl = $('toast');
const modalBackdrop = $('modalBackdrop'), modalContent = $('modalContent');
const connectBanner = $('connectBanner');

// ---------- State ----------
const STORE_KEY = 'poolflow-planner-v2';

const state = {
  items: [],
  edges: [],
  dims: [],
  selectedId: null,
  connectMode: false,
  connectSourceId: null,
  pendingPipe: { type:'return', size:'2"' },
  view: { scale: 1, tx: 0, ty: 0 },
  scale: { pxPerFoot: 24 },
  nextId: 1,
  lastSolve: null,
  undoStack: [],
};

// ---------- Real-world conversion ----------
function pxPerFoot() { return state.scale?.pxPerFoot || 24; }
function pxToFeet(px) { return px / pxPerFoot(); }
function feetToPx(ft) { return ft * pxPerFoot(); }
function pxToFI(px) {
  const totalIn = Math.round(pxToFeet(px) * 12);
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 };
}
function fiToPx(ft, inches) {
  const f = Math.max(0, Number(ft) || 0);
  const i = Math.max(0, Number(inches) || 0);
  return Math.round(feetToPx(f + i / 12));
}
function fmtFI(px) {
  const { ft, in: i } = pxToFI(px);
  return i ? `${ft}′ ${i}″` : `${ft}′`;
}
function fmtFIShort(px) {
  const totalFt = pxToFeet(px);
  if (totalFt < 1) {
    const inches = Math.round(totalFt * 12);
    return `${inches}″`;
  }
  const { ft, in: i } = pxToFI(px);
  return i ? `${ft}′${i}″` : `${ft}′`;
}

// ---------- Persistence ----------
function persist() {
  const snap = { items: state.items, edges: state.edges, dims: state.dims, nextId: state.nextId, view: state.view, pendingPipe: state.pendingPipe, scale: state.scale };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snap)); } catch {}
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.items)) return false;
    state.items = s.items;
    state.edges = s.edges || [];
    state.dims = s.dims || [];
    state.nextId = s.nextId || (s.items.length + 1);
    state.view = s.view || { scale:1, tx:0, ty:0 };
    state.pendingPipe = s.pendingPipe || { type:'return', size:'2"' };
    state.scale = s.scale && s.scale.pxPerFoot ? s.scale : { pxPerFoot: 24 };
    return true;
  } catch { return false; }
}
function uid() { return 'n' + (state.nextId++); }
function pushUndo() {
  state.undoStack.push(JSON.stringify({ items: state.items, edges: state.edges, dims: state.dims }));
  if (state.undoStack.length > 30) state.undoStack.shift();
}
function undo() {
  const last = state.undoStack.pop();
  if (!last) { toast('Nothing to undo'); return; }
  const s = JSON.parse(last);
  state.items = s.items; state.edges = s.edges; state.dims = s.dims;
  state.selectedId = null;
  redrawAll(); persist();
}

// ---------- View transform (pan & zoom) ----------
function applyTransform() {
  world.style.transform = `translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`;
}
function clientToWorld(cx, cy) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (cx - rect.left - state.view.tx) / state.view.scale,
    y: (cy - rect.top  - state.view.ty) / state.view.scale,
  };
}
function setZoom(newScale, anchorClientX, anchorClientY) {
  const s = Math.max(0.25, Math.min(3, newScale));
  if (anchorClientX == null) {
    const rect = viewport.getBoundingClientRect();
    anchorClientX = rect.left + rect.width / 2;
    anchorClientY = rect.top + rect.height / 2;
  }
  const before = clientToWorld(anchorClientX, anchorClientY);
  state.view.scale = s;
  const after = clientToWorld(anchorClientX, anchorClientY);
  state.view.tx += (after.x - before.x) * s;
  state.view.ty += (after.y - before.y) * s;
  applyTransform();
}
function fitToContent() {
  if (!state.items.length) {
    state.view = { scale: 1, tx: 20, ty: 20 };
    applyTransform();
    return;
  }
  const pad = 40;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const i of state.items) {
    minX = Math.min(minX, i.x);
    minY = Math.min(minY, i.y);
    maxX = Math.max(maxX, i.x + i.w);
    maxY = Math.max(maxY, i.y + i.h);
  }
  // Account for the bottom sheet eating ~80px (mid) or more (open)
  const sheetEl = document.getElementById('sheet');
  const sheetH = sheetEl?.getBoundingClientRect ? Math.max(80, window.innerHeight - sheetEl.getBoundingClientRect().top) : 80;
  const isMobile = window.innerWidth < 900;
  const reserved = isMobile ? (sheetEl?.classList.contains('open') ? sheetH : 90) : 0;
  const cw = canvasArea.clientWidth - (isMobile ? 0 : 0);
  const ch = Math.max(120, canvasArea.clientHeight - reserved);
  const w = maxX - minX + pad*2, h = maxY - minY + pad*2;
  const sc = Math.min(cw / w, ch / h, 1.6);
  state.view.scale = Math.max(0.3, sc);
  state.view.tx = -((minX - pad) * state.view.scale) + (cw - (w * state.view.scale)) / 2;
  state.view.ty = -((minY - pad) * state.view.scale) + 16;
  applyTransform();
}

// ---------- Pointer manager (drag, pan, pinch) ----------
const pointers = new Map(); // id -> { clientX, clientY, target }
let dragMode = null;        // 'pan' | 'pinch' | 'node' | 'resize' | null
let dragData = null;
const TAP_THRESHOLD = 8;    // px before counts as drag
const LONG_PRESS_MS = 500;
let longPressTimer = null;
let longPressFired = false;

function onPointerDown(e) {
  // Don't intercept controls
  if (e.target.closest('button, input, select, textarea, .sheet, .topbar, .hud, .modal-backdrop')) return;

  const p = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, target: e.target, startX: e.clientX, startY: e.clientY, moved: false };
  pointers.set(e.pointerId, p);
  viewport.setPointerCapture?.(e.pointerId);

  const nodeEl = e.target.closest('.node');
  const handle  = e.target.closest('.resize-handle');

  if (pointers.size === 2) {
    // Start pinch
    dragMode = 'pinch';
    const pts = [...pointers.values()];
    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    dragData = {
      startDist: Math.hypot(dx, dy),
      startScale: state.view.scale,
      midX: (pts[0].clientX + pts[1].clientX)/2,
      midY: (pts[0].clientY + pts[1].clientY)/2,
      startTx: state.view.tx,
      startTy: state.view.ty,
    };
    clearLongPress();
    return;
  }

  if (handle && state.selectedId) {
    dragMode = 'resize';
    const item = getItem(state.selectedId);
    dragData = { item, startW: item.w, startH: item.h, startX: e.clientX, startY: e.clientY };
    clearLongPress();
    e.preventDefault();
    return;
  }

  if (nodeEl) {
    const id = nodeEl.dataset.id;
    const item = getItem(id);
    if (!item) return;

    if (state.connectMode) {
      // Tap-to-connect flow
      handleConnectTap(id);
      clearLongPress();
      return;
    }

    dragMode = 'node';
    dragData = {
      item,
      startX: e.clientX, startY: e.clientY,
      origX: item.x, origY: item.y,
      element: nodeEl,
    };
    nodeEl.classList.add('dragging');
    selectItem(id);
    // long-press to open quick valve toggle / property
    longPressFired = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      if (item.type === 'valve2' || item.type === 'valve3') {
        cycleValve(item);
        toast(`Valve: ${item.valveState || 'open'}`);
      } else {
        openSheetTab('selected');
        openSheet();
      }
    }, LONG_PRESS_MS);
    e.preventDefault();
    return;
  }

  // Empty canvas → pan
  dragMode = 'pan';
  dragData = { startTx: state.view.tx, startTy: state.view.ty, startX: e.clientX, startY: e.clientY };
  clearLongPress();
}

function onPointerMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.clientX = e.clientX; p.clientY = e.clientY;
  const dx0 = e.clientX - p.startX, dy0 = e.clientY - p.startY;
  if (Math.hypot(dx0, dy0) > TAP_THRESHOLD) p.moved = true;

  if (dragMode === 'pinch' && pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    const dist = Math.hypot(dx, dy);
    const newScale = Math.max(0.25, Math.min(3, dragData.startScale * (dist / dragData.startDist)));
    const midX = (pts[0].clientX + pts[1].clientX) / 2;
    const midY = (pts[0].clientY + pts[1].clientY) / 2;
    // anchor zoom on midpoint, also pan with midpoint drift
    const before = clientToWorld(midX, midY);
    state.view.scale = newScale;
    const after = clientToWorld(midX, midY);
    state.view.tx += (after.x - before.x) * state.view.scale;
    state.view.ty += (after.y - before.y) * state.view.scale;
    // also account for midpoint movement
    state.view.tx += (midX - dragData.midX);
    state.view.ty += (midY - dragData.midY);
    dragData.midX = midX; dragData.midY = midY;
    applyTransform();
    return;
  }

  if (dragMode === 'pan') {
    state.view.tx = dragData.startTx + (e.clientX - dragData.startX);
    state.view.ty = dragData.startTy + (e.clientY - dragData.startY);
    applyTransform();
    return;
  }

  if (dragMode === 'node') {
    if (longPressFired) return; // ignore drag after long press
    if (p.moved) {
      clearLongPress();
      const dxw = (e.clientX - dragData.startX) / state.view.scale;
      const dyw = (e.clientY - dragData.startY) / state.view.scale;
      const item = dragData.item;
      item.x = Math.round((dragData.origX + dxw) / 4) * 4;
      item.y = Math.round((dragData.origY + dyw) / 4) * 4;
      dragData.element.style.left = item.x + 'px';
      dragData.element.style.top  = item.y + 'px';
      drawEdges(); drawDims();
    }
    return;
  }

  if (dragMode === 'resize' && dragData.item) {
    const dxw = (e.clientX - dragData.startX) / state.view.scale;
    const dyw = (e.clientY - dragData.startY) / state.view.scale;
    const item = dragData.item;
    const inchPx = pxPerFoot() / 12;
    const snap = RESIZABLE.has(item.type) ? inchPx : 4;
    item.w = Math.max(50, Math.round((dragData.startW + dxw) / snap) * snap);
    item.h = Math.max(40, Math.round((dragData.startH + dyw) / snap) * snap);
    const el = nodeEl(item.id);
    if (el) {
      el.style.width = item.w + 'px';
      el.style.height = item.h + 'px';
      const meta = el.querySelector('.meta');
      if (meta) meta.textContent = metaText(item);
    }
    drawEdges(); drawDims();
    return;
  }
}

function onPointerUp(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  clearLongPress();
  if (!p) return;

  if (dragMode === 'pinch' && pointers.size < 2) {
    dragMode = pointers.size === 1 ? 'pan' : null;
    if (dragMode === 'pan') {
      const remaining = [...pointers.values()][0];
      dragData = { startTx: state.view.tx, startTy: state.view.ty, startX: remaining.clientX, startY: remaining.clientY };
      remaining.startX = remaining.clientX; remaining.startY = remaining.clientY;
    } else {
      dragData = null;
    }
    return;
  }

  if (dragMode === 'node') {
    dragData?.element?.classList.remove('dragging');
    if (!p.moved && !longPressFired) {
      // tap → already selected on down; nothing extra
    } else if (p.moved) {
      pushUndo(); // commit move
    }
    dragMode = null; dragData = null; persist();
    return;
  }

  if (dragMode === 'resize') {
    pushUndo(); persist();
    dragMode = null; dragData = null;
    syncSelectedPanel();
    return;
  }

  if (dragMode === 'pan') {
    // Tap on empty area → deselect
    if (!p.moved) {
      selectItem(null);
    }
    dragMode = null; dragData = null;
  }
}
function clearLongPress() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }

viewport.addEventListener('pointerdown', onPointerDown, { passive:false });
viewport.addEventListener('pointermove', onPointerMove, { passive:false });
viewport.addEventListener('pointerup', onPointerUp);
viewport.addEventListener('pointercancel', onPointerUp);
viewport.addEventListener('pointerleave', onPointerUp);

// Wheel zoom for desktop / trackpad
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = -e.deltaY * 0.0015;
  setZoom(state.view.scale * (1 + delta), e.clientX, e.clientY);
}, { passive:false });

// Prevent iOS Safari rubber-band on the canvas
document.addEventListener('gesturestart', e => e.preventDefault());

// ---------- Items ----------
function getItem(id) { return state.items.find(i => i.id === id); }
function nodeEl(id) { return world.querySelector(`.node[data-id="${id}"]`); }

function addItem(type, opts = {}) {
  const tool = TOOLS[type] || { w:100, h:60, label:type };
  // Place near center of current view
  const rect = viewport.getBoundingClientRect();
  const center = clientToWorld(rect.left + rect.width/2, rect.top + rect.height/3);
  const offset = state.items.length * 14;
  const item = {
    id: uid(),
    type,
    label: opts.label || tool.label,
    size: opts.size || '',
    notes: opts.notes || '',
    relation: opts.relation || '',
    valveState: opts.valveState || (type==='valve2' ? 'open' : type==='valve3' ? 'both' : ''),
    x: opts.x ?? Math.round((center.x - tool.w/2 + offset) / 4) * 4,
    y: opts.y ?? Math.round((center.y - tool.h/2 + offset) / 4) * 4,
    w: opts.w ?? tool.w,
    h: opts.h ?? tool.h,
  };
  pushUndo();
  state.items.push(item);
  renderItem(item);
  selectItem(item.id);
  persist();
  return item;
}

function renderItem(item) {
  const tool = TOOLS[item.type] || {};
  const el = document.createElement('div');
  el.className = 'node ' + (NODE_CLASS[item.type] || '');
  if (RESIZABLE.has(item.type)) el.classList.add('resizable');
  if ((item.type==='valve2' && item.valveState==='closed') ||
      (item.type==='valve3' && item.valveState==='')) {
    el.classList.add('closed-state');
  }
  el.dataset.id = item.id;
  Object.assign(el.style, { left: item.x+'px', top: item.y+'px', width: item.w+'px', height: item.h+'px' });
  el.innerHTML = `
    <div class="icon">${iconMarkup(item.type)}</div>
    <div class="title">${escapeHtml(item.label)}</div>
    <div class="meta">${escapeHtml(metaText(item))}</div>
    <div class="resize-handle" aria-label="Resize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 21h12V9"/><path d="M14 14l7 7"/></svg></div>
  `;
  world.appendChild(el);
}
function metaText(item) {
  const bits = [];
  if (RESIZABLE.has(item.type)) {
    bits.push(`${fmtFIShort(item.w)} × ${fmtFIShort(item.h)}`);
  }
  if (item.size) bits.push(item.size);
  if (item.valveState) bits.push(item.valveState);
  if (item.relation) bits.push('→' + item.relation);
  if (item.notes) bits.push(item.notes);
  return bits.join(' · ');
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function refreshItem(item) {
  const el = nodeEl(item.id);
  if (!el) { renderItem(item); return; }
  el.className = 'node ' + (NODE_CLASS[item.type] || '');
  if (RESIZABLE.has(item.type)) el.classList.add('resizable');
  if ((item.type==='valve2' && item.valveState==='closed')) el.classList.add('closed-state');
  if (state.selectedId === item.id) el.classList.add('selected');
  Object.assign(el.style, { left: item.x+'px', top: item.y+'px', width: item.w+'px', height: item.h+'px' });
  el.querySelector('.title').textContent = item.label;
  el.querySelector('.meta').textContent  = metaText(item);
}

function deleteItem(id) {
  pushUndo();
  state.items = state.items.filter(i => i.id !== id);
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  state.dims  = state.dims.filter(d => d.a !== id && d.b !== id);
  const el = nodeEl(id); if (el) el.remove();
  if (state.selectedId === id) state.selectedId = null;
  solveFlow(); persist(); renderSheet();
}

function selectItem(id) {
  state.selectedId = id;
  world.querySelectorAll('.node').forEach(n => n.classList.toggle('selected', n.dataset.id === id));
  syncSelectedPanel();
}

function cycleValve(item) {
  pushUndo();
  if (item.type === 'valve2') {
    item.valveState = item.valveState === 'open' ? 'closed' : 'open';
  } else if (item.type === 'valve3') {
    const order = ['a','b','both'];
    const next = order[(order.indexOf(item.valveState) + 1) % order.length] || 'a';
    item.valveState = next;
  }
  refreshItem(item); solveFlow(); persist();
}

// ---------- Connect mode ----------
function startConnectMode() {
  if (!state.items.length) { toast('Add parts first'); return; }
  state.connectMode = true;
  state.connectSourceId = null;
  connectBanner.classList.add('show');
  closeSheet();
  toast('Connect mode: tap source, then destination');
}
function cancelConnectMode() {
  state.connectMode = false;
  state.connectSourceId = null;
  connectBanner.classList.remove('show');
  world.querySelectorAll('.node.connect-source').forEach(n => n.classList.remove('connect-source'));
}
function handleConnectTap(id) {
  if (!state.connectSourceId) {
    state.connectSourceId = id;
    const el = nodeEl(id); if (el) el.classList.add('connect-source');
    toast('Now tap destination');
    return;
  }
  if (state.connectSourceId === id) {
    // tapping same node cancels
    cancelConnectMode();
    return;
  }
  // Create edge
  const from = getItem(state.connectSourceId), to = getItem(id);
  if (from && to) {
    pushUndo();
    state.edges.push({
      id: uid(),
      from: from.id,
      to: to.id,
      type: state.pendingPipe.type,
      size: state.pendingPipe.size,
      label: `${from.label} → ${to.label}`,
      active: false,
      blocked: false,
    });
    toast(`${PIPE_TYPES[state.pendingPipe.type].label} ${state.pendingPipe.size}: ${from.label} → ${to.label}`);
    solveFlow(); persist();
  }
  cancelConnectMode();
}

// ---------- Drawing ----------
function drawEdges() {
  const defs = `<defs>
    ${Object.entries(PIPE_TYPES).map(([k, v]) => `
      <marker id="arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0L10 5L0 10Z" fill="${v.color}"/>
      </marker>`).join('')}
    <style>
      .pipe { fill:none; stroke-linecap:round; }
      .pipe.active { stroke-dasharray:14 10; animation: flow 1.2s linear infinite; }
      .pipe.blocked { opacity:.3; stroke-dasharray:4 8; }
      @keyframes flow { to { stroke-dashoffset: -24; } }
    </style>
  </defs>`;
  let html = defs;
  for (const e of state.edges) {
    const a = getItem(e.from), b = getItem(e.to);
    if (!a || !b) continue;
    const p1 = { x: a.x + a.w/2, y: a.y + a.h/2 };
    const p2 = { x: b.x + b.w/2, y: b.y + b.h/2 };
    const mx = (p1.x + p2.x) / 2;
    const d = `M ${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}`;
    const t = PIPE_TYPES[e.type] || PIPE_TYPES.return;
    const classes = ['pipe'];
    if (e.active) classes.push('active');
    if (e.blocked) classes.push('blocked');
    const sw = pipeStrokeWidth(e.size);
    html += `<path d="${d}" class="${classes.join(' ')}" stroke="${t.color}" stroke-width="${sw}" stroke-dasharray="${t.dash}" marker-end="url(#arr-${e.type})"></path>`;
    // label
    const lx = (p1.x + p2.x) / 2, ly = (p1.y + p2.y) / 2 - 8;
    html += `<text class="flow-text" x="${lx}" y="${ly}" text-anchor="middle">${escapeHtml(e.size || '')} ${escapeHtml(t.label)}</text>`;
  }
  edgeSvg.innerHTML = html;
}

function drawDims() {
  let html = '';
  for (const d of state.dims) {
    const a = getItem(d.a), b = getItem(d.b);
    if (!a || !b) continue;
    const ca = { x: a.x + a.w/2, y: a.y + a.h/2 };
    const cb = { x: b.x + b.w/2, y: b.y + b.h/2 };
    const y = Math.min(ca.y, cb.y) - 36;
    const x1 = Math.min(ca.x, cb.x), x2 = Math.max(ca.x, cb.x);
    const distPx = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const ftDisp = fmtFI(distPx);
    html += `
      <line x1="${ca.x}" y1="${ca.y}" x2="${ca.x}" y2="${y}" stroke="var(--muted)" stroke-dasharray="3 4"/>
      <line x1="${cb.x}" y1="${cb.y}" x2="${cb.x}" y2="${y}" stroke="var(--muted)" stroke-dasharray="3 4"/>
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--text)" stroke-width="1.5"/>
      <polygon points="${x1},${y} ${x1+8},${y-4} ${x1+8},${y+4}" fill="var(--text)"/>
      <polygon points="${x2},${y} ${x2-8},${y-4} ${x2-8},${y+4}" fill="var(--text)"/>
      <text class="dim-text" x="${(x1+x2)/2}" y="${y-8}" text-anchor="middle">${d.label}: ${ftDisp}</text>`;
  }
  dimSvg.innerHTML = html;
}

function redrawAll() {
  world.querySelectorAll('.node').forEach(n => n.remove());
  state.items.forEach(renderItem);
  applyTransform();
  drawEdges(); drawDims();
  solveFlow();
  renderSheet();
}

// ---------- Solver ----------
function adjacency() { const m = {}; state.items.forEach(i => m[i.id] = []); state.edges.forEach(e => m[e.from].push(e)); return m; }
function valveAllows(node, edges, index) {
  if (node.type === 'valve2') return node.valveState !== 'closed';
  if (node.type === 'valve3') {
    if (node.valveState === 'both' || !node.valveState) return true;
    if (node.valveState === 'a') return index === 0;
    if (node.valveState === 'b') return index === 1;
    return false;
  }
  if (node.type === 'checkvalve') return true;
  if (node.type === 'actuated') return node.valveState !== 'closed';
  return true;
}
function solveFlow() {
  state.edges.forEach(e => { e.active = false; e.blocked = false; });
  const issues = [];
  const adj = adjacency();
  const pumps = state.items.filter(i => i.type === 'pump');
  const results = [];

  function traverse(edge, root, seen) {
    edge.active = true;
    const node = getItem(edge.to);
    if (!node) return;
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.type === 'valve2' && node.valveState === 'closed') {
      edge.blocked = true; issues.push(`${node.label} is closed.`); return;
    }
    const outs = (adj[node.id] || []).filter(e => e.type !== 'conduit');
    if (node.type === 'valve3') {
      outs.forEach((o, i) => valveAllows(node, outs, i) ? traverse(o, root, new Set(seen)) : (o.blocked = true));
      return;
    }
    if (node.type === 'tee') {
      if (!outs.length) issues.push(`${node.label} tee has no downstream branch.`);
      outs.forEach(o => traverse(o, root, new Set(seen))); return;
    }
    if (['pool','spa'].includes(node.type)) {
      results.push({ root, end: node.label, type: node.type, id: node.id }); return;
    }
    if (!outs.length) {
      issues.push(`${node.label} ends with no downstream body.`); return;
    }
    outs.forEach(o => traverse(o, root, new Set(seen)));
  }

  for (const pump of pumps) {
    const incoming = state.edges.filter(e => e.to === pump.id && e.type !== 'conduit');
    const outgoing = state.edges.filter(e => e.from === pump.id && e.type !== 'conduit');
    if (!incoming.length) issues.push(`Pump ${pump.label} has no suction source.`);
    if (!outgoing.length) issues.push(`Pump ${pump.label} has no return destination.`);
    incoming.forEach(e => e.active = true);
    outgoing.forEach(o => traverse(o, pump.label, new Set([pump.id])));
  }

  // Spillover check
  for (const spa of state.items.filter(i => i.type === 'spa')) {
    const inToSpa = state.edges.filter(e => e.to === spa.id && ['return','spillover','feature'].includes(e.type) && e.active && !e.blocked);
    if (inToSpa.length) {
      const out = state.edges.filter(e => e.from === spa.id && (e.type === 'spillover' || e.type === 'return') && e.active && !e.blocked);
      const reachesPool = out.some(e => getItem(e.to)?.type === 'pool');
      const relPool = spa.relation === 'pool';
      if (!relPool && !reachesPool) {
        issues.push(`Spa ${spa.label} has no spillover/return to pool.`);
      }
    }
  }

  state.lastSolve = { issues, results };
  const ok = !issues.length;
  statusPill.className = 'status-pill ' + (ok ? 'ok' : 'err');
  statusPill.querySelector('.label').textContent = ok ? (results.length ? `Flow → ${[...new Set(results.map(r => r.end))].join(', ')}` : 'Ready') : `${issues.length} issue${issues.length===1?'':'s'}`;
  drawEdges();
}

// ---------- Bottom sheet ----------
let activeTab = 'parts';
function openSheet() { sheet.classList.add('open'); sheet.classList.remove('mid'); }
function midSheet()  { sheet.classList.add('mid'); sheet.classList.remove('open'); }
function closeSheet(){ sheet.classList.remove('open'); sheet.classList.remove('mid'); }
function openSheetTab(name) {
  activeTab = name;
  sheetTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  renderSheet();
}
sheetTabs.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    openSheetTab(btn.dataset.tab);
    if (!sheet.classList.contains('open')) openSheet();
  });
});

// drag-handle to toggle sheet states
let sheetDragStart = null;
const sheetHandle = $('sheetHandle');
sheetHandle.addEventListener('pointerdown', (e) => {
  sheetDragStart = { y: e.clientY, ts: Date.now() };
  sheetHandle.setPointerCapture(e.pointerId);
});
sheetHandle.addEventListener('pointermove', (e) => {
  if (!sheetDragStart) return;
  const dy = e.clientY - sheetDragStart.y;
  if (Math.abs(dy) > 10) {
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(calc(${dy}px + (var(--current-y, 0px))))`;
  }
});
sheetHandle.addEventListener('pointerup', (e) => {
  if (!sheetDragStart) return;
  const dy = e.clientY - sheetDragStart.y;
  sheet.style.transition = '';
  sheet.style.transform = '';
  if (dy < -40) openSheet();
  else if (dy > 60) closeSheet();
  else if (sheet.classList.contains('open')) midSheet();
  else openSheet();
  sheetDragStart = null;
});

function renderSheet() {
  if (activeTab === 'parts')      sheetBody.innerHTML = renderParts();
  else if (activeTab === 'selected') sheetBody.innerHTML = renderSelected();
  else if (activeTab === 'pipes')    sheetBody.innerHTML = renderPipes();
  else if (activeTab === 'validate') sheetBody.innerHTML = renderValidate();
  else if (activeTab === 'takeoff')  sheetBody.innerHTML = renderTakeoff();
  else if (activeTab === 'export')   sheetBody.innerHTML = renderExport();
  bindSheetActions();
}

function renderParts() {
  return PALETTE_GROUPS.map(([title, items]) => `
    <div class="group">
      <div class="group-title">${title}</div>
      <div class="palette">
        ${items.map(([type, label]) => `
          <button data-add="${type}">
            <span class="glyph">${iconMarkup(type)}</span>
            <span class="lbl">${label}</span>
          </button>`).join('')}
      </div>
    </div>
  `).join('') + `
    <div class="row" style="margin-top:14px;">
      <button class="btn" data-action="demo">Load demo</button>
      <button class="btn danger" data-action="clearAll">Clear all</button>
    </div>
  `;
}

function renderEquipmentModelPicker(item) {
  const models = EQUIPMENT_MODELS[item.type];
  if (!models || !models.length) return '';
  const cur = item.modelId || '';
  const m = cur ? findEquipmentModel(cur) : null;
  const detail = m
    ? `<div style="color:var(--muted); font-size:12px; margin-top:4px;">${escapeHtml(m.brand)} · ${escapeHtml(m.name)} — ${m.wIn}″ × ${m.dIn}″${m.hIn?` × ${m.hIn}″ H`:''}${m.port?` · ${escapeHtml(m.port)}`:''}${m.btu?` · ${escapeHtml(m.btu)} BTU`:''}${m.area?` · ${escapeHtml(m.area)}`:''}</div>`
    : `<div style="color:var(--muted); font-size:12px; margin-top:4px;">Pick a model to scale this part on the pad.</div>`;
  return `
    <div class="group" style="margin-top:10px;">
      <div class="group-title">Model (to scale)</div>
      <div class="field">
        <select id="f-model">
          <option value="">— generic —</option>
          ${models.map(mm => `<option value="${mm.id}" ${mm.id===cur?'selected':''}>${escapeHtml(mm.brand)} — ${escapeHtml(mm.name)}</option>`).join('')}
        </select>
      </div>
      ${detail}
      <button class="btn" data-action="applyModel" style="margin-top:8px;">Snap to actual size</button>
    </div>`;
}

function renderSizeFields(item) {
  if (RESIZABLE.has(item.type)) {
    const w = pxToFI(item.w), h = pxToFI(item.h);
    const presets = item.type === 'pool'
      ? [['16′×32′',16,32], ['18′×36′',18,36], ['20′×40′',20,40], ['16′ round',16,16]]
      : item.type === 'spa'
        ? [['7′×7′',7,7], ['8′×8′',8,8], ['6′×6′',6,6], ['9′×7′',9,7]]
        : [['10′×6′',10,6], ['12′×8′',12,8], ['14′×6′',14,6]];
    return `
      <div class="group" style="margin-top:10px;">
        <div class="group-title">Size (feet · inches)</div>
        <div class="row tight">
          <div class="field"><label>Width</label>
            <div class="fi-input"><input id="f-w-ft" type="number" min="0" max="999" value="${w.ft}"/><span>′</span><input id="f-w-in" type="number" min="0" max="11" value="${w.in}"/><span>″</span></div>
          </div>
          <div class="field"><label>Height</label>
            <div class="fi-input"><input id="f-h-ft" type="number" min="0" max="999" value="${h.ft}"/><span>′</span><input id="f-h-in" type="number" min="0" max="11" value="${h.in}"/><span>″</span></div>
          </div>
        </div>
        <div class="chip-row" style="margin-top:8px;">
          ${presets.map(([lbl, fw, fh]) => `<button class="chip" data-action="preset-size" data-fw="${fw}" data-fh="${fh}">${lbl}</button>`).join('')}
        </div>
      </div>`;
  }
  return `
    <div class="row tight" style="margin-top:8px;">
      <div class="field"><label>Width (px)</label><input id="f-w-px" type="number" value="${item.w}" min="40"/></div>
      <div class="field"><label>Height (px)</label><input id="f-h-px" type="number" value="${item.h}" min="30"/></div>
    </div>`;
}

function renderSelected() {
  const item = getItem(state.selectedId);
  if (!item) return `<div class="panel"><p style="color:var(--muted);">Tap a part on the canvas to edit it.</p></div>`;
  const isValve = item.type === 'valve2' || item.type === 'valve3' || item.type === 'actuated';
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:10px;">
        <div style="font-weight:700; font-size:16px;">${escapeHtml(item.label)}</div>
        <div style="text-align:right; color:var(--muted); font-size:12px;">${item.type}</div>
      </div>
      <div class="field"><label>Label</label><input id="f-label" value="${escapeHtml(item.label)}"/></div>
      <div class="row tight" style="margin-top:8px;">
        <div class="field"><label>Pipe size</label>
          <select id="f-size">
            <option value="">—</option>
            ${PIPE_SIZES.map(s => `<option ${item.size===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Body relation</label>
          <select id="f-relation">
            <option value="">None</option>
            <option ${item.relation==='pool'?'selected':''} value="pool">Flows to pool</option>
            <option ${item.relation==='spa'?'selected':''} value="spa">Flows to spa</option>
          </select>
        </div>
      </div>
      ${isValve ? `
      <div class="field" style="margin-top:8px;"><label>Valve mode</label>
        <select id="f-valve">
          <option value="">N/A</option>
          <option ${item.valveState==='open'?'selected':''} value="open">Open</option>
          <option ${item.valveState==='closed'?'selected':''} value="closed">Closed</option>
          <option ${item.valveState==='a'?'selected':''} value="a">3-way → A</option>
          <option ${item.valveState==='b'?'selected':''} value="b">3-way → B</option>
          <option ${item.valveState==='both'?'selected':''} value="both">3-way shared</option>
        </select>
      </div>` : ''}
      ${renderEquipmentModelPicker(item)}
      ${renderSizeFields(item)}
      <div class="field" style="margin-top:8px;"><label>Notes</label><input id="f-notes" value="${escapeHtml(item.notes||'')}" placeholder="e.g. branch A, custom feature"/></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn primary" data-action="applySelected">Apply</button>
        <button class="btn danger"  data-action="deleteSelected">Delete</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <button class="btn" data-action="duplicateSelected">Duplicate</button>
        <button class="btn" data-action="measureFrom">Measure from this…</button>
      </div>
    </div>`;
}

function renderPipes() {
  const p = state.pendingPipe;
  return `
    <div class="panel">
      <h3>Pipe to draw</h3>
      <div class="field"><label>Type</label>
        <select id="pipe-type">
          ${Object.entries(PIPE_TYPES).map(([k, v]) => `<option ${p.type===k?'selected':''} value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin-top:8px;"><label>Size</label>
        <select id="pipe-size">
          ${PIPE_SIZES.map(s => `<option ${p.size===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="btn primary full" style="margin-top:12px;" data-action="connectMode">
        Start tap-to-connect
      </button>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Tap two parts in order. Long-press a valve to flip it.</p>
    </div>

    <div class="panel">
      <h3>Existing pipes (${state.edges.length})</h3>
      ${state.edges.length === 0 ? `<p style="color:var(--muted);">No connections yet.</p>` :
        state.edges.map(e => {
          const a = getItem(e.from), b = getItem(e.to); if (!a||!b) return '';
          const t = PIPE_TYPES[e.type] || {};
          return `<div class="row-item" style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:10px; margin-bottom:6px;">
            <div>
              <div style="font-weight:600;">${escapeHtml(a.label)} → ${escapeHtml(b.label)}</div>
              <div style="color:var(--muted); font-size:12px;">${t.label||e.type} · ${e.size||'—'}${e.active?' · active':''}${e.blocked?' · blocked':''}</div>
            </div>
            <button class="btn" data-action="deletePipe" data-pid="${e.id}">Delete</button>
          </div>`;
        }).join('')
      }
    </div>

    <div class="panel">
      <h3>Legend</h3>
      <div class="legend">
        ${Object.entries(PIPE_TYPES).map(([k,v])=>`<div class="item"><div class="swatch" style="background:${v.color}"></div>${v.label}</div>`).join('')}
      </div>
    </div>`;
}

function renderValidate() {
  const sol = state.lastSolve;
  const issues = sol?.issues || [];
  const ok = !issues.length;
  return `
    <div class="panel">
      <h3>Status</h3>
      <div class="row-item ${ok ? '' : 'err'}" style="padding:12px; border-radius:10px; background:${ok ? 'color-mix(in srgb, var(--success) 14%, var(--surface))' : 'var(--error-bg)'};
           color:${ok ? 'var(--success)' : 'var(--error)'}; border:1px solid ${ok ? 'var(--success)' : 'var(--error)'}; font-weight:600;">
        ${ok ? '✓ Valid flow' : `⚠ ${issues.length} issue${issues.length===1?'':'s'} found`}
      </div>
      <div class="issues-list" style="margin-top:10px;">
        ${issues.length === 0
          ? `<div class="row-item">No hydraulic errors detected.</div>`
          : issues.map(t => `<div class="row-item err">${escapeHtml(t)}</div>`).join('')}
      </div>
      <button class="btn primary full" style="margin-top:12px;" data-action="solveFlow">Re-solve flow</button>
    </div>`;
}

// ---------- BOM computation ----------
// Sample a cubic Bezier (matches drawEdges) and sum segment lengths to get pixels
function edgePathLengthPx(edge) {
  const a = getItem(edge.from), b = getItem(edge.to);
  if (!a || !b) return 0;
  const p1 = { x: a.x + a.w/2, y: a.y + a.h/2 };
  const p2 = { x: b.x + b.w/2, y: b.y + b.h/2 };
  const mx = (p1.x + p2.x) / 2;
  const c1 = { x: mx, y: p1.y };
  const c2 = { x: mx, y: p2.y };
  const N = 24;
  let len = 0, prev = p1;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u*u*u*p1.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*p2.x;
    const y = u*u*u*p1.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*p2.y;
    len += Math.hypot(x - prev.x, y - prev.y);
    prev = { x, y };
  }
  return len;
}

function edgeAngleDeg(edge) {
  const a = getItem(edge.from), b = getItem(edge.to);
  if (!a || !b) return 0;
  const dx = (b.x + b.w/2) - (a.x + a.w/2);
  const dy = (b.y + b.h/2) - (a.y + a.h/2);
  let ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  if (ang > 90) ang = 180 - ang;
  return ang;
}

function computeBOM() {
  const wasteFactor = 1.10;
  const pipeByKey = {};
  const fitBySize = {};
  const ensureFit = (size) => {
    if (!fitBySize[size]) fitBySize[size] = { elbow90:0, elbow45:0, coupling:0, tee:0, union:0 };
    return fitBySize[size];
  };

  for (const e of state.edges) {
    const ft = pxToFeet(edgePathLengthPx(e));
    const typeLabel = (PIPE_TYPES[e.type]?.label) || e.type;
    const size = e.size || '—';
    const key = typeLabel + '|' + size;
    if (!pipeByKey[key]) pipeByKey[key] = { typeLabel, size, ft:0 };
    pipeByKey[key].ft += ft;

    const fit = ensureFit(size);
    const ang = edgeAngleDeg(e);
    if (ang >= BOM_RULES.use45DegMin && ang <= BOM_RULES.use45DegMax) {
      fit.elbow45 += 2;
      fit.elbow90 += 1;
    } else {
      fit.elbow90 += BOM_RULES.minElbowsPerRun;
    }
    fit.coupling += Math.max(0, Math.floor(ft / BOM_RULES.couplingEveryFt));
    if (ft > BOM_RULES.longRunFt) fit.coupling += 1;
  }

  const adj = {};
  state.items.forEach(i => adj[i.id] = { in:[], out:[] });
  state.edges.forEach(e => { if (adj[e.from]) adj[e.from].out.push(e); if (adj[e.to]) adj[e.to].in.push(e); });
  for (const item of state.items) {
    if (item.type === 'tee') {
      const sizes = [...(adj[item.id]?.in||[]), ...(adj[item.id]?.out||[])].map(e => e.size).filter(Boolean);
      const s = sizes[0] || '—';
      ensureFit(s).tee += 1;
    }
    if (EQUIPMENT_TYPES.has(item.type)) {
      const connSizes = [...(adj[item.id]?.in||[]), ...(adj[item.id]?.out||[])].map(e => e.size).filter(Boolean);
      const s = connSizes[0] || '2"';
      ensureFit(s).union += BOM_RULES.unionsPerEquipment;
    }
  }

  const equipment = state.items
    .filter(i => EQUIPMENT_TYPES.has(i.type))
    .map(i => {
      const m = i.modelId ? findEquipmentModel(i.modelId) : null;
      return {
        id: i.id,
        type: i.type,
        label: i.label,
        model: m ? (m.brand + ' ' + m.name) : '(generic)',
        footprint: m ? (m.wIn + '″ × ' + m.dIn + '″' + (m.hIn ? (' × ' + m.hIn + '″ H') : '')) : '',
        port: m?.port || '',
      };
    });

  const valves = state.items
    .filter(i => ['valve2','valve3','checkvalve','actuated'].includes(i.type))
    .map(i => {
      const m = i.modelId ? findEquipmentModel(i.modelId) : null;
      const typeLabel = {valve2:'2-way',valve3:'3-way',checkvalve:'Check',actuated:'Actuated'}[i.type];
      return {
        type: i.type,
        typeLabel,
        label: i.label,
        size: i.size || (m?.port || '—'),
        model: m ? (m.brand + ' ' + m.name) : '(generic)',
      };
    });

  const fixtureTypes = ['return','skimmer','drain','jet','bubbler','deckjet','sheer','slide','autofill','light','feature','custom'];
  const fixtures = {};
  state.items.forEach(i => {
    if (fixtureTypes.includes(i.type)) {
      const k = TOOLS[i.type]?.label || i.type;
      fixtures[k] = (fixtures[k] || 0) + 1;
    }
  });

  const pipeList = Object.values(pipeByKey).map(p => ({
    typeLabel: p.typeLabel,
    size: p.size,
    rawFt: p.ft,
    withWasteFt: p.ft * wasteFactor,
    sticks20: Math.ceil((p.ft * wasteFactor) / 20),
  }));

  return { pipeList, fitBySize, equipment, valves, fixtures };
}

function renderTakeoff() {
  const bom = computeBOM();
  const { pipeList, fitBySize, equipment, valves, fixtures } = bom;

  const pipeRows = pipeList.length
    ? pipeList.map(p => `<div class="row-item"><span>${escapeHtml(p.typeLabel)} · ${escapeHtml(p.size)}</span><span class="qty">${p.withWasteFt.toFixed(1)} ft · ${p.sticks20}× 20′ sticks</span></div>`).join('')
    : `<div class="row-item">No pipes yet. Draw connections in the Pipes tab.</div>`;

  const fitRows = Object.keys(fitBySize).length
    ? Object.entries(fitBySize).sort().map(([size, f]) => {
        const parts = [];
        if (f.elbow90) parts.push(f.elbow90 + '× 90°');
        if (f.elbow45) parts.push(f.elbow45 + '× 45°');
        if (f.tee)     parts.push(f.tee + '× tee');
        if (f.coupling)parts.push(f.coupling + '× coupling');
        if (f.union)   parts.push(f.union + '× union');
        return `<div class="row-item"><span>Size ${escapeHtml(size)}</span><span class="qty" style="text-align:right;">${parts.join(' · ') || '—'}</span></div>`;
      }).join('')
    : `<div class="row-item">No fittings estimated yet.</div>`;

  const valveRows = valves.length
    ? valves.map(v => `<div class="row-item"><span>${escapeHtml(v.typeLabel)} · ${escapeHtml(v.size)}</span><span class="qty">${escapeHtml(v.model)}</span></div>`).join('')
    : `<div class="row-item">No valves placed.</div>`;

  const eqRows = equipment.length
    ? equipment.map(e => `<div class="row-item"><span>${escapeHtml(e.label)}</span><span class="qty" style="text-align:right;">${escapeHtml(e.model)}${e.footprint?(' · '+escapeHtml(e.footprint)):''}</span></div>`).join('')
    : `<div class="row-item">No equipment placed.</div>`;

  const fixRows = Object.keys(fixtures).length
    ? Object.entries(fixtures).map(([k,v]) => `<div class="row-item"><span>${escapeHtml(k)}</span><span class="qty">${v}</span></div>`).join('')
    : `<div class="row-item">No fixtures placed.</div>`;

  return `
    <div class="panel">
      <h3>Pipe — linear feet (with 10% waste)</h3>
      <div class="takeoff-list">${pipeRows}</div>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Lengths measured from canvas at ${pxPerFoot()} px/ft. Adjust scale in Export tab.</p>
    </div>
    <div class="panel">
      <h3>Fittings (estimated)</h3>
      <div class="takeoff-list">${fitRows}</div>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Heuristic: 2× elbows per run, +1 coupling every 20′, unions on each side of equipment, tees from explicit tee nodes.</p>
    </div>
    <div class="panel">
      <h3>Valves</h3>
      <div class="takeoff-list">${valveRows}</div>
    </div>
    <div class="panel">
      <h3>Equipment</h3>
      <div class="takeoff-list">${eqRows}</div>
    </div>
    <div class="panel">
      <h3>Fixtures &amp; features</h3>
      <div class="takeoff-list">${fixRows}</div>
    </div>`;
}

function renderExport() {
  return `
    <div class="panel">
      <h3>Share with plumbers</h3>
      <div class="row" style="margin-top:8px;">
        <button class="btn primary" data-action="exportPDF">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Export PDF
        </button>
        <button class="btn" data-action="exportJSON">Export JSON</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <button class="btn" data-action="exportPNG">Save plan image</button>
        <button class="btn" data-action="sharePlan">Share…</button>
      </div>
    </div>
    <div class="panel">
      <h3>Backup & restore</h3>
      <div class="row">
        <button class="btn" data-action="importJSON">Import JSON</button>
        <button class="btn" data-action="undo">Undo</button>
      </div>
    </div>
    <div class="panel">
      <h3>GitHub</h3>
      <p style="color:var(--muted); font-size:12px;">Save the current planner code back to your GitHub Pages repo (requires personal access token with <code>repo</code> scope).</p>
      <button class="btn primary full" data-action="pushGithub">Update GitHub</button>
    </div>
    <div class="panel">
      <h3>Drawing scale</h3>
      <p style="color:var(--muted); font-size:12px; margin-top:0;">How many canvas pixels equal 1 foot. Higher = bigger drawings.</p>
      <div class="row tight">
        <div class="field"><label>Pixels per foot</label>
          <input id="scale-px" type="number" min="4" max="200" step="1" value="${pxPerFoot()}"/>
        </div>
        <button class="btn primary" data-action="applyScale" style="max-width:120px;">Apply</button>
      </div>
      <div class="chip-row" style="margin-top:8px;">
        <button class="chip" data-action="applyScale" data-scale="12">12 px/ft</button>
        <button class="chip" data-action="applyScale" data-scale="24">24 px/ft</button>
        <button class="chip" data-action="applyScale" data-scale="36">36 px/ft</button>
        <button class="chip" data-action="applyScale" data-scale="48">48 px/ft</button>
      </div>
    </div>
    <div class="panel">
      <h3>Appearance</h3>
      <div class="row">
        <button class="btn" data-action="theme-light">Light</button>
        <button class="btn" data-action="theme-dark">Dark</button>
        <button class="btn" data-action="theme-auto">Auto</button>
      </div>
    </div>
  `;
}

function bindSheetActions() {
  // Palette adders
  sheetBody.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.add;
      addItem(type);
      if (type === 'custom' || type === 'customeq') {
        // open Selected so user can rename
        openSheetTab('selected'); openSheet();
      }
    });
  });

  // Actions
  sheetBody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => doAction(btn.dataset.action, btn));
  });

  // Selected fields — live save on Apply
  if (activeTab === 'selected' && state.selectedId) {
    // (no live binding; user taps Apply)
  }

  // Pipe selectors auto-save
  const pipeType = $('pipe-type'), pipeSize = $('pipe-size');
  if (pipeType) pipeType.onchange = () => { state.pendingPipe.type = pipeType.value; persist(); };
  if (pipeSize) pipeSize.onchange = () => { state.pendingPipe.size = pipeSize.value; persist(); };
}

function doAction(name, btn) {
  switch(name) {
    case 'applySelected': {
      const item = getItem(state.selectedId); if (!item) return;
      pushUndo();
      item.label = $('f-label')?.value || item.label;
      item.size  = $('f-size')?.value || '';
      item.relation = $('f-relation')?.value || '';
      if ($('f-valve')) item.valveState = $('f-valve').value || '';
      if ($('f-w-ft')) {
        const wPx = fiToPx($('f-w-ft').value, $('f-w-in').value);
        const hPx = fiToPx($('f-h-ft').value, $('f-h-in').value);
        if (wPx >= 20) item.w = wPx;
        if (hPx >= 16) item.h = hPx;
      } else if ($('f-w-px')) {
        item.w = parseInt($('f-w-px').value || item.w, 10);
        item.h = parseInt($('f-h-px').value || item.h, 10);
      }
      item.notes = $('f-notes')?.value || '';
      refreshItem(item); solveFlow(); persist();
      toast('Saved'); break;
    }
    case 'deleteSelected': if (state.selectedId) deleteItem(state.selectedId); renderSheet(); break;
    case 'applyModel': {
      const item = getItem(state.selectedId); if (!item) return;
      const sel = $('f-model');
      if (!sel) return;
      const id = sel.value;
      pushUndo();
      if (!id) {
        item.modelId = '';
        item.modelLabel = '';
      } else {
        const m = findEquipmentModel(id);
        if (m) {
          item.modelId = id;
          item.modelLabel = `${m.brand} ${m.name}`;
          // Snap footprint to scale (W × D in plan view)
          const wPx = Math.max(20, Math.round(feetToPx(m.wIn / 12)));
          const dPx = Math.max(16, Math.round(feetToPx(m.dIn / 12)));
          item.w = wPx;
          item.h = dPx;
          // Auto-update label only if user hasn't customized it (still default label for type)
          const defaultLabel = TOOLS[item.type]?.label;
          if (!item.label || item.label === defaultLabel) {
            item.label = `${m.brand} ${m.name}`;
          }
        }
      }
      refreshItem(item); persist();
      renderSheet();
      toast(item.modelId ? 'Snapped to actual size' : 'Cleared model');
      break;
    }
    case 'preset-size': {
      const item = getItem(state.selectedId); if (!item) return;
      const fw = parseFloat(btn.dataset.fw), fh = parseFloat(btn.dataset.fh);
      pushUndo();
      item.w = Math.round(feetToPx(fw));
      item.h = Math.round(feetToPx(fh));
      refreshItem(item); persist();
      renderSheet();
      toast(`${fw}′ × ${fh}′`); break;
    }
    case 'applyScale': {
      let v;
      if (btn?.dataset?.scale) v = parseFloat(btn.dataset.scale);
      else v = parseFloat($('scale-px')?.value);
      if (v > 0 && v <= 200) {
        pushUndo();
        state.scale.pxPerFoot = v;
        persist();
        drawEdges(); drawDims();
        state.items.forEach(refreshItem);
        renderSheet();
        toast(`Scale: ${v} px / ft`);
      } else { toast('Pick 1–200 px/ft'); } break;
    }
    case 'duplicateSelected': {
      const i = getItem(state.selectedId); if (!i) return;
      addItem(i.type, { ...i, x: i.x + 24, y: i.y + 24, id: undefined });
      break;
    }
    case 'measureFrom': {
      if (!state.selectedId) return;
      const a = state.selectedId;
      toast('Tap another part to measure to');
      const handler = (e) => {
        const n = e.target.closest('.node');
        if (!n) return;
        const b = n.dataset.id;
        if (b === a) return;
        state.dims.push({ a, b, label: 'Spacing' });
        viewport.removeEventListener('pointerdown', handler, true);
        drawDims(); persist();
      };
      viewport.addEventListener('pointerdown', handler, true);
      break;
    }
    case 'deletePipe': {
      pushUndo();
      const pid = btn.dataset.pid;
      state.edges = state.edges.filter(e => e.id !== pid);
      solveFlow(); persist(); renderSheet(); break;
    }
    case 'connectMode': startConnectMode(); break;
    case 'solveFlow': solveFlow(); renderSheet(); break;
    case 'exportPDF': exportPDF(); break;
    case 'exportJSON': exportJSON(); break;
    case 'exportPNG': exportPNG(); break;
    case 'sharePlan': sharePlan(); break;
    case 'importJSON': importJSON(); break;
    case 'undo': undo(); break;
    case 'pushGithub': openGithubModal(); break;
    case 'clearAll': if (confirm('Clear everything?')) { pushUndo(); state.items=[]; state.edges=[]; state.dims=[]; state.selectedId=null; redrawAll(); persist(); } break;
    case 'demo': loadDemo(); break;
    case 'theme-light': document.documentElement.setAttribute('data-theme','light'); break;
    case 'theme-dark':  document.documentElement.setAttribute('data-theme','dark');  break;
    case 'theme-auto':  document.documentElement.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); break;
  }
}

function syncSelectedPanel() {
  if (activeTab === 'selected') renderSheet();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- Export ----------
function exportJSON() {
  const data = { version: 2, items: state.items, edges: state.edges, dims: state.dims };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `poolflow-plan-${Date.now()}.json`;
  a.click();
  toast('JSON exported');
}
function importJSON() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json';
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        pushUndo();
        state.items = s.items || []; state.edges = s.edges || []; state.dims = s.dims || [];
        state.nextId = state.items.length + 100;
        state.selectedId = null;
        redrawAll(); fitToContent(); persist();
        toast('Plan loaded');
      } catch { toast('Invalid file'); }
    };
    r.readAsText(file);
  };
  input.click();
}

function exportPDF() {
  if (!window.jspdf) { toast('PDF library still loading…'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.text('PoolFlow Planner — Equipment & Plumbing Plan', 32, 36);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 32, 52);

  // Render plan diagram as a vector-ish bitmap by rasterizing SVG/world into a temp canvas
  const png = renderWorldToImage();
  if (png) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - 64, maxH = pageH - 130;
    const ratio = Math.min(maxW / png.w, maxH / png.h);
    doc.addImage(png.url, 'PNG', 32, 68, png.w * ratio, png.h * ratio);
  }

  // Parts list
  doc.addPage();
  doc.setFontSize(16); doc.text('Parts', 32, 36);
  doc.setFontSize(10);
  let y = 60;
  state.items.forEach(i => {
    const line = `• ${i.label} (${i.type})  size:${i.size||'-'}  valve:${i.valveState||'-'}  rel:${i.relation||'-'}  notes:${i.notes||'-'}`;
    doc.text(line, 32, y); y += 14;
    if (y > 540) { doc.addPage(); y = 36; }
  });

  // Connections
  doc.addPage(); doc.setFontSize(16); doc.text('Connections', 32, 36);
  doc.setFontSize(10); y = 60;
  state.edges.forEach(e => {
    const a = getItem(e.from), b = getItem(e.to);
    const line = `• ${a?.label} → ${b?.label}   ${PIPE_TYPES[e.type]?.label||e.type}  ${e.size||'-'}  ${e.active?'active':'inactive'}${e.blocked?' BLOCKED':''}`;
    doc.text(line, 32, y); y += 14;
    if (y > 540) { doc.addPage(); y = 36; }
  });

  // Validation
  doc.addPage(); doc.setFontSize(16); doc.text('Validation', 32, 36);
  doc.setFontSize(10); y = 60;
  const issues = state.lastSolve?.issues?.length ? state.lastSolve.issues : ['No hydraulic errors detected.'];
  issues.forEach(t => { doc.text('• ' + t, 32, y); y += 14; if (y>540){doc.addPage();y=36;} });

  // BOM / Takeoff
  const bom = computeBOM();

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Pipe', 32, 36);
  doc.setFontSize(9); doc.setTextColor(120); doc.text('Linear feet measured from canvas Beziers, +10% waste, rounded to 20′ sticks.', 32, 50);
  doc.setTextColor(0); doc.setFontSize(10); y = 70;
  if (!bom.pipeList.length) {
    doc.text('• No pipes drawn.', 32, y); y += 14;
  } else {
    bom.pipeList.forEach(p => {
      doc.text(`• ${p.typeLabel}  ${p.size}: ${p.withWasteFt.toFixed(1)} ft  (${p.sticks20} × 20′ sticks)`, 32, y);
      y += 14; if (y>540){doc.addPage();y=36;}
    });
  }

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Fittings', 32, 36);
  doc.setFontSize(10); y = 60;
  const sizes = Object.keys(bom.fitBySize).sort();
  if (!sizes.length) {
    doc.text('• No fittings estimated.', 32, y);
  } else {
    sizes.forEach(s => {
      const f = bom.fitBySize[s];
      doc.setFont('helvetica','bold'); doc.text(`Size ${s}`, 32, y); doc.setFont('helvetica','normal'); y += 14;
      const lines = [];
      if (f.elbow90) lines.push(`• ${f.elbow90} × 90° elbow`);
      if (f.elbow45) lines.push(`• ${f.elbow45} × 45° elbow`);
      if (f.tee)     lines.push(`• ${f.tee} × tee`);
      if (f.coupling)lines.push(`• ${f.coupling} × coupling`);
      if (f.union)   lines.push(`• ${f.union} × union`);
      lines.forEach(l => { doc.text('    ' + l, 32, y); y += 14; if (y>540){doc.addPage();y=36;} });
      y += 4;
    });
  }

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Equipment', 32, 36);
  doc.setFontSize(10); y = 60;
  if (!bom.equipment.length) {
    doc.text('• No equipment placed.', 32, y);
  } else {
    bom.equipment.forEach(e => {
      doc.text(`• ${e.label}: ${e.model}${e.footprint?'  ('+e.footprint+')':''}${e.port?'  port: '+e.port:''}`, 32, y);
      y += 14; if (y>540){doc.addPage();y=36;}
    });
  }

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Valves & Fixtures', 32, 36);
  doc.setFontSize(11); doc.text('Valves', 32, 60); doc.setFontSize(10); y = 76;
  if (!bom.valves.length) {
    doc.text('• No valves placed.', 32, y); y += 14;
  } else {
    bom.valves.forEach(v => {
      doc.text(`• ${v.typeLabel} ${v.size}: ${v.label} — ${v.model}`, 32, y);
      y += 14; if (y>540){doc.addPage();y=36;}
    });
  }
  y += 8;
  if (y > 500) { doc.addPage(); y = 36; }
  doc.setFontSize(11); doc.text('Fixtures', 32, y); y += 16; doc.setFontSize(10);
  const fixEntries = Object.entries(bom.fixtures);
  if (!fixEntries.length) {
    doc.text('• No fixtures placed.', 32, y);
  } else {
    fixEntries.forEach(([k,v]) => {
      doc.text(`• ${v} × ${k}`, 32, y); y += 14; if (y>540){doc.addPage();y=36;}
    });
  }

  doc.save(`poolflow-plan-${Date.now()}.pdf`);
  toast('PDF exported');
}

// Rasterize the world (positions of nodes + edges) to a PNG-ish data URL via canvas
function renderWorldToImage() {
  if (!state.items.length) return null;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const i of state.items) { minX=Math.min(minX,i.x); minY=Math.min(minY,i.y); maxX=Math.max(maxX,i.x+i.w); maxY=Math.max(maxY,i.y+i.h); }
  const pad = 40;
  const w = (maxX - minX) + pad*2, h = (maxY - minY) + pad*2;
  const c = document.createElement('canvas');
  const scale = 2;
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  const ox = -minX + pad, oy = -minY + pad;

  // grid
  ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  // edges
  for (const e of state.edges) {
    const a = getItem(e.from), b = getItem(e.to); if (!a||!b) continue;
    const p1 = { x: a.x + a.w/2 + ox, y: a.y + a.h/2 + oy };
    const p2 = { x: b.x + b.w/2 + ox, y: b.y + b.h/2 + oy };
    const t = PIPE_TYPES[e.type] || PIPE_TYPES.return;
    ctx.strokeStyle = t.color.startsWith('var') ? cssVarColor(t.color) : t.color;
    ctx.lineWidth = pipeStrokeWidth(e.size);
    ctx.setLineDash(t.dash ? t.dash.split(' ').map(Number) : []);
    ctx.beginPath();
    const mx = (p1.x + p2.x) / 2;
    ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(mx, p1.y, mx, p2.y, p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - 10*Math.cos(ang-0.4), p2.y - 10*Math.sin(ang-0.4));
    ctx.lineTo(p2.x - 10*Math.cos(ang+0.4), p2.y - 10*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fill();
    // label
    ctx.fillStyle = '#111'; ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${e.size||''} ${t.label}`, (p1.x+p2.x)/2, (p1.y+p2.y)/2 - 8);
  }

  // dims
  ctx.strokeStyle = '#444'; ctx.fillStyle = '#111';
  for (const d of state.dims) {
    const a = getItem(d.a), b = getItem(d.b); if (!a||!b) continue;
    const ca = { x: a.x + a.w/2 + ox, y: a.y + a.h/2 + oy };
    const cb = { x: b.x + b.w/2 + ox, y: b.y + b.h/2 + oy };
    const y = Math.min(ca.y, cb.y) - 30;
    ctx.beginPath(); ctx.moveTo(ca.x, y); ctx.lineTo(cb.x, y); ctx.stroke();
    const ft = (Math.hypot(cb.x-ca.x, cb.y-ca.y)/24).toFixed(1);
    ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${d.label}: ${ft} ft`, (ca.x+cb.x)/2, y - 6);
  }

  // nodes
  for (const i of state.items) {
    const x = i.x + ox, y = i.y + oy;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = i.type === 'pool' ? '#1f6feb' : i.type === 'spa' ? '#7c4dff' : i.type === 'pad' ? '#999' : '#333';
    ctx.lineWidth = 2;
    if (i.type === 'pad') ctx.setLineDash([6,4]);
    roundRect(ctx, x, y, i.w, i.h, 8); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i.label, x + i.w/2, y + i.h/2 - 4);
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#555';
    const m = metaText(i);
    if (m) ctx.fillText(m, x + i.w/2, y + i.h/2 + 12);
  }

  return { url: c.toDataURL('image/png'), w, h };
}
function roundRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function cssVarColor(v) {
  // map our CSS variable names to concrete colors for canvas export
  const map = {
    'var(--pipe-suction)':'#1f6feb',
    'var(--pipe-return)':'#e23b56',
    'var(--pipe-spillover)':'#7c4dff',
    'var(--pipe-feature)':'#e07b00',
    'var(--pipe-conduit)':'#9aa0a6',
    'var(--pipe-gas)':'#d19900',
    'var(--pipe-drain)':'#3a4a5c',
  };
  return map[v] || '#333';
}

function exportPNG() {
  const img = renderWorldToImage();
  if (!img) { toast('Add parts first'); return; }
  const a = document.createElement('a');
  a.href = img.url; a.download = `poolflow-plan-${Date.now()}.png`;
  a.click();
  toast('Image saved');
}
async function sharePlan() {
  const img = renderWorldToImage();
  if (!img) { toast('Add parts first'); return; }
  try {
    const blob = await (await fetch(img.url)).blob();
    const file = new File([blob], `poolflow-plan.png`, { type:'image/png' });
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      await navigator.share({ files:[file], title:'PoolFlow plan' });
    } else {
      exportPNG();
    }
  } catch { exportPNG(); }
}

// ---------- GitHub push ----------
function openGithubModal() {
  modalContent.innerHTML = `
    <h3>Update GitHub</h3>
    <p style="color:var(--muted); font-size:13px;">This will overwrite <code>index.html</code> in <code>reifere-stack/poolflow-planner</code> with the current page source. Bring your own Personal Access Token (classic) with <code>repo</code> scope.</p>
    <div class="field"><label>GitHub Token</label><input type="password" id="gh-token" placeholder="ghp_..."/></div>
    <div class="field" style="margin-top:8px;"><label>Commit message</label><input id="gh-msg" value="Update planner from device"/></div>
    <div class="row" style="margin-top:14px;">
      <button class="btn" id="gh-cancel">Cancel</button>
      <button class="btn primary" id="gh-go">Push</button>
    </div>
  `;
  modalBackdrop.classList.add('show');
  $('gh-cancel').onclick = closeModal;
  $('gh-go').onclick = async () => {
    const token = $('gh-token').value.trim();
    const msg = $('gh-msg').value.trim() || 'Update planner';
    if (!token) { toast('Need a token'); return; }
    try {
      const html = document.documentElement.outerHTML;
      const content = btoa(unescape(encodeURIComponent(html)));
      const url = 'https://api.github.com/repos/reifere-stack/poolflow-planner/contents/index.html';
      const get = await fetch(url, { headers:{ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json' } });
      const existing = await get.json();
      const put = await fetch(url, {
        method:'PUT',
        headers:{ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json','Content-Type':'application/json' },
        body: JSON.stringify({ message: msg, content, sha: existing.sha })
      });
      if (!put.ok) throw new Error(await put.text());
      toast('Pushed to GitHub');
      closeModal();
    } catch (err) {
      toast('Push failed');
      console.error(err);
    }
  };
}
function closeModal() { modalBackdrop.classList.remove('show'); modalContent.innerHTML=''; }
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });

// ---------- Demo ----------
function loadDemo() {
  pushUndo();
  state.items = []; state.edges = []; state.dims = []; state.selectedId = null;
  world.querySelectorAll('.node').forEach(n => n.remove());
  state.nextId = 1;

  const add = (type, opts) => addItem(type, opts);
  const pool = add('pool',    { x: 80,  y: 380, label:'Pool' });
  const spa  = add('spa',     { x: 380, y: 220, label:'Spa', relation:'pool' });
  const pad  = add('pad',     { x: 1100, y: 280, label:'Equipment Pad' });
  const sk   = add('skimmer', { x: 110, y: 340, label:'Skimmer', size:'2.5"' });
  const md   = add('drain',   { x: 200, y: 540, label:'Main Drain', size:'2"' });
  const ret1 = add('return',  { x: 110, y: 600, label:'Return 1', size:'2"' });
  const ret2 = add('return',  { x: 240, y: 600, label:'Return 2', size:'2"' });
  const jet  = add('jet',     { x: 410, y: 260, label:'Spa Jet 1', size:'2"' });
  const feat = add('feature', { x: 700, y: 200, label:'Water Feature', size:'2"', relation:'spa' });
  const vSuc = add('valve3',  { x: 920, y: 320, label:'Suction Valve', valveState:'a' });
  const pump = add('pump',    { x: 1110, y: 300, label:'Pump', size:'2.5"' });
  const flt  = add('filter',  { x: 1240, y: 300, label:'Filter', size:'2.5"' });
  const htr  = add('heater',  { x: 1370, y: 300, label:'Heater', size:'2.5"' });
  const vRet = add('valve3',  { x: 1510, y: 300, label:'Return Valve', valveState:'both' });
  const tee  = add('tee',     { x: 1620, y: 380, label:'Tee' });
  const fvlv = add('valve2',  { x: 800, y: 300, label:'Feature Valve', valveState:'open' });

  const addE = (from, to, type, size) => state.edges.push({ id:uid(), from:from.id, to:to.id, type, size, label:`${from.label} → ${to.label}`, active:false, blocked:false });
  addE(sk,   vSuc, 'suction', '2.5"');
  addE(md,   vSuc, 'suction', '2"');
  addE(vSuc, pump, 'suction', '2.5"');
  addE(pump, flt,  'return',  '2.5"');
  addE(flt,  htr,  'return',  '2.5"');
  addE(htr,  vRet, 'return',  '2.5"');
  addE(htr,  fvlv, 'feature', '2"');
  addE(fvlv, feat, 'feature', '2"');
  addE(feat, spa,  'feature', '2"');
  addE(vRet, tee,  'return',  '2.5"');
  addE(tee,  ret1, 'return',  '2"');
  addE(tee,  ret2, 'return',  '2"');
  addE(vRet, jet,  'return',  '2"');
  addE(spa,  pool, 'spillover','2.5"');

  state.dims.push({ a: ret1.id, b: ret2.id, label:'Return spacing' });

  solveFlow(); persist(); redrawAll(); fitToContent();
}

// ---------- Top-bar buttons ----------
$('menuBtn').addEventListener('click', () => {
  if (sheet.classList.contains('open')) midSheet();
  else openSheet();
});
$('connectBtn').addEventListener('click', () => {
  if (state.connectMode) cancelConnectMode();
  else startConnectMode();
});
$('connectCancel').addEventListener('click', cancelConnectMode);
$('undoBtn').addEventListener('click', undo);

$('zoomIn').addEventListener('click', () => setZoom(state.view.scale * 1.25));
$('zoomOut').addEventListener('click', () => setZoom(state.view.scale / 1.25));
$('zoomFit').addEventListener('click', fitToContent);

// Theme auto
document.documentElement.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// ---------- Init ----------
if (!restore()) {
  loadDemo();
} else {
  redrawAll();
  applyTransform();
  setTimeout(fitToContent, 50);
}
renderSheet();
solveFlow();

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedId) { deleteItem(state.selectedId); e.preventDefault(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { undo(); e.preventDefault(); }
});

// Resize
window.addEventListener('resize', () => { applyTransform(); });

})();
