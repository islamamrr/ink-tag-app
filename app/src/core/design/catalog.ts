// The template catalogue: every template the Templates tab offers, grouped
// into packs and categories, with sample content for the previews. It is a
// JSON file (catalog.json) so new templates and packs can be shipped as data:
// the app reads the bundled file, and a newer one saved in its storage
// (downloaded later, for example) replaces it without an app update.
//
// An entry is either a template written in code ("builtin", templates.ts)
// with catalogue details added, or a full spec (specs.ts).

import bundled from './catalog.json';
import { type Behaviour, checkSpec, type LiveRule, specTemplate, type TemplateSpec } from './specs';
import { type TemplateDef, type Values, TEMPLATES } from './templates';

export interface CatalogCategory {
  id: string;
  title: string;
}

export interface CatalogPack {
  id: string;
  title: string;
  description: string;
  /** YYYY-MM-DD. The newest pack is the "New" shelf. */
  added: string;
  templates: string[];
}

interface BuiltinRef {
  builtin: string;
  category: string[];
  tags?: string[];
  sample?: Values;
  fills?: string;
}

export interface CatalogFile {
  version: number;
  categories: CatalogCategory[];
  packs: CatalogPack[];
  popular?: string[];
  templates: (BuiltinRef | TemplateSpec)[];
}

export interface CatalogEntry {
  id: string;
  def: TemplateDef;
  behaviour: Behaviour;
  category: string[];
  tags: string[];
  sample: Values;
  /** "You fill in: …" */
  fills: string;
  live?: LiveRule[];
  /** board: the list field holding the pictures to tap. */
  boardFrom?: string;
  firmware?: string;
}

/** Templates offered under "Start from scratch", not in the grid. */
export const SCRATCH = 'scratch';

export class Catalog {
  readonly entries: CatalogEntry[] = [];
  readonly categories: CatalogCategory[];
  readonly packs: CatalogPack[];
  readonly popular: string[];
  /** Entries left out, and why (for the developer log). */
  readonly skipped: string[] = [];
  private readonly byId = new Map<string, CatalogEntry>();

  constructor(file: CatalogFile) {
    this.categories = file.categories ?? [];
    for (const t of file.templates ?? []) {
      let e: CatalogEntry | null = null;
      if ('builtin' in t) {
        const def = TEMPLATES.find((x) => x.id === t.builtin);
        if (!def) {
          this.skipped.push(`${t.builtin}: no such built-in template`);
          continue;
        }
        e = {
          id: def.id,
          def,
          behaviour: 'form',
          category: t.category ?? [],
          tags: t.tags ?? [],
          sample: t.sample ?? {},
          fills: t.fills ?? '',
        };
      } else {
        const why = checkSpec(t);
        if (why) {
          this.skipped.push(why);
          continue;
        }
        e = {
          id: t.id,
          def: specTemplate(t),
          behaviour: t.behaviour,
          category: t.category ?? [],
          tags: t.tags ?? [],
          sample: t.sample ?? {},
          fills: t.fills ?? '',
          live: t.live?.rules,
          boardFrom: t.board?.from,
          firmware: t.firmware,
        };
      }
      if (this.byId.has(e.id)) {
        this.skipped.push(`${e.id}: listed twice`);
        continue;
      }
      this.byId.set(e.id, e);
      this.entries.push(e);
    }
    this.packs = (file.packs ?? [])
      .map((p) => ({ ...p, templates: p.templates.filter((id) => this.byId.has(id)) }))
      .filter((p) => p.templates.length)
      .sort((a, b) => b.added.localeCompare(a.added));
    this.popular = (file.popular ?? []).filter((id) => this.byId.has(id));
  }

  get(id: string): CatalogEntry | undefined {
    return this.byId.get(id);
  }

  /** The grid: everything but the scratch starters, optionally one category or only live ones. */
  list(filter: { category?: string; live?: boolean } = {}): CatalogEntry[] {
    return this.entries.filter(
      (e) =>
        !e.category.includes(SCRATCH) &&
        (!filter.category || e.category.includes(filter.category)) &&
        (!filter.live || e.behaviour === 'live'),
    );
  }

  /** The newest pack, for the "New" shelf. */
  newest(): CatalogPack | undefined {
    return this.packs[0];
  }

  pack(id: string): CatalogPack | undefined {
    return this.packs.find((p) => p.id === id);
  }

  /** Names, descriptions and tags, every word must match somewhere. */
  search(q: string): CatalogEntry[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return this.list().filter((e) => {
      const hay = [e.def.title, e.def.description, ...e.tags, ...e.category].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
}

export const BUNDLED_CATALOG = bundled as unknown as CatalogFile;

/** The bundled catalogue, or a newer valid one (e.g. downloaded), whichever is newer. */
export function pickCatalog(saved: unknown): Catalog {
  const s = saved as Partial<CatalogFile> | null;
  if (s && typeof s.version === 'number' && s.version > BUNDLED_CATALOG.version && Array.isArray(s.templates))
    return new Catalog(s as CatalogFile);
  return new Catalog(BUNDLED_CATALOG);
}

/** Live rules in words, for the live template screen. */
export const LIVE_RULES: Record<LiveRule, { label: string; detail: string }> = {
  hourly: { label: 'Every hour', detail: 'On the hour, 8:00 to 20:00' },
  quarter: { label: 'Every 15 minutes', detail: 'Shows quarter hours, 8:00 to 20:00' },
  morning: { label: 'Once a morning', detail: 'Date only, at 7:00' },
};
