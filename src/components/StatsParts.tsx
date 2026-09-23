// Pieces the record screens share: the public profile shows one player's
// record, the Stats screen shows everybody's, and both are built from these.
import type { StringKey, Translate } from '../i18n/index.ts';
import { rankFor, winRate, LEVEL_COUNT, type PublicStats } from '../lib/stats.ts';
import { aiWinRate, rankCountries, type CountryRow } from '../lib/countryStats.ts';
import { countryFlag } from '../lib/country.ts';
import { countryLabel } from './countryLabel.ts';

/** "1×3 · 4×2": which difficulties those games were played at. */
const levelSplit = (byLevel: number[]): string =>
  byLevel.map((n, i) => (n > 0 ? `${i + 1}×${n}` : null)).filter(Boolean).join(' · ');

/** Flag and name, inline. */
export function Nation({ code, t, locale }: { code: string; t: Translate; locale: string }) {
  return <>{`${countryFlag(code)} ${countryLabel(code, t, locale)}`}</>;
}

export function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/**
 * A country per row: flag, name, how its AI games split across the levels,
 * and either the count or — when outcomes are known — the win rate.
 */
export function CountryRows({ rows, t, locale, showRate = false }: {
  rows: CountryRow[]; t: Translate; locale: string; showRate?: boolean;
}) {
  return (
    <div className="level-table">
      {rows.map(row => (
        <div className="level-row" key={row.code}>
          <span className="level-badge level-badge-sm">{countryFlag(row.code)}</span>
          <span className="level-row-name">{countryLabel(row.code, t, locale)}</span>
          <span className="level-row-detail">{levelSplit(row.byLevel)}</span>
          <span className="level-row-rate">
            {showRate
              ? t('stats.countryRowRate', { games: row.games, rate: aiWinRate(row) })
              : t('stats.countryRow', { games: row.games })}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The rating card: the number, the tier, the way to the next one. */
export function RankCard({ rating, peak, t }: { rating: number; peak: number; t: Translate }) {
  const rank = rankFor(rating);
  return (
    <div className="rank-card">
      <div className="rank-badge">{rating}</div>
      <div className="rank-body">
        <div className="rank-name">{t(rank.tier.key as StringKey)}</div>
        <div className="rank-next">
          {rank.next
            ? t('stats.nextRank', {
                points: Math.max(0, rank.next.min - rating),
                rank: t(rank.next.key as StringKey),
              })
            : t('stats.maxRank')}
        </div>
        <div className="rank-track" aria-hidden>
          <div
            className="rank-fill"
            style={{
              width: rank.next
                ? `${Math.min(100, Math.max(0, ((rating - rank.tier.min) / (rank.next.min - rank.tier.min)) * 100))}%`
                : '100%',
            }}
          />
        </div>
        <div className="rank-peak">{t('stats.peak')} {peak}</div>
      </div>
    </div>
  );
}

/**
 * One player's record against the AI — what the Stats screen used to be, and
 * now the heart of a public profile. The same view for your own record (read
 * from this device) and anybody else's (read from the server).
 */
export function AiRecord({ stats, t, locale }: { stats: PublicStats; t: Translate; locale: string }) {
  const levelName = (i: number) => t(`level.${i + 1}.name` as StringKey);
  const countries = rankCountries(stats.byCountry);
  return (
    <>
      <RankCard rating={stats.rating} peak={stats.peakRating} t={t} />
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

          {countries.length > 0 && (
            <>
              <h3 className="set-head">{t('stats.byCountry')}</h3>
              <CountryRows rows={countries} t={t} locale={locale} />
            </>
          )}
        </>
      )}
    </>
  );
}
