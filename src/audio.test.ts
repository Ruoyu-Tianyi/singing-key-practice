import { afterEach, describe, expect, it, vi } from "vitest";
import { PitchDetector } from "pitchy";
import {
  AudioEngine,
  DEFAULT_MICROPHONE_SETTINGS,
  detectPitchFrame,
  frequencyToMidi,
  midiToFrequency,
  noteLabel,
  normalizeMicrophoneSettings,
} from "./audio";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function signal(
  frequency: number,
  sampleRate = 48000,
  amplitude = 0.3,
  length = 4096,
): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

describe("equal-tempered note math", () => {
  it("maps A4 and middle C to their frequencies", () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.625565, 5);
    expect(frequencyToMidi(440)).toBe(69);
  });

  it("round trips fractional pitch with alternate reference tuning", () => {
    for (const midi of [21, 48, 60.25, 69, 84.7, 108]) {
      expect(frequencyToMidi(midiToFrequency(midi, 442), 442)).toBeCloseTo(
        midi,
        10,
      );
    }
  });

  it("formats octaves, sharps and the nearest note", () => {
    expect(noteLabel(0)).toBe("C-1");
    expect(noteLabel(60)).toBe("C4");
    expect(noteLabel(60.8)).toBe("C#4");
    expect(noteLabel(69)).toBe("A4");
    expect(noteLabel(127)).toBe("G9");
    expect(noteLabel(Number.NaN)).toBe("—");
  });

  it("rejects invalid frequencies and tuning", () => {
    expect(frequencyToMidi(0)).toBeNaN();
    expect(frequencyToMidi(-440)).toBeNaN();
    expect(frequencyToMidi(Infinity)).toBeNaN();
    expect(midiToFrequency(Number.NaN)).toBeNaN();
    expect(midiToFrequency(60, 0)).toBeNaN();
  });
});

describe("McLeod pitch analysis", () => {
  it.each([110, 220, 440, 880])(
    "detects a synthesized %i Hz tone",
    (frequency) => {
      const frame = detectPitchFrame(signal(frequency), 48000, 440, 12.5);
      expect(frame.frequency).toBeCloseTo(frequency, 0);
      expect(frame.clarity).toBeGreaterThan(0.98);
      expect(frame.cents).toBeCloseTo(0, 0);
      expect(frame.time).toBe(12.5);
      expect(frame.rms).toBeGreaterThan(0.2);
    },
  );

  it("detects a voice-like harmonic signal at a different sample rate", () => {
    const sampleRate = 44100;
    const frequency = midiToFrequency(60.2);
    const samples = Float32Array.from({ length: 4096 }, (_, index) => {
      const phase = (2 * Math.PI * frequency * index) / sampleRate;
      return (
        0.25 * Math.sin(phase) +
        0.12 * Math.sin(phase * 2) +
        0.05 * Math.sin(phase * 3)
      );
    });
    const frame = detectPitchFrame(samples, sampleRate);
    expect(frame.midi).toBeCloseTo(60.2, 2);
    expect(frame.cents).toBeCloseTo(20, 0);
  });

  it("returns no pitch for silence and very quiet signals", () => {
    expect(
      detectPitchFrame(new Float32Array(4096), 48000).frequency,
    ).toBeNull();
    expect(detectPitchFrame(signal(440, 48000, 0.001), 48000).midi).toBeNull();
    expect(detectPitchFrame(new Float32Array(), 48000).frequency).toBeNull();
  });

  it("rejects unpitched broadband noise and out-of-range tones", () => {
    let seed = 12345;
    const noise = Float32Array.from({ length: 4096 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed / 2147483648) * 0.3;
    });
    expect(detectPitchFrame(noise, 48000).frequency).toBeNull();
    expect(detectPitchFrame(signal(4000), 48000).frequency).toBeNull();
  });

  it("amplifies quiet analysis without changing raw input RMS, waveform or frequency", () => {
    const samples = signal(440, 48000, 0.004);
    const original = samples.slice();
    const ordinary = detectPitchFrame(samples, 48000);
    const amplified = detectPitchFrame(
      samples,
      48000,
      440,
      0,
      undefined,
      normalizeMicrophoneSettings({ inputGain: 4 }),
    );
    expect(ordinary.frequency).toBeNull();
    expect(amplified.frequency).toBeCloseTo(440, 0);
    expect(amplified.rms).toBeCloseTo(ordinary.rms, 12);
    expect(samples).toEqual(original);
    // Lowering only the explicit gate must also allow a quiet, clear voice.
    const sensitive = detectPitchFrame(
      samples,
      48000,
      440,
      0,
      undefined,
      normalizeMicrophoneSettings({ noiseThreshold: 0.001 }),
    );
    expect(sensitive.frequency).toBeCloseTo(440, 0);
    const rejected = detectPitchFrame(
      signal(440, 48000, 0.08),
      48000,
      440,
      0,
      undefined,
      normalizeMicrophoneSettings({ inputGain: 0.5, noiseThreshold: 0.05 }),
    );
    expect(rejected.frequency).toBeNull();
    expect(
      detectPitchFrame(
        signal(440, 48000, 0.8),
        48000,
        440,
        0,
        undefined,
        normalizeMicrophoneSettings({ inputGain: 4 }),
      ).frequency,
    ).toBeCloseTo(440, 0);
  });

  it("uses the configured gate independently of any detector-level minimum volume", () => {
    const samples = signal(440, 48000, 0.004);
    const detector = PitchDetector.forFloat32Array(samples.length);
    detector.minVolumeAbsolute = 0.5;
    const frame = detectPitchFrame(
      samples,
      48000,
      440,
      0,
      detector,
      normalizeMicrophoneSettings({ noiseThreshold: 0.001 }),
    );
    expect(frame.frequency).toBeCloseTo(440, 0);
  });

  it("applies inclusive frequency/clarity boundaries and rejects values outside them", () => {
    const detector = PitchDetector.forFloat32Array(4096);
    const findPitch = vi.spyOn(detector, "findPitch");
    const settings = normalizeMicrophoneSettings({
      minFrequency: 130,
      maxFrequency: 1000,
      clarityThreshold: 0.9,
    });
    for (const [frequency, clarity, accepted] of [
      [130, 0.9, true],
      [1000, 0.9, true],
      [129.99, 1, false],
      [1000.01, 1, false],
      [440, 0.8999, false],
    ] as const) {
      findPitch.mockReturnValue([frequency, clarity]);
      const frame = detectPitchFrame(
        signal(440),
        48000,
        440,
        0,
        detector,
        settings,
      );
      expect(frame.frequency !== null).toBe(accepted);
    }
  });

  it.each([2048, 4096, 8192] as const)(
    "detects real synthetic signals using a %i-sample window",
    (fftSize) => {
      const settings = normalizeMicrophoneSettings({ fftSize, inputGain: 4 });
      const frame = detectPitchFrame(
        signal(220, 44100, 0.01, fftSize),
        44100,
        440,
        0,
        undefined,
        settings,
      );
      expect(frame.frequency).toBeCloseTo(220, 0);
    },
  );
});

function mockAudioBrowser() {
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const oscillator = () => ({
    ...node(),
    type: "sine",
    frequency: parameter(),
    detune: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
    setPeriodicWave: vi.fn(),
    onended: null,
  });
  const oscillators: ReturnType<typeof oscillator>[] = [];
  const context = {
    state: "running",
    currentTime: 10,
    sampleRate: 48000,
    destination: node(),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createGain: () => ({ ...node(), gain: parameter() }),
    createOscillator: () => {
      const result = oscillator();
      oscillators.push(result);
      return result;
    },
    createPeriodicWave: vi.fn(),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  const requestAnimationFrame = vi.fn();
  const cancelAnimationFrame = vi.fn();
  vi.stubGlobal("window", {
    AudioContext: vi.fn(function () {
      return context;
    }),
    requestAnimationFrame,
    cancelAnimationFrame,
  });
  return { context, oscillators, requestAnimationFrame, cancelAnimationFrame };
}

function mockLiveMicrophone(frequency = 440, amplitude = 0.004) {
  const browser = mockAudioBrowser();
  let scheduled: FrameRequestCallback | null = null;
  let frameId = 0;
  browser.requestAnimationFrame.mockImplementation(
    (callback: FrameRequestCallback) => {
      scheduled = callback;
      return ++frameId;
    },
  );
  const analyser = {
    fftSize: 4096,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => {
      if (amplitude === 0) samples.fill(0);
      else
        samples.set(
          signal(
            frequency,
            browser.context.sampleRate,
            amplitude,
            samples.length,
          ),
        );
    }),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  Object.assign(browser.context, {
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
  });
  const stopTrack = vi.fn();
  const getUserMedia = vi
    .fn()
    .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const step = (timestamp: number) => {
    const callback = scheduled;
    scheduled = null;
    callback?.(timestamp);
  };
  return { ...browser, analyser, source, stopTrack, getUserMedia, step };
}

describe("live microphone configuration", () => {
  it("applies gain, frequency and FFT changes without reconnecting or monitoring the microphone", async () => {
    const browser = mockLiveMicrophone();
    const detectorFactory = vi.spyOn(PitchDetector, "forFloat32Array");
    const engine = new AudioEngine();
    expect(engine.microphoneSampleRate).toBeNull();
    const saved = engine.configureMicrophone({
      inputGain: 4,
      updateRateHz: 10,
    });
    saved.inputGain = 1;
    expect(engine.microphoneSettings.inputGain).toBe(4);
    Object.assign(engine.microphoneSettings, { inputGain: 1 });
    expect(engine.microphoneSettings.inputGain).toBe(4);
    const onFrame = vi.fn();
    await engine.startMicrophone(onFrame);
    expect(engine.microphoneSampleRate).toBe(48000);
    browser.step(0);
    const rawRms = onFrame.mock.lastCall![0].rms;
    expect(onFrame.mock.lastCall![0].frequency).toBeCloseTo(440, 0);

    engine.configureMicrophone({
      minFrequency: 500,
      maxFrequency: 1000,
      fftSize: 8192,
      updateRateHz: 60,
    });
    expect(browser.analyser.fftSize).toBe(8192);
    expect(detectorFactory).toHaveBeenCalledWith(8192);
    browser.step(1000 / 60);
    expect(
      browser.analyser.getFloatTimeDomainData.mock.lastCall![0],
    ).toHaveLength(8192);
    expect(onFrame.mock.lastCall![0].frequency).toBeNull();
    engine.configureMicrophone({
      minFrequency: 50,
      maxFrequency: 2200,
      inputGain: 1,
    });
    browser.step(2000 / 60);
    expect(onFrame.mock.lastCall![0].frequency).toBeNull();
    engine.configureMicrophone({ inputGain: 4, fftSize: 2048 });
    browser.step(3000 / 60);
    expect(
      browser.analyser.getFloatTimeDomainData.mock.lastCall![0],
    ).toHaveLength(2048);
    expect(onFrame.mock.lastCall![0].frequency).toBeCloseTo(440, 0);
    // Different window phases can vary RMS slightly; gain never changes it fourfold.
    expect(onFrame.mock.lastCall![0].rms).toBeCloseTo(rawRms, 4);
    expect(browser.getUserMedia).toHaveBeenCalledOnce();
    expect(browser.source.connect).toHaveBeenCalledExactlyOnceWith(
      browser.analyser,
    );
    expect(browser.analyser.connect).not.toHaveBeenCalled();
    const framesAtStop = onFrame.mock.calls.length;
    engine.stopMicrophone();
    expect(engine.microphoneSampleRate).toBeNull();
    expect(browser.stopTrack).toHaveBeenCalledOnce();
    expect(browser.cancelAnimationFrame).toHaveBeenCalled();
    expect(browser.source.disconnect).toHaveBeenCalledOnce();
    browser.step(4000 / 60);
    expect(onFrame).toHaveBeenCalledTimes(framesAtStop);
    await engine.close();
  });

  it.each([10, 20, 30, 60] as const)(
    "sustains a %i Hz target on rounded 60 Hz animation timestamps",
    async (updateRateHz) => {
      const browser = mockLiveMicrophone(440, 0);
      const engine = new AudioEngine();
      engine.configureMicrophone({ updateRateHz });
      const onFrame = vi.fn();
      await engine.startMicrophone(onFrame);
      for (let index = 0; index <= 60; index += 1) {
        browser.step(Math.round(index * (1000 / 60) * 1000) / 1000);
      }
      expect(onFrame).toHaveBeenCalledTimes(updateRateHz + 1);
      await engine.close();
    },
  );

  it("caps updates at browser callbacks and never catches up with bursts after a stall", async () => {
    const browser = mockLiveMicrophone(440, 0);
    const engine = new AudioEngine();
    engine.configureMicrophone({ updateRateHz: 60 });
    const onFrame = vi.fn();
    await engine.startMicrophone(onFrame);
    for (let index = 0; index <= 30; index += 1)
      browser.step(index * (1000 / 30));
    expect(onFrame).toHaveBeenCalledTimes(31);
    browser.step(5000);
    expect(onFrame).toHaveBeenCalledTimes(32);
    await engine.close();
  });

  it("preserves the latest valid settings while microphone permission is pending", async () => {
    const browser = mockLiveMicrophone();
    let grant!: (stream: MediaStream) => void;
    browser.getUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const engine = new AudioEngine();
    const onFrame = vi.fn();
    const starting = engine.startMicrophone(onFrame);
    await Promise.resolve();
    engine.configureMicrophone({ fftSize: 8192, inputGain: 4 });
    grant({
      getTracks: () => [{ stop: browser.stopTrack }],
    } as unknown as MediaStream);
    await starting;
    browser.step(0);
    expect(browser.analyser.fftSize).toBe(8192);
    expect(onFrame.mock.lastCall![0].frequency).toBeCloseTo(440, 0);
    expect(engine.microphoneSettings).toEqual({
      ...DEFAULT_MICROPHONE_SETTINGS,
      fftSize: 8192,
      inputGain: 4,
    });
    await engine.close();
  });
});

describe("audio lifecycle and musical scheduling", () => {
  it.each(["stop", "close"])(
    "releases a late microphone permission result after %s",
    async (action) => {
      const { requestAnimationFrame } = mockAudioBrowser();
      let grantPermission!: (stream: MediaStream) => void;
      const getUserMedia = vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            grantPermission = resolve;
          }),
      );
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
      const engine = new AudioEngine();
      const starting = engine.startMicrophone(vi.fn());
      await Promise.resolve();
      expect(getUserMedia).toHaveBeenCalledOnce();
      if (action === "close") await engine.close();
      else engine.stopMicrophone();
      const stopTrack = vi.fn();
      grantPermission({
        getTracks: () => [{ stop: stopTrack }],
      } as unknown as MediaStream);
      await starting;
      expect(stopTrack).toHaveBeenCalledOnce();
      expect(requestAnimationFrame).not.toHaveBeenCalled();
      await engine.close();
    },
  );

  it("explains microphone permission failures in Chinese", async () => {
    mockAudioBrowser();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      },
    });
    const engine = new AudioEngine();
    await expect(engine.startMicrophone(vi.fn())).rejects.toThrow(
      "请允许此网站使用麦克风",
    );
    await engine.close();
  });

  it("schedules exact audio times including count-in and rests, then cancels callbacks", async () => {
    vi.useFakeTimers();
    const { context, oscillators } = mockAudioBrowser();
    const engine = new AudioEngine();
    const onTimeline = vi.fn();
    const onNote = vi.fn();
    const onComplete = vi.fn();
    await engine.scheduleNotes(
      [
        { midi: 60, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 64, beats: 1 },
      ],
      120,
      "piano",
      { countIn: 2, metronome: true, onTimeline, onNote, onComplete },
    );
    expect(onTimeline).toHaveBeenCalledOnce();
    expect(onTimeline.mock.calls[0][0]).toBeCloseTo(
      performance.now() + 1080,
      6,
    );
    expect(oscillators).toHaveLength(1); // Only the first count-in click is within the lookahead.
    expect(onNote).not.toHaveBeenCalled();
    context.currentTime = 10.9;
    await vi.advanceTimersByTimeAsync(20);
    const middleC = oscillators.find(
      (voice) => voice.frequency.value === midiToFrequency(60),
    );
    expect(middleC?.start).toHaveBeenCalledWith(11.08);
    expect(onNote).not.toHaveBeenCalled();
    context.currentTime = 11.59;
    await vi.advanceTimersByTimeAsync(20);
    const e4 = oscillators.find(
      (voice) => voice.frequency.value === midiToFrequency(64),
    );
    expect(e4?.start).toHaveBeenCalledWith(11.83);
    expect(onNote.mock.calls).toEqual([[0], [1]]);
    context.currentTime = 11.84;
    await vi.advanceTimersByTimeAsync(20);
    expect(onNote.mock.calls).toEqual([[0], [1], [2]]);
    context.currentTime = 12.34;
    await vi.advanceTimersByTimeAsync(20);
    expect(onComplete).toHaveBeenCalledOnce();

    onNote.mockClear();
    onComplete.mockClear();
    await engine.scheduleNotes([{ midi: 60, beats: 4 }], 120, "accordion", {
      onNote,
      onComplete,
    });
    engine.stopPlayback();
    context.currentTime = 20;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onNote).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    await engine.close();
  });

  it("maps the scheduled onset using the browser output timestamp when available", async () => {
    const { context } = mockAudioBrowser();
    Object.assign(context, {
      getOutputTimestamp: () => ({ contextTime: 9.98, performanceTime: 1000 }),
    });
    const engine = new AudioEngine();
    const onTimeline = vi.fn();
    await engine.scheduleNotes([{ midi: null, beats: 1 }], 120, "piano", {
      countIn: 2,
      onTimeline,
    });
    expect(onTimeline.mock.calls[0][0]).toBeCloseTo(2100, 6);
    await engine.close();
  });

  it("creates only a short audio horizon for a 10,000-note song, then cancels future work", async () => {
    vi.useFakeTimers();
    const { context, oscillators } = mockAudioBrowser();
    const engine = new AudioEngine();
    const notes = Array.from({ length: 10000 }, () => ({
      midi: 60,
      beats: 0.25,
    }));
    await engine.scheduleNotes(notes, 120, "piano", { metronome: true });
    // Two six-partial piano notes and one click fit the initial 250 ms horizon.
    expect(oscillators).toHaveLength(13);
    expect(
      oscillators.every((voice) => voice.start.mock.calls[0][0] <= 10.25),
    ).toBe(true);
    context.currentTime = 10.2;
    await vi.advanceTimersByTimeAsync(20);
    expect(oscillators).toHaveLength(19);
    const nextFundamental = oscillators
      .filter((voice) => voice.frequency.value === midiToFrequency(60))
      .at(-1);
    expect(nextFundamental?.start.mock.calls[0][0]).toBeCloseTo(10.33, 8);
    engine.stopPlayback();
    const countAtStop = oscillators.length;
    context.currentTime = 20;
    await vi.advanceTimersByTimeAsync(2000);
    expect(oscillators).toHaveLength(countAtStop);
    await engine.close();
  });

  it("skips expired audio after a timer stall rather than playing a catch-up burst", async () => {
    vi.useFakeTimers();
    const { context, oscillators } = mockAudioBrowser();
    const engine = new AudioEngine();
    const onComplete = vi.fn();
    await engine.scheduleNotes(
      [60, 62, 64, 65].map((midi) => ({ midi, beats: 0.25 })),
      120,
      "piano",
      { onComplete },
    );
    expect(oscillators).toHaveLength(12);
    context.currentTime = 11;
    await vi.advanceTimersByTimeAsync(20);
    expect(oscillators).toHaveLength(12);
    expect(onComplete).toHaveBeenCalledOnce();
    await engine.close();
  });

  it("bounds live voices even when pathological tiny durations all fit the horizon", async () => {
    const { oscillators } = mockAudioBrowser();
    const engine = new AudioEngine();
    await engine.scheduleNotes(
      Array.from({ length: 10000 }, () => ({ midi: 60, beats: 1e-9 })),
      120,
      "piano",
    );
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.length).toBeLessThanOrEqual(64 * 6);
    const previousCount = oscillators.length;
    await engine.scheduleNotes([{ midi: 62, beats: 1 }], 120, "piano");
    expect(oscillators).toHaveLength(previousCount + 6);
    await engine.close();
  });

  it.each([
    {
      meter: "3/4",
      duration: 6,
      quarterOffsets: [0, 1, 2, 3, 4, 5],
      accents: [0, 3],
    },
    {
      meter: "5/8",
      duration: 5,
      quarterOffsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
      accents: [0, 5],
    },
  ])(
    "resets song accents in $meter after four quarter-note count-in clicks",
    async ({ meter, duration, quarterOffsets, accents }) => {
      vi.useFakeTimers();
      const { context, oscillators } = mockAudioBrowser();
      const engine = new AudioEngine();
      await engine.scheduleNotes(
        [{ midi: null, beats: duration }],
        120,
        "piano",
        {
          countIn: 4,
          metronome: true,
          timeSignature: meter,
        },
      );
      // Each click enters the lookahead before its onset, as in foreground use.
      for (let step = 1; step <= 50; step += 1) {
        context.currentTime = 10 + step / 10;
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(oscillators).toHaveLength(4 + quarterOffsets.length);
      const countIn = oscillators.slice(0, 4);
      expect(countIn.map((click) => click.frequency.value)).toEqual([
        1400, 1000, 1000, 1000,
      ]);
      countIn.forEach((click, index) =>
        expect(click.start.mock.calls[0][0]).toBeCloseTo(
          10.08 + index * 0.5,
          8,
        ),
      );
      const song = oscillators.slice(4);
      song.forEach((click, index) => {
        expect(click.start.mock.calls[0][0]).toBeCloseTo(
          12.08 + quarterOffsets[index] * 0.5,
          8,
        );
        expect(click.frequency.value).toBe(
          accents.includes(index) ? 1400 : 1000,
        );
      });
      await engine.close();
    },
  );
});
