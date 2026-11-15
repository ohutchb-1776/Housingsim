// Plotly chart builders.
(function (root) {
  "use strict";
  const { METRICS, column, summarize, quantile } = Model;

  const INK = "#e6edf3", MUTED = "#8b949e", GRID = "#252c36";
  const GROUP_COLORS = ["#f85149", "#f0883e", "#58a6ff", "#a371f7"];
  const CONFIG = { displayModeBar: false, responsive: true };

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function base(extra = {}) {
    const ax = { gridcolor: GRID, zerolinecolor: GRID, linecolor: GRID, tickfont: { color: MUTED, size: 11 }, titlefont: { color: MUTED, size: 12 } };
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: INK, size: 12 },
      margin: { l: 64, r: 20, t: 14, b: 46 },
      xaxis: { ...ax }, yaxis: { ...ax },
      legend: { orientation: "h", y: -0.18, font: { size: 12 } },
      hoverlabel: { bgcolor: "#1a2029", bordercolor: "#2a313c", font: { color: INK } },
    }, extra);
  }
  const axis = (title, more = {}) => ({ title: { text: title }, gridcolor: GRID, zerolinecolor: GRID, linecolor: GRID, tickfont: { color: MUTED, size: 11 }, ...more });
  const prefix = (m) => (METRICS[m].unit === "$" ? "$" : "");
  const suffix = (m) => (METRICS[m].unit === "%" ? "%" : "");

  // Per-year percentiles, cached.
  const cache = new Map();
  function bands(res, metric) {
    const key = res.policy.id + "|" + metric + "|" + res.stamp;
    if (cache.has(key)) return cache.get(key);
    const out = { p10: [], p50: [], p90: [], mean: [] };
    for (let t = 0; t <= res.T; t++) {
      const sm = summarize(column(res[metric], t, res.S));
      out.p10.push(sm.p10); out.p50.push(sm.median); out.p90.push(sm.p90); out.mean.push(sm.mean);
    }
    cache.set(key, out);
    return out;
  }

  function fan(el, results, metric, showPaths) {
    const years = [...Array(results[0].T + 1).keys()];
    const traces = [];
    for (const r of results) {
      const c = r.policy.color, b = bands(r, metric);
      if (showPaths) {
        const nPaths = Math.min(40, r.S);
        for (let i = 0; i < nPaths; i++) {
          const s = Math.floor((i * r.S) / nPaths);
          traces.push({ x: years, y: years.map((t) => r[metric][t * r.S + s]), mode: "lines",
            line: { color: rgba(c, 0.16), width: 1 }, hoverinfo: "skip", showlegend: false, legendgroup: r.policy.id });
        }
      }
      traces.push({ x: years.concat([...years].reverse()), y: b.p90.concat([...b.p10].reverse()), fill: "toself",
        fillcolor: rgba(c, 0.13), line: { width: 0 }, hoverinfo: "skip", showlegend: false, legendgroup: r.policy.id });
      traces.push({ x: years, y: b.p50, mode: "lines", name: r.policy.name, legendgroup: r.policy.id,
        line: { color: c, width: 3 },
        customdata: years.map((t) => [b.p10[t], b.p90[t]]),
        hovertemplate: `<b>${r.policy.name}</b><br>Year %{x}<br>Median ${prefix(metric)}%{y:,.1f}${suffix(metric)}` +
          `<br>80% of runs: ${prefix(metric)}%{customdata[0]:,.0f}–${prefix(metric)}%{customdata[1]:,.0f}${suffix(metric)}<extra></extra>` });
    }
    Plotly.react(el, traces, base({
      xaxis: axis("Year"), yaxis: axis(METRICS[metric].label, { tickprefix: prefix(metric), ticksuffix: suffix(metric) }),
      hovermode: "closest",
    }), CONFIG);
  }

  function tradeoff(el, results) {
    const traces = [];
    for (const r of results) {
      const c = r.policy.color, T = r.T, S = r.S;
      const x = Array.from(column(r.displaced, T, S)), y = Array.from(column(r.rent, T, S));
      traces.push({ x, y, mode: "markers", type: "scattergl", name: r.policy.name, legendgroup: r.policy.id,
        marker: { color: rgba(c, 0.35), size: 4 }, hovertemplate: `${r.policy.name}<br>%{x:,.0f} displaced<br>$%{y:,.0f}/mo<extra></extra>`, showlegend: false });
      const low = summarize(column(r.lowShare, T, S)).median;
      traces.push({ x: [summarize(x).median], y: [summarize(y).median], mode: "markers+text", name: r.policy.name,
        legendgroup: r.policy.id, text: [r.policy.name], textposition: "top center", textfont: { color: c, size: 12 },
        marker: { color: rgba(c, 0.5), size: 14 + low * 1.4, line: { color: c, width: 2.5 } },
        hovertemplate: `<b>${r.policy.name}</b> (median)<br>%{x:,.0f} displaced<br>$%{y:,.0f}/mo<br>${low.toFixed(1)}% low-income remain<extra></extra>` });
    }
    Plotly.react(el, traces, base({ showlegend: false,
      xaxis: axis("Households displaced (cumulative)"), yaxis: axis("Final-year rent", { tickprefix: "$" }) }), CONFIG);
  }

  function stay(el, res, groupNames) {
    const years = [...Array(res.T + 1).keys()], G = res.G, S = res.S;
    const med = [];
    for (let g = 0; g < G; g++) med.push(years.map((t) => quantile(Float64Array.from(res.groups.subarray((t * G + g) * S, (t * G + g + 1) * S)).sort(), 0.5)));
    const tot = years.map((t) => med.reduce((a, m) => a + m[t], 0));
    const traces = med.map((m, g) => ({ x: years, y: m.map((v, t) => (100 * v) / tot[t]), stackgroup: "one", name: groupNames[g] + " income",
      line: { width: 0.5, color: GROUP_COLORS[g] }, fillcolor: rgba(GROUP_COLORS[g], 0.85),
      hovertemplate: `${groupNames[g]}: %{y:.1f}%<extra></extra>` }));
    Plotly.react(el, traces, base({ hovermode: "x unified", xaxis: axis("Year"), yaxis: axis("Share of residents", { ticksuffix: "%", range: [0, 100] }) }), CONFIG);
  }

  function heat(el, results, nbhds, mode) {
    const N = nbhds.length;
    const z = [], text = [];
    for (let n = 0; n < N; n++) {
      const row = [], trow = [];
      for (const r of results) {
        const S = r.S, T = r.T;
        const med = (arr, t) => quantile(Float64Array.from(arr.subarray((t * N + n) * S, (t * N + n + 1) * S)).sort(), 0.5);
        let v;
        if (mode === "rentchg") v = 100 * (med(r.nbhdRent, T) / med(r.nbhdRent, 0) - 1);
        else if (mode === "low") v = med(r.nbhdLow, T);
        else v = med(r.nbhdRent, T);
        row.push(v);
        trow.push(mode === "rent" ? "$" + Math.round(v).toLocaleString() : (mode === "rentchg" ? (v > 0 ? "+" : "") : "") + v.toFixed(0) + "%");
      }
      z.push(row); text.push(trow);
    }
    const good = mode === "low";
    const scale = good ? [[0, "#8b1d1d"], [0.5, "#1a2029"], [1, "#1f7a3a"]] : [[0, "#1f4f99"], [0.5, "#1a2029"], [1, "#a32626"]];
    Plotly.react(el, [{ type: "heatmap", z, x: results.map((r) => r.policy.name), y: nbhds, text, texttemplate: "%{text}",
      textfont: { color: "#fff", size: 13 }, colorscale: scale, showscale: false, xgap: 3, ygap: 3,
      hovertemplate: "%{y} · %{x}<br>%{text}<extra></extra>" }],
      base({ margin: { l: 100, r: 10, t: 10, b: 90 }, xaxis: { tickfont: { color: INK, size: 11 }, showgrid: false, tickangle: -25, automargin: true },
        yaxis: { tickfont: { color: INK, size: 12 }, showgrid: false, autorange: "reversed" } }), CONFIG);
  }

  function dist(el, results, metric) {
    const traces = results.map((r) => ({ type: "histogram", x: Array.from(column(r[metric], r.T, r.S)), name: r.policy.name,
      marker: { color: rgba(r.policy.color, 0.55), line: { color: r.policy.color, width: 1 } }, nbinsx: 40, histnorm: "probability",
      hovertemplate: `${r.policy.name}<br>%{x}<br>%{y:.1%} of runs<extra></extra>` }));
    Plotly.react(el, traces, base({ barmode: "overlay", xaxis: axis(METRICS[metric].label, { tickprefix: prefix(metric), ticksuffix: suffix(metric) }),
      yaxis: axis("Share of runs", { tickformat: ".0%" }) }), CONFIG);
  }

  function runChart(el, res, s) {
    const T = res.T, S = res.S, years = [...Array(T + 1).keys()], c = res.policy.color, b = bands(res, "rent");
    const shapes = [];
    for (let t = 1; t <= T; t++) if (res.trace.recession[(t - 1) * S + s])
      shapes.push({ type: "rect", xref: "x", yref: "paper", x0: t - 0.5, x1: t + 0.5, y0: 0, y1: 1, fillcolor: "rgba(248,81,73,.13)", line: { width: 0 }, layer: "below" });
    const traces = [
      { x: years.concat([...years].reverse()), y: b.p90.concat([...b.p10].reverse()), fill: "toself", fillcolor: rgba(c, 0.12), line: { width: 0 }, name: "Middle 80% of all runs", hoverinfo: "skip" },
      { x: years, y: b.p50, mode: "lines", line: { color: c, width: 1.5, dash: "dot" }, name: "Median of all runs", hovertemplate: "Median $%{y:,.0f}<extra></extra>" },
      { x: years, y: years.map((t) => res.rent[t * S + s]), mode: "lines+markers", line: { color: "#fff", width: 3 }, marker: { size: 5, color: c },
        name: `Run #${s}`, hovertemplate: "Year %{x}: $%{y:,.0f}<extra></extra>" },
      { x: years.slice(1), y: years.slice(1).map((t) => res.trace.displacedYear[(t - 1) * S + s]), type: "bar", yaxis: "y2",
        marker: { color: "rgba(248,81,73,.28)" }, name: "Displaced that year", hovertemplate: "%{y:,.0f} displaced<extra></extra>" },
    ];
    traces.unshift(traces.pop());
    let maxD = 0;
    for (let t = 1; t <= T; t++) maxD = Math.max(maxD, res.trace.displacedYear[(t - 1) * S + s]);
    Plotly.react(el, traces, base({ shapes, xaxis: axis("Year"), yaxis: axis("City rent", { tickprefix: "$" }),
      yaxis2: axis("Displaced per year", { overlaying: "y", side: "right", showgrid: false, range: [0, maxD * 2.4 || 1] }),
      margin: { l: 64, r: 64, t: 14, b: 46 },
      annotations: shapes.length ? [{ xref: "paper", yref: "paper", x: 1, y: 1.06, xanchor: "right", showarrow: false,
        text: "<span style='color:#f85149'>■</span> recession years", font: { color: MUTED, size: 11 } }] : [] }), CONFIG);
  }

  function tornado(el, items, onClick) {
    const sorted = [...items].sort((a, b) => Math.abs(a.rho) - Math.abs(b.rho));
    Plotly.react(el, [{ type: "bar", orientation: "h", x: sorted.map((d) => d.rho), y: sorted.map((d) => d.label),
      customdata: sorted.map((d) => d.key),
      marker: { color: sorted.map((d) => (d.rho > 0 ? "#f0883e" : "#58a6ff")) },
      text: sorted.map((d) => (d.rho > 0 ? "+" : "") + d.rho.toFixed(2)), textposition: "outside", textfont: { color: INK },
      hovertemplate: "%{y}<br>ρ = %{x:.3f}<extra></extra>" }],
      base({ margin: { l: 250, r: 40, t: 10, b: 46 }, xaxis: axis("Spearman correlation with outcome", { range: [-1, 1], zeroline: true, zerolinecolor: MUTED }),
        yaxis: { tickfont: { color: INK, size: 12 }, automargin: true } }), CONFIG);
    el.removeAllListeners && el.removeAllListeners("plotly_click");
    el.on("plotly_click", (e) => onClick(e.points[0].customdata));
  }

  function sensScatter(el, x, y, xLabel, metric, color) {
    Plotly.react(el, [{ x: Array.from(x), y: Array.from(y), mode: "markers", type: "scattergl",
      marker: { color: rgba(color, 0.5), size: 5 }, hovertemplate: `${xLabel}: %{x:.3f}<br>%{y:,.1f}<extra></extra>` }],
      base({ xaxis: axis(xLabel), yaxis: axis(METRICS[metric].label, { tickprefix: prefix(metric), ticksuffix: suffix(metric) }) }), CONFIG);
  }

  function convergence(el, results, metric) {
    const traces = [];
    const notes = [];
    for (const r of results) {
      const v = column(r[metric], r.T, r.S), xs = [], m = [], lo = [], hi = [];
      let sum = 0, sq = 0;
      for (let i = 0; i < v.length; i++) {
        sum += v[i]; sq += v[i] * v[i];
        const n = i + 1;
        if (n < 5) continue;
        const mean = sum / n, sd = Math.sqrt(Math.max(sq / n - mean * mean, 0) * n / (n - 1)), se = sd / Math.sqrt(n);
        xs.push(n); m.push(mean); lo.push(mean - 1.96 * se); hi.push(mean + 1.96 * se);
      }
      const c = r.policy.color;
      traces.push({ x: xs.concat([...xs].reverse()), y: hi.concat([...lo].reverse()), fill: "toself", fillcolor: rgba(c, 0.15), line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      traces.push({ x: xs, y: m, mode: "lines", line: { color: c, width: 2 }, name: r.policy.name,
        hovertemplate: `${r.policy.name}<br>After %{x} runs: ${prefix(metric)}%{y:,.1f}${suffix(metric)}<extra></extra>` });
      notes.push({ name: r.policy.name, mean: m[m.length - 1], half: hi[hi.length - 1] - m[m.length - 1] });
    }
    Plotly.react(el, traces, base({ xaxis: axis("Number of runs (log scale)", { type: "log", tickvals: [5, 10, 20, 50, 100, 200, 500, 1000, 2000], ticktext: ["5", "10", "20", "50", "100", "200", "500", "1,000", "2,000"] }), yaxis: axis("Running average, " + METRICS[metric].label, { tickprefix: prefix(metric), ticksuffix: suffix(metric) }) }), CONFIG);
    return notes;
  }

  function spark(el, values, color) {
    Plotly.react(el, [{ type: "histogram", x: Array.from(values), nbinsx: 24, marker: { color: rgba(color, 0.8) }, hoverinfo: "skip" }],
      { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", margin: { l: 0, r: 0, t: 0, b: 0 },
        xaxis: { visible: false }, yaxis: { visible: false }, bargap: 0.05 }, { staticPlot: true, responsive: true });
  }

  root.Charts = { fan, tradeoff, stay, heat, dist, runChart, tornado, sensScatter, convergence, spark, bands, clearCache: () => cache.clear() };
})(window);
