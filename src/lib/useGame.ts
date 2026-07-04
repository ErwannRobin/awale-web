import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValid, distribute } from './engine';
import { AIClient } from './aiClient';

export type Phase = 'idle' | 'animating' | 'thinking' | 'over';
export type Winner = 0 | 1 | 'draw' | null;

const SOW_MS = 220;      // per-seed sowing tick
const CAP_MS = 260;      // per captured-pit sweep
const AI_MIN_MS = 600;   // AI never feels instant

const fresh = () => Array(12).fill(4) as number[];

export interface GameState {
  pits: number[];
  scores: number[];
  turn: 0 | 1;
  phase: Phase;
  winner: Winner;
  legal: number[];
  hintPit: number | null;
  activePit: number | null;   // pit currently being sown/emphasised
  capturing: number[];        // pits mid-capture sweep (for styling)
  canUndo: boolean;
  lastCaptured: number | null;
}

interface Options { mode: 'ai' | 'local'; level: number }

export function useGame({ mode, level }: Options) {
  const clientRef = useRef<AIClient | null>(null);
  if (clientRef.current === null) clientRef.current = new AIClient();

  const [pits, setPits] = useState<number[]>(fresh);
  const [scores, setScores] = useState<number[]>([0, 0]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [winner, setWinner] = useState<Winner>(null);
  const [hintPit, setHintPit] = useState<number | null>(null);
  const [activePit, setActivePit] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number[]>([]);
  const [lastCaptured, setLastCaptured] = useState<number | null>(null);

  // Logical truth (kept in refs so async steps read the latest values).
  const pitsRef = useRef<number[]>(fresh());
  const scoresRef = useRef<number[]>([0, 0]);
  const turnRef = useRef<0 | 1>(0);
  const phaseRef = useRef<Phase>('idle');
  const timers = useRef<number[]>([]);
  const history = useRef<{ pits: number[]; scores: number[]; turn: 0 | 1 }[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  const humanPlayer: 0 | 1 = 0; // In AI mode the person is South (bottom).

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const legalFor = useCallback((p: number[], player: 0 | 1) => {
    const out: number[] = [];
    for (let j = player * 6; j < player * 6 + 6; j++) if (isValid(p, j)) out.push(j);
    return out;
  }, []);

  const legal = useMemo(
    () => (phase === 'idle' ? legalFor(pits, turn) : []),
    [pits, turn, phase, legalFor],
  );

  // ---- game-over helpers -------------------------------------------------
  const decideWinner = (s: number[]): Winner =>
    s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : 'draw';

  const finish = useCallback(() => {
    setPhaseBoth('over');
    setWinner(decideWinner(scoresRef.current));
    setActivePit(null);
  }, []);

  // Blocked player: the side to move has no legal move → each keeps their row.
  const handleBlocked = useCallback((player: 0 | 1) => {
    const p = pitsRef.current;
    const s = [...scoresRef.current];
    for (let k = 0; k < 6; k++) s[0] += p[k];
    for (let k = 6; k < 12; k++) s[1] += p[k];
    const cleared = Array(12).fill(0);
    pitsRef.current = cleared; scoresRef.current = s;
    setPits(cleared); setScores(s);
    void player;
    finish();
  }, [finish]);

  const forwardTo = useRef<(player: 0 | 1) => void>(() => {});

  // ---- animated move -----------------------------------------------------
  const animateMove = useCallback((pit: number) => {
    const player = turnRef.current;
    const pre = [...pitsRef.current];

    const work = [...pitsRef.current];
    const sc = [...scoresRef.current];
    const result = distribute(work, sc, pit);

    // Reconstruct the post-sow (pre-capture) board so we know per-pit counts.
    const sown = [...pre];
    sown[pit] = 0;
    for (const idx of result.sowed) sown[idx]++;

    // Commit truth immediately; the UI animates toward it.
    pitsRef.current = work;
    scoresRef.current = sc;

    setPhaseBoth('animating');
    setHintPit(null);
    setActivePit(pit);
    setCapturing([]);
    setLastCaptured(null);

    // 1. origin empties
    const display = [...pre];
    display[pit] = 0;
    setPits([...display]);

    // 2. sow one seed at a time
    result.sowed.forEach((idx, k) => {
      at(SOW_MS * (k + 1), () => {
        display[idx]++;
        setActivePit(idx);
        setPits([...display]);
      });
    });

    const afterSow = SOW_MS * (result.sowed.length + 1);

    // 3. sweep captured pits (last-sown first, matching engine order)
    if (result.captured.length > 0) {
      result.captured.forEach((cap, k) => {
        at(afterSow + CAP_MS * k, () => {
          setCapturing(result.captured.slice(0, k + 1));
          setLastCaptured(cap);
          display[cap] = 0;
          setPits([...display]);
          const gained = sown[cap];
          setScores(prev => {
            const ns = [...prev];
            ns[player] += gained;
            return ns;
          });
        });
      });
    }

    const afterCaptures = afterSow + CAP_MS * result.captured.length + 260;

    at(afterCaptures, () => {
      setActivePit(null);
      setCapturing([]);
      // Snap to truth (also covers endGame folding remaining seeds).
      setPits([...pitsRef.current]);
      setScores([...scoresRef.current]);

      if (!result.running || scoresRef.current[player] >= 25) {
        finish();
        return;
      }
      const next: 0 | 1 = player === 0 ? 1 : 0;
      turnRef.current = next;
      setTurn(next);
      // Blocked-player check for the side about to move.
      if (legalFor(pitsRef.current, next).length === 0) {
        handleBlocked(next);
        return;
      }
      setPhaseBoth('idle');
      forwardTo.current(next);
    });
  }, [finish, handleBlocked, legalFor]);

  // ---- AI turn -----------------------------------------------------------
  const runAI = useCallback((player: 0 | 1) => {
    setPhaseBoth('thinking');
    setActivePit(null);
    const t0 = performance.now();
    clientRef.current!
      .bestMove('game', pitsRef.current, scoresRef.current, player)
      .then(move => {
        const wait = Math.max(0, AI_MIN_MS - (performance.now() - t0));
        at(wait, () => {
          if (move == null) { handleBlocked(player); return; }
          animateMove(move);
        });
      });
  }, [animateMove, handleBlocked]);

  // After each committed move, decide whether the next mover is the AI.
  forwardTo.current = (nextPlayer: 0 | 1) => {
    if (mode === 'ai' && nextPlayer !== humanPlayer) runAI(nextPlayer);
  };

  // ---- public actions ----------------------------------------------------
  const play = useCallback((pit: number) => {
    if (phaseRef.current !== 'idle') return;
    if (mode === 'ai' && turnRef.current !== humanPlayer) return;
    if (!isValid(pitsRef.current, pit) || owner6(pit) !== turnRef.current) return;

    // Snapshot for undo (vs AI only), taken at the human's turn start.
    if (mode === 'ai') {
      history.current.push({
        pits: [...pitsRef.current],
        scores: [...scoresRef.current],
        turn: turnRef.current,
      });
      setHistoryLen(history.current.length);
    }
    animateMove(pit);
  }, [mode, animateMove]);

  const hint = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    const move = await clientRef.current!.bestMove(
      'hint', pitsRef.current, scoresRef.current, turnRef.current,
    );
    if (move != null && phaseRef.current === 'idle') {
      setHintPit(move);
      at(1800, () => setHintPit(null));
    }
  }, []);

  const undo = useCallback(() => {
    if (mode !== 'ai') return;
    if (phaseRef.current === 'animating' || phaseRef.current === 'thinking') return;
    const snap = history.current.pop();
    if (!snap) return;
    setHistoryLen(history.current.length);
    clearTimers();
    pitsRef.current = [...snap.pits];
    scoresRef.current = [...snap.scores];
    turnRef.current = snap.turn;
    setPits([...snap.pits]);
    setScores([...snap.scores]);
    setTurn(snap.turn);
    setWinner(null);
    setHintPit(null);
    setActivePit(null);
    setCapturing([]);
    setPhaseBoth('idle');
  }, [mode]);

  const newGame = useCallback(() => {
    clearTimers();
    clientRef.current!.newGame(level);
    history.current = [];
    setHistoryLen(0);
    pitsRef.current = fresh();
    scoresRef.current = [0, 0];
    turnRef.current = 0;
    setPits(fresh());
    setScores([0, 0]);
    setTurn(0);
    setWinner(null);
    setHintPit(null);
    setActivePit(null);
    setCapturing([]);
    setLastCaptured(null);
    setPhaseBoth('idle');
  }, [level]);

  // Initialise the worker's stateful AI for this game's level.
  useEffect(() => {
    clientRef.current!.newGame(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { clearTimers(); clientRef.current?.dispose(); }, []);

  const state: GameState = {
    pits, scores, turn, phase, winner, legal,
    hintPit, activePit, capturing,
    canUndo: mode === 'ai' && historyLen > 0 && (phase === 'idle' || phase === 'over'),
    lastCaptured,
  };

  return { state, play, hint, undo, newGame };
}

const owner6 = (pit: number) => (Math.floor((pit % 12) / 6) as 0 | 1);
