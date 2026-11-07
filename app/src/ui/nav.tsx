// Four tabs, each with its own stack of screens, and Android's back button.
// Small on purpose: no navigation library (and no new native code) for the
// wireframe build. Moving to Expo Router later means turning each Route
// below into a file under src/app/.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

import type { Design, PictureStyle, Scene } from '../core';

export type Tab = 'templates' | 'gallery' | 'badge' | 'settings';

export type Route =
  | { name: 'root' }
  | { name: 'pack'; id: string }
  | { name: 'search' }
  | { name: 'template'; id: string }
  | { name: 'form'; id: string; values?: Record<string, string | boolean | undefined>; layout?: number }
  | { name: 'list'; id: string }
  | { name: 'board'; id: string }
  | { name: 'live'; id: string }
  | { name: 'photo'; photo?: string; scene?: Scene; style?: PictureStyle; fromShare?: boolean }
  | { name: 'send'; design?: Design; itemId?: string }
  | { name: 'item'; id: string }
  | { name: 'badgePage'; id: string }
  | { name: 'setup' }
  | { name: 'help' }
  | { name: 'about' }
  | { name: 'debug' };

interface NavState {
  tab: Tab;
  stacks: Record<Tab, Route[]>;
}

export interface Nav {
  tab: Tab;
  route: Route;
  /** The current tab's screens, first to last. */
  stack: Route[];
  depth: number;
  push(r: Route): void;
  pop(): void;
  replace(r: Route): void;
  /** Back to the tab's first screen. */
  home(tab?: Tab): void;
  setTab(t: Tab): void;
  /** A one-line confirmation shown on the next screen ("On your badge."). */
  notice: string | null;
  setNotice(n: string | null): void;
}

const NavContext = createContext<Nav | null>(null);

const root = (): Route[] => [{ name: 'root' }];

export function NavProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [st, setSt] = useState<NavState>({
    tab: 'templates',
    stacks: { templates: root(), gallery: root(), badge: root(), settings: root() },
  });

  const update = useCallback((fn: (stack: Route[]) => Route[], tab?: Tab) => {
    setSt((s) => {
      const t = tab ?? s.tab;
      return { tab: t, stacks: { ...s.stacks, [t]: fn(s.stacks[t]) } };
    });
  }, []);

  const nav = useMemo((): Nav => {
    const stack = st.stacks[st.tab];
    return {
      tab: st.tab,
      route: stack[stack.length - 1],
      stack,
      depth: stack.length,
      push: (r) => update((s) => [...s, r]),
      pop: () => update((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      replace: (r) => update((s) => [...s.slice(0, -1), r]),
      home: (tab) => update(() => root(), tab),
      setTab: (t) => setSt((s) => ({ ...s, tab: t })),
      notice,
      setNotice,
    };
  }, [st, update, notice]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.depth > 1) {
        nav.pop();
        return true;
      }
      if (nav.tab !== 'templates') {
        nav.setTab('templates');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [nav]);

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavProvider');
  return n;
}
