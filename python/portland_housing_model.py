# Portland Housing Policy Monte Carlo — illustrative inputs, not verified Portland data.

from statistics import NormalDist

import numpy as np
import pandas as pd

import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

# ============================================================
# 1. SETTINGS
# ============================================================

SIMULATIONS = 500
YEARS = 20
RANDOM_SEED = 42

INFLATION = 0.025
VACANCY_TARGET = 0.05          # "healthy" vacancy rate
FRICTIONAL_VACANCY = 0.03      # units always empty mid-turnover

RENT_TIGHTNESS_RESPONSE = 0.60   # rent growth per unit of excess demand / units
DEMAND_PRICE_ELASTICITY = 0.50   # demand growth lost per 1pt real rent growth
SUPPLY_PRICE_RESPONSE = 8.0      # +8% construction per 1pt real rent growth

RENT_VOLATILITY = 0.015
INCOME_VOLATILITY = 0.012
DEMAND_VOLATILITY = 0.005

WITHIN_GROUP_INCOME_SIGMA = 0.35   # income spread inside each group (log)
INCOME_QUANTILES = 25              # points used to represent that spread
BURDEN_THRESHOLD = 0.30
LANDLORD_INCOME_RULE = 3.0         # must earn 3x rent to qualify for a lease

BASE_DISPLACEMENT = 0.002
DISPLACEMENT_SLOPE = 0.12          # added yearly probability per 1.0 excess burden
MAX_DISPLACEMENT = 0.15

INCOME_GROUPS = {
    #            share  median income  income growth  demand adj  displacement sens.
    "Low":     (0.25,  30_000,        0.025,         -0.003,     1.00),
    "Working": (0.35,  50_000,        0.028,         -0.001,     0.70),
    "Middle":  (0.25,  85_000,        0.030,          0.001,     0.25),
    "High":    (0.15, 150_000,        0.035,          0.003,     0.10),
}

NEIGHBORHOODS = {
    #                 rent  households units  demand  construction  zoning (0=open, 1=locked)
    "East Bayside": (1700, 2500,      2700,  0.025,  0.025,        0.70),
    "West End":     (1800, 3500,      3700,  0.015,  0.015,        0.85),
    "Munjoy Hill":  (1900, 2000,      2100,  0.025,  0.010,        0.90),
    "Parkside":     (1500, 3000,      3200,  0.020,  0.020,        0.60),
    "Old Port":     (2100, 1200,      1300,  0.020,  0.010,        0.95),
}

POLICIES = {
    #   zoning_relief: cut zoning restrictiveness by this fraction
    #   public_units:  new public units per year, citywide, rent = 30% of income
    #   tenant_protection: multiplier on displacement probability
    #   construction_penalty: multiplier on market construction. Rent
    #     regulation has been found to shrink rental supply (e.g. Diamond,
    #     McQuade & Qian 2019, San Francisco); 0.90 here is an ASSUMPTION.
    "Status Quo":         dict(zoning_relief=0.0, public_units=0,   tenant_protection=1.00, construction_penalty=1.00),
    "Zoning Reform":      dict(zoning_relief=0.5, public_units=0,   tenant_protection=1.00, construction_penalty=1.00),
    "Public Housing":     dict(zoning_relief=0.0, public_units=150, tenant_protection=1.00, construction_penalty=1.00),
    "Tenant Protections": dict(zoning_relief=0.0, public_units=0,   tenant_protection=0.45, construction_penalty=0.90),
    "Combined Policy":    dict(zoning_relief=0.5, public_units=150, tenant_protection=0.45, construction_penalty=0.90),
}

NBHD = list(NEIGHBORHOODS)
GROUPS = list(INCOME_GROUPS)
N, G, S, K = len(NBHD), len(GROUPS), SIMULATIONS, INCOME_QUANTILES

# Standard-normal points representing the income spread within a group.
Z = np.array([NormalDist().inv_cdf((k + 0.5) / K) for k in range(K)])
INCOME_SPREAD = np.exp(WITHIN_GROUP_INCOME_SIGMA * Z)[None, :, None, None]  # (1,K,1,1)


def col(table, i):
    return np.array([row[i] for row in table.values()], dtype=float)


# ============================================================
# 2. SIMULATION ENGINE
# Array shapes: neighborhood-level (N,S); group-level (G,N,S);
# income points (G,K,N,S).
# ============================================================

def run_simulation(policy):
    # Same seed for every policy = common random numbers, so differences
    # between policies come from the policy, not from luck.
    rng = np.random.default_rng(RANDOM_SEED)

    share, med_inc, inc_growth, demand_adj, disp_sens = (
        col(INCOME_GROUPS, i)[:, None, None] for i in range(5)
    )
    rent0, hh0, units0, base_demand, base_build, zoning = (
        col(NEIGHBORHOODS, i)[:, None] for i in range(6)
    )

    rents = rent0 * np.ones((N, S))
    mkt_units = units0 * np.ones((N, S))
    housed_mkt = share * hh0[None] * np.ones((G, N, S))   # renters in market units
    housed_pub = np.zeros((G, N, S))                       # tenants in public units
    pub_units = np.zeros((N, S))
    desired = housed_mkt.copy()       # households who want to live here (incl. housed)

    # Each cell gets its own random starting median income.
    incomes = med_inc * rng.lognormal(0, 0.10, size=(G, N, S))

    eff_zoning = zoning * (1 - policy["zoning_relief"])
    zoning_factor = 1 - 0.5 * eff_zoning

    real_rent_growth = np.zeros((N, S))
    cum_displaced = np.zeros((G, N, S))
    hist = {k: [] for k in ["rent", "burden", "burden_low", "displaced",
                            "low_share", "vacancy", "units"]}

    def record():
        housed = housed_mkt + housed_pub
        burden_pts = 12 * rents[None, None] / (incomes[:, None] * INCOME_SPREAD)
        burdened_share = (burden_pts > BURDEN_THRESHOLD).mean(axis=1)    # (G,N,S)
        burdened = burdened_share * housed_mkt                           # public tenants pay 30%
        hh_n = housed.sum(axis=0)
        hist["rent"].append((rents * hh_n).sum(0) / hh_n.sum(0))
        hist["burden"].append(100 * burdened.sum((0, 1)) / housed.sum((0, 1)))
        hist["burden_low"].append(100 * burdened[0].sum(0) / housed[0].sum(0))
        hist["displaced"].append(cum_displaced.sum((0, 1)))
        hist["low_share"].append(100 * housed[0].sum(0) / housed.sum((0, 1)))
        hist["vacancy"].append(100 * (1 - housed_mkt.sum((0, 1)) / mkt_units.sum(0)))
        hist["units"].append(mkt_units.sum(0) + pub_units.sum(0))
        hist.setdefault("rent_nbhd", []).append(rents.copy())
        hist.setdefault("groups", []).append(housed.sum(1))
        hist.setdefault("low_nbhd", []).append(100 * housed[0] / housed.sum(0))

    record()

    for _ in range(YEARS):
        # A. DEMAND — grows with neighborhood popularity, falls when rents outpace inflation.
        shock = rng.normal(0, DEMAND_VOLATILITY, (1, S)) + rng.normal(0, DEMAND_VOLATILITY, (N, S))
        growth = base_demand + shock - DEMAND_PRICE_ELASTICITY * real_rent_growth
        desired *= 1 + np.clip(growth[None] + demand_adj, -0.05, 0.15)

        # B. INCOMES
        wage = (inc_growth
                + rng.normal(0, INCOME_VOLATILITY, (1, 1, S))
                + rng.normal(0, INCOME_VOLATILITY, (G, N, S)))
        incomes *= 1 + np.clip(wage, -0.10, 0.15)

        # C. CONSTRUCTION — builders respond to rents; zoning caps how much.
        supply_response = np.maximum(0, 1 + SUPPLY_PRICE_RESPONSE * real_rent_growth)
        new_mkt = (mkt_units * base_build * zoning_factor * supply_response
                   * policy["construction_penalty"])
        mkt_units += new_mkt

        # D. PUBLIC HOUSING — split across neighborhoods by population, filled
        # by low-income households: half move out of market units (freeing them),
        # half come off the waitlist.
        hh_n = (housed_mkt + housed_pub).sum(0)
        new_pub = policy["public_units"] * hh_n / hh_n.sum(0, keepdims=True)
        pub_units += new_pub
        movers = np.minimum(0.5 * new_pub, housed_mkt[0])
        housed_mkt[0] -= movers
        housed_pub[0] += new_pub
        desired[0] = np.maximum(desired[0], housed_mkt[0] + housed_pub[0])

        # E. DISPLACEMENT — probability rises with burden above 30%.
        burden_pts = 12 * rents[None, None] / (incomes[:, None] * INCOME_SPREAD)
        excess = np.maximum(burden_pts - BURDEN_THRESHOLD, 0)
        p = np.clip(BASE_DISPLACEMENT + DISPLACEMENT_SLOPE * excess, 0, MAX_DISPLACEMENT)
        p = np.clip(p.mean(axis=1) * disp_sens * policy["tenant_protection"], 0, MAX_DISPLACEMENT)
        displaced = rng.binomial(np.rint(housed_mkt).astype(int), p).astype(float)
        displaced = np.minimum(displaced, housed_mkt)
        housed_mkt -= displaced
        desired -= displaced       # they leave the neighborhood
        cum_displaced += displaced

        # F. IN-MOVERS — empty units go to households who want in AND pass
        # the landlord income test. This is where gentrification happens.
        qualifies = (incomes[:, None] * INCOME_SPREAD
                     >= LANDLORD_INCOME_RULE * 12 * rents[None, None]).mean(axis=1)
        waiting = np.maximum(desired - housed_mkt - housed_pub, 0)
        eligible = waiting * qualifies
        open_units = np.maximum(mkt_units * (1 - FRICTIONAL_VACANCY) - housed_mkt.sum(0), 0)
        fill = np.minimum(open_units, eligible.sum(0))
        housed_mkt += eligible / np.maximum(eligible.sum(0), 1e-9) * fill

        # G. RENTS — driven by EFFECTIVE demand (current tenants plus would-be
        # tenants who can actually qualify) relative to market units. Wanting to
        # live somewhere you can't afford doesn't bid up rent.
        waiting = np.maximum(desired - housed_mkt - housed_pub, 0)
        mkt_demand = (housed_mkt + waiting * qualifies).sum(0)
        tightness = mkt_demand / mkt_units - (1 - VACANCY_TARGET)
        rent_growth = np.clip(
            INFLATION + RENT_TIGHTNESS_RESPONSE * tightness
            + rng.normal(0, RENT_VOLATILITY, (N, S)),
            -0.10, 0.25,
        )
        rents *= 1 + rent_growth
        real_rent_growth = rent_growth - INFLATION

        record()

    return {k: np.array(v) for k, v in hist.items()}


# ============================================================
# 3. RUN ALL POLICIES
# ============================================================

results = {}
for name, policy in POLICIES.items():
    print("Running:", name)
    results[name] = run_simulation(policy)

METRICS = {
    "rent": "City Rent ($/mo)",
    "burden": "Rent Burdened (%)",
    "burden_low": "Low-Income Burdened (%)",
    "displaced": "Cumulative Displaced",
    "low_share": "Low-Income Share of Households (%)",
    "vacancy": "Market Vacancy (%)",
    "units": "Total Housing Units",
}

rows = []
for name, r in results.items():
    for year in range(YEARS + 1):
        row = {"Policy": name, "Year": year}
        for key, label in METRICS.items():
            vals = r[key][year]
            row[label] = np.median(vals)
            row[label + " p10"] = np.percentile(vals, 10)
            row[label + " p90"] = np.percentile(vals, 90)
        rows.append(row)

df = pd.DataFrame(rows)
df.to_csv("portland_housing_results.csv", index=False)

final = df[df.Year == YEARS].set_index("Policy")[list(METRICS.values())]
print(f"\nYEAR {YEARS} — MEDIAN ACROSS {SIMULATIONS} SIMULATIONS")
print(final.round(1).to_string())


# ============================================================
# 4. VISUALS
# ============================================================

BG, PANEL, INK, MUTED, GRID = "#0e1117", "#161b22", "#e6edf3", "#8b949e", "#30363d"
COLORS = dict(zip(POLICIES, ["#8b949e", "#58a6ff", "#3fb950", "#f0883e", "#d2a8ff"]))
GROUP_COLORS = ["#f85149", "#f0883e", "#58a6ff", "#a371f7"]
years = np.arange(YEARS + 1)

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": PANEL, "savefig.facecolor": BG,
    "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": GRID,
    "axes.grid": True, "grid.alpha": 0.6, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.titlelocation": "left", "legend.frameon": False,
})


def title_block(fig, title, subtitle):
    fig.text(0.015, 0.975, title, fontsize=18, fontweight="bold", va="top")
    fig.text(0.015, 0.975 - 0.45 / fig.get_figheight(), subtitle, fontsize=10.5, color=MUTED, va="top")


def end_label(ax, x, y, text, color, dx=0.4):
    ax.annotate(text, (x, y), xytext=(x + dx, y), color=color, fontsize=9,
                fontweight="bold", va="center", annotation_clip=False)


# ---- 4.1 Every future, one panel per policy ----------------------------------
fig, axes = plt.subplots(1, 5, figsize=(20, 6.5), sharey=True)
title_block(fig, "2,500 possible futures for Portland rent",
            f"Each thin line is one simulated 20-year future ({SIMULATIONS} per policy). "
            "Bold line = median. Dashed = status quo median for comparison.")
sq_median = np.median(results["Status Quo"]["rent"], axis=1)
for ax, (name, r) in zip(axes, results.items()):
    c = COLORS[name]
    ax.plot(years, r["rent"], color=c, alpha=0.035, lw=0.8)
    med = np.median(r["rent"], axis=1)
    ax.plot(years, med, color="white", lw=4.5, alpha=0.9)
    ax.plot(years, med, color=c, lw=2.5)
    if name != "Status Quo":
        ax.plot(years, sq_median, color=MUTED, lw=1.3, ls="--")
    diff = med[-1] - sq_median[-1]
    ax.set_title(name, color=c)
    ax.text(0.04, 0.93, f"${med[-1]:,.0f}/mo",
            transform=ax.transAxes, fontsize=15, fontweight="bold", color=INK)
    if name != "Status Quo":
        ax.text(0.04, 0.84, f"{'+' if diff > 0 else '−'}${abs(diff):,.0f} vs status quo",
                transform=ax.transAxes, fontsize=9.5,
                color="#f85149" if diff > 0 else "#3fb950")
    ax.set_xlabel("Year")
axes[0].set_ylabel("Household-weighted monthly rent ($)")
axes[0].yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"${v:,.0f}"))
fig.tight_layout(rect=(0, 0, 1, 0.88))
fig.savefig("1_rent_futures.png", dpi=150)


# ---- 4.2 Dashboard of fan charts ----------------------------------------------
fig, axes = plt.subplots(2, 3, figsize=(18, 10))
title_block(fig, "Policy dashboard", "Median with 10th–90th percentile band across simulations")
panels = [
    ("rent", "City rent", lambda v, _: f"${v:,.0f}"),
    ("burden", "Households paying >30% of income", lambda v, _: f"{v:.0f}%"),
    ("burden_low", "Low-income households paying >30%", lambda v, _: f"{v:.0f}%"),
    ("displaced", "Cumulative displaced households", lambda v, _: f"{v:,.0f}"),
    ("low_share", "Low-income share of residents", lambda v, _: f"{v:.0f}%"),
    ("units", "Total housing units", lambda v, _: f"{v:,.0f}"),
]
for ax, (key, title, fmt) in zip(axes.flat, panels):
    finals = []
    for name, r in results.items():
        d = r[key]
        ax.fill_between(years, np.percentile(d, 10, 1), np.percentile(d, 90, 1),
                        color=COLORS[name], alpha=0.13, lw=0)
        med = np.median(d, axis=1)
        ax.plot(years, med, color=COLORS[name], lw=2.2, label=name)
        finals.append((med[-1], name))
    ax.set_title(title)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt))
    ax.set_xlim(0, YEARS)
    ax.set_xticks(range(0, YEARS + 1, 5))
    lo, hi = ax.get_ylim()
    gap = (hi - lo) * 0.055
    placed = []
    for y, name in sorted(finals):
        y_lab = max([y] + [p + gap for p in placed])
        placed.append(y_lab)
        ax.annotate(fmt(y, None), (YEARS, y), xytext=(YEARS + 0.5, y_lab),
                    color=COLORS[name], fontsize=8.5, fontweight="bold", va="center",
                    annotation_clip=False)
handles, labels = axes.flat[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=5, fontsize=11)
fig.tight_layout(rect=(0, 0.05, 0.98, 0.9), w_pad=4)
fig.savefig("2_dashboard.png", dpi=150)


# ---- 4.3 The trade-off map ----------------------------------------------------
fig, ax = plt.subplots(figsize=(12, 8))
title_block(fig, "The trade-off: rent vs. displacement after 20 years",
            "Cloud = all simulations. Bubble size = share of low-income residents remaining. "
            "Bottom-left is best.")
for name, r in results.items():
    c = COLORS[name]
    x, y = r["displaced"][-1], r["rent"][-1]
    ax.scatter(x, y, s=6, color=c, alpha=0.18, lw=0)
    mx, my = np.median(x), np.median(y)
    low = np.median(r["low_share"][-1])
    ax.scatter(mx, my, s=low * 90, color=c, alpha=0.35, lw=0)
    ax.scatter(mx, my, s=low * 90, facecolor="none", edgecolor=c, lw=2)
    ax.annotate(f"{name}\n{low:.0f}% low-income remain", (mx, my),
                xytext=(14, 14), textcoords="offset points", color=c,
                fontsize=10, fontweight="bold")
ax.set_xlabel("Households displaced over 20 years")
ax.set_ylabel("Monthly rent in year 20")
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"${v:,.0f}"))
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:,.0f}"))
ax.annotate("better", xy=(0.04, 0.06), xytext=(0.16, 0.18), xycoords="axes fraction",
            color=MUTED, fontsize=11, fontstyle="italic",
            arrowprops=dict(arrowstyle="->", color=MUTED, lw=1.5))
fig.tight_layout(rect=(0, 0, 1, 0.9))
fig.savefig("3_tradeoff.png", dpi=150)


# ---- 4.4 Who gets to stay: income composition --------------------------------
fig, axes = plt.subplots(1, len(POLICIES), figsize=(20, 6), sharey=True)
title_block(fig, "Who gets to stay?",
            "Median share of residents by income group over 20 years")
for ax, (name, r) in zip(axes, results.items()):
    comp = np.median(r["groups"], axis=2)            # (years, G)
    comp = 100 * comp / comp.sum(axis=1, keepdims=True)
    ax.stackplot(years, comp.T, colors=GROUP_COLORS, alpha=0.9, lw=0)
    ax.set_title(name, color=COLORS[name])
    ax.set_xlim(0, YEARS)
    ax.set_ylim(0, 100)
    ax.set_xticks(range(0, YEARS + 1, 5))
    ax.grid(False)
    ax.set_xlabel("Year")
    ax.text(YEARS - 0.5, comp[-1, 0] / 2, f"{comp[-1, 0]:.0f}%", ha="right",
            va="center", fontsize=12, fontweight="bold", color="white")
axes[0].set_ylabel("Share of residents (%)")
fig.legend([plt.Rectangle((0, 0), 1, 1, color=c) for c in GROUP_COLORS],
           [f"{g} income" for g in GROUPS], loc="lower center", ncol=4, fontsize=11)
fig.tight_layout(rect=(0, 0.06, 1, 0.86), w_pad=2)
fig.savefig("4_who_stays.png", dpi=150)


# ---- 4.5 Neighborhood heatmaps ------------------------------------------------
heat = LinearSegmentedColormap.from_list("heat", ["#0d419d", "#161b22", "#da3633"])
heat_r = LinearSegmentedColormap.from_list("heat_r", ["#da3633", "#161b22", "#238636"])
pol = list(POLICIES)
rent_chg = np.array([[100 * (np.median(results[p]["rent_nbhd"][-1, i])
                             / np.median(results[p]["rent_nbhd"][0, i]) - 1)
                      for p in pol] for i in range(N)])
low_left = np.array([[np.median(results[p]["low_nbhd"][-1, i]) for p in pol]
                     for i in range(N)])

fig, axes = plt.subplots(1, 2, figsize=(18, 6.5))
title_block(fig, "Neighborhood by neighborhood",
            "Left: rent change over 20 years. Right: low-income share of residents in year 20 "
            "(started at 25% everywhere).")
for ax, data, cmap, fmt, ttl in [
    (axes[0], rent_chg, heat, "{:+.0f}%", "Rent change, year 0 → 20"),
    (axes[1], low_left, heat_r, "{:.0f}%", "Low-income share remaining"),
]:
    center = np.median(data)
    span = np.abs(data - center).max()
    ax.imshow(data, cmap=cmap, vmin=center - span, vmax=center + span, aspect="auto")
    ax.set_xticks(range(len(pol)), pol, rotation=20, ha="right")
    ax.set_yticks(range(N), NBHD)
    ax.grid(False)
    for s in ax.spines.values():
        s.set_visible(False)
    for i in range(N):
        for j in range(len(pol)):
            ax.text(j, i, fmt.format(data[i, j]), ha="center", va="center",
                    fontsize=11, fontweight="bold", color="white")
    ax.set_title(ttl)
fig.tight_layout(rect=(0, 0, 1, 0.88))
fig.savefig("5_neighborhoods.png", dpi=150)


# ---- 4.6 Final-year rent distributions (ridgeline) ---------------------------
fig, ax = plt.subplots(figsize=(13, 7.5))
title_block(fig, "How wide is the range of outcomes?",
            "Distribution of year-20 city rent across all simulations, with median marked")
all_final = np.concatenate([r["rent"][-1] for r in results.values()])
grid = np.linspace(all_final.min() * 0.97, all_final.max() * 1.03, 400)
bw = all_final.std() * 0.12
for k, (name, r) in enumerate(reversed(list(results.items()))):
    vals = r["rent"][-1]
    dens = np.exp(-0.5 * ((grid[:, None] - vals[None]) / bw) ** 2).sum(1)
    dens = dens / dens.max() * 1.25
    base = k * 1.1
    ax.fill_between(grid, base, base + dens, color=COLORS[name], alpha=0.75, lw=0, zorder=10 - k)
    ax.plot(grid, base + dens, color="white", lw=1, alpha=0.8, zorder=10 - k)
    med = np.median(vals)
    ax.vlines(med, base, base + np.interp(med, grid, dens), color="white", lw=1.5, ls=":", zorder=11)
    ax.text(grid[0], base + 0.25, name, color=COLORS[name], fontsize=12,
            fontweight="bold", zorder=12)
    ax.text(med, base + 0.12, f" ${med:,.0f}", ha="left", fontsize=9.5, fontweight="bold", color="white", zorder=12)
ax.set_yticks([])
ax.grid(axis="y", visible=False)
ax.spines["left"].set_visible(False)
ax.set_xlabel("Monthly rent in year 20")
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"${v:,.0f}"))
fig.tight_layout(rect=(0, 0, 1, 0.9))
fig.savefig("6_rent_distributions.png", dpi=150)

print("\nSaved 6 charts (1_rent_futures.png … 6_rent_distributions.png) and portland_housing_results.csv")
plt.show()
