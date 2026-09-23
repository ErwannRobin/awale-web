import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { useSettings } from '../lib/useSettings.ts';
import { publicStats, type Stats } from '../lib/stats.ts';
import type { Profile } from '../lib/profile.ts';
import type { Session } from '../lib/auth.ts';
import { fetchPlayer, worldStatsEnabled, type PublicPlayer } from '../lib/worldStats.ts';
import { CHALLENGES } from '../lib/challenges.ts';
import { AiRecord, Nation, Tile } from './StatsParts.tsx';

interface Props {
  /** Whose profile; null means the player holding the phone. */
  userId: string | null;
  account: Session | null;
  /** This device's own profile and record, for when the profile is yours. */
  profile: Profile;
  stats: Stats;
  /** Challenges solved on this device; shown on your own profile only. */
  completed: number[];
  onBack: () => void;
  /** Only offered on your own profile. */
  onEdit: () => void;
}

const pct = (wins: number, games: number) => (games === 0 ? 0 : Math.round((wins / games) * 100));

/**
 * A player, as anybody may see them: who they are, where they play from, how
 * they do online against people, and how they do against the AI — the record
 * the Stats screen used to show, now one tap away from every leaderboard row.
 *
 * Your own profile is read from this device, which is always the most up to
 * date; the online half still comes from the server, which is where rated
 * games are decided. Anybody else's comes from the server entirely.
 */
export default function PlayerProfile({
  userId, account, profile, stats, completed, onBack, onEdit,
}: Props) {
  const t = useT();
  const { language } = useSettings();
  const self = userId === null || userId === account?.user.id;
  const serverId = self ? account?.user.id ?? null : userId;

  const [remote, setRemote] = useState<PublicPlayer | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(serverId ? 'loading' : 'ready');

  useEffect(() => {
    if (!serverId || !worldStatsEnabled()) { setState(serverId ? 'missing' : 'ready'); return; }
    let live = true;
    setState('loading');
    void fetchPlayer(serverId).then(p => {
      if (!live) return;
      setRemote(p);
      setState(p ? 'ready' : 'missing');
    });
    return () => { live = false; };
  }, [serverId]);

  const name = self
    ? (account?.user.name || profile.name || t('common.player'))
    : (remote?.name || t('common.player'));
  const avatar = self ? profile.avatar : remote?.avatar ?? 'clay';
  const country = self ? profile.country : remote?.country ?? 'ZZ';
  const ai = self ? publicStats(stats) : remote?.ai ?? null;
  const online = remote?.rating ?? null;

  return (
    <div className="screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('player.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <div className="player-head">
          <span className={`avatar avatar-${avatar}`} aria-hidden />
          <div className="player-id">
            <h2 className="learn-title player-name">{name}</h2>
            <div className="player-where">
              <Nation code={country} t={t} locale={language} />
              {remote?.position ? ` · #${remote.position}` : ''}
            </div>
          </div>
        </div>

        {self && (
          <button className="pill" onClick={onEdit}>
            <span className="pill-body"><span className="pill-title">{t('player.edit')}</span></span>
          </button>
        )}

        {state === 'loading' && <p className="empty-note">{t('leaderboard.loading')}</p>}
        {state === 'missing' && !self && <p className="empty-note">{t('player.missing')}</p>}

        <h3 className="set-head">{t('player.online')}</h3>
        {online ? (
          <div className="stat-grid">
            <Tile label={t('player.onlineRating')} value={online.rating} />
            <Tile label={t('stats.played')} value={online.gamesPlayed} />
            <Tile label={t('stats.winRate')} value={`${pct(online.wins, online.gamesPlayed)}%`} />
            <Tile
              label={t('stats.won')}
              value={online.wins}
              sub={t('stats.levelRow', { wins: online.wins, losses: online.losses, draws: online.draws })}
            />
          </div>
        ) : (
          <p className="set-help set-help-block">
            {self && !account ? t('player.onlineSignIn') : t('player.onlineNone')}
          </p>
        )}

        <h3 className="set-head">{t('player.ai')}</h3>
        {ai ? <AiRecord stats={ai} t={t} locale={language} /> : state !== 'loading' && (
          <p className="empty-note">{t('stats.empty')}</p>
        )}

        {self && (
          <>
            <h3 className="set-head">{t('stats.challenges')}</h3>
            <div className="level-table">
              <div className="level-row">
                <span className="level-badge level-badge-sm">🧩</span>
                <span className="level-row-name">{t('menu.challenges')}</span>
                <span className="level-row-detail">
                  {t('menu.challengesSub', { solved: completed.length, total: CHALLENGES.length })}
                </span>
                <span className="level-row-rate">
                  {Math.round((completed.length / CHALLENGES.length) * 100)}%
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
