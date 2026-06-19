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
  connectSourceTap: null,
  pendingPipe: { type:'return', size:'2"' },
  view: { scale: 1, tx: 0, ty: 0 },
  scale: { pxPerFoot: 24 },
  nextId: 1,
  lastSolve: null,
  undoStack: [],
  editingEdgeId: null,
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
    // Migration: old 3-way valve states 'a'/'b'/'both' -> 'pos1'/'pos2'/'shared'.
    // Also strip the long-dead edge.valvePort field.
    const VS_MAP = { a: 'pos1', b: 'pos2', both: 'shared', '': 'shared' };
    for (const it of state.items) {
      if (it.type === 'valve3' && it.valveState in VS_MAP) {
        it.valveState = VS_MAP[it.valveState];
      }
    }
    for (const e of state.edges) {
      if ('valvePort' in e) delete e.valvePort;
    }
    // Migration: assign explicit ports for legacy edges touching valve3 / pump.
    // Valves: use direction-based heuristic + geometry (left = A, right = B).
    // Pumps:  incoming = intake (suction), outgoing = discharge (return).
    migratePortsOnLoad(state);
    state.dims = s.dims || [];
    state.nextId = s.nextId || (s.items.length + 1);
    state.view = s.view || { scale:1, tx:0, ty:0 };
    state.pendingPipe = s.pendingPipe || { type:'return', size:'2"' };
    state.scale = s.scale && s.scale.pxPerFoot ? s.scale : { pxPerFoot: 24 };
    return true;
  } catch { return false; }
}

// One-time-per-load migration: write fromPort/toPort onto edges touching
// 3-way valves and pumps so the new port-aware code paths work for legacy plans.
function migratePortsOnLoad(s) {
  if (!s || !Array.isArray(s.items) || !Array.isArray(s.edges)) return;
  const itemById = {};
  s.items.forEach(it => itemById[it.id] = it);

  // --- 3-way valves ---
  for (const valve of s.items) {
    if (valve.type !== 'valve3') continue;
    const touching = s.edges.filter(e =>
      (e.from === valve.id || e.to === valve.id) &&
      e.type !== 'conduit' && e.type !== 'spillover'
    );
    // Skip if any edge already has a valid port set.
    const alreadyPorted = touching.some(e =>
      (e.from === valve.id && (e.fromPort === 'trunk' || e.fromPort === 'a' || e.fromPort === 'b')) ||
      (e.to   === valve.id && (e.toPort   === 'trunk' || e.toPort   === 'a' || e.toPort   === 'b'))
    );
    if (alreadyPorted) continue;
    const ins  = touching.filter(e => e.to   === valve.id);
    const outs = touching.filter(e => e.from === valve.id);
    // Identify trunk edge + branch edges using the old direction heuristic.
    let trunkEdge = null, branchEdges = [];
    if (outs.length >= 2 && ins.length <= 1) { trunkEdge = ins[0]  || null; branchEdges = outs.slice(0, 2); }
    else if (ins.length >= 2 && outs.length <= 1) { trunkEdge = outs[0] || null; branchEdges = ins.slice(0, 2); }
    else if (outs.length >= 2) { trunkEdge = ins[0]  || null; branchEdges = outs.slice(0, 2); }
    else if (ins.length >= 2)  { trunkEdge = outs[0] || null; branchEdges = ins.slice(0, 2);  }
    else {
      // 0-1 edges total: assign trunk to whatever single edge is there.
      if (touching.length === 1) trunkEdge = touching[0];
    }
    // Sort branches: left-most (smaller x) becomes A, other becomes B.
    const otherEnd = (e) => e.from === valve.id ? itemById[e.to] : itemById[e.from];
    if (branchEdges.length === 2) {
      const a = otherEnd(branchEdges[0]);
      const b = otherEnd(branchEdges[1]);
      if (a && b) {
        const ka = (a.y || 0) * 10000 + (a.x || 0);
        const kb = (b.y || 0) * 10000 + (b.x || 0);
        if (ka > kb) branchEdges = [branchEdges[1], branchEdges[0]];
      }
    }
    const writePort = (e, port) => {
      if (!e) return;
      if (e.from === valve.id) e.fromPort = port;
      else if (e.to === valve.id) e.toPort = port;
    };
    writePort(trunkEdge, 'trunk');
    if (branchEdges[0]) writePort(branchEdges[0], 'a');
    if (branchEdges[1]) writePort(branchEdges[1], 'b');
  }

  // --- Propagate suction/return type through pass-through nodes ---
  // Done BEFORE pumps so pump pass also reaffirms intake/discharge.
  propagatePipeTypes(s);

  // --- Pumps ---
  for (const pump of s.items) {
    if (pump.type !== 'pump') continue;
    const touching = s.edges.filter(e =>
      (e.from === pump.id || e.to === pump.id) &&
      e.type !== 'conduit' && e.type !== 'spillover'
    );
    for (const e of touching) {
      // Incoming -> intake (suction). Outgoing -> discharge (return).
      if (e.to === pump.id) {
        if (e.toPort !== 'intake' && e.toPort !== 'discharge') e.toPort = 'intake';
        if (e.toPort === 'intake'    && e.type !== 'feature' && e.type !== 'gas' && e.type !== 'conduit') e.type = 'suction';
      }
      if (e.from === pump.id) {
        if (e.fromPort !== 'intake' && e.fromPort !== 'discharge') e.fromPort = 'discharge';
        if (e.fromPort === 'discharge' && e.type !== 'feature' && e.type !== 'gas' && e.type !== 'conduit') e.type = 'return';
      }
    }
  }

  // Run propagation once more after pump tagging so anything downstream of a
  // freshly-tagged pump pipe is correct.
  propagatePipeTypes(s);
}

// Items that pass a pipe type through (do NOT terminate it):
const PASS_THROUGH_TYPES = new Set([
  'tee', 'valve2', 'valve3', 'checkvalve', 'actuated', 'manifold',
  'filter', 'heater', 'saltcell', 'booster', 'customeq',
  'bodylink',
]);

// Pipe types that participate in suction/return propagation (others are
// special-purpose and left alone).
function isHydraulicPipe(type) {
  return type === 'suction' || type === 'return';
}

// Returns 'suction' | 'return' | null. Walks outward from one side of `edge`
// through pass-through items until it hits a classified endpoint.
function resolveEndRole(edge, side, s, itemById) {
  // side: 'from' or 'to'
  const startId = side === 'from' ? edge.from : edge.to;
  const startItem = itemById[startId];
  if (!startItem) return null;
  // If start is itself a classified endpoint, use it directly.
  const startPort = side === 'from' ? edge.fromPort : edge.toPort;
  const direct = impliedPipeTypeForEndpoint(startItem, startPort);
  if (direct) return direct;
  // BFS through pass-through items.
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const item = itemById[id];
    if (!item) continue;
    if (!PASS_THROUGH_TYPES.has(item.type)) continue;
    // Find adjacent edges of hydraulic type.
    for (const e of s.edges) {
      if (!isHydraulicPipe(e.type)) continue;
      let otherId = null, otherPort = null;
      if (e.from === id) { otherId = e.to;   otherPort = e.toPort; }
      else if (e.to === id) { otherId = e.from; otherPort = e.fromPort; }
      if (!otherId || visited.has(otherId)) continue;
      visited.add(otherId);
      const otherItem = itemById[otherId];
      const otherRole = impliedPipeTypeForEndpoint(otherItem, otherPort);
      if (otherRole) return otherRole;
      queue.push(otherId);
    }
  }
  return null;
}

function propagatePipeTypes(s) {
  if (!s || !Array.isArray(s.items) || !Array.isArray(s.edges)) return;
  const itemById = {};
  s.items.forEach(it => itemById[it.id] = it);
  for (const e of s.edges) {
    if (!isHydraulicPipe(e.type)) continue;
    const fromRole = resolveEndRole(e, 'from', s, itemById);
    const toRole   = resolveEndRole(e, 'to',   s, itemById);
    // Pick non-null role. If both agree, easy. If they disagree, leave as-is
    // — the design is hydraulically wrong and we don't want to mask it.
    let chosen = null;
    if (fromRole && toRole) chosen = (fromRole === toRole) ? fromRole : null;
    else chosen = fromRole || toRole;
    if (chosen && chosen !== e.type) e.type = chosen;
  }
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

  // Pipe hit (transparent thick stroke over each routed line)
  const pipeHit = e.target.closest('.pipe-hit');
  if (pipeHit && !nodeEl) {
    const edgeId = pipeHit.dataset.edgeId;
    if (state.connectMode && state.connectSourceId) {
      // Insert a tee in the middle of this pipe, connecting source -> new tee
      const wp = clientToWorld(e.clientX, e.clientY);
      handleConnectTapOnPipe(edgeId, wp);
      clearLongPress();
      e.preventDefault();
      return;
    }
    if (state.editingEdgeId === edgeId) {
      // Add a waypoint at this point
      const wp = clientToWorld(e.clientX, e.clientY);
      const edge = state.edges.find(x => x.id === edgeId);
      if (edge) {
        pushUndo();
        edge.waypoints = edge.waypoints || [];
        insertWaypointInOrder(edge, wp);
        if (edge.routeStyle === 'auto' || !edge.routeStyle) edge.routeStyle = 'manual';
        drawEdges(); persist(); renderSheet();
        toast('Bend added');
      }
      clearLongPress();
      e.preventDefault();
      return;
    }
    // Otherwise tap just selects this edge for editing
    state.editingEdgeId = edgeId;
    drawEdges();
    openSheetTab('pipes');
    openSheet();
    clearLongPress();
    e.preventDefault();
    return;
  }

  // Waypoint handle hit
  const wpHit = e.target.closest('.pipe-wp');
  if (wpHit) {
    const edgeId = wpHit.dataset.edgeId;
    const idx = parseInt(wpHit.dataset.wpIdx, 10);
    const edge = state.edges.find(x => x.id === edgeId);
    if (edge) {
      dragMode = 'waypoint';
      const start = clientToWorld(e.clientX, e.clientY);
      dragData = { edge, idx, startX: e.clientX, startY: e.clientY, origWp: { ...edge.waypoints[idx] } };
      // long-press deletes the waypoint
      clearLongPress();
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        pushUndo();
        edge.waypoints.splice(idx, 1);
        if (!edge.waypoints.length && edge.routeStyle === 'manual') edge.routeStyle = 'auto';
        drawEdges(); persist(); renderSheet();
        toast('Bend removed');
      }, LONG_PRESS_MS);
      e.preventDefault();
      return;
    }
  }

  if (nodeEl) {
    const id = nodeEl.dataset.id;
    const item = getItem(id);
    if (!item) return;

    if (state.connectMode) {
      // Tap-to-connect flow. Pass the world-space tap point so port-aware
      // endpoints (valve3, pump) can pick the closest port to the tap.
      const tapPt = clientToWorld(e.clientX, e.clientY);
      handleConnectTap(id, tapPt);
      clearLongPress();
      return;
    }

    // Tap a 3-way valve port chip = flip the valve to that position.
    // (A=pos1, B=pos2, Trunk=shared). Skip drag setup in this case.
    const portChip = e.target.closest && e.target.closest('.valve3-port');
    if (portChip && item.type === 'valve3') {
      const port = portChip.dataset.port;
      selectItem(id);
      setValve3ByPort(item, port);
      clearLongPress();
      e.preventDefault();
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

  if (dragMode === 'waypoint') {
    if (longPressFired) return;
    if (p.moved) {
      clearLongPress();
      const dxw = (e.clientX - dragData.startX) / state.view.scale;
      const dyw = (e.clientY - dragData.startY) / state.view.scale;
      const wp = dragData.edge.waypoints[dragData.idx];
      wp.x = Math.round(dragData.origWp.x + dxw);
      wp.y = Math.round(dragData.origWp.y + dyw);
      drawEdges();
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
      // A clean tap (no drag, no long-press) on a 2-way valve toggles it.
      // 3-way valves flip via port-chip taps instead.
      const tappedItem = dragData?.item;
      if (tappedItem && tappedItem.type === 'valve2') {
        cycleValve(tappedItem);
      }
    } else if (p.moved) {
      pushUndo(); // commit move
      const moved = dragData?.item;
      if (moved && maybeAutoRelate(moved)) {
        refreshItem(moved);
        solveFlow();
        syncSelectedPanel();
      }
      // Pool/Spa moves can re-flow nearby fixtures too
      if (moved && (moved.type === 'pool' || moved.type === 'spa')) {
        let any = false;
        for (const it of state.items) if (maybeAutoRelate(it)) { refreshItem(it); any = true; }
        if (any) solveFlow();
      }
    }
    dragMode = null; dragData = null; persist();
    return;
  }

  if (dragMode === 'resize') {
    pushUndo(); persist();
    const resized = dragData?.item;
    dragMode = null; dragData = null;
    if (resized) {
      // resizing a body can change which fixtures it covers
      if (resized.type === 'pool' || resized.type === 'spa') {
        let any = false;
        for (const it of state.items) if (maybeAutoRelate(it)) { refreshItem(it); any = true; }
        if (any) solveFlow();
      } else if (maybeAutoRelate(resized)) {
        refreshItem(resized);
        solveFlow();
      }
    }
    syncSelectedPanel();
    return;
  }

  if (dragMode === 'waypoint') {
    if (p.moved && !longPressFired) { pushUndo(); persist(); }
    dragMode = null; dragData = null;
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

// Fixture types that can imply a body of water by proximity.
const FIXTURE_DEFAULT_BODY = {
  jet: 'spa', bubbler: 'spa',
  return: 'pool', skimmer: 'pool', drain: 'pool', deckjet: 'pool',
  sheer: 'pool', slide: 'pool', autofill: 'pool', feature: 'pool',
  light: null, conduit: null, custom: null,
};

// Test whether two axis-aligned rects overlap (or one contains the other).
function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function rectArea(r) { return Math.max(0, r.w) * Math.max(0, r.h); }

function rectIntersectArea(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

// If a fixture sits on top of (or close to) a Pool/Spa, return that body type.
// Returns 'pool' | 'spa' | null. Closest wins; overlap beats nearest-by-center.
function inferBodyRelation(item) {
  if (!(item.type in FIXTURE_DEFAULT_BODY)) return null;
  if (FIXTURE_DEFAULT_BODY[item.type] === null) return null;
  const bodies = state.items.filter(i => i.type === 'pool' || i.type === 'spa');
  if (!bodies.length) return null;
  // 1) Prefer the body whose rect overlaps the fixture rect the most.
  let bestOverlap = 0, overlapBody = null;
  for (const b of bodies) {
    const a = rectIntersectArea(item, b);
    if (a > bestOverlap) { bestOverlap = a; overlapBody = b; }
  }
  if (overlapBody) return overlapBody.type;
  // 2) Otherwise use nearest body within a reasonable distance (about 1 fixture-width away).
  const cx = item.x + item.w/2, cy = item.y + item.h/2;
  let bestDist = Infinity, nearest = null;
  for (const b of bodies) {
    const bcx = b.x + b.w/2, bcy = b.y + b.h/2;
    // Distance from fixture center to body edge (negative if inside).
    const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w));
    const dy = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bestDist) { bestDist = d; nearest = b; }
  }
  const closeEnoughPx = Math.max(item.w, item.h);
  if (nearest && bestDist <= closeEnoughPx) return nearest.type;
  return null;
}

// Apply inferred relation IF the user hasn't manually set one.
function maybeAutoRelate(item) {
  if (!(item.type in FIXTURE_DEFAULT_BODY)) return false;
  if (item.relationLocked) return false; // user pinned it
  const inferred = inferBodyRelation(item);
  if (inferred && item.relation !== inferred) {
    item.relation = inferred;
    item.relationAuto = true;
    return true;
  }
  return false;
}

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
    valveState: opts.valveState || (type==='valve2' ? 'open' : type==='valve3' ? 'shared' : ''),
    x: opts.x ?? Math.round((center.x - tool.w/2 + offset) / 4) * 4,
    y: opts.y ?? Math.round((center.y - tool.h/2 + offset) / 4) * 4,
    w: opts.w ?? tool.w,
    h: opts.h ?? tool.h,
  };
  pushUndo();
  state.items.push(item);
  renderItem(item);
  // Auto-infer body relation when the fixture is placed on/near a Pool or Spa,
  // unless the caller already specified one (e.g. demo seed).
  if (!item.relation) {
    if (maybeAutoRelate(item)) refreshItem(item);
  }
  selectItem(item.id);
  persist();
  return item;
}

// Build the inner HTML for a 3-way valve node: a visible T-shape body with three
// labelled ports (Trunk on bottom, A on left, B on right). The port markers are
// absolute-positioned dots; the open-position chip shows current flow.
function valve3InnerMarkup(item) {
  const info = (typeof valveBranchInfo === 'function') ? valveBranchInfo(item) : null;
  const labelA = info ? info.pos1 : 'A';
  const labelB = info ? info.pos2 : 'B';
  const side   = info ? info.side : 'unknown';
  const vs = item.valveState || 'shared';
  let trunkRole = 'Trunk';
  if (side === 'return')  trunkRole = 'In';
  if (side === 'suction') trunkRole = 'Out';
  const openClass = (port) => {
    if (vs === 'shared') return port === 'a' || port === 'b' ? 'open' : '';
    if (vs === 'pos1' && port === 'a') return 'open';
    if (vs === 'pos2' && port === 'b') return 'open';
    return '';
  };
  const legClass = (port) => openClass(port) ? 'leg-open' : 'leg-closed';
  const stateText = vs === 'shared' ? 'Shared'
                  : vs === 'pos1'   ? '→ ' + escapeHtml(labelA)
                  : vs === 'pos2'   ? '→ ' + escapeHtml(labelB)
                  : 'Off';
  return `
    <svg class="valve3-body" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line class="leg leg-trunk" x1="50" y1="50" x2="50" y2="100"/>
      <line class="leg ${legClass('a')}" x1="50" y1="50" x2="0"  y2="50"/>
      <line class="leg ${legClass('b')}" x1="50" y1="50" x2="100" y2="50"/>
      <circle class="valve3-hub" cx="50" cy="50" r="10"/>
    </svg>
    <div class="valve3-title">${escapeHtml(item.label)}</div>
    <div class="valve3-port port-trunk" data-port="trunk" title="${escapeHtml(trunkRole)}">
      <span class="port-dot">T</span><span class="port-label">${escapeHtml(trunkRole)}</span>
    </div>
    <div class="valve3-port port-a ${openClass('a')}" data-port="a" title="Port A: ${escapeHtml(labelA)}">
      <span class="port-dot">A</span><span class="port-label">${escapeHtml(labelA)}</span>
    </div>
    <div class="valve3-port port-b ${openClass('b')}" data-port="b" title="Port B: ${escapeHtml(labelB)}">
      <span class="port-dot">B</span><span class="port-label">${escapeHtml(labelB)}</span>
    </div>
  `;
}

// Inner HTML for a pump: standard icon/title + two side ports labelled
// "Suction" (left, intake) and "Return" (right, discharge), Poolside-style.
function pumpInnerMarkup(item) {
  return `
    <div class="icon">${iconMarkup(item.type)}</div>
    <div class="title">${escapeHtml(item.label)}</div>
    <div class="meta">${escapeHtml(metaText(item))}</div>
    <div class="pump-port port-intake" data-port="intake" title="Intake → Suction">
      <span class="port-dot">S</span><span class="port-label">Suction</span>
    </div>
    <div class="pump-port port-discharge" data-port="discharge" title="Discharge → Return">
      <span class="port-dot">R</span><span class="port-label">Return</span>
    </div>
  `;
}

function nodeInnerMarkup(item) {
  if (item.type === 'valve3') return valve3InnerMarkup(item);
  if (item.type === 'pump')   return pumpInnerMarkup(item);
  return `
    <div class="icon">${iconMarkup(item.type)}</div>
    <div class="title">${escapeHtml(item.label)}</div>
    <div class="meta">${escapeHtml(metaText(item))}</div>
    <div class="resize-handle" aria-label="Resize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 21h12V9"/><path d="M14 14l7 7"/></svg></div>
  `;
}

function renderItem(item) {
  const tool = TOOLS[item.type] || {};
  const el = document.createElement('div');
  el.className = 'node ' + (NODE_CLASS[item.type] || '');
  if (item.type === 'valve3') el.classList.add('valve3-node');
  if (item.type === 'pump')   el.classList.add('pump-node');
  if (RESIZABLE.has(item.type)) el.classList.add('resizable');
  if ((item.type==='valve2' && item.valveState==='closed') ||
      (item.type==='valve3' && item.valveState==='')) {
    el.classList.add('closed-state');
  }
  el.dataset.id = item.id;
  Object.assign(el.style, { left: item.x+'px', top: item.y+'px', width: item.w+'px', height: item.h+'px' });
  el.innerHTML = nodeInnerMarkup(item);
  world.appendChild(el);
}
function metaText(item) {
  const bits = [];
  if (RESIZABLE.has(item.type)) {
    bits.push(`${fmtFIShort(item.w)} × ${fmtFIShort(item.h)}`);
  }
  if (item.size) bits.push(item.size);
  if (item.valveState) {
    if (item.type === 'valve3') {
      const info = valveBranchInfo(item);
      if (item.valveState === 'pos1') bits.push('→ ' + info.pos1);
      else if (item.valveState === 'pos2') bits.push('→ ' + info.pos2);
      else bits.push('shared');
    } else {
      bits.push(item.valveState);
    }
  }
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
  if (item.type === 'valve3') el.classList.add('valve3-node');
  if (item.type === 'pump')   el.classList.add('pump-node');
  if (RESIZABLE.has(item.type)) el.classList.add('resizable');
  if ((item.type==='valve2' && item.valveState==='closed')) el.classList.add('closed-state');
  if (state.selectedId === item.id) el.classList.add('selected');
  Object.assign(el.style, { left: item.x+'px', top: item.y+'px', width: item.w+'px', height: item.h+'px' });
  if (item.type === 'valve3' || item.type === 'pump') {
    // Rebuild fully so port labels & sub-elements stay in sync.
    el.innerHTML = nodeInnerMarkup(item);
  } else {
    const titleEl = el.querySelector('.title');
    const metaEl  = el.querySelector('.meta');
    if (titleEl) titleEl.textContent = item.label;
    if (metaEl)  metaEl.textContent  = metaText(item);
  }
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
    const order = ['pos1','pos2','shared'];
    const cur = order.indexOf(item.valveState);
    item.valveState = order[(cur + 1) % order.length] || 'shared';
  }
  refreshItem(item); solveFlow(); persist(); drawEdges();
  if (item.type === 'valve3') {
    const info = valveBranchInfo(item);
    const label = item.valveState === 'pos1' ? info.pos1
                : item.valveState === 'pos2' ? info.pos2
                : 'Shared';
    toast(`${item.label}: → ${label}`);
  } else {
    toast(`${item.label}: ${item.valveState}`);
  }
}

// Set a 3-way valve to a specific port (tap-on-port-chip):
//   tap A     -> open to A only (pos1)
//   tap B     -> open to B only (pos2)
//   tap Trunk -> open to both branches (shared)
function setValve3ByPort(item, port) {
  if (!item || item.type !== 'valve3') return;
  const target = port === 'a' ? 'pos1' : port === 'b' ? 'pos2' : 'shared';
  if (item.valveState === target) {
    // Tapping the already-open port has no effect, but give visual feedback.
    const info = valveBranchInfo(item);
    const lbl = target === 'pos1' ? info.pos1 : target === 'pos2' ? info.pos2 : 'Shared';
    toast(`${item.label}: already → ${lbl}`);
    return;
  }
  pushUndo();
  item.valveState = target;
  refreshItem(item); solveFlow(); persist(); drawEdges();
  syncSelectedPanel();
  const info = valveBranchInfo(item);
  const lbl = target === 'pos1' ? info.pos1 : target === 'pos2' ? info.pos2 : 'Shared';
  toast(`${item.label}: → ${lbl}`);
}

// ---------- Connect mode ----------
function startConnectMode() {
  if (!state.items.length) { toast('Add parts first'); return; }
  state.connectMode = true;
  state.connectSourceId = null;
  state.connectSourceTap = null;
  connectBanner.classList.add('show');
  closeSheet();
  toast('Connect mode: tap source, then destination');
}
function cancelConnectMode() {
  state.connectMode = false;
  state.connectSourceId = null;
  state.connectSourceTap = null;
  connectBanner.classList.remove('show');
  world.querySelectorAll('.node.connect-source').forEach(n => n.classList.remove('connect-source'));
}
// Insert a waypoint into an edge so its order along the polyline is preserved.
// We find the closest segment of the existing routed polyline and insert there.
function insertWaypointInOrder(edge, pt) {
  const existing = edge.waypoints || [];
  if (!existing.length) { edge.waypoints = [{ x: Math.round(pt.x), y: Math.round(pt.y) }]; return; }
  // Build the live anchor sequence (start + waypoints + end) to determine the best insert position
  const a = getItem(edge.from), b = getItem(edge.to);
  if (!a || !b) { existing.push({ x: Math.round(pt.x), y: Math.round(pt.y) }); return; }
  const start = edgeAnchorPoint(a, edge.fromPort);
  const end   = edgeAnchorPoint(b, edge.toPort);
  const seq = [start, ...existing, end];
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < seq.length - 1; i++) {
    const d = pointToSegmentDistance(pt, seq[i], seq[i+1]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  // Insert in the waypoints array at position bestI (since seq[0]=start, waypoints start at seq[1])
  existing.splice(bestI, 0, { x: Math.round(pt.x), y: Math.round(pt.y) });
  edge.waypoints = existing;
}

function pointToSegmentDistance(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx*vx + vy*vy;
  if (len2 < 1e-6) return Math.hypot(wx, wy);
  let t = (wx*vx + wy*vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * vx, py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}

// User tapped on an existing pipe while in connect mode (after picking a source).
// Splice the existing edge at that point with a new tee node, then make a new edge
// from the connect source -> the new tee.
function handleConnectTapOnPipe(edgeId, wp) {
  const edge = state.edges.find(e => e.id === edgeId);
  if (!edge) { cancelConnectMode(); return; }
  const sourceId = state.connectSourceId;
  if (!sourceId) { cancelConnectMode(); return; }
  if (sourceId === edge.from || sourceId === edge.to) { toast('Pick a different source'); cancelConnectMode(); return; }
  pushUndo();
  // Create the tee node at the tap point
  const teeId = uid();
  const teeW = TOOLS.tee?.w || 80, teeH = TOOLS.tee?.h || 60;
  const tee = {
    id: teeId,
    type: 'tee',
    label: 'Tee',
    x: Math.round(wp.x - teeW/2),
    y: Math.round(wp.y - teeH/2),
    w: teeW, h: teeH,
    size: edge.size,
  };
  state.items.push(tee);
  renderItem(tee);
  // Split the original edge: change its `to` to the tee, then add edge from tee -> original.to
  const originalTo = edge.to;
  edge.to = teeId;
  state.edges.push({
    id: uid(),
    from: teeId,
    to: originalTo,
    type: edge.type,
    size: edge.size,
    label: `${tee.label} → ${getItem(originalTo)?.label || '?'}`,
    active: false, blocked: false,
    routeStyle: edge.routeStyle || 'auto',
    waypoints: [],
    fromSize: '', toSize: '',
  });
  // Add the new branch from source -> tee using the pending pipe spec.
  // Honor the source-side port (valve3 / pump) recorded at source-tap time.
  const pp = state.pendingPipe;
  const srcItem = getItem(sourceId);
  const srcAssign = assignPortForTap(srcItem, state.connectSourceTap, 'from');
  const pipeType = srcAssign.pipeType || pp.type;
  state.edges.push({
    id: uid(),
    from: sourceId,
    to: teeId,
    type: pipeType,
    size: pp.size,
    label: `${srcItem?.label || '?'} → ${tee.label}`,
    active: false, blocked: false,
    routeStyle: pp.routeStyle || 'auto',
    waypoints: [],
    fromSize: '', toSize: '',
    fromPort: srcAssign.port || '',
    toPort: '',
  });
  toast('Tee inserted into pipe');
  cancelConnectMode();
  solveFlow(); persist(); drawEdges(); renderSheet();
}

function handleConnectTap(id, tapPt) {
  if (!state.connectSourceId) {
    state.connectSourceId = id;
    state.connectSourceTap = tapPt || null;
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
    const srcTap = state.connectSourceTap;
    const fromAssign = assignPortForTap(from, srcTap, 'from');
    const toAssign   = assignPortForTap(to,   tapPt, 'to');
    // Endpoint-implied pipe type wins over the pending pipe type:
    //   pump intake / skimmer / main drain → suction
    //   pump discharge / return / jet / bubbler / feature → return
    // The destination side wins if both ends imply a type (rare conflict).
    const impliedType = toAssign.pipeType || fromAssign.pipeType || null;
    const pipeType = impliedType || state.pendingPipe.type;
    state.edges.push({
      id: uid(),
      from: from.id,
      to: to.id,
      type: pipeType,
      size: state.pendingPipe.size,
      label: `${from.label} → ${to.label}`,
      active: false,
      blocked: false,
      routeStyle: state.pendingPipe.routeStyle || 'auto',
      waypoints: [],
      fromSize: '',
      toSize: '',
      fromPort: fromAssign.port || '',
      toPort:   toAssign.port   || '',
    });
    toast(`${PIPE_TYPES[pipeType].label} ${state.pendingPipe.size}: ${from.label} → ${to.label}`);
    solveFlow(); persist();
  }
  cancelConnectMode();
}

// ---------- Routing ----------
// Compute the orthogonal "L" path between two points based on routeStyle.
// style: 'auto' (90deg L), '45' (45-then-straight), 'straight' (direct line)
function autoRoute(p1, p2, style) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (style === 'straight') return [p1, p2];
  if (style === '45') {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 4 || ady < 4) return [p1, p2];
    const sx = Math.sign(dx), sy = Math.sign(dy);
    if (adx > ady) {
      // 45 diagonal first, then horizontal
      const corner = { x: p1.x + sx * ady, y: p2.y };
      return [p1, corner, p2];
    } else {
      const corner = { x: p2.x, y: p1.y + sy * adx };
      return [p1, corner, p2];
    }
  }
  // default: 90deg L. Choose corner to minimize visual overlap
  // Prefer horizontal-first then vertical
  if (Math.abs(dx) < 4 || Math.abs(dy) < 4) return [p1, p2];
  const corner = { x: p2.x, y: p1.y }; // horizontal then vertical
  return [p1, corner, p2];
}

// Anchor point for one end of an edge. Port-aware items (valve3, pump) anchor
// at the exact port world-position when their edge has a port assignment.
function edgeAnchorPoint(item, port) {
  if (item.type === 'valve3' && (port === 'trunk' || port === 'a' || port === 'b')) {
    return valvePortPos(item, port);
  }
  if (item.type === 'pump' && (port === 'intake' || port === 'discharge')) {
    return pumpPortPos(item, port);
  }
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

// Full route for an edge: anchor points + user waypoints, applying routing style
function edgeRoutePoints(e) {
  const a = getItem(e.from), b = getItem(e.to);
  if (!a || !b) return [];
  const start = edgeAnchorPoint(a, e.fromPort);
  const end   = edgeAnchorPoint(b, e.toPort);
  const style = e.routeStyle || 'auto';
  const wps = Array.isArray(e.waypoints) ? e.waypoints : [];
  if (style === 'manual' || wps.length) {
    // User-defined waypoints - connect with route style between each segment
    const segStyle = (style === 'manual') ? '90' : style;
    const segStyleFn = segStyle === '45' ? '45' : segStyle === 'straight' ? 'straight' : 'auto';
    const pts = [start, ...wps, end];
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const segPts = autoRoute(pts[i-1], pts[i], segStyleFn);
      for (let j = 1; j < segPts.length; j++) out.push(segPts[j]);
    }
    return out;
  }
  // Auto routing
  if (style === 'straight') return [start, end];
  if (style === '45') return autoRoute(start, end, '45');
  return autoRoute(start, end, 'auto');
}

// Build SVG path string with rounded corners from a list of polyline points
function polylineRoundedPath(pts, radius) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i-1], cur = pts[i], next = pts[i+1];
    const v1x = cur.x - prev.x, v1y = cur.y - prev.y;
    const v2x = next.x - cur.x, v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
    const r = Math.min(radius, len1/2, len2/2);
    if (r < 2 || len1 < 2 || len2 < 2) { d += ` L ${cur.x} ${cur.y}`; continue; }
    const ax = cur.x - (v1x/len1) * r, ay = cur.y - (v1y/len1) * r;
    const bx = cur.x + (v2x/len2) * r, by = cur.y + (v2y/len2) * r;
    d += ` L ${ax} ${ay} Q ${cur.x} ${cur.y} ${bx} ${by}`;
  }
  d += ` L ${pts[pts.length-1].x} ${pts[pts.length-1].y}`;
  return d;
}

// Classify each interior vertex of a polyline as 90 / 45 / other based on angle change
function polylineCorners(pts) {
  const corners = { e90: 0, e45: 0, other: 0 };
  if (pts.length < 3) return corners;
  for (let i = 1; i < pts.length - 1; i++) {
    const v1x = pts[i].x - pts[i-1].x, v1y = pts[i].y - pts[i-1].y;
    const v2x = pts[i+1].x - pts[i].x, v2y = pts[i+1].y - pts[i].y;
    const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
    if (len1 < 2 || len2 < 2) continue;
    const dot = (v1x*v2x + v1y*v2y) / (len1*len2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; // turn angle
    // ~90deg turn (i.e. interior angle 90)
    if (ang > 70 && ang < 110) corners.e90++;
    else if (ang > 30 && ang < 60) corners.e45++;
    else if (ang > 5) corners.other++;
  }
  return corners;
}

function polylineLengthPx(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  return len;
}

// ---------- Drawing ----------
function drawEdges() {
  const defs = `<defs>
    ${Object.entries(PIPE_TYPES).map(([k, v]) => `
      <marker id="arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0L10 5L0 10Z" fill="${v.color}"/>
      </marker>`).join('')}
    <style>
      .pipe { fill:none; stroke-linecap:round; stroke-linejoin:round; }
      .pipe.active { stroke-dasharray:14 10; animation: flow 1.2s linear infinite; }
      .pipe.blocked { opacity:.3; stroke-dasharray:4 8; }
      .pipe-hit { fill:none; stroke:transparent; stroke-width:18; cursor:crosshair; pointer-events:stroke; }
      .pipe-wp { fill:#fff; stroke:#333; stroke-width:1.5; cursor:move; pointer-events:all; }
      .pipe-wp.selected { stroke:var(--accent); stroke-width:2.5; }
      .reducer-badge { fill:#fff; stroke:#666; stroke-width:1; }
      .reducer-text { font: bold 9px -apple-system, system-ui, sans-serif; fill:#222; pointer-events:none; }
      .spill-wave { fill:none; stroke:#2eb6ff; stroke-width:4; stroke-linecap:round; opacity:.85; }
      .spill-wave-anim { animation: spillFlow 1.6s linear infinite; stroke-dasharray:10 8; }
      .spill-badge { fill:#fff; stroke:#2eb6ff; stroke-width:1.5; }
      .spill-text { font: 600 11px -apple-system, system-ui, sans-serif; fill:#0a6e9a; pointer-events:none; }
      .port-badge { fill:#fff; stroke:var(--accent, #4f8cff); stroke-width:1.5; }
      .port-badge.active { fill:var(--accent, #4f8cff); }
      .port-text { font: 700 11px -apple-system, system-ui, sans-serif; fill:var(--accent, #4f8cff); pointer-events:none; text-anchor:middle; dominant-baseline:central; }
      .port-text.active { fill:#fff; }
      @keyframes flow { to { stroke-dashoffset: -24; } }
      @keyframes spillFlow { to { stroke-dashoffset: -36; } }
    </style>
    <marker id="arr-spill" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#2eb6ff"/>
    </marker>
  </defs>`;
  let html = defs;
  // Spillover arrows are drawn first so pipes render above them
  html += renderSpillovers();
  for (const e of state.edges) {
    const pts = edgeRoutePoints(e);
    if (pts.length < 2) continue;
    const t = PIPE_TYPES[e.type] || PIPE_TYPES.return;
    const classes = ['pipe'];
    if (e.active) classes.push('active');
    if (e.blocked) classes.push('blocked');
    const sw = pipeStrokeWidth(e.size);
    const d = polylineRoundedPath(pts, 10);
    // Invisible thick stroke for hit-testing (tap on a pipe to add a tee)
    html += `<path d="${d}" class="pipe-hit" data-edge-id="${e.id}"></path>`;
    html += `<path d="${d}" class="${classes.join(' ')}" stroke="${t.color}" stroke-width="${sw}" stroke-dasharray="${t.dash}" marker-end="url(#arr-${e.type})" pointer-events="none"></path>`;
    // Label at midpoint of polyline
    const totalLen = polylineLengthPx(pts);
    let target = totalLen / 2, acc = 0, lx = pts[0].x, ly = pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const segLen = Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
      if (acc + segLen >= target) {
        const k = (target - acc) / segLen;
        lx = pts[i-1].x + (pts[i].x-pts[i-1].x) * k;
        ly = pts[i-1].y + (pts[i].y-pts[i-1].y) * k - 8;
        break;
      }
      acc += segLen;
    }
    html += `<text class="flow-text" x="${lx}" y="${ly}" text-anchor="middle" pointer-events="none">${escapeHtml(e.size || '')} ${escapeHtml(t.label)}</text>`;

    // Reducer bushing badges at endpoints if fromSize/toSize differ from line size
    if (e.fromSize && e.fromSize !== e.size) {
      html += reducerBadge(pts[0].x, pts[0].y, e.fromSize, e.size);
    }
    if (e.toSize && e.toSize !== e.size) {
      const last = pts[pts.length-1];
      html += reducerBadge(last.x, last.y, e.size, e.toSize);
    }

    // Show waypoint handles if this pipe is being edited
    if (state.editingEdgeId === e.id && Array.isArray(e.waypoints)) {
      e.waypoints.forEach((wp, idx) => {
        html += `<circle class="pipe-wp" cx="${wp.x}" cy="${wp.y}" r="7" data-edge-id="${e.id}" data-wp-idx="${idx}"></circle>`;
      });
    }
  }
  // Branch-name chips on 3-way valve branch pipes (Poolside-style).
  // For every valve3, draw a small chip near the valve end of each branch pipe showing
  // the destination name (e.g. "Pool", "Spa", or "Branch 1" fallback).
  for (const valve of state.items) {
    if (valve.type !== 'valve3') continue;
    const info = valveBranchInfo(valve);
    if (info.branches.length < 2) continue;
    const labels = [info.pos1, info.pos2];
    for (let i = 0; i < info.branches.length; i++) {
      const edge = info.branches[i];
      const label = labels[i] || ('Branch ' + (i + 1));
      const pts = edgeRoutePoints(edge);
      if (pts.length < 2) continue;
      // For suction-side branches, the valve sits at the .to end; for return-side, at .from.
      const valveAtStart = edge.from === valve.id;
      const p0 = valveAtStart ? pts[0] : pts[pts.length - 1];
      const p1 = valveAtStart ? pts[1] : pts[pts.length - 2];
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.min(28, len * 0.4);
      const bx = p0.x + (dx / len) * off;
      const by = p0.y + (dy / len) * off;
      const vs = valve.valveState || 'shared';
      const posIsOpen = vs === 'shared' || (vs === 'pos1' && i === 0) || (vs === 'pos2' && i === 1);
      const active = posIsOpen && edge.active && !edge.blocked;
      const cls = active ? 'port-badge active' : 'port-badge';
      const tcls = active ? 'port-text active' : 'port-text';
      const w = Math.max(44, label.length * 7.2 + 14);
      html += `<rect class="${cls}" x="${bx - w/2}" y="${by - 10}" width="${w}" height="20" rx="10" pointer-events="none"></rect>`;
      html += `<text class="${tcls}" x="${bx}" y="${by}" pointer-events="none">${escapeHtml(label)}</text>`;
    }
  }
  edgeSvg.innerHTML = html;
}

// ---------- Spillover (water-body to water-body) ----------
function renderSpillovers() {
  let svg = '';
  for (const item of state.items) {
    if ((item.type !== 'pool' && item.type !== 'spa') || !item.spillsInto) continue;
    const target = getItem(item.spillsInto);
    if (!target || (target.type !== 'pool' && target.type !== 'spa')) continue;
    // Anchor at edge of source nearest to target
    const a = nearestEdgePoint(item, target);
    const b = nearestEdgePoint(target, item);
    // Build a wavy path along the line a -> b
    const path = wavyPathBetween(a, b, 8, 18);
    svg += `<path class="spill-wave spill-wave-anim" d="${path}" marker-end="url(#arr-spill)"></path>`;
    // Label at midpoint with feature name
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const featLabel = SPILL_FEATURE_LABEL[item.spillFeature] || 'Spillover';
    const width = item.spillWidth ? ' · ' + item.spillWidth : '';
    const qty = (item.spillQty && item.spillQty > 1) ? (item.spillQty + '× ') : '';
    const text = qty + featLabel + width;
    const w = Math.max(80, text.length * 6.2);
    svg += `<rect class="spill-badge" x="${mx - w/2}" y="${my - 12}" width="${w}" height="22" rx="11"/>`;
    svg += `<text class="spill-text" x="${mx}" y="${my + 4}" text-anchor="middle">${escapeHtml(text)}</text>`;
  }
  return svg;
}

const SPILL_FEATURE_LABEL = {
  waterfall: 'Waterfall',
  sheer:     'Sheer descent',
  weir:      'Weir / dam plate',
  bondbeam:  'Raised bond beam',
  scupper:   'Scupper',
  rainwall:  'Rain curtain',
  runnel:    'Runnel',
};

function nearestEdgePoint(from, to) {
  // Project the center-to-center line onto the source rect's boundary
  const fc = { x: from.x + from.w/2, y: from.y + from.h/2 };
  const tc = { x: to.x + to.w/2,   y: to.y + to.h/2 };
  const dx = tc.x - fc.x, dy = tc.y - fc.y;
  if (dx === 0 && dy === 0) return fc;
  const hx = from.w / 2, hy = from.h / 2;
  const scale = Math.min(
    hx / Math.max(Math.abs(dx), 0.001),
    hy / Math.max(Math.abs(dy), 0.001)
  );
  return { x: fc.x + dx * scale, y: fc.y + dy * scale };
}

function wavyPathBetween(a, b, amplitude, wavelength) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const steps = Math.max(4, Math.floor(len / wavelength));
  let d = `M ${a.x} ${a.y}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + ux * len * t;
    const py = a.y + uy * len * t;
    const off = Math.sin(t * Math.PI * steps / 2) * amplitude * ((i % 2) ? 1 : -1);
    d += ` L ${px + nx * off} ${py + ny * off}`;
  }
  d += ` L ${b.x} ${b.y}`;
  return d;
}

function reducerBadge(x, y, sa, sb) {
  const label = `${sa}→${sb}`;
  // simple oval w/ text
  return `
    <ellipse class="reducer-badge" cx="${x}" cy="${y-18}" rx="24" ry="9"/>
    <text class="reducer-text" x="${x}" y="${y-15}" text-anchor="middle">${escapeHtml(label)}</text>`;
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

// ---------- 3-way valve: Poolside-style named-branch model ----------
// A 3-way valve has 3 physical ports: 1 trunk (common) + 2 branches.
// Return-side valves: trunk = inlet, branches = outputs (e.g. Pool / Spa).
// Suction-side valves: trunk = outlet, branches = inputs (e.g. Skimmer / Main Drain).
//
// valveState: 'pos1' | 'pos2' | 'shared'. Position names come from auto-naming
// the downstream graph (Poolside-style: branch ending at the spa becomes 'Spa').

const BRANCH_NAMED_TYPES = new Set([
  'pool','spa',
  'jet','bubbler','return','skimmer','drain','deckjet',
  'sheer','slide','autofill','feature','waterfall','laminar',
]);

// ---------- 3-way valve geometry & port helpers ----------
// A 3-way valve has 3 named ports laid out as a T:
//   trunk = bottom-center, a = left-middle, b = right-middle
// Ports are stored on the edge as edge.fromPort / edge.toPort = 'trunk'|'a'|'b'|''.
const V3_PORTS = ['trunk', 'a', 'b'];

function valvePortPos(valve, port) {
  if (!valve || valve.type !== 'valve3') return null;
  const cx = valve.x + valve.w / 2;
  const cy = valve.y + valve.h / 2;
  if (port === 'trunk') return { x: cx, y: valve.y + valve.h };
  if (port === 'a')     return { x: valve.x,            y: cy };
  if (port === 'b')     return { x: valve.x + valve.w,  y: cy };
  return { x: cx, y: cy };
}

// Returns 'trunk'|'a'|'b' closest to a world-space point.
function nearestValvePort(valve, pt) {
  let best = 'trunk', bestD = Infinity;
  for (const p of V3_PORTS) {
    const pos = valvePortPos(valve, p);
    const d = Math.hypot(pos.x - pt.x, pos.y - pt.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// All non-conduit edges touching this valve, grouped by port.
function valvePortMap(valve) {
  const out = { trunk: [], a: [], b: [], unassigned: [] };
  for (const e of state.edges) {
    if (e.type === 'conduit' || e.type === 'spillover') continue;
    if (e.from === valve.id) {
      const p = e.fromPort;
      if (p === 'trunk' || p === 'a' || p === 'b') out[p].push(e);
      else out.unassigned.push(e);
    } else if (e.to === valve.id) {
      const p = e.toPort;
      if (p === 'trunk' || p === 'a' || p === 'b') out[p].push(e);
      else out.unassigned.push(e);
    }
  }
  return out;
}

// Pick the first available port. Honors `preferred` if it's free.
function nextFreeValvePort(valve, preferred) {
  const pm = valvePortMap(valve);
  if (preferred && pm[preferred] && pm[preferred].length === 0) return preferred;
  for (const p of V3_PORTS) {
    if (pm[p].length === 0) return p;
  }
  return null;
}

// ---------- Pump ports (intake / discharge) ----------
// Pumps have 2 fixed ports: intake on the left (water in, suction side) and
// discharge on the right (water out, return side). Just like Poolside, anything
// connected to the intake side is automatically suction; anything connected to
// the discharge side is automatically return.
const PUMP_PORTS = ['intake', 'discharge'];

function pumpPortPos(pump, port) {
  if (!pump || pump.type !== 'pump') return null;
  const cy = pump.y + pump.h / 2;
  if (port === 'intake')    return { x: pump.x,             y: cy };
  if (port === 'discharge') return { x: pump.x + pump.w,    y: cy };
  return { x: pump.x + pump.w / 2, y: cy };
}

// Returns 'intake' or 'discharge' depending on which side of the pump pt is on.
function nearestPumpPort(pump, pt) {
  const cx = pump.x + pump.w / 2;
  return pt.x < cx ? 'intake' : 'discharge';
}

// Pipe type implied by a pump port: intake is suction, discharge is return.
function pumpPortPipeType(port) {
  if (port === 'intake')    return 'suction';
  if (port === 'discharge') return 'return';
  return null;
}

// ---------- Unified port assignment for connect-mode ----------
// Given an item and a tap point, return { port, pipeType } where pipeType is the
// implied pipe type (or null if the item doesn't dictate one).
// `role` is 'from' (this item is the source side of a new edge) or 'to' (destination).
// Endpoint role for pipe-type inference.
//   'suction' = water leaves the pool body here (skimmer, main drain)
//                or enters the pump (pump.intake) — pipes touching this point
//                MUST be suction.
//   'return'  = water enters the pool body here (return, jet, bubbler, etc.)
//                or leaves the pump (pump.discharge) — pipes here MUST be return.
//   null      = neutral (pumps, filters, valves, tees, bodies, etc.).
const SUCTION_FIXTURES = new Set(['skimmer', 'drain']);
const RETURN_FIXTURES  = new Set(['return', 'jet', 'bubbler', 'deckjet', 'sheer', 'slide', 'feature']);

function itemFixtureRole(item) {
  if (!item) return null;
  if (SUCTION_FIXTURES.has(item.type)) return 'suction';
  if (RETURN_FIXTURES.has(item.type))  return 'return';
  return null;
}

// Pipe type implied by either endpoint of a connection, considering both
// fixture types AND pump ports. Returns 'suction' | 'return' | null.
function impliedPipeTypeForEndpoint(item, port) {
  if (!item) return null;
  if (item.type === 'pump') return pumpPortPipeType(port);
  return itemFixtureRole(item);
}

function assignPortForTap(item, tapPt, role) {
  if (!item) return { port: '', pipeType: null };
  if (item.type === 'valve3') {
    if (!tapPt) return { port: nextFreeValvePort(item, null) || 'trunk', pipeType: null };
    return { port: nearestValvePort(item, tapPt), pipeType: null };
  }
  if (item.type === 'pump') {
    // If a tap point exists, honor it; otherwise default by role.
    let port;
    if (tapPt) port = nearestPumpPort(item, tapPt);
    else       port = role === 'from' ? 'discharge' : 'intake';
    return { port, pipeType: pumpPortPipeType(port) };
  }
  // Fixtures get their role-implied pipe type.
  const role2 = itemFixtureRole(item);
  return { port: '', pipeType: role2 };
}

// Returns { trunk, branches, side } for a valve3.
// New (preferred): use explicit per-edge port assignments (fromPort/toPort).
// Legacy fallback: infer from in/out direction.
function valveBranches(valve) {
  const pm = valvePortMap(valve);
  const hasExplicit = pm.trunk.length + pm.a.length + pm.b.length > 0;
  if (hasExplicit) {
    const trunk    = pm.trunk[0] || null;
    const branchA  = pm.a[0]     || null;
    const branchB  = pm.b[0]     || null;
    const branches = [branchA, branchB].filter(Boolean);
    // Side from arrow direction of the trunk edge.
    let side = 'unknown';
    if (trunk) {
      if (trunk.to   === valve.id) side = 'return';   // trunk is incoming -> branches outflow
      else if (trunk.from === valve.id) side = 'suction'; // trunk is outgoing -> branches inflow
    } else if (branchA || branchB) {
      // No trunk edge yet; guess from branches.
      const refEdge = branchA || branchB;
      side = refEdge.from === valve.id ? 'return' : 'suction';
    }
    return { trunk, branches, side };
  }
  // Legacy path: no port assignments yet, use the old in/out heuristic.
  const ins  = state.edges.filter(e => e.to   === valve.id && e.type !== 'conduit' && e.type !== 'spillover');
  const outs = state.edges.filter(e => e.from === valve.id && e.type !== 'conduit' && e.type !== 'spillover');
  let trunk = null, branches = [], side = 'unknown';
  if (outs.length >= 2 && ins.length <= 1) {
    trunk = ins[0] || null; branches = outs.slice(0, 2); side = 'return';
  } else if (ins.length >= 2 && outs.length <= 1) {
    trunk = outs[0] || null; branches = ins.slice(0, 2); side = 'suction';
  } else if (outs.length >= 2) {
    trunk = ins[0] || null; branches = outs.slice(0, 2); side = 'return';
  } else if (ins.length >= 2) {
    trunk = outs[0] || null; branches = ins.slice(0, 2); side = 'suction';
  }
  // Stable order: top-left destination becomes branch 1.
  if (branches.length === 2) {
    const otherEnd = (e) => side === 'suction' ? getItem(e.from) : getItem(e.to);
    const a = otherEnd(branches[0]), b = otherEnd(branches[1]);
    if (a && b) {
      const ka = (a.y || 0) * 10000 + (a.x || 0);
      const kb = (b.y || 0) * 10000 + (b.x || 0);
      if (ka > kb) branches = [branches[1], branches[0]];
    }
  }
  return { trunk, branches, side };
}

// Walk along non-conduit edges from one end of an edge and return the first
// "named" node (pool/spa/named fixture). Stops on cycles and other valves.
function findNamedDownstream(startEdge, direction) {
  const seen = new Set();
  const startNode = direction === 'forward' ? getItem(startEdge.to) : getItem(startEdge.from);
  if (!startNode) return null;
  const stack = [startNode];
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    if (BRANCH_NAMED_TYPES.has(node.type)) return node;
    if (node.type === 'valve3' || node.type === 'valve2' || node.type === 'actuated') continue;
    const next = direction === 'forward'
      ? state.edges.filter(e => e.from === node.id && e.type !== 'conduit' && e.type !== 'spillover')
      : state.edges.filter(e => e.to   === node.id && e.type !== 'conduit' && e.type !== 'spillover');
    for (const e of next) {
      const n = direction === 'forward' ? getItem(e.to) : getItem(e.from);
      if (n && !seen.has(n.id)) stack.push(n);
    }
  }
  return null;
}

// Display label for one branch. Priority: explicit override > auto-named > "Branch N".
function branchLabelFor(valve, branchEdge, branchIndex, side) {
  const override = valve.branchLabels && valve.branchLabels[branchEdge.id];
  if (override) return override;
  const direction = side === 'suction' ? 'backward' : 'forward';
  const named = findNamedDownstream(branchEdge, direction);
  if (named) return named.label || ('Branch ' + (branchIndex + 1));
  return 'Branch ' + (branchIndex + 1);
}

// Returns { trunk, branches, side, pos1, pos2 } for a valve3.
function valveBranchInfo(valve) {
  const { trunk, branches, side } = valveBranches(valve);
  if (branches.length < 2) {
    return { trunk, branches, side, pos1: 'Branch 1', pos2: 'Branch 2' };
  }
  return {
    trunk, branches, side,
    pos1: branchLabelFor(valve, branches[0], 0, side),
    pos2: branchLabelFor(valve, branches[1], 1, side),
  };
}

// Decide if flow may pass through a given edge of a valve3 under its current position.
function valve3EdgeOpen(valve, edge) {
  const { branches } = valveBranches(valve);
  const vs = valve.valveState || 'shared';
  if (vs === 'shared') return true;
  const isBranch = branches.some(b => b.id === edge.id);
  if (!isBranch) return true; // trunk always open
  if (vs === 'pos1') return branches[0]?.id === edge.id;
  if (vs === 'pos2') return branches[1]?.id === edge.id;
  return true;
}

function valveAllows(node, edges, index) {
  if (node.type === 'valve2') return node.valveState !== 'closed';
  if (node.type === 'valve3') {
    return valve3EdgeOpen(node, edges[index]);
  }
  if (node.type === 'checkvalve') return true;
  if (node.type === 'actuated') return node.valveState !== 'closed';
  return true;
}
function solveFlow() {
  // Normalize pipe types BEFORE solving so the flow logic sees correct
  // suction/return tagging (downstream checks rely on it).
  propagatePipeTypes(state);
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
    // Fixtures that deliver water into a body are valid terminal points.
    // They imply which body via item.relation (set in Selected panel), or by
    // sensible defaults (spa jets -> spa, deck jets/sheer/etc -> pool).
    const DELIVERY_DEFAULTS = {
      jet: 'spa', bubbler: 'spa',
      return: 'pool', skimmer: 'pool', drain: 'pool', deckjet: 'pool',
      sheer: 'pool', slide: 'pool', autofill: 'pool', feature: 'pool',
      light: null, conduit: null, custom: null,
    };
    if (node.type in DELIVERY_DEFAULTS) {
      const body = node.relation || DELIVERY_DEFAULTS[node.type];
      if (body) {
        results.push({ root, end: node.label, type: body, id: node.id, viaFixture: node.type });
        return;
      }
    }
    if (!outs.length) {
      issues.push(`${node.label} ends with no downstream body. Set a Body relation (Flows to pool/spa) in the Selected panel.`); return;
    }
    outs.forEach(o => traverse(o, root, new Set(seen)));
  }

  // Backward traversal for suction-side: walk against arrows from the pump,
  // marking inputs active. When a 3-way valve appears suction-side, only the
  // branch open under its current position passes; the other is blocked.
  function traverseBack(edge, seen) {
    edge.active = true;
    const node = getItem(edge.from);
    if (!node) return;
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.type === 'valve2' && node.valveState === 'closed') {
      edge.blocked = true; issues.push(`${node.label} is closed.`); return;
    }
    const ins = state.edges.filter(e => e.to === node.id && e.type !== 'conduit');
    if (node.type === 'valve3') {
      ins.forEach((inE) => {
        if (valve3EdgeOpen(node, inE)) traverseBack(inE, new Set(seen));
        else inE.blocked = true;
      });
      return;
    }
    if (node.type === 'tee') {
      ins.forEach(inE => traverseBack(inE, new Set(seen)));
      return;
    }
    if (['pool','spa'].includes(node.type)) return;
    // Otherwise (skimmer/drain/etc.), the suction chain ends here.
    if (!ins.length) return;
    ins.forEach(inE => traverseBack(inE, new Set(seen)));
  }

  for (const pump of pumps) {
    const incoming = state.edges.filter(e => e.to === pump.id && e.type !== 'conduit');
    const outgoing = state.edges.filter(e => e.from === pump.id && e.type !== 'conduit');
    if (!incoming.length) issues.push(`Pump ${pump.label} has no suction source.`);
    if (!outgoing.length) issues.push(`Pump ${pump.label} has no return destination.`);
    incoming.forEach(e => traverseBack(e, new Set([pump.id])));
    outgoing.forEach(o => traverse(o, pump.label, new Set([pump.id])));
  }

  // Spillover check — a body receiving water must have a way back to the source body
  // either via piped return, an explicit spillsInto, or relation hint.
  // "Receiving water" includes flow that terminates at a fixture in that body
  // (e.g. spa jets count as water arriving at the spa).
  const bodyReceiving = new Set(results.map(r => r.type));
  for (const body of state.items.filter(i => i.type === 'pool' || i.type === 'spa')) {
    const inToBody = state.edges.filter(e => e.to === body.id && ['return','spillover','feature'].includes(e.type) && e.active && !e.blocked);
    const viaFixture = bodyReceiving.has(body.type);
    if (!inToBody.length && !viaFixture) continue;
    const pipedOut = state.edges.filter(e => e.from === body.id && (e.type === 'spillover' || e.type === 'return') && e.active && !e.blocked);
    const reachesOther = pipedOut.some(e => { const t = getItem(e.to); return t && t.type !== body.type && (t.type === 'pool' || t.type === 'spa'); });
    const hasGravitySpill = !!(body.spillsInto && getItem(body.spillsInto));
    const relOther = body.relation && body.relation !== body.type;
    if (!relOther && !reachesOther && !hasGravitySpill) {
      const where = body.type === 'spa' ? 'pool' : 'spa';
      issues.push(`${body.label} (${body.type}) receives water but has no spillover or return path to a ${where}. Set a spillover destination in the Selected panel.`);
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
  const isBody = item.type === 'pool' || item.type === 'spa';
  const otherBodies = state.items.filter(i => (i.type === 'pool' || i.type === 'spa') && i.id !== item.id);
  const spillFeatures = [
    ['waterfall',  'Waterfall'],
    ['sheer',      'Sheer descent'],
    ['weir',       'Weir / dam plate'],
    ['bondbeam',   'Raised bond beam'],
    ['scupper',    'Scupper'],
    ['rainwall',   'Rain curtain / wall'],
    ['runnel',     'Runnel / channel'],
  ];
  const spillSizes = ['6"','12"','18"','24"','36"','48"','60"','72"','custom'];
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
        <div class="field"><label>Body relation${item.relationAuto && !item.relationLocked ? ' \u00b7 auto' : ''}</label>
          <select id="f-relation">
            <option value="">None</option>
            <option ${item.relation==='pool'?'selected':''} value="pool">Flows to pool</option>
            <option ${item.relation==='spa'?'selected':''} value="spa">Flows to spa</option>
          </select>
        </div>
      </div>
      ${isValve ? (item.type === 'valve3' ? (() => {
        const info = valveBranchInfo(item);
        const vs = item.valveState || 'shared';
        const pill = (state, label) => `<button class="valve-pill ${vs===state?'on':''}" data-action="setValveState" data-item-id="${item.id}" data-state="${state}">${label}</button>`;
        return `
      <div class="field" style="margin-top:8px;"><label>Valve position — tap to flip</label></div>
      <div class="valve-pills">
        ${pill('pos1', 'A: ' + escapeHtml(info.pos1))}
        ${pill('shared', 'Shared')}
        ${pill('pos2', 'B: ' + escapeHtml(info.pos2))}
      </div>
      <p style="color:var(--muted); font-size:12px; margin-top:6px;">Tip: tap a port (A / B / T) directly on the valve to flip it. Branches are auto-named from the plumbing downstream.</p>`;
      })() : `
      <div class="field" style="margin-top:8px;"><label>Valve mode — tap to flip</label></div>
      <div class="valve-pills">
        <button class="valve-pill ${item.valveState==='open'?'on':''}"   data-action="setValveState" data-item-id="${item.id}" data-state="open">Open</button>
        <button class="valve-pill ${item.valveState==='closed'?'on':''}" data-action="setValveState" data-item-id="${item.id}" data-state="closed">Closed</button>
      </div>
      <p style="color:var(--muted); font-size:12px; margin-top:6px;">Tip: just tap the valve on the canvas to toggle it.</p>`) : ''}
      ${renderEquipmentModelPicker(item)}
      ${renderSizeFields(item)}
      ${isBody ? `
      <div class="panel" style="margin:10px 0 0; padding:10px; border:1px dashed var(--border); background:color-mix(in srgb, var(--accent) 5%, transparent);">
        <div style="font-weight:600; margin-bottom:6px;">Spillover (gravity)</div>
        <p style="font-size:12px; color:var(--muted); margin:0 0 8px;">If this body spills into another, set the destination and feature here. The app will draw a wavy gravity arrow and add the feature to the takeoff.</p>
        <div class="row tight">
          <div class="field"><label>Spills into</label>
            <select id="f-spillsInto">
              <option value="">None</option>
              ${otherBodies.map(b => `<option ${item.spillsInto===b.id?'selected':''} value="${b.id}">${escapeHtml(b.label)} (${b.type})</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Feature</label>
            <select id="f-spillFeature">
              <option value="">—</option>
              ${spillFeatures.map(([k,lbl]) => `<option ${item.spillFeature===k?'selected':''} value="${k}">${lbl}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="row tight" style="margin-top:8px;">
          <div class="field"><label>Feature width</label>
            <select id="f-spillWidth">
              <option value="">—</option>
              ${spillSizes.map(s => `<option ${item.spillWidth===s?'selected':''} value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Quantity</label>
            <input id="f-spillQty" type="number" min="1" step="1" value="${item.spillQty||1}"/>
          </div>
        </div>
      </div>` : ''}
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
  const routeStyle = p.routeStyle || 'auto';
  const editing = state.editingEdgeId ? state.edges.find(e => e.id === state.editingEdgeId) : null;

  // If this pipe is a branch of a 3-way valve, show what it leads to and let the
  // user rename the branch if the auto-name isn't right.
  let portPanel = '';
  if (editing) {
    // The valve might be on either end of the edge (return-side: valve=from; suction-side: valve=to).
    const candidates = [getItem(editing.from), getItem(editing.to)].filter(v => v && v.type === 'valve3');
    for (const valve of candidates) {
      const info = valveBranchInfo(valve);
      const branchIdx = info.branches.findIndex(b => b.id === editing.id);
      if (branchIdx < 0) continue; // this edge is the trunk, not a branch
      const otherIdx = branchIdx === 0 ? 1 : 0;
      const myLabel = branchIdx === 0 ? info.pos1 : info.pos2;
      const otherLabel = branchIdx === 0 ? info.pos2 : info.pos1;
      const override = (valve.branchLabels && valve.branchLabels[editing.id]) || '';
      portPanel += `
        <div class="panel" style="border:2px solid var(--accent); margin-top:8px;">
          <h3>3-way valve branch</h3>
          <div style="font-size:13px; color:var(--muted); margin-bottom:6px;">
            Valve: <strong>${escapeHtml(valve.label)}</strong> · side: <strong>${info.side}</strong>
          </div>
          <div style="font-size:13px; margin-bottom:6px;">
            This pipe is the <strong>${escapeHtml(myLabel)}</strong> branch.
            <br><span style="color:var(--muted); font-size:12px;">Other branch: ${escapeHtml(otherLabel)}</span>
          </div>
          <div class="field" style="margin-top:6px;"><label>Rename this branch (optional)</label>
            <input id="f-branch-label" placeholder="Auto: ${escapeHtml(myLabel)}" value="${escapeHtml(override)}"/>
          </div>
          <div class="row" style="gap:6px; margin-top:6px;">
            <button class="btn primary" data-action="setBranchLabel" data-valve-id="${valve.id}">Save name</button>
            <button class="btn" data-action="setBranchLabel" data-valve-id="${valve.id}" data-clear="1">Use auto name</button>
          </div>
          <p style="color:var(--muted); font-size:12px; margin-top:8px;">Tip: open the valve in the Selected tab and pick “Open to ${escapeHtml(myLabel)}” to route flow this way.</p>
        </div>`;
      break;
    }
  }

  const editPanel = editing ? `
    <div class="panel" style="border:2px solid var(--accent);">
      <h3>Editing pipe</h3>
      <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(getItem(editing.from)?.label||'?')} → ${escapeHtml(getItem(editing.to)?.label||'?')}</div>
      <div class="row tight">
        <div class="field"><label>Type</label>
          <select id="edge-type">
            ${Object.entries(PIPE_TYPES).map(([k, v]) => `<option ${editing.type===k?'selected':''} value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Main size</label>
          <select id="edge-size">
            ${PIPE_SIZES.map(s => `<option ${editing.size===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Route style</label>
        <select id="edge-route">
          <option ${(editing.routeStyle||'auto')==='auto'?'selected':''} value="auto">Auto (90° L)</option>
          <option ${editing.routeStyle==='45'?'selected':''} value="45">45° diagonal</option>
          <option ${editing.routeStyle==='manual'?'selected':''} value="manual">Manual waypoints (90°)</option>
          <option ${editing.routeStyle==='straight'?'selected':''} value="straight">Straight (as the crow flies)</option>
        </select>
      </div>
      <div class="row tight" style="margin-top:8px;">
        <div class="field"><label>Reducer at start</label>
          <select id="edge-from-size">
            <option value="">— same as main —</option>
            ${PIPE_SIZES.map(s => `<option ${editing.fromSize===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Reducer at end</label>
          <select id="edge-to-size">
            <option value="">— same as main —</option>
            ${PIPE_SIZES.map(s => `<option ${editing.toSize===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Tap on the pipe in the canvas to add a 90° bend at that point. Long-press a bend handle to delete it.</p>
      <div class="row" style="margin-top:8px;">
        <button class="btn primary" data-action="applyEdge">Apply</button>
        <button class="btn" data-action="flipEdge">Reverse arrow</button>
        <button class="btn" data-action="clearWaypoints">Clear bends</button>
        <button class="btn" data-action="stopEditEdge">Done</button>
      </div>
    </div>${portPanel}` : '';

  return `
    ${editPanel}
    <div class="panel">
      <h3>Pipe to draw</h3>
      <div class="row tight">
        <div class="field"><label>Type</label>
          <select id="pipe-type">
            ${Object.entries(PIPE_TYPES).map(([k, v]) => `<option ${p.type===k?'selected':''} value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Size</label>
          <select id="pipe-size">
            ${PIPE_SIZES.map(s => `<option ${p.size===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Route style for new pipes</label>
        <select id="pipe-route">
          <option ${routeStyle==='auto'?'selected':''} value="auto">Auto (90° L)</option>
          <option ${routeStyle==='45'?'selected':''} value="45">45° diagonal</option>
          <option ${routeStyle==='manual'?'selected':''} value="manual">Manual (start with no bends, tap to add)</option>
          <option ${routeStyle==='straight'?'selected':''} value="straight">Straight (no bends)</option>
        </select>
      </div>
      <button class="btn primary full" style="margin-top:12px;" data-action="connectMode">
        Start tap-to-connect
      </button>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Tap two parts in order. Tap on a pipe to drop into it (auto-inserts a tee). Long-press a valve to flip it.</p>
    </div>

    <div class="panel">
      <h3>Existing pipes (${state.edges.length})</h3>
      ${state.edges.length === 0 ? `<p style="color:var(--muted);">No connections yet.</p>` :
        state.edges.map(e => {
          const a = getItem(e.from), b = getItem(e.to); if (!a||!b) return '';
          const t = PIPE_TYPES[e.type] || {};
          const reducerNote = (e.fromSize && e.fromSize!==e.size) || (e.toSize && e.toSize!==e.size)
            ? ` · reducer${e.fromSize&&e.fromSize!==e.size?' '+e.fromSize+'→'+e.size:''}${e.toSize&&e.toSize!==e.size?' '+e.size+'→'+e.toSize:''}` : '';
          const bends = Array.isArray(e.waypoints) ? e.waypoints.length : 0;
          return `<div class="row-item" style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:10px; margin-bottom:6px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:600;">${escapeHtml(a.label)} → ${escapeHtml(b.label)}</div>
              <div style="color:var(--muted); font-size:12px;">${t.label||e.type} · ${e.size||'—'} · ${e.routeStyle||'auto'}${bends?` · ${bends} bend${bends>1?'s':''}`:''}${reducerNote}${e.active?' · active':''}${e.blocked?' · blocked':''}</div>
            </div>
            <div class="row" style="gap:6px;">
              <button class="btn" data-action="editEdge" data-pid="${e.id}">Edit</button>
              <button class="btn" data-action="deletePipe" data-pid="${e.id}">Delete</button>
            </div>
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
// Length from the actual routed polyline (90s/45s included).
function edgePathLengthPx(edge) {
  return polylineLengthPx(edgeRoutePoints(edge));
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
  const reducers = {}; // key: 'fromSize→toSize' -> count
  const ensureFit = (size) => {
    if (!fitBySize[size]) fitBySize[size] = { elbow90:0, elbow45:0, coupling:0, tee:0, union:0 };
    return fitBySize[size];
  };

  for (const e of state.edges) {
    const pts = edgeRoutePoints(e);
    const ft = pxToFeet(polylineLengthPx(pts));
    const typeLabel = (PIPE_TYPES[e.type]?.label) || e.type;
    const size = e.size || '—';
    const key = typeLabel + '|' + size;
    if (!pipeByKey[key]) pipeByKey[key] = { typeLabel, size, ft:0 };
    pipeByKey[key].ft += ft;

    const fit = ensureFit(size);
    // Real corner counts from the routed polyline
    const corners = polylineCorners(pts);
    fit.elbow90 += corners.e90;
    fit.elbow45 += corners.e45;
    fit.coupling += Math.max(0, Math.floor(ft / BOM_RULES.couplingEveryFt));

    // Reducer bushings on this edge if fromSize/toSize differ from line size
    if (e.fromSize && e.fromSize !== size) {
      const k = e.fromSize + ' × ' + size; // e.g. 4" x 2"
      reducers[k] = (reducers[k] || 0) + 1;
    }
    if (e.toSize && e.toSize !== size) {
      const k = size + ' × ' + e.toSize;
      reducers[k] = (reducers[k] || 0) + 1;
    }
  }

  const adj = {};
  state.items.forEach(i => adj[i.id] = { in:[], out:[] });
  state.edges.forEach(e => { if (adj[e.from]) adj[e.from].out.push(e); if (adj[e.to]) adj[e.to].in.push(e); });
  for (const item of state.items) {
    if (item.type === 'tee') {
      // Tee size = the size of the run it sits on. Branch reducers counted via fromSize/toSize on attached edges.
      const connected = [...(adj[item.id]?.in||[]), ...(adj[item.id]?.out||[])];
      const sizes = connected.map(e => e.size).filter(Boolean);
      const s = sizes[0] || '—';
      ensureFit(s).tee += 1;
      // If a branch off the tee has a different size, count a reducer on the branch
      const runSizes = sizes.filter(x => x);
      const distinct = [...new Set(runSizes)];
      if (distinct.length > 1) {
        // bushing for each distinct branch != main
        distinct.slice(1).forEach(b => {
          const k = s + ' × ' + b;
          reducers[k] = (reducers[k] || 0) + 1;
        });
      }
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

  // Spillover features (gravity — body to body)
  const spillovers = [];
  for (const item of state.items) {
    if ((item.type !== 'pool' && item.type !== 'spa') || !item.spillsInto) continue;
    const tgt = getItem(item.spillsInto);
    if (!tgt) continue;
    const featLabel = SPILL_FEATURE_LABEL[item.spillFeature] || 'Spillover';
    spillovers.push({
      from: item.label,
      fromType: item.type,
      to: tgt.label,
      toType: tgt.type,
      feature: featLabel,
      width: item.spillWidth || '',
      qty: Math.max(1, item.spillQty || 1),
    });
  }

  return { pipeList, fitBySize, equipment, valves, fixtures, reducers, spillovers };
}

function renderTakeoff() {
  const bom = computeBOM();
  const { pipeList, fitBySize, equipment, valves, fixtures, reducers, spillovers } = bom;

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

  const reducerRows = Object.keys(reducers || {}).length
    ? Object.entries(reducers).sort().map(([k,v]) => `<div class="row-item"><span>${escapeHtml(k)} reducer bushing</span><span class="qty">${v}</span></div>`).join('')
    : `<div class="row-item">No reducer bushings needed.</div>`;

  const spillRows = (spillovers || []).length
    ? spillovers.map(s => `<div class="row-item"><span>${escapeHtml(s.from)} → ${escapeHtml(s.to)}<br><span style="color:var(--muted); font-size:12px;">${escapeHtml(s.feature)}${s.width?(' · '+escapeHtml(s.width)):''}</span></span><span class="qty">${s.qty}×</span></div>`).join('')
    : `<div class="row-item">No spillovers configured. Open a Pool or Spa in the Selected tab to add one.</div>`;

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
      <h3>Reducer bushings</h3>
      <div class="takeoff-list">${reducerRows}</div>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Counted from pipe reducer settings (fromSize / toSize) and from tee branches that change size.</p>
    </div>
    <div class="panel">
      <h3>Spillovers (gravity flow)</h3>
      <div class="takeoff-list">${spillRows}</div>
      <p style="color:var(--muted); font-size:12px; margin-top:8px;">Spillovers are configured on each Pool/Spa (Selected tab). They model water moving by gravity between bodies and add the feature to the parts order.</p>
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
  const pipeType = $('pipe-type'), pipeSize = $('pipe-size'), pipeRoute = $('pipe-route');
  if (pipeType) pipeType.onchange = () => { state.pendingPipe.type = pipeType.value; persist(); };
  if (pipeSize) pipeSize.onchange = () => { state.pendingPipe.size = pipeSize.value; persist(); };
  if (pipeRoute) pipeRoute.onchange = () => { state.pendingPipe.routeStyle = pipeRoute.value; persist(); };
}

function doAction(name, btn) {
  switch(name) {
    case 'applySelected': {
      const item = getItem(state.selectedId); if (!item) return;
      pushUndo();
      item.label = $('f-label')?.value || item.label;
      item.size  = $('f-size')?.value || '';
      const newRel = $('f-relation')?.value || '';
      item.relation = newRel;
      // User picked something explicit — lock it (or clear lock if they reset to none)
      item.relationLocked = !!newRel;
      item.relationAuto = false;
      if ($('f-valve')) item.valveState = $('f-valve').value || '';
      if ($('f-spillsInto')) {
        item.spillsInto   = $('f-spillsInto').value || '';
        item.spillFeature = $('f-spillFeature')?.value || '';
        item.spillWidth   = $('f-spillWidth')?.value || '';
        item.spillQty     = Math.max(1, parseInt($('f-spillQty')?.value || '1', 10) || 1);
      }
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
      syncSelectedPanel();
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
      if (state.editingEdgeId === pid) state.editingEdgeId = null;
      solveFlow(); persist(); renderSheet(); drawEdges(); break;
    }
    case 'editEdge': {
      state.editingEdgeId = btn.dataset.pid;
      drawEdges(); renderSheet();
      toast('Tap on the pipe to add a bend');
      break;
    }
    case 'stopEditEdge': {
      state.editingEdgeId = null;
      drawEdges(); renderSheet();
      break;
    }
    case 'clearWaypoints': {
      const e = state.edges.find(x => x.id === state.editingEdgeId);
      if (!e) break;
      pushUndo();
      e.waypoints = [];
      drawEdges(); persist(); renderSheet();
      toast('Bends cleared');
      break;
    }
    case 'flipEdge': {
      const e = state.edges.find(x => x.id === state.editingEdgeId);
      if (!e) break;
      pushUndo();
      // Swap endpoints, reverse waypoints, swap reducer ends, and refresh label.
      const from = e.from, to = e.to;
      e.from = to; e.to = from;
      if (Array.isArray(e.waypoints)) e.waypoints = [...e.waypoints].reverse();
      const fs = e.fromSize || '', ts = e.toSize || '';
      e.fromSize = ts; e.toSize = fs;
      e.label = `${getItem(e.from)?.label || '?'} → ${getItem(e.to)?.label || '?'}`;
      // Branch labels on 3-way valves are keyed by edge.id (unchanged), so they
      // automatically still apply to the (now-reversed) pipe.
      drawEdges(); solveFlow(); persist(); renderSheet();
      toast('Arrow flipped');
      break;
    }
    case 'setBranchLabel': {
      const e = state.edges.find(x => x.id === state.editingEdgeId);
      if (!e) break;
      const valveId = btn.dataset.valveId;
      const valve = getItem(valveId);
      if (!valve) break;
      pushUndo();
      valve.branchLabels = valve.branchLabels || {};
      if (btn.dataset.clear === '1') {
        delete valve.branchLabels[e.id];
        toast('Using auto name');
      } else {
        const name = ($('f-branch-label')?.value || '').trim();
        if (name) { valve.branchLabels[e.id] = name; toast('Branch renamed'); }
        else { delete valve.branchLabels[e.id]; toast('Using auto name'); }
      }
      drawEdges(); solveFlow(); persist(); renderSheet();
      break;
    }
    case 'applyEdge': {
      const e = state.edges.find(x => x.id === state.editingEdgeId);
      if (!e) break;
      const t = $('edge-type')?.value;
      // Validate user-picked pipe type against endpoint roles before mutating.
      if (t && isHydraulicPipe(t)) {
        const itemById = {}; state.items.forEach(i => itemById[i.id] = i);
        const fromRole = resolveEndRole(e, 'from', state, itemById);
        const toRole   = resolveEndRole(e, 'to',   state, itemById);
        const conflict = (fromRole && fromRole !== t) || (toRole && toRole !== t);
        if (conflict) {
          const why = (fromRole && fromRole !== t) ? fromRole : toRole;
          toast(`Can't set this pipe to ${t} — it connects to a ${why} fixture`);
          break;
        }
      }
      pushUndo();
      if (t) e.type = t;
      const sz = $('edge-size')?.value; if (sz) e.size = sz;
      const r = $('edge-route')?.value; if (r) e.routeStyle = r;
      e.fromSize = $('edge-from-size')?.value || '';
      e.toSize = $('edge-to-size')?.value || '';
      // Re-propagate in case this edge change unlocks/locks neighbors.
      propagatePipeTypes(state);
      drawEdges(); solveFlow(); persist(); renderSheet();
      toast('Pipe updated');
      break;
    }
    case 'connectMode': startConnectMode(); break;
    case 'setValveState': {
      const targetId = btn.dataset.itemId;
      const next     = btn.dataset.state;
      const item = getItem(targetId);
      if (!item) break;
      if (item.type === 'valve3') {
        const port = next === 'pos1' ? 'a' : next === 'pos2' ? 'b' : 'trunk';
        setValve3ByPort(item, port);
      } else if (item.type === 'valve2' || item.type === 'actuated') {
        if (item.valveState === next) break;
        pushUndo();
        item.valveState = next;
        refreshItem(item); solveFlow(); persist(); drawEdges();
        syncSelectedPanel();
        toast(`${item.label}: ${next}`);
      }
      break;
    }
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

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Spillovers (gravity flow)', 32, 36);
  doc.setFontSize(9); doc.setTextColor(120); doc.text('Body-to-body spillovers — not pumped. Driven by water level difference.', 32, 50);
  doc.setTextColor(0); doc.setFontSize(10); y = 70;
  const spills = bom.spillovers || [];
  if (!spills.length) {
    doc.text('• No spillovers configured.', 32, y); y += 14;
  } else {
    spills.forEach(s => {
      const sizeBit = s.width ? ' (' + s.width + ')' : '';
      doc.text(`• ${s.qty} × ${s.feature}${sizeBit}  —  ${s.from} → ${s.to}`, 32, y);
      y += 14; if (y>540){doc.addPage();y=36;}
    });
  }

  doc.addPage(); doc.setFontSize(16); doc.text('Bill of Materials — Reducer Bushings', 32, 36);
  doc.setFontSize(9); doc.setTextColor(120); doc.text('Counted from per-pipe reducer settings and tee branches that change size.', 32, 50);
  doc.setTextColor(0); doc.setFontSize(10); y = 70;
  const reducerEntries = Object.entries(bom.reducers || {}).sort();
  if (!reducerEntries.length) {
    doc.text('• No reducer bushings needed.', 32, y); y += 14;
  } else {
    reducerEntries.forEach(([k,v]) => {
      doc.text(`• ${v} × ${k} reducer bushing`, 32, y);
      y += 14; if (y>540){doc.addPage();y=36;}
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

  // spillovers (drawn under pipes)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const item of state.items) {
    if ((item.type !== 'pool' && item.type !== 'spa') || !item.spillsInto) continue;
    const tgt = getItem(item.spillsInto); if (!tgt) continue;
    const a0 = nearestEdgePoint(item, tgt);
    const b0 = nearestEdgePoint(tgt, item);
    const a = { x: a0.x + ox, y: a0.y + oy };
    const b = { x: b0.x + ox, y: b0.y + oy };
    ctx.strokeStyle = '#2eb6ff'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]);
    ctx.beginPath();
    const len = Math.hypot(b.x-a.x, b.y-a.y);
    const ux = (b.x-a.x)/len, uy = (b.y-a.y)/len, nx = -uy, ny = ux;
    const steps = Math.max(4, Math.floor(len / 18));
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + ux * len * t;
      const py = a.y + uy * len * t;
      const off = Math.sin(t * Math.PI * steps / 2) * 8 * ((i % 2) ? 1 : -1);
      ctx.lineTo(px + nx * off, py + ny * off);
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead at b
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = '#2eb6ff';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 12*Math.cos(ang-0.4), b.y - 12*Math.sin(ang-0.4));
    ctx.lineTo(b.x - 12*Math.cos(ang+0.4), b.y - 12*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fill();
    // label
    const featLabel = (typeof SPILL_FEATURE_LABEL !== 'undefined' && SPILL_FEATURE_LABEL[item.spillFeature]) || 'Spillover';
    const widthBit = item.spillWidth ? ' · ' + item.spillWidth : '';
    const qtyBit = (item.spillQty && item.spillQty > 1) ? (item.spillQty + '× ') : '';
    ctx.fillStyle = '#0a6e9a'; ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(qtyBit + featLabel + widthBit, (a.x+b.x)/2, (a.y+b.y)/2 - 8);
  }

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
  const vSuc = add('valve3',  { x: 920, y: 320, label:'Suction Valve', valveState:'shared' });
  const pump = add('pump',    { x: 1110, y: 300, label:'Pump', size:'2.5"' });
  const flt  = add('filter',  { x: 1240, y: 300, label:'Filter', size:'2.5"' });
  const htr  = add('heater',  { x: 1370, y: 300, label:'Heater', size:'2.5"' });
  const vRet = add('valve3',  { x: 1510, y: 300, label:'Return Valve', valveState:'shared' });
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

  // Run the port migration over the freshly-built demo so valves & pumps get ports.
  migratePortsOnLoad(state);

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
