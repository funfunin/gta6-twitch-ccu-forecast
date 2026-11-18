# gta6-twitch-ccu-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/funfunin/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/funfunin/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day, 2026-11-19 (UTC), from the first hour's count — as five quantiles an hour.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) reads every `<id>.in` in the input directory and writes `/output/<id>.out` with 23 rows, hours 2 to 24, each `{"hour": h, "q": [q05, q25, q50, q75, q95]}`. It runs offline, is deterministic (two runs write the same bytes), and takes well under the 8-second limit.

## The model

A kernel-weighted median ratio curve over past big launches. For each hour h, every comparable launch contributes one log-ratio, ln(viewers_h / viewers_1), measured on its own release day. The forecast median is the case's hour-1 print times the exponential of the weighted median of those log-ratios, where a comparable's weight is a Gaussian kernel on log(hour-1 print), bandwidth 1.0: launches whose first hour looked like this case's first hour count most.

Why that weighting matters: the ratio curve depends on how much of the world had unlocked by 00:00 UTC. A launch whose hour 1 was nearly empty (rolling midnight, most regions still locked) rises 10–100x by the evening; a launch whose hour 1 was already huge stays comparatively flat. A plain median over all launches mixes the two regimes and is wrong for both. The kernel keeps them apart.

The spread is the kernel-weighted standard deviation of the same log-ratios for that hour, floored at 0.30 log units. Quantiles are log-normal around the median: q_tau = median * exp(z_tau * sigma), z = (-1.645, -0.674, 0, 0.674, 1.645).

Everything is computed at run time from the case's own `comparables` field, so the final case (all 42 comparables) is used exactly as given. The Grand Theft Auto VI category's own pre-release history is excluded from the ratio curves — its "release day" in the data is the 2026-08-27 premiere, not a launch day. The case's top-streams and category fields are not used: the comparable ratio curves already encode the launch-day shape, and the hour-1 print already anchors the scale.

Fallbacks keep every case valid: an hour with fewer than three comparable ratios falls back to persistence with the house baseline's spread, and if the model throws for a case the whole case falls back to the baseline forecast instead of crashing — an invalid case ranks below every valid entry.

## Validation

Leave-one-out over the 37 launch comparables in the kit, and scoring the four real practice cases against SullyGnome's published hourly averages (which reproduces the house baseline's practice loss of 0.387, so the scorer and the answers check out):

| | mean pinball loss |
|---|---|
| House baseline (practice) | 0.387 |
| This model (practice, 4 cases) | 0.234 |
| House baseline (LOO, 37 pseudo-cases) | 0.930 |
| This model (LOO, 37 pseudo-cases) | 0.404 |

90% coverage on the practice cases: 0.87–1.00 (an honest forecast covers about 0.90). The model beats the baseline in both the big first-hour group (0.263 vs 0.351) and the small first-hour group (0.842 vs 2.730) of the leave-one-out test.

## Assumptions, stated plainly

- The shape of a launch day is learned from past launches' Twitch category curves (SullyGnome hourly averages, as shipped in the kit), not from any live data: the program runs offline and cannot read Twitch.
- Hour 1's print is taken as the anchor for scale; the shape is assumed to depend on it only through the kernel on log(hour-1 viewers).
- Quantile spreads assume log-normality around the weighted median, with the cross-launch dispersion as the spread. No claim is made about streamer-level or category-level effects beyond what the comparables show.
- Practice scores are no guide to the final: the final's answer is recorded live on 2026-11-19 and was not available when this was built.

---

<sub>Entered on [make.fun](https://make.fun/?ref=quick-kestrel-62&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
