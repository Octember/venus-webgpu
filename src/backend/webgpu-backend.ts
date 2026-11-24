import {
  VK_DESCRIPTOR_TYPE,
  VK_IMAGE_USAGE,
  VK_INDEX_TYPE,
  VK_MEMORY_PROPERTY,
  VK_PHYSICAL_DEVICE_TYPE,
  VK_QUEUE_FLAGS,
  VK_RESULT,
  VK_SHADER_STAGE,
  type VkResult,
} from "../protocol/constants.ts";
import {
  buildBindGroupLayoutEntry,
  isDynamicDescriptor,
  isStorageDescriptor,
  reflectStorageAccess,
  resolveWholeSize,
  vkCompareOpToWebGpu,
  vkCullModeToWebGpu,
  vkFormatToWebGpu,
  vkLoadOpToWebGpu,
  vkStoreOpToWebGpu,
  vkTopologyToWebGpu,
  vkVertexFormatToWebGpu,
} from "./vk-to-webgpu.ts";
export { reflectStorageAccess };
import type {
  VenusCommandHandler,
  VkDescriptorSetLayoutBinding,
  VkFramebufferCreateInfo,
  VkGraphicsPipelineCreateInfo,
  VkHandle,
  VkImageCreateInfo,
  VkImageViewCreateInfo,
  VkMappedMemoryRange,
  VkMemoryRequirements,
  VkPhysicalDeviceMemoryProperties,
  VkPhysicalDeviceProperties,
  VkQueueFamilyProperties,
  VkRenderPassCreateInfo,
  VkRingCreateInfoMESA,
  VkSamplerCreateInfo,
  VkSubmitInfo,
  VkWriteDescriptorSet,
} from "../protocol/types.ts";
import { SpirvTranslator } from "../shader/spirv.ts";
import {
  VenusObjectTable,
  type RecordedCommand,
  type VenusCommandBuffer,
  type VenusDescriptorSet,
  type VenusDeviceMemory,
  type VenusPipeline,
  type VenusPipelineLayout,
} from "./objects.ts";

const DEFAULT_PHYS_DEVICE_HANDLE = 0x1000n;
const ALIGNMENT = 256;

function alignUp(n: number, align: number): number {
  return (n + align - 1) & ~(align - 1);
}

export interface WebGpuVenusBackendOptions {
  device: GPUDevice;
  translator?: SpirvTranslator;
  canvasContext?: GPUCanvasContext;
}

export class WebGpuVenusBackend implements VenusCommandHandler {
  readonly device: GPUDevice;
  readonly translator: SpirvTranslator;
  readonly objects = new VenusObjectTable();
  private canvasContext?: GPUCanvasContext;
  private pendingWork: Promise<void> = Promise.resolve();
  private readonly rings = new Map<bigint, VkRingCreateInfoMESA>();
  private replyStream: { resourceId: number; offset: number; size: number; position: number } | null = null;

  constructor(opts: WebGpuVenusBackendOptions) {
    this.device = opts.device;
    this.translator = opts.translator ?? new SpirvTranslator();
    this.canvasContext = opts.canvasContext;
  }

  reset(): void {
    this.objects.clear();
    this.rings.clear();
    this.replyStream = null;
    this.pendingWork = Promise.resolve();
  }

  setCanvasContext(ctx: GPUCanvasContext): void {
    this.canvasContext = ctx;
  }

  /** Expose host-visible backing memory for direct guest/test reads & writes. */
  getMemoryHostData(memory: VkHandle): Uint8Array<ArrayBuffer> | null {
    return this.objects.memories.get(memory)?.hostData ?? null;
  }

  vkCreateInstance(instance: VkHandle): VkResult {
    this.objects.instances.add(instance);
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyInstance(instance: VkHandle): void {
    this.objects.instances.delete(instance);
  }

  vkEnumeratePhysicalDevices(_instance: VkHandle): { result: VkResult; physicalDevices: VkHandle[] } {
    this.objects.physicalDevices.add(DEFAULT_PHYS_DEVICE_HANDLE);
    return { result: VK_RESULT.VK_SUCCESS, physicalDevices: [DEFAULT_PHYS_DEVICE_HANDLE] };
  }

  vkGetPhysicalDeviceProperties(_physicalDevice: VkHandle): VkPhysicalDeviceProperties {
    const limits = this.device.limits;
    return {
      apiVersion: (1 << 22) | (3 << 12),
      driverVersion: 1,
      vendorID: 0x10005, // Mesa/Virtio
      deviceID: 0x0001,
      deviceType: VK_PHYSICAL_DEVICE_TYPE.VIRTUAL_GPU,
      deviceName: "Venus-WebGPU Bridge",
      minStorageBufferOffsetAlignment: limits?.minStorageBufferOffsetAlignment ?? 256,
      maxComputeWorkGroupCount: [
        limits?.maxComputeWorkgroupsPerDimension ?? 65535,
        limits?.maxComputeWorkgroupsPerDimension ?? 65535,
        limits?.maxComputeWorkgroupsPerDimension ?? 65535,
      ],
      maxComputeWorkGroupInvocations: limits?.maxComputeInvocationsPerWorkgroup ?? 256,
      maxComputeWorkGroupSize: [
        limits?.maxComputeWorkgroupSizeX ?? 256,
        limits?.maxComputeWorkgroupSizeY ?? 256,
        limits?.maxComputeWorkgroupSizeZ ?? 64,
      ],
    };
  }

  vkGetPhysicalDeviceQueueFamilyProperties(_physicalDevice: VkHandle): VkQueueFamilyProperties[] {
    return [
      {
        queueFlags: VK_QUEUE_FLAGS.GRAPHICS | VK_QUEUE_FLAGS.COMPUTE | VK_QUEUE_FLAGS.TRANSFER,
        queueCount: 1,
        timestampValidBits: 64,
      },
    ];
  }

  vkGetPhysicalDeviceMemoryProperties(_physicalDevice: VkHandle): VkPhysicalDeviceMemoryProperties {
    return {
      memoryTypes: [
        { propertyFlags: VK_MEMORY_PROPERTY.DEVICE_LOCAL, heapIndex: 0 },
        {
          propertyFlags:
            VK_MEMORY_PROPERTY.HOST_VISIBLE |
            VK_MEMORY_PROPERTY.HOST_COHERENT |
            VK_MEMORY_PROPERTY.HOST_CACHED,
          heapIndex: 0,
        },
      ],
      memoryHeaps: [{ size: BigInt(1024 * 1024 * 1024), flags: 1 }],
    };
  }

  vkCreateDevice(_physicalDevice: VkHandle, device: VkHandle, _queueFamilyIndex: number): VkResult {
    this.objects.devices.add(device);
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyDevice(device: VkHandle): void {
    this.objects.devices.delete(device);
  }

  vkGetDeviceQueue(_device: VkHandle, _queueFamilyIndex: number, _queueIndex: number, queue: VkHandle): void {
    this.objects.queues.add(queue);
  }

  vkAllocateMemory(
    _device: VkHandle,
    allocationSize: bigint,
    memoryTypeIndex: number,
    memory: VkHandle,
  ): VkResult {
    const size = alignUp(Math.max(4, Number(allocationSize)), ALIGNMENT);
    const gpuBuffer = this.device.createBuffer({
      size,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.UNIFORM |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.INDEX |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    const isHostVisible = memoryTypeIndex === 1;
    this.objects.memories.set(memory, {
      handle: memory,
      size,
      memoryTypeIndex,
      gpuBuffer,
      hostData: isHostVisible ? new Uint8Array(size) : null,
      mappedOffset: 0,
      mappedSize: 0,
      dirty: false,
      needsReadback: false,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkFreeMemory(_device: VkHandle, memory: VkHandle): void {
    const mem = this.objects.memories.get(memory);
    if (mem) {
      this.objects.memories.delete(memory);
      void this.pendingWork.catch(() => {}).then(() => mem.gpuBuffer.destroy());
    }
  }

  vkMapMemory(_device: VkHandle, memory: VkHandle, offset: bigint, size: bigint): VkResult {
    const mem = this.objects.memories.get(memory);
    if (!mem || !mem.hostData) return VK_RESULT.VK_ERROR_MEMORY_MAP_FAILED;
    mem.mappedOffset = Number(offset);
    mem.mappedSize = resolveWholeSize(size, mem.size, mem.mappedOffset);
    mem.dirty = true;
    return VK_RESULT.VK_SUCCESS;
  }

  vkUnmapMemory(_device: VkHandle, memory: VkHandle): void {
    const mem = this.objects.memories.get(memory);
    if (mem && mem.hostData) {
      mem.dirty = true;
      mem.mappedOffset = 0;
      mem.mappedSize = 0;
    }
  }

  vkFlushMappedMemoryRanges(_device: VkHandle, ranges: VkMappedMemoryRange[]): VkResult {
    for (const r of ranges) {
      const mem = this.objects.memories.get(r.memory);
      if (mem?.hostData) {
        const off = Number(r.offset) & ~3;
        const size = resolveWholeSize(r.size, mem.size, Number(r.offset));
        const end = Math.min(mem.size, alignUp(Number(r.offset) + size, 4));
        const len = Math.max(0, end - off);
        if (len > 0) {
          this.device.queue.writeBuffer(mem.gpuBuffer, off, mem.hostData, off, len);
        }
        mem.dirty = false;
      }
    }
    return VK_RESULT.VK_SUCCESS;
  }

  async vkInvalidateMappedMemoryRanges(_device: VkHandle, ranges: VkMappedMemoryRange[]): Promise<VkResult> {
    await this.pendingWork;
    for (const r of ranges) {
      const mem = this.objects.memories.get(r.memory);
      if (mem?.hostData && mem.needsReadback) {
        await this.readbackMemory(mem);
      }
    }
    return VK_RESULT.VK_SUCCESS;
  }

  vkCreateBuffer(_device: VkHandle, size: bigint, usage: number, buffer: VkHandle): VkResult {
    this.objects.buffers.set(buffer, {
      handle: buffer,
      size: Number(size),
      usage,
      memory: null,
      memoryOffset: 0,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyBuffer(_device: VkHandle, buffer: VkHandle): void {
    this.objects.buffers.delete(buffer);
  }

  vkGetBufferMemoryRequirements(_device: VkHandle, buffer: VkHandle): VkMemoryRequirements {
    const buf = this.objects.buffers.get(buffer);
    const size = BigInt(alignUp(buf?.size ?? 256, ALIGNMENT));
    return { size, alignment: BigInt(ALIGNMENT), memoryTypeBits: 0b11 };
  }

  vkBindBufferMemory(_device: VkHandle, buffer: VkHandle, memory: VkHandle, memoryOffset: bigint): VkResult {
    const buf = this.objects.buffers.get(buffer);
    const mem = this.objects.memories.get(memory);
    if (!buf || !mem) return VK_RESULT.VK_ERROR_OUT_OF_HOST_MEMORY;
    buf.memory = mem;
    buf.memoryOffset = Number(memoryOffset);
    return VK_RESULT.VK_SUCCESS;
  }

  async vkCreateShaderModule(_device: VkHandle, code: Uint32Array, shaderModule: VkHandle): Promise<VkResult> {
    const { wgsl } = await this.translator.translateToWgsl(code);
    const module = this.device.createShaderModule({ code: wgsl });
    this.objects.shaderModules.set(shaderModule, { handle: shaderModule, wgsl, module });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyShaderModule(_device: VkHandle, shaderModule: VkHandle): void {
    this.objects.shaderModules.delete(shaderModule);
  }

  vkCreateDescriptorSetLayout(
    _device: VkHandle,
    bindings: VkDescriptorSetLayoutBinding[],
    layout: VkHandle,
  ): VkResult {
    const entries = bindings.map((b) => buildBindGroupLayoutEntry(b));
    const gpuLayout = this.device.createBindGroupLayout({ entries });
    this.objects.descriptorSetLayouts.set(layout, { handle: layout, bindings, gpuLayout });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyDescriptorSetLayout(_device: VkHandle, layout: VkHandle): void {
    this.objects.descriptorSetLayouts.delete(layout);
  }

  vkCreatePipelineLayout(_device: VkHandle, setLayouts: VkHandle[], pipelineLayout: VkHandle): VkResult {
    const resolved = setLayouts.map((h) => {
      const l = this.objects.descriptorSetLayouts.get(h);
      if (!l) throw new Error(`Unknown descriptor set layout: ${h}`);
      return l;
    });
    const gpuLayout = this.device.createPipelineLayout({
      bindGroupLayouts: resolved.map((l) => l.gpuLayout),
    });
    this.objects.pipelineLayouts.set(pipelineLayout, {
      handle: pipelineLayout,
      setLayouts: resolved,
      gpuLayout,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyPipelineLayout(_device: VkHandle, pipelineLayout: VkHandle): void {
    this.objects.pipelineLayouts.delete(pipelineLayout);
  }

  vkCreateComputePipelines(
    _device: VkHandle,
    moduleHandle: VkHandle,
    entryPoint: string,
    layoutHandle: VkHandle,
    pipeline: VkHandle,
  ): VkResult {
    const mod = this.objects.shaderModules.get(moduleHandle);
    const layout = this.objects.pipelineLayouts.get(layoutHandle);
    if (!mod || !layout) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    const storageAccess = reflectStorageAccess([mod.wgsl]);
    const { bindGroupLayouts: reflectedBindGroupLayouts, pipelineLayout } = this.createReflectedLayouts(
      layout,
      storageAccess,
    );
    const gpuPipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: mod.module, entryPoint },
    });
    this.objects.pipelines.set(pipeline, {
      handle: pipeline,
      kind: "compute",
      layout,
      gpuPipeline,
      reflectedBindGroupLayouts,
      storageAccess,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyPipeline(_device: VkHandle, pipeline: VkHandle): void {
    this.objects.pipelines.delete(pipeline);
  }

  vkCreateDescriptorPool(_device: VkHandle, pool: VkHandle): VkResult {
    this.objects.descriptorPools.add(pool);
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyDescriptorPool(_device: VkHandle, pool: VkHandle): void {
    this.objects.descriptorPools.delete(pool);
  }

  vkAllocateDescriptorSets(
    _device: VkHandle,
    _pool: VkHandle,
    setLayouts: VkHandle[],
    descriptorSets: VkHandle[],
  ): VkResult {
    for (let i = 0; i < descriptorSets.length; i++) {
      const layout = this.objects.descriptorSetLayouts.get(setLayouts[i]);
      if (!layout) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
      this.objects.descriptorSets.set(descriptorSets[i], {
        handle: descriptorSets[i],
        layout,
        bindings: new Map(),
        gpuBindGroupsByLayout: new WeakMap(),
      });
    }
    return VK_RESULT.VK_SUCCESS;
  }

  vkUpdateDescriptorSets(_device: VkHandle, writes: VkWriteDescriptorSet[]): void {
    for (const w of writes) {
      const set = this.objects.descriptorSets.get(w.dstSet);
      if (!set) continue;
      for (let i = 0; i < w.bufferInfos.length; i++) {
        const info = w.bufferInfos[i];
        const buf = this.objects.buffers.get(info.buffer);
        if (!buf) continue;
        const range = resolveWholeSize(info.range, buf.size, Number(info.offset));
        set.bindings.set(w.dstBinding + i, {
          buffer: buf,
          offset: Number(info.offset),
          range,
        });
        set.gpuBindGroupsByLayout = new WeakMap();
      }
    }
  }

  vkCreateCommandPool(_device: VkHandle, _queueFamilyIndex: number, pool: VkHandle): VkResult {
    this.objects.commandPools.add(pool);
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyCommandPool(_device: VkHandle, pool: VkHandle): void {
    this.objects.commandPools.delete(pool);
  }

  vkAllocateCommandBuffers(_device: VkHandle, _pool: VkHandle, commandBuffers: VkHandle[]): VkResult {
    for (const handle of commandBuffers) {
      this.objects.commandBuffers.set(handle, { handle, commands: [] });
    }
    return VK_RESULT.VK_SUCCESS;
  }

  vkFreeCommandBuffers(_device: VkHandle, _pool: VkHandle, commandBuffers: VkHandle[]): void {
    for (const handle of commandBuffers) {
      this.objects.commandBuffers.delete(handle);
    }
  }

  vkBeginCommandBuffer(commandBuffer: VkHandle): VkResult {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (!cb) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    cb.commands = [];
    return VK_RESULT.VK_SUCCESS;
  }

  vkEndCommandBuffer(commandBuffer: VkHandle): VkResult {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (!cb) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    return VK_RESULT.VK_SUCCESS;
  }

  vkCmdBindPipeline(commandBuffer: VkHandle, pipelineBindPoint: number, pipelineHandle: VkHandle): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const pipeline = this.objects.pipelines.get(pipelineHandle);
    if (cb && pipeline) cb.commands.push({ type: "bindPipeline", bindPoint: pipelineBindPoint, pipeline });
  }

  vkCmdBindDescriptorSets(
    commandBuffer: VkHandle,
    pipelineBindPoint: number,
    _layout: VkHandle,
    firstSet: number,
    descriptorSets: VkHandle[],
    dynamicOffsets: number[],
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (!cb) return;
    const sets = descriptorSets
      .map((h) => this.objects.descriptorSets.get(h))
      .filter((s): s is VenusDescriptorSet => s !== undefined);
    cb.commands.push({ type: "bindDescriptorSets", bindPoint: pipelineBindPoint, firstSet, sets, dynamicOffsets });
  }

  vkCmdDispatch(commandBuffer: VkHandle, x: number, y: number, z: number): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) cb.commands.push({ type: "dispatch", x, y, z });
  }

  vkCmdCopyBuffer(
    commandBuffer: VkHandle,
    srcHandle: VkHandle,
    dstHandle: VkHandle,
    srcOffset: bigint,
    dstOffset: bigint,
    size: bigint,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const src = this.objects.buffers.get(srcHandle);
    const dst = this.objects.buffers.get(dstHandle);
    if (cb && src && dst) {
      cb.commands.push({
        type: "copyBuffer",
        src,
        dst,
        srcOffset: Number(srcOffset),
        dstOffset: Number(dstOffset),
        size: Number(size),
      });
    }
  }

  vkCmdFillBuffer(
    commandBuffer: VkHandle,
    dstHandle: VkHandle,
    dstOffset: bigint,
    size: bigint,
    data: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const dst = this.objects.buffers.get(dstHandle);
    if (cb && dst) {
      const off = Number(dstOffset);
      const byteSize = resolveWholeSize(size, dst.size, off);
      cb.commands.push({
        type: "fillBuffer",
        dst,
        dstOffset: off,
        size: byteSize,
        data,
      });
    }
  }

  vkCmdPipelineBarrier(_commandBuffer: VkHandle): void {
    // WebGPU manages memory barriers implicitly between passes/dispatches.
  }

  vkCreateFence(_device: VkHandle, signaled: boolean, fence: VkHandle): VkResult {
    this.objects.fences.set(fence, { handle: fence, signaled });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyFence(_device: VkHandle, fence: VkHandle): void {
    this.objects.fences.delete(fence);
  }

  vkResetFences(_device: VkHandle, fences: VkHandle[]): VkResult {
    for (const h of fences) {
      const f = this.objects.fences.get(h);
      if (f) f.signaled = false;
    }
    return VK_RESULT.VK_SUCCESS;
  }

  vkGetFenceStatus(_device: VkHandle, fence: VkHandle): VkResult {
    const f = this.objects.fences.get(fence);
    return f?.signaled ? VK_RESULT.VK_SUCCESS : VK_RESULT.VK_NOT_READY;
  }

  async vkWaitForFences(
    _device: VkHandle,
    fences: VkHandle[],
    waitAll: boolean,
    timeout: bigint,
  ): Promise<VkResult> {
    const isReady = () => {
      if (fences.length === 0) return true;
      return waitAll
        ? fences.every((h) => this.objects.fences.get(h)?.signaled === true)
        : fences.some((h) => this.objects.fences.get(h)?.signaled === true);
    };
    if (!isReady() && timeout !== 0n) {
      await this.pendingWork.catch(() => {});
    }
    return isReady() ? VK_RESULT.VK_SUCCESS : VK_RESULT.VK_TIMEOUT;
  }

  vkQueueSubmit(_queue: VkHandle, submits: VkSubmitInfo[], fenceHandle: VkHandle): VkResult {
    this.flushDirtyMemories();

    const encoder = this.device.createCommandEncoder();
    const touchedHostMemories = new Set<VenusDeviceMemory>();
    const stagingBuffers: GPUBuffer[] = [];

    for (const submit of submits) {
      for (const cbHandle of submit.commandBuffers) {
        const cb = this.objects.commandBuffers.get(cbHandle);
        if (cb) {
          this.encodeCommandBuffer(cb, encoder, touchedHostMemories, stagingBuffers);
        }
      }
    }

    this.device.queue.submit([encoder.finish()]);

    for (const mem of touchedHostMemories) {
      mem.needsReadback = true;
    }

    this.pendingWork = this.pendingWork
      .catch(() => {})
      .then(async () => {
        if (typeof this.device.queue.onSubmittedWorkDone === "function") {
          await this.device.queue.onSubmittedWorkDone();
        }
        for (const staging of stagingBuffers) {
          staging.destroy();
        }
        for (const mem of touchedHostMemories) {
          if (!mem.dirty) {
            await this.readbackMemory(mem);
          }
        }
        if (fenceHandle !== 0n) {
          const f = this.objects.fences.get(fenceHandle);
          if (f) f.signaled = true;
        }
      });
    return VK_RESULT.VK_SUCCESS;
  }

  private flushDirtyMemories(): void {
    for (const mem of this.objects.memories.values()) {
      if (mem.hostData && (mem.dirty || mem.mappedSize > 0)) {
        this.device.queue.writeBuffer(mem.gpuBuffer, 0, mem.hostData);
        mem.dirty = false;
      }
    }
  }

  private encodeCommandBuffer(
    cb: VenusCommandBuffer,
    encoder: GPUCommandEncoder,
    touchedHostMemories: Set<VenusDeviceMemory>,
    stagingBuffers: GPUBuffer[],
  ): void {
    let computePass: GPUComputePassEncoder | null = null;
    let renderPass: GPURenderPassEncoder | null = null;
    let activePipeline: VenusPipeline | null = null;
    const endPass = () => {
      if (computePass) {
        computePass.end();
        computePass = null;
      }
      if (renderPass) {
        renderPass.end();
        renderPass = null;
      }
    };
    const ensureComputePass = () => {
      if (renderPass) {
        renderPass.end();
        renderPass = null;
      }
      if (!computePass) computePass = encoder.beginComputePass();
      return computePass;
    };

    for (const cmd of cb.commands) {
      switch (cmd.type) {
        case "bindPipeline": {
          activePipeline = cmd.pipeline;
          if (cmd.pipeline.kind === "graphics" && renderPass) {
            renderPass.setPipeline(cmd.pipeline.gpuPipeline);
          } else if (cmd.pipeline.kind === "compute") {
            ensureComputePass().setPipeline(cmd.pipeline.gpuPipeline);
          }
          break;
        }
        case "bindDescriptorSets": {
          const pass = renderPass ?? ensureComputePass();
          this.bindDescriptorSets(pass, cmd, activePipeline, touchedHostMemories);
          break;
        }
        case "dispatch": {
          ensureComputePass().dispatchWorkgroups(cmd.x, cmd.y, cmd.z);
          break;
        }
        case "beginRenderPass": {
          endPass();
          renderPass = encoder.beginRenderPass(this.buildRenderPassDescriptor(cmd));
          break;
        }
        case "endRenderPass": {
          if (renderPass) {
            renderPass.end();
            renderPass = null;
          }
          break;
        }
        case "setViewport": {
          renderPass?.setViewport(cmd.x, cmd.y, cmd.width, cmd.height, cmd.minDepth, cmd.maxDepth);
          break;
        }
        case "setScissor": {
          renderPass?.setScissorRect(cmd.x, cmd.y, cmd.width, cmd.height);
          break;
        }
        case "bindVertexBuffers": {
          if (renderPass) {
            for (let i = 0; i < cmd.buffers.length; i++) {
              const buf = cmd.buffers[i];
              if (buf.memory) {
                renderPass.setVertexBuffer(
                  cmd.firstBinding + i,
                  buf.memory.gpuBuffer,
                  buf.memoryOffset + (cmd.offsets[i] ?? 0),
                );
              }
            }
          }
          break;
        }
        case "bindIndexBuffer": {
          if (renderPass && cmd.buffer.memory) {
            renderPass.setIndexBuffer(
              cmd.buffer.memory.gpuBuffer,
              cmd.indexType === VK_INDEX_TYPE.UINT16 ? "uint16" : "uint32",
              cmd.buffer.memoryOffset + cmd.offset,
            );
          }
          break;
        }
        case "draw": {
          renderPass?.draw(cmd.vertexCount, cmd.instanceCount, cmd.firstVertex, cmd.firstInstance);
          break;
        }
        case "drawIndexed": {
          renderPass?.drawIndexed(
            cmd.indexCount,
            cmd.instanceCount,
            cmd.firstIndex,
            cmd.vertexOffset,
            cmd.firstInstance,
          );
          break;
        }
        case "copyBufferToImage": {
          endPass();
          if (cmd.src.memory) {
            encoder.copyBufferToTexture(
              {
                buffer: cmd.src.memory.gpuBuffer,
                offset: cmd.src.memoryOffset + cmd.bufferOffset,
                bytesPerRow: cmd.width * 4,
                rowsPerImage: cmd.height,
              },
              { texture: cmd.dst.gpuTexture },
              { width: cmd.width, height: cmd.height, depthOrArrayLayers: 1 },
            );
          }
          break;
        }
        case "copyBuffer": {
          endPass();
          if (cmd.src.memory && cmd.dst.memory) {
            encoder.copyBufferToBuffer(
              cmd.src.memory.gpuBuffer,
              cmd.src.memoryOffset + cmd.srcOffset,
              cmd.dst.memory.gpuBuffer,
              cmd.dst.memoryOffset + cmd.dstOffset,
              cmd.size,
            );
            if (cmd.dst.memory.hostData) {
              touchedHostMemories.add(cmd.dst.memory);
            }
          }
          break;
        }
        case "fillBuffer": {
          endPass();
          if (cmd.dst.memory && cmd.size >= 4) {
            const alignedSize = alignUp(cmd.size, 4);
            const words = new Uint32Array(alignedSize >>> 2);
            words.fill(cmd.data >>> 0);
            const staging = this.device.createBuffer({
              size: alignedSize,
              usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(staging, 0, words);
            encoder.copyBufferToBuffer(
              staging,
              0,
              cmd.dst.memory.gpuBuffer,
              cmd.dst.memoryOffset + cmd.dstOffset,
              alignedSize,
            );
            stagingBuffers.push(staging);
            if (cmd.dst.memory.hostData) {
              touchedHostMemories.add(cmd.dst.memory);
            }
          }
          break;
        }
      }
    }
    endPass();
  }

  private buildRenderPassDescriptor(
    cmd: Extract<RecordedCommand, { type: "beginRenderPass" }>,
  ): GPURenderPassDescriptor {
    const colorView = cmd.framebuffer.attachments[0]?.gpuView;
    const depthView = cmd.framebuffer.attachments[1]?.gpuView;
    const rpInfo = cmd.renderPass.info;
    const colorAttachments: GPURenderPassColorAttachment[] = colorView
      ? [
          {
            view: colorView,
            clearValue: {
              r: cmd.clearColor[0],
              g: cmd.clearColor[1],
              b: cmd.clearColor[2],
              a: cmd.clearColor[3],
            },
            loadOp: vkLoadOpToWebGpu(rpInfo.colorAttachment?.loadOp ?? 0),
            storeOp: vkStoreOpToWebGpu(rpInfo.colorAttachment?.storeOp ?? 0),
          },
        ]
      : [];
    const depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined = depthView
      ? {
          view: depthView,
          depthClearValue: cmd.clearDepth,
          depthLoadOp: vkLoadOpToWebGpu(rpInfo.depthAttachment?.loadOp ?? 0),
          depthStoreOp: vkStoreOpToWebGpu(rpInfo.depthAttachment?.storeOp ?? 0),
        }
      : undefined;
    return { colorAttachments, depthStencilAttachment };
  }

  private bindDescriptorSets(
    pass: GPUComputePassEncoder | GPURenderPassEncoder,
    cmd: Extract<RecordedCommand, { type: "bindDescriptorSets" }>,
    activePipeline: VenusPipeline | null,
    touchedHostMemories: Set<VenusDeviceMemory>,
  ): void {
    let dynOffsetCursor = 0;
    for (let i = 0; i < cmd.sets.length; i++) {
      const set = cmd.sets[i];
      const setIdx = cmd.firstSet + i;
      const targetLayout = activePipeline?.reflectedBindGroupLayouts[setIdx] ?? set.layout.gpuLayout;
      const bg = this.ensureBindGroup(set, targetLayout);
      const dynCount = set.layout.bindings.filter((b) => isDynamicDescriptor(b.descriptorType)).length;
      const slice = cmd.dynamicOffsets.slice(dynOffsetCursor, dynOffsetCursor + dynCount);
      dynOffsetCursor += dynCount;
      pass.setBindGroup(setIdx, bg, slice);
      for (const [bindingIdx, b] of set.bindings.entries()) {
        const layoutBinding = set.layout.bindings.find((lb) => lb.binding === bindingIdx);
        const reflectedAccess = activePipeline?.storageAccess.get(`${setIdx}:${bindingIdx}`);
        const isWritableStorage =
          layoutBinding &&
          isStorageDescriptor(layoutBinding.descriptorType) &&
          (layoutBinding.stageFlags & VK_SHADER_STAGE.VERTEX) === 0 &&
          reflectedAccess !== "read-only-storage";
        if (isWritableStorage && b.buffer.memory?.hostData) {
          touchedHostMemories.add(b.buffer.memory);
        }
      }
    }
  }

  async vkQueueWaitIdle(_queue: VkHandle): Promise<VkResult> {
    await this.pendingWork;
    return VK_RESULT.VK_SUCCESS;
  }

  async vkDeviceWaitIdle(_device: VkHandle): Promise<VkResult> {
    await this.pendingWork;
    return VK_RESULT.VK_SUCCESS;
  }

  vkCreateRingMESA(ringId: bigint, info: VkRingCreateInfoMESA): void {
    this.rings.set(ringId, info);
  }

  vkDestroyRingMESA(ringId: bigint): void {
    this.rings.delete(ringId);
  }

  vkSetReplyCommandStreamMESA(resourceId: number, offset: bigint, size: bigint): void {
    this.replyStream = { resourceId, offset: Number(offset), size: Number(size), position: 0 };
  }

  vkSeekReplyCommandStreamMESA(position: bigint): void {
    if (this.replyStream) {
      this.replyStream.position = Number(position);
    }
  }

  getReplyStream(): { resourceId: number; offset: number; size: number; position: number } | null {
    return this.replyStream;
  }

  // Phase 2: Graphics & Presentation

  vkCreateImage(_device: VkHandle, info: VkImageCreateInfo, image: VkHandle): VkResult {
    const format = vkFormatToWebGpu(info.format);
    let usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    if (info.usage & VK_IMAGE_USAGE.SAMPLED) usage |= GPUTextureUsage.TEXTURE_BINDING;
    if (info.usage & VK_IMAGE_USAGE.STORAGE) usage |= GPUTextureUsage.STORAGE_BINDING;
    if (info.usage & (VK_IMAGE_USAGE.COLOR_ATTACHMENT | VK_IMAGE_USAGE.DEPTH_STENCIL_ATTACHMENT)) {
      usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    }
    const gpuTexture = this.device.createTexture({
      size: { width: info.width, height: info.height, depthOrArrayLayers: 1 },
      format,
      usage,
    });
    this.objects.images.set(image, {
      handle: image,
      format: info.format,
      width: info.width,
      height: info.height,
      usage: info.usage,
      gpuTexture,
      memory: null,
      memoryOffset: 0,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyImage(_device: VkHandle, image: VkHandle): void {
    const img = this.objects.images.get(image);
    if (img) {
      this.objects.images.delete(image);
      void this.pendingWork.catch(() => {}).then(() => img.gpuTexture.destroy());
    }
  }

  vkGetImageMemoryRequirements(_device: VkHandle, image: VkHandle): VkMemoryRequirements {
    const img = this.objects.images.get(image);
    const size = img ? BigInt(alignUp(img.width * img.height * 4, ALIGNMENT)) : 0n;
    return { size, alignment: BigInt(ALIGNMENT), memoryTypeBits: 0b11 };
  }

  vkBindImageMemory(_device: VkHandle, image: VkHandle, memory: VkHandle, offset: bigint): VkResult {
    const img = this.objects.images.get(image);
    const mem = this.objects.memories.get(memory);
    if (!img || !mem) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    img.memory = mem;
    img.memoryOffset = Number(offset);
    return VK_RESULT.VK_SUCCESS;
  }

  vkCreateImageView(_device: VkHandle, info: VkImageViewCreateInfo, view: VkHandle): VkResult {
    const img = this.objects.images.get(info.image);
    if (!img) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    const gpuView = img.gpuTexture.createView();
    this.objects.imageViews.set(view, { handle: view, image: img, format: info.format, gpuView });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyImageView(_device: VkHandle, view: VkHandle): void {
    this.objects.imageViews.delete(view);
  }

  vkCreateSampler(_device: VkHandle, info: VkSamplerCreateInfo, sampler: VkHandle): VkResult {
    const gpuSampler = this.device.createSampler({
      magFilter: info.magFilter === 0 ? "nearest" : "linear",
      minFilter: info.minFilter === 0 ? "nearest" : "linear",
    });
    this.objects.samplers.set(sampler, { handle: sampler, gpuSampler });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroySampler(_device: VkHandle, sampler: VkHandle): void {
    this.objects.samplers.delete(sampler);
  }

  vkCreateRenderPass(_device: VkHandle, info: VkRenderPassCreateInfo, renderPass: VkHandle): VkResult {
    this.objects.renderPasses.set(renderPass, { handle: renderPass, info });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyRenderPass(_device: VkHandle, renderPass: VkHandle): void {
    this.objects.renderPasses.delete(renderPass);
  }

  vkCreateFramebuffer(_device: VkHandle, info: VkFramebufferCreateInfo, framebuffer: VkHandle): VkResult {
    const rp = this.objects.renderPasses.get(info.renderPass);
    if (!rp) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    const attachments = info.attachments
      .map((h) => this.objects.imageViews.get(h))
      .filter((v): v is NonNullable<typeof v> => v !== undefined);
    this.objects.framebuffers.set(framebuffer, {
      handle: framebuffer,
      renderPass: rp,
      attachments,
      width: info.width,
      height: info.height,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkDestroyFramebuffer(_device: VkHandle, framebuffer: VkHandle): void {
    this.objects.framebuffers.delete(framebuffer);
  }

  vkCreateGraphicsPipelines(
    _device: VkHandle,
    info: VkGraphicsPipelineCreateInfo,
    pipeline: VkHandle,
  ): VkResult {
    const vs = this.objects.shaderModules.get(info.vertexShader);
    const fs = this.objects.shaderModules.get(info.fragmentShader);
    const layout = this.objects.pipelineLayouts.get(info.layout);
    const rp = this.objects.renderPasses.get(info.renderPass);
    if (!vs || !fs || !layout || !rp) {
      return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    }

    const buffers: GPUVertexBufferLayout[] = info.bindings.map((b) => ({
      arrayStride: b.stride,
      stepMode: "vertex",
      attributes: info.attributes
        .filter((a) => a.binding === b.binding)
        .map((a) => ({
          shaderLocation: a.location,
          offset: a.offset,
          format: vkVertexFormatToWebGpu(a.format),
        })),
    }));

    const colorFormat = rp.info.colorAttachment
      ? vkFormatToWebGpu(rp.info.colorAttachment.format)
      : "rgba8unorm";
    const depthFormat = rp.info.depthAttachment
      ? vkFormatToWebGpu(rp.info.depthAttachment.format)
      : undefined;

    const storageAccess = reflectStorageAccess([vs.wgsl, fs.wgsl]);
    const { bindGroupLayouts: reflectedBindGroupLayouts, pipelineLayout } = this.createReflectedLayouts(
      layout,
      storageAccess,
    );

    const gpuPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: vs.module,
        entryPoint: info.vertexEntry,
        buffers,
      },
      fragment: {
        module: fs.module,
        entryPoint: info.fragmentEntry,
        targets: [{ format: colorFormat }],
      },
      primitive: {
        topology: vkTopologyToWebGpu(info.topology),
        cullMode: vkCullModeToWebGpu(info.cullMode),
      },
      depthStencil: depthFormat
        ? {
            format: depthFormat,
            depthWriteEnabled: info.depthWriteEnable,
            depthCompare: info.depthTestEnable ? vkCompareOpToWebGpu(info.depthCompareOp) : "always",
          }
        : undefined,
    });

    this.objects.pipelines.set(pipeline, {
      handle: pipeline,
      kind: "graphics",
      layout,
      gpuPipeline,
      reflectedBindGroupLayouts,
      storageAccess,
    });
    return VK_RESULT.VK_SUCCESS;
  }

  vkCmdBeginRenderPass(
    commandBuffer: VkHandle,
    renderPassHandle: VkHandle,
    framebufferHandle: VkHandle,
    clearColor: [number, number, number, number],
    clearDepth: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const renderPass = this.objects.renderPasses.get(renderPassHandle);
    const framebuffer = this.objects.framebuffers.get(framebufferHandle);
    if (cb && renderPass && framebuffer) {
      cb.commands.push({ type: "beginRenderPass", renderPass, framebuffer, clearColor, clearDepth });
    }
  }

  vkCmdEndRenderPass(commandBuffer: VkHandle): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) cb.commands.push({ type: "endRenderPass" });
  }

  vkCmdSetViewport(
    commandBuffer: VkHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) cb.commands.push({ type: "setViewport", x, y, width, height, minDepth, maxDepth });
  }

  vkCmdSetScissor(commandBuffer: VkHandle, x: number, y: number, width: number, height: number): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) cb.commands.push({ type: "setScissor", x, y, width, height });
  }

  vkCmdBindVertexBuffers(
    commandBuffer: VkHandle,
    firstBinding: number,
    bufferHandles: VkHandle[],
    offsets: bigint[],
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (!cb) return;
    const buffers = bufferHandles
      .map((h) => this.objects.buffers.get(h))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    cb.commands.push({
      type: "bindVertexBuffers",
      firstBinding,
      buffers,
      offsets: offsets.map((o) => Number(o)),
    });
  }

  vkCmdBindIndexBuffer(commandBuffer: VkHandle, bufferHandle: VkHandle, offset: bigint, indexType: number): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const buffer = this.objects.buffers.get(bufferHandle);
    if (cb && buffer) {
      cb.commands.push({ type: "bindIndexBuffer", buffer, offset: Number(offset), indexType });
    }
  }

  vkCmdDraw(
    commandBuffer: VkHandle,
    vertexCount: number,
    instanceCount: number,
    firstVertex: number,
    firstInstance: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) cb.commands.push({ type: "draw", vertexCount, instanceCount, firstVertex, firstInstance });
  }

  vkCmdDrawIndexed(
    commandBuffer: VkHandle,
    indexCount: number,
    instanceCount: number,
    firstIndex: number,
    vertexOffset: number,
    firstInstance: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (cb) {
      cb.commands.push({ type: "drawIndexed", indexCount, instanceCount, firstIndex, vertexOffset, firstInstance });
    }
  }

  vkCmdCopyBufferToImage(
    commandBuffer: VkHandle,
    srcHandle: VkHandle,
    dstHandle: VkHandle,
    bufferOffset: bigint,
    width: number,
    height: number,
  ): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const src = this.objects.buffers.get(srcHandle);
    const dst = this.objects.images.get(dstHandle);
    if (cb && src && dst) {
      cb.commands.push({ type: "copyBufferToImage", src, dst, bufferOffset: Number(bufferOffset), width, height });
    }
  }

  async vkQueuePresentKHR(_queue: VkHandle, imageHandle: VkHandle): Promise<VkResult> {
    await this.pendingWork.catch(() => {});
    if (this.canvasContext) {
      this.presentImage(imageHandle, this.canvasContext);
    }
    return VK_RESULT.VK_SUCCESS;
  }

  presentImage(imageHandle: VkHandle, canvasContext: GPUCanvasContext): void {
    const img = this.objects.images.get(imageHandle);
    if (!img) return;
    const dstTexture = canvasContext.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: img.gpuTexture },
      { texture: dstTexture },
      {
        width: Math.min(img.width, dstTexture.width),
        height: Math.min(img.height, dstTexture.height),
        depthOrArrayLayers: 1,
      },
    );
    this.device.queue.submit([encoder.finish()]);
  }

  private createReflectedLayouts(
    layout: VenusPipelineLayout,
    storageAccess: Map<string, "read-only-storage" | "storage">,
  ): { bindGroupLayouts: GPUBindGroupLayout[]; pipelineLayout: GPUPipelineLayout } {
    const bindGroupLayouts = layout.setLayouts.map((setLayout, setIdx) => {
      const entries = setLayout.bindings.map((b) =>
        buildBindGroupLayoutEntry(b, storageAccess.get(`${setIdx}:${b.binding}`)),
      );
      return this.device.createBindGroupLayout({ entries });
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts });
    return { bindGroupLayouts, pipelineLayout };
  }

  private ensureBindGroup(
    set: VenusDescriptorSet,
    layout: GPUBindGroupLayout = set.layout.gpuLayout,
  ): GPUBindGroup {
    const cached = set.gpuBindGroupsByLayout.get(layout);
    if (cached) return cached;
    const entries: GPUBindGroupEntry[] = [];
    for (const [binding, info] of set.bindings.entries()) {
      if (!info.buffer.memory) {
        throw new Error(`Buffer ${info.buffer.handle} has no bound memory`);
      }
      entries.push({
        binding,
        resource: {
          buffer: info.buffer.memory.gpuBuffer,
          offset: info.buffer.memoryOffset + info.offset,
          size: info.range,
        },
      });
    }
    const bg = this.device.createBindGroup({
      layout,
      entries,
    });
    set.gpuBindGroupsByLayout.set(layout, bg);
    return bg;
  }

  private async readbackMemory(mem: VenusDeviceMemory): Promise<void> {
    if (!mem.hostData) return;
    const staging = this.device.createBuffer({
      size: mem.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(mem.gpuBuffer, 0, staging, 0, mem.size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    mem.hostData.set(mapped);
    staging.unmap();
    staging.destroy();
    mem.needsReadback = false;
  }
}
