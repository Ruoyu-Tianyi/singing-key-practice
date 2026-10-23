import "./style.css";
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
} from "lucide";
import {
  AudioEngine,
  midiToFrequency,
  noteLabel,
  type PitchFrame,
  type Instrument,
} from "./audio";
import {
  builtinScores,
  importScore,
  parseJianpu,
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
try {
  const saved = JSON.parse(localStorage.getItem("shengzhun-stats") || "null");
  if (saved && Number.isFinite(saved.seconds)) stats = saved;
  const savedScores = JSON.parse(
    localStorage.getItem("shengzhun-scores") || "[]",
  );
  if (Array.isArray(savedScores))
    customScores = savedScores.filter(
      (s) => Array.isArray(s.notes) && s.notes.length < 10000,
    );
} catch {
  /* storage can be unavailable in private mode */
}
let score = builtinScores[0];
let editDraft: ScoreNote[] = [],
  editPage = 0;
const app = $("app");
app.innerHTML = `
<aside class="sidebar">
  <a class="brand" href="#tuner" aria-label="声准 首页"><span class="brand-mark">${i("audio-lines")}</span><span>声准<small>SHENGZHUN</small></span></a>
  <div class="nav-label">我的练习室</div>
  <nav aria-label="练习模式">
    <button class="nav-item active" data-view="tuner">${i("audio-lines")}<span>实时音准仪</span><span class="nav-dot"></span></button>
    <button class="nav-item" data-view="match">${i("piano")}<span>标准音模唱</span></button>
    <button class="nav-item" data-view="songs">${i("book-open")}<span>曲谱练习</span><span class="badge-small">NEW</span></button>
  </nav>
  <div class="sidebar-note"><span class="tiny-spark">✳</span><strong>每一个音，都更靠近一点。</strong><p>听见、唱出、看见。<br>让练习成为一件轻松的小事。</p><div class="mini-wave"><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div></div>
  <div class="sidebar-bottom"><button data-action="settings">${i("settings-2")}<span>练习设置</span></button><button data-action="help">${i("circle-help")}<span>使用指南</span>${i("arrow-up-right")}</button><div class="open-source">开源、免费，为热爱歌唱的你 <span>♡</span></div></div>
</aside>
<main>
  <header class="topbar"><span>练习室 <span class="slash">/</span> <span id="breadcrumb">实时音准仪</span></span><span class="privacy">${i("shield-check")}声音仅在你的设备上处理</span><button class="help-icon" data-action="settings" aria-label="练习设置">${i("settings-2")}</button><button class="help-icon" data-action="help" aria-label="使用指南">${i("circle-help")}</button></header>
  <div class="page">
    <div class="page-heading"><div><div class="eyebrow">A LITTLE PRACTICE, A LITTLE CLOSER.</div><h1 id="page-title">找到你的每一个音<span>。</span></h1><p id="page-subtitle">让声音被看见，让每一次练习都有方向。</p></div><button class="button secondary import-top" data-action="import">${i("upload")}导入曲谱</button></div>
    <div class="workspace">
      <div class="main-column">
        <section class="card tuner-card" aria-label="实时音高监测">
          <div class="card-header"><h2>${i("audio-lines")}<span id="monitor-title">实时音准</span></h2><span class="status" id="mic-status"><span></span>麦克风未开启</span></div>
          <div class="pitch-readout"><div class="current-pitch"><span id="live-note">—</span><span class="pitch-hz" id="live-hz">等待你的声音</span></div><div class="tuning-readout"><span id="tuning-status">准备好，就唱出一个音</span><strong id="live-cents">— <small>音分</small></strong></div></div>
          <div class="pitch-chart"><canvas id="pitch-canvas" role="img" aria-label="最近十秒的演唱音高曲线，纵轴为音名，横轴为时间"></canvas><div class="chart-empty" id="chart-empty"><span class="empty-mic">${i("mic")}</span><strong>在这里，听见自己的进步</strong><span>开启麦克风，轻轻唱一个「啊」</span></div><div class="chart-legend"><span class="legend-target"></span>目标音 <span class="legend-live"></span>你的声音<span class="chart-window">最近 10 秒</span></div></div>
          <div class="tuner-bottom"><span>${i("headphones")}建议佩戴耳机，识别更准确</span><button class="button primary" id="mic-button" data-action="mic">${i("mic")}开启麦克风</button></div>
        </section>
        <section class="card keyboard-card" id="keyboard-card"><div class="card-header"><h2>${i("piano")}听一个标准音</h2><div class="octave-switch"><button data-action="octave-down" aria-label="降低键盘八度">${i("minus")}</button><span id="octave-label">C3 – B4</span><button data-action="octave-up" aria-label="升高键盘八度">${i("plus")}</button></div></div><div class="keyboard-wrap"><div id="keyboard" class="keyboard" aria-label="标准音键盘"></div></div><div class="keyboard-footer"><span>点击琴键听音，再试着唱出来</span><span>电脑快捷键 <kbd>A</kbd> – <kbd>K</kbd></span></div></section>
        <section class="card songs-card" id="songs-card" hidden><div class="card-header"><h2>${i("book-open")}我的曲谱</h2><button class="text-button" data-action="editor">手动编谱 ${i("plus")}</button></div><div class="score-controls"><label>选择曲谱<select id="score-select"></select></label><label>速度 <span id="bpm-text">80 BPM</span><input id="bpm" type="range" min="30" max="220" value="80"></label></div><div class="score-meta"><strong id="score-title"></strong><span id="score-meta"></span><button class="text-button" data-action="export" aria-label="导出当前曲谱">${i("download")}导出</button></div><div id="score-notes" class="score-notes" aria-label="曲谱音符，点击可试听"></div><div class="range-controls"><label>起始音符<input id="range-start" type="number" min="1" value="1"></label><span>至</span><label>结束音符<input id="range-end" type="number" min="1" value="1"></label><label>移调<select id="transpose">${Array.from({ length: 25 }, (_, n) => `<option value="${n - 12}" ${n === 12 ? "selected" : ""}>${n === 12 ? "原调" : `${n > 12 ? "+" : ""}${n - 12} 半音`}</option>`).join("")}</select></label></div><div class="song-actions"><label class="check-label"><input id="metronome" type="checkbox" checked>节拍器</label><label class="check-label"><input id="guide" type="checkbox">跟唱提示音</label><button class="icon-button" data-action="loop" id="loop-button" aria-label="循环练习" aria-pressed="false">${i("repeat-2")}</button><button class="button secondary" data-action="listen" id="listen-button">${i("headphones")}听示范</button><button class="button primary" data-action="practice" id="practice-button">${i("play")}开始练习</button></div><p id="song-feedback" class="song-feedback" role="status">先听一遍旋律，再跟着节拍唱。练习前有 4 拍预备。</p><div id="practice-result" class="practice-result" hidden></div></section>
        <div class="bottom-tip">${i("sparkles")}<span id="bottom-tip">小提示：不用唱得很响亮。自然、稳定的声音，是最好的开始。</span></div>
      </div>
      <aside class="right-column">
        <section class="card reference-card"><div class="card-header"><h2>${i("music-2")}目标音</h2><span class="tag">标准音高</span></div><div class="target-selector"><button class="round-button" data-action="target-down" aria-label="降低目标音">${i("minus")}</button><div><strong id="target-note">C<span>4</span></strong><span id="target-solfege">Do · 中央 C</span></div><button class="round-button" data-action="target-up" aria-label="升高目标音">${i("plus")}</button></div><p class="target-frequency" id="target-frequency">261.63 <span>Hz</span></p><div class="timbre-label">参考音色</div><div class="segmented"><button class="selected" data-instrument="piano" aria-pressed="true">${i("piano")}钢琴</button><button data-instrument="accordion" aria-pressed="false">${i("music-2")}手风琴</button></div><button class="button play-reference" id="reference-button" data-action="reference">${i("volume-2")}播放标准音</button><label class="volume-control">${i("volume-2")}<input id="volume" type="range" min="0" max="100" value="55" aria-label="播放音量"><span id="volume-text">55%</span></label><div class="tuning-reference">十二平均律 <span>·</span> A4 = <span id="a4-display">440</span> Hz</div></section>
        <section class="card input-card"><div class="card-header"><h2>输入状态</h2><span id="input-state">未连接</span></div><div class="meter" id="input-meter">${Array.from({ length: 32 }, () => "<span></span>").join("")}</div><div class="meter-labels"><span>安静</span><span>适中</span><span>响亮</span></div><p id="input-tip">开启麦克风后，观察声音的输入强度。</p></section>
        <section class="practice-guide"><div class="guide-icon">${i("headphones")}</div><h3>给自己 5 分钟</h3><p>从一个舒服的音开始，<br>听一听，唱一唱，再靠近一点。</p><div class="guide-steps"><span><b>1</b>播放标准音，仔细聆听</span><span><b>2</b>用「啊」或「呜」轻声模唱</span><span><b>3</b>观察曲线，慢慢调整音高</span></div><div class="practice-stat"><span>今日已练习</span><strong id="today-time">0 <small>分钟</small></strong></div></section>
      </aside>
    </div>
    <footer><span>声准 <span class="footer-dot">·</span> 每一次发声，都是新的开始。</span><span>为你的声音，留一点时间 <span class="footer-heart">♡</span></span></footer>
  </div>
</main>
<div id="toast" class="toast" role="status" hidden></div>
<dialog id="import-dialog"><div class="dialog-head"><div><span class="eyebrow">YOUR MUSIC, YOUR PACE</span><h2>把想唱的歌，带进练习室</h2></div><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><p>MusicXML / MIDI 可直接导入。图片与 PDF 的识别结果需要校对。</p><label class="field">曲谱类型<select id="import-kind"><option value="digital">MusicXML / MIDI / JSON</option><option value="jianpu">图片 / PDF 简谱（本地文字识别）</option><option value="staff">图片 / PDF 五线谱（Audiveris 服务）</option></select></label><label class="field" id="omr-field" hidden>五线谱识别服务地址<input id="omr-endpoint" type="url" placeholder="http://127.0.0.1:8765/api/recognize"><small>需自行运行附带的本地服务；曲谱只发送到此地址。</small></label><label class="upload-zone" for="score-file">${i("upload")}<strong>点击选择你的曲谱</strong><span>MusicXML、MXL、MIDI、JSON、PNG、JPG、PDF · 最大 20 MB</span><input id="score-file" type="file" accept=".xml,.musicxml,.mxl,.mid,.midi,.json,.png,.jpg,.jpeg,.webp,.pdf" hidden></label><p id="import-progress" class="import-progress" role="status"></p><div id="ocr-review" hidden><div class="notice">简谱识别无法可靠保留上下标、八度和时值。请对照原谱修正，再保存。</div><label class="field">识别文字<textarea id="ocr-text" rows="5"></textarea></label><button class="button primary" data-action="save-ocr">校对完成，导入曲谱</button></div><div class="dialog-foot">只有你主动选择五线谱服务时，曲谱才会离开此设备。首次简谱识别需联网下载识别模型。</div></dialog>
<dialog id="editor-dialog"><div class="dialog-head"><h2>写一段自己的旋律</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><label class="field">曲谱名称<input id="editor-title" value="我的旋律" maxlength="100"></label><label class="field">简谱<textarea id="editor-text" rows="5" spellcheck="false">1 1 5 5 | 6 6 5- | 4 4 3 3 | 2 2 1-</textarea></label><p class="notation-help">以 C 大调为基准：1–7 为音符，0 为休止；<code>1'</code> 高八度，<code>1,</code> 低八度；<code>1-</code> 两拍，<code>1_</code> 半拍，<code>1__</code> 四分之一拍；可用 #、b 升降音。请用空格分隔音符。</p><button class="button primary" data-action="save-editor">${i("check")}保存到我的曲谱</button></dialog>
<dialog id="settings-dialog"><div class="dialog-head"><h2>让练习更适合你</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><label class="field">标准音 A4（Hz）<input id="tuning" type="number" min="430" max="450" step="1" value="440"><small>默认 440 Hz。调节后，识别与参考音会一起更新。</small></label><label class="field">跟唱延迟校正（毫秒）<input id="latency" type="number" min="0" max="500" step="10" value="100"><small>用于补偿设备输入延迟，只影响曲谱练习的对齐与评分。</small></label><div class="notice">手机和平板请通过 HTTPS 访问。局域网 HTTP 地址通常不能使用麦克风；本机 localhost 可以。</div><button class="button primary" data-action="save-settings">保存设置</button></dialog>
<dialog id="help-dialog"><div class="dialog-head"><h2>从第一个音开始</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><div class="help-content"><h3>实时音准仪</h3><p>开启麦克风并允许浏览器录音。音名和曲线显示当前音高，音分表示距离最近标准音的偏差。绿色表示误差在 ±25 音分以内；音量太低、噪声或多人合唱会降低准确度。</p><h3>标准音模唱</h3><p>点击琴键或播放目标音，再用自然的声音模唱。「标准音模唱」模式会把偏差对准你选的目标音。钢琴与手风琴采用本地合成音色。</p><h3>曲谱练习</h3><p>选一首曲谱、调整速度与片段。先听示范，再开始练习。4 拍预备后跟着音符唱，默认不播放旋律，避免扬声器串音。音准命中率按有效发声采样计算，覆盖率表示目标发声时长中检测到有效声音的比例；节奏参考首次发声及换音时间，连续同音无法可靠区分。</p><h3>图片和 PDF</h3><p>简谱使用文字 OCR，必须校对八度和时值。五线谱需要附带的 Audiveris 服务，识别后也需要核对；复杂多声部只取选定主旋律，不支持完整乐队总谱。更准确的方式是从制谱软件导出 MusicXML。</p><h3>数据与隐私</h3><p>麦克风声音不上传、不录制。自定义曲谱和今日练习时长保存在当前浏览器中；没有账号与跨设备同步。电脑、平板、手机均可通过同一 HTTPS 网址访问。</p></div></dialog>`;

function refreshIcons() {
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.7 } });
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($("toast").hidden = true), 5000);
}
let toastTimer = 0;
function volume() {
  return Number($<HTMLInputElement>("volume").value) / 100;
}
function persist() {
  try {
    localStorage.setItem("shengzhun-stats", JSON.stringify(stats));
    localStorage.setItem("shengzhun-scores", JSON.stringify(customScores));
  } catch {
    toast("浏览器存储不可用，关闭页面后曲谱可能不会保留。");
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
  $("today-time").innerHTML =
    `${stats.date === localDate() ? Math.floor(stats.seconds / 60) : 0} <small>分钟</small>`;
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
  if (view !== next) stopSong();
  view = next;
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
  });
  const titles = {
    tuner: [
      "实时音准仪",
      "找到你的每一个音",
      "让声音被看见，让每一次练习都有方向。",
    ],
    match: [
      "标准音模唱",
      "先听见，再唱准",
      "从一个标准音开始，建立耳朵与声音的默契。",
    ],
    songs: [
      "曲谱练习",
      "把喜欢的旋律，慢慢唱准",
      "放慢一点，练好一小段，再把它们连成一首歌。",
    ],
  };
  $("breadcrumb").textContent = titles[view][0];
  $("page-title").innerHTML = titles[view][1] + "<span>。</span>";
  $("page-subtitle").textContent = titles[view][2];
  $("monitor-title").textContent =
    view === "songs"
      ? "旋律跟唱"
      : view === "match"
        ? "目标音模唱"
        : "实时音准";
  $("keyboard-card").hidden = view === "songs";
  $("songs-card").hidden = view !== "songs";
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
    if (generation === micGeneration)
      toast(
        error instanceof Error
          ? error.message
          : "无法开启麦克风，请检查浏览器权限。",
      );
  } finally {
    if (generation === micGeneration) {
      micBusy = false;
      updateMic();
    }
  }
}
function stopMic() {
  ++micGeneration;
  if (playing && practicing) stopSong();
  engine.stopMicrophone();
  if (monitorStarted) addTime((performance.now() - monitorStarted) / 1000);
  monitorStarted = 0;
  mic = micBusy = false;
  frame = null;
  samples = [];
  updateMic();
}
function updateMic() {
  $("mic-button").innerHTML =
    i(mic || micBusy ? "square" : "mic") +
    (micBusy ? "取消连接" : mic ? "停止监听" : "开启麦克风");
  $("mic-status").innerHTML =
    `<span></span>${micBusy ? "正在申请权限" : mic ? "正在聆听" : "麦克风未开启"}`;
  $("mic-status").classList.toggle("connected", mic);
  $("input-state").textContent = mic ? "已连接" : "未连接";
  $("chart-empty").hidden = mic;
  refreshIcons();
}
function selectedNotes(): ScoreNote[] {
  const start = Math.max(
    0,
    Number($<HTMLInputElement>("range-start").value) - 1,
  );
  const end = Math.min(
    score.notes.length,
    Number($<HTMLInputElement>("range-end").value),
  );
  return score.notes
    .slice(start, end)
    .map((n) => ({ ...n, midi: n.midi === null ? null : n.midi + transpose }));
}
function onPitch(next: PitchFrame) {
  frame = next;
  const now = performance.now();
  samples.push({ t: now, midi: next.midi });
  while (samples.length && samples[0].t < now - 11000) samples.shift();
  if (practicing && playing && songStart > 0) {
    const correctedTime =
      next.time * 1000 - Number($<HTMLInputElement>("latency").value);
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
  persist();
  renderScores();
  setView("songs");
  toast(`已导入「${next.title}」，请试听并核对音符与节奏。`);
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
  const token = ++sessionToken;
  if (practice && !mic) {
    await toggleMic();
    if (!mic || token !== sessionToken || view !== "songs" || document.hidden)
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
        const grace = practice
          ? Number($<HTMLInputElement>("latency").value)
          : 0;
        window.setTimeout(() => {
          if (token === sessionToken) finishSong(practice, notes);
        }, grace);
      },
    });
  } catch (error) {
    stopSong();
    toast(error instanceof Error ? error.message : "播放失败，请重试。");
  }
}
function finishSong(practice: boolean, notes: ScoreNote[]) {
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
    $("practice-result").hidden = false;
    $("practice-result").innerHTML =
      `<div><span>音准命中率</span><strong>${pitchTotal ? `${pitch}%` : "—"}</strong></div><div><span>有效发声覆盖</span><strong>${coverage}%</strong></div><div><span>换音平均偏差</span><strong>${rhythm === null ? "—" : `${rhythm}<small> ms</small>`}</strong></div><p>${pitchTotal ? "只统计有效人声；同音连续音符的节奏检测仅作参考。" : "未检测到有效人声，暂不能评估音准。请检查输入状态并佩戴耳机。"}</p>`;
    stats.sessions++;
    stats.best = Math.max(stats.best, pitch);
    persist();
  }
  $("song-feedback").textContent = practice
    ? "这一遍完成了。看看反馈，再慢一点练习。"
    : "示范结束。准备好了，就开始练习。";
  if (loop) {
    const token = sessionToken;
    window.setTimeout(() => {
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
      $<HTMLDialogElement>("settings-dialog").showModal();
      break;
    case "help":
      $<HTMLDialogElement>("help-dialog").showModal();
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
      const a4 = Number($<HTMLInputElement>("tuning").value),
        latency = Number($<HTMLInputElement>("latency").value);
      if (
        a4 < 430 ||
        a4 > 450 ||
        !Number.isFinite(a4) ||
        latency < 0 ||
        latency > 500 ||
        !Number.isFinite(latency)
      ) {
        toast("A4 请输入 430–450 Hz，延迟请输入 0–500 毫秒。");
        break;
      }
      engine.a4 = a4;
      $("a4-display").textContent = String(a4);
      updateTarget();
      try {
        localStorage.setItem(
          "shengzhun-settings",
          JSON.stringify({ a4, latency }),
        );
      } catch {}
      $<HTMLDialogElement>("settings-dialog").close();
      toast("练习设置已保存。");
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
  if (settings && settings.a4 >= 430 && settings.a4 <= 450) {
    engine.a4 = settings.a4;
    $<HTMLInputElement>("tuning").value = String(settings.a4);
    $("a4-display").textContent = String(settings.a4);
    $<HTMLInputElement>("latency").value = String(
      Math.max(0, Math.min(500, Number(settings.latency) || 0)),
    );
  }
} catch {}

const canvas = $<HTMLCanvasElement>("pitch-canvas");
const ctx = canvas.getContext("2d")!;
const editButton = document.createElement("button");
editButton.className = "text-button";
editButton.dataset.action = "edit-score";
editButton.textContent = "校对音符";
$("songs-card").querySelector(".card-header")!.append(editButton);
const editDialog = document.createElement("dialog");
editDialog.id = "score-edit-dialog";
editDialog.innerHTML = `<div class="dialog-head"><h2>逐音校对曲谱</h2><button class="icon-button" data-close aria-label="关闭">${i("x")}</button></div><label class="field">曲谱名称<input id="edit-title" maxlength="120"></label><p>对照原谱修改音高和拍数。四分音符为 1 拍，八分音符为 0.5 拍；休止输入「休止」。</p><div class="edit-row edit-row-heading"><span>序号</span><span>音高（如 C4、F#4）</span><span>拍数</span></div><div id="edit-rows"></div><div class="edit-pagination"><button class="button secondary" data-action="edit-prev">上一页</button><span id="edit-page-label"></span><button class="button secondary" data-action="edit-next">下一页</button></div><button class="button primary" data-action="save-score-edit">${i("check")}保存校对后的曲谱</button>`;
document.body.append(editDialog);
let lastUI = 0;
function draw(now: number) {
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
  if (view === "songs" && playing && activeIndex >= 0) {
    center = selectedNotes()[activeIndex]?.midi ?? target;
  }
  const rangePitch =
    view === "tuner" && mic && frame?.midi != null ? frame.midi : center;
  const low = Math.floor(rangePitch / 12) * 12 - 12,
    high = low + 36;
  const y = (m: number) => h - 35 - ((m - low) / (high - low)) * (h - 55);
  const left = 45,
    right = w - 16;
  ctx.font = "10px system-ui";
  ctx.lineWidth = 1;
  for (let m = low; m <= high; m++) {
    const yy = y(m);
    ctx.strokeStyle = m % 12 === 0 ? "#dce0e9" : "#eff0f5";
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    if ([0, 4, 7].includes(((m % 12) + 12) % 12)) {
      ctx.fillStyle = m % 12 === 0 ? "#66637e" : "#858397";
      ctx.fillText(noteLabel(m), 12, yy + 3);
    }
  }
  for (let t = 0; t <= 10; t += 2) {
    const x = left + (t / 10) * (right - left);
    ctx.strokeStyle = "#f0f1f6";
    ctx.beginPath();
    ctx.moveTo(x, 15);
    ctx.lineTo(x, h - 28);
    ctx.stroke();
    ctx.fillStyle = "#aaabba";
    ctx.fillText(t === 10 ? "现在" : `−${10 - t}s`, x - 7, h - 12);
  }
  ctx.fillStyle = "#8d7de411";
  ctx.fillRect(
    left,
    y(center + 0.25),
    right - left,
    y(center - 0.25) - y(center + 0.25),
  );
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#a695df";
  ctx.beginPath();
  ctx.moveTo(left, y(center));
  ctx.lineTo(right, y(center));
  ctx.stroke();
  ctx.setLineDash([]);
  if (playing && view === "songs") {
    const notes = selectedNotes(),
      bpm = Number($<HTMLInputElement>("bpm").value);
    let offset = 0;
    for (const n of notes) {
      const start = songStart + (offset * 60000) / bpm;
      offset += n.beats;
      const end = songStart + (offset * 60000) / bpm;
      const x1 = left + ((start - now + 10000) / 10000) * (right - left),
        x2 = left + ((end - now + 10000) / 10000) * (right - left);
      if (n.midi !== null && x2 >= left && x1 <= right) {
        ctx.fillStyle = "#b9abe84a";
        ctx.fillRect(
          Math.max(left, x1),
          y(n.midi) - 5,
          Math.max(0, Math.min(right, x2) - Math.max(left, x1) - 2),
          10,
        );
      }
    }
  }
  ctx.strokeStyle = "#7460d4";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let pen = false;
  for (const s of samples) {
    const x = left + ((s.t - now + 10000) / 10000) * (right - left);
    if (s.midi === null || s.midi < low || s.midi > high || x < left) {
      pen = false;
      continue;
    }
    if (!pen) ctx.moveTo(x, y(s.midi));
    else ctx.lineTo(x, y(s.midi));
    pen = true;
  }
  ctx.stroke();
  if (now - lastUI > 100) {
    lastUI = now;
    const valid = mic && frame?.midi !== null && frame?.frequency;
    const note = valid ? noteLabel(frame!.midi!) : "—";
    $("live-note").textContent = note;
    $("live-hz").textContent = valid
      ? `${frame!.frequency!.toFixed(1)} Hz`
      : mic
        ? "轻声唱一个音"
        : "等待你的声音";
    const cents = valid
      ? view === "tuner"
        ? frame!.cents!
        : (frame!.midi! - center) * 100
      : null;
    $("live-cents").innerHTML =
      cents === null
        ? "— <small>音分</small>"
        : `${cents > 0 ? "+" : ""}${Math.round(cents)} <small>音分</small>`;
    const tune = $("tuning-status");
    tune.textContent =
      cents === null
        ? mic
          ? "正在聆听你的声音"
          : "准备好，就唱出一个音"
        : Math.abs(cents) <= 25
          ? "音很准，保持住"
          : cents < 0
            ? "稍低一点，试着向上"
            : "稍高一点，试着向下";
    tune.classList.toggle("in-tune", cents !== null && Math.abs(cents) <= 25);
    const level = mic && frame ? Math.min(1, frame.rms * 9) : 0;
    $("input-meter")
      .querySelectorAll("span")
      .forEach((s, n) => s.classList.toggle("lit", n < level * 32));
    $("input-tip").textContent = !mic
      ? "开启麦克风后，观察声音的输入强度。"
      : level < 0.025
        ? "声音较轻，靠近麦克风，自然发声。"
        : level > 0.9
          ? "声音较响，稍微离麦克风远一点。"
          : "输入正常，保持自然、稳定地发声。";
    if (mic && monitorStarted)
      $("today-time").innerHTML =
        `${Math.floor(((stats.date === localDate() ? stats.seconds : 0) + (now - monitorStarted) / 1000) / 60)} <small>分钟</small>`;
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
