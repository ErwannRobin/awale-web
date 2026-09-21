import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey, Translate } from '../i18n/index.ts';
import { loadStats, rankFor, winRate, LEVEL_COUNT } from '../lib/stats.ts';
import { rankCountries, type CountryRow, type CountryTable } from '../lib/countryStats.ts';
import { countryFlag, countryName, UNKNOWN_COUNTRY } from '../lib/country.ts';
import { fetchCountryTable, worldStatsEnabled } from '../lib/worldStats.ts';
import { useSettings } from '../lib/useSettings.ts';
import { CHALLENGES } from '../lib/challenges.ts';

interface Props {
  completed: number[];
  onBack: () => void;
}

/** Enough of the world table to be a picture, not a directory. */
const WORLD_ROWS = 10;

/** "1×3 · 4×2": which difficulties those games were played at. */
const levelSplit = (byLevel: number[]): string =>
  byLevel.map((n, i) => (n > 0 ? `${i + 1}×${n}` : null)).filter(Boolean).join(' · ');

/** A country: flag, name, how its games split across the levels, and the total. */
function CountryRows({ rows, t, locale }: { rows: CountryRow[]; t: Translate; locale: string }) {
  return (
    <div className="level-table">
      {rows.map(row => (
        <div className="level-row" key={row.code}>
          <span className="level-badge level-badge-sm">{countryFlag(row.code)}</span>
          <span className="level-row-name">
            {row.code === UNKNOWN_COUNTRY
              ? t('stats.countryUnknown')
              : countryName(row.code, locale) || row.code}
          </span>
          <span className="level-row-detail">{levelSplit(row.byLevel)}</span>
          <span className="level-row-rate">{t('stats.countryRow', { games: row.games })}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function Stats({ completed, onBack }: Props) {
  const t = useT();
  const { language, shareStats } = useSettings();
  const stats = useMemo(() => loadStats(), []);
  const rank = rankFor(stats.rating);
  const levelName = (i: number) => t(`level.${i + 1}.name` as StringKey);

  const mine = useMemo(() => rankCountries(stats.byCountry), [stats.byCountry]);

  // The world table is somebody else's server, so the screen renders without
  // it and fills the section in if and when it answers. No spinner, no layout
  // that jumps: the section simply is not there until there is something in it.
  const [world, setWorld] = useState<CountryTable | null>(null);
  useEffect(() => {
    if (!worldStatsEnabled()) return;
    let live = true;
    void fetchCountryTable().then(table => { if (live) setWorld(table); });
    return () => { live = false; };
  }, []);

  return (
    <div className="screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('stats.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('stats.title')}</h2>
        <p className="learn-lead">{t('stats.lead')}</p>

        <div className="rank-card">
          <div className="rank-badge">{stats.rating}</div>
          <div className="rank-body">
            <div className="rank-name">{t(rank.tier.key as StringKey)}</div>
            <div className="rank-next">
              {rank.next
                ? t('stats.nextRank', {
                    points: Math.max(0, rank.next.min - stats.rating),
                    rank: t(rank.next.key as StringKey),
                  })
                : t('stats.maxRank')}
            </div>
            <div className="rank-track" aria-hidden>
              <div
                className="rank-fill"
                style={{
                  width: rank.next
                    ? `${Math.min(100, Math.max(0, ((stats.rating - rank.tier.min) / (rank.next.min - rank.tier.min)) * 100))}%`
                    : '100%',
                }}
              />
            </div>
            <div className="rank-peak">{t('stats.peak')} {stats.peakRating}</div>
          </div>
        </div>

        {stats.games === 0 ? (
          <p className="empty-note">{t('stats.empty')}</p>
        ) : (
          <>
            <div className="stat-grid">
              <Tile label={t('stats.played')} value={stats.games} />
              <Tile label={t('stats.winRate')} value={`${winRate(stats)}%`} />
              <Tile label={t('stats.won')} value={stats.wins} />
              <Tile label={t('stats.lost')} value={stats.losses} />
              <Tile label={t('stats.drawn')} value={stats.draws} />
              <Tile label={t('stats.streak')} value={stats.streak} sub={`${t('stats.bestStreak')} ${stats.bestStreak}`} />
              <Tile label={t('stats.seeds')} value={stats.seedsCaptured} />
              <Tile label={t('stats.bestMargin')} value={stats.bestMargin} />
            </div>

            <h3 className="set-head">{t('stats.byCountry')}</h3>
            <CountryRows rows={mine} t={t} locale={language} />

            <h3 className="set-head">{t('stats.byLevel')}</h3>
            <div className="level-table">
              {Array.from({ length: LEVEL_COUNT }, (_, i) => {
                const tally = stats.byLevel[i];
                return (
                  <div className="level-row" key={i}>
                    <span className="level-badge level-badge-sm">{i + 1}</span>
                    <span className="level-row-name">{levelName(i)}</span>
                    <span className="level-row-detail">
                      {tally.games === 0
                        ? t('stats.noneAtLevel')
                        : t('stats.levelRow', { wins: tally.wins, losses: tally.losses, draws: tally.draws })}
                    </span>
                    <span className="level-row-rate">{tally.games === 0 ? '—' : `${winRate(tally)}%`}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {world && (
          <>
            <h3 className="set-head">{t('stats.world')}</h3>
            <p className="set-help set-help-block">
              {t('stats.worldLead')}
              {!shareStats && ` ${t('stats.worldOff')}`}
            </p>
            {world.countries.length === 0 ? (
              <p className="empty-note">{t('stats.worldEmpty')}</p>
            ) : (
              <>
                <CountryRows rows={world.countries.slice(0, WORLD_ROWS)} t={t} locale={language} />
                <p className="set-help set-help-block">
                  {t('stats.worldTotal', { games: world.total })}
                </p>
              </>
            )}
          </>
        )}

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
      </div>
    </div>
  );
}
