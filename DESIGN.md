# Openboard Design System

## 0. Research Log

- Embedded references: shortlisted Linear, Notion, and Figma workspace patterns; selected premium utilitarian minimalism with a neutral canvas because board tools need visual calm and dense controls.
- Lazyweb: skipped because the product is an interaction-first local application and the primary reference is the board workflow.
- Imagen drafts: skipped because the product uses no illustrative or photographic surface.

## 1. Atmosphere & Identity

Openboard is a quiet work surface: warm paper around a precise, infinite canvas. Its signature is a restrained editor chrome that keeps controls legible without competing with the work itself.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Application background | `--surface-app` | `#F7F6F3` | Browser background |
| Canvas | `--surface-canvas` | `#FFFDFC` | Board surface |
| Panel | `--surface-panel` | `#FFFFFF` | Controls and dialogs |
| Ink | `--text-primary` | `#242424` | Primary text |
| Muted ink | `--text-secondary` | `#73716D` | Supporting text |
| Line | `--border-default` | `#E7E3DD` | Dividers and controls |
| Accent | `--accent-primary` | `#315C45` | Active controls and focus |
| Accent soft | `--accent-soft` | `#EDF3EC` | Presence and selected state |
| Warning note | `--note-yellow` | `#FBF3DB` | New note default |
| Blue note | `--note-blue` | `#E1F3FE` | Note color |
| Red note | `--note-red` | `#FDEBEC` | Note color |

## 3. Typography

Primary type is `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`; metadata uses `ui-monospace, SFMono-Regular, Menlo, monospace`.

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| Title | 20px | 650 | Board title |
| Body | 16px | 400 | Note content |
| Small | 14px | 400 | Controls |
| Caption | 12px | 600 | Labels and state |

## 4. Spacing & Layout

The base unit is 4px. Use `--space-1` through `--space-8` for 4px to 32px. The board shell has a 56px top bar, a 64px left rail, and a responsive right details panel.

## 5. Components

### Tool button

- Structure: labelled `button` in the left rail.
- States: default, hover, active, visible focus, disabled.
- Accessibility: native button, readable label, keyboard focus.

### Board card

- Structure: board title, collaborator count, and action button.
- States: default, hover, empty, loading, error.
- Layout: responsive grid.

### Note

- Structure: editable text area within a colored canvas object.
- States: idle, selected, editing, remote update.
- Accessibility: labelled text input and visible selection state.

## 6. Motion & Interaction

Use 120ms ease-out for button feedback and 200ms ease-in-out for panel changes. Only opacity and transform are animated. Reduced motion disables transitions.

## 7. Depth & Surface

Use borders-only depth. Panels use `1px solid var(--border-default)` with no drop shadows.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA, keyboard-operable controls, visible focus, and reduced-motion support.
- Accepted debt: the first release does not offer freeform shape drawing; it focuses on collaborative notes and image assets.
