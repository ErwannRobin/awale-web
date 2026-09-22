import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { onlineBaseUrl } from '../lib/onlineConfig.ts';

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
    <div className="screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('leaderboard.title')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('leaderboard.title')}</h2>
        <p className="learn-lead">{t('leaderboard.lead')}</p>

        {loading ? (
          <p className="empty-note">{t('leaderboard.loading')}</p>
        ) : error ? (
          <>
            <p className="empty-note">{error}</p>
            <button className="pill" onClick={fetchLeaderboard}>
              <span className="pill-body"><span className="pill-title">{t('leaderboard.retry')}</span></span>
            </button>
          </>
        ) : players.length === 0 ? (
          <p className="empty-note">{t('leaderboard.empty')}</p>
        ) : (
          <>
            <h3 className="set-head">{t('leaderboard.totalPlayers', { count: players.length })}</h3>
            <div className="rec-list">
              {players.map(player => (
                <div key={player.userId} className="rec-row">
                  <span className="rec-rank">{player.position}</span>
                  <span className="rec-body">
                    <span className="rec-score">{player.name}</span>
                    <span className="rec-meta">
                      {t('leaderboard.games')}: {player.gamesPlayed} · {t('leaderboard.wins')}: {player.wins}
                    </span>
                  </span>
                  <span className="rec-delta">{player.rating}</span>
                </div>
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
