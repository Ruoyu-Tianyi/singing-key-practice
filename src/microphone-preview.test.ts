import { describe, expect, it } from "vitest";
import {
  amplitudeDb,
  formatAmplitude,
  meterPosition,
} from "./microphone-preview";

describe("microphone preview meter", () => {
  it("compares amplified input and its gate on the same logarithmic scale", () => {
    const raw = 0.005;
    const gate = 0.008;
    expect(meterPosition(raw)).toBeLessThan(meterPosition(gate));
    expect(meterPosition(raw * 2)).toBeGreaterThan(meterPosition(gate));
    expect(amplitudeDb(raw * 2) - amplitudeDb(raw)).toBeCloseTo(6.0206);
    expect(formatAmplitude(raw)).toBe("-46.0 dBFS");
    expect(formatAmplitude(raw * 2)).toBe("-40.0 dBFS");
  });

  it("keeps silence and invalid input finite in the displayed meter", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(meterPosition(value)).toBe(0);
      expect(formatAmplitude(value)).toBe("— dBFS");
    }
  });

  it("clamps the meter without hiding an over-full-scale analysis level", () => {
    expect(meterPosition(0.000001)).toBe(0);
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(2)).toBe(1);
    expect(formatAmplitude(2)).toBe("+6.0 dBFS");
  });
});
