// Starts the app's services once and re-renders the screens when anything
// they show changes (badges, library, connection, sends, settings, live).
// Also: reconnect to the badge at launch, and keep a live template going
// when the app comes back to the foreground.

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';

import { type SavedBadge, userMessage } from '../core';
import { appLog, getServices, type Services } from '../services/app';
import { Loading, Problem, Screen } from './kit';

interface Ctx extends Services {
  version: number;
  /** The badge the app is working with (the one used last). */
  badge: SavedBadge | undefined;
  connected: boolean;
  /** Launch reconnect finished (true even if the badge wasn't found). */
  reconnectTried: boolean;
}

const ServicesContext = createContext<Ctx | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [svc, setSvc] = useState<Services | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [reconnectTried, setReconnectTried] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    let unsubs: (() => void)[] = [];
    getServices()
      .then((s) => {
        setSvc(s);
        const bump = () => setVersion((n) => n + 1);
        unsubs = [s.app.subscribe(bump), s.state.subscribe(bump), s.live.subscribe(bump)];
      })
      .catch(setError);
    return () => unsubs.forEach((u) => u());
  }, []);

  // Launch: reconnect, then pick up the live template if one was running.
  useEffect(() => {
    if (!svc || started.current) return;
    started.current = true;
    (async () => {
      if (svc.state.prefs().connectOnOpen && svc.app.badges.current()) {
        const ok = await svc.app.reconnect().catch(() => false);
        appLog(`launch reconnect: ${ok ? 'connected' : 'not nearby'}`);
      }
      setReconnectTried(true);
      const job = svc.state.live();
      if (job) await svc.live.resume(job).catch((e) => appLog(`live resume: ${userMessage(e)}`));
    })();
  }, [svc]);

  // Timers stop in the background: pause, and catch up on return.
  useEffect(() => {
    if (!svc) return;
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') void svc.live.resume();
      else if (s === 'background') svc.live.pause();
    });
    return () => sub.remove();
  }, [svc]);

  if (error)
    return (
      <Screen title="Ink Tag">
        <Problem title="Ink Tag couldn't start">{userMessage(error)}</Problem>
      </Screen>
    );
  if (!svc) return <Loading label="Starting Ink Tag…" />;

  const badge = svc.app.badges.current();
  const conn = svc.app.connection();
  const value: Ctx = {
    ...svc,
    version,
    badge,
    connected: !!badge && conn.badgeId === badge.id && conn.status === 'connected',
    reconnectTried,
  };
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Ctx {
  const c = useContext(ServicesContext);
  if (!c) throw new Error('useServices outside ServicesProvider');
  return c;
}

/** "just now", "12 min ago", "2 h ago", "3 days ago". */
export function ago(t?: number, now = Date.now()) {
  if (!t) return 'never';
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
