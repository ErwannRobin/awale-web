import { useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import type { Profile } from '../lib/profile.ts';
import { rankFor, suggestedLevel, type Stats } from '../lib/stats.ts';
import type { SavedGame } from '../lib/saveGame.ts';
import { primeAudio, playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { CHALLENGES, DAILY_POOL } from '../lib/challenges.ts';
import { currentStreak, dailyFor, dayKey, msUntilNext, type DailyProgress } from '../lib/daily.ts';
import { formatWait } from '../lib/format.ts';
import { onlineEnabled } from '../lib/onlineConfig.ts';
import {
  BoltIcon, BotIcon, CalendarIcon, CapIcon, ChartIcon, GearIcon,
  GlobeIcon, PlayIcon, TargetIcon, TrophyIcon, UsersIcon,
} from './Icons.tsx';

interface Props {
  profile: Profile;
  stats: Stats;
  completed: number[];
  saved: SavedGame | null;
  daily: DailyProgress;
  onDaily: () => void;
  onPlayAI: (level: number) => void;
  onPlayLocal: () => void;
  onQuickMatch: (level: number) => void;
  onContinue: () => void;
  onOnline: () => void;
  onTutorial: () => void;
  onChallenges: () => void;
  onSettings: () => void;
  /** The player chip — the way in to an account. */
  onProfile: () => void;
  onStats: () => void;
  onRecords: () => void;
  onLeaderboard: () => void;
}

function Diamond() {
  return <span className="diamond" aria-hidden>◇</span>;
}

export default function Menu({
  profile, stats, completed, saved, daily, onDaily,
  onPlayAI, onPlayLocal, onQuickMatch, onContinue, onOnline,
  onTutorial, onChallenges, onSettings, onProfile, onStats, onRecords, onLeaderboard,
}: Props) {
  const t = useT();
  const [pickAI, setPickAI] = useState(false);
  const rank = rankFor(stats.rating);
  const quickLevel = suggestedLevel(stats.rating);
  const levelName = (i: number) => t(`level.${i + 1}.name` as StringKey);

  // Today's puzzle, and whether it is already done. Read at render: the menu
  // is drawn afresh every time it is shown, which is often enough for a date.
  const now = new Date();
  const today = dailyFor(dayKey(now), DAILY_POOL);
  const solvedToday = daily.solved[today.day] !== undefined;
  const streak = currentStreak(daily, today.day);
  const dailySub = solvedToday
    ? t('daily.menuSolved', { time: formatWait(msUntilNext(now)) })
    : t('daily.menuSub', { n: today.number, tier: t(`daily.tier.${today.tier}` as StringKey) });

  // The menu is the first thing a player touches, so unlock audio here.
  const tap = () => { primeAudio(); playTap(); hapticTap(); };
  const go = (fn: () => void) => () => { tap(); fn(); };

  return (
    <div className="screen menu">
      <div className="menu-top">
        <button className="chip chip-avatar" onClick={go(onProfile)} aria-label={t('profile.title')}>
          <span className={`avatar avatar-${profile.avatar}`} aria-hidden />
          <span className="chip-body">
            <span className="chip-name">{profile.name || t('common.player')}</span>
            <span className="chip-rating">★ {stats.rating} · {t(rank.tier.key as StringKey)}</span>
          </span>
        </button>
        <div className="menu-top-right">
          <button className="icon-btn" onClick={go(onLeaderboard)} aria-label={t('menu.leaderboard')}>
            <GlobeIcon />
          </button>
          <button className="icon-btn" onClick={go(onRecords)} aria-label={t('menu.records')}>
            <TrophyIcon />
          </button>
          <button className="icon-btn" onClick={go(onStats)} aria-label={t('menu.stats')}>
            <ChartIcon />
          </button>
          <button className="icon-btn" onClick={go(onSettings)} aria-label={t('common.settings')}>
            <GearIcon />
          </button>
        </div>
      </div>

      <div className="menu-hero">
        <div className="hero-ornament"><Diamond /><span className="rule" /><Diamond /></div>
        <h1 className="title">AWALÉ</h1>
        <p className="tagline">{t('menu.tagline')}</p>
      </div>

      {!pickAI ? (
        <div className="menu-actions">
          {saved && (
            <button className="pill pill-green" onClick={go(onContinue)}>
              <span className="pill-icon"><PlayIcon /></span>
              <span className="pill-body">
                <span className="pill-title">{t('menu.continue')}</span>
                <span className="pill-sub">
                  {t('menu.continueSub', {
                    opponent: saved.mode === 'local' ? t('menu.twoPlayers') : levelName(saved.level),
                  })}
                </span>
              </span>
            </button>
          )}
          <button className={saved ? 'pill' : 'pill pill-green'} onClick={go(() => onQuickMatch(quickLevel))}>
            <span className="pill-icon"><BoltIcon /></span>
            <span className="pill-body">
              <span className="pill-title">{t('menu.quickMatch')}</span>
              <span className="pill-sub">{t('menu.quickMatchSub', { level: levelName(quickLevel) })}</span>
            </span>
          </button>
          <button className={`pill ${solvedToday ? 'pill-done' : ''}`} onClick={go(onDaily)}>
            <span className="pill-icon"><CalendarIcon /></span>
            <span className="pill-body">
              <span className="pill-title">{t('daily.menuTitle')}</span>
              <span className="pill-sub">
                {dailySub}{streak > 0 ? ` · 🔥 ${streak}` : ''}
              </span>
            </span>
          </button>
          {/* Built with no server configured, this build has no online play,
              and a menu entry that leads to an error is worse than no entry. */}
          {onlineEnabled() && (
            <button className="pill" onClick={go(onOnline)}>
              <span className="pill-icon"><GlobeIcon /></span>
              <span className="pill-body">
                <span className="pill-title">{t('menu.online')}</span>
                <span className="pill-sub">{t('menu.onlineSub')}</span>
              </span>
            </button>
          )}
          <button className="pill" onClick={go(onPlayLocal)}>
            <span className="pill-icon"><UsersIcon /></span>
            <span className="pill-body">
              <span className="pill-title">{t('menu.twoPlayers')}</span>
              <span className="pill-sub">{t('menu.twoPlayersSub')}</span>
            </span>
          </button>
          <button className="pill" onClick={go(() => setPickAI(true))}>
            <span className="pill-icon"><BotIcon /></span>
            <span className="pill-body">
              <span className="pill-title">{t('menu.vsAI')}</span>
              <span className="pill-sub">{t('menu.vsAISub')}</span>
            </span>
          </button>
          <button className="pill" onClick={go(onChallenges)}>
            <span className="pill-icon"><TargetIcon /></span>
            <span className="pill-body">
              {/* The menu shouts its titles; the screen it opens does not, so
                  the capitals are CSS rather than a second translation. */}
              <span className="pill-title pill-title-caps">{t('menu.challenges')}</span>
              <span className="pill-sub">
                {t('menu.challengesSub', { solved: completed.length, total: CHALLENGES.length })}
              </span>
            </span>
          </button>
          <button className="pill" onClick={go(onTutorial)}>
            <span className="pill-icon"><CapIcon /></span>
            <span className="pill-body">
              <span className="pill-title">{t('menu.learn')}</span>
              <span className="pill-sub">{t('menu.learnSub')}</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="menu-actions">
          <div className="level-head">
            <button className="back-link" onClick={go(() => setPickAI(false))}>← {t('common.back')}</button>
            <span>{t('menu.chooseDifficulty')}</span>
          </div>
          {[0, 1, 2, 3].map(i => (
            <button key={i} className="pill pill-level" onClick={go(() => onPlayAI(i))}>
              <span className="level-badge">{i + 1}</span>
              <span className="pill-body">
                <span className="pill-title">{levelName(i)}</span>
                <span className="pill-sub">{t(`level.${i + 1}.desc` as StringKey)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
