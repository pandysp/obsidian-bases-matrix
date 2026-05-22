# Tech radar example

A [ThoughtWorks-style technology radar](https://www.thoughtworks.com/radar) implemented as 4 quadrants × 4 concentric rings — `showQuadrants: true` and `showRings: true` together.

- **Quadrants** carry the **category** (Tools, Techniques, Platforms, Languages & Frameworks).
- **Rings** carry the **action recommendation** (Adopt → Trial → Assess → Hold, innermost to outermost).

Each note represents one technology you're tracking. Its position is a function of its quadrant and ring; you can drag points to re-rate them as your assessment changes.

## Install

1. Make sure the plugin is installed and enabled in your vault.
2. Copy the entire `tech-radar/` directory into your vault (anywhere, e.g. `vault-root/tech-radar/`).
3. Open `radar.base` in Obsidian. The radar should render with 23 sample technologies.

If you placed the folder somewhere other than the vault root, update the filter in `radar.base`:

```yaml
filters:
  and:
    - file.folder == "<your-actual-path>"
    - file.ext == "md"
```

## What you'll see

- **Center: Adopt.** The proven, low-risk defaults (Git, TypeScript, React, Vercel, trunk-based development, property-based testing).
- **Ring 2: Trial.** Try in a real project before betting on it (Biome, Cursor, Cloudflare Workers, Bun, Tailwind v4, Astro).
- **Ring 3: Assess.** Interesting enough to keep an eye on, not ready to commit (Zed, Effect, Fly.io, HTMX, Solid.js).
- **Ring 4: Hold.** Maintain existing code; new projects shouldn't start here (Jenkins, microservices-by-default, Heroku, jQuery).

Color encodes quadrant — each category gets a palette slot so you can pick out "all Platforms" at a glance.

## Each item

```yaml
---
title: "Biome"
x: 1.15
y: 0.80
---

Single-binary linter + formatter…
```

The plugin plots by `x` and `y` only. The plot is centered on (0, 0) (`xMin: -5`, `xMax: 5`, `yMin: -5`, `yMax: 5` in `radar.base`), so the quadrant a point falls into is purely a function of its sign:

- `x > 0, y > 0` → Tools (top-right)
- `x < 0, y > 0` → Techniques (top-left)
- `x < 0, y < 0` → Platforms (bottom-left)
- `x > 0, y < 0` → Languages & Frameworks (bottom-right)

Ring assignment is purely a function of distance from origin (rings are at `r = 1.25, 2.5, 3.75, 5`). Drag a point closer to the center to "Adopt" it, farther to "Hold" it — the `x` / `y` frontmatter is the durable record. The `colorBy: formula.quadrant` formula in `radar.base` is what makes each category get its own palette slot.

## Re-rating a tech

Drag any point. The plugin updates `x` and `y` in the note's frontmatter on release. Move TypeScript inward as you become more confident, move HTMX outward if your assessment cools — the frontmatter is the durable record.

To switch a tech to a different category (e.g. move React from Tools to Languages & Frameworks), drag it across the x-axis or y-axis. The `formula.quadrant` formula in `radar.base` re-computes the category from sign(`x`) and sign(`y`), so the point's color updates automatically.

## File structure

```
tech-radar/
├── README.md         # this file
├── radar.base        # the 4×4 radar view config
└── items/
    ├── git.md
    ├── github-actions.md
    ├── …             # 23 entries
    └── jquery.md
```
