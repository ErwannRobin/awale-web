import { useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { LANGUAGES } from '../i18n/index.ts';
import { useSettings } from '../lib/useSettings.ts';
import { updateSettings, type SpeedName, type ThemeName } from '../lib/settings.ts';
import { resetStats } from '../lib/stats.ts';
import { saveCompleted } from '../lib/progress.ts';
import { clearSavedGame } from '../lib/saveGame.ts';
import { loadProfile, saveProfile, AVATARS, NAME_MAX, type AvatarKey } from '../lib/profile.ts';
import { playTap, primeAudio } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';

interface Props {
  onBack: () => void;
  onToast: (msg: string) => void;
  onProfileChange: () => void;
  onDataReset: () => void;
}

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {help && <span className="set-help">{help}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'toggle-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg ${value === o.value ? 'seg-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings({ onBack, onToast, onProfileChange, onDataReset }: Props) {
  const t = useT();
  const s = useSettings();
  const [profile, setProfile] = useState(loadProfile);

  // Every control makes a sound, so unlock the audio context on the first one.
  const feedback = () => { primeAudio(); playTap(); hapticTap(); };
  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => {
    updateSettings({ [key]: value } as Partial<typeof s>);
    feedback();
  };

  const commitProfile = (next: typeof profile) => {
    setProfile(next);
    saveProfile(next);
    onProfileChange();
  };

  const confirmReset = (run: () => void) => {
    if (!window.confirm(t('settings.confirmReset'))) return;
    run();
    onDataReset();
    onToast(t('settings.resetDone'));
  };

  return (
    <div className="screen settings-screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('settings.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('settings.title')}</h2>
        <p className="learn-lead">{t('settings.lead')}</p>

        <section className="set-section" aria-label={t('profile.title')}>
          <h3 className="set-head">{t('profile.title')}</h3>
          <Row label={t('profile.name')}>
            <input
              className="text-input"
              value={profile.name}
              maxLength={NAME_MAX}
              placeholder={t('profile.namePlaceholder')}
              onChange={e => commitProfile({ ...profile, name: e.target.value })}
              aria-label={t('profile.name')}
            />
          </Row>
          <Row label={t('profile.avatar')}>
            <div className="avatar-picker" role="radiogroup" aria-label={t('profile.avatar')}>
              {AVATARS.map(a => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={profile.avatar === a}
                  aria-label={a}
                  className={`avatar avatar-pick avatar-${a} ${profile.avatar === a ? 'avatar-on' : ''}`}
                  onClick={() => { commitProfile({ ...profile, avatar: a as AvatarKey }); feedback(); }}
                />
              ))}
            </div>
          </Row>
        </section>

        <section className="set-section" aria-label={t('settings.sectionFeel')}>
          <h3 className="set-head">{t('settings.sectionFeel')}</h3>
          <Row label={t('settings.sound')} help={t('settings.soundHelp')}>
            <Toggle on={s.sound} label={t('settings.sound')} onChange={v => {
              updateSettings({ sound: v });
              if (v) { primeAudio(); playTap(); }
              hapticTap();
            }} />
          </Row>
          <Row label={t('settings.haptics')} help={t('settings.hapticsHelp')}>
            <Toggle on={s.haptics} label={t('settings.haptics')} onChange={v => {
              updateSettings({ haptics: v });
              if (v) hapticTap();
              playTap();
            }} />
          </Row>
          <Row label={t('settings.speed')} help={t('settings.speedHelp')}>
            <Choice<SpeedName>
              label={t('settings.speed')}
              value={s.speed}
              onChange={v => set('speed', v)}
              options={[
                { value: 'slow', label: t('settings.speedSlow') },
                { value: 'normal', label: t('settings.speedNormal') },
                { value: 'fast', label: t('settings.speedFast') },
                { value: 'instant', label: t('settings.speedInstant') },
              ]}
            />
          </Row>
        </section>

        <section className="set-section" aria-label={t('settings.sectionBoard')}>
          <h3 className="set-head">{t('settings.sectionBoard')}</h3>
          <Row label={t('settings.theme')}>
            <Choice<ThemeName>
              label={t('settings.theme')}
              value={s.theme}
              onChange={v => set('theme', v)}
              options={[
                { value: 'wood', label: t('settings.themeWood') },
                { value: 'night', label: t('settings.themeNight') },
                { value: 'sand', label: t('settings.themeSand') },
              ]}
            />
          </Row>
          <Row label={t('settings.counts')} help={t('settings.countsHelp')}>
            <Toggle on={s.showCounts} label={t('settings.counts')} onChange={v => set('showCounts', v)} />
          </Row>
          <Row label={t('settings.leftHanded')} help={t('settings.leftHandedHelp')}>
            <Toggle on={s.leftHanded} label={t('settings.leftHanded')} onChange={v => set('leftHanded', v)} />
          </Row>
        </section>

        <section className="set-section" aria-label={t('settings.language')}>
          <h3 className="set-head">{t('settings.language')}</h3>
          <Row label={t('settings.language')}>
            <Choice
              label={t('settings.language')}
              value={s.language}
              onChange={v => set('language', v)}
              options={LANGUAGES.map(l => ({ value: l.code, label: l.label }))}
            />
          </Row>
        </section>

        <section className="set-section" aria-label={t('settings.sectionData')}>
          <h3 className="set-head">{t('settings.sectionData')}</h3>
          <p className="set-help set-help-block">{t('settings.noAccount')}</p>
          <div className="set-actions">
            <button className="ctrl" onClick={() => confirmReset(() => resetStats())}>
              {t('settings.resetStats')}
            </button>
            <button className="ctrl" onClick={() => confirmReset(() => saveCompleted([]))}>
              {t('settings.resetProgress')}
            </button>
            <button className="ctrl ctrl-danger" onClick={() => confirmReset(() => {
              resetStats();
              saveCompleted([]);
              clearSavedGame();
              saveProfile({ name: '', avatar: 'clay' });
              setProfile({ name: '', avatar: 'clay' });
            })}>
              {t('settings.resetAll')}
            </button>
          </div>
        </section>

        <button className="pill pill-green learn-cta" onClick={onBack}>
          <span className="pill-body"><span className="pill-title">{t('common.done')}</span></span>
        </button>
      </div>
    </div>
  );
}
