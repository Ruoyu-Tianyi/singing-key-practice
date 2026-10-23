export interface MicrophoneSettings {
  /** Linear amplification used for analysis only; never connected to speakers. */
  inputGain: number;
  /** Minimum amplified RMS amplitude accepted for pitch analysis. */
  noiseThreshold: number;
  minFrequency: number;
  maxFrequency: number;
  /** Minimum reported pitch clarity, independent of MPM peak selection. */
  clarityThreshold: number;
  updateRateHz: 10 | 20 | 30 | 60;
  fftSize: 2048 | 4096 | 8192;
}

export const DEFAULT_MICROPHONE_SETTINGS: Readonly<MicrophoneSettings> =
  Object.freeze({
    inputGain: 1,
    noiseThreshold: 0.008,
    minFrequency: 50,
    maxFrequency: 2200,
    clarityThreshold: 0.87,
    updateRateHz: 30,
    fftSize: 4096,
  });

function normalizeRecord(
  value: unknown,
  fallback: Readonly<MicrophoneSettings>,
): MicrophoneSettings {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bounded = (
    key: keyof MicrophoneSettings,
    minimum: number,
    maximum: number,
  ): number => {
    const candidate = source[key];
    return typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(maximum, Math.max(minimum, candidate))
      : fallback[key];
  };
  let minFrequency = bounded("minFrequency", 40, 500);
  let maxFrequency = bounded("maxFrequency", 200, 3000);
  // Invalid saved ranges or partial edits keep the last valid pair together.
  if (minFrequency >= maxFrequency) {
    minFrequency = fallback.minFrequency;
    maxFrequency = fallback.maxFrequency;
  }
  const rate = source.updateRateHz;
  const fftSize = source.fftSize;
  return {
    inputGain: bounded("inputGain", 0.5, 4),
    noiseThreshold: bounded("noiseThreshold", 0.001, 0.05),
    minFrequency,
    maxFrequency,
    clarityThreshold: bounded("clarityThreshold", 0.6, 0.99),
    updateRateHz:
      rate === 10 || rate === 20 || rate === 30 || rate === 60
        ? rate
        : fallback.updateRateHz,
    fftSize:
      fftSize === 2048 || fftSize === 4096 || fftSize === 8192
        ? fftSize
        : fallback.fftSize,
  };
}

/** Safe for untrusted persisted JSON; omitted or invalid fields retain base values. */
export function normalizeMicrophoneSettings(
  value: unknown = {},
  base: Readonly<MicrophoneSettings> = DEFAULT_MICROPHONE_SETTINGS,
): MicrophoneSettings {
  return normalizeRecord(
    value,
    normalizeRecord(base, DEFAULT_MICROPHONE_SETTINGS),
  );
}
