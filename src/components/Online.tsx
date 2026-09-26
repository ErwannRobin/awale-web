import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import {
  makeRoomCode, normaliseRoomCode, CODE_LENGTH, TIME_CONTROL_IDS, type TimeControlId,
} from '../lib/protocol.ts';
import { queueUrl } from '../lib/onlineConfig.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { fetchNations, worldStatsEnabled, type NationsTable } from '../lib/worldStats.ts';
import { useSettings } from '../lib/useSettings.ts';
import { updateSettings } from '../lib/settings.ts';
import { timeControlShort } from './timeControl.ts';
import type { StringKey } from '../i18n/index.ts';
import { RivalCard } from './Rivalry.tsx';

interface Props {
  /** The player's country, for the rivalry nudge. */
  myCountry: string;
  /** The nations ranking, behind the nudge. */
  onNations: () => void;
  /** `control` is absent when joining by code: the room already has its clock. */
  onStart: (room: string, control?: TimeControlId) => void;
  onBack: () => void;
  onToast: (msg: string) => void;
}

/** How long to wait for the matchmaker before giving up and saying so. */
const QUEUE_TIMEOUT_MS = 8000;

export default function Online({ myCountry, onNations, onStart, onBack, onToast }: Props) {
  const t = useT();
  const { language, timeControl } = useSettings();

  // The moment a player chooses to play someone is the moment their nation's
  // standing is worth a line: who is just ahead, and by how much.
  const [nations, setNations] = useState<NationsTable | null>(null);
  useEffect(() => {
    if (!worldStatsEnabled()) return;
    let live = true;
    void fetchNations().then(v => { if (live) setNations(v); });
    return () => { live = false; };
  }, []);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);

  const tap = () => { playTap(); hapticTap(); };

  // A friend game needs no server round trip to start: the code *is* the room,
  // and the room comes into being when the first player connects to it.
  const createRoom = () => {
    tap();
    onStart(makeRoomCode(), timeControl);
  };

  // Remembered, because a player who likes blitz likes it next time too — and
  // quick match only ever pairs two people who asked for the same clock.
  const pickControl = (id: TimeControlId) => {
    tap();
    updateSettings({ timeControl: id });
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
      const response = await fetch(queueUrl(timeControl), { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { code?: unknown };
      const clean = typeof body.code === 'string' ? normaliseRoomCode(body.code) : null;
      if (!clean) throw new Error('bad reply');
      onStart(clean, timeControl);
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

      {nations && nations.nations.length > 0 && (
        <div className="rival-link">
          <RivalCard nations={nations.nations} myCountry={myCountry} t={t} locale={language} />
          <button type="button" className="ctrl" onClick={() => { tap(); onNations(); }}>
            {t('rival.seeNations')}
          </button>
        </div>
      )}

      {!joining ? (
        <div className="menu-actions">
          <div className="tc-picker" role="radiogroup" aria-label={t('online.timeControl')}>
            <span className="tc-picker-label" aria-hidden>⏱ {t('online.timeControl')}</span>
            <div className="tc-options">
              {TIME_CONTROL_IDS.map(id => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={timeControl === id}
                  className={`tc-option ${timeControl === id ? 'tc-option-on' : ''}`}
                  onClick={() => pickControl(id)}
                >
                  <span className="tc-option-name">{t(`tc.${id}` as StringKey)}</span>
                  {id !== 'none' && <span className="tc-option-time">{timeControlShort(id)}</span>}
                </button>
              ))}
            </div>
          </div>
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
