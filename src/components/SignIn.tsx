import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import {
  VERIFY_ORIGIN, saveSession, startSignIn, waitForSignIn,
  type Session, type StartedSignIn,
} from '../lib/auth.ts';
import { playTap } from '../lib/sound.ts';
import { hapticTap } from '../lib/haptics.ts';
import { isNative } from '../lib/platform.ts';

interface Props {
  onSignedIn: (session: Session, isNew: boolean) => void;
  onBack: () => void;
  onToast: (msg: string) => void;
}

type Phase = 'starting' | 'waiting' | 'done';

/**
 * Signing in with a phone number, by way of WhatsApp.
 *
 * Two routes to the same place, because one of them is not always available:
 * a browser gets phone-verif's page in a frame, and a native WebView — where a
 * third-party frame is blocked as often as not — gets a button that opens
 * WhatsApp itself. Both end with the same question asked of our own server: is
 * this session verified yet?
 *
 * The frame's `postMessage` is a *hint*, never proof. It means "ask again now"
 * and nothing more; the answer that counts comes from the Worker, which asked
 * phone-verif with a key this page has never seen.
 */
export default function SignIn({ onSignedIn, onBack, onToast }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('starting');
  const [started, setStarted] = useState<StartedSignIn | null>(null);
  const nudge = useRef<(() => void) | null>(null);

  const tap = () => { playTap(); hapticTap(); };
  const embedded = !isNative();

  const back = useCallback(() => { tap(); onBack(); }, [onBack]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const fail = (key: 'signIn.unavailable' | 'signIn.expired' | 'signIn.failed') => {
      if (cancelled) return;
      setPhase('done');
      onToast(t(key));
      onBack();
    };

    void (async () => {
      let session: StartedSignIn;
      try {
        session = await startSignIn(controller.signal);
      } catch {
        // No API key deployed, or the service is down. Either way the game
        // still works; the player simply stays anonymous.
        fail('signIn.unavailable');
        return;
      }
      if (cancelled) return;
      setStarted(session);
      setPhase('waiting');

      try {
        const reply = await waitForSignIn({
          sessionId: session.sessionId,
          signal: controller.signal,
          onReady: wake => { nudge.current = wake; },
        });
        if (cancelled) return;
        if (reply.status === 'verified' && reply.session) {
          const saved = saveSession({ token: reply.session.token, user: reply.session.user });
          setPhase('done');
          onSignedIn(saved, reply.session.user.isNew);
          return;
        }
        fail(reply.status === 'expired' ? 'signIn.expired' : 'signIn.failed');
      } catch (error) {
        // An abort is this screen being left, not a failure worth a message.
        if (cancelled || (error as Error).name === 'AbortError') return;
        fail('signIn.unavailable');
      }
    })();

    return () => { cancelled = true; nudge.current = null; controller.abort(); };
  }, [onBack, onSignedIn, onToast, t]);

  // The frame saying it is done. Origin-checked, and believed only far enough
  // to skip the rest of the polling interval.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== VERIFY_ORIGIN) return;
      const data = event.data as { type?: unknown } | null;
      if (data?.type === 'verification_complete') nudge.current?.();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="screen menu">
      <div className="menu-top">
        <button className="back-link" onClick={back}>← {t('common.back')}</button>
      </div>

      <div className="menu-hero">
        <div className="hero-ornament">
          <span className="diamond" aria-hidden>◇</span>
          <span className="rule" />
          <span className="diamond" aria-hidden>◇</span>
        </div>
        <h1 className="title">{t('signIn.title')}</h1>
        <p className="tagline">{t('signIn.tagline')}</p>
      </div>

      {phase === 'waiting' && started && embedded ? (
        <div className="verify-frame-wrap">
          <iframe
            className="verify-frame"
            src={started.embedUrl}
            title={t('signIn.title')}
            // No `allow-same-origin`: the frame has nothing to read from this
            // page, and the only thing it sends is the message handled above.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="origin"
          />
        </div>
      ) : (
        <div className="wait-card">
          <p className="wait-line">
            {phase === 'starting' ? t('signIn.starting') : t('signIn.waiting')}
          </p>
          <div className="wait-dots" aria-hidden><span /><span /><span /></div>
          {phase === 'waiting' && started?.whatsappUrl && (
            <>
              <p className="wait-hint">{t('signIn.whatsappHint')}</p>
              <a
                className="pill pill-green"
                href={started.whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={tap}
              >
                <span className="pill-icon">💬</span>
                <span className="pill-body">
                  <span className="pill-title">{t('signIn.openWhatsApp')}</span>
                  <span className="pill-sub">{t('signIn.openWhatsAppSub')}</span>
                </span>
              </a>
            </>
          )}
        </div>
      )}

      <div className="menu-cards">
        <div className="info-card info-card-static">
          <span className="info-icon">🔒</span>
          <span>
            <strong>{t('signIn.privacyTitle')}</strong><br />
            {t('signIn.privacyBody')}
          </span>
        </div>
      </div>
    </div>
  );
}
