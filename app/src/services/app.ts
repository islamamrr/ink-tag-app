// Everything the product screens use, started once: the InkTag service
// (badges, library, sending), the app's own state (settings, template
// drafts), the template catalogue and the live-template runner. Plus a
// rolling log for "Share a log with support".

import {
  AppState,
  type Catalog,
  type CatalogEntry,
  type Design,
  type InkTag,
  type LiveJob,
  LiveRunner,
  pickCatalog,
  userMessage,
  withDefaults,
} from '../core';
import { getInkTag, onServiceLog } from './inkTag';
import { FileStorage } from './storage';

export interface Services {
  app: InkTag;
  state: AppState;
  catalog: Catalog;
  live: LiveRunner;
}

const LOG_MAX = 400;
const logLines: string[] = [];
onServiceLog((kind, text) => {
  logLines.push(`${new Date().toISOString()} ${kind} ${text}`);
  if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
});

export const appLog = (line: string) => {
  logLines.push(`${new Date().toISOString()} ui ${line}`);
  if (logLines.length > LOG_MAX) logLines.shift();
};

export const logText = () => logLines.join('\n');

/** A template entry as a design to send, with its form values. */
export function templateDesign(
  e: CatalogEntry,
  values: Record<string, string | boolean | undefined>,
  opts: { layout: number; orientation: 'portrait' | 'landscape'; now?: number },
): Design {
  const scene = e.def.build(withDefaults(e.def, values), { orientation: opts.orientation, layout: opts.layout, now: opts.now });
  const kind = e.id === 'text' ? 'text' : e.id === 'qr' ? 'qr' : e.id === 'collage' ? 'collage' : 'template';
  return { scene, style: 'poster', kind, title: e.def.title, template: { id: e.id, values, layout: opts.layout } };
}

let services: Promise<Services> | null = null;

export function getServices(): Promise<Services> {
  services ??= (async () => {
    const storage = new FileStorage();
    const [app, saved] = await Promise.all([
      getInkTag(),
      storage
        .readText('catalog.json')
        .then((t) => (t ? JSON.parse(t) : null))
        .catch(() => null),
    ]);
    const state = new AppState(storage);
    await state.load();
    const catalog = pickCatalog(saved);
    for (const why of catalog.skipped) appLog(`catalogue: skipped ${why}`);
    const live = new LiveRunner({
      now: Date.now,
      setTimer: (fn, ms) => {
        // Long timers are fine in JS, but cap them so a changed clock is noticed.
        const t = setTimeout(fn, Math.min(ms, 30 * 60_000));
        return () => clearTimeout(t);
      },
      send: async (job: LiveJob, drawAt: number) => {
        const e = catalog.get(job.templateId);
        const badge = app.badges.get(job.badgeId);
        if (!e || !badge) throw new Error('That template or badge is gone.');
        const values = { ...job.values, dateOnly: job.rule === 'morning' ? 'true' : undefined };
        const design = templateDesign(e, values, { layout: job.layout, orientation: badge.orientation, now: drawAt });
        appLog(`live: ${job.templateId} for ${new Date(drawAt).toISOString()}`);
        await app.send(job.badgeId, design);
      },
      save: (job) => state.setLive(job),
      describe: userMessage,
    });
    return { app, state, catalog, live };
  })();
  services.catch(() => (services = null));
  return services;
}
