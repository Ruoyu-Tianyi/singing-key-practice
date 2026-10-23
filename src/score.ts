/** Score beats always mean quarter-note beats; pitches are sounding MIDI notes. */
export interface ScoreNote {
  midi: number | null;
  beats: number;
  lyric?: string;
}
export interface PracticeScore {
  id: string;
  title: string;
  bpm: number;
  timeSignature: string;
  notes: ScoreNote[];
  source?: string;
  /** Raw numbered-notation OCR suggestion. Always review before practising. */
  ocrText?: string;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_NOTES = 10000;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const degree = [0, 0, 2, 4, 5, 7, 9, 11];
const id = () =>
  `score-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
const cleanTitle = (value: string) =>
  value.replace(/\.[^.]+$/, "").slice(0, 120) || "导入曲谱";

export function parseJianpu(
  text: string,
  title = "我的简谱",
  bpm = 80,
): PracticeScore {
  const notes: ScoreNote[] = [];
  let tonic = 60;
  let timeSignature = "4/4";
  let parsedBpm = bpm;
  const key = text.match(/(?:^|\s)1\s*=\s*([A-Ga-g])([#♯b♭]?)/m);
  if (key) {
    tonic += (
      { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>
    )[key[1].toUpperCase()];
    tonic += ["#", "♯"].includes(key[2])
      ? 1
      : ["b", "♭"].includes(key[2])
        ? -1
        : 0;
  }
  const tempo = text.match(/(?:bpm|tempo|速度|♩)\s*[:=]?\s*(\d{2,3})/i);
  if (tempo) parsedBpm = Number(tempo[1]);
  const meter = text.match(/\b(\d{1,2})\s*\/\s*(2|4|8|16)\b/);
  if (meter) timeSignature = `${meter[1]}/${meter[2]}`;

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?:\/\/|;).*/, "").trim();
    if (
      !line ||
      /^(?:19|20)\d{2}$/.test(line) ||
      /^(?:title|标题|曲名|作词|作曲|歌词|bpm|tempo|速度)\s*[:=：]/i.test(line)
    )
      continue;
    line = line
      .replace(/1\s*=\s*[A-Ga-g][#♯b♭]?/g, "")
      .replace(/\b\d{1,2}\s*\/\s*(?:2|4|8|16)\b/g, "")
      .replace(/(?:bpm|tempo|速度|♩)\s*[:=]?\s*\d{2,3}/gi, "")
      .replace(/[♯]/g, "#")
      .replace(/[♭]/g, "b")
      .replace(/[’′]/g, "'");
    // A whole line must be notation. This prevents years, page numbers and prose
    // containing incidental digits from silently becoming melody notes.
    if (!line.trim() || /[^0-7#b',._\-\s|()[\]:]/.test(line)) continue;
    if (!/[0-7]/.test(line) && !/^\s*-+(?:\s*\|\s*)?$/.test(line)) continue;
    const tokens = line.match(/[#b]?[0-7][',]*_{0,2}-*\.?|-+/g) ?? [];
    for (const token of tokens) {
      if (/^-+$/.test(token)) {
        if (notes.length) notes[notes.length - 1].beats += token.length;
        continue;
      }
      const match = token.match(/^([#b]?)([0-7])([',]*)(_*)(-*)(\.?)$/)!;
      const [, accidental, number, octave, subdivision, extension, dotted] =
        match;
      const octaveShift = [...octave].reduce(
        (sum, c) => sum + (c === "'" ? 12 : -12),
        0,
      );
      const midi =
        number === "0"
          ? null
          : tonic +
            degree[Number(number)] +
            octaveShift +
            (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
      const beats =
        (subdivision.length === 2 ? 0.25 : subdivision.length === 1 ? 0.5 : 1) *
          (dotted ? 1.5 : 1) +
        extension.length;
      notes.push({ midi, beats });
      if (notes.length > MAX_NOTES)
        throw new Error("曲谱音符太多，请分段导入（最多 10,000 个）。");
    }
  }
  if (!notes.length)
    throw new Error(
      "没有识别到简谱音符。请使用 1–7、0（休止）、单引号（高八度）、逗号（低八度）、_（半拍）和 -（延长一拍）。",
    );
  return validateScore({
    id: id(),
    title,
    bpm: parsedBpm,
    timeSignature,
    notes,
    source: "手动简谱 · 默认中央 C 为 1，可使用 1=D 指定调号",
  });
}

export const builtinScores: PracticeScore[] = [
  {
    ...parseJianpu(
      "1 1 5 5 | 6 6 5- | 4 4 3 3 | 2 2 1- |\n5 5 4 4 | 3 3 2- | 5 5 4 4 | 3 3 2- |\n1 1 5 5 | 6 6 5- | 4 4 3 3 | 2 2 1-",
      "小星星",
      84,
    ),
    id: "twinkle",
    source: "公版旋律 · Ah! vous dirai-je, maman（18 世纪）",
  },
  {
    ...parseJianpu(
      "3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3. 2_ 2- |\n3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1_ 1- |\n2 2 3 1 | 2 3_ 4_ 3 1 | 2 3_ 4_ 3 2 | 1 2 5,- |\n3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1_ 1-",
      "欢乐颂",
      96,
    ),
    id: "ode",
    source: "公版旋律 · 贝多芬《第九交响曲》主题（1824）",
  },
  {
    ...parseJianpu(
      "1 2 3 4 | 5 6 7 1' | 1' 7 6 5 | 4 3 2 1-",
      "C 大调音阶",
      80,
    ),
    id: "scale",
    source: "C 大调上行 / 下行音阶",
  },
];

export function validateScore(value: unknown): PracticeScore {
  if (!value || typeof value !== "object")
    throw new Error("曲谱数据格式不正确。");
  const data = value as Partial<PracticeScore>;
  if (
    !Array.isArray(data.notes) ||
    !data.notes.length ||
    data.notes.length > MAX_NOTES
  )
    throw new Error("曲谱应包含 1–10,000 个音符。");
  const notes = data.notes.map((note): ScoreNote => {
    if (
      !note ||
      typeof note !== "object" ||
      (note.midi !== null &&
        (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127)) ||
      !Number.isFinite(note.beats) ||
      note.beats <= 0 ||
      note.beats > 256
    )
      throw new Error("音符的音高或时值不正确。");
    return {
      midi: note.midi,
      beats: note.beats,
      ...(typeof note.lyric === "string"
        ? { lyric: note.lyric.slice(0, 80) }
        : {}),
    };
  });
  const parsedBpm = data.bpm ?? 80;
  if (!Number.isFinite(parsedBpm) || parsedBpm < 20 || parsedBpm > 300)
    throw new Error("速度应在 20–300 BPM 之间。");
  const timeSignature = data.timeSignature ?? "4/4";
  if (!/^\d{1,2}\/(?:2|4|8|16)$/.test(timeSignature))
    throw new Error("拍号格式不正确，例如 4/4 或 6/8。");
  return {
    id: typeof data.id === "string" ? data.id.slice(0, 100) : id(),
    title:
      typeof data.title === "string" ? data.title.slice(0, 120) : "导入曲谱",
    bpm: parsedBpm,
    timeSignature,
    notes,
    ...(typeof data.source === "string"
      ? { source: data.source.slice(0, 500) }
      : {}),
    ...(typeof data.ocrText === "string"
      ? { ocrText: data.ocrText.slice(0, 100000) }
      : {}),
  };
}

function xmlDocument(xml: string): Document {
  if (xml.length > MAX_XML_BYTES)
    throw new Error("解压后的曲谱过大，请分段导入。");
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml))
    throw new Error("不支持包含自定义实体的 XML。");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror"))
    throw new Error("MusicXML 格式有误，无法读取。");
  return document;
}
const child = (el: Element, tag: string) =>
  [...el.children].find((node) => node.localName === tag);
const txt = (el: Element | undefined, tag: string) =>
  el ? child(el, tag)?.textContent?.trim() : undefined;
const numeric = (value: string | undefined, fallback: number) =>
  value === undefined ? fallback : Number(value);

/** Import first pitched part and its first voice, avoiding accompaniment chords. */
export function parseMusicXml(
  xml: string,
  fallbackTitle = "导入曲谱",
): PracticeScore {
  const document = xmlDocument(xml);
  if (document.documentElement.localName !== "score-partwise")
    throw new Error(
      "目前支持 score-partwise MusicXML，请在制谱软件中另存为此格式。",
    );
  const parts = [...document.documentElement.children].filter(
    (el) => el.localName === "part",
  );
  const part = parts.find((item) =>
    [...item.getElementsByTagName("note")].some((note) => child(note, "pitch")),
  );
  if (!part) throw new Error("此 MusicXML 没有可练习的旋律音符。");
  const firstPitched = [...part.getElementsByTagName("note")].find((note) =>
    child(note, "pitch"),
  )!;
  const selectedVoice = txt(firstPitched, "voice") ?? "1";
  const selectedStaff = txt(firstPitched, "staff") ?? "1";
  const notes: ScoreNote[] = [];
  let divisions = 1,
    measureStart = 0,
    melodyEnd = 0,
    bpm = 80,
    timeSignature = "4/4",
    transpose = 0;
  let tieOpen = false;
  const warnings = new Set<string>();
  for (const measure of [...part.children].filter(
    (el) => el.localName === "measure",
  )) {
    let cursor = measureStart,
      maxCursor = measureStart,
      previousOnset = measureStart;
    const events: {
      at: number;
      note: ScoreNote;
      tieStart: boolean;
      tieStop: boolean;
    }[] = [];
    for (const el of [...measure.children]) {
      if (el.localName === "attributes") {
        divisions = numeric(txt(el, "divisions"), divisions);
        if (!Number.isFinite(divisions) || divisions <= 0)
          throw new Error("MusicXML 的 divisions 时值无效。");
        const time = child(el, "time");
        if (time && txt(time, "beats") && txt(time, "beat-type"))
          timeSignature = `${txt(time, "beats")}/${txt(time, "beat-type")}`;
        const trans = child(el, "transpose");
        if (trans)
          transpose =
            numeric(txt(trans, "chromatic"), 0) +
            numeric(txt(trans, "octave-change"), 0) * 12;
      } else if (el.localName === "direction") {
        const sound = el.querySelector("sound[tempo]");
        const tempo = Number(sound?.getAttribute("tempo"));
        if (tempo > 0 && measureStart === 0) bpm = tempo;
        else if (tempo > 0 && Math.abs(tempo - bpm) > 0.1)
          warnings.add("含速度变化；练习使用统一速度");
        if (!sound && measureStart === 0) {
          const perMinute = el.querySelector(
            "metronome > per-minute",
          )?.textContent;
          const unit = el.querySelector("metronome > beat-unit")?.textContent;
          const unitBeats: Record<string, number> = {
            whole: 4,
            half: 2,
            quarter: 1,
            eighth: 0.5,
          };
          if (perMinute)
            bpm =
              Number(perMinute) *
              (unitBeats[unit ?? "quarter"] ?? 1) *
              (el.querySelector("beat-unit-dot") ? 1.5 : 1);
        }
      } else if (el.localName === "backup" || el.localName === "forward") {
        cursor +=
          (numeric(txt(el, "duration"), 0) / divisions) *
          (el.localName === "backup" ? -1 : 1);
        maxCursor = Math.max(maxCursor, cursor);
      } else if (el.localName === "note") {
        if (child(el, "grace")) {
          warnings.add("已略过装饰音");
          continue;
        }
        const duration = numeric(txt(el, "duration"), 0) / divisions;
        if (!Number.isFinite(duration) || duration <= 0 || duration > 256)
          continue;
        const chord = !!child(el, "chord");
        const at = chord ? previousOnset : cursor;
        if (!chord) {
          previousOnset = cursor;
          cursor += duration;
          maxCursor = Math.max(maxCursor, cursor);
        }
        if (
          chord ||
          (txt(el, "voice") ?? "1") !== selectedVoice ||
          (txt(el, "staff") ?? "1") !== selectedStaff
        )
          continue;
        const pitch = child(el, "pitch");
        let midi: number | null = null;
        if (pitch) {
          const semitones: Record<string, number> = {
            C: 0,
            D: 2,
            E: 4,
            F: 5,
            G: 7,
            A: 9,
            B: 11,
          };
          midi =
            (numeric(txt(pitch, "octave"), 4) + 1) * 12 +
            (semitones[txt(pitch, "step") ?? ""] ?? NaN) +
            numeric(txt(pitch, "alter"), 0) +
            transpose;
        } else if (!child(el, "rest")) continue;
        const lyric =
          el.querySelector("lyric > text")?.textContent ?? undefined;
        const ties = [...el.children].filter(
          (item) => item.localName === "tie",
        );
        events.push({
          at,
          note: { midi, beats: duration, ...(lyric ? { lyric } : {}) },
          tieStart: ties.some((item) => item.getAttribute("type") === "start"),
          tieStop: ties.some((item) => item.getAttribute("type") === "stop"),
        });
      }
    }
    for (const event of events.sort((a, b) => a.at - b.at)) {
      if (event.at > melodyEnd + 0.0001) {
        notes.push({ midi: null, beats: event.at - melodyEnd });
        tieOpen = false;
      }
      if (event.at < melodyEnd - 0.0001) {
        warnings.add("重叠声部已简化为单旋律");
        continue;
      }
      const last = notes.at(-1);
      if (tieOpen && event.tieStop && last?.midi === event.note.midi)
        last.beats += event.note.beats;
      else notes.push(event.note);
      tieOpen = event.tieStart;
      melodyEnd = event.at + event.note.beats;
      if (notes.length > MAX_NOTES)
        throw new Error("曲谱音符太多，请分段导入。");
    }
    measureStart = Math.max(maxCursor, melodyEnd);
  }
  if (part.querySelector("repeat, ending"))
    warnings.add("反复记号按谱面顺序单次读取");
  const title =
    document.querySelector("work-title")?.textContent ||
    document.querySelector("movement-title")?.textContent ||
    fallbackTitle;
  return validateScore({
    id: id(),
    title,
    bpm,
    timeSignature,
    notes,
    source: `MusicXML · 首个旋律声部 / voice ${selectedVoice}${warnings.size ? `；${[...warnings].join("；")}` : ""}`,
  });
}

async function extractMxl(data: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files);
  if (entries.length > 250) throw new Error("压缩曲谱包含过多文件。");
  const safeRead = async (entry: (typeof entries)[number]) => {
    // JSZip exposes uncompressed size before decompression. Check both sides.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (size && size > MAX_XML_BYTES) throw new Error("解压后的曲谱过大。");
    const result = await entry.async("string");
    if (result.length > MAX_XML_BYTES) throw new Error("解压后的曲谱过大。");
    return result;
  };
  let rootPath: string | null = null;
  const container = zip.file("META-INF/container.xml");
  if (container)
    rootPath =
      xmlDocument(await safeRead(container))
        .querySelector("rootfile")
        ?.getAttribute("full-path") ?? null;
  if (
    rootPath?.includes("..") ||
    rootPath?.startsWith("/") ||
    rootPath?.includes("\\")
  )
    throw new Error("MXL 曲谱路径不安全。");
  const entry = rootPath
    ? zip.file(rootPath)
    : entries.find(
        (item) =>
          !item.dir &&
          !item.name.startsWith("META-INF/") &&
          /\.(musicxml|xml)$/i.test(item.name),
      );
  if (!entry) throw new Error("MXL 中没有找到 MusicXML 曲谱。");
  return safeRead(entry);
}

async function parseMidi(
  data: ArrayBuffer,
  title: string,
): Promise<PracticeScore> {
  const { Midi } = await import("@tonejs/midi");
  const midi = new Midi(data);
  const track = midi.tracks.find(
    (item) => item.notes.length && !item.instrument.percussion,
  );
  if (!track) throw new Error("MIDI 中没有旋律轨道。");
  const ppq = midi.header.ppq;
  const notes: ScoreNote[] = [];
  let end = 0,
    simplified = false;
  // Highest note wins when notes start together. Other simultaneous parts are skipped.
  for (const note of [...track.notes].sort(
    (a, b) => a.ticks - b.ticks || b.midi - a.midi,
  )) {
    const at = note.ticks / ppq;
    const beats = note.durationTicks / ppq;
    if (at < end - 0.0001) {
      simplified = true;
      continue;
    }
    if (beats <= 0) continue;
    if (at > end + 0.0001) notes.push({ midi: null, beats: at - end });
    notes.push({ midi: note.midi, beats });
    end = at + beats;
    if (notes.length > MAX_NOTES) throw new Error("MIDI 太长，请分段导入。");
  }
  const signature = midi.header.timeSignatures[0]?.timeSignature;
  return validateScore({
    id: id(),
    title: midi.name || track.name || title,
    bpm: midi.header.tempos[0]?.bpm ?? 80,
    timeSignature: signature ? signature.join("/") : "4/4",
    notes,
    source: `MIDI · 首个非打击乐轨道${simplified ? "；和弦 / 重叠音已简化" : ""}${midi.header.tempos.length > 1 ? "；速度变化按首个速度练习" : ""}`,
  });
}

async function ocrNumberedScore(
  file: File,
  onProgress: (message: string) => void,
): Promise<PracticeScore> {
  onProgress("正在加载本地文字识别引擎（首次使用需要下载识别资源）…");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text")
        onProgress(`正在识别简谱文字… ${Math.round(message.progress * 100)}%`);
    },
  });
  let text = "",
    confidence = 0,
    pages = 0;
  try {
    // Do not whitelist digits: doing so can turn lyrics and headings into false notes.
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const pdfjs = await import("pdfjs-dist");
      const { default: workerSrc } = await import(
        "pdfjs-dist/build/pdf.worker.min.mjs?url"
      );
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      try {
        if (pdf.numPages > 10)
          throw new Error("本地 OCR 每次最多识别 10 页，请先拆分 PDF。");
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          onProgress(`正在读取 PDF 第 ${pageNumber} / ${pdf.numPages} 页…`);
          const page = await pdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(2, 2400 / Math.max(base.width, base.height)),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("此浏览器无法读取 PDF 图片。");
          await page.render({ canvas, canvasContext: context, viewport })
            .promise;
          const result = await worker.recognize(canvas);
          text += `${result.data.text}\n`;
          confidence += result.data.confidence;
          pages++;
          canvas.width = 1;
          canvas.height = 1;
          page.cleanup();
        }
      } finally {
        await pdf.destroy();
      }
    } else {
      const url = URL.createObjectURL(file);
      try {
        const result = await worker.recognize(url);
        text = result.data.text;
        confidence = result.data.confidence;
        pages = 1;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } finally {
    await worker.terminate();
  }
  const score = parseJianpu(text, cleanTitle(file.name));
  return {
    ...score,
    ocrText: text,
    source: `待校对 · 图片 / PDF 简谱 OCR（文字置信度约 ${Math.round(confidence / Math.max(1, pages))}%）；上下八度点、减时线和节奏可能遗漏，须编辑确认。五线谱请使用 Audiveris 或导入 MusicXML。`,
  };
}

export async function importScore(
  file: File,
  onProgress: (message: string) => void = () => {},
  omrEndpoint?: string,
): Promise<PracticeScore> {
  if (!file.size) throw new Error("文件为空，请重新选择。");
  if (file.size > MAX_BYTES)
    throw new Error("文件超过 20 MB，请压缩或分段导入。");
  const title = cleanTitle(file.name);
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  onProgress("正在读取曲谱…");
  if (extension === "json") return validateScore(JSON.parse(await file.text()));
  if (extension === "txt") return parseJianpu(await file.text(), title);
  if (extension === "xml" || extension === "musicxml")
    return parseMusicXml(await file.text(), title);
  if (extension === "mxl")
    return parseMusicXml(await extractMxl(await file.arrayBuffer()), title);
  if (extension === "mid" || extension === "midi")
    return parseMidi(await file.arrayBuffer(), title);
  if (
    ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "pdf"].includes(
      extension ?? "",
    ) ||
    file.type.startsWith("image/") ||
    file.type === "application/pdf"
  ) {
    if (omrEndpoint) {
      const endpoint = new URL(omrEndpoint);
      if (!["http:", "https:"].includes(endpoint.protocol))
        throw new Error("OMR 服务地址应使用 http 或 https。");
      onProgress("正在通过 Audiveris 识别五线谱，复杂曲谱可能需要几分钟…");
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(190000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`五线谱识别失败（${response.status}）：${detail}`);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_XML_BYTES)
        throw new Error("OMR 返回的曲谱过大。");
      const isZip =
        new Uint8Array(bytes)[0] === 0x50 && new Uint8Array(bytes)[1] === 0x4b;
      const score = parseMusicXml(
        isZip ? await extractMxl(bytes) : new TextDecoder().decode(bytes),
        title,
      );
      return {
        ...score,
        source: `${score.source}；Audiveris 自动识别结果，须对照原谱校对`,
      };
    }
    try {
      return await ocrNumberedScore(file, onProgress);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "文字识别失败。"} 图片和 PDF 的五线谱需要配置本地 Audiveris 服务，或先转换为 MusicXML；简谱也可手动粘贴并校对。`,
      );
    }
  }
  throw new Error(
    "暂不支持此文件。请选择 MusicXML、MXL、MIDI、JSON、简谱文本、图片或 PDF。",
  );
}

/** Convert a score back to editable C-based numbered notation without losing rhythm. */
export function scoreToJianpu(score: PracticeScore): string {
  const names = [
    "1",
    "#1",
    "2",
    "#2",
    "3",
    "4",
    "#4",
    "5",
    "#5",
    "6",
    "#6",
    "7",
  ];
  return score.notes
    .map((note) => {
      const pitch =
        note.midi === null
          ? "0"
          : names[((note.midi % 12) + 12) % 12] +
            (note.midi >= 72
              ? "'".repeat(Math.floor((note.midi - 60) / 12))
              : note.midi < 60
                ? ",".repeat(Math.ceil((60 - note.midi) / 12))
                : "");
      if (note.beats === 0.25) return `${pitch}__`;
      if (note.beats === 0.5) return `${pitch}_`;
      if (note.beats === 0.75) return `${pitch}_.`;
      if (note.beats === 1.5) return `${pitch}.`;
      if (Number.isInteger(note.beats))
        return pitch + "-".repeat(note.beats - 1);
      // General MusicXML durations cannot all be represented by this simple editor.
      return pitch;
    })
    .join(" ");
}
