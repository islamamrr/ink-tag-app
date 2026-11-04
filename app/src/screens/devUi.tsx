// Plain building blocks for the developer screen. Deliberately unstyled
// beyond legibility: the product UI is designed separately.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  disabled,
  kind = 'normal',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'normal' | 'primary' | 'danger' | 'quiet';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        kind === 'quiet' && s.btnQuiet,
        pressed && s.btnPressed,
        disabled && s.btnDisabled,
      ]}
    >
      <Text style={[s.btnText, kind === 'quiet' && s.btnQuietText]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({
  tone,
  title,
  children,
  onClose,
}: {
  tone: 'error' | 'warn' | 'ok' | 'info';
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <View style={[s.banner, s[tone]]}>
      <View style={s.cardHead}>
        <Text style={s.bannerTitle}>{title}</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }]} />
    </View>
  );
}

/** "label: value" line; value in monospace. */
export function KV({ k, v, tone }: { k: string; v: string; tone?: 'bad' | 'good' }) {
  return (
    <Text style={s.kv}>
      <Text style={s.k}>{k} </Text>
      <Text style={[s.v, tone === 'bad' && s.bad, tone === 'good' && s.good]}>{v}</Text>
    </Text>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  card: { backgroundColor: 'white', borderRadius: 8, padding: 12, gap: 8, borderWidth: 1, borderColor: '#ddd' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#333', textTransform: 'uppercase' },
  btn: { backgroundColor: '#1d3557', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 6 },
  btnPrimary: { backgroundColor: '#2a9d8f' },
  btnDanger: { backgroundColor: '#b23a48' },
  btnQuiet: { backgroundColor: '#e9ecef' },
  btnPressed: { opacity: 0.7 },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: 'white', fontWeight: '600' },
  btnQuietText: { color: '#1d3557' },
  banner: { borderRadius: 8, padding: 12, gap: 4, borderWidth: 1 },
  error: { backgroundColor: '#fde8ea', borderColor: '#e5a3ab' },
  warn: { backgroundColor: '#fff4d6', borderColor: '#e8c66a' },
  ok: { backgroundColor: '#e3f6ec', borderColor: '#8fd1ac' },
  info: { backgroundColor: '#e7f0fb', borderColor: '#9dbbe3' },
  bannerTitle: { fontWeight: '700', flexShrink: 1, color: '#222' },
  close: { fontSize: 16, color: '#555' },
  small: { fontSize: 12, color: '#555' },
  body: { color: '#222' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#222' },
  barTrack: { height: 10, backgroundColor: '#e9ecef', borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: '#2a9d8f' },
  kv: { fontSize: 13 },
  k: { color: '#666' },
  v: { fontFamily: 'monospace', color: '#222' },
  bad: { color: '#b23a48', fontWeight: '700' },
  good: { color: '#217a4b' },
});
