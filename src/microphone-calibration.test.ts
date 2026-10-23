import { describe, expect, it } from "vitest";
import {
  recommendMicrophoneSettings,
  type CalibrationSample,
  type MicrophoneCalibrationResult,
} from "./microphone-calibration";

const noise = (rms: number, count = 40): CalibrationSample[] =>
  Array.from({ length: count }, () => ({ rms, clarity: 0, frequency: null }));
const voice = (rms: number, count = 60): CalibrationSample[] =>
  Array.from({ length: count }, () => ({ rms, clarity: 0.98, frequency: 220 }));

function expectSuccess(result: MicrophoneCalibrationResult) {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.reason);
  const { inputGain, noiseThreshold } = result.settings;
  expect(inputGain).toBeGreaterThanOrEqual(0.5);
  expect(inputGain).toBeLessThanOrEqual(4);
  expect(inputGain * 10).toBeCloseTo(Math.round(inputGain * 10), 10);
  expect(noiseThreshold).toBeGreaterThanOrEqual(0.001);
  expect(noiseThreshold).toBeLessThanOrEqual(0.05);
  expect(noiseThreshold * 1000).toBeCloseTo(
    Math.round(noiseThreshold * 1000),
    10,
  );
  expect(noiseThreshold).toBeGreaterThan(result.noiseRms * inputGain);
  expect(noiseThreshold).toBeLessThanOrEqual(result.voiceRms * inputGain);
  expect(Number.isFinite(result.separationRatio)).toBe(true);
  return result;
}

function expectFailure(result: MicrophoneCalibrationResult, error: string) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Unexpected settings recommendation");
  expect(result.error).toBe(error);
  expect(result.reason).toMatch(/[\u4e00-\u9fff]/);
  expect("settings" in result).toBe(false);
}

describe("raw microphone calibration", () => {
  it("recommends quantized settings from a normal low-rate singing capture", () => {
    const result = expectSuccess(
      recommendMicrophoneSettings(noise(0.001), voice(0.02)),
    );
    expect(result.settings).toEqual({ inputGain: 2, noiseThreshold: 0.004 });
    expect(result.noiseRms).toBe(0.001);
    expect(result.voiceRms).toBe(0.02);
    expect(result.noiseFrameCount).toBe(40);
    expect(result.voiceFrameCount).toBe(60);
  });

  it("raises quiet singing above a safe gate using raw rather than already amplified RMS", () => {
    const result = expectSuccess(
      recommendMicrophoneSettings(noise(0.0003), voice(0.002)),
    );
    expect(result.settings.inputGain).toBe(4);
    expect(result.settings.noiseThreshold).toBe(0.003);
    expect(0.002).toBeLessThan(0.008); // Default gain/gate would miss this voice.
    expect(0.002 * result.settings.inputGain).toBeGreaterThan(
      result.settings.noiseThreshold,
    );
  });

  it("supports the quietest reachable raw boundary in a silent room", () => {
    const result = expectSuccess(
      recommendMicrophoneSettings(noise(0), voice(0.00025)),
    );
    expect(result.settings).toEqual({ inputGain: 4, noiseThreshold: 0.001 });
    expectFailure(
      recommendMicrophoneSettings(noise(0), voice(0.000249)),
      "no_safe_settings",
    );
  });

  it("can lower gain for louder input without losing noise isolation", () => {
    const result = expectSuccess(
      recommendMicrophoneSettings(noise(0.01), voice(0.2)),
    );
    expect(result.settings.inputGain).toBe(0.5);
    expect(result.settings.noiseThreshold).toBe(0.009);
  });

  it("ignores rare transients and uses softer stable singing instead of a loud peak", () => {
    const noises = noise(0.001, 120);
    noises[20] = { rms: 0.2, clarity: 0, frequency: null };
    noises[70] = { rms: 0.1, clarity: 0, frequency: null };
    const singing = voice(0.01, 180);
    singing[30] = { rms: 0.4, clarity: 0.99, frequency: 220 };
    singing[90] = { rms: 0.3, clarity: 0.99, frequency: 220 };
    const result = expectSuccess(recommendMicrophoneSettings(noises, singing));
    expect(result.noiseRms).toBe(0.001);
    expect(result.voiceRms).toBe(0.01);
  });

  it("accepts a stable sung note with modest vibrato, breathing gaps and input variation", () => {
    const singing = voice(0.02, 180).map((sample, index) => ({
      ...sample,
      rms: 0.018 + (index % 7) * 0.001,
      frequency: 220 * 2 ** ((Math.sin(index) * 0.2) / 12),
    }));
    for (let index = 65; index < 78; index += 1)
      singing[index] = { rms: 0.001, clarity: 0, frequency: 0 };
    const result = expectSuccess(
      recommendMicrophoneSettings(noise(0.001, 120), singing),
    );
    expect(result.voiceFrameCount).toBeLessThan(180);
    expect(result.voiceFrameCount).toBeGreaterThan(150);
    expect(result.voiceRms).toBeLessThan(0.024);
  });

  it("requires enough capture in both phases", () => {
    expectFailure(
      recommendMicrophoneSettings(noise(0.001, 19), voice(0.02)),
      "insufficient_noise",
    );
    expectFailure(
      recommendMicrophoneSettings(noise(0.001), voice(0.02, 29)),
      "insufficient_voice",
    );
    expectSuccess(
      recommendMicrophoneSettings(noise(0.001, 20), voice(0.02, 30)),
    );
  });

  it("rejects changing environmental noise rather than deriving an unsafe average", () => {
    expectFailure(
      recommendMicrophoneSettings(
        [...noise(0.001, 60), ...noise(0.02, 60)],
        voice(0.1),
      ),
      "unstable_noise",
    );
  });

  it("refuses to repair low signal-to-noise separation with extra gain", () => {
    expectFailure(
      recommendMicrophoneSettings(noise(0.01), voice(0.02)),
      "poor_separation",
    );
  });

  it("fails when noise cannot be isolated within the available gain/gate range", () => {
    expectFailure(
      recommendMicrophoneSettings(noise(0.08), voice(0.4)),
      "no_safe_settings",
    );
  });

  it("requires genuine continuous stable frames rather than isolated confident peaks", () => {
    const intermittent = voice(0.02).map((sample, index) =>
      index % 3 === 2 ? { rms: 0.001, clarity: 0.1, frequency: null } : sample,
    );
    expectFailure(
      recommendMicrophoneSettings(noise(0.001), intermittent),
      "unstable_voice",
    );
    const jumping = voice(0.02).map((sample, index) => ({
      ...sample,
      frequency: index % 2 ? 220 : 440,
    }));
    expectFailure(
      recommendMicrophoneSettings(noise(0.001), jumping),
      "unstable_voice",
    );
    const unclear = voice(0.02).map((sample) => ({ ...sample, clarity: 0.7 }));
    expectFailure(
      recommendMicrophoneSettings(noise(0.001), unclear),
      "unstable_voice",
    );
  });

  it("fails if most of a singing capture is silent or unvoiced", () => {
    expectFailure(
      recommendMicrophoneSettings(noise(0.001), [
        ...voice(0.02, 15),
        ...noise(0.001, 75),
      ]),
      "unstable_voice",
    );
  });

  it("filters occasional bad RMS but rejects mostly malformed input", () => {
    const bad = [Number.NaN, Infinity, -0.1, 2].map((rms) => ({
      rms,
      clarity: 0,
      frequency: null,
    }));
    expectSuccess(
      recommendMicrophoneSettings([...noise(0.001), ...bad], voice(0.02)),
    );
    expectFailure(
      recommendMicrophoneSettings(
        [...noise(0.001, 20), ...Array.from({ length: 20 }, () => bad[0])],
        voice(0.02),
      ),
      "invalid_samples",
    );
    expectFailure(
      recommendMicrophoneSettings(
        noise(0.001),
        voice(0.02).map((sample) => ({ ...sample, frequency: Infinity })),
      ),
      "unstable_voice",
    );
  });

  it("is deterministic and leaves frozen caller samples untouched", () => {
    const noises = Object.freeze(
      noise(0.001).map((sample) => Object.freeze(sample)),
    );
    const singing = Object.freeze(
      voice(0.02).map((sample) => Object.freeze(sample)),
    );
    expect(recommendMicrophoneSettings(noises, singing)).toEqual(
      recommendMicrophoneSettings(noises, singing),
    );
    expect(singing.every((sample) => sample.rms === 0.02)).toBe(true);
  });

  it("keeps noise and quiet-voice inequalities after grid quantization across useful levels", () => {
    for (const rawNoise of [0, 0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03]) {
      for (const rawVoice of [
        0.00025, 0.0004, 0.001, 0.002, 0.01, 0.03, 0.1, 0.3,
      ]) {
        const result = recommendMicrophoneSettings(
          noise(rawNoise),
          voice(rawVoice),
        );
        if (!result.success) continue;
        expectSuccess(result);
        expect(result.settings.noiseThreshold).toBeGreaterThanOrEqual(
          rawNoise * result.settings.inputGain * 1.8 - 1e-12,
        );
        expect(result.settings.noiseThreshold).toBeLessThanOrEqual(
          rawVoice * result.settings.inputGain,
        );
      }
    }
  });
});
