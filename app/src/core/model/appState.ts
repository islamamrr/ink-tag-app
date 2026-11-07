// What the app remembers beyond badges and the library: app-wide settings,
// each template's last form (so a to-do list or a status board keeps its
// items), the status last tapped on a board, and the running live template.

import type { PictureStyle } from '../design/styles';
import type { Values } from '../design/templates';
import type { LiveJob } from './live';
import { JsonDoc, type Storage } from './storage';

export interface AppPrefs {
  /** Reconnect to the badge when the app opens. */
  connectOnOpen: boolean;
  /** The look new photos start with. */
  defaultStyle: PictureStyle;
  /** The welcome screen has been seen (or a badge added). */
  welcomed: boolean;
}

export interface Draft {
  values: Values;
  layout: number;
  updatedAt: number;
}

export interface BoardShown {
  label: string;
  badgeId: string;
  at: number;
}

interface AppStateDoc {
  prefs: AppPrefs;
  drafts: Record<string, Draft>;
  boards: Record<string, BoardShown>;
  live: LiveJob | null;
}

export const DEFAULT_APP_PREFS: AppPrefs = { connectOnOpen: true, defaultStyle: 'smooth', welcomed: false };

const fresh = (): AppStateDoc => ({ prefs: { ...DEFAULT_APP_PREFS }, drafts: {}, boards: {}, live: null });

export class AppState {
  private doc: AppStateDoc = fresh();
  private readonly file: JsonDoc<AppStateDoc>;
  private listeners = new Set<() => void>();

  constructor(storage: Storage) {
    this.file = new JsonDoc(storage, 'app-state.json', 1, fresh);
  }

  async load() {
    const d = await this.file.load();
    this.doc = { ...fresh(), ...d, prefs: { ...DEFAULT_APP_PREFS, ...d.prefs } };
    this.emit();
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private async save() {
    this.emit();
    await this.file.save(this.doc);
  }

  prefs(): AppPrefs {
    return this.doc.prefs;
  }

  async setPrefs(p: Partial<AppPrefs>) {
    this.doc.prefs = { ...this.doc.prefs, ...p };
    await this.save();
  }

  draft(templateId: string): Draft | undefined {
    return this.doc.drafts[templateId];
  }

  async saveDraft(templateId: string, values: Values, layout: number, now = Date.now()) {
    this.doc.drafts[templateId] = { values, layout, updatedAt: now };
    await this.save();
  }

  board(templateId: string): BoardShown | undefined {
    return this.doc.boards[templateId];
  }

  async setBoard(templateId: string, shown: BoardShown) {
    this.doc.boards[templateId] = shown;
    await this.save();
  }

  live(): LiveJob | null {
    return this.doc.live;
  }

  async setLive(job: LiveJob | null) {
    this.doc.live = job ? { ...job } : null;
    await this.save();
  }
}
