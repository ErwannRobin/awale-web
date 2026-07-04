import challenges from '../content/challenges.json';
import { isUnlocked } from '../lib/progress';

export interface Challenge {
  goal: string;
  scoreJ1: number;   // computer (South, player 0)
  scoreJ2: number;   // human (North, player 1)
  levelIA?: number;  // engine level, default 1
  situation: number[];
}

export const CHALLENGES = challenges as Challenge[];

interface Props {
  completed: number[];
  onStart: (index: number) => void;
  onBack: () => void;
}

export default function Challenges({ completed, onStart, onBack }: Props) {
  const solved = completed.length;
  return (
    <div className="screen challenges">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label="Back">←</button>
        <div className="brand">◇ CHALLENGES ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="challenges-body">
        <h2 className="learn-title">Puzzle Challenges</h2>
        <p className="learn-lead">
          You play <strong>North</strong> and move first. Beat each fixed position to unlock the
          next. Solved {solved} / {CHALLENGES.length}.
        </p>

        <div className="challenge-list">
          {CHALLENGES.map((ch, i) => {
            const unlocked = isUnlocked(i, completed);
            const done = completed.includes(i);
            return (
              <button
                key={i}
                className={`challenge-item ${unlocked ? '' : 'locked'} ${done ? 'done' : ''}`}
                disabled={!unlocked}
                onClick={() => unlocked && onStart(i)}
              >
                <span className="challenge-num">{done ? '✓' : unlocked ? i + 1 : '🔒'}</span>
                <span className="challenge-text">
                  <span className="challenge-head">
                    Challenge {i + 1}
                    {ch.levelIA != null && <span className="challenge-tag">lvl {ch.levelIA + 1}</span>}
                  </span>
                  <span className="challenge-goal">{unlocked ? ch.goal : 'Locked — win the previous challenge to unlock.'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
