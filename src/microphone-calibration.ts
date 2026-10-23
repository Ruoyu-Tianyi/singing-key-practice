import type { MicrophoneSettings } from "./microphone-settings";

export interface CalibrationSample {
  /** Original microphone RMS, before any analysis gain or volume gate. */
  rms: number;
  clarity: number;
  frequency: number | null;
}

export type MicrophoneCalibrationError =
  | "insufficient_noise"
  | "insufficient_voice"
  | "invalid_samples"
  | "unstable_noise"
  | "unstable_voice"
  | "poor_separation"
  | "no_safe_settings";

export type MicrophoneCalibrationResult =
  | {
      success: true;
      settings: Pick<MicrophoneSettings, "inputGain" | "noiseThreshold">;
      /** 95th percentile of valid raw noise amplitudes. */
      noiseRms: number;
      /** 25th percentile of trusted, stable raw singing amplitudes. */
      voiceRms: number;
      separationRatio: number;
      noiseFrameCount: number;
      /** Only the stable, voiced frames used for the recommendation. */
      voiceFrameCount: number;
    }
  | { success: false; error: MicrophoneCalibrationError; reason: string };

const MIN_NOISE_FRAMES = 20;
const MIN_VOICE_FRAMES = 30;
const MIN_STABLE_VOICE_FRAMES = 15;
const MIN_STABLE_VOICE_FRACTION = 0.3;
const MIN_RUN_LENGTH = 3;
const MIN_VOICE_CLARITY = 0.8;
const MIN_SEPARATION_RATIO = 3.5;
const NOISE_MARGIN = 1.8;
const PREFERRED_VOICE_LEVEL = 0.04;

function failure(
  error: MicrophoneCalibrationError,
  reason: string,
): MicrophoneCalibrationResult {
  return { success: false, error, reason };
}

function validRms(sample: CalibrationSample): boolean {
  return (
    sample !== null &&
    typeof sample === "object" &&
    Number.isFinite(sample.rms) &&
    sample.rms >= 0 &&
    sample.rms <= 1
  );
}

function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function trustedVoice(sample: CalibrationSample): boolean {
  return (
    validRms(sample) &&
    sample.rms > 0 &&
    Number.isFinite(sample.clarity) &&
    sample.clarity >= MIN_VOICE_CLARITY &&
    sample.clarity <= 1 &&
    typeof sample.frequency === "number" &&
    Number.isFinite(sample.frequency) &&
    sample.frequency >= 40 &&
    sample.frequency <= 3000
  );
}

/** Preserve sequence gaps: isolated pitched peaks must never become a stable run. */
function stableVoiceAmplitudes(
  samples: readonly CalibrationSample[],
): number[] {
  const stable: number[] = [];
  let run: CalibrationSample[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN_LENGTH)
      stable.push(...run.map((sample) => sample.rms));
    run = [];
  };
  for (const sample of samples) {
    if (!trustedVoice(sample)) {
      flush();
      continue;
    }
    const previous = run.at(-1);
    if (previous) {
      const semitones = Math.abs(
        12 * Math.log2(sample.frequency! / previous.frequency!),
      );
      const amplitudeRatio =
        Math.max(sample.rms, previous.rms) / Math.min(sample.rms, previous.rms);
      if (semitones > 0.75 || amplitudeRatio > 2.5) flush();
    }
    run.push(sample);
  }
  flush();
  return stable.sort((left, right) => left - right);
}

/**
 * Recommend only gain and the amplified-RMS gate. Sampling duration belongs to
 * the caller; these checks also work at 10 Hz and when browser frames are lost.
 * The chosen gate has an explicit margin above 95% of measured noise, while at
 * least 75% of the stable singing frames can reach it. Gain cannot improve SNR.
 */
export function recommendMicrophoneSettings(
  noiseSamples: readonly CalibrationSample[],
  voiceSamples: readonly CalibrationSample[],
): MicrophoneCalibrationResult {
  const validNoise = noiseSamples.filter(validRms);
  const validVoice = voiceSamples.filter(validRms);
  if (validNoise.length < MIN_NOISE_FRAMES) {
    return failure(
      "insufficient_noise",
      "有效的环境噪声样本不足，请保持安静并重新测量。",
    );
  }
  if (validVoice.length < MIN_VOICE_FRAMES) {
    return failure(
      "insufficient_voice",
      "有效的试唱样本不足，请持续轻唱一个音后重新测量。",
    );
  }
  if (
    validNoise.length < noiseSamples.length * 0.75 ||
    validVoice.length < voiceSamples.length * 0.75
  ) {
    return failure(
      "invalid_samples",
      "输入数据不完整或超出有效范围，请检查麦克风连接后重新校准。",
    );
  }
  const noise = validNoise
    .map((sample) => sample.rms)
    .sort((left, right) => left - right);
  const noiseRms = quantile(noise, 0.95);
  if (quantile(noise, 0.9) > Math.max(0.003, quantile(noise, 0.25) * 6)) {
    return failure(
      "unstable_noise",
      "环境噪声变化较大，请避开说话声或突发声音，在较安静的环境重新测量。",
    );
  }
  const voice = stableVoiceAmplitudes(voiceSamples);
  if (
    voice.length <
    Math.max(
      MIN_STABLE_VOICE_FRAMES,
      Math.ceil(voiceSamples.length * MIN_STABLE_VOICE_FRACTION),
    )
  ) {
    return failure(
      "unstable_voice",
      "没有采集到足够稳定的试唱声音，请用舒适音高持续轻唱一个音，并检查识别音域后重试。",
    );
  }
  const voiceRms = quantile(voice, 0.25);
  const separationRatio = voiceRms / Math.max(noiseRms, 1e-9);
  if (separationRatio < MIN_SEPARATION_RATIO) {
    return failure(
      "poor_separation",
      "试唱声音与环境噪声过于接近，无法同时保留轻声并隔离噪声。请减小背景噪声、靠近麦克风后重试。",
    );
  }

  const preferredGain = Math.min(
    4,
    Math.max(0.5, PREFERRED_VOICE_LEVEL / voiceRms),
  );
  let recommendation: {
    inputGain: number;
    noiseThreshold: number;
    distance: number;
  } | null = null;
  // Search the actual UI grid; clamping or rounding after choosing could erase
  // noise isolation or put the gate above the quiet voice's reachable level.
  for (let step = 5; step <= 40; step += 1) {
    const inputGain = step / 10;
    const lowerGate = Math.max(0.001, noiseRms * inputGain * NOISE_MARGIN);
    const noiseThreshold =
      Math.max(1, Math.ceil((lowerGate - 1e-12) * 1000)) / 1000;
    if (noiseThreshold > 0.05 || noiseThreshold > voiceRms * inputGain)
      continue;
    const distance = Math.abs(Math.log(inputGain / preferredGain));
    if (!recommendation || distance < recommendation.distance) {
      recommendation = { inputGain, noiseThreshold, distance };
    }
  }
  if (!recommendation) {
    if (voiceRms * 4 < 0.001) {
      return failure(
        "no_safe_settings",
        "试唱声音过轻，最高增益仍无法达到最小门限。请靠近麦克风或检查设备输入音量后重试。",
      );
    }
    return failure(
      "no_safe_settings",
      "当前增益和门限的可调范围内没有安全组合，请减小环境噪声或调整麦克风距离后重新校准。",
    );
  }
  return {
    success: true,
    settings: {
      inputGain: recommendation.inputGain,
      noiseThreshold: recommendation.noiseThreshold,
    },
    noiseRms,
    voiceRms,
    separationRatio,
    noiseFrameCount: validNoise.length,
    voiceFrameCount: voice.length,
  };
}
