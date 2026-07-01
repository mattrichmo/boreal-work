export const consoleAppCss = `
:root {
  color-scheme: dark;
  --bw-bg: #080a09;
  --bw-panel: #101511;
  --bw-panel-2: #151c17;
  --bw-border: #2c342e;
  --bw-text: #edf5f0;
  --bw-muted: #94a39b;
  --bw-body: #bfccc6;
  --bw-accent: #71d48b;
  --bw-warn: #d7b969;
  --bw-danger: #df7c7c;
  --bw-focus: #8be9a5;
  --bw-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bw-bg);
  color: var(--bw-body);
  font-family: var(--bw-font);
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: var(--bw-bg); }
a { color: inherit; text-decoration: none; }
button, input { font: inherit; }
select { font: inherit; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.bw-console { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr); }
.bw-console__sidebar { border-right: 1px solid var(--bw-border); background: #0b0f0c; padding: 20px 14px; display: flex; flex-direction: column; gap: 18px; position: sticky; top: 0; height: 100vh; }
.bw-console__brand { display: grid; gap: 4px; padding: 0 8px; }
.bw-console__brand strong { color: var(--bw-text); font-size: 18px; }
.bw-console__brand span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-console__nav { display: grid; gap: 6px; }
.bw-console__nav-link { display: flex; align-items: center; gap: 10px; min-height: 40px; border: 1px solid transparent; border-radius: 8px; padding: 9px 10px; color: var(--bw-body); }
.bw-console__nav-link[aria-current="page"] { color: var(--bw-text); border-color: var(--bw-border); background: var(--bw-panel-2); }
.bw-console__mode { margin-top: auto; display: grid; gap: 8px; padding: 10px; border: 1px solid var(--bw-border); border-radius: 8px; background: var(--bw-panel); }
.bw-console__main { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.bw-console__topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 72px; border-bottom: 1px solid var(--bw-border); padding: 14px 22px; background: rgba(16, 21, 17, 0.92); position: sticky; top: 0; z-index: 2; }
.bw-console__title { min-width: 0; }
.bw-console__title h1 { margin: 0; color: var(--bw-text); font-size: 22px; line-height: 1.2; letter-spacing: 0; }
.bw-console__title p { margin: 4px 0 0; color: var(--bw-muted); font-size: 13px; overflow-wrap: anywhere; }
.bw-console__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.bw-console__content { min-width: 0; padding: 22px; display: grid; gap: 18px; align-content: start; }
.bw-page-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.8fr); gap: 16px; align-items: start; }
.bw-page-stack { display: grid; gap: 16px; align-content: start; }
.bw-card, .bw-metric { border: 1px solid var(--bw-border); border-radius: 8px; background: var(--bw-panel); min-width: 0; }
.bw-card__header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 14px 14px 0; }
.bw-card__eyebrow { color: var(--bw-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; overflow-wrap: anywhere; }
.bw-card__title { margin: 2px 0 0; color: var(--bw-text); font-size: 16px; line-height: 1.25; letter-spacing: 0; }
.bw-card__body { padding: 14px; min-width: 0; }
.bw-metric { padding: 12px; display: grid; gap: 4px; }
.bw-metric__label { color: var(--bw-muted); font-size: 12px; }
.bw-metric__value { color: var(--bw-text); font-size: 24px; line-height: 1; font-weight: 680; overflow-wrap: anywhere; }
.bw-metric__detail { color: var(--bw-muted); font-size: 12px; }
.bw-metric--success { border-color: rgba(113, 212, 139, 0.45); }
.bw-metric--warning { border-color: rgba(215, 185, 105, 0.55); }
.bw-metric--danger { border-color: rgba(223, 124, 124, 0.6); }
.bw-global-metrics, .bw-global-health-summary, .bw-sprint-header__metrics, .bw-health-summary, .bw-sync-grid, .bw-progress-grid, .bw-scope-summary__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.bw-bucket-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.bw-bucket { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 12px; display: grid; gap: 12px; }
.bw-bucket__header { min-width: 0; display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.bw-bucket__header h4 { margin: 0; color: var(--bw-text); font-size: 15px; line-height: 1.25; overflow-wrap: anywhere; }
.bw-bucket__header p { margin: 4px 0 0; color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-bucket__metrics { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.bw-bucket__metrics div { min-width: 0; border-radius: 8px; padding: 8px; background: rgba(255,255,255,0.03); }
.bw-bucket__metrics dt { color: var(--bw-muted); font-size: 11px; }
.bw-bucket__metrics dd { margin: 3px 0 0; color: var(--bw-text); font-size: 17px; font-weight: 680; overflow-wrap: anywhere; }
.bw-bucket__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.bw-bucket__link { min-height: 34px; border: 1px solid var(--bw-border); border-radius: 8px; color: var(--bw-text); display: inline-flex; align-items: center; justify-content: center; padding: 7px 10px; overflow-wrap: anywhere; text-align: center; }
.bw-global-queues { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: start; }
.bw-global-queue { min-width: 0; display: grid; gap: 10px; align-content: start; }
.bw-global-queue__header { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--bw-text); }
.bw-global-queue__items { display: grid; gap: 8px; }
.bw-global-queue__row { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 10px; }
.bw-global-queue__main { min-width: 0; display: grid; gap: 7px; }
.bw-global-queue__main strong { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-global-queue__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--bw-muted); font-size: 12px; min-width: 0; }
.bw-global-queue__meta span { overflow-wrap: anywhere; min-width: 0; }
.bw-global-queue__command { min-width: 0; display: grid; gap: 4px; }
.bw-global-queue__command span { color: var(--bw-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
.bw-global-queue__command code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; padding: 7px; color: var(--bw-body); background: #0b0f0c; white-space: normal; overflow-wrap: anywhere; }
.bw-global-search, .bw-activity-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.bw-global-search__row, .bw-activity-row { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; gap: 8px; }
.bw-global-search__row strong, .bw-activity-row strong { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-global-search__row p { margin: 4px 0 0; color: var(--bw-muted); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-global-search__meta, .bw-activity-row__meta { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--bw-muted); font-size: 12px; }
.bw-global-search__meta span, .bw-activity-row__meta span { overflow-wrap: anywhere; min-width: 0; }
.bw-activity-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
.bw-activity-row__main { min-width: 0; display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.bw-activity-row__main span { color: var(--bw-muted); font-size: 12px; text-align: right; overflow-wrap: anywhere; }
.bw-global-health-projects, .bw-drift-groups, .bw-drift-list { display: grid; gap: 8px; margin-top: 10px; }
.bw-global-health-project, .bw-drift-row { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 8px; }
.bw-global-health-project strong, .bw-drift-row strong { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-global-health-project code, .bw-drift-row code, .bw-drift-action code { display: block; color: var(--bw-muted); white-space: normal; overflow-wrap: anywhere; }
.bw-global-health-project__meta, .bw-drift-row__meta, .bw-drift-action__meta { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--bw-muted); font-size: 12px; }
.bw-drift-group { min-width: 0; display: grid; gap: 8px; }
.bw-drift-group__header { min-height: 30px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--bw-text); }
.bw-drift-row__main { min-width: 0; display: grid; gap: 4px; }
.bw-drift-row__main p { margin: 0; color: var(--bw-muted); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-drift-actions { display: grid; gap: 6px; }
.bw-drift-action { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; padding: 8px; display: grid; gap: 6px; }
.bw-drift-action__meta span { overflow-wrap: anywhere; }
.bw-field { min-width: 0; display: grid; gap: 5px; }
.bw-field-label { color: var(--bw-muted); font-size: 12px; display: grid; gap: 2px; }
.bw-field-label__hint { color: var(--bw-muted); }
.bw-input { width: 100%; min-height: 36px; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-text); padding: 7px 9px; min-width: 0; }
.bw-input:disabled { cursor: not-allowed; opacity: 0.55; color: var(--bw-muted); }
.bw-input:focus { outline: 2px solid var(--bw-focus); outline-offset: 1px; }
.bw-settings-add { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 10px; align-items: end; margin-bottom: 12px; }
.bw-settings-modes, .bw-settings-projects, .bw-settings-commands { display: grid; gap: 10px; }
.bw-settings-modes { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 12px; }
.bw-settings-mode, .bw-settings-project { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 10px; }
.bw-settings-mode header, .bw-settings-project__header, .bw-settings-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; min-width: 0; }
.bw-settings-project__header div { min-width: 0; display: grid; gap: 2px; }
.bw-settings-mode strong, .bw-settings-project strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-settings-mode p { margin: 0; color: var(--bw-body); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-settings-mode span, .bw-settings-project__header span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.bw-settings-command { min-width: 0; display: grid; gap: 4px; }
.bw-settings-command span { color: var(--bw-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
.bw-settings-command code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; padding: 7px; color: var(--bw-body); background: #0b0f0c; white-space: normal; overflow-wrap: anywhere; }
.bw-button { min-height: 36px; border: 1px solid var(--bw-border); border-radius: 8px; background: var(--bw-panel-2); color: var(--bw-text); display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 7px 10px; cursor: pointer; max-width: 100%; }
.bw-button--primary { background: #17391f; border-color: rgba(113, 212, 139, 0.6); }
.bw-button--ghost { background: transparent; }
.bw-button:disabled { cursor: not-allowed; opacity: 0.5; background: var(--bw-panel-2); border-color: var(--bw-border); }
.bw-button__label { overflow-wrap: anywhere; }
.bw-badge { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; border: 1px solid var(--bw-border); padding: 2px 8px; color: var(--bw-body); font-size: 12px; width: fit-content; max-width: 100%; overflow-wrap: anywhere; }
.bw-badge--accent, .bw-badge--success { border-color: rgba(113, 212, 139, 0.5); color: #b8f2c5; }
.bw-badge--warning { border-color: rgba(215, 185, 105, 0.6); color: #f3df9f; }
.bw-badge--danger { border-color: rgba(223, 124, 124, 0.65); color: #f1b1b1; }
.bw-notice { border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; display: grid; gap: 4px; background: rgba(255,255,255,0.02); }
.bw-notice__label { color: var(--bw-text); font-size: 12px; font-weight: 650; }
.bw-notice__body { overflow-wrap: anywhere; }
.bw-notice--success { border-color: rgba(113, 212, 139, 0.42); }
.bw-notice--warning { border-color: rgba(215, 185, 105, 0.55); }
.bw-notice--danger { border-color: rgba(223, 124, 124, 0.6); }
.bw-view-tabs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid var(--bw-border); border-radius: 8px; padding: 8px; background: var(--bw-panel); }
.bw-view-tabs__tab { min-height: 34px; border: 1px solid var(--bw-border); border-radius: 8px; padding: 7px 10px; color: var(--bw-body); display: inline-flex; align-items: center; justify-content: center; overflow-wrap: anywhere; }
.bw-view-tabs__tab--active { color: var(--bw-text); border-color: rgba(113, 212, 139, 0.55); background: #17391f; }
.bw-kanban { max-width: 100%; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 260px); gap: 12px; overflow-x: auto; padding-bottom: 4px; align-items: start; }
.bw-kanban__column { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; grid-template-rows: auto minmax(120px, 1fr); gap: 10px; align-content: start; }
.bw-kanban__column--blocked, .bw-kanban__column--needs_verification { border-color: rgba(215, 185, 105, 0.5); }
.bw-kanban__column--in_progress { border-color: rgba(113, 212, 139, 0.38); }
.bw-kanban__column--verified, .bw-kanban__column--closed { border-color: rgba(113, 212, 139, 0.5); }
.bw-kanban__column--cancelled { border-color: rgba(223, 124, 124, 0.62); }
.bw-kanban__column-title { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--bw-text); font-weight: 650; }
.bw-kanban__column-title span { overflow-wrap: anywhere; }
.bw-kanban__items { min-width: 0; display: grid; gap: 10px; align-content: start; }
.bw-kanban-card { width: 100%; min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: var(--bw-panel); display: grid; gap: 9px; align-self: stretch; }
.bw-kanban-card--blocked, .bw-kanban-card--needs_verification { border-color: rgba(215, 185, 105, 0.5); }
.bw-kanban-card--in_progress, .bw-kanban-card--reserved { border-color: rgba(113, 212, 139, 0.4); }
.bw-kanban-card--verified, .bw-kanban-card--closed { border-color: rgba(113, 212, 139, 0.5); }
.bw-kanban-card--cancelled { border-color: rgba(223, 124, 124, 0.55); }
.bw-kanban-card__header { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.bw-kanban-card__identity { min-width: 0; display: grid; gap: 3px; }
.bw-kanban-card__title { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-kanban-card__id { color: var(--bw-muted); font-size: 11px; overflow-wrap: anywhere; }
.bw-kanban-card__state, .bw-kanban-card__labels { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.bw-kanban-card__facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.bw-kanban-card__facts div { min-width: 0; border-radius: 8px; padding: 7px; background: rgba(255,255,255,0.04); }
.bw-kanban-card__facts dt { color: var(--bw-muted); font-size: 10px; }
.bw-kanban-card__facts dd { margin: 2px 0 0; color: var(--bw-text); font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.bw-kanban-card__summary { margin: 0; color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-sprint-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; align-items: start; }
.bw-sprint-action { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; align-items: end; }
.bw-sprint-action__header { grid-column: 1 / -1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bw-sprint-action__header strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-sprint-actions__wide { grid-column: 1 / -1; }
.bw-sprint-review { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr); gap: 10px; align-items: start; }
.bw-review-queue { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 10px; }
.bw-review-queue__header { min-height: 30px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.bw-review-queue__header strong, .bw-review-item strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-review-items { display: grid; gap: 8px; }
.bw-review-item { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 9px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; background: rgba(0,0,0,0.12); }
.bw-review-item div { min-width: 0; display: grid; gap: 3px; }
.bw-review-item span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-review-item__meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.bw-discovery-form__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.bw-sprint-table td > strong, .bw-sprint-table td > span { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-sprint-table td > span { color: var(--bw-muted); font-size: 12px; margin-top: 3px; }
.bw-sprint-table__labels { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.bw-dependency-view { display: grid; gap: 10px; }
.bw-dependency-list { display: grid; gap: 8px; }
.bw-dependency-row { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 10px; }
.bw-dependency-row__main { min-width: 0; display: grid; gap: 3px; }
.bw-dependency-row__main strong { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-dependency-row__main span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-dependency-row__meta, .bw-dependency-row__links, .bw-dependency-row__link-list { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.bw-dependency-row__link-list > span { color: var(--bw-muted); font-size: 12px; }
.bw-sprint-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.bw-sprint-timeline__step { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 8px; }
.bw-sprint-timeline__step--blocked, .bw-sprint-timeline__step--needs_verification { border-color: rgba(215, 185, 105, 0.5); }
.bw-sprint-timeline__step--in_progress, .bw-sprint-timeline__step--verified, .bw-sprint-timeline__step--closed { border-color: rgba(113, 212, 139, 0.45); }
.bw-sprint-timeline__step--cancelled { border-color: rgba(223, 124, 124, 0.55); }
.bw-sprint-timeline__header, .bw-sprint-timeline__item { min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.bw-sprint-timeline__header strong, .bw-sprint-timeline__item span { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-sprint-timeline__items { display: grid; gap: 6px; color: var(--bw-muted); }
.bw-sprint-timeline__item { border: 1px solid var(--bw-border); border-radius: 8px; padding: 8px; background: var(--bw-panel); }
.bw-sprint-progress { display: grid; gap: 12px; }
.bw-sprint-progress__bars { display: grid; gap: 8px; }
.bw-sprint-progress__bar { min-width: 0; display: grid; grid-template-columns: minmax(120px, 0.8fr) minmax(140px, 1fr) auto; gap: 8px; align-items: center; color: var(--bw-muted); }
.bw-sprint-progress__bar span, .bw-sprint-progress__bar strong { overflow-wrap: anywhere; }
.bw-sprint-progress__bar strong { color: var(--bw-text); }
.bw-sprint-progress__bar progress { width: 100%; min-width: 0; height: 12px; accent-color: var(--bw-accent); }
.bw-work-table, .bw-event-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.bw-work-table th, .bw-work-table td, .bw-event-table th, .bw-event-table td { border-bottom: 1px solid var(--bw-border); padding: 9px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.bw-work-table th, .bw-event-table th { color: var(--bw-muted); font-weight: 600; }
.bw-row-select { color: var(--bw-text); font-weight: 650; text-decoration: underline; text-decoration-color: var(--bw-border); text-underline-offset: 2px; }
.bw-row-select:hover, .bw-row-select:focus-visible { text-decoration-color: var(--bw-accent); }
tr.bw-row--selected { background: rgba(113, 212, 139, 0.1); }
tr.bw-row--selected .bw-row-select { text-decoration-color: var(--bw-accent); }
.bw-raw-summary, .bw-raw-preview-meta, .bw-raw-preview-panel__status, .bw-raw-table__status { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.bw-raw-summary { margin-bottom: 10px; }
.bw-raw-table td > strong, .bw-raw-table td > span { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-raw-table td > span, .bw-raw-table__summary, .bw-raw-table__status span { color: var(--bw-muted); font-size: 12px; }
.bw-raw-table__summary { margin: 5px 0 0; line-height: 1.35; }
.bw-raw-preview-meta, .bw-raw-preview-panel, .bw-raw-commands { display: grid; gap: 9px; margin-bottom: 10px; min-width: 0; }
.bw-raw-preview-meta, .bw-raw-preview-panel__status { display: flex; }
.bw-raw-preview-panel__detail { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-raw-preview { max-height: 340px; overflow: auto; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.bw-raw-commands div { min-width: 0; display: grid; gap: 4px; }
.bw-raw-commands span { color: var(--bw-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
.bw-raw-commands code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-raw-source-links, .bw-ingest-commands, .bw-ingest-findings, .bw-ingest-mutations { display: grid; gap: 9px; min-width: 0; }
.bw-raw-source-links { margin-bottom: 10px; }
.bw-raw-source-links div, .bw-ingest-commands div { min-width: 0; display: grid; gap: 4px; }
.bw-raw-source-links span, .bw-ingest-commands span { color: var(--bw-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
.bw-raw-source-links code, .bw-ingest-commands code, .bw-ingest-mutation > code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-ingest-finding, .bw-ingest-mutation { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 8px; }
.bw-ingest-finding { grid-template-columns: auto minmax(0, 1fr); align-items: start; }
.bw-ingest-finding strong, .bw-ingest-mutation strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-ingest-finding p, .bw-ingest-mutation p { margin: 0; color: var(--bw-muted); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.bw-ingest-finding span, .bw-ingest-mutation span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-ingest-mutation header { min-width: 0; display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.bw-ingest-mutation header div { min-width: 0; display: grid; gap: 3px; }
.bw-ingest-diff { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.bw-ingest-diff div { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 7px; background: var(--bw-panel); }
.bw-ingest-diff dt { color: var(--bw-muted); font-size: 10px; }
.bw-ingest-diff dd { margin: 2px 0 0; color: var(--bw-text); font-size: 12px; overflow-wrap: anywhere; }
.bw-contradiction-summary, .bw-contradiction-list, .bw-contradiction-resolutions, .bw-contradiction-evidence { display: grid; gap: 9px; min-width: 0; }
.bw-contradiction-summary { display: flex; flex-wrap: wrap; margin-bottom: 10px; }
.bw-contradiction { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 10px; }
.bw-contradiction header { min-width: 0; display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.bw-contradiction header div { min-width: 0; display: grid; gap: 3px; }
.bw-contradiction strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-contradiction span, .bw-contradiction p { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-contradiction-assertions { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.bw-contradiction-assertions div, .bw-contradiction-evidence div, .bw-contradiction-resolutions div { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 8px; background: var(--bw-panel); display: grid; gap: 5px; }
.bw-contradiction-assertions dt { color: var(--bw-muted); font-size: 10px; }
.bw-contradiction-assertions dd { margin: 0; color: var(--bw-text); font-size: 12px; overflow-wrap: anywhere; }
.bw-contradiction-evidence code, .bw-contradiction-resolutions code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-wiki-summary { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; min-width: 0; }
.bw-wiki-table td > strong, .bw-wiki-table td > span { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-wiki-table td > span { color: var(--bw-muted); font-size: 12px; }
.bw-wiki-coverage, .bw-wiki-records, .bw-wiki-links { display: grid; gap: 9px; min-width: 0; }
.bw-wiki-coverage div, .bw-wiki-records div { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 8px; background: var(--bw-panel); display: grid; gap: 5px; }
.bw-wiki-coverage span, .bw-wiki-records span, .bw-wiki-records p { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-wiki-coverage code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-wiki-records strong, .bw-wiki-links strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-filter-links { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; min-width: 0; }
.bw-filter-links__item { border: 1px solid var(--bw-border); border-radius: 8px; padding: 5px 8px; color: var(--bw-muted); text-decoration: none; font-size: 12px; overflow-wrap: anywhere; }
.bw-filter-links__item--active { border-color: var(--bw-accent); color: var(--bw-text); background: rgba(92, 141, 107, 0.18); }
.bw-decision-timeline { display: grid; gap: 10px; min-width: 0; }
.bw-decision-event { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; gap: 9px; }
.bw-decision-event header { display: flex; align-items: start; justify-content: space-between; gap: 8px; min-width: 0; }
.bw-decision-event header div { display: grid; gap: 3px; min-width: 0; }
.bw-decision-event strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-decision-event span, .bw-decision-event p, .bw-decision-event blockquote { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-decision-event blockquote { border-left: 2px solid var(--bw-accent); padding-left: 8px; color: var(--bw-body); }
.bw-knowledge-health { display: grid; gap: 10px; min-width: 0; }
.bw-health-finding { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; gap: 9px; }
.bw-health-finding__header { display: flex; align-items: start; justify-content: space-between; gap: 8px; min-width: 0; }
.bw-health-finding__header div { display: grid; gap: 3px; min-width: 0; }
.bw-health-finding strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-health-finding span, .bw-health-finding p { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-health-finding__actions { display: grid; gap: 6px; min-width: 0; }
.bw-health-finding__actions code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-report-table td > strong, .bw-report-table td > span { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-report-table td > span { color: var(--bw-muted); font-size: 12px; margin-top: 3px; }
.bw-report-table code { display: block; color: var(--bw-muted); white-space: normal; overflow-wrap: anywhere; }
.bw-report-preview { max-height: 160px; overflow: auto; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0; font-size: 11px; }
.bw-report-export-list, .bw-report-commands { display: grid; gap: 10px; min-width: 0; }
.bw-report-export { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; gap: 9px; }
.bw-report-export header { display: flex; align-items: start; justify-content: space-between; gap: 8px; min-width: 0; }
.bw-report-export header div, .bw-report-commands div { display: grid; gap: 4px; min-width: 0; }
.bw-report-export strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-report-export span, .bw-report-export p, .bw-report-commands span { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-report-export > code, .bw-report-commands code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-obsidian-table td > strong, .bw-obsidian-table td > span, .bw-obsidian-table td > code { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-obsidian-table td > span { color: var(--bw-muted); font-size: 12px; margin-top: 4px; }
.bw-obsidian-table td > code { color: var(--bw-muted); white-space: normal; margin-top: 6px; }
.bw-vault-link-grid, .bw-obsidian-invalid { display: grid; gap: 10px; min-width: 0; }
.bw-vault-link { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; background: rgba(255,255,255,0.015); display: grid; gap: 9px; }
.bw-vault-link header { display: flex; align-items: start; justify-content: space-between; gap: 8px; min-width: 0; }
.bw-vault-link header div { display: grid; gap: 3px; min-width: 0; }
.bw-vault-link strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-vault-link span, .bw-vault-link p, .bw-vault-link-actions span { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-vault-link-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.bw-workflow-action-table td > strong, .bw-workflow-action-table td > span, .bw-workflow-action-table code { display: block; min-width: 0; overflow-wrap: anywhere; }
.bw-workflow-action-table td > span { color: var(--bw-muted); font-size: 12px; line-height: 1.35; margin-top: 4px; }
.bw-workflow-action-table code { color: var(--bw-muted); white-space: normal; margin-top: 6px; }
.bw-sprint-header, .bw-entity-header { display: flex; align-items: start; justify-content: space-between; gap: 16px; border: 1px solid var(--bw-border); border-radius: 8px; background: var(--bw-panel); padding: 16px; }
.bw-sprint-header { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); }
.bw-sprint-header__main { min-width: 0; display: grid; gap: 8px; align-content: start; }
.bw-sprint-header__status, .bw-sprint-header__details { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.bw-sprint-header__details { color: var(--bw-muted); font-size: 12px; }
.bw-sprint-header__details span { overflow-wrap: anywhere; }
.bw-sprint-header h1, .bw-entity-header__title { margin: 0; color: var(--bw-text); font-size: 22px; line-height: 1.2; letter-spacing: 0; overflow-wrap: anywhere; }
.bw-sprint-header p { margin: 0; color: var(--bw-muted); font-size: 13px; overflow-wrap: anywhere; }
.bw-sprint-header--empty { border-color: rgba(215, 185, 105, 0.55); }
.bw-scope-summary { display: grid; gap: 12px; }
.bw-scope-stat { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 4px; }
.bw-scope-stat span { color: var(--bw-muted); font-size: 12px; }
.bw-scope-stat strong { color: var(--bw-text); font-size: 18px; line-height: 1.15; overflow-wrap: anywhere; }
.bw-scope-stat--accent { border-color: rgba(113, 212, 139, 0.45); }
.bw-scope-stat--success { border-color: rgba(113, 212, 139, 0.45); }
.bw-scope-stat--warning { border-color: rgba(215, 185, 105, 0.55); }
.bw-scope-stat--danger { border-color: rgba(223, 124, 124, 0.6); }
.bw-scope-summary__phases { display: grid; gap: 8px; }
.bw-scope-phase { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.bw-scope-phase__main { min-width: 0; display: grid; gap: 3px; }
.bw-scope-phase__main strong { color: var(--bw-text); line-height: 1.3; overflow-wrap: anywhere; }
.bw-scope-phase__main span { color: var(--bw-muted); font-size: 12px; overflow-wrap: anywhere; }
.bw-scope-phase__meta { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; min-width: 0; }
.bw-directive-summary, .bw-directive-groups, .bw-directive-list, .bw-directive-source-commands, .bw-directive-obligations { display: grid; gap: 10px; min-width: 0; }
.bw-directive-summary__counts, .bw-directive-row__meta, .bw-directive-row__ids, .bw-directive-badges, .bw-global-queue__directives { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.bw-directive-badges--empty { color: var(--bw-muted); font-size: 12px; }
.bw-directive-source-commands code, .bw-directive-row > code, .bw-directive-mini-row > code { display: block; border: 1px solid var(--bw-border); border-radius: 8px; background: #0b0f0c; color: var(--bw-body); padding: 7px; white-space: normal; overflow-wrap: anywhere; }
.bw-directive-obligation { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 9px; }
.bw-directive-obligation--danger { border-color: rgba(223, 124, 124, 0.58); }
.bw-directive-obligation header { min-width: 0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: 8px; }
.bw-directive-obligation header strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-directive-group { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: rgba(255,255,255,0.015); padding: 10px; display: grid; gap: 9px; }
.bw-directive-group--blocked { border-color: rgba(223, 124, 124, 0.6); }
.bw-directive-group--required { border-color: rgba(215, 185, 105, 0.55); }
.bw-directive-group--recommended { border-color: rgba(113, 212, 139, 0.45); }
.bw-directive-group__header, .bw-directive-row__header { min-width: 0; display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 8px; }
.bw-directive-group__header strong, .bw-directive-row strong, .bw-directive-mini-row strong { color: var(--bw-text); overflow-wrap: anywhere; }
.bw-directive-row, .bw-directive-mini-row { min-width: 0; border: 1px solid var(--bw-border); border-radius: 8px; background: var(--bw-panel); padding: 10px; display: grid; gap: 8px; }
.bw-directive-row--blocked, .bw-directive-mini-row--blocked { border-color: rgba(223, 124, 124, 0.5); }
.bw-directive-row--required, .bw-directive-mini-row--required { border-color: rgba(215, 185, 105, 0.48); }
.bw-directive-row--recommended, .bw-directive-mini-row--recommended { border-color: rgba(113, 212, 139, 0.38); }
.bw-directive-row__header div { min-width: 0; display: grid; gap: 3px; }
.bw-directive-row span, .bw-directive-row p, .bw-directive-mini-row span, .bw-directive-mini-row p { color: var(--bw-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; margin: 0; }
.bw-entity-header__labels, .bw-verification, .bw-ref-list__item, .bw-lock-list li, .bw-command-list, .bw-command-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
.bw-command-list { align-items: stretch; }
.bw-command-row { justify-content: space-between; border: 1px solid var(--bw-border); border-radius: 8px; padding: 10px; width: 100%; }
.bw-command-row code { color: var(--bw-muted); overflow-wrap: anywhere; }
.bw-command-row__actions, .bw-command-confirm { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bw-command-confirm { color: var(--bw-muted); font-size: 12px; }
.bw-json-state { display: none; }
.bw-stale-banner { border-color: rgba(215, 185, 105, 0.7); }
@media (max-width: 860px) {
  .bw-console { grid-template-columns: 1fr; }
  .bw-console__sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--bw-border); }
  .bw-console__nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bw-console__topbar { position: static; align-items: stretch; flex-direction: column; }
  .bw-console__actions { justify-content: start; }
  .bw-page-grid { grid-template-columns: 1fr; }
  .bw-global-queues { grid-template-columns: 1fr; }
  .bw-kanban { grid-auto-flow: row; grid-auto-columns: initial; grid-template-columns: 1fr; overflow-x: visible; }
  .bw-sprint-action { grid-template-columns: 1fr; }
  .bw-sprint-review, .bw-discovery-form__row, .bw-review-item { grid-template-columns: 1fr; }
  .bw-review-item__meta { justify-content: flex-start; }
  .bw-sprint-progress__bar { grid-template-columns: 1fr; }
  .bw-settings-add, .bw-settings-modes, .bw-settings-grid { grid-template-columns: 1fr; }
  .bw-ingest-diff { grid-template-columns: 1fr; }
  .bw-contradiction-assertions { grid-template-columns: 1fr; }
  .bw-sprint-header, .bw-scope-phase { grid-template-columns: 1fr; }
  .bw-scope-phase__meta { justify-content: flex-start; }
  .bw-activity-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bw-activity-row__main { display: grid; }
  .bw-activity-row__main span { text-align: left; }
}
`;
