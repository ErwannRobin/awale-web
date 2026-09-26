import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { liveUrl } from '../lib/onlineConfig.ts';
import { parseLiveGames, type LiveGame } from '../lib/protocol.ts';
import { countryFlag } from '../lib/country.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { timeControlLabel } from './timeControl.ts';

interface Props {
  onWatch: (room: string) => void;
  onPlay: () => void;
  onBack: () => void;
}

/** Games come and go by the minute; this keeps the list honest while it is open. */
const REFRESH_MS = 10_000;

/**
 * Quick-match games being played right now, to pick one to watch.
 *
 * Friend games are never here — see `hello.listed` — so the screen says so,
 * rather than leaving someone wondering why their own game is missing.
 */
export default function LiveGames({ onWatch, onPlay, onBack }: Props) {
  const t = useT();
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch(liveUrl(), { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const rows = parseLiveGames(await response.json());
        if (live) { setGames(rows); setFailed(false); }
      } catch {
        if (live) setFailed(true);
      }
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => { live = false; clearInterval(id); };
  }, []);

  const tap = () => { playTap(); hapticTap(); };
  const name = (p: LiveGame['players'][number]) =>
    `${p.country ? `${countryFlag(p.country)} ` : ''}${p.name}`;

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
        <h1 className="title">{t('live.title')}</h1>
        <p className="tagline">{t('live.lead')}</p>
      </div>

      <div className="menu-actions">
        {games === null && !failed && <p className="wait-line">{t('live.loading')}</p>}
        {failed && games === null && <p className="wait-line">{t('live.error')}</p>}
        {games !== null && games.length === 0 && (
          <>
            <p className="wait-line">{t('live.empty')}</p>
            <button className="pill pill-green" onClick={() => { tap(); onPlay(); }}>
              <span className="pill-body">
                <span className="pill-title">{t('live.playOnline')}</span>
              </span>
            </button>
          </>
        )}
        {games?.map(game => (
          <button key={game.room} className="pill live-row" onClick={() => { tap(); onWatch(game.room); }}>
            <span className="pill-icon" aria-hidden>👁</span>
            <span className="pill-body">
              <span className="pill-title live-names">
                {name(game.players[0])} <span className="live-vs">{t('live.vs')}</span> {name(game.players[1])}
              </span>
              <span className="pill-sub">{timeControlLabel(t, game.control)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
