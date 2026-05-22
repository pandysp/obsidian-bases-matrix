# Training log example

A year of 5K time trials plotted on `week × time`. The chart's job is to **surface the trend** that's hard to see in a list of timestamps — improvement, plateaus, heat-induced slowdowns, an injury setback, and the eventual sub-25 breakthrough.

This is the kind of plot scatter views are actually good for: continuous numeric axes with no meaningful quadrant interpretation. "Low time is good" is the only frame; no "do first / delegate" labels would apply.

## Install

1. Make sure the plugin is installed and enabled in your vault.
2. Copy the entire `training-log/` directory into your vault (anywhere, e.g. `vault-root/training-log/`).
3. Open `training.base` in Obsidian. The chart should render with 26 sessions across 2025.

If you placed the folder somewhere other than the vault root, update the filter in `training.base`:

```yaml
filters:
  and:
    - file.folder == "<your-actual-path>"
    - file.ext == "md"
```

## What you'll see

26 weekly 5K time trials across a calendar year. The points trace a recognisable training narrative:

- **Jan–Feb** (~31 min): out-of-shape start to the year
- **Mar–Apr**: spring fitness arrives, first sub-29
- **May**: a flat plateau — the body needs a rest week
- **Jun–Jul**: heat slows things down even as fitness improves
- **Aug**: heat adaptation kicks in, sub-26 breakthrough
- **Sep–Oct**: peak fitness, sub-25 race day in October
- **Nov**: minor calf strain, two weeks off, conservative return
- **Dec**: end-of-year time trial sets a new all-time PB

The eye picks up the overall downward trajectory instantly and the deviations from it — the bad-sleep spike in March, the heat dome in July, the injury bump in November. A spreadsheet of times would hide all of that.

## Each session note

```yaml
---
title: "Oct 12 — RACE: Sub-25!!"
week: 41
time_minutes: 24.9
distance_km: 5
rpe: 10
weather: "Cool, dry"
---

Local 5K race. Sub-25 for the first time…
```

`week` and `time_minutes` are the plot axes. `rpe` (rate of perceived exertion), `distance_km`, and `weather` are toggleable as tooltip chips via the Properties panel.

## When this example matters more than Eisenhower

The Eisenhower matrix carves data into four quadrants because every task has an action (do, schedule, eliminate, delegate). A training log doesn't. There's no "high week" or "low week" — the week number is just position on a timeline. Imposing quadrants here would create false categories.

Pick this configuration when:

- You're tracking a measurement over time (weight, pace, mood, focus)
- You want to spot a **correlation** between two variables (sleep vs productivity, exercise vs energy)
- The axes are continuous and the question is "is there a pattern?" not "what should I do?"

## File structure

```
training-log/
├── README.md            # this file
├── training.base        # the scatter view config
└── sessions/
    ├── 2025-01-05.md
    ├── 2025-01-19.md
    ├── …
    └── 2025-12-21.md
```
