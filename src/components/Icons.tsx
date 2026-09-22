// Line icons, drawn here rather than pulled from an emoji font.
//
// Emoji come in whatever colours the platform ships and look different on
// every device; these are plain strokes in `currentColor`, so a button decides
// its own colour (see --icon) and every theme gets the same drawing.
//
// All of them share one 24×24 grid and one stroke weight, which is what makes
// a set look like a set.

import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Resume a game in progress. */
export const PlayIcon = () => (
  <Icon><path d="M8.5 5.4 19 12 8.5 18.6V5.4Z" /></Icon>
);

/** Quick match — straight into a game. */
export const BoltIcon = () => (
  <Icon><path d="M13.2 2.5 4.8 13.4h6.1L10.8 21.5l8.4-10.9h-6.1l.1-8.1Z" /></Icon>
);

/** Online play. */
export const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 9.6h17.6M3.2 14.4h17.6" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
  </Icon>
);

/** Two players on one device. */
export const UsersIcon = () => (
  <Icon>
    <circle cx="9.2" cy="8.4" r="3.4" />
    <path d="M2.8 20c0-3.4 2.9-5.6 6.4-5.6s6.4 2.2 6.4 5.6" />
    <path d="M16.4 5.4a3.4 3.4 0 0 1 0 6.3" />
    <path d="M18 14.9c2 .8 3.2 2.6 3.2 5.1" />
  </Icon>
);

/** The computer opponent. */
export const BotIcon = () => (
  <Icon>
    <rect x="4" y="8.2" width="16" height="11.6" rx="3.2" />
    <path d="M12 4.6v3.6" />
    <circle cx="12" cy="3.2" r="1.3" />
    <path d="M9.4 13.4v1.6M14.6 13.4v1.6" />
    <path d="M2.2 12.8v3.4M21.8 12.8v3.4" />
  </Icon>
);

/** The tutorial. */
export const CapIcon = () => (
  <Icon>
    <path d="M12 4 21.5 8.6 12 13.2 2.5 8.6 12 4Z" />
    <path d="M6.4 10.9V16c0 1.8 2.5 3.1 5.6 3.1s5.6-1.3 5.6-3.1v-5.1" />
    <path d="M21.5 8.6v5.2" />
  </Icon>
);

/** Challenges — a set position to solve. */
export const TargetIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.3" />
  </Icon>
);

/** Records — your best games. */
export const TrophyIcon = () => (
  <Icon>
    <path d="M7.8 4h8.4v5.1a4.2 4.2 0 0 1-8.4 0V4Z" />
    <path d="M7.8 6H5.3a2.6 2.6 0 0 0 2.7 4.2" />
    <path d="M16.2 6h2.5a2.6 2.6 0 0 1-2.7 4.2" />
    <path d="M12 13.4V16" />
    <path d="M9.4 20c0-2.2 1-3.6 2.6-4 1.6.4 2.6 1.8 2.6 4" />
    <path d="M8.2 20h7.6" />
  </Icon>
);

/** Stats and rank. */
export const ChartIcon = () => (
  <Icon>
    <path strokeWidth={2.2} d="M6.6 19.4v-5.8M12 19.4V4.6M17.4 19.4v-9.2" />
  </Icon>
);

/** Settings. */
export const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.9" />
    {/* Eight teeth, each rooted just inside the rim so the cog reads as one
        piece rather than a circle with rays around it. */}
    <path
      strokeWidth={2.4}
      d="M12 4.6v2.8M12 16.6v2.8M16.6 12h2.8M4.6 12h2.8
         M15.25 8.75 17.23 6.77M6.77 17.23l1.98-1.98
         M15.25 15.25l1.98 1.98M6.77 6.77 8.75 8.75"
    />
  </Icon>
);

/** Back / Previous. */
export const BackIcon = () => (
  <Icon>
    <path d="M19.2 12 12 5.8 4.8 12" />
    <path d="M12 5.8v12.4" />
  </Icon>
);
