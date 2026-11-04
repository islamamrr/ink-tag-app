// Screen check: tells the owner when the badge's screen isn't answering,
// before they blame the app. Two signals: the panel id the badge reads at
// boot (firmware 0.3+; all FF or 00 means no answer, usually wiring), and
// whether the last refresh finished or timed out.

import { panelAnswering, type TagInfo } from '../protocol/codec';
import { ErrorCode } from '../protocol/constants';
import type { DisplayOutcome } from '../protocol/client';

export type ScreenStatus = 'ok' | 'not-answering' | 'refresh-failed' | 'unknown';

export interface ScreenCheck {
  status: ScreenStatus;
  /** One sentence for the owner. */
  message: string;
  checkedAt: number;
}

const MESSAGES: Record<ScreenStatus, string> = {
  ok: 'The screen is answering.',
  'not-answering':
    "The badge can't reach its screen. The screen's ribbon cable may be loose: switch the badge off and reseat it.",
  'refresh-failed':
    "The screen didn't finish its last refresh. The picture is saved on the badge: tap Redraw to try again.",
  unknown: 'Not checked yet. Send a picture to check the screen.',
};

/**
 * Combines INFO with the outcome of the last refresh, if any. A refresh that
 * worked beats an old wiring warning; a panel that never answered at boot
 * beats everything else.
 */
export function checkScreen(
  info: TagInfo | null,
  lastRefresh?: DisplayOutcome | null,
  now = Date.now(),
): ScreenCheck {
  const make = (status: ScreenStatus): ScreenCheck => ({ status, message: MESSAGES[status], checkedAt: now });
  if (lastRefresh?.status === 'displayed') return make('ok');
  if (info && panelAnswering(info) === false) return make('not-answering');
  if (lastRefresh?.status === 'failed' && lastRefresh.error.code === ErrorCode.PANEL_TIMEOUT)
    return make('refresh-failed');
  if (info && panelAnswering(info) === true) return make('ok');
  return make('unknown');
}

export const screenMessage = (s: ScreenStatus) => MESSAGES[s];
