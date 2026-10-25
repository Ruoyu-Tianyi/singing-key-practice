/** Completed song practices only; audio and raw pitch frames are never retained. */
export interface PracticeRecord {
  id: string;
  completedAt: string;
  title: string;
  scoreId: string;
  bpm: number;
  transpose: number;
  /** One-based, inclusive note indices in the source score. */
  rangeStart: number;
  rangeEnd: number;
  durationSeconds: number;
  pitchAccuracy: number | null;
  coverage: number;
  rhythmOffsetMs: number | null;
}

export interface PracticeDay {
  date: string;
  sessions: number;
  durationSeconds: number;
  bestPitchAccuracy: number | null;
}

export interface PracticeSummary {
  days: PracticeDay[];
  sessions: number;
  durationSeconds: number;
  practiceDays: number;
  bestPitchAccuracy: number | null;
  /** Arithmetic mean of scored practices, not a pooled accuracy measurement. */
  averagePitchAccuracy: number | null;
}

export const MAX_PRACTICE_RECORDS = 100;
const MAX_BACKUP_BYTES = 512 * 1024;
const BACKUP_KIND = "auralis-practice-history";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function shortText(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 120
  );
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  // Date.parse rolls dates such as February 30 into March; reject those inputs.
  const calendarDate = value.slice(0, 10);
  const day = new Date(`${calendarDate}T00:00:00.000Z`);
  return (
    Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0, 10) === calendarDate
  );
}

/** Reject malformed persisted values instead of manufacturing practice results. */
export function normalizePracticeRecord(value: unknown): PracticeRecord | null {
  if (!object(value)) return null;
  const {
    id,
    completedAt,
    title,
    scoreId,
    bpm,
    transpose,
    rangeStart,
    rangeEnd,
    durationSeconds,
    pitchAccuracy,
    coverage,
    rhythmOffsetMs,
  } = value;
  if (
    !shortText(id) ||
    !shortText(title) ||
    !shortText(scoreId) ||
    // Require an explicit timezone so a backup cannot change dates on import.
    !timestamp(completedAt) ||
    !finiteRange(bpm, 30, 220) ||
    !finiteRange(transpose, -12, 12) ||
    !Number.isInteger(transpose) ||
    !finiteRange(rangeStart, 1, 10000) ||
    !Number.isInteger(rangeStart) ||
    !finiteRange(rangeEnd, rangeStart, 10000) ||
    !Number.isInteger(rangeEnd) ||
    !finiteRange(durationSeconds, 0, 86400) ||
    !finiteRange(coverage, 0, 100) ||
    !(pitchAccuracy === null || finiteRange(pitchAccuracy, 0, 100)) ||
    !(rhythmOffsetMs === null || finiteRange(rhythmOffsetMs, 0, 60000))
  )
    return null;
  return {
    id: id.trim(),
    completedAt: new Date(completedAt).toISOString(),
    title: title.trim(),
    scoreId: scoreId.trim(),
    bpm,
    transpose,
    rangeStart,
    rangeEnd,
    durationSeconds,
    // No captured voice must never become a perfect (or failed) pitch score.
    pitchAccuracy: coverage === 0 ? null : pitchAccuracy,
    coverage,
    rhythmOffsetMs,
  };
}

export function createPracticeRecord(input: PracticeRecord): PracticeRecord {
  const record = normalizePracticeRecord(input);
  if (!record) throw new Error("练习记录的数据不完整或超出有效范围。");
  return record;
}

function recordArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (
    object(value) &&
    value.kind === BACKUP_KIND &&
    value.version === 1 &&
    Array.isArray(value.records)
  ) {
    return value.records;
  }
  return null;
}

/** Tolerant storage recovery: retain valid rows, newest first, with unique IDs. */
export function normalizePracticeHistory(value: unknown): PracticeRecord[] {
  const rows = recordArray(value);
  if (!rows || rows.length > 1000) return [];
  const ids = new Set<string>();
  return rows
    .map(normalizePracticeRecord)
    .filter((record): record is PracticeRecord => record !== null)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .filter((record) => {
      if (ids.has(record.id)) return false;
      ids.add(record.id);
      return true;
    })
    .slice(0, MAX_PRACTICE_RECORDS);
}

export function readPracticeHistory(json: string | null): PracticeRecord[] {
  if (!json || json.length > MAX_BACKUP_BYTES) return [];
  try {
    return normalizePracticeHistory(JSON.parse(json));
  } catch {
    return [];
  }
}

export function addPracticeRecord(
  records: readonly PracticeRecord[],
  input: PracticeRecord,
): PracticeRecord[] {
  const record = createPracticeRecord(input);
  return normalizePracticeHistory([
    record,
    ...records.filter((row) => row.id !== record.id),
  ]);
}

/** A strict import is all-or-nothing; corrupted backups never silently lose rows. */
export function importPracticeHistory(json: string): PracticeRecord[] {
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("练习记录文件过大，请选择 Auralis 导出的记录备份。");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("无法读取练习记录，请选择有效的 JSON 备份。");
  }
  if (
    !object(value) ||
    value.kind !== BACKUP_KIND ||
    value.version !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > MAX_PRACTICE_RECORDS
  ) {
    throw new Error("这不是支持的 Auralis 练习记录备份。");
  }
  const records = value.records.map(normalizePracticeRecord);
  if (
    records.some((row) => row === null) ||
    new Set(records.map((row) => row?.id)).size !== records.length
  ) {
    throw new Error("备份包含无效或重复的练习记录，未导入任何记录。");
  }
  return normalizePracticeHistory(records);
}

export function exportPracticeHistory(
  records: readonly PracticeRecord[],
): string {
  return JSON.stringify(
    {
      kind: BACKUP_KIND,
      version: 1,
      records: normalizePracticeHistory(records),
    },
    null,
    2,
  );
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Seven local calendar days including today; not seven rolling 24-hour periods. */
export function summarizePracticeHistory(
  records: readonly PracticeRecord[],
  now: Date,
): PracticeSummary {
  if (!Number.isFinite(now.getTime())) throw new Error("统计日期无效。");
  const days: PracticeDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 6 + index);
    return {
      date: localDate(date),
      sessions: 0,
      durationSeconds: 0,
      bestPitchAccuracy: null,
    };
  });
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const pitches: number[] = [];
  for (const record of normalizePracticeHistory(records)) {
    const completedAt = new Date(record.completedAt);
    if (completedAt.getTime() > now.getTime()) continue;
    const day = dayMap.get(localDate(completedAt));
    if (!day) continue;
    day.sessions++;
    day.durationSeconds += record.durationSeconds;
    if (record.pitchAccuracy !== null) {
      pitches.push(record.pitchAccuracy);
      day.bestPitchAccuracy = Math.max(
        day.bestPitchAccuracy ?? 0,
        record.pitchAccuracy,
      );
    }
  }
  return {
    days,
    sessions: days.reduce((sum, day) => sum + day.sessions, 0),
    durationSeconds: days.reduce((sum, day) => sum + day.durationSeconds, 0),
    practiceDays: days.filter((day) => day.sessions > 0).length,
    bestPitchAccuracy: pitches.length ? Math.max(...pitches) : null,
    averagePitchAccuracy: pitches.length
      ? pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length
      : null,
  };
}
