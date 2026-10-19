# SPARK app (v3, model M3)

Client-side app: load RR intervals, fit the SPARK model, explore the latent vagal-like / sympathetic-like drives.
Open `index.html` in a browser (Chart.js is loaded from a CDN; everything else is local, nothing is uploaded).

## What changed
**1. Model M3, aligned with the R engine (`engine.js`, port of `model_engine.R`).**
logistic vagal/sympathetic spectral anchor from a Morlet CWT matching `biwavelet::wt` (V_P/V_S), monotone-Hermite HR resampling,
the artifact multiplier (default θ = 0.25) with likelihood and diagnostics cut-offs,
3-D MAP (ln κ_S, ln(κ_P−κ_S), ln Λ_R) with log-normal τ_P / τ_S / jitter priors and a Beta topology prior,
R's own BFGS (`optim`/vmmin) and Hessian-based standard errors (delta method), as in `report_model`.
**2. GUI.** Responsive layout (sidebar becomes a drawer below 860 px, sticky tabs, touch-sized controls), light/dark themes with accent colours,
chart cards with toolbars (PNG, fullscreen, width, hide), drag-to-resize cards saved in IndexedDB, toasts, keyboard shortcuts, print stylesheet.
**3. Visualizations and statistics.** New tabs *Model* and *Statistics*: spectral partition, prior-vs-posterior (τ_P, τ_S, jitter),
τ_P–τ_S Laplace ellipses, parameter correlation matrix, state-space landscape (U = −ln p, basins, mean flow), Poincaré plot, conventional HRV table
(SDNN, RMSSD, pNN50, LF/HF; observed vs filtered), rolling statistics, x_p–x_s cross-correlation, innovation ACF/PACF/KS/Q-Q/histogram, skew and kurtosis.
**4. Exports (menu in the top bar).** Any chart as PNG (1–4×, background choice), all charts as ZIP, parameters CSV (estimate, SE, 95% CI),
per-beat CSV (states with SEs, artifact multiplier, innovations), filtered RR, full session JSON, self-contained HTML report (print to PDF), and an **R script that reproduces the fit**.
**5. Settings (gear icon or `S`).** Appearance, chart styling and which charts are visible, every `spark_priors` / `spark_control` field with presets and live validation,
analysis options, export defaults, settings import/export. Saved in this browser.

The latent space stays at exactly two states (x_p, x_s).

## Files
`index.html` · `styles.css` · `engine.js` (model, no DOM: also runs in Node) · `settings.js` · `charts.js` · `export.js` · `tips.js` · `app.js` · `previous/` (the files you uploaded) · `tests/`

## Tests
- `node tests/test_editor_browser.js` (real Chromium, mouse-driven): drawing, edges, shared edges, selection, deletion, editing, clean start on a new dataset, API and events: 29 checks.
- `node tests/test_lifecycle_browser.js`: worker equals main thread, lazy builds, no rebuild on revisit, in-place phase redraw, hidden-tab export, per-window statistics following the phases, stability under rapid interaction: 13 checks.
- `node tests/test_parse.js`: file formats, unit detection and user choice, errors (31 checks).
- `node tests/test_phases.js`: automatic detection (accuracy, artifacts, false positives, two and three stressors, graded effort, manual markers, phase summary, per-window statistics): 29 checks.
- `node tests/test_engine.js`: the JS engine against reference results from the R engine (`tests/reference_R.json`, made by `Rscript tests/make_reference.R model_engine.R`) on four RR series, including the 5-2-5 example and the vagal-floor parameter: 56 checks.
- `cd tests && npm i jsdom@24 chart.js@4.4.1 @napi-rs/canvas && node test_ui.js`: loads the real page headlessly, runs the analysis, automatic and manual phases, both examples, playground, settings and every export, data input and units, settings organisation, the SPARK API, clean start on a new dataset, row filling and per-window statistics: 79 checks.

Measured agreement with R: spectral anchor 1e-8; filter states, variances and innovations ≤ 1e-9; MAP objective ≤ 1e-6; fit (κ, ν₀, σ², LL*) ≤ 1e-7 (same iteration counts as R's BFGS);
standard errors within 1% (numerical Hessian here, `numDeriv` Richardson in R). The R script exported by the app reproduces the browser fit in real R (multi-stressor example: κ_S 1e-5, κ_P 8e-6, LL* 3e-4 in absolute value).

## Statistics per window (v3.8)
The Statistics tab has a table of **conventional HRV statistics for every phase window**, for the observed RR and for the model-filtered RR side by side: heart rate, mean RR, SDNN, RMSSD, pNN50, LF, HF and LF/HF, with the whole recording as a reference row.
A beat belongs to the window in which it starts; LF, HF and LF/HF need at least 2 min of data (shown as — for shorter windows); with no phases defined only the whole recording is shown. It follows the phases (automatic, typed or drawn),
is built only when the tab is opened, and is exported as CSV (*Conventional statistics per window*), in the session JSON (`hrv.per_window`) and in the HTML report. Engine function: `phaseHRV(fit, phases)`.
Note that in windows where heart rate changes strongly (exercise, early recovery) SDNN and the spectral values include that trend.

## Performance (v3.7)
Interaction latency was reduced by removing the work that ran on every interaction. Measured with `node tests/perf.js` (real clicks and keys in Chromium, 4× CPU throttling): worst interaction **4120 → ≈ 740 ms**, interactions over 200 ms **29 → 7 of 39**, tab switches **0.7–3.3 s → 40–110 ms**
(the remaining slow figures come from a single-process headless Chromium that withholds the presented frame until a long task ends, so they are upper bounds).
- **Worker.** The spectral anchor, MAP fit, Hessian, derived statistics, spectra, rolling statistics, landscape and scalogram run in a Web Worker started from the engine's own source (works from `file://`); the page stays responsive during a run. Where workers are unavailable the same stages run on the main thread with yields. Results are identical (tested).
- **Lazy, sliced building.** Only the visible tab is built, one chart per task, after the browser has painted and is idle; a skeleton shows meanwhile and hidden tabs are built when opened. Derived data is computed on first use. Theme, chart and analysis settings redraw only what they affect; phase changes redraw bands in place.
- **Cached heat-maps.** The scalogram and landscape heat-maps are built once at data resolution and scaled by the GPU; repaints are skipped when nothing that affects them changed.
- **Cheaper charts.** Bands and gradient areas are single-path plugins (Chart.js fills cost 60–100 ms per chart); trajectory strokes are batched; the landscape density uses binned smoothing (difference from the exact estimate ≤ 0.02 in U).
- **No layout shift** when a modal opens (`scrollbar-gutter`), no backdrop blur on the top bar and small shadows (large blurs were the main paint cost).
- Resolution and content are unchanged (charts, scalogram and landscape are drawn at the same resolution as before).
`tests/test_lifecycle_browser.js` guards this architecture; `tests/perf.js` measures it.

## Layout rules (v3.6)
Cards sit in a grid that fills every row: paired cards have equal height (the chart of the shorter one grows to match), a half-width card that would stand alone in its row spans the whole row (also when you hide a neighbour), and the Overview metric cards always form complete rows (8×2, 4×4 or 2×8).
**Phase map** and **State-space landscape** are square (1:1) by default and side by side, filling the row; dragging a card's resize bar switches it to a free height, and *Reset chart sizes* restores the squares. The landscape's **mean-flow arrows** have a dark halo and white core, a length that grows with speed, and a legend, and are drawn above the trajectory.
The Model tab ends with a *Prior and posterior summary* next to the parameter correlation.

## Phase editor and scripting API (v3.5)
**Draw the phases.** On the RR tachogram (Signal tab) click the phase tool in the card toolbar, or *Define on the tachogram…* in the sidebar's Phases panel. Pick **Rest**, **Stressor** or **Recovery**, then drag a rectangle across the plot:
the window snaps to beats and overwrites whatever it covers (overlapped windows are trimmed or split). Drag the **grip** on a window edge (middle of the plot) to adjust it — a shared edge between two touching windows moves both;
click a window to select it (Delete removes it). The list in the editor gives exact times (m:ss or seconds), type and delete for each window; *Start from detected* copies the automatic detection as editable windows; *Clear* returns to automatic detection.
Any number of windows and stressors; gaps are allowed (those beats belong to no phase and are shown as “Unassigned”). **Priority:** windows drawn here → typed markers → automatic detection.
Windows belong to the recording they were drawn for: **loading another dataset clears them (and any typed markers)**; they are included in the session JSON and the phases CSV.

**Scripting API** (`window.SPARK`, e.g. from the browser console or a bookmarklet):
| | |
|---|---|
| `SPARK.data.load(text, name, {unit})` · `.loadRR(rrSeconds, label)` · `.example('5-2-5' \| 'multi')` · `.get()` | load a file's text (unit `'auto'`/`'ms'`/`'s'`/`'min'`), RR in seconds, or an example |
| `await SPARK.run()` · `SPARK.result()` | run the analysis; the result bundle `{fit, rep, dm, diag, events, phases, …}` |
| `SPARK.phases.get()` · `.detect(opts)` · `.summary()` | current phases (`source`: auto / manual / drawn), a detection with the current options, the per-phase table |
| `SPARK.phases.setWindows([{kind, from, to}])` · `.clearWindows()` · `.windows()` · `.setMarkers('300, 420')` · `.setMode('auto'\|'off')` · `.edit()` | define phases |
| `SPARK.settings.get(path)` · `.set(path, value)` · `.reset(section)` · `.exportJSON()` | settings (paths as in the settings file, e.g. `'analysis.timeUnit'`) |
| `SPARK.export.*` | `parametersCSV`, `beatsCSV`, `phasesCSV`, `sessionJSON`, `reportHTML`, `rScript`, `chartPNG(id)`, `allPNGZip` |
| `SPARK.ui.showTab(name)` · `.openSettings(section)` · `.toast(msg, kind)` · `.setTheme('light'\|'dark'\|'auto')` | interface |
| `SPARK.on('data' \| 'result' \| 'phases', fn)` → unsubscribe function · `SPARK.off` | events |
| `SPARK.engine` | the pure model functions (no DOM; also `require('./engine.js')` in Node): `fitModel`, `reportModel`, `detectPhases`, `phasesFromWindows`, `parseRRDetailed`, `simulateSession`, … |
`SparkApp` (the earlier, smaller object) still exists as an alias.

**Menus and layout.** Settings are grouped as Appearance · Data · Phases · Model · Analysis · Charts · Export · Backup & reset, with the rarely used model groups collapsed under “advanced”, and a search box that finds any setting.
The sidebar follows the workflow: Data (file, time unit, examples) → Analysis → Phases → Parameter playground → Filtered RR. The export menu is grouped into Charts · Tables and data · Reports and reproducibility.

## Data input and the vagal floor (v3.4)
**Files.** `.txt` and `.csv` (also `.tsv`, `.dat`, `.rr`, `.ibi`): one RR value per line, or a table. Delimiters `,` `;` tab or spaces, decimal point or comma, a header row, quoted fields, `#` comment lines, BOM and CRLF are handled.
With several columns the RR column is chosen by its header (rr, rri, ibi, nn, interval…), else the first column that is not monotonic; a steadily increasing column is read as **beat times** and differenced to RR (row counters are skipped).
**Time unit.** Milliseconds, seconds or minutes, **auto-detected** from a header hint (“RR (ms)”, “rr_s”, “[min]”) or from the typical value (seconds 0.2–3.5, milliseconds 150–3500, minutes 0.004–0.06). Choose the unit yourself in Data Input → *Time unit* or Settings → Analysis → Data input;
changing it re-reads the loaded file at once. A unit that makes the values implausible (outside 0.1–3 s) is refused with an explanation, values that fall outside that range are ignored and counted, and values that cannot be classified (for example heart rate in bpm) ask for a manual choice.
Everything is converted to seconds internally, so the model result does not depend on the file's unit. The chip shows how the file was read; the session JSON records it. Filtered RR can be exported in s, ms or min.
**Vagal floor at low frequency.** The default is **0.25** (the engine default). It sets the share of the vagal weight kept below the spectral crossover, so it changes V_P/V_S and with it how an excursion is apportioned between the two drives: report it with the results and vary it as a sensitivity analysis. Settings saved by an earlier version with one of the previous defaults (0.1 or 0.5) are moved to 0.25; a value chosen afterwards is kept.
The app defaults equal the R engine's, so the exported R script needs no explicit setting for the vagal floor unless you change it.

## Automatic phase detection (v3.3)
When no manual times are given, phases are **detected from heart rate** (observed RR only; the model does not detect phases): median HR in 5-s bins → optimal piecewise-constant levels
(dynamic programming, up to 2×*max stressors*+1 levels) → **backward elimination** of every level change smaller than the minimum shift (default 10 bpm) or with a z-score below the minimum (default 4;
z = change / SE, computed on the settled part of each phase and with the SE inflated for autocorrelation) → boundaries placed at beat resolution (stressor onset where HR leaves the previous plateau,
stressor end where its decline begins) → levels classified in order: first = **Rest**, an upward change = **Stressor** (a further upward change continues the same, graded stressor), a downward change = **Recovery**.
Any number of stressors is supported (named Stressor 1, 2, …). Everything is shown by phase: shaded bands, phase map, landscape, Poincaré, scalogram markers and a phase table with each phase's HR, RMSSD, drive means,
displacement from rest and the detected change with its z-score.
**Manual override:** type markers in Settings → Analysis → Protocol phases (seconds, increasing: end of rest, end of stressor 1, start of stressor 2, end of stressor 2 …, e.g. `300, 420` or `240, 360, 600, 780`). Typed markers replace detection; invalid ones are ignored with a warning. Detection can be switched off, and its sensitivity changed (conservative 12 bpm / z 5, standard 10 / 4, sensitive 8 / 4, custom).
**How well it works** (simulations, `tests/test_phases.js`; the model's own heart-rate variability sets the limit): at the default setting, 0–5% of stationary recordings got an invented phase (1 of 30 physiological 10-min recordings),
stressors of +20 bpm and more were found in 100% of simulations (+40 bpm: 20 of 20), and +12 bpm stressors in about a third; onsets are placed within about 4 s (strong stressors) to 10 s (mild ones), ends 6–20 s late because heart rate declines gradually.
Slow drifts and genuine stressors of similar size cannot be told apart from heart rate alone: for subtle protocols, use manual markers. A second built-in example (two stressors in one recording) is loaded with the second example button.

## Example data and phases (v3.2)
The built-in example is now a simulated **5-2-5 exercise test**: 5 min rest, 2 min exercise, 5 min recovery (≈ 960 beats). Two OU drives plus deterministic exercise offsets
(fast vagal withdrawal, slower sympathetic rise, slower recovery) drive an integrate-and-fire pacemaker with physiological values: ≈ 64 bpm at rest, ≈ 135 bpm at the end of exercise,
RMSSD ≈ 34 → 9 → 41 ms. Because the protocol times are known, charts shade the phases, the **phase map** and the **landscape** are coloured by phase with phase centroids and arrows
(rest → exercise → recovery), and a **phase summary** table reports HR, RMSSD, drive means/SDs and the displacement of each phase from rest.
For your own recordings the same views appear as soon as phases are detected (see above) or typed.
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
