// My badges: every badge this phone has added, with the name the owner gave
// it, how it hangs, what it's used for, its lock key and what it shows now.

import type { Orientation } from '../imaging/frame';
import type { BadgeUse } from '../design/templates';
import type { ScreenCheck } from './screenCheck';
import { JsonDoc, type Storage } from './storage';

export type BadgeKind = 'ble' | 'demo';

export interface SavedBadge {
  /** Bluetooth id (MAC on Android, a UUID on iOS), or "demo-…" for a simulated badge. */
  id: string;
  kind: BadgeKind;
  /** The owner's name for it ("Islam's badge"). */
  name: string;
  /** What it advertises ("InkTag-3F2A"). */
  advertisedName: string;
  use: BadgeUse;
  orientation: Orientation;
  addedAt: number;
  lastConnectedAt?: number;
  /** Heard nearby (scan or connection). */
  lastSeenAt?: number;
  firmware?: string;
  /**
   * Hex owner key when this phone locked the badge. Stored with the app's
   * files for v1; moving it to the phone's keychain (expo-secure-store) is a
   * follow-up.
   */
  ownerKey?: string;
  /** Library item on the screen now, and when it was sent. */
  shownItemId?: string;
  shownAt?: number;
  /** Last screen check result. */
  screen?: ScreenCheck;
}

interface BadgesDoc {
  badges: SavedBadge[];
  /** The badge the app opens with and reconnects to. */
  currentId: string | null;
}

export class BadgeRegistry {
  private doc: BadgesDoc = { badges: [], currentId: null };
  private readonly file: JsonDoc<BadgesDoc>;
  private listeners = new Set<() => void>();

  constructor(storage: Storage) {
    this.file = new JsonDoc(storage, 'badges.json', 1, () => ({ badges: [], currentId: null }));
  }

  async load() {
    this.doc = await this.file.load();
    this.emit();
  }

  /** Most recently used first. */
  list(): SavedBadge[] {
    return [...this.doc.badges].sort(
      (a, b) => (b.lastConnectedAt ?? b.addedAt) - (a.lastConnectedAt ?? a.addedAt),
    );
  }

  get(id: string): SavedBadge | undefined {
    return this.doc.badges.find((b) => b.id === id);
  }

  current(): SavedBadge | undefined {
    return (this.doc.currentId && this.get(this.doc.currentId)) || this.list()[0];
  }

  async setCurrent(id: string | null) {
    this.doc.currentId = id;
    await this.persist();
  }

  async put(badge: SavedBadge) {
    const i = this.doc.badges.findIndex((b) => b.id === badge.id);
    if (i >= 0) this.doc.badges[i] = badge;
    else this.doc.badges.push(badge);
    await this.persist();
    return badge;
  }

  async update(id: string, patch: Partial<SavedBadge>) {
    const b = this.get(id);
    if (!b) throw new Error(`no badge ${id}`);
    return this.put({ ...b, ...patch, id });
  }

  async remove(id: string) {
    this.doc.badges = this.doc.badges.filter((b) => b.id !== id);
    if (this.doc.currentId === id) this.doc.currentId = null;
    await this.persist();
  }

  /** A name for a new badge that no other badge here has: "My badge", "My badge 2", … */
  suggestName(base = 'My badge'): string {
    const taken = new Set(this.doc.badges.map((b) => b.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private async persist() {
    await this.file.save(this.doc);
    this.emit();
  }
}
