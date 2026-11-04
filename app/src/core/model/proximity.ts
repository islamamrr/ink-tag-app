// Signal strength in plain words, for the "Add a badge" list.

export type Proximity = 'very-close' | 'near' | 'room' | 'far' | 'unknown';

export interface ProximityInfo {
  level: Proximity;
  /** 0–4 bars. */
  bars: number;
  label: string;
}

// Rough thresholds for a phone and a small badge antenna; RSSI varies a lot
// between phones, so these only rank badges and set expectations.
export function proximity(rssi: number | null | undefined, nearest = false): ProximityInfo {
  if (rssi == null) return { level: 'unknown', bars: 0, label: 'Signal unknown' };
  if (rssi >= -55)
    return {
      level: 'very-close',
      bars: 4,
      label: nearest ? 'Very close · probably the one in your hand' : 'Very close',
    };
  if (rssi >= -70) return { level: 'near', bars: 3, label: 'Nearby' };
  if (rssi >= -85) return { level: 'room', bars: 2, label: 'Across the room' };
  return { level: 'far', bars: 1, label: 'Far away' };
}
