import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true exposes the dev server on the LAN so a real phone (or a
  // Capacitor live-reload shell) can load it during development.
  server: { host: true },
  build: {
    // Matches the oldest WebView we intend to support in a native shell.
    target: 'es2020',
  },
});
