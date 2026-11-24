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
