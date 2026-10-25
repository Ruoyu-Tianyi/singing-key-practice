import "./style.css";
import { APP_VERSION, helpContent, historyDialogMarkup } from "./support";
import {
  addPracticeRecord,
  createPracticeRecord,
  readPracticeHistory,
  summarizePracticeHistory,
  exportPracticeHistory,
  importPracticeHistory,
  type PracticeRecord,
} from "./practice-history";
import {
  recommendMicrophoneSettings,
  type CalibrationSample,
} from "./microphone-calibration";
import {
  amplitudeDb,
  formatAmplitude,
  meterPosition,
  PREVIEW_FLOOR_DB,
} from "./microphone-preview";
import {
  createIcons,
  AudioLines,
  Mic,
  Music2,
  Piano,
  BookOpen,
  Settings2,
  CircleHelp,
  ArrowUpRight,
  Play,
  Square,
  Plus,
  Minus,
  Upload,
  Headphones,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Volume2,
  X,
  Repeat2,
  Check,
  SlidersHorizontal,
  Github,
  Download,
  Target,
  Timer,
  Sparkles,
  Maximize2,
  Minimize2,
} from "lucide";
import {
  PitchViewport,
  selectPitchRange,
  chooseNoteLabelStep,
} from "./pitch-chart";
import {
  AudioEngine,
  midiToFrequency,
  noteLabel,
  type PitchFrame,
  type Instrument,
  DEFAULT_MICROPHONE_SETTINGS,
  normalizeMicrophoneSettings,
  type MicrophoneSettings,
} from "./audio";
import {
  builtinScores,
  importScore,
  parseJianpu,
  validateScore,
  type PracticeScore,
  type ScoreNote,
} from "./score";

const iconSet = {
  AudioLines,
  Mic,
  Music2,
  Piano,
  BookOpen,
  Settings2,
  CircleHelp,
  ArrowUpRight,
  Play,
  Square,
  Plus,
  Minus,
  Upload,
  Headphones,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Volume2,
  X,
  Repeat2,
  Check,
  SlidersHorizontal,
  Github,
  Download,
  Target,
  Timer,
  Sparkles,
  Maximize2,
  Minimize2,
};
const i = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const engine = new AudioEngine();
let microphoneSettings: MicrophoneSettings = { ...DEFAULT_MICROPHONE_SETTINGS };
let previewSettings: MicrophoneSettings = { ...microphoneSettings };
let previewFrame: PitchFrame | null = null;
let previewSamples: { t: number; midi: number | null }[] = [];
const previewViewport = new PitchViewport();
let previewOwnsMicrophone = false,
  previewInvalid = false,
  previewReceivedAt = 0,
  lastPreviewPaint = -Infinity;
let micError = "";
type CalibrationPhase =
  | "idle"
  | "connecting"
  | "noise"
  | "ready"
  | "voice"
  | "success"
  | "error";
let calibrationPhase: CalibrationPhase = "idle";
let calibrationGeneration = 0;
let calibrationStartedAt = 0;
let calibrationFirstFrameAt = 0;
let calibrationLastFrameAt = 0;
let calibrationNoise: CalibrationSample[] = [];
let calibrationVoice: CalibrationSample[] = [];
let calibrationMessage = "先安静 4 秒，再自然试唱 6 秒。";
let calibrationDetail = "";
let inputLatencyMs = 100;
const pitchViewport = new PitchViewport();
type View = "tuner" | "match" | "songs";
let view: View = "tuner",
  instrument: Instrument = "piano",
  target = 60,
  octave = 3;
let mic = false,
  micBusy = false,
  playing = false,
  practicing = false,
  loop = false;
let frame: PitchFrame | null = null,
  activeIndex = -1,
  songStart = 0,
  transpose = 0;
let samples: { t: number; midi: number | null }[] = [],
  noteEvents: { index: number; error: number }[] = [];
let lastVoiced = 0,
  lastMidi: number | null = null,
  pitchTotal = 0,
  pitchInTune = 0,
  pitchedMs = 0;
let lastScoreTime = 0,
  sessionToken = 0,
  monitorStarted = 0,
  micGeneration = 0;
let loopTimer = 0;
let practiceNotes: ScoreNote[] = [],
  practiceOnsets: number[] = [],
  practiceBeatMs = 750;
let stats: { seconds: number; sessions: number; best: number; date: string } = {
  seconds: 0,
  sessions: 0,
  best: 0,
  date: "",
};
let customScores: PracticeScore[] = [];
let practiceHistory: PracticeRecord[] = [];
let historySaved = true;
let activePractice: Pick<
  PracticeRecord,
  "title" | "scoreId" | "bpm" | "transpose" | "rangeStart" | "rangeEnd"
> | null = null;
try {
  const saved = JSON.parse(localStorage.getItem("shengzhun-stats") || "null");
  if (saved && Number.isFinite(saved.seconds) && saved.seconds >= 0) {
    stats = {
      seconds: saved.seconds,
      sessions: Number.isFinite(saved.sessions)
        ? Math.max(0, saved.sessions)
        : 0,
      best: Number.isFinite(saved.best)
        ? Math.max(0, Math.min(100, saved.best))
        : 0,
      date: typeof saved.date === "string" ? saved.date : "",
    };
  }
} catch {
  /* Unavailable or damaged storage must not prevent startup. */
}
try {
  const savedScores = JSON.parse(
    localStorage.getItem("shengzhun-scores") || "[]",
  );
  if (Array.isArray(savedScores))
    customScores = savedScores.flatMap((value) => {
      try {
        return [validateScore(value)];
      } catch {
        return [];
      }
    });
} catch {
  /* storage can be unavailable in private mode */
}
try {
  practiceHistory = readPracticeHistory(
    localStorage.getItem("auralis-practice-history"),
  );
} catch {
  historySaved = false;
}
let score = builtinScores[0];
let editDraft: ScoreNote[] = [],
  editPage = 0;
const app = $("app");
app.innerHTML = `
<aside class="sidebar">
  <a class="brand" href="#tuner" aria-label="Auralis 首页"><span class="brand-mark"><img src="./logo-mark.svg" width="48" height="48" alt="" /></span><span>auralis<small>FIND YOUR FREQUENCY</small></span></a>
  <div class="nav-label">YOUR PRACTICE SPACE</div>
  <nav aria-label="练习模式">
    <button class="nav-item active" data-view="tuner" aria-label="实时音准仪">${i("audio-lines")}<span>实时音准仪<small>Pitch monitor</small></span><span class="nav-index" aria-hidden="true">01</span></button>
    <button class="nav-item" data-view="match" aria-label="标准音模唱">${i("piano")}<span>标准音模唱<small>Note matching</small></span><span class="nav-index" aria-hidden="true">02</span></button>
    <button class="nav-item" data-view="songs" aria-label="曲谱练习">${i("book-open")}<span>曲谱练习<small>Melody practice</small></span><span class="nav-index" aria-hidden="true">03</span></button>
  </nav>
  <div class="sidebar-note"><div class="sidebar-orbit" aria-hidden="true"><span></span><span></span><span></span><b>♪</b></div><strong>Every voice<br>has its own <em>orbit.</em></strong><p>听见自己，靠近每一个音。</p></div>
  <div class="sidebar-bottom"><button data-action="settings">${i("settings-2")}<span>练习设置</span></button><button data-action="help">${i("circle-help")}<span>使用指南</span>${i("arrow-up-right")}</button><div class="open-source"><span></span> ON-DEVICE AUDIO <small>开源 · 本地处理</small></div></div>
</aside>
<main>
  <header class="topbar"><span><span class="studio-label">STUDIO</span><span class="slash">/</span><span id="breadcrumb">实时音准仪</span></span><span class="privacy">${i("shield-check")}声音只属于你 · 仅在本机分析</span><button class="help-icon mobile-import" data-action="import" aria-label="导入曲谱">${i("upload")}</button><button class="help-icon" data-action="settings" aria-label="练习设置">${i("settings-2")}</button><button class="help-icon" data-action="help" aria-label="使用指南">${i("circle-help")}</button></header>
  <div class="page">
    <div class="page-heading"><div><div class="eyebrow"><span></span> A SPACE FOR YOUR VOICE</div><h1 id="page-title">Find your <em>frequency.</em></h1><p id="page-subtitle">让声音被看见，让每一次练习都有方向。</p></div><div class="hero-actions"><span class="hero-caption">LISTEN. SING. FEEL.</span><button class="button secondary import-top" data-action="import">${i("upload")}导入你的曲谱${i("arrow-up-right")}</button></div><div class="hero-orbit" aria-hidden="true"><span></span><span></span><b>✧</b></div></div>
    <div class="workspace">
      <div class="main-column">
        <section class="card tuner-card" aria-label="实时音高监测">
          <div class="card-header"><h2>${i("audio-lines")}<span id="monitor-title">实时音准</span><small>PITCH OBSERVATORY</small></h2><div class="chart-tools"><span class="status" id="mic-status"><span></span>麦克风未开启</span><button class="chart-expand-button" id="chart-expand-button" data-action="expand-chart" aria-pressed="false">${i("maximize-2")}<span>放大曲线</span></button></div></div>
          <div class="pitch-readout"><div class="current-pitch"><span class="readout-label">YOUR NOTE</span><span id="live-note">—</span><span class="pitch-hz" id="live-hz">等待你的声音</span></div><div class="tuning-readout"><span class="readout-label">INTONATION</span><strong id="live-cents">— <small>音分</small></strong><span id="tuning-status">准备好，就唱出一个音</span></div></div>
          <div class="pitch-chart"><canvas id="pitch-canvas" role="img" aria-label="最近十秒的演唱音高曲线，纵轴为音名，横轴为时间，音域自动适应整段声音"></canvas><div class="chart-empty" id="chart-empty"><span class="empty-mic">${i("mic")}<b></b><b></b></span><strong>Your voice, in a new light.</strong><span>开启麦克风，让第一个音点亮这里。</span></div><div class="chart-legend"><span class="legend-live"></span>你的声音<span class="legend-target"></span><span id="chart-reference-label">标准音</span><span class="chart-range" id="chart-range">音域自适应</span><span class="chart-window">10 SEC WINDOW</span></div></div>
          <div class="target-dock" id="target-dock" aria-label="目标音与播放"><div class="dock-label">目标音<p class="target-frequency" id="target-frequency">261.63 <span>Hz</span></p></div></div>
          <div class="song-practice-dock" id="song-practice-dock" hidden><div class="song-transport"></div></div>
          <div class="tuner-bottom"><span id="microphone-help">${i("headphones")}建议佩戴耳机，识别更准确</span><button class="button secondary mic-settings" data-action="settings">${i("sliders-horizontal")}收音设置</button><button class="button primary" id="mic-button" data-action="mic" aria-describedby="microphone-help">${i("mic")}开启麦克风</button></div>
        </section>
        <section class="card keyboard-card" id="keyboard-card"><div class="card-header"><h2>${i("piano")}听一个标准音</h2><div class="octave-switch"><button data-action="octave-down" aria-label="降低键盘八度">${i("minus")}</button><span id="octave-label">C3 – B4</span><button data-action="octave-up" aria-label="升高键盘八度">${i("plus")}</button></div></div><div class="keyboard-wrap"><div id="keyboard" class="keyboard" aria-label="标准音键盘"></div></div><div class="keyboard-footer"><span>点击琴键听音，再试着唱出来</span><span>电脑快捷键 <kbd>A</kbd> – <kbd>K</kbd></span></div></section>
        <section class="card songs-card" id="songs-card" hidden><div class="card-header"><h2>${i("book-open")}我的曲谱</h2><button class="text-button" data-action="editor">手动编谱 ${i("plus")}</button></div><div class="score-controls"><label>选择曲谱<select id="score-select"></select></label><label>速度 <span id="bpm-text">80 BPM</span><input id="bpm" type="range" min="30" max="220" value="80"></label></div><div class="score-meta"><strong id="score-title"></strong><span id="score-meta"></span><button class="text-button" data-action="export" aria-label="导出当前曲谱">${i("download")}导出</button></div><div id="score-notes" class="score-notes" aria-label="曲谱音符，点击可试听"></div><div class="range-controls"><label>起始音符<input id="range-start" type="number" min="1" value="1"></label><span>至</span><label>结束音符<input id="range-end" type="number" min="1" value="1"></label><label>移调<select id="transpose">${Array.from({ length: 25 }, (_, n) => `<option value="${n - 12}" ${n === 12 ? "selected" : ""}>${n === 12 ? "原调" : `${n > 12 ? "+" : ""}${n - 12} 半音`}</option>`).join("")}</select></label></div><div class="song-actions"><label class="check-label"><input id="metronome" type="checkbox" checked>节拍器</label><label class="check-label"><input id="guide" type="checkbox">跟唱提示音</label><button class="icon-button" data-action="loop" id="loop-button" aria-label="循环练习" aria-pressed="false">${i("repeat-2")}</button><button class="button secondary" data-action="listen" id="listen-button">${i("headphones")}听示范</button><button class="button primary" data-action="practice" id="practice-button">${i("play")}开始练习</button></div><p id="song-feedback" class="song-feedback" role="status">先听一遍旋律，再跟着节拍唱。练习前有 4 拍预备。</p><div id="practice-result" class="practice-result" hidden></div></section>
        <div class="bottom-tip">${i("sparkles")}<span id="bottom-tip">小提示：不用唱得很响亮。自然、稳定的声音，是最好的开始。</span></div>
      </div>
      <aside class="right-column">
        <section class="card reference-card"><div class="card-header"><h2>${i("music-2")}音色与播放</h2><span class="tag">标准音设置</span></div><div class="target-selector"><button class="round-button" data-action="target-down" aria-label="降低目标音">${i("minus")}</button><div><strong id="target-note">C<span>4</span></strong><span id="target-solfege">Do · 中央 C</span></div><button class="round-button" data-action="target-up" aria-label="升高目标音">${i("plus")}</button></div><div class="timbre-label">参考音色</div><div class="segmented"><button class="selected" data-instrument="piano" aria-pressed="true">${i("piano")}钢琴</button><button data-instrument="accordion" aria-pressed="false">${i("music-2")}手风琴</button></div><button class="button play-reference" id="reference-button" data-action="reference">${i("volume-2")}播放标准音</button><label class="volume-control">${i("volume-2")}<input id="volume" type="range" min="0" max="100" value="55" aria-label="标准音播放音量"><span id="volume-text">55%</span></label><div class="tuning-reference">十二平均律 <span>·</span> A4 = <span id="a4-display">440</span> Hz</div></section>
        <section class="card input-card"><div class="card-header"><h2>输入状态</h2><span id="input-state">未连接</span></div><div class="meter" id="input-meter">${Array.from({ length: 32 }, () => "<span></span>").join("")}</div><div class="meter-labels"><span>安静</span><span>适中</span><span>响亮</span></div><p id="input-tip">开启麦克风后，观察声音的输入强度。</p></section>
        <section class="practice-guide"><div class="guide-icon">${i("headphones")}</div><h3>给自己 5 分钟</h3><p>从一个舒服的音开始，<br>听一听，唱一唱，再靠近一点。</p><div class="guide-steps"><span><b>1</b>播放标准音，仔细聆听</span><span><b>2</b>用「啊」或「呜」轻声模唱</span><span><b>3</b>观察曲线，慢慢调整音高</span></div><div class="practice-stat"><span>今日已练习</span><strong id="today-time">0 <small>分钟</small></strong></div></section>
      </aside>
    </div>
    <footer><a href="https://github.com/Ruoyu-Tianyi/singing-key-practice" target="_blank" rel="noopener noreferrer">auralis <span class="footer-dot">/</span> OPEN SOURCE VOCAL STUDIO ${i("arrow-up-right")}</a><span>Make a little space for your voice. <span class="footer-heart">✧</span></span></footer>
  </div>
</main>
<div id="toast" class="toast" role="status" hidden></div>
<dialog id="import-dialog" aria-labelledby="import-dialog-title"><div class="dialog-head"><div><span class="eyebrow">YOUR MUSIC, YOUR PACE</span><h2 id="import-dialog-title">把想唱的歌，带进练习室</h2></div><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><p>MusicXML / MIDI 可直接导入。图片与 PDF 的识别结果需要校对。</p><label class="field">曲谱类型<select id="import-kind"><option value="digital">MusicXML / MIDI / JSON</option><option value="jianpu">图片 / PDF 简谱（本地文字识别）</option><option value="staff">图片 / PDF 五线谱（Audiveris 服务）</option></select></label><label class="field" id="omr-field" hidden>五线谱识别服务地址<input id="omr-endpoint" type="url" placeholder="http://127.0.0.1:8765/api/recognize"><small>需自行运行附带的本地服务；曲谱只发送到此地址。</small></label><label class="upload-zone" for="score-file">${i("upload")}<strong>点击选择你的曲谱</strong><span>MusicXML、MXL、MIDI、JSON、PNG、JPG、PDF · 最大 20 MB</span><input id="score-file" type="file" accept=".xml,.musicxml,.mxl,.mid,.midi,.json,.png,.jpg,.jpeg,.webp,.pdf" hidden></label><p id="import-progress" class="import-progress" role="status"></p><div id="ocr-review" hidden><div class="notice">简谱识别无法可靠保留上下标、八度和时值。请对照原谱修正，再保存。</div><label class="field">识别文字<textarea id="ocr-text" rows="5"></textarea></label><button class="button primary" data-action="save-ocr">校对完成，导入曲谱</button></div><div class="dialog-foot">只有你主动选择五线谱服务时，曲谱才会离开此设备。首次简谱识别需联网下载识别模型。</div></dialog>
<dialog id="editor-dialog" aria-labelledby="editor-dialog-title"><div class="dialog-head"><h2 id="editor-dialog-title">写一段自己的旋律</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><label class="field">曲谱名称<input id="editor-title" value="我的旋律" maxlength="100"></label><label class="field">简谱<textarea id="editor-text" rows="5" spellcheck="false">1 1 5 5 | 6 6 5- | 4 4 3 3 | 2 2 1-</textarea></label><p class="notation-help">以 C 大调为基准：1–7 为音符，0 为休止；<code>1'</code> 高八度，<code>1,</code> 低八度；<code>1-</code> 两拍，<code>1_</code> 半拍，<code>1__</code> 四分之一拍；可用 #、b 升降音。请用空格分隔音符。</p><button class="button primary" data-action="save-editor">${i("check")}保存到我的曲谱</button></dialog>
<dialog id="settings-dialog" aria-labelledby="settings-dialog-title">
  <div class="dialog-head"><div><span class="eyebrow">TUNE YOUR LISTENING</span><h2 id="settings-dialog-title">让练习更适合你</h2></div><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div>
  <section class="settings-preview" aria-labelledby="mic-preview-title">
    <div class="mic-preview-heading"><h3 id="mic-preview-title">实时收音预览 <span id="mic-preview-status">未开启</span></h3><button id="mic-preview-button" class="button secondary" data-action="preview-mic" aria-pressed="false">${i("mic")}开启收音</button></div>
    <div class="mic-preview-readouts"><div class="mic-preview-pitch"><strong id="mic-preview-note">—</strong><div><span id="mic-preview-frequency">等待你的声音</span><span id="mic-preview-cents">— 音分</span></div></div><div class="mic-preview-input"><div><span>分析音量</span><strong id="mic-preview-level">— dBFS</strong></div><div id="mic-preview-meter" class="mic-preview-meter" role="meter" aria-label="增益后的分析音量" aria-valuemin="-72" aria-valuemax="0" aria-valuenow="-72" aria-describedby="mic-preview-help"><span id="mic-preview-fill"></span><b id="mic-preview-gate-marker"></b></div><small id="mic-preview-raw">原始 — · 门限 —</small></div></div>
    <div class="mic-preview-chart"><canvas id="mic-preview-canvas" role="img" aria-label="最近五秒的预览音高曲线，音域自动适应声音"></canvas><span id="mic-preview-message">开启收音，边唱边调</span><small>5s</small></div>
    <div class="mic-calibration" aria-label="自动收音校准">
      <div class="mic-calibration-toolbar"><button id="mic-calibrate-button" class="button secondary" data-action="calibrate-mic">${i("sparkles")}自动校准</button><span id="mic-calibrate-step">环境 → 试唱 → 微调</span><button id="mic-calibrate-cancel" class="calibration-cancel" data-action="cancel-calibration" hidden>取消校准</button></div>
      <p id="mic-calibrate-status" role="status">先安静 4 秒，再自然试唱 6 秒。</p>
      <div id="mic-calibrate-timing" hidden><progress id="mic-calibrate-progress" max="100" value="0" aria-label="当前校准步骤进度"></progress><span id="mic-calibrate-countdown" aria-hidden="true"></span></div>
      <p id="mic-calibrate-detail" hidden></p>
    </div>
  </section>
  <div class="settings-body">
  <p class="settings-intro">收音参数立即预览，保存后用于练习；关闭将放弃未保存的改动。</p>
  <fieldset class="settings-section"><legend>麦克风收音</legend>
    <div class="mic-presets" aria-label="收音场景预设"><button class="button secondary" data-action="mic-preset" data-preset="soft">轻声练习</button><button class="button secondary" data-action="mic-preset" data-preset="balanced">日常环境</button><button class="button secondary" data-action="mic-preset" data-preset="noisy">环境较吵</button></div>
    <p class="setting-note">预设会立即预览输入增益、音量门限和可信度的效果，保存后用于正式练习。</p>
    <label class="field" for="mic-gain">收音灵敏度 · 输入增益 <output id="mic-gain-value" for="mic-gain">1.0×</output><input id="mic-gain" type="range" min="0.5" max="4" step="0.1" value="1" aria-describedby="mic-gain-help"></label><p class="setting-help" id="mic-gain-help">调高后更容易拾取轻声，也会放大背景声。这是本机分析增益，不改变系统麦克风音量，也不会从扬声器播放人声。</p>
    <label class="field" for="mic-gate">音量门限 <output id="mic-gate-value" for="mic-gate">0.008</output><input id="mic-gate" type="range" min="0.001" max="0.05" step="0.001" value="0.008" aria-describedby="mic-gate-help"></label><p class="setting-help" id="mic-gate-help">越低越容易拾取轻声和尾音，也更容易收进环境声；越高越能忽略轻微噪声，但轻声曲线可能中断。数值是数字信号电平，不是实际声压。</p>
  </fieldset>
  <fieldset class="settings-section"><legend>识别频率与音域</legend>
    <p class="setting-help" id="mic-preview-help">音量条为增益后的数字电平（dBFS），竖线为音量门限。预览只在本机分析，人声不会通过扬声器回放。仅在面板内开启的收音会随面板关闭而停止。</p>
    <label class="field" for="mic-range-preset">音域预设<select id="mic-range-preset"><option value="wide">宽音域 · 50–2200 Hz</option><option value="low">偏低音域 · 65–1000 Hz</option><option value="high">偏高音域 · 130–2000 Hz</option><option value="custom">自定义范围</option></select></label>
    <div class="settings-pair"><label class="field" for="mic-min-frequency">最低音高（Hz）<input id="mic-min-frequency" type="number" min="40" max="500" step="1" value="50" aria-describedby="mic-range-help"><small>可设为 40–500 Hz</small></label><label class="field" for="mic-max-frequency">最高音高（Hz）<input id="mic-max-frequency" type="number" min="200" max="3000" step="1" value="2200" aria-describedby="mic-range-help"><small>可设为 200–3000 Hz</small></label></div>
    <p class="setting-help" id="mic-range-help">Hz 在这里表示声音高低：例如 A4 = 440 Hz。缩小范围会忽略范围外的音高估计，超出范围时不显示曲线；不会将声音移调，也不能代替降噪。</p>
    <label class="field" for="mic-refresh">检测更新频率<select id="mic-refresh" aria-describedby="mic-refresh-help"><option value="10">10 次/秒 · 更省电</option><option value="20">20 次/秒 · 轻量</option><option value="30" selected>30 次/秒 · 均衡</option><option value="60">60 次/秒 · 更细密</option></select></label>
    <p class="setting-help" id="mic-refresh-help">控制多久检测一次音高；较高可捕捉更密的变化，也更耗电。它不改变音名、识别上限或硬件采样率，实际次数受设备性能与屏幕刷新限制。</p>
    <div class="sample-rate-note"><span>音频处理采样率</span><strong id="mic-sample-rate">开启麦克风后显示</strong><p>这是浏览器每秒处理的音频采样数，由浏览器与设备决定；与上面的音高 Hz、检测次数/秒不同。</p></div>
  </fieldset>
  <details class="settings-advanced"><summary>更多检测选项 ${i("chevron-down")}</summary><div>
    <label class="field" for="mic-clarity">识别可信度门限 <output id="mic-clarity-value" for="mic-clarity">87%</output><input id="mic-clarity" type="range" min="0.6" max="0.99" step="0.01" value="0.87" aria-describedby="mic-clarity-help"></label><p class="setting-help" id="mic-clarity-help">较高会严格过滤不稳定的音高，曲线可能变少；较低更容易显示音高，也更可能出现跳动。此百分比是算法指标，不是唱准分数。</p>
    <label class="field" for="mic-window">分析窗口<select id="mic-window" aria-describedby="mic-window-help"><option value="2048">2048 个采样 · 短窗口</option><option value="4096" selected>4096 个采样 · 均衡</option><option value="8192">8192 个采样 · 长窗口</option></select></label><p class="setting-help" id="mic-window-help">长窗口包含更多声音片段，有助于覆盖低音的更多振动周期，但响应变化可能更慢、计算更重。短窗口反应较快，低音可能较难稳定识别。更改窗口后，曲谱跟唱可能需要重新微调延迟校正。<span id="mic-window-time"></span></p>
  </div></details>
  <fieldset class="settings-section"><legend>标准音与节奏</legend><div class="settings-pair"><label class="field">标准音 A4（Hz）<input id="tuning" type="number" min="430" max="450" step="1" value="440"><small>默认 440 Hz；用于音名换算和参考音，不是麦克风采样率。</small></label><label class="field">跟唱延迟（毫秒）<input id="latency" type="number" min="0" max="500" step="10" value="100"><small>用于输入延迟对齐，只影响曲谱练习的时间与评分。</small></label></div></fieldset>
  <p class="setting-help">声音仅在本机分析。手机请通过 HTTPS 访问，并允许浏览器使用麦克风。标准音播放音量请在「音色与播放」中调整。</p>
  </div><p id="settings-error" role="alert" hidden></p><div class="settings-actions"><button class="button secondary" data-action="reset-mic-settings">恢复收音默认值</button><button class="button primary" data-action="save-settings">保存设置</button></div>
</dialog>
<dialog id="help-dialog" aria-labelledby="help-dialog-title"><div class="dialog-head"><h2 id="help-dialog-title">从第一个音开始</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><div class="help-content"><h3>实时音准仪</h3><p>开启麦克风并允许浏览器录音。音名和曲线显示当前音高，音分表示距离最近标准音的偏差。绿色表示误差在 ±25 音分以内；音量太低、噪声或多人合唱会降低准确度。</p><h3>标准音模唱</h3><p>点击琴键或播放目标音，再用自然的声音模唱。「标准音模唱」模式会把偏差对准你选的目标音。钢琴与手风琴采用本地合成音色。</p><h3>曲谱练习</h3><p>选一首曲谱、调整速度与片段。先听示范，再开始练习。4 拍预备后跟着音符唱，默认不播放旋律，避免扬声器串音。音准命中率按有效发声采样计算，覆盖率表示目标发声时长中检测到有效声音的比例；节奏参考首次发声及换音时间，连续同音无法可靠区分。</p><h3>图片和 PDF</h3><p>简谱使用文字 OCR，必须校对八度和时值。五线谱需要附带的 Audiveris 服务，识别后也需要核对；复杂多声部只取选定主旋律，不支持完整乐队总谱。更准确的方式是从制谱软件导出 MusicXML。</p><h3>数据与隐私</h3><p>麦克风声音不上传、不录制。自定义曲谱和今日练习时长保存在当前浏览器中；没有账号与跨设备同步。电脑、平板、手机均可通过同一 HTTPS 网址访问。</p></div></dialog>`;

app.insertAdjacentHTML("beforeend", historyDialogMarkup);
document.querySelector("#help-dialog .help-content")!.innerHTML = helpContent;
document
  .querySelector(".topbar [data-action='settings']")!
  .insertAdjacentHTML(
    "beforebegin",
    `<button class="help-icon" data-action="history" aria-label="练习记录">${i("timer")}</button>`,
  );
document
  .querySelector(".practice-guide")!
  .insertAdjacentHTML(
    "beforeend",
    `<button class="journal-entry" data-action="history">${i("timer")}查看练习记录 ${i("chevron-right")}</button>`,
  );
document
  .querySelector(".tuner-bottom")!
  .insertAdjacentHTML(
    "beforebegin",
    '<p id="audio-error" class="audio-error" role="status" hidden></p>',
  );
const settingsDialog = $<HTMLDialogElement>("settings-dialog");
const previewCanvas = $<HTMLCanvasElement>("mic-preview-canvas");
const previewContext = previewCanvas.getContext("2d")!;
const chartHost = document.querySelector<HTMLElement>(".workspace")!;
const tunerCard = document.querySelector<HTMLElement>(".tuner-card")!;
const mainColumn = document.querySelector<HTMLElement>(".main-column")!;
chartHost.prepend(tunerCard);
const inputCard = document.querySelector<HTMLElement>(".input-card")!;
mainColumn.insertBefore(inputCard, document.querySelector(".bottom-tip"));
// Keep one set of controls with the canvas, including in its enlarged dialog.
$("target-dock").append(
  document.querySelector(".target-selector")!,
  $("reference-button"),
);
$("song-practice-dock").prepend(document.querySelector(".score-controls")!);
$("song-practice-dock")
  .querySelector(".song-transport")!
  .append($("listen-button"), $("practice-button"));
$("song-practice-dock").append($("song-feedback"));
const chartDialog = document.createElement("dialog");
chartDialog.id = "chart-focus-dialog";
chartDialog.className = "chart-focus-dialog";
chartDialog.setAttribute("aria-label", "放大的实时音高曲线");
document.body.append(chartDialog);
let chartExpanded = false;

function setChartExpanded(expanded: boolean) {
  chartExpanded = expanded;
  if (expanded) {
    chartDialog.append(tunerCard);
    chartDialog.showModal();
  } else {
    if (chartDialog.open) chartDialog.close();
    chartHost.insertBefore(tunerCard, mainColumn);
  }
  const button = $("chart-expand-button");
  button.setAttribute("aria-pressed", String(expanded));
  button.innerHTML =
    i(expanded ? "minimize-2" : "maximize-2") +
    `<span>${expanded ? "还原曲线" : "放大曲线"}</span>`;
  refreshIcons();
  button.focus({ preventScroll: true });
}
chartDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  setChartExpanded(false);
});
chartDialog.addEventListener("close", () => {
  if (chartExpanded) setChartExpanded(false);
});

function refreshIcons() {
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.7 } });
}
function setText(id: string, value: string) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}
function setMarkup(id: string, value: string) {
  const node = $(id);
  if (node.innerHTML !== value) node.innerHTML = value;
}
const microphoneFields: Record<keyof MicrophoneSettings, string> = {
  inputGain: "mic-gain",
  noiseThreshold: "mic-gate",
  minFrequency: "mic-min-frequency",
  maxFrequency: "mic-max-frequency",
  clarityThreshold: "mic-clarity",
  updateRateHz: "mic-refresh",
  fftSize: "mic-window",
};
const frequencyPresets: Record<string, [number, number]> = {
  wide: [50, 2200],
  low: [65, 1000],
  high: [130, 2000],
};
function updateMicrophoneDescriptions() {
  setText(
    "mic-gain-value",
    `${Number($<HTMLInputElement>("mic-gain").value).toFixed(1)}×`,
  );
  setText(
    "mic-gate-value",
    Number($<HTMLInputElement>("mic-gate").value).toFixed(3),
  );
  setText(
    "mic-clarity-value",
    `${Math.round(Number($<HTMLInputElement>("mic-clarity").value) * 100)}%`,
  );
  const minimum = Number($<HTMLInputElement>("mic-min-frequency").value);
  const maximum = Number($<HTMLInputElement>("mic-max-frequency").value);
  $<HTMLSelectElement>("mic-range-preset").value =
    Object.entries(frequencyPresets).find(
      ([, range]) => range[0] === minimum && range[1] === maximum,
    )?.[0] ?? "custom";
  const rate = engine.microphoneSampleRate;
  setText(
    "mic-sample-rate",
    rate ? `${rate.toLocaleString()} Hz` : "开启麦克风后显示",
  );
  const window = Number($<HTMLSelectElement>("mic-window").value);
  setText(
    "mic-window-time",
    rate
      ? ` 当前窗口约 ${((window / rate) * 1000).toFixed(1)} 毫秒。`
      : ` 以 48,000 Hz 为例，此窗口约 ${((window / 48000) * 1000).toFixed(1)} 毫秒，实际时长在开启麦克风后显示。`,
  );
  if (settingsDialog.open) updateMicrophonePreview();
}
function fillMicrophoneSettings(settings: MicrophoneSettings) {
  for (const [key, id] of Object.entries(microphoneFields)) {
    $<HTMLInputElement | HTMLSelectElement>(id).value = String(
      settings[key as keyof MicrophoneSettings],
    );
  }
  $("settings-error").hidden = true;
  updateMicrophoneDescriptions();
}
function readMicrophoneSettings(
  reportErrors = true,
): MicrophoneSettings | null {
  const result: Record<string, number> = {};
  for (const [key, id] of Object.entries(microphoneFields)) {
    const input = $<HTMLInputElement | HTMLSelectElement>(id);
    if (
      !input.value ||
      !input.checkValidity() ||
      !Number.isFinite(Number(input.value))
    ) {
      if (reportErrors) {
        setText(
          "settings-error",
          "请填写有效的收音设置，数值需在各项标注的范围内。",
        );
        $("settings-error").hidden = false;
        input.focus();
      }
      return null;
    }
    result[key] = Number(input.value);
  }
  if (result.minFrequency >= result.maxFrequency) {
    if (reportErrors) {
      setText("settings-error", "最低音高必须小于最高音高。请检查识别范围。");
      $("settings-error").hidden = false;
      $("mic-min-frequency").focus();
    }
    return null;
  }
  return result as unknown as MicrophoneSettings;
}
function resetPreviewFrames() {
  previewFrame = null;
  previewSamples = [];
  previewReceivedAt = 0;
  lastPreviewPaint = -Infinity;
  previewViewport.reset();
}
function receivePreviewFrame(next: PitchFrame) {
  if (!settingsDialog.open || !mic) return;
  const now = performance.now();
  advanceCalibration(now);
  if (calibrationPhase === "noise" || calibrationPhase === "voice") {
    if (!calibrationFirstFrameAt) calibrationFirstFrameAt = now;
    calibrationLastFrameAt = now;
    (calibrationPhase === "noise" ? calibrationNoise : calibrationVoice).push({
      rms: next.rms,
      clarity: next.clarity,
      frequency: next.frequency,
    });
  }
  previewFrame = next;
  previewReceivedAt = now;
  previewSamples.push({ t: previewReceivedAt, midi: next.midi });
  while (
    previewSamples.length &&
    previewSamples[0].t < previewReceivedAt - 5500
  )
    previewSamples.shift();
}
function updateMicrophonePreview() {
  if (!settingsDialog.open) return;
  const draft = readMicrophoneSettings(false);
  previewInvalid = draft === null;
  if (draft) {
    previewSettings = draft;
    // Calibration reads raw RMS independently of the current gate. The normal
    // preview still displays the draft gain; no practice settings are changed.
    const analysis = calibrationIsActive()
      ? {
          ...draft,
          inputGain: 4,
          noiseThreshold: 0.001,
          clarityThreshold: 0.6,
          updateRateHz: 30 as const,
          fftSize: 4096 as const,
        }
      : draft;
    engine.setMicrophonePreview(analysis, receivePreviewFrame);
  }
  updateCalibrationUI();
  renderMicrophonePreview(performance.now(), true);
}
function closeMicrophonePreview() {
  cancelCalibration();
  engine.clearMicrophonePreview();
  const stopOwned = previewOwnsMicrophone;
  previewOwnsMicrophone = false;
  previewInvalid = false;
  resetPreviewFrames();
  if (stopOwned) stopMic();
}
settingsDialog.addEventListener("close", closeMicrophonePreview);

function calibrationIsActive() {
  return ["connecting", "noise", "ready", "voice"].includes(calibrationPhase);
}
function updateCalibrationUI(now = performance.now()) {
  const active = calibrationIsActive();
  const measuring =
    calibrationPhase === "noise" || calibrationPhase === "voice";
  const button = $<HTMLButtonElement>("mic-calibrate-button");
  const label =
    calibrationPhase === "ready"
      ? "开始试唱"
      : calibrationPhase === "noise"
        ? "测量环境中"
        : calibrationPhase === "voice"
          ? "试唱采样中"
          : calibrationPhase === "connecting"
            ? "连接麦克风"
            : calibrationPhase === "success" || calibrationPhase === "error"
              ? "重新校准"
              : "自动校准";
  if (button.textContent !== label) {
    button.innerHTML =
      i(calibrationPhase === "ready" ? "mic" : "sparkles") + label;
    refreshIcons();
  }
  button.disabled =
    measuring || calibrationPhase === "connecting" || (micBusy && !active);
  $("mic-calibrate-cancel").hidden = !active;
  $("mic-calibrate-step").hidden = active;
  setText("mic-calibrate-status", calibrationMessage);
  $("mic-calibrate-status").classList.toggle(
    "calibration-error",
    calibrationPhase === "error",
  );
  $("mic-calibrate-detail").hidden = !calibrationDetail;
  setText("mic-calibrate-detail", calibrationDetail);
  $("mic-calibrate-timing").hidden = !measuring;
  if (measuring) {
    const duration = calibrationPhase === "noise" ? 4000 : 6000;
    const elapsed = Math.max(0, now - calibrationStartedAt);
    $<HTMLProgressElement>("mic-calibrate-progress").value = Math.min(
      100,
      (elapsed / duration) * 100,
    );
    setText(
      "mic-calibrate-countdown",
      `${Math.max(0, Math.ceil((duration - elapsed) / 1000))} 秒`,
    );
  }
  settingsDialog
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >('.settings-body input, .settings-body select, .mic-presets button, [data-action="reset-mic-settings"], [data-action="save-settings"]')
    .forEach((input) => {
      input.disabled = active;
    });
}
function resetCalibrationWindow() {
  calibrationStartedAt = performance.now();
  calibrationFirstFrameAt = calibrationLastFrameAt = 0;
}
function markCalibrationManual() {
  if (calibrationPhase === "success") {
    calibrationMessage = "当前参数已手动调整，正在实时预览。满意后保存。";
  }
}
function cancelCalibration(
  message = "先安静 4 秒，再自然试唱 6 秒。",
  cancelPending = true,
) {
  const pendingOwned =
    cancelPending &&
    calibrationPhase === "connecting" &&
    previewOwnsMicrophone &&
    micBusy;
  ++calibrationGeneration;
  calibrationPhase = "idle";
  calibrationNoise = [];
  calibrationVoice = [];
  calibrationMessage = message;
  calibrationDetail = "";
  if (pendingOwned) {
    previewOwnsMicrophone = false;
    stopMic();
  }
  if (settingsDialog.open) updateMicrophonePreview();
  else updateCalibrationUI();
}
function failCalibration(reason: string) {
  ++calibrationGeneration;
  calibrationPhase = "error";
  calibrationNoise = [];
  calibrationVoice = [];
  calibrationMessage = reason;
  calibrationDetail =
    "参数未改动。调整环境或麦克风距离后可重试，也可手动微调。";
  updateMicrophonePreview();
}
async function startCalibration() {
  if (!settingsDialog.open) return;
  if (calibrationPhase === "ready") {
    calibrationPhase = "voice";
    calibrationVoice = [];
    calibrationMessage = "用平时练习的音量，持续唱一个舒服的「啊」。";
    resetCalibrationWindow();
    updateCalibrationUI();
    return;
  }
  if (calibrationIsActive() || micBusy || !readMicrophoneSettings()) return;
  const generation = ++calibrationGeneration;
  calibrationPhase = "connecting";
  calibrationNoise = [];
  calibrationVoice = [];
  calibrationMessage = mic
    ? "准备测量环境，请保持安静。"
    : "请允许麦克风访问，连接后开始测量环境。";
  calibrationDetail = "校准只推荐灵敏度和门限；完成后可微调，保存才用于练习。";
  stopSong();
  updateMicrophonePreview();
  if (!mic) {
    previewOwnsMicrophone = true;
    await toggleMic();
  }
  if (generation !== calibrationGeneration || !settingsDialog.open) return;
  if (!mic) {
    failCalibration(micError || "无法开始收音，请检查麦克风后重试。");
    return;
  }
  calibrationPhase = "noise";
  calibrationMessage = "第一步 · 保持安静，正在测量环境噪声。";
  resetCalibrationWindow();
  updateMicrophonePreview();
}
function advanceCalibration(now: number) {
  if (calibrationPhase !== "noise" && calibrationPhase !== "voice") return;
  const duration = calibrationPhase === "noise" ? 4000 : 6000;
  if (now - calibrationStartedAt < duration) return;
  if (
    !mic ||
    !calibrationFirstFrameAt ||
    now - calibrationLastFrameAt > 500 ||
    calibrationLastFrameAt - calibrationFirstFrameAt < duration * 0.6
  ) {
    failCalibration("收音采样不连续，请保持页面在前台后重试。");
    return;
  }
  if (calibrationPhase === "noise") {
    if (calibrationNoise.length < 20) {
      failCalibration("环境采样不足，请确认麦克风正常收音后重试。");
      return;
    }
    calibrationPhase = "ready";
    calibrationMessage = "环境采样完成。准备好后，点击「开始试唱」。";
    updateCalibrationUI(now);
    return;
  }
  const result = recommendMicrophoneSettings(
    calibrationNoise,
    calibrationVoice,
  );
  calibrationNoise = [];
  calibrationVoice = [];
  if (!result.success) {
    failCalibration(result.reason);
    return;
  }
  calibrationPhase = "success";
  calibrationMessage = `推荐 ${result.settings.inputGain.toFixed(1)}× · 门限 ${result.settings.noiseThreshold.toFixed(3)}，已用于预览。`;
  calibrationDetail = `环境 ${formatAmplitude(result.noiseRms)} · 试唱 ${formatAmplitude(result.voiceRms)}。可继续手动微调，满意后保存。`;
  $<HTMLInputElement>("mic-gain").value = String(result.settings.inputGain);
  $<HTMLInputElement>("mic-gate").value = String(
    result.settings.noiseThreshold,
  );
  resetPreviewFrames();
  updateMicrophoneDescriptions();
}

function renderMicrophonePreview(now: number, force = false) {
  if (!settingsDialog.open || (!force && now - lastPreviewPaint < 50)) return;
  lastPreviewPaint = now;
  updateCalibrationUI(now);
  const fresh = mic && previewFrame !== null && now - previewReceivedAt <= 350;
  const raw =
    fresh && Number.isFinite(previewFrame!.rms)
      ? Math.max(0, previewFrame!.rms)
      : 0;
  const adjusted = raw * previewSettings.inputGain;
  const valid =
    fresh &&
    adjusted >= previewSettings.noiseThreshold &&
    previewFrame!.clarity >= previewSettings.clarityThreshold &&
    previewFrame!.midi !== null &&
    Number.isFinite(previewFrame!.midi) &&
    previewFrame!.frequency !== null &&
    Number.isFinite(previewFrame!.frequency) &&
    previewFrame!.frequency >= previewSettings.minFrequency &&
    previewFrame!.frequency <= previewSettings.maxFrequency;
  document
    .querySelector(".settings-preview")!
    .classList.toggle("is-listening", mic);
  setText(
    "mic-preview-status",
    micBusy ? "连接中" : mic ? "正在聆听" : "未开启",
  );
  const label = micBusy ? "取消连接" : mic ? "停止收音" : "开启收音";
  const button = $("mic-preview-button");
  button.setAttribute("aria-pressed", String(mic));
  if (button.textContent !== label) {
    button.innerHTML = i(mic || micBusy ? "square" : "mic") + label;
    refreshIcons();
  }
  setText("mic-preview-note", valid ? noteLabel(previewFrame!.midi!) : "—");
  setText(
    "mic-preview-frequency",
    valid
      ? `${previewFrame!.frequency!.toFixed(1)} Hz`
      : mic
        ? "等待稳定音高"
        : "等待你的声音",
  );
  const cents =
    valid &&
    previewFrame!.cents !== null &&
    Number.isFinite(previewFrame!.cents)
      ? Math.round(previewFrame!.cents)
      : null;
  setText(
    "mic-preview-cents",
    cents === null ? "— 音分" : `${cents > 0 ? "+" : ""}${cents} 音分`,
  );
  $("mic-preview-cents").classList.toggle(
    "in-tune",
    cents !== null && Math.abs(cents) <= 25,
  );
  setText("mic-preview-level", formatAmplitude(adjusted));
  setText(
    "mic-preview-raw",
    `原始 ${formatAmplitude(raw).replace(" dBFS", "")} · 门限 ${formatAmplitude(previewSettings.noiseThreshold).replace(" dBFS", "")}`,
  );
  $("mic-preview-fill").style.width = `${meterPosition(adjusted) * 100}%`;
  $("mic-preview-gate-marker").style.left =
    `${meterPosition(previewSettings.noiseThreshold) * 100}%`;
  const meter = $("mic-preview-meter");
  const db = Math.max(PREVIEW_FLOOR_DB, Math.min(0, amplitudeDb(adjusted)));
  meter.setAttribute("aria-valuenow", db.toFixed(1));
  meter.setAttribute(
    "aria-valuetext",
    `增益后 ${formatAmplitude(adjusted)}，原始 ${formatAmplitude(raw)}`,
  );
  const message = previewInvalid
    ? "参数未完整，保留上一组有效预览"
    : micBusy
      ? "等待麦克风授权，可点击取消"
      : !mic
        ? micError || "开启收音，边唱边调"
        : !fresh || raw === 0
          ? "轻声唱一个持续的音"
          : adjusted < previewSettings.noiseThreshold
            ? "低于音量门限 · 可提高灵敏度或降低门限"
            : !valid
              ? "等待稳定音高 · 检查音域与可信度"
              : "实时预览中 · 保存后用于练习";
  setText("mic-preview-message", message);
  $("mic-preview-message").classList.toggle(
    "preview-warning",
    previewInvalid || !!micError,
  );
  const rect = previewCanvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (rect.width < 1 || rect.height < 1) return;
  const w = rect.width,
    h = rect.height;
  if (
    previewCanvas.width !== Math.round(w * dpr) ||
    previewCanvas.height !== Math.round(h * dpr)
  ) {
    previewCanvas.width = Math.round(w * dpr);
    previewCanvas.height = Math.round(h * dpr);
  }
  const ctx = previewContext;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const { low, high } = previewViewport.update(
    selectPitchRange(previewSamples, { now, windowMs: 5000 }),
    now,
  );
  const left = 29,
    right = w - 8,
    top = 7,
    bottom = Math.max(8, h - 21);
  const y = (midi: number) =>
    bottom - ((midi - low) / (high - low)) * (bottom - top);
  ctx.font = "9px 'Space Grotesk', system-ui";
  const step = chooseNoteLabelStep({ low, high }, bottom - top);
  for (let midi = low; midi <= high; midi++) {
    if (((midi % step) + step) % step !== 0) continue;
    ctx.strokeStyle = "rgba(159,184,209,.12)";
    ctx.beginPath();
    ctx.moveTo(left, y(midi));
    ctx.lineTo(right, y(midi));
    ctx.stroke();
    ctx.fillStyle = "#8295b0";
    ctx.fillText(noteLabel(midi), 1, y(midi) + 3);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  ctx.clip();
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#6fe6e9";
  let pen = false;
  for (const sample of previewSamples) {
    const x = left + ((sample.t - now + 5000) / 5000) * (right - left);
    if (
      sample.midi === null ||
      !Number.isFinite(sample.midi) ||
      x < left ||
      x > right
    ) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x, y(sample.midi));
    else ctx.moveTo(x, y(sample.midi));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($("toast").hidden = true), 5000);
}
let toastTimer = 0;

function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function savePracticeHistory() {
  try {
    localStorage.setItem(
      "auralis-practice-history",
      JSON.stringify(practiceHistory),
    );
    historySaved = true;
  } catch {
    historySaved = false;
    toast("练习记录暂未保存到浏览器，请在练习记录中导出备份。");
  }
}

function renderPracticeHistory() {
  const summary = summarizePracticeHistory(practiceHistory, new Date());
  const minutes =
    summary.durationSeconds > 0 && summary.durationSeconds < 60
      ? "&lt;1"
      : Math.floor(summary.durationSeconds / 60);
  $("history-summary").innerHTML =
    `<div><strong>${summary.sessions}</strong><span>完成练习</span></div><div><strong>${minutes}</strong><span>练习分钟</span></div><div><strong>${summary.practiceDays}<small> / 7</small></strong><span>练习天数</span></div>`;
  const max = Math.max(1, ...summary.days.map((day) => day.sessions));
  $("history-week").innerHTML = summary.days
    .map(
      (day) =>
        `<div class="journal-day" aria-label="${escape(day.date)}，${day.sessions} 次练习"><span>${day.sessions || "·"}</span><div><b style="height:${day.sessions ? Math.max(8, (day.sessions / max) * 100) : 3}%" class="${day.sessions ? "has-practice" : ""}"></b></div><small>${Number(day.date.slice(-2))}日</small></div>`,
    )
    .join("");
  $("history-count").textContent = `${practiceHistory.length} / 100`;
  $("history-storage-warning").hidden = historySaved;
  $("history-list").innerHTML = practiceHistory.length
    ? practiceHistory
        .map((record) => {
          const available = [...builtinScores, ...customScores].some(
            (s) => s.id === record.scoreId && s.notes.length >= record.rangeEnd,
          );
          const date = new Date(record.completedAt).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return `<article class="journal-record"><div class="journal-record-heading"><div><h4>${escape(record.title)}</h4><time datetime="${escape(record.completedAt)}">${escape(date)}</time></div><button class="button secondary" data-action="retry-history" data-record-id="${escape(record.id)}" ${available ? "" : "disabled"}>${available ? "再练一次" : "需导入原曲谱"}</button></div><p class="journal-record-meta">${record.bpm} BPM · 第 ${record.rangeStart}–${record.rangeEnd} 音 · ${record.transpose === 0 ? "原调" : `${record.transpose > 0 ? "+" : ""}${record.transpose} 半音`}</p><dl><div><dt>音准命中</dt><dd>${record.pitchAccuracy === null ? "—" : `${record.pitchAccuracy}%`}</dd></div><div><dt>发声覆盖</dt><dd>${record.coverage}%</dd></div><div><dt>换音偏差</dt><dd>${record.rhythmOffsetMs === null ? "—" : `${record.rhythmOffsetMs} ms`}</dd></div></dl>${record.pitchAccuracy === null ? '<p class="journal-no-voice">本次未检测到有效人声，可校准收音后重试。</p>' : ""}</article>`;
        })
        .join("")
    : `<div class="journal-empty">${i("music-2")}<h3>给下一次进步，留个起点</h3><p>完成一遍曲谱或片段练习，记录就会出现在这里。示范和中途停止不会计入。</p><button class="button primary" data-action="history-start">去练一小段</button></div>`;
  document.querySelector<HTMLButtonElement>(
    '[data-action="export-history"]',
  )!.disabled = !practiceHistory.length;
  refreshIcons();
}

function updateDiagnostics() {
  const details = {
    application: `Auralis ${APP_VERSION}`,
    browser: navigator.userAgent,
    secureContext: window.isSecureContext,
    microphoneSupported: Boolean(navigator.mediaDevices?.getUserMedia),
    audioSupported: Boolean(
      window.AudioContext ||
        (window as Window & { webkitAudioContext?: unknown })
          .webkitAudioContext,
    ),
    microphoneState: mic ? "listening" : micBusy ? "connecting" : "off",
    sampleRate: engine.microphoneSampleRate,
    tuningA4: engine.a4,
    latencyMs: inputLatencyMs,
    microphoneSettings,
    version: APP_VERSION,
  };
  $<HTMLTextAreaElement>("support-diagnostics").value = JSON.stringify(
    details,
    null,
    2,
  );
}

function volume() {
  return Number($<HTMLInputElement>("volume").value) / 100;
}
function persist() {
  try {
    localStorage.setItem("shengzhun-stats", JSON.stringify(stats));
    localStorage.setItem("shengzhun-scores", JSON.stringify(customScores));
    return true;
  } catch {
    toast("浏览器存储不可用，关闭页面后曲谱可能不会保留。");
    return false;
  }
}
function localDate() {
  return new Date().toLocaleDateString("sv-SE");
}
function addTime(seconds: number) {
  if (stats.date !== localDate())
    stats = { seconds: 0, sessions: 0, best: 0, date: localDate() };
  stats.seconds += Math.max(0, seconds);
  persist();
  updateStats();
}
function updateStats() {
  setMarkup(
    "today-time",
    `${stats.date === localDate() ? Math.floor(stats.seconds / 60) : 0} <small>分钟</small>`,
  );
}
function updateTarget() {
  const label = noteLabel(target);
  $("target-note").innerHTML =
    `${escape(label.slice(0, -1))}<span>${label.slice(-1)}</span>`;
  $("target-frequency").innerHTML =
    `${midiToFrequency(target, engine.a4).toFixed(2)} <span>Hz</span>`;
  $("target-solfege").textContent =
    [
      "Do",
      "Do ♯",
      "Re",
      "Re ♯",
      "Mi",
      "Fa",
      "Fa ♯",
      "Sol",
      "Sol ♯",
      "La",
      "La ♯",
      "Si",
    ][target % 12] + (target === 60 ? " · 中央 C" : "");
  document.querySelectorAll<HTMLElement>("[data-key]").forEach((k) => {
    k.classList.toggle("selected-key", Number(k.dataset.key) === target);
    k.setAttribute("aria-pressed", String(Number(k.dataset.key) === target));
  });
}
function renderKeyboard() {
  const start = (octave + 1) * 12;
  const whites = [0, 2, 4, 5, 7, 9, 11];
  $("keyboard").innerHTML =
    Array.from({ length: 14 }, (_, n) => {
      const midi = start + Math.floor(n / 7) * 12 + whites[n % 7];
      return `<button class="white-key" data-key="${midi}" aria-label="播放 ${noteLabel(midi)}"><span>${noteLabel(midi)}</span></button>`;
    }).join("") +
    Array.from({ length: 2 }, (_, o) =>
      [1, 3, 6, 8, 10]
        .map((s, n) => {
          const positions = [1, 2, 4, 5, 6];
          const midi = start + o * 12 + s;
          return `<button class="black-key" style="left:${((o * 7 + positions[n]) / 14) * 100}%" data-key="${midi}" aria-label="播放 ${noteLabel(midi)}"><span>${noteLabel(midi)}</span></button>`;
        })
        .join(""),
    ).join("");
  $("octave-label").textContent = `C${octave} – B${octave + 1}`;
  updateTarget();
}
function setView(next: View) {
  if (view !== next && chartExpanded) setChartExpanded(false);
  if (view !== next) stopSong();
  view = next;
  document.body.dataset.mode = view;
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
  });
  const titles = {
    tuner: [
      "实时音准仪",
      "Find your <em>frequency.</em>",
      "让声音被看见，让每一次练习都有方向。",
    ],
    match: [
      "标准音模唱",
      "Feel the <em>resonance.</em>",
      "从一个标准音开始，建立耳朵与声音的默契。",
    ],
    songs: [
      "曲谱练习",
      "Follow your <em>melody.</em>",
      "放慢一点，练好一小段，再把它们连成一首歌。",
    ],
  };
  $("breadcrumb").textContent = titles[view][0];
  $("page-title").innerHTML = titles[view][1];
  $("page-subtitle").textContent = titles[view][2];
  $("monitor-title").textContent =
    view === "songs"
      ? "旋律跟唱"
      : view === "match"
        ? "目标音模唱"
        : "实时音准";
  $("keyboard-card").hidden = view === "songs";
  $("songs-card").hidden = view !== "songs";
  $("target-dock").hidden = view === "songs";
  $("song-practice-dock").hidden = view !== "songs";
  const heading = document.querySelector<HTMLElement>(".page-heading");
  if (
    heading?.animate &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  ) {
    heading.animate(
      [
        { opacity: 0.35, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 220, easing: "ease-out" },
    );
  }
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
}
async function toggleMic() {
  if (micBusy) {
    stopMic();
    return;
  }
  if (mic) {
    stopMic();
    return;
  }
  const generation = ++micGeneration;
  micError = "";
  micBusy = true;
  updateMic();
  try {
    await engine.startMicrophone(onPitch);
    if (generation !== micGeneration) return;
    mic = true;
    monitorStarted = performance.now();
    frame = null;
    samples = [];
  } catch (error) {
    if (generation === micGeneration) {
      micError =
        error instanceof Error
          ? error.message
          : "无法开启麦克风，请检查浏览器权限。";
      toast(micError);
    }
  } finally {
    if (generation === micGeneration) {
      micBusy = false;
      updateMic();
    }
  }
}
function stopMic() {
  if (calibrationIsActive()) {
    cancelCalibration("收音已停止，校准已取消。原参数保留。", false);
  }
  ++micGeneration;
  clearTimeout(loopTimer);
  loopTimer = 0;
  if (!playing) ++sessionToken;
  if (playing && practicing) stopSong();
  engine.stopMicrophone();
  if (monitorStarted) addTime((performance.now() - monitorStarted) / 1000);
  monitorStarted = 0;
  mic = micBusy = false;
  frame = null;
  samples = [];
  micError = "";
  resetPreviewFrames();
  pitchViewport.reset();
  updateMic();
}
function updateMic() {
  $("audio-error").hidden = !micError;
  $("audio-error").textContent = micError;
  $("mic-button").innerHTML =
    i(mic || micBusy ? "square" : "mic") +
    (micBusy ? "取消连接" : mic ? "停止监听" : "开启麦克风");
  $("mic-status").innerHTML =
    `<span></span>${micBusy ? "正在申请权限" : mic ? "正在聆听" : "麦克风未开启"}`;
  $("mic-status").classList.toggle("connected", mic);
  tunerCard.classList.toggle("is-listening", mic);
  $("input-state").textContent = mic ? "已连接" : "未连接";
  updateMicrophoneDescriptions();
  $("chart-empty").hidden = mic || playing;
  refreshIcons();
}
engine.onInterrupted = (error) => {
  stopSong();
  stopMic();
  micError = error.message;
  $("song-feedback").textContent =
    "音频已中断，本次未完成的练习不会计入记录。重新开启后可再练一次。";
  updateMic();
  if (settingsDialog.open) renderMicrophonePreview(performance.now(), true);
  toast(error.message);
};
let cachedScore: PracticeScore | undefined;
let cachedSelectionKey = "";
let cachedNotes: ScoreNote[] = [];
let chartReferencePitches: number[] = [];
function selectedNotes(): ScoreNote[] {
  const start = Math.max(
    0,
    Number($<HTMLInputElement>("range-start").value) - 1,
  );
  const end = Math.min(
    score.notes.length,
    Number($<HTMLInputElement>("range-end").value),
  );
  const key = `${start}:${end}:${transpose}`;
  if (cachedScore !== score || cachedSelectionKey !== key) {
    cachedScore = score;
    cachedSelectionKey = key;
    cachedNotes = score.notes.slice(start, end).map((n) => ({
      ...n,
      midi: n.midi === null ? null : n.midi + transpose,
    }));
    chartReferencePitches = cachedNotes.flatMap((n) =>
      n.midi === null ? [] : [n.midi],
    );
  }
  return cachedNotes;
}
function onPitch(next: PitchFrame) {
  frame = next;
  const now = performance.now();
  samples.push({ t: now, midi: next.midi });
  while (samples.length && samples[0].t < now - 11000) samples.shift();
  if (practicing && playing && songStart > 0) {
    const correctedTime = next.time * 1000 - inputLatencyMs;
    const elapsed = correctedTime - songStart;
    let index = practiceOnsets.length - 1;
    while (index >= 0 && practiceOnsets[index] > elapsed) index--;
    const expected = practiceNotes[index];
    if (next.midi === null) {
      if (correctedTime - lastVoiced > 180) lastMidi = null;
      lastScoreTime = correctedTime;
      return;
    }
    if (
      correctedTime - lastVoiced > 180 ||
      lastMidi === null ||
      Math.abs(next.midi - lastMidi) > 0.7
    ) {
      let nearest = -1;
      practiceOnsets.forEach((onset, n) => {
        if (
          practiceNotes[n].midi !== null &&
          (nearest < 0 ||
            Math.abs(onset - elapsed) <
              Math.abs(practiceOnsets[nearest] - elapsed))
        )
          nearest = n;
      });
      if (
        nearest >= 0 &&
        !noteEvents.some((e) => e.index === nearest) &&
        Math.abs(practiceOnsets[nearest] - elapsed) < practiceBeatMs * 0.75
      )
        noteEvents.push({
          index: nearest,
          error: Math.abs(practiceOnsets[nearest] - elapsed),
        });
    }
    const end =
      practiceOnsets.at(-1)! + practiceNotes.at(-1)!.beats * practiceBeatMs;
    if (expected && expected.midi !== null && elapsed < end) {
      const dt = lastScoreTime
        ? Math.max(0, Math.min(correctedTime - lastScoreTime, 100))
        : 16;
      pitchTotal += dt;
      if (Math.abs(next.midi - expected.midi) * 100 <= 25) pitchInTune += dt;
      pitchedMs += dt;
    }
    lastVoiced = correctedTime;
    lastMidi = next.midi;
    lastScoreTime = correctedTime;
  } else {
    lastScoreTime = now;
    if (next.midi === null && now - lastVoiced > 180) lastMidi = null;
  }
}
function renderScores() {
  $("score-select").innerHTML = [...builtinScores, ...customScores]
    .map(
      (s) =>
        `<option value="${escape(s.id)}" ${score.id === s.id ? "selected" : ""}>${escape(s.title)}</option>`,
    )
    .join("");
  renderScore();
}
function renderScore() {
  $("score-title").textContent = score.title;
  $("score-meta").textContent =
    `${score.timeSignature} · ${score.notes.length} 个音符`;
  let source = $("score-source");
  if (!source) {
    source = document.createElement("p");
    source.id = "score-source";
    source.className = "score-source";
    $("score-notes").before(source);
  }
  source.textContent = score.source || "";
  $<HTMLInputElement>("bpm").value = String(
    Math.min(220, Math.max(30, score.bpm)),
  );
  $("bpm-text").textContent = `${$<HTMLInputElement>("bpm").value} BPM`;
  $<HTMLInputElement>("range-start").value = "1";
  $<HTMLInputElement>("range-end").value = String(score.notes.length);
  $<HTMLInputElement>("range-start").max = String(score.notes.length);
  $<HTMLInputElement>("range-end").max = String(score.notes.length);
  renderNoteTokens();
}
function renderNoteTokens() {
  $("score-notes").innerHTML = score.notes
    .map(
      (n, index) =>
        `<button data-score-note="${index}" class="score-note ${n.midi === null ? "rest" : ""}" aria-label="第 ${index + 1} 个音：${n.midi === null ? "休止" : noteLabel(n.midi + transpose)}，${n.beats} 拍"><small>${index + 1}</small><strong>${n.midi === null ? "休" : noteLabel(n.midi + transpose)}</strong><span>${n.beats} 拍</span></button>`,
    )
    .join("");
}
function storeScore(next: PracticeScore) {
  stopSong();
  score = next;
  customScores = [...customScores.filter((s) => s.id !== next.id), next];
  const saved = persist();
  renderScores();
  setView("songs");
  toast(
    saved
      ? `已导入「${next.title}」，请试听并核对音符与节奏。`
      : `「${next.title}」已用于本次练习，但浏览器未能保存，请导出备份。`,
  );
}
function renderEditPage() {
  $("edit-rows").innerHTML = editDraft
    .slice(editPage * 32, (editPage + 1) * 32)
    .map(
      (note, n) =>
        `<label class="edit-row"><span>${editPage * 32 + n + 1}</span><input data-edit-pitch="${editPage * 32 + n}" aria-label="第 ${editPage * 32 + n + 1} 个音的音高" value="${note.midi === null ? "休止" : escape(noteLabel(note.midi))}"><input data-edit-beats="${editPage * 32 + n}" aria-label="第 ${editPage * 32 + n + 1} 个音的拍数" type="number" min="0.03125" max="64" step="any" value="${note.beats}"></label>`,
    )
    .join("");
  $("edit-page-label").textContent =
    `${editPage + 1} / ${Math.ceil(editDraft.length / 32)} 页`;
}
function collectEditPage(): boolean {
  for (const input of document.querySelectorAll<HTMLInputElement>(
    "[data-edit-pitch]",
  )) {
    const n = Number(input.dataset.editPitch),
      text = input.value.trim();
    if (["休止", "休", "0", "rest"].includes(text.toLowerCase())) {
      editDraft[n].midi = null;
      continue;
    }
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(text);
    if (!m) {
      toast(`第 ${n + 1} 个音请输入 C4、F#4、Bb3 或「休止」。`);
      input.focus();
      return false;
    }
    const midi =
      (Number(m[3]) + 1) * 12 +
      { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()]! +
      (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    if (midi < 0 || midi > 127) {
      toast("音高超出 MIDI 音符范围。");
      return false;
    }
    editDraft[n].midi = midi;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>(
    "[data-edit-beats]",
  )) {
    const beats = Number(input.value);
    if (!Number.isFinite(beats) || beats < 0.03125 || beats > 64) {
      toast("每个音的拍数需介于 0.03125 与 64。");
      input.focus();
      return false;
    }
    editDraft[Number(input.dataset.editBeats)].beats = beats;
  }
  return true;
}
function stopSong() {
  sessionToken++;
  clearTimeout(loopTimer);
  loopTimer = 0;
  activePractice = null;
  engine.stopPlayback();
  playing = practicing = false;
  activeIndex = -1;
  document
    .querySelectorAll(".score-note.current")
    .forEach((e) => e.classList.remove("current"));
  $("song-feedback").textContent = "已停止。调整片段或速度，再练一遍。";
  updateSongButtons();
}
function updateSongButtons() {
  $("chart-empty").hidden = mic || playing;
  $("practice-button").innerHTML =
    playing && practicing ? i("square") + "停止练习" : i("play") + "开始练习";
  $("listen-button").innerHTML =
    playing && !practicing
      ? i("square") + "停止示范"
      : i("headphones") + "听示范";
  [
    "score-select",
    "bpm",
    "range-start",
    "range-end",
    "transpose",
    "metronome",
    "guide",
  ].forEach((id) => ($<HTMLInputElement>(id).disabled = playing));
  $("reference-button").setAttribute("aria-disabled", String(playing));
  refreshIcons();
}
async function startSong(practice: boolean) {
  if (playing) {
    stopSong();
    return;
  }
  clearTimeout(loopTimer);
  loopTimer = 0;
  const rangeStart = Number($<HTMLInputElement>("range-start").value);
  const rangeEnd = Number($<HTMLInputElement>("range-end").value);
  if (
    !Number.isInteger(rangeStart) ||
    !Number.isInteger(rangeEnd) ||
    rangeStart < 1 ||
    rangeEnd < rangeStart ||
    rangeEnd > score.notes.length
  ) {
    toast(
      `片段请输入 1–${score.notes.length} 之间的完整音符序号，结束不能早于起始。`,
    );
    return;
  }
  const token = ++sessionToken;
  const requestedScore = score;
  const requestedTranspose = transpose;
  if (practice && !mic) {
    await toggleMic();
    if (
      !mic ||
      token !== sessionToken ||
      view !== "songs" ||
      document.hidden ||
      score !== requestedScore ||
      transpose !== requestedTranspose ||
      Number($<HTMLInputElement>("range-start").value) !== rangeStart ||
      Number($<HTMLInputElement>("range-end").value) !== rangeEnd
    )
      return;
  }
  const notes = selectedNotes();
  if (!notes.length) {
    toast("结束音符需要大于或等于起始音符。");
    return;
  }
  playing = true;
  practicing = practice;
  activeIndex = -1;
  songStart = 0;
  pitchTotal = pitchInTune = pitchedMs = 0;
  lastScoreTime = lastVoiced = 0;
  lastMidi = null;
  noteEvents = [];
  const bpm = Number($<HTMLInputElement>("bpm").value);
  activePractice = practice
    ? {
        title: score.title || "未命名曲谱",
        scoreId: score.id || "unknown",
        bpm,
        transpose,
        rangeStart,
        rangeEnd,
      }
    : null;
  const guide = $<HTMLInputElement>("guide").checked;
  practiceNotes = notes;
  practiceBeatMs = 60000 / bpm;
  let accumulated = 0;
  practiceOnsets = notes.map((n) => {
    const t = accumulated;
    accumulated += n.beats * practiceBeatMs;
    return t;
  });
  $("practice-result").hidden = true;
  $("song-feedback").textContent = practice
    ? "预备 4 拍，准备开始…"
    : "聆听旋律，留意音符的高低与长短。";
  updateSongButtons();
  try {
    await engine.scheduleNotes(notes, bpm, instrument, {
      countIn: practice ? 4 : 0,
      timeSignature: score.timeSignature,
      metronome: $<HTMLInputElement>("metronome").checked,
      volume: practice && !guide ? 0 : volume(),
      onTimeline: (start) => {
        if (token === sessionToken) songStart = start;
      },
      onNote: (index) => {
        if (token !== sessionToken) return;
        activeIndex = index;
        const first = Number($<HTMLInputElement>("range-start").value) - 1;
        document
          .querySelectorAll("[data-score-note]")
          .forEach((el, n) =>
            el.classList.toggle("current", n === first + index),
          );
        $("song-feedback").textContent =
          `${practice ? "跟着节拍唱" : "正在示范"} · 第 ${index + 1} / ${notes.length} 个音符`;
      },
      onComplete: () => {
        if (token !== sessionToken) return;
        const grace = practice ? inputLatencyMs : 0;
        window.setTimeout(() => {
          if (token === sessionToken) finishSong(practice, notes);
        }, grace);
      },
    });
  } catch (error) {
    if (token !== sessionToken) return;
    stopSong();
    toast(error instanceof Error ? error.message : "播放失败，请重试。");
  }
}
function finishSong(practice: boolean, notes: ScoreNote[]) {
  if (!playing) return;
  playing = practicing = false;
  activeIndex = -1;
  updateSongButtons();
  document
    .querySelectorAll(".score-note.current")
    .forEach((e) => e.classList.remove("current"));
  if (practice) {
    const pitch = pitchTotal ? Math.round((pitchInTune / pitchTotal) * 100) : 0;
    const duration =
      (notes.filter((n) => n.midi !== null).reduce((s, n) => s + n.beats, 0) *
        60000) /
      Number($<HTMLInputElement>("bpm").value);
    const coverage = duration
      ? Math.min(100, Math.round((pitchedMs / duration) * 100))
      : 0;
    const rhythm = noteEvents.length
      ? Math.round(
          noteEvents.reduce((s, e) => s + e.error, 0) / noteEvents.length,
        )
      : null;
    const evaluatedPitch = pitchTotal && coverage > 0 ? pitch : null;
    $("practice-result").hidden = false;
    $("practice-result").innerHTML =
      `<div><span>音准命中率</span><strong>${evaluatedPitch !== null ? `${evaluatedPitch}%` : "—"}</strong></div><div><span>有效发声覆盖</span><strong>${coverage}%</strong></div><div><span>换音平均偏差</span><strong>${rhythm === null ? "—" : `${rhythm}<small> ms</small>`}</strong></div><p>${evaluatedPitch !== null ? "只统计有效人声；同音连续音符的节奏检测仅作参考。" : "未检测到足够的有效人声，暂不能评估音准。请检查输入状态并佩戴耳机。"}</p>`;
    $("practice-result").insertAdjacentHTML(
      "beforeend",
      '<button class="text-button result-history" data-action="history">查看练习记录 →</button>',
    );
    if (activePractice) {
      try {
        practiceHistory = addPracticeRecord(
          practiceHistory,
          createPracticeRecord({
            ...activePractice,
            id: crypto.randomUUID(),
            completedAt: new Date().toISOString(),
            durationSeconds:
              (notes.reduce((sum, n) => sum + n.beats, 0) * 60) /
              activePractice.bpm,
            pitchAccuracy: evaluatedPitch,
            coverage,
            rhythmOffsetMs: rhythm,
          }),
        );
        savePracticeHistory();
        if ($<HTMLDialogElement>("history-dialog").open)
          renderPracticeHistory();
      } catch {
        toast("本次练习已完成，但无法生成记录；请通过使用指南反馈问题。");
      }
    }
    activePractice = null;
    stats.sessions++;
    stats.best = Math.max(stats.best, pitch);
    persist();
  }
  $("song-feedback").textContent = practice
    ? "这一遍完成了。看看反馈，再慢一点练习。"
    : "示范结束。准备好了，就开始练习。";
  if (loop) {
    const token = sessionToken;
    loopTimer = window.setTimeout(() => {
      loopTimer = 0;
      if (
        token === sessionToken &&
        !playing &&
        loop &&
        view === "songs" &&
        !document.hidden
      )
        void startSong(practice);
    }, 1000);
  }
}
async function playKey(midi: number) {
  if (playing) {
    toast("请先停止曲谱播放，再试听标准音。");
    return;
  }
  target = midi;
  updateTarget();
  try {
    await engine.playNote(midi, 1.5, instrument, volume());
  } catch (e) {
    toast(e instanceof Error ? e.message : "无法播放声音。");
  }
}

document.addEventListener("click", async (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    "button,[data-view],[data-close]",
  );
  if (!el) return;
  if (el.hasAttribute("data-close")) {
    el.closest("dialog")?.close();
    return;
  }
  if (el.dataset.view) {
    setView(el.dataset.view as View);
    return;
  }
  if (el.dataset.instrument) {
    instrument = el.dataset.instrument as Instrument;
    document.querySelectorAll<HTMLElement>("[data-instrument]").forEach((b) => {
      b.classList.toggle("selected", b === el);
      b.setAttribute("aria-pressed", String(b === el));
    });
    return;
  }
  if (el.dataset.key) {
    void playKey(Number(el.dataset.key));
    return;
  }
  if (el.dataset.scoreNote) {
    const n = score.notes[Number(el.dataset.scoreNote)];
    if (n.midi !== null) void playKey(n.midi + transpose);
    return;
  }
  switch (el.dataset.action) {
    case "expand-chart":
      setChartExpanded(!chartExpanded);
      break;
    case "mic":
      await toggleMic();
      break;
    case "reference":
      await playKey(target);
      break;
    case "target-down":
      target = Math.max(36, target - 1);
      updateTarget();
      break;
    case "target-up":
      target = Math.min(84, target + 1);
      updateTarget();
      break;
    case "octave-down":
      octave = Math.max(1, octave - 1);
      renderKeyboard();
      break;
    case "octave-up":
      octave = Math.min(5, octave + 1);
      renderKeyboard();
      break;
    case "import":
      $<HTMLDialogElement>("import-dialog").showModal();
      break;
    case "editor":
      $<HTMLDialogElement>("editor-dialog").showModal();
      break;
    case "edit-score":
      stopSong();
      editDraft = score.notes.map((n) => ({ ...n }));
      editPage = 0;
      $<HTMLInputElement>("edit-title").value = score.title;
      renderEditPage();
      $<HTMLDialogElement>("score-edit-dialog").showModal();
      break;
    case "edit-prev":
      if (collectEditPage()) {
        editPage = Math.max(0, editPage - 1);
        renderEditPage();
      }
      break;
    case "edit-next":
      if (collectEditPage()) {
        editPage = Math.min(Math.ceil(editDraft.length / 32) - 1, editPage + 1);
        renderEditPage();
      }
      break;
    case "save-score-edit":
      if (collectEditPage()) {
        storeScore({
          ...score,
          id: `edited-${Date.now()}`,
          title: $<HTMLInputElement>("edit-title").value.trim() || score.title,
          notes: editDraft.map((n) => ({ ...n })),
          source: `${score.source || "曲谱"} · 已手动校对`,
          bpm: Number($<HTMLInputElement>("bpm").value),
        });
        $<HTMLDialogElement>("score-edit-dialog").close();
      }
      break;
    case "settings":
      cancelCalibration();
      previewOwnsMicrophone = false;
      previewSettings = { ...microphoneSettings };
      previewInvalid = false;
      resetPreviewFrames();
      fillMicrophoneSettings(microphoneSettings);
      $<HTMLInputElement>("tuning").value = String(engine.a4);
      $<HTMLInputElement>("latency").value = String(inputLatencyMs);
      settingsDialog.showModal();
      updateMicrophonePreview();
      break;
    case "preview-mic":
      previewOwnsMicrophone = !(mic || micBusy);
      await toggleMic();
      renderMicrophonePreview(performance.now(), true);
      break;
    case "calibrate-mic":
      await startCalibration();
      break;
    case "cancel-calibration":
      cancelCalibration("校准已取消，原参数保留。可手动微调或重新校准。");
      break;
    case "reset-mic-settings":
      markCalibrationManual();
      fillMicrophoneSettings({ ...DEFAULT_MICROPHONE_SETTINGS });
      break;
    case "mic-preset": {
      const presets: Record<string, Partial<MicrophoneSettings>> = {
        soft: { inputGain: 2, noiseThreshold: 0.004, clarityThreshold: 0.87 },
        balanced: {
          inputGain: 1,
          noiseThreshold: 0.008,
          clarityThreshold: 0.87,
        },
        noisy: { inputGain: 1, noiseThreshold: 0.02, clarityThreshold: 0.93 },
      };
      const preset = presets[el.dataset.preset ?? ""];
      if (preset) {
        markCalibrationManual();
        for (const [key, value] of Object.entries(preset)) {
          $<HTMLInputElement>(
            microphoneFields[key as keyof MicrophoneSettings],
          ).value = String(value);
        }
        updateMicrophoneDescriptions();
      }
      break;
    }
    case "help":
      updateDiagnostics();
      $<HTMLDialogElement>("help-dialog").showModal();
      break;
    case "copy-diagnostics":
      try {
        await navigator.clipboard.writeText(
          $<HTMLTextAreaElement>("support-diagnostics").value,
        );
        toast("诊断信息已复制，你可以检查后附在问题反馈中。");
      } catch {
        $<HTMLTextAreaElement>("support-diagnostics").select();
        toast("浏览器未允许自动复制，已选中诊断信息，请手动复制。");
      }
      break;
    case "history":
      renderPracticeHistory();
      $<HTMLDialogElement>("history-dialog").showModal();
      break;
    case "history-start":
      $<HTMLDialogElement>("history-dialog").close();
      setView("songs");
      $("practice-button").focus();
      break;
    case "retry-history": {
      const record = practiceHistory.find(
        (item) => item.id === el.dataset.recordId,
      );
      const previousScore = [...builtinScores, ...customScores].find(
        (item) => item.id === record?.scoreId,
      );
      if (
        !record ||
        !previousScore ||
        previousScore.notes.length < record.rangeEnd
      ) {
        toast("请先导入这条记录对应的原曲谱，再重新选择片段。");
        break;
      }
      stopSong();
      score = previousScore;
      transpose = record.transpose;
      $<HTMLSelectElement>("transpose").value = String(transpose);
      renderScores();
      $<HTMLInputElement>("bpm").value = String(record.bpm);
      $("bpm-text").textContent = `${record.bpm} BPM`;
      $<HTMLInputElement>("range-start").value = String(record.rangeStart);
      $<HTMLInputElement>("range-end").value = String(record.rangeEnd);
      $<HTMLDialogElement>("history-dialog").close();
      setView("songs");
      $("practice-result").hidden = true;
      $("song-feedback").textContent =
        "已载入上次的速度、移调与片段。准备好后点击开始练习。";
      $("practice-button").focus();
      break;
    }
    case "export-history":
      downloadJson(
        exportPracticeHistory(practiceHistory),
        `auralis-practice-${localDate()}.json`,
      );
      $("history-message").textContent =
        "已发起下载：备份包含记录，不包含曲谱与收音设置。";
      break;
    case "import-history":
      $<HTMLInputElement>("history-file").click();
      break;
    case "save-editor":
      try {
        storeScore(
          parseJianpu(
            $<HTMLTextAreaElement>("editor-text").value,
            $<HTMLInputElement>("editor-title").value || "我的旋律",
          ),
        );
        $<HTMLDialogElement>("editor-dialog").close();
      } catch (e) {
        toast((e as Error).message);
      }
      break;
    case "save-ocr":
      try {
        storeScore(
          parseJianpu(
            $<HTMLTextAreaElement>("ocr-text").value,
            pendingImportTitle,
          ),
        );
        $<HTMLDialogElement>("import-dialog").close();
      } catch (e) {
        toast((e as Error).message);
      }
      break;
    case "save-settings": {
      if (calibrationIsActive()) break;
      const a4 = Number($<HTMLInputElement>("tuning").value),
        latency = Number($<HTMLInputElement>("latency").value);
      if (
        a4 < 430 ||
        a4 > 450 ||
        !Number.isFinite(a4) ||
        latency < 0 ||
        latency > 500 ||
        !Number.isFinite(latency) ||
        !$<HTMLInputElement>("latency").value.trim()
      ) {
        setText(
          "settings-error",
          "A4 请输入 430–450 Hz，延迟请输入 0–500 毫秒。",
        );
        $("settings-error").hidden = false;
        break;
      }
      const nextMicrophone = readMicrophoneSettings();
      if (!nextMicrophone) break;
      const interruptedPractice = playing && practicing;
      if (interruptedPractice) stopSong();
      microphoneSettings = engine.configureMicrophone(nextMicrophone);
      engine.a4 = a4;
      inputLatencyMs = latency;
      $("a4-display").textContent = String(a4);
      updateTarget();
      let saved = true;
      try {
        localStorage.setItem(
          "shengzhun-settings",
          JSON.stringify({ a4, latency, microphone: microphoneSettings }),
        );
      } catch {
        saved = false;
      }
      $<HTMLDialogElement>("settings-dialog").close();
      toast(
        (saved
          ? mic
            ? "练习设置已保存，收音参数已用于当前监听。"
            : "练习设置已保存。"
          : "设置已用于本次练习，但浏览器未能保存，关闭后可能丢失。") +
          (interruptedPractice ? "评分参数已改变，请重新开始练习。" : ""),
      );
      break;
    }
    case "listen":
      await startSong(false);
      break;
    case "practice":
      await startSong(true);
      break;
    case "loop":
      loop = !loop;
      if (!loop) {
        clearTimeout(loopTimer);
        loopTimer = 0;
      }
      el.classList.toggle("selected", loop);
      el.setAttribute("aria-pressed", String(loop));
      break;
    case "export": {
      const blob = new Blob(
        [
          JSON.stringify(
            { ...score, bpm: Number($<HTMLInputElement>("bpm").value) },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${score.title}.json`;
      a.click();
      URL.revokeObjectURL(url);
      break;
    }
  }
});
let pendingImportTitle = "导入的曲谱";
$("history-file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("history-file");
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 512 * 1024)
      throw new Error("记录备份应小于 512 KB，请选择 Auralis 导出的记录文件。");
    const imported = importPracticeHistory(await file.text());
    // Existing IDs win: importing the same backup cannot duplicate or rewrite history.
    const existingIds = new Set(practiceHistory.map((record) => record.id));
    const additions = imported.filter((record) => !existingIds.has(record.id));
    for (const record of additions)
      practiceHistory = addPracticeRecord(practiceHistory, record);
    savePracticeHistory();
    renderPracticeHistory();
    $("history-message").textContent =
      `已合并 ${additions.length} 条新记录，保留最近 100 次。${historySaved ? "" : "请导出备份，当前浏览器未能保存。"}`;
  } catch (error) {
    $("history-message").textContent =
      error instanceof Error ? error.message : "无法导入练习记录。";
  } finally {
    input.value = "";
  }
});
$("import-kind").addEventListener("change", () => {
  $("omr-field").hidden = $<HTMLSelectElement>("import-kind").value !== "staff";
});
$("score-file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("score-file");
  const file = input.files?.[0];
  if (!file) return;
  const kind = $<HTMLSelectElement>("import-kind").value;
  const endpoint = $<HTMLInputElement>("omr-endpoint").value.trim();
  if (kind === "staff" && !endpoint) {
    toast("请填写已运行的五线谱识别服务地址。");
    input.value = "";
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast("曲谱文件不能超过 20 MB。");
    input.value = "";
    return;
  }
  input.disabled = true;
  $("ocr-review").hidden = true;
  $("import-progress").textContent = "正在读取曲谱…";
  pendingImportTitle = file.name.replace(/\.[^.]+$/, "");
  try {
    const next = await importScore(
      file,
      (msg) => ($("import-progress").textContent = msg),
      kind === "staff" ? endpoint : undefined,
    );
    const ocrText = (next as PracticeScore & { ocrText?: string }).ocrText;
    if (ocrText) {
      $<HTMLTextAreaElement>("ocr-text").value = ocrText;
      $("ocr-review").hidden = false;
      $("import-progress").textContent = "已生成识别草稿，请对照原谱校对。";
    } else {
      storeScore(next);
      $<HTMLDialogElement>("import-dialog").close();
      $("import-progress").textContent = "";
    }
  } catch (e) {
    $("import-progress").textContent =
      e instanceof Error ? e.message : "识别失败，请尝试 MusicXML 或手动编谱。";
  } finally {
    input.value = "";
    input.disabled = false;
  }
});
$("score-select").addEventListener("change", () => {
  score =
    [...builtinScores, ...customScores].find(
      (s) => s.id === $<HTMLSelectElement>("score-select").value,
    ) || builtinScores[0];
  renderScore();
});
$("bpm").addEventListener("input", () => {
  $("bpm-text").textContent = `${$<HTMLInputElement>("bpm").value} BPM`;
});
$("transpose").addEventListener("change", () => {
  transpose = Number($<HTMLSelectElement>("transpose").value);
  renderNoteTokens();
});
$("volume").addEventListener("input", () => {
  $("volume-text").textContent = $<HTMLInputElement>("volume").value + "%";
});
for (const id of Object.values(microphoneFields)) {
  const onInput = () => {
    markCalibrationManual();
    updateMicrophoneDescriptions();
  };
  $(id).addEventListener("input", onInput);
  $(id).addEventListener("change", onInput);
}
$("mic-range-preset").addEventListener("change", () => {
  const range =
    frequencyPresets[$<HTMLSelectElement>("mic-range-preset").value];
  if (!range) return;
  markCalibrationManual();
  $<HTMLInputElement>("mic-min-frequency").value = String(range[0]);
  $<HTMLInputElement>("mic-max-frequency").value = String(range[1]);
  updateMicrophoneDescriptions();
});
document.addEventListener("keydown", (event) => {
  if (
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.querySelector("dialog[open]") ||
    (event.target as HTMLElement).matches("input,textarea,select,button")
  )
    return;
  const n = "asdfghjk".indexOf(event.key.toLowerCase());
  if (n >= 0) {
    event.preventDefault();
    void playKey((octave + 1) * 12 + [0, 2, 4, 5, 7, 9, 11, 12][n]);
  }
});
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        (e as MouseEvent).clientX < r.left ||
        (e as MouseEvent).clientX > r.right ||
        (e as MouseEvent).clientY < r.top ||
        (e as MouseEvent).clientY > r.bottom
      )
        d.close();
    }
  }),
);
window.addEventListener("hashchange", () => {
  const hash = location.hash.slice(1);
  if (["tuner", "match", "songs"].includes(hash)) setView(hash as View);
});
window.addEventListener("pagehide", (event) => {
  stopSong();
  stopMic();
  if (!event.persisted) void engine.close();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSong();
    if (mic || micBusy) stopMic();
  }
});
try {
  const settings = JSON.parse(
    localStorage.getItem("shengzhun-settings") || "null",
  );
  if (
    settings &&
    Number.isFinite(settings.a4) &&
    settings.a4 >= 430 &&
    settings.a4 <= 450
  ) {
    engine.a4 = settings.a4;
    $<HTMLInputElement>("tuning").value = String(settings.a4);
    $("a4-display").textContent = String(settings.a4);
    inputLatencyMs = Number.isFinite(settings.latency)
      ? Math.max(0, Math.min(500, settings.latency))
      : 100;
    $<HTMLInputElement>("latency").value = String(inputLatencyMs);
  }
  microphoneSettings = normalizeMicrophoneSettings(settings?.microphone);
} catch {}
engine.configureMicrophone(microphoneSettings);
fillMicrophoneSettings(microphoneSettings);

const canvas = $<HTMLCanvasElement>("pitch-canvas");
const ctx = canvas.getContext("2d")!;
const editButton = document.createElement("button");
editButton.className = "text-button";
editButton.dataset.action = "edit-score";
editButton.textContent = "校对音符";
$("songs-card").querySelector(".card-header")!.append(editButton);
const editDialog = document.createElement("dialog");
editDialog.id = "score-edit-dialog";
editDialog.setAttribute("aria-labelledby", "score-edit-dialog-title");
editDialog.innerHTML = `<div class="dialog-head"><h2 id="score-edit-dialog-title">逐音校对曲谱</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><label class="field">曲谱名称<input id="edit-title" maxlength="120"></label><p>对照原谱修改音高和拍数。四分音符为 1 拍，八分音符为 0.5 拍；休止输入「休止」。</p><div class="edit-row edit-row-heading"><span>序号</span><span>音高（如 C4、F#4）</span><span>拍数</span></div><div id="edit-rows"></div><div class="edit-pagination"><button class="button secondary" data-action="edit-prev">上一页</button><span id="edit-page-label"></span><button class="button secondary" data-action="edit-next">下一页</button></div><button class="button primary" data-action="save-score-edit">${i("check")}保存校对后的曲谱</button>`;
document.body.append(editDialog);
let lastUI = 0;
function draw(now: number) {
  if (settingsDialog.open) {
    advanceCalibration(now);
    renderMicrophonePreview(now);
    requestAnimationFrame(draw);
    return;
  }
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(rect.width * dpr) ||
    canvas.height !== Math.round(rect.height * dpr)
  ) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const w = rect.width,
    h = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  let center = target;
  if (view === "tuner" && mic && frame?.midi != null)
    center = Math.round(frame.midi);
  if (view === "songs") {
    selectedNotes();
    if (playing && activeIndex >= 0)
      center = practiceNotes[activeIndex]?.midi ?? target;
  }
  const desiredRange = selectPitchRange(samples, {
    now,
    target: view === "match" ? target : undefined,
    referencePitches: view === "songs" ? chartReferencePitches : undefined,
  });
  const { low, high } = pitchViewport.update(desiredRange, now);
  const top = 20,
    bottom = h - 34,
    left = 53,
    right = w - 24;
  const plotHeight = Math.max(1, bottom - top);
  const y = (m: number) => bottom - ((m - low) / (high - low)) * plotHeight;
  const labelStep = chooseNoteLabelStep({ low, high }, plotHeight);
  ctx.font = "11px 'Space Grotesk', system-ui";
  ctx.lineWidth = 1;
  for (let m = low; m <= high; m++) {
    const yy = y(m);
    ctx.strokeStyle =
      m % 12 === 0 ? "rgba(159,184,209,.16)" : "rgba(159,184,209,.065)";
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    if (((m % labelStep) + labelStep) % labelStep === 0) {
      ctx.fillStyle = m % 12 === 0 ? "#bac8de" : "#7c8ca7";
      ctx.fillText(noteLabel(m), 10, yy + 4);
    }
  }
  for (let t = 0; t <= 10; t += 2) {
    const x = left + (t / 10) * (right - left);
    ctx.strokeStyle = "rgba(159,184,209,.075)";
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillStyle = "#8290a9";
    ctx.fillText(
      t === 10 ? "现在" : `−${10 - t}s`,
      x - (t === 10 ? 18 : 7),
      h - 11,
    );
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, Math.max(0, right - left), plotHeight);
  ctx.clip();
  if (center >= low && center <= high) {
    ctx.fillStyle = "rgba(167,146,255,.065)";
    ctx.fillRect(
      left,
      y(center + 0.25),
      right - left,
      y(center - 0.25) - y(center + 0.25),
    );
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(178,161,255,.58)";
    ctx.beginPath();
    ctx.moveTo(left, y(center));
    ctx.lineTo(right, y(center));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (playing && view === "songs" && songStart > 0) {
    const elapsed = now - songStart;
    let a = 0,
      b = practiceOnsets.length;
    while (a < b) {
      const middle = (a + b) >>> 1;
      if (practiceOnsets[middle] < elapsed - 10000) a = middle + 1;
      else b = middle;
    }
    for (
      let index = Math.max(0, a - 1);
      index < practiceNotes.length;
      index++
    ) {
      const n = practiceNotes[index];
      const start = songStart + practiceOnsets[index];
      if (start > now) break;
      const end = start + n.beats * practiceBeatMs;
      const x1 = left + ((start - now + 10000) / 10000) * (right - left),
        x2 = left + ((end - now + 10000) / 10000) * (right - left);
      if (n.midi !== null && x2 >= left && x1 <= right) {
        ctx.fillStyle = "rgba(167,146,255,.28)";
        ctx.fillRect(
          Math.max(left, x1),
          y(n.midi) - 5,
          Math.max(0, Math.min(right, x2) - Math.max(left, x1) - 2),
          10,
        );
      }
    }
  }
  ctx.strokeStyle = "#6fe6e9";
  ctx.lineWidth = 2.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let pen = false;
  for (const s of samples) {
    const x = left + ((s.t - now + 10000) / 10000) * (right - left);
    if (s.midi === null || !Number.isFinite(s.midi) || x < left || x > right) {
      pen = false;
      continue;
    }
    if (!pen) ctx.moveTo(x, y(s.midi));
    else ctx.lineTo(x, y(s.midi));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
  if (now - lastUI > 100) {
    lastUI = now;
    setText("chart-range", `自适应音域 ${noteLabel(low)} – ${noteLabel(high)}`);
    setText(
      "chart-reference-label",
      view === "tuner" ? "最近标准音" : "目标音",
    );
    const valid = mic && frame?.midi !== null && frame?.frequency;
    const note = valid ? noteLabel(frame!.midi!) : "—";
    setText("live-note", note);
    setText(
      "live-hz",
      valid
        ? `${frame!.frequency!.toFixed(1)} Hz`
        : mic
          ? "轻声唱一个音"
          : "等待你的声音",
    );
    const cents = valid
      ? view === "tuner"
        ? frame!.cents!
        : (frame!.midi! - center) * 100
      : null;
    setMarkup(
      "live-cents",
      cents === null
        ? "— <small>音分</small>"
        : `${cents > 0 ? "+" : ""}${Math.round(cents)} <small>音分</small>`,
    );
    const tune = $("tuning-status");
    setText(
      "tuning-status",
      cents === null
        ? mic
          ? "正在聆听你的声音"
          : "准备好，就唱出一个音"
        : Math.abs(cents) <= 25
          ? "音很准，保持住"
          : cents < 0
            ? "稍低一点，试着向上"
            : "稍高一点，试着向下",
    );
    tune.classList.toggle("in-tune", cents !== null && Math.abs(cents) <= 25);
    const level = mic && frame ? Math.min(1, frame.rms * 9) : 0;
    $("input-meter")
      .querySelectorAll("span")
      .forEach((s, n) => s.classList.toggle("lit", n < level * 32));
    setText(
      "input-tip",
      !mic
        ? "开启麦克风后，观察声音的输入强度。"
        : level < 0.025
          ? "声音较轻，靠近麦克风，自然发声。"
          : level > 0.9
            ? "声音较响，稍微离麦克风远一点。"
            : "输入正常，保持自然、稳定地发声。",
    );
    if (mic && monitorStarted)
      setMarkup(
        "today-time",
        `${Math.floor(((stats.date === localDate() ? stats.seconds : 0) + (now - monitorStarted) / 1000) / 60)} <small>分钟</small>`,
      );
  }
  requestAnimationFrame(draw);
}
renderKeyboard();
renderScores();
updateStats();
refreshIcons();
setView(
  ["match", "songs"].includes(location.hash.slice(1))
    ? (location.hash.slice(1) as View)
    : "tuner",
);
requestAnimationFrame(draw);
