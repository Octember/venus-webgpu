import { describe, expect, test } from "bun:test";
import { createVectorAddSpirv, SpirvTranslator } from "../src/shader/spirv.ts";

describe("SpirvTranslator (naga-wasm)", () => {
  test("translates SPIR-V vector-add compute shader to valid WGSL and caches it", async () => {
    const translator = new SpirvTranslator();
    const spirv = createVectorAddSpirv();

    const first = await translator.translateToWgsl(spirv);
    expect(first.wgsl).toContain("@compute");
    expect(first.wgsl).toContain("@workgroup_size(64, 1, 1)");
    expect(first.wgsl).toContain("@group(0) @binding(0)");
    expect(first.wgsl).toContain("@group(0) @binding(1)");
    expect(first.wgsl).toContain("@group(0) @binding(2)");

    const second = await translator.translateToWgsl(spirv);
    expect(second.hash).toBe(first.hash);
    expect(second.wgsl).toBe(first.wgsl);
  });
});
