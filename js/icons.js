/* ===== PoolFlow icon library =====
 * Each icon returns inner SVG markup drawn in a 24x24 viewBox using stroke=currentColor.
 */
const ICONS = {
  // Structures
  pool: `<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 13c2 0 2-1.5 4-1.5S9 13 11 13s2-1.5 4-1.5S17 13 19 13" opacity=".7"/>`,
  spa: `<circle cx="12" cy="12" r="8"/><path d="M9 9.5c0 1.5-1.5 1.8-1.5 3.2M12 9c0 1.5-1.5 1.8-1.5 3.2M15 9.5c0 1.5-1.5 1.8-1.5 3.2" opacity=".75"/>`,
  spillover: `<path d="M3 9h18"/><path d="M5 9v3M9 9v3M13 9v3M17 9v3M21 9v3"/><path d="M4 15h16" opacity=".5" stroke-dasharray="2 2"/>`,
  pad: `<rect x="3" y="6" width="18" height="12" rx="2" stroke-dasharray="3 3"/><path d="M7 10h10M7 14h10" opacity=".55"/>`,

  // Fittings
  skimmer: `<rect x="5" y="6" width="14" height="10" rx="2"/><path d="M5 10h14" opacity=".6"/><ellipse cx="12" cy="13" rx="4" ry="1.6" opacity=".7"/>`,
  return: `<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`,
  drain: `<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6" opacity=".7"/>`,
  jet: `<circle cx="9" cy="12" r="4"/><path d="M13 12h7M15 9l3 3-3 3" opacity=".85"/>`,
  bubbler: `<path d="M12 21V11"/><circle cx="12" cy="7" r="2.4"/><circle cx="8" cy="9" r="1.4" opacity=".7"/><circle cx="16" cy="9" r="1.4" opacity=".7"/>`,
  deckjet: `<path d="M5 20c2-6 5-9 7-13"/><path d="M12 7c2 4 5 7 7 13" opacity=".55"/><circle cx="12" cy="4" r="1.6"/>`,
  sheer: `<path d="M4 7h16"/><path d="M4 7v3M20 7v3"/><path d="M6 12v7M9 12v7M12 12v7M15 12v7M18 12v7" opacity=".7"/>`,
  slide: `<path d="M5 5c0 7 4 9 8 10s4 4 4 4"/><path d="M3 19h6"/><path d="M5 5h3" opacity=".7"/>`,
  autofill: `<path d="M12 3l5 6a5 5 0 1 1-10 0z"/><path d="M9 13h6" opacity=".6"/>`,
  light: `<circle cx="12" cy="10" r="5"/><path d="M9 19h6M10 22h4" /><path d="M12 5v-2M6 6l-1.5-1.5M18 6l1.5-1.5" opacity=".7"/>`,
  feature: `<path d="M12 3c3 5 5 7 5 10a5 5 0 1 1-10 0c0-3 2-5 5-10z"/>`,
  custom: `<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 3"/><path d="M12 8v8M8 12h8"/>`,

  // Equipment
  pump: `<circle cx="11" cy="13" r="6"/><path d="M11 13l4-4"/><rect x="14" y="4" width="6" height="5" rx="1"/>`,
  filter: `<path d="M8 3h8l-1 4v9a3 3 0 0 1-6 0V7z"/><path d="M9 11h6M9 14h6" opacity=".6"/>`,
  heater: `<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 9c0 1.5-1 2-1 3.5S9 15 9 15M14 9c0 1.5-1 2-1 3.5S14 15 14 15" opacity=".8"/>`,
  saltcell: `<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 8h6M9 12h6M9 16h6" opacity=".65"/>`,
  booster: `<circle cx="12" cy="13" r="5"/><path d="M12 13l3-3"/><path d="M12 4v3" /><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/>`,
  valve2: `<circle cx="12" cy="12" r="7"/><path d="M5 12h14"/><path d="M12 12l4-3" opacity=".9"/>`,
  valve3: `<circle cx="12" cy="12" r="7"/><path d="M12 5v7M12 12l6 3.5M12 12l-6 3.5"/>`,
  checkvalve: `<circle cx="12" cy="12" r="7"/><path d="M5 12h14"/><path d="M10 8l5 4-5 4" opacity=".9"/>`,
  actuated: `<circle cx="12" cy="13" r="6"/><path d="M5 13h14"/><rect x="9.5" y="3" width="5" height="4" rx="1"/>`,
  manifold: `<path d="M3 14h18v3H3z"/><path d="M6 14v-4M10 14v-4M14 14v-4M18 14v-4"/>`,
  tee: `<path d="M4 12h16"/><path d="M12 12v8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>`,
  conduit: `<path d="M3 9h18M3 15h18" stroke-dasharray="4 3"/>`,
  bodylink: `<path d="M4 8h7a4 4 0 0 1 0 8H4"/><path d="M20 16h-7" opacity=".7"/>`,
  customeq: `<rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="3 3"/><path d="M12 9v6M9 12h6"/>`,
};

function iconMarkup(key) {
  const inner = ICONS[key] || ICONS.custom;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
