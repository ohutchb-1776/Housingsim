// Page logic: read inputs, run the Monte Carlo, render results.
(function () {
  "use strict";
  const { DEFAULTS, POLICIES, METRICS, column, summarize, spearman } = Model;
  const $ = (id) => document.getElementById(id);
  const fmt = (m, v) => METRICS[m].fmt(v);

  let cfg = structuredClone(DEFAULTS);
  let results = [];
  let stamp = 0;

  // ---------- Inputs ----------
  function customPolicy() {
    return { id: "custom", name: "My Policy", color: "#f778ba",
      zoningRelief: +$("c-zr").value, publicUnits: +$("c-pu").value,
      tenantProtection: +$("c-tp").value, constructionPenalty: +$("c-cp").value,
      desc: "Your custom combination." };
  }
  function activePolicies() {
    return $("in-custom").checked ? [...POLICIES, customPolicy()] : [...POLICIES];
  }
  function updateSliderLabels() {
    $("o-zr").textContent = Math.round(+$("c-zr").value * 100) + "%";
    $("o-pu").textContent = $("c-pu").value;
    $("o-tp").textContent = (+$("c-tp").value).toFixed(2) + "×";
    $("o-cp").textContent = (+$("c-cp").value).toFixed(2) + "×";
  }

  const NB_COLS = [
    ["name", "Neighborhood", (v) => v], ["rent", "Rent ($/mo)", (v) => v], ["households", "Households", (v) => v],
    ["units", "Units", (v) => v], ["demand", "Demand growth", (v) => v], ["construction", "Build rate", (v) => v],
    ["zoning", "Zoning (0 open – 1 strict)", (v) => v],
  ];
  const GR_COLS = [
    ["name", "Group"], ["share", "Share of households"], ["income", "Median income ($)"], ["growth", "Income growth"],
    ["demandAdj", "Demand adj."], ["sens", "Displacement sensitivity"],
  ];

  function editableTable(el, rows, cols) {
    let h = "<table><thead><tr>" + cols.map((c) => `<th>${c[1]}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach((r, i) => {
      h += "<tr>" + cols.map((c, j) => j === 0 ? `<td>${r[c[0]]}</td>` : `<td contenteditable data-row="${i}" data-key="${c[0]}">${r[c[0]]}</td>`).join("") + "</tr>";
    });
    el.innerHTML = h + "</tbody></table>";
  }
  function readEditable(el, rows) {
    el.querySelectorAll("td[contenteditable]").forEach((td) => {
      const v = parseFloat(td.textContent.replace(/[$,%\s]/g, ""));
      if (isFinite(v)) rows[+td.dataset.row][td.dataset.key] = v;
      else td.textContent = rows[+td.dataset.row][td.dataset.key];
    });
  }
  function renderInputs() {
    editableTable($("table-nbhd"), cfg.neighborhoods, NB_COLS);
    editableTable($("table-groups"), cfg.incomeGroups, GR_COLS);
    const pol = activePolicies();
    $("table-policies").innerHTML = "<table><thead><tr><th>Policy</th><th>Zoning relief</th><th>Public units / yr</th><th>Displacement ×</th><th>Construction ×</th><th style='text-align:left'>Description</th></tr></thead><tbody>" +
      pol.map((p) => `<tr><td style="color:${p.color};font-weight:600">${p.name}</td><td>${Math.round(p.zoningRelief * 100)}%</td><td>${p.publicUnits}</td><td>${p.tenantProtection.toFixed(2)}</td><td>${p.constructionPenalty.toFixed(2)}</td><td style="text-align:left;white-space:normal;color:#c9d1d9">${p.desc}</td></tr>`).join("") +
      "</tbody></table>";
  }

  // ---------- Run ----------
  function run() {
    readEditable($("table-nbhd"), cfg.neighborhoods);
    readEditable($("table-groups"), cfg.incomeGroups);
    cfg.sims = +$("in-sims").value;
    cfg.years = Math.max(5, Math.min(40, Math.round(+$("in-years").value) || 20));
    $("in-years").value = cfg.years;
    cfg.seed = Math.round(+$("in-seed").value) || 0;

    const pols = activePolicies();
    const out = [];
    const btn = $("btn-run");
    btn.disabled = true;
    stamp++;
    Charts.clearCache();
    const t0 = performance.now();
    let i = 0;
    const step = () => {
      $("run-status").textContent = `Simulating ${pols[i].name}… (${i + 1}/${pols.length})`;
      $("progress-bar").style.width = (100 * i) / pols.length + "%";
      setTimeout(() => {
        const r = Model.runPolicy(cfg, pols[i]);
        r.stamp = stamp;
        out.push(r);
        i++;
        if (i < pols.length) step();
        else {
          results = out;
          $("progress-bar").style.width = "100%";
          const total = cfg.sims * pols.length;
          $("run-status").textContent = `Done: ${total.toLocaleString()} simulated futures × ${cfg.years} years in ${((performance.now() - t0) / 1000).toFixed(1)}s (seed ${cfg.seed}).`;
          btn.disabled = false;
          renderAll();
        }
      }, 30);
    };
    step();
  }

  // ---------- Render ----------
  function fillSelect(el, opts, keep) {
    const prev = el.value;
    el.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    if (keep && opts.some(([v]) => v === prev)) el.value = prev;
  }
  const metricOpts = Object.entries(METRICS).map(([k, m]) => [k, m.label]);
  const outcomeOpts = ["rent", "burden", "displaced", "lowShare"].map((k) => [k, METRICS[k].label]);

  function renderAll() {
    const T = cfg.years, S = cfg.sims, pol = results.map((r) => r.policy);
    document.querySelectorAll(".js-sims").forEach((e) => (e.textContent = S.toLocaleString()));
    document.querySelectorAll(".js-total").forEach((e) => (e.textContent = (S * pol.length).toLocaleString()));
    $("res-sub").textContent = `· year ${T}, ${S.toLocaleString()} runs per policy`;

    const polOpts = pol.map((p, i) => [String(i), p.name]);
    fillSelect($("sel-stay-policy"), polOpts, true);
    fillSelect($("sel-run-policy"), polOpts, true);
    fillSelect($("sel-sens-policy"), polOpts, true);
    $("in-run").max = S - 1;
    if (+$("in-run").value > S - 1) $("in-run").value = 0;

    renderCards(); renderFan(); renderTradeoff(); renderStay(); renderHeat(); renderDist();
    renderTable(); renderUncertain(); renderRun(); renderSens(); renderConv(); renderInputs();
  }

  function renderCards() {
    const T = cfg.years, thr = +$("in-threshold").value;
    const sq = results[0];
    const sqMed = (m) => summarize(column(sq[m], T, sq.S)).median;
    $("cards").innerHTML = results.map((r) => {
      const st = (m) => summarize(column(r[m], T, r.S));
      const rent = st("rent");
      const v = column(r.rent, T, r.S);
      let over = 0; for (const x of v) if (x > thr) over++;
      const pOver = (100 * over) / v.length;
      const d = rent.median - sqMed("rent");
      const delta = r === sq ? "<span class='muted'>baseline</span>"
        : `<span class="${d > 0 ? "delta-bad" : "delta-good"}">${d > 0 ? "+" : "−"}$${Math.abs(Math.round(d)).toLocaleString()} vs. status quo</span>`;
      return `<div class="card" style="--c:${r.policy.color}">
        <h4>${r.policy.name}</h4>
        <div class="big">${fmt("rent", rent.median)}<span class="muted" style="font-size:14px">/mo</span></div>
        <div class="range">80% of runs: ${fmt("rent", rent.p10)} – ${fmt("rent", rent.p90)}<br>${delta}</div>
        <div class="row"><span>Chance rent &gt; $${thr.toLocaleString()}</span><b>${pOver.toFixed(0)}%</b></div>
        <div class="row"><span>Rent-burdened</span><b>${fmt("burden", st("burden").median)}</b></div>
        <div class="row"><span>Displaced</span><b>${fmt("displaced", st("displaced").median)}</b></div>
        <div class="row"><span>Low-income share</span><b>${fmt("lowShare", st("lowShare").median)}</b></div>
      </div>`;
    }).join("");
  }

  const renderFan = () => Charts.fan($("chart-fan"), results, $("sel-fan-metric").value, $("chk-paths").checked);
  const renderTradeoff = () => Charts.tradeoff($("chart-tradeoff"), results);
  const renderStay = () => Charts.stay($("chart-stay"), results[+$("sel-stay-policy").value || 0], cfg.incomeGroups.map((g) => g.name));
  const renderHeat = () => Charts.heat($("chart-heat"), results, cfg.neighborhoods.map((n) => n.name), $("sel-heat").value);
  const renderDist = () => Charts.dist($("chart-dist"), results, $("sel-dist-metric").value);

  function renderTable() {
    const T = cfg.years, ms = Object.keys(METRICS);
    let h = "<table><thead><tr><th>Policy</th>" + ms.map((m) => `<th>${METRICS[m].label}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of results) {
      h += `<tr><td style="color:${r.policy.color};font-weight:600">${r.policy.name}</td>` + ms.map((m) => {
        const s = summarize(column(r[m], T, r.S));
        return `<td>${fmt(m, s.median)}<span class="sub">${fmt(m, s.p10)} – ${fmt(m, s.p90)}</span></td>`;
      }).join("") + "</tr>";
    }
    $("table-results").innerHTML = h + "</tbody></table>";
  }

  function downloadCSV() {
    const lines = ["policy,year,metric,mean,median,p05,p10,p25,p75,p90,p95,std_dev"];
    for (const r of results) for (let t = 0; t <= r.T; t++) for (const m of Object.keys(METRICS)) {
      const s = summarize(column(r[m], t, r.S));
      lines.push([r.policy.name, t, m, s.mean, s.median, s.p05, s.p10, s.p25, s.p75, s.p90, s.p95, s.sd].map((v) => (typeof v === "number" ? +v.toFixed(4) : `"${v}"`)).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `portland_monte_carlo_seed${cfg.seed}_${cfg.sims}runs.csv`;
    a.click();
  }

  function renderUncertain() {
    const keys = Object.keys(cfg.uncertain), r = results[0];
    let h = "<table><thead><tr><th>Symbol</th><th style='text-align:left'>What it means</th><th>Low</th><th>Most likely</th><th>High</th><th>Values drawn</th></tr></thead><tbody>";
    keys.forEach((k) => {
      const u = cfg.uncertain[k];
      h += `<tr><td class="sym" data-tex="${u.sym}"></td><td style="text-align:left">${u.label}</td><td>${u.lo}</td><td>${u.mode}</td><td>${u.hi}</td><td><div class="spark" id="spark-${k}"></div></td></tr>`;
    });
    $("table-uncertain").innerHTML = h + "</tbody></table>";
    if (window.katex) document.querySelectorAll("#table-uncertain .sym").forEach((td) => katex.render(td.dataset.tex, td));
    else document.querySelectorAll("#table-uncertain .sym").forEach((td) => (td.textContent = td.dataset.tex.replace("\\", "")));
    keys.forEach((k) => Charts.spark($("spark-" + k), r.params[k], "#f0883e"));
  }

  function pickRun(mode) {
    const r = results[+$("sel-run-policy").value || 0], v = column(r.rent, r.T, r.S);
    let s = 0;
    if (mode === "rand") s = Math.floor(Math.random() * r.S);
    else for (let i = 1; i < v.length; i++) if (mode === "worst" ? v[i] > v[s] : v[i] < v[s]) s = i;
    $("in-run").value = s;
    renderRun();
  }

  function renderRun() {
    const r = results[+$("sel-run-policy").value || 0];
    const s = Math.max(0, Math.min(r.S - 1, Math.round(+$("in-run").value) || 0));
    $("in-run").value = s;
    const S = r.S, T = r.T;
    $("run-params").innerHTML = "<span class='muted small' style='align-self:center'>This run drew:</span>" +
      Object.keys(cfg.uncertain).map((k) => {
        const u = cfg.uncertain[k], v = r.params[k][s];
        return `<span class="chip">${u.label}: <b>${v.toFixed(k === "supplyResponse" ? 2 : 3)}</b></span>`;
      }).join("");
    Charts.runChart($("chart-run"), r, s);
    const pct = (v) => (v >= 0 ? "+" : "") + (100 * v).toFixed(2) + "%";
    let h = "<table><thead><tr><th>Year</th><th>Economy</th><th>City demand shock</th><th>Wage shock</th><th>Units completed</th><th>Displaced</th><th>Moved in</th><th>Market tightness</th><th>Rent growth</th><th>City rent</th><th>Burdened</th></tr></thead><tbody>";
    h += `<tr><td>0</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmt("rent", r.rent[s])}</td><td>${fmt("burden", r.burden[s])}</td></tr>`;
    for (let t = 1; t <= T; t++) {
      const i = (t - 1) * S + s, rec = r.trace.recession[i];
      h += `<tr class="${rec ? "recession" : ""}"><td>${t}</td><td>${rec ? "<b style='color:#f85149'>Recession</b>" : "Normal"}</td>
        <td>${pct(r.trace.cityDemandShock[i])}</td><td>${pct(r.trace.wageShock[i])}</td>
        <td>${Math.round(r.trace.completions[i]).toLocaleString()}</td><td>${Math.round(r.trace.displacedYear[i]).toLocaleString()}</td>
        <td>${Math.round(r.trace.inMovers[i]).toLocaleString()}</td><td>${pct(r.trace.tightness[i])}</td>
        <td>${pct(r.trace.rentGrowth[i])}</td><td>${fmt("rent", r.rent[t * S + s])}</td><td>${fmt("burden", r.burden[t * S + s])}</td></tr>`;
    }
    $("table-run").innerHTML = h + "</tbody></table>";
  }

  let sensKey = null;
  function renderSens() {
    const r = results[+$("sel-sens-policy").value || 0], m = $("sel-sens-metric").value;
    const y = column(r[m], r.T, r.S);
    const items = Object.keys(cfg.uncertain).map((k) => ({ key: k, label: cfg.uncertain[k].label, rho: spearman(r.params[k], y) }));
    const rec = new Float64Array(r.S);
    for (let s = 0; s < r.S; s++) for (let t = 0; t < r.T; t++) rec[s] += r.trace.recession[t * r.S + s];
    items.push({ key: "_recYears", label: "Number of recession years", rho: spearman(rec, y), values: rec });
    if (!sensKey || !items.some((d) => d.key === sensKey))
      sensKey = items.reduce((a, b) => (Math.abs(b.rho) > Math.abs(a.rho) ? b : a)).key;
    Charts.tornado($("chart-tornado"), items, (k) => { sensKey = k; renderSensScatter(items, r, y, m); });
    renderSensScatter(items, r, y, m);
  }
  function renderSensScatter(items, r, y, m) {
    const it = items.find((d) => d.key === sensKey);
    const x = it.values || r.params[sensKey];
    Charts.sensScatter($("chart-sens-scatter"), x, y, `${it.label} (ρ = ${it.rho.toFixed(2)})`, m, r.policy.color);
  }

  function renderConv() {
    const m = $("sel-conv-metric").value;
    const notes = Charts.convergence($("chart-conv"), results, m);
    const n = notes[0];
    $("conv-note").innerHTML = `With ${cfg.sims.toLocaleString()} runs, the Status Quo average for <b>${METRICS[m].label.toLowerCase()}</b> is
      <b>${fmt(m, n.mean)}</b>, accurate to about <b>±${fmt(m, n.half).replace("-", "")}</b> (95% confidence).
      Doubling the runs would shrink that margin by a factor of √2 ≈ 1.41.`;
  }

  // ---------- Wire up ----------
  function init() {
    fillSelect($("sel-fan-metric"), metricOpts);
    fillSelect($("sel-dist-metric"), outcomeOpts);
    fillSelect($("sel-sens-metric"), outcomeOpts);
    fillSelect($("sel-conv-metric"), outcomeOpts);
    updateSliderLabels();
    renderInputs();

    $("btn-run").onclick = run;
    $("btn-dice").onclick = () => { $("in-seed").value = Math.floor(Math.random() * 1e6); };
    $("in-custom").onchange = () => { $("custom-policy").classList.toggle("hidden", !$("in-custom").checked); renderInputs(); };
    ["c-zr", "c-pu", "c-tp", "c-cp"].forEach((id) => ($(id).oninput = () => { updateSliderLabels(); }));
    $("sel-fan-metric").onchange = renderFan;
    $("chk-paths").onchange = renderFan;
    $("sel-stay-policy").onchange = renderStay;
    $("sel-heat").onchange = renderHeat;
    $("sel-dist-metric").onchange = renderDist;
    $("in-threshold").oninput = renderCards;
    $("btn-csv").onclick = downloadCSV;
    $("sel-run-policy").onchange = renderRun;
    $("in-run").onchange = renderRun;
    $("btn-run-rand").onclick = () => pickRun("rand");
    $("btn-run-worst").onclick = () => pickRun("worst");
    $("btn-run-best").onclick = () => pickRun("best");
    $("sel-sens-policy").onchange = renderSens;
    $("sel-sens-metric").onchange = () => { sensKey = null; renderSens(); };
    $("sel-conv-metric").onchange = renderConv;
    $("btn-reset").onclick = () => { cfg = structuredClone(DEFAULTS); renderInputs(); run(); };

    if (window.renderMathInElement) {
      renderMathInElement(document.body, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        ignoredClasses: ["cards", "table-wrap"],
      });
    }
    run();
  }

  window.addEventListener("load", init);
})();
