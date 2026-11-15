# Who Can Afford Portland? — A Monte Carlo Housing Policy Simulation

An interactive Monte Carlo simulation of rents, rent burden, displacement, and gentrification in five Portland, Maine neighborhoods under five housing policies (plus one you design yourself). It runs entirely in the browser.

**Live site:** `https://<your-username>.github.io/<repo-name>/`

> Starting inputs are illustrative assumptions, not verified Portland data.

## What the model does

Each simulated future runs 20 years (adjustable). It draws:

- **7 uncertain market parameters** per run, from triangular distributions. These include how strongly rents respond to shortages, how much demand falls when rents rise, and how well tenant protections work.
- **Random events every year:** recessions (a two-state Markov chain), citywide and local demand shocks, wage shocks, rent shocks, and binomial displacement draws.

Each year it models demand, incomes (with spread inside each income group), construction (with a 2-year pipeline), displacement, landlord income screening for new renters, and rents. The site's **How it works** section has every equation.

Run #k uses the same random numbers under every policy (common random numbers), so policy comparisons aren't driven by luck. Any seed gives the same results every time.

## Site sections

| Section | What it shows |
|---|---|
| Results | Policy scorecards, fan charts with individual runs, rent vs. displacement trade-off, income makeup over time, neighborhood heatmaps, distributions, CSV download |
| How it works | Monte Carlo explained, both kinds of uncertainty, the full equation set (steps A–H), and the statistics used |
| Inside one run | Every random draw behind any single simulated future, year by year |
| Sensitivity | Tornado chart (Spearman rank correlation) of which unknowns drive outcomes |
| Convergence | Running average with a 95% confidence band, showing whether there are enough runs |
| Inputs | Editable neighborhood and income tables |

## Files

```
index.html          page layout + methodology text
css/style.css       styling
js/rng.js           seeded random numbers (xoshiro128**, inverse-CDF normal, binomial, triangular)
js/model.js         the simulation engine
js/charts.js        Plotly charts
js/app.js           controls and rendering
python/             standalone Python version (matplotlib charts; simpler model,
                    with no recessions, construction lag, or parameter uncertainty)
.nojekyll           tells GitHub Pages to serve files as-is
```

## Put it on GitHub Pages

1. Create a new public repository on GitHub (e.g. `portland-housing-monte-carlo`).
2. Click **Add file → Upload files**, drag in everything from this folder (including the `css`, `js`, and `python` folders), and commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, set **Source** to *Deploy from a branch*, choose branch `main` and folder `/ (root)`, then click **Save**.
4. Wait about a minute. The site will be at `https://<your-username>.github.io/<repo-name>/`.

## Run it locally

Double-click `index.html`, or run a local server:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

An internet connection is needed for the Plotly, KaTeX, and font CDNs.
