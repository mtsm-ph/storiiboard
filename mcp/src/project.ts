import { basename } from 'node:path';
import type { HeldForecasts } from '../../src/core/checks/exteriorRain';
import { mapPlace } from '../../src/core/model/location';
import type { SbdRecord } from '../../src/core/model/record';
import type { SlateNumbers } from '../../src/core/model/shotNumbers';
import { cachedForecast, weatherKey } from '../../src/core/net/weather';
import { loadRecords } from '../../src/core/ops/ops';
import { everBroughtIn } from '../../src/core/ops/suggestions';
import type { ProjectFile } from '../../src/core/storage/driver';
import { loadLookup } from '../../src/core/storage/lookups';
import { SCHEMA_VERSION } from '../../src/core/storage/migrations';
import { loadSeen, type Seen } from '../../src/core/storage/seen';
import { loadSlateNumbers } from '../../src/core/storage/slateNumbers';
import { openReadOnly, ProjectRefused } from './readOnlyFile';

// One project as the tools read it: every record, its Seen marks and slate numbers, read in one go from a read-only
// connection that is closed straight after, so each call reads the file as it is then (the app may have saved since)
// and nothing stays open between calls. The reads run in one transaction (round 2), so a save landing between two of
// them can't give the records of one moment and the slate numbers of the next.
//
// 7.6: and the forecasts the project already holds (its `lookups` cache, as the app's checks read it), for run_checks'
// rain check. Read from the file only: the server never fetches one.

export type Records = Readonly<Record<string, SbdRecord>>;

export interface ProjectData {
  path: string;
  /** The .sbd's name without the extension, as the app names the project. */
  name: string;
  projectId: string;
  schemaVersion: number;
  records: Records;
  seen: Seen;
  slate: SlateNumbers;
  /** The forecasts held in the file, by location id, and when each was fetched (7.6); none when left out. */
  forecasts?: HeldForecasts;
  forecastsFetchedAt?: ReadonlyMap<string, string>;
  /**
   * The change files the project ever brought in, by id (7.6 round 3): what the log's creates of suggestions name
   * (everBroughtIn, undone bring-ins included, as the app's folder pass skips them) and the suggestions' own
   * `change_file_id`. The room check counts only the folder's other files. None when left out.
   */
  broughtIn?: ReadonlySet<string>;
}

/** The change files brought in, from the log and from the suggestions held. */
async function broughtInFiles(file: ProjectFile, list: readonly SbdRecord[]): Promise<Set<string>> {
  const files = new Set((await everBroughtIn(file)).files);
  for (const record of list) {
    const id = record.type === 'suggestion' ? record.props.change_file_id : undefined;
    if (typeof id === 'string') files.add(id);
  }
  return files;
}

/** Each live location's held forecast, by its place as the app caches it (weatherKey), read from the file alone. */
async function heldForecasts(file: ProjectFile, list: readonly SbdRecord[], projectId: string): Promise<{ forecasts: HeldForecasts; fetchedAt: Map<string, string> }> {
  const forecasts = new Map<string, NonNullable<ReturnType<typeof cachedForecast>>>();
  const fetchedAt = new Map<string, string>();
  for (const record of list) {
    if (record.type !== 'location' || record.parentId !== projectId || record.trashedAt !== null) continue;
    const place = mapPlace(record.props);
    if (!place) continue;
    const held = await loadLookup(file, 'weather', weatherKey(place.latitude, place.longitude));
    const forecast = held ? cachedForecast(held.result) : null;
    if (!held || !forecast) continue;
    forecasts.set(record.id, forecast);
    fetchedAt.set(record.id, held.fetchedAt);
  }
  return { forecasts, fetchedAt };
}

/**
 * A project file's stem, as Storiiboard names its Suggestions folder from it (changes.rs, Rust's `file_stem`): the file
 * name less its `.sbd`. Null for a name that doesn't end in `.sbd` or has nothing before it (round 2): the server reads
 * only such files, so its folder's name is always the app's.
 */
export function projectStem(path: string): string | null {
  const name = basename(path);
  if (!/\.sbd$/i.test(name) || name.length <= 4) return null;
  return name.slice(0, -4);
}

export async function readProject(path: string): Promise<ProjectData> {
  const stem = projectStem(path);
  if (stem === null) throw new ProjectRefused('This server reads only Storiiboard projects: files whose names end in .sbd.');
  const file = openReadOnly(path);
  try {
    return await file.snapshot(async () => {
      const list = await loadRecords(file);
      const records: Record<string, SbdRecord> = {};
      for (const record of list) records[record.id] = record;
      const project = list.find((r) => r.type === 'project' && r.parentId === null);
      if (!project) throw new ProjectRefused("This file isn't a Storiiboard project.");
      const seen = await loadSeen(file);
      const slate = await loadSlateNumbers(file);
      const held = await heldForecasts(file, list, project.id);
      const broughtIn = await broughtInFiles(file, list);
      return {
        path,
        name: stem,
        projectId: project.id,
        schemaVersion: SCHEMA_VERSION,
        records,
        seen,
        slate,
        forecasts: held.forecasts,
        forecastsFetchedAt: held.fetchedAt,
        broughtIn,
      };
    });
  } finally {
    await file.close();
  }
}
