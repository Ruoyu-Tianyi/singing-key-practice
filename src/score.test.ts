// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  builtinScores,
  importScore,
  parseJianpu,
  parseMusicXml,
  scoreToJianpu,
  validateScore,
} from "./score";

describe("numbered notation", () => {
  it("reads accidentals, octave marks, rests, subdivisions, dots and extensions", () => {
    const score = parseJianpu("1 #2 b3 4' 5, 0 | 6_ 7__ 1. 2-- -");
    expect(score.notes.map((note) => note.midi)).toEqual([
      60,
      63,
      63,
      77,
      55,
      null,
      69,
      71,
      60,
      62,
    ]);
    expect(score.notes.map((note) => note.beats)).toEqual([
      1, 1, 1, 1, 1, 1, 0.5, 0.25, 1.5, 4,
    ]);
  });
  it("does not interpret title, year, tempo or time signature as notes", () => {
    const score = parseJianpu(
      "标题：我的歌 123\n2026\n1=D 6/8 BPM=120\n1 2 3 | 0 5_ 6_",
    );
    expect(score.bpm).toBe(120);
    expect(score.timeSignature).toBe("6/8");
    expect(score.notes.map((note) => note.midi)).toEqual([
      62,
      64,
      66,
      null,
      69,
      71,
    ]);
  });
  it("ignores prose containing incidental digits and rejects an empty melody", () => {
    expect(() => parseJianpu("第 1 页\n作品 7\nBPM=80\n4/4")).toThrow(
      "没有识别到",
    );
  });
  it("keeps common rhythm and pitch when converting back into notation", () => {
    const original = parseJianpu("#1, 2_ 3__ 4. 5_. 6-- 0 1'");
    expect(parseJianpu(scoreToJianpu(original)).notes).toEqual(original.notes);
  });
  it("includes public-domain melodies without invalid durations", () => {
    expect(builtinScores).toHaveLength(3);
    for (const score of builtinScores)
      expect(validateScore(score).notes.length).toBeGreaterThan(10);
  });
});

describe("score validation", () => {
  const base = {
    title: "test",
    bpm: 80,
    timeSignature: "4/4",
    notes: [{ midi: 60, beats: 1 }],
  };
  it("rejects invalid pitches, rests without duration and implausible tempo", () => {
    expect(() =>
      validateScore({ ...base, notes: [{ midi: 500, beats: 1 }] }),
    ).toThrow();
    expect(() =>
      validateScore({ ...base, notes: [{ midi: null, beats: 0 }] }),
    ).toThrow();
    expect(() =>
      validateScore({ ...base, notes: [{ midi: undefined, beats: 1 }] }),
    ).toThrow();
    expect(() => validateScore({ ...base, bpm: 0 })).toThrow();
    expect(() => validateScore({ ...base, timeSignature: "text" })).toThrow();
    expect(() => validateScore({ ...base, notes: [] })).toThrow();
  });
  it.each([undefined, "", " \t\n ", "\u3000", 12])(
    "replaces an empty or non-text id/title (%j) with a usable identity",
    (value) => {
      const score = validateScore({ ...base, id: value, title: value });
      expect(score.id).toMatch(/^score-.+/);
      expect(score.title).toBe("导入曲谱");
      // Export/import and startup validation must retain the generated identity.
      expect(validateScore(JSON.parse(JSON.stringify(score)))).toEqual(score);
    },
  );
  it("trims imported identity fields while preserving bounded nonempty values", () => {
    const score = validateScore({
      ...base,
      id: "  my-song  ",
      title: "  我的旋律 \n",
    });
    expect(score.id).toBe("my-song");
    expect(score.title).toBe("我的旋律");
    const long = validateScore({
      ...base,
      id: `a${" ".repeat(100)}b`,
      title: "曲".repeat(200),
    });
    expect(long.id).toBe("a");
    expect(long.title).toHaveLength(120);
  });
});

const wrap = (measures: string) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Test melody</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const pitch = (step: string, octave = 4) =>
  `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`;

describe("MusicXML melody import", () => {
  it("preserves rests and tied note duration across measures", () => {
    const score = parseMusicXml(
      wrap(
        `<measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="90"/></direction><note><rest/><duration>2</duration></note><note>${pitch("C")}<duration>6</duration><tie type="start"/><lyric><text>啦</text></lyric></note></measure><measure number="2"><note>${pitch("C")}<duration>2</duration><tie type="stop"/></note><note>${pitch("D")}<duration>6</duration></note></measure>`,
      ),
    );
    expect(score.title).toBe("Test melody");
    expect(score.bpm).toBe(90);
    expect(score.notes).toEqual([
      { midi: null, beats: 1 },
      { midi: 60, beats: 4, lyric: "啦" },
      { midi: 62, beats: 3 },
    ]);
  });
  it("selects first voice, skips chord tones, and applies sounding transposition", () => {
    const score = parseMusicXml(
      wrap(
        `<measure><attributes><divisions>1</divisions><transpose><chromatic>-2</chromatic></transpose></attributes><note>${pitch("C")}<duration>1</duration><voice>1</voice><staff>1</staff></note><note><chord/>${pitch("E")}<duration>1</duration><voice>1</voice><staff>1</staff></note><note>${pitch("D")}<duration>1</duration><voice>1</voice><staff>1</staff></note><backup><duration>2</duration></backup><note>${pitch("G", 3)}<duration>2</duration><voice>2</voice><staff>2</staff></note></measure>`,
      ),
    );
    expect(score.notes).toEqual([
      { midi: 58, beats: 1 },
      { midi: 60, beats: 1 },
    ]);
  });
  it("honors changed divisions and fills gaps made by forward movement", () => {
    const score = parseMusicXml(
      wrap(
        `<measure><attributes><divisions>2</divisions></attributes><note>${pitch("C")}<duration>2</duration></note><forward><duration>2</duration></forward><note>${pitch("D")}<duration>2</duration></note></measure><measure><attributes><divisions>4</divisions></attributes><note>${pitch("E")}<duration>2</duration></note></measure>`,
      ),
    );
    expect(score.notes.map((note) => note.beats)).toEqual([1, 1, 1, 0.5]);
    expect(score.notes[1].midi).toBe(null);
  });
  it("flags repeats and changing tempo instead of pretending to expand them", () => {
    const score = parseMusicXml(
      wrap(
        `<measure><note>${pitch("C")}<duration>1</duration></note><barline><repeat direction="backward"/></barline></measure><measure><direction><sound tempo="110"/></direction><note>${pitch("D")}<duration>1</duration></note></measure>`,
      ),
    );
    expect(score.notes).toHaveLength(2);
    expect(score.source).toContain("单次读取");
    expect(score.source).toContain("统一速度");
  });
  it("rejects malformed XML, custom entities and unsupported score roots", () => {
    expect(() => parseMusicXml("<score-partwise>")).toThrow("格式有误");
    expect(() =>
      parseMusicXml(
        '<!DOCTYPE score-partwise [<!ENTITY x "x">]><score-partwise/>',
      ),
    ).toThrow("实体");
    expect(() => parseMusicXml("<score-timewise/>")).toThrow("score-partwise");
  });
});

function mockFile(name: string, bytes: ArrayBuffer, type = ""): File {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes,
    text: async () => new TextDecoder().decode(bytes),
  } as File;
}

describe("file import", () => {
  it("reads an actual compressed MXL with a container manifest", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      '<container><rootfiles><rootfile full-path="scores/song.musicxml"/></rootfiles></container>',
    );
    zip.file(
      "scores/song.musicxml",
      wrap(
        `<measure><note>${pitch("F")}<duration>1</duration></note></measure>`,
      ),
    );
    const score = await importScore(
      mockFile("song.mxl", await zip.generateAsync({ type: "arraybuffer" })),
    );
    expect(score.notes).toEqual([{ midi: 65, beats: 1 }]);
  });
  it("rejects an MXL manifest path traversal without extracting files", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      '<container><rootfiles><rootfile full-path="../outside.xml"/></rootfiles></container>',
    );
    zip.file(
      "outside.xml",
      wrap(
        `<measure><note>${pitch("F")}<duration>1</duration></note></measure>`,
      ),
    );
    await expect(
      importScore(
        mockFile("song.mxl", await zip.generateAsync({ type: "arraybuffer" })),
      ),
    ).rejects.toThrow("路径不安全");
  });
  it("reads an actual MIDI and preserves silence while selecting one melody", async () => {
    const { Midi } = await import("@tonejs/midi");
    const midi = new Midi();
    midi.header.setTempo(100);
    const track = midi.addTrack();
    track.addNote({ midi: 60, ticks: 0, durationTicks: midi.header.ppq });
    track.addNote({ midi: 64, ticks: 0, durationTicks: midi.header.ppq });
    track.addNote({
      midi: 67,
      ticks: midi.header.ppq * 2,
      durationTicks: midi.header.ppq / 2,
    });
    const bytes = midi.toArray();
    const score = await importScore(
      mockFile(
        "melody.mid",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    );
    expect(score.notes).toEqual([
      { midi: 64, beats: 1 },
      { midi: null, beats: 1 },
      { midi: 67, beats: 0.5 },
    ]);
    expect(score.bpm).toBeCloseTo(100);
    expect(score.source).toContain("重叠音已简化");
  });
  it("round trips an exported JSON score and rejects unsupported or oversize files", async () => {
    const source = parseJianpu("1 2_ 0 3-", "Roundtrip");
    const data = new TextEncoder().encode(JSON.stringify(source)).buffer;
    expect(await importScore(mockFile("song.json", data))).toEqual(source);
    await expect(
      importScore(mockFile("song.exe", new ArrayBuffer(1))),
    ).rejects.toThrow("暂不支持");
    await expect(
      importScore({ name: "large.xml", size: 21 * 1024 * 1024 } as File),
    ).rejects.toThrow("20 MB");
  });
});
