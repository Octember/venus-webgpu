import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const distDir = join(root, "dist");
const demoDistDir = join(root, "demo/dist");

rmSync(distDir, { recursive: true, force: true });
rmSync(demoDistDir, { recursive: true, force: true });

const libBuild = await Bun.build({
  entrypoints: [join(root, "src/index.ts"), join(root, "src/transport/unkernel.ts")],
  outdir: distDir,
  root: join(root, "src"),
  target: "browser",
  splitting: true,
  external: ["naga-wasm"],
});

if (!libBuild.success) {
  for (const log of libBuild.logs) console.error(log);
  process.exit(1);
}

const demoBuild = await Bun.build({
  entrypoints: [join(root, "demo/demo.ts")],
  outdir: demoDistDir,
  target: "browser",
});

if (!demoBuild.success) {
  for (const log of demoBuild.logs) console.error(log);
  process.exit(1);
}

mkdirSync(demoDistDir, { recursive: true });
copyFileSync(
  join(root, "node_modules/naga-wasm/dist/wasm/naga_bg.wasm"),
  join(demoDistDir, "naga_bg.wasm"),
);

const tsc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

if (tsc.exitCode !== 0) {
  process.exit(tsc.exitCode ?? 1);
}

function walkDts(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDts(full));
    } else if (entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

const tsSpecifierRe = /from\s+["'][^"']*\.ts["']/;
for (const file of walkDts(distDir)) {
  const content = readFileSync(file, "utf8").replace(/(from\s+["'][^"']*)\.ts(["'])/g, "$1.js$2");
  Bun.write(file, content);
  if (tsSpecifierRe.test(content)) {
    console.error(`Found .ts import specifier in ${file}`);
    process.exit(1);
  }
}

console.log("Build succeeded.");
