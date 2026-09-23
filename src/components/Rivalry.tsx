// The nudge that turns a table of countries into a rivalry: which nation is
// directly in your own nation's way, by how much, and what it takes to pass it.
//
// Shown where the decision to play is made — the Stats screen, the Online
// screen — and again when a game between two countries ends, with the score
// between them that game just changed.
import type { Translate } from '../i18n/index.ts';
import { countryFlag, UNKNOWN_COUNTRY } from '../lib/country.ts';
import { findRival, type HeadToHead, type NationRow } from '../lib/countryStats.ts';
import { countryLabel } from './countryLabel.ts';

interface CardProps {
  nations: NationRow[];
  myCountry: string;
  t: Translate;
  locale: string;
  /** Where the card sends a player who wants to do something about it. */
  onPlay?: () => void;
  onPickCountry?: () => void;
}

export function RivalCard({ nations, myCountry, t, locale, onPlay, onPickCountry }: CardProps) {
  const name = (code: string) => `${countryFlag(code)} ${countryLabel(code, t, locale)}`;

  if (myCountry === UNKNOWN_COUNTRY) {
    return (
      <div className="rival-card">
        <div className="rival-title">{t('rival.title')}</div>
        <p className="rival-text">{t('rival.noCountry')}</p>
        {onPickCountry && (
          <button className="pill" onClick={onPickCountry}>
            <span className="pill-body"><span className="pill-title">{t('rival.pickCountry')}</span></span>
          </button>
        )}
      </div>
    );
  }

  const mine = nations.find(n => n.code === myCountry) ?? null;
  const rival = findRival(nations, myCountry);
  let text: string;
  if (!mine || mine.points === 0) {
    text = rival && rival.nation.code !== myCountry && rival.nation.points > 0
      ? t('rival.unrankedChase', { me: name(myCountry), rival: name(rival.nation.code), gap: rival.gap })
      : t('rival.unranked', { me: name(myCountry) });
  } else if (!rival) {
    text = t('rival.alone', { me: name(myCountry) });
  } else if (!rival.ahead) {
    text = t('rival.leading', { me: name(myCountry), rival: name(rival.nation.code), gap: rival.gap });
  } else if (rival.gap === 0) {
    text = t('rival.level', { me: name(myCountry), rival: name(rival.nation.code) });
  } else {
    text = t('rival.chasing', {
      me: name(myCountry), rival: name(rival.nation.code), gap: rival.gap,
      wins: Math.ceil((rival.gap + 1) / 3),
    });
  }

  return (
    <div className="rival-card">
      <div className="rival-title">
        {t('rival.title')}
        {mine && mine.points > 0 && <span className="rival-pos">#{mine.position}</span>}
      </div>
      <p className="rival-text">{text}</p>
      {onPlay && (
        <button className="pill pill-green" onClick={onPlay}>
          <span className="pill-body"><span className="pill-title">{t('rival.play')}</span></span>
        </button>
      )}
    </div>
  );
}

/** "🇫🇷 12 – 9 🇨🇮 · 2 draws", from one side's point of view. */
export function HeadToHeadLine({ row, from, t }: { row: HeadToHead; from?: string; t: Translate }) {
  const flip = from !== undefined && from === row.b;
  const [x, y] = flip ? [row.b, row.a] : [row.a, row.b];
  const [xs, ys] = flip ? [row.bWins, row.aWins] : [row.aWins, row.bWins];
  return (
    <span className="h2h">
      <span aria-hidden>{countryFlag(x)}</span>
      <strong>{` ${xs} – ${ys} `}</strong>
      <span aria-hidden>{countryFlag(y)}</span>
      {row.draws > 0 && <span className="h2h-draws">{` · ${t('rival.draws', { n: row.draws })}`}</span>}
    </span>
  );
}
