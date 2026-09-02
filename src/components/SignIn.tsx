import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import {
  saveSession, startSignIn, waitForSignIn,
  type Session, type StartedSignIn,
} from '../lib/auth.ts';
import { encodeQr } from '../lib/qr.ts';
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
 * This screen is the game's own, all the way down: nothing of phone-verif's is
 * embedded or loaded here. The Worker starts the verification with its API key,
 * hands back a `wa.me` link with the message already written, and this screen
 * shows it. The player opens WhatsApp, sends the message, comes back — and the
 * only question this page ever asks is put to our own server, which is the one
 * holding the key and the only thing that can answer it.
 *
 * So there is nothing here for a page-level attacker to say. The screen cannot
 * declare a sign-in successful; it can only keep asking until the server does.
 */
export default function SignIn({ onSignedIn, onBack, onToast }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('starting');
  const [started, setStarted] = useState<StartedSignIn | null>(null);
  const [copied, setCopied] = useState(false);
  const nudge = useRef<(() => void) | null>(null);

  // Drawn here, from the link we were given — no request, no credit, and it
  // still works with the network down. Pointless on the device that would have
  // to scan it, so phones get the button and nothing else.
  const showQr = !isNative();
  const qr = useMemo(
    () => (showQr && started?.whatsappUrl ? encodeQr(started.whatsappUrl) : null),
    [showQr, started?.whatsappUrl],
  );

  const tap = () => { playTap(); hapticTap(); };
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

  // Coming back to the tab is the moment a player is most likely to have just
  // sent the message, so ask again immediately instead of sitting out the rest
  // of the interval. It changes when we ask, never the answer.
  useEffect(() => {
    const wake = () => { if (!document.hidden) nudge.current?.(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  const copyLink = async () => {
    if (!started?.whatsappUrl) return;
    tap();
    try {
      await navigator.clipboard.writeText(started.whatsappUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast(t('signIn.copyFailed'));
    }
  };

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

      <div className="wait-card">
        {phase === 'waiting' && started?.whatsappUrl ? (
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
            {qr && (
              <>
                <p className="wait-hint">{t('signIn.qrHint')}</p>
                <svg
                  className="qr"
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label={t('signIn.qrHint')}
                  shapeRendering="crispEdges"
                >
                  {/* The quiet zone is part of the code, so it is painted
                      rather than left to whatever is behind the card. */}
                  <rect width={qr.size} height={qr.size} fill="#fff" />
                  <path d={qr.path} fill="#000" />
                </svg>
              </>
            )}
            <p className="wait-line">{t('signIn.waiting')}</p>
            <div className="wait-dots" aria-hidden><span /><span /><span /></div>
            {/* For signing in on a phone while reading this on a desktop. */}
            <button className="ctrl" onClick={() => void copyLink()}>
              {copied ? `✓ ${t('online.copied')}` : `🔗 ${t('signIn.copyLink')}`}
            </button>
          </>
        ) : (
          <>
            <p className="wait-line">{t('signIn.starting')}</p>
            <div className="wait-dots" aria-hidden><span /><span /><span /></div>
          </>
        )}
      </div>

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
