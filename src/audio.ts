import { PitchDetector } from "pitchy";
import {
  DEFAULT_MICROPHONE_SETTINGS,
  normalizeMicrophoneSettings,
  type MicrophoneSettings,
} from "./microphone-settings";

export {
  DEFAULT_MICROPHONE_SETTINGS,
  normalizeMicrophoneSettings,
  type MicrophoneSettings,
} from "./microphone-settings";

export type Instrument = "piano" | "accordion";

export interface PitchFrame {
  frequency: number | null;
  /** Fractional MIDI number, so the pitch trace preserves intonation. */
  midi: number | null;
  /** Offset from the nearest equal-tempered semitone. */
  cents: number | null;
  clarity: number;
  rms: number;
  /** Monotonic browser time, in seconds. */
  time: number;
}

type Detector = ReturnType<typeof PitchDetector.forFloat32Array>;
type Timer = ReturnType<typeof setTimeout>;
type ScoreNote = { midi: number | null; beats: number };

interface Voice {
  oscillators: OscillatorNode[];
  nodes: AudioNode[];
  envelope: GainNode;
}

interface MicrophoneAnalysis {
  samples: Float32Array<ArrayBuffer>;
  amplifiedSamples: Float32Array<ArrayBuffer>;
  detector: Detector;
  nextFrameTime: number;
}

interface MicrophonePreview {
  options: MicrophoneSettings;
  onFrame: (frame: PitchFrame) => void;
  analyser: AnalyserNode | null;
  analysis: MicrophoneAnalysis | null;
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const SCHEDULE_LOOKAHEAD_SECONDS = 0.25;
const MAX_SCHEDULED_VOICES = 64;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function midiToFrequency(midi: number, a4 = 440): number {
  return Number.isFinite(midi) && Number.isFinite(a4) && a4 > 0
    ? a4 * 2 ** ((midi - 69) / 12)
    : Number.NaN;
}

export function frequencyToMidi(frequency: number, a4 = 440): number {
  return Number.isFinite(frequency) &&
    frequency > 0 &&
    Number.isFinite(a4) &&
    a4 > 0
    ? 69 + 12 * Math.log2(frequency / a4)
    : Number.NaN;
}

export function noteLabel(midi: number): string {
  if (!Number.isFinite(midi)) return "—";
  const note = Math.round(midi);
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

/** McLeod detection with a quiet/noisy-frame gate; the microphone reuses a detector. */
export function detectPitchFrame(
  samples: Float32Array,
  sampleRate: number,
  a4 = 440,
  time = 0,
  detector?: Detector,
  settings: Readonly<MicrophoneSettings> = DEFAULT_MICROPHONE_SETTINGS,
  amplifiedSamples?: Float32Array,
): PitchFrame {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
  const empty: PitchFrame = {
    frequency: null,
    midi: null,
    cents: null,
    clarity: 0,
    rms,
    time,
  };
  if (
    !Number.isFinite(rms) ||
    rms * settings.inputGain < settings.noiseThreshold ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return empty;
  }
  let analysisInput = samples;
  if (settings.inputGain !== 1) {
    analysisInput =
      amplifiedSamples?.length === samples.length
        ? amplifiedSamples
        : new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      // Do not clip: linear gain must preserve waveform shape and pitch.
      analysisInput[index] = samples[index] * settings.inputGain;
    }
  }
  const pitchDetector =
    detector ?? PitchDetector.forFloat32Array(samples.length);
  // Our explicit amplified-RMS gate is authoritative, even for quiet inputs.
  pitchDetector.minVolumeAbsolute = 0;
  const [frequency, clarity] = pitchDetector.findPitch(
    analysisInput,
    sampleRate,
  );
  if (
    !Number.isFinite(frequency) ||
    !Number.isFinite(clarity) ||
    frequency < settings.minFrequency ||
    frequency > settings.maxFrequency ||
    clarity < settings.clarityThreshold
  ) {
    return { ...empty, clarity: Number.isFinite(clarity) ? clarity : 0 };
  }
  const midi = frequencyToMidi(frequency, a4);
  if (!Number.isFinite(midi)) return { ...empty, clarity };
  return {
    frequency,
    midi,
    cents: (midi - Math.round(midi)) * 100,
    clarity,
    rms,
    time,
  };
}

function microphoneError(error: unknown): Error {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new Error(
      "无法访问麦克风：请允许此网站使用麦克风，并确认系统隐私设置已授权。",
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new Error("没有找到麦克风。请连接麦克风后重试。");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error(
      "无法读取麦克风。请检查设备连接，或关闭正在占用它的应用后重试。",
    );
  }
  if (name === "SecurityError") {
    return new Error(
      "浏览器阻止了麦克风访问。请通过 HTTPS 或本机 localhost 打开网页。",
    );
  }
  return error instanceof Error
    ? error
    : new Error("麦克风启动失败，请检查设备和浏览器权限后重试。");
}

export class AudioEngine {
  /** Reference tuning shared by detection and synthesized guide notes. */
  a4 = 440;

  private context: AudioContext | null = null;
  private output: DynamicsCompressorNode | null = null;
  private stream: MediaStream | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analysis: MicrophoneAnalysis | null = null;
  private microphoneOptions = normalizeMicrophoneSettings();
  private microphonePreview: MicrophonePreview | null = null;
  private animationFrame: number | null = null;
  private microphoneGeneration = 0;
  private playbackGeneration = 0;
  private timers = new Set<Timer>();
  private voices = new Set<Voice>();
  private destroyed = false;

  get microphoneSettings(): Readonly<MicrophoneSettings> {
    return { ...this.microphoneOptions };
  }

  /** Actual rate of the samples analyzed by Web Audio; null while disconnected. */
  get microphoneSampleRate(): number | null {
    return this.analyser ? (this.context?.sampleRate ?? null) : null;
  }

  /** Applies to an active stream without another device permission request. */
  configureMicrophone(options: unknown): MicrophoneSettings {
    const next = normalizeMicrophoneSettings(options, this.microphoneOptions);
    if (this.analyser && next.fftSize !== this.microphoneOptions.fftSize) {
      const analysis = this.createMicrophoneAnalysis(next.fftSize);
      this.analyser.fftSize = next.fftSize;
      this.analysis = analysis;
    } else if (
      this.analysis &&
      next.updateRateHz !== this.microphoneOptions.updateRateHz
    ) {
      this.analysis.nextFrameTime = -Infinity;
    }
    this.microphoneOptions = next;
    return { ...next };
  }

  /** An isolated draft analysis of the current stream; never commits settings. */
  setMicrophonePreview(
    options: MicrophoneSettings,
    onFrame: (frame: PitchFrame) => void,
  ): void {
    if (this.destroyed) return;
    const preview = this.microphonePreview;
    const next = normalizeMicrophoneSettings(
      options,
      preview?.options ?? this.microphoneOptions,
    );
    if (preview) {
      if (preview.analyser && next.fftSize !== preview.options.fftSize) {
        const analysis = this.createMicrophoneAnalysis(next.fftSize);
        preview.analyser.fftSize = next.fftSize;
        preview.analysis = analysis;
      } else if (
        preview.analysis &&
        next.updateRateHz !== preview.options.updateRateHz
      ) {
        preview.analysis.nextFrameTime = -Infinity;
      }
      preview.options = next;
      preview.onFrame = onFrame;
    } else {
      this.microphonePreview = {
        options: next,
        onFrame,
        analyser: null,
        analysis: null,
      };
    }
    this.activateMicrophonePreview();
  }

  clearMicrophonePreview(): void {
    this.detachMicrophonePreview();
    this.microphonePreview = null;
  }

  private activateMicrophonePreview(): void {
    const preview = this.microphonePreview;
    if (!preview || preview.analyser || !this.context || !this.microphoneSource)
      return;
    const analysis = this.createMicrophoneAnalysis(preview.options.fftSize);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = preview.options.fftSize;
    analyser.smoothingTimeConstant = 0;
    this.microphoneSource.connect(analyser);
    preview.analyser = analyser;
    preview.analysis = analysis;
  }

  private detachMicrophonePreview(): void {
    const preview = this.microphonePreview;
    if (!preview?.analyser) return;
    this.microphoneSource?.disconnect(preview.analyser);
    preview.analyser.disconnect();
    preview.analyser = null;
    preview.analysis = null;
  }

  private createMicrophoneAnalysis(
    fftSize: MicrophoneSettings["fftSize"],
  ): MicrophoneAnalysis {
    const detector = PitchDetector.forFloat32Array(fftSize);
    detector.minVolumeAbsolute = 0;
    return {
      samples: new Float32Array(fftSize),
      amplifiedSamples: new Float32Array(fftSize),
      detector,
      nextFrameTime: -Infinity,
    };
  }

  private readMicrophoneFrame(
    analyser: AnalyserNode,
    analysis: MicrophoneAnalysis,
    options: Readonly<MicrophoneSettings>,
    timestamp: number,
    sampleRate: number,
  ): PitchFrame | null {
    if (timestamp + 0.5 < analysis.nextFrameTime) return null;
    const interval = 1000 / options.updateRateHz;
    // Keep a target clock with tolerance for rounded RAF timestamps. A slow
    // frame never triggers multiple analyses or a backlog of catch-up work.
    analysis.nextFrameTime = Number.isFinite(analysis.nextFrameTime)
      ? analysis.nextFrameTime + interval
      : timestamp + interval;
    if (analysis.nextFrameTime <= timestamp + 0.5) {
      analysis.nextFrameTime = timestamp + interval;
    }
    analyser.getFloatTimeDomainData(analysis.samples);
    return detectPitchFrame(
      analysis.samples,
      sampleRate,
      this.a4,
      timestamp / 1000,
      analysis.detector,
      options,
      analysis.amplifiedSamples,
    );
  }

  private async getContext(): Promise<AudioContext> {
    if (this.destroyed) throw new Error("音频已关闭，请刷新页面后重试。");
    if (typeof window === "undefined")
      throw new Error("音频功能需要在浏览器中使用。");
    if (!this.context || this.context.state === "closed") {
      const AudioContextConstructor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextConstructor)
        throw new Error("当前浏览器不支持网页音频，请使用较新的浏览器。");
      this.context = new AudioContextConstructor({
        latencyHint: "interactive",
      });
      this.output = this.context.createDynamicsCompressor();
      this.output.threshold.value = -12;
      this.output.knee.value = 18;
      this.output.ratio.value = 4;
      this.output.attack.value = 0.003;
      this.output.release.value = 0.15;
      this.output.connect(this.context.destination);
    }
    const context = this.context;
    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        throw new Error("无法启动声音。请点击页面中的播放或麦克风按钮后重试。");
      }
    }
    if (this.destroyed) throw new Error("音频已关闭，请刷新页面后重试。");
    if (context.state !== "running") {
      throw new Error("声音尚未启动。请点击页面中的播放或麦克风按钮后重试。");
    }
    return context;
  }

  async startMicrophone(onFrame: (frame: PitchFrame) => void): Promise<void> {
    this.stopMicrophone();
    const generation = this.microphoneGeneration;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error(
        "当前页面无法使用麦克风。请通过 HTTPS 或本机 localhost 打开，并使用较新的浏览器。",
      );
    }
    let pendingStream: MediaStream | null = null;
    try {
      const context = await this.getContext();
      if (generation !== this.microphoneGeneration || this.destroyed) return;
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      // A permission prompt can finish after Stop, a new Start, or page teardown.
      if (generation !== this.microphoneGeneration || this.destroyed) {
        pendingStream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = pendingStream;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = this.microphoneOptions.fftSize;
      this.analyser.smoothingTimeConstant = 0;
      this.microphoneSource = context.createMediaStreamSource(pendingStream);
      this.microphoneSource.connect(this.analyser);
      // The analyser needs no destination connection; microphone audio is never monitored.
      const analyser = this.analyser;
      this.analysis = this.createMicrophoneAnalysis(
        this.microphoneOptions.fftSize,
      );
      this.activateMicrophonePreview();
      const tick = (timestamp: number) => {
        if (generation !== this.microphoneGeneration || this.destroyed) return;
        this.animationFrame = window.requestAnimationFrame(tick);
        const analysis = this.analysis;
        if (analysis) {
          const frame = this.readMicrophoneFrame(
            analyser,
            analysis,
            this.microphoneOptions,
            timestamp,
            context.sampleRate,
          );
          if (frame) onFrame(frame);
        }
        // Main consumers may stop or replace the stream from their callback.
        if (generation !== this.microphoneGeneration || this.destroyed) return;
        const preview = this.microphonePreview;
        if (preview?.analyser && preview.analysis) {
          const frame = this.readMicrophoneFrame(
            preview.analyser,
            preview.analysis,
            preview.options,
            timestamp,
            context.sampleRate,
          );
          if (frame) preview.onFrame(frame);
        }
      };
      this.animationFrame = window.requestAnimationFrame(tick);
    } catch (error) {
      pendingStream?.getTracks().forEach((track) => track.stop());
      if (generation !== this.microphoneGeneration || this.destroyed) return;
      this.stopMicrophone();
      throw microphoneError(error);
    }
  }

  stopMicrophone(): void {
    this.microphoneGeneration += 1;
    if (this.animationFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = null;
    this.detachMicrophonePreview();
    this.microphoneSource?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.microphoneSource = null;
    this.analyser = null;
    this.analysis = null;
    this.stream = null;
  }

  /** Resolves when scheduled. A new playback request replaces the previous one. */
  async playNote(
    midi: number,
    duration = 1.2,
    instrument: Instrument = "piano",
    volume = 0.65,
  ): Promise<void> {
    this.stopPlayback();
    const generation = this.playbackGeneration;
    if (!Number.isFinite(midi) || !Number.isFinite(duration) || duration <= 0) {
      throw new Error("音高和播放时长必须是有效数值。");
    }
    const context = await this.getContext();
    if (generation !== this.playbackGeneration || this.destroyed) return;
    this.makeVoice(
      context,
      midi,
      context.currentTime + 0.015,
      duration,
      instrument,
      volume,
    );
  }

  /** Audio-clock scheduling includes rests and count-in; onComplete reports the score end. */
  async scheduleNotes(
    notes: ScoreNote[],
    bpm: number,
    instrument: Instrument,
    options: {
      /** Scheduled first-note onset in the same millisecond clock as performance.now(). */
      onTimeline?: (startTimeMs: number) => void;
      onNote?: (index: number) => void;
      onComplete?: () => void;
      countIn?: number;
      metronome?: boolean;
      /** Song clicks follow the meter denominator; BPM/count-in use quarter notes. */
      timeSignature?: string;
      volume?: number;
    } = {},
  ): Promise<void> {
    this.stopPlayback();
    const generation = this.playbackGeneration;
    if (
      !Number.isFinite(bpm) ||
      bpm <= 0 ||
      notes.some(
        (note) =>
          !Number.isFinite(note.beats) ||
          note.beats <= 0 ||
          (note.midi !== null && !Number.isFinite(note.midi)),
      )
    )
      throw new Error("曲谱包含无效音符、时值或速度。");
    const context = await this.getContext();
    if (generation !== this.playbackGeneration || this.destroyed) return;
    const beatSeconds = 60 / clamp(bpm, 20, 320);
    const countIn = Number.isFinite(options.countIn)
      ? clamp(Math.floor(options.countIn ?? 0), 0, 16)
      : 0;
    const meter = /^(\d{1,2})\/(1|2|4|8|16|32|64)$/.exec(
      options.timeSignature ?? "4/4",
    );
    const beatsPerBar = meter && Number(meter[1]) > 0 ? Number(meter[1]) : 4;
    const beatUnit = meter && Number(meter[1]) > 0 ? Number(meter[2]) : 4;
    const clickSeconds = (beatSeconds * 4) / beatUnit;
    const origin = context.currentTime + 0.08;
    let cursor = origin + countIn * beatSeconds;
    const events: {
      time: number;
      index: number;
      midi: number | null;
      duration: number;
    }[] = [];
    for (const [index, note] of notes.entries()) {
      const duration = note.beats * beatSeconds;
      events.push({ time: cursor, index, midi: note.midi, duration });
      cursor += duration;
    }
    const end = cursor;
    const firstNoteTime = origin + countIn * beatSeconds;
    // Count-in always uses quarter-note clicks. The song meter starts afresh
    // at its first event and can use a different click unit (for example 6/8).
    const songTickCount = options.metronome
      ? Math.ceil((end - firstNoteTime) / clickSeconds - 1e-7)
      : 0;
    // Where supported, map the render clock to the actual output clock rather
    // than measuring a delayed UI callback. The fallback shares RAF's time base.
    const stamp =
      typeof context.getOutputTimestamp === "function"
        ? context.getOutputTimestamp()
        : null;
    const startTimeMs =
      stamp?.contextTime && stamp.performanceTime
        ? stamp.performanceTime + (firstNoteTime - stamp.contextTime) * 1000
        : performance.now() + (firstNoteTime - context.currentTime) * 1000;
    options.onTimeline?.(startTimeMs);
    if (generation !== this.playbackGeneration || this.destroyed) return;
    let nextEvent = 0;
    let nextAudioEvent = 0;
    let nextCountInClick = 0;
    let nextSongClick = 0;
    const update = () => {
      if (generation !== this.playbackGeneration || this.destroyed) return;
      const now = context.currentTime;
      const horizon = now + SCHEDULE_LOOKAHEAD_SECONDS;
      // Keep native audio nodes proportional to the near future, even for a
      // long score. Fully elapsed events are skipped after a stalled timer.
      while (
        nextAudioEvent < events.length &&
        events[nextAudioEvent].time <= horizon
      ) {
        const event = events[nextAudioEvent];
        if (
          event.midi !== null &&
          event.time + event.duration > now &&
          this.voices.size < MAX_SCHEDULED_VOICES
        ) {
          this.makeVoice(
            context,
            event.midi,
            event.time,
            event.duration * 0.94,
            instrument,
            options.volume ?? 0.55,
          );
        }
        nextAudioEvent += 1;
      }
      while (
        nextCountInClick < countIn &&
        origin + nextCountInClick * beatSeconds <= horizon
      ) {
        const clickTime = origin + nextCountInClick * beatSeconds;
        if (clickTime >= now && this.voices.size < MAX_SCHEDULED_VOICES) {
          this.makeClick(context, clickTime, nextCountInClick % 4 === 0);
        }
        nextCountInClick += 1;
      }
      while (
        nextSongClick < songTickCount &&
        firstNoteTime + nextSongClick * clickSeconds <= horizon
      ) {
        const clickTime = firstNoteTime + nextSongClick * clickSeconds;
        if (clickTime >= now && this.voices.size < MAX_SCHEDULED_VOICES) {
          this.makeClick(context, clickTime, nextSongClick % beatsPerBar === 0);
        }
        nextSongClick += 1;
      }
      while (nextEvent < events.length && events[nextEvent].time <= now) {
        options.onNote?.(events[nextEvent].index);
        nextEvent += 1;
        if (generation !== this.playbackGeneration || this.destroyed) return;
      }
      if (now >= end) {
        options.onComplete?.();
        return;
      }
      this.setPlaybackTimer(update, 20);
    };
    update();
  }

  stopPlayback(): void {
    this.playbackGeneration += 1;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setTargetAtTime(0, now, 0.004);
      for (const oscillator of voice.oscillators) {
        try {
          oscillator.stop(now + 0.02);
        } catch {
          /* Already ended. */
        }
      }
    }
    // Canceled voices have their own onended cleanup and must not consume the
    // next playback request's scheduling budget during this short release.
    this.voices.clear();
  }

  async close(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopMicrophone();
    this.clearMicrophonePreview();
    this.stopPlayback();
    const context = this.context;
    this.context = null;
    this.output = null;
    if (context && context.state !== "closed") await context.close();
    this.voices.clear();
  }

  private setPlaybackTimer(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  private makeVoice(
    context: AudioContext,
    midi: number,
    start: number,
    duration: number,
    instrument: Instrument,
    volume: number,
  ): void {
    const frequency = midiToFrequency(midi, this.a4);
    const level = Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.55;
    if (
      level === 0 ||
      !Number.isFinite(frequency) ||
      frequency <= 0 ||
      frequency >= context.sampleRate / 2
    )
      return;
    const length = Math.max(0.035, duration);
    const envelope = context.createGain();
    const voice: Voice = { oscillators: [], nodes: [envelope], envelope };
    envelope.connect(this.output ?? context.destination);
    const end = start + length;
    const release = instrument === "piano" ? 0.16 : 0.1;
    const attack = Math.min(instrument === "piano" ? 0.008 : 0.035, length / 3);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(
      level * (instrument === "piano" ? 0.42 : 0.3),
      start + attack,
    );
    envelope.gain.setValueAtTime(
      level * (instrument === "piano" ? 0.42 : 0.3),
      end,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, end + release);
    if (instrument === "piano") {
      // Faster decay of upper partials gives a percussive, piano-like timbre.
      const partials = [1, 0.48, 0.22, 0.12, 0.07, 0.035];
      for (const [index, amplitude] of partials.entries()) {
        const harmonic = index + 1;
        if (frequency * harmonic >= context.sampleRate / 2) continue;
        const oscillator = context.createOscillator();
        const partial = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * harmonic;
        partial.gain.setValueAtTime(amplitude, start);
        partial.gain.exponentialRampToValueAtTime(
          Math.max(
            0.0001,
            amplitude * Math.exp(-(length + release) / (1.65 / harmonic)),
          ),
          end + release,
        );
        oscillator.connect(partial);
        partial.connect(envelope);
        voice.oscillators.push(oscillator);
        voice.nodes.push(oscillator, partial);
      }
    } else {
      // Three gently detuned reed banks provide an accordion-like sustained tone.
      const real = new Float32Array(10);
      const imaginary = new Float32Array([
        0, 1, 0.72, 0.44, 0.28, 0.16, 0.1, 0.065, 0.035, 0.02,
      ]);
      const wave = context.createPeriodicWave(real, imaginary);
      for (const detune of [-3.5, 0, 3.5]) {
        const oscillator = context.createOscillator();
        const reed = context.createGain();
        oscillator.setPeriodicWave(wave);
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        reed.gain.value = 1 / 3;
        oscillator.connect(reed);
        reed.connect(envelope);
        voice.oscillators.push(oscillator);
        voice.nodes.push(oscillator, reed);
      }
    }
    this.startVoice(voice, start, end + release + 0.02);
  }

  private makeClick(
    context: AudioContext,
    start: number,
    accented: boolean,
  ): void {
    const envelope = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = accented ? 1400 : 1000;
    oscillator.type = "sine";
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(
      accented ? 0.1 : 0.065,
      start + 0.002,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    oscillator.connect(envelope);
    envelope.connect(this.output ?? context.destination);
    this.startVoice(
      { oscillators: [oscillator], nodes: [oscillator, envelope], envelope },
      start,
      start + 0.055,
    );
  }

  private startVoice(voice: Voice, start: number, end: number): void {
    this.voices.add(voice);
    let active = voice.oscillators.length;
    for (const oscillator of voice.oscillators) {
      oscillator.onended = () => {
        active -= 1;
        if (active === 0) {
          voice.nodes.forEach((node) => node.disconnect());
          this.voices.delete(voice);
        }
      };
      oscillator.start(start);
      oscillator.stop(end);
    }
  }
}
