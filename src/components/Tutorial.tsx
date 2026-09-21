import { useCallback, useEffect, useRef, useState } from 'react';
import Board from './Board.tsx';
import { owner, isValid, distribute } from '../lib/engine.ts';
import { AIClient } from '../lib/aiClient.ts';
import type { GameState } from '../lib/useGame.ts';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { SPEED_FACTOR } from '../lib/settings.ts';
import { useOrientation } from '../lib/useOrientation.ts';
import { playSow, playCapture, playTap } from '../lib/sound.ts';
import { hapticCapture, hapticTap } from '../lib/haptics.ts';

const SOW_MS = 220;
const CAP_MS = 260;
const DEMO_DELAY = 1000;

// The tutorial always sows at the slow tempo, whatever the player's animation
// speed setting says. A demo is there to be FOLLOWED seed by seed — at `fast`
// it is a blur, and at `instant` the seeds simply teleport and the lesson is
// lost. The setting still rules every other board in the app.
const TUTORIAL_FACTOR = SPEED_FACTOR.slow;

// The game the closing call-to-action starts: the gentlest opponent, because
// the player has just met the rules for the first time.
const EASY_LEVEL = 0;

// The learner is North (player 1) and sits nearest the viewer, so their six
// pits are the row on their own side of the board. Demo moves are played by
// South so the learner always sees a move from the other side before being
// asked for one.
// `portraitKey` is for the one step that names a side of the board: the board
// turns a quarter-turn below PORTRAIT_MAX_WIDTH, where "row" becomes "column".
type Common = { key: StringKey; portraitKey?: StringKey; board?: number[] };
type Step =
  | ({ kind: 'message' } & Common)
  | ({ kind: 'demo'; pit: number } & Common)
  | ({ kind: 'interact' } & Common)
  | ({ kind: 'freePlay' } & Common);

// A step without a `board` keeps whatever the previous step left behind: the
// learner's own move should still be on the table while the next card explains
// what it showed. Only steps that need a staged position declare one.
const STEPS: Step[] = [
  { kind: 'message', key: 'tutorial.step1', board: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', key: 'tutorial.step2', portraitKey: 'tutorial.step2.portrait' },
  { kind: 'demo', key: 'tutorial.step3', pit: 5 },
  { kind: 'interact', key: 'tutorial.step4' },
  { kind: 'message', key: 'tutorial.step5' },
  { kind: 'message', key: 'tutorial.step6' },
  { kind: 'demo', key: 'tutorial.step7', pit: 2, board: [0, 1, 6, 6, 6, 6, 0, 1, 2, 7, 7, 6] },
  { kind: 'message', key: 'tutorial.step8' },
  { kind: 'demo', key: 'tutorial.step9', pit: 4, board: [5, 5, 5, 5, 15, 0, 0, 0, 0, 4, 6, 3] },
  { kind: 'message', key: 'tutorial.step10' },
  { kind: 'message', key: 'tutorial.step11' },
  { kind: 'freePlay', key: 'tutorial.step12', board: [3, 1, 2, 1, 5, 5, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', key: 'tutorial.step13' },
];

// Every line the card can ever show. They are all rendered, stacked in one
// grid cell with the inactive ones hidden, so the card is as tall as its
// longest line from the start and no step change ever shifts the board.
const CARD_KEYS: StringKey[] = [
  ...STEPS.flatMap(s => (s.portraitKey ? [s.key, s.portraitKey] : [s.key])),
  'tutorial.captured',
];

/** A step worth re-running: the ones that move seeds. A message just sits there. */
const replayable = (s: Step) => s.kind !== 'message';

type Awaiting = 'next' | 'move' | 'demo' | 'busy';

interface Props {
  onExit: () => void;
  onChallenges: () => void;
  onPlay: (level: number) => void;
}

const legalNorth = (p: number[]) => {
  const out: number[] = [];
  for (let j = 6; j < 12; j++) if (isValid(p, j)) out.push(j);
  return out;
};

const sameBoard = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

export default function Tutorial({ onExit, onChallenges, onPlay }: Props) {
  const t = useT();
  const orientation = useOrientation();
  const stepText = useCallback(
    (st: Step) => t(st.portraitKey && orientation === 'portrait' ? st.portraitKey : st.key),
    [t, orientation],
  );
  const clientRef = useRef<AIClient | null>(null);
  if (clientRef.current === null) { clientRef.current = new AIClient(); clientRef.current.newGame(0); }

  const [pits, setPits] = useState<number[]>(STEPS[0].board!.slice());
  const [scores, setScores] = useState<number[]>([0, 0]);
  const [activePit, setActivePit] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  // Bumped to re-enter the current step — that is all "replay" needs to be.
  const [take, setTake] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>('next');
  const [banner, setBanner] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const pitsRef = useRef<number[]>(STEPS[0].board!.slice());
  const scoresRef = useRef<number[]>([0, 0]);
  // The position each step STARTED from, indexed by step. Going back or
  // replaying restores the entry, so a step always runs from where it ran the
  // first time — including the steps whose position is whatever the learner
  // themselves left behind.
  const entries = useRef<{ pits: number[]; scores: number[] }[]>([]);
  // Incremented on every step entry, so work scheduled by the step we just
  // left (an AI reply already in flight) can tell that it is stale.
  const visit = useRef(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // Seed-by-seed sowing, the same shape as the main board's — at the tutorial's
  // own fixed tempo rather than the player's speed setting.
  const animate = useCallback((pit: number, onDone?: (running: boolean) => void) => {
    const mover = owner(pit);
    const pre = [...pitsRef.current];
    const work = [...pitsRef.current];
    const sc = [...scoresRef.current];
    const res = distribute(work, sc, pit);
    const sown = [...pre]; sown[pit] = 0; for (const i of res.sowed) sown[i]++;
    pitsRef.current = work; scoresRef.current = sc;

    const sowMs = SOW_MS * TUTORIAL_FACTOR;
    const capMs = CAP_MS * TUTORIAL_FACTOR;

    setAwaiting('busy');
    setActivePit(pit); setCapturing([]);
    const disp = [...pre]; disp[pit] = 0; setPits([...disp]);

    res.sowed.forEach((idx, k) => at(sowMs * (k + 1), () => {
      const before = disp[idx];   // how full the pit was before this seed landed
      disp[idx]++; setActivePit(idx); setPits([...disp]);
      playSow(k, before);
    }));
    const afterSow = sowMs * (res.sowed.length + 1);
    res.captured.forEach((cap, k) => at(afterSow + capMs * k, () => {
      setCapturing(res.captured.slice(0, k + 1));
      disp[cap] = 0; setPits([...disp]);
      setScores(prev => { const ns = [...prev]; ns[mover] += sown[cap]; return ns; });
    }));
    if (res.captured.length > 0) at(afterSow, () => {
      playCapture(res.captured.length, res.captured.reduce((sum, c) => sum + sown[c], 0));
      hapticCapture();
    });

    const end = afterSow + capMs * res.captured.length + 240 * TUTORIAL_FACTOR;
    at(end, () => {
      setActivePit(null); setCapturing([]);
      setPits([...pitsRef.current]); setScores([...scoresRef.current]);
      onDone?.(res.running);
    });
  }, []);

  // South (AI) reply during free play. The search is async, so it has to check
  // on return that the learner has not stepped away in the meantime.
  const southReply = useCallback(() => {
    const mine = visit.current;
    setAwaiting('busy');
    clientRef.current!.bestMove('game', pitsRef.current, scoresRef.current, 0).then(move => {
      if (visit.current !== mine) return;
      at(400, () => {
        if (move == null) { setAwaiting('next'); return; }
        animate(move, running => {
          if (!running) { setAwaiting('next'); return; }
          if (legalNorth(pitsRef.current).length === 0) { setAwaiting('next'); return; }
          setAwaiting('move');
        });
      });
    });
  }, [animate]);

  // Enter a step: restore the position it starts from, then set up
  // interaction / demo.
  useEffect(() => {
    clearTimers();
    visit.current++;
    setBanner(null);
    const s = STEPS[step];

    const entry = entries.current[step];
    const nextPits = entry ? entry.pits.slice()
      : s.board ? s.board.slice()
      : pitsRef.current.slice();
    const nextScores = entry ? entry.scores.slice()
      : s.board ? [0, 0]
      : scoresRef.current.slice();
    entries.current[step] = { pits: nextPits.slice(), scores: nextScores.slice() };

    // Only touch the board when it actually differs: re-seeding an identical
    // position would restart every pit's seed animation for nothing.
    if (!sameBoard(pitsRef.current, nextPits)) setPits(nextPits.slice());
    if (!sameBoard(scoresRef.current, nextScores)) setScores(nextScores.slice());
    pitsRef.current = nextPits;
    scoresRef.current = nextScores;

    setActivePit(null); setCapturing([]);
    setAnnouncement(stepText(s));

    if (s.kind === 'message') setAwaiting('next');
    else if (s.kind === 'interact') setAwaiting('move');
    else if (s.kind === 'freePlay') setAwaiting('move');
    else if (s.kind === 'demo') {
      setAwaiting('demo');
      at(DEMO_DELAY, () => animate(s.pit, () => setAwaiting('next')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, take]);

  useEffect(() => () => { clearTimers(); clientRef.current?.dispose(); }, []);

  const handlePlay = (pit: number) => {
    const s = STEPS[step];
    if (awaiting !== 'move') return;
    if (!isValid(pitsRef.current, pit) || owner(pit) !== 1) return;

    if (s.kind === 'interact') {
      animate(pit, () => setStep(i => i + 1));   // one move, then advance
      return;
    }
    if (s.kind === 'freePlay') {
      const before = scoresRef.current[1];
      animate(pit, running => {
        if (scoresRef.current[1] > before) {
          setBanner(t('tutorial.captured'));
          setAwaiting('next');
          return;
        }
        if (!running) { setAwaiting('next'); return; }
        southReply();
      });
    }
  };

  const isLast = step >= STEPS.length - 1;
  const canAdvance = awaiting === 'next' && !isLast;

  const next = () => {
    playTap(); hapticTap();
    if (isLast) { onExit(); return; }
    setStep(i => i + 1);
  };

  // Going back invalidates the positions the later steps started from: the
  // learner may well play a different move this time round.
  const back = () => {
    if (step === 0) return;
    playTap(); hapticTap();
    entries.current.length = step;
    setStep(step - 1);
  };

  const replay = () => {
    playTap(); hapticTap();
    entries.current.length = step + 1;
    setTake(n => n + 1);
  };

  const s = STEPS[step];
  const interactive = awaiting === 'move';
  const boardState: GameState = {
    pits, scores, turn: 1, phase: interactive ? 'idle' : 'animating',
    winner: null,
    legal: interactive ? legalNorth(pits) : [],
    hintPit: null, activePit, capturing, canUndo: false, lastCaptured: null,
    announcement: '',
  };

  const footer = (() => {
    if (awaiting === 'demo') return t('tutorial.watch');
    if (awaiting === 'busy') return t('tutorial.moving');
    if (awaiting === 'move') {
      return s.kind === 'freePlay' ? t('tutorial.yourTurnCapture') : t('tutorial.yourTurnTap');
    }
    if (canAdvance) return t('tutorial.tapToContinue');
    return null;
  })();

  const cardText = banner ?? stepText(s);

  return (
    <div className="screen game tutorial">
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('tutorial.brand')} ◇</div>
        <div className="tut-progress">{step + 1} / {STEPS.length}</div>
      </header>

      <div className="sr-only" role="status" aria-live="polite">{banner ?? announcement}</div>

      <div
        className={`tut-card${canAdvance ? ' tut-card-tappable' : ''}`}
        role={canAdvance ? 'button' : undefined}
        tabIndex={canAdvance ? 0 : undefined}
        aria-label={canAdvance ? `${cardText} — ${t('tutorial.next')}` : undefined}
        onClick={canAdvance ? next : undefined}
        onKeyDown={canAdvance
          ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } }
          : undefined}
      >
        <span className="tip-orn" aria-hidden>✦</span>
        <div className="tut-text-stack">
          <div className="tut-text">{cardText}</div>
          {CARD_KEYS.map(k => (
            <div key={k} className="tut-text tut-text-ghost" aria-hidden="true">{t(k)}</div>
          ))}
        </div>
      </div>

      <Board state={boardState} viewpoint={1} interactive={interactive} onPlay={handlePlay} />

      <div className="tut-footer">
        {/* Always rendered, even when empty: a hint appearing must not push
            the board up the screen. */}
        <div className="tut-hint">{footer ?? ' '}</div>

        <div className="game-controls tut-primary">
          {isLast ? (
            <button className="pill pill-green tut-next" onClick={() => { playTap(); hapticTap(); onPlay(EASY_LEVEL); }}>
              <span className="pill-body">
                <span className="pill-title">{t('tutorial.playNow')}</span>
                <span className="pill-sub">{t('tutorial.playNowSub', { level: t('level.1.name') })}</span>
              </span>
            </button>
          ) : awaiting === 'next' && (
            <button className="pill pill-green tut-next" onClick={next}>
              <span className="pill-body">
                <span className="pill-title">{t('tutorial.next')}</span>
              </span>
            </button>
          )}
        </div>

        <div className="tut-nav">
          <button className="ctrl" onClick={back} disabled={step === 0}>← {t('tutorial.prev')}</button>
          {replayable(s) && (
            <button className="ctrl" onClick={replay}>↻ {t('tutorial.replay')}</button>
          )}
          {isLast && (
            <button className="ctrl" onClick={onChallenges}>{t('tutorial.toChallenges')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
