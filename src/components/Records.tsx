import { useMemo } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { useSettings } from '../lib/useSettings.ts';
import { loadStats, type GameRecord } from '../lib/stats.ts';

interface Props { onBack: () => void }

const OUTCOME_KEY = { win: 'records.win', loss: 'records.loss', draw: 'records.draw' } as const;

function formatDate(at: number, locale: string): string {
  try {
    return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function RecordRow({ r, rank, locale }: { r: GameRecord; rank?: number; locale: string }) {
  const t = useT();
  return (
    <div className={`rec-row rec-${r.outcome}`}>
      {rank !== undefined && <span className="rec-rank">{rank}</span>}
      <span className={`rec-badge rec-badge-${r.outcome}`}>{t(OUTCOME_KEY[r.outcome])}</span>
      <span className="rec-body">
        <span className="rec-score">{r.you} — {r.them}</span>
        <span className="rec-meta">
          {t('records.vs', { level: t(`level.${r.level + 1}.name` as StringKey) })} · {formatDate(r.at, locale)}
        </span>
      </span>
      <span className="rec-delta">
        {r.ratingAfter >= r.ratingBefore ? '+' : ''}{r.ratingAfter - r.ratingBefore}
      </span>
    </div>
  );
}

export default function Records({ onBack }: Props) {
  const t = useT();
  const stats = useMemo(() => loadStats(), []);
  const { language: locale } = useSettings();

  // "Best" = biggest winning margin, then the strongest level beaten.
  const best = useMemo(
    () => stats.history
      .filter(r => r.outcome === 'win')
      .sort((a, b) => (b.you - b.them) - (a.you - a.them) || b.level - a.level)
      .slice(0, 5),
    [stats.history],
  );

  return (
    <div className="screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('records.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('records.title')}</h2>
        <p className="learn-lead">{t('records.lead')}</p>

        {best.length === 0 ? (
          <p className="empty-note">{t('records.empty')}</p>
        ) : (
          <div className="rec-list">
            {best.map((r, i) => <RecordRow key={`${r.at}-${i}`} r={r} rank={i + 1} locale={locale} />)}
          </div>
        )}

        {stats.history.length > 0 && (
          <>
            <h3 className="set-head">{t('records.recent')}</h3>
            <div className="rec-list">
              {stats.history.slice(0, 15).map((r, i) => (
                <RecordRow key={`recent-${r.at}-${i}`} r={r} locale={locale} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
