// The UI kit, in riso print (design/riso-style.md): paper, black ink and the
// four print inks. Every piece reads the surface it sits on (paper, a card,
// or a flood ink) and picks its colours from it, so a screen only says which
// ink it floods with. Screens only use what's here and in print.tsx.

import { StatusBar } from 'expo-status-bar';
import { createContext, type ReactNode, useContext, useState } from 'react';
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
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dots, Ground, HardShadow, Icon, type IconName, InkStrip, OffsetText, OnSurface, useSurface, Words } from './print';
import { BADGE_INK, type Flood, FONT, INK, PAPER, SHADOW, SPACE, type Surface, surfaceFor, TYPE } from './theme';

export { useSurface } from './print';

/** A white card on paper; on a flood, cards are paper. Either way: black ink. */
const cardSurface = (on: Surface): Surface => ({ ...PAPER, ground: on.card, card: on.card === INK.white ? INK.paper : INK.white });
const line = (sf: Surface) => (sf.flood && sf.fg === INK.paper ? 'rgba(243,239,231,0.4)' : 'rgba(24,24,27,0.16)');

// ------------------------------------------------------------------ frame

/** Set by the shell: is this screen the one showing, and does it own the bottom edge (no tab bar)? */
export const FrameContext = createContext({ active: true, bottom: true });

// ------------------------------------------------------------------ layout

/**
 * A screen: header, scrolling body, optional footer pinned at the bottom.
 * `flood` fills the whole screen with that ink (detail screens); without it
 * the screen is paper. With `onBack` the header is a back button and a small
 * meta title; without, a big title (or the wordmark with `brand`).
 */
export function Screen({
  title,
  brand,
  back,
  onBack,
  right,
  children,
  footer,
  flood,
  scroll = true,
  pad = true,
}: {
  title?: string;
  brand?: boolean;
  back?: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flood?: Flood | null;
  scroll?: boolean;
  pad?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const frame = useContext(FrameContext);
  const sf = surfaceFor(flood);
  const body = pad ? st.body : undefined;
  const bottom = frame.bottom ? insets.bottom : 0;
  return (
    <OnSurface surface={sf}>
      <View style={{ flex: 1, backgroundColor: sf.ground, paddingTop: insets.top }}>
        {frame.active && <StatusBar style={sf.light ? 'light' : 'dark'} />}
        <Ground surface={sf} />
        {(title || brand || onBack || right) && (
          <View style={st.header}>
            {onBack ? (
              <>
                <IconBtn icon="back" label={back ?? 'Back'} onPress={onBack} />
                <Text style={[st.meta, { color: sf.fg, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                  {title?.toUpperCase() ?? ''}
                </Text>
                {right ?? <View style={{ width: 44 }} />}
              </>
            ) : (
              <>
                <View style={{ flex: 1 }}>{brand ? <Wordmark /> : title ? <Text style={[st.title, { color: sf.fg }]}>{title}</Text> : null}</View>
                {right}
              </>
            )}
          </View>
        )}
        {scroll ? (
          <ScrollView contentContainerStyle={[body, { gap: 16, paddingBottom: footer ? 24 : 32 + bottom }]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, gap: 16 }, body]}>{children}</View>
        )}
        {footer && (
          <View style={[st.footer, { paddingBottom: 16 + bottom }, !sf.flood && { backgroundColor: sf.ground, borderTopWidth: 2, borderTopColor: INK.black }]}>{footer}</View>
        )}
      </View>
    </OnSurface>
  );
}

export function Row({ children, gap = 8, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Col({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// ------------------------------------------------------------------ text

/** "ink tag", printed in blue with red off-register. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <OffsetText style={{ fontFamily: FONT.display, fontSize: size, lineHeight: size * 1.25, color: INK.blue, letterSpacing: -0.5 }} second="rgba(228,64,47,0.75)">
      ink tag
    </OffsetText>
  );
}

/** A heading. On a flood (or with `display`) it's the display face, off-register. */
export function H({ children, size = TYPE.headingL, display, center }: { children: ReactNode; size?: number; display?: boolean; center?: boolean }) {
  const sf = useSurface();
  if (display || sf.flood) {
    const k = Math.round(size * 0.78);
    return (
      <OffsetText style={{ fontFamily: FONT.display, fontSize: k, lineHeight: k * 1.3, color: sf.fg, textAlign: center ? 'center' : 'left' }} second={withAlpha(sf.second, 0.8)}>
        {children}
      </OffsetText>
    );
  }
  return <Text style={{ fontFamily: FONT.black, fontSize: size, lineHeight: size * 1.08, color: sf.fg, textAlign: center ? 'center' : 'left', includeFontPadding: false }}>{children}</Text>;
}

/** Body text. */
export const T = ({ children, muted, bold, center, size }: { children: ReactNode; muted?: boolean; bold?: boolean; center?: boolean; size?: number }) => {
  const sf = useSurface();
  const fs = size ?? 18;
  return (
    <Text style={{ fontFamily: bold ? FONT.black : FONT.bold, fontSize: fs, lineHeight: fs * 1.2, color: muted ? sf.muted : sf.fg, textAlign: center ? 'center' : 'left' }}>{children}</Text>
  );
};

/** A small mono caps line: field labels, counts, meta. */
export const Label = ({ children, muted, center }: { children: ReactNode; muted?: boolean; center?: boolean }) => {
  const sf = useSurface();
  const style = [st.meta, { color: muted ? sf.muted : sf.fg, textAlign: center ? 'center' : 'left' }] as TextStyle[];
  if (typeof children === 'string') return <Words text={children.toUpperCase()} style={style} align={center ? 'center' : 'left'} />;
  return <Text style={style}>{children}</Text>;
};

/** A mono caps line in any colour, with tight word gaps: tags under tiles, counts, status words. */
export const Meta = ({ text, color, size = TYPE.label, align }: { text: string; color?: string; size?: number; align?: 'left' | 'center' | 'right' }) => {
  const sf = useSurface();
  return <Words text={text.toUpperCase()} style={[st.meta, { fontSize: size, color: color ?? sf.muted }]} align={align} />;
};

/** A section heading with an optional mono link on the right ("ALL PHOTOS"). */
export function Section({ title, link, onLink }: { title: string; link?: string; onLink?: () => void }) {
  const sf = useSurface();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <H size={24}>{title}</H>
      {link && onLink && (
        <Pressable onPress={onLink} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 6 }}>
          <Words text={link.toUpperCase()} style={[st.meta, { color: sf.flood ? sf.fg : INK.blue }]} />
        </Pressable>
      )}
    </Row>
  );
}

/** Text styles for the current surface, for the odd bespoke layout. */
export function useText() {
  const sf = useSurface();
  return {
    body: { fontFamily: FONT.bold, fontSize: 18, lineHeight: 22, color: sf.fg } as TextStyle,
    strong: { fontFamily: FONT.heavy, fontSize: 19, lineHeight: 22, color: sf.fg } as TextStyle,
    small: { fontFamily: FONT.bold, fontSize: 16, lineHeight: 19, color: sf.muted } as TextStyle,
    meta: [st.meta, { color: sf.muted }] as TextStyle[],
    big: { fontFamily: FONT.display, fontSize: 30, lineHeight: 38, color: sf.fg } as TextStyle,
    sf,
  };
}

// ------------------------------------------------------------------ controls

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Btn({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  busy,
  flex,
  small,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  busy?: boolean;
  flex?: boolean;
  small?: boolean;
  icon?: IconName;
}) {
  const sf = useSurface();
  const off = disabled || busy;
  const h = small ? 44 : 54;
  const primary = kind === 'primary';
  // Paper: the main button is blue ink with a black shadow. On a flood: paper, with the second ink behind.
  const face: ViewStyle = primary
    ? sf.flood
      ? { backgroundColor: sf.card }
      : { backgroundColor: INK.blue, borderWidth: 2, borderColor: INK.black }
    : kind === 'secondary'
      ? sf.flood
        ? { borderWidth: 2, borderColor: sf.fg }
        : { backgroundColor: sf.card, borderWidth: 2, borderColor: INK.black }
      : kind === 'danger'
        ? { borderWidth: 2, borderColor: sf.flood ? sf.fg : INK.red, borderStyle: 'dashed' }
        : {};
  const color = primary ? (sf.flood ? sf.cardFg : INK.paper) : kind === 'secondary' ? (sf.flood ? sf.fg : sf.cardFg) : kind === 'danger' && !sf.flood ? INK.red : sf.fg;
  const shadow = primary ? (sf.flood ? sf.second : INK.black) : null;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }} style={[flex && { flex: 1 }, off && { opacity: 0.45 }]}>
      {({ pressed }) => (
        <View>
          {shadow && <View style={{ position: 'absolute', left: SHADOW.card, top: 3, right: -SHADOW.card, bottom: -3, borderRadius: h / 2, backgroundColor: shadow }} />}
          <View
            style={[
              st.btn,
              { minHeight: h, borderRadius: h / 2, paddingHorizontal: small ? 16 : 22 },
              face,
              pressed && (shadow ? { transform: [{ translateX: 3 }, { translateY: 2 }] } : { opacity: 0.7 }),
            ]}
          >
            {busy ? <ActivityIndicator color={color} size="small" /> : icon ? <Icon name={icon} size={small ? 18 : 22} color={color} /> : null}
            <Text style={[st.btnText, { color, fontSize: small ? TYPE.body : primary ? TYPE.headingM : 20 }, kind === 'ghost' && { textDecorationLine: 'underline' }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** A round icon button: back, close, search, favourite. */
export function IconBtn({ icon, label, onPress, tone, fill }: { icon: IconName; label: string; onPress: () => void; tone?: 'yellow' | 'card' | 'outline'; fill?: boolean }) {
  const sf = useSurface();
  const t = tone ?? (sf.flood ? 'card' : 'outline');
  const bg = t === 'yellow' ? INK.yellow : t === 'card' ? sf.card : sf.flood ? 'transparent' : INK.white;
  const border = t === 'card' && sf.flood ? undefined : sf.flood && t === 'outline' ? sf.fg : INK.black;
  const color = t === 'outline' && sf.flood ? sf.fg : INK.black;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        border && { borderWidth: 2, borderColor: border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={20} color={color} stroke={2.5} fill={fill} />
    </Pressable>
  );
}

export function Chip({ label, on, onPress, swatch, swatches }: { label: string; on?: boolean; onPress?: () => void; swatch?: string; swatches?: string[] }) {
  const sf = useSurface();
  const yellowFlood = sf.flood === 'yellow';
  const face: ViewStyle = on
    ? sf.flood
      ? yellowFlood
        ? { backgroundColor: INK.black, borderColor: INK.black }
        : { backgroundColor: sf.card, borderColor: INK.black }
      : { backgroundColor: INK.yellow, borderColor: INK.black }
    : sf.flood
      ? { borderColor: sf.fg }
      : { backgroundColor: sf.card, borderColor: INK.black };
  const color = on ? (yellowFlood ? INK.paper : INK.black) : sf.flood ? sf.fg : sf.cardFg;
  const shadow = on ? (sf.flood ? (yellowFlood ? INK.blue : INK.black) : INK.blue) : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={label} hitSlop={4}>
      {shadow ? <View style={{ position: 'absolute', left: SHADOW.chipX, top: SHADOW.chipY, right: -SHADOW.chipX, bottom: -SHADOW.chipY, borderRadius: 22, backgroundColor: shadow }} /> : null}
      <View style={[st.chip, face]}>
        {swatch && <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: swatch, borderWidth: 1.5, borderColor: INK.black }} />}
        {swatches && swatches.length > 0 && (
          <View style={{ flexDirection: 'row' }}>
            {swatches.map((c, i) => (
              <View key={i} style={{ width: 14, height: 14, borderRadius: 7, marginLeft: i ? -4 : 0, backgroundColor: c, borderWidth: 1.5, borderColor: INK.black }} />
            ))}
          </View>
        )}
        <Text style={[st.chipText, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function Chips<V extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string; swatches?: string[] }[];
  value: V | undefined;
  onChange: (v: V) => void;
}) {
  return (
    <Row wrap gap={8}>
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} swatches={o.swatches} on={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </Row>
  );
}

/** A horizontally scrolling chip row, bleeding to the screen edges. */
export function ChipStrip({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 4 }}>
      {children}
    </ScrollView>
  );
}

/** The badge's inks as round swatches, for text, sticker and frame colour. */
export function InkSwatches<V extends string>({ options, value, onChange }: { options: V[]; value: V; onChange: (v: V) => void }) {
  const sf = useSurface();
  return (
    <Row gap={10} wrap>
      {options.map((c) => {
        const on = c === value;
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            accessibilityRole="radio"
            accessibilityLabel={c}
            accessibilityState={{ selected: on }}
            style={{ width: 44, height: 44, borderRadius: 22, borderWidth: on ? 3.5 : 2, borderColor: on ? (sf.flood ? sf.fg : INK.blue) : INK.black, padding: on ? 3 : 0 }}
          >
            <View style={{ flex: 1, borderRadius: 22, backgroundColor: BADGE_INK[c] ?? INK.white, borderWidth: on ? 1.5 : 0, borderColor: INK.black }} />
          </Pressable>
        );
      })}
    </Row>
  );
}

export function Field({ label, ...p }: TextInputProps & { label?: string }) {
  const sf = useSurface();
  return (
    <View style={{ gap: 6 }}>
      {label && <Words text={label.toUpperCase()} style={[st.meta, { color: sf.fg }]} />}
      <TextInput
        placeholderTextColor="#8A857A"
        selectionColor={INK.blue}
        {...p}
        style={[st.field, { backgroundColor: sf.card }, p.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }, p.style]}
      />
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
  const sf = useSurface();
  const inner = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[st.rowLabel, { color: sf.fg }]}>{label}</Text>
        {detail ? <Text style={[st.small, { color: sf.muted }]}>{detail}</Text> : null}
      </View>
      {right}
      {value !== undefined ? (
        <View style={{ maxWidth: '45%' }}>
          <Words text={value.toUpperCase()} style={[st.meta, { color: sf.muted }]} align="right" />
        </View>
      ) : null}
      {onPress ? <Icon name="next" size={18} color={sf.fg} stroke={2.6} /> : null}
    </>
  );
  const style = [st.row, { borderBottomColor: line(sf) }, last && { borderBottomWidth: 0 }];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      {inner}
    </Pressable>
  ) : (
    <View style={style}>{inner}</View>
  );
}

export function ToggleRow({ label, detail, value, onChange, disabled, last }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  const sf = useSurface();
  return (
    <ListRow
      label={label}
      detail={detail}
      last={last}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ true: sf.flood ? INK.black : INK.blue, false: 'rgba(24,24,27,0.22)' }}
          thumbColor={value ? INK.yellow : INK.white}
          ios_backgroundColor="rgba(24,24,27,0.22)"
        />
      }
    />
  );
}

// ------------------------------------------------------------------ boxes

/** "What happened, what's still true, what to do": every problem uses this box. */
export function Problem({ title, children, action, onAction, onClose }: { title: string; children?: ReactNode; action?: string; onAction?: () => void; onClose?: () => void }) {
  const on = useSurface();
  const sf = cardSurface(on);
  return (
    <HardShadow x={SHADOW.card} y={SHADOW.card} color={on.flood === 'red' ? INK.black : INK.red}>
      <OnSurface surface={sf}>
        <View style={[st.box, { backgroundColor: sf.ground }]} accessibilityRole="alert">
          <Row>
            <Text style={[st.rowLabel, { flex: 1, fontFamily: FONT.black, fontSize: 20 }]}>{title}</Text>
            {onClose && (
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
                <Icon name="close" size={18} />
              </Pressable>
            )}
          </Row>
          {typeof children === 'string' ? <Text style={[st.small, { color: INK.muted }]}>{children}</Text> : children}
          {action && onAction && (
            <View style={{ alignSelf: 'flex-start' }}>
              <Btn label={action} onPress={onAction} small />
            </View>
          )}
        </View>
      </OnSurface>
    </HardShadow>
  );
}

/** A confirmation, stuck on like a yellow sticker ("On your badge. Sent in 26 s."). */
export function Note({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <HardShadow x={SHADOW.card} y={SHADOW.card} style={{ transform: [{ rotate: '-0.6deg' }] }}>
      <View style={[st.box, { backgroundColor: INK.yellow, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }]} accessibilityLiveRegion="polite">
        <Text style={[st.rowLabel, { flex: 1, color: INK.black }]}>{children}</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
            <Icon name="close" size={18} />
          </Pressable>
        )}
      </View>
    </HardShadow>
  );
}

/** A print card: white (paper on a flood), black outline, hard shadow, optionally tilted. */
export function Card({ children, onPress, style, tilt = 0, shadow = INK.black, label }: { children: ReactNode; onPress?: () => void; style?: ViewStyle; tilt?: number; shadow?: string | null; label?: string }) {
  const on = useSurface();
  const sf = cardSurface(on);
  const face = (pressed: boolean) => [st.card, { backgroundColor: sf.ground }, style, pressed && shadow ? { transform: [{ translateX: SHADOW.card - 1 }, { translateY: SHADOW.card - 1 }] } : pressed ? { opacity: 0.7 } : null];
  const body = (pressed: boolean) => (
    <View style={tilt ? { transform: [{ rotate: `${tilt}deg` }] } : undefined}>
      {shadow && <View style={{ position: 'absolute', left: SHADOW.card, top: SHADOW.card, right: -SHADOW.card, bottom: -SHADOW.card, backgroundColor: shadow }} />}
      <OnSurface surface={sf}>
        <View style={face(pressed)}>{children}</View>
      </OnSurface>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  ) : (
    body(false)
  );
}

/** A list in a card (settings sections and the like). */
export function Group({ children }: { children: ReactNode }) {
  return (
    <Card shadow={null} style={{ paddingVertical: 2, paddingHorizontal: 14, gap: 0 }}>
      {children}
    </Card>
  );
}

export function Bar({ value }: { value: number }) {
  const sf = useSurface();
  const fill = sf.flood ? (sf.flood === 'yellow' ? INK.black : INK.yellow) : INK.blue;
  return (
    <View style={[st.barTrack, { backgroundColor: sf.card }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={{ height: '100%', backgroundColor: fill, width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, borderRightWidth: value > 0 && value < 1 ? 2 : 0, borderColor: INK.black }} />
    </View>
  );
}

/** Where a picture will be, while it's drawn: paper with a faint halftone fading down. */
export function Placeholder({ style, label }: { style?: ViewStyle; label?: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View style={[st.placeholder, style]} onLayout={(e) => setSize({ w: Math.ceil(e.nativeEvent.layout.width), h: Math.ceil(e.nativeEvent.layout.height) })}>
      {size.w > 0 && <Dots width={size.w} height={size.h} spacing={7} radius={1.6} color={INK.black} alpha={0.14} fadeTo={size.h} style={{ left: 0, top: 0 }} />}
      {label ? <Words text={label.toUpperCase()} style={[st.meta, { color: INK.muted }]} align="center" /> : null}
    </View>
  );
}

/** Nothing here yet: a small halftone badge, one bold line, one muted line, one button. Every empty state looks like this. */
export function EmptyState({ title, children, action, onAction, icon = 'badge' }: { title: string; children?: string; action?: string; onAction?: () => void; icon?: IconName }) {
  const sf = useSurface();
  return (
    <View style={{ alignItems: 'center', gap: SPACE.m, paddingVertical: SPACE.xl, paddingHorizontal: SPACE.l }}>
      <View style={{ width: 74, height: 104, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: SHADOW.card, top: SHADOW.card, right: -SHADOW.card, bottom: -SHADOW.card, backgroundColor: INK.black }} />
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: sf.flood ? sf.card : INK.white, borderWidth: 2, borderColor: INK.black, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          <Dots width={74} height={104} spacing={7} radius={2} color={sf.flood ? INK[sf.flood] : INK.blue} alpha={0.5} fadeTo={104} style={{ left: 0, top: 0 }} />
          <Icon name={icon} size={30} color={INK.black} />
        </View>
      </View>
      <InkStrip size={10} gap={3} style={{ marginTop: SPACE.s }} />
      <Text style={{ fontFamily: FONT.black, fontSize: TYPE.headingM, lineHeight: TYPE.headingM * 1.1, color: sf.fg, textAlign: 'center' }}>{title}</Text>
      {children ? <Text style={{ fontFamily: FONT.bold, fontSize: TYPE.body, lineHeight: TYPE.body * 1.2, color: sf.muted, textAlign: 'center' }}>{children}</Text> : null}
      {action && onAction ? <Btn kind="primary" label={action} onPress={onAction} /> : null}
    </View>
  );
}

/** A bottom sheet over the screen, always paper. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={st.dim} onPress={onClose} accessibilityLabel="Close" />
      <OnSurface surface={PAPER}>
        <View style={[st.sheet, { paddingBottom: 22 + insets.bottom }]}>
          <View style={st.grab} />
          {title && <H size={26}>{title}</H>}
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </OnSurface>
    </Modal>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const sf = useSurface();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: sf.flood ? undefined : sf.ground }}>
      <ActivityIndicator color={sf.flood ? sf.fg : INK.blue} />
      <Text style={[st.meta, { color: sf.muted }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8, minHeight: 60 },
  title: { fontFamily: FONT.black, fontSize: 34, lineHeight: 38, includeFontPadding: false },
  meta: { fontFamily: FONT.monoBold, fontSize: TYPE.label, letterSpacing: 0.4 },
  body: { paddingHorizontal: SPACE.side, paddingTop: SPACE.s },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  small: { fontFamily: FONT.bold, fontSize: TYPE.small, lineHeight: 19 },
  rowLabel: { fontFamily: FONT.heavy, fontSize: 19, lineHeight: 23, color: INK.black },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnText: { fontFamily: FONT.black, includeFontPadding: false },
  chip: { minHeight: 44, borderWidth: 2, borderRadius: 22, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7 },
  chipText: { fontFamily: FONT.heavy, fontSize: 17, includeFontPadding: false },
  field: { minHeight: 52, borderWidth: 2, borderColor: INK.black, paddingHorizontal: 14, fontFamily: FONT.heavy, fontSize: 21, color: INK.black },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1.5, paddingVertical: 8 },
  box: { borderWidth: 2, borderColor: INK.black, padding: 14, gap: 8 },
  card: { borderWidth: 2, borderColor: INK.black, padding: 14, gap: 8 },
  barTrack: { height: 16, borderWidth: 2, borderColor: INK.black, overflow: 'hidden' },
  placeholder: { backgroundColor: INK.paper, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dim: { flex: 1, backgroundColor: 'rgba(24,24,27,0.45)' },
  sheet: { backgroundColor: INK.paper, borderTopWidth: 2, borderColor: INK.black, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingTop: 12, gap: 12, maxHeight: '85%' },
  grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: INK.black, alignSelf: 'center' },
});
