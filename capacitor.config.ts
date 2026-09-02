/// <reference types="node" />
// Native shell configuration — read by the Capacitor CLI, never by the app.
// See the "Native mobile app" section of the README for the build commands.
//
// `src/lib/native.ts` is the runtime half: it swaps persistence to Preferences,
// styles the status bar and arms the reminders.
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
    LocalNotifications: {
      // Tint for the small status-bar icon on Android. The icon itself is the
      // app icon until a dedicated monochrome `ic_stat_*` drawable is added.
      iconColor: '#d4a845',
    },
  },
};

export default config;
