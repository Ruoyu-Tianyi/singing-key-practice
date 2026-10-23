export interface PitchSample {
  t: number;
  midi: number | null;
}

export interface PitchRange {
  low: number;
  high: number;
}

export interface PitchRangeOptions {
  now: number;
  target?: number;
  referencePitches?: readonly number[];
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 10_000;
const MINIMUM_SPAN = 12;
const PITCH_PADDING = 2;
const CLOCK_TOLERANCE_MS = 1;

/** Fit the complete visible contour, with room above and below its extremes. */
export function selectPitchRange(
  samples: readonly PitchSample[],
  options: PitchRangeOptions,
): PitchRange {
  const now = Number.isFinite(options.now) ? options.now : 0;
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs! >= 0
      ? options.windowMs!
      : DEFAULT_WINDOW_MS;
  let minimum = Infinity;
  let maximum = -Infinity;
  const include = (midi: number | null | undefined) => {
    if (typeof midi !== "number" || !Number.isFinite(midi)) return;
    minimum = Math.min(minimum, midi);
    maximum = Math.max(maximum, midi);
  };

  for (const sample of samples) {
    if (
      Number.isFinite(sample.t) &&
      sample.t >= now - windowMs &&
      sample.t <= now + CLOCK_TOLERANCE_MS
    ) {
      include(sample.midi);
    }
  }
  include(options.target);
  for (const midi of options.referencePitches ?? []) include(midi);

  if (!Number.isFinite(minimum)) minimum = maximum = 60;

  const center = Math.round(minimum / 2 + maximum / 2);
  const span = Math.max(
    MINIMUM_SPAN,
    Math.ceil((maximum - minimum + PITCH_PADDING * 2) / 2) * 2,
  );
  // Integer labels keep a sustained note's small cent fluctuations from
  // moving the axis every frame. Padding still takes precedence at both ends.
  return {
    low: Math.min(center - span / 2, Math.floor(minimum - PITCH_PADDING)),
    high: Math.max(center + span / 2, Math.ceil(maximum + PITCH_PADDING)),
  };
}

/** Choose a readable spacing between the chart's labeled horizontal lines. */
export function chooseNoteLabelStep(range: PitchRange, height: number): number {
  const span = range.high - range.low;
  if (
    !Number.isFinite(span) ||
    span <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return 12;
  }
  const requiredStep = (20 * span) / height;
  return (
    [1, 2, 3, 6, 12].find((step) => step >= requiredStep) ??
    // Very short charts can need more than one octave between labels.
    Math.ceil(requiredStep / 12) * 12
  );
}

/** Expand immediately, and shrink only after the new range settles. */
export class PitchViewport {
  private range: PitchRange | undefined;
  private pending: { range: PitchRange; since: number } | undefined;
  private previousTime = -Infinity;

  update(desired: PitchRange, now: number): PitchRange {
    const next = this.validRange(desired) ? desired : { low: 54, high: 66 };
    const timestamp = Number.isFinite(now) ? now : 0;
    if (timestamp < this.previousTime) this.pending = undefined;
    this.previousTime = timestamp;

    if (!this.range) {
      this.range = { ...next };
      return { ...this.range };
    }

    this.range = {
      low: Math.min(this.range.low, next.low),
      high: Math.max(this.range.high, next.high),
    };
    const removableSpan =
      this.range.high - this.range.low - (next.high - next.low);
    if (removableSpan < 2) {
      this.pending = undefined;
    } else if (
      !this.pending ||
      this.pending.range.low !== next.low ||
      this.pending.range.high !== next.high
    ) {
      this.pending = { range: { ...next }, since: timestamp };
    } else if (timestamp - this.pending.since >= 1_200) {
      this.range = { ...next };
      this.pending = undefined;
    }

    return { ...this.range };
  }

  reset(): void {
    this.range = undefined;
    this.pending = undefined;
    this.previousTime = -Infinity;
  }

  private validRange(range: PitchRange): boolean {
    return (
      Number.isFinite(range.low) &&
      Number.isFinite(range.high) &&
      range.high > range.low
    );
  }
}
