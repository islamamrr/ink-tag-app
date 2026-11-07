import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavProvider } from './src/ui/nav';
import { ServicesProvider } from './src/ui/services';
import Shell from './src/ui/Shell';

// The wireframe product UI: four tabs (Templates, Gallery, My badge,
// Settings) in plain greys, on top of the v1 service layer in src/core.
// The low-level badge test screen is under Settings › For testing.
export default function App() {
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
