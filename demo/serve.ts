const port = Number(process.env.PORT ?? 4173);

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
      const headers: Record<string, string> = {};
      if (path.endsWith(".wasm")) {
        headers["Content-Type"] = "application/wasm";
      }
      return new Response(file, { headers });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`venus-webgpu demo listening on http://localhost:${port}`);
