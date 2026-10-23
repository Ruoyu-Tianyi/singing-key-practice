import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Preserve license/NOTICE texts with the static distributable, including transitive packages.
const root = path.resolve("node_modules/.pnpm");
const out = path.resolve("public/licenses");
await mkdir(out, { recursive: true });
const collected = new Map();
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const moduleRoot = path.join(root, entry.name, "node_modules");
  let candidates;
  try {
    candidates = await readdir(moduleRoot, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const candidate of candidates) {
    const directories = candidate.name.startsWith("@")
      ? (await readdir(path.join(moduleRoot, candidate.name))).map((name) =>
          path.join(moduleRoot, candidate.name, name),
        )
      : [path.join(moduleRoot, candidate.name)];
    for (const directory of directories) {
      let pkg;
      try {
        pkg = JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        );
      } catch {
        continue;
      }
      const key = `${pkg.name}@${pkg.version}`;
      if (collected.has(key)) continue;
      const files = (await readdir(directory)).filter((name) =>
        /^(licen[sc]e|notice|copying)(\.|$)/i.test(name),
      );
      const texts = [];
      for (const name of files) {
        try {
          texts.push(
            `${name}\n${await readFile(path.join(directory, name), "utf8")}`,
          );
        } catch {
          /* directory */
        }
      }
      if (texts.length) collected.set(key, texts.join("\n\n"));
    }
  }
}
const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const content = [...collected].sort(([a], [b]) => a.localeCompare(b));
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open-source licenses · 声准</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:14px system-ui;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{border-bottom:1px solid #ddd;padding:14px 0}summary{cursor:pointer}</style><h1>Open-source licenses</h1><p>声准 · Third-party license and NOTICE texts, including build dependencies.</p>${content.map(([name, text]) => `<details><summary>${escape(name)}</summary><pre>${escape(text)}</pre></details>`).join("")}</html>`,
);
console.log(`Preserved license/NOTICE texts for ${content.length} packages.`);
