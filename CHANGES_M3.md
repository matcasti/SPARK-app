# SPARK app: change log (M3 engine and later)

## Model: the app now runs M3 (no vagal variance gate)
- engine.js: M3 (3 parameters: ln kappa_S, ln(kappa_P - kappa_S), ln Lambda_R); no gate gain, second pass, gamma prior or gate fields. Port of model_engine.R (the M3 engine of the SPARK project). Default vagal floor 0.25 (the engine default). The artifact multiplier is unchanged.
- Interface: removed the gamma slider of the manual panel, the "vagal gate" pill and metric tile, the gate gain chart, the gamma prior chart and table row, the gate settings group, gamma start value and the gate preset; the correlation matrix is 3 x 3; tab "Gate & Model" is "Model"; added a Lambda_R tile.
- Exports: parameters, per-beat CSV (no vagal_gain), session JSON, HTML report and R script (sources model_engine.R, states no gamma).
- Settings: version 5 migrates a saved vagal floor of 0.1 or 0.5 (earlier defaults) to 0.25.
- Tests: tests/reference_R.json regenerated with the M3 R engine (make_reference.R updated); the JS engine agrees with R to about 1e-9.

## v3.6.0: optional RR cleaning before the analysis
- New optional step (off by default): the running-median / MAD gate of tools/prep-data.R (`clean_sample`), window 50, 3.5 x MAD, 2 passes by default; all three can be tweaked in the sidebar (Data) or in Settings -> Data -> RR cleaning.
- engine.js: `cleanSample`, `runmed` (R's end rule "median"), settings validation. Equal to R's `clean_sample` to 5e-15 in 60 cases (tests/test_clean.js; reference made with tests/make_reference_clean.R).
- Interface: sidebar checkbox, three inputs and a summary of the replaced beats; RR chart marks replaced beats; new "RR cleaning" card (Signal tab); a filtered series loaded for re-estimation is not cleaned again.
- Exports: per-beat CSV (rr_raw_s, replaced), session JSON (cleaning block, raw RR), HTML report, R script (raw RR + clean_sample + settings; reproduces the app's fit).

## v3.7.0: Live section, RR intervals from a Polar H10 reconstructed on the go
- New `Analysis | Live` switch. Live: connect a Polar H10 (Web Bluetooth, standard Heart Rate service 0x180D / 0x2A37, battery 0x180F / 0x2A19; the ECG service is not used); RR intervals are reconstructed with M3 as they arrive.
- live.js (no DOM): packet parser, PolarSource (request filter, notifications, battery, automatic reconnection), SimulatedSource, LiveSession (rejection of impossible RR, gap detection with segments, window, optional cleaning gate, refit scheduling, status).
- Reconstruction: the M3 filter runs over the last window at every beat with the latest parameters (~0.2 ms); kappa_S, kappa_P, Lambda_R and the spectral anchor are re-estimated every 15 s of recording in the Web Worker (`SparkCompute.fitLive`, ~0.1 s).
- Interface (live_ui.js): sensor panel, reconstruction controls, session panel; values, two live charts (RR with filtered band, and x_p / x_s with bands); exports (received RR, states of the window, session JSON); "Send to analysis". Settings -> Live; `SPARK.live` API.
- Not tried with a physical Polar H10 (tested against a mock device and a simulated source).

## v3.8.0: welcome message and responsive layout
- Welcome dialog at start (welcome.js): features, optional "For the curious" section (model M3, estimation, spectral anchor, engine), shortcuts, "Don't show this again" (Settings -> Appearance -> Start); reopen with the ? button or key. Modal dialog with focus trap; Escape/backdrop close.
- Phones (<= 560 px): the top bar wraps into two rows; chart-card tools drop to a second line; scrollable tab bars show a shadow where more tabs are hidden; info buttons and metric selectors get a >= 24 px hit area on touch screens.
- tests/viewport_audit.js: real-Chromium audit of 12 viewports (320x568 .. 1920x1080) x main states: 0 issues.

## v3.8.1: simulated sensor removed from the Live interface
- The "Simulated sensor" button, its speed selector and every text that mentioned it are gone from the Live section, the welcome message and the support hint; the Live section offers only "Connect Polar H10".
- The simulated source stays in live.js and `SPARK.live.simulate(rr, {speed})` stays in the scripting API (used by the tests and the audit, not by the interface).
- The sensor name and battery are cleared when no sensor is connected (Stop, end of stream, failed connection).

## v3.9.0: calibration period in Live, plot proportions, settings fix
- Calibration period (as in the original app used as blueprint): after the sensor connects, the RR intervals received during `live.calibrationS` seconds (default 8, Settings -> Live; 0 turns it off) are discarded and counted; the status line, the banner and the dot show "Calibrating" with a countdown, the heart rate keeps updating, and the recording (time zero) starts after it. It restarts after an automatic reconnection. The RR CSV has a `# Calibration period` comment line and the session JSON the seconds and the discarded beats.
- Live plots: the height is kept between 0.5 and 2 times the width (preferred 250 / 290 px, clamped; `SPARK.live.layout()`), following resizes.
- Fix (settings.js): `merge()` copied sections missing from saved settings by reference, so a later change altered the defaults and "Reset this section" restored modified values; it now deep-copies. Regression test added.
- viewport_audit.js also checks the live plot proportions and a calibrating state.

## v3.10.0: live plots side by side on wide screens, continuous updating
- The two live plots are in a grid that puts them side by side when each can be at least 560 px wide (about 1470 px of screen or more) and stacks them otherwise; both keep a height between 0.5 and 2 times their width (preferred 270 px). At 1600x900, 1920x1080, 2560x1440 and 3440x1440 both plots are fully inside the screen (lowest edge 637 / 687 px at 1600 / 1920 wide). Live metrics use 6 columns on wide screens.
- Continuous updating (live_ui.js, helpers in live.js `SparkLive.smooth`): a 30 frames/s loop advances a display time smoothly (0.5x-3x real time, never ahead of the newest beat, fixed display delay, default 1 s) and draws the curve and its bands up to it, with an interpolated tip; the time axis scrolls in real time (30 s minimum span, then the chart window) and the vertical scale eases. Settings -> Live: "Smooth, continuous plot updating" (on by default; off with Reduce motion) and "Display delay".
- Measured in a real Chromium: smooth on, axis and tip move 30 times per second with steps of 0.03 s (max 0.064 s), one chart update about 2 ms (p95 4.2 ms); smooth off, one move per beat (about 1 s).
- tests/test_ui.js: the matchMedia stub no longer claims that the user asks for reduced motion.

## v3.11.0: spacing, subtle dark-mode axes, very small screens
- Spacing: chart-card tools 5 px apart, menu items 2 px, settings navigation 4 px, preset / settings-file button rows 8 px (the rows were `display:block` and their buttons touched), Stop button of the Live panel 8 px below Connect, settings rows 6 px between label and control.
- Dark mode: the live charts are rebuilt when the theme or accent changes (they kept the light-theme grid `#DDE4EF`, which looked white in dark mode); translucent hairline axes (grid 7.5%, baseline 15% opacity; no vertical grid or frame); the other charts' dark grid softened from 11% to 8.5%.
- Very small screens: `body{min-width:320px}` removed (the page now adapts down to 240 px wide); extra rules below 360, 300 and 260 px (smaller paddings and controls, icon-only buttons, one-column tiles) and for screens up to 420 px high (the top bar scrolls away, dialogs use the whole height); chart tools wrap.
- viewport_audit.js: 21 viewports (down to 240x240, 320x200 and 900x200) and a detector of controls that are too close (ignores controls under dialogs and inside closed sections).

## v3.11.1: fix for "Cannot read properties of undefined (reading 'fitWindowMin')" on deployment
- Cause (most likely, from the stack trace): `live_ui.js` runs `syncControls()` when it is loaded and read `ST.get('live')`, which is `undefined` if the served `settings.js` is an older file without the Live section (a cached copy mixed with the new `live_ui.js`).
- Fix: `live_ui.js` has built-in defaults for the Live settings and never assumes the section exists (`liveSettings()`, `setLive()`), logs a warning and shows a toast asking for a reload ignoring the cache; `welcome.js` treats a missing `ui` section as "show the welcome". Cleaning settings used by Live also have fallbacks.
- Prevention: every local script and the stylesheet are requested with `?v=<version>` so cached files of different versions cannot be mixed; a test checks that they match the version in app.js.
- Tests: reproduces the exact error when the fix is reverted (an older settings file without the Live and ui sections); version-stamp consistency check.

## v3.11.2: help texts and labels aligned with the SPARK manuscript
- Tooltips (`tips.js`): baseline rate ν₀ is no longer described as the zero-tone rate after pharmacological blockade; τ_S and τ_P give the real default priors (95% intervals 100–300 s and 3–6 s) and say that τ_S is largely set by the prior and τ_P can absorb slower oscillations; κ_P/κ_S says that κ_P > κ_S is imposed; the vagal floor default is 0.25 (it said 0.5); the states are described as causal (filtered) estimates with 95% bands conditional on the fitted parameters (they said Kalman-smoothed with credible intervals); the sign convention ν(t) = ν₀ − x_p + x_s is stated; RMSSD and SDNN are marked as computed on the filtered series; the PACF text refers to lags 1–40.
- Descriptive displays (areal velocity, balance index and its SD, total drive, excursion index) are labelled as descriptive and say what they do not represent; the entropy-production, dissipation and allostatic-cost wording is removed, because that interpretation is not supported. The card "Entropy production rate" is now "State excursion index" and "Mean EPR" is "Mean excursion index"; "Autonomic balance index" is "Log balance index"; the Overview card "Heart rate" is "Baseline rate ν₀". Card ids, exported keys (for example `mean_epr` in the session JSON) and formulas are unchanged.
- "95% credible bands" is now "95% bands (conditional on the fitted parameters)" in the charts and in Settings; the parameter report and exports describe the two drives as vagal-like and sympathetic-like.
- Welcome message: the priors are "informative", not "weak".
- No change to the model, the numbers or the file formats. Version-stamped file URLs moved to 3.11.2.

## v3.12.0: the retrospective fit uses three starts (as the R engine)
- The single BFGS start could end in a worse local optimum (in the SPARK project, 12 of 313 recordings; the objective was 10 to 470 units above the best one found, and seven of those fits had τ_P < 0.15 s). The retrospective fit now runs R's BFGS from three starting points, in coordinates scaled by the spread of the time-scale priors, and keeps the lowest objective: the default start (centers of the priors, Λ_R = 1e-3), a noise-free start (τ_P 12 s, τ_S 160 s, Λ_R = 1e-6) and a noisy start (τ_P 25 s, τ_S 150 s, Λ_R = 0.3). Among runs within 0.01 of the lowest, the earliest start is kept. The objective function is unchanged. It is the same procedure as in `model_engine.R` (`fit_model`), so the app and the R engine reach the same optimum.
- The Live view keeps its single start and the former coordinates (it refits repeatedly while recording), so a Live estimate on a hard recording can still differ from the retrospective one.
- Fits take about 2.6 times longer (three runs).
- The session export (JSON) adds `start_chosen` and `start_objectives`.
- Spectral anchor: `biwaveletMorlet` now uses biwavelet's cone-of-influence constant bit for bit (`fourier.factor * sqrt(1/2)`; the former `fourier.factor / sqrt(2)` differs in the last bit). At half-octave scales the period equals the cone edge exactly in two columns, and that bit decided whether the mask kept them, which made the JS anchor differ from R's by up to 8e-5 (relative). It now agrees to better than 1e-9 (38 recordings of the SPARK project: 7e-10), and the fitted κ and Λ_R to 5e-6.
- Tests: `tests/test_engine.js` has a fifth series (`tests/data/hard1499.json`, a step series on which the single start ended 71 objective units above the best optimum); the references in `tests/reference_R.json` were regenerated with the new R engine. All 76 checks pass (14 of them, on the spectral anchor, failed before the cone-constant fix).
- Exported R scripts call `fit_model`: they need the `model_engine.R` of the SPARK project that contains the three-start fit (the older file gives the single-start result).

## Tests (all pass)
UI 154 checks, live stream 48, RR cleaning 8, engine vs R 56, parsing 31, phase detection 29; viewport audit 0 issues in 21 viewports (240x240 to 2560x1440). Desktop Chromium only; Safari, Firefox and physical phones not tested; the Chromium-based editor, lifecycle, performance and layout scripts were not run.
