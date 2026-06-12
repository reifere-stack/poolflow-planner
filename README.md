# PoolFlow Planner

A static, touch-friendly drag-and-drop pool/spa plumbing layout designer for pool contractors.
Runs entirely client-side — no backend — so it can be hosted on GitHub Pages.

## Features
- Top-down SVG plan view with a blueprint grid (1 square = 1 ft), pan + zoom (mouse wheel / pinch), snap-to-grid toggle.
- Drag-and-drop palette: pool & spa (resizable), spillover, skimmers, returns, main drains, spa jets, bubblers, deck jets, sheer descents, slide, autofill, custom features, and equipment-pad items (pump, filter, heater, salt cell, booster pump, 2-way / 3-way / check / actuated valves, manifold, custom equipment, pad zone).
- Pipe tool with waypoints — each pipe has a size (1.5"–4", labeled on the pipe, stroke scales with size) and a color-coded type (suction, return/pressure, feature, gas, drain). Pipes stay attached to components when they move.
- Editable labels on everything; select, rotate, duplicate, delete.
- Projects: name + client/address, autosave to localStorage, multi-project list (open/rename/delete), JSON export/import.
- PDF export (jsPDF): landscape letter plan sheet with title block, fitted diagram, and a legend of pipe types/sizes and component keys.

## Run locally
Just open `index.html`, or serve the folder:
```
npx serve .
```

## Deploy to GitHub Pages
All asset paths are **relative** (`./...`), so the app works from any subpath
(`https://<user>.github.io/<repo>/`).

1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: deploy from branch (e.g. `main` / root).
3. Open the published URL. No build step required.

## Tech
Vanilla JS + SVG, jsPDF bundled in `./lib`. Fonts: Space Grotesk + IBM Plex (Google Fonts).
