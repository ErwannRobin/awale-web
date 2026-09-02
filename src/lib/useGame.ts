import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValid, distribute, WINNING_SCORE } from './engine.ts';
import { AIClient } from './aiClient.ts';
import { getSettings, SPEED_FACTOR } from './settings.ts';
import { playSow, playCapture, playWin, playLose } from './sound.ts';
import { hapticCapture, hapticWin, hapticLose } from './haptics.ts';
import { saveGame, clearSavedGame, type SavedGame } from './saveGame.ts';

export type Phase = 'idle' | 'animating' | 'thinking' | 'over';
export type Winner = 0 | 1 | 'draw' | null;

const SOW_MS = 220;      // per-seed sowing tick, at normal speed
const CAP_MS = 260;      // per captured-pit sweep
const TAIL_MS = 260;     // settle time before the turn passes
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
  /** Screen-reader narration of the most recent event. */
  announcement: string;
}

// A custom start position (used by Challenges). Without it the game begins from
// the standard opening with the human as South, moving first.
export interface GameSetup {
  pits: number[];
  scores: [number, number];   // [player 0 (South), player 1 (North)]
  humanPlayer: 0 | 1;
  firstPlayer: 0 | 1;
  onResult?: (humanWon: boolean, scores: number[]) => void;
}

export interface Narrator {
  moved(player: 0 | 1, pit: number): string;
  captured(player: 0 | 1, count: number): string;
  turn(player: 0 | 1): string;
  over(winner: Winner, scores: number[]): string;
}

interface Options {
  mode: 'ai' | 'local';
  level: number;
  setup?: GameSetup;
  /** Position to resume instead of a fresh board. */
  resume?: SavedGame | null;
  /** Free play persists so a refresh does not lose the board; challenges do not. */
  persist?: boolean;
  /** Fired once per finished game, for stats. */
  onFinish?: (winner: Winner, scores: number[]) => void;
  narrator?: Narrator;
}

export function useGame({ mode, level, setup, resume, persist, onFinish, narrator }: Options) {
  const clientRef = useRef<AIClient | null>(null);
  if (clientRef.current === null) clientRef.current = new AIClient();

  const humanPlayer: 0 | 1 = setup?.humanPlayer ?? 0;
  const firstPlayer: 0 | 1 = resume?.turn ?? setup?.firstPlayer ?? 0;
  const startPits = useCallback(
    () => (resume ? [...resume.pits] : setup ? [...setup.pits] : fresh()),
    [setup, resume],
  );
  const startScores = useCallback(
    () => (resume ? [...resume.scores] : setup ? [...setup.scores] : [0, 0]),
    [setup, resume],
  );

  const [pits, setPits] = useState<number[]>(startPits);
  const [scores, setScores] = useState<number[]>(startScores);
  const [turn, setTurn] = useState<0 | 1>(firstPlayer);
  const [phase, setPhase] = useState<Phase>('idle');
  const [winner, setWinner] = useState<Winner>(null);
  const [hintPit, setHintPit] = useState<number | null>(null);
  const [activePit, setActivePit] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number[]>([]);
  const [lastCaptured, setLastCaptured] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Logical truth (kept in refs so async steps read the latest values).
  const pitsRef = useRef<number[]>(startPits());
  const scoresRef = useRef<number[]>(startScores());
  const turnRef = useRef<0 | 1>(firstPlayer);
  const phaseRef = useRef<Phase>('idle');
  // Plain setTimeout (not window.setTimeout) so this state machine runs
  // unchanged under React Native.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const history = useRef<{ pits: number[]; scores: number[]; turn: 0 | 1 }[]>(
    resume ? resume.history.map(h => ({ ...h })) : [],
  );
  const [historyLen, setHistoryLen] = useState(history.current.length);
  const resultFired = useRef(false);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

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

  // Free play is resumable; challenges restart from their fixed position and
  // the tutorial is scripted, so neither writes a save slot.
  const persistNow = useCallback(() => {
    if (!persist) return;
    saveGame({
      mode, level,
      pits: [...pitsRef.current],
      scores: [...scoresRef.current],
      turn: turnRef.current,
      history: history.current.map(h => ({ ...h })),
    });
  }, [persist, mode, level]);

  // ---- game-over helpers -------------------------------------------------
  const decideWinner = (s: number[]): Winner =>
    s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : 'draw';

  const finish = useCallback(() => {
    setPhaseBoth('over');
    const w = decideWinner(scoresRef.current);
    setWinner(w);
    setActivePit(null);
    if (narrator) setAnnouncement(narrator.over(w, [...scoresRef.current]));
    if (persist) clearSavedGame();
    if (w === humanPlayer || (mode === 'local' && w !== 'draw')) { playWin(); hapticWin(); }
    else { playLose(); hapticLose(); }
    if (!resultFired.current) {
      resultFired.current = true;
      setup?.onResult?.(w === humanPlayer, [...scoresRef.current]);
      onFinish?.(w, [...scoresRef.current]);
    }
  }, [setup, humanPlayer, onFinish, narrator, persist, mode]);

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

    // Animation tempo is a user setting; `instant` collapses every step to 0ms
    // but keeps the ordering, so the final state is identical either way.
    const factor = SPEED_FACTOR[getSettings().speed];
    const sowMs = SOW_MS * factor;
    const capMs = CAP_MS * factor;

    setPhaseBoth('animating');
    setHintPit(null);
    setActivePit(pit);
    setCapturing([]);
    setLastCaptured(null);
    if (narrator) setAnnouncement(narrator.moved(player, pit));

    // 1. origin empties
    const display = [...pre];
    display[pit] = 0;
    setPits([...display]);

    // 2. sow one seed at a time
    result.sowed.forEach((idx, k) => {
      at(sowMs * (k + 1), () => {
        display[idx]++;
        setActivePit(idx);
        setPits([...display]);
        if (factor > 0) playSow(k);
      });
    });

    const afterSow = sowMs * (result.sowed.length + 1);

    // 3. sweep captured pits (last-sown first, matching engine order)
    if (result.captured.length > 0) {
      result.captured.forEach((cap, k) => {
        at(afterSow + capMs * k, () => {
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
      at(afterSow, () => {
        playCapture(result.captured.length);
        hapticCapture();
        if (narrator) {
          const total = result.captured.reduce((sum, c) => sum + sown[c], 0);
          setAnnouncement(narrator.captured(player, total));
        }
      });
    }

    const afterCaptures = afterSow + capMs * result.captured.length + TAIL_MS * factor;

    at(afterCaptures, () => {
      setActivePit(null);
      setCapturing([]);
      // Snap to truth (also covers endGame folding remaining seeds).
      setPits([...pitsRef.current]);
      setScores([...scoresRef.current]);

      if (!result.running || scoresRef.current[player] >= WINNING_SCORE) {
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
      persistNow();
      if (narrator) setAnnouncement(narrator.turn(next));
      forwardTo.current(next);
    });
  }, [finish, handleBlocked, legalFor, narrator, persistNow]);

  // ---- AI turn -----------------------------------------------------------
  const runAI = useCallback((player: 0 | 1) => {
    setPhaseBoth('thinking');
    setActivePit(null);
    const t0 = performance.now();
    // A user who set `instant` does not want a staged pause either.
    const minWait = SPEED_FACTOR[getSettings().speed] === 0 ? 0 : AI_MIN_MS;
    clientRef.current!
      .bestMove('game', pitsRef.current, scoresRef.current, player)
      .then(move => {
        const wait = Math.max(0, minWait - (performance.now() - t0));
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
  }, [mode, animateMove, humanPlayer]);

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
    resultFired.current = false;
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
    persistNow();
  }, [mode, persistNow]);

  const newGame = useCallback(() => {
    clearTimers();
    clientRef.current!.newGame(level);
    history.current = [];
    setHistoryLen(0);
    resultFired.current = false;
    // A restart abandons any resumed position — start from the real beginning.
    const basePits = setup ? [...setup.pits] : fresh();
    const baseScores = setup ? [...setup.scores] : [0, 0];
    const first: 0 | 1 = setup?.firstPlayer ?? 0;
    pitsRef.current = basePits;
    scoresRef.current = baseScores;
    turnRef.current = first;
    setPits([...basePits]);
    setScores([...baseScores]);
    setTurn(first);
    setWinner(null);
    setHintPit(null);
    setActivePit(null);
    setCapturing([]);
    setLastCaptured(null);
    setAnnouncement('');
    setPhaseBoth('idle');
    persistNow();
    // If the AI moves first from this position, kick it off.
    if (mode === 'ai' && first !== humanPlayer) at(300, () => runAI(first));
  }, [level, setup, mode, humanPlayer, runAI, persistNow]);

  // Initialise the worker's stateful AI, and kick the AI if it opens.
  useEffect(() => {
    clientRef.current!.newGame(level);
    persistNow();
    if (mode === 'ai' && firstPlayer !== humanPlayer) at(400, () => runAI(firstPlayer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { clearTimers(); clientRef.current?.dispose(); }, []);

  const state: GameState = {
    pits, scores, turn, phase, winner, legal,
    hintPit, activePit, capturing,
    canUndo: mode === 'ai' && historyLen > 0 && (phase === 'idle' || phase === 'over'),
    lastCaptured,
    announcement,
  };

  return { state, play, hint, undo, newGame, humanPlayer };
}

const owner6 = (pit: number) => (Math.floor((pit % 12) / 6) as 0 | 1);
