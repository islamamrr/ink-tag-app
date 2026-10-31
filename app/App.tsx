import { StatusBar } from 'expo-status-bar';

import DebugScreen from './src/screens/DebugScreen';

export default function App() {
  return (
    <>
      <DebugScreen />
      <StatusBar style="auto" />
    </>
  );
}
