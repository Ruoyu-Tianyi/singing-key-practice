/** One logarithmic scale keeps the analysis meter and its gate comparable. */
export const PREVIEW_FLOOR_DB = -72;

export function amplitudeDb(amplitude: number): number {
  return Number.isFinite(amplitude) && amplitude > 0
    ? 20 * Math.log10(amplitude)
    : -Infinity;
}

export function meterPosition(amplitude: number): number {
  return Math.max(
    0,
    Math.min(
      1,
      (amplitudeDb(amplitude) - PREVIEW_FLOOR_DB) / -PREVIEW_FLOOR_DB,
    ),
  );
}

export function formatAmplitude(amplitude: number): string {
  const db = amplitudeDb(amplitude);
  return Number.isFinite(db)
    ? `${db > 0 ? "+" : ""}${db.toFixed(1)} dBFS`
    : "— dBFS";
}
