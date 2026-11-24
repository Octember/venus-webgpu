import {
  VK_DESCRIPTOR_TYPE,
  VK_MEMORY_PROPERTY,
  VK_PHYSICAL_DEVICE_TYPE,
  VK_QUEUE_FLAGS,
  VK_RESULT,
  type VkResult,
} from "../protocol/constants.ts";
import type {
  VenusCommandHandler,
  VkDescriptorSetLayoutBinding,
  VkHandle,
  VkMappedMemoryRange,
  VkMemoryRequirements,
  VkPhysicalDeviceMemoryProperties,
  VkPhysicalDeviceProperties,
  VkQueueFamilyProperties,
  VkRingCreateInfoMESA,
  VkSubmitInfo,
  VkWriteDescriptorSet,
} from "../protocol/types.ts";
import { SpirvTranslator } from "../shader/spirv.ts";
import { VenusObjectTable, type VenusDescriptorSet, type VenusDeviceMemory } from "./objects.ts";

const DEFAULT_PHYS_DEVICE_HANDLE = 0x1000n;
const ALIGNMENT = 256;

function alignUp(n: number, align: number): number {
  return (n + align - 1) & ~(align - 1);
}

export interface WebGpuVenusBackendOptions {
  device: GPUDevice;
  translator?: SpirvTranslator;
}

export class WebGpuVenusBackend implements VenusCommandHandler {
  readonly device: GPUDevice;
  readonly translator: SpirvTranslator;
  readonly objects = new VenusObjectTable();
  private pendingWork: Promise<void> = Promise.resolve();
  private readonly rings = new Map<bigint, VkRingCreateInfoMESA>();

  constructor(opts: WebGpuVenusBackendOptions) {
    this.device = opts.device;
    this.translator = opts.translator ?? new SpirvTranslator();
  }

  /** Expose host-visible backing memory for direct guest/test reads & writes. */
  getMemoryHostData(memory: VkHandle): Uint8Array | null {
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
        queueFlags: VK_QUEUE_FLAGS.COMPUTE | VK_QUEUE_FLAGS.TRANSFER,
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
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
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
      mem.gpuBuffer.destroy();
      this.objects.memories.delete(memory);
    }
  }

  vkMapMemory(_device: VkHandle, memory: VkHandle, offset: bigint, size: bigint): VkResult {
    const mem = this.objects.memories.get(memory);
    if (!mem || !mem.hostData) return VK_RESULT.VK_ERROR_MEMORY_MAP_FAILED;
    mem.mappedOffset = Number(offset);
    mem.mappedSize = size === 0xffffffffffffffffn ? mem.size - mem.mappedOffset : Number(size);
    mem.dirty = true;
    return VK_RESULT.VK_SUCCESS;
  }

  vkUnmapMemory(_device: VkHandle, memory: VkHandle): void {
    const mem = this.objects.memories.get(memory);
    if (mem && mem.hostData) {
      mem.dirty = true;
    }
  }

  vkFlushMappedMemoryRanges(_device: VkHandle, ranges: VkMappedMemoryRange[]): VkResult {
    for (const r of ranges) {
      const mem = this.objects.memories.get(r.memory);
      if (mem?.hostData) {
        const off = Number(r.offset);
        const len = r.size === 0xffffffffffffffffn ? mem.size - off : alignUp(Number(r.size), 4);
        this.device.queue.writeBuffer(mem.gpuBuffer, off, mem.hostData as Uint8Array<ArrayBuffer>, off, Math.min(len, mem.size - off));
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
    const entries: GPUBindGroupLayoutEntry[] = bindings.map((b) => ({
      binding: b.binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type:
          b.descriptorType === VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER ||
          b.descriptorType === VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER_DYNAMIC
            ? "uniform"
            : "storage",
      },
    }));
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
    const gpuPipeline = this.device.createComputePipeline({
      layout: layout.gpuLayout,
      compute: { module: mod.module, entryPoint },
    });
    this.objects.pipelines.set(pipeline, { handle: pipeline, layout, gpuPipeline });
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
        gpuBindGroup: null,
        dirty: true,
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
        const range =
          info.range === 0xffffffffffffffffn ? buf.size - Number(info.offset) : Number(info.range);
        set.bindings.set(w.dstBinding + i, {
          buffer: buf,
          offset: Number(info.offset),
          range,
        });
        set.dirty = true;
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
      this.objects.commandBuffers.set(handle, { handle, recording: false, commands: [] });
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
    cb.recording = true;
    cb.commands = [];
    return VK_RESULT.VK_SUCCESS;
  }

  vkEndCommandBuffer(commandBuffer: VkHandle): VkResult {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    if (!cb) return VK_RESULT.VK_ERROR_INITIALIZATION_FAILED;
    cb.recording = false;
    return VK_RESULT.VK_SUCCESS;
  }

  vkCmdBindPipeline(commandBuffer: VkHandle, _pipelineBindPoint: number, pipelineHandle: VkHandle): void {
    const cb = this.objects.commandBuffers.get(commandBuffer);
    const pipeline = this.objects.pipelines.get(pipelineHandle);
    if (cb && pipeline) cb.commands.push({ type: "bindPipeline", pipeline });
  }

  vkCmdBindDescriptorSets(
    commandBuffer: VkHandle,
    _pipelineBindPoint: number,
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
    cb.commands.push({ type: "bindDescriptorSets", firstSet, sets, dynamicOffsets });
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
      cb.commands.push({
        type: "fillBuffer",
        dst,
        dstOffset: Number(dstOffset),
        size: Number(size),
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
    _waitAll: boolean,
    _timeout: bigint,
  ): Promise<VkResult> {
    await this.pendingWork;
    for (const h of fences) {
      const f = this.objects.fences.get(h);
      if (f) f.signaled = true;
    }
    return VK_RESULT.VK_SUCCESS;
  }

  vkQueueSubmit(_queue: VkHandle, submits: VkSubmitInfo[], fenceHandle: VkHandle): VkResult {
    // Flush any dirty host-visible memory to GPU before encoding.
    for (const mem of this.objects.memories.values()) {
      if (mem.hostData && mem.dirty) {
        this.device.queue.writeBuffer(mem.gpuBuffer, 0, mem.hostData as Uint8Array<ArrayBuffer>);
        mem.dirty = false;
      }
    }

    const encoder = this.device.createCommandEncoder();
    const touchedHostMemories = new Set<VenusDeviceMemory>();

    for (const submit of submits) {
      for (const cbHandle of submit.commandBuffers) {
        const cb = this.objects.commandBuffers.get(cbHandle);
        if (!cb) continue;

        let pass: GPUComputePassEncoder | null = null;
        const endPass = () => {
          if (pass) {
            pass.end();
            pass = null;
          }
        };
        const ensurePass = () => {
          if (!pass) pass = encoder.beginComputePass();
          return pass;
        };

        for (const cmd of cb.commands) {
          switch (cmd.type) {
            case "bindPipeline": {
              ensurePass().setPipeline(cmd.pipeline.gpuPipeline);
              break;
            }
            case "bindDescriptorSets": {
              const p = ensurePass();
              for (let i = 0; i < cmd.sets.length; i++) {
                const set = cmd.sets[i];
                const bg = this.ensureBindGroup(set);
                p.setBindGroup(cmd.firstSet + i, bg, cmd.dynamicOffsets);
                for (const b of set.bindings.values()) {
                  if (b.buffer.memory?.hostData) {
                    touchedHostMemories.add(b.buffer.memory);
                  }
                }
              }
              break;
            }
            case "dispatch": {
              ensurePass().dispatchWorkgroups(cmd.x, cmd.y, cmd.z);
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
              if (cmd.dst.memory) {
                const words = new Uint32Array(cmd.size >>> 2);
                words.fill(cmd.data >>> 0);
                this.device.queue.writeBuffer(
                  cmd.dst.memory.gpuBuffer,
                  cmd.dst.memoryOffset + cmd.dstOffset,
                  words,
                );
              }
              break;
            }
          }
        }
        endPass();
      }
    }

    this.device.queue.submit([encoder.finish()]);

    for (const mem of touchedHostMemories) {
      mem.needsReadback = true;
    }

    const work = (async () => {
      if (typeof this.device.queue.onSubmittedWorkDone === "function") {
        await this.device.queue.onSubmittedWorkDone();
      }
      for (const mem of touchedHostMemories) {
        await this.readbackMemory(mem);
      }
      if (fenceHandle !== 0n) {
        const f = this.objects.fences.get(fenceHandle);
        if (f) f.signaled = true;
      }
    })();

    this.pendingWork = this.pendingWork.then(() => work);
    return VK_RESULT.VK_SUCCESS;
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

  private ensureBindGroup(set: VenusDescriptorSet): GPUBindGroup {
    if (set.gpuBindGroup && !set.dirty) return set.gpuBindGroup;
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
    set.gpuBindGroup = this.device.createBindGroup({
      layout: set.layout.gpuLayout,
      entries,
    });
    set.dirty = false;
    return set.gpuBindGroup;
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
