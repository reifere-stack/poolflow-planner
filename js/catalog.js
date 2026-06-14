/* ===== Component catalog ===== */

const PALETTE_GROUPS = [
  ['Bodies & Pad', [
    ['pool',     'Pool',          {w:300, h:170, large:true}],
    ['spa',      'Spa',           {w:160, h:120, large:true}],
    ['pad',      'Equip Pad',     {w:260, h:140, large:true, dashed:true}],
    ['bodylink', 'Spill Link',    {w:100, h:50}],
  ]],
  ['Returns & Suction', [
    ['skimmer',  'Skimmer',       {w:90, h:60}],
    ['drain',    'Main Drain',    {w:90, h:60}],
    ['return',   'Return',        {w:80, h:60}],
  ]],
  ['Features', [
    ['jet',      'Spa Jet',       {w:80, h:60}],
    ['bubbler',  'Bubbler',       {w:90, h:60}],
    ['deckjet',  'Deck Jet',      {w:90, h:60}],
    ['sheer',    'Sheer Descent', {w:100, h:60}],
    ['slide',    'Slide',         {w:90, h:60}],
    ['autofill', 'Autofill',      {w:90, h:60}],
    ['feature',  'Feature',       {w:100, h:60}],
    ['light',    'Light',         {w:80, h:60}],
    ['custom',   'Custom',        {w:100, h:60, editLabel:true}],
  ]],
  ['Equipment', [
    ['pump',     'Pump',          {w:110, h:70}],
    ['filter',   'Filter',        {w:110, h:70}],
    ['heater',   'Heater',        {w:110, h:70}],
    ['saltcell', 'Salt Cell',     {w:110, h:70}],
    ['booster',  'Booster',       {w:110, h:70}],
    ['manifold', 'Manifold',      {w:120, h:70}],
    ['conduit',  'Conduit',       {w:100, h:60}],
    ['customeq', 'Equipment',     {w:120, h:70, editLabel:true}],
  ]],
  ['Valves & Tees', [
    ['valve2',     '2-Way Valve',    {w:100, h:70}],
    ['valve3',     '3-Way Valve',    {w:110, h:70}],
    ['checkvalve', 'Check Valve',    {w:110, h:70}],
    ['actuated',   'Actuated Valve', {w:120, h:70}],
    ['tee',        'Tee',            {w:80, h:60}],
  ]],
];

// Flatten into a lookup for default dimensions/properties
const TOOLS = {};
PALETTE_GROUPS.forEach(([_, items]) => {
  items.forEach(([type, label, opts]) => {
    TOOLS[type] = { type, label, ...opts };
  });
});

// CSS classification for visual styling
const NODE_CLASS = {
  pool: 'body-pool large',
  spa: 'body-spa large',
  pad: 'body-pad large',
  valve2: 'valve',
  valve3: 'valve',
  checkvalve: 'valve',
  actuated: 'valve',
  tee: 'tee',
};

// Items that user can resize (mostly bodies and the pad zone)
const RESIZABLE = new Set(['pool','spa','pad']);

const PIPE_TYPES = {
  suction:   { label:'Suction',     color:'var(--pipe-suction)',   dash:'10 7' },
  return:    { label:'Return',      color:'var(--pipe-return)',    dash:''     },
  spillover: { label:'Spillover',   color:'var(--pipe-spillover)', dash:'2 6'  },
  feature:   { label:'Feature',     color:'var(--pipe-feature)',   dash:''     },
  conduit:   { label:'Conduit',     color:'var(--pipe-conduit)',   dash:'4 4'  },
  gas:       { label:'Gas',         color:'var(--pipe-gas)',       dash:'9 6'  },
  drain:     { label:'Drain/Waste', color:'var(--pipe-drain)',     dash:'2 5'  },
};

const PIPE_SIZES = ['1.5"','2"','2.5"','3"','4"','1" conduit','3/4" conduit'];

function pipeStrokeWidth(size) {
  if (!size) return 3.5;
  const num = parseFloat(size);
  if (isNaN(num)) return 3.5;
  // 1.5 -> 3, 2 -> 4, 2.5 -> 5, 3 -> 6, 4 -> 7
  return Math.max(2.6, Math.min(7, 2 + num));
}
