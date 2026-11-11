import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { computerTimeZone } from '../core/model/location';
import { isTimeZone } from '../core/model/sunTimes';
import { isTauriApp } from './fileAccess';

// A place's time zone (4.3): on the desktop from Rust (src-tauri/src/timezone.rs, tzf-rs: offline, from the
// coordinates). A browser build (the end-to-end tests, `?files=memory`) has no finder and answers with this computer's
// zone, so a test that sets the browser's time zone gets a known answer.

const found = new Map<string, string | null>();
const key = (latitude: number, longitude: number) => `${String(latitude)},${String(longitude)}`;

/** The answer already known for a point: a zone, null for a point that can't be placed, undefined for not asked yet. */
export function knownTimeZone(latitude: number, longitude: number): string | null | undefined {
  return found.get(key(latitude, longitude));
}

/**
 * The IANA zone at a point: a zone, null when it can't be placed, or undefined when Rust failed to answer. Asked once
 * per point; a failed ask is never remembered, so the next one asks again.
 */
async function askZone(latitude: number, longitude: number): Promise<string | null | undefined> {
  const k = key(latitude, longitude);
  const known = found.get(k);
  if (known !== undefined) return known;
  let zone: string | null;
  if (isTauriApp) {
    try {
      zone = await invoke<string | null>('time_zone_at', { latitude, longitude });
    } catch {
      return undefined;
    }
    if (zone !== null && !isTimeZone(zone)) zone = null;
  } else {
    zone = computerTimeZone();
  }
  found.set(k, zone);
  return zone;
}

/** The IANA zone at a point, or null when it can't be placed or Rust didn't answer. */
export async function timeZoneAt(latitude: number, longitude: number): Promise<string | null> {
  return (await askZone(latitude, longitude)) ?? null;
}

export interface ZonePoint {
  id: string;
  latitude: number;
  longitude: number;
}

/**
 * The looked-up zone of each point, by id: a zone, null for a point that can't be placed, and no entry while the
 * answer is on its way (so a caller waits rather than guessing). Answers already known are there on the first draw.
 * Points are compared by value, so a redraw with the same places asks nothing, and a place that moved never shows
 * the old place's zone.
 */
export function useZonesAt(points: readonly ZonePoint[]): ReadonlyMap<string, string | null> {
  const wanted = JSON.stringify(points);
  const [, setTick] = useState(0);
  // Points Rust failed to answer for, in this mount: they read as "can't be placed" (the computer's zone, said so),
  // and are asked again the next time the tile is opened.
  const failed = useRef(new Set<string>());
  useEffect(() => {
    let current = true;
    const list = JSON.parse(wanted) as ZonePoint[];
    void Promise.all(
      list.map(async (p) => {
        if ((await askZone(p.latitude, p.longitude)) === undefined) failed.current.add(key(p.latitude, p.longitude));
      }),
    ).then(() => {
      if (current) setTick((n) => n + 1);
    });
    return () => {
      current = false;
    };
  }, [wanted]);
  const answers = new Map<string, string | null>();
  for (const p of points) {
    const known = knownTimeZone(p.latitude, p.longitude);
    if (known !== undefined) answers.set(p.id, known);
    else if (failed.current.has(key(p.latitude, p.longitude))) answers.set(p.id, null);
  }
  return answers;
}
