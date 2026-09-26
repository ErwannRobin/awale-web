import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board.tsx';
import { useGame, type GameSetup, type Narrator, type Winner } from '../lib/useGame.ts';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { loadStats, saveStats, applyResult, type Outcome } from '../lib/stats.ts';
import type { SavedGame } from '../lib/saveGame.ts';
import { playTap, playMusic, stopMusic } from '../lib/sound.ts';
import { useSettings } from '../lib/useSettings.ts';
import { updateSettings } from '../lib/settings.ts';
import { hapticTap } from '../lib/haptics.ts';
import { loadProfile } from '../lib/profile.ts';
import { reportGame } from '../lib/worldStats.ts';
import { maybeRequestReview } from '../lib/review.ts';
import type { OnlineHandle } from '../lib/useOnlineSession.ts';
import { useClocks } from '../lib/useClocks.ts';
import { REACTIONS } from '../lib/protocol.ts';
import type { Seat } from '../lib/rules.ts';
import { formatClock } from '../lib/format.ts';
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
  /** Override the near player's label — a spectator sees two names, not "You". */
  youName?: string;
  /**
   * Watching someone else's game: the near seat is South, nothing can be
   * played, sent or resigned, and every line names the players.
   */
  spectating?: boolean;
  /** Extra lines for the game-over card, under the rating change. */
  overExtra?: React.ReactNode;
  resume?: SavedGame | null;
  /** Free play saves itself so a refresh resumes; challenges do not. */
  persist?: boolean;
  /** Free play against the AI feeds the rating; challenges and pass-and-play do not. */
  rated?: boolean;
  onExit: () => void;
  /** Challenges only: open the next one, when this is not the last. */
  onNext?: () => void;
  /** Puzzles only: the title a solved puzzle gets, instead of "Challenge complete!". */
  winText?: string;
  /** Puzzles only: offered as the main action once the puzzle is solved. */
  onShare?: () => void;
  /** The label of the way out on the game-over card, when it is not the default. */
  exitLabel?: string;
  /**
   * Hint and Undo. On by default against the AI; the daily puzzle turns them
   * off, because its result is shared and compared, and a solve that took an
   * engine's hint or three undos is not the same solve.
   */
  assists?: boolean;
  onLearn: () => void;
  onSettings: () => void;
  onToast: (msg: string) => void;
  onStatsChange?: () => void;
}

const TIP_KEYS: StringKey[] = ['tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5', 'tip.6'];

/** Under this, a clock turns red: the moment a player starts counting. */
const LOW_TIME_MS = 20_000;

/** How long a reaction bubble stays up. */
const BUBBLE_MS = 2_600;

function PlayerCard({
  name, score, active, side, avatar, clock, clockLabel, reaction,
}: {
  name: string; score: number;
  active: boolean; side: 'you' | 'opp'; avatar: string;
  /** Milliseconds left and whether it is ticking; absent in an untimed game. */
  clock?: { ms: number; running: boolean };
  clockLabel?: string;
  /** A reaction just sent from this seat; `n` restarts the bubble each time. */
  reaction?: { emoji: string; label: string; n: number } | null;
}) {
  return (
    <div className={`pcard pcard-${side} ${active ? 'pcard-active' : ''}`}>
      {reaction && (
        <span key={reaction.n} className="react-bubble" role="status" aria-label={reaction.label}>
          {reaction.emoji}
        </span>
      )}
      {side === 'opp' && <div className="pcard-score">{score}</div>}
      <div className="pcard-info" dir="auto">
        <div className="pcard-name">
          <span className="pcard-name-text">{name}</span>
          {active && <span className="live-dot" aria-hidden />}
        </div>
        {clock && (
          <div
            className={`pcard-clock ${clock.running ? 'pcard-clock-running' : ''} ${clock.ms < LOW_TIME_MS ? 'pcard-clock-low' : ''}`}
            role="timer"
            aria-label={clockLabel}
          >
            {formatClock(clock.ms)}
          </div>
        )}
      </div>
      {side === 'you' && <div className="pcard-score">{score}</div>}
      <div className={`avatar avatar-${side} avatar-${avatar}`} aria-hidden />
    </div>
  );
}

export default function Game({
  mode, level, setup, goal, title, oppName: oppOverride, youName: youOverride, spectating = false,
  overExtra, resume, persist, rated,
  online, onExit, onNext, winText, onShare, exitLabel, assists = true,
  onLearn, onSettings, onToast, onStatsChange,
}: Props) {
  const t = useT();
  const isOnline = mode === 'online';
  const showTips = useSettings().showTips;
  const [tip, setTip] = useState(0);
  const youAvatar = useMemo(() => loadProfile().avatar, []);
  // An online game arrives with a `setup` too — the seat and the opening
  // position come from the server — so "has a setup" is not the question.
  const isChallenge = !!setup && mode !== 'online';
  const [ratingDelta, setRatingDelta] = useState<{ before: number; after: number } | null>(null);

  const levelName = useCallback((i: number) => t(`level.${i + 1}.name` as StringKey), [t]);

  const viewpointRef = useRef<0 | 1>(setup?.humanPlayer ?? 0);
  // A spectator's narration names the players; set every render, below.
  const seatNamesRef = useRef<[string, string] | null>(null);

  // Narration for the live region. Built from the same translation table as the
  // visible UI, so a screen reader follows the game in the player's language.
  const narrator = useMemo<Narrator>(() => {
    // The local board flips with every turn, so "you" always means whoever is
    // holding the device right now — the same person the near row belongs to.
    const who = (p: 0 | 1) => seatNamesRef.current?.[p]
      ?? (p === viewpointRef.current ? t('common.you') : t('a11y.opponent'));
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
    // The country as it stands right now. Read here rather than carried in from
    // the start of the game, and never read again afterwards: this is the one
    // moment the game is attributed, so changing country later moves nothing.
    const country = loadProfile().country;
    const before = loadStats();
    const next = applyResult(before, {
      level, outcome, you: scores[me], them: scores[1 - me], country,
    });
    saveStats(next);
    // The same game, counted once in the world table. Fire and forget: no part
    // of finishing a game waits on the network, and a failure is simply a game
    // the table never hears about.
    void reportGame({ level, country, outcome, you: scores[me], them: scores[1 - me] });
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

  // The clocks, in a timed online game. They read the server's last word and
  // count down from it — see lib/useClocks.ts.
  const clocks = useClocks(online?.view.snapshot?.clock, online?.view.clockAt ?? 0);
  const clockFor = (seat: 0 | 1) => (clocks
    ? { ms: clocks.left[seat], running: clocks.running === seat && state.phase !== 'over' }
    : undefined);

  // Reactions: the latest one floats up from its sender's card for a moment.
  // Switched off in Settings, nothing is shown and nothing can be sent.
  const reactionsOn = useSettings().reactions && isOnline;
  const incoming = online?.reaction ?? null;
  const [bubble, setBubble] = useState<{ by: Seat; e: number; n: number } | null>(null);
  useEffect(() => {
    if (!incoming || !reactionsOn) return;
    setBubble(incoming);
    const timer = setTimeout(() => setBubble(b => (b?.n === incoming.n ? null : b)), BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [incoming, reactionsOn]);
  const bubbleFor = (seat: 0 | 1) => (bubble && bubble.by === seat
    ? {
      emoji: REACTIONS[bubble.e],
      label: t('a11y.reacted', {
        who: seat === viewpoint ? youName : oppName,
        name: t(`react.${bubble.e}` as StringKey),
      }),
      n: bubble.n,
    }
    : null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [reactCooldown, setReactCooldown] = useState(false);
  const sendReaction = (e: number) => {
    playTap(); hapticTap();
    online?.react(e);
    setTrayOpen(false);
    // The server drops anything sent faster; greying the button says so first.
    setReactCooldown(true);
    setTimeout(() => setReactCooldown(false), 1_500);
  };

  const youName = youOverride ?? (mode === 'local' ? t('game.us') : t('common.you'));
  const oppName = oppOverride
    ?? (isOnline ? (opponentSlot?.name || t('online.opponent'))
      : mode === 'ai' ? levelName(level)
        : t('game.them'));
  const nameOf = (seat: 0 | 1) => (seat === viewpoint ? youName : oppName);
  seatNamesRef.current = spectating
    ? (viewpoint === 0 ? [youName, oppName] : [oppName, youName])
    : null;

  const interactive =
    !spectating
    && state.phase === 'idle' && (mode === 'local' || state.turn === viewpoint)
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
    if (spectating) {
      return { pill: t('game.oppTurn', { name: nameOf(state.turn) }), line: t('watch.watching') };
    }
    if (mode !== 'local') {
      return state.turn === viewpoint
        ? { pill: t('game.yourTurn'), line: t(selectPit) }
        : { pill: t('game.oppTurn', { name: oppName }), line: t('game.waiting') };
    }
    // Pass-and-play: the board turns round, so the side to move is always
    // the near one — "Us" — and naming it again in the pill adds nothing.
    return { pill: t('game.yourTurn'), line: t(selectPit) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf reads youName/oppName
  }, [state.phase, state.turn, viewpoint, mode, isOnline, oppName, youName, spectating, selectPit, t]);

  // Every helper line this game can ever put under the pill, rendered as
  // invisible ghosts behind the live one. The slot is therefore as tall as its
  // longest line from the first paint, so a longer line — or a line that wraps
  // where the previous one did not — never nudges the board down the screen.
  const statusLines = useMemo(() => {
    const all = spectating ? [t('watch.watching'), t('game.seedsMoving')] : [t(selectPit), t('game.seedsMoving')];
    if (isOnline && !spectating) all.push(t('online.sendingSub'), t('game.waiting'));
    else if (mode === 'ai') all.push(t('game.choosing', { name: oppName }), t('game.waiting'));
    return [...new Set(all)];
  }, [t, selectPit, isOnline, mode, oppName, spectating]);

  // One × switches off both coaching texts at once — the line under the pill
  // and the tip card below the board. Settings puts them back; the toast says
  // so, because a control that only ever hides is a trap.
  const hideTips = () => {
    playTap(); hapticTap();
    updateSettings({ showTips: false });
    onToast(t('game.tipsHidden'));
  };

  const humanWon = state.winner === viewpoint;
  const winnerText = (): string => {
    if (state.winner === 'draw') return t('game.draw');
    if (spectating && state.winner !== null) return t('game.oppWins', { name: nameOf(state.winner) });
    if (isChallenge) return humanWon ? (winText ?? t('game.challengeDone')) : t('game.challengeFailed');
    if (mode === 'local') {
      return t('game.sideWins', { name: t(state.winner === viewpoint ? 'game.us' : 'game.them') });
    }
    return humanWon ? t('game.youWin') : t('game.oppWins', { name: oppName });
  };

  // Online endings the board cannot show on its own deserve a word of why.
  const overReason = online?.view.snapshot?.reason ?? null;
  const overNote = (): string | null => {
    if (!isOnline) return null;
    if (spectating) {
      if (state.winner === null || state.winner === 'draw') return null;
      const loser = nameOf((1 - state.winner) as 0 | 1);
      if (overReason === 'resign') return t('watch.resigned', { name: loser });
      if (overReason === 'abandoned') return t('watch.abandoned', { name: loser });
      if (overReason === 'timeout') return t('watch.flagged', { name: loser });
      return null;
    }
    if (overReason === 'resign') {
      return humanWon ? t('online.oppResigned') : t('online.youResigned');
    }
    if (overReason === 'abandoned') {
      return humanWon ? t('online.oppLeftForGood') : t('online.youTimedOut');
    }
    if (overReason === 'timeout') {
      return humanWon ? t('online.oppFlagged') : t('online.youFlagged');
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
  // A spectator cares about either player dropping out, and by name.
  const players = online?.view.snapshot?.players;
  const goneSeat: 0 | 1 | null = !spectating || !players ? null
    : players[0] && !players[0].online ? 0
      : players[1] && !players[1].online ? 1 : null;
  const banner = !isOnline ? null
    : connection === 'offline' ? t('online.reconnecting')
      : connection === 'connecting' ? t('online.connecting')
        : goneSeat !== null ? t('online.oppOffline', { name: nameOf(goneSeat) })
          : opponentGone && !spectating ? t('online.oppOffline', { name: oppName })
            : null;
  const audience = online?.view.audience ?? 0;

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
      {audience > 0 && (
        <div className="audience-chip" aria-label={t('watch.audience', { n: audience })}>
          <span aria-hidden>👁</span> {audience}
        </div>
      )}

      {/* One grid so the two player cards can sit above the board on a wide
          screen and flank it on a phone, where vertical space is scarce. */}
      {/* Left to right even on an Arabic page: your card sits beside your own
          row of pits, and mirroring the grid would put it on the far side. */}
      <div className="play-area" dir="ltr">
        {/* The grid is pinned left to right; its words are not. `auto` lets an
            Arabic line run right to left, full stop and all. */}
        <div className="turn-center" dir="auto">
          {/* Reserved whether or not there is a pill: the board stays put when
              the game ends and the status disappears. */}
          <div className="turn-pill-slot">
            {status && (
              <div className={`turn-pill ${state.phase === 'thinking' ? 'turn-pill-think' : ''}`}>
                <span className="turn-dot" aria-hidden />{status.pill}
              </div>
            )}
          </div>
          {showTips && (
            <div className="turn-line-row">
              {/* Balances the × so the line stays centred under the pill. */}
              <span className="turn-close-spacer" aria-hidden />
              <div className="turn-line-stack">
                <div className="turn-line">{status?.line ?? ''}</div>
                {statusLines.map(line => (
                  <div key={line} className="turn-line turn-line-ghost" aria-hidden="true">{line}</div>
                ))}
              </div>
              <button className="tip-close" onClick={hideTips} aria-label={t('game.hideTips')}>×</button>
            </div>
          )}
        </div>
        <PlayerCard
          name={youName} score={state.scores[viewpoint]}
          active={state.turn === viewpoint && state.phase !== 'over'}
          side="you" avatar={youAvatar}
          clock={clockFor(viewpoint)}
          clockLabel={clocks ? t('a11y.clock', { who: youName, time: formatClock(clocks.left[viewpoint]) }) : undefined}
          reaction={bubbleFor(viewpoint)}
        />
        <Board state={state} viewpoint={viewpoint} interactive={interactive} onPlay={play} />
        <PlayerCard
          name={oppName} score={state.scores[opp]}
          active={state.turn === opp && state.phase !== 'over'}
          side="opp" avatar="olive"
          clock={clockFor(opp)}
          clockLabel={clocks ? t('a11y.clock', { who: oppName, time: formatClock(clocks.left[opp]) }) : undefined}
          reaction={bubbleFor(opp)}
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
        ) : showTips ? (
          <div className="tip-card">
            <span className="tip-orn" aria-hidden>✧</span>
            {/* Same ghost stack as the status line: the card is as tall as the
                longest tip from the start, so the rotation never resizes it. */}
            <div className="tip-stack">
              <div className="tip-body">
                <div className="tip-text">{t(TIP_KEYS[tip])}</div>
                <button className="tip-more" onClick={onLearn}>{t('game.learnMore')}</button>
              </div>
              {TIP_KEYS.map(k => (
                <div key={k} className="tip-body tip-body-ghost" aria-hidden="true">
                  <div className="tip-text">{t(k)}</div>
                  <span className="tip-more">{t('game.learnMore')}</span>
                </div>
              ))}
            </div>
            <button className="tip-close" onClick={hideTips} aria-label={t('game.hideTips')}>×</button>
          </div>
        ) : null}
        <div className="game-controls">
          {isOnline && !spectating && (
            // No restart, no hint, no undo: none of the three mean anything
            // when a second person is sitting on the other side of the board.
            <button
              className={`ctrl ${confirmResign ? 'ctrl-warn' : ''}`}
              onClick={askResign}
              disabled={state.phase === 'over'}
            >
              🏳 {confirmResign ? t('online.resignConfirm') : t('online.resign')}
            </button>
          )}
          {reactionsOn && !spectating && (
            <div className="react-anchor">
              <button
                className="ctrl"
                onClick={() => { playTap(); setTrayOpen(o => !o); }}
                disabled={reactCooldown || connection !== 'online'}
                aria-expanded={trayOpen}
                aria-label={t('react.open')}
              >
                😊
              </button>
              {trayOpen && (
                <div className="react-tray" role="menu" aria-label={t('react.open')}>
                  {REACTIONS.map((emoji, e) => (
                    <button
                      key={emoji}
                      className="react-pick"
                      role="menuitem"
                      aria-label={t(`react.${e}` as StringKey)}
                      onClick={() => sendReaction(e)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isOnline && (
            <button className="ctrl" onClick={restart}>
              ↻ {isChallenge ? t('game.restart') : t('game.newGame')}
            </button>
          )}
          {mode === 'ai' && assists && (
            <button className="ctrl" onClick={() => void hint()} disabled={!interactive}>
              💡 {t('game.hint')}
            </button>
          )}
          {mode === 'ai' && assists && (
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
            {overExtra}
            {isChallenge && humanWon && !goNext && <p className="over-note">{t('game.nextUnlocked')}</p>}
            {overNote() && <p className="over-note">{overNote()}</p>}
            {isOnline && !spectating && online?.view.rematchOffered && !online.view.rematchSent && (
              <p className="over-note">{t('online.rematchOffered', { name: oppName })}</p>
            )}
            {spectating && <p className="over-note">{t('watch.stay')}</p>}
            {spectating ? null : isOnline ? (
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
            ) : isChallenge && humanWon && onShare ? (
              <button className="pill pill-green" onClick={() => { playTap(); hapticTap(); onShare(); }}>
                <span className="pill-body">
                  <span className="pill-title">{t('daily.share')}</span>
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
                  <span className="pill-title">
                    {exitLabel ?? (isChallenge ? t('game.toChallenges') : t('game.backToMenu'))}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
