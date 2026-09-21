import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Menu from './components/Menu.tsx';
import Learn from './components/Learn.tsx';
import Tutorial from './components/Tutorial.tsx';
import Challenges from './components/Challenges.tsx';
import { CHALLENGES, challengeGoalKey } from './lib/challenges.ts';
import Game from './components/Game.tsx';
import Online from './components/Online.tsx';
import OnlineGame from './components/OnlineGame.tsx';
import SignIn from './components/SignIn.tsx';
import SettingsScreen from './components/Settings.tsx';
import StatsScreen from './components/Stats.tsx';
import Records from './components/Records.tsx';
import type { GameSetup } from './lib/useGame.ts';
import { loadCompleted, saveCompleted } from './lib/progress.ts';
import { loadProfile } from './lib/profile.ts';
import { clearSession, loadSession, refreshSession, type Session } from './lib/auth.ts';
import { loadStats } from './lib/stats.ts';
import { loadSavedGame, clearSavedGame, type SavedGame } from './lib/saveGame.ts';
import { useSettings } from './lib/useSettings.ts';
import { useBackButton } from './lib/useBackButton.ts';
import { useBrowserBack } from './lib/useBrowserBack.ts';
import { useEscapeKey } from './lib/useEscapeKey.ts';
import { isNative } from './lib/platform.ts';
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
  // Sign-in is reached from the online screen and from the player chip on the
  // menu, so like Learn and Settings it carries where to go back to.
  | { name: 'signIn'; back: Screen }
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
  // Read from storage so a returning player is signed in before the first
  // paint, then confirmed against the server — see the effect below.
  const [account, setAccount] = useState<Session | null>(loadSession);
  const [stats, setStats] = useState(loadStats);
  const [saved, setSaved] = useState<SavedGame | null>(() => loadSavedGame());
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameKey = useRef(0);

  // Theme and language are document-level: the theme swaps CSS tokens, and
  // <html lang> matters for screen readers and hyphenation.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('lang', settings.language);

    // The browser paints its own furniture — the address bar on mobile web,
    // the status bar in an installed shell — and CSS cannot reach it. Left at
    // the one value in index.html it stays dark brown above a pale sand table,
    // which reads as the background starting below the address bar rather than
    // at the top of the screen. Feed it the colour the table actually starts
    // with, read back from the theme so there is still one source of truth.
    const top = getComputedStyle(root).getPropertyValue('--table-1').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (top && meta) meta.setAttribute('content', top);
    // Same reason, for the chrome the colour does not cover: text and scroll
    // bars in the browser's own UI. Sand is the only light theme.
    root.style.colorScheme = settings.theme === 'sand' ? 'light' : 'dark';
  }, [settings.theme, settings.language]);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // A stored token may have been signed with a key that has since rotated. The
  // server is the only thing that can tell, so ask it once at startup and drop
  // the session if it says no.
  useEffect(() => {
    const stored = loadSession();
    if (!stored) return;
    let live = true;
    void refreshSession(stored).then(next => { if (live) setAccount(next); });
    return () => { live = false; };
  }, []);

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
   * The player chip at the top of the menu.
   *
   * Signed out, it goes to sign-in: the chip is the account, and that is the
   * only thing there is to do with one you do not have yet. Signed in, there
   * is nothing to sign into, so it opens the profile in Settings — and a build
   * with no server configured has no sign-in at all.
   */
  const openAccount = () => setScreen(
    onlineEnabled() && !account
      ? { name: 'signIn', back: { name: 'menu' } }
      : { name: 'settings', back: { name: 'menu' } },
  );

  /**
   * What "back" means, wherever it is pressed: Android's hardware button, the
   * browser's Back button, Escape on a desktop keyboard. One screen back, not
   * "quit" — quitting out of a game in progress is exactly what store
   * reviewers flag. Only the menu exits, and only on Android; iOS has no such
   * button and forbids a programmatic exit anyway, and on the web the browser
   * leaves the site by itself.
   */
  const goBack = () => {
    switch (screen.name) {
      case 'menu': void exitApp(); return;
      case 'game': leaveGame(); return;
      case 'onlineGame': leaveOnline(); return;
      case 'signIn':
      case 'learn':
      case 'settings': goBackTo(screen.back)(); return;
      case 'challenge': setScreen({ name: 'challenges' }); return;
      default: setScreen({ name: 'menu' });
    }
  };

  useBackButton(goBack);

  // The same meaning for the web: the browser's Back button, and the back
  // swipe that goes with it, step one screen back instead of leaving the site.
  // Not on native, where the button above already has it and both would fire.
  useBrowserBack(!isNative() && screen.name !== 'menu', goBack);

  // Escape closes the panels that sit ON something else. It stops there on
  // purpose: Escape out of a game would be a keystroke away from a lost board.
  useEscapeKey(
    screen.name === 'settings' || screen.name === 'learn' || screen.name === 'signIn',
    goBack,
  );

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
          onProfile={openAccount}
          onStats={() => setScreen({ name: 'stats' })}
          onRecords={() => setScreen({ name: 'records' })}
        />
      )}

      {screen.name === 'online' && (
        <Online
          onStart={room => setScreen({ name: 'onlineGame', room })}
          onBack={() => setScreen({ name: 'menu' })}
          onToast={showToast}
          account={account}
          onSignIn={() => setScreen({ name: 'signIn', back: { name: 'online' } })}
          onSignOut={() => {
            clearSession();
            setAccount(null);
            showToast(t('signIn.signedOut'));
          }}
        />
      )}

      {screen.name === 'signIn' && (
        <SignIn
          onSignedIn={(session, isNew) => {
            setAccount(session);
            setScreen(screen.back);
            showToast(isNew || !session.user.name
              ? t('signIn.welcome')
              : t('signIn.welcomeBack', { name: session.user.name }));
          }}
          onBack={goBackTo(screen.back)}
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
          onPlay={level => startGame('ai', level)}
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
          onNext={screen.index + 1 < CHALLENGES.length
            ? () => setScreen({ name: 'challenge', index: screen.index + 1 })
            : undefined}
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
