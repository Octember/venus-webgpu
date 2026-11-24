import type {
  VkDescriptorSetLayoutBinding,
  VkHandle,
  VkRenderPassCreateInfo,
} from "../protocol/types.ts";

export interface VenusDeviceMemory {
  handle: VkHandle;
  size: number;
  memoryTypeIndex: number;
  gpuBuffer: GPUBuffer;
  hostData: Uint8Array<ArrayBuffer> | null;
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
  kind: "compute";
  layout: VenusPipelineLayout;
  gpuPipeline: GPUComputePipeline;
  reflectedBindGroupLayouts: GPUBindGroupLayout[];
  storageAccess: Map<string, "read-only-storage" | "storage">;
}

export interface VenusGraphicsPipeline {
  handle: VkHandle;
  kind: "graphics";
  layout: VenusPipelineLayout;
  gpuPipeline: GPURenderPipeline;
  reflectedBindGroupLayouts: GPUBindGroupLayout[];
  storageAccess: Map<string, "read-only-storage" | "storage">;
}

export type VenusPipeline = VenusComputePipeline | VenusGraphicsPipeline;

export interface VenusImage {
  handle: VkHandle;
  format: number;
  width: number;
  height: number;
  usage: number;
  gpuTexture: GPUTexture;
  memory: VenusDeviceMemory | null;
  memoryOffset: number;
}

export interface VenusImageView {
  handle: VkHandle;
  image: VenusImage;
  format: number;
  gpuView: GPUTextureView;
}

export interface VenusSampler {
  handle: VkHandle;
  gpuSampler: GPUSampler;
}

export interface VenusRenderPass {
  handle: VkHandle;
  info: VkRenderPassCreateInfo;
}

export interface VenusFramebuffer {
  handle: VkHandle;
  renderPass: VenusRenderPass;
  attachments: VenusImageView[];
  width: number;
  height: number;
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
  gpuBindGroupsByLayout: WeakMap<GPUBindGroupLayout, GPUBindGroup>;
}

export type RecordedCommand =
  | { type: "bindPipeline"; bindPoint: number; pipeline: VenusPipeline }
  | { type: "bindDescriptorSets"; bindPoint: number; firstSet: number; sets: VenusDescriptorSet[]; dynamicOffsets: number[] }
  | { type: "dispatch"; x: number; y: number; z: number }
  | { type: "copyBuffer"; src: VenusBuffer; dst: VenusBuffer; srcOffset: number; dstOffset: number; size: number }
  | { type: "fillBuffer"; dst: VenusBuffer; dstOffset: number; size: number; data: number }
  | {
      type: "beginRenderPass";
      renderPass: VenusRenderPass;
      framebuffer: VenusFramebuffer;
      clearColor: [number, number, number, number];
      clearDepth: number;
    }
  | { type: "endRenderPass" }
  | { type: "setViewport"; x: number; y: number; width: number; height: number; minDepth: number; maxDepth: number }
  | { type: "setScissor"; x: number; y: number; width: number; height: number }
  | { type: "bindVertexBuffers"; firstBinding: number; buffers: VenusBuffer[]; offsets: number[] }
  | { type: "bindIndexBuffer"; buffer: VenusBuffer; offset: number; indexType: number }
  | { type: "draw"; vertexCount: number; instanceCount: number; firstVertex: number; firstInstance: number }
  | {
      type: "drawIndexed";
      indexCount: number;
      instanceCount: number;
      firstIndex: number;
      vertexOffset: number;
      firstInstance: number;
    }
  | { type: "copyBufferToImage"; src: VenusBuffer; dst: VenusImage; bufferOffset: number; width: number; height: number };

export interface VenusCommandBuffer {
  handle: VkHandle;
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
  readonly pipelines = new Map<VkHandle, VenusPipeline>();
  readonly images = new Map<VkHandle, VenusImage>();
  readonly imageViews = new Map<VkHandle, VenusImageView>();
  readonly samplers = new Map<VkHandle, VenusSampler>();
  readonly renderPasses = new Map<VkHandle, VenusRenderPass>();
  readonly framebuffers = new Map<VkHandle, VenusFramebuffer>();
  readonly descriptorPools = new Set<VkHandle>();
  readonly descriptorSets = new Map<VkHandle, VenusDescriptorSet>();
  readonly commandPools = new Set<VkHandle>();
  readonly commandBuffers = new Map<VkHandle, VenusCommandBuffer>();
  readonly fences = new Map<VkHandle, VenusFence>();

  clear(): void {
    for (const mem of this.memories.values()) {
      mem.gpuBuffer.destroy();
    }
    for (const img of this.images.values()) {
      img.gpuTexture.destroy();
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
    this.images.clear();
    this.imageViews.clear();
    this.samplers.clear();
    this.renderPasses.clear();
    this.framebuffers.clear();
    this.descriptorPools.clear();
    this.descriptorSets.clear();
    this.commandPools.clear();
    this.commandBuffers.clear();
    this.fences.clear();
  }
}
