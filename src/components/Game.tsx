import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board.tsx';
import { useGame, type GameSetup, type Narrator, type Winner } from '../lib/useGame.ts';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { loadStats, saveStats, applyResult, type Outcome } from '../lib/stats.ts';
import type { SavedGame } from '../lib/saveGame.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { loadProfile } from '../lib/profile.ts';

interface Props {
  mode: 'ai' | 'local';
  level: number;
  setup?: GameSetup;      // custom start position (challenges)
  goal?: string;          // challenge goal text (shown instead of rotating tips)
  title?: string;         // e.g. "Challenge 3"
  oppName?: string;       // override opponent label
  resume?: SavedGame | null;
  /** Free play saves itself so a refresh resumes; challenges do not. */
  persist?: boolean;
  /** Free play against the AI feeds the rating; challenges and pass-and-play do not. */
  rated?: boolean;
  onExit: () => void;
  onLearn: () => void;
  onSettings: () => void;
  onToast: (msg: string) => void;
  onStatsChange?: () => void;
}

const TIP_KEYS: StringKey[] = ['tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5', 'tip.6'];

function PlayerCard({
  name, score, pits, offset, active, side, avatar,
}: {
  name: string; score: number; pits: number[]; offset: number;
  active: boolean; side: 'you' | 'opp'; avatar: string;
}) {
  const pipRow = [];
  for (let k = 0; k < 6; k++) {
    pipRow.push(
      <span key={k} className={`pip ${pits[offset + k] > 0 ? 'pip-on' : ''}`}>{pits[offset + k]}</span>,
    );
  }
  return (
    <div className={`pcard pcard-${side} ${active ? 'pcard-active' : ''}`}>
      {side === 'opp' && <div className="pcard-score">{score}</div>}
      <div className="pcard-info">
        <div className="pcard-name">
          {name} {active && <span className="live-dot" aria-hidden />}
        </div>
        <div className="pips" aria-hidden>{pipRow}</div>
      </div>
      {side === 'you' && <div className="pcard-score">{score}</div>}
      <div className={`avatar avatar-${side} avatar-${avatar}`} aria-hidden />
    </div>
  );
}

export default function Game({
  mode, level, setup, goal, title, oppName: oppOverride, resume, persist, rated,
  onExit, onLearn, onSettings, onToast, onStatsChange,
}: Props) {
  const t = useT();
  const [tip, setTip] = useState(0);
  const youAvatar = useMemo(() => loadProfile().avatar, []);
  const isChallenge = !!setup;
  const [ratingDelta, setRatingDelta] = useState<{ before: number; after: number } | null>(null);

  const levelName = useCallback((i: number) => t(`level.${i + 1}.name` as StringKey), [t]);

  const viewpointRef = useRef<0 | 1>(setup?.humanPlayer ?? 0);

  // Narration for the live region. Built from the same translation table as the
  // visible UI, so a screen reader follows the game in the player's language.
  const narrator = useMemo<Narrator>(() => {
    const who = (p: 0 | 1) =>
      mode === 'local'
        ? t(p === 0 ? 'game.south' : 'game.north')
        : p === viewpointRef.current ? t('common.you') : t('a11y.opponent');
    return {
      moved: (p, pit) => t('a11y.moved', { who: who(p), index: (pit % 6) + 1 }),
      captured: (p, count) => t('a11y.captured', { who: who(p), count }),
      turn: p => t('a11y.turnNow', { who: who(p) }),
      over: (w, scores) => t('a11y.gameOver', {
        result: w === 'draw' ? t('game.draw') : who(w as 0 | 1),
        you: scores[viewpointRef.current],
        them: scores[1 - viewpointRef.current],
      }),
    };
  }, [t, mode]);

  // Rated free play folds the result into the local record and rating.
  const onFinish = useCallback((winner: Winner, scores: number[]) => {
    if (!rated) return;
    const me = setup?.humanPlayer ?? 0;
    const outcome: Outcome = winner === 'draw' ? 'draw' : winner === me ? 'win' : 'loss';
    const before = loadStats();
    const next = applyResult(before, {
      level, outcome, you: scores[me], them: scores[1 - me],
    });
    saveStats(next);
    setRatingDelta({ before: before.rating, after: next.rating });
    onStatsChange?.();
  }, [rated, level, setup, onStatsChange]);

  const { state, play, hint, undo, newGame, humanPlayer } = useGame({
    mode, level, setup, resume, persist, onFinish, narrator,
  });

  useEffect(() => {
    if (goal) return; // challenges show a fixed goal, not rotating tips
    const id = setInterval(() => setTip(x => (x + 1) % TIP_KEYS.length), 6000);
    return () => clearInterval(id);
  }, [goal]);

  useEffect(() => {
    if (resume) onToast(t('game.resumed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewpoint: 0 | 1 = mode === 'ai' ? humanPlayer : state.turn;
  viewpointRef.current = viewpoint;
  const opp = (1 - viewpoint) as 0 | 1;

  const youName = mode === 'ai'
    ? t('common.you')
    : t(viewpoint === 0 ? 'game.south' : 'game.north');
  const oppName = oppOverride
    ?? (mode === 'ai' ? levelName(level) : t(viewpoint === 0 ? 'game.north' : 'game.south'));

  const interactive =
    state.phase === 'idle' && (mode === 'local' || state.turn === viewpoint);

  const status = useMemo(() => {
    if (state.phase === 'over') return null;
    if (state.phase === 'thinking') return { pill: t('game.thinking'), line: t('game.choosing', { name: oppName }) };
    if (state.phase === 'animating') return { pill: t('game.sowing'), line: t('game.seedsMoving') };
    if (mode === 'ai') {
      return state.turn === viewpoint
        ? { pill: t('game.yourTurn'), line: t('game.selectPit') }
        : { pill: t('game.oppTurn', { name: oppName }), line: t('game.waiting') };
    }
    return { pill: t('game.oppTurn', { name: youName }), line: t('game.selectPit') };
  }, [state.phase, state.turn, viewpoint, mode, oppName, youName, t]);

  const humanWon = state.winner === viewpoint;
  const winnerText = (): string => {
    if (state.winner === 'draw') return t('game.draw');
    if (isChallenge) return humanWon ? t('game.challengeDone') : t('game.challengeFailed');
    if (mode === 'ai') return humanWon ? t('game.youWin') : t('game.oppWins', { name: oppName });
    return t('game.sideWins', { name: t(state.winner === 0 ? 'game.south' : 'game.north') });
  };

  const restart = () => {
    playTap(); hapticTap();
    setRatingDelta(null);
    newGame();
  };

  return (
    <div className="screen game">
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label={t('common.back')}>←</button>
        <div className="brand">{title ? title.toUpperCase() : '◇ AWALÉ ◇'}</div>
        <div className="game-top-right">
          <button className="round-btn" onClick={onLearn} aria-label={t('game.howToPlay')}>?</button>
          <button className="round-btn" onClick={onSettings} aria-label={t('common.settings')}>⚙</button>
        </div>
      </header>

      {/* Screen readers follow the game here; the board itself is a grid of buttons. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>

      <div className="players">
        <PlayerCard
          name={youName} score={state.scores[viewpoint]} pits={state.pits}
          offset={viewpoint * 6} active={state.turn === viewpoint && state.phase !== 'over'}
          side="you" avatar={youAvatar}
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
          offset={opp * 6} active={state.turn === opp && state.phase !== 'over'}
          side="opp" avatar="olive"
        />
      </div>

      <Board state={state} viewpoint={viewpoint} interactive={interactive} onPlay={play} />

      <div className="game-bottom">
        {goal ? (
          <div className="tip-card goal-card">
            <span className="tip-orn" aria-hidden>◈</span>
            <div>
              {title && <div className="goal-title">{title}</div>}
              <div className="tip-text">{goal}</div>
            </div>
          </div>
        ) : (
          <div className="tip-card">
            <span className="tip-orn" aria-hidden>✧</span>
            <div>
              <div className="tip-text">{t(TIP_KEYS[tip])}</div>
              <button className="tip-more" onClick={onLearn}>{t('game.learnMore')}</button>
            </div>
          </div>
        )}
        <div className="game-controls">
          <button className="ctrl" onClick={restart}>
            ↻ {isChallenge ? t('game.restart') : t('game.newGame')}
          </button>
          {mode === 'ai' && (
            <button className="ctrl" onClick={() => void hint()} disabled={!interactive}>
              💡 {t('game.hint')}
            </button>
          )}
          {mode === 'ai' && (
            <button className="ctrl" onClick={() => { playTap(); undo(); }} disabled={!state.canUndo}>
              ↩ {t('game.undo')}
            </button>
          )}
        </div>
      </div>

      {state.phase === 'over' && (
        <div className="overlay">
          <div className="over-card" role="dialog" aria-modal="true" aria-label={winnerText()}>
            <div className="hero-ornament">
              <span className="diamond">◇</span><span className="rule" /><span className="diamond">◇</span>
            </div>
            <h2 className="over-title">{winnerText()}</h2>
            <div className="over-score">
              <span>{youName} <strong>{state.scores[viewpoint]}</strong></span>
              <span className="over-dash">—</span>
              <span><strong>{state.scores[opp]}</strong> {oppName}</span>
            </div>
            {ratingDelta && (
              <p className="over-rating">
                {t('game.ratingChange', { before: ratingDelta.before, after: ratingDelta.after })}
                <span className={ratingDelta.after >= ratingDelta.before ? 'delta-up' : 'delta-down'}>
                  {ratingDelta.after >= ratingDelta.before ? ' ▲' : ' ▼'}
                  {Math.abs(ratingDelta.after - ratingDelta.before)}
                </span>
              </p>
            )}
            {isChallenge && humanWon && <p className="over-note">{t('game.nextUnlocked')}</p>}
            <button className="pill pill-green" onClick={restart}>
              <span className="pill-body">
                <span className="pill-title">{isChallenge ? t('game.tryAgain') : t('game.playAgain')}</span>
              </span>
            </button>
            <button className="pill" onClick={onExit}>
              <span className="pill-body">
                <span className="pill-title">{isChallenge ? t('game.toChallenges') : t('game.backToMenu')}</span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
