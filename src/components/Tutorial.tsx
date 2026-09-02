import { useCallback, useEffect, useRef, useState } from 'react';
import Board from './Board.tsx';
import { owner, isValid, distribute } from '../lib/engine.ts';
import { AIClient } from '../lib/aiClient.ts';
import type { GameState } from '../lib/useGame.ts';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { getSettings, SPEED_FACTOR } from '../lib/settings.ts';
import { playSow, playCapture, playTap } from '../lib/sound.ts';
import { hapticCapture, hapticTap } from '../lib/haptics.ts';

const SOW_MS = 220;
const CAP_MS = 260;
const DEMO_DELAY = 1000;

// The learner is North (player 1). Demo moves are played by South so the
// learner always sees a move from the other side before being asked for one.
type Step =
  | { kind: 'message'; key: StringKey; board?: number[] }
  | { kind: 'demo'; key: StringKey; pit: number; board?: number[] }
  | { kind: 'interact'; key: StringKey; board?: number[] }
  | { kind: 'freePlay'; key: StringKey; board?: number[] };

const STEPS: Step[] = [
  { kind: 'message', key: 'tutorial.step1', board: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', key: 'tutorial.step2' },
  { kind: 'demo', key: 'tutorial.step3', pit: 5 },
  { kind: 'interact', key: 'tutorial.step4' },
  { kind: 'message', key: 'tutorial.step5', board: [2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', key: 'tutorial.step6' },
  { kind: 'demo', key: 'tutorial.step7', pit: 2, board: [0, 1, 6, 6, 6, 6, 0, 1, 2, 7, 7, 6] },
  { kind: 'message', key: 'tutorial.step8' },
  { kind: 'demo', key: 'tutorial.step9', pit: 4, board: [5, 5, 5, 5, 15, 0, 0, 0, 0, 4, 6, 3] },
  { kind: 'message', key: 'tutorial.step10' },
  { kind: 'message', key: 'tutorial.step11' },
  { kind: 'freePlay', key: 'tutorial.step12', board: [3, 1, 2, 1, 5, 5, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', key: 'tutorial.step13' },
];

type Awaiting = 'next' | 'move' | 'demo' | 'busy';

interface Props {
  onExit: () => void;
  onChallenges: () => void;
}

const legalNorth = (p: number[]) => {
  const out: number[] = [];
  for (let j = 6; j < 12; j++) if (isValid(p, j)) out.push(j);
  return out;
};

export default function Tutorial({ onExit, onChallenges }: Props) {
  const t = useT();
  const clientRef = useRef<AIClient | null>(null);
  if (clientRef.current === null) { clientRef.current = new AIClient(); clientRef.current.newGame(0); }

  const [pits, setPits] = useState<number[]>(STEPS[0].board!.slice());
  const [scores, setScores] = useState<number[]>([0, 0]);
  const [activePit, setActivePit] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>('next');
  const [banner, setBanner] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const pitsRef = useRef<number[]>(STEPS[0].board!.slice());
  const scoresRef = useRef<number[]>([0, 0]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // Shared seed-by-seed animation (mirrors the main game, including the
  // animation-speed setting).
  const animate = useCallback((pit: number, onDone?: (running: boolean) => void) => {
    const mover = owner(pit);
    const pre = [...pitsRef.current];
    const work = [...pitsRef.current];
    const sc = [...scoresRef.current];
    const res = distribute(work, sc, pit);
    const sown = [...pre]; sown[pit] = 0; for (const i of res.sowed) sown[i]++;
    pitsRef.current = work; scoresRef.current = sc;

    const factor = SPEED_FACTOR[getSettings().speed];
    const sowMs = SOW_MS * factor;
    const capMs = CAP_MS * factor;

    setAwaiting('busy');
    setActivePit(pit); setCapturing([]);
    const disp = [...pre]; disp[pit] = 0; setPits([...disp]);

    res.sowed.forEach((idx, k) => at(sowMs * (k + 1), () => {
      disp[idx]++; setActivePit(idx); setPits([...disp]);
      if (factor > 0) playSow(k);
    }));
    const afterSow = sowMs * (res.sowed.length + 1);
    res.captured.forEach((cap, k) => at(afterSow + capMs * k, () => {
      setCapturing(res.captured.slice(0, k + 1));
      disp[cap] = 0; setPits([...disp]);
      setScores(prev => { const ns = [...prev]; ns[mover] += sown[cap]; return ns; });
    }));
    if (res.captured.length > 0) at(afterSow, () => { playCapture(res.captured.length); hapticCapture(); });

    const end = afterSow + capMs * res.captured.length + 240 * factor;
    at(end, () => {
      setActivePit(null); setCapturing([]);
      setPits([...pitsRef.current]); setScores([...scoresRef.current]);
      onDone?.(res.running);
    });
  }, []);

  // South (AI) reply during free play.
  const southReply = useCallback(() => {
    setAwaiting('busy');
    clientRef.current!.bestMove('game', pitsRef.current, scoresRef.current, 0).then(move => {
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

  // Enter a step: load its board, then set up interaction / demo.
  useEffect(() => {
    clearTimers();
    setBanner(null);
    const s = STEPS[step];
    if (s.board) {
      pitsRef.current = s.board.slice();
      scoresRef.current = [0, 0];
      setPits(s.board.slice());
      setScores([0, 0]);
    }
    setActivePit(null); setCapturing([]);
    setAnnouncement(t(s.key));

    if (s.kind === 'message') setAwaiting('next');
    else if (s.kind === 'interact') setAwaiting('move');
    else if (s.kind === 'freePlay') setAwaiting('move');
    else if (s.kind === 'demo') {
      setAwaiting('demo');
      at(DEMO_DELAY, () => animate(s.pit, () => setAwaiting('next')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  const next = () => {
    playTap(); hapticTap();
    if (step >= STEPS.length - 1) { onExit(); return; }
    setStep(i => i + 1);
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
    return null;
  })();

  return (
    <div className="screen game tutorial">
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('tutorial.brand')} ◇</div>
        <div className="tut-progress">{step + 1} / {STEPS.length}</div>
      </header>

      <div className="sr-only" role="status" aria-live="polite">{banner ?? announcement}</div>

      <div className="tut-card">
        <span className="tip-orn" aria-hidden>✦</span>
        <div className="tut-text">{banner ?? t(s.key)}</div>
      </div>

      <Board state={boardState} viewpoint={1} interactive={interactive} onPlay={handlePlay} />

      <div className="tut-footer">
        {footer && <div className="tut-hint">{footer}</div>}
        <div className="game-controls">
          {awaiting === 'next' && (
            <button className="pill pill-green tut-next" onClick={next}>
              <span className="pill-body">
                <span className="pill-title">
                  {step >= STEPS.length - 1 ? t('tutorial.finish') : t('tutorial.next')}
                </span>
              </span>
            </button>
          )}
          {step >= STEPS.length - 1 && awaiting === 'next' && (
            <button className="ctrl" onClick={onChallenges}>{t('tutorial.toChallenges')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
