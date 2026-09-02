import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { registerServiceWorker } from './lib/offline.ts';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// A board game should work on a plane. Dev keeps the network authoritative.
if (import.meta.env.PROD) registerServiceWorker();
