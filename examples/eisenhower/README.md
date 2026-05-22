# Eisenhower example

A self-contained demo of the 2×2 Matrix view. Drop this folder into any Obsidian vault and the matrix renders with 14 sample notes spread across the Eisenhower quadrants — including clusters of **4, 3, and 2 overlapping points** so you immediately see the cluster tray and drag-out behavior.

## Install

1. Make sure the plugin is installed and enabled in your vault.
2. Copy the entire `eisenhower/` directory into your vault (anywhere, e.g. `vault-root/eisenhower/`).
3. Open `eisenhower.base` in Obsidian. The matrix should render with all 14 sample tasks.
4. (Optional) Copy `linear.css` into `<your-vault>/.obsidian/snippets/` and enable it in Settings → Appearance → CSS snippets to skin the tooltip Linear-style.

If you placed the folder somewhere other than the vault root, update the filter in `eisenhower.base`:

```yaml
filters:
  and:
    - file.folder == "<your-actual-path>"
    - file.ext == "md"
```

## What you'll see

**Do First (top-right)** — a **4-point cluster** of urgent + important tasks (`Renew SSL certificate`, `Fix production auth bug`, `Investor follow-up email`, `Submit conference talk proposal for SREcon`). Tap the cluster glyph to open the tray and see every member listed; tap a row to open that note's detail modal.

**Schedule (top-left)** — 2 singletons (`Plan Q2 roadmap`, `Update team OKRs`) and a **3-point cluster** (`Refactor authentication module`, `Write public API documentation`, `Document architecture decisions for v2 platform migration`). Try long-pressing a row in the open tray — the row lifts and you can drag it onto the chart as a ghost dot. On release, the cluster re-forms with one fewer member.

**Eliminate (bottom-left)** — 2 singletons, both `area: personal` so they share a color.

**Delegate (bottom-right)** — a **2-point cluster** (`Schedule quarterly all-hands` + `Order team merchandise`) plus a singleton (`Customer-blocker support ticket about checkout flow timeout`) — try dragging the singleton's dot onto the cluster to merge them.

## Features demonstrated

- Cluster glyph + count for N ≥ 2 overlapping points.
- Tray-on-tap: HTML overlay listing every member with its color dot and title; row click opens that note's detail modal.
- Long-press a tray row to drag that member out of the cluster while the rest stays put.
- Color encoding via `colorBy: note.area` — 5 distinct areas (`eng`, `support`, `ops`, `admin`, `personal`) get 5 palette slots.
- Two-line label wrapping (look at the long titles like `Customer-blocker support ticket about checkout flow timeout` and `Document architecture decisions for v2 platform migration`).
- Inline-edit axis and quadrant labels: click `Urgency`, `Importance`, or any of `Do First` / `Schedule` / `Eliminate` / `Delegate` to rename them in place.
- Click a point → inline detail modal with the full Obsidian editor (properties + body) embedded.
- Drag a point → both `urgency` and `importance` frontmatter update at once.
- (With `linear.css` enabled) the tooltip subtitle pulls the file basename via `data-file-name`, and `Created` / `Updated` chips style themselves via `data-property-id`.

## File structure

```
eisenhower/
├── README.md          # this file
├── eisenhower.base    # the matrix view config
├── linear.css         # optional user snippet (Linear-style tooltip)
└── notes/
    ├── TODO-01.md ... TODO-14.md
```
