import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Menu from './components/Menu.tsx';
import Learn from './components/Learn.tsx';
import Tutorial from './components/Tutorial.tsx';
import Challenges from './components/Challenges.tsx';
import { CHALLENGES, DAILY_POOL, challengeGoalKey } from './lib/challenges.ts';
import {
  currentStreak, dailyFor, dayKey, loadDaily, msUntilNext, recordAttempt, saveDaily, tryMarks,
  type DailyProgress,
} from './lib/daily.ts';
import Game from './components/Game.tsx';
import Online from './components/Online.tsx';
import OnlineGame from './components/OnlineGame.tsx';
import SignIn from './components/SignIn.tsx';
import ProfileScreen from './components/Profile.tsx';
import SettingsScreen from './components/Settings.tsx';
import StatsScreen from './components/Stats.tsx';
import Records from './components/Records.tsx';
import Leaderboard from './components/Leaderboard.tsx';
import PlayerProfile from './components/PlayerProfile.tsx';
import type { GameSetup } from './lib/useGame.ts';
import { loadCompleted, saveCompleted } from './lib/progress.ts';
import { applyDetectedCountry, loadProfile } from './lib/profile.ts';
import { clearSession, loadSession, refreshSession, syncProfile, type Session } from './lib/auth.ts';
import { loadStats } from './lib/stats.ts';
import { loadSavedGame, clearSavedGame, type SavedGame } from './lib/saveGame.ts';
import { useSettings } from './lib/useSettings.ts';
import { useScreenHistory } from './lib/useScreenHistory.ts';
import { useBackButton } from './lib/useBackButton.ts';
import { useEscapeKey } from './lib/useEscapeKey.ts';
import { exitApp } from './lib/native.ts';
import { refreshReminder } from './lib/notifications.ts';
import { clearJoinCode, onlineEnabled, readJoinCode, readJoinControl } from './lib/onlineConfig.ts';
import { detectCountry } from './lib/worldStats.ts';
import { normaliseRoomCode, type TimeControlId } from './lib/protocol.ts';
import { useT } from './i18n/useT.ts';
import { isRtl, type StringKey } from './i18n/index.ts';
import { formatWait } from './lib/format.ts';

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
  // `tc` is the clock this player asked for; absent when joining by code.
  | { name: 'onlineGame'; room: string; tc?: TimeControlId }
  | { name: 'challenge'; index: number }
  // The day is carried, so a puzzle opened before midnight is still that
  // day's puzzle after it — and Back/Forward bring back the same board.
  | { name: 'daily'; day: string }
  | { name: 'leaderboard' }
  // A player's public profile; `userId` null is your own.
  | { name: 'player'; userId: string | null }
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
      return room ? { name: 'onlineGame', room, tc: readJoinControl() } : { name: 'menu' };
    },
    useCallback((target: Screen): Screen => {
      if (target.name !== 'game') return target;
      const latest = loadSavedGame();
      return latest ? { ...target, resume: latest } : { name: 'menu' };
    }, []),
  );
  const screen = nav.screen;
  const [completed, setCompleted] = useState<number[]>(() => loadCompleted());
  const [daily, setDaily] = useState<DailyProgress>(loadDaily);
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
    root.setAttribute('dir', isRtl(settings.language) ? 'rtl' : 'ltr');

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
    void refreshSession(stored).then(async next => {
      if (!next) { if (live) setAccount(next); return; }
      // Catches an account that signed in before this sync existed, or whose
      // first sign-in raced a network hiccup — and keeps the account's country
      // and avatar in step with this device's once per launch.
      next = await pushProfile(next);
      if (live) setAccount(next);
    });
    return () => { live = false; };
  }, []);

  // Where the player is, worked out once per launch from the request's own IP
  // at the edge — see lib/worldStats.ts. A player who has picked a country
  // keeps it: `applyDetectedCountry` leaves a manual choice alone, so this
  // effect is a no-op for them rather than a fight they lose every launch.
  useEffect(() => {
    let live = true;
    void detectCountry().then(code => {
      if (!live || !code) return;
      // Read the stored profile rather than the state: this lands after a
      // paint, and `applyDetectedCountry` writes, which a state updater must not.
      setProfile(applyDetectedCountry(loadProfile(), code));
    });
    return () => { live = false; };
  }, []);

  // A signed-in player's country and avatar follow the local profile: the
  // leaderboard, the nations ranking and the public profile all read them from
  // the account. Keyed on the values, so a launch or an unrelated re-render
  // sends nothing.
  const accountId = account?.user.id ?? null;
  const synced = useRef<string>('');
  useEffect(() => {
    const session = loadSession();
    if (!accountId || !session) return;
    const key = `${accountId}|${profile.country}|${profile.avatar}`;
    if (synced.current === '' ) { synced.current = key; return; }
    if (synced.current === key) return;
    synced.current = key;
    void syncProfile(session, { country: profile.country, avatar: profile.avatar })
      .then(setAccount)
      .catch(() => { /* offline: the next launch syncs again */ });
  }, [accountId, profile.country, profile.avatar]);

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
    setDaily(loadDaily());
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

  // The daily puzzle on screen, if any, built once per day it is opened for.
  const dailyDay = screen.name === 'daily' ? screen.day : null;
  const dailyPuzzle = useMemo(() => (dailyDay ? dailyFor(dailyDay, DAILY_POOL) : null), [dailyDay]);
  const dailySetup = useMemo<GameSetup | null>(() => {
    if (!dailyPuzzle) return null;
    const day = dailyPuzzle.day;
    return {
      pits: dailyPuzzle.pits,
      scores: dailyPuzzle.scores,
      humanPlayer: 1,
      firstPlayer: 1,
      // Every finished game is an attempt; the first win banks the day.
      onResult: won => {
        const next = recordAttempt(loadDaily(), day, won);
        saveDaily(next);
        setDaily(next);
      },
    };
  }, [dailyPuzzle]);

  const dailyGoal = (): string => {
    if (!dailyPuzzle) return '';
    const [them, you] = dailyPuzzle.scores;
    const score = you > them ? t('daily.scoreAhead', { you, them })
      : you < them ? t('daily.scoreBehind', { you, them })
        : t('daily.scoreLevel', { you });
    return t('daily.goal', {
      score,
      level: t(`level.${dailyPuzzle.level + 1}.name` as StringKey),
      moves: dailyPuzzle.moves,
    });
  };

  const shareDaily = async () => {
    if (!dailyPuzzle) return;
    const tries = daily.solved[dailyPuzzle.day] ?? 1;
    const streak = currentStreak(daily, dayKey(new Date()));
    const lines = [
      `${t('daily.shareTitle', { n: dailyPuzzle.number })} ${tryMarks(tries)}`,
      tries === 1 ? t('daily.firstTry') : t('daily.inTries', { n: tries }),
      ...(streak > 1 ? [`🔥 ${t('daily.streakDays', { n: streak })}`] : []),
    ];
    const url = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
      ? `${location.origin}${location.pathname}`
      : '';
    const text = lines.join('\n');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text, ...(url ? { url } : {}) });
        return;
      }
      await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
      showToast(t('daily.copied'));
    } catch (error) {
      // Dismissing the share sheet is a choice, not a failure worth a toast.
      if ((error as { name?: string })?.name === 'AbortError') return;
      showToast(t('online.copyFailed'));
    }
  };

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
   * Hand the account everything this device knows about the player: the
   * name (when the account has none), the country, the avatar, and — taken
   * only by an account with no record yet — the record played here before
   * signing in. Never fails a sign-in: on any trouble the session is kept.
   */
  const pushProfile = async (session: Session): Promise<Session> => {
    const local = loadProfile();
    const record = loadStats();
    try {
      return await syncProfile(session, {
        ...(!session.user.name && local.name ? { name: local.name } : {}),
        country: local.country,
        avatar: local.avatar,
        ...(record.games > 0 ? { ai: record } : {}),
      });
    } catch {
      return session;
    }
  };

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
      case 'daily': nav.back({ name: 'menu' }); return;
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
          daily={daily}
          onDaily={() => nav.go({ name: 'daily', day: dayKey(new Date()) })}
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
          myCountry={profile.country}
          onNations={() => nav.go({ name: 'stats' })}
          onStart={(room, tc) => nav.go({ name: 'onlineGame', room, tc })}
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
          onAccountChange={setAccount}
          onViewPublic={() => nav.go({ name: 'player', userId: null })}
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
          onSignedIn={async (session, isNew) => {
            // A brand-new account has no name of its own; if the player
            // already picked one locally before ever signing in, carry it
            // over rather than leaving the account nameless everywhere that
            // reads it — the leaderboard included.
            const signedIn = await pushProfile(session);
            setAccount(signedIn);
            nav.back(screen.back);
            showToast(isNew || !signedIn.user.name
              ? t('signIn.welcome')
              : t('signIn.welcomeBack', { name: signedIn.user.name }));
          }}
          onBack={goBackTo(screen.back)}
          onToast={showToast}
        />
      )}

      {screen.name === 'onlineGame' && (
        <OnlineGame
          key={screen.room}
          room={screen.room}
          control={screen.tc}
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
        <StatsScreen
          myCountry={profile.country}
          onBack={() => nav.back({ name: 'menu' })}
          onLeaderboard={() => nav.go({ name: 'leaderboard' })}
          onMyProfile={() => nav.go({ name: 'player', userId: null })}
          onPlayer={userId => nav.go({ name: 'player', userId })}
          onPlayOnline={() => nav.go({ name: 'online' })}
          onPickCountry={openProfile}
        />
      )}

      {screen.name === 'player' && (
        <PlayerProfile
          key={screen.userId ?? 'me'}
          userId={screen.userId}
          account={account}
          profile={profile}
          stats={stats}
          completed={completed}
          onBack={() => nav.back({ name: 'menu' })}
          onEdit={openProfile}
        />
      )}

      {screen.name === 'records' && (
        <Records
          onBack={() => nav.back({ name: 'menu' })}
          onLeaderboard={() => nav.go({ name: 'leaderboard' })}
        />
      )}

      {screen.name === 'leaderboard' && (
        <Leaderboard
          onBack={() => nav.back({ name: 'menu' })}
          onPlayer={userId => nav.go({ name: 'player', userId })}
          myCountry={profile.country}
          myId={account?.user.id ?? null}
        />
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

      {screen.name === 'daily' && dailyPuzzle && dailySetup && (
        <Game
          key={`daily-${dailyPuzzle.day}`}
          mode="ai"
          level={dailyPuzzle.level}
          setup={dailySetup}
          goal={dailyGoal()}
          title={t('daily.title', { n: dailyPuzzle.number })}
          oppName={t(`level.${dailyPuzzle.level + 1}.name` as StringKey)}
          winText={t('daily.solved')}
          onShare={() => void shareDaily()}
          exitLabel={t('game.backToMenu')}
          assists={false}
          overExtra={daily.solved[dailyPuzzle.day] !== undefined && (
            <p className="over-note">
              {daily.solved[dailyPuzzle.day] === 1
                ? t('daily.firstTry')
                : t('daily.inTries', { n: daily.solved[dailyPuzzle.day] })}
              {' · 🔥 '}{t('daily.streakDays', { n: currentStreak(daily, dailyPuzzle.day) })}
              <br />
              {t('daily.nextIn', { time: formatWait(msUntilNext(new Date())) })}
            </p>
          )}
          onExit={() => nav.back({ name: 'menu' })}
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
