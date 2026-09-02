import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';

interface Props { onBack: () => void }

const RULES = [1, 2, 3, 4, 5];

export default function Learn({ onBack }: Props) {
  const t = useT();
  return (
    <div className="screen learn">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ AWALÉ ◇</div>
        <span style={{ width: 44 }} />
      </header>
      <div className="learn-body">
        <h2 className="learn-title">{t('learn.title')}</h2>
        <p className="learn-lead">{t('learn.lead')}</p>
        {RULES.map(n => (
          <div className="rule-block" key={n}>
            <div className="rule-num">{n}</div>
            <div>
              <h3>{t(`learn.${n}.h` as StringKey)}</h3>
              <p>{t(`learn.${n}.b` as StringKey)}</p>
            </div>
          </div>
        ))}
        <button className="pill pill-green learn-cta" onClick={onBack}>
          <span className="pill-body"><span className="pill-title">{t('learn.gotIt')}</span></span>
        </button>
      </div>
    </div>
  );
}
