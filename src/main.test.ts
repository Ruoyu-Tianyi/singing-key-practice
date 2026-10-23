import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  DEFAULT_MICROPHONE_SETTINGS,
  type MicrophoneSettings,
  type PitchFrame,
} from "./audio";

const audio = vi.hoisted(() => ({
  startMicrophone: vi.fn(),
  stopMicrophone: vi.fn(),
  scheduleNotes: vi.fn(),
  playNote: vi.fn(),
  stopPlayback: vi.fn(),
  close: vi.fn(),
  configureMicrophone: vi.fn(),
  setMicrophonePreview: vi.fn(),
  clearMicrophonePreview: vi.fn(),
}));

let scheduledDraw: FrameRequestCallback;
const canvasContext = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  fillRect: vi.fn(),
  setLineDash: vi.fn(),
  save: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  restore: vi.fn(),
};

vi.mock("./audio", async (importOriginal) => {
  const original = await importOriginal<typeof import("./audio")>();
  return {
    ...original,
    AudioEngine: class {
      a4 = 440;
      private currentMicrophoneSettings = original.normalizeMicrophoneSettings(
        original.DEFAULT_MICROPHONE_SETTINGS,
      );
      get microphoneSettings() {
        return { ...this.currentMicrophoneSettings };
      }
      get microphoneSampleRate() {
        return null;
      }
      configureMicrophone(options: unknown) {
        audio.configureMicrophone(options);
        this.currentMicrophoneSettings = original.normalizeMicrophoneSettings(
          options,
          this.currentMicrophoneSettings,
        );
        return { ...this.currentMicrophoneSettings };
      }
      startMicrophone = audio.startMicrophone;
      stopMicrophone = audio.stopMicrophone;
      scheduleNotes = audio.scheduleNotes;
      playNote = audio.playNote;
      stopPlayback = audio.stopPlayback;
      close = audio.close;
      setMicrophonePreview = audio.setMicrophonePreview;
      clearMicrophonePreview = audio.clearMicrophonePreview;
    },
  };
});

const element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
};
const text = (selector: string) => element(selector).textContent;

const microphoneFields: Record<keyof MicrophoneSettings, string> = {
  inputGain: "#mic-gain",
  noiseThreshold: "#mic-gate",
  minFrequency: "#mic-min-frequency",
  maxFrequency: "#mic-max-frequency",
  clarityThreshold: "#mic-clarity",
  updateRateHz: "#mic-refresh",
  fftSize: "#mic-window",
};

function editMicrophoneSettings(settings: Readonly<MicrophoneSettings>) {
  for (const [key, selector] of Object.entries(microphoneFields)) {
    const input = element<HTMLInputElement | HTMLSelectElement>(selector);
    input.value = String(settings[key as keyof MicrophoneSettings]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function restorePracticeSettings() {
  await click('[data-action="settings"]');
  editMicrophoneSettings(DEFAULT_MICROPHONE_SETTINGS);
  element<HTMLInputElement>("#tuning").value = "440";
  element<HTMLInputElement>("#latency").value = "100";
  await click('[data-action="save-settings"]');
}

async function settle() {
  // DOM event handlers have nested awaits for audio permission and playback.
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

async function click(selector: string) {
  element(selector).click();
  await settle();
}

let previewClock = 100_000;
function emitPreview(overrides: Partial<PitchFrame> = {}) {
  const onPreview = audio.setMicrophonePreview.mock.lastCall?.[1] as
    | ((frame: PitchFrame) => void)
    | undefined;
  if (!onPreview) throw new Error("Microphone preview was not registered");
  previewClock += 200;
  const clock = vi.spyOn(performance, "now").mockReturnValue(previewClock);
  try {
    onPreview({
      frequency: 440,
      midi: 69,
      cents: 0,
      clarity: 1,
      rms: 0.02,
      time: previewClock / 1000,
      ...overrides,
    });
    scheduledDraw(previewClock);
  } finally {
    clock.mockRestore();
  }
}

function pendingPermission() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  audio.startMicrophone.mockReturnValueOnce(promise);
  return resolve;
}

function pagehide(persisted: boolean) {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

type ScheduledCallbacks = {
  countIn: number;
  onTimeline: (start: number) => void;
  onNote: (index: number) => void;
  onComplete: () => void;
};
function callbacks(): ScheduledCallbacks {
  return audio.scheduleNotes.mock.lastCall![3] as ScheduledCallbacks;
}

async function saveMelody(title: string, notation: string) {
  await click('[data-action="editor"]');
  element<HTMLInputElement>("#editor-title").value = title;
  element<HTMLTextAreaElement>("#editor-text").value = notation;
  await click('[data-action="save-editor"]');
}

const originalDialogShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalDialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeAll(async () => {
  localStorage.clear();
  history.replaceState(null, "", "#tuner");
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      scheduledDraw = callback;
      return 1;
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      const wasOpen = this.open;
      this.removeAttribute("open");
      if (wasOpen) this.dispatchEvent(new Event("close"));
    },
  });
  // Import once: the app registers document/window listeners at module scope.
  await import("./main");
});

beforeEach(async () => {
  vi.useFakeTimers();
  pagehide(true);
  element("#chart-focus-dialog").dispatchEvent(
    new Event("cancel", { cancelable: true }),
  );
  document.querySelectorAll("dialog").forEach((dialog) => dialog.close());
  await click('[data-view="tuner"]');
  audio.startMicrophone.mockReset().mockResolvedValue(undefined);
  audio.scheduleNotes.mockReset().mockResolvedValue(undefined);
  audio.playNote.mockReset().mockResolvedValue(undefined);
  audio.close.mockReset().mockResolvedValue(undefined);
  vi.clearAllMocks();
});

afterEach(() => {
  pagehide(true);
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalDialogShow)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalDialogShow,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalDialogClose)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      originalDialogClose,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("practice room integration", () => {
  it.each([
    ["tuner", "Find your frequency.", "实时音准仪"],
    ["match", "Feel the resonance.", "标准音模唱"],
    ["songs", "Follow your melody.", "曲谱练习"],
  ])(
    "keeps %s navigation and its workspace in sync",
    async (mode, title, breadcrumb) => {
      await click(`[data-view="${mode}"]`);
      expect(text("#page-title")).toBe(title);
      expect(text("#breadcrumb")).toBe(breadcrumb);
      expect(location.hash).toBe(`#${mode}`);
      const current = document.querySelectorAll(
        '[data-view][aria-current="page"]',
      );
      expect(current).toHaveLength(1);
      expect(current[0]).toBe(element(`[data-view="${mode}"]`));
      expect(current[0].classList.contains("active")).toBe(true);
      expect(element("#songs-card").hidden).toBe(mode !== "songs");
      expect(element("#keyboard-card").hidden).toBe(mode === "songs");
      expect(element("#target-dock").hidden).toBe(mode === "songs");
      expect(element("#song-practice-dock").hidden).toBe(mode !== "songs");
      expect(element(".brand").getAttribute("aria-label")).toBe("Auralis 首页");
    },
  );

  it.each([
    ["import", "把想唱的歌，带进练习室"],
    ["editor", "写一段自己的旋律"],
    ["settings", "让练习更适合你"],
    ["help", "从第一个音开始"],
  ])(
    "opens the %s dialog with a readable accessible name and close control",
    async (action, title) => {
      await click(`[data-action="${action}"]`);
      const dialog = element<HTMLDialogElement>(`#${action}-dialog`);
      expect(dialog.open).toBe(true);
      const headingId = dialog.getAttribute("aria-labelledby");
      expect(headingId).toBeTruthy();
      const heading = document.getElementById(headingId!);
      expect(dialog.contains(heading)).toBe(true);
      expect(heading?.textContent).toBe(title);
      await click(`#${action}-dialog [data-close][aria-label="关闭"]`);
      expect(dialog.open).toBe(false);
    },
  );

  it("respects reduced motion when switching practice modes", async () => {
    const heading = element(".page-heading");
    const originalAnimate = Object.getOwnPropertyDescriptor(heading, "animate");
    const originalMatchMedia = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    );
    const animate = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(heading, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });
    try {
      await click('[data-view="match"]');
      expect(text("#page-title")).toBe("Feel the resonance.");
      expect(matchMedia).toHaveBeenCalledWith(
        "(prefers-reduced-motion: reduce)",
      );
      expect(animate).not.toHaveBeenCalled();
      matchMedia.mockReturnValue({ matches: false });
      await click('[data-view="songs"]');
      expect(animate).toHaveBeenCalledOnce();
    } finally {
      if (originalAnimate)
        Object.defineProperty(heading, "animate", originalAnimate);
      else Reflect.deleteProperty(heading, "animate");
      if (originalMatchMedia)
        Object.defineProperty(window, "matchMedia", originalMatchMedia);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("saves microphone settings with tuning and restores the saved values on reopening", async () => {
    const settings: MicrophoneSettings = {
      inputGain: 1.8,
      noiseThreshold: 0.006,
      minFrequency: 65,
      maxFrequency: 1800,
      clarityThreshold: 0.91,
      updateRateHz: 20,
      fftSize: 8192,
    };
    try {
      await click('[data-action="settings"]');
      editMicrophoneSettings(settings);
      element<HTMLInputElement>("#tuning").value = "442";
      element<HTMLInputElement>("#latency").value = "160";
      await click('[data-action="save-settings"]');
      expect(audio.configureMicrophone).toHaveBeenLastCalledWith(settings);
      expect(element<HTMLDialogElement>("#settings-dialog").open).toBe(false);
      expect(text("#a4-display")).toBe("442");
      expect(JSON.parse(localStorage.getItem("shengzhun-settings")!)).toEqual({
        a4: 442,
        latency: 160,
        microphone: settings,
      });
      await click('[data-action="settings"]');
      for (const [key, selector] of Object.entries(microphoneFields)) {
        expect(
          element<HTMLInputElement | HTMLSelectElement>(selector).value,
        ).toBe(String(settings[key as keyof MicrophoneSettings]));
      }
      expect(text("#mic-gain-value")).toBe("1.8×");
      expect(text("#mic-clarity-value")).toBe("91%");
    } finally {
      await restorePracticeSettings();
    }
  });

  it.each([
    ["a reversed frequency range", "#mic-min-frequency", "400", "200"],
    ["a missing lower frequency", "#mic-min-frequency", "", "2200"],
    ["an out-of-range upper frequency", "#mic-max-frequency", "3001", "3001"],
  ])(
    "rejects %s without changing saved or applied settings",
    async (_name, selector, value, maximum) => {
      await click('[data-action="settings"]');
      const saved = localStorage.getItem("shengzhun-settings");
      const tuning = text("#a4-display");
      element<HTMLInputElement>(selector).value = value;
      element<HTMLInputElement>("#mic-max-frequency").value = maximum;
      element<HTMLInputElement>("#tuning").value = "443";
      await click('[data-action="save-settings"]');
      expect(element<HTMLDialogElement>("#settings-dialog").open).toBe(true);
      expect(element("#settings-error").hidden).toBe(false);
      expect(text("#settings-error")).not.toBe("");
      expect(audio.configureMicrophone).not.toHaveBeenCalled();
      expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
      expect(text("#a4-display")).toBe(tuning);
      await restorePracticeSettings();
    },
  );

  it("previews microphone defaults without applying them until save", async () => {
    const custom: MicrophoneSettings = {
      ...DEFAULT_MICROPHONE_SETTINGS,
      inputGain: 2,
      noiseThreshold: 0.004,
      updateRateHz: 20,
    };
    try {
      await click('[data-action="settings"]');
      editMicrophoneSettings(custom);
      await click('[data-action="save-settings"]');
      const saved = localStorage.getItem("shengzhun-settings");
      audio.configureMicrophone.mockClear();
      await click('[data-action="settings"]');
      await click('[data-action="reset-mic-settings"]');
      expect(audio.configureMicrophone).not.toHaveBeenCalled();
      expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
      for (const [key, selector] of Object.entries(microphoneFields)) {
        expect(
          element<HTMLInputElement | HTMLSelectElement>(selector).value,
        ).toBe(
          String(DEFAULT_MICROPHONE_SETTINGS[key as keyof MicrophoneSettings]),
        );
      }
      await click("#settings-dialog [data-close]");
      await click('[data-action="settings"]');
      expect(element<HTMLInputElement>("#mic-gain").value).toBe("2");
      expect(element<HTMLInputElement>("#mic-gate").value).toBe("0.004");
      await click('[data-action="reset-mic-settings"]');
      await click('[data-action="save-settings"]');
      expect(audio.configureMicrophone).toHaveBeenLastCalledWith(
        DEFAULT_MICROPHONE_SETTINGS,
      );
      expect(
        JSON.parse(localStorage.getItem("shengzhun-settings")!).microphone,
      ).toEqual(DEFAULT_MICROPHONE_SETTINGS);
    } finally {
      await restorePracticeSettings();
    }
  });

  it("previews scene and range presets while keeping them staged until save", async () => {
    try {
      await click('[data-action="settings"]');
      const saved = localStorage.getItem("shengzhun-settings");
      await click('[data-action="mic-preset"][data-preset="soft"]');
      expect(element<HTMLInputElement>("#mic-gain").value).toBe("2");
      expect(element<HTMLInputElement>("#mic-gate").value).toBe("0.004");
      const range = element<HTMLSelectElement>("#mic-range-preset");
      range.value = "low";
      range.dispatchEvent(new Event("change", { bubbles: true }));
      expect(element<HTMLInputElement>("#mic-min-frequency").value).toBe("65");
      expect(element<HTMLInputElement>("#mic-max-frequency").value).toBe(
        "1000",
      );
      expect(audio.configureMicrophone).not.toHaveBeenCalled();
      expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
      const maximum = element<HTMLInputElement>("#mic-max-frequency");
      maximum.value = "1200";
      maximum.dispatchEvent(new Event("input", { bubbles: true }));
      expect(range.value).toBe("custom");
      await click('[data-action="save-settings"]');
      expect(audio.configureMicrophone).toHaveBeenLastCalledWith({
        ...DEFAULT_MICROPHONE_SETTINGS,
        inputGain: 2,
        noiseThreshold: 0.004,
        minFrequency: 65,
        maxFrequency: 1200,
      });
    } finally {
      await restorePracticeSettings();
    }
  });

  it("draws both ends of a recent phrase spanning more than two octaves", async () => {
    await click("#mic-button");
    const onPitch = audio.startMicrophone.mock.lastCall![0] as (
      frame: PitchFrame,
    ) => void;
    const clock = vi.spyOn(performance, "now");
    for (const [milliseconds, midi] of [
      [1000, 36],
      [2000, 84],
    ]) {
      clock.mockReturnValue(milliseconds);
      onPitch({
        frequency: 440 * 2 ** ((midi - 69) / 12),
        midi,
        cents: 0,
        clarity: 1,
        rms: 0.2,
        time: milliseconds / 1000,
      });
    }
    scheduledDraw(2500);
    clock.mockRestore();
    const [firstX, firstY] = canvasContext.moveTo.mock.lastCall! as [
      number,
      number,
    ];
    const [lastX, lastY] = canvasContext.lineTo.mock.lastCall! as [
      number,
      number,
    ];
    expect(firstX).toBeCloseTo(53 + 0.85 * (776 - 53));
    expect(lastX).toBeCloseTo(53 + 0.95 * (776 - 53));
    expect(firstY).toBeGreaterThan(lastY);
    expect(firstY).toBeLessThan(366);
    expect(lastY).toBeGreaterThan(20);
    expect(text("#chart-range")).toBe("自适应音域 A#1 – D6");
    for (const call of [
      ...canvasContext.moveTo.mock.calls,
      ...canvasContext.lineTo.mock.calls,
      ...canvasContext.fillRect.mock.calls,
      ...canvasContext.rect.mock.calls,
    ]) {
      expect(call.every(Number.isFinite)).toBe(true);
    }
  });

  it("fits the complete selected score before its first note plays", async () => {
    await saveMelody("跨音域曲线回归", "1,, 1''");
    scheduledDraw(3000);
    expect(text("#chart-range")).toBe("自适应音域 A#1 – D6");
    expect(text("#chart-reference-label")).toBe("目标音");
    expect(canvasContext.clip).toHaveBeenCalledOnce();
    expect(canvasContext.save).toHaveBeenCalledOnce();
    expect(canvasContext.restore).toHaveBeenCalledOnce();
  });

  it("restores the same chart after the expand button and native Escape cancel event", async () => {
    const card = element(".tuner-card");
    const canvas = element("#pitch-canvas");
    const controls = [
      element("#target-note"),
      element("#target-frequency"),
      element("#reference-button"),
      element("#score-select"),
      element("#listen-button"),
      element("#practice-button"),
    ];
    const dialog = element<HTMLDialogElement>("#chart-focus-dialog");
    await click("#chart-expand-button");
    expect(dialog.open).toBe(true);
    expect(card.parentElement).toBe(dialog);
    expect(element("#chart-expand-button").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(element("#pitch-canvas")).toBe(canvas);
    controls.forEach((control) => expect(card.contains(control)).toBe(true));
    await click("#chart-expand-button");
    expect(dialog.open).toBe(false);
    expect(card.parentElement).toBe(element(".workspace"));
    expect(element("#chart-expand-button").getAttribute("aria-pressed")).toBe(
      "false",
    );
    await click("#chart-expand-button");
    const escape = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(card.parentElement).toBe(element(".workspace"));
    expect(element("#pitch-canvas")).toBe(canvas);
    controls.forEach((control) => {
      expect(card.contains(control)).toBe(true);
      expect(document.querySelectorAll(`#${control.id}`)).toHaveLength(1);
      expect(element(`#${control.id}`)).toBe(control);
    });
    expect(element("#chart-expand-button").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(element("#chart-expand-button"));
  });

  it("keeps shared reference and song transport controls beside the chart", async () => {
    const targetDock = element("#target-dock");
    for (const selector of [
      ".target-selector",
      "#target-frequency",
      "#reference-button",
    ]) {
      expect(targetDock.contains(element(selector))).toBe(true);
      expect(document.querySelectorAll(selector)).toHaveLength(1);
    }
    const frequency = text("#target-frequency");
    await click('[data-action="target-up"]');
    expect(text("#target-frequency")).not.toBe(frequency);
    await click('[data-action="target-down"]');
    expect(text("#target-frequency")).toBe(frequency);
    await click("#reference-button");
    expect(audio.playNote).toHaveBeenCalledOnce();
    await click('[data-view="songs"]');
    const songDock = element("#song-practice-dock");
    for (const selector of [
      ".score-controls",
      "#listen-button",
      "#practice-button",
      "#song-feedback",
    ]) {
      expect(songDock.contains(element(selector))).toBe(true);
      expect(document.querySelectorAll(selector)).toHaveLength(1);
    }
    expect(element("#songs-card").contains(element("#range-start"))).toBe(true);
    expect(element("#songs-card").contains(element("#score-notes"))).toBe(true);
  });

  it("keeps the microphone disconnected when permission resolves after cancellation", async () => {
    const grant = pendingPermission();
    await click("#mic-button");
    expect(text("#mic-button")).toContain("取消连接");
    expect(text("#mic-status")).toContain("正在申请权限");
    await click("#mic-button");
    expect(audio.stopMicrophone).toHaveBeenCalled();
    grant();
    await settle();
    expect(text("#mic-button")).toContain("开启麦克风");
    expect(text("#input-state")).toBe("未连接");
    expect(element("#mic-status").classList.contains("connected")).toBe(false);
    expect(element("#chart-empty").hidden).toBe(false);
  });

  it("abandons a practice request when navigation occurs before permission is granted", async () => {
    await click('[data-view="songs"]');
    const grant = pendingPermission();
    await click("#practice-button");
    expect(audio.startMicrophone).toHaveBeenCalledOnce();
    await click('[data-view="tuner"]');
    grant();
    await settle();
    expect(audio.scheduleNotes).not.toHaveBeenCalled();
    expect(text("#breadcrumb")).toBe("实时音准仪");
    expect(element<HTMLButtonElement>("#score-select").disabled).toBe(false);
  });

  it("starts and stops demonstration controls and ignores canceled playback callbacks", async () => {
    await click('[data-view="songs"]');
    await click("#listen-button");
    expect(audio.scheduleNotes).toHaveBeenCalledOnce();
    expect(callbacks().countIn).toBe(0);
    expect(text("#listen-button")).toContain("停止示范");
    expect(element<HTMLSelectElement>("#score-select").disabled).toBe(true);
    const previous = callbacks();
    previous.onNote(0);
    expect(document.querySelectorAll(".score-note.current")).toHaveLength(1);
    const stops = audio.stopPlayback.mock.calls.length;
    await click("#listen-button");
    expect(audio.stopPlayback).toHaveBeenCalledTimes(stops + 1);
    expect(text("#listen-button")).toContain("听示范");
    expect(element<HTMLSelectElement>("#score-select").disabled).toBe(false);
    previous.onNote(1);
    previous.onComplete();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll(".score-note.current")).toHaveLength(0);
    expect(text("#song-feedback")).toContain("已停止");
  });

  it("stops the old demonstration before saving an edited melody", async () => {
    await click('[data-view="songs"]');
    await click("#listen-button");
    const stops = audio.stopPlayback.mock.calls.length;
    await saveMelody("编谱保存回归", "1 2 3- 0");
    expect(audio.stopPlayback).toHaveBeenCalledTimes(stops + 1);
    expect(text("#score-title")).toBe("编谱保存回归");
    expect(document.querySelectorAll(".score-note")).toHaveLength(4);
    expect(text("#score-notes")).toContain("C4");
    expect(text("#score-notes")).toContain("休");
    expect(text("#listen-button")).toContain("听示范");
    expect(element<HTMLDialogElement>("#editor-dialog").open).toBe(false);
    expect(localStorage.getItem("shengzhun-scores")).toContain("编谱保存回归");
  });

  it("imports real JSON through the file handler and stops active playback", async () => {
    await click('[data-view="songs"]');
    await click("#listen-button");
    const stops = audio.stopPlayback.mock.calls.length;
    await click('[data-action="import"]');
    const data = {
      id: "integration-import",
      title: "文件导入回归",
      bpm: 90,
      timeSignature: "4/4",
      notes: [
        { midi: 60, beats: 1 },
        { midi: 67, beats: 2 },
      ],
    };
    const file = new File([JSON.stringify(data)], "melody.json", {
      type: "application/json",
    });
    // jsdom's File lacks text(); keep the real score parser and file handler.
    Object.defineProperty(file, "text", {
      value: async () => JSON.stringify(data),
    });
    const input = element<HTMLInputElement>("#score-file");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(audio.stopPlayback).toHaveBeenCalledTimes(stops + 1);
    expect(text("#score-title")).toBe("文件导入回归");
    expect(document.querySelectorAll(".score-note")).toHaveLength(2);
    expect(input.disabled).toBe(false);
    expect(element<HTMLDialogElement>("#import-dialog").open).toBe(false);
    expect(text("#listen-button")).toContain("听示范");
  });

  it("retains a reusable audio engine when the page enters the back-forward cache", async () => {
    await click('[data-view="songs"]');
    await click("#listen-button");
    pagehide(true);
    expect(audio.close).not.toHaveBeenCalled();
    expect(text("#listen-button")).toContain("听示范");
    await click("#listen-button");
    expect(audio.scheduleNotes).toHaveBeenCalledTimes(2);
    expect(text("#listen-button")).toContain("停止示范");
  });

  it("uses the scheduled timeline for early onsets and waits for the final input latency", async () => {
    await saveMelody("延迟评分回归", "1 2");
    element<HTMLInputElement>("#bpm").value = "60";
    element<HTMLInputElement>("#latency").value = "100";
    await click("#practice-button");
    expect(callbacks().countIn).toBe(4);
    const scheduled = callbacks();
    const onPitch = audio.startMicrophone.mock.lastCall![0] as (
      frame: PitchFrame,
    ) => void;
    scheduled.onTimeline(1000);
    const sing = (midi: number, milliseconds: number) =>
      onPitch({
        frequency: 440 * 2 ** ((midi - 69) / 12),
        midi,
        cents: 0,
        clarity: 1,
        rms: 0.2,
        time: milliseconds / 1000,
      });
    // Heard 100 ms early after the configured 100 ms input correction.
    sing(60, 1000);
    sing(60, 1200);
    sing(62, 2100);
    scheduled.onComplete();
    await vi.advanceTimersByTimeAsync(99);
    expect(element("#practice-result").hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(element("#practice-result").hidden).toBe(false);
    const values = [
      ...element("#practice-result").querySelectorAll("strong"),
    ].map((node) => node.textContent);
    expect(values[0]).toBe("100%");
    expect(values[2]).toBe("50 ms");
    expect(text("#practice-button")).toContain("开始练习");
  });

  it("keeps rejected tuning and latency drafts out of scoring and restores saved values on reopen", async () => {
    try {
      await click('[data-action="settings"]');
      element<HTMLInputElement>("#tuning").value = "442";
      element<HTMLInputElement>("#latency").value = "150";
      await click('[data-action="save-settings"]');
      const saved = localStorage.getItem("shengzhun-settings");
      await click('[data-action="settings"]');
      element<HTMLInputElement>("#tuning").value = "449";
      element<HTMLInputElement>("#latency").value = "400";
      element<HTMLInputElement>("#mic-min-frequency").value = "400";
      element<HTMLInputElement>("#mic-max-frequency").value = "200";
      await click('[data-action="save-settings"]');
      expect(element<HTMLDialogElement>("#settings-dialog").open).toBe(true);
      expect(text("#a4-display")).toBe("442");
      expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
      await click("#settings-dialog [data-close]");
      await saveMelody("取消延迟草稿回归", "1 2");
      element<HTMLInputElement>("#bpm").value = "60";
      await click("#practice-button");
      const scheduled = callbacks();
      const onPitch = audio.startMicrophone.mock.lastCall![0] as (
        frame: PitchFrame,
      ) => void;
      scheduled.onTimeline(1000);
      for (const [midi, milliseconds] of [
        [60, 1150],
        [60, 1250],
        [62, 2150],
      ]) {
        onPitch({
          frequency: 442 * 2 ** ((midi - 69) / 12),
          midi,
          cents: 0,
          clarity: 1,
          rms: 0.2,
          time: milliseconds / 1000,
        });
      }
      scheduled.onComplete();
      await vi.advanceTimersByTimeAsync(149);
      expect(element("#practice-result").hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(element("#practice-result").hidden).toBe(false);
      const values = [
        ...element("#practice-result").querySelectorAll("strong"),
      ].map((node) => node.textContent);
      expect(values[0]).toBe("100%");
      expect(values[2]).toBe("0 ms");
      await click('[data-action="settings"]');
      expect(element<HTMLInputElement>("#tuning").value).toBe("442");
      expect(element<HTMLInputElement>("#latency").value).toBe("150");
      expect(element<HTMLInputElement>("#mic-min-frequency").value).toBe("50");
      expect(element<HTMLInputElement>("#mic-max-frequency").value).toBe(
        "2200",
      );
    } finally {
      await restorePracticeSettings();
    }
  });

  it("keeps unchanged live readout nodes stable while updating changed pitches", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(20_000);
    try {
      await click("#mic-button");
      const onPitch = audio.startMicrophone.mock.lastCall![0] as (
        frame: PitchFrame,
      ) => void;
      onPitch({
        frequency: 440 * 2 ** ((60 - 69) / 12),
        midi: 60,
        cents: 0,
        clarity: 1,
        rms: 0.05,
        time: 20,
      });
      scheduledDraw(20_110);
      const stableNodes = [
        "#live-note",
        "#live-hz",
        "#live-cents",
        "#tuning-status",
        "#input-tip",
        "#today-time",
      ].map((selector) => ({
        node: element(selector),
        children: [...element(selector).childNodes],
      }));
      scheduledDraw(20_320);
      for (const { node, children } of stableNodes) {
        expect(node.childNodes).toHaveLength(children.length);
        children.forEach((child, index) =>
          expect(node.childNodes[index]).toBe(child),
        );
      }
      expect(text("#live-note")).toBe("C4");
      expect(text("#live-cents")).toBe("0 音分");
      clock.mockReturnValue(20_400);
      onPitch({
        frequency: 440 * 2 ** ((61.12 - 69) / 12),
        midi: 61.12,
        cents: 12,
        clarity: 1,
        rms: 0.05,
        time: 20.4,
      });
      scheduledDraw(20_530);
      expect(text("#live-note")).toBe("C#4");
      expect(text("#live-cents")).toBe("+12 音分");
    } finally {
      clock.mockRestore();
    }
  });

  it("shows live draft pitch and gain-adjusted volume beside the scrolling settings", async () => {
    const saved = localStorage.getItem("shengzhun-settings");
    await click('[data-action="settings"]');
    const dialog = element<HTMLDialogElement>("#settings-dialog");
    const preview = element(".settings-preview");
    expect(preview.parentElement).toBe(dialog);
    expect(element(".settings-body").contains(preview)).toBe(false);
    expect(document.querySelectorAll("#mic-preview-canvas")).toHaveLength(1);
    expect(audio.startMicrophone).not.toHaveBeenCalled();
    await click("#mic-preview-button");
    emitPreview();
    expect(text("#mic-preview-note")).toBe("A4");
    expect(text("#mic-preview-frequency")).toContain("440");
    expect(text("#mic-preview-cents")).toContain("0");
    expect(text("#mic-preview-raw")).toContain("原始");
    const meter = element("#mic-preview-meter");
    expect(meter.getAttribute("role")).toBe("meter");
    const initialLevel = Number(meter.getAttribute("aria-valuenow"));
    expect(initialLevel).toBeGreaterThan(-72);
    const gain = element<HTMLInputElement>("#mic-gain");
    gain.value = "2";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.setMicrophonePreview.mock.lastCall?.[0].inputGain).toBe(2);
    emitPreview();
    expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThan(
      initialLevel,
    );
    const marker = element("#mic-preview-gate-marker");
    const initialGate = Number.parseFloat(marker.style.left);
    const gate = element<HTMLInputElement>("#mic-gate");
    gate.value = "0.03";
    gate.dispatchEvent(new Event("input", { bubbles: true }));
    emitPreview({ frequency: null, midi: null, cents: null, rms: 0.001 });
    expect(Number.parseFloat(marker.style.left)).toBeGreaterThan(initialGate);
    expect(text("#mic-preview-note")).toBe("—");
    expect(text("#mic-preview-message")).toContain("门限");
    const registrations = audio.setMicrophonePreview.mock.calls.length;
    element<HTMLInputElement>("#mic-min-frequency").value = "400";
    const maximum = element<HTMLInputElement>("#mic-max-frequency");
    maximum.value = "200";
    maximum.dispatchEvent(new Event("input", { bubbles: true }));
    emitPreview();
    expect(audio.setMicrophonePreview).toHaveBeenCalledTimes(registrations);
    expect(text("#mic-preview-message")).toContain("参数未完整");
    expect(text("#mic-preview-note")).toBe("A4");
    expect(audio.configureMicrophone).not.toHaveBeenCalled();
    expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
    await click("#settings-dialog [data-close]");
    expect(audio.clearMicrophonePreview).toHaveBeenCalled();
    expect(audio.stopMicrophone).toHaveBeenCalledOnce();
  });

  it("saves previewed settings and stops microphone capture owned by the panel", async () => {
    try {
      await click('[data-action="settings"]');
      await click("#mic-preview-button");
      const gain = element<HTMLInputElement>("#mic-gain");
      gain.value = "2";
      gain.dispatchEvent(new Event("input", { bubbles: true }));
      emitPreview();
      expect(audio.configureMicrophone).not.toHaveBeenCalled();
      await click('[data-action="save-settings"]');
      expect(audio.configureMicrophone).toHaveBeenLastCalledWith({
        ...DEFAULT_MICROPHONE_SETTINGS,
        inputGain: 2,
      });
      expect(element<HTMLDialogElement>("#settings-dialog").open).toBe(false);
      expect(audio.stopMicrophone).toHaveBeenCalledOnce();
      expect(text("#input-state")).toBe("未连接");
      await click('[data-action="settings"]');
      expect(element<HTMLInputElement>("#mic-gain").value).toBe("2");
      expect(audio.startMicrophone).toHaveBeenCalledOnce();
    } finally {
      await restorePracticeSettings();
    }
  });

  it("keeps an active practice session on committed analysis while previewing drafts", async () => {
    await saveMelody("独立收音预览回归", "1 2");
    element<HTMLInputElement>("#bpm").value = "60";
    await click("#practice-button");
    const scheduled = callbacks();
    scheduled.onTimeline(1000);
    const onPitch = audio.startMicrophone.mock.lastCall![0] as (
      frame: PitchFrame,
    ) => void;
    const saved = localStorage.getItem("shengzhun-settings");
    await click('[data-action="settings"]');
    expect(audio.startMicrophone).toHaveBeenCalledOnce();
    const gain = element<HTMLInputElement>("#mic-gain");
    gain.value = "3";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    element<HTMLInputElement>("#tuning").value = "449";
    element<HTMLInputElement>("#latency").value = "400";
    emitPreview({ frequency: 880, midi: 81 });
    for (const [midi, milliseconds] of [
      [60, 1100],
      [60, 1200],
      [62, 2100],
    ]) {
      onPitch({
        frequency: 440 * 2 ** ((midi - 69) / 12),
        midi,
        cents: 0,
        clarity: 1,
        rms: 0.2,
        time: milliseconds / 1000,
      });
    }
    scheduled.onComplete();
    await vi.advanceTimersByTimeAsync(100);
    const values = [
      ...element("#practice-result").querySelectorAll("strong"),
    ].map((node) => node.textContent);
    expect(values[0]).toBe("100%");
    expect(values[2]).toBe("0 ms");
    const stops = audio.stopMicrophone.mock.calls.length;
    await click("#settings-dialog [data-close]");
    expect(audio.stopMicrophone).toHaveBeenCalledTimes(stops);
    expect(text("#input-state")).toBe("已连接");
    expect(audio.configureMicrophone).not.toHaveBeenCalled();
    expect(localStorage.getItem("shengzhun-settings")).toBe(saved);
    expect(text("#a4-display")).toBe("440");
  });

  it("cancels preview capture when the panel closes before microphone permission resolves", async () => {
    await click('[data-action="settings"]');
    const grant = pendingPermission();
    await click("#mic-preview-button");
    expect(text("#mic-status")).toContain("正在申请权限");
    await click("#settings-dialog [data-close]");
    expect(audio.clearMicrophonePreview).toHaveBeenCalled();
    expect(audio.stopMicrophone).toHaveBeenCalledOnce();
    grant();
    await settle();
    expect(element<HTMLDialogElement>("#settings-dialog").open).toBe(false);
    expect(text("#input-state")).toBe("未连接");
    expect(element("#mic-status").classList.contains("connected")).toBe(false);
    await click('[data-action="settings"]');
    expect(text("#mic-preview-note")).toBe("—");
    expect(audio.startMicrophone).toHaveBeenCalledOnce();
  });
});
