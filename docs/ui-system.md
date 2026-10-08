# Rebyters UI system

Everything the player sees — world HUD, side menu, sheets, Lab, Atlas, Account,
sign-in, empty and loading states — is skinned from one file:
`app/src/routes/player/ui.css`.

## Rules of the system

| Aspect   | Rule |
| -------- | ---- |
| Type     | One family (Sora), four weights (400/500/600/700), seven sizes: 11, 12, 13, 14, 16, 20, 26 px. Nothing under 11 px. |
| Colour   | One accent (cyan). Green, amber, rose and violet only mean good, warning, danger and special, or one of the four stats. |
| Surface  | HUD glass (floats over the world) → panel (sheets, dialogs, menu) → card (rows and tiles) → well (inset read-only areas). |
| Radius   | 8, 12, 16, 20, 26 px, or pill. |
| Controls | `ui-btn` with `ui-btn-primary`, `-secondary`, `-ghost` or `-danger`; `ui-btn-rich` for a two-line action; `ui-close` for every close button. |
| States   | One selected look (accent border and tint) and one locked look (dimmed), shared by every card. |

All values are tokens on `:root` (`--ui-*`). Change the look there.

## How it is wired

- Mark a subtree with the class `rb-ui` to opt it in. The game shell, the
  Lab/Atlas/Account dialog and the sign-in and wallet dialogs already are.
- The component rules sit in the cascade layer `rebyters-ui` and every
  declaration carries `!important`. Important declarations in a layer outrank
  the important declarations of unlayered CSS, so the file wins over the older
  stacked rules in `player.css` without selector tricks.
- `player.css` still owns layout: positions, grids and the size of the world.
  Colour, type, radius, surfaces and control styling belong in `ui.css`. The
  older skin rules in `player.css` are now inert and can be deleted over time.

## Adding something new

Use the shared classes first (`ui-btn…`, `ui-close`, `ui-note`). If a new
component needs its own rule, add it to the matching section of `ui.css` and
build it from tokens rather than literal colours or sizes.
