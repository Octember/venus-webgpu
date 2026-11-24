import { VK_COMMAND_GENERATE_REPLY_BIT_EXT, VK_COMMAND_TYPE } from "./constants.ts";
import type {
  VkDescriptorSetLayoutBinding,
  VkHandle,
  VkMappedMemoryRange,
  VkSubmitInfo,
  VkWriteDescriptorSet,
} from "./types.ts";
import { VenusCsEncoder } from "./wire.ts";

/**
 * Encodes Phase 1 Venus wire-protocol command packets.
 * Used by tests and the browser demo to produce authentic Venus streams.
 */
export class VenusCommandEncoder {
  readonly cs = new VenusCsEncoder();

  private header(type: number, reply = false): void {
    this.cs.writeU32(type);
    this.cs.writeU32(reply ? VK_COMMAND_GENERATE_REPLY_BIT_EXT : 0);
  }

  vkCreateInstance(instance: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateInstance, reply);
    this.cs.writeHandle(instance);
  }

  vkDestroyInstance(instance: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkDestroyInstance, reply);
    this.cs.writeHandle(instance);
  }

  vkEnumeratePhysicalDevices(instance: VkHandle, maxCount = 1, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkEnumeratePhysicalDevices, reply);
    this.cs.writeHandle(instance);
    this.cs.writeU32(maxCount);
  }

  vkCreateDevice(physicalDevice: VkHandle, device: VkHandle, queueFamilyIndex = 0, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateDevice, reply);
    this.cs.writeHandle(physicalDevice);
    this.cs.writeHandle(device);
    this.cs.writeU32(queueFamilyIndex);
  }

  vkDestroyDevice(device: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkDestroyDevice, reply);
    this.cs.writeHandle(device);
  }

  vkGetDeviceQueue(device: VkHandle, queueFamilyIndex: number, queueIndex: number, queue: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkGetDeviceQueue, false);
    this.cs.writeHandle(device);
    this.cs.writeU32(queueFamilyIndex);
    this.cs.writeU32(queueIndex);
    this.cs.writeHandle(queue);
  }

  vkAllocateMemory(
    device: VkHandle,
    allocationSize: bigint,
    memoryTypeIndex: number,
    memory: VkHandle,
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkAllocateMemory, reply);
    this.cs.writeHandle(device);
    this.cs.writeU64(allocationSize);
    this.cs.writeU32(memoryTypeIndex);
    this.cs.writeHandle(memory);
  }

  vkFreeMemory(device: VkHandle, memory: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkFreeMemory, false);
    this.cs.writeHandle(device);
    this.cs.writeHandle(memory);
  }

  vkMapMemory(device: VkHandle, memory: VkHandle, offset: bigint, size: bigint, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkMapMemory, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(memory);
    this.cs.writeU64(offset);
    this.cs.writeU64(size);
  }

  vkUnmapMemory(device: VkHandle, memory: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkUnmapMemory, false);
    this.cs.writeHandle(device);
    this.cs.writeHandle(memory);
  }

  vkFlushMappedMemoryRanges(device: VkHandle, ranges: VkMappedMemoryRange[], reply = true): void {
    this.header(VK_COMMAND_TYPE.vkFlushMappedMemoryRanges, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(ranges.length);
    for (const r of ranges) {
      this.cs.writeHandle(r.memory);
      this.cs.writeU64(r.offset);
      this.cs.writeU64(r.size);
    }
  }

  vkInvalidateMappedMemoryRanges(device: VkHandle, ranges: VkMappedMemoryRange[], reply = true): void {
    this.header(VK_COMMAND_TYPE.vkInvalidateMappedMemoryRanges, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(ranges.length);
    for (const r of ranges) {
      this.cs.writeHandle(r.memory);
      this.cs.writeU64(r.offset);
      this.cs.writeU64(r.size);
    }
  }

  vkCreateBuffer(device: VkHandle, size: bigint, usage: number, buffer: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateBuffer, reply);
    this.cs.writeHandle(device);
    this.cs.writeU64(size);
    this.cs.writeU32(usage);
    this.cs.writeHandle(buffer);
  }

  vkDestroyBuffer(device: VkHandle, buffer: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyBuffer, false);
    this.cs.writeHandle(device);
    this.cs.writeHandle(buffer);
  }

  vkGetBufferMemoryRequirements(device: VkHandle, buffer: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkGetBufferMemoryRequirements, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(buffer);
  }

  vkBindBufferMemory(
    device: VkHandle,
    buffer: VkHandle,
    memory: VkHandle,
    memoryOffset: bigint,
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkBindBufferMemory, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(buffer);
    this.cs.writeHandle(memory);
    this.cs.writeU64(memoryOffset);
  }

  vkCreateShaderModule(device: VkHandle, code: Uint32Array, shaderModule: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateShaderModule, reply);
    this.cs.writeHandle(device);
    this.cs.writeArraySize(code.byteLength);
    this.cs.writeU32Array(code);
    this.cs.writeHandle(shaderModule);
  }

  vkDestroyShaderModule(device: VkHandle, shaderModule: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyShaderModule, false);
    this.cs.writeHandle(device);
    this.cs.writeHandle(shaderModule);
  }

  vkCreateDescriptorSetLayout(
    device: VkHandle,
    bindings: VkDescriptorSetLayoutBinding[],
    layout: VkHandle,
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCreateDescriptorSetLayout, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(bindings.length);
    for (const b of bindings) {
      this.cs.writeU32(b.binding);
      this.cs.writeU32(b.descriptorType);
      this.cs.writeU32(b.descriptorCount);
      this.cs.writeU32(b.stageFlags);
    }
    this.cs.writeHandle(layout);
  }

  vkCreatePipelineLayout(device: VkHandle, setLayouts: VkHandle[], pipelineLayout: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreatePipelineLayout, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(setLayouts.length);
    for (const l of setLayouts) this.cs.writeHandle(l);
    this.cs.writeHandle(pipelineLayout);
  }

  vkCreateComputePipelines(
    device: VkHandle,
    module: VkHandle,
    entryPoint: string,
    layout: VkHandle,
    pipeline: VkHandle,
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCreateComputePipelines, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(1);
    this.cs.writeHandle(module);
    this.cs.writeString(entryPoint);
    this.cs.writeHandle(layout);
    this.cs.writeHandle(pipeline);
  }

  vkCreateDescriptorPool(device: VkHandle, pool: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateDescriptorPool, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(pool);
  }

  vkAllocateDescriptorSets(
    device: VkHandle,
    pool: VkHandle,
    setLayouts: VkHandle[],
    descriptorSets: VkHandle[],
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkAllocateDescriptorSets, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(pool);
    this.cs.writeU32(setLayouts.length);
    for (const l of setLayouts) this.cs.writeHandle(l);
    for (const s of descriptorSets) this.cs.writeHandle(s);
  }

  vkUpdateDescriptorSets(device: VkHandle, writes: VkWriteDescriptorSet[]): void {
    this.header(VK_COMMAND_TYPE.vkUpdateDescriptorSets, false);
    this.cs.writeHandle(device);
    this.cs.writeU32(writes.length);
    for (const w of writes) {
      this.cs.writeHandle(w.dstSet);
      this.cs.writeU32(w.dstBinding);
      this.cs.writeU32(w.dstArrayElement);
      this.cs.writeU32(w.descriptorCount);
      this.cs.writeU32(w.descriptorType);
      for (const info of w.bufferInfos) {
        this.cs.writeHandle(info.buffer);
        this.cs.writeU64(info.offset);
        this.cs.writeU64(info.range);
      }
    }
  }

  vkCreateCommandPool(device: VkHandle, queueFamilyIndex: number, pool: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateCommandPool, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(queueFamilyIndex);
    this.cs.writeHandle(pool);
  }

  vkAllocateCommandBuffers(
    device: VkHandle,
    pool: VkHandle,
    commandBuffers: VkHandle[],
    reply = true,
  ): void {
    this.header(VK_COMMAND_TYPE.vkAllocateCommandBuffers, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(pool);
    this.cs.writeU32(commandBuffers.length);
    for (const cb of commandBuffers) this.cs.writeHandle(cb);
  }

  vkBeginCommandBuffer(commandBuffer: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkBeginCommandBuffer, reply);
    this.cs.writeHandle(commandBuffer);
  }

  vkEndCommandBuffer(commandBuffer: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkEndCommandBuffer, reply);
    this.cs.writeHandle(commandBuffer);
  }

  vkCmdBindPipeline(commandBuffer: VkHandle, bindPoint: number, pipeline: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkCmdBindPipeline, false);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(bindPoint);
    this.cs.writeHandle(pipeline);
  }

  vkCmdBindDescriptorSets(
    commandBuffer: VkHandle,
    bindPoint: number,
    layout: VkHandle,
    firstSet: number,
    descriptorSets: VkHandle[],
    dynamicOffsets: number[] = [],
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdBindDescriptorSets, false);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(bindPoint);
    this.cs.writeHandle(layout);
    this.cs.writeU32(firstSet);
    this.cs.writeU32(descriptorSets.length);
    for (const s of descriptorSets) this.cs.writeHandle(s);
    this.cs.writeU32(dynamicOffsets.length);
    for (const o of dynamicOffsets) this.cs.writeU32(o);
  }

  vkCmdDispatch(commandBuffer: VkHandle, x: number, y: number, z: number): void {
    this.header(VK_COMMAND_TYPE.vkCmdDispatch, false);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(x);
    this.cs.writeU32(y);
    this.cs.writeU32(z);
  }

  vkCmdCopyBuffer(
    commandBuffer: VkHandle,
    src: VkHandle,
    dst: VkHandle,
    srcOffset: bigint,
    dstOffset: bigint,
    size: bigint,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdCopyBuffer, false);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeHandle(src);
    this.cs.writeHandle(dst);
    this.cs.writeU64(srcOffset);
    this.cs.writeU64(dstOffset);
    this.cs.writeU64(size);
  }

  vkCreateFence(device: VkHandle, signaled: boolean, fence: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkCreateFence, reply);
    this.cs.writeHandle(device);
    this.cs.writeBool32(signaled);
    this.cs.writeHandle(fence);
  }

  vkWaitForFences(device: VkHandle, fences: VkHandle[], waitAll: boolean, timeout: bigint, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkWaitForFences, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(fences.length);
    for (const f of fences) this.cs.writeHandle(f);
    this.cs.writeBool32(waitAll);
    this.cs.writeU64(timeout);
  }

  vkQueueSubmit(queue: VkHandle, submits: VkSubmitInfo[], fence: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkQueueSubmit, reply);
    this.cs.writeHandle(queue);
    this.cs.writeU32(submits.length);
    for (const s of submits) {
      this.cs.writeU32(s.waitSemaphores.length);
      for (const w of s.waitSemaphores) this.cs.writeHandle(w);
      this.cs.writeU32(s.commandBuffers.length);
      for (const cb of s.commandBuffers) this.cs.writeHandle(cb);
      this.cs.writeU32(s.signalSemaphores.length);
      for (const sig of s.signalSemaphores) this.cs.writeHandle(sig);
    }
    this.cs.writeHandle(fence);
  }

  vkQueueWaitIdle(queue: VkHandle, reply = true): void {
    this.header(VK_COMMAND_TYPE.vkQueueWaitIdle, reply);
    this.cs.writeHandle(queue);
  }

  finish(): Uint8Array {
    return this.cs.finish();
  }
}
