// Portland Housing Monte Carlo — simulation engine.
// Step letters (A–H) match the equations on the website's Method section.
(function (root) {
  "use strict";

  const DEFAULTS = {
    sims: 500,
    years: 20,
    seed: 42,

    incomeGroups: [
      { name: "Low",     share: 0.25, income: 30000,  growth: 0.025, demandAdj: -0.003, sens: 1.00 },
      { name: "Working", share: 0.35, income: 50000,  growth: 0.028, demandAdj: -0.001, sens: 0.70 },
      { name: "Middle",  share: 0.25, income: 85000,  growth: 0.030, demandAdj:  0.001, sens: 0.25 },
      { name: "High",    share: 0.15, income: 150000, growth: 0.035, demandAdj:  0.003, sens: 0.10 },
    ],

    neighborhoods: [
      { name: "East Bayside", rent: 1700, households: 2500, units: 2700, demand: 0.025, construction: 0.025, zoning: 0.70 },
      { name: "West End",     rent: 1800, households: 3500, units: 3700, demand: 0.015, construction: 0.015, zoning: 0.85 },
      { name: "Munjoy Hill",  rent: 1900, households: 2000, units: 2100, demand: 0.025, construction: 0.010, zoning: 0.90 },
      { name: "Parkside",     rent: 1500, households: 3000, units: 3200, demand: 0.020, construction: 0.020, zoning: 0.60 },
      { name: "Old Port",     rent: 2100, households: 1200, units: 1300, demand: 0.020, construction: 0.010, zoning: 0.95 },
    ],

    constants: {
      inflation: 0.025,
      vacancyTarget: 0.05,
      frictionalVacancy: 0.03,
      rentVol: 0.015,
      incomeVol: 0.012,
      demandVol: 0.005,
      incomeQuantiles: 25,
      burdenThreshold: 0.30,
      landlordRule: 3.0,
      baseDisplacement: 0.002,
      maxDisplacement: 0.15,
      constructionLag: 2,
      recessionStay: 0.35,
      recessionDemandHit: 0.010,
      recessionIncomeHit: 0.030,
      recessionBuildFactor: 0.60,
      startingIncomeNoise: 0.10,
    },

    // Structural parameters nobody knows exactly. Each simulation draws its
    // own value from a triangular(low, most likely, high) distribution.
    uncertain: {
      rentResponse:       { lo: 0.40, mode: 0.60, hi: 0.90, sym: "\\theta",   label: "Rent response to tight markets" },
      demandElasticity:   { lo: 0.30, mode: 0.50, hi: 0.80, sym: "\\eta",     label: "Demand lost when rents rise" },
      supplyResponse:     { lo: 4.0,  mode: 8.0,  hi: 12.0, sym: "\\phi",     label: "Construction response to rents" },
      displacementSlope:  { lo: 0.08, mode: 0.12, hi: 0.18, sym: "\\beta",    label: "Displacement per unit of excess burden" },
      incomeSpread:       { lo: 0.30, mode: 0.35, hi: 0.42, sym: "\\sigma",   label: "Income spread within a group" },
      recessionProb:      { lo: 0.06, mode: 0.10, hi: 0.15, sym: "\\lambda",  label: "Yearly chance a recession starts" },
      protectionEfficacy: { lo: 0.60, mode: 1.00, hi: 1.20, sym: "e",         label: "How well tenant protections work" },
    },
  };

  const POLICIES = [
    { id: "sq",   name: "Status Quo",         color: "#8b949e", zoningRelief: 0.0, publicUnits: 0,   tenantProtection: 1.00, constructionPenalty: 1.00,
      desc: "Current rules continue." },
    { id: "zone", name: "Zoning Reform",      color: "#58a6ff", zoningRelief: 0.5, publicUnits: 0,   tenantProtection: 1.00, constructionPenalty: 1.00,
      desc: "Zoning restrictiveness cut in half, so more market-rate housing gets built." },
    { id: "pub",  name: "Public Housing",     color: "#3fb950", zoningRelief: 0.0, publicUnits: 150, tenantProtection: 1.00, constructionPenalty: 1.00,
      desc: "150 public units started per year, rented to low-income households at 30% of income." },
    { id: "ten",  name: "Tenant Protections", color: "#f0883e", zoningRelief: 0.0, publicUnits: 0,   tenantProtection: 0.45, constructionPenalty: 0.90,
      desc: "Displacement risk cut 55% (just-cause eviction, rent stabilization), with 10% less construction." },
    { id: "comb", name: "Combined Policy",    color: "#d2a8ff", zoningRelief: 0.5, publicUnits: 150, tenantProtection: 0.45, constructionPenalty: 0.90,
      desc: "All three together." },
  ];

  const METRICS = {
    rent:       { label: "City rent",                         unit: "$",  fmt: (v) => "$" + Math.round(v).toLocaleString() },
    burden:     { label: "Households paying >30% of income",  unit: "%",  fmt: (v) => v.toFixed(1) + "%" },
    burdenLow:  { label: "Low-income households paying >30%", unit: "%",  fmt: (v) => v.toFixed(1) + "%" },
    displaced:  { label: "Cumulative displaced households",   unit: "",   fmt: (v) => Math.round(v).toLocaleString() },
    lowShare:   { label: "Low-income share of residents",     unit: "%",  fmt: (v) => v.toFixed(1) + "%" },
    vacancy:    { label: "Market vacancy rate",               unit: "%",  fmt: (v) => v.toFixed(1) + "%" },
    units:      { label: "Total housing units",               unit: "",   fmt: (v) => Math.round(v).toLocaleString() },
    pubUnits:   { label: "Public housing units",              unit: "",   fmt: (v) => Math.round(v).toLocaleString() },
  };

  const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  function runPolicy(cfg, policy) {
    const C = cfg.constants, S = cfg.sims, T = cfg.years, T1 = T + 1;
    const NB = cfg.neighborhoods, GR = cfg.incomeGroups;
    const N = NB.length, G = GR.length, K = C.incomeQuantiles, L = C.constructionLag;
    const uKeys = Object.keys(cfg.uncertain);

    const Z = new Float64Array(K);
    for (let k = 0; k < K; k++) Z[k] = RNG.invNorm((k + 0.5) / K);

    const out = { policy, S, T, N, G };
    for (const m of Object.keys(METRICS)) out[m] = new Float32Array(T1 * S);
    out.nbhdRent = new Float32Array(T1 * N * S);
    out.nbhdLow = new Float32Array(T1 * N * S);
    out.groups = new Float32Array(T1 * G * S);
    const trace = {};
    for (const k of ["recession", "cityDemandShock", "wageShock", "rentGrowth", "completions", "displacedYear", "inMovers", "tightness"])
      trace[k] = new Float32Array(T * S);
    out.trace = trace;
    out.params = {};
    for (const k of uKeys) out.params[k] = new Float32Array(S);

    // Policy-adjusted zoning factor per neighborhood.
    const zf = NB.map((n) => 1 - 0.5 * n.zoning * (1 - policy.zoningRelief));
    const zf0 = NB.map((n) => 1 - 0.5 * n.zoning);

    // Scratch arrays (G×N, row-major g*N+n)
    const GN = G * N;
    const housedMkt = new Float64Array(GN), housedPub = new Float64Array(GN);
    const desired = new Float64Array(GN), incomes = new Float64Array(GN);
    const burdenedShare = new Float64Array(GN), qualifies = new Float64Array(GN);
    const rents = new Float64Array(N), mktUnits = new Float64Array(N), pubUnits = new Float64Array(N);
    const realRG = new Float64Array(N);
    const pipe = Array.from({ length: L }, () => new Float64Array(N));
    const pubPipe = new Float64Array(L);
    const cumDisp = new Float64Array(GN);
    const spread = new Float64Array(K);

    for (let s = 0; s < S; s++) {
      const rng = RNG.makeStream(cfg.seed, s);

      // ---- Draw this simulation's uncertain parameters ----
      const P = {};
      for (const k of uKeys) {
        const u = cfg.uncertain[k];
        P[k] = rng.triangular(u.lo, u.mode, u.hi);
        out.params[k][s] = P[k];
      }
      const tau = 1 - (1 - policy.tenantProtection) * P.protectionEfficacy;
      for (let k = 0; k < K; k++) spread[k] = Math.exp(P.incomeSpread * Z[k]);

      // ---- Initial state ----
      for (let n = 0; n < N; n++) {
        rents[n] = NB[n].rent; mktUnits[n] = NB[n].units; pubUnits[n] = 0; realRG[n] = 0;
        // Projects already in the permitting pipeline were approved under current zoning.
        for (let l = 0; l < L; l++) pipe[l][n] = NB[n].units * NB[n].construction * zf0[n];
      }
      pubPipe.fill(0);
      for (let g = 0; g < G; g++) for (let n = 0; n < N; n++) {
        const i = g * N + n;
        housedMkt[i] = GR[g].share * NB[n].households;
        housedPub[i] = 0; desired[i] = housedMkt[i]; cumDisp[i] = 0;
        incomes[i] = GR[g].income * Math.exp(C.startingIncomeNoise * rng.normal());
      }
      let recession = 0;

      const computeBurden = () => {
        for (let g = 0; g < G; g++) for (let n = 0; n < N; n++) {
          const i = g * N + n, annual = 12 * rents[n];
          let b = 0, q = 0;
          for (let k = 0; k < K; k++) {
            const y = incomes[i] * spread[k];
            if (annual / y > C.burdenThreshold) b++;
            if (y >= C.landlordRule * annual) q++;
          }
          burdenedShare[i] = b / K; qualifies[i] = q / K;
        }
      };

      const record = (t) => {
        computeBurden();
        let hhAll = 0, burdenedAll = 0, low = 0, lowBurdened = 0, rentW = 0, mktHoused = 0, mktU = 0, pubU = 0;
        for (let n = 0; n < N; n++) {
          let hhN = 0;
          for (let g = 0; g < G; g++) {
            const i = g * N + n, h = housedMkt[i] + housedPub[i];
            hhN += h; burdenedAll += burdenedShare[i] * housedMkt[i];
            mktHoused += housedMkt[i];
            if (g === 0) { low += h; lowBurdened += burdenedShare[i] * housedMkt[i]; }
          }
          hhAll += hhN; rentW += rents[n] * hhN; mktU += mktUnits[n]; pubU += pubUnits[n];
          const idx = (t * N + n) * S + s;
          out.nbhdRent[idx] = rents[n];
          out.nbhdLow[idx] = (100 * (housedMkt[n] + housedPub[n])) / hhN;
        }
        for (let g = 0; g < G; g++) {
          let gs = 0;
          for (let n = 0; n < N; n++) gs += housedMkt[g * N + n] + housedPub[g * N + n];
          out.groups[(t * G + g) * S + s] = gs;
        }
        let dsum = 0;
        for (let i = 0; i < GN; i++) dsum += cumDisp[i];
        const o = t * S + s;
        out.rent[o] = rentW / hhAll;
        out.burden[o] = (100 * burdenedAll) / hhAll;
        out.burdenLow[o] = (100 * lowBurdened) / low;
        out.displaced[o] = dsum;
        out.lowShare[o] = (100 * low) / hhAll;
        out.vacancy[o] = 100 * (1 - mktHoused / mktU);
        out.units[o] = mktU + pubU;
        out.pubUnits[o] = pubU;
      };

      record(0);

      for (let t = 1; t <= T; t++) {
        const tr = (t - 1) * S + s;

        // A. ECONOMIC REGIME — two-state Markov chain (normal / recession).
        const uR = rng.uniform();
        recession = recession ? (uR < C.recessionStay ? 1 : 0) : (uR < P.recessionProb ? 1 : 0);
        trace.recession[tr] = recession;

        // B. DEMAND — households who want to live in each neighborhood.
        const cityShock = rng.normal(0, C.demandVol);
        trace.cityDemandShock[tr] = cityShock;
        for (let n = 0; n < N; n++) {
          const local = rng.normal(0, C.demandVol);
          const base = NB[n].demand + cityShock + local - P.demandElasticity * realRG[n] - C.recessionDemandHit * recession;
          for (let g = 0; g < G; g++) desired[g * N + n] *= 1 + clip(base + GR[g].demandAdj, -0.05, 0.15);
        }

        // C. INCOMES
        const wage = rng.normal(0, C.incomeVol);
        trace.wageShock[tr] = wage;
        for (let g = 0; g < G; g++) for (let n = 0; n < N; n++) {
          const gr = GR[g].growth + wage + rng.normal(0, C.incomeVol) - C.recessionIncomeHit * recession;
          incomes[g * N + n] *= 1 + clip(gr, -0.10, 0.15);
        }

        // D. CONSTRUCTION — starts today finish L years from now.
        let completions = 0;
        const done = pipe.shift();
        const starts = new Float64Array(N);
        for (let n = 0; n < N; n++) {
          mktUnits[n] += done[n]; completions += done[n];
          starts[n] = mktUnits[n] * NB[n].construction * zf[n]
            * Math.max(0, 1 + P.supplyResponse * realRG[n])
            * policy.constructionPenalty
            * (recession ? C.recessionBuildFactor : 1);
        }
        pipe.push(starts);

        // Public units: split by population, filled by low-income households.
        const pubDone = pubPipe[0];
        for (let l = 0; l < L - 1; l++) pubPipe[l] = pubPipe[l + 1];
        pubPipe[L - 1] = policy.publicUnits;
        if (pubDone > 0) {
          let tot = 0; const hhN = new Float64Array(N);
          for (let n = 0; n < N; n++) { for (let g = 0; g < G; g++) hhN[n] += housedMkt[g * N + n] + housedPub[g * N + n]; tot += hhN[n]; }
          for (let n = 0; n < N; n++) {
            const add = (pubDone * hhN[n]) / tot;
            pubUnits[n] += add; completions += add;
            const movers = Math.min(0.5 * add, housedMkt[n]);   // half from existing market tenants
            housedMkt[n] -= movers;
            housedPub[n] += add;
            desired[n] = Math.max(desired[n], housedMkt[n] + housedPub[n]);
          }
        }
        trace.completions[tr] = completions;

        // E. DISPLACEMENT
        let dispYear = 0;
        for (let g = 0; g < G; g++) for (let n = 0; n < N; n++) {
          const i = g * N + n, annual = 12 * rents[n];
          let pSum = 0;
          for (let k = 0; k < K; k++) {
            const excess = Math.max(annual / (incomes[i] * spread[k]) - C.burdenThreshold, 0);
            pSum += clip(C.baseDisplacement + P.displacementSlope * excess, 0, C.maxDisplacement);
          }
          const p = clip((pSum / K) * GR[g].sens * tau, 0, C.maxDisplacement);
          const d = Math.min(rng.binomial(Math.round(housedMkt[i]), p), housedMkt[i]);
          housedMkt[i] -= d; desired[i] -= d; cumDisp[i] += d; dispYear += d;
        }
        trace.displacedYear[tr] = dispYear;

        // F. IN-MOVERS — vacant units go to qualified households who want in.
        computeBurden();
        let movedIn = 0;
        for (let n = 0; n < N; n++) {
          let occ = 0, elig = 0;
          const e = new Float64Array(G);
          for (let g = 0; g < G; g++) {
            const i = g * N + n;
            occ += housedMkt[i];
            e[g] = Math.max(desired[i] - housedMkt[i] - housedPub[i], 0) * qualifies[i];
            elig += e[g];
          }
          const open = Math.max(mktUnits[n] * (1 - C.frictionalVacancy) - occ, 0);
          const fill = Math.min(open, elig);
          if (elig > 0) for (let g = 0; g < G; g++) housedMkt[g * N + n] += (e[g] / elig) * fill;
          movedIn += fill;
        }
        trace.inMovers[tr] = movedIn;

        // G. RENTS — effective demand vs. supply.
        let rgW = 0, hhTot = 0, tightW = 0;
        for (let n = 0; n < N; n++) {
          let eff = 0, hhN = 0;
          for (let g = 0; g < G; g++) {
            const i = g * N + n;
            eff += housedMkt[i] + Math.max(desired[i] - housedMkt[i] - housedPub[i], 0) * qualifies[i];
            hhN += housedMkt[i] + housedPub[i];
          }
          const tight = eff / mktUnits[n] - (1 - C.vacancyTarget);
          const rg = clip(C.inflation + P.rentResponse * tight + rng.normal(0, C.rentVol), -0.10, 0.25);
          rents[n] *= 1 + rg;
          realRG[n] = rg - C.inflation;
          rgW += rg * hhN; tightW += tight * hhN; hhTot += hhN;
        }
        trace.rentGrowth[tr] = rgW / hhTot;
        trace.tightness[tr] = tightW / hhTot;

        // H. RECORD
        record(t);
      }
    }
    return out;
  }

  // ---------- Statistics helpers ----------
  function column(arr, t, S) { return arr.subarray(t * S, (t + 1) * S); }
  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function summarize(values) {
    const a = Float64Array.from(values).sort();
    let sum = 0, sq = 0;
    for (const v of a) { sum += v; sq += v * v; }
    const n = a.length, mean = sum / n, sd = Math.sqrt(Math.max(sq / n - mean * mean, 0) * n / (n - 1));
    return { mean, sd, se: sd / Math.sqrt(n), p05: quantile(a, 0.05), p10: quantile(a, 0.10), p25: quantile(a, 0.25),
             median: quantile(a, 0.5), p75: quantile(a, 0.75), p90: quantile(a, 0.90), p95: quantile(a, 0.95), min: a[0], max: a[n - 1] };
  }
  function ranks(v) {
    const idx = Array.from(v, (x, i) => i).sort((a, b) => v[a] - v[b]);
    const r = new Float64Array(v.length);
    idx.forEach((j, k) => (r[j] = k));
    return r;
  }
  function spearman(x, y) {
    const rx = ranks(x), ry = ranks(y), n = x.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += rx[i]; my += ry[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  }

  root.Model = { DEFAULTS, POLICIES, METRICS, runPolicy, column, summarize, quantile, spearman };
})(typeof window !== "undefined" ? window : globalThis);
