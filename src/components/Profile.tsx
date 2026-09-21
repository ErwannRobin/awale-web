import { useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { StringKey } from '../i18n/index.ts';
import { loadProfile, saveProfile, AVATARS, NAME_MAX, type AvatarKey } from '../lib/profile.ts';
import { rankFor, type Stats } from '../lib/stats.ts';
import { authEnabled, type Session } from '../lib/auth.ts';
import { playTap, primeAudio } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';

interface Props {
  stats: Stats;
  /** The signed-in account, or null when playing anonymously. */
  account: Session | null;
  onBack: () => void;
  onProfileChange: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
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

/**
 * Who you are: the name and face other players see, and the account behind
 * them. Settings — the gear — is about how the game behaves, which is a
 * different question, so the two screens are separate. Signing in and out
 * lives here and nowhere else, because that is what an account is.
 */
export default function Profile({
  stats, account, onBack, onProfileChange, onSignIn, onSignOut,
}: Props) {
  const t = useT();
  const [profile, setProfile] = useState(loadProfile);
  const rank = rankFor(stats.rating);

  const feedback = () => { primeAudio(); playTap(); hapticTap(); };

  const commitProfile = (next: typeof profile) => {
    setProfile(next);
    saveProfile(next);
    onProfileChange();
  };

  return (
    <div className="screen settings-screen">
      <header className="game-top">
        <button className="round-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <div className="brand">◇ {t('profile.brand')} ◇</div>
        <span style={{ width: 44 }} />
      </header>

      <div className="panel-body">
        <h2 className="learn-title">{t('profile.title')}</h2>
        <p className="learn-lead">{t('profile.lead')}</p>

        <section className="set-section" aria-label={t('profile.sectionIdentity')}>
          <h3 className="set-head">{t('profile.sectionIdentity')}</h3>
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
          <Row label={t('profile.rank')}>
            <span className="set-value">★ {stats.rating} · {t(rank.tier.key as StringKey)}</span>
          </Row>
        </section>

        {/* Built with no server configured, there is no account to hold — so
            the section is absent rather than present and dead. */}
        {authEnabled() && (
          <section className="set-section" aria-label={t('profile.sectionAccount')}>
            <h3 className="set-head">{t('profile.sectionAccount')}</h3>
            {account ? (
              <>
                <div className="info-card info-card-static">
                  <span className="info-icon">✅</span>
                  <span className="account-line">
                    <span>
                      {t('signIn.signedIn')} ·{' '}
                      <strong className="account-name">
                        {account.user.name || t('common.player')}
                      </strong>
                    </span>
                  </span>
                </div>
                <div className="set-actions">
                  <button
                    className="ctrl ctrl-danger"
                    onClick={() => { feedback(); onSignOut(); }}
                  >
                    {t('signIn.signOut')}
                  </button>
                </div>
              </>
            ) : (
              <div className="set-actions">
                <button className="pill" onClick={() => { feedback(); onSignIn(); }}>
                  <span className="pill-icon">👤</span>
                  <span className="pill-body">
                    <span className="pill-title">{t('signIn.menu')}</span>
                    <span className="pill-sub">{t('signIn.menuSub')}</span>
                  </span>
                </button>
              </div>
            )}
          </section>
        )}

        <button className="pill pill-green learn-cta" onClick={onBack}>
          <span className="pill-body"><span className="pill-title">{t('common.done')}</span></span>
        </button>
      </div>
    </div>
  );
}
