import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Seeds from './Seeds.tsx';
import type { GameState } from '../lib/useGame.ts';
import { boardLayout } from '../lib/layout.ts';
import { landingPit } from '../lib/preview.ts';
import { isValid } from '../lib/engine.ts';
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

  const isLegal = useCallback(
    (pit: number) => interactive && state.phase === 'idle' && state.legal.includes(pit),
    [interactive, state.phase, state.legal],
  );

  // ---- move preview ------------------------------------------------------
  // Hovering (mouse) or holding (touch) a pit answers the question a beginner
  // asks every turn: where does that last seed land? Just that pit — sketching
  // the whole sowing turns a glance into arithmetic.
  //
  // Both rows answer it. Reading the opponent's threats is half of awalé, and
  // "what does that big pit of theirs reach?" is the same question asked of
  // their side, so a pit is previewable whenever its own owner could legally
  // play it — playable-by-you is a narrower thing, and it still gates taps.
  // The preview is derived, never stored in the game state.
  const [preview, setPreview] = useState<{ source: number; target: number } | null>(null);

  const canPreview = useCallback(
    (pit: number) => state.phase === 'idle' && isValid(state.pits, pit),
    [state.phase, state.pits],
  );

  const showPreview = useCallback((pit: number | null) => {
    setPreview(prev => {
      if (pit === null || !canPreview(pit)) return prev === null ? prev : null;
      if (prev?.source === pit) return prev;
      return { source: pit, target: landingPit(state.pits, pit) };
    });
  }, [canPreview, state.pits]);

  // Any change of position or turn invalidates the peek; drop it rather than
  // leave a mark pointing at a board that has moved on.
  useEffect(() => {
    if (state.phase !== 'idle') setPreview(null);
  }, [state.phase]);

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
    if (!canPreview(pit)) return;
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
      showPreview(pit);
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
    const target = preview?.target === pit;
    const cls = [
      'pit',
      `pit-${rowSide}`,
      legal ? 'pit-legal' : '',
      state.activePit === pit ? 'pit-active' : '',
      state.capturing.includes(pit) ? 'pit-capturing' : '',
      state.hintPit === pit ? 'pit-hint' : '',
      target ? 'pit-target' : '',
    ].join(' ');
    const count = state.pits[pit];
    const params = {
      seat: rowSide === 'near' ? t('a11y.seatYours') : t('a11y.seatOpp'),
      index: (pit % 6) + 1,
      count,
    };
    // Not `disabled`: a disabled button swallows the pointer events an
    // opponent-side peek is made of. `aria-disabled` says the same thing to
    // assistive tech, `handleClick` enforces it, and the tab order still stops
    // only at the pits you can actually play.
    return (
      <button
        key={pit}
        type="button"
        data-pit={pit}
        className={cls}
        aria-disabled={legal ? undefined : true}
        tabIndex={legal ? 0 : -1}
        onClick={() => handleClick(pit)}
        onPointerEnter={e => { if (e.pointerType === 'mouse') showPreview(pit); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') showPreview(null); }}
        onPointerDown={onPointerDown(pit)}
        onPointerMove={onPointerMove}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onContextMenu={e => { if (holding.current) e.preventDefault(); }}
        aria-label={t(legal ? 'a11y.pitPlayable' : 'a11y.pit', params)}
      >
        <span className="pit-bowl">
          <Seeds pit={pit} count={count} />
        </span>
        {showCounts && <span className="pit-count" aria-hidden>{count}</span>}
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
    // Always left to right, whatever the page: an Arabic page flips its rows,
    // and a flipped ring of pits is a ring sown clockwise.
    <div className="board-wrap" dir="ltr">
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
