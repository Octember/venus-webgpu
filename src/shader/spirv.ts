import { init, parseSpirv, validate, writeWgsl, type InitInput } from "naga-wasm";

function fnv1a64(words: Uint32Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < words.length; i++) {
    hash ^= BigInt(words[i]);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function toUint32Array(code: Uint32Array | Uint8Array): Uint32Array {
  if (code instanceof Uint32Array) return code;
  if (code.byteOffset % 4 === 0) {
    return new Uint32Array(code.buffer, code.byteOffset, code.byteLength >>> 2);
  }
  const copy = new Uint8Array(code);
  return new Uint32Array(copy.buffer, 0, copy.byteLength >>> 2);
}

export class SpirvTranslator {
  private initPromise: Promise<void> | null = null;
  private readonly cache = new Map<string, string>();

  async ensureInit(wasmInput?: InitInput): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = init(wasmInput).then(() => undefined);
    }
    return this.initPromise;
  }

  async translateToWgsl(code: Uint32Array | Uint8Array): Promise<{ wgsl: string; hash: string }> {
    const words = toUint32Array(code);
    const hash = fnv1a64(words);
    const cached = this.cache.get(hash);
    if (cached !== undefined) {
      return { wgsl: cached, hash };
    }

    await this.ensureInit();
    const mod = parseSpirv(words);
    try {
      const info = validate(mod);
      try {
        const wgsl = writeWgsl(mod, info);
        this.cache.set(hash, wgsl);
        return { wgsl, hash };
      } finally {
        info.free();
      }
    } finally {
      mod.free();
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Generates a valid SPIR-V 1.3 compute shader:
 *   @group(0) @binding(0) var<storage, read> a: array<f32>;
 *   @group(0) @binding(1) var<storage, read> b: array<f32>;
 *   @group(0) @binding(2) var<storage, read_write> c: array<f32>;
 *   @compute @workgroup_size(64, 1, 1)
 *   fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
 *     c[gid.x] = a[gid.x] + b[gid.x];
 *   }
 */
export function createVectorAddSpirv(): Uint32Array {
  const words: number[] = [];
  const emit = (opcode: number, ...operands: number[]) => {
    words.push(((operands.length + 1) << 16) | opcode);
    for (const op of operands) words.push(op >>> 0);
  };
  const strWords = (s: string): number[] => {
    const bytes = new TextEncoder().encode(s + "\0");
    const paddedLen = (bytes.length + 3) & ~3;
    const out: number[] = [];
    for (let i = 0; i < paddedLen; i += 4) {
      out.push(
        ((bytes[i] ?? 0) |
          ((bytes[i + 1] ?? 0) << 8) |
          ((bytes[i + 2] ?? 0) << 16) |
          ((bytes[i + 3] ?? 0) << 24)) >>>
          0,
      );
    }
    return out;
  };

  // IDs
  const ID_MAIN = 1;
  const ID_GL_INVOCATION_ID = 2;
  const ID_A = 3;
  const ID_B = 4;
  const ID_C = 5;
  const ID_VOID = 6;
  const ID_FUNC_VOID = 7;
  const ID_U32 = 8;
  const ID_F32 = 9;
  const ID_UVEC3 = 10;
  const ID_PTR_INPUT_UVEC3 = 11;
  const ID_RUNTIME_ARRAY_F32 = 12;
  const ID_STRUCT_BUF = 13;
  const ID_PTR_STORAGE_BUF = 14;
  const ID_PTR_STORAGE_F32 = 15;
  const ID_CONST_0 = 16;
  const ID_PTR_INPUT_U32 = 17;
  const ID_LABEL_ENTRY = 18;
  const ID_IDX_PTR = 19;
  const ID_IDX = 20;
  const ID_PTR_A = 21;
  const ID_PTR_B = 22;
  const ID_PTR_C = 23;
  const ID_VAL_A = 24;
  const ID_VAL_B = 25;
  const ID_SUM = 26;
  const BOUND = 27;

  // SPIR-V Header: Magic, Version 1.3, Generator, Bound, Schema
  words.push(0x07230203, 0x00010300, 0x00000000, BOUND, 0x00000000);

  // OpCapability Shader (17, 1)
  emit(17, 1);
  // OpMemoryModel Logical GLSL450 (14, 0, 1)
  emit(14, 0, 1);
  // OpEntryPoint GLCompute %main "main" %gl_GlobalInvocationID (15, 5, ID_MAIN, ..."main", ID_GL_INVOCATION_ID)
  emit(15, 5, ID_MAIN, ...strWords("main"), ID_GL_INVOCATION_ID);
  // OpExecutionMode %main LocalSize 64 1 1 (16, ID_MAIN, 17, 64, 1, 1)
  emit(16, ID_MAIN, 17, 64, 1, 1);

  // Annotations
  // OpDecorate %gl_GlobalInvocationID BuiltIn GlobalInvocationId (71, id, 11, 28)
  emit(71, ID_GL_INVOCATION_ID, 11, 28);
  // OpDecorate %runtime_array ArrayStride 4 (71, id, 6, 4)
  emit(71, ID_RUNTIME_ARRAY_F32, 6, 4);
  // OpDecorate %struct_buf Block (71, id, 2)
  emit(71, ID_STRUCT_BUF, 2);
  // OpMemberDecorate %struct_buf 0 Offset 0 (72, id, 0, 35, 0)
  emit(72, ID_STRUCT_BUF, 0, 35, 0);

  // DescriptorSet 0 (34, 0), Binding 0/1/2 (33, n)
  emit(71, ID_A, 34, 0);
  emit(71, ID_A, 33, 0);
  emit(71, ID_A, 24); // NonWritable
  emit(71, ID_B, 34, 0);
  emit(71, ID_B, 33, 1);
  emit(71, ID_B, 24); // NonWritable
  emit(71, ID_C, 34, 0);
  emit(71, ID_C, 33, 2);

  // Types, Constants, Variables
  emit(19, ID_VOID); // OpTypeVoid
  emit(33, ID_FUNC_VOID, ID_VOID); // OpTypeFunction
  emit(21, ID_U32, 32, 0); // OpTypeInt 32 0
  emit(22, ID_F32, 32); // OpTypeFloat 32
  emit(23, ID_UVEC3, ID_U32, 3); // OpTypeVector
  emit(32, ID_PTR_INPUT_UVEC3, 1, ID_UVEC3); // OpTypePointer Input
  emit(29, ID_RUNTIME_ARRAY_F32, ID_F32); // OpTypeRuntimeArray
  emit(30, ID_STRUCT_BUF, ID_RUNTIME_ARRAY_F32); // OpTypeStruct
  emit(32, ID_PTR_STORAGE_BUF, 12, ID_STRUCT_BUF); // OpTypePointer StorageBuffer (12)
  emit(32, ID_PTR_STORAGE_F32, 12, ID_F32); // OpTypePointer StorageBuffer f32
  emit(43, ID_U32, ID_CONST_0, 0); // OpConstant u32 0
  emit(32, ID_PTR_INPUT_U32, 1, ID_U32); // OpTypePointer Input u32

  // Variables
  emit(59, ID_PTR_INPUT_UVEC3, ID_GL_INVOCATION_ID, 1); // Input
  emit(59, ID_PTR_STORAGE_BUF, ID_A, 12); // StorageBuffer
  emit(59, ID_PTR_STORAGE_BUF, ID_B, 12); // StorageBuffer
  emit(59, ID_PTR_STORAGE_BUF, ID_C, 12); // StorageBuffer

  // Function main
  emit(54, ID_VOID, ID_MAIN, 0, ID_FUNC_VOID); // OpFunction
  emit(248, ID_LABEL_ENTRY); // OpLabel
  emit(65, ID_PTR_INPUT_U32, ID_IDX_PTR, ID_GL_INVOCATION_ID, ID_CONST_0); // OpAccessChain
  emit(61, ID_U32, ID_IDX, ID_IDX_PTR); // OpLoad
  emit(65, ID_PTR_STORAGE_F32, ID_PTR_A, ID_A, ID_CONST_0, ID_IDX); // OpAccessChain
  emit(61, ID_F32, ID_VAL_A, ID_PTR_A); // OpLoad
  emit(65, ID_PTR_STORAGE_F32, ID_PTR_B, ID_B, ID_CONST_0, ID_IDX); // OpAccessChain
  emit(61, ID_F32, ID_VAL_B, ID_PTR_B); // OpLoad
  emit(129, ID_F32, ID_SUM, ID_VAL_A, ID_VAL_B); // OpFAdd
  emit(65, ID_PTR_STORAGE_F32, ID_PTR_C, ID_C, ID_CONST_0, ID_IDX); // OpAccessChain
  emit(62, ID_PTR_C, ID_SUM); // OpStore
  emit(253); // OpReturn
  emit(56); // OpFunctionEnd

  return new Uint32Array(words);
}

/**
 * Builds a SPIR-V 1.3 vertex shader for a 3D colored cube:
 *   layout(set = 0, binding = 0) uniform UBO { mat4 mvp; };
 *   layout(location = 0) in vec3 inPos;
 *   layout(location = 1) in vec3 inColor;
 *   layout(location = 0) out vec3 outColor;
 */
export function createCubeVertexSpirv(): Uint32Array {
  const words: number[] = [];
  const op = (opcode: number, ...args: number[]) => {
    words.push(((args.length + 1) << 16) | opcode, ...args);
  };
  const str = (s: string): number[] => {
    const out: number[] = [];
    const bytes = new TextEncoder().encode(s + "\0");
    for (let i = 0; i < bytes.length; i += 4) {
      out.push(
        (bytes[i] ?? 0) |
          ((bytes[i + 1] ?? 0) << 8) |
          ((bytes[i + 2] ?? 0) << 16) |
          ((bytes[i + 3] ?? 0) << 24),
      );
    }
    return out;
  };

  // IDs:
  // 1: void, 2: fn(), 3: f32, 4: vec3<f32>, 5: vec4<f32>, 6: mat4x4<f32>
  // 7: UBO struct { mat4 }, 8: ptr Uniform UBO, 9: ubo var
  // 10: ptr Input vec3, 11: inPos, 12: inColor
  // 13: ptr Output vec4, 14: gl_Position, 15: ptr Output vec3, 16: outColor
  // 17: main, 18: label, 19: ptr Uniform mat4, 20: i32(0), 21: mvp, 22: pos3, 23: f32(1.0)
  // 24: pos4, 25: clipPos, 26: col3, 27: i32_t
  words.push(0x07230203, 0x00010300, 0x00080001, 28, 0);

  op(17, 1); // OpCapability Shader
  op(14, 0, 1); // OpMemoryModel Logical GLSL450
  op(15, 0, 17, ...str("main"), 11, 12, 14, 16, 9); // OpEntryPoint Vertex

  // Decorations
  op(71, 7, 2); // OpDecorate %UBO Block
  op(72, 7, 0, 5); // OpMemberDecorate %UBO 0 ColMajor
  op(72, 7, 0, 35, 0); // OpMemberDecorate %UBO 0 Offset 0
  op(72, 7, 0, 7, 16); // OpMemberDecorate %UBO 0 MatrixStride 16
  op(71, 9, 34, 0); // DescriptorSet 0
  op(71, 9, 33, 0); // Binding 0
  op(71, 11, 30, 0); // Location 0
  op(71, 12, 30, 1); // Location 1
  op(71, 14, 11, 0); // BuiltIn Position
  op(71, 16, 30, 0); // Location 0

  // Types
  op(19, 1); // void
  op(33, 2, 1); // fn() -> void
  op(22, 3, 32); // f32
  op(23, 4, 3, 3); // vec3<f32>
  op(23, 5, 3, 4); // vec4<f32>
  op(24, 6, 5, 4); // mat4x4<f32>
  op(30, 7, 6); // struct UBO { mat4 }
  op(32, 8, 2, 7); // ptr Uniform UBO
  op(32, 10, 1, 4); // ptr Input vec3
  op(32, 13, 3, 5); // ptr Output vec4
  op(32, 15, 3, 4); // ptr Output vec3
  op(32, 19, 2, 6); // ptr Uniform mat4
  op(21, 27, 32, 1); // i32
  op(43, 27, 20, 0); // i32(0)
  op(43, 3, 23, 0x3f800000); // f32(1.0)

  // Variables
  op(59, 8, 9, 2); // ubo
  op(59, 10, 11, 1); // inPos
  op(59, 10, 12, 1); // inColor
  op(59, 13, 14, 3); // gl_Position
  op(59, 15, 16, 3); // outColor

  // Function
  op(54, 1, 17, 0, 2); // OpFunction
  op(248, 18); // OpLabel
  op(65, 19, 28, 9, 20); // %28 = OpAccessChain %19 %9 %20
  op(61, 6, 21, 28); // %21 = OpLoad %6 %28 (mvp)
  op(61, 4, 22, 11); // %22 = OpLoad %4 %11 (inPos)
  // OpCompositeConstruct vec4(pos3.x, pos3.y, pos3.z, 1.0) -> wait: OpCompositeExtract or OpVectorShuffle?
  // Simpler: OpCompositeExtract x, y, z or OpCompositeConstruct %5 %22 %23 (SPIR-V allows vec3 + f32 in OpCompositeConstruct!)
  op(80, 5, 24, 22, 23); // %24 = OpCompositeConstruct %5 %22 %23
  op(145, 5, 25, 21, 24); // %25 = OpMatrixTimesVector %5 %21 %24
  op(62, 14, 25); // OpStore %14 %25
  op(61, 4, 26, 12); // %26 = OpLoad %4 %12 (inColor)
  op(62, 16, 26); // OpStore %16 %26
  op(253); // OpReturn
  op(56); // OpFunctionEnd

  words[3] = 29; // bound
  return new Uint32Array(words);
}

/**
 * Builds a SPIR-V 1.3 fragment shader for a 3D colored cube:
 *   layout(location = 0) in vec3 inColor;
 *   layout(location = 0) out vec4 outColor;
 */
export function createCubeFragmentSpirv(): Uint32Array {
  const words: number[] = [];
  const op = (opcode: number, ...args: number[]) => {
    words.push(((args.length + 1) << 16) | opcode, ...args);
  };
  const str = (s: string): number[] => {
    const out: number[] = [];
    const bytes = new TextEncoder().encode(s + "\0");
    for (let i = 0; i < bytes.length; i += 4) {
      out.push(
        (bytes[i] ?? 0) |
          ((bytes[i + 1] ?? 0) << 8) |
          ((bytes[i + 2] ?? 0) << 16) |
          ((bytes[i + 3] ?? 0) << 24),
      );
    }
    return out;
  };

  // IDs:
  // 1: void, 2: fn(), 3: f32, 4: vec3<f32>, 5: vec4<f32>
  // 6: ptr Input vec3, 7: inColor, 8: ptr Output vec4, 9: outColor
  // 10: main, 11: label, 12: col3, 13: f32(1.0), 14: col4
  words.push(0x07230203, 0x00010300, 0x00080001, 15, 0);

  op(17, 1); // OpCapability Shader
  op(14, 0, 1); // OpMemoryModel Logical GLSL450
  op(15, 4, 10, ...str("main"), 7, 9); // OpEntryPoint Fragment
  op(16, 10, 7); // OpExecutionMode %main OriginUpperLeft

  op(71, 7, 30, 0); // Location 0
  op(71, 9, 30, 0); // Location 0

  op(19, 1); // void
  op(33, 2, 1); // fn()
  op(22, 3, 32); // f32
  op(23, 4, 3, 3); // vec3
  op(23, 5, 3, 4); // vec4
  op(32, 6, 1, 4); // ptr Input vec3
  op(32, 8, 3, 5); // ptr Output vec4
  op(43, 3, 13, 0x3f800000); // f32(1.0)

  op(59, 6, 7, 1); // inColor
  op(59, 8, 9, 3); // outColor

  op(54, 1, 10, 0, 2); // OpFunction
  op(248, 11); // OpLabel
  op(61, 4, 12, 7); // %12 = OpLoad %4 %7
  op(80, 5, 14, 12, 13); // %14 = OpCompositeConstruct %5 %12 %13
  op(62, 9, 14); // OpStore %9 %14
  op(253); // OpReturn
  op(56); // OpFunctionEnd

  return new Uint32Array(words);
}
