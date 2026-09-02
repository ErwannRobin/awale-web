import { useMemo, useRef, useState } from 'react';
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

interface Props {
  room: string;
  onExit: () => void;
  onLearn: () => void;
  onSettings: () => void;
  onToast: (msg: string) => void;
}

/** Errors worth explaining rather than showing as a code. */
const ERROR_KEYS: Partial<Record<string, StringKey>> = {
  'room-full': 'online.errFull',
  'bad-version': 'online.errVersion',
};

export default function OnlineGame({ room, onExit, onLearn, onSettings, onToast }: Props) {
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
  });
  const { snapshot, seat, connection, error } = online.view;

  // The board is built once, from the position at the moment both players are
  // in. After that the match drives it: a rematch or a reconnect arrives as a
  // reset, not as a remount, so the screen never flickers mid-game.
  const setupRef = useRef<GameSetup | null>(null);
  if (!setupRef.current && snapshot && seat !== null && snapshot.status !== 'waiting') {
    setupRef.current = {
      pits: [...snapshot.pits],
      scores: [snapshot.scores[0], snapshot.scores[1]],
      humanPlayer: seat,
      firstPlayer: snapshot.turn,
    };
  }

  const copyLink = async () => {
    playTap(); hapticTap();
    const link = shareLink(room);
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

  if (setupRef.current) {
    return (
      <Game
        mode="online"
        level={0}
        setup={setupRef.current}
        online={online}
        oppName={snapshot?.players[1 - (seat ?? 0)]?.name || t('online.opponent')}
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
            <p className="wait-line">
              {connection === 'online' ? t('online.waiting') : t('online.connecting')}
            </p>
            <div className="wait-dots" aria-hidden>
              <span /><span /><span />
            </div>
            <p className="wait-hint">{t('online.shareHint')}</p>
            <button className="ctrl" onClick={() => void copyLink()}>
              {copied ? `✓ ${t('online.copied')}` : `🔗 ${t('online.copyLink')}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
