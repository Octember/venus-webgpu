import {
  VK_COMMAND_GENERATE_REPLY_BIT_EXT,
  VK_COMMAND_TYPE,
  VK_RESULT,
} from "./constants.ts";
import type {
  VenusCommandHandler,
  VkDescriptorSetLayoutBinding,
  VkHandle,
  VkMappedMemoryRange,
  VkSubmitInfo,
  VkWriteDescriptorSet,
} from "./types.ts";
import { VenusCsDecoder, VenusCsEncoder } from "./wire.ts";

/**
 * Decodes a Venus command stream and dispatches each command to a
 * VenusCommandHandler, writing replies to a VenusCsEncoder when
 * VK_COMMAND_GENERATE_REPLY_BIT_EXT is set.
 */
export class VenusCommandDecoder {
  private readonly handler: VenusCommandHandler;

  constructor(handler: VenusCommandHandler) {
    this.handler = handler;
  }

  async execute(stream: Uint8Array, replyEncoder?: VenusCsEncoder): Promise<Uint8Array> {
    const dec = new VenusCsDecoder(stream);
    const reply = replyEncoder ?? new VenusCsEncoder();

    while (dec.remaining >= 8) {
      const commandType = dec.readU32();
      const commandFlags = dec.readU32();
      const wantsReply = (commandFlags & VK_COMMAND_GENERATE_REPLY_BIT_EXT) !== 0;

      await this.dispatch(commandType, commandFlags, wantsReply, dec, reply);
    }

    return reply.finish();
  }

  private writeReplyHeader(reply: VenusCsEncoder, commandType: number, commandFlags: number): void {
    reply.writeU32(commandType);
    reply.writeU32(commandFlags);
  }

  private replyResult(
    reply: VenusCsEncoder,
    commandType: number,
    commandFlags: number,
    wantsReply: boolean,
    result: number,
  ): void {
    if (wantsReply) {
      this.writeReplyHeader(reply, commandType, commandFlags);
      reply.writeI32(result);
    }
  }

  private replyVoid(
    reply: VenusCsEncoder,
    commandType: number,
    commandFlags: number,
    wantsReply: boolean,
  ): void {
    if (wantsReply) {
      this.writeReplyHeader(reply, commandType, commandFlags);
    }
  }

  private readHandles(dec: VenusCsDecoder): VkHandle[] {
    const count = dec.readU32();
    const handles: VkHandle[] = [];
    for (let i = 0; i < count; i++) handles.push(dec.readHandle());
    return handles;
  }

  private readMappedMemoryRanges(dec: VenusCsDecoder): VkMappedMemoryRange[] {
    const count = dec.readU32();
    const ranges: VkMappedMemoryRange[] = [];
    for (let i = 0; i < count; i++) {
      ranges.push({
        memory: dec.readHandle(),
        offset: dec.readU64(),
        size: dec.readU64(),
      });
    }
    return ranges;
  }

  private async dispatch(
    type: number,
    flags: number,
    wantsReply: boolean,
    dec: VenusCsDecoder,
    reply: VenusCsEncoder,
  ): Promise<void> {
    switch (type) {
      case VK_COMMAND_TYPE.vkCreateInstance: {
        const instance = dec.readHandle();
        const res = this.handler.vkCreateInstance(instance);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyInstance: {
        const instance = dec.readHandle();
        this.handler.vkDestroyInstance(instance);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkEnumeratePhysicalDevices: {
        const instance = dec.readHandle();
        const maxCount = dec.readU32();
        const { result, physicalDevices } = this.handler.vkEnumeratePhysicalDevices(instance);
        const count = Math.min(maxCount || physicalDevices.length, physicalDevices.length);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(result);
          reply.writeU32(count);
          reply.writeArraySize(count);
          for (let i = 0; i < count; i++) {
            reply.writeHandle(physicalDevices[i]);
          }
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetPhysicalDeviceProperties: {
        const phys = dec.readHandle();
        const props = this.handler.vkGetPhysicalDeviceProperties(phys);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeU32(props.apiVersion);
          reply.writeU32(props.driverVersion);
          reply.writeU32(props.vendorID);
          reply.writeU32(props.deviceID);
          reply.writeU32(props.deviceType);
          reply.writeString(props.deviceName);
          reply.writeU32(props.minStorageBufferOffsetAlignment);
          reply.writeU32(props.maxComputeWorkGroupCount[0]);
          reply.writeU32(props.maxComputeWorkGroupCount[1]);
          reply.writeU32(props.maxComputeWorkGroupCount[2]);
          reply.writeU32(props.maxComputeWorkGroupInvocations);
          reply.writeU32(props.maxComputeWorkGroupSize[0]);
          reply.writeU32(props.maxComputeWorkGroupSize[1]);
          reply.writeU32(props.maxComputeWorkGroupSize[2]);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetPhysicalDeviceQueueFamilyProperties: {
        const phys = dec.readHandle();
        const families = this.handler.vkGetPhysicalDeviceQueueFamilyProperties(phys);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeU32(families.length);
          reply.writeArraySize(families.length);
          for (const f of families) {
            reply.writeU32(f.queueFlags);
            reply.writeU32(f.queueCount);
            reply.writeU32(f.timestampValidBits);
          }
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetPhysicalDeviceMemoryProperties: {
        const phys = dec.readHandle();
        const mem = this.handler.vkGetPhysicalDeviceMemoryProperties(phys);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeU32(mem.memoryTypes.length);
          for (const t of mem.memoryTypes) {
            reply.writeU32(t.propertyFlags);
            reply.writeU32(t.heapIndex);
          }
          reply.writeU32(mem.memoryHeaps.length);
          for (const h of mem.memoryHeaps) {
            reply.writeU64(h.size);
            reply.writeU32(h.flags);
          }
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateDevice: {
        const phys = dec.readHandle();
        const device = dec.readHandle();
        const queueFamilyIndex = dec.readU32();
        const res = this.handler.vkCreateDevice(phys, device, queueFamilyIndex);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyDevice: {
        const device = dec.readHandle();
        this.handler.vkDestroyDevice(device);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetDeviceQueue: {
        const device = dec.readHandle();
        const queueFamilyIndex = dec.readU32();
        const queueIndex = dec.readU32();
        const queue = dec.readHandle();
        this.handler.vkGetDeviceQueue(device, queueFamilyIndex, queueIndex, queue);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkAllocateMemory: {
        const device = dec.readHandle();
        const allocationSize = dec.readU64();
        const memoryTypeIndex = dec.readU32();
        const memory = dec.readHandle();
        const res = this.handler.vkAllocateMemory(device, allocationSize, memoryTypeIndex, memory);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkFreeMemory: {
        const device = dec.readHandle();
        const memory = dec.readHandle();
        this.handler.vkFreeMemory(device, memory);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkMapMemory: {
        const device = dec.readHandle();
        const memory = dec.readHandle();
        const offset = dec.readU64();
        const size = dec.readU64();
        const res = this.handler.vkMapMemory(device, memory, offset, size);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkUnmapMemory: {
        const device = dec.readHandle();
        const memory = dec.readHandle();
        this.handler.vkUnmapMemory(device, memory);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkFlushMappedMemoryRanges: {
        const device = dec.readHandle();
        const count = dec.readU32();
        const ranges: VkMappedMemoryRange[] = [];
        for (let i = 0; i < count; i++) {
          ranges.push({
            memory: dec.readHandle(),
            offset: dec.readU64(),
            size: dec.readU64(),
          });
        }
        const res = this.handler.vkFlushMappedMemoryRanges(device, ranges);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkInvalidateMappedMemoryRanges: {
        const device = dec.readHandle();
        const count = dec.readU32();
        const ranges: VkMappedMemoryRange[] = [];
        for (let i = 0; i < count; i++) {
          ranges.push({
            memory: dec.readHandle(),
            offset: dec.readU64(),
            size: dec.readU64(),
          });
        }
        const res = await this.handler.vkInvalidateMappedMemoryRanges(device, ranges);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateBuffer: {
        const device = dec.readHandle();
        const size = dec.readU64();
        const usage = dec.readU32();
        const buffer = dec.readHandle();
        const res = this.handler.vkCreateBuffer(device, size, usage, buffer);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyBuffer: {
        const device = dec.readHandle();
        const buffer = dec.readHandle();
        this.handler.vkDestroyBuffer(device, buffer);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetBufferMemoryRequirements: {
        const device = dec.readHandle();
        const buffer = dec.readHandle();
        const reqs = this.handler.vkGetBufferMemoryRequirements(device, buffer);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeU64(reqs.size);
          reply.writeU64(reqs.alignment);
          reply.writeU32(reqs.memoryTypeBits);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkBindBufferMemory: {
        const device = dec.readHandle();
        const buffer = dec.readHandle();
        const memory = dec.readHandle();
        const memoryOffset = dec.readU64();
        const res = this.handler.vkBindBufferMemory(device, buffer, memory, memoryOffset);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateShaderModule: {
        const device = dec.readHandle();
        const codeSize = dec.readArraySize();
        const wordCount = codeSize >>> 2;
        const code = dec.readU32Array(wordCount);
        const shaderModule = dec.readHandle();
        const res = await this.handler.vkCreateShaderModule(device, code, shaderModule);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyShaderModule: {
        const device = dec.readHandle();
        const shaderModule = dec.readHandle();
        this.handler.vkDestroyShaderModule(device, shaderModule);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateDescriptorSetLayout: {
        const device = dec.readHandle();
        const bindingCount = dec.readU32();
        const bindings: VkDescriptorSetLayoutBinding[] = [];
        for (let i = 0; i < bindingCount; i++) {
          bindings.push({
            binding: dec.readU32(),
            descriptorType: dec.readU32(),
            descriptorCount: dec.readU32(),
            stageFlags: dec.readU32(),
          });
        }
        const layout = dec.readHandle();
        const res = this.handler.vkCreateDescriptorSetLayout(device, bindings, layout);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyDescriptorSetLayout: {
        const device = dec.readHandle();
        const layout = dec.readHandle();
        this.handler.vkDestroyDescriptorSetLayout(device, layout);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreatePipelineLayout: {
        const device = dec.readHandle();
        const count = dec.readU32();
        const setLayouts: VkHandle[] = [];
        for (let i = 0; i < count; i++) setLayouts.push(dec.readHandle());
        const pipelineLayout = dec.readHandle();
        const res = this.handler.vkCreatePipelineLayout(device, setLayouts, pipelineLayout);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyPipelineLayout: {
        const device = dec.readHandle();
        const pipelineLayout = dec.readHandle();
        this.handler.vkDestroyPipelineLayout(device, pipelineLayout);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateComputePipelines: {
        const device = dec.readHandle();
        const count = dec.readU32();
        let res: number = VK_RESULT.VK_SUCCESS;
        for (let i = 0; i < count; i++) {
          const module = dec.readHandle();
          const entryPoint = dec.readString();
          const layout = dec.readHandle();
          const pipeline = dec.readHandle();
          res = this.handler.vkCreateComputePipelines(device, module, entryPoint, layout, pipeline);
        }
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyPipeline: {
        const device = dec.readHandle();
        const pipeline = dec.readHandle();
        this.handler.vkDestroyPipeline(device, pipeline);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateDescriptorPool: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        const res = this.handler.vkCreateDescriptorPool(device, pool);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyDescriptorPool: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        this.handler.vkDestroyDescriptorPool(device, pool);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkAllocateDescriptorSets: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        const count = dec.readU32();
        const setLayouts: VkHandle[] = [];
        for (let i = 0; i < count; i++) setLayouts.push(dec.readHandle());
        const descriptorSets: VkHandle[] = [];
        for (let i = 0; i < count; i++) descriptorSets.push(dec.readHandle());
        const res = this.handler.vkAllocateDescriptorSets(device, pool, setLayouts, descriptorSets);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkUpdateDescriptorSets: {
        const device = dec.readHandle();
        const writeCount = dec.readU32();
        const writes: VkWriteDescriptorSet[] = [];
        for (let i = 0; i < writeCount; i++) {
          const dstSet = dec.readHandle();
          const dstBinding = dec.readU32();
          const dstArrayElement = dec.readU32();
          const descriptorCount = dec.readU32();
          const descriptorType = dec.readU32();
          const bufferInfos = [];
          for (let j = 0; j < descriptorCount; j++) {
            bufferInfos.push({
              buffer: dec.readHandle(),
              offset: dec.readU64(),
              range: dec.readU64(),
            });
          }
          writes.push({ dstSet, dstBinding, dstArrayElement, descriptorCount, descriptorType, bufferInfos });
        }
        this.handler.vkUpdateDescriptorSets(device, writes);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateCommandPool: {
        const device = dec.readHandle();
        const queueFamilyIndex = dec.readU32();
        const pool = dec.readHandle();
        const res = this.handler.vkCreateCommandPool(device, queueFamilyIndex, pool);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyCommandPool: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        this.handler.vkDestroyCommandPool(device, pool);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkAllocateCommandBuffers: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        const count = dec.readU32();
        const commandBuffers: VkHandle[] = [];
        for (let i = 0; i < count; i++) commandBuffers.push(dec.readHandle());
        const res = this.handler.vkAllocateCommandBuffers(device, pool, commandBuffers);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkFreeCommandBuffers: {
        const device = dec.readHandle();
        const pool = dec.readHandle();
        const count = dec.readU32();
        const commandBuffers: VkHandle[] = [];
        for (let i = 0; i < count; i++) commandBuffers.push(dec.readHandle());
        this.handler.vkFreeCommandBuffers(device, pool, commandBuffers);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkBeginCommandBuffer: {
        const cmd = dec.readHandle();
        const res = this.handler.vkBeginCommandBuffer(cmd);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkEndCommandBuffer: {
        const cmd = dec.readHandle();
        const res = this.handler.vkEndCommandBuffer(cmd);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCmdBindPipeline: {
        const cmd = dec.readHandle();
        const bindPoint = dec.readU32();
        const pipeline = dec.readHandle();
        this.handler.vkCmdBindPipeline(cmd, bindPoint, pipeline);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdBindDescriptorSets: {
        const cmd = dec.readHandle();
        const bindPoint = dec.readU32();
        const layout = dec.readHandle();
        const firstSet = dec.readU32();
        const setCount = dec.readU32();
        const sets: VkHandle[] = [];
        for (let i = 0; i < setCount; i++) sets.push(dec.readHandle());
        const dynCount = dec.readU32();
        const dynOffsets: number[] = [];
        for (let i = 0; i < dynCount; i++) dynOffsets.push(dec.readU32());
        this.handler.vkCmdBindDescriptorSets(cmd, bindPoint, layout, firstSet, sets, dynOffsets);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdDispatch: {
        const cmd = dec.readHandle();
        const x = dec.readU32();
        const y = dec.readU32();
        const z = dec.readU32();
        this.handler.vkCmdDispatch(cmd, x, y, z);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdCopyBuffer: {
        const cmd = dec.readHandle();
        const src = dec.readHandle();
        const dst = dec.readHandle();
        const srcOffset = dec.readU64();
        const dstOffset = dec.readU64();
        const size = dec.readU64();
        this.handler.vkCmdCopyBuffer(cmd, src, dst, srcOffset, dstOffset, size);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdFillBuffer: {
        const cmd = dec.readHandle();
        const dst = dec.readHandle();
        const dstOffset = dec.readU64();
        const size = dec.readU64();
        const data = dec.readU32();
        this.handler.vkCmdFillBuffer(cmd, dst, dstOffset, size, data);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdPipelineBarrier: {
        const cmd = dec.readHandle();
        this.handler.vkCmdPipelineBarrier(cmd);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateFence: {
        const device = dec.readHandle();
        const signaled = dec.readBool32();
        const fence = dec.readHandle();
        const res = this.handler.vkCreateFence(device, signaled, fence);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyFence: {
        const device = dec.readHandle();
        const fence = dec.readHandle();
        this.handler.vkDestroyFence(device, fence);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkResetFences: {
        const device = dec.readHandle();
        const count = dec.readU32();
        const fences: VkHandle[] = [];
        for (let i = 0; i < count; i++) fences.push(dec.readHandle());
        const res = this.handler.vkResetFences(device, fences);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkGetFenceStatus: {
        const device = dec.readHandle();
        const fence = dec.readHandle();
        const res = this.handler.vkGetFenceStatus(device, fence);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkWaitForFences: {
        const device = dec.readHandle();
        const count = dec.readU32();
        const fences: VkHandle[] = [];
        for (let i = 0; i < count; i++) fences.push(dec.readHandle());
        const waitAll = dec.readBool32();
        const timeout = dec.readU64();
        const res = await this.handler.vkWaitForFences(device, fences, waitAll, timeout);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkQueueSubmit: {
        const queue = dec.readHandle();
        const submitCount = dec.readU32();
        const submits: VkSubmitInfo[] = [];
        for (let i = 0; i < submitCount; i++) {
          const waitCount = dec.readU32();
          const waitSemaphores: VkHandle[] = [];
          for (let j = 0; j < waitCount; j++) waitSemaphores.push(dec.readHandle());
          const cmdCount = dec.readU32();
          const commandBuffers: VkHandle[] = [];
          for (let j = 0; j < cmdCount; j++) commandBuffers.push(dec.readHandle());
          const sigCount = dec.readU32();
          const signalSemaphores: VkHandle[] = [];
          for (let j = 0; j < sigCount; j++) signalSemaphores.push(dec.readHandle());
          submits.push({ waitSemaphores, commandBuffers, signalSemaphores });
        }
        const fence = dec.readHandle();
        const res = this.handler.vkQueueSubmit(queue, submits, fence);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkQueueWaitIdle: {
        const queue = dec.readHandle();
        const res = await this.handler.vkQueueWaitIdle(queue);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDeviceWaitIdle: {
        const device = dec.readHandle();
        const res = await this.handler.vkDeviceWaitIdle(device);
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkSetReplyCommandStreamMESA: {
        const resourceId = dec.readU32();
        const offset = dec.readU64();
        const size = dec.readU64();
        this.handler.vkSetReplyCommandStreamMESA?.(resourceId, offset, size);
        break;
      }

      case VK_COMMAND_TYPE.vkSeekReplyCommandStreamMESA: {
        const position = dec.readU64();
        this.handler.vkSeekReplyCommandStreamMESA?.(position);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateRingMESA: {
        const ringId = dec.readU64();
        const resourceId = dec.readU32();
        const offset = dec.readU64();
        const size = dec.readU64();
        const idleTimeout = dec.readU64();
        const headOffset = dec.readU64();
        const tailOffset = dec.readU64();
        const statusOffset = dec.readU64();
        const bufferOffset = dec.readU64();
        const bufferSize = dec.readU64();
        const extraOffset = dec.readU64();
        const extraSize = dec.readU64();
        this.handler.vkCreateRingMESA?.(ringId, {
          resourceId,
          offset,
          size,
          idleTimeout,
          headOffset,
          tailOffset,
          statusOffset,
          bufferOffset,
          bufferSize,
          extraOffset,
          extraSize,
        });
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyRingMESA: {
        const ringId = dec.readU64();
        this.handler.vkDestroyRingMESA?.(ringId);
        break;
      }

      case VK_COMMAND_TYPE.vkNotifyRingMESA: {
        const ringId = dec.readU64();
        const seqno = dec.readU32();
        const notifyFlags = dec.readU32();
        this.handler.vkNotifyRingMESA?.(ringId, seqno, notifyFlags);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateImage: {
        const device = dec.readHandle();
        const format = dec.readU32();
        const width = dec.readU32();
        const height = dec.readU32();
        const usage = dec.readU32();
        const image = dec.readHandle();
        const res = this.handler.vkCreateImage?.(device, { format, width, height, usage }, image) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyImage: {
        const device = dec.readHandle();
        const image = dec.readHandle();
        this.handler.vkDestroyImage?.(device, image);
        this.replyVoid(reply, type, flags, wantsReply);
        break;
      }

      case VK_COMMAND_TYPE.vkGetImageMemoryRequirements: {
        const device = dec.readHandle();
        const image = dec.readHandle();
        const req = this.handler.vkGetImageMemoryRequirements?.(device, image) ?? {
          size: 0n,
          alignment: 256n,
          memoryTypeBits: 3,
        };
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeU64(req.size);
          reply.writeU64(req.alignment);
          reply.writeU32(req.memoryTypeBits);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkBindImageMemory: {
        const device = dec.readHandle();
        const image = dec.readHandle();
        const memory = dec.readHandle();
        const offset = dec.readU64();
        const res = this.handler.vkBindImageMemory?.(device, image, memory, offset) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCreateImageView: {
        const device = dec.readHandle();
        const image = dec.readHandle();
        const format = dec.readU32();
        const aspectMask = dec.readU32();
        const view = dec.readHandle();
        const res = this.handler.vkCreateImageView?.(device, { image, format, aspectMask }, view) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyImageView: {
        const device = dec.readHandle();
        const view = dec.readHandle();
        this.handler.vkDestroyImageView?.(device, view);
        this.replyVoid(reply, type, flags, wantsReply);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateSampler: {
        const device = dec.readHandle();
        const magFilter = dec.readU32();
        const minFilter = dec.readU32();
        const sampler = dec.readHandle();
        const res = this.handler.vkCreateSampler?.(device, { magFilter, minFilter }, sampler) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroySampler: {
        const device = dec.readHandle();
        const sampler = dec.readHandle();
        this.handler.vkDestroySampler?.(device, sampler);
        this.replyVoid(reply, type, flags, wantsReply);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateRenderPass: {
        const device = dec.readHandle();
        const hasColor = dec.readU32() !== 0;
        const colorAttachment = hasColor
          ? { format: dec.readU32(), loadOp: dec.readU32(), storeOp: dec.readU32() }
          : undefined;
        const hasDepth = dec.readU32() !== 0;
        const depthAttachment = hasDepth
          ? { format: dec.readU32(), loadOp: dec.readU32(), storeOp: dec.readU32() }
          : undefined;
        const renderPass = dec.readHandle();
        const res =
          this.handler.vkCreateRenderPass?.(device, { colorAttachment, depthAttachment }, renderPass) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyRenderPass: {
        const device = dec.readHandle();
        const renderPass = dec.readHandle();
        this.handler.vkDestroyRenderPass?.(device, renderPass);
        this.replyVoid(reply, type, flags, wantsReply);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateFramebuffer: {
        const device = dec.readHandle();
        const renderPass = dec.readHandle();
        const attCount = dec.readU32();
        const attachments: bigint[] = [];
        for (let i = 0; i < attCount; i++) attachments.push(dec.readHandle());
        const width = dec.readU32();
        const height = dec.readU32();
        const framebuffer = dec.readHandle();
        const res =
          this.handler.vkCreateFramebuffer?.(device, { renderPass, attachments, width, height }, framebuffer) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkDestroyFramebuffer: {
        const device = dec.readHandle();
        const framebuffer = dec.readHandle();
        this.handler.vkDestroyFramebuffer?.(device, framebuffer);
        this.replyVoid(reply, type, flags, wantsReply);
        break;
      }

      case VK_COMMAND_TYPE.vkCreateGraphicsPipelines: {
        const device = dec.readHandle();
        const vertexShader = dec.readHandle();
        const vertexEntry = dec.readString();
        const fragmentShader = dec.readHandle();
        const fragmentEntry = dec.readString();
        const bindingCount = dec.readU32();
        const bindings = [];
        for (let i = 0; i < bindingCount; i++) {
          bindings.push({ binding: dec.readU32(), stride: dec.readU32() });
        }
        const attrCount = dec.readU32();
        const attributes = [];
        for (let i = 0; i < attrCount; i++) {
          attributes.push({
            location: dec.readU32(),
            binding: dec.readU32(),
            format: dec.readU32(),
            offset: dec.readU32(),
          });
        }
        const topology = dec.readU32();
        const cullMode = dec.readU32();
        const depthTestEnable = dec.readU32() !== 0;
        const depthWriteEnable = dec.readU32() !== 0;
        const depthCompareOp = dec.readU32();
        const layout = dec.readHandle();
        const renderPass = dec.readHandle();
        const pipeline = dec.readHandle();
        const res =
          this.handler.vkCreateGraphicsPipelines?.(
            device,
            {
              vertexShader,
              vertexEntry,
              fragmentShader,
              fragmentEntry,
              bindings,
              attributes,
              topology,
              cullMode,
              depthTestEnable,
              depthWriteEnable,
              depthCompareOp,
              layout,
              renderPass,
            },
            pipeline,
          ) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      case VK_COMMAND_TYPE.vkCmdBeginRenderPass: {
        const commandBuffer = dec.readHandle();
        const renderPass = dec.readHandle();
        const framebuffer = dec.readHandle();
        const clearColor: [number, number, number, number] = [
          dec.readF32(),
          dec.readF32(),
          dec.readF32(),
          dec.readF32(),
        ];
        const clearDepth = dec.readF32();
        this.handler.vkCmdBeginRenderPass?.(commandBuffer, renderPass, framebuffer, clearColor, clearDepth);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdEndRenderPass: {
        const commandBuffer = dec.readHandle();
        this.handler.vkCmdEndRenderPass?.(commandBuffer);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdSetViewport: {
        const commandBuffer = dec.readHandle();
        const x = dec.readF32();
        const y = dec.readF32();
        const width = dec.readF32();
        const height = dec.readF32();
        const minDepth = dec.readF32();
        const maxDepth = dec.readF32();
        this.handler.vkCmdSetViewport?.(commandBuffer, x, y, width, height, minDepth, maxDepth);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdSetScissor: {
        const commandBuffer = dec.readHandle();
        const x = dec.readU32();
        const y = dec.readU32();
        const width = dec.readU32();
        const height = dec.readU32();
        this.handler.vkCmdSetScissor?.(commandBuffer, x, y, width, height);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdBindVertexBuffers: {
        const commandBuffer = dec.readHandle();
        const firstBinding = dec.readU32();
        const count = dec.readU32();
        const buffers: bigint[] = [];
        const offsets: bigint[] = [];
        for (let i = 0; i < count; i++) {
          buffers.push(dec.readHandle());
          offsets.push(dec.readU64());
        }
        this.handler.vkCmdBindVertexBuffers?.(commandBuffer, firstBinding, buffers, offsets);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdBindIndexBuffer: {
        const commandBuffer = dec.readHandle();
        const buffer = dec.readHandle();
        const offset = dec.readU64();
        const indexType = dec.readU32();
        this.handler.vkCmdBindIndexBuffer?.(commandBuffer, buffer, offset, indexType);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdDraw: {
        const commandBuffer = dec.readHandle();
        const vertexCount = dec.readU32();
        const instanceCount = dec.readU32();
        const firstVertex = dec.readU32();
        const firstInstance = dec.readU32();
        this.handler.vkCmdDraw?.(commandBuffer, vertexCount, instanceCount, firstVertex, firstInstance);
        break;
      }

      case VK_COMMAND_TYPE.vkCmdDrawIndexed: {
        const commandBuffer = dec.readHandle();
        const indexCount = dec.readU32();
        const instanceCount = dec.readU32();
        const firstIndex = dec.readU32();
        const vertexOffset = dec.readI32();
        const firstInstance = dec.readU32();
        this.handler.vkCmdDrawIndexed?.(
          commandBuffer,
          indexCount,
          instanceCount,
          firstIndex,
          vertexOffset,
          firstInstance,
        );
        break;
      }

      case VK_COMMAND_TYPE.vkCmdCopyBufferToImage: {
        const commandBuffer = dec.readHandle();
        const srcBuffer = dec.readHandle();
        const dstImage = dec.readHandle();
        const bufferOffset = dec.readU64();
        const width = dec.readU32();
        const height = dec.readU32();
        this.handler.vkCmdCopyBufferToImage?.(commandBuffer, srcBuffer, dstImage, bufferOffset, width, height);
        break;
      }

      case VK_COMMAND_TYPE.vkQueuePresentKHR: {
        const queue = dec.readHandle();
        const image = dec.readHandle();
        const res = (await this.handler.vkQueuePresentKHR?.(queue, image)) ?? 0;
        if (wantsReply) {
          this.writeReplyHeader(reply, type, flags);
          reply.writeI32(res);
        }
        break;
      }

      default:
        throw new Error(`Unsupported Venus command type: ${type}`);
    }
  }
}
