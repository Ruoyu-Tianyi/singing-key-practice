import { describe, expect, it } from "vitest";
import {
  chooseNoteLabelStep,
  PitchViewport,
  selectPitchRange,
} from "./pitch-chart";

describe("pitch chart range", () => {
  it("starts with a centered octave and centers a single detected note", () => {
    expect(selectPitchRange([], { now: 0 })).toEqual({ low: 54, high: 66 });
    expect(selectPitchRange([{ t: 0, midi: 69.1 }], { now: 0 })).toEqual({
      low: 63,
      high: 75,
    });
  });

  it("keeps low and high notes in the visible history with two semitones of padding", () => {
    const range = selectPitchRange(
      [
        { t: 1_000, midi: 42.7 },
        { t: 5_000, midi: 60 },
        { t: 10_000, midi: 85.3 },
      ],
      { now: 10_000 },
    );
    expect(range.low).toBeLessThanOrEqual(40.7);
    expect(range.high).toBeGreaterThanOrEqual(87.3);
    expect(Number.isInteger(range.low)).toBe(true);
    expect(Number.isInteger(range.high)).toBe(true);
  });

  it("preserves the contour through a rest rather than following only the latest frame", () => {
    expect(
      selectPitchRange(
        [
          { t: 1_000, midi: 48 },
          { t: 4_000, midi: 72 },
          { t: 5_000, midi: null },
        ],
        { now: 5_000 },
      ),
    ).toEqual({ low: 46, high: 74 });
  });

  it("expires old samples, ignores future frames, and includes the exact window boundary", () => {
    expect(
      selectPitchRange(
        [
          { t: -1, midi: 20 },
          { t: 0, midi: 60 },
          { t: 10_002, midi: 100 },
        ],
        { now: 10_000 },
      ),
    ).toEqual({ low: 54, high: 66 });
    expect(
      selectPitchRange(
        [
          { t: 8_999, midi: 20 },
          { t: 9_000, midi: 72 },
          { t: 10_000.5, midi: 72 },
        ],
        { now: 10_000, windowMs: 1_000 },
      ),
    ).toEqual({ low: 66, high: 78 });
  });

  it("includes an explicit exercise target and the selected score's entire range", () => {
    const range = selectPitchRange([{ t: 0, midi: 81 }], {
      now: 0,
      target: 45,
      referencePitches: [48, 60, 72, Number.NaN],
    });
    expect(range.low).toBeLessThanOrEqual(43);
    expect(range.high).toBeGreaterThanOrEqual(83);
    expect(selectPitchRange([], { now: 0, target: 72 })).toEqual({
      low: 66,
      high: 78,
    });
  });

  it("does not pull an unrelated reference note into free singing", () => {
    expect(selectPitchRange([{ t: 0, midi: 91 }], { now: 0 })).toEqual({
      low: 85,
      high: 97,
    });
  });

  it("filters missing pitches and non-finite pitch/timestamp values", () => {
    expect(
      selectPitchRange(
        [
          { t: 0, midi: null },
          { t: 0, midi: Number.NaN },
          { t: 0, midi: Infinity },
          { t: Number.NaN, midi: 10 },
          { t: Infinity, midi: 100 },
        ],
        { now: 0, target: Number.NaN, referencePitches: [Infinity] },
      ),
    ).toEqual({ low: 54, high: 66 });
  });

  it("keeps pitches across the complete MIDI range without clipping to a vocal preset", () => {
    const range = selectPitchRange(
      [
        { t: 0, midi: 0 },
        { t: 0, midi: 127 },
      ],
      { now: 0 },
    );
    expect(range.low).toBeLessThanOrEqual(-2);
    expect(range.high).toBeGreaterThanOrEqual(129);
  });

  it("keeps sustained-note cent fluctuations inside unchanged integer bounds", () => {
    const ranges = [59.95, 60, 60.05].map((midi) =>
      selectPitchRange([{ t: 0, midi }], { now: 0 }),
    );
    expect(ranges).toEqual(Array(3).fill({ low: 54, high: 66 }));
  });

  it("always fits each finite input with padding and a minimum octave", () => {
    for (let low = 0; low <= 100; low += 7.3) {
      for (let width = 0; width <= 25; width += 2.7) {
        const range = selectPitchRange(
          [
            { t: 0, midi: low },
            { t: 0, midi: low + width },
          ],
          { now: 0 },
        );
        expect(range.low).toBeLessThanOrEqual(low - 2);
        expect(range.high).toBeGreaterThanOrEqual(low + width + 2);
        expect(range.high - range.low).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

describe("stable pitch viewport", () => {
  it("expands immediately for a new high or low and returns independent snapshots", () => {
    const viewport = new PitchViewport();
    const first = viewport.update({ low: 54, high: 66 }, 0);
    expect(viewport.update({ low: 58, high: 80 }, 16)).toEqual({
      low: 54,
      high: 80,
    });
    expect(viewport.update({ low: 40, high: 52 }, 32)).toEqual({
      low: 40,
      high: 80,
    });
    expect(first).toEqual({ low: 54, high: 66 });
  });

  it("shrinks only after the replacement range has been stable for 1.2 seconds", () => {
    const viewport = new PitchViewport();
    viewport.update({ low: 40, high: 90 }, 0);
    expect(viewport.update({ low: 54, high: 66 }, 100)).toEqual({
      low: 40,
      high: 90,
    });
    expect(viewport.update({ low: 54, high: 66 }, 1_299)).toEqual({
      low: 40,
      high: 90,
    });
    expect(viewport.update({ low: 54, high: 66 }, 1_300)).toEqual({
      low: 54,
      high: 66,
    });
  });

  it("waits again when the desired range changes while an outlier ages out", () => {
    const viewport = new PitchViewport();
    viewport.update({ low: 40, high: 90 }, 0);
    viewport.update({ low: 54, high: 66 }, 100);
    expect(viewport.update({ low: 56, high: 68 }, 1_000)).toEqual({
      low: 40,
      high: 90,
    });
    expect(viewport.update({ low: 56, high: 68 }, 1_301)).toEqual({
      low: 40,
      high: 90,
    });
    expect(viewport.update({ low: 56, high: 68 }, 2_200)).toEqual({
      low: 56,
      high: 68,
    });
  });

  it("can reset for a new exercise and tolerates a restarted clock", () => {
    const viewport = new PitchViewport();
    viewport.update({ low: 40, high: 90 }, 10_000);
    viewport.update({ low: 54, high: 66 }, 10_100);
    expect(viewport.update({ low: 54, high: 66 }, 0)).toEqual({
      low: 40,
      high: 90,
    });
    expect(viewport.update({ low: 54, high: 66 }, 1_200)).toEqual({
      low: 54,
      high: 66,
    });
    viewport.reset();
    expect(viewport.update({ low: 70, high: 82 }, 0)).toEqual({
      low: 70,
      high: 82,
    });
  });
});

describe("pitch axis labels", () => {
  it.each([
    [12, 300, 1],
    [24, 300, 2],
    [36, 300, 3],
    [72, 300, 6],
    [127, 300, 12],
    [127, 80, 36],
  ])(
    "spaces a %s-semitone range at %s pixels without label overlap",
    (span, height, expected) => {
      const step = chooseNoteLabelStep({ low: 0, high: span }, height);
      expect(step).toBe(expected);
      expect((step * height) / span).toBeGreaterThanOrEqual(20);
    },
  );

  it("provides a safe default when the canvas has no layout yet", () => {
    expect(chooseNoteLabelStep({ low: 54, high: 66 }, 0)).toBe(12);
    expect(chooseNoteLabelStep({ low: 60, high: 60 }, 300)).toBe(12);
  });
});
