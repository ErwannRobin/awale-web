// Renders up to a handful of polished-stone seeds inside a pit as CSS dots.
// Colours & jitter are deterministic per (pit, seedIndex) so a pit looks
// stable across re-renders but varied across the board.

const STONE = ['green', 'ivory', 'gold', 'brown'] as const;

function hash(n: number) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// Sunflower-ish placement so seeds cluster naturally in the bowl.
function layout(i: number, total: number) {
  const golden = 2.399963;
  const a = i * golden;
  const r = total <= 1 ? 0 : 0.62 * Math.sqrt((i + 0.5) / total);
  return { x: 50 + Math.cos(a) * r * 46, y: 50 + Math.sin(a) * r * 46 };
}

interface Props {
  pit: number;
  /** How many seeds this call draws, counting from slot 0. */
  count: number;
  /** First slot to draw. Lets a move preview fill only the incoming seeds. */
  from?: number;
  /** Slots the bowl is packed for. Defaults to `count`; a preview passes the
   *  post-sow total so real and ghost seeds share one arrangement. */
  total?: number;
  /** Faint, dashed outlines: seeds that would arrive, not seeds that are there. */
  ghost?: boolean;
}

export default function Seeds({ pit, count, from = 0, total, ghost = false }: Props) {
  if (count <= 0) return null;
  const shown = Math.min(count, 12);
  const packed = Math.min(total ?? count, 12);
  const start = Math.min(Math.max(from, 0), shown);
  if (start >= shown) return null;
  const dots = [];
  for (let i = start; i < shown; i++) {
    const h = hash(pit * 131 + i * 17);
    const color = STONE[h % STONE.length];
    const jx = ((hash(h) % 100) / 100 - 0.5) * 6;
    const jy = ((hash(h + 7) % 100) / 100 - 0.5) * 6;
    const { x, y } = layout(i, packed);
    dots.push(
      <span
        key={i}
        className={`seed seed-${color}${ghost ? ' seed-ghost' : ''}`}
        style={{ left: `calc(${x + jx}% )`, top: `calc(${y + jy}%)` }}
      />,
    );
  }
  return <span className={`seeds${ghost ? ' seeds-ghost' : ''}`}>{dots}</span>;
}
