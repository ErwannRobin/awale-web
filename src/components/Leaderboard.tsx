import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { useSettings } from '../lib/useSettings.ts';
import { countryFlag, UNKNOWN_COUNTRY } from '../lib/country.ts';
import { fetchLeaderboard, worldStatsEnabled, type LeaderboardPlayer } from '../lib/worldStats.ts';
import { countryLabel } from './countryLabel.ts';

interface Props {
  onBack: () => void;
  /** Open a player's public profile. */
  onPlayer: (userId: string) => void;
  /** The viewer's own country and account, to filter by and to highlight. */
  myCountry: string;
  myId: string | null;
}

type Scope = 'world' | 'country';

export default function Leaderboard({ onBack, onPlayer, myCountry, myId }: Props) {
  const t = useT();
  const { language } = useSettings();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  // "My country" only means something once the player has one.
  const hasCountry = myCountry !== UNKNOWN_COUNTRY;
  const [scope, setScope] = useState<Scope>('world');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!worldStatsEnabled()) {
      setError(t('leaderboard.notAvailable'));
      setLoading(false);
      return;
    }
    const data = await fetchLeaderboard();
    if (!data) {
      setError(t('leaderboard.error'));
    } else {
      setPlayers(data.players);
      setLastUpdated(new Date(data.updatedAt).toLocaleString());
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const shown = scope === 'country' ? players.filter(p => p.country === myCountry) : players;

  return (
    <div className="screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('leaderboard.title')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('leaderboard.title')}</h2>
        <p className="learn-lead">{t('leaderboard.lead')}</p>

        {hasCountry && (
          <div className="segmented tabs" role="radiogroup" aria-label={t('leaderboard.scope')}>
            {(['world', 'country'] as Scope[]).map(s => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                className={`seg ${scope === s ? 'seg-on' : ''}`}
                onClick={() => setScope(s)}
              >
                {s === 'world'
                  ? `🌍 ${t('leaderboard.world')}`
                  : `${countryFlag(myCountry)} ${countryLabel(myCountry, t, language)}`}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="empty-note">{t('leaderboard.loading')}</p>
        ) : error ? (
          <>
            <p className="empty-note">{error}</p>
            <button className="pill" onClick={() => { void load(); }}>
              <span className="pill-body"><span className="pill-title">{t('leaderboard.retry')}</span></span>
            </button>
          </>
        ) : shown.length === 0 ? (
          <p className="empty-note">{t('leaderboard.empty')}</p>
        ) : (
          <>
            <h3 className="set-head">{t('leaderboard.totalPlayers', { count: shown.length })}</h3>
            <div className="rec-list">
              {shown.map((player, i) => (
                <button
                  key={player.userId}
                  type="button"
                  className={`rec-row rec-row-btn ${player.userId === myId ? 'rec-row-me' : ''}`}
                  onClick={() => onPlayer(player.userId)}
                  aria-label={t('leaderboard.open', { name: player.name })}
                >
                  {/* In a country's view, the place within that country. */}
                  <span className="rec-rank">{scope === 'country' ? i + 1 : player.position}</span>
                  <span className="rec-flag" aria-hidden>{countryFlag(player.country)}</span>
                  <span className="rec-body">
                    <span className="rec-score">{player.name}</span>
                    <span className="rec-meta">
                      {t('leaderboard.games')}: {player.gamesPlayed} · {t('leaderboard.wins')}: {player.wins}
                    </span>
                  </span>
                  <span className="rec-delta">{player.rating}</span>
                </button>
              ))}
            </div>
            <p className="stat-sub" style={{ textAlign: 'center', marginTop: 10 }}>
              {t('leaderboard.updatedAt', { time: lastUpdated })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
