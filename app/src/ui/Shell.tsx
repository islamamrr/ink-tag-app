// The app's frame: first run, the four tabs, and which screen each route
// shows. A photo shared from another app opens the photo editor.

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DebugScreen from '../screens/DebugScreen';
import { importPhoto } from '../services/inkTag';
import { useSharedPhoto } from '../services/share';
import { Btn, G, Loading, Problem, Screen } from './kit';
import { type Route, type Tab, useNav } from './nav';
import { BadgePage, BadgeTab, SetupScreen, Welcome } from './screens/badge';
import { GalleryScreen, ItemScreen } from './screens/gallery';
import { PhotoScreen } from './screens/photo';
import { SendScreen } from './screens/send';
import { AboutScreen, HelpScreen, SettingsScreen } from './screens/settings';
import { PackScreen, SearchScreen, TemplatePreview, TemplatesHome } from './screens/templates';
import { BoardScreen, FormScreen, ListScreen, LiveScreen } from './screens/useTemplate';
import { useServices } from './services';

function RouteView({ tab, route }: { tab: Tab; route: Route }) {
  const nav = useNav();
  switch (route.name) {
    case 'root':
      return tab === 'templates' ? <TemplatesHome /> : tab === 'gallery' ? <GalleryScreen /> : tab === 'badge' ? <BadgeTab /> : <SettingsScreen />;
    case 'pack':
      return <PackScreen id={route.id} />;
    case 'search':
      return <SearchScreen />;
    case 'template':
      return <TemplatePreview id={route.id} />;
    case 'form':
      return <FormScreen id={route.id} values={route.values} layout={route.layout} />;
    case 'list':
      return <ListScreen id={route.id} />;
    case 'board':
      return <BoardScreen id={route.id} />;
    case 'live':
      return <LiveScreen id={route.id} />;
    case 'photo':
      return <PhotoScreen photo={route.photo} scene={route.scene} style={route.style} fromShare={route.fromShare} />;
    case 'send':
      return <SendScreen design={route.design} itemId={route.itemId} />;
    case 'item':
      return <ItemScreen id={route.id} />;
    case 'badgePage':
      return <BadgePage id={route.id} />;
    case 'setup':
      return <SetupScreen onClose={nav.pop} />;
    case 'help':
      return <HelpScreen />;
    case 'about':
      return <AboutScreen />;
    case 'debug':
      return <DebugRoute />;
  }
}

/** The old test screen holds its own Bluetooth connection, so the app lets go first. */
function DebugRoute() {
  const { app } = useServices();
  const nav = useNav();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    app.disconnect().finally(() => setReady(true));
  }, [app]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12 }}>
        <Btn kind="ghost" label="‹ Back to the app" onPress={nav.pop} />
      </View>
      {ready ? <DebugScreen /> : <Loading label="Disconnecting…" />}
    </View>
  );
}

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'templates', label: 'Templates' },
  { tab: 'gallery', label: 'Gallery' },
  { tab: 'badge', label: 'My badge' },
  { tab: 'settings', label: 'Settings' },
];

function TabBar() {
  const nav = useNav();
  const { app } = useServices();
  const many = app.badges.list().length > 1;
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 2, borderTopColor: G.ink, backgroundColor: G.white, paddingTop: 6, paddingHorizontal: 6 }}>
      {TABS.map(({ tab, label }) => {
        const on = nav.tab === tab;
        return (
          <Pressable
            key={tab}
            onPress={() => (on ? nav.home(tab) : nav.setTab(tab))}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? G.ink : G.muted, backgroundColor: on ? G.ink : 'transparent' }} />
            <Text style={{ fontSize: 12, fontWeight: on ? '700' : '600', color: on ? G.ink : G.muted }}>{tab === 'badge' && many ? 'Badges' : label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Shell() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const { app, state } = useServices();
  const { photo, clear } = useSharedPhoto();
  const [setupOpen, setSetupOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // "Send from Photos": import the picture and open the editor on Templates.
  useEffect(() => {
    if (!photo) return;
    importPhoto(photo.uri)
      .then((id) => {
        nav.home('templates');
        nav.push({ name: 'photo', photo: id, fromShare: true });
      })
      .catch((e) => setShareError(String(e?.message ?? e)))
      .finally(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const firstRun = !state.prefs().welcomed && app.badges.list().length === 0;
  const frame = (child: React.ReactNode) => <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: G.white }}>{child}</View>;

  if (firstRun)
    return frame(setupOpen ? <SetupScreen onClose={() => setSetupOpen(false)} /> : <Welcome onSetup={() => setSetupOpen(true)} />);

  return frame(
    <>
      {shareError && (
        <Screen scroll={false}>
          <Problem title="Couldn't open the shared picture" action="OK" onAction={() => setShareError(null)}>
            {shareError}
          </Problem>
        </Screen>
      )}
      {!shareError && (
        // The whole stack stays mounted (only the top shows), so going back
        // finds a screen as it was left.
        <View key={nav.tab} style={{ flex: 1 }}>
          {nav.stack.map((r, i) => (
            <View key={`${i}:${r.name}:${'id' in r ? r.id : ''}`} style={{ flex: 1, display: i === nav.depth - 1 ? 'flex' : 'none' }}>
              <RouteView tab={nav.tab} route={r} />
            </View>
          ))}
        </View>
      )}
      {nav.depth === 1 && <TabBar />}
    </>,
  );
}
