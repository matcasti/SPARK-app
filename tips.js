/* SPARK info tooltips: content dictionary and the floating tooltip (hover, focus, tap). */
(function(){
const TIPS = {
  // ── Metric cards ──────────────────────────────────────────
  'm-hr':{
    title:'Heart Rate (bpm)',
    formula:'HR = ν₀ × 60',
    body:'Intrinsic SA node pacing rate absent all autonomic tone. This is the baseline rate the sinoatrial node would maintain if both vagal and sympathetic influences were simultaneously removed — equivalent to the pharmacologically-blocked "zero-tone" rate observed in denervation studies.'
  },
  'm-ts':{
    title:'τ Sympathetic (s)',
    formula:'τ_S = 1 / κ_S',
    body:'Sympathetic neurotransmitter time constant. Controls how long after a neural burst the norepinephrine-mediated drive remains elevated at the SA node. Longer τ_S (10–30 s typical) produces the slow, sustained adrenergic responses characteristic of the fight-or-flight arc.'
  },
  'm-tp':{
    title:'τ Parasympathetic (s)',
    formula:'τ_P = 1 / κ_P',
    body:'Vagal acetylcholine clearance time constant. Acetylcholine is hydrolysed by AChE on the ms timescale, so τ_P ≪ τ_S physiologically (0.5–3 s). This kinetic asymmetry enables rapid beat-to-beat heart rate slowing and is the principal generator of high-frequency HRV.'
  },
  'm-kpks':{
    title:'κ_P / κ_S — Kinetic Asymmetry',
    formula:'κ_P / κ_S',
    body:'Ratio of autonomic clearance rates. Values substantially > 1 confirm the expected physiological asymmetry: vagal control operates orders of magnitude faster than sympathetic. This ratio determines the frequency separation between LF (sympathetic) and HF (parasympathetic) HRV bands.'
  },
  'm-hflf':{
    title:'Λ_P = V_P / V_S (spectral anchor)',
    formula:'Λ_P = E_vagal / E_symp  [logistic CWT partition]',
    body:'Ratio of the stationary variances of the vagal and sympathetic drives, fixed from the data before the fit: the global Morlet CWT power of heart rate between 0.04 and 0.40 Hz is split with logistic frequency weights (sympathetic below the crossover, vagal above it, with a vagal floor at low frequency, default 0.5). It is not estimated by the optimizer.'
  },
  'm-sigs':{
    title:'σ_P / σ_S — Drive Amplitude Ratio',
    formula:'σ_P / σ_S = √(2κ_P Λ_P σ²sys) / √(2κ_S σ²sys)',
    body:'Ratio of absolute parasympathetic-to-sympathetic drive amplitudes. Reflects the relative excursion range of each branch around its resting level. Values > 1 mean vagal modulation is larger in amplitude; values < 1 indicate sympathetic predominance.'
  },
  'm-rmssd':{
    title:'RMSSD — filtered (ms)',
    formula:'RMSSD = 1000 · √( Σ(IRR_i − IRR_{i−1})² / (N−1) )',
    body:'Root mean square of successive differences computed on the Kalman-filtered RR series. By operating on the smoothed latent rate rather than raw beats, it isolates true autonomic variation from ectopic artifacts and measurement noise. Primary index of parasympathetic (vagal) tone.'
  },
  'm-sdnn':{
    title:'SDNN — filtered (ms)',
    formula:'SDNN = 1000 · std(IRR)',
    body:'Standard deviation of the Kalman-filtered NN intervals. Overall HRV magnitude index spanning all frequencies — both sympathetic (LF) and parasympathetic (HF) contributions. Computed on the smoothed latent cardiac rate estimate rather than raw observed beats.'
  },
  'm-rmse':{
    title:'Fit RMSE (ms)',
    formula:'RMSE = 1000 · √( Σ(ŷ_k − y_k)² / N )',
    body:'Root mean square error between the model-predicted and observed RR intervals. The principal measure of overall model fit quality. Values < 15 ms are typical for normal sinus rhythm with clean data; higher values may indicate complex arrhythmia, non-stationarity, or sensor artifacts.'
  },
  'm-gate':{
    title:'Artifact-gated beats (%)',
    formula:'g_k = 1 + (max(|Δbk|,|Δfw|) / θ_jump)^p_jump',
    body:'Percentage of beats whose artifact multiplier 1 + (J/θ)^p exceeds the diagnostics cut-off (default 1.5). J is the larger of the backward and forward relative RR jump at the beat. The jitter variance of those beats is inflated, so the filter trusts them far less; beats above the likelihood cut-off (default 100) are also excluded from σ² and the likelihood. This rule handles ectopic beats and artifacts.'
  },
  'm-avel':{
    title:'Areal Velocity (Hz²/s)',
    formula:'Ω_rms = √⟨ (½(X_P Ẋ_S − X_S Ẋ_P))² ⟩_t',
    body:'Root-mean-square instantaneous rate at which the (X_P, X_S) trajectory sweeps phase-plane area. Because it is a rate rather than a running total, its scale does not grow with recording duration or beat count, making it directly comparable across recordings of different length.'
  },
  'm-mepr':{
    title:'Mean EPR  ṡ̄ (s⁻¹)',
    formula:'ṡ̄ = ⟨κ_P(X_P²/V_P^ss−1) + κ_S(X_S²/V_S^ss−1)⟩_t',
    body:'Time-averaged stochastic entropy production rate derived from Ornstein-Uhlenbeck non-equilibrium statistical mechanics. Zero at thermodynamic equilibrium. Positive values confirm the autonomic system operates as an open dissipative system, expending continuous metabolic work to maintain ordered chronotropic rhythms against environmental perturbations.'
  },
  'm-bstd':{
    title:'Balance σ (nats)',
    formula:'σ_B = std( EMA[ ln(f(X_P)/f(X_S)) ] )',
    body:'Standard deviation of the smoothed Autonomic Log Balance Index. Indicates the volatility or dynamic range of the autonomic balance over the recording. High values suggest a highly reactive and fluctuating autonomic equilibrium; low values suggest a rigid, highly constrained balance.'
  },

  // ── Chart panels ──────────────────────────────────────────
  'c-rr':{
    title:'RR Interval — Observed vs. Filtered',
    formula:'y_k ~ N(1/ν(x_k), Λ_R/ν²)',
    body:'Observed beat-to-beat RR intervals (grey), Kalman-filtered latent rate estimate (red line) and 95% prediction interval (shaded band). Gated beats (ectopic, artifact, or rhythm change) are marked with triangles. The filter separates true autonomic variation from measurement noise and non-sinus events without hard-rejecting beats.'
  },
  'c-psd':{
    title:'Power Spectral Density',
    formula:'LF: 0.04–0.15 Hz  |  HF: 0.15–0.40 Hz',
    body:'PSD of observed (grey) vs. Kalman-filtered (coloured) RR series estimated via Welch periodogram. Red shading marks the LF band (mixed sympathetic/parasympathetic); teal marks HF (primarily vagal). Close overlap of empirical and model spectra validates the spectral assumptions embedded in the Λ_P prior.'
  },
  'c-cwt':{
    title:'Morlet CWT Time-Frequency Scalogram',
    formula:'W(s,τ) = ∫ x(t) ψ*_{s,τ}(t) dt  |  ψ(η) = π^{-¼} e^{iω₀η} e^{-η²/2}  (ω₀=6)',
    body:'Continuous Wavelet Transform of the 4 Hz-resampled, mean-removed heart rate signal using a Morlet mother wavelet (ω₀=6). Each pixel encodes log-power in the joint time-frequency plane: bright yellow = high power, dark purple/black = low power (inferno colormap). The frequency axis is inherently log-spaced (dyadic scale grid, dj=0.25). Dashed horizontal lines mark band boundaries at 0.04 Hz (VLF/LF) and 0.15 Hz (LF/HF); 0.40 Hz marks the upper edge of the HF band. Unlike the global PSD, the scalogram reveals transient oscillatory bursts, non-stationarities, and temporal evolution of autonomic rhythms that are invisible to stationary spectral analysis — making it the primary diagnostic for time-varying sympatho-vagal dynamics.'
  },
  'c-states':{
    title:'Latent Autonomic Drivers',
    formula:'dX_P = −κ_P X_P dt + σ_P dW_P',
    body:'Kalman-smoothed estimates of the latent parasympathetic X_P (teal) and sympathetic X_S (red) drives with 95% credible intervals. Units are Hz — the instantaneous contribution each branch makes to the cardiac pacing rate. Values above zero are excitatory (increased HR); below zero are inhibitory (decreased HR).'
  },
  'c-phase':{
    title:'Autonomic Phase Space Topology',
    formula:'(X_P(t), X_S(t)) ∈ ℝ²',
    body:'Two-dimensional trajectory of the latent state vector through time. Colour encodes temporal progression from dark (early) to bright plasma (late); connecting lines highlight the sequential path. Ellipses mark the 1σ and 2σ steady-state covariance regions. Loops indicate cyclic modulation; concentrated clusters indicate autonomic quiescence. Loop area and direction reveal time-reversal asymmetry.'
  },
  'c-abi':{
    title:'Log Autonomic Balance Index',
    formula:'f(x) = 0.5 + (1/π)atan(x/σ_ss); ABI(t) = EMA[ ln(f(X_P)/f(X_S)) ]',
    body:'Each latent drive is mapped to a strictly positive (0, 1) probability-like domain while preserving its sign: baseline maps to 0.5, autonomic activation approaches 1.0, and withdrawal approaches 0.0. The natural log-ratio of these shifted states prevents division-by-zero artifacts. Finally, an Exponential Moving Average (EMA) is applied for temporal stabilization, yielding a noise-resistant index of true physiological dominance (positive = vagal, negative = sympathetic).'
  },
  'c-tdrive':{
    title:'Total Autonomic Drive ‖x‖',
    formula:'‖x(t)‖ = √( X_P(t)² + X_S(t)² )',
    body:'Euclidean norm of the two-dimensional latent state vector. Quantifies overall autonomic activity magnitude independent of which branch dominates. High values reflect strong bidirectional modulation; low values reflect autonomic quiescence. Proportional to the instantaneous kinetic energy of the autonomic oscillator.'
  },
  'c-epr':{
    title:'Entropy Production Rate ṡ(t)',
    formula:'ṡ(t) = κ_P(X_P²/V_P^ss−1) + κ_S(X_S²/V_S^ss−1)',
    body:'Instantaneous stochastic entropy production rate in s⁻¹, derived from Ornstein-Uhlenbeck non-equilibrium statistical mechanics. Zero at steady state. Red shading (ṡ > 0) marks periods of thermodynamic load where both drives exceed their typical amplitudes; teal (ṡ < 0) marks recovery phases where drives are sub-typical. Serves as the instantaneous allostatic cost signal.'
  },
  'c-avel':{
    title:'Phase-Plane Areal Velocity (Smoothed)',
    formula:'dA/dt = EMA[ 0.5 (X_P·dX_S/dt − X_S·dX_P/dt) ]',
    body:'The smoothed instantaneous rate at which the autonomic state sweeps out area in the sympathetic-parasympathetic phase plane. An Exponential Moving Average (EMA) is applied to filter high-frequency derivative noise, revealing the true macroscopic envelope of autonomic volatility and state transitions. Being a rate rather than a running total, this metric is directly comparable across recordings of different length.'
  },
  'c-hist':{
    title:'Innovation Distribution',
    formula:'z_k = (y_k − ŷ_k) / σ_k  ~  N(0,1)?',
    body:'Histogram of standardised Kalman filter innovations. A well-specified model produces i.i.d. N(0,1) innovations (red curve). Systematic skew indicates mis-specified drift; heavy tails indicate outliers not fully captured by the gate function; an overly narrow distribution suggests over-smoothing or an inflated measurement noise parameter.'
  },
  'c-qq':{
    title:'Normal Q-Q Plot of Innovations',
    formula:'z_(k) vs Φ⁻¹(k / (N+1))',
    body:'Normal quantile-quantile plot of standardised innovations. Points on the diagonal (dashed) confirm Gaussian innovation distributions — a necessary condition for Kalman filter optimality. Deviations in the tails indicate outliers not fully captured by the gating; an S-shape indicates systematic non-Gaussianity in the underlying process.'
  },
  'c-pacf':{
    title:'Partial Autocorrelation — Innovations',
    formula:'Bounds: ± 1.96 / √N',
    body:'Partial autocorrelation function of standardised innovations at lags 1–20. A well-specified model should show all bars within the 95% confidence bounds (dashed lines). Bars exceeding the bounds indicate residual temporal structure the model has not captured. A large lag-1 bar often signals that a clearance rate κ is underestimated; periodic patterns suggest mis-specified oscillator frequency.'
  },
  'c-ks':{
    title:'Time-Rescaling KS Uniformity Test',
    formula:'u_k = 1 − exp(−∫_{t_{k-1}}^{t_k} λ(s) ds)  ~  U(0,1)?',
    body:'Time-rescaling goodness-of-fit test. Under the true model, transformed inter-event times u_k should be i.i.d. Uniform(0,1). The empirical CDF (red) should fall within the Kolmogorov-Smirnov confidence bands (green dashed). Departure above the diagonal indicates the model predicts rates that are too low; departure below indicates over-prediction.'
  },
  // ── v3: model and statistics ──────────────────────────────────
  'm-ll':{title:'Profiled log-likelihood',formula:'LL* = −½ Σ ln S_k − (n/2) ln σ̂²',body:'Log-likelihood after profiling ν₀ (GLS) and σ² (concentrated), over beats below the likelihood cut-off. Compare only between fits of the same series.'},
  'm-lr':{title:'Threshold-jitter rate Λ_R',formula:'Var(timing noise) = σ̂²·Λ_R·Δt',body:'Variance rate of the noise on the sinoatrial threshold crossing, relative to the global scale σ̂². It sets the equivalent beat-timing jitter shown next to it and is penalized by a log-normal prior on that jitter.'},
  'm-jit':{title:'RR timing jitter (ms)',formula:'s_RR = √(σ̂²·Λ_R·median RR) / ν₀',body:'Equivalent standard deviation of beat-timing noise at the median RR, penalized by a log-normal prior (default 95% interval 0.5–20 ms).'},
  'c-phtab':{title:'Phase summary',body:'Heart rate, RMSSD and the mean of the two reconstructed drives in each phase (rest, one or several stressors, recoveries), plus the distance of each phase centroid from rest in the plane of the drives. Phases are detected automatically from heart rate (median 5-s bins, optimal piecewise-constant levels, then removal of level changes smaller than the minimum shift or with a z-score below the minimum, accounting for autocorrelation) or come from the markers you type. The model itself does not detect phases: check the limits against your protocol.'},
  'c-post':{title:'Prior and posterior summary',body:'For each time-scale parameter: the 95% range of its prior, the estimate, the Laplace posterior range and the ratio of posterior to prior spread. A ratio well below 1 means the data narrowed the prior; close to 1 means the prior is doing the work.'},
  'c-phhrv':{title:'Conventional statistics per window',body:'Mean heart rate, SDNN, RMSSD, pNN50, LF and HF power and LF/HF of the observed RR and of the model-filtered RR inside each phase window, with the whole recording as a reference. A beat belongs to the window in which it starts. Spectral values need at least 2 min of data. Where heart rate changes strongly within a window (exercise, early recovery) SDNN and the spectral values include that trend, so compare windows of similar steadiness.'},
  'c-poin':{title:'Poincaré plot',body:'Each point plots an RR interval against the next one. The observed cloud (grey) includes ectopic beats and timing noise; the filtered cloud (colour) shows the model-implied series. A tighter filtered cloud along the identity line means beat-to-beat noise was removed.'},
  'c-land':{title:'State-space landscape',formula:'U = −ln( p / p_max )',body:'Kernel density of the reconstructed (x_p, x_s) states in units of their stationary SDs. Bright regions (low U) are basins where the states spend most of their time; rings mark density maxima; white arrows show the mean direction of movement from each region and converge on attractors. It is a descriptive map of where the states lie, not a potential estimated from the model.'},
  'c-part':{title:'Spectral anchor',body:'Global (time-averaged, cone-of-influence masked) Morlet CWT power of heart rate and the logistic weights that split it into vagal and sympathetic energy. Their ratio fixes V_P/V_S before the fit.'},
  'c-ell':{title:'τ_P – τ_S regions',body:'Dashed: 95% region of the independent log-normal priors. Blue: Laplace approximation of the posterior (inverse numerical Hessian) at 50% and 95%. Narrow, tilted ellipses mean the two time constants are well determined or strongly correlated.'},
  'c-pp':{title:'Prior vs posterior',body:'Prior density and the data-informed estimate. For the time constants, the posterior is the Laplace (normal in ln τ) approximation. A posterior much narrower than the prior means the data were informative; a posterior sitting at the prior means the prior is doing the work.'},
  'c-corr':{title:'Parameter correlation',body:'Correlation matrix of the MAP estimates from the inverse Hessian. Large off-diagonal values flag parameters that trade off against each other.'},
  'c-hrv':{title:'Conventional HRV statistics',body:'Standard time- and frequency-domain HRV of the observed RR series and of the model-filtered series, for comparison. They describe the output; the latent states describe a generative explanation of it.'},
  'c-roll':{title:'Rolling statistics',body:'Heart rate, SDNN or RMSSD in sliding windows (set the window and step in Settings → Analysis), for the observed and the filtered series.'},
  'c-xc':{title:'Cross-correlation of x_p and x_s',body:'Correlation between the two reconstructed drives at lags in beats. Positive lags correlate x_p now with x_s later. Bars beyond the band are outside ±1.96/√N.'},
  'c-acf':{title:'Innovation autocorrelation',body:'Autocorrelation of the standardized innovations of the retained beats. A well-specified model leaves white-noise innovations; bars outside the band at low lags indicate unmodelled structure.'}

};


// ── Tooltip controller ──────────────────────────────────────
(()=>{
  const tip=document.getElementById('info-tip');
  const tipTitle=tip.querySelector('.tip-title');
  const tipFormula=tip.querySelector('.tip-formula');
  const tipBody=tip.querySelector('.tip-body');
  let _hideTimer, _lastBtn=null;

  function positionTip(btn){
    const rect=btn.getBoundingClientRect();
    const tw=tip.offsetWidth||272;
    requestAnimationFrame(()=>{
      const th=tip.offsetHeight;
      let left=rect.left+rect.width/2-tw/2;
      let top=rect.bottom+9;
      // clamp horizontally within viewport
      left=Math.max(8,Math.min(left,window.innerWidth-tw-8));
      // flip above button if too close to bottom
      if(top+th>window.innerHeight-8) top=rect.top-th-9;
      // clamp vertically — flipped tooltip must not escape above viewport
      top=Math.max(8,top);
      tip.style.left=left+'px';
      tip.style.top=top+'px';
    });
  }

  function showTip(btn){
    clearTimeout(_hideTimer);
    const d=TIPS[btn.dataset.tip];
    if(!d) return;
    tipTitle.textContent=d.title||'';
    tipTitle.style.display=d.title?'block':'none';
    tipFormula.textContent=d.formula||'';
    tipFormula.style.display=d.formula?'block':'none';
    tipBody.textContent=d.body||'';
    tip.classList.add('show');
    _lastBtn=btn;
    positionTip(btn);
  }

  function hideTip(){
    _hideTimer=setTimeout(()=>{tip.classList.remove('show');_lastBtn=null;},90);
  }

  // Hover (desktop)
  document.addEventListener('mouseenter',e=>{
    if(e.target.classList?.contains('info-btn')) showTip(e.target);
  },true);
  document.addEventListener('mouseleave',e=>{
    if(e.target.classList?.contains('info-btn')) hideTip();
  },true);

  // Focus (keyboard navigation)
  document.addEventListener('focusin',e=>{
    if(e.target.classList?.contains('info-btn')) showTip(e.target);
  });
  document.addEventListener('focusout',e=>{
    if(e.target.classList?.contains('info-btn')) hideTip();
  });

  // Click — toggle on mobile, dismiss on outside click
  document.addEventListener('click',e=>{
    if(e.target.classList?.contains('info-btn')){
      e.stopPropagation();
      if(tip.classList.contains('show')&&_lastBtn===e.target){hideTip();}
      else showTip(e.target);
    } else if(!tip.contains(e.target)){
      hideTip();
    }
  });

  // Hide on scroll (prevents stale tooltip positions)
  window.addEventListener('scroll',hideTip,{passive:true,capture:true});
  window.addEventListener('resize',hideTip,{passive:true});
})();

})();
