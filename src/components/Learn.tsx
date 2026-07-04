interface Props { onBack: () => void }

const RULES: { h: string; b: string }[] = [
  {
    h: 'The board',
    b: 'Twelve pits in a circle, six per player. You own the six pits on your side. Every pit starts with 4 seeds — 48 in all.',
  },
  {
    h: 'Sowing',
    b: 'On your turn pick one of your non-empty pits and scatter all of its seeds one by one into the following pits, moving counterclockwise. The pit you lifted from is skipped if you loop all the way around.',
  },
  {
    h: 'Capturing',
    b: "If your last seed lands in an opponent's pit that then holds exactly 2 or 3 seeds, you capture it. Capture also sweeps backward through the pits just before it while they too hold 2 or 3 — up to four pits in a row.",
  },
  {
    h: 'Feed your opponent',
    b: 'If the opponent has no seeds, you must play a move that reaches their side to give them some. A move that would capture every last one of their seeds (a “grand slam”) is not allowed if any other move exists.',
  },
  {
    h: 'Winning',
    b: 'First to capture 25 or more seeds wins the game. If a player cannot move, each side keeps the seeds still on their own row. Equal scores at the end is a draw.',
  },
];

export default function Learn({ onBack }: Props) {
  return (
    <div className="screen learn">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label="Back">←</button>
        <div className="brand">◇ AWALÉ ◇</div>
        <span style={{ width: 44 }} />
      </header>
      <div className="learn-body">
        <h2 className="learn-title">How to play</h2>
        <p className="learn-lead">Awalé is a game of the oware (mancala) family — pure strategy, no luck.</p>
        {RULES.map((r, i) => (
          <div className="rule-block" key={i}>
            <div className="rule-num">{i + 1}</div>
            <div>
              <h3>{r.h}</h3>
              <p>{r.b}</p>
            </div>
          </div>
        ))}
        <button className="pill pill-green learn-cta" onClick={onBack}>
          <span className="pill-body"><span className="pill-title">GOT IT</span></span>
        </button>
      </div>
    </div>
  );
}
