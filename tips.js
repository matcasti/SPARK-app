/* SPARK info tooltips: content dictionary and the floating tooltip (hover, focus, tap). */
(function(){
const TIPS = {
  // ── Metric cards ──────────────────────────────────────────
  'm-hr':{
    title:'Baseline rate ν₀ (bpm)',
    formula:'ν₀ × 60   [ν(t) = ν₀ − x_p + x_s]',
    body:'The baseline pacing rate of the model: the rate that remains when the two latent drives, which fluctuate around zero, are set aside. It is a model parameter (profiled out analytically). It is not the mean heart rate of the recording (see the HRV tables) and not a measurement of the intrinsic rate under pharmacological blockade.'
  },
  'm-ts':{
    title:'τ Sympathetic (s)',
    formula:'τ_S = 1 / κ_S',
    body:'E-folding time of the slow, sympathetic-like drive. Its prior is log-normal with a 95% interval of 100–300 s (default), and the estimate usually falls inside it, so it is largely set by the prior. Do not read it as an independent measurement of a sympathetic time constant, and check the Prior and posterior summary before comparing it between recordings.'
  },
  'm-tp':{
    title:'τ Parasympathetic (s)',
    formula:'τ_P = 1 / κ_P',
    body:'E-folding time of the fast, vagal-like drive. Its prior is log-normal with a 95% interval of 3–6 s (default). The estimate often lies outside that interval, because the fast drive can absorb slower fluctuations such as baroreflex-related oscillations: read it as a fast time constant and not as a strictly vagal one.'
  },
  'm-kpks':{
    title:'κ_P / κ_S — separation of the two rates',
    formula:'κ_P / κ_S  (= τ_S / τ_P)',
    body:'Ratio of the two clearance rates. The model imposes κ_P > κ_S and a prior on their separation (target 20 by default), so a ratio above 1 is part of the identification structure and is not a finding. Differences between recordings are informative only together with the Prior and posterior summary.'
  },
  'm-hflf':{
    title:'Λ_P = V_P / V_S (spectral anchor)',
    formula:'Λ_P = E_vagal / E_symp  [logistic CWT partition]',
    body:'Ratio of the stationary variances of the vagal-like and sympathetic-like drives, fixed from the recording before the fit: the global Morlet wavelet power of heart rate (0.04–0.40 Hz) is split with logistic frequency weights (sympathetic below the crossover, 0.10 Hz by default; vagal above it, with a vagal floor at low frequency, default 0.25). It is not estimated by the optimizer. It decides how variability is shared between the two drives, so any statement about that split is conditional on this anchor.'
  },
  'm-sigs':{
    title:'σ_P / σ_S — amplitude ratio',
    formula:'σ_P / σ_S = √(2κ_P Λ_P σ²sys) / √(2κ_S σ²sys)',
    body:'Ratio of the stationary amplitudes of the two drives. It follows from the fitted clearance rates and the spectral anchor (Λ_P), so it carries the same conditioning: read it as a description of the model\'s decomposition and not as the relative strength of the two autonomic branches.'
  },
  'm-rmssd':{
    title:'RMSSD — filtered (ms)',
    formula:'RMSSD = 1000 · √( Σ(IRR_i − IRR_{i−1})² / (N−1) )',
    body:'RMSSD of the model-filtered RR series. The filter attenuates beat-to-beat noise and down-weights artifacts, so it is generally lower than the RMSSD of the observed series (both are in the Statistics tab). RMSSD is conventionally read as an index of vagally mediated variability, with the usual caveats.'
  },
  'm-sdnn':{
    title:'SDNN — filtered (ms)',
    formula:'SDNN = 1000 · std(IRR)',
    body:'Standard deviation of the model-filtered RR series: overall variability over all frequencies (LF and HF). It is generally lower than the SDNN of the observed series. Compare it between recordings only with the same settings and the same recording length.'
  },
  'm-rmse':{
    title:'Fit RMSE (ms)',
    formula:'RMSE = 1000 · √( Σ(ŷ_k − y_k)² / N )',
    body:'Root mean square error between the filtered and the observed RR intervals. It is an in-sample fit error (the filtered RR at each beat uses states updated with that beat), not a measure of predictive accuracy. In the SPARK paper the median was about 2.5 ms; large values can come from artifacts, arrhythmia or strong non-stationarity.'
  },
  'm-gate':{
    title:'Artifact-gated beats (%)',
    formula:'g_k = 1 + (max(|Δbk|,|Δfw|) / θ_jump)^p_jump',
    body:'Percentage of beats whose artifact multiplier 1 + (J/θ)^p exceeds the diagnostics cut-off (default 1.5). J is the larger of the backward and forward relative RR jump at the beat. The jitter variance of those beats is inflated, so the filter trusts them far less; beats above the likelihood cut-off (default 100) are also excluded from σ² and the likelihood. This rule handles ectopic beats and artifacts.'
  },
  'm-avel':{
    title:'Areal Velocity (Hz²/s)',
    formula:'Ω_rms = √⟨ (½(X_P Ẋ_S − X_S Ẋ_P))² ⟩_t',
    body:'Root-mean-square rate at which the (x_p, x_s) trajectory sweeps area in the plane: a descriptive summary of how fast the two states rotate around each other. It does not grow with recording length. Use it to explore a recording, not to compare people.'
  },
  'm-mepr':{
    title:'Mean excursion index ṡ̄ (s⁻¹)',
    formula:'ṡ̄ = ⟨κ_P(x_p²/V_P − 1) + κ_S(x_s²/V_S − 1)⟩_t',
    body:'Time average of the excursion index (see its chart): how far the two states are, on average, from what their stationary variances imply. The expression comes from Ornstein–Uhlenbeck theory but is used here only as a descriptive index: it should not be read as entropy production, dissipation or an allostatic cost.'
  },
  'm-bstd':{
    title:'Balance σ (nats)',
    formula:'σ_B = std( EMA[ ln(f(x_p)/f(x_s)) ] )',
    body:'Standard deviation of the balance index over the recording: how much the log ratio of the two mapped states varies. It depends on the transformation used (see the balance chart) and should not be read as reactivity or rigidity of the autonomic system.'
  },

  // ── Chart panels ──────────────────────────────────────────
  'c-rr':{
    title:'RR Interval — Observed vs. Filtered',
    formula:'y_k ~ N(1/ν(x_k), Λ_R/ν²)',
    body:'Observed beat-to-beat RR intervals (grey), model-filtered series (red line) and its 95% prediction band (shaded). Gated beats (ectopic, artifact or rhythm change) are marked with triangles: the filter down-weights them instead of rejecting them outright.'
  },
  'c-psd':{
    title:'Power Spectral Density',
    formula:'LF: 0.04–0.15 Hz  |  HF: 0.15–0.40 Hz',
    body:'PSD of the observed (grey) and model-filtered (coloured) RR series, estimated with a Welch periodogram. Red shading marks the LF band (mixed sympathetic and parasympathetic influences); teal marks HF (mainly vagal). A close overlap suggests that the model reproduces the spectral content of the series; it does not by itself validate the spectral anchor.'
  },
  'c-cwt':{
    title:'Morlet CWT Time-Frequency Scalogram',
    formula:'W(s,τ) = ∫ x(t) ψ*_{s,τ}(t) dt  |  ψ(η) = π^{-¼} e^{iω₀η} e^{-η²/2}  (ω₀=6)',
    body:'Continuous Wavelet Transform of the 4 Hz-resampled, mean-removed heart rate signal using a Morlet mother wavelet (ω₀=6). Each pixel encodes log-power in the joint time-frequency plane: bright yellow = high power, dark purple/black = low power (inferno colormap). The frequency axis is inherently log-spaced (dyadic scale grid, dj=0.25). Dashed horizontal lines mark band boundaries at 0.04 Hz (VLF/LF) and 0.15 Hz (LF/HF); 0.40 Hz marks the upper edge of the HF band. Unlike the global PSD, the scalogram shows transient oscillatory bursts and the temporal evolution of rhythms; the spectral anchor uses its time average.'
  },
  'c-states':{
    title:'Latent Autonomic Drives',
    formula:'dx_p = −κ_P x_p dt + σ_P dW_P ;  ν(t) = ν₀ − x_p + x_s',
    body:'Causal (filtered) estimates of the latent vagal-like x_p (teal) and sympathetic-like x_s (red) drives, in Hz, with 95% bands that are conditional on the fitted parameters (they ignore the uncertainty of those parameters). A positive x_s speeds the pacemaker and a positive x_p slows it. The states are model-based reconstructions, not recordings of nerve activity, and, being filtered, they lag sudden changes.'
  },
  'c-phase':{
    title:'Phase Map',
    formula:'(x_p(t), x_s(t)) ∈ ℝ²',
    body:'Trajectory of the two latent states through time, colour-coded from early (dark) to late (bright). Ellipses mark the stationary 1σ and 2σ regions. Clusters show where the states spend their time and loops show that the two states vary together in a cyclic way; the direction and area of loops are descriptive.'
  },
  'c-abi':{
    title:'Log Balance Index (descriptive)',
    formula:'f(x) = 0.5 + atan(x/σ_ss)/π ;  index(t) = EMA[ ln(f(x_p)/f(x_s)) ]',
    body:'Each latent state is mapped to the interval (0, 1) and the index is the smoothed (exponential moving average) log ratio of the two mapped states; positive values mean a larger mapped x_p than x_s. It is a descriptive transformation, not a measure of autonomic dominance.'
  },
  'c-tdrive':{
    title:'Total drive magnitude ‖x‖',
    formula:'‖x(t)‖ = √( x_p(t)² + x_s(t)² )',
    body:'Euclidean norm of the two states (Hz): how far the pair is from its mean level at each moment, whichever state contributes. A descriptive magnitude; it is not an energy of the autonomic system.'
  },
  'c-epr':{
    title:'Excursion index ṡ(t)',
    formula:'ṡ(t) = κ_P(x_p²/V_P − 1) + κ_S(x_s²/V_S − 1)',
    body:'Positive when the states are larger than their stationary variances imply, negative when they are smaller. The expression comes from Ornstein–Uhlenbeck theory and is shown here only as a descriptive index: it should not be read as entropy production, thermodynamic load or allostatic cost.'
  },
  'c-avel':{
    title:'Phase-Plane Areal Velocity (Smoothed)',
    formula:'dA/dt = EMA[ 0.5 (x_p·dx_s/dt − x_s·dx_p/dt) ]',
    body:'Smoothed (exponential moving average) rate at which the state trajectory sweeps area in the (x_p, x_s) plane; positive for counter-clockwise rotation. A descriptive display of the rotation of the trajectory.'
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
    body:'Partial autocorrelation function of standardised innovations at lags 1–40. A well-specified model would show all bars within the 95% bounds (dashed lines). Bars beyond the bounds indicate residual structure that the model does not represent, for example respiratory or baroreflex oscillations; this is common in real recordings, so read the states as conditional on it.'
  },
  'c-ks':{
    title:'Time-Rescaling KS Uniformity Test',
    formula:'u_k = 1 − exp(−∫_{t_{k-1}}^{t_k} λ(s) ds)  ~  U(0,1)?',
    body:'Time-rescaling goodness-of-fit test. Under the true model, transformed inter-event times u_k should be i.i.d. Uniform(0,1). The empirical CDF (red) should fall within the Kolmogorov-Smirnov confidence bands (green dashed). Departure above the diagonal indicates the model predicts rates that are too low; departure below indicates over-prediction.'
  },
  // ── v3: model and statistics ──────────────────────────────────
  'm-ll':{title:'Profiled log-likelihood',formula:'LL* = −½ Σ ln S_k − (n/2) ln σ̂²',body:'Log-likelihood after profiling ν₀ (GLS) and σ² (concentrated), over beats below the likelihood cut-off. Compare only between fits of the same series.'},
  'c-clean':{title:'RR cleaning (optional)',formula:'|x − running median| > n·MAD → linear interpolation',body:'The running-median / MAD gate of tools/prep-data.R. In a window of w beats (default 50) a value farther than n × MAD (default 3.5; MAD = 1.4826 × running median of the absolute deviations, floored at 10% of the overall median deviation) from the running median is replaced by linear interpolation between the accepted neighbours; the gate is applied several times (default 2). The number of beats never changes. Smaller n replaces more beats, including genuine variability. The model also down-weights artifact beats (artifact multiplier), so cleaning is optional.'},
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
