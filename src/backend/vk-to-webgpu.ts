import {
  VK_ATTACHMENT_LOAD_OP,
  VK_ATTACHMENT_STORE_OP,
  VK_COMPARE_OP,
  VK_CULL_MODE,
  VK_DESCRIPTOR_TYPE,
  VK_FORMAT,
  VK_PRIMITIVE_TOPOLOGY,
  VK_SHADER_STAGE,
  VK_WHOLE_SIZE,
} from "../protocol/constants.ts";
import type { VkDescriptorSetLayoutBinding } from "../protocol/types.ts";

export function vkFormatToWebGpu(format: number): GPUTextureFormat {
  switch (format) {
    case VK_FORMAT.B8G8R8A8_UNORM:
      return "bgra8unorm";
    case VK_FORMAT.D32_SFLOAT:
      return "depth32float";
    case VK_FORMAT.D24_UNORM_S8_UINT:
      return "depth24plus-stencil8";
    case VK_FORMAT.R8G8B8A8_UNORM:
    default:
      return "rgba8unorm";
  }
}

export function vkVertexFormatToWebGpu(format: number): GPUVertexFormat {
  switch (format) {
    case VK_FORMAT.R32G32_SFLOAT:
      return "float32x2";
    case VK_FORMAT.R32G32B32A32_SFLOAT:
      return "float32x4";
    case VK_FORMAT.R32G32B32_SFLOAT:
    default:
      return "float32x3";
  }
}

export function vkTopologyToWebGpu(topology: number): GPUPrimitiveTopology {
  switch (topology) {
    case VK_PRIMITIVE_TOPOLOGY.POINT_LIST:
      return "point-list";
    case VK_PRIMITIVE_TOPOLOGY.LINE_LIST:
      return "line-list";
    case VK_PRIMITIVE_TOPOLOGY.LINE_STRIP:
      return "line-strip";
    case VK_PRIMITIVE_TOPOLOGY.TRIANGLE_STRIP:
      return "triangle-strip";
    case VK_PRIMITIVE_TOPOLOGY.TRIANGLE_LIST:
    default:
      return "triangle-list";
  }
}

export function vkCullModeToWebGpu(cullMode: number): GPUCullMode {
  switch (cullMode) {
    case VK_CULL_MODE.FRONT:
      return "front";
    case VK_CULL_MODE.BACK:
      return "back";
    case VK_CULL_MODE.NONE:
    default:
      return "none";
  }
}

export function vkCompareOpToWebGpu(op: number): GPUCompareFunction {
  switch (op) {
    case VK_COMPARE_OP.NEVER:
      return "never";
    case VK_COMPARE_OP.EQUAL:
      return "equal";
    case VK_COMPARE_OP.LESS_OR_EQUAL:
      return "less-equal";
    case VK_COMPARE_OP.GREATER:
      return "greater";
    case VK_COMPARE_OP.NOT_EQUAL:
      return "not-equal";
    case VK_COMPARE_OP.GREATER_OR_EQUAL:
      return "greater-equal";
    case VK_COMPARE_OP.ALWAYS:
      return "always";
    case VK_COMPARE_OP.LESS:
    default:
      return "less";
  }
}

export function vkLoadOpToWebGpu(op: number): GPULoadOp {
  return op === VK_ATTACHMENT_LOAD_OP.CLEAR ? "clear" : "load";
}

export function vkStoreOpToWebGpu(op: number): GPUStoreOp {
  return op === VK_ATTACHMENT_STORE_OP.DONT_CARE ? "discard" : "store";
}

export function vkShaderStageToWebGpu(stageFlags: number): number {
  let visibility = 0;
  if (stageFlags & VK_SHADER_STAGE.VERTEX) visibility |= GPUShaderStage.VERTEX;
  if (stageFlags & VK_SHADER_STAGE.FRAGMENT) visibility |= GPUShaderStage.FRAGMENT;
  if (stageFlags & VK_SHADER_STAGE.COMPUTE) visibility |= GPUShaderStage.COMPUTE;
  if (visibility === 0) {
    visibility = GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  }
  return visibility;
}

export function isDynamicDescriptor(descriptorType: number): boolean {
  return (
    descriptorType === VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER_DYNAMIC ||
    descriptorType === VK_DESCRIPTOR_TYPE.STORAGE_BUFFER_DYNAMIC
  );
}

export function isStorageDescriptor(descriptorType: number): boolean {
  return (
    descriptorType === VK_DESCRIPTOR_TYPE.STORAGE_BUFFER ||
    descriptorType === VK_DESCRIPTOR_TYPE.STORAGE_BUFFER_DYNAMIC
  );
}

export function buildBindGroupLayoutEntry(
  b: VkDescriptorSetLayoutBinding,
  reflectedAccess?: "read-only-storage" | "storage",
): GPUBindGroupLayoutEntry {
  const visibility = vkShaderStageToWebGpu(b.stageFlags);
  const isUniform =
    b.descriptorType === VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER ||
    b.descriptorType === VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER_DYNAMIC;
  const hasDynamicOffset = isDynamicDescriptor(b.descriptorType);
  const storageType: GPUBufferBindingType =
    (visibility & GPUShaderStage.VERTEX) !== 0 || reflectedAccess === "read-only-storage"
      ? "read-only-storage"
      : "storage";
  return {
    binding: b.binding,
    visibility,
    buffer: {
      type: isUniform ? "uniform" : storageType,
      hasDynamicOffset,
    },
  };
}

export function reflectStorageAccess(
  wgslSources: string[],
): Map<string, "read-only-storage" | "storage"> {
  const access = new Map<string, "read-only-storage" | "storage">();
  const re = /@group\(\s*(\d+)\s*\)\s*@binding\(\s*(\d+)\s*\)\s*var<\s*storage(?:\s*,\s*(read|read_write))?\s*>/g;
  for (const src of wgslSources) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const key = `${m[1]}:${m[2]}`;
      const mode = m[3] === "read_write" ? "storage" : "read-only-storage";
      if (access.get(key) !== "storage") {
        access.set(key, mode);
      }
    }
  }
  return access;
}

export function resolveWholeSize(size: bigint, total: number, offset = 0): number {
  return size === VK_WHOLE_SIZE ? Math.max(0, total - offset) : Number(size);
}
