import type { VkDescriptorSetLayoutBinding, VkHandle } from "../protocol/types.ts";

export interface VenusDeviceMemory {
  handle: VkHandle;
  size: number;
  memoryTypeIndex: number;
  gpuBuffer: GPUBuffer;
  hostData: Uint8Array | null;
  mappedOffset: number;
  mappedSize: number;
  dirty: boolean;
  needsReadback: boolean;
}

export interface VenusBuffer {
  handle: VkHandle;
  size: number;
  usage: number;
  memory: VenusDeviceMemory | null;
  memoryOffset: number;
}

export interface VenusShaderModule {
  handle: VkHandle;
  wgsl: string;
  module: GPUShaderModule;
}

export interface VenusDescriptorSetLayout {
  handle: VkHandle;
  bindings: VkDescriptorSetLayoutBinding[];
  gpuLayout: GPUBindGroupLayout;
}

export interface VenusPipelineLayout {
  handle: VkHandle;
  setLayouts: VenusDescriptorSetLayout[];
  gpuLayout: GPUPipelineLayout;
}

export interface VenusComputePipeline {
  handle: VkHandle;
  layout: VenusPipelineLayout;
  gpuPipeline: GPUComputePipeline;
}

export interface VenusDescriptorBinding {
  buffer: VenusBuffer;
  offset: number;
  range: number;
}

export interface VenusDescriptorSet {
  handle: VkHandle;
  layout: VenusDescriptorSetLayout;
  bindings: Map<number, VenusDescriptorBinding>;
  gpuBindGroup: GPUBindGroup | null;
  dirty: boolean;
}

export type RecordedCommand =
  | { type: "bindPipeline"; pipeline: VenusComputePipeline }
  | { type: "bindDescriptorSets"; firstSet: number; sets: VenusDescriptorSet[]; dynamicOffsets: number[] }
  | { type: "dispatch"; x: number; y: number; z: number }
  | { type: "copyBuffer"; src: VenusBuffer; dst: VenusBuffer; srcOffset: number; dstOffset: number; size: number }
  | { type: "fillBuffer"; dst: VenusBuffer; dstOffset: number; size: number; data: number };

export interface VenusCommandBuffer {
  handle: VkHandle;
  recording: boolean;
  commands: RecordedCommand[];
}

export interface VenusFence {
  handle: VkHandle;
  signaled: boolean;
}

export class VenusObjectTable {
  readonly instances = new Set<VkHandle>();
  readonly physicalDevices = new Set<VkHandle>();
  readonly devices = new Set<VkHandle>();
  readonly queues = new Set<VkHandle>();
  readonly memories = new Map<VkHandle, VenusDeviceMemory>();
  readonly buffers = new Map<VkHandle, VenusBuffer>();
  readonly shaderModules = new Map<VkHandle, VenusShaderModule>();
  readonly descriptorSetLayouts = new Map<VkHandle, VenusDescriptorSetLayout>();
  readonly pipelineLayouts = new Map<VkHandle, VenusPipelineLayout>();
  readonly pipelines = new Map<VkHandle, VenusComputePipeline>();
  readonly descriptorPools = new Set<VkHandle>();
  readonly descriptorSets = new Map<VkHandle, VenusDescriptorSet>();
  readonly commandPools = new Set<VkHandle>();
  readonly commandBuffers = new Map<VkHandle, VenusCommandBuffer>();
  readonly fences = new Map<VkHandle, VenusFence>();

  clear(): void {
    for (const mem of this.memories.values()) {
      mem.gpuBuffer.destroy();
    }
    this.instances.clear();
    this.physicalDevices.clear();
    this.devices.clear();
    this.queues.clear();
    this.memories.clear();
    this.buffers.clear();
    this.shaderModules.clear();
    this.descriptorSetLayouts.clear();
    this.pipelineLayouts.clear();
    this.pipelines.clear();
    this.descriptorPools.clear();
    this.descriptorSets.clear();
    this.commandPools.clear();
    this.commandBuffers.clear();
    this.fences.clear();
  }
}
