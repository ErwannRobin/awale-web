import { useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { makeRoomCode, normaliseRoomCode, CODE_LENGTH } from '../lib/protocol.ts';
import { queueUrl } from '../lib/onlineConfig.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';

interface Props {
  onStart: (room: string) => void;
  onBack: () => void;
  onToast: (msg: string) => void;
}

/** How long to wait for the matchmaker before giving up and saying so. */
const QUEUE_TIMEOUT_MS = 8000;

export default function Online({ onStart, onBack, onToast }: Props) {
  const t = useT();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);

  const tap = () => { playTap(); hapticTap(); };

  // A friend game needs no server round trip to start: the code *is* the room,
  // and the room comes into being when the first player connects to it.
  const createRoom = () => {
    tap();
    onStart(makeRoomCode());
  };

  const submitCode = () => {
    tap();
    const clean = normaliseRoomCode(code);
    if (!clean) { onToast(t('online.badCode')); return; }
    onStart(clean);
  };

  const quickMatch = async () => {
    tap();
    setSearching(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), QUEUE_TIMEOUT_MS);
      const response = await fetch(queueUrl(), { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { code?: unknown };
      const clean = typeof body.code === 'string' ? normaliseRoomCode(body.code) : null;
      if (!clean) throw new Error('bad reply');
      onStart(clean);
    } catch {
      // The matchmaker is the only part of online play that needs plain HTTP,
      // so this is also the first place a misconfigured URL shows up.
      onToast(t('online.queueFailed'));
      setSearching(false);
    }
  };

  return (
    <div className="screen menu">
      <div className="menu-top">
        <button className="back-link" onClick={() => { tap(); onBack(); }}>
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
        <p className="tagline">{t('online.tagline')}</p>
      </div>

      {!joining ? (
        <div className="menu-actions">
          <button className="pill pill-green" onClick={() => void quickMatch()} disabled={searching}>
            <span className="pill-icon">🌍</span>
            <span className="pill-body">
              <span className="pill-title">
                {searching ? t('online.searching') : t('online.quickMatch')}
              </span>
              <span className="pill-sub">{t('online.quickMatchSub')}</span>
            </span>
          </button>
          <button className="pill" onClick={createRoom}>
            <span className="pill-icon">🔗</span>
            <span className="pill-body">
              <span className="pill-title">{t('online.invite')}</span>
              <span className="pill-sub">{t('online.inviteSub')}</span>
            </span>
          </button>
          <button className="pill" onClick={() => { tap(); setJoining(true); }}>
            <span className="pill-icon">⌨️</span>
            <span className="pill-body">
              <span className="pill-title">{t('online.join')}</span>
              <span className="pill-sub">{t('online.joinSub')}</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="menu-actions">
          <div className="level-head">
            <button className="back-link" onClick={() => { tap(); setJoining(false); }}>
              ← {t('common.back')}
            </button>
            <span>{t('online.enterCode')}</span>
          </div>
          <form
            className="code-form"
            onSubmit={event => { event.preventDefault(); submitCode(); }}
          >
            <input
              className="code-input"
              value={code}
              onChange={event => setCode(event.target.value.toUpperCase())}
              maxLength={CODE_LENGTH + 2}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label={t('online.enterCode')}
              placeholder={'—'.repeat(CODE_LENGTH)}
            />
            <button className="pill pill-green" type="submit">
              <span className="pill-body">
                <span className="pill-title">{t('online.joinAction')}</span>
              </span>
            </button>
          </form>
        </div>
      )}

      <div className="menu-cards">
        <div className="info-card info-card-static">
          <span className="info-icon">ℹ️</span>
          <span>
            <strong>{t('online.unratedTitle')}</strong><br />
            <span className="muted">{t('online.unratedBody')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
