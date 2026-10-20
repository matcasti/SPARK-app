# Reference results of the R cleaning gate (clean_sample of tools/prep-data.R) for tests/test_clean.js.
#   Rscript tests/make_reference_clean.R <path/to/prep-data.R>
args <- commandArgs(trailingOnly = TRUE); prep <- if (length(args)) args[1] else "tools/prep-data.R"
suppressPackageStartupMessages({ library(jsonlite); library(data.table) }); PREP_AUTORUN <- FALSE; source(prep)
ref <- fromJSON("tests/reference_R.json", simplifyVector = TRUE)
set.seed(11)
inject <- function(x, n_art, seed) { set.seed(seed); idx <- sort(sample(seq(15, length(x) - 15), n_art)); for (k in idx) x[k] <- x[k] * sample(c(0.4, 0.65, 1.7, 2), 1); x }
series <- list(
  example400 = ref$example400$dy, exercise525 = ref$exercise525$dy, stepArtifacts = ref$stepArtifacts$dy, restLong = inject(ref$restLong$dy, 25, 5),
  tied = round(ref$restLong$dy[1:300] / 0.004) * 0.004,                                   # quantised like an ECG at 250 Hz: many ties
  short = ref$example400$dy[1:25], even_length = inject(ref$example400$dy[1:200], 6, 7), odd_length = inject(ref$example400$dy[1:201], 6, 8),
  with_na = { x <- inject(ref$example400$dy[1:300], 8, 9); x[c(5, 6, 120, 299, 300)] <- NA; x }, flat = c(rep(0.8, 40), 1.9, rep(0.8, 40)))
settings <- list(list(window = 50, n_mad = 3.5, n_iter = 2), list(window = 30, n_mad = 3, n_iter = 1), list(window = 100, n_mad = 5, n_iter = 3), list(window = 20, n_mad = 2, n_iter = 5), list(window = 7, n_mad = 3.5, n_iter = 2), list(window = 4, n_mad = 3.5, n_iter = 2))
out <- list()
for (nm in names(series)) for (j in seq_along(settings)) {
  s <- settings[[j]]; x <- series[[nm]]
  y <- suppressWarnings(clean_sample(x, window = s$window, n_mad = s$n_mad, n_iter = s$n_iter))
  out[[length(out) + 1]] <- list(name = nm, window = s$window, n_mad = s$n_mad, n_iter = s$n_iter, x = x, y = as.numeric(y), changed = as.integer(attr(y, "changed")))
}
write_json(out, "tests/reference_clean_R.json", digits = I(15), auto_unbox = TRUE, na = "string")
cat("reference_clean_R.json written:", length(out), "cases\n")
