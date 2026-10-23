import { describe, expect, it } from "vitest";
import {
  DEFAULT_MICROPHONE_SETTINGS,
  normalizeMicrophoneSettings,
} from "./microphone-settings";

describe("microphone settings normalization", () => {
  it("keeps the existing listening defaults and accepts legacy saved settings", () => {
    expect(normalizeMicrophoneSettings()).toEqual({
      inputGain: 1,
      noiseThreshold: 0.008,
      minFrequency: 50,
      maxFrequency: 2200,
      clarityThreshold: 0.87,
      updateRateHz: 30,
      fftSize: 4096,
    });
    expect(normalizeMicrophoneSettings({ a4: 442, latency: 100 })).toEqual(
      DEFAULT_MICROPHONE_SETTINGS,
    );
  });

  it.each([null, [], "settings", 60, undefined])(
    "accepts malformed saved values without throwing: %s",
    (value) => {
      expect(normalizeMicrophoneSettings(value)).toEqual(
        DEFAULT_MICROPHONE_SETTINGS,
      );
    },
  );

  it("clamps finite settings to safe bounds", () => {
    expect(
      normalizeMicrophoneSettings({
        inputGain: 10,
        noiseThreshold: 0,
        minFrequency: -20,
        maxFrequency: 6000,
        clarityThreshold: 1,
      }),
    ).toMatchObject({
      inputGain: 4,
      noiseThreshold: 0.001,
      minFrequency: 40,
      maxFrequency: 3000,
      clarityThreshold: 0.99,
    });
    expect(
      normalizeMicrophoneSettings({
        inputGain: 0,
        noiseThreshold: 1,
        clarityThreshold: 0,
      }),
    ).toMatchObject({
      inputGain: 0.5,
      noiseThreshold: 0.05,
      clarityThreshold: 0.6,
    });
  });

  it("rejects nonfinite numbers, coercible strings and unsupported enum choices", () => {
    expect(
      normalizeMicrophoneSettings({
        inputGain: Number.NaN,
        noiseThreshold: Number.POSITIVE_INFINITY,
        minFrequency: "100",
        maxFrequency: null,
        clarityThreshold: false,
        updateRateHz: 25,
        fftSize: 3072,
      }),
    ).toEqual(DEFAULT_MICROPHONE_SETTINGS);
  });

  it("merges partial live edits into the previous settings", () => {
    const previous = normalizeMicrophoneSettings({
      inputGain: 2,
      minFrequency: 65,
      maxFrequency: 1000,
      fftSize: 8192,
    });
    expect(normalizeMicrophoneSettings({ updateRateHz: 20 }, previous)).toEqual(
      { ...previous, updateRateHz: 20 },
    );
    expect(
      normalizeMicrophoneSettings(
        { minFrequency: 500, maxFrequency: 200 },
        previous,
      ),
    ).toEqual(previous);
  });

  it("round trips valid presets and never mutates inputs or frozen defaults", () => {
    const preset = {
      ...DEFAULT_MICROPHONE_SETTINGS,
      minFrequency: 130,
      maxFrequency: 2000,
    };
    const result = normalizeMicrophoneSettings(preset);
    expect(result).toEqual(preset);
    result.inputGain = 3;
    expect(preset.inputGain).toBe(1);
    expect(DEFAULT_MICROPHONE_SETTINGS.inputGain).toBe(1);
    expect(Object.isFrozen(DEFAULT_MICROPHONE_SETTINGS)).toBe(true);
  });
});
