# SPARK app (v3, model M3G)

Client-side app: load RR intervals, fit the SPARK model, explore the latent vagal-like / sympathetic-like drives.
Open `index.html` in a browser (Chart.js is loaded from a CDN; everything else is local, nothing is uploaded).

## What changed
**1. Model aligned with the R engine (`engine.js`, port of `01_model_engine.R`).** Replaces the pre-M3G model:
logistic vagal/sympathetic spectral anchor from a Morlet CWT matching `biwavelet::wt` (V_P/V_S), monotone-Hermite HR resampling,
the causal vagal variance gate (γ, τ_g, two passes with ν₀/σ² plug-ins), the artifact gate (default θ = 0.25) with likelihood and diagnostics cut-offs,
4-D MAP (ln κ_S, ln(κ_P−κ_S), ln Λ_R, ln γ) with log-normal τ_P / τ_S / jitter priors, Beta topology prior and Lomax + wall prior on γ,
R's own BFGS (`optim`/vmmin) and Hessian-based standard errors (delta method), as in `report_model`.
**2. GUI.** Responsive layout (sidebar becomes a drawer below 860 px, sticky tabs, touch-sized controls), light/dark themes with accent colours,
chart cards with toolbars (PNG, fullscreen, width, hide), drag-to-resize cards saved in IndexedDB, toasts, keyboard shortcuts, print stylesheet.
**3. Visualizations and statistics.** New tabs *Gate & Model* and *Statistics*: vagal gate g_k(t), spectral partition, prior-vs-posterior (τ_P, τ_S, jitter, γ),
τ_P–τ_S Laplace ellipses, parameter correlation matrix, state-space landscape (U = −ln p, basins, mean flow), Poincaré plot, conventional HRV table
(SDNN, RMSSD, pNN50, LF/HF; observed vs filtered), rolling statistics, x_p–x_s cross-correlation, innovation ACF/PACF/KS/Q-Q/histogram, skew and kurtosis.
**4. Exports (menu in the top bar).** Any chart as PNG (1–4×, background choice), all charts as ZIP, parameters CSV (estimate, SE, 95% CI),
per-beat CSV (states with SEs, gain, innovations), filtered RR, full session JSON, self-contained HTML report (print to PDF), and an **R script that reproduces the fit**.
**5. Settings (gear icon or `S`).** Appearance, chart styling and which charts are visible, every `spark_priors` / `spark_control` field with presets and live validation,
analysis options, export defaults, settings import/export. Saved in this browser.

The latent space stays at exactly two states (x_p, x_s).

## Files
`index.html` · `styles.css` · `engine.js` (model, no DOM: also runs in Node) · `settings.js` · `charts.js` · `export.js` · `tips.js` · `app.js` · `previous/` (the files you uploaded) · `tests/`

## Tests
- `node tests/test_engine.js`: the JS engine against reference results from the R engine (`tests/reference_R.json`, made by `Rscript tests/make_reference.R 01_model_engine.R`) on four RR series, including the 5-2-5 example: 64 checks.
- `cd tests && npm i jsdom@24 chart.js@4.4.1 @napi-rs/canvas && node test_ui.js`: loads the real page headlessly, runs the analysis, phases, playground, settings and every export: 33 checks.

Measured agreement with R: spectral anchor 1e-8; filter states, variances, gain and innovations ≤ 1e-9; MAP objective ≤ 1e-6; fit (κ, γ, ν₀, σ², LL*) ≤ 1e-7 (same iteration counts as R's BFGS);
standard errors within 1% (numerical Hessian here, `numDeriv` Richardson in R). The R script exported by the app reproduces the browser fit in real R (κ_S 7e-8, κ_P 1e-7, LL* 4e-9).

## Example data and phases (v3.2)
The built-in example is now a simulated **5-2-5 exercise test**: 5 min rest, 2 min exercise, 5 min recovery (≈ 960 beats). Two OU drives plus deterministic exercise offsets
(fast vagal withdrawal, slower sympathetic rise, slower recovery) drive an integrate-and-fire pacemaker with physiological values: ≈ 64 bpm at rest, ≈ 135 bpm at the end of exercise,
RMSSD ≈ 34 → 9 → 41 ms. Because the protocol times are known, charts shade the phases, the **phase map** and the **landscape** are coloured by phase with phase centroids and arrows
(rest → exercise → recovery), and a **phase summary** table reports HR, RMSSD, drive means/SDs and the displacement of each phase from rest.
For your own recordings, set *Rest ends at* and *Exercise ends at* (seconds) in Settings → Analysis to get the same views. The model does not detect phases.
The earlier highly variable example is still available as `genLegacyExampleRR` (used for the R-equivalence reference).

## Look (v3.2)
One visual language for all charts: Inter type, hairline value-axis grid without tick marks, rounded solid legends, index tooltips with a crosshair, gradient areas, m:ss time axes,
shaded phase bands, refined dark and light palettes, softer cards with a title and a one-line description. `node tests/shots.js [dark|light] [ids]` renders cards in real Chromium for review.

## Layout (v3.1)
Layout rules were rebuilt and checked in a real browser (headless Chromium) at 1920×1080, 1366×768, 1280×600, 1024×768, 768×1024, 844×390, 390×844 and 360×640:
`node tests/layout_audit.js [--shots]` (needs `npm i puppeteer-core @sparticuz/chromium chart.js`). It measures collapsed or distorted charts, clipped content,
page overflow, sticky bars, drawer, settings modal, export menu, fullscreen and sidebar collapse. Result: 0 issues at all eight sizes.
Fixed in this version: chart cards collapsing to 120 px (`flex:1` overrode their height), sticky sidebar/tabs broken by `overflow-x:hidden`,
the drawer growing taller than short screens (`align-self` on a fixed box), clipped and unscrollable parameter table, cut-off titles,
Greek letters turned into other symbols by upper-casing (τ → T, σ → Σ), scalogram squeezed into a shorter box, charts of hidden tabs painted twice.
Wide screens: the menu button collapses the sidebar; narrow screens (≤ 860 px): it opens a drawer.

## Known limits
- The layout was verified in headless Chromium only; Safari and Firefox were not tested.
- The built-in example data is far more variable than real RR series (RMSSD ≈ 290 ms), so it shows many artifact-gated beats; use it to explore the interface, not as a reference.
- The KS p-value uses the asymptotic distribution (R's `ks.test` is exact for small N); D matches.
- Fitting runs in the main thread (about 0.5 s for 400 beats, a few seconds for several thousand).
