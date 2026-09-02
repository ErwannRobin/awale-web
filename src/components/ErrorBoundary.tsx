import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate } from '../i18n/index.ts';
import { getSettings } from '../lib/settings.ts';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches render errors so a bug in one screen shows a recovery card instead of
 * a blank page. Settings, stats and challenge progress live in storage, so
 * reloading loses nothing but the game in progress — which is itself saved.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing to report to — no analytics — so leave a trace in the console.
    console.error('Awalé crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const t = (key: Parameters<typeof translate>[1]) => translate(getSettings().language, key);
    return (
      <div className="screen">
        <div className="overlay overlay-static">
          <div className="over-card" role="alert">
            <div className="hero-ornament">
              <span className="diamond">◇</span><span className="rule" /><span className="diamond">◇</span>
            </div>
            <h2 className="over-title">{t('error.title')}</h2>
            <p className="over-note">{t('error.body')}</p>
            <details className="error-details">
              <summary>{t('error.details')}</summary>
              <pre>{error.message}</pre>
            </details>
            <button className="pill pill-green" onClick={() => window.location.reload()}>
              <span className="pill-body"><span className="pill-title">{t('error.reload')}</span></span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
