import { describe, expect, it } from "vitest";
import {
  addPracticeRecord,
  createPracticeRecord,
  exportPracticeHistory,
  importPracticeHistory,
  MAX_PRACTICE_RECORDS,
  normalizePracticeHistory,
  normalizePracticeRecord,
  readPracticeHistory,
  summarizePracticeHistory,
  type PracticeRecord,
} from "./practice-history";

function record(overrides: Partial<PracticeRecord> = {}): PracticeRecord {
  return {
    id: "practice-1",
    completedAt: "2026-10-25T04:00:00.000Z",
    title: "C 大调音阶",
    scoreId: "scale-c",
    bpm: 80,
    transpose: 0,
    rangeStart: 1,
    rangeEnd: 8,
    durationSeconds: 6,
    pitchAccuracy: 82,
    coverage: 90,
    rhythmOffsetMs: 120,
    ...overrides,
  };
}

describe("practice history validation and storage", () => {
  it("keeps meaningful zero scores, fractional timing and bounded song settings", () => {
    const input = record({
      pitchAccuracy: 0,
      durationSeconds: 12.75,
      transpose: -12,
      bpm: 220,
    });
    expect(createPracticeRecord(input)).toEqual(input);
    expect(createPracticeRecord(input)).not.toBe(input);
  });

  it("does not manufacture a pitch score when no voice was captured", () => {
    expect(
      createPracticeRecord(record({ coverage: 0, pitchAccuracy: 100 }))
        .pitchAccuracy,
    ).toBeNull();
    expect(
      createPracticeRecord(record({ coverage: 0, pitchAccuracy: null }))
        .pitchAccuracy,
    ).toBeNull();
    expect(
      createPracticeRecord(record({ pitchAccuracy: null })).pitchAccuracy,
    ).toBeNull();
  });

  it.each([
    { coverage: 101 },
    { coverage: -1 },
    { coverage: NaN },
    { pitchAccuracy: Infinity },
    { pitchAccuracy: -1 },
    { rhythmOffsetMs: -1 },
    { durationSeconds: Infinity },
    { rangeStart: 3, rangeEnd: 2 },
    { rangeStart: 0 },
    { rangeEnd: 1.5 },
    { bpm: 0 },
    { transpose: 13 },
    { completedAt: "yesterday" },
    { completedAt: "2026-10-25T12:00:00" },
    { completedAt: "2026-02-30T00:00:00Z" },
    { completedAt: "2026-10-25T24:00:00Z" },
    { title: " " },
    { id: "x".repeat(121) },
  ])("rejects invalid imported fields: %j", (invalid) => {
    expect(normalizePracticeRecord(record(invalid))).toBeNull();
  });

  it("creates only known own fields and preserves titles as data", () => {
    const normalized = normalizePracticeRecord({
      ...record({ title: "<img src=x>" }),
      payload: "ignored",
    });
    expect(normalized?.title).toBe("<img src=x>");
    expect(normalized).not.toHaveProperty("payload");
    expect(() => createPracticeRecord(record({ coverage: NaN }))).toThrow();
  });

  it("normalizes timezone offsets into an unambiguous timestamp", () => {
    expect(
      createPracticeRecord(record({ completedAt: "2026-10-25T12:00:00+08:00" }))
        .completedAt,
    ).toBe("2026-10-25T04:00:00.000Z");
  });

  it.each([null, "", "{", "null", '{"records":[]}', "123"])(
    "recovers safely from malformed local storage: %s",
    (json) => {
      expect(readPracticeHistory(json)).toEqual([]);
    },
  );

  it("retains valid local rows even when another saved row is corrupt", () => {
    expect(
      readPracticeHistory(JSON.stringify([record(), { id: "broken" }])),
    ).toEqual([record()]);
  });

  it("keeps the newest 100 records without mutating the input", () => {
    const records = Array.from({ length: 105 }, (_, index) =>
      record({
        id: `practice-${index}`,
        completedAt: new Date(Date.UTC(2026, 9, 25, 0, index)).toISOString(),
      }),
    );
    const previousFirst = records[0];
    const result = normalizePracticeHistory(records);
    expect(result).toHaveLength(MAX_PRACTICE_RECORDS);
    expect(result[0].id).toBe("practice-104");
    expect(result.at(-1)?.id).toBe("practice-5");
    expect(records[0]).toBe(previousFirst);
  });

  it("deduplicates IDs and replaces a supplied record without double counting", () => {
    const earlier = record({
      completedAt: "2026-10-24T04:00:00.000Z",
      pitchAccuracy: 20,
    });
    expect(normalizePracticeHistory([earlier, record()])).toEqual([record()]);
    expect(addPracticeRecord([record()], earlier)).toEqual([earlier]);
  });
});

describe("portable practice history backups", () => {
  it("round-trips a versioned export, including missing metrics", () => {
    const rows = [record({ pitchAccuracy: null, rhythmOffsetMs: null })];
    expect(importPracticeHistory(exportPracticeHistory(rows))).toEqual(rows);
    expect(readPracticeHistory(exportPracticeHistory(rows))).toEqual(rows);
    expect(importPracticeHistory(exportPracticeHistory([]))).toEqual([]);
  });

  it("rejects a broken backup atomically, unsupported versions and duplicate IDs", () => {
    const backup = JSON.parse(exportPracticeHistory([record()]));
    expect(() =>
      importPracticeHistory(JSON.stringify({ ...backup, version: 2 })),
    ).toThrow();
    expect(() =>
      importPracticeHistory(
        JSON.stringify({ ...backup, records: [record(), { id: "bad" }] }),
      ),
    ).toThrow();
    expect(() =>
      importPracticeHistory(
        JSON.stringify({ ...backup, records: [record(), record()] }),
      ),
    ).toThrow();
    expect(() => importPracticeHistory("{")).toThrow();
  });

  it("rejects oversized files and unsupported or excessive record collections", () => {
    expect(() => importPracticeHistory(" ".repeat(512 * 1024 + 1))).toThrow();
    expect(() => importPracticeHistory(JSON.stringify([record()]))).toThrow();
    expect(() =>
      importPracticeHistory(
        JSON.stringify({
          kind: "auralis-practice-history",
          version: 1,
          records: Array.from({ length: 101 }, (_, id) =>
            record({ id: String(id) }),
          ),
        }),
      ),
    ).toThrow();
  });
});

describe("seven local calendar day summaries", () => {
  it("uses local midnight boundaries, excludes future/old records and keeps all seven days", () => {
    const now = new Date(2026, 9, 25, 12);
    const firstDay = new Date(2026, 9, 19, 0, 0, 0);
    const rows = [
      record({
        id: "first",
        completedAt: firstDay.toISOString(),
        pitchAccuracy: 60,
        durationSeconds: 15,
      }),
      record({
        id: "today",
        completedAt: new Date(2026, 9, 25, 0).toISOString(),
        pitchAccuracy: 90,
        durationSeconds: 30,
      }),
      record({
        id: "silent",
        completedAt: new Date(2026, 9, 25, 1).toISOString(),
        pitchAccuracy: null,
        coverage: 0,
        durationSeconds: 10,
      }),
      record({
        id: "old",
        completedAt: new Date(firstDay.getTime() - 1).toISOString(),
        pitchAccuracy: 100,
      }),
      record({
        id: "future",
        completedAt: new Date(now.getTime() + 1).toISOString(),
        pitchAccuracy: 100,
      }),
    ];
    const result = summarizePracticeHistory(rows, now);
    expect(result.days).toHaveLength(7);
    expect(result.days[0].date).toBe("2026-10-19");
    expect(result.days[6].date).toBe("2026-10-25");
    expect(result).toMatchObject({
      sessions: 3,
      durationSeconds: 55,
      practiceDays: 2,
      bestPitchAccuracy: 90,
      averagePitchAccuracy: 75,
    });
    expect(result.days[6]).toMatchObject({ sessions: 2, durationSeconds: 40 });
  });

  it("returns absent scores for an empty week or all-silent practices", () => {
    const now = new Date(2026, 9, 25, 12);
    expect(summarizePracticeHistory([], now)).toMatchObject({
      sessions: 0,
      bestPitchAccuracy: null,
      averagePitchAccuracy: null,
    });
    expect(
      summarizePracticeHistory(
        [
          record({
            completedAt: now.toISOString(),
            coverage: 0,
            pitchAccuracy: 100,
          }),
        ],
        now,
      ),
    ).toMatchObject({
      sessions: 1,
      bestPitchAccuracy: null,
      averagePitchAccuracy: null,
    });
  });

  it("crosses year boundaries using calendar arithmetic", () => {
    const days = summarizePracticeHistory([], new Date(2027, 0, 2, 12)).days;
    expect(days.map((day) => day.date)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(() => summarizePracticeHistory([], new Date(NaN))).toThrow();
  });
});
