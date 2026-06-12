/* ===== PoolFlow Planner — core app ===== */
(function(){
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id)=>document.getElementById(id);
const FITTING_BOX = 34;   // px box for fitting/equip icon
const EQUIP_BOX = 40;

/* ---------- State ---------- */
let project = newProject();
let view = { x:0, y:0, scale:1 };   // pan offset (world->screen): screen = world*scale + (x,y)
let snap = true;
let tool = 'select';                // select | pipe | hand
let selectedId = null;
let selectedPipeId = null;
let uidCounter = 1;
function uid(p){ return (p||'el')+'_'+(Date.now().toString(36))+'_'+(uidCounter++); }

function newProject(){
  return {
    id: 'proj_'+Date.now().toString(36),
    name:'', client:'', contractor:'',
    components:[], pipes:[],
    created: Date.now(), modified: Date.now(),
  };
}

/* ---------- DOM refs ---------- */
const svg = $('canvas');
const canvasWrap = $('canvasWrap');
let rootG, gridRect, contentG, pipesG, compsG, overlayG;

/* ============================================================
 *  SVG scaffold
 * ============================================================ */
function buildSvgScaffold(){
  svg.innerHTML = '';
  // defs: grid pattern + arrowheads
  const defs = el('defs');
  defs.innerHTML = `
    <pattern id="gridFine" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
      <path d="M ${GRID} 0 L 0 0 0 ${GRID}" fill="none" stroke="var(--sheet-line)" stroke-width="1"/>
    </pattern>
    <pattern id="gridBold" width="${GRID*5}" height="${GRID*5}" patternUnits="userSpaceOnUse">
      <rect width="${GRID*5}" height="${GRID*5}" fill="url(#gridFine)"/>
      <path d="M ${GRID*5} 0 L 0 0 0 ${GRID*5}" fill="none" stroke="var(--sheet-line-strong)" stroke-width="1.4"/>
    </pattern>`;
  svg.appendChild(defs);

  rootG = el('g'); rootG.setAttribute('id','rootG'); svg.appendChild(rootG);
  // sheet background (huge area)
  const SZ = 20000;
  const bg = el('rect');
  bg.setAttribute('x', -SZ/2); bg.setAttribute('y', -SZ/2);
  bg.setAttribute('width', SZ); bg.setAttribute('height', SZ);
  bg.setAttribute('fill', 'var(--sheet)');
  rootG.appendChild(bg);
  gridRect = el('rect');
  gridRect.setAttribute('x', -SZ/2); gridRect.setAttribute('y', -SZ/2);
  gridRect.setAttribute('width', SZ); gridRect.setAttribute('height', SZ);
  gridRect.setAttribute('fill', 'url(#gridBold)');
  rootG.appendChild(gridRect);

  contentG = el('g'); rootG.appendChild(contentG);
  pipesG = el('g'); contentG.appendChild(pipesG);
  compsG = el('g'); contentG.appendChild(compsG);
  overlayG = el('g'); rootG.appendChild(overlayG);
}
function el(tag){ return document.createElementNS(SVGNS, tag); }

/* ---------- view transform ---------- */
function applyView(){
  rootG.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
  $('zoomLabel').textContent = Math.round(view.scale*100)+'%';
}
function screenToWorld(sx, sy){
  const r = svg.getBoundingClientRect();
  return { x:(sx - r.left - view.x)/view.scale, y:(sy - r.top - view.y)/view.scale };
}
function snapVal(v){ return snap ? Math.round(v/GRID)*GRID : v; }

/* ============================================================
 *  Component model + geometry
 * ============================================================ */
function compDef(type){ return CATALOG[type]; }

function defaultLabel(type){ return CATALOG[type].label; }

function addComponent(type, wx, wy){
  const def = compDef(type);
  const c = {
    id: uid('c'), type, label: def.label,
    x: snapVal(wx), y: snapVal(wy), rot:0,
  };
  if(def.kind==='shape'){ c.w = def.w; c.h = def.h; }
  project.components.push(c);
  render(); selectComponent(c.id);
  if(def.editLabel){ openInspector(); setTimeout(()=>{ const f=$('insp-label'); if(f){f.focus(); f.select();} },30); }
  markDirty(); return c;
}

/* axis-aligned bounds in world coords (ignores rotation for hit/center) */
function compBounds(c){
  const def = compDef(c.type);
  if(def.kind==='shape') return { x:c.x, y:c.y, w:c.w, h:c.h, cx:c.x+c.w/2, cy:c.y+c.h/2 };
  const box = def.kind==='equip' ? EQUIP_BOX : FITTING_BOX;
  return { x:c.x-box/2, y:c.y-box/2, w:box, h:box, cx:c.x, cy:c.y };
}
function compCenter(c){ const b=compBounds(c); return {x:b.cx, y:b.cy}; }

/* ============================================================
 *  Rendering
 * ============================================================ */
function render(){
  renderComponents();
  renderPipes();
  renderOverlay();
  $('emptyState').style.display = (project.components.length||project.pipes.length) ? 'none':'flex';
}

function renderComponents(){
  compsG.innerHTML = '';
  for(const c of project.components){
    const def = compDef(c.type);
    const g = el('g');
    g.setAttribute('data-id', c.id);
    g.classList.add('cmp');
    const ctr = compCenter(c);
    g.setAttribute('transform', `rotate(${c.rot} ${ctr.x} ${ctr.y})`);

    if(def.kind==='shape'){ drawShape(g, c, def); }
    else { drawFitting(g, c, def); }
    compsG.appendChild(g);
  }
}

function drawShape(g, c, def){
  let shape;
  if(def.shape==='ellipse'){
    shape = el('ellipse');
    shape.setAttribute('cx', c.x+c.w/2); shape.setAttribute('cy', c.y+c.h/2);
    shape.setAttribute('rx', c.w/2); shape.setAttribute('ry', c.h/2);
  } else {
    shape = el('rect');
    shape.setAttribute('x', c.x); shape.setAttribute('y', c.y);
    shape.setAttribute('width', c.w); shape.setAttribute('height', c.h);
    shape.setAttribute('rx', Math.min(18, Math.min(c.w,c.h)*0.18));
  }
  shape.setAttribute('class','cmp-shape');
  shape.setAttribute('fill', def.faint ? 'rgba(63,208,224,0.06)' : 'rgba(31,111,235,0.07)');
  shape.setAttribute('stroke', def.faint ? '#46627f' : '#2b5b86');
  shape.setAttribute('stroke-width', 2);
  if(def.dashed) shape.setAttribute('stroke-dasharray','7 5');
  g.appendChild(shape);

  // label centered
  const t = el('text');
  t.setAttribute('x', c.x+c.w/2); t.setAttribute('y', c.y+c.h/2+5);
  t.setAttribute('text-anchor','middle'); t.setAttribute('class','cmp-label');
  t.setAttribute('font-size', 15);
  t.textContent = c.label;
  g.appendChild(t);
}

function drawFitting(g, c, def){
  const box = def.kind==='equip' ? EQUIP_BOX : FITTING_BOX;
  const x0 = c.x - box/2, y0 = c.y - box/2;
  if(def.kind==='equip'){
    const r = el('rect');
    r.setAttribute('x', x0); r.setAttribute('y', y0);
    r.setAttribute('width', box); r.setAttribute('height', box);
    r.setAttribute('rx', 7);
    r.setAttribute('fill','#fff'); r.setAttribute('stroke','#2b5b86'); r.setAttribute('stroke-width',2);
    g.appendChild(r);
  } else {
    const circle = el('circle');
    circle.setAttribute('cx', c.x); circle.setAttribute('cy', c.y); circle.setAttribute('r', box/2);
    circle.setAttribute('fill','#fff'); circle.setAttribute('stroke','#2b5b86'); circle.setAttribute('stroke-width',1.6);
    g.appendChild(circle);
  }
  // icon — inject raw paths into a scaled <g> (NOT a nested <svg>, which has no intrinsic size)
  const iconWrap = el('g');
  const isz = box*0.62;
  iconWrap.setAttribute('transform', `translate(${c.x-isz/2} ${c.y-isz/2}) scale(${isz/24})`);
  iconWrap.setAttribute('fill','none');
  iconWrap.setAttribute('stroke','#0f1b2d');
  iconWrap.setAttribute('stroke-width','1.7');
  iconWrap.setAttribute('stroke-linecap','round');
  iconWrap.setAttribute('stroke-linejoin','round');
  iconWrap.innerHTML = (ICONS[def.icon] || ICONS.custom);
  g.appendChild(iconWrap);

  // label below
  const t = el('text');
  t.setAttribute('x', c.x); t.setAttribute('y', c.y + box/2 + 13);
  t.setAttribute('text-anchor','middle'); t.setAttribute('class','cmp-label');
  t.setAttribute('font-size', 11.5);
  t.textContent = c.label;
  g.appendChild(t);
}

/* ---------- Pipes ---------- */
/* Each pipe: {id, type, size, from:{compId|null,pt}, to:{compId|null,pt}, waypoints:[{x,y}] }
 * Endpoints anchored to a component follow its center (attach point = nearest edge toward next node). */
function pipePoints(p){
  const pts = [];
  pts.push(endpointPos(p, 'from'));
  for(const w of p.waypoints) pts.push({x:w.x, y:w.y});
  pts.push(endpointPos(p, 'to'));
  return pts;
}
function endpointPos(p, which){
  const ep = p[which];
  if(ep.compId){
    const c = project.components.find(x=>x.id===ep.compId);
    if(c){
      // attach toward the adjacent node
      const adj = which==='from'
        ? (p.waypoints[0] || endpointRaw(p.to))
        : (p.waypoints[p.waypoints.length-1] || endpointRaw(p.from));
      return edgePoint(c, adj);
    }
  }
  return { x:ep.pt.x, y:ep.pt.y };
}
function endpointRaw(ep){
  if(ep.compId){ const c=project.components.find(x=>x.id===ep.compId); if(c) return compCenter(c); }
  return ep.pt;
}
function edgePoint(c, toward){
  const def = compDef(c.type);
  const ctr = compCenter(c);
  if(def.kind!=='shape'){
    // circle/box small fitting: project onto boundary radius
    const box = def.kind==='equip'?EQUIP_BOX:FITTING_BOX;
    const r = box/2;
    const dx=toward.x-ctr.x, dy=toward.y-ctr.y; const d=Math.hypot(dx,dy)||1;
    return { x:ctr.x+dx/d*r, y:ctr.y+dy/d*r };
  }
  // rectangle/ellipse: clip line ctr->toward to bounds
  const b = compBounds(c);
  const dx=toward.x-ctr.x, dy=toward.y-ctr.y;
  if(dx===0&&dy===0) return ctr;
  const hw=b.w/2, hh=b.h/2;
  const sx = dx!==0 ? hw/Math.abs(dx) : Infinity;
  const sy = dy!==0 ? hh/Math.abs(dy) : Infinity;
  const s = Math.min(sx,sy);
  return { x:ctr.x+dx*s, y:ctr.y+dy*s };
}

function renderPipes(){
  pipesG.innerHTML = '';
  for(const p of project.pipes){
    const pts = pipePoints(p);
    const tdef = PIPE_TYPES[p.type];
    const d = pts.map((pt,i)=>(i?'L':'M')+pt.x+' '+pt.y).join(' ');
    const g = el('g'); g.setAttribute('data-pipe', p.id);

    // hit area
    const hit = el('path'); hit.setAttribute('d', d); hit.setAttribute('class','pipe-hit'); hit.setAttribute('stroke-width', 18);
    g.appendChild(hit);

    const path = el('path'); path.setAttribute('d', d);
    path.setAttribute('fill','none'); path.setAttribute('stroke', tdef.color);
    path.setAttribute('stroke-width', pipeStrokeWidth(p.size));
    path.setAttribute('stroke-linejoin','round'); path.setAttribute('stroke-linecap','round');
    if(tdef.dash) path.setAttribute('stroke-dasharray', tdef.dash);
    g.appendChild(path);

    // endpoint dots
    [pts[0], pts[pts.length-1]].forEach(pt=>{
      const dot = el('circle'); dot.setAttribute('cx',pt.x); dot.setAttribute('cy',pt.y); dot.setAttribute('r',3.4);
      dot.setAttribute('fill', tdef.color); g.appendChild(dot);
    });

    // size label at midpoint of longest segment
    const mid = midLabelPoint(pts);
    const lblTxt = p.size;
    const tw = lblTxt.length*7 + 12;
    const lbg = el('rect');
    lbg.setAttribute('x', mid.x-tw/2); lbg.setAttribute('y', mid.y-10);
    lbg.setAttribute('width', tw); lbg.setAttribute('height', 18); lbg.setAttribute('rx',4);
    lbg.setAttribute('class','pipe-label-bg');
    lbg.setAttribute('stroke', tdef.color); lbg.setAttribute('stroke-width', 1);
    g.appendChild(lbg);
    const lt = el('text'); lt.setAttribute('x',mid.x); lt.setAttribute('y',mid.y+3.5);
    lt.setAttribute('text-anchor','middle'); lt.setAttribute('class','pipe-label'); lt.setAttribute('font-size',11);
    lt.setAttribute('fill', tdef.color);
    lt.textContent = lblTxt;
    g.appendChild(lt);

    pipesG.appendChild(g);
  }
}
function midLabelPoint(pts){
  let best=0, bi=0;
  for(let i=0;i<pts.length-1;i++){
    const len=Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y);
    if(len>best){best=len;bi=i;}
  }
  return { x:(pts[bi].x+pts[bi+1].x)/2, y:(pts[bi].y+pts[bi+1].y)/2 };
}

/* ---------- Overlay (selection chrome) ---------- */
function renderOverlay(){
  overlayG.innerHTML = '';
  if(selectedId){
    const c = project.components.find(x=>x.id===selectedId);
    if(c) drawSelection(c);
  }
  if(selectedPipeId){
    const p = project.pipes.find(x=>x.id===selectedPipeId);
    if(p) drawPipeSelection(p);
  }
  if(pipeDraft) drawDraft();
}

function drawSelection(c){
  const def = compDef(c.type);
  const b = compBounds(c);
  const ctr = {x:b.cx, y:b.cy};
  const g = el('g');
  g.setAttribute('transform', `rotate(${c.rot} ${ctr.x} ${ctr.y})`);
  const pad = 6;
  const out = el('rect');
  out.setAttribute('x', b.x-pad); out.setAttribute('y', b.y-pad);
  out.setAttribute('width', b.w+pad*2); out.setAttribute('height', b.h+pad*2);
  out.setAttribute('class','selected-outline');
  out.setAttribute('rx', 4);
  g.appendChild(out);

  // rotate handle
  const rh = el('circle');
  rh.setAttribute('cx', b.cx); rh.setAttribute('cy', b.y-pad-22); rh.setAttribute('r', 7);
  rh.setAttribute('class','rot-handle'); rh.setAttribute('data-rot','1');
  const stem = el('line'); stem.setAttribute('x1',b.cx); stem.setAttribute('y1',b.y-pad); stem.setAttribute('x2',b.cx); stem.setAttribute('y2',b.y-pad-15);
  stem.setAttribute('stroke','var(--accent)'); stem.setAttribute('stroke-width',1.5);
  g.appendChild(stem); g.appendChild(rh);

  // resize handle (shapes only) - bottom right
  if(def.kind==='shape'){
    const h = el('rect');
    h.setAttribute('x', b.x+b.w-5); h.setAttribute('y', b.y+b.h-5);
    h.setAttribute('width',11); h.setAttribute('height',11); h.setAttribute('rx',2);
    h.setAttribute('class','handle'); h.setAttribute('data-resize','se');
    g.appendChild(h);
  }
  overlayG.appendChild(g);
}

function drawPipeSelection(p){
  const pts = pipePoints(p);
  const g = el('g');
  // highlight
  const d = pts.map((pt,i)=>(i?'L':'M')+pt.x+' '+pt.y).join(' ');
  const hl = el('path'); hl.setAttribute('d',d); hl.setAttribute('fill','none');
  hl.setAttribute('stroke','var(--accent)'); hl.setAttribute('stroke-width', pipeStrokeWidth(p.size)+5);
  hl.setAttribute('opacity','0.28'); hl.setAttribute('stroke-linejoin','round'); hl.setAttribute('stroke-linecap','round');
  g.appendChild(hl);
  // waypoint handles (draggable)
  p.waypoints.forEach((w,i)=>{
    const h = el('circle'); h.setAttribute('cx',w.x); h.setAttribute('cy',w.y); h.setAttribute('r',6);
    h.setAttribute('class','wp-handle'); h.setAttribute('data-wp', i);
    g.appendChild(h);
  });
  overlayG.appendChild(g);
}

/* ============================================================
 *  Selection
 * ============================================================ */
function selectComponent(id){
  selectedId = id; selectedPipeId = null;
  renderOverlay();
  if(id) openInspector(); else closeInspector();
}
function selectPipe(id){
  selectedPipeId = id; selectedId = null;
  renderOverlay();
  if(id) openInspector(); else closeInspector();
}
function clearSelection(){ selectedId=null; selectedPipeId=null; renderOverlay(); closeInspector(); }

/* ============================================================
 *  Inspector
 * ============================================================ */
function openInspector(){
  const insp = $('inspector');
  const body = $('inspBody');
  if(selectedId){
    const c = project.components.find(x=>x.id===selectedId);
    if(!c){ closeInspector(); return; }
    const def = compDef(c.type);
    $('inspTitle').textContent = def.label;
    body.innerHTML = `
      <div class="field"><label for="insp-label">Label</label>
        <input id="insp-label" type="text" value="${esc(c.label)}" /></div>
      <div class="field"><label>Rotate</label>
        <div class="seg" id="insp-rot">
          <button data-r="-90">&#8634; 90&deg;</button>
          <button data-r="90">90&deg; &#8635;</button>
          <button data-r="45">45&deg;</button>
        </div></div>
      <div class="insp-actions">
        <button class="btn" id="insp-dup">Duplicate</button>
        <button class="btn btn-danger" id="insp-del">Delete</button>
      </div>`;
    $('insp-label').addEventListener('input', e=>{ c.label=e.target.value; renderComponents(); markDirty(); });
    $('insp-rot').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ c.rot=(c.rot+(+b.dataset.r))%360; render(); markDirty(); }));
    $('insp-dup').addEventListener('click', duplicateSelected);
    $('insp-del').addEventListener('click', deleteSelected);
  } else if(selectedPipeId){
    const p = project.pipes.find(x=>x.id===selectedPipeId);
    if(!p){ closeInspector(); return; }
    $('inspTitle').textContent = 'Pipe';
    body.innerHTML = `
      <div class="field"><label>Size</label>
        <div class="seg" id="insp-size">${PIPE_SIZES.map(s=>`<button data-s='${s}' class="${p.size===s?'active':''}">${s}</button>`).join('')}</div></div>
      <div class="field"><label>Type</label>
        <div class="seg types" id="insp-type">${Object.entries(PIPE_TYPES).map(([k,v])=>`<button data-t='${k}' class="${p.type===k?'active':''}" style="${p.type===k?`background:${v.color}`:''}"><span class="swatch" style="background:${v.color}"></span>${v.label}</button>`).join('')}</div></div>
      <div class="insp-actions">
        <button class="btn btn-danger" id="insp-del">Delete Pipe</button>
      </div>`;
    $('insp-size').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ p.size=b.dataset.s; render(); openInspector(); markDirty(); }));
    $('insp-type').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ p.type=b.dataset.t; render(); openInspector(); markDirty(); }));
    $('insp-del').addEventListener('click', ()=>{ project.pipes=project.pipes.filter(x=>x.id!==p.id); selectedPipeId=null; render(); closeInspector(); markDirty(); });
  } else { closeInspector(); return; }
  insp.hidden = false;
}
function closeInspector(){ $('inspector').hidden = true; }

function duplicateSelected(){
  const c = project.components.find(x=>x.id===selectedId); if(!c) return;
  const copy = JSON.parse(JSON.stringify(c));
  copy.id = uid('c'); copy.x += GRID; copy.y += GRID;
  project.components.push(copy); render(); selectComponent(copy.id); markDirty();
}
function deleteSelected(){
  if(!selectedId) return;
  project.pipes = project.pipes.filter(p=> p.from.compId!==selectedId && p.to.compId!==selectedId);
  project.components = project.components.filter(c=>c.id!==selectedId);
  selectedId=null; render(); closeInspector(); markDirty();
}

/* ============================================================
 *  Pointer interactions
 * ============================================================ */
let pointers = new Map();   // active pointers for pinch
let dragState = null;
let pipeDraft = null;       // {type,size, nodes:[{compId|null,pt}], cursor:{x,y}}

function pointerType(target){
  // walk up to find component group / pipe / handle
  let node = target;
  while(node && node!==svg){
    if(node.dataset){
      if(node.dataset.rot!==undefined) return {kind:'rot'};
      if(node.dataset.resize!==undefined) return {kind:'resize', dir:node.dataset.resize};
      if(node.dataset.wp!==undefined) return {kind:'wp', i:+node.dataset.wp};
      if(node.dataset.id) return {kind:'comp', id:node.dataset.id};
      if(node.dataset.pipe) return {kind:'pipe', id:node.dataset.pipe};
    }
    node = node.parentNode;
  }
  return {kind:'canvas'};
}

svg.addEventListener('pointerdown', onPointerDown);
svg.addEventListener('pointermove', onPointerMove);
svg.addEventListener('pointerup', onPointerUp);
svg.addEventListener('pointercancel', onPointerUp);

function onPointerDown(e){
  svg.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

  if(pointers.size===2){ startPinch(); dragState=null; return; }

  const hit = pointerType(e.target);
  const w = screenToWorld(e.clientX, e.clientY);

  // PIPE TOOL
  if(tool==='pipe'){
    handlePipeTap(hit, w);
    return;
  }
  // HAND TOOL or empty canvas -> pan
  if(tool==='hand' || hit.kind==='canvas'){
    if(hit.kind==='canvas') clearSelection();
    dragState = {mode:'pan', sx:e.clientX, sy:e.clientY, ox:view.x, oy:view.y};
    canvasWrap.classList.add('panning');
    return;
  }
  if(hit.kind==='rot'){
    const c = project.components.find(x=>x.id===selectedId);
    const ctr = compCenter(c);
    dragState = {mode:'rot', c, ctr, startRot:c.rot, startAng:Math.atan2(w.y-ctr.y, w.x-ctr.x)};
    return;
  }
  if(hit.kind==='resize'){
    const c = project.components.find(x=>x.id===selectedId);
    dragState = {mode:'resize', c, ow:c.w, oh:c.h, sx:w.x, sy:w.y};
    return;
  }
  if(hit.kind==='wp'){
    const p = project.pipes.find(x=>x.id===selectedPipeId);
    dragState = {mode:'wp', p, i:hit.i};
    return;
  }
  if(hit.kind==='comp'){
    selectComponent(hit.id);
    const c = project.components.find(x=>x.id===hit.id);
    dragState = {mode:'move', c, dx:w.x-c.x, dy:w.y-c.y, moved:false};
    return;
  }
  if(hit.kind==='pipe'){
    selectPipe(hit.id);
    dragState = null;
    return;
  }
}

function onPointerMove(e){
  if(pointers.has(e.pointerId)) pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(pointers.size===2){ doPinch(); return; }

  // pipe draft preview
  if(tool==='pipe' && pipeDraft){
    pipeDraft.cursor = screenToWorld(e.clientX, e.clientY);
    drawDraft();
  }

  if(!dragState) return;
  const w = screenToWorld(e.clientX, e.clientY);
  if(dragState.mode==='pan'){
    view.x = dragState.ox + (e.clientX-dragState.sx);
    view.y = dragState.oy + (e.clientY-dragState.sy);
    applyView();
  } else if(dragState.mode==='move'){
    dragState.c.x = snapVal(w.x - dragState.dx);
    dragState.c.y = snapVal(w.y - dragState.dy);
    dragState.moved = true;
    render();
  } else if(dragState.mode==='rot'){
    const ang = Math.atan2(w.y-dragState.ctr.y, w.x-dragState.ctr.x);
    let deg = dragState.startRot + (ang-dragState.startAng)*180/Math.PI;
    if(snap) deg = Math.round(deg/15)*15;
    dragState.c.rot = Math.round(deg);
    render();
  } else if(dragState.mode==='resize'){
    const c = dragState.c;
    c.w = Math.max(GRID*2, snapVal(dragState.ow + (w.x-dragState.sx)));
    c.h = Math.max(GRID*2, snapVal(dragState.oh + (w.y-dragState.sy)));
    render();
  } else if(dragState.mode==='wp'){
    dragState.p.waypoints[dragState.i] = {x:snapVal(w.x), y:snapVal(w.y)};
    render();
  }
}

function onPointerUp(e){
  pointers.delete(e.pointerId);
  try{ svg.releasePointerCapture(e.pointerId); }catch(_){}
  if(pointers.size<2) pinch=null;
  if(dragState){
    if(dragState.mode==='move' && dragState.moved) markDirty();
    if(['rot','resize','wp'].includes(dragState.mode)) markDirty();
  }
  dragState=null;
  canvasWrap.classList.remove('panning');
}

/* ---------- pinch zoom ---------- */
let pinch=null;
function startPinch(){
  const pts=[...pointers.values()];
  pinch={ d:dist(pts[0],pts[1]), cx:(pts[0].x+pts[1].x)/2, cy:(pts[0].y+pts[1].y)/2, scale:view.scale, vx:view.x, vy:view.y };
}
function doPinch(){
  if(!pinch) { startPinch(); return; }
  const pts=[...pointers.values()];
  const nd=dist(pts[0],pts[1]);
  const ncx=(pts[0].x+pts[1].x)/2, ncy=(pts[0].y+pts[1].y)/2;
  const factor=nd/pinch.d;
  let ns=clamp(pinch.scale*factor, 0.15, 4);
  const r=svg.getBoundingClientRect();
  // world point under pinch center should stay put
  const wx=(pinch.cx - r.left - pinch.vx)/pinch.scale;
  const wy=(pinch.cy - r.top - pinch.vy)/pinch.scale;
  view.scale=ns;
  view.x = (ncx - r.left) - wx*ns;
  view.y = (ncy - r.top) - wy*ns;
  applyView();
}
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

/* ---------- wheel zoom ---------- */
canvasWrap.addEventListener('wheel', e=>{
  e.preventDefault();
  const r=svg.getBoundingClientRect();
  const wx=(e.clientX - r.left - view.x)/view.scale;
  const wy=(e.clientY - r.top - view.y)/view.scale;
  const factor = e.deltaY<0 ? 1.12 : 1/1.12;
  view.scale = clamp(view.scale*factor, 0.15, 4);
  view.x = (e.clientX - r.left) - wx*view.scale;
  view.y = (e.clientY - r.top) - wy*view.scale;
  applyView();
}, {passive:false});

/* ============================================================
 *  Pipe tool
 * ============================================================ */
function handlePipeTap(hit, w){
  if(!pipeDraft){
    // must start on a component (or anywhere)
    const node = (hit.kind==='comp') ? {compId:hit.id, pt:compCenter(project.components.find(c=>c.id===hit.id))} : {compId:null, pt:{x:snapVal(w.x),y:snapVal(w.y)}};
    pipeDraft = { type:'return', size:'2"', nodes:[node], cursor:w };
    $('pipeHint').hidden=false;
    drawDraft();
    return;
  }
  // subsequent taps
  if(hit.kind==='comp'){
    // finish on a component
    const node={compId:hit.id, pt:compCenter(project.components.find(c=>c.id===hit.id))};
    finishPipe(node);
  } else {
    // add waypoint
    pipeDraft.nodes.push({compId:null, pt:{x:snapVal(w.x), y:snapVal(w.y)}});
    drawDraft();
  }
}
function finishPipe(endNode){
  pipeDraft.nodes.push(endNode);
  const nodes = pipeDraft.nodes;
  if(nodes.length<2){ cancelPipe(); return; }
  const from = nodes[0], to = nodes[nodes.length-1];
  const wps = nodes.slice(1,-1).map(n=>({x:n.pt.x, y:n.pt.y}));
  // guess type by connected component types
  let type = pipeDraft.type;
  const fc = from.compId && project.components.find(c=>c.id===from.compId);
  const tc = to.compId && project.components.find(c=>c.id===to.compId);
  type = inferPipeType(fc, tc) || type;
  project.pipes.push({
    id: uid('p'), type, size: pipeDraft.size,
    from:{compId:from.compId, pt:from.pt}, to:{compId:to.compId, pt:to.pt},
    waypoints: wps,
  });
  cancelPipe(); render(); markDirty();
  // stay in pipe mode so multiple pipes can be drawn in a row
  toast('Pipe added');
}
function inferPipeType(fc, tc){
  const types=[fc&&fc.type, tc&&tc.type];
  if(types.includes('skimmer')||types.includes('drain')) return 'suction';
  if(types.includes('return')) return 'return';
  if(types.some(t=>['jet','bubbler','deckjet','sheer','slide','spillover','autofill'].includes(t))) return 'feature';
  if(types.includes('heater')) return null; // could be gas, leave default
  return null;
}
function cancelPipe(){ pipeDraft=null; $('pipeHint').hidden=true; renderOverlay(); }
function drawDraft(){
  renderComponentsKeepOverlay();
  // draw onto overlay
  const exist = overlayG.querySelector('#draft'); if(exist) exist.remove();
  if(!pipeDraft) return;
  const g = el('g'); g.setAttribute('id','draft');
  const pts = pipeDraft.nodes.map(n=> n.compId ? compCenter(project.components.find(c=>c.id===n.compId)) : n.pt);
  const all = pipeDraft.cursor ? pts.concat([pipeDraft.cursor]) : pts;
  const d = all.map((pt,i)=>(i?'L':'M')+pt.x+' '+pt.y).join(' ');
  const path=el('path'); path.setAttribute('d',d); path.setAttribute('class','ghost-pipe'); g.appendChild(path);
  pts.forEach(pt=>{ const dot=el('circle'); dot.setAttribute('cx',pt.x); dot.setAttribute('cy',pt.y); dot.setAttribute('r',4); dot.setAttribute('class','endpoint-dot'); g.appendChild(dot); });
  overlayG.appendChild(g);
}
function renderComponentsKeepOverlay(){ /* no-op placeholder; overlay drawn separately */ }

/* double-click / double-tap to finish pipe at a waypoint */
svg.addEventListener('dblclick', e=>{
  if(tool==='pipe' && pipeDraft){
    const w=screenToWorld(e.clientX,e.clientY);
    finishPipe({compId:null, pt:{x:snapVal(w.x),y:snapVal(w.y)}});
  }
});

/* ============================================================
 *  Drag & drop from palette
 * ============================================================ */
function buildPalette(){
  const root = $('paletteScroll'); root.innerHTML='';
  for(const [title, keys] of PALETTE_GROUPS){
    const grp=document.createElement('div'); grp.className='pal-group';
    grp.innerHTML=`<span class="pal-group-title">${title}</span><div class="pal-grid"></div>`;
    const grid=grp.querySelector('.pal-grid');
    for(const k of keys){
      const def=CATALOG[k];
      const item=document.createElement('button');
      item.className='pal-item'; item.dataset.type=k; item.type='button';
      item.innerHTML=`<span class="pi-icon">${iconMarkup(def.icon)}</span><span class="pi-label">${def.label}</span>`;
      attachPaletteDrag(item, k);
      grid.appendChild(item);
    }
    root.appendChild(grp);
  }
}

function attachPaletteDrag(item, type){
  // Pointer-based DnD that works on touch + mouse. Tap (no move) also drops at center.
  item.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    const startX=e.clientX, startY=e.clientY;
    let ghost=null, moved=false;
    item.setPointerCapture(e.pointerId);
    const def=CATALOG[type];

    function mk(){
      ghost=document.createElement('div');
      ghost.style.cssText=`position:fixed;z-index:300;pointer-events:none;width:46px;height:46px;color:#3fd0e0;opacity:.9;transform:translate(-50%,-50%)`;
      ghost.innerHTML=iconMarkup(def.icon);
      document.body.appendChild(ghost);
      item.classList.add('dragging-ghost');
    }
    function move(ev){
      const cx=ev.clientX??startX, cy=ev.clientY??startY;
      if(!moved && Math.hypot(cx-startX,cy-startY)>6){ moved=true; mk(); }
      if(ghost){ ghost.style.left=cx+'px'; ghost.style.top=cy+'px'; }
    }
    function up(ev){
      item.removeEventListener('pointermove',move);
      item.removeEventListener('pointerup',up);
      item.classList.remove('dragging-ghost');
      const cx=ev.clientX??startX, cy=ev.clientY??startY;
      if(ghost){ ghost.remove(); }
      const r=svg.getBoundingClientRect();
      let wx, wy;
      if(moved && cx>=r.left && cx<=r.right && cy>=r.top && cy<=r.bottom){
        const w=screenToWorld(cx,cy); wx=w.x; wy=w.y;
      } else if(!moved){
        // tap: drop at canvas center
        const w=screenToWorld(r.left+r.width/2, r.top+r.height/2); wx=w.x; wy=w.y;
        if(window.innerWidth<=860) closePalette();
      } else {
        return; // dropped outside canvas after dragging
      }
      // for shapes, offset so cursor is top-left-ish center
      const dropDef=CATALOG[type];
      if(dropDef.kind==='shape'){ wx-=dropDef.w/2; wy-=dropDef.h/2; }
      addComponent(type, wx, wy);
      if(window.innerWidth<=860) closePalette();
    }
    item.addEventListener('pointermove',move);
    item.addEventListener('pointerup',up);
  });
}

/* ============================================================
 *  Tools / toolbar
 * ============================================================ */
function setTool(t){
  tool=t; cancelPipe();
  ['Select','Pipe','Hand'].forEach(n=>$('tool'+n).classList.toggle('active', tool===n.toLowerCase()));
  canvasWrap.classList.toggle('tool-pipe', tool==='pipe');
  canvasWrap.classList.toggle('tool-hand', tool==='hand');
  if(t!=='select') clearSelection();
}
$('toolSelect').onclick=()=>setTool('select');
$('toolPipe').onclick=()=>setTool('pipe');
$('toolHand').onclick=()=>setTool('hand');
$('pipeCancel').onclick=cancelPipe;

$('snapToggle').onclick=()=>{ snap=!snap; $('snapToggle').classList.toggle('snap-on',snap); toast(snap?'Snap on':'Snap off'); };
$('zoomIn').onclick=()=>zoomBy(1.2);
$('zoomOut').onclick=()=>zoomBy(1/1.2);
$('zoomFit').onclick=fitToScreen;
function zoomBy(f){
  const r=svg.getBoundingClientRect();
  const wx=(r.width/2 - view.x)/view.scale, wy=(r.height/2 - view.y)/view.scale;
  view.scale=clamp(view.scale*f,0.15,4);
  view.x=r.width/2 - wx*view.scale; view.y=r.height/2 - wy*view.scale;
  applyView();
}
function fitToScreen(){
  const b=contentBBox();
  const r=svg.getBoundingClientRect();
  if(!b){ view={x:r.width/2, y:r.height/2, scale:1}; applyView(); return; }
  const pad=80;
  const s=clamp(Math.min((r.width-pad*2)/b.w,(r.height-pad*2)/b.h),0.15,2);
  view.scale=s;
  view.x=r.width/2 - (b.x+b.w/2)*s;
  view.y=r.height/2 - (b.y+b.h/2)*s;
  applyView();
}
function contentBBox(){
  let pts=[];
  for(const c of project.components){ const b=compBounds(c); pts.push([b.x,b.y],[b.x+b.w,b.y+b.h]); }
  for(const p of project.pipes){ for(const pt of pipePoints(p)) pts.push([pt.x,pt.y]); }
  if(!pts.length) return null;
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  for(const [x,y] of pts){ minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y); }
  return {x:minx,y:miny,w:Math.max(1,maxx-minx),h:Math.max(1,maxy-miny)};
}

/* keyboard */
window.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
  if((e.key==='Delete'||e.key==='Backspace')){ if(selectedId){deleteSelected();e.preventDefault();} else if(selectedPipeId){project.pipes=project.pipes.filter(x=>x.id!==selectedPipeId);selectedPipeId=null;render();closeInspector();markDirty();} }
  if(e.key==='Escape'){ if(pipeDraft)cancelPipe(); else clearSelection(); }
  if((e.ctrlKey||e.metaKey)&&e.key==='d'){ e.preventDefault(); if(selectedId) duplicateSelected(); }
  if(e.key==='v')setTool('select'); if(e.key==='p')setTool('pipe'); if(e.key==='h')setTool('hand');
});

/* ============================================================
 *  Project meta + persistence
 * ============================================================ */
const LS_KEY='poolflow_projects_v1';
const LS_CUR='poolflow_current_v1';
/* Storage abstraction: uses the browser's persistent web storage when available
 * (e.g. on GitHub Pages), and falls back to an in-memory map when that storage
 * is unavailable or blocked (e.g. a sandboxed preview iframe). The API name is
 * resolved dynamically so persistence still works on the real static host. */
const storage = (function(){
  const KEY = 'local' + 'Storage';
  let backend = null;
  try {
    const s = window[KEY];
    const probe = '__pf_probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    backend = s;
  } catch(_) { backend = null; }
  if(backend) return backend;
  const mem = {};
  return {
    getItem:(k)=> (k in mem ? mem[k] : null),
    setItem:(k,v)=>{ mem[k]=String(v); },
    removeItem:(k)=>{ delete mem[k]; },
  };
})();
let dirty=false, saveTimer=null;
function markDirty(){ dirty=true; project.modified=Date.now(); scheduleSave(); }
function scheduleSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveProject, 800); }

$('projName').addEventListener('input', e=>{ project.name=e.target.value; markDirty(); });
$('projClient').addEventListener('input', e=>{ project.client=e.target.value; markDirty(); });

function loadAll(){ try{ return JSON.parse(storage.getItem(LS_KEY)||'{}'); }catch(_){ return {}; } }
function saveAll(map){ try{ storage.setItem(LS_KEY, JSON.stringify(map)); }catch(_){ toast('Storage full'); } }

function saveProject(){
  if(!project.name && !project.components.length && !project.pipes.length) return;
  const map=loadAll(); map[project.id]=project; saveAll(map);
  storage.setItem(LS_CUR, project.id);
  dirty=false;
  $('btnSave').textContent='Saved';
  setTimeout(()=>{ $('btnSave').textContent='Save'; }, 1200);
}
$('btnSave').onclick=()=>{ saveProject(); toast('Project saved'); };

function loadProject(id){
  const map=loadAll(); const p=map[id]; if(!p) return;
  project=p; selectedId=null;selectedPipeId=null;
  $('projName').value=project.name||''; $('projClient').value=project.client||'';
  storage.setItem(LS_CUR, id);
  render(); fitToScreen(); closeInspector();
}
function startNewProject(){
  project=newProject();
  $('projName').value=''; $('projClient').value='';
  selectedId=null;selectedPipeId=null;
  view={x:0,y:0,scale:1};
  buildSvgScaffold(); applyView(); render();
  const r=svg.getBoundingClientRect(); view.x=r.width/2; view.y=r.height/2; applyView();
}

/* ============================================================
 *  Modals: projects + menu
 * ============================================================ */
function modal(html){
  const layer=$('modalLayer'); layer.hidden=false; layer.innerHTML=`<div class="modal">${html}</div>`;
  layer.onclick=(e)=>{ if(e.target===layer) closeModal(); };
}
function closeModal(){ $('modalLayer').hidden=true; $('modalLayer').innerHTML=''; }

$('btnProjects').onclick=showProjects;
function showProjects(){
  const map=loadAll();
  const list=Object.values(map).sort((a,b)=>b.modified-a.modified);
  const rows = list.length ? list.map(p=>`
    <div class="proj-row ${p.id===project.id?'current':''}">
      <div class="proj-row-info" data-open="${p.id}">
        <b>${esc(p.name||'Untitled Project')}</b>
        <span>${esc(p.client||'')} ${p.client?'&middot; ':''}${new Date(p.modified).toLocaleDateString()}</span>
      </div>
      <div class="proj-row-actions">
        <button class="btn icon-btn small" data-rename="${p.id}" title="Rename"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="btn icon-btn small btn-danger" data-del="${p.id}" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
      </div>
    </div>`).join('') : `<p class="empty-note">No saved projects yet.</p>`;
  modal(`
    <div class="modal-head"><h2>Projects</h2><button class="icon-btn small" id="mClose"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="modal-body"><div class="proj-list">${rows}</div></div>
    <div class="modal-foot"><button class="btn btn-accent" id="mNew">New Project</button></div>`);
  $('mClose').onclick=closeModal;
  $('mNew').onclick=()=>{ saveProject(); startNewProject(); closeModal(); toast('New project'); };
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ saveProject(); loadProject(b.dataset.open); closeModal(); });
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ const map=loadAll(); delete map[b.dataset.del]; saveAll(map); if(b.dataset.del===project.id) startNewProject(); showProjects(); });
  document.querySelectorAll('[data-rename]').forEach(b=>b.onclick=()=>{ const map=loadAll(); const p=map[b.dataset.rename]; const nn=prompt('Project name', p.name||''); if(nn!==null){ p.name=nn; if(p.id===project.id){project.name=nn;$('projName').value=nn;} saveAll(map); showProjects(); } });
}

$('btnMenu').onclick=showMenu;
function showMenu(){
  modal(`
    <div class="modal-head"><h2>Menu</h2><button class="icon-btn small" id="mClose"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="modal-body"><div class="menu-list">
      <button id="mExportJson"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export project as JSON</button>
      <button id="mImportJson"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12"/></svg>Import project from JSON</button>
      <button id="mPdf2"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>Export PDF plan sheet</button>
      <button id="mContractor"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 16 0v1"/></svg>Set contractor name</button>
      <button id="mNew2"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>New blank project</button>
    </div></div>`);
  $('mClose').onclick=closeModal;
  $('mExportJson').onclick=()=>{ exportJSON(); closeModal(); };
  $('mImportJson').onclick=()=>{ $('importFile').click(); closeModal(); };
  $('mPdf2').onclick=()=>{ closeModal(); exportPDF(); };
  $('mNew2').onclick=()=>{ saveProject(); startNewProject(); closeModal(); };
  $('mContractor').onclick=()=>{ const n=prompt('Contractor / company name (shown on PDF)', project.contractor||''); if(n!==null){ project.contractor=n; markDirty(); toast('Contractor saved'); } closeModal(); };
}

/* ---------- JSON export/import ---------- */
function exportJSON(){
  const data=JSON.stringify(project,null,2);
  const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(project.name||'poolflow-project').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('JSON exported');
}
$('importFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{
    const p=JSON.parse(rd.result);
    if(!p.components) throw 0;
    p.id=p.id||('proj_'+Date.now().toString(36));
    project=p;
    $('projName').value=project.name||''; $('projClient').value=project.client||'';
    render(); fitToScreen(); saveProject(); toast('Project imported');
  }catch(_){ toast('Invalid JSON file'); } };
  rd.readAsText(f); e.target.value='';
});

/* ============================================================
 *  PDF export
 * ============================================================ */
$('btnExportPdf').onclick=exportPDF;
function exportPDF(){
  if(!project.components.length && !project.pipes.length){ toast('Add components first'); return; }
  toast('Building PDF…');
  setTimeout(()=>{ try{ buildPDF(); }catch(err){ console.error(err); toast('PDF error'); } }, 30);
}

function buildPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'letter' }); // 792 x 612
  const PW=792, PH=612, M=24;
  const INK='#0f1b2d', LINE='#94a9c4', SUB='#5a6e88';

  // ---- Outer border ----
  doc.setDrawColor(15,27,45); doc.setLineWidth(1.4);
  doc.rect(M, M, PW-M*2, PH-M*2);

  // ---- Title block (bottom strip) ----
  const tbH=70, tbY=PH-M-tbH;
  doc.setLineWidth(1); doc.line(M, tbY, PW-M, tbY);
  // dividers
  const cols=[M, M+300, M+470, M+620, PW-M];
  for(let i=1;i<cols.length-1;i++) doc.line(cols[i], tbY, cols[i], PH-M);
  function tbCell(x, label, value, big){
    doc.setFontSize(6.5); doc.setTextColor(90,110,136); doc.setFont('helvetica','normal');
    doc.text(label.toUpperCase(), x+8, tbY+15);
    doc.setTextColor(15,27,45); doc.setFont('helvetica', big?'bold':'normal'); doc.setFontSize(big?14:10);
    doc.text(value||'—', x+8, tbY+ (big?40:33), {maxWidth: 280});
  }
  tbCell(cols[0], 'Project', project.name||'Untitled Project', true);
  // client/address spans into project cell second line
  doc.setFontSize(8); doc.setTextColor(90,110,136); doc.setFont('helvetica','normal');
  doc.text((project.client||'').slice(0,70), cols[0]+8, tbY+56, {maxWidth:284});
  tbCell(cols[1], 'Sheet', 'Plumbing Plan');
  doc.setFontSize(8); doc.setTextColor(90,110,136);
  doc.text('Top-down schematic', cols[1]+8, tbY+50);
  tbCell(cols[2], 'Contractor', project.contractor||'');
  tbCell(cols[3], 'Date', new Date().toLocaleDateString());
  doc.setFontSize(7); doc.setTextColor(90,110,136);
  doc.text('PoolFlow Planner', cols[3]+8, tbY+50);

  // ---- Header strip ----
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(15,27,45);
  doc.text('POOL & SPA PLUMBING PLAN', M+10, M+22);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,110,136);
  doc.text('Scale: 1 grid = 1  ft (approx.) · Not for construction without site verification', M+10, M+35);

  // ---- Diagram area ----
  const legendW=150;
  const dx=M+8, dyTop=M+46, dw=PW-M*2-legendW-24, dh=tbY-dyTop-10;
  // light frame for plan
  doc.setDrawColor(200,210,225); doc.setLineWidth(0.5); doc.rect(dx, dyTop, dw, dh);

  const bb=contentBBox()||{x:0,y:0,w:100,h:100};
  const pad=20;
  const s=Math.min((dw-pad*2)/bb.w, (dh-pad*2)/bb.h);
  const ox=dx + (dw - bb.w*s)/2 - bb.x*s;
  const oy=dyTop + (dh - bb.h*s)/2 - bb.y*s;
  const TX=(x)=>ox+x*s, TY=(y)=>oy+y*s;

  // grid inside diagram (subtle)
  doc.setDrawColor(228,234,242); doc.setLineWidth(0.3);
  // draw pipes
  for(const p of project.pipes){
    const pts=pipePoints(p); const t=PIPE_TYPES[p.type];
    const rgb=hex2rgb(t.color);
    doc.setDrawColor(rgb[0],rgb[1],rgb[2]);
    doc.setLineWidth(Math.max(0.8, pipeStrokeWidth(p.size)*s*0.5));
    if(t.dash){ const dd=t.dash.split(' ').map(n=>+n*s*0.5); doc.setLineDashPattern(dd,0);} else doc.setLineDashPattern([],0);
    for(let i=0;i<pts.length-1;i++) doc.line(TX(pts[i].x),TY(pts[i].y),TX(pts[i+1].x),TY(pts[i+1].y));
    doc.setLineDashPattern([],0);
    // size label
    const mid=midLabelPoint(pts);
    doc.setFillColor(255,255,255); doc.setDrawColor(rgb[0],rgb[1],rgb[2]); doc.setLineWidth(0.4);
    const lw=p.size.length*4+6;
    doc.rect(TX(mid.x)-lw/2, TY(mid.y)-6, lw, 11, 'FD');
    doc.setFontSize(6.5); doc.setTextColor(rgb[0],rgb[1],rgb[2]); doc.setFont('helvetica','bold');
    doc.text(p.size, TX(mid.x), TY(mid.y)+2.5, {align:'center'});
  }
  // draw components
  doc.setFont('helvetica','bold');
  for(const c of project.components){
    const def=compDef(c.type);
    if(def.kind==='shape'){
      doc.setDrawColor(43,91,134); doc.setFillColor(238,243,250); doc.setLineWidth(1);
      if(def.dashed) doc.setLineDashPattern([3,2],0); else doc.setLineDashPattern([],0);
      if(def.shape==='ellipse'){
        doc.ellipse(TX(c.x+c.w/2),TY(c.y+c.h/2), c.w/2*s, c.h/2*s, 'FD');
      } else {
        doc.roundedRect(TX(c.x),TY(c.y), c.w*s, c.h*s, 4,4,'FD');
      }
      doc.setLineDashPattern([],0);
      doc.setFontSize(Math.max(7,Math.min(11, c.h*s*0.18)));
      doc.setTextColor(15,27,45);
      doc.text(c.label, TX(c.x+c.w/2), TY(c.y+c.h/2)+3, {align:'center'});
    } else {
      const box=(def.kind==='equip'?EQUIP_BOX:FITTING_BOX)*s;
      doc.setDrawColor(43,91,134); doc.setFillColor(255,255,255); doc.setLineWidth(0.8);
      const cx=TX(c.x), cy=TY(c.y);
      if(def.kind==='equip') doc.roundedRect(cx-box/2,cy-box/2,box,box,3,3,'FD');
      else doc.circle(cx,cy,box/2,'FD');
      // initials glyph
      doc.setFontSize(Math.max(5,box*0.34)); doc.setTextColor(15,27,45); doc.setFont('helvetica','bold');
      doc.text(glyphFor(c.type), cx, cy+box*0.13, {align:'center'});
      doc.setFontSize(6.2); doc.setFont('helvetica','normal'); doc.setTextColor(60,80,105);
      doc.text(c.label, cx, cy+box/2+8, {align:'center', maxWidth:80});
    }
  }

  // ---- Legend ----
  const lx=PW-M-legendW-8, ly=dyTop;
  doc.setDrawColor(200,210,225); doc.setLineWidth(0.6); doc.setFillColor(248,250,252);
  doc.rect(lx, ly, legendW, dh, 'FD');
  let yy=ly+18;
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(15,27,45);
  doc.text('LEGEND', lx+10, yy); yy+=16;
  doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(90,110,136);
  doc.text('PIPE TYPES', lx+10, yy); yy+=4;
  doc.setFont('helvetica','normal'); doc.setTextColor(15,27,45);
  const usedTypes=new Set(project.pipes.map(p=>p.type));
  for(const [k,v] of Object.entries(PIPE_TYPES)){
    yy+=13;
    const rgb=hex2rgb(v.color); doc.setDrawColor(rgb[0],rgb[1],rgb[2]); doc.setLineWidth(2);
    if(v.dash) doc.setLineDashPattern([4,2],0); else doc.setLineDashPattern([],0);
    doc.line(lx+10, yy-2, lx+34, yy-2); doc.setLineDashPattern([],0);
    doc.setFontSize(7); doc.setTextColor(usedTypes.has(k)?15:160, usedTypes.has(k)?27:170, usedTypes.has(k)?45:185);
    doc.text(v.label, lx+40, yy);
  }
  yy+=20;
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(90,110,136);
  doc.text('PIPE SIZES USED', lx+10, yy);
  doc.setFont('helvetica','normal'); doc.setTextColor(15,27,45); doc.setFontSize(7);
  const usedSizes=[...new Set(project.pipes.map(p=>p.size))].sort((a,b)=>parseFloat(a)-parseFloat(b));
  yy+=12; doc.text(usedSizes.length?usedSizes.join('  ·  '):'—', lx+10, yy);

  yy+=20;
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(90,110,136);
  doc.text('COMPONENT KEY', lx+10, yy);
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(15,27,45);
  const usedComp=[...new Set(project.components.map(c=>c.type))];
  for(const t of usedComp){
    if(yy> ly+dh-16) break;
    yy+=11;
    doc.setFont('helvetica','bold'); doc.setTextColor(15,27,45); doc.setFontSize(6.5);
    doc.text(glyphFor(t), lx+12, yy, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setTextColor(60,80,105);
    doc.text(CATALOG[t].label, lx+24, yy, {maxWidth:legendW-30});
  }

  const fname=(project.name||'poolflow-plan').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  doc.save(fname+'.pdf');
  toast('PDF downloaded');
}
function glyphFor(type){
  const map={pool:'PL',spa:'SPA',padzone:'PAD',spillover:'SO',skimmer:'SK',return:'R',drain:'MD',jet:'JET',bubbler:'BUB',deckjet:'DJ',sheer:'SD',slide:'SL',autofill:'AF',custom:'?',pump:'P',filter:'F',heater:'H',saltcell:'SC',booster:'BP',valve2:'2W',valve3:'3W',checkvalve:'CV',actuated:'AV',manifold:'MF',customeq:'EQ'};
  return map[type]||'?';
}
function hex2rgb(h){ h=h.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }

/* ============================================================
 *  Misc UI
 * ============================================================ */
let toastTimer=null;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.hidden=true,1800); }
function esc(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

$('inspClose').onclick=clearSelection;

// palette toggle (mobile)
$('paletteToggle').onclick=()=>$('palette').classList.toggle('open');
function closePalette(){ $('palette').classList.remove('open'); }

// inject logo
$('palette') && document.querySelectorAll('.logo, .empty-logo').forEach(e=>e.innerHTML=LOGO_SVG);

/* ============================================================
 *  Init
 * ============================================================ */
function init(){
  buildSvgScaffold();
  buildPalette();
  document.querySelectorAll('.logo, .empty-logo').forEach(e=>e.innerHTML=LOGO_SVG);
  const curId=storage.getItem(LS_CUR);
  const map=loadAll();
  if(curId && map[curId]){ loadProject(curId); }
  else { startNewProject(); }
  setTool('select');
  applyView();
  window.addEventListener('resize', ()=>{});
  // expose for QA
  window.__poolflow={ get project(){return project;}, addComponent, setTool, fitToScreen, exportPDF, screenToWorld };
}
document.addEventListener('DOMContentLoaded', init);
})();
