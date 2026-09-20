import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Seeds from './Seeds.tsx';
import type { GameState } from '../lib/useGame.ts';
import { boardLayout } from '../lib/layout.ts';
import { previewMove, type MovePreview } from '../lib/preview.ts';
import { useOrientation } from '../lib/useOrientation.ts';
import { useSettings } from '../lib/useSettings.ts';
import { hapticTap } from '../lib/haptics.ts';
import { useT } from '../i18n/useT.ts';

interface Props {
  state: GameState;
  viewpoint: 0 | 1;      // which player sits nearest the viewer
  interactive: boolean;  // whether the near row can be tapped
  onPlay: (pit: number) => void;
}

/** Hold this long on a pit before the preview opens (touch and pen only). */
const LONG_PRESS_MS = 320;
/** Sliding further than this before the hold fires means "scroll", not "peek". */
const SLOP_PX = 12;

// End-store seed pile (captured seeds visibly accumulate).
function Store({
  count, side, label, incoming,
}: {
  count: number; side: 'near' | 'far'; label: string;
  /** Seeds the previewed move would drop in here. */
  incoming?: number;
}) {
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
    <div className={`store store-${side}${incoming ? ' store-preview' : ''}`} aria-label={label}>
      <div className="store-hollow" aria-hidden>{dots}</div>
      <div className="store-count">{count}</div>
      {!!incoming && <div className="store-gain" aria-hidden>+{incoming}</div>}
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

  const isLegal = useCallback(
    (pit: number) => interactive && state.phase === 'idle' && state.legal.includes(pit),
    [interactive, state.phase, state.legal],
  );

  // ---- move preview ------------------------------------------------------
  // Hovering (mouse) or holding (touch) a playable pit answers the question a
  // beginner asks every turn: where do these seeds end up? The preview is
  // derived, never stored in the game state — it can go stale but never wrong.
  const [preview, setPreview] = useState<MovePreview | null>(null);

  const showPreview = useCallback((pit: number | null) => {
    setPreview(prev => {
      if (pit === null) return prev === null ? prev : null;
      if (!isLegal(pit)) return prev === null ? prev : null;
      if (prev?.source === pit) return prev;
      return previewMove(state.pits, pit);
    });
  }, [isLegal, state.pits]);

  // Any change of position or turn invalidates the peek; drop it rather than
  // leave ghost seeds pointing at a board that has moved on.
  useEffect(() => {
    if (state.phase !== 'idle' || !interactive) setPreview(null);
  }, [state.phase, interactive]);

  // ---- long press, and dragging from pit to pit --------------------------
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  // True from the moment a hold opens the preview until the finger lifts. It
  // also swallows the click that release would otherwise fire.
  const holding = useRef(false);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    pressAt.current = null;
  }, []);

  useEffect(() => cancelHold, [cancelHold]);

  /** Which pit is under the finger right now (it may not be the one pressed). */
  const pitUnder = (x: number, y: number): number | null => {
    if (typeof document === 'undefined') return null;
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest('[data-pit]');
    if (!hit) return null;
    const n = Number(hit.getAttribute('data-pit'));
    return Number.isInteger(n) ? n : null;
  };

  const onPointerDown = (pit: number) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return;          // mouse peeks on hover
    if (!isLegal(pit)) return;
    pressAt.current = { x: e.clientX, y: e.clientY };
    holdTimer.current = setTimeout(() => {
      holding.current = true;
      holdTimer.current = null;
      hapticTap();
      showPreview(pit);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (holding.current) {
      // The finger keeps its capture on the pit it started from, so ask the
      // document what is actually under it.
      const pit = pitUnder(e.clientX, e.clientY);
      showPreview(pit !== null && isLegal(pit) ? pit : null);
      return;
    }
    const start = pressAt.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancelHold();
  };

  const endHold = () => {
    cancelHold();
    if (!holding.current) return;
    setPreview(null);
    // Release after the click that follows this pointerup has been swallowed.
    setTimeout(() => { holding.current = false; }, 0);
  };

  const handleClick = (pit: number) => {
    if (holding.current) return;   // this tap was a peek, not a move
    if (!isLegal(pit)) return;
    setPreview(null);
    onPlay(pit);
  };

  const renderPit = (pit: number, rowSide: 'far' | 'near') => {
    const legal = isLegal(pit);
    const gain = preview?.gain[pit] ?? 0;
    const taken = preview?.captured.includes(pit) ?? false;
    const cls = [
      'pit',
      `pit-${rowSide}`,
      legal ? 'pit-legal' : '',
      state.activePit === pit ? 'pit-active' : '',
      state.capturing.includes(pit) ? 'pit-capturing' : '',
      state.hintPit === pit ? 'pit-hint' : '',
      preview ? 'pit-previewing' : '',
      preview?.source === pit ? 'pit-preview-source' : '',
      gain > 0 ? 'pit-preview-sow' : '',
      taken ? 'pit-preview-capture' : '',
      preview && preview.last === pit ? 'pit-preview-last' : '',
    ].join(' ');
    const count = state.pits[pit];
    const after = preview ? preview.after[pit] : count;
    const params = {
      seat: rowSide === 'near' ? t('a11y.seatYours') : t('a11y.seatOpp'),
      index: (pit % 6) + 1,
      count,
    };
    // `count` is what is in the bowl; during a preview the real seeds are
    // packed for the post-sow total so the ghosts slot in beside them.
    const shownCount = preview?.source === pit ? 0 : count;
    return (
      <button
        key={pit}
        type="button"
        data-pit={pit}
        className={cls}
        disabled={!legal}
        onClick={() => handleClick(pit)}
        onPointerEnter={e => { if (e.pointerType === 'mouse' && legal) showPreview(pit); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') showPreview(null); }}
        onPointerDown={onPointerDown(pit)}
        onPointerMove={onPointerMove}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onContextMenu={e => { if (holding.current) e.preventDefault(); }}
        aria-label={t(legal ? 'a11y.pitPlayable' : 'a11y.pit', params)}
      >
        <span className="pit-bowl">
          <Seeds pit={pit} count={shownCount} total={after} />
          {gain > 0 && <Seeds pit={pit} count={after} from={count} total={after} ghost />}
        </span>
        {gain > 0 && (
          <span className={`pit-gain${taken ? ' pit-gain-capture' : ''}`} aria-hidden>
            {taken ? `↑${after}` : `+${gain}`}
          </span>
        )}
        {showCounts && <span className="pit-count" aria-hidden>{count}</span>}
      </button>
    );
  };

  const nearGain = preview && preview.mover === viewpoint ? preview.capturedSeeds : 0;
  const nearStore = (
    <Store key="near" count={state.scores[viewpoint]} side="near" incoming={nearGain}
           label={t('a11y.yourStore', { count: state.scores[viewpoint] })} />
  );
  const farStore = (
    <Store key="far" count={state.scores[opp]} side="far"
           incoming={preview && preview.mover === opp ? preview.capturedSeeds : 0}
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
