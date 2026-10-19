# Reference results from the R engine (model_engine.R) for tests/test_engine.js.
#   Rscript tests/make_reference.R <path/to/model_engine.R>
args <- commandArgs(trailingOnly = TRUE); engine <- if (length(args)) args[1] else "model_engine.R"
suppressPackageStartupMessages({ library(biwavelet); library(numDeriv); library(MASS); library(jsonlite) })
source(engine)

sim_rr <- function(n, seed, nu0 = 1.1, ks = 1 / 150, kp = 1 / 4, Vs = 0.02, Vp = 0.05, step = NULL, artifacts = integer()) {
  set.seed(seed); xs <- 0; xp <- 0; rr <- numeric(n); t <- 0
  for (i in seq_len(n)) {
    dt <- 1 / nu0
    xs <- xs * exp(-ks * dt) + sqrt(Vs * (1 - exp(-2 * ks * dt))) * rnorm(1)
    xp <- xp * exp(-kp * dt) + sqrt(Vp * (1 - exp(-2 * kp * dt))) * rnorm(1)
    mp <- 0; ms <- 0
    if (!is.null(step) && t > step$t0 && t < step$t1) { mp <- -step$amp_p * (1 - exp(-(t - step$t0) / 6)); ms <- step$amp_s * (1 - exp(-(t - step$t0) / 25)) }
    nu <- max(nu0 - xp + xs - mp + ms, 0.4)
    rr[i] <- max(0.3, min(2, 1 / nu + 0.012 * rnorm(1))); t <- t + rr[i]
  }
  for (a in artifacts) rr[a] <- if (a %% 2) rr[a] * 1.7 else rr[a] * 0.45
  rr
}
series <- list(
  example400 = jsonlite::fromJSON("tests/data/example400.json"),
  exercise525 = jsonlite::fromJSON("tests/data/exercise525.json"),
  stepArtifacts = sim_rr(700, 7, step = list(t0 = 250, t1 = 560, amp_p = 0.25, amp_s = 0.30), artifacts = c(120, 361, 530)),
  restLong = sim_rr(1100, 11, Vp = 0.09, Vs = 0.03)
)
fixed <- list(kp = 1.0, ks = 0.012, lR = 0.002)
out <- lapply(series, function(dy) {
  priors <- spark_priors(); control <- spark_control()                  # the engine defaults (vagal floor fraction 0.25)
  pr <- extract_spectral_priors(dy, priors, verbose = FALSE)
  pr_alt <- extract_spectral_priors(dy, spark_priors(lower_lf_vagal_fraction = 0.5), verbose = FALSE)   # a non-default floor, to test the parameter path
  f <- run_gls_filter(dy, fixed$kp, fixed$ks, pr$energy_ratio, fixed$lR, control)
  theta <- c(log(0.012), log(0.9), log(0.002))
  fit <- suppressMessages(fit_model(dy, priors, control, verbose = FALSE))
  rep_df <- NULL; invisible(capture.output(rep_df <- report_model(fit)))
  se <- function(name) { v <- suppressWarnings(as.numeric(rep_df$SE[rep_df$Parameter == name])); if (length(v)) v else NA_real_ }
  list(dy = dy, energy_ratio = pr$energy_ratio, energy_ratio_alt = pr_alt$energy_ratio, p_lf = pr$p_lf, p_hf = pr$p_hf, nu0_init = pr$nu0_init,
       filter = list(params = fixed, LL_star = f$LL_star, nu0 = f$nu0, sig2 = f$sig2, X_p = f$states[, "X_p"], X_s = f$states[, "X_s"], X_p_var = f$states[, "X_p_var"],
                     X_s_var = f$states[, "X_s_var"], rr_var = f$states[, "rr_var"], std_innov = f$std_innov, innovations_diagnostic = f$innovations_diagnostic,
                     implied_rr = f$implied_rr, gate_multiplier = f$gate_multiplier),
       objective = list(theta = theta, value = objective_map(theta, dy, pr, control)),
       fit = list(params = unclass(fit$params), LL_star = fit$LL_star, objective = fit$opt_raw$value, theta = fit$opt_raw$par, X_p = fit$states[, "X_p"], X_s = fit$states[, "X_s"]),
       se = list(ks = se("Kappa_S"), kp = se("Kappa_P"), lR = se("Lambda_R"), tau_s = se("Tau_S"), tau_p = se("Tau_P")))
})
jsonlite::write_json(out, "tests/reference_R.json", digits = I(15), auto_unbox = TRUE, na = "string")
cat("reference_R.json written for:", paste(names(out), collapse = ", "), "\n")
