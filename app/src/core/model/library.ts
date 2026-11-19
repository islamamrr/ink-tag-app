// The library: every picture sent from this phone, with favourites and
// collections, ready to send again in one tap. Each item keeps:
// - the design (scene JSON) and its style, so it can be edited later;
// - the packed frame (209 KB), so sending again needs no redraw or dither;
// - a small preview image the phone writes (PNG), for the grid.
// Photos used by a design are copied into the library, so editing still
// works after the original leaves the phone's gallery.

import type { Scene } from '../design/scene';
import { scenePhotos } from '../design/scene';
import type { PictureStyle } from '../design/styles';
import { JsonDoc, newId, type Storage } from './storage';

export type ItemKind = 'photo' | 'template' | 'text' | 'qr' | 'draw' | 'collage';

export interface LibraryItem {
  id: string;
  kind: ItemKind;
  /** "Photo", "Name badge", … */
  title: string;
  /** Template id when made from one, with its form values, to reopen the form. */
  template?: { id: string; values: Record<string, string | boolean | undefined>; layout: number };
  scene: Scene;
  style: PictureStyle;
  createdAt: number;
  favourite: boolean;
  /** Sends of this item, newest last. */
  sends: { badgeId: string; at: number }[];
  /** CRC-32 of the frame, to spot duplicates. */
  crc32: number;
  /** Which colours the preview PNG was painted in; see PREVIEW_VERSION. Missing on items saved before it. */
  previewVersion?: number;
}

/** 2: previews in the app's bright screen inks (SCREEN_PALETTE). 1 (or none): the measured panel colours. */
export const PREVIEW_VERSION = 2;

export interface Collection {
  id: string;
  name: string;
  /** In the owner's order. */
  itemIds: string[];
  createdAt: number;
}

interface LibraryDoc {
  items: LibraryItem[];
  collections: Collection[];
}

export type LibraryFilter = { kind: 'all' } | { kind: 'favourites' } | { kind: 'collection'; id: string };

export interface LibrarySection {
  /** "Today", "Yesterday", "This week", "Earlier". */
  title: string;
  items: LibraryItem[];
}

const framePath = (id: string) => `library/frames/${id}.bin`;
const previewPath = (id: string) => `library/previews/${id}.png`;
export const photoPath = (id: string) => `library/photos/${id}`;

/** Unfavourited, uncollected items beyond this are pruned, oldest first. */
export const DEFAULT_KEEP = 200;

export class Library {
  private doc: LibraryDoc = { items: [], collections: [] };
  private readonly file: JsonDoc<LibraryDoc>;
  private listeners = new Set<() => void>();

  constructor(
    private readonly storage: Storage,
    private readonly opts: { now?: () => number; keep?: number } = {},
  ) {
    this.file = new JsonDoc(storage, 'library/index.json', 1, () => ({ items: [], collections: [] }));
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  async load() {
    this.doc = await this.file.load();
    this.emit();
  }

  // ------------------------------------------------------------ reading

  get(id: string) {
    return this.doc.items.find((i) => i.id === id);
  }

  /** Newest first (by last send, else creation). */
  list(filter: LibraryFilter = { kind: 'all' }): LibraryItem[] {
    if (filter.kind === 'collection') {
      const c = this.collection(filter.id);
      return c ? c.itemIds.map((id) => this.get(id)).filter((x): x is LibraryItem => !!x) : [];
    }
    const items = filter.kind === 'favourites' ? this.doc.items.filter((i) => i.favourite) : this.doc.items;
    return [...items].sort((a, b) => lastUsed(b) - lastUsed(a));
  }

  /** The "Send again" row on Home: the last few, for one badge if given. */
  recent(n = 4, badgeId?: string): LibraryItem[] {
    const items = badgeId
      ? this.list().filter((i) => i.sends.some((s) => s.badgeId === badgeId))
      : this.list();
    return items.slice(0, n);
  }

  /** The grid, grouped by when each item was last used. */
  sections(filter: LibraryFilter = { kind: 'all' }): LibrarySection[] {
    const now = new Date(this.now());
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86_400_000;
    const buckets: [string, (t: number) => boolean][] = [
      ['Today', (t) => t >= startOfDay],
      ['Yesterday', (t) => t >= startOfDay - day],
      ['This week', (t) => t >= startOfDay - 6 * day],
      ['Earlier', () => true],
    ];
    const out: LibrarySection[] = buckets.map(([title]) => ({ title, items: [] }));
    for (const item of this.list(filter)) {
      const t = lastUsed(item);
      out[buckets.findIndex(([, test]) => test(t))].items.push(item);
    }
    return filter.kind === 'collection' ? [{ title: '', items: this.list(filter) }] : out.filter((s) => s.items.length);
  }

  frame(id: string) {
    return this.storage.readBytes(framePath(id));
  }

  preview(id: string) {
    return this.storage.readBytes(previewPath(id));
  }

  /** Replaces an item's preview (an older one painted in the dull panel colours). */
  async setPreview(id: string, preview: Uint8Array, version = PREVIEW_VERSION) {
    const item = this.doc.items.find((i) => i.id === id);
    if (!item) return;
    await this.storage.writeBytes(previewPath(id), preview);
    item.previewVersion = version;
    await this.persist();
  }

  collections(): Collection[] {
    return [...this.doc.collections];
  }

  collection(id: string) {
    return this.doc.collections.find((c) => c.id === id);
  }

  // ------------------------------------------------------------ writing

  /**
   * Adds a newly made picture. An item with the same frame (same CRC) is
   * reused instead of stored twice.
   */
  async add(
    entry: Omit<LibraryItem, 'id' | 'createdAt' | 'favourite' | 'sends'>,
    frame: Uint8Array,
    preview?: Uint8Array,
  ): Promise<LibraryItem> {
    const same = this.doc.items.find((i) => i.crc32 === entry.crc32);
    if (same) return same;
    const item: LibraryItem = {
      ...entry,
      id: newId(this.now()),
      createdAt: this.now(),
      favourite: false,
      sends: [],
    };
    await this.storage.writeBytes(framePath(item.id), frame);
    if (preview) await this.storage.writeBytes(previewPath(item.id), preview);
    this.doc.items.push(item);
    await this.prune();
    await this.persist();
    return item;
  }

  /** Keeps a photo with the library; returns its id for PhotoLayer.photo. */
  async addPhoto(bytes: Uint8Array): Promise<string> {
    const id = `${newId(this.now())}.jpg`;
    await this.storage.writeBytes(photoPath(id), bytes);
    return id;
  }

  photo(id: string) {
    return this.storage.readBytes(photoPath(id));
  }

  async recordSend(id: string, badgeId: string) {
    const item = this.get(id);
    if (!item) return;
    item.sends.push({ badgeId, at: this.now() });
    if (item.sends.length > 50) item.sends.splice(0, item.sends.length - 50);
    await this.persist();
  }

  async setFavourite(id: string, favourite: boolean) {
    const item = this.get(id);
    if (!item) return;
    item.favourite = favourite;
    await this.persist();
  }

  async rename(id: string, title: string) {
    const item = this.get(id);
    if (!item) return;
    item.title = title.trim() || item.title;
    await this.persist();
  }

  async remove(id: string) {
    const item = this.get(id);
    if (!item) return;
    this.doc.items = this.doc.items.filter((i) => i.id !== id);
    for (const c of this.doc.collections) c.itemIds = c.itemIds.filter((x) => x !== id);
    await this.dropFiles(item);
    await this.persist();
  }

  async createCollection(name: string, itemIds: string[] = []): Promise<Collection> {
    const c: Collection = {
      id: newId(this.now()),
      name: name.trim() || 'Collection',
      itemIds: itemIds.filter((id) => this.get(id)),
      createdAt: this.now(),
    };
    this.doc.collections.push(c);
    await this.persist();
    return c;
  }

  async renameCollection(id: string, name: string) {
    const c = this.collection(id);
    if (!c) return;
    c.name = name.trim() || c.name;
    await this.persist();
  }

  async deleteCollection(id: string) {
    this.doc.collections = this.doc.collections.filter((c) => c.id !== id);
    await this.persist();
  }

  async addToCollection(collectionId: string, itemId: string) {
    const c = this.collection(collectionId);
    if (!c || !this.get(itemId) || c.itemIds.includes(itemId)) return;
    c.itemIds.push(itemId);
    await this.persist();
  }

  async removeFromCollection(collectionId: string, itemId: string) {
    const c = this.collection(collectionId);
    if (!c) return;
    c.itemIds = c.itemIds.filter((x) => x !== itemId);
    await this.persist();
  }

  async moveInCollection(collectionId: string, itemId: string, toIndex: number) {
    const c = this.collection(collectionId);
    if (!c || !c.itemIds.includes(itemId)) return;
    c.itemIds = c.itemIds.filter((x) => x !== itemId);
    c.itemIds.splice(Math.max(0, Math.min(toIndex, c.itemIds.length)), 0, itemId);
    await this.persist();
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ------------------------------------------------------------ internals

  private kept(item: LibraryItem) {
    return item.favourite || this.doc.collections.some((c) => c.itemIds.includes(item.id));
  }

  private async prune() {
    const keep = this.opts.keep ?? DEFAULT_KEEP;
    const loose = this.list().filter((i) => !this.kept(i));
    for (const item of loose.slice(keep)) {
      this.doc.items = this.doc.items.filter((i) => i.id !== item.id);
      await this.dropFiles(item);
    }
  }

  private async dropFiles(item: LibraryItem) {
    await this.storage.remove(framePath(item.id));
    await this.storage.remove(previewPath(item.id));
    // A photo can be shared by several designs (edited copies).
    const stillUsed = new Set(this.doc.items.flatMap((i) => scenePhotos(i.scene)));
    for (const p of scenePhotos(item.scene)) if (!stillUsed.has(p)) await this.storage.remove(photoPath(p));
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private async persist() {
    await this.file.save(this.doc);
    this.emit();
  }
}

const lastUsed = (i: LibraryItem) => i.sends.at(-1)?.at ?? i.createdAt;
