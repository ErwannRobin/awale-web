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
import ProfileScreen from './components/Profile.tsx';
import SettingsScreen from './components/Settings.tsx';
import StatsScreen from './components/Stats.tsx';
import Records from './components/Records.tsx';
import Leaderboard from './components/Leaderboard.tsx';
import type { GameSetup } from './lib/useGame.ts';
import { loadCompleted, saveCompleted } from './lib/progress.ts';
import { loadProfile } from './lib/profile.ts';
import { clearSession, loadSession, refreshSession, type Session } from './lib/auth.ts';
import { loadStats } from './lib/stats.ts';
import { loadSavedGame, clearSavedGame, type SavedGame } from './lib/saveGame.ts';
import { useSettings } from './lib/useSettings.ts';
import { useScreenHistory } from './lib/useScreenHistory.ts';
import { useBackButton } from './lib/useBackButton.ts';
import { useEscapeKey } from './lib/useEscapeKey.ts';
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
  // The player chip on the menu: who you are, and the account behind you.
  | { name: 'profile' }
  // Sign-in is reached from the profile screen, so like Learn and Settings it
  // carries where to go back to.
  | { name: 'signIn'; back: Screen }
  | { name: 'onlineGame'; room: string }
  | { name: 'challenge'; index: number }
  | { name: 'leaderboard' }
  // Help and Settings are reachable mid-game, so they carry the screen to
  // return to. Without that, tapping ⚙ during a game would drop the board.
  | { name: 'learn'; back: Screen }
  | { name: 'settings'; back: Screen };

export default function App() {
  const settings = useSettings();
  const t = useT();

  /**
   * The screen stack lives in `window.history`, so the browser's Back — the
   * desktop arrow, the phone's back gesture, Safari's edge swipe — means "one
   * screen back" instead of "leave the game". `go` opens a screen, `back`
   * returns to the one under it, `replace` stands in for it.
   *
   * A restored `game` screen re-reads the save slot: the snapshot stored in the
   * history entry is from when the game started, and the board has moved on.
   * A save that is gone (the game ended) sends the player to the menu.
   */
  const nav = useScreenHistory<Screen>(
    // A `?join=CODE` link opens straight into that room. Landing on the menu
    // first and making the player find the code again would waste the link.
    () => {
      if (!onlineEnabled()) return { name: 'menu' };
      const code = readJoinCode();
      const room = code ? normaliseRoomCode(code) : null;
      return room ? { name: 'onlineGame', room } : { name: 'menu' };
    },
    useCallback((target: Screen): Screen => {
      if (target.name !== 'game') return target;
      const latest = loadSavedGame();
      return latest ? { ...target, resume: latest } : { name: 'menu' };
    }, []),
  );
  const screen = nav.screen;
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

  /**
   * The menu reads the save slot and the stats afresh every time it appears.
   *
   * Leaving a game through its own ← goes via `leaveGame`, which refreshes both
   * before the menu renders; a browser Back out of the board does not, and a
   * menu still offering to continue a game that has just ended would be a lie.
   * `clearJoinCode` for the same reason: whichever way the player walked out of
   * an online game, a reload must not walk back into it.
   */
  useEffect(() => {
    if (screen.name !== 'menu') return;
    refreshSaved();
    refreshStats();
    clearJoinCode();
  }, [screen.name, refreshSaved, refreshStats]);

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
    nav.go({ name: 'game', mode, level, key: ++gameKey.current, resume });
  };

  const leaveOnline = () => {
    // Drop the invite from the address bar on the way out, so a refresh does
    // not walk back into a game that has finished.
    clearJoinCode();
    nav.back({ name: 'menu' });
    void refreshReminder('left a game');
  };

  const leaveGame = () => {
    refreshSaved();
    refreshStats();
    nav.back({ name: 'menu' });
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
   * The ← on a screen that was opened over another one.
   *
   * It pops the history entry rather than pushing the screen it came from, so
   * the arrow and the browser's own Back do the one thing. The screen carried
   * in `back` is only needed when there is no entry to pop — a reload, or an
   * invite link that opened straight into a game.
   */
  const goBackTo = (target: Screen) => () => nav.back(target);

  /**
   * The player chip at the top of the menu: your name, your face, your
   * account. Settings — the gear beside it — is about how the game behaves,
   * which is a different question, so the two screens are separate.
   */
  const openProfile = () => nav.go({ name: 'profile' });

  /**
   * Android's back button, which the native shell hands to us instead of
   * letting the WebView act on it — and, through `useEscapeKey` below, the
   * Escape key. Both run the very same moves as the on-screen ←, so a screen
   * cannot mean one thing to a button and another to a gesture — and back
   * means "one screen back", not "quit", because quitting out of a game in
   * progress is exactly what store reviewers flag.
   *
   * Only the last screen standing exits, and only on Android; iOS has no such
   * button and forbids a programmatic exit anyway.
   */
  const goBack = () => {
    switch (screen.name) {
      // The menu is normally the bottom of the stack — but not after a game
      // that ended while it sat under a Settings screen, so ask, don't assume.
      case 'menu': if (nav.atRoot()) void exitApp(); else nav.back({ name: 'menu' }); return;
      case 'game': leaveGame(); return;
      case 'onlineGame': leaveOnline(); return;
      case 'signIn':
      case 'learn':
      case 'settings': goBackTo(screen.back)(); return;
      case 'challenge': nav.back({ name: 'challenges' }); return;
      default: nav.back({ name: 'menu' });
    }
  };

  useBackButton(goBack);

  // Escape closes the panels that sit ON something else, and stops there on
  // purpose: Escape out of a game would be a keystroke away from a lost board.
  // (The browser's own Back walks the whole stack — that is useScreenHistory.)
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
          onTutorial={() => nav.go({ name: 'tutorial' })}
          onChallenges={() => nav.go({ name: 'challenges' })}
          onOnline={() => nav.go({ name: 'online' })}
          onSettings={() => nav.go({ name: 'settings', back: { name: 'menu' } })}
          onProfile={openProfile}
          onStats={() => nav.go({ name: 'stats' })}
          onRecords={() => nav.go({ name: 'records' })}
          onLeaderboard={() => nav.go({ name: 'leaderboard' })}
        />
      )}

      {screen.name === 'online' && (
        <Online
          onStart={room => nav.go({ name: 'onlineGame', room })}
          onBack={() => nav.back({ name: 'menu' })}
          onToast={showToast}
        />
      )}

      {screen.name === 'profile' && (
        <ProfileScreen
          stats={stats}
          account={account}
          onBack={() => nav.back({ name: 'menu' })}
          onProfileChange={() => setProfile(loadProfile())}
          onSignIn={() => nav.go({ name: 'signIn', back: { name: 'profile' } })}
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
            nav.back(screen.back);
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
          onLearn={() => nav.go({ name: 'learn', back: screen })}
          onSettings={() => nav.go({ name: 'settings', back: screen })}
          onToast={showToast}
        />
      )}

      {screen.name === 'learn' && <Learn onBack={goBackTo(screen.back)} />}

      {screen.name === 'settings' && (
        <SettingsScreen
          onBack={goBackTo(screen.back)}
          onToast={showToast}
          onDataReset={() => {
            setCompleted(loadCompleted());
            refreshStats();
            refreshSaved();
            setProfile(loadProfile());
          }}
        />
      )}

      {screen.name === 'stats' && (
        <StatsScreen completed={completed} onBack={() => nav.back({ name: 'menu' })} />
      )}

      {screen.name === 'records' && <Records onBack={() => nav.back({ name: 'menu' })} />}

      {screen.name === 'leaderboard' && (
        <Leaderboard onBack={() => nav.back({ name: 'menu' })} />
      )}

      {screen.name === 'tutorial' && (
        <Tutorial
          onExit={() => nav.back({ name: 'menu' })}
          // The tutorial is finished by the time it offers this, so it steps
          // aside rather than stacking: Back from the puzzles means the menu.
          onChallenges={() => nav.replace({ name: 'challenges' })}
          onPlay={level => startGame('ai', level)}
        />
      )}

      {screen.name === 'challenges' && (
        <Challenges
          completed={completed}
          onStart={index => nav.go({ name: 'challenge', index })}
          onBack={() => nav.back({ name: 'menu' })}
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
          onLearn={() => nav.go({ name: 'learn', back: screen })}
          onSettings={() => nav.go({ name: 'settings', back: screen })}
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
          onExit={() => nav.back({ name: 'challenges' })}
          // "Next" walks along the list, it does not go deeper into it, so one
          // Back returns to the puzzles instead of replaying the solved ones.
          onNext={screen.index + 1 < CHALLENGES.length
            ? () => nav.replace({ name: 'challenge', index: screen.index + 1 })
            : undefined}
          onLearn={() => nav.go({ name: 'learn', back: screen })}
          onSettings={() => nav.go({ name: 'settings', back: screen })}
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
