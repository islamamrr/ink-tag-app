// The app's look: riso print. Paper, black ink and four print inks, nothing
// else (design/riso-style.md). Browsing screens are paper; a template or a
// photo "floods" its screens with its main ink.
//
// Plain TypeScript: no React here, so the ink picking is easy to test.

export const INK = {
  paper: '#F3EFE7',
  black: '#18181B',
  red: '#E4402F',
  yellow: '#FFD200',
  blue: '#2A55D9',
  green: '#2E9E5B',
  muted: '#4A4740',
  white: '#FFFFFF',
} as const;

/** The app's colour for each of the badge's six colours. */
export const BADGE_INK: Record<string, string> = {
  black: INK.black,
  white: INK.white,
  red: INK.red,
  yellow: INK.yellow,
  blue: INK.blue,
  green: INK.green,
};

/** Font family names, one per weight (Android ignores fontWeight on custom fonts). */
export const FONT = {
  display: 'RubikMonoOne',
  bold: 'DarkerGrotesque-Bold',
  heavy: 'DarkerGrotesque-ExtraBold',
  black: 'DarkerGrotesque-Black',
  mono: 'SpaceMono',
  monoBold: 'SpaceMono-Bold',
} as const;

/** The inks a screen can flood with. */
export type Flood = 'red' | 'yellow' | 'blue' | 'green';
const FLOODS: Flood[] = ['red', 'yellow', 'blue', 'green'];

/** What a surface (paper, or one flood ink) asks of the things drawn on it. */
export interface Surface {
  flood: Flood | null;
  ground: string;
  /** Text and outlines. */
  fg: string;
  muted: string;
  /** Dots in the paper grain or the flood's halftone. */
  dots: string;
  dotsAlpha: number;
  /** The second ink: offset text and the main button's hard shadow. */
  second: string;
  /** Fields, cards and the main button sit on this. */
  card: string;
  /** Text on `card`. */
  cardFg: string;
  /** Light status bar text on dark floods. */
  light: boolean;
}

export const PAPER: Surface = {
  flood: null,
  ground: INK.paper,
  fg: INK.black,
  muted: INK.muted,
  dots: INK.black,
  dotsAlpha: 0.05,
  second: INK.red,
  card: INK.white,
  cardFg: INK.black,
  light: false,
};

export function surfaceFor(flood: Flood | null | undefined): Surface {
  if (!flood) return PAPER;
  const yellow = flood === 'yellow';
  return {
    flood,
    ground: INK[flood],
    fg: yellow ? INK.black : INK.paper,
    muted: yellow ? 'rgba(24,24,27,0.78)' : 'rgba(243,239,231,0.88)',
    dots: yellow ? INK.red : INK.yellow,
    dotsAlpha: 0.9,
    second: flood === 'blue' || flood === 'green' ? INK.red : INK.blue,
    card: INK.paper,
    cardFg: INK.black,
    light: !yellow,
  };
}

/** Shares of the badge's six colours in a picture, 0..1 each. */
export type Shares = Partial<Record<string, number>>;

/** The print ink a picture uses most. Black-and-white pictures get the brand blue. */
export function mainInk(shares: Shares | null | undefined, fallback: Flood = 'blue'): Flood {
  if (!shares) return fallback;
  let best: Flood | null = null;
  for (const f of FLOODS) if ((shares[f] ?? 0) >= 0.03 && (best === null || (shares[f] ?? 0) > (shares[best] ?? 0))) best = f;
  return best ?? fallback;
}

/** "GREEN + RED", "MOSTLY RED", or "BLACK + WHITE": the inks a picture prints with. */
export function inkLine(shares: Shares | null | undefined): string {
  if (!shares) return '';
  const used = FLOODS.filter((f) => (shares[f] ?? 0) >= 0.03).sort((a, b) => (shares[b] ?? 0) - (shares[a] ?? 0));
  if (used.length === 0) return 'BLACK + WHITE';
  if (used.length === 1 || (shares[used[0]] ?? 0) > 3 * (shares[used[1]] ?? 0)) return `MOSTLY ${used[0].toUpperCase()}`;
  return `${used[0]} + ${used[1]}`.toUpperCase();
}

/** A small tilt for print cards, the same for the same index. */
export const tiltFor = (i: number) => [-1.5, 1, 0.5, -1, 1.5, -0.5][((i % 6) + 6) % 6];
