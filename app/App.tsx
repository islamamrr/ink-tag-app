import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavProvider } from './src/ui/nav';
import { ServicesProvider } from './src/ui/services';
import Shell from './src/ui/Shell';
import { FONT, INK } from './src/ui/theme';

// The product UI in riso print (design/riso-style.md): four tabs (Print,
// Gallery, My badge, Settings) on top of the v1 service layer in src/core.
// The low-level badge test screen is under Settings › For testing.
export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    [FONT.display]: require('./assets/fonts/RubikMonoOne-Regular.ttf'),
    [FONT.bold]: require('./assets/fonts/DarkerGrotesque-Bold.ttf'),
    [FONT.heavy]: require('./assets/fonts/DarkerGrotesque-ExtraBold.ttf'),
    [FONT.black]: require('./assets/fonts/DarkerGrotesque-Black.ttf'),
    [FONT.mono]: require('./assets/fonts/SpaceMono-Regular.ttf'),
    [FONT.monoBold]: require('./assets/fonts/SpaceMono-Bold.ttf'),
  });
  // Without its fonts the app still works, in the phone's own type.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: INK.paper }} />;
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <NavProvider>
          <Shell />
        </NavProvider>
      </ServicesProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
