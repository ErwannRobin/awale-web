import { useEffect, useMemo, useState } from 'react';
import Board from './Board';
import { useGame } from '../lib/useGame';

interface Props {
  mode: 'ai' | 'local';
  level: number;
  onExit: () => void;
  onLearn: () => void;
  onToast: (msg: string) => void;
}

const TIPS = [
  'Capture: land your last seed in an opponent pit that then holds 2 or 3 seeds.',
  'A capture can sweep up to four pits in a row — all holding 2 or 3.',
  'If your opponent is starving, you must play a move that feeds them.',
  'You may not capture every one of your opponent\'s seeds if another move exists.',
  'Loading a pit with many seeds keeps it out of your opponent\'s capture range.',
  'First to 25 seeds wins — half the board plus one.',
];

const LEVEL_NAMES = ['Novice', 'Skilled', 'Expert', 'Master'];

function PlayerCard({
  name, score, pits, offset, active, side,
}: { name: string; score: number; pits: number[]; offset: number; active: boolean; side: 'you' | 'opp' }) {
  const pipRow = [];
  for (let k = 0; k < 6; k++) {
    pipRow.push(<span key={k} className={`pip ${pits[offset + k] > 0 ? 'pip-on' : ''}`}>{pits[offset + k]}</span>);
  }
  return (
    <div className={`pcard pcard-${side} ${active ? 'pcard-active' : ''}`}>
      {side === 'opp' && <div className="pcard-score">{score}</div>}
      <div className="pcard-info">
        <div className="pcard-name">
          {name} {active && <span className="live-dot" aria-hidden />}
        </div>
        <div className="pips">{pipRow}</div>
      </div>
      {side === 'you' && <div className="pcard-score">{score}</div>}
      <div className={`avatar avatar-${side}`} aria-hidden />
    </div>
  );
}

export default function Game({ mode, level, onExit, onLearn, onToast }: Props) {
  const { state, play, hint, undo, newGame } = useGame({ mode, level });
  const [tip, setTip] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTip(t => (t + 1) % TIPS.length), 6000);
    return () => window.clearInterval(id);
  }, []);

  const viewpoint: 0 | 1 = mode === 'ai' ? 0 : state.turn;
  const opp = (1 - viewpoint) as 0 | 1;

  const youName = mode === 'ai' ? 'You' : viewpoint === 0 ? 'South' : 'North';
  const oppName = mode === 'ai' ? LEVEL_NAMES[level] : viewpoint === 0 ? 'North' : 'South';

  const interactive =
    state.phase === 'idle' && (mode === 'local' || state.turn === viewpoint);

  const status = useMemo(() => {
    if (state.phase === 'over') return null;
    if (state.phase === 'thinking') return { pill: 'Thinking…', line: `${oppName} is choosing a move.` };
    if (state.phase === 'animating') return { pill: 'Sowing…', line: 'Seeds are on the move.' };
    if (mode === 'ai') {
      return state.turn === viewpoint
        ? { pill: 'Your Turn', line: 'Select a highlighted pit to sow.' }
        : { pill: `${oppName}'s Turn`, line: 'Waiting for your opponent.' };
    }
    return { pill: `${youName}'s Turn`, line: 'Select a highlighted pit to sow.' };
  }, [state.phase, state.turn, viewpoint, mode, oppName, youName]);

  const winnerText = (): string => {
    if (state.winner === 'draw') return 'Draw';
    if (mode === 'ai') return state.winner === viewpoint ? 'You win!' : `${oppName} wins`;
    return `${state.winner === 0 ? 'South' : 'North'} wins`;
  };

  return (
    <div className={`screen game ${mode === 'local' ? `view-${viewpoint}` : ''}`}>
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label="Back to menu">←</button>
        <div className="brand">◇ AWALÉ ◇</div>
        <div className="game-top-right">
          <button className="round-btn" onClick={onLearn} aria-label="How to play">?</button>
          <button className="round-btn" onClick={() => onToast('Settings — coming soon')} aria-label="Settings">⚙</button>
        </div>
      </header>

      <div className="players">
        <PlayerCard
          name={youName} score={state.scores[viewpoint]} pits={state.pits}
          offset={viewpoint * 6} active={state.turn === viewpoint && state.phase !== 'over'} side="you"
        />
        <div className="turn-center">
          {status && (
            <>
              <div className={`turn-pill ${state.phase === 'thinking' ? 'turn-pill-think' : ''}`}>
                <span className="turn-dot" aria-hidden />{status.pill}
              </div>
              <div className="turn-line">{status.line}</div>
            </>
          )}
        </div>
        <PlayerCard
          name={oppName} score={state.scores[opp]} pits={state.pits}
          offset={opp * 6} active={state.turn === opp && state.phase !== 'over'} side="opp"
        />
      </div>

      <Board state={state} viewpoint={viewpoint} interactive={interactive} onPlay={play} />

      <div className="game-bottom">
        <div className="tip-card">
          <span className="tip-orn" aria-hidden>✧</span>
          <div>
            <div className="tip-text">{TIPS[tip]}</div>
            <button className="tip-more" onClick={onLearn}>Learn more →</button>
          </div>
        </div>
        <div className="game-controls">
          <button className="ctrl" onClick={newGame}>↻ New Game</button>
          {mode === 'ai' && (
            <button className="ctrl" onClick={() => void hint()} disabled={!interactive}>💡 Hint</button>
          )}
          {mode === 'ai' && (
            <button className="ctrl" onClick={undo} disabled={!state.canUndo}>↩ Undo</button>
          )}
        </div>
      </div>

      {state.phase === 'over' && (
        <div className="overlay">
          <div className="over-card">
            <div className="hero-ornament"><span className="diamond">◇</span><span className="rule" /><span className="diamond">◇</span></div>
            <h2 className="over-title">{winnerText()}</h2>
            <div className="over-score">
              <span>{youName} <strong>{state.scores[viewpoint]}</strong></span>
              <span className="over-dash">—</span>
              <span><strong>{state.scores[opp]}</strong> {oppName}</span>
            </div>
            <button className="pill pill-green" onClick={newGame}>
              <span className="pill-body"><span className="pill-title">PLAY AGAIN</span></span>
            </button>
            <button className="pill" onClick={onExit}>
              <span className="pill-body"><span className="pill-title">BACK TO MENU</span></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
