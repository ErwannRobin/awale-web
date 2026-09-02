import Seeds from './Seeds';
import type { GameState } from '../lib/useGame';
import { boardLayout } from '../lib/layout';
import { useOrientation } from '../lib/useOrientation';

interface Props {
  state: GameState;
  viewpoint: 0 | 1;      // which player sits nearest the viewer
  interactive: boolean;  // whether the near row can be tapped
  onPlay: (pit: number) => void;
}

// End-store seed pile (captured seeds visibly accumulate).
function Store({ count, side, label }: { count: number; side: 'near' | 'far'; label: string }) {
  const pile = Math.min(count, 30);
  const dots = [];
  for (let i = 0; i < pile; i++) {
    const color = ['green', 'ivory', 'gold', 'brown'][(i * 7 + 3) % 4];
    const col = i % 4;
    const row = Math.floor(i / 4);
    dots.push(
      <span
        key={i}
        className={`seed seed-${color}`}
        style={{
          left: `${18 + col * 21}%`,
          bottom: `${8 + row * 12}%`,
          top: 'auto',
        }}
      />,
    );
  }
  return (
    <div className={`store store-${side}`} aria-label={`${label}: ${count} seeds captured`}>
      <div className="store-hollow" aria-hidden>{dots}</div>
      <div className="store-count">{count}</div>
    </div>
  );
}

export default function Board({ state, viewpoint, interactive, onPlay }: Props) {
  const opp = (1 - viewpoint) as 0 | 1;
  const orientation = useOrientation();
  // Pit arrangement comes from the pure layout module, which guarantees the
  // index order 0 → 11 reads counterclockwise on screen in either orientation.
  const layout = boardLayout(viewpoint, orientation);

  const isLegal = (pit: number) =>
    interactive && state.phase === 'idle' && state.legal.includes(pit);

  const renderPit = (pit: number, rowSide: 'far' | 'near') => {
    const legal = isLegal(pit);
    const cls = [
      'pit',
      `pit-${rowSide}`,
      legal ? 'pit-legal' : '',
      state.activePit === pit ? 'pit-active' : '',
      state.capturing.includes(pit) ? 'pit-capturing' : '',
      state.hintPit === pit ? 'pit-hint' : '',
    ].join(' ');
    const seat = rowSide === 'near' ? 'Your' : "Opponent's";
    return (
      <button
        key={pit}
        type="button"
        className={cls}
        disabled={!legal}
        onClick={() => legal && onPlay(pit)}
        aria-label={`${seat} pit ${(pit % 6) + 1}, ${state.pits[pit]} seeds${legal ? ', playable' : ''}`}
      >
        <span className="pit-bowl">
          <Seeds pit={pit} count={state.pits[pit]} />
        </span>
        <span className="pit-count" aria-hidden>{state.pits[pit]}</span>
      </button>
    );
  };

  const nearStore = <Store key="near" count={state.scores[viewpoint]} side="near" label="Your store" />;
  const farStore = <Store key="far" count={state.scores[opp]} side="far" label="Opponent store" />;
  const stores = layout.storesReversed ? [farStore, nearStore] : [nearStore, farStore];

  return (
    <div className="board-wrap">
      <div className="board" style={{ flexDirection: layout.boardDirection }}>
        {stores[0]}
        <div className="pit-grid" style={{ flexDirection: layout.gridDirection }}>
          <div className="pit-row pit-row-far" style={{ flexDirection: layout.rowDirection }}>
            {layout.far.map(p => renderPit(p, 'far'))}
          </div>
          <div className={`board-midline board-midline-${orientation}`} />
          <div className="pit-row pit-row-near" style={{ flexDirection: layout.rowDirection }}>
            {layout.near.map(p => renderPit(p, 'near'))}
          </div>
        </div>
        {stores[1]}
      </div>
    </div>
  );
}
