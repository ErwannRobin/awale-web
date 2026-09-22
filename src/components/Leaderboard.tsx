import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { onlineBaseUrl } from '../lib/onlineConfig.ts';
import { BackIcon } from './Icons.tsx';

interface LeaderboardPlayer {
  userId: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  position: number;
}

interface LeaderboardResponse {
  players: LeaderboardPlayer[];
  total: number;
  updatedAt: number;
}

interface Props {
  onBack: () => void;
}

export default function Leaderboard({ onBack }: Props) {
  const t = useT();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      setError(null);

      const base = onlineBaseUrl();
      if (!base) {
        setError(t('leaderboard.notAvailable') as string);
        setLoading(false);
        return;
      }

      const response = await fetch(`${base}/leaderboard`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as LeaderboardResponse;
      setPlayers(data.players);
      setLastUpdated(new Date(data.updatedAt).toLocaleString());
      
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leaderboard.error') as string);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  return (
    <div className="screen leaderboard">
      <div className="leaderboard-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back') as StringKey}>
          <BackIcon />
        </button>
        <h1>{t('leaderboard.title')}</h1>
        <div className="header-spacer" />
      </div>

      {loading ? (
        <div className="leaderboard-loading">
          <div className="spinner" />
          <p>{t('leaderboard.loading')}</p>
        </div>
      ) : error ? (
        <div className="leaderboard-error">
          <p>{error}</p>
          <button className="pill" onClick={fetchLeaderboard}>
            {t('leaderboard.retry')}
          </button>
        </div>
      ) : (
        <div className="leaderboard-content">
          <div className="leaderboard-stats">
            <span>{t('leaderboard.totalPlayers', { count: players.length })}</span>
            <span className="leaderboard-updated">
              {t('leaderboard.updatedAt', { time: lastUpdated })}
            </span>
          </div>

          <div className="leaderboard-list">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th className="rank">{t('leaderboard.rank')}</th>
                  <th className="name">{t('leaderboard.name')}</th>
                  <th className="rating">{t('leaderboard.rating')}</th>
                  <th className="games">{t('leaderboard.games')}</th>
                  <th className="wins">{t('leaderboard.wins')}</th>
                </tr>
              </thead>
              <tbody>
                {players.map(player => (
                  <tr key={player.userId} className="leaderboard-row">
                    <td className="rank">{player.position}</td>
                    <td className="name">{player.name}</td>
                    <td className="rating">
                      <span className="rating-value">{player.rating}</span>
                    </td>
                    <td className="games">{player.gamesPlayed}</td>
                    <td className="wins">
                      <span className="win-rate">
                        {player.wins}/{player.gamesPlayed}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
