// The app's frame: first run, the four tabs, and which screen each route
// shows. A photo shared from another app opens the photo editor.

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DebugScreen from '../screens/DebugScreen';
import { importPhoto } from '../services/inkTag';
import { useSharedPhoto } from '../services/share';
import { Btn, FrameContext, Loading, Problem, Screen } from './kit';
import { Icon, type IconName } from './print';
import { type Route, type Tab, useNav } from './nav';
import { BadgePage, BadgeTab, SetupScreen, Welcome } from './screens/badge';
import { GalleryScreen, ItemScreen } from './screens/gallery';
import { PhotoScreen } from './screens/photo';
import { SendScreen } from './screens/send';
import { AboutScreen, HelpScreen, SettingsScreen } from './screens/settings';
import { PackScreen, SearchScreen, TemplatePreview, TemplatesHome } from './screens/templates';
import { BoardScreen, FormScreen, ListScreen, LiveScreen } from './screens/useTemplate';
import { useServices } from './services';
import { FONT, INK } from './theme';

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
      return <SendScreen design={route.design} itemId={route.itemId} flood={route.flood} />;
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
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ paddingHorizontal: 12 }}>
        <Btn kind="ghost" label="Back to the app" onPress={nav.pop} />
      </View>
      {ready ? <DebugScreen /> : <Loading label="Disconnecting…" />}
    </View>
  );
}

const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'templates', label: 'Print', icon: 'print' },
  { tab: 'gallery', label: 'Gallery', icon: 'gallery' },
  { tab: 'badge', label: 'My badge', icon: 'badge' },
  { tab: 'settings', label: 'Settings', icon: 'settings' },
];

/** Paper, a black rule on top; the open tab is a yellow pill with a blue shadow. */
function TabBar() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { app } = useServices();
  const many = app.badges.list().length > 1;
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 2, borderTopColor: INK.black, backgroundColor: INK.paper, paddingTop: 8, paddingBottom: 6 + insets.bottom }}
    >
      {TABS.map(({ tab, label, icon }) => {
        const on = nav.tab === tab;
        return (
          <Pressable
            key={tab}
            onPress={() => (on ? nav.home(tab) : nav.setTab(tab))}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <View style={{ width: 56, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              {on && <View style={{ position: 'absolute', left: 3, top: 2, width: 56, height: 32, borderRadius: 16, backgroundColor: INK.blue }} />}
              {on && <View style={{ position: 'absolute', left: 0, top: 0, width: 56, height: 32, borderRadius: 16, backgroundColor: INK.yellow }} />}
              <Icon name={icon} size={21} color={on ? INK.black : INK.muted} stroke={on ? 2.3 : 2} />
            </View>
            <Text style={{ fontFamily: on ? FONT.heavy : FONT.bold, fontSize: 16, color: on ? INK.black : INK.muted, includeFontPadding: false }}>{tab === 'badge' && many ? 'Badges' : label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const ROOT = { active: true, bottom: false };
const DEEP = { active: true, bottom: true };
const HIDDEN = { active: false, bottom: true };

export default function Shell() {
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
  const frame = (child: React.ReactNode) => <View style={{ flex: 1, backgroundColor: INK.paper }}>{child}</View>;

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
              {/* The tab's first screen sits above the tab bar; deeper ones own the bottom edge. */}
              <FrameContext.Provider value={i === nav.depth - 1 ? (i === 0 ? ROOT : DEEP) : HIDDEN}>
                <RouteView tab={nav.tab} route={r} />
              </FrameContext.Provider>
            </View>
          ))}
        </View>
      )}
      {nav.depth === 1 && <TabBar />}
    </>,
  );
}
