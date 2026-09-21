import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board.tsx';
import { useGame, type GameSetup, type Narrator, type Winner } from '../lib/useGame.ts';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { loadStats, saveStats, applyResult, type Outcome } from '../lib/stats.ts';
import type { SavedGame } from '../lib/saveGame.ts';
import { playTap, playMusic, stopMusic } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { loadProfile } from '../lib/profile.ts';
import { maybeRequestReview } from '../lib/review.ts';
import type { OnlineHandle } from '../lib/useOnlineSession.ts';
import { GearIcon } from './Icons.tsx';

/** Long enough for the win banner and its chime to land before the OS sheet. */
const REVIEW_DELAY_MS = 1500;

interface Props {
  mode: 'ai' | 'local' | 'online';
  level: number;
  /** Present only in online mode: the live match this board belongs to. */
  online?: OnlineHandle;
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
  /** Challenges only: open the next one, when this is not the last. */
  onNext?: () => void;
  onLearn: () => void;
  onSettings: () => void;
  onToast: (msg: string) => void;
  onStatsChange?: () => void;
}

const TIP_KEYS: StringKey[] = ['tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5', 'tip.6'];

function PlayerCard({
  name, score, active, side, avatar,
}: {
  name: string; score: number;
  active: boolean; side: 'you' | 'opp'; avatar: string;
}) {
  return (
    <div className={`pcard pcard-${side} ${active ? 'pcard-active' : ''}`}>
      {side === 'opp' && <div className="pcard-score">{score}</div>}
      <div className="pcard-info">
        <div className="pcard-name">
          <span className="pcard-name-text">{name}</span>
          {active && <span className="live-dot" aria-hidden />}
        </div>
      </div>
      {side === 'you' && <div className="pcard-score">{score}</div>}
      <div className={`avatar avatar-${side} avatar-${avatar}`} aria-hidden />
    </div>
  );
}

export default function Game({
  mode, level, setup, goal, title, oppName: oppOverride, resume, persist, rated,
  online, onExit, onNext, onLearn, onSettings, onToast, onStatsChange,
}: Props) {
  const t = useT();
  const isOnline = mode === 'online';
  const [tip, setTip] = useState(0);
  const youAvatar = useMemo(() => loadProfile().avatar, []);
  // An online game arrives with a `setup` too — the seat and the opening
  // position come from the server — so "has a setup" is not the question.
  const isChallenge = !!setup && mode !== 'online';
  const [ratingDelta, setRatingDelta] = useState<{ before: number; after: number } | null>(null);

  const levelName = useCallback((i: number) => t(`level.${i + 1}.name` as StringKey), [t]);

  const viewpointRef = useRef<0 | 1>(setup?.humanPlayer ?? 0);

  // Narration for the live region. Built from the same translation table as the
  // visible UI, so a screen reader follows the game in the player's language.
  const narrator = useMemo<Narrator>(() => {
    // The local board flips with every turn, so "you" always means whoever is
    // holding the device right now — the same person the near row belongs to.
    const who = (p: 0 | 1) =>
      p === viewpointRef.current ? t('common.you') : t('a11y.opponent');
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
  }, [t]);

  // The store rating sheet, asked for after a win and never after a loss.
  // Delayed so the win lands first, and cancelled if the player leaves before
  // then. See lib/review.ts for the rules on top of the OS throttle.
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reviewTimer.current), []);

  // Ambiance loop for the duration of the board, on then off.
  useEffect(() => { playMusic(); return stopMusic; }, []);

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

    if (outcome === 'win') {
      reviewTimer.current = setTimeout(() => { void maybeRequestReview(next.wins); }, REVIEW_DELAY_MS);
    }
  }, [rated, level, setup, onStatsChange]);

  const {
    state, play, hint, undo, newGame, humanPlayer,
    applyRemoteMove, resetTo, endWith,
  } = useGame({
    mode, level, setup, resume, persist, onFinish, narrator,
    remote: online?.remote,
  });

  // Hand the board to the match, so a move the server confirms can be played.
  // Unbinding on the way out matters: a confirmed move arriving after this
  // screen is gone must not reach a board that no longer exists.
  const bind = online?.bind;
  useEffect(() => {
    if (!bind) return;
    bind({ applyRemoteMove, resetTo, endWith });
    return () => bind(null);
  }, [bind, applyRemoteMove, resetTo, endWith]);

  useEffect(() => {
    if (goal) return; // challenges show a fixed goal, not rotating tips
    const id = setInterval(() => setTip(x => (x + 1) % TIP_KEYS.length), 6000);
    return () => clearInterval(id);
  }, [goal]);

  useEffect(() => {
    if (resume) onToast(t('game.resumed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewpoint: 0 | 1 = mode === 'local' ? state.turn : humanPlayer;
  viewpointRef.current = viewpoint;
  const opp = (1 - viewpoint) as 0 | 1;

  const opponentSlot = online?.view.snapshot?.players[1 - viewpoint] ?? null;

  const youName = mode === 'local' ? t('game.us') : t('common.you');
  const oppName = oppOverride
    ?? (isOnline ? (opponentSlot?.name || t('online.opponent'))
      : mode === 'ai' ? levelName(level)
        : t('game.them'));

  const interactive =
    state.phase === 'idle' && (mode === 'local' || state.turn === viewpoint)
    // Online, a board you cannot reach the server from is a board you cannot
    // move on. Better a disabled pit than a tap that silently goes nowhere.
    && (!isOnline || online?.view.connection === 'online');

  // The preview gesture differs by pointer: a mouse peeks on hover, a finger
  // has to hold. Say which, once, under the turn pill.
  const selectPit = useMemo(() => {
    const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none)').matches;
    return coarse ? 'game.selectPitHold' : 'game.selectPitHover';
  }, []) as StringKey;

  const status = useMemo(() => {
    if (state.phase === 'over') return null;
    if (state.phase === 'thinking') {
      // Online, "thinking" means your own move is in the post.
      return isOnline
        ? { pill: t('online.sending'), line: t('online.sendingSub') }
        : { pill: t('game.thinking'), line: t('game.choosing', { name: oppName }) };
    }
    if (state.phase === 'animating') return { pill: t('game.sowing'), line: t('game.seedsMoving') };
    if (mode !== 'local') {
      return state.turn === viewpoint
        ? { pill: t('game.yourTurn'), line: t(selectPit) }
        : { pill: t('game.oppTurn', { name: oppName }), line: t('game.waiting') };
    }
    // Pass-and-play: the board turns round, so the side to move is always
    // the near one — "Us" — and naming it again in the pill adds nothing.
    return { pill: t('game.yourTurn'), line: t(selectPit) };
  }, [state.phase, state.turn, viewpoint, mode, isOnline, oppName, selectPit, t]);

  const humanWon = state.winner === viewpoint;
  const winnerText = (): string => {
    if (state.winner === 'draw') return t('game.draw');
    if (isChallenge) return humanWon ? t('game.challengeDone') : t('game.challengeFailed');
    if (mode === 'local') {
      return t('game.sideWins', { name: t(state.winner === viewpoint ? 'game.us' : 'game.them') });
    }
    return humanWon ? t('game.youWin') : t('game.oppWins', { name: oppName });
  };

  // Online endings the board cannot show on its own deserve a word of why.
  const overReason = online?.view.snapshot?.reason ?? null;
  const overNote = (): string | null => {
    if (!isOnline) return null;
    if (overReason === 'resign') {
      return humanWon ? t('online.oppResigned') : t('online.youResigned');
    }
    if (overReason === 'abandoned') {
      return humanWon ? t('online.oppLeftForGood') : t('online.youTimedOut');
    }
    return null;
  };

  const restart = () => {
    playTap(); hapticTap();
    setRatingDelta(null);
    newGame();
  };

  // A solved challenge leads to the next one. Sending the player back to the
  // list to find it themselves is a step nobody wants, so the list stays where
  // it always was — behind the ← in the header.
  const goNext = isChallenge && humanWon && onNext
    ? () => { playTap(); hapticTap(); onNext(); }
    : null;

  // Resigning is one tap too easy to do by accident mid-thought, so it asks
  // once. The question withdraws itself rather than sitting there as a trap.
  const [confirmResign, setConfirmResign] = useState(false);
  const resignTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resignTimer.current), []);
  const askResign = () => {
    playTap(); hapticTap();
    if (confirmResign) {
      clearTimeout(resignTimer.current);
      setConfirmResign(false);
      online?.resign();
      return;
    }
    setConfirmResign(true);
    resignTimer.current = setTimeout(() => setConfirmResign(false), 4000);
  };

  const connection = online?.view.connection ?? 'online';
  const opponentGone = isOnline && opponentSlot !== null && !opponentSlot.online;
  const banner = !isOnline ? null
    : connection === 'offline' ? t('online.reconnecting')
      : connection === 'connecting' ? t('online.connecting')
        : opponentGone ? t('online.oppOffline', { name: oppName })
          : null;

  return (
    <div className="screen game">
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label={t('common.back')}>←</button>
        <div className="brand">{title ? title.toUpperCase() : '◇ AWALÉ ◇'}</div>
        <div className="game-top-right">
          <button className="round-btn" onClick={onLearn} aria-label={t('game.howToPlay')}>?</button>
          <button className="round-btn" onClick={onSettings} aria-label={t('common.settings')}>
            <GearIcon />
          </button>
        </div>
      </header>

      {/* Screen readers follow the game here; the board itself is a grid of buttons. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>

      {banner && <div className="net-banner" role="status">{banner}</div>}

      {/* One grid so the two player cards can sit above the board on a wide
          screen and flank it on a phone, where vertical space is scarce. */}
      <div className="play-area">
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
          name={youName} score={state.scores[viewpoint]}
          active={state.turn === viewpoint && state.phase !== 'over'}
          side="you" avatar={youAvatar}
        />
        <Board state={state} viewpoint={viewpoint} interactive={interactive} onPlay={play} />
        <PlayerCard
          name={oppName} score={state.scores[opp]}
          active={state.turn === opp && state.phase !== 'over'}
          side="opp" avatar="olive"
        />
      </div>

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
          {isOnline ? (
            // No restart, no hint, no undo: none of the three mean anything
            // when a second person is sitting on the other side of the board.
            <button
              className={`ctrl ${confirmResign ? 'ctrl-warn' : ''}`}
              onClick={askResign}
              disabled={state.phase === 'over'}
            >
              🏳 {confirmResign ? t('online.resignConfirm') : t('online.resign')}
            </button>
          ) : (
            <button className="ctrl" onClick={restart}>
              ↻ {isChallenge ? t('game.restart') : t('game.newGame')}
            </button>
          )}
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
            {isChallenge && humanWon && !goNext && <p className="over-note">{t('game.nextUnlocked')}</p>}
            {overNote() && <p className="over-note">{overNote()}</p>}
            {isOnline && online?.view.rematchOffered && !online.view.rematchSent && (
              <p className="over-note">{t('online.rematchOffered', { name: oppName })}</p>
            )}
            {isOnline ? (
              <button
                className="pill pill-green"
                onClick={() => { playTap(); hapticTap(); online?.rematch(); }}
                disabled={online?.view.rematchSent || connection !== 'online'}
              >
                <span className="pill-body">
                  <span className="pill-title">
                    {online?.view.rematchSent ? t('online.rematchWaiting') : t('online.rematch')}
                  </span>
                </span>
              </button>
            ) : goNext ? (
              <button className="pill pill-green" onClick={goNext}>
                <span className="pill-body">
                  <span className="pill-title">{t('game.nextChallenge')}</span>
                </span>
              </button>
            ) : (
              <button className="pill pill-green" onClick={restart}>
                <span className="pill-body">
                  <span className="pill-title">{isChallenge ? t('game.tryAgain') : t('game.playAgain')}</span>
                </span>
              </button>
            )}
            {goNext ? (
              <button className="pill" onClick={restart}>
                <span className="pill-body">
                  <span className="pill-title">{t('game.tryAgain')}</span>
                </span>
              </button>
            ) : (
              <button className="pill" onClick={onExit}>
                <span className="pill-body">
                  <span className="pill-title">{isChallenge ? t('game.toChallenges') : t('game.backToMenu')}</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
