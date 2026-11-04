import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaView, View } from 'react-native';

import DebugScreen from './src/screens/DebugScreen';
import { Btn, Row } from './src/screens/devUi';
import V1Screen from './src/screens/V1Screen';
import { getInkTag } from './src/services/inkTag';
import { useSharedPhoto } from './src/services/share';

// Two developer screens until the product UI lands: "v1" drives the v1
// service layer (badges, create, library); "Test" is the low-level badge
// test screen. Only one of them holds the Bluetooth connection at a time.
export default function App() {
  const [screen, setScreen] = useState<'v1' | 'test'>('v1');
  const { photo, clear } = useSharedPhoto();

  // A photo shared from another app always opens the v1 screen.
  const shown = photo ? 'v1' : screen;

  const switchTo = async (next: 'v1' | 'test') => {
    if (next === shown) return;
    if (shown === 'v1') await (await getInkTag().catch(() => null))?.disconnect();
    setScreen(next);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
      <View style={{ paddingTop: 40, paddingHorizontal: 12 }}>
        <Row>
          <Btn label="v1" kind={shown === 'v1' ? 'primary' : 'quiet'} onPress={() => switchTo('v1')} />
          <Btn label="Test" kind={shown === 'test' ? 'primary' : 'quiet'} onPress={() => switchTo('test')} />
        </Row>
      </View>
      {shown === 'v1' ? <V1Screen shared={photo} onSharedUsed={clear} /> : <DebugScreen />}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}
