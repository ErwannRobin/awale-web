import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Menu from './components/Menu.tsx';
import Learn from './components/Learn.tsx';
import Tutorial from './components/Tutorial.tsx';
import Challenges from './components/Challenges.tsx';
import { CHALLENGES, challengeGoalKey } from './lib/challenges.ts';
import Game from './components/Game.tsx';
import Online from './components/Online.tsx';
import OnlineGame from './components/OnlineGame.tsx';
import SettingsScreen from './components/Settings.tsx';
import StatsScreen from './components/Stats.tsx';
import Records from './components/Records.tsx';
import type { GameSetup } from './lib/useGame.ts';
import { loadCompleted, saveCompleted } from './lib/progress.ts';
import { loadProfile } from './lib/profile.ts';
import { loadStats } from './lib/stats.ts';
import { loadSavedGame, clearSavedGame, type SavedGame } from './lib/saveGame.ts';
import { useSettings } from './lib/useSettings.ts';
import { useBackButton } from './lib/useBackButton.ts';
import { exitApp } from './lib/native.ts';
import { refreshReminder } from './lib/notifications.ts';
import { clearJoinCode, onlineEnabled, readJoinCode } from './lib/onlineConfig.ts';
import { normaliseRoomCode } from './lib/protocol.ts';
import { useT } from './i18n/useT.ts';

type Screen =
  | { name: 'menu' }
  | { name: 'tutorial' }
  | { name: 'challenges' }
  | { name: 'stats' }
  | { name: 'records' }
  | { name: 'game'; mode: 'ai' | 'local'; level: number; key: number; resume: SavedGame | null }
  | { name: 'online' }
  | { name: 'onlineGame'; room: string }
  | { name: 'challenge'; index: number }
  // Help and Settings are reachable mid-game, so they carry the screen to
  // return to. Without that, tapping ⚙ during a game would drop the board.
  | { name: 'learn'; back: Screen }
  | { name: 'settings'; back: Screen };

export default function App() {
  const settings = useSettings();
  const t = useT();

  // A `?join=CODE` link opens straight into that room. Landing on the menu
  // first and making the player find the code again would waste the link.
  const [screen, setScreen] = useState<Screen>(() => {
    if (!onlineEnabled()) return { name: 'menu' };
    const code = readJoinCode();
    const room = code ? normaliseRoomCode(code) : null;
    return room ? { name: 'onlineGame', room } : { name: 'menu' };
  });
  const [completed, setCompleted] = useState<number[]>(() => loadCompleted());
  const [profile, setProfile] = useState(loadProfile);
  const [stats, setStats] = useState(loadStats);
  const [saved, setSaved] = useState<SavedGame | null>(() => loadSavedGame());
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameKey = useRef(0);

  // Theme and language are document-level: the theme swaps CSS tokens, and
  // <html lang> matters for screen readers and hyphenation.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('lang', settings.language);
  }, [settings.theme, settings.language]);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refreshStats = useCallback(() => setStats(loadStats()), []);
  const refreshSaved = useCallback(() => setSaved(loadSavedGame()), []);

  const markComplete = useCallback((index: number) => {
    setCompleted(prev => {
      if (prev.includes(index)) return prev;
      const next = [...prev, index];
      saveCompleted(next);
      return next;
    });
  }, []);

  const startGame = (mode: 'ai' | 'local', level = 3, resume: SavedGame | null = null) => {
    // Starting fresh abandons any stored game, so the menu stops offering it.
    if (!resume) { clearSavedGame(); setSaved(null); }
    setScreen({ name: 'game', mode, level, key: ++gameKey.current, resume });
  };

  const leaveOnline = () => {
    // Drop the invite from the address bar on the way out, so a refresh does
    // not walk back into a game that has finished.
    clearJoinCode();
    setScreen({ name: 'menu' });
    void refreshReminder('left a game');
  };

  const leaveGame = () => {
    refreshSaved();
    refreshStats();
    setScreen({ name: 'menu' });
    // Just played, so any "you have not played in a while" reminder moves out.
    void refreshReminder('left a game');
  };

  // Build the setup for the active challenge (memoised so its identity is stable).
  const challengeIndex = screen.name === 'challenge' ? screen.index : -1;
  const challengeSetup = useMemo<GameSetup | null>(() => {
    if (challengeIndex < 0) return null;
    const ch = CHALLENGES[challengeIndex];
    return {
      pits: ch.pits,
      scores: ch.scores,          // [computer/South, human/North]
      humanPlayer: 1,
      firstPlayer: 1,
      onResult: won => { if (won) markComplete(challengeIndex); },
    };
  }, [challengeIndex, markComplete]);

  /**
   * Returning to a game re-reads the save slot rather than reusing the stale
   * `resume` object captured when the game started, so the board comes back
   * exactly where it was left.
   */
  const goBackTo = (target: Screen) => () => {
    if (target.name === 'game') {
      const latest = loadSavedGame();
      setScreen(latest ? { ...target, resume: latest } : { name: 'menu' });
      return;
    }
    setScreen(target);
  };

  /**
   * Android's back button. It has to mean "one screen back", not "quit" —
   * quitting out of a game in progress is exactly what store reviewers flag.
   * Only the menu exits, and only on Android; iOS has no such button and
   * forbids a programmatic exit anyway.
   */
  useBackButton(() => {
    switch (screen.name) {
      case 'menu': void exitApp(); return;
      case 'game': leaveGame(); return;
      case 'onlineGame': leaveOnline(); return;
      case 'learn':
      case 'settings': goBackTo(screen.back)(); return;
      case 'challenge': setScreen({ name: 'challenges' }); return;
      default: setScreen({ name: 'menu' });
    }
  });

  return (
    <div className="app">
      {screen.name === 'menu' && (
        <Menu
          profile={profile}
          stats={stats}
          completed={completed}
          saved={saved}
          onPlayAI={level => startGame('ai', level)}
          onPlayLocal={() => startGame('local')}
          onQuickMatch={level => startGame('ai', level)}
          onContinue={() => saved && startGame(saved.mode, saved.level, saved)}
          onTutorial={() => setScreen({ name: 'tutorial' })}
          onChallenges={() => setScreen({ name: 'challenges' })}
          onOnline={() => setScreen({ name: 'online' })}
          onSettings={() => setScreen({ name: 'settings', back: { name: 'menu' } })}
          onStats={() => setScreen({ name: 'stats' })}
          onRecords={() => setScreen({ name: 'records' })}
        />
      )}

      {screen.name === 'online' && (
        <Online
          onStart={room => setScreen({ name: 'onlineGame', room })}
          onBack={() => setScreen({ name: 'menu' })}
          onToast={showToast}
        />
      )}

      {screen.name === 'onlineGame' && (
        <OnlineGame
          key={screen.room}
          room={screen.room}
          onExit={leaveOnline}
          onLearn={() => setScreen({ name: 'learn', back: screen })}
          onSettings={() => setScreen({ name: 'settings', back: screen })}
          onToast={showToast}
        />
      )}

      {screen.name === 'learn' && <Learn onBack={goBackTo(screen.back)} />}

      {screen.name === 'settings' && (
        <SettingsScreen
          onBack={goBackTo(screen.back)}
          onToast={showToast}
          onProfileChange={() => setProfile(loadProfile())}
          onDataReset={() => {
            setCompleted(loadCompleted());
            refreshStats();
            refreshSaved();
            setProfile(loadProfile());
          }}
        />
      )}

      {screen.name === 'stats' && (
        <StatsScreen completed={completed} onBack={() => setScreen({ name: 'menu' })} />
      )}

      {screen.name === 'records' && <Records onBack={() => setScreen({ name: 'menu' })} />}

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
          resume={screen.resume}
          persist
          rated={screen.mode === 'ai'}
          onExit={leaveGame}
          onLearn={() => setScreen({ name: 'learn', back: screen })}
          onSettings={() => setScreen({ name: 'settings', back: screen })}
          onToast={showToast}
          onStatsChange={refreshStats}
        />
      )}

      {screen.name === 'challenge' && challengeSetup && (
        <Game
          key={`ch-${screen.index}`}
          mode="ai"
          level={CHALLENGES[screen.index].levelIA ?? 1}
          setup={challengeSetup}
          goal={t(challengeGoalKey(screen.index))}
          title={t('challenges.item', { n: screen.index + 1 })}
          oppName={t('a11y.opponent')}
          onExit={() => setScreen({ name: 'challenges' })}
          onLearn={() => setScreen({ name: 'learn', back: screen })}
          onSettings={() => setScreen({ name: 'settings', back: screen })}
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
