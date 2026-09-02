import Seeds from './Seeds.tsx';
import type { GameState } from '../lib/useGame.ts';
import { boardLayout } from '../lib/layout.ts';
import { useOrientation } from '../lib/useOrientation.ts';
import { useSettings } from '../lib/useSettings.ts';
import { useT } from '../i18n/useT.ts';

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
    <div className={`store store-${side}`} aria-label={label}>
      <div className="store-hollow" aria-hidden>{dots}</div>
      <div className="store-count">{count}</div>
    </div>
  );
}

export default function Board({ state, viewpoint, interactive, onPlay }: Props) {
  const opp = (1 - viewpoint) as 0 | 1;
  const orientation = useOrientation();
  const { showCounts, leftHanded } = useSettings();
  const t = useT();

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
    const params = {
      seat: rowSide === 'near' ? t('a11y.seatYours') : t('a11y.seatOpp'),
      index: (pit % 6) + 1,
      count: state.pits[pit],
    };
    return (
      <button
        key={pit}
        type="button"
        className={cls}
        disabled={!legal}
        onClick={() => legal && onPlay(pit)}
        aria-label={t(legal ? 'a11y.pitPlayable' : 'a11y.pit', params)}
      >
        <span className="pit-bowl">
          <Seeds pit={pit} count={state.pits[pit]} />
        </span>
        {showCounts && <span className="pit-count" aria-hidden>{state.pits[pit]}</span>}
      </button>
    );
  };

  const nearStore = (
    <Store key="near" count={state.scores[viewpoint]} side="near"
           label={t('a11y.yourStore', { count: state.scores[viewpoint] })} />
  );
  const farStore = (
    <Store key="far" count={state.scores[opp]} side="far"
           label={t('a11y.oppStore', { count: state.scores[opp] })} />
  );

  // Left-handed swaps only the two stores. It must never reverse the pit rows:
  // mirroring the ring turns the sowing direction clockwise (see lib/layout.ts).
  const nearFirst = layout.storesReversed ? leftHanded : !leftHanded;
  const stores = nearFirst ? [nearStore, farStore] : [farStore, nearStore];

  return (
    <div className="board-wrap">
      <div className="board" style={{ flexDirection: layout.boardDirection }}
           role="group" aria-label={t('a11y.board')}>
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
