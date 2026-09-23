import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { LEVEL_COUNT } from '../lib/stats.ts';
import { aiWinRate, emptyTally, rivalriesOf, type CountryTable, type CountryTally } from '../lib/countryStats.ts';
import { countryFlag, UNKNOWN_COUNTRY } from '../lib/country.ts';
import {
  fetchCountryTable, fetchNations, worldStatsEnabled, type NationsTable,
} from '../lib/worldStats.ts';
import { useSettings } from '../lib/useSettings.ts';
import { CountryRows, Tile } from './StatsParts.tsx';
import { countryLabel } from './countryLabel.ts';
import { HeadToHeadLine, RivalCard } from './Rivalry.tsx';

interface Props {
  /** The player's country, for the rivalry card and to highlight their row. */
  myCountry: string;
  onBack: () => void;
  onLeaderboard: () => void;
  /** Your own public profile — where your personal record lives now. */
  onMyProfile: () => void;
  onPlayer: (userId: string) => void;
  onPlayOnline: () => void;
  onPickCountry: () => void;
}

type Tab = 'ai' | 'pvp' | 'nations';

/** Enough of a table to be a picture, not a directory. */
const TOP_ROWS = 10;

/** Every country's AI games folded into one, for the worldwide numbers. */
function worldTally(table: CountryTable): CountryTally {
  const all = emptyTally();
  for (const c of table.countries) {
    all.games += c.games;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      all.byLevel[i] += c.byLevel[i];
      all.wins[i] += c.wins[i];
      all.losses[i] += c.losses[i];
      all.draws[i] += c.draws[i];
    }
  }
  return all;
}

/**
 * Everybody's games, worldwide: against the AI, and against each other, kept
 * apart because they measure different things — and the nations ranking that
 * turns the second into a rivalry. The player's own record moved to their
 * public profile, one tap away at the top.
 */
export default function Stats({
  myCountry, onBack, onLeaderboard, onMyProfile, onPlayer, onPlayOnline, onPickCountry,
}: Props) {
  const t = useT();
  const { language, shareStats } = useSettings();
  const [tab, setTab] = useState<Tab>('ai');
  const levelName = (i: number) => t(`level.${i + 1}.name` as StringKey);
  const enabled = worldStatsEnabled();

  // Somebody else's server, so the screen renders without it and fills in when
  // it answers. `undefined` is "still asking", `null` is "did not answer".
  const [table, setTable] = useState<CountryTable | null | undefined>(undefined);
  const [nations, setNations] = useState<NationsTable | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchCountryTable().then(v => { if (live) setTable(v); });
    void fetchNations().then(v => { if (live) setNations(v); });
    return () => { live = false; };
  }, [enabled]);

  const world = useMemo(() => (table ? worldTally(table) : null), [table]);
  const pvpRows = useMemo(
    () => (table ? table.countries
      .filter(c => c.pvp.games > 0 && c.code !== UNKNOWN_COUNTRY)
      .sort((a, b) => b.pvp.games - a.pvp.games) : []),
    [table],
  );
  const mine = useMemo(
    () => (nations ? rivalriesOf(nations.rivalries, myCountry) : []),
    [nations, myCountry],
  );
  const name = (code: string) => `${countryFlag(code)} ${countryLabel(code, t, language)}`;

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
        <div className="stats-links">
          <button className="pill" onClick={onMyProfile}>
            <span className="pill-body"><span className="pill-title">{t('stats.myProfile')}</span></span>
          </button>
          <button className="pill" onClick={onLeaderboard}>
            <span className="pill-body"><span className="pill-title">{t('stats.viewLeaderboard')}</span></span>
          </button>
        </div>

        {!enabled ? (
          <p className="empty-note">{t('stats.offline')}</p>
        ) : (
          <>
            {nations && (
              <RivalCard
                nations={nations.nations}
                myCountry={myCountry}
                t={t}
                locale={language}
                onPlay={onPlayOnline}
                onPickCountry={onPickCountry}
              />
            )}

            <div className="segmented tabs" role="tablist" aria-label={t('stats.title')}>
              {(['ai', 'pvp', 'nations'] as Tab[]).map(k => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  className={`seg ${tab === k ? 'seg-on' : ''}`}
                  onClick={() => setTab(k)}
                >
                  {t(`stats.tab.${k}` as StringKey)}
                </button>
              ))}
            </div>

            {table === undefined && <p className="empty-note">{t('leaderboard.loading')}</p>}
            {table === null && <p className="empty-note">{t('leaderboard.error')}</p>}

            {tab === 'ai' && table && world && (
              <section aria-label={t('stats.tab.ai')}>
                <p className="set-help set-help-block">
                  {t('stats.aiLead')}
                  {!shareStats && ` ${t('stats.worldOff')}`}
                </p>
                <div className="stat-grid">
                  <Tile label={t('stats.aiGames')} value={table.total} />
                  <Tile label={t('stats.humanWinRate')} value={`${aiWinRate(world)}%`} />
                  <Tile label={t('stats.countries')} value={table.countries.filter(c => c.games > 0).length} />
                </div>

                <h3 className="set-head">{t('stats.byLevel')}</h3>
                <div className="level-table">
                  {Array.from({ length: LEVEL_COUNT }, (_, i) => (
                    <div className="level-row" key={i}>
                      <span className="level-badge level-badge-sm">{i + 1}</span>
                      <span className="level-row-name">{levelName(i)}</span>
                      <span className="level-row-detail">
                        {t('stats.countryRow', { games: world.byLevel[i] })}
                      </span>
                      <span className="level-row-rate">
                        {world.byLevel[i] === 0 ? '—' : `${aiWinRate(world, i)}%`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="set-help set-help-block">{t('stats.levelRateHelp')}</p>

                <h3 className="set-head">{t('stats.world')}</h3>
                {table.countries.length === 0 ? (
                  <p className="empty-note">{t('stats.worldEmpty')}</p>
                ) : (
                  <CountryRows
                    rows={table.countries.filter(c => c.games > 0).slice(0, TOP_ROWS)}
                    t={t}
                    locale={language}
                    showRate
                  />
                )}
              </section>
            )}

            {tab === 'pvp' && table && (
              <section aria-label={t('stats.tab.pvp')}>
                <p className="set-help set-help-block">{t('stats.pvpLead')}</p>
                <div className="stat-grid">
                  <Tile label={t('stats.pvpGames')} value={table.pvpTotal} />
                  <Tile label={t('stats.rivalries')} value={table.rivalries.length} />
                  <Tile label={t('stats.countries')} value={pvpRows.length} />
                </div>

                <h3 className="set-head">{t('stats.pvpByCountry')}</h3>
                {pvpRows.length === 0 ? (
                  <p className="empty-note">{t('stats.pvpEmpty')}</p>
                ) : (
                  <div className="level-table">
                    {pvpRows.slice(0, TOP_ROWS).map(c => (
                      <div className={`level-row ${c.code === myCountry ? 'level-row-me' : ''}`} key={c.code}>
                        <span className="level-badge level-badge-sm">{countryFlag(c.code)}</span>
                        <span className="level-row-name">{countryLabel(c.code, t, language)}</span>
                        <span className="level-row-detail">
                          {t('stats.pvpRow', {
                            wins: c.pvp.wins, losses: c.pvp.losses, draws: c.pvp.draws, internal: c.pvp.internal,
                          })}
                        </span>
                        <span className="level-row-rate">{t('stats.countryRow', { games: c.pvp.games })}</span>
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="set-head">{t('stats.topRivalries')}</h3>
                {table.rivalries.length === 0 ? (
                  <p className="empty-note">{t('stats.rivalriesEmpty')}</p>
                ) : (
                  <div className="level-table">
                    {table.rivalries.slice(0, TOP_ROWS).map(r => (
                      <div className="level-row" key={`${r.a}-${r.b}`}>
                        <span className="level-row-name">
                          {`${countryLabel(r.a, t, language)} – ${countryLabel(r.b, t, language)}`}
                        </span>
                        <span className="level-row-detail" />
                        <span className="level-row-rate"><HeadToHeadLine row={r} t={t} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === 'nations' && nations === undefined && (
              <p className="empty-note">{t('leaderboard.loading')}</p>
            )}
            {tab === 'nations' && nations && (
              <section aria-label={t('stats.tab.nations')}>
                <p className="set-help set-help-block">{t('stats.nationsLead')}</p>
                {nations.nations.length === 0 ? (
                  <p className="empty-note">{t('stats.nationsEmpty')}</p>
                ) : (
                  <div className="rec-list">
                    {nations.nations.slice(0, 20).map(n => {
                      const top = n.topPlayer;
                      const body = (
                        <>
                          <span className="rec-rank">{n.position}</span>
                          <span className="rec-flag" aria-hidden>{countryFlag(n.code)}</span>
                          <span className="rec-body">
                            <span className="rec-score">{countryLabel(n.code, t, language)}</span>
                            <span className="rec-meta">
                              {t('stats.nationMeta', {
                                wins: n.pvp.wins, players: n.players, rating: n.avgRating || '—',
                              })}
                              {top ? ` · ${t('stats.nationBest', { name: top.name })}` : ''}
                            </span>
                          </span>
                          <span className="rec-delta">{t('stats.points', { points: n.points })}</span>
                        </>
                      );
                      const cls = `rec-row ${n.code === myCountry ? 'rec-row-me' : ''}`;
                      // A nation's row opens its best player: a country is a
                      // flag, a person is somebody to go and beat.
                      return top ? (
                        <button
                          key={n.code}
                          type="button"
                          className={`${cls} rec-row-btn`}
                          onClick={() => onPlayer(top.userId)}
                        >
                          {body}
                        </button>
                      ) : (
                        <div key={n.code} className={cls}>{body}</div>
                      );
                    })}
                  </div>
                )}

                {myCountry !== UNKNOWN_COUNTRY && (
                  <>
                    <h3 className="set-head">{t('stats.myRivalries', { country: name(myCountry) })}</h3>
                    {mine.length === 0 ? (
                      <p className="empty-note">{t('stats.rivalriesEmpty')}</p>
                    ) : (
                      <div className="level-table">
                        {mine.map(r => (
                          <div className="level-row" key={r.opponent}>
                            <span className="level-badge level-badge-sm">{countryFlag(r.opponent)}</span>
                            <span className="level-row-name">{countryLabel(r.opponent, t, language)}</span>
                            <span className="level-row-detail">
                              {t('stats.levelRow', { wins: r.wins, losses: r.losses, draws: r.draws })}
                            </span>
                            <span className="level-row-rate">
                              {r.wins > r.losses ? '▲' : r.wins < r.losses ? '▼' : '='}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
