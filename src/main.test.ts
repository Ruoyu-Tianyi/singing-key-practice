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
import type { PitchFrame } from "./audio";

const audio = vi.hoisted(() => ({
  startMicrophone: vi.fn(),
  stopMicrophone: vi.fn(),
  scheduleNotes: vi.fn(),
  playNote: vi.fn(),
  stopPlayback: vi.fn(),
  close: vi.fn(),
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
      startMicrophone = audio.startMicrophone;
      stopMicrophone = audio.stopMicrophone;
      scheduleNotes = audio.scheduleNotes;
      playNote = audio.playNote;
      stopPlayback = audio.stopPlayback;
      close = audio.close;
    },
  };
});

const element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
};
const text = (selector: string) => element(selector).textContent;

async function settle() {
  // DOM event handlers have nested awaits for audio permission and playback.
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

async function click(selector: string) {
  element(selector).click();
  await settle();
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
      this.removeAttribute("open");
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
    const dialog = element<HTMLDialogElement>("#chart-focus-dialog");
    await click("#chart-expand-button");
    expect(dialog.open).toBe(true);
    expect(card.parentElement).toBe(dialog);
    expect(element("#chart-expand-button").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(element("#pitch-canvas")).toBe(canvas);
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
    expect(element("#chart-expand-button").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(element("#chart-expand-button"));
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
});
