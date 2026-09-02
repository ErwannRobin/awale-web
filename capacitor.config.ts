/// <reference types="node" />
// Native shell configuration. This file is inert until the Capacitor packages
// are installed — see the "Native mobile app" section of the README:
//
//   npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
//   npm run build && npx cap add ios && npx cap add android && npx cap sync
//
// Nothing in src/ imports it; it exists so the native port is a checkout away
// rather than a redesign.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.awale.game',
  appName: 'Awalé',
  webDir: 'dist',
  backgroundColor: '#150c06',
  android: {
    // The board is drawn with CSS gradients; letting the WebView scale text
    // independently would break pit alignment.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#150c06',
      showSpinner: false,
      launchAutoHide: true,
    },
  },
};

export default config;
