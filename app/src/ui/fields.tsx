// Form controls built from a template's fields, so a template that arrives
// as data gets its form with no new screen code.

import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type Field, formatList, type ListItem, parseList, type Values } from '../core';
import { pickPhotos } from '../services/inkTag';
import { Btn, Chips, Col, Field as TextField, Label, Row, T, useText } from './kit';
import { Icon } from './print';
import { BADGE_INK, INK } from './theme';

export function FieldEditor({ f, values, onChange, onBusy }: { f: Field; values: Values; onChange: (v: Values) => void; onBusy?: (b: boolean) => void }) {
  const v = values[f.key] ?? f.default;
  const tx = useText();
  const set = (x: string | boolean | undefined) => onChange({ ...values, [f.key]: x });
  switch (f.kind) {
    case 'choice':
      return (
        <Col gap={8}>
          <Label>{f.label}</Label>
          <Chips options={(f.options ?? []).map((o) => ({ ...o, swatches: o.inks?.map((c) => BADGE_INK[c]) }))} value={typeof v === 'string' ? v : undefined} onChange={set} />
        </Col>
      );
    case 'toggle':
      return (
        <Row>
          <Text style={[tx.strong, { flex: 1 }]}>{f.label}</Text>
          <Btn small label={v === true ? 'On' : 'Off'} kind={v === true ? 'primary' : 'secondary'} onPress={() => set(!(v === true))} />
        </Row>
      );
    case 'photo':
      return (
        <Row>
          <Text style={[tx.strong, { flex: 1 }]}>
            {f.label}: <Text style={tx.small}>{v ? 'chosen' : 'none'}</Text>
          </Text>
          <Btn
            small
            label={v ? 'Change' : 'Choose'}
            onPress={async () => {
              onBusy?.(true);
              try {
                const [id] = await pickPhotos(1);
                if (id) set(id);
              } finally {
                onBusy?.(false);
              }
            }}
          />
          {!!v && <Btn small kind="ghost" label="Remove" onPress={() => set(undefined)} />}
        </Row>
      );
    case 'list':
      return <ListEditor label={f.label} value={typeof v === 'string' ? v : ''} max={f.max} onChange={set} />;
    default:
      return (
        <TextField
          label={f.label + (f.required ? '' : ' (optional)')}
          placeholder={f.kind === 'date' ? 'YYYY-MM-DD' : f.placeholder}
          value={typeof v === 'string' ? v : ''}
          multiline={f.kind === 'multiline'}
          secureTextEntry={false}
          autoCapitalize={f.kind === 'url' || f.kind === 'email' || f.kind === 'password' ? 'none' : 'sentences'}
          keyboardType={f.kind === 'phone' ? 'phone-pad' : f.kind === 'email' ? 'email-address' : f.kind === 'url' ? 'url' : f.kind === 'date' ? 'numbers-and-punctuation' : 'default'}
          onChangeText={set}
        />
      );
  }
}

/** Add, tick, edit, move and remove items. Ticks are kept in the text ("[x] "). */
export function ListEditor({ label, value, max, onChange, ticks = true }: { label: string; value: string; max?: number; onChange: (v: string) => void; ticks?: boolean }) {
  // Rows are kept here while typing, so emptying a row doesn't remove it.
  const [items, setItems] = useState<ListItem[]>(() => parseList(value));
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setItems(parseList(value));
    }
  }, [value]);
  const save = (next: ListItem[]) => {
    setItems(next);
    sent.current = formatList(next);
    onChange(sent.current);
  };
  const full = max !== undefined && items.length >= max;
  const tx = useText();
  return (
    <Col gap={8}>
      <Label>{`${label}${max ? ` · ${items.length} of ${max}` : ''}`}</Label>
      {items.map((it, i) => (
        <Row key={i} gap={6}>
          {ticks && (
            <Pressable
              onPress={() => save(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: it.done }}
              hitSlop={8}
              accessibilityLabel={it.text}
              style={{ width: 34, height: 34, borderWidth: 2, borderColor: INK.black, alignItems: 'center', justifyContent: 'center', backgroundColor: it.done ? INK.yellow : tx.sf.card }}
            >
              {it.done && <Icon name="check" size={20} stroke={3.2} />}
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <TextField
              value={it.color ? `${it.text} | ${it.color}` : it.text}
              onChangeText={(t) => save(items.map((x, j) => (j === i ? { text: t, done: x.done } : x)))}
              style={it.done ? { textDecorationLine: 'line-through' } : undefined}
            />
          </View>
          <Pressable onPress={() => i > 0 && save(swap(items, i, i - 1))} hitSlop={6} accessibilityLabel="Move up" accessibilityRole="button" disabled={i === 0} style={{ padding: 4, opacity: i === 0 ? 0.3 : 1 }}>
            <Icon name="up" size={20} color={tx.sf.fg} stroke={2.6} />
          </Pressable>
          <Pressable onPress={() => save(items.filter((_, j) => j !== i))} hitSlop={6} accessibilityLabel="Remove" accessibilityRole="button" style={{ padding: 4 }}>
            <Icon name="close" size={20} color={tx.sf.fg} stroke={2.6} />
          </Pressable>
        </Row>
      ))}
      {items.length === 0 && <T muted>Nothing yet.</T>}
      <Row gap={10}>
        <Btn small icon="plus" label="Add an item" disabled={full} onPress={() => save([...items, { text: `Item ${items.length + 1}`, done: false }])} />
        {ticks && items.some((x) => x.done) && <Btn small kind="ghost" label="Clear ticked" onPress={() => save(items.filter((x) => !x.done))} />}
      </Row>
    </Col>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = a.slice();
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}
