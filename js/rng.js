// Seeded random number generation.
// Every simulation gets its own deterministic stream, so simulation #k sees
// exactly the same random draws under every policy ("common random numbers").
(function (root) {
  "use strict";

  function splitmix32(a) {
    return function () {
      a |= 0; a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
      return ((t ^ (t >>> 15)) >>> 0);
    };
  }

  // xoshiro128** — fast, high-quality 32-bit generator.
  function makeStream(seed, simIndex) {
    const sm = splitmix32((seed * 2654435761) ^ (simIndex * 40503 + 0x5bd1e995));
    let a = sm(), b = sm(), c = sm(), d = sm();
    function next() {
      const r = Math.imul(rotl(Math.imul(b, 5), 7), 9);
      const t = b << 9;
      c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
      return (r >>> 0) / 4294967296;
    }
    function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }
    const uniform = () => {
      let u = next();
      while (u === 0) u = next();
      return u;
    };
    return {
      uniform,
      normal: (mu = 0, sd = 1) => mu + sd * invNorm(uniform()),
      triangular: (lo, mode, hi) => triangularInv(uniform(), lo, mode, hi),
      binomial: (n, p) => binomialInv(uniform(), n, p),
    };
  }

  // Inverse standard-normal CDF (Acklam's algorithm, |error| < 1.2e-9).
  function invNorm(p) {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function triangularInv(u, lo, mode, hi) {
    const f = (mode - lo) / (hi - lo);
    return u < f
      ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
      : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }

  // Binomial draw from ONE uniform: exact inversion for small means,
  // normal approximation (continuity-corrected) for large ones.
  function binomialInv(u, n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    const mean = n * p, v = mean * (1 - p);
    if (v >= 25) {
      const x = Math.round(mean + Math.sqrt(v) * invNorm(u));
      return Math.min(n, Math.max(0, x));
    }
    let pmf = Math.pow(1 - p, n), cdf = pmf, k = 0;
    const ratio = p / (1 - p);
    while (cdf < u && k < n) {
      pmf *= ((n - k) / (k + 1)) * ratio;
      k++; cdf += pmf;
    }
    return k;
  }

  function normCdf(x) {
    // Abramowitz–Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  root.RNG = { makeStream, invNorm, normCdf };
})(typeof window !== "undefined" ? window : globalThis);
