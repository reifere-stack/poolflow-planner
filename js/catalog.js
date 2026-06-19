/* ===== Component catalog ===== */

const PALETTE_GROUPS = [
  ['Bodies & Pad', [
    ['pool',     'Pool',          {w:300, h:170, large:true}],
    ['spa',      'Spa',           {w:160, h:120, large:true}],
    ['pad',      'Equip Pad',     {w:260, h:140, large:true, dashed:true}],
    ['bodylink', 'Spill Link',    {w:100, h:50}],
  ]],
  ['Returns & Suction', [
    ['skimmer',  'Skimmer',       {w:44, h:44, compact:true}],
    ['drain',    'Main Drain',    {w:44, h:44, compact:true}],
    ['return',   'Return',        {w:36, h:36, compact:true}],
  ]],
  ['Features', [
    ['jet',      'Spa Jet',       {w:32, h:32, compact:true}],
    ['bubbler',  'Bubbler',       {w:40, h:40, compact:true}],
    ['deckjet',  'Deck Jet',      {w:44, h:44, compact:true}],
    ['sheer',    'Sheer Descent', {w:60, h:40, compact:true}],
    ['slide',    'Slide',         {w:60, h:44, compact:true}],
    ['autofill', 'Autofill',      {w:44, h:44, compact:true}],
    ['feature',  'Feature',       {w:60, h:44, compact:true}],
    ['light',    'Light',         {w:36, h:36, compact:true}],
    ['custom',   'Custom',        {w:80, h:50, editLabel:true}],
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
    ['valve3',     '3-Way Valve',    {w:130, h:100}],
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

/* ===== Real-world equipment catalog =====
   Dimensions in INCHES (footprint in plan view = wIn x dIn).
   Used by the Selected panel to pick a model and snap the item to scale on the pad.
*/
const EQUIPMENT_MODELS = {
  pump: [
    { id:'pentair-intelliflo3-vsf-3hp', brand:'Pentair', name:'IntelliFlo3 VSF 3.0 HP', wIn:26, dIn:12, hIn:16, port:'2"–3"', notes:'Variable speed, 3.0 THP' },
    { id:'pentair-intelliflo3-vsf-1_5hp', brand:'Pentair', name:'IntelliFlo3 VSF 1.5 HP', wIn:22, dIn:11, hIn:14, port:'2"', notes:'Variable speed, 1.5 THP' },
    { id:'hayward-tristar-vs-2_7', brand:'Hayward', name:'TriStar VS 2.7 HP', wIn:30, dIn:14, hIn:16, port:'2" × 2.5"', notes:'Variable speed' },
    { id:'hayward-superpump-vs', brand:'Hayward', name:'Super Pump VS', wIn:24, dIn:11, hIn:14, port:'1.5"–2"', notes:'Variable speed' },
    { id:'jandy-epump-vs-2_7', brand:'Jandy', name:'ePump VS 2.7 HP', wIn:30, dIn:15, hIn:16, port:'2.5" × 3"', notes:'Variable speed' },
    { id:'pentair-whisperflo', brand:'Pentair', name:'WhisperFlo (single speed)', wIn:22, dIn:11, hIn:14, port:'2"', notes:'Single speed' },
  ],
  filter: [
    { id:'pentair-cc-plus-520', brand:'Pentair', name:'Clean & Clear Plus 520', wIn:22, dIn:22, hIn:74, area:'520 sq ft', notes:'Cartridge' },
    { id:'pentair-cc-plus-420', brand:'Pentair', name:'Clean & Clear Plus 420', wIn:22, dIn:22, hIn:68, area:'420 sq ft', notes:'Cartridge' },
    { id:'pentair-cc-plus-320', brand:'Pentair', name:'Clean & Clear Plus 320', wIn:22, dIn:22, hIn:62, area:'320 sq ft', notes:'Cartridge' },
    { id:'hayward-swimclear-c5030', brand:'Hayward', name:'SwimClear C5030', wIn:26, dIn:26, hIn:47, area:'525 sq ft', notes:'Cartridge' },
    { id:'hayward-swimclear-c3030', brand:'Hayward', name:'SwimClear C3030', wIn:26, dIn:26, hIn:35, area:'325 sq ft', notes:'Cartridge' },
    { id:'pentair-quad-de-100', brand:'Pentair', name:'Quad DE 100', wIn:22, dIn:22, hIn:74, area:'100 sq ft', notes:'DE' },
  ],
  heater: [
    { id:'pentair-mastertemp-400', brand:'Pentair', name:'MasterTemp 400', wIn:23, dIn:33, hIn:28, btu:'400k', notes:'Need 12" sides / 24" top clearance' },
    { id:'hayward-h400fdn', brand:'Hayward', name:'Universal H400FDN', wIn:34, dIn:30, hIn:24, btu:'400k', notes:'Need 6" rear / 12" side clearance' },
    { id:'jandy-jxi-400', brand:'Jandy', name:'JXi 400', wIn:23, dIn:22, hIn:27, btu:'400k', notes:'Most compact 400k' },
    { id:'pentair-mastertemp-250', brand:'Pentair', name:'MasterTemp 250', wIn:23, dIn:32, hIn:28, btu:'250k', notes:'Need 12" sides' },
    { id:'jandy-jxi-260', brand:'Jandy', name:'JXi 260', wIn:23, dIn:22, hIn:27, btu:'260k', notes:'Compact' },
  ],
  valve2: [
    { id:'jandy-nl-2way-2', brand:'Jandy', name:'NeverLube 2-Way 2"', wIn:6, dIn:6, hIn:7, port:'2"', notes:'' },
    { id:'jandy-nl-2way-25', brand:'Jandy', name:'NeverLube 2-Way 2.5"', wIn:7, dIn:7, hIn:7, port:'2.5"', notes:'' },
    { id:'pentair-1_5-2way', brand:'Pentair', name:'1.5"-2" 2-Way Valve', wIn:6, dIn:6, hIn:7, port:'1.5"–2"', notes:'' },
  ],
  valve3: [
    { id:'jandy-nl-3way-2', brand:'Jandy', name:'NeverLube 3-Way 2"', wIn:6, dIn:7, hIn:7, port:'2"', notes:'' },
    { id:'jandy-nl-3way-25', brand:'Jandy', name:'NeverLube 3-Way 2.5"', wIn:7, dIn:8, hIn:7, port:'2.5"', notes:'' },
    { id:'pentair-fullfloxf-25', brand:'Pentair', name:'FullFloXF 2.5"–3" Diverter', wIn:7, dIn:7, hIn:7, port:'2.5"–3"', notes:'' },
  ],
  checkvalve: [
    { id:'jandy-check-2', brand:'Jandy', name:'2" Spring Check', wIn:5, dIn:3, hIn:5, port:'2"', notes:'' },
    { id:'jandy-check-25', brand:'Jandy', name:'2.5" Spring Check', wIn:6, dIn:4, hIn:6, port:'2.5"', notes:'' },
  ],
  actuated: [
    { id:'jandy-jva-24', brand:'Jandy', name:'JVA 2444 (3-way)', wIn:7, dIn:9, hIn:10, port:'2"–2.5"', notes:'24V actuator on 3-way' },
    { id:'pentair-iva', brand:'Pentair', name:'IntelliValve (3-way)', wIn:7, dIn:9, hIn:10, port:'2"–2.5"', notes:'IntelliCenter compatible' },
  ],
  saltcell: [
    { id:'pentair-ic40', brand:'Pentair', name:'IntelliChlor IC40', wIn:14, dIn:5, hIn:5, port:'2"', notes:'Up to 40k gal' },
    { id:'hayward-tcell-940', brand:'Hayward', name:'AquaRite T-Cell-940', wIn:14, dIn:5, hIn:5, port:'2"', notes:'Up to 40k gal' },
  ],
  booster: [
    { id:'polaris-pb4-60', brand:'Polaris', name:'PB4-60 Booster', wIn:18, dIn:9, hIn:11, port:'1.5"', notes:'For pressure-side cleaner' },
  ],
};

// Convenience: lookup model by id
function findEquipmentModel(modelId) {
  for (const type in EQUIPMENT_MODELS) {
    const m = EQUIPMENT_MODELS[type].find(x => x.id === modelId);
    if (m) return { type, ...m };
  }
  return null;
}

/* ===== Fittings BOM helpers =====
   Heuristics to estimate fittings on a plumbing run between two equipment items.
*/
const BOM_RULES = {
  // Couplings every N feet of straight pipe
  couplingEveryFt: 20,
  // Min 2 elbows per run (one at each end vertical)
  minElbowsPerRun: 2,
  // If horizontal length differs from vertical length significantly, add an extra 90
  longRunFt: 25,
  // For very angled runs (between 30–60 degrees off-axis), use a 45 instead of a 90
  use45DegMin: 25, // degrees
  use45DegMax: 65,
  // Unions on either side of equipment
  unionsPerEquipment: 2,
};

// Items that count as "equipment" needing unions on each side
const EQUIPMENT_TYPES = new Set(['pump','filter','heater','saltcell','booster','manifold','customeq']);

