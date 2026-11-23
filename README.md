# Fabric

An endless pixel-art factory game for [Toki](https://www.playtoki.app/): mine an asteroid field, lay belts,
smelt, assemble, pipe fluids, launch payloads. Touch-first, also plays with mouse and keyboard. English and German.

- **Endless:** 20 hand-made levels, then generated ones forever; six upgrade tracks; an infinite generated map;
  relocation to a fresh site with permanent beacons; offline progress.
- **Content:** 38 buildings, 43 goods, 6 fluids.
- **No engine:** TypeScript and Canvas 2D. All art is drawn in code from one palette; sounds are synthesised.

## Run

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

The build lands in `dist/` with relative paths, so it runs from any folder.

## Publish on Toki

`public/toki.json` is copied next to `index.html` and fills in the game's page (title, texts, cover, screenshots,
achievements, the extra leaderboard). Either upload `dist/` on Toki's Add game page, or connect the Toki GitHub
App to this repository: it is a Vite project, so Toki offers its build action.

What the game sends to Toki, through `window.toki` when it exists:

| Call | When |
| --- | --- |
| `toki.score(level)` | A level is completed: the highest level ever reached (main list, higher is better). |
| `toki.score(output, "output")` | A new best output per minute: the worth of everything delivered to the hub in a minute. |
| `toki.achievement(id)` | An achievement from `toki.json` is earned. |

Saves live in `localStorage` (`fabric-save`, `fabric-settings`), which Toki's script syncs by itself.

## Where things are

| File | What |
| --- | --- |
| `src/defs.ts` | Items, buildings, recipes, levels, upgrades: the content tables. |
| `src/world.ts` | The generated asteroid field. |
| `src/sim.ts` | The simulation: belts, machines, pipes, power, levels, saving. No DOM, covered by `tests/`. |
| `src/sprites.ts` | The pixel art. |
| `src/render.ts` | The canvas renderer: lighting, particles, effects. |
| `src/ui.ts`, `src/style.css` | The HUD. |
| `src/main.ts` | Loop, input, feedback, calls to Toki. |
| `src/i18n.ts` | English and German texts. |
