# Sajad Azizi — personal research website

A static academic website for attosecond physics, molecular photoionization and scientific computing. No build step or external JavaScript dependencies are required for the portfolio pages.

## Pages

- `index.html`: research introduction, analytical phase illustration and selected work.
- `research.html`: research stories, eMOL, proposed directions and scientific computing.
- `publications.html`: journal articles, manuscripts/preprints and doctoral thesis.
- `emol.html`: code overview and embedded N₂/H₂O explorers.
- `cv.html`: career timeline; no downloadable CV.
- `contact.html`: public professional contact information.
- `presentations.html` and `certifications.html`: talks, teaching and training, linked from the footer.

## Preview locally

Run `python3 -m http.server 8765` from this directory, then open `http://localhost:8765/`.

## Assets and conventions

- `assets/style.css` and `assets/site.js`: shared visual style and accessible mobile navigation.
- `assets/phase-portrait.{js,css}`: analytical model D± = Y₀₀ ± 0.7iY₂₀. `assets/figs/phase-portrait.svg` is the fallback when JavaScript is unavailable. This illustration is not experimental data.
- `assets/emol.{js,css}` and `assets/tabs.js`: explorer wrapper, navigation and iframe sizing.
- `assets/viz/`: self-contained scientific explorers and their shared presentation assets. Keep numerical payloads and scientific checks intact when editing presentation.

Use accurate publication statuses. H₂O remains a preliminary snapshot while calculations are in progress. The complete application proposal is not part of the site.

The shared header and footer are static HTML so links work without JavaScript; keep them consistent across the eight public pages. The `v=` asset query strings should be updated when deploying changed shared assets to avoid stale browser caches.
