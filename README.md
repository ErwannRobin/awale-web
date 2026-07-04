# Awalé

A polished web build of **Awalé** — the classic African seed-sowing strategy game
of the oware / mancala family.

## Play

- **Play vs AI** — four difficulty levels (Novice → Master), backed by a negamax
  search that runs in a Web Worker so the board never blocks.
- **Two players** — pass-and-play on one device; the board flips so the player to
  move always sits at the bottom.
- **Hint** — asks the strongest engine for the best move and pulses that pit.
- **Undo** (vs AI) — restores your previous position.
- **Challenges** — 12 fixed puzzle positions. You play North and move first;
  win one to unlock the next (progress saved in `localStorage`).
- **Tutorial** — a guided 13-step walkthrough with demo moves, a hands-on turn,
  and a short free-play finish.

## Rules

Twelve pits in a circle, six per player, four seeds each (48 total). On your turn
you lift all the seeds from one of your non-empty pits and sow them one by one
counterclockwise, skipping the pit you started from. If your last seed lands in an
opponent pit that then holds 2 or 3 seeds you capture it, sweeping backward through
adjacent 2/3 pits up to four in a row. You must feed a starving opponent when you
can, and you may not capture *every* one of their seeds if another move exists
(the grand-slam rule). First to 25 seeds wins.

## Develop

```bash
npm install
npm run dev       # start the dev server
npm run build     # typecheck + production build
npm test          # engine rule assertions
```

### Structure

| Path | Purpose |
| --- | --- |
| `src/lib/engine.ts` | Board model, move validation, sowing, capture, end-game |
| `src/lib/ai.ts` | Negamax search + difficulty levels |
| `src/lib/ai.worker.ts` | Runs the AI off the main thread |
| `src/lib/useGame.ts` | Game state machine + seed-by-seed animation |
| `src/lib/progress.ts` | Challenge unlock progress (localStorage) |
| `src/content/challenges.json` | The 12 fixed challenge positions |
| `src/components/` | Menu, Game, Board, Seeds, Learn, Challenges, Tutorial UI |

The engine and AI are a faithful port of a long-standing C implementation; their
rules (including historical quirks) are intentionally preserved verbatim.
