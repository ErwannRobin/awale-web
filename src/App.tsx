import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Menu from './components/Menu';
import Learn from './components/Learn';
import Tutorial from './components/Tutorial';
import Challenges, { CHALLENGES } from './components/Challenges';
import Game from './components/Game';
import type { GameSetup } from './lib/useGame';
import { loadCompleted, saveCompleted } from './lib/progress';

type Screen =
  | { name: 'menu' }
  | { name: 'learn' }
  | { name: 'tutorial' }
  | { name: 'challenges' }
  | { name: 'game'; mode: 'ai' | 'local'; level: number; key: number }
  | { name: 'challenge'; index: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [completed, setCompleted] = useState<number[]>(() => loadCompleted());
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const gameKey = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const markComplete = useCallback((index: number) => {
    setCompleted(prev => {
      if (prev.includes(index)) return prev;
      const next = [...prev, index];
      saveCompleted(next);
      return next;
    });
  }, []);

  const startGame = (mode: 'ai' | 'local', level = 3) =>
    setScreen({ name: 'game', mode, level, key: ++gameKey.current });

  // Build the setup for the active challenge (memoised so its identity is stable).
  const challengeIndex = screen.name === 'challenge' ? screen.index : -1;
  const challengeSetup = useMemo<GameSetup | null>(() => {
    if (challengeIndex < 0) return null;
    const ch = CHALLENGES[challengeIndex];
    return {
      pits: ch.situation,
      scores: [ch.scoreJ1, ch.scoreJ2], // [computer/South, human/North]
      humanPlayer: 1,
      firstPlayer: 1,
      onResult: won => { if (won) markComplete(challengeIndex); },
    };
  }, [challengeIndex, markComplete]);

  return (
    <div className="app">
      {screen.name === 'menu' && (
        <Menu
          onPlayAI={level => startGame('ai', level)}
          onPlayLocal={() => startGame('local')}
          onTutorial={() => setScreen({ name: 'tutorial' })}
          onChallenges={() => setScreen({ name: 'challenges' })}
          onToast={showToast}
        />
      )}

      {screen.name === 'learn' && <Learn onBack={() => setScreen({ name: 'menu' })} />}

      {screen.name === 'tutorial' && (
        <Tutorial
          onExit={() => setScreen({ name: 'menu' })}
          onChallenges={() => setScreen({ name: 'challenges' })}
        />
      )}

      {screen.name === 'challenges' && (
        <Challenges
          completed={completed}
          onStart={index => setScreen({ name: 'challenge', index })}
          onBack={() => setScreen({ name: 'menu' })}
        />
      )}

      {screen.name === 'game' && (
        <Game
          key={screen.key}
          mode={screen.mode}
          level={screen.level}
          onExit={() => setScreen({ name: 'menu' })}
          onLearn={() => setScreen({ name: 'learn' })}
          onToast={showToast}
        />
      )}

      {screen.name === 'challenge' && challengeSetup && (
        <Game
          key={`ch-${screen.index}`}
          mode="ai"
          level={CHALLENGES[screen.index].levelIA ?? 1}
          setup={challengeSetup}
          goal={CHALLENGES[screen.index].goal}
          title={`Challenge ${screen.index + 1}`}
          oppName="Computer"
          onExit={() => setScreen({ name: 'challenges' })}
          onLearn={() => setScreen({ name: 'learn' })}
          onToast={showToast}
        />
      )}

      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
