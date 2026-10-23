import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, detectPitchFrame, frequencyToMidi, midiToFrequency, noteLabel } from './audio'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function signal(frequency: number, sampleRate = 48000, amplitude = 0.3): Float32Array {
  return Float32Array.from({ length: 4096 }, (_, index) =>
    amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  )
}

describe('equal-tempered note math', () => {
  it('maps A4 and middle C to their frequencies', () => {
    expect(midiToFrequency(69)).toBe(440)
    expect(midiToFrequency(60)).toBeCloseTo(261.625565, 5)
    expect(frequencyToMidi(440)).toBe(69)
  })

  it('round trips fractional pitch with alternate reference tuning', () => {
    for (const midi of [21, 48, 60.25, 69, 84.7, 108]) {
      expect(frequencyToMidi(midiToFrequency(midi, 442), 442)).toBeCloseTo(midi, 10)
    }
  })

  it('formats octaves, sharps and the nearest note', () => {
    expect(noteLabel(0)).toBe('C-1')
    expect(noteLabel(60)).toBe('C4')
    expect(noteLabel(60.8)).toBe('C#4')
    expect(noteLabel(69)).toBe('A4')
    expect(noteLabel(127)).toBe('G9')
    expect(noteLabel(Number.NaN)).toBe('—')
  })

  it('rejects invalid frequencies and tuning', () => {
    expect(frequencyToMidi(0)).toBeNaN()
    expect(frequencyToMidi(-440)).toBeNaN()
    expect(frequencyToMidi(Infinity)).toBeNaN()
    expect(midiToFrequency(Number.NaN)).toBeNaN()
    expect(midiToFrequency(60, 0)).toBeNaN()
  })
})

describe('McLeod pitch analysis', () => {
  it.each([110, 220, 440, 880])('detects a synthesized %i Hz tone', (frequency) => {
    const frame = detectPitchFrame(signal(frequency), 48000, 440, 12.5)
    expect(frame.frequency).toBeCloseTo(frequency, 0)
    expect(frame.clarity).toBeGreaterThan(0.98)
    expect(frame.cents).toBeCloseTo(0, 0)
    expect(frame.time).toBe(12.5)
    expect(frame.rms).toBeGreaterThan(0.2)
  })

  it('detects a voice-like harmonic signal at a different sample rate', () => {
    const sampleRate = 44100
    const frequency = midiToFrequency(60.2)
    const samples = Float32Array.from({ length: 4096 }, (_, index) => {
      const phase = (2 * Math.PI * frequency * index) / sampleRate
      return 0.25 * Math.sin(phase) + 0.12 * Math.sin(phase * 2) + 0.05 * Math.sin(phase * 3)
    })
    const frame = detectPitchFrame(samples, sampleRate)
    expect(frame.midi).toBeCloseTo(60.2, 2)
    expect(frame.cents).toBeCloseTo(20, 0)
  })

  it('returns no pitch for silence and very quiet signals', () => {
    expect(detectPitchFrame(new Float32Array(4096), 48000).frequency).toBeNull()
    expect(detectPitchFrame(signal(440, 48000, 0.001), 48000).midi).toBeNull()
    expect(detectPitchFrame(new Float32Array(), 48000).frequency).toBeNull()
  })

  it('rejects unpitched broadband noise and out-of-range tones', () => {
    let seed = 12345
    const noise = Float32Array.from({ length: 4096 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      return (seed / 2147483648) * 0.3
    })
    expect(detectPitchFrame(noise, 48000).frequency).toBeNull()
    expect(detectPitchFrame(signal(4000), 48000).frequency).toBeNull()
  })
})

function mockAudioBrowser() {
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const oscillator = () => ({
    ...node(),
    type: 'sine',
    frequency: parameter(),
    detune: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
    setPeriodicWave: vi.fn(),
    onended: null,
  })
  const oscillators: ReturnType<typeof oscillator>[] = []
  const context = {
    state: 'running',
    currentTime: 10,
    sampleRate: 48000,
    destination: node(),
    createDynamicsCompressor: () => ({
      ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(),
    }),
    createGain: () => ({ ...node(), gain: parameter() }),
    createOscillator: () => {
      const result = oscillator()
      oscillators.push(result)
      return result
    },
    createPeriodicWave: vi.fn(),
    resume: vi.fn(async () => { context.state = 'running' }),
    close: vi.fn(async () => { context.state = 'closed' }),
  }
  const requestAnimationFrame = vi.fn()
  vi.stubGlobal('window', {
    AudioContext: vi.fn(function () { return context }),
    requestAnimationFrame,
    cancelAnimationFrame: vi.fn(),
  })
  return { context, oscillators, requestAnimationFrame }
}

describe('audio lifecycle and musical scheduling', () => {
  it.each(['stop', 'close'])('releases a late microphone permission result after %s', async (action) => {
    const { requestAnimationFrame } = mockAudioBrowser()
    let grantPermission!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grantPermission = resolve }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const engine = new AudioEngine()
    const starting = engine.startMicrophone(vi.fn())
    await Promise.resolve()
    expect(getUserMedia).toHaveBeenCalledOnce()
    if (action === 'close') await engine.close()
    else engine.stopMicrophone()
    const stopTrack = vi.fn()
    grantPermission({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await starting
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    await engine.close()
  })

  it('explains microphone permission failures in Chinese', async () => {
    mockAudioBrowser()
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) },
    })
    const engine = new AudioEngine()
    await expect(engine.startMicrophone(vi.fn())).rejects.toThrow('请允许此网站使用麦克风')
    await engine.close()
  })

  it('schedules exact audio times including count-in and rests, then cancels callbacks', async () => {
    vi.useFakeTimers()
    const { context, oscillators } = mockAudioBrowser()
    const engine = new AudioEngine()
    const onTimeline = vi.fn()
    const onNote = vi.fn()
    const onComplete = vi.fn()
    await engine.scheduleNotes([
      { midi: 60, beats: 1 }, { midi: null, beats: 0.5 }, { midi: 64, beats: 1 },
    ], 120, 'piano', { countIn: 2, metronome: true, onTimeline, onNote, onComplete })
    expect(onTimeline).toHaveBeenCalledOnce()
    expect(onTimeline.mock.calls[0][0]).toBeCloseTo(performance.now() + 1080, 6)
    expect(oscillators).toHaveLength(1) // Only the first count-in click is within the lookahead.
    expect(onNote).not.toHaveBeenCalled()
    context.currentTime = 10.9
    await vi.advanceTimersByTimeAsync(20)
    const middleC = oscillators.find((voice) => voice.frequency.value === midiToFrequency(60))
    expect(middleC?.start).toHaveBeenCalledWith(11.08)
    expect(onNote).not.toHaveBeenCalled()
    context.currentTime = 11.59
    await vi.advanceTimersByTimeAsync(20)
    const e4 = oscillators.find((voice) => voice.frequency.value === midiToFrequency(64))
    expect(e4?.start).toHaveBeenCalledWith(11.83)
    expect(onNote.mock.calls).toEqual([[0], [1]])
    context.currentTime = 11.84
    await vi.advanceTimersByTimeAsync(20)
    expect(onNote.mock.calls).toEqual([[0], [1], [2]])
    context.currentTime = 12.34
    await vi.advanceTimersByTimeAsync(20)
    expect(onComplete).toHaveBeenCalledOnce()

    onNote.mockClear()
    onComplete.mockClear()
    await engine.scheduleNotes([{ midi: 60, beats: 4 }], 120, 'accordion', { onNote, onComplete })
    engine.stopPlayback()
    context.currentTime = 20
    await vi.advanceTimersByTimeAsync(5000)
    expect(onNote).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    await engine.close()
  })

  it('maps the scheduled onset using the browser output timestamp when available', async () => {
    const { context } = mockAudioBrowser()
    Object.assign(context, { getOutputTimestamp: () => ({ contextTime: 9.98, performanceTime: 1000 }) })
    const engine = new AudioEngine()
    const onTimeline = vi.fn()
    await engine.scheduleNotes([{ midi: null, beats: 1 }], 120, 'piano', { countIn: 2, onTimeline })
    expect(onTimeline.mock.calls[0][0]).toBeCloseTo(2100, 6)
    await engine.close()
  })

  it('creates only a short audio horizon for a 10,000-note song, then cancels future work', async () => {
    vi.useFakeTimers()
    const { context, oscillators } = mockAudioBrowser()
    const engine = new AudioEngine()
    const notes = Array.from({ length: 10000 }, () => ({ midi: 60, beats: 0.25 }))
    await engine.scheduleNotes(notes, 120, 'piano', { metronome: true })
    // Two six-partial piano notes and one click fit the initial 250 ms horizon.
    expect(oscillators).toHaveLength(13)
    expect(oscillators.every((voice) => voice.start.mock.calls[0][0] <= 10.25)).toBe(true)
    context.currentTime = 10.2
    await vi.advanceTimersByTimeAsync(20)
    expect(oscillators).toHaveLength(19)
    const nextFundamental = oscillators.filter((voice) => voice.frequency.value === midiToFrequency(60)).at(-1)
    expect(nextFundamental?.start.mock.calls[0][0]).toBeCloseTo(10.33, 8)
    engine.stopPlayback()
    const countAtStop = oscillators.length
    context.currentTime = 20
    await vi.advanceTimersByTimeAsync(2000)
    expect(oscillators).toHaveLength(countAtStop)
    await engine.close()
  })

  it('skips expired audio after a timer stall rather than playing a catch-up burst', async () => {
    vi.useFakeTimers()
    const { context, oscillators } = mockAudioBrowser()
    const engine = new AudioEngine()
    const onComplete = vi.fn()
    await engine.scheduleNotes([60, 62, 64, 65].map((midi) => ({ midi, beats: 0.25 })), 120, 'piano', { onComplete })
    expect(oscillators).toHaveLength(12)
    context.currentTime = 11
    await vi.advanceTimersByTimeAsync(20)
    expect(oscillators).toHaveLength(12)
    expect(onComplete).toHaveBeenCalledOnce()
    await engine.close()
  })

  it('bounds live voices even when pathological tiny durations all fit the horizon', async () => {
    const { oscillators } = mockAudioBrowser()
    const engine = new AudioEngine()
    await engine.scheduleNotes(Array.from({ length: 10000 }, () => ({ midi: 60, beats: 1e-9 })), 120, 'piano')
    expect(oscillators.length).toBeGreaterThan(0)
    expect(oscillators.length).toBeLessThanOrEqual(64 * 6)
    const previousCount = oscillators.length
    await engine.scheduleNotes([{ midi: 62, beats: 1 }], 120, 'piano')
    expect(oscillators).toHaveLength(previousCount + 6)
    await engine.close()
  })
})
