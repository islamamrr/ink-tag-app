// The data-driven template catalogue, list values and live scheduling.

import {
  AppState,
  BUNDLED_CATALOG,
  Catalog,
  compile,
  daysUntil,
  estimateText,
  fillTokens,
  formatList,
  LiveRunner,
  type LiveJob,
  MemoryStorage,
  nextRun,
  parseDay,
  parseList,
  pickCatalog,
  resolveColor,
  type Scene,
  withDefaults,
  yearPercent,
} from '../src/core';

const cat = new Catalog(BUNDLED_CATALOG);
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const texts = (s: Scene) => s.layers.flatMap((l) => (l.type === 'text' ? [l.text] : []));

test('the bundled catalogue loads with nothing skipped', () => {
  expect(cat.skipped).toEqual([]);
  expect(cat.entries.length).toBeGreaterThanOrEqual(20);
  expect(cat.newest()?.id).toBe('desk');
  for (const p of cat.packs) for (const id of p.templates) expect(cat.get(id)).toBeDefined();
  // Only behaviours today's firmware can do.
  for (const e of cat.entries) {
    expect(['form', 'list', 'board', 'live']).toContain(e.behaviour);
    expect(e.firmware).toBeUndefined();
  }
});

test('every template draws its sample, upright and sideways, in every layout', () => {
  const now = local(2026, 11, 7, 9, 0);
  for (const e of cat.entries) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (let layout = 0; layout < e.def.layouts; layout++) {
        const scene = e.def.build(withDefaults(e.def, e.sample), { orientation, layout, now });
        const ops = compile(scene, estimateText);
        expect(ops.length).toBeGreaterThan(0);
        for (const l of scene.layers)
          if ('box' in l) {
            expect(l.box.width).toBeGreaterThan(0);
            expect(l.box.height).toBeGreaterThan(0);
          }
      }
    }
  }
});

test('the scratch starters stay out of the grid; categories and search work', () => {
  const grid = cat.list().map((e) => e.id);
  expect(grid).not.toContain('text');
  expect(grid).toContain('todo');
  expect(cat.list({ live: true }).every((e) => e.behaviour === 'live')).toBe(true);
  expect(cat.list({ category: 'events' }).map((e) => e.id)).toContain('table-number');
  expect(cat.search('wifi guests').map((e) => e.id)).toEqual(['wifi-qr']);
  expect(cat.search('')).toEqual([]);
});

test('a broken entry in a downloaded catalogue is skipped, not fatal', () => {
  const c = new Catalog({
    version: 2,
    categories: [],
    packs: [{ id: 'p', title: 'P', description: '', added: '2027-01-01', templates: ['ok', 'nope'] }],
    templates: [
      { id: 'ok', title: 'OK', description: '', behaviour: 'form', category: [], fields: [], sample: {}, layouts: [{ blocks: [{ t: 'text', text: 'Hi' }] }] },
      { id: 'Bad Id', title: 'x' } as never,
      { builtin: 'missing', category: [] },
    ],
  });
  expect(c.entries.map((e) => e.id)).toEqual(['ok']);
  expect(c.skipped).toHaveLength(2);
  expect(c.pack('p')?.templates).toEqual(['ok']);
  // Older or broken saved files fall back to the bundled one.
  expect(pickCatalog({ version: 0, templates: [] }).entries.length).toBe(cat.entries.length);
  expect(pickCatalog(null).entries.length).toBe(cat.entries.length);
});

test('lists keep ticks and colours as plain text', () => {
  const items = parseList('[x] Milk\n  Eggs \n\nIn a meeting | blue\nA | b | red\nNot a colour | purple');
  expect(items).toEqual([
    { text: 'Milk', done: true },
    { text: 'Eggs', done: false },
    { text: 'In a meeting', done: false, color: 'blue' },
    { text: 'A | b', done: false, color: 'red' },
    { text: 'Not a colour | purple', done: false },
  ]);
  expect(parseList(formatList(items))).toEqual(items);
});

test('the to-do list crosses out or hides ticked items', () => {
  const todo = cat.get('todo')!;
  const v = withDefaults(todo.def, { items: '[x] Done thing\nOpen thing' });
  const strike = todo.def.build({ ...v, done: 'strike' });
  const hide = todo.def.build({ ...v, done: 'hide' });
  expect(texts(strike)).toContain('Done thing');
  expect(texts(hide)).not.toContain('Done thing');
  expect(texts(hide)).toContain('Open thing');
});

test('a long list ends with "+N more" instead of overflowing', () => {
  const todo = cat.get('todo')!;
  const items = Array.from({ length: 40 }, (_, i) => `Item ${i + 1}`).join('\n');
  const t = texts(todo.def.build(withDefaults(todo.def, { items })));
  expect(t.some((x) => /^\+\d+ more$/.test(x))).toBe(true);
});

test('tokens: time, dates, countdown, year', () => {
  const now = local(2026, 11, 7, 9, 5);
  expect(fillTokens('{{now:HH:mm}} {{now:dddd}} {{now:D MMMM YYYY}} {{now:ddd}} {{now:MMM}}', {}, now)).toBe(
    '09:05 Saturday 7 November 2026 Sat Nov',
  );
  expect(fillTokens('{{daysUntil:d}} days', { d: '2026-11-10' }, now)).toBe('3 days');
  expect(fillTokens('{{daysUntil:d}}', { d: 'soon' }, now)).toBe('?');
  expect(fillTokens('Hi {{name}}{{missing}}', { name: ' Sam ' }, now)).toBe('Hi Sam');
  expect(parseDay('2026-02-30')).toBeNull();
  expect(daysUntil(new Date(2026, 10, 7), local(2026, 11, 7, 23, 59))).toBe(0);
  expect(yearPercent(local(2026, 1, 1))).toBe(0);
  expect(yearPercent(local(2026, 7, 2, 12))).toBe(50);
  expect(resolveColor('on:{{c}}', { c: 'yellow' }, now, 'white')).toBe('black');
  expect(resolveColor('{{c}}', { c: 'nonsense' }, now, 'white')).toBe('white');
});

test('the clock shows the time unless it only updates in the morning', () => {
  const clock = cat.get('clock')!;
  const now = local(2026, 11, 7, 14, 0);
  const v = withDefaults(clock.def, clock.sample);
  expect(texts(clock.def.build(v, { now }))).toContain('14:00');
  expect(texts(clock.def.build({ ...v, dateOnly: 'true' }, { now }))).not.toContain('14:00');
});

test('live schedule: hourly in the day, quarter hours, mornings', () => {
  expect(nextRun('hourly', local(2026, 11, 7, 9, 0))).toBe(local(2026, 11, 7, 10, 0));
  expect(nextRun('hourly', local(2026, 11, 7, 9, 59))).toBe(local(2026, 11, 7, 10, 0));
  expect(nextRun('hourly', local(2026, 11, 7, 5, 10))).toBe(local(2026, 11, 7, 8, 0));
  expect(nextRun('hourly', local(2026, 11, 7, 20, 0))).toBe(local(2026, 11, 8, 8, 0));
  expect(nextRun('quarter', local(2026, 11, 7, 9, 7))).toBe(local(2026, 11, 7, 9, 15));
  expect(nextRun('quarter', local(2026, 11, 7, 19, 50))).toBe(local(2026, 11, 7, 20, 0));
  expect(nextRun('morning', local(2026, 11, 7, 6, 0))).toBe(local(2026, 11, 7, 7, 0));
  expect(nextRun('morning', local(2026, 11, 7, 7, 0))).toBe(local(2026, 11, 8, 7, 0));
  // Month end.
  expect(nextRun('morning', local(2026, 11, 30, 12, 0))).toBe(local(2026, 12, 1, 7, 0));
});

test('the live runner sends now, then on schedule, and catches up after a pause', async () => {
  let now = local(2026, 11, 7, 9, 10);
  let timer: { fn: () => void; at: number } | null = null;
  const sent: number[] = [];
  const saved: (LiveJob | null)[] = [];
  let fail = false;
  const r = new LiveRunner({
    now: () => now,
    setTimer: (fn, ms) => {
      timer = { fn, at: now + ms };
      return () => (timer = null);
    },
    send: async (_job, drawAt) => {
      if (fail) throw new Error('away');
      sent.push(drawAt);
    },
    save: (j) => {
      saved.push(j && { ...j });
    },
    describe: (e) => (e as Error).message,
  });
  await r.start({ badgeId: 'b', templateId: 'clock', values: {}, layout: 0, rule: 'hourly' });
  expect(sent).toEqual([local(2026, 11, 7, 9, 10)]);
  expect(r.current()!.nextAt).toBe(local(2026, 11, 7, 10, 0));
  expect(timer!.at).toBe(local(2026, 11, 7, 10, 0));

  // The timer fires a little late: the picture still says 10:00.
  now = local(2026, 11, 7, 10, 0, ) + 20_000;
  const t1 = timer!;
  timer = null;
  t1.fn();
  await new Promise((res) => setTimeout(res, 0));
  expect(sent[1]).toBe(local(2026, 11, 7, 10, 0));
  expect(r.current()!.nextAt).toBe(local(2026, 11, 7, 11, 0));

  // A failed update is remembered and the schedule goes on.
  fail = true;
  now = local(2026, 11, 7, 11, 0);
  timer!.fn();
  await new Promise((res) => setTimeout(res, 0));
  expect(r.current()!.lastError).toBe('away');
  expect(r.current()!.nextAt).toBe(local(2026, 11, 7, 12, 0));

  // Paused for hours (app in the background): resume sends at once, drawing now.
  fail = false;
  r.pause();
  now = local(2026, 11, 7, 15, 30);
  await r.resume();
  expect(sent[sent.length - 1]).toBe(now);
  expect(r.current()!.lastError).toBeUndefined();
  expect(r.current()!.nextAt).toBe(local(2026, 11, 7, 16, 0));

  await r.stop();
  expect(r.current()).toBeNull();
  expect(saved[saved.length - 1]).toBeNull();
});

test('app state keeps prefs, drafts, boards and the live job', async () => {
  const storage = new MemoryStorage();
  const a = new AppState(storage);
  await a.load();
  expect(a.prefs().connectOnOpen).toBe(true);
  await a.setPrefs({ welcomed: true, defaultStyle: 'poster' });
  await a.saveDraft('todo', { items: 'A' }, 1, 5);
  await a.setBoard('status-board', { label: 'Lunch', badgeId: 'b', at: 7 });
  const b = new AppState(storage);
  await b.load();
  expect(b.prefs()).toMatchObject({ welcomed: true, defaultStyle: 'poster', connectOnOpen: true });
  expect(b.draft('todo')).toEqual({ values: { items: 'A' }, layout: 1, updatedAt: 5 });
  expect(b.board('status-board')?.label).toBe('Lunch');
  expect(b.live()).toBeNull();
});
