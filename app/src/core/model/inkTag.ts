// The app's v1 behaviour in one place, with no UI: my badges, adding one,
// locking it to this phone, reconnecting at launch, demo badges, making a
// picture, sending it with clear progress, the library, redraw, blank, and
// the screen check. Screens call this; tests drive it against simulated
// badges, so every flow runs on a laptop.
//
// The phone-specific parts come in as dependencies: Bluetooth (BadgeLinks),
// drawing a scene (SceneRenderer, Skia on the phone), random bytes for lock
// keys, and Storage for files.

import { compile, type DrawOp, type Scene } from '../design/scene';
import { STYLES, type PictureStyle } from '../design/styles';
import { helloScene, type BadgeUse } from '../design/templates';
import { frameToRgba, type Orientation } from '../imaging/frame';
import { SCREEN_PALETTE } from '../imaging/palette';
import { convertFitted, type Converted } from '../imaging/pipeline';
import type { RgbaImage } from '../imaging/rgba';
import { type DisplayOutcome, type Log, TagClient } from '../protocol/client';
import { supportsLock, type TagInfo } from '../protocol/codec';
import { Color, type ColorName, PROTOCOL_VERSION } from '../protocol/constants';
import {
  BluetoothError,
  DisconnectedError,
  LockedError,
  TagError,
  TimeoutError,
  UnsupportedProtocolError,
  UploadError,
} from '../protocol/errors';
import { FakeTag, type Timing } from '../sim/fakeTag';
import { SimLink } from '../sim/simLink';
import type { FoundBadge } from '../transport/scan';
import { fromHex, toHex } from '../util/sha256';
import { BadgeRegistry, type SavedBadge } from './badges';
import { Library, type ItemKind, type LibraryItem, PREVIEW_VERSION } from './library';
import { DEFAULT_TIMINGS, ProgressTracker, type SendProgress, type Timings } from './progress';
import { proximity, type ProximityInfo } from './proximity';
import { checkScreen, type ScreenCheck } from './screenCheck';
import { JsonDoc, newId, type Storage } from './storage';

// ------------------------------------------------------------------ dependencies

export interface OpenLink {
  client: TagClient;
  close(): Promise<void>;
}

/** Real badges over Bluetooth. */
export interface BadgeLinks {
  scan(opts: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onUpdate?: (b: FoundBadge[]) => void;
  }): Promise<FoundBadge[]>;
  /** Connects; the returned client has not sent anything yet. */
  open(id: string, log: Log): Promise<OpenLink>;
}

/** Draws a scene's operations into RGBA at the scene's size. */
export interface SceneRenderer {
  measure: Parameters<typeof compile>[1];
  draw(scene: Scene, ops: DrawOp[], photo: (id: string) => Promise<Uint8Array | null>): Promise<RgbaImage>;
  /** A small PNG of the preview, for the library grid. Optional. */
  encodePreview?(img: RgbaImage): Promise<Uint8Array>;
}

export interface InkTagDeps {
  storage: Storage;
  renderer: SceneRenderer;
  /** Absent in Expo Go or on a phone without Bluetooth: only demo badges then. */
  links?: BadgeLinks;
  randomBytes: (n: number) => Uint8Array;
  now?: () => number;
  log?: Log;
  /** Demo badges' speed. 'fast' by default; 'instant' in tests. */
  demoTiming?: Timing;
}

// ------------------------------------------------------------------ public types

export interface Design {
  scene: Scene;
  style: PictureStyle;
  kind: ItemKind;
  title: string;
  template?: LibraryItem['template'];
}

export interface Prepared {
  converted: Converted;
  /** The picture before dithering (the "Photo" side of the preview toggle). */
  rendered: RgbaImage;
}

export interface NearbyBadge extends FoundBadge {
  proximity: ProximityInfo;
  /** Already in My badges. */
  saved?: SavedBadge;
}

export interface BadgeSetup {
  name?: string;
  use?: BadgeUse;
  orientation?: Orientation;
  /** Lock to this phone (needs firmware 0.4). On by default. */
  lock?: boolean;
  /** Draw "Hello" and the colour stripes, so the owner sees it's the right badge. */
  hello?: boolean;
}

export interface AddResult {
  badge: SavedBadge;
  /** The firmware is too old to lock; the badge was added unlocked. */
  lockUnsupported: boolean;
  /** The hello picture's refresh, when hello was asked for. */
  displayed?: Promise<DisplayOutcome>;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export interface ConnectionState {
  badgeId: string | null;
  status: ConnectionStatus;
  info?: TagInfo;
  error?: unknown;
}

export interface SendResult {
  item: LibraryItem;
  /** Settles when the refresh ends; never rejects. */
  displayed: Promise<DisplayOutcome>;
}

interface Settings {
  timings: Timings;
}

// ------------------------------------------------------------------ the service

export class InkTag {
  readonly badges: BadgeRegistry;
  readonly library: Library;
  private settings: Settings = { timings: DEFAULT_TIMINGS };
  private readonly settingsFile: JsonDoc<Settings>;
  private conn: { badgeId: string; client: TagClient; info: TagInfo; close: () => Promise<void> } | null =
    null;
  private connState: ConnectionState = { badgeId: null, status: 'idle' };
  private progress: SendProgress | null = null;
  /** Demo badges live as long as the app runs; their picture is kept in memory. */
  private readonly demoTags = new Map<string, FakeTag>();
  private listeners = new Set<() => void>();
  private connecting: Promise<unknown> | null = null;

  constructor(private readonly deps: InkTagDeps) {
    this.badges = new BadgeRegistry(deps.storage);
    this.library = new Library(deps.storage, { now: deps.now });
    this.settingsFile = new JsonDoc(deps.storage, 'settings.json', 1, () => ({ timings: DEFAULT_TIMINGS }));
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private log: Log = (kind, text) => this.deps.log?.(kind, text);

  async init() {
    await Promise.all([this.badges.load(), this.library.load()]);
    this.settings = await this.settingsFile.load();
    this.emit();
  }

  get bluetooth() {
    return !!this.deps.links;
  }

  // ------------------------------------------------------------ observing

  connection(): ConnectionState {
    return this.connState;
  }

  sending(): SendProgress | null {
    return this.progress;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    const a = this.badges.subscribe(l);
    const b = this.library.subscribe(l);
    return () => {
      this.listeners.delete(l);
      a();
      b();
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private setConn(s: ConnectionState) {
    this.connState = s;
    this.emit();
  }

  // ------------------------------------------------------------ finding and adding

  /** Badges nearby, nearest first, marked if already added. */
  async scan(
    opts: { timeoutMs?: number; signal?: AbortSignal; onUpdate?: (b: NearbyBadge[]) => void } = {},
  ): Promise<NearbyBadge[]> {
    if (!this.deps.links) throw new BluetoothError('no-native-module');
    const decorate = (list: FoundBadge[]) =>
      list.map(
        (b, i): NearbyBadge => ({ ...b, proximity: proximity(b.rssi, i === 0), saved: this.badges.get(b.id) }),
      );
    const found = await this.deps.links.scan({
      ...opts,
      onUpdate: opts.onUpdate && ((l) => opts.onUpdate!(decorate(l))),
    });
    const seen = this.now();
    for (const b of found) if (this.badges.get(b.id)) await this.badges.update(b.id, { lastSeenAt: seen });
    return decorate(found);
  }

  /** Adds a real badge found by scan(). */
  addBadge(found: Pick<FoundBadge, 'id' | 'name'>, setup: BadgeSetup = {}): Promise<AddResult> {
    return this.add({ id: found.id, kind: 'ble', advertisedName: found.name }, setup);
  }

  /** Adds a simulated badge: the whole app works with it, no hardware needed. */
  addDemoBadge(setup: BadgeSetup = {}): Promise<AddResult> {
    const id = `demo-${newId(this.now())}`;
    return this.add({ id, kind: 'demo', advertisedName: `InkTag-DEMO` }, { name: 'Demo badge', ...setup });
  }

  private async add(
    who: Pick<SavedBadge, 'id' | 'kind' | 'advertisedName'>,
    setup: BadgeSetup,
  ): Promise<AddResult> {
    const existing = this.badges.get(who.id);
    const badge: SavedBadge = existing ?? {
      ...who,
      name: setup.name?.trim() || this.badges.suggestName(),
      use: setup.use ?? 'lanyard',
      orientation: setup.orientation ?? 'portrait',
      addedAt: this.now(),
    };
    if (existing && setup.name) badge.name = setup.name.trim();

    // Connect before saving, so a badge locked to someone else is never added.
    const { client } = await this.open(badge);
    let { info } = this.conn!;
    let lockUnsupported = false;
    try {
      if (info.lock?.locked && !info.lock.authorized) {
        // Ours already (added again after "Forget" failed to reach it)? Else someone else's.
        if (!existing?.ownerKey) throw new LockedError();
        info = this.conn!.info = await client.authenticate(fromHex(existing.ownerKey));
      }
      const wantLock = setup.lock ?? true;
      if (wantLock && supportsLock(info)) {
        const key = this.deps.randomBytes(16);
        info = this.conn!.info = await client.lock(key);
        badge.ownerKey = toHex(key);
      } else if (wantLock) lockUnsupported = true;
    } catch (e) {
      await this.dropConnection();
      throw e;
    }
    badge.firmware = info.firmware;
    badge.lastConnectedAt = badge.lastSeenAt = this.now();
    badge.screen = checkScreen(info, null, this.now());
    await this.badges.put(badge);
    await this.badges.setCurrent(badge.id);
    this.setConn({ badgeId: badge.id, status: 'connected', info: this.conn!.info });

    let displayed: Promise<DisplayOutcome> | undefined;
    if (setup.hello ?? true) {
      const r = await this.send(badge.id, {
        scene: helloScene(badge.name, badge.orientation),
        style: 'poster',
        kind: 'template',
        title: 'Hello',
      });
      displayed = r.displayed;
    }
    return { badge: this.badges.get(badge.id)!, lockUnsupported, displayed };
  }

  // ------------------------------------------------------------ connecting

  /**
   * Connects to a saved badge (closing any other connection) and proves the
   * lock key. Updates firmware, last seen and the screen check.
   */
  async connect(badgeId: string): Promise<TagInfo> {
    const badge = this.badges.get(badgeId);
    if (!badge) throw new Error(`no badge ${badgeId}`);
    if (this.conn?.badgeId === badgeId && this.conn.client.connected) return this.conn.info;
    // One connect at a time; a second caller waits for the first.
    while (this.connecting) await this.connecting.catch(() => {});
    if (this.conn?.badgeId === badgeId && this.conn.client.connected) return this.conn.info;
    const p = this.doConnect(badge);
    this.connecting = p;
    try {
      return await p;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(badge: SavedBadge): Promise<TagInfo> {
    try {
      let { info } = await this.open(badge);
      const key = badge.ownerKey ? fromHex(badge.ownerKey) : null;
      const patch: Partial<SavedBadge> = {
        firmware: info.firmware,
        lastConnectedAt: this.now(),
        lastSeenAt: this.now(),
      };
      if (info.lock?.locked && !info.lock.authorized) {
        if (!key) throw new LockedError();
        info = await this.conn!.client.authenticate(key);
      } else if (info.lock && !info.lock.locked && key) {
        // Unlocked from the badge's button: the old key is useless now.
        this.log('info', 'badge was reset; it is no longer locked');
        patch.ownerKey = undefined;
      }
      this.conn!.info = info;
      patch.screen = checkScreen(info, null, this.now());
      // Keep a known-good result from a refresh over "unknown" from INFO alone.
      if (patch.screen.status === 'unknown' && badge.screen) patch.screen = badge.screen;
      await this.badges.update(badge.id, patch);
      await this.badges.setCurrent(badge.id);
      this.setConn({ badgeId: badge.id, status: 'connected', info });
      return info;
    } catch (e) {
      await this.dropConnection();
      this.setConn({ badgeId: badge.id, status: 'failed', error: e });
      throw e;
    }
  }

  /** Opens a link and says hello. Leaves this.conn set. */
  private async open(badge: Pick<SavedBadge, 'id' | 'kind'>): Promise<{ client: TagClient; info: TagInfo }> {
    await this.dropConnection();
    this.setConn({ badgeId: badge.id, status: 'connecting' });
    let opened: OpenLink;
    if (badge.kind === 'demo') {
      let tag = this.demoTags.get(badge.id);
      if (!tag) {
        tag = new FakeTag({ timing: this.deps.demoTiming ?? 'fast' });
        this.demoTags.set(badge.id, tag);
      }
      const link = new SimLink(tag, { bytesPerSecond: this.deps.demoTiming === 'instant' ? 0 : 24 * 1024 });
      await link.connect();
      const client = new TagClient(link, this.log);
      opened = { client, close: () => client.close() };
    } else {
      if (!this.deps.links) throw new BluetoothError('no-native-module');
      opened = await this.deps.links.open(badge.id, this.log);
    }
    try {
      let info: TagInfo;
      try {
        info = await opened.client.info();
      } catch (e) {
        // The first INFO can be lost if the notification subscription reached
        // the badge late. Ask once more before giving up.
        if (!(e instanceof TimeoutError)) throw e;
        this.log('info', 'no INFO yet, asking again');
        info = await opened.client.info();
      }
      if (info.protocol !== PROTOCOL_VERSION) throw new UnsupportedProtocolError(info.protocol);
      this.conn = { badgeId: badge.id, client: opened.client, info, close: opened.close };
      opened.client.link.onDisconnect(() => {
        if (this.conn?.client === opened.client) {
          this.conn = null;
          this.setConn({ badgeId: badge.id, status: 'idle' });
        }
      });
      return { client: opened.client, info };
    } catch (e) {
      await opened.close().catch(() => {});
      throw e;
    }
  }

  private async dropConnection() {
    const c = this.conn;
    this.conn = null;
    if (c) await c.close().catch(() => {});
  }

  /**
   * At launch: reconnects to the badge used last, if it is nearby. Resolves
   * false (without throwing) when it isn't, so Home can show "Not nearby".
   */
  async reconnect(timeoutMs = 8_000): Promise<boolean> {
    const badge = this.badges.current();
    if (!badge) return false;
    if (badge.kind === 'ble') {
      if (!this.deps.links) return false;
      let heard = false;
      const ctl = new AbortController();
      try {
        await this.deps.links.scan({
          timeoutMs,
          signal: ctl.signal,
          onUpdate: (l) => {
            if (l.some((b) => b.id === badge.id)) {
              heard = true;
              ctl.abort();
            }
          },
        });
      } catch {
        return false;
      }
      if (!heard) return false;
    }
    try {
      await this.connect(badge.id);
      return true;
    } catch {
      return false;
    }
  }

  async disconnect() {
    await this.dropConnection();
    this.setConn({ badgeId: null, status: 'idle' });
  }

  private async client(badgeId: string): Promise<TagClient> {
    await this.connect(badgeId);
    return this.conn!.client;
  }

  // ------------------------------------------------------------ pictures

  /**
   * Draws and dithers a design: what the badge will show, before sending.
   * Used for the Photo / On badge toggle.
   */
  async prepare(design: Pick<Design, 'scene' | 'style'>): Promise<Prepared> {
    const { renderer } = this.deps;
    const ops = compile(design.scene, renderer.measure);
    const rendered = await renderer.draw(design.scene, ops, (id) => this.library.photo(id));
    const converted = convertFitted(rendered, {
      orientation: design.scene.orientation,
      dither: STYLES[design.style].dither,
    });
    return { converted, rendered };
  }

  /**
   * A library item's thumbnail (PNG) in the app's screen inks. Items saved
   * before those existed are repainted from their stored frame once.
   */
  async thumbnail(itemId: string): Promise<Uint8Array | null> {
    const item = this.library.get(itemId);
    if (!item) return null;
    if ((item.previewVersion ?? 1) >= PREVIEW_VERSION) return this.library.preview(itemId);
    const frame = await this.library.frame(itemId);
    const { renderer } = this.deps;
    if (!frame || !renderer.encodePreview) return this.library.preview(itemId);
    try {
      const png = await renderer.encodePreview(frameToRgba(frame, item.scene.orientation, undefined, SCREEN_PALETTE));
      await this.library.setPreview(itemId, png);
      return png;
    } catch {
      return this.library.preview(itemId);
    }
  }

  /**
   * Sends a new design, or a library item again. Resolves when the badge has
   * stored the picture (safe to walk away); `displayed` follows after the
   * refresh. Progress is reported through onProgress and sending().
   */
  async send(
    badgeId: string,
    what: Design | { itemId: string },
    opts: { onProgress?: (p: SendProgress) => void; signal?: AbortSignal; prepared?: Prepared } = {},
  ): Promise<SendResult> {
    const badge = this.badges.get(badgeId);
    if (!badge) throw new Error(`no badge ${badgeId}`);
    const connected = this.conn?.badgeId === badgeId && this.conn.client.connected;
    const tracker = new ProgressTracker(this.settings.timings, {
      total: 0,
      temperature: badge.kind === 'ble' ? this.conn?.info.temperature : null,
      connected,
      now: this.deps.now,
      onChange: (p) => {
        this.progress = p;
        opts.onProgress?.(p);
        this.emit();
      },
    });
    tracker.enter('preparing');
    try {
      // 1. The frame: from the library, or drawn now and added to it.
      let item: LibraryItem;
      let frame: Uint8Array;
      if ('itemId' in what) {
        const found = this.library.get(what.itemId);
        const bytes = found && (await this.library.frame(found.id));
        if (!found || !bytes) throw new Error('That picture is no longer in the library.');
        item = found;
        frame = bytes;
      } else {
        const prepared = opts.prepared ?? (await this.prepare(what));
        const { converted } = prepared;
        frame = converted.frame;
        const preview = await this.deps.renderer.encodePreview?.(converted.display).catch(() => undefined);
        item = await this.library.add(
          {
            kind: what.kind,
            title: what.title,
            template: what.template,
            scene: what.scene,
            style: what.style,
            crc32: converted.crc32,
            previewVersion: preview ? PREVIEW_VERSION : undefined,
          },
          frame,
          preview,
        );
      }
      tracker.bytes(0, frame.length);

      // 2. Connected and authorized.
      tracker.enter('connecting');
      const client = await this.client(badgeId);

      // 3. Upload: erase, send, verify.
      const up = await client.upload(frame, {
        signal: opts.signal,
        onStage: (s, attempt) => tracker.enter(s, attempt),
        onProgress: (sent, total) => tracker.bytes(sent, total),
      });

      // 4. Stored: record it, then follow the refresh.
      tracker.enter('refreshing');
      await this.library.recordSend(item.id, badgeId);
      await this.badges.update(badgeId, { shownItemId: item.id, shownAt: this.now() });
      const displayed = up.displayed.then(async (outcome) => {
        tracker.enter(outcome.status === 'failed' ? 'failed' : 'done');
        if (outcome.status === 'displayed') {
          this.settings.timings = tracker.learned();
          await this.settingsFile.save(this.settings).catch(() => {});
        }
        if (this.badges.get(badgeId))
          await this.badges
            .update(badgeId, { screen: checkScreen(this.conn?.info ?? null, outcome, this.now()) })
            .catch(() => {});
        return outcome;
      });
      return { item, displayed };
    } catch (e) {
      tracker.enter('failed');
      if (e instanceof UploadError && e.badgeBlank)
        await this.badges.update(badgeId, { shownItemId: undefined, shownAt: undefined }).catch(() => {});
      throw e;
    }
  }

  /** Redraws the stored picture. */
  async redraw(badgeId: string): Promise<DisplayOutcome> {
    const client = await this.client(badgeId);
    const outcome = await settle(client.show());
    await this.badges.update(badgeId, { screen: checkScreen(this.conn?.info ?? null, outcome, this.now()) });
    if (outcome.status === 'failed') throw outcome.error;
    return outcome;
  }

  /** Fills the screen with one colour (white by default). The stored picture is kept. */
  async blank(badgeId: string, color: ColorName = 'white'): Promise<DisplayOutcome> {
    const client = await this.client(badgeId);
    const outcome = await settle(client.clear(Color[color]));
    await this.badges.update(badgeId, {
      shownItemId: undefined,
      shownAt: this.now(),
      screen: checkScreen(this.conn?.info ?? null, outcome, this.now()),
    });
    if (outcome.status === 'failed') throw outcome.error;
    return outcome;
  }

  // ------------------------------------------------------------ badge settings

  async rename(badgeId: string, name: string) {
    if (!name.trim()) return;
    await this.badges.update(badgeId, { name: name.trim() });
  }

  async setUse(badgeId: string, use: BadgeUse) {
    await this.badges.update(badgeId, { use });
  }

  async setOrientation(badgeId: string, orientation: Orientation) {
    await this.badges.update(badgeId, { orientation });
  }

  /**
   * "Only my phone can change it". On: a new key (also how the key is
   * changed). Off: the badge forgets the key and any phone can use it.
   */
  async setLocked(badgeId: string, on: boolean): Promise<TagInfo> {
    const client = await this.client(badgeId);
    if (!supportsLock(this.conn!.info))
      throw new Error('This badge needs firmware 0.4 or newer to lock.');
    if (on) {
      const key = this.deps.randomBytes(16);
      const info = await client.lock(key);
      await this.badges.update(badgeId, { ownerKey: toHex(key) });
      this.conn!.info = info;
      return info;
    }
    const info = await client.unlock();
    await this.badges.update(badgeId, { ownerKey: undefined });
    this.conn!.info = info;
    return info;
  }

  /**
   * Removes a badge from this phone. If it's nearby and locked to this phone,
   * it is unlocked first so it can be added to another phone; if it isn't
   * reachable it stays locked (the button reset still works).
   */
  async forget(badgeId: string): Promise<{ unlocked: boolean }> {
    const badge = this.badges.get(badgeId);
    if (!badge) return { unlocked: false };
    let unlocked = !badge.ownerKey;
    if (badge.ownerKey) {
      try {
        const client = await this.client(badgeId);
        if (this.conn?.info.lock?.locked) await client.unlock();
        unlocked = true;
      } catch {
        unlocked = false;
      }
    }
    if (this.conn?.badgeId === badgeId) await this.disconnect();
    this.demoTags.delete(badgeId);
    await this.badges.remove(badgeId);
    return { unlocked };
  }

  /** Asks the badge again and updates its screen check. */
  async checkScreen(badgeId: string): Promise<ScreenCheck> {
    const client = await this.client(badgeId);
    const info = await client.info();
    this.conn!.info = info;
    const prev = this.badges.get(badgeId)?.screen;
    let s = checkScreen(info, null, this.now());
    if (s.status === 'unknown' && prev && prev.status !== 'not-answering') s = { ...prev, checkedAt: this.now() };
    await this.badges.update(badgeId, { screen: s });
    return s;
  }

  /** Demo badges only: the simulated badge, for showing its screen in demo mode. */
  demoTag(badgeId: string): FakeTag | undefined {
    return this.demoTags.get(badgeId);
  }
}

async function settle(p: Promise<number | null>): Promise<DisplayOutcome> {
  try {
    return { status: 'displayed', temperature: await p };
  } catch (e) {
    if (e instanceof TagError) return { status: 'failed', error: e };
    if (e instanceof TimeoutError) return { status: 'unknown', reason: 'timeout' };
    if (e instanceof DisconnectedError) return { status: 'unknown', reason: 'disconnected' };
    throw e;
  }
}
