// The app's riso look: which ink a picture floods its screen with.

import { inkLine, mainInk, surfaceFor, tiltFor } from '../src/ui/theme';

describe('mainInk', () => {
  it('picks the print ink a picture uses most', () => {
    expect(mainInk({ black: 0.3, white: 0.4, red: 0.2, green: 0.1 })).toBe('red');
    expect(mainInk({ white: 0.5, blue: 0.05, yellow: 0.3 })).toBe('yellow');
  });
  it('gives black-and-white pictures the brand blue', () => {
    expect(mainInk({ black: 0.5, white: 0.49, red: 0.01 })).toBe('blue');
    expect(mainInk(null)).toBe('blue');
    expect(mainInk(undefined, 'green')).toBe('green');
  });
});

describe('inkLine', () => {
  it('names the inks a picture prints with', () => {
    expect(inkLine({ green: 0.3, red: 0.2, white: 0.5 })).toBe('GREEN + RED');
    expect(inkLine({ red: 0.6, yellow: 0.05, white: 0.35 })).toBe('MOSTLY RED');
    expect(inkLine({ black: 0.5, white: 0.5 })).toBe('BLACK + WHITE');
    expect(inkLine(null)).toBe('');
  });
});

describe('surfaces', () => {
  it('prints black on yellow and paper on the darker floods', () => {
    expect(surfaceFor('yellow').fg).toBe('#18181B');
    expect(surfaceFor('red').fg).toBe('#F3EFE7');
    expect(surfaceFor(null).flood).toBeNull();
  });
  it('tilts prints the same way every time', () => {
    expect(tiltFor(0)).toBe(tiltFor(6));
    expect(Math.abs(tiltFor(-1))).toBeLessThanOrEqual(2);
  });
});
