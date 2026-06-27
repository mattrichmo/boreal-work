# Design System Tokens

Status: Sprint 03 Phase 03B token, accessibility, and icon contract  
Source: `dump/Brand design system setup/globals.css`  
Model: `packages/ui-model/src/design-system.ts`

## Token Inventory

The source CSS contains 89 token declarations. `@boreal/ui-model` exposes those declarations as metadata and the tests compare each token name/value pair against `globals.css`.

| Group | Count | Notes |
| --- | ---: | --- |
| Raw palette | 27 | Ink, evergreen, frost, signal, paper, and accessible light-mode signal values. |
| Typography | 10 | Display, sans, mono families, and seven type-scale tokens. |
| Spacing | 9 | 4-point spacing rhythm from `4px` through `92px`. |
| Radii | 3 | Chip, card, and pill radii. |
| Effects/layout | 4 | Shadows, label tracking, and sidebar width. |
| Semantic themes | 36 | 18 dark theme role tokens and 18 light theme role tokens. |

## Theme Rules

- Components should consume semantic tokens such as `--bw-bg`, `--bw-surface`, `--bw-text`, `--bw-accent`, and `--bw-danger-text`.
- Raw palette tokens are allowed in palette documentation and deliberately fixed brand panels only.
- Dark and light themes are selected with `data-theme="dark"` or `data-theme="light"` on the console root.
- The console should import these tokens once at app entry. Component files should not duplicate token values.

## Contrast Checks

Representative source-token contrast checks:

| Pair | Contrast |
| --- | ---: |
| Dark text on dark background | 17.32:1 |
| Dark body text on dark background | 11.98:1 |
| Dark muted text on dark surface | 5.45:1 |
| Dark on amber accent | 9.07:1 |
| Light text on light background | 17.89:1 |
| Light body text on light background | 13.74:1 |
| Light muted text on white surface | 6.96:1 |
| Light amber text on light background | 5.53:1 |
| Light rust text on light background | 6.16:1 |
| Light evergreen brand text on light background | 8.48:1 |

## Interaction Rules

1. `focus-visible-ring`: interactive elements use a visible `:focus-visible` outline with `var(--bw-accent)`.
2. `keyboard-parity`: pointer actions need Enter or Space access, and Escape closes transient panels without mutating state.
3. `compact-dashboard-density`: dashboard rows keep stable minimum heights and predictable column tracks.
4. `stable-responsive-frames`: boards, tables, drawers, and split panes define min/max dimensions so dynamic content cannot resize the layout.
5. `text-overflow-contract`: controls, chips, cards, and table cells wrap or ellipsize inside fixed boundaries.

## Icon Strategy

Use `lucide-react` in `apps/console` only, after the console app is scaffolded. Keep icon names as data in shared contracts until then.

- Scope: browser console only.
- Import policy: named imports in the console package.
- Runtime policy: no React or lucide dependency in `@boreal/core`, runtime engines, storage, CLI, or TUI packages.
- Machine output policy: icons never replace JSON fields or text labels in CLI machine-readable output.
- CLI rich views: keep terminal symbols/text in the CLI render primitives unless a future TUI package explicitly adds an icon renderer.

Initial icon intents are modeled in `borealIconRegistry` for dashboard, sprint board, search, filtering, refresh, verification, locks, git, import/export, entity editing, and settings surfaces.
