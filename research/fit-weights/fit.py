"""
Fits ArbiScore's logistic-regression weights to real Aave V3 (Arbitrum One) outcomes.

    python research/fit-weights/fit.py

Input: dataset.csv from collect.ts (features as of cutoff T, label = liquidated in the next 180 days).
The on-chain model predicts P(good) = sigmoid(b0 + sum w_i * x_i) with a fixed sign per feature
(the contracts do unsigned math with positive and negative terms split), so the fit is
sign-constrained: positive features >= 0, negative features <= 0, with light L2.

Out-of-sample quality is measured as mean AUC over 20 random 70/30 splits, on all wallets and on
the at-risk subset (debt open at T: only they could be liquidated without borrowing again).

Guardrails (product constraints; they cost ~0.03 AUC here because many weight sets fit Aave
data almost equally well, so the constraints choose among them):
- intercept fixed at -1.6, so an empty wallet (prior quality only) stays Subprime (~513)
- in-protocol repayment depth keeps weight >= 1.0, so repaying ArbiScore loans can reach Prime
- a liquidation costs at least -3.5, so a wallet with recent liquidations stays below Standard
- activity/volume capped at 0.6: they come from attested Aave activity, which is cheap to farm

Calibration note: liquidated wallets are over-sampled (38% of the sample vs 2.25% of borrowers),
so the fitted intercept prices risk as if default were ~17x more common than it is. It is kept:
tiers set collateral, and a conservative intercept keeps a fresh wallet Subprime.
"""
import csv
import json
import os
import numpy as np
from scipy.optimize import minimize
from sklearn.metrics import roc_auc_score

HERE = os.path.dirname(os.path.abspath(__file__))
FEATURES = ["quality", "depth", "liquidation", "age", "activity", "volume", "utilization"]
SIGN = {"quality": 1, "depth": 1, "liquidation": -1, "age": 1, "activity": 1, "volume": 1, "utilization": -1}
HAND = np.array([-2.6, 3.2, 1.3, -2.6, 0.9, 0.35, 0.35, -0.4])  # intercept, then FEATURES order
TIERS = [(750, "Prime"), (680, "Near-prime"), (600, "Standard"), (0, "Subprime")]
L2 = 1e-3
SPLITS = 20
S = 1_000_000

rows = list(csv.DictReader(open(os.path.join(HERE, "dataset.csv"))))
X = np.array([[float(r[f]) for f in FEATURES] for r in rows])
bad = np.array([int(r["label"]) for r in rows])
good = 1 - bad
at_risk = np.array([int(r["open"]) > 0 for r in rows])
stats = json.load(open(os.path.join(HERE, "population_stats.json")))
base_bad = stats["population_liquidated_in_window"] / stats["population_sampled"]
BOUNDS = [(None, None)] + [((0, None) if SIGN[f] > 0 else (None, 0)) for f in FEATURES]
GUARDED = [(-1.6, -1.6)] + [{"depth": (1.0, None), "liquidation": (None, -3.5), "activity": (0, 0.6),
                            "volume": (0, 0.6)}.get(f, BOUNDS[i + 1]) for i, f in enumerate(FEATURES)]


def fit(Xs, ys, bounds=BOUNDS):
    def loss(w):
        z = w[0] + Xs @ w[1:]
        return (np.logaddexp(0, z) - ys * z).mean() + L2 * (w[1:] ** 2).sum()

    def grad(w):
        p = 1 / (1 + np.exp(-(w[0] + Xs @ w[1:])))
        g = (p - ys) / len(ys)
        return np.concatenate([[g.sum()], Xs.T @ g + 2 * L2 * w[1:]])

    x0 = np.clip(HAND, [b[0] if b[0] is not None else -9 for b in bounds], [b[1] if b[1] is not None else 9 for b in bounds])
    return minimize(loss, x0, jac=grad, bounds=bounds, method="L-BFGS-B").x


def auc(w, sel):
    return roc_auc_score(good[sel], X[sel] @ w[1:])


rng = np.random.default_rng(7)
cv = {k: [] for k in ["hand_all", "free_all", "fit_all", "hand_risk", "free_risk", "fit_risk"]}
for _ in range(SPLITS):
    idx = rng.permutation(len(rows))
    tr, te = idx[: int(0.7 * len(rows))], idx[int(0.7 * len(rows)):]
    w, wfree = fit(X[tr], good[tr], GUARDED), fit(X[tr], good[tr])
    ter = te[at_risk[te]]
    cv["free_all"].append(auc(wfree, te)); cv["free_risk"].append(auc(wfree, ter))
    cv["hand_all"].append(auc(HAND, te)); cv["fit_all"].append(auc(w, te))
    cv["hand_risk"].append(auc(HAND, ter)); cv["fit_risk"].append(auc(w, ter))
m = {k: float(np.mean(v)) for k, v in cv.items()}
sd = {k: float(np.std(v)) for k, v in cv.items()}

# Final weights: guarded fit on everything, rounded to a 0.05 grid
wfree = np.round(fit(X, good) * 20) / 20
wf = np.round(fit(X, good, GUARDED) * 20) / 20
wf[1:] = np.where(np.array([SIGN[f] for f in FEATURES]) > 0, np.maximum(wf[1:], 0), np.minimum(wf[1:], 0))


def tiers(w):
    s = 300 + 550 / (1 + np.exp(-(w[0] + X @ w[1:])))
    out, hi = [], 10_000
    for thr, label in TIERS:
        sel = (s >= thr) & (s < hi)
        out.append((label, int(sel.sum()), float(bad[sel].mean()) if sel.any() else float("nan")))
        hi = thr
    return out


print(f"wallets: {len(rows)} ({bad.sum()} liquidated within 180d of cutoff); {at_risk.sum()} had debt open at cutoff")
print(f"borrower-population liquidation rate: {base_bad:.2%}\n")
print(f"{'':12}{'hand':>8}{'free fit':>10}{'guarded':>9}")
for name, h, u, f in zip(["intercept"] + FEATURES, HAND, wfree, wf):
    print(f"{name:12}{h:8.2f}{u:10.2f}{f:9.2f}")
print(f"\nOut-of-sample AUC ({SPLITS} random 70/30 splits, mean +- sd)")
for grp, k in [("all wallets", "all"), ("debt open at cutoff", "risk")]:
    print(f"  {grp:<21} hand {m['hand_' + k]:.3f}   free fit {m['free_' + k]:.3f}   guarded {m['fit_' + k]:.3f}  (sd ~{sd['fit_' + k]:.3f})")
for label, w in [("hand", HAND), ("guarded", wf)]:
    print(f"\nTiers, {label} weights (in-sample; liquidated share is of this enriched sample):")
    for t, n, r in tiers(w):
        print(f"  {t:<10} n={n:<5} liquidated={r:6.1%}")

# Out-of-time check: the weights above, fitted on this cutoff, scored on an earlier, non-overlapping
# period collected with CUTOFF_OFFSET_DAYS=180 (cutoff 360 days ago, label window ending at this cutoff)
oot = None
oot_file = os.path.join(HERE, "dataset_cutoff-180d.csv")
if os.path.exists(oot_file):
    orows = list(csv.DictReader(open(oot_file)))
    OX = np.array([[float(r[f]) for f in FEATURES] for r in orows])
    ogood = np.array([1 - int(r["label"]) for r in orows])
    orisk = np.array([int(r["open"]) > 0 for r in orows])
    oauc = lambda w, sel: roc_auc_score(ogood[sel], OX[sel] @ w[1:])
    alls = np.ones(len(orows), bool)
    oot = {name: {"all": oauc(w, alls), "risk": oauc(w, orisk)} for name, w in [("hand", HAND), ("free_fit", wfree), ("fitted", wf)]}
    os_ = 300 + 550 / (1 + np.exp(-(wf[0] + OX @ wf[1:])))
    otiers, hi = [], 10_000
    for thr, label in TIERS:
        sel = (os_ >= thr) & (os_ < hi)
        otiers.append((label, int(sel.sum()), float((1 - ogood)[sel].mean()) if sel.any() else float("nan")))
        hi = thr
    oot["tiers_fitted"] = otiers
    print(f"\nOut-of-time check: earlier period ({len(orows)} wallets, {int((1 - ogood).sum())} liquidated; weights not refitted)")
    for grp, k in [("all wallets", "all"), ("debt open at cutoff", "risk")]:
        print(f"  {grp:<21} hand {oot['hand'][k]:.3f}   free fit {oot['free_fit'][k]:.3f}   guarded {oot['fitted'][k]:.3f}")
    print("  tiers, guarded weights:", ", ".join(f"{t} {r:.1%} (n={n})" for t, n, r in otiers))

json.dump({
    "out_of_time": oot,
    "features": FEATURES, "hand": HAND.tolist(), "free_fit": wfree.tolist(), "fitted": wf.tolist(),
    "fixed_point": {n: int(round(v * S)) for n, v in zip(["intercept"] + FEATURES, wf)},
    "cv_auc_mean": m, "cv_auc_sd": sd, "n": len(rows), "liquidated": int(bad.sum()),
    "at_risk": int(at_risk.sum()), "population_liquidation_rate": base_bad,
    "tiers_hand": tiers(HAND), "tiers_fitted": tiers(wf),
}, open(os.path.join(HERE, "fit_result.json"), "w"), indent=2)
