import type { VkResult } from "./constants.ts";

export type VkHandle = bigint;

export interface VkCommandHeader {
  commandType: number;
  commandFlags: number;
}

export interface VkMemoryType {
  propertyFlags: number;
  heapIndex: number;
}

export interface VkMemoryHeap {
  size: bigint;
  flags: number;
}

export interface VkPhysicalDeviceMemoryProperties {
  memoryTypes: VkMemoryType[];
  memoryHeaps: VkMemoryHeap[];
}

export interface VkQueueFamilyProperties {
  queueFlags: number;
  queueCount: number;
  timestampValidBits: number;
}

export interface VkPhysicalDeviceProperties {
  apiVersion: number;
  driverVersion: number;
  vendorID: number;
  deviceID: number;
  deviceType: number;
  deviceName: string;
  minStorageBufferOffsetAlignment: number;
  maxComputeWorkGroupCount: [number, number, number];
  maxComputeWorkGroupInvocations: number;
  maxComputeWorkGroupSize: [number, number, number];
}

export interface VkMemoryRequirements {
  size: bigint;
  alignment: bigint;
  memoryTypeBits: number;
}

export interface VkDescriptorSetLayoutBinding {
  binding: number;
  descriptorType: number;
  descriptorCount: number;
  stageFlags: number;
}

export interface VkDescriptorBufferInfo {
  buffer: VkHandle;
  offset: bigint;
  range: bigint;
}

export interface VkWriteDescriptorSet {
  dstSet: VkHandle;
  dstBinding: number;
  dstArrayElement: number;
  descriptorCount: number;
  descriptorType: number;
  bufferInfos: VkDescriptorBufferInfo[];
}

export interface VkSubmitInfo {
  waitSemaphores: VkHandle[];
  commandBuffers: VkHandle[];
  signalSemaphores: VkHandle[];
}

export interface VkMappedMemoryRange {
  memory: VkHandle;
  offset: bigint;
  size: bigint;
}

export interface VkRingCreateInfoMESA {
  resourceId: number;
  offset: bigint;
  size: bigint;
  idleTimeout: bigint;
  headOffset: bigint;
  tailOffset: bigint;
  statusOffset: bigint;
  bufferOffset: bigint;
  bufferSize: bigint;
  extraOffset: bigint;
  extraSize: bigint;
}

export interface VenusCommandHandler {
  vkCreateInstance(instance: VkHandle): VkResult;
  vkDestroyInstance(instance: VkHandle): void;
  vkEnumeratePhysicalDevices(instance: VkHandle): { result: VkResult; physicalDevices: VkHandle[] };
  vkGetPhysicalDeviceProperties(physicalDevice: VkHandle): VkPhysicalDeviceProperties;
  vkGetPhysicalDeviceQueueFamilyProperties(physicalDevice: VkHandle): VkQueueFamilyProperties[];
  vkGetPhysicalDeviceMemoryProperties(physicalDevice: VkHandle): VkPhysicalDeviceMemoryProperties;
  vkCreateDevice(physicalDevice: VkHandle, device: VkHandle, queueFamilyIndex: number): VkResult;
  vkDestroyDevice(device: VkHandle): void;
  vkGetDeviceQueue(device: VkHandle, queueFamilyIndex: number, queueIndex: number, queue: VkHandle): void;

  vkAllocateMemory(device: VkHandle, allocationSize: bigint, memoryTypeIndex: number, memory: VkHandle): VkResult;
  vkFreeMemory(device: VkHandle, memory: VkHandle): void;
  vkMapMemory(device: VkHandle, memory: VkHandle, offset: bigint, size: bigint): VkResult;
  vkUnmapMemory(device: VkHandle, memory: VkHandle): void;
  vkFlushMappedMemoryRanges(device: VkHandle, ranges: VkMappedMemoryRange[]): VkResult;
  vkInvalidateMappedMemoryRanges(device: VkHandle, ranges: VkMappedMemoryRange[]): Promise<VkResult> | VkResult;

  vkCreateBuffer(device: VkHandle, size: bigint, usage: number, buffer: VkHandle): VkResult;
  vkDestroyBuffer(device: VkHandle, buffer: VkHandle): void;
  vkGetBufferMemoryRequirements(device: VkHandle, buffer: VkHandle): VkMemoryRequirements;
  vkBindBufferMemory(device: VkHandle, buffer: VkHandle, memory: VkHandle, memoryOffset: bigint): VkResult;

  vkCreateShaderModule(device: VkHandle, code: Uint32Array, shaderModule: VkHandle): Promise<VkResult> | VkResult;
  vkDestroyShaderModule(device: VkHandle, shaderModule: VkHandle): void;
  vkCreateDescriptorSetLayout(
    device: VkHandle,
    bindings: VkDescriptorSetLayoutBinding[],
    layout: VkHandle,
  ): VkResult;
  vkDestroyDescriptorSetLayout(device: VkHandle, layout: VkHandle): void;
  vkCreatePipelineLayout(device: VkHandle, setLayouts: VkHandle[], pipelineLayout: VkHandle): VkResult;
  vkDestroyPipelineLayout(device: VkHandle, pipelineLayout: VkHandle): void;
  vkCreateComputePipelines(
    device: VkHandle,
    module: VkHandle,
    entryPoint: string,
    layout: VkHandle,
    pipeline: VkHandle,
  ): VkResult;
  vkDestroyPipeline(device: VkHandle, pipeline: VkHandle): void;
  vkCreateDescriptorPool(device: VkHandle, pool: VkHandle): VkResult;
  vkDestroyDescriptorPool(device: VkHandle, pool: VkHandle): void;
  vkAllocateDescriptorSets(
    device: VkHandle,
    pool: VkHandle,
    setLayouts: VkHandle[],
    descriptorSets: VkHandle[],
  ): VkResult;
  vkUpdateDescriptorSets(device: VkHandle, writes: VkWriteDescriptorSet[]): void;

  vkCreateCommandPool(device: VkHandle, queueFamilyIndex: number, pool: VkHandle): VkResult;
  vkDestroyCommandPool(device: VkHandle, pool: VkHandle): void;
  vkAllocateCommandBuffers(device: VkHandle, pool: VkHandle, commandBuffers: VkHandle[]): VkResult;
  vkFreeCommandBuffers(device: VkHandle, pool: VkHandle, commandBuffers: VkHandle[]): void;
  vkBeginCommandBuffer(commandBuffer: VkHandle): VkResult;
  vkEndCommandBuffer(commandBuffer: VkHandle): VkResult;
  vkCmdBindPipeline(commandBuffer: VkHandle, pipelineBindPoint: number, pipeline: VkHandle): void;
  vkCmdBindDescriptorSets(
    commandBuffer: VkHandle,
    pipelineBindPoint: number,
    layout: VkHandle,
    firstSet: number,
    descriptorSets: VkHandle[],
    dynamicOffsets: number[],
  ): void;
  vkCmdDispatch(commandBuffer: VkHandle, groupCountX: number, groupCountY: number, groupCountZ: number): void;
  vkCmdCopyBuffer(
    commandBuffer: VkHandle,
    srcBuffer: VkHandle,
    dstBuffer: VkHandle,
    srcOffset: bigint,
    dstOffset: bigint,
    size: bigint,
  ): void;
  vkCmdFillBuffer(commandBuffer: VkHandle, dstBuffer: VkHandle, dstOffset: bigint, size: bigint, data: number): void;
  vkCmdPipelineBarrier(commandBuffer: VkHandle): void;

  vkCreateFence(device: VkHandle, signaled: boolean, fence: VkHandle): VkResult;
  vkDestroyFence(device: VkHandle, fence: VkHandle): void;
  vkResetFences(device: VkHandle, fences: VkHandle[]): VkResult;
  vkGetFenceStatus(device: VkHandle, fence: VkHandle): VkResult;
  vkWaitForFences(device: VkHandle, fences: VkHandle[], waitAll: boolean, timeout: bigint): Promise<VkResult> | VkResult;
  vkQueueSubmit(queue: VkHandle, submits: VkSubmitInfo[], fence: VkHandle): VkResult;
  vkQueueWaitIdle(queue: VkHandle): Promise<VkResult> | VkResult;
  vkDeviceWaitIdle(device: VkHandle): Promise<VkResult> | VkResult;

  // Venus MESA control
  vkSetReplyCommandStreamMESA?(resourceId: number, offset: bigint, size: bigint): void;
  vkSeekReplyCommandStreamMESA?(position: bigint): void;
  vkCreateRingMESA?(ringId: bigint, info: VkRingCreateInfoMESA): void;
  vkDestroyRingMESA?(ringId: bigint): void;
  vkNotifyRingMESA?(ringId: bigint, seqno: number, flags: number): void;

  // Phase 2: Graphics & Presentation
  vkCreateImage?(
    device: VkHandle,
    info: VkImageCreateInfo,
    image: VkHandle,
  ): VkResult;
  vkDestroyImage?(device: VkHandle, image: VkHandle): void;
  vkGetImageMemoryRequirements?(device: VkHandle, image: VkHandle): VkMemoryRequirements;
  vkBindImageMemory?(device: VkHandle, image: VkHandle, memory: VkHandle, offset: bigint): VkResult;
  vkCreateImageView?(
    device: VkHandle,
    info: VkImageViewCreateInfo,
    view: VkHandle,
  ): VkResult;
  vkDestroyImageView?(device: VkHandle, view: VkHandle): void;
  vkCreateSampler?(device: VkHandle, info: VkSamplerCreateInfo, sampler: VkHandle): VkResult;
  vkDestroySampler?(device: VkHandle, sampler: VkHandle): void;
  vkCreateRenderPass?(device: VkHandle, info: VkRenderPassCreateInfo, renderPass: VkHandle): VkResult;
  vkDestroyRenderPass?(device: VkHandle, renderPass: VkHandle): void;
  vkCreateFramebuffer?(device: VkHandle, info: VkFramebufferCreateInfo, framebuffer: VkHandle): VkResult;
  vkDestroyFramebuffer?(device: VkHandle, framebuffer: VkHandle): void;
  vkCreateGraphicsPipelines?(
    device: VkHandle,
    info: VkGraphicsPipelineCreateInfo,
    pipeline: VkHandle,
  ): VkResult;
  vkCmdBeginRenderPass?(
    commandBuffer: VkHandle,
    renderPass: VkHandle,
    framebuffer: VkHandle,
    clearColor: [number, number, number, number],
    clearDepth: number,
  ): void;
  vkCmdEndRenderPass?(commandBuffer: VkHandle): void;
  vkCmdSetViewport?(
    commandBuffer: VkHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void;
  vkCmdSetScissor?(commandBuffer: VkHandle, x: number, y: number, width: number, height: number): void;
  vkCmdBindVertexBuffers?(
    commandBuffer: VkHandle,
    firstBinding: number,
    buffers: VkHandle[],
    offsets: bigint[],
  ): void;
  vkCmdBindIndexBuffer?(commandBuffer: VkHandle, buffer: VkHandle, offset: bigint, indexType: number): void;
  vkCmdDraw?(
    commandBuffer: VkHandle,
    vertexCount: number,
    instanceCount: number,
    firstVertex: number,
    firstInstance: number,
  ): void;
  vkCmdDrawIndexed?(
    commandBuffer: VkHandle,
    indexCount: number,
    instanceCount: number,
    firstIndex: number,
    vertexOffset: number,
    firstInstance: number,
  ): void;
  vkCmdCopyBufferToImage?(
    commandBuffer: VkHandle,
    srcBuffer: VkHandle,
    dstImage: VkHandle,
    bufferOffset: bigint,
    width: number,
    height: number,
  ): void;
  vkQueuePresentKHR?(queue: VkHandle, image: VkHandle): Promise<VkResult> | VkResult;
}

export interface VkImageCreateInfo {
  format: number;
  width: number;
  height: number;
  usage: number;
}

export interface VkImageViewCreateInfo {
  image: VkHandle;
  format: number;
  aspectMask: number;
}

export interface VkSamplerCreateInfo {
  magFilter: number;
  minFilter: number;
}

export interface VkAttachmentDescription {
  format: number;
  loadOp: number;
  storeOp: number;
}

export interface VkRenderPassCreateInfo {
  colorAttachment?: VkAttachmentDescription;
  depthAttachment?: VkAttachmentDescription;
}

export interface VkFramebufferCreateInfo {
  renderPass: VkHandle;
  attachments: VkHandle[];
  width: number;
  height: number;
}

export interface VkVertexInputBinding {
  binding: number;
  stride: number;
}

export interface VkVertexInputAttribute {
  location: number;
  binding: number;
  format: number;
  offset: number;
}

export interface VkGraphicsPipelineCreateInfo {
  vertexShader: VkHandle;
  vertexEntry: string;
  fragmentShader: VkHandle;
  fragmentEntry: string;
  bindings: VkVertexInputBinding[];
  attributes: VkVertexInputAttribute[];
  topology: number;
  cullMode: number;
  depthTestEnable: boolean;
  depthWriteEnable: boolean;
  depthCompareOp: number;
  layout: VkHandle;
  renderPass: VkHandle;
}
