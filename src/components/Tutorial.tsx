import { useCallback, useEffect, useRef, useState } from 'react';
import Board from './Board';
import { owner, isValid, distribute } from '../lib/engine';
import { AIClient } from '../lib/aiClient';
import type { GameState } from '../lib/useGame';

const SOW_MS = 220;
const CAP_MS = 260;
const DEMO_DELAY = 1000;

// Human is North (player 1); demo moves are played by South (player 0).
type Step =
  | { kind: 'message'; text: string; board?: number[] }
  | { kind: 'demo'; text: string; pit: number; board?: number[] }
  | { kind: 'interact'; text: string; board?: number[] }
  | { kind: 'freePlay'; text: string; board?: number[] };

const STEPS: Step[] = [
  { kind: 'message', text: '1: The goal of the game is to collect more seeds than the opponent.', board: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', text: '2: To start, choose one of your pits and sow its seeds one by one counterclockwise.' },
  { kind: 'demo', text: 'For example:', pit: 5 },
  { kind: 'interact', text: 'Your turn: tap one of your highlighted pits to sow it!' },
  { kind: 'message', text: 'Well done! 3: If the last sown pit holds 2 or 3 seeds on the opponent\'s side, you capture them.', board: [2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', text: '4: You also capture the preceding consecutive pits if they hold 2 or 3 seeds.' },
  { kind: 'demo', text: 'For example:', pit: 2, board: [0, 1, 6, 6, 6, 6, 0, 1, 2, 7, 7, 6] },
  { kind: 'message', text: '5: A pit holding 12+ seeds (a "house") skips its origin pit when sown.' },
  { kind: 'demo', text: 'For example:', pit: 4, board: [5, 5, 5, 5, 15, 0, 0, 0, 0, 4, 6, 3] },
  { kind: 'message', text: '6: By courtesy, you cannot starve your opponent by capturing all their seeds.' },
  { kind: 'message', text: '7: And you must feed a starving opponent when you can.' },
  { kind: 'freePlay', text: 'Your turn now: try to capture some seeds!', board: [3, 1, 2, 1, 5, 5, 4, 4, 4, 4, 4, 4] },
  { kind: 'message', text: 'End of the tutorial. Try the challenges to sharpen your strategy!' },
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
  const clientRef = useRef<AIClient | null>(null);
  if (clientRef.current === null) { clientRef.current = new AIClient(); clientRef.current.newGame(0); }

  const [pits, setPits] = useState<number[]>(STEPS[0].board!.slice());
  const [scores, setScores] = useState<number[]>([0, 0]);
  const [activePit, setActivePit] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>('next');
  const [banner, setBanner] = useState<string | null>(null);

  const pitsRef = useRef<number[]>(STEPS[0].board!.slice());
  const scoresRef = useRef<number[]>([0, 0]);
  const timers = useRef<number[]>([]);
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // Shared seed-by-seed animation (mirrors the main game).
  const animate = useCallback((pit: number, onDone?: (running: boolean) => void) => {
    const mover = owner(pit);
    const pre = [...pitsRef.current];
    const work = [...pitsRef.current];
    const sc = [...scoresRef.current];
    const res = distribute(work, sc, pit);
    const sown = [...pre]; sown[pit] = 0; for (const i of res.sowed) sown[i]++;
    pitsRef.current = work; scoresRef.current = sc;

    setAwaiting('busy');
    setActivePit(pit); setCapturing([]);
    const disp = [...pre]; disp[pit] = 0; setPits([...disp]);

    res.sowed.forEach((idx, k) => at(SOW_MS * (k + 1), () => {
      disp[idx]++; setActivePit(idx); setPits([...disp]);
    }));
    const afterSow = SOW_MS * (res.sowed.length + 1);
    res.captured.forEach((cap, k) => at(afterSow + CAP_MS * k, () => {
      setCapturing(res.captured.slice(0, k + 1));
      disp[cap] = 0; setPits([...disp]);
      setScores(prev => { const ns = [...prev]; ns[mover] += sown[cap]; return ns; });
    }));
    const end = afterSow + CAP_MS * res.captured.length + 240;
    at(end, () => {
      setActivePit(null); setCapturing([]);
      setPits([...pitsRef.current]); setScores([...scoresRef.current]);
      onDone?.(res.running);
    });
  }, []);

  // South (AI) reply during free play.
  const southReply = useCallback((afterHumanScore: number) => {
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
    void afterHumanScore;
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
          setBanner('Well played — you captured seeds! 🎉');
          setAwaiting('next');
          return;
        }
        if (!running) { setAwaiting('next'); return; }
        southReply(before);
      });
    }
  };

  const next = () => {
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
  };

  const footer = (() => {
    if (awaiting === 'demo') return 'Watch how the computer sows…';
    if (awaiting === 'busy') return 'Seeds are on the move…';
    if (awaiting === 'move') return s.kind === 'freePlay'
      ? 'Your turn — capture some seeds!'
      : 'Your turn — tap a highlighted pit.';
    return null;
  })();

  return (
    <div className="screen game tutorial">
      <header className="game-top">
        <button className="round-btn" onClick={onExit} aria-label="Back">←</button>
        <div className="brand">◇ TUTORIAL ◇</div>
        <div className="tut-progress">{step + 1} / {STEPS.length}</div>
      </header>

      <div className="tut-card">
        <span className="tip-orn" aria-hidden>✦</span>
        <div className="tut-text">{banner ?? s.text}</div>
      </div>

      <Board state={boardState} viewpoint={1} interactive={interactive} onPlay={handlePlay} />

      <div className="tut-footer">
        {footer && <div className="tut-hint">{footer}</div>}
        <div className="game-controls">
          {(awaiting === 'next') && (
            <button className="pill pill-green tut-next" onClick={next}>
              <span className="pill-body"><span className="pill-title">{step >= STEPS.length - 1 ? 'FINISH' : 'NEXT'}</span></span>
            </button>
          )}
          {step >= STEPS.length - 1 && awaiting === 'next' && (
            <button className="ctrl" onClick={onChallenges}>Go to Challenges →</button>
          )}
        </div>
      </div>
    </div>
  );
}
