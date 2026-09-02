// Pure board geometry. Given who sits nearest the viewer and the screen shape,
// this returns how the twelve pits are arranged on screen.
//
// INVARIANT — walking pit indices 0 → 1 → … → 11 → 0 must trace a
// COUNTERCLOCKWISE ring as the viewer sees it, because that is the direction
// seeds are sown in awalé. `ringWinding` turns that into something a test can
// assert in any orientation.
//
// The arrangement lives here rather than in CSS media queries for two reasons:
// a mirrored layout silently reverses the sowing direction (that bug shipped
// once already), and a native port has no media queries to reuse.

export type Orientation = 'landscape' | 'portrait';

export interface BoardLayout {
  /** Viewpoint player's six pits, in DOM order. */
  near: number[];
  /** Opponent's six pits, in DOM order. */
  far: number[];
  /** Stack direction of the board (stores + pit grid). */
  boardDirection: 'row' | 'column';
  /** Stack direction of the pit grid (the two rows + the midline). */
  gridDirection: 'column' | 'row-reverse';
  /** Stack direction within one row of six pits. */
  rowDirection: 'row' | 'column';
  /** True when the opponent's store should render before the viewer's. */
  storesReversed: boolean;
}

export function boardLayout(viewpoint: 0 | 1, orientation: Orientation): BoardLayout {
  const opp = 1 - viewpoint;
  const near: number[] = [];
  for (let k = 0; k < 6; k++) near.push(viewpoint * 6 + k);
  // The far row runs backwards: index order continues around the ring, so the
  // opponent pit adjacent to `near`'s last pit must sit adjacent to it.
  const far: number[] = [];
  for (let k = 5; k >= 0; k--) far.push(opp * 6 + k);

  return orientation === 'landscape'
    ? {
        near, far,
        boardDirection: 'row',       // store · pits · store
        gridDirection: 'column',     // far row on top, near row below
        rowDirection: 'row',         // pits run left → right
        storesReversed: false,
      }
    : {
        near, far,
        boardDirection: 'column',    // store above, pits, store below
        gridDirection: 'row-reverse',// near column on the LEFT, far on the right
        rowDirection: 'column',      // pits run top → bottom
        storesReversed: true,        // opponent on top, matching the player cards
      };
}

/** Grid coordinates of every pit: x grows rightwards, y grows downwards. */
export function screenPositions(l: BoardLayout): Map<number, { x: number; y: number }> {
  const pos = new Map<number, { x: number; y: number }>();
  const place = (row: number[], lane: number) => {
    row.forEach((pit, along) => {
      pos.set(pit, l.rowDirection === 'row' ? { x: along, y: lane } : { x: lane, y: along });
    });
  };
  // `column` renders the far row first; `row-reverse` flips the near row to the front.
  if (l.gridDirection === 'column') { place(l.far, 0); place(l.near, 1); }
  else { place(l.near, 0); place(l.far, 1); }
  return pos;
}

/**
 * Signed area of the pit ring in screen coordinates. Because y grows downwards,
 * a NEGATIVE area means the ring reads counterclockwise to the viewer.
 */
export function ringWinding(l: BoardLayout): number {
  const pos = screenPositions(l);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const p = pos.get(i)!;
    const q = pos.get((i + 1) % 12)!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export const isCounterClockwise = (l: BoardLayout): boolean => ringWinding(l) < 0;
