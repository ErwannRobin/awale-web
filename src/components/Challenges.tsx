import { isUnlocked } from '../lib/progress.ts';
import { useT } from '../i18n/useT.ts';
import { CHALLENGES, challengeGoalKey } from '../lib/challenges.ts';

interface Props {
  completed: number[];
  onStart: (index: number) => void;
  onBack: () => void;
}

export default function Challenges({ completed, onStart, onBack }: Props) {
  const t = useT();
  return (
    <div className="screen challenges">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('challenges.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="challenges-body">
        <h2 className="learn-title">{t('challenges.title')}</h2>
        <p className="learn-lead">
          {t('challenges.lead', { solved: completed.length, total: CHALLENGES.length })}
        </p>

        <div className="challenge-list">
          {CHALLENGES.map((ch, i) => {
            const unlocked = isUnlocked(i, completed);
            const done = completed.includes(i);
            return (
              <button
                key={i}
                className={`challenge-item ${unlocked ? '' : 'locked'} ${done ? 'done' : ''}`}
                disabled={!unlocked}
                onClick={() => unlocked && onStart(i)}
              >
                <span className="challenge-num">{done ? '✓' : unlocked ? i + 1 : '🔒'}</span>
                <span className="challenge-text">
                  <span className="challenge-head">
                    {t('challenges.item', { n: i + 1 })}
                    {ch.levelIA != null && (
                      <span className="challenge-tag">{t('challenges.levelTag', { n: ch.levelIA + 1 })}</span>
                    )}
                  </span>
                  <span className="challenge-goal">
                    {unlocked ? t(challengeGoalKey(i)) : t('challenges.locked')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
