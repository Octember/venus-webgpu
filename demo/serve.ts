import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}. Expected an integer between 1 and 65535.`);
  process.exit(1);
}

const demoDistDir = join(import.meta.dir, "dist");
const demoJsPath = join(demoDistDir, "demo.js");
const wasmDestPath = join(demoDistDir, "naga_bg.wasm");

if (!existsSync(demoJsPath) || !existsSync(wasmDestPath)) {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "demo.ts")],
    outdir: demoDistDir,
    target: "browser",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  mkdirSync(demoDistDir, { recursive: true });
  copyFileSync(
    join(import.meta.dir, "../node_modules/naga-wasm/dist/wasm/naga_bg.wasm"),
    wasmDestPath,
  );
}

try {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      let file = Bun.file(`${import.meta.dir}${path}`);
      if (!(await file.exists()) && path.endsWith("/naga_bg.wasm")) {
        file = Bun.file(`${import.meta.dir}/../node_modules/naga-wasm/dist/wasm/naga_bg.wasm`);
      }
      if (await file.exists()) {
        const headers: Record<string, string> = {
          "Cache-Control": "no-store",
        };
        if (path.endsWith(".wasm")) {
          headers["Content-Type"] = "application/wasm";
        }
        return new Response(file, { headers });
      }
      return new Response("Not found", { status: 404 });
    },
  });
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Try: PORT=${port + 1} bun run demo`);
    process.exit(1);
  }
  throw err;
}

console.log(`venus-webgpu demo listening on http://localhost:${port}`);
