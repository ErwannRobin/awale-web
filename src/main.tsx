import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { registerServiceWorker } from './lib/offline.ts';
import { initNative } from './lib/native.ts';
import './styles.css';

function mount() {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

  // A board game should work on a plane. Dev keeps the network authoritative,
  // and the native shell already has every asset on disk.
  if (import.meta.env.PROD) registerServiceWorker();
}

// The native shell swaps the persistence backend, and screens read progress
// during render — so the bootstrap has to finish first. On the web this
// resolves immediately, and a failure inside it still renders the game.
initNative().catch(() => {}).then(mount);
