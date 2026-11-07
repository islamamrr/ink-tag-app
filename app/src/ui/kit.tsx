// The wireframe UI kit: black, white and greys only, so the flow can be
// tested before the visual design. Pictures for the badge keep their six
// colours; everything around them is grey. Swap these pieces for the real
// design later; screens only use what's here.

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const G = {
  ink: '#1a1a1a',
  text: '#333333',
  muted: '#555555',
  line: '#e3e3e3',
  mid: '#8a8a8a',
  soft: '#d6d6d6',
  pale: '#f4f4f4',
  chipOn: '#e4e4e4',
  white: '#ffffff',
};

// ------------------------------------------------------------------ layout

/** A screen: optional header, scrolling body, optional footer pinned at the bottom. */
export function Screen({
  title,
  back,
  onBack,
  right,
  children,
  footer,
  scroll = true,
  pad = true,
}: {
  title?: string;
  back?: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  pad?: boolean;
}) {
  const body = pad ? s.body : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: G.white }}>
      {(title || onBack || right) && (
        <View style={s.header}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12} style={s.backBtn} accessibilityRole="button">
              <Text style={s.backText}>‹ {back ?? 'Back'}</Text>
            </Pressable>
          ) : null}
          {title ? (
            <Text style={[s.h1, onBack && { fontSize: 18 }, { flex: 1 }]} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {right}
        </View>
      )}
      {scroll ? (
        <ScrollView contentContainerStyle={[body, { gap: 14, paddingBottom: 32 }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, gap: 14 }, body]}>{children}</View>
      )}
      {footer && <View style={s.footer}>{footer}</View>}
    </View>
  );
}

export function Row({ children, gap = 8, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Col({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// ------------------------------------------------------------------ text

export const H = ({ children, size = 24 }: { children: ReactNode; size?: number }) => (
  <Text style={[s.h1, { fontSize: size }]}>{children}</Text>
);
export const T = ({ children, muted, bold, center, size }: { children: ReactNode; muted?: boolean; bold?: boolean; center?: boolean; size?: number }) => (
  <Text style={[s.t, muted && s.muted, bold && { fontWeight: '700', color: G.ink }, center && { textAlign: 'center' }, size ? { fontSize: size } : null]}>
    {children}
  </Text>
);
export const Label = ({ children }: { children: ReactNode }) => <Text style={s.label}>{children}</Text>;

// ------------------------------------------------------------------ controls

export function Btn({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  busy,
  flex,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  flex?: boolean;
  small?: boolean;
}) {
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        small && { minHeight: 40, paddingHorizontal: 12 },
        primary && s.btnPrimary,
        kind === 'ghost' && s.btnGhost,
        kind === 'danger' && s.btnDanger,
        flex && { flex: 1 },
        pressed && { opacity: 0.7 },
        (disabled || busy) && { opacity: 0.4 },
      ]}
    >
      {busy && <ActivityIndicator color={primary ? G.white : G.ink} size="small" />}
      <Text style={[s.btnText, primary && { color: G.white }, kind === 'ghost' && { textDecorationLine: 'underline' }, small && { fontSize: 14 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

export function Chips<V extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V | undefined;
  onChange: (v: V) => void;
}) {
  return (
    <Row wrap gap={6}>
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </Row>
  );
}

/** A horizontally scrolling chip row. */
export function ChipStrip({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {children}
    </ScrollView>
  );
}

export function Field({ label, ...p }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={s.small}>{label}</Text>}
      <TextInput placeholderTextColor={G.mid} {...p} style={[s.field, p.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 10 }]} />
    </View>
  );
}

/** A settings-style row: label (and detail) on the left, a value or control on the right. */
export function ListRow({
  label,
  detail,
  value,
  onPress,
  right,
  last,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  last?: boolean;
}) {
  const inner = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {detail ? <Text style={s.small}>{detail}</Text> : null}
      </View>
      {right}
      {value !== undefined || onPress ? (
        <Text style={s.small}>
          {value ?? ''}
          {onPress ? ' ›' : ''}
        </Text>
      ) : null}
    </>
  );
  const style = [s.row, last && { borderBottomWidth: 0 }];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: G.pale }]} accessibilityRole="button">
      {inner}
    </Pressable>
  ) : (
    <View style={style}>{inner}</View>
  );
}

export function ToggleRow({ label, detail, value, onChange, disabled }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <ListRow
      label={label}
      detail={detail}
      right={<Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: G.ink, false: G.soft }} thumbColor={G.white} />}
    />
  );
}

// ------------------------------------------------------------------ boxes

/** "What happened, what's still true, what to do": every problem uses this box. */
export function Problem({ title, children, action, onAction, onClose }: { title: string; children?: ReactNode; action?: string; onAction?: () => void; onClose?: () => void }) {
  return (
    <View style={s.problem}>
      <Row>
        <Text style={[s.rowLabel, { flex: 1, fontWeight: '700' }]}>{title}</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Text style={s.muted}>✕</Text>
          </Pressable>
        )}
      </Row>
      {typeof children === 'string' ? <Text style={s.small}>{children}</Text> : children}
      {action && onAction && <Btn label={action} onPress={onAction} small />}
    </View>
  );
}

/** A quiet confirmation line ("On your badge. Sent in 26 s."). */
export function Note({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <View style={s.note}>
      <Text style={[s.t, { flex: 1 }]}>{children}</Text>
      {onClose && (
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
          <Text style={s.muted}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const st = [s.card, style];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [st, pressed && { backgroundColor: G.pale }]} accessibilityRole="button">
      {children}
    </Pressable>
  ) : (
    <View style={st}>{children}</View>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }]} />
    </View>
  );
}

/** Striped placeholder where a picture will be. */
export function Placeholder({ style, label }: { style?: ViewStyle; label?: string }) {
  return (
    <View style={[s.placeholder, style]}>
      {label ? <Text style={[s.small, { textAlign: 'center' }]}>{label}</Text> : null}
    </View>
  );
}

/** A bottom sheet over the screen. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={s.dim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: 22 + insets.bottom }]}>
        <View style={s.grab} />
        {title && <H size={20}>{title}</H>}
        {children}
      </View>
    </Modal>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
      <ActivityIndicator color={G.ink} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, minHeight: 52 },
  backBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 4 },
  backText: { fontSize: 16, fontWeight: '600', color: G.ink, textDecorationLine: 'underline' },
  body: { paddingHorizontal: 20, paddingTop: 6 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, gap: 10, borderTopWidth: 1.5, borderTopColor: G.line, backgroundColor: G.white },
  h1: { fontSize: 24, fontWeight: '800', color: G.ink, letterSpacing: -0.2 },
  t: { fontSize: 15, lineHeight: 21, color: G.text },
  muted: { color: G.muted },
  small: { fontSize: 13, lineHeight: 18, color: G.muted },
  label: { fontSize: 11.5, fontWeight: '700', color: G.muted, letterSpacing: 1, textTransform: 'uppercase' },
  btn: {
    minHeight: 48,
    borderWidth: 2,
    borderColor: G.ink,
    borderRadius: 12,
    backgroundColor: G.white,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnPrimary: { backgroundColor: G.ink },
  btnGhost: { borderColor: 'transparent', backgroundColor: 'transparent' },
  btnDanger: { borderStyle: 'dashed' },
  btnText: { fontSize: 15, fontWeight: '600', color: G.ink },
  chip: { minHeight: 36, borderWidth: 1.5, borderColor: G.mid, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: G.white },
  chipOn: { borderWidth: 2, borderColor: G.ink, backgroundColor: G.chipOn },
  chipText: { fontSize: 13, color: G.ink, fontWeight: '500' },
  field: { minHeight: 46, borderWidth: 2, borderColor: G.ink, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: G.ink, backgroundColor: G.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, borderBottomWidth: 1.5, borderBottomColor: G.line, paddingVertical: 6 },
  rowLabel: { fontSize: 15, color: G.ink },
  problem: { borderWidth: 2, borderStyle: 'dashed', borderColor: G.ink, borderRadius: 14, padding: 14, gap: 6, backgroundColor: G.pale },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: G.ink, borderRadius: 14, padding: 12, backgroundColor: G.white },
  card: { borderWidth: 2, borderColor: G.ink, borderRadius: 16, padding: 12, gap: 8, backgroundColor: G.white },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: G.soft, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: G.ink },
  placeholder: { backgroundColor: '#e6e6e6', borderWidth: 1.5, borderColor: '#9a9a9a', alignItems: 'center', justifyContent: 'center' },
  dim: { flex: 1, backgroundColor: 'rgba(20,20,20,0.38)' },
  sheet: { backgroundColor: G.white, borderTopWidth: 2.5, borderColor: G.ink, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingTop: 12, gap: 12, maxHeight: '85%' },
  grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#bbb', alignSelf: 'center' },
});
