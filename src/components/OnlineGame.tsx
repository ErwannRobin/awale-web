import { useEffect, useMemo, useRef, useState } from 'react';
import Game from './Game.tsx';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { useOnlineSession } from '../lib/useOnlineSession.ts';
import { playerToken, shareLink } from '../lib/onlineConfig.ts';
import { loadProfile } from '../lib/profile.ts';
import { loadSession } from '../lib/auth.ts';
import type { GameSetup } from '../lib/useGame.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { countryFlag, UNKNOWN_COUNTRY } from '../lib/country.ts';
import { rivalryKey, type HeadToHead } from '../lib/countryStats.ts';
import { fetchRivalry } from '../lib/worldStats.ts';
import { HeadToHeadLine } from './Rivalry.tsx';
import { timeControlLabel } from './timeControl.ts';
import type { TimeControlId } from '../lib/protocol.ts';

interface Props {
  room: string;
  /** The clock this player asked for; the room keeps the first one it hears. */
  control?: TimeControlId;
  /** Here to watch, not to play. */
  watch?: boolean;
  /** Ask for a place in the public live list (quick match). */
  listed?: boolean;
  /** A full room offers to be watched instead; this takes the player there. */
  onWatch?: (room: string) => void;
  onExit: () => void;
  onLearn: () => void;
  onSettings: () => void;
  onToast: (msg: string) => void;
}

/**
 * How long after the game ends to ask for the head-to-head. The room tells both
 * players the result first and counts it for the nations after, so asking at
 * once would show the score from before this game.
 */
const RIVALRY_DELAY_MS = 2500;

/** Errors worth explaining rather than showing as a code. */
const ERROR_KEYS: Partial<Record<string, StringKey>> = {
  'room-full': 'online.errFull',
  'bad-version': 'online.errVersion',
};

export default function OnlineGame({
  room, control, watch = false, listed = false, onWatch, onExit, onLearn, onSettings, onToast,
}: Props) {
  const t = useT();
  const profile = useMemo(loadProfile, []);
  const token = useMemo(playerToken, []);
  // Signed in, the account is who you are at the table: its name is the one the
  // opponent sees, and its token is what proves the seat. Signed out, nothing
  // here changes — the anonymous browser token still holds the seat.
  const account = useMemo(loadSession, []);
  const [copied, setCopied] = useState(false);

  const online = useOnlineSession({
    room,
    name: account?.user.name || profile.name,
    token,
    auth: account?.token,
    country: profile.country === UNKNOWN_COUNTRY ? undefined : profile.country,
    control,
    watch,
    listed,
  });
  const { snapshot, seat, connection, error } = online.view;
  // What the room actually plays at, once it has said; until then, what we asked.
  const roomControl: TimeControlId = snapshot?.clock?.control ?? control ?? 'none';

  // Two countries at one board: the game is also a round of their rivalry.
  const mine = seat === null ? undefined : snapshot?.players[seat]?.country;
  const theirs = seat === null ? undefined : snapshot?.players[1 - seat]?.country;
  const pair = rivalryKey(mine, theirs);
  const over = snapshot?.status === 'over';
  const [rivalry, setRivalry] = useState<HeadToHead | null>(null);
  useEffect(() => {
    if (!over || !pair || !mine || !theirs) { setRivalry(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      void fetchRivalry(mine, theirs).then(row => { if (live) setRivalry(row); });
    }, RIVALRY_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [over, pair, mine, theirs]);

  // The board is built once, from the position at the moment both players are
  // in. After that the match drives it: a rematch or a reconnect arrives as a
  // reset, not as a remount, so the screen never flickers mid-game.
  const setupRef = useRef<GameSetup | null>(null);
  // A spectator sits on South's side of the board.
  const sitAs: 0 | 1 | null = watch ? (online.view.watching ? 0 : null) : seat;
  if (!setupRef.current && snapshot && sitAs !== null && snapshot.status !== 'waiting') {
    setupRef.current = {
      pits: [...snapshot.pits],
      scores: [snapshot.scores[0], snapshot.scores[1]],
      humanPlayer: sitAs,
      firstPlayer: snapshot.turn,
    };
  }
  const labelOf = (s: 0 | 1) => {
    const p = snapshot?.players[s];
    return `${p?.country ? `${countryFlag(p.country)} ` : ''}${p?.name || t('online.opponent')}`;
  };

  const copyLink = async () => {
    playTap(); hapticTap();
    const link = shareLink(room, roomControl);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied often enough (insecure origin, an old
      // WebView, a permission prompt) that the code has to stay readable
      // on screen as the fallback. It already is, right above this button.
      onToast(t('online.copyFailed'));
    }
  };

  if (setupRef.current && watch) {
    return (
      <Game
        mode="online"
        level={0}
        setup={setupRef.current}
        online={online}
        spectating
        title={t('watch.title')}
        youName={labelOf(0)}
        oppName={labelOf(1)}
        onExit={onExit}
        onLearn={onLearn}
        onSettings={onSettings}
        onToast={onToast}
      />
    );
  }

  if (setupRef.current) {
    return (
      <Game
        mode="online"
        level={0}
        setup={setupRef.current}
        online={online}
        oppName={`${theirs ? `${countryFlag(theirs)} ` : ''}${snapshot?.players[1 - (seat ?? 0)]?.name || t('online.opponent')}`}
        overExtra={rivalry && mine && (
          <p className="over-rating over-rivalry">
            {t('rival.overLine')} <HeadToHeadLine row={rivalry} from={mine} t={t} />
          </p>
        )}
        onExit={onExit}
        onLearn={onLearn}
        onSettings={onSettings}
        onToast={onToast}
      />
    );
  }

  const fatal = error ? ERROR_KEYS[error] : undefined;

  return (
    <div className="screen menu">
      <div className="menu-top">
        <button className="back-link" onClick={() => { playTap(); onExit(); }}>
          ← {t('common.back')}
        </button>
      </div>

      <div className="menu-hero">
        <div className="hero-ornament">
          <span className="diamond" aria-hidden>◇</span>
          <span className="rule" />
          <span className="diamond" aria-hidden>◇</span>
        </div>
        <h1 className="title">{t('online.title')}</h1>
      </div>

      <div className="wait-card" role="status" aria-live="polite">
        {fatal ? (
          <>
            <p className="wait-line">{t(fatal)}</p>
            {error === 'room-full' && onWatch && (
              <button className="pill pill-green" onClick={() => { playTap(); onWatch(room); }}>
                <span className="pill-body">
                  <span className="pill-title">👁 {t('watch.instead')}</span>
                </span>
              </button>
            )}
            <button className="pill" onClick={() => { playTap(); onExit(); }}>
              <span className="pill-body">
                <span className="pill-title">{t('game.backToMenu')}</span>
              </span>
            </button>
          </>
        ) : (
          <>
            <p className="wait-label">{t('online.roomCode')}</p>
            <p className="room-code">{room}</p>
            <p className="wait-label">{t('online.roomClock', { tc: timeControlLabel(t, roomControl) })}</p>
            <p className="wait-line">
              {connection !== 'online' ? t('online.connecting')
                : watch ? t('watch.waitingPlayers') : t('online.waiting')}
            </p>
            <div className="wait-dots" aria-hidden>
              <span /><span /><span />
            </div>
            {!watch && (
              <>
                <p className="wait-hint">{t('online.shareHint')}</p>
                <button className="ctrl" onClick={() => void copyLink()}>
                  {copied ? `✓ ${t('online.copied')}` : `🔗 ${t('online.copyLink')}`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
