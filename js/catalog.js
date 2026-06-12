/* ===== Component catalog =====
 * kind: how it renders on canvas
 *   'shape'  -> resizable rounded-rect / ellipse (pool, spa, pad zone)
 *   'fitting'-> small icon glyph + label (skimmers, returns, jets, etc.)
 *   'equip'  -> icon glyph in a rounded box + label (pad equipment)
 * Sizes are in world units where 1 unit = 1 px at zoom 1, and GRID (=24) = 1 ft.
 */
const GRID = 24; // px per foot

const CATALOG = {
  // --- Structures ---
  pool:      { label:'Pool',        kind:'shape', shape:'rrect', w:GRID*16, h:GRID*8,  cat:'struct', icon:'pool' },
  spa:       { label:'Spa',         kind:'shape', shape:'ellipse', w:GRID*4, h:GRID*4, cat:'struct', icon:'spa' },
  padzone:   { label:'Equipment Pad', kind:'shape', shape:'rrect', w:GRID*6, h:GRID*4, cat:'equip', icon:'manifold', dashed:true, faint:true },

  // --- Fittings ---
  spillover: { label:'Spillover',   kind:'fitting', cat:'feature', icon:'spillover' },
  skimmer:   { label:'Skimmer',     kind:'fitting', cat:'fitting', icon:'skimmer' },
  return:    { label:'Return',      kind:'fitting', cat:'fitting', icon:'return' },
  drain:     { label:'Main Drain',  kind:'fitting', cat:'fitting', icon:'drain' },
  jet:       { label:'Spa Jet',     kind:'fitting', cat:'feature', icon:'jet' },
  bubbler:   { label:'Bubbler',     kind:'fitting', cat:'feature', icon:'bubbler' },
  deckjet:   { label:'Deck Jet',    kind:'fitting', cat:'feature', icon:'deckjet' },
  sheer:     { label:'Sheer Descent', kind:'fitting', cat:'feature', icon:'sheer' },
  slide:     { label:'Slide',       kind:'fitting', cat:'feature', icon:'slide' },
  autofill:  { label:'Autofill',    kind:'fitting', cat:'feature', icon:'autofill' },
  custom:    { label:'Custom',      kind:'fitting', cat:'feature', icon:'custom', editLabel:true },

  // --- Equipment ---
  pump:      { label:'Pump',        kind:'equip', cat:'equip', icon:'pump' },
  filter:    { label:'Filter',      kind:'equip', cat:'equip', icon:'filter' },
  heater:    { label:'Heater',      kind:'equip', cat:'equip', icon:'heater' },
  saltcell:  { label:'Salt Cell',   kind:'equip', cat:'equip', icon:'saltcell' },
  booster:   { label:'Booster Pump',kind:'equip', cat:'equip', icon:'booster' },
  valve2:    { label:'2-Way Valve', kind:'equip', cat:'equip', icon:'valve2' },
  valve3:    { label:'3-Way Valve', kind:'equip', cat:'equip', icon:'valve3' },
  checkvalve:{ label:'Check Valve', kind:'equip', cat:'equip', icon:'checkvalve' },
  actuated:  { label:'Actuated Valve', kind:'equip', cat:'equip', icon:'actuated' },
  manifold:  { label:'Manifold',    kind:'equip', cat:'equip', icon:'manifold' },
  customeq:  { label:'Equipment',   kind:'equip', cat:'equip', icon:'customeq', editLabel:true },
};

/* Palette layout: groups of [title, [type keys]] */
const PALETTE_GROUPS = [
  ['Structures', ['pool','spa','spillover','padzone']],
  ['Fittings',   ['skimmer','return','drain']],
  ['Features',   ['jet','bubbler','deckjet','sheer','slide','autofill','custom']],
  ['Equipment',  ['pump','filter','heater','saltcell','booster','valve2','valve3','checkvalve','actuated','manifold','customeq']],
];

/* Pipe types */
const PIPE_TYPES = {
  suction: { label:'Suction',  color:'#1f6feb', dash:'10 7' },
  return:  { label:'Return / Pressure', color:'#e23b56', dash:'' },
  feature: { label:'Feature',  color:'#7c4dff', dash:'' },
  gas:     { label:'Gas',      color:'#e0a800', dash:'9 6' },
  drain:   { label:'Drain / Waste', color:'#3a4a5c', dash:'2 5' },
};
const PIPE_SIZES = ['1.5"','2"','2.5"','3"','4"'];
function pipeStrokeWidth(size){
  const i = PIPE_SIZES.indexOf(size);
  return 2.4 + (i<0?1:i)*0.9; // 2.4 .. 6
}
