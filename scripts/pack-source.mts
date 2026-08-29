import { fileURLToPath } from "node:url";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import archiver from "archiver";
import pkg from "../package.json" with { type: "json" };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, ".."); // scripts/ -> repo root
const targetDir = resolve(repoRoot, "dist/source");

const name = pkg.name.replace(/^@[^/]+\//, ""); // strip @scope/ if scoped
const targetFile = `${targetDir}/${name}-${pkg.version}-source.zip`;

// Ask git for the exact set of project files.
// - `ls-files` = tracked files, already honoring .gitignore at every level
// - `-z` = NUL-delimited, safe for filenames with spaces/newlines
// - cwd: repoRoot so this works no matter where the script is launched from
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

if (tracked.length === 0) {
  throw new Error("git ls-files returned nothing - not a git checkout, or no committed files.");
}

// `ls-files` reports the INDEX, so a file deleted in the working tree but not yet
// staged is still listed. Skip those instead of crashing, and say which - packing a
// tree that no longer exists would be worse than packing one file less.
const files = tracked.filter((file) => existsSync(resolve(repoRoot, file)));
const missing = tracked.filter((file) => !files.includes(file));
if (missing.length) {
  console.warn(`pack-source: skipping ${missing.length} tracked but deleted file(s):`);
  for (const file of missing) console.warn(`  ${file}`);
}

await mkdir(targetDir, { recursive: true });

await new Promise<void>((resolve_, reject) => {
  const output = createWriteStream(targetFile);
  const archive = archiver("zip", { zlib: { level: 9 } });

  // The file is only guaranteed complete on 'close'.
  output.on("close", () => resolve_());
  output.on("error", reject);
  archive.on("warning", reject);
  archive.on("error", reject);
  archive.pipe(output);

  // git paths are relative to repoRoot; give archiver the absolute source
  // path, but keep the archive entry name as the clean relative path.
  files.forEach((file) => archive.file(resolve(repoRoot, file), { name: file }));
  archive.finalize();
});

console.log(`Wrote ${targetFile} (${files.length} files).`);
