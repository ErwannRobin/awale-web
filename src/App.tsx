import { useCallback, useEffect, useRef, useState } from 'react';
import Menu from './components/Menu';
import Learn from './components/Learn';
import Game from './components/Game';

type Screen =
  | { name: 'menu' }
  | { name: 'learn' }
  | { name: 'game'; mode: 'ai' | 'local'; level: number; key: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const gameKey = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const startGame = (mode: 'ai' | 'local', level = 3) =>
    setScreen({ name: 'game', mode, level, key: ++gameKey.current });

  return (
    <div className="app">
      {screen.name === 'menu' && (
        <Menu
          onPlayAI={level => startGame('ai', level)}
          onPlayLocal={() => startGame('local')}
          onLearn={() => setScreen({ name: 'learn' })}
          onToast={showToast}
        />
      )}
      {screen.name === 'learn' && <Learn onBack={() => setScreen({ name: 'menu' })} />}
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
      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
