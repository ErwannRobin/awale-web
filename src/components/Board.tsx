import Seeds from './Seeds';
import type { GameState } from '../lib/useGame';

interface Props {
  state: GameState;
  viewpoint: 0 | 1;      // which player sits at the bottom row
  interactive: boolean;  // whether the bottom row can be tapped
  onPlay: (pit: number) => void;
}

// End-store seed pile (captured seeds visibly accumulate).
function Store({ count, side }: { count: number; side: 'left' | 'right' }) {
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
    <div className={`store store-${side}`}>
      <div className="store-hollow">{dots}</div>
      <div className="store-count">{count}</div>
    </div>
  );
}

export default function Board({ state, viewpoint, interactive, onPlay }: Props) {
  const opp = (1 - viewpoint) as 0 | 1;
  const bottomPits: number[] = [];
  for (let k = 0; k < 6; k++) bottomPits.push(viewpoint * 6 + k);
  // Top row rendered right-to-left so sowing reads counterclockwise.
  const topPits: number[] = [];
  for (let k = 5; k >= 0; k--) topPits.push(opp * 6 + k);

  const isLegal = (pit: number) =>
    interactive && state.phase === 'idle' && state.legal.includes(pit);

  const renderPit = (pit: number, rowSide: 'top' | 'bottom') => {
    const legal = isLegal(pit);
    const cls = [
      'pit',
      `pit-${rowSide}`,
      legal ? 'pit-legal' : '',
      state.activePit === pit ? 'pit-active' : '',
      state.capturing.includes(pit) ? 'pit-capturing' : '',
      state.hintPit === pit ? 'pit-hint' : '',
    ].join(' ');
    return (
      <button
        key={pit}
        className={cls}
        disabled={!legal}
        onClick={() => legal && onPlay(pit)}
        aria-label={`Pit with ${state.pits[pit]} seeds`}
      >
        <span className="pit-bowl">
          <Seeds pit={pit} count={state.pits[pit]} />
        </span>
        <span className="pit-count">{state.pits[pit]}</span>
      </button>
    );
  };

  // Left store belongs to the viewpoint player (whose card sits top-left);
  // right store to the opponent.
  return (
    <div className="board-wrap">
      <div className="board">
        <Store count={state.scores[viewpoint]} side="left" />
        <div className="pit-grid">
          <div className="pit-row pit-row-top">
            {topPits.map(p => renderPit(p, 'top'))}
          </div>
          <div className="board-midline" />
          <div className="pit-row pit-row-bottom">
            {bottomPits.map(p => renderPit(p, 'bottom'))}
          </div>
        </div>
        <Store count={state.scores[opp]} side="right" />
      </div>
    </div>
  );
}
