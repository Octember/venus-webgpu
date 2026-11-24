import { VK_COMMAND_GENERATE_REPLY_BIT_EXT, VK_COMMAND_TYPE } from "./constants.ts";
import type {
  VkDescriptorSetLayoutBinding,
  VkFramebufferCreateInfo,
  VkGraphicsPipelineCreateInfo,
  VkHandle,
  VkImageCreateInfo,
  VkImageViewCreateInfo,
  VkMappedMemoryRange,
  VkRenderPassCreateInfo,
  VkSamplerCreateInfo,
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

  vkSetReplyCommandStreamMESA(resourceId: number, offset: bigint, size: bigint): void {
    this.header(VK_COMMAND_TYPE.vkSetReplyCommandStreamMESA);
    this.cs.writeU32(resourceId);
    this.cs.writeU64(offset);
    this.cs.writeU64(size);
  }

  vkSeekReplyCommandStreamMESA(position: bigint): void {
    this.header(VK_COMMAND_TYPE.vkSeekReplyCommandStreamMESA);
    this.cs.writeU64(position);
  }

  // Phase 2: Graphics & Presentation

  vkCreateImage(device: VkHandle, info: VkImageCreateInfo, image: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkCreateImage, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(info.format);
    this.cs.writeU32(info.width);
    this.cs.writeU32(info.height);
    this.cs.writeU32(info.usage);
    this.cs.writeHandle(image);
  }

  vkDestroyImage(device: VkHandle, image: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyImage);
    this.cs.writeHandle(device);
    this.cs.writeHandle(image);
  }

  vkGetImageMemoryRequirements(device: VkHandle, image: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkGetImageMemoryRequirements, true);
    this.cs.writeHandle(device);
    this.cs.writeHandle(image);
  }

  vkBindImageMemory(device: VkHandle, image: VkHandle, memory: VkHandle, offset: bigint, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkBindImageMemory, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(image);
    this.cs.writeHandle(memory);
    this.cs.writeU64(offset);
  }

  vkCreateImageView(device: VkHandle, info: VkImageViewCreateInfo, view: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkCreateImageView, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(info.image);
    this.cs.writeU32(info.format);
    this.cs.writeU32(info.aspectMask);
    this.cs.writeHandle(view);
  }

  vkDestroyImageView(device: VkHandle, view: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyImageView);
    this.cs.writeHandle(device);
    this.cs.writeHandle(view);
  }

  vkCreateSampler(device: VkHandle, info: VkSamplerCreateInfo, sampler: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkCreateSampler, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(info.magFilter);
    this.cs.writeU32(info.minFilter);
    this.cs.writeHandle(sampler);
  }

  vkDestroySampler(device: VkHandle, sampler: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroySampler);
    this.cs.writeHandle(device);
    this.cs.writeHandle(sampler);
  }

  vkCreateRenderPass(device: VkHandle, info: VkRenderPassCreateInfo, renderPass: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkCreateRenderPass, reply);
    this.cs.writeHandle(device);
    this.cs.writeU32(info.colorAttachment ? 1 : 0);
    if (info.colorAttachment) {
      this.cs.writeU32(info.colorAttachment.format);
      this.cs.writeU32(info.colorAttachment.loadOp);
      this.cs.writeU32(info.colorAttachment.storeOp);
    }
    this.cs.writeU32(info.depthAttachment ? 1 : 0);
    if (info.depthAttachment) {
      this.cs.writeU32(info.depthAttachment.format);
      this.cs.writeU32(info.depthAttachment.loadOp);
      this.cs.writeU32(info.depthAttachment.storeOp);
    }
    this.cs.writeHandle(renderPass);
  }

  vkDestroyRenderPass(device: VkHandle, renderPass: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyRenderPass);
    this.cs.writeHandle(device);
    this.cs.writeHandle(renderPass);
  }

  vkCreateFramebuffer(device: VkHandle, info: VkFramebufferCreateInfo, framebuffer: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkCreateFramebuffer, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(info.renderPass);
    this.cs.writeU32(info.attachments.length);
    for (const att of info.attachments) {
      this.cs.writeHandle(att);
    }
    this.cs.writeU32(info.width);
    this.cs.writeU32(info.height);
    this.cs.writeHandle(framebuffer);
  }

  vkDestroyFramebuffer(device: VkHandle, framebuffer: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkDestroyFramebuffer);
    this.cs.writeHandle(device);
    this.cs.writeHandle(framebuffer);
  }

  vkCreateGraphicsPipelines(
    device: VkHandle,
    info: VkGraphicsPipelineCreateInfo,
    pipeline: VkHandle,
    reply = false,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCreateGraphicsPipelines, reply);
    this.cs.writeHandle(device);
    this.cs.writeHandle(info.vertexShader);
    this.cs.writeString(info.vertexEntry);
    this.cs.writeHandle(info.fragmentShader);
    this.cs.writeString(info.fragmentEntry);
    this.cs.writeU32(info.bindings.length);
    for (const b of info.bindings) {
      this.cs.writeU32(b.binding);
      this.cs.writeU32(b.stride);
    }
    this.cs.writeU32(info.attributes.length);
    for (const a of info.attributes) {
      this.cs.writeU32(a.location);
      this.cs.writeU32(a.binding);
      this.cs.writeU32(a.format);
      this.cs.writeU32(a.offset);
    }
    this.cs.writeU32(info.topology);
    this.cs.writeU32(info.cullMode);
    this.cs.writeU32(info.depthTestEnable ? 1 : 0);
    this.cs.writeU32(info.depthWriteEnable ? 1 : 0);
    this.cs.writeU32(info.depthCompareOp);
    this.cs.writeHandle(info.layout);
    this.cs.writeHandle(info.renderPass);
    this.cs.writeHandle(pipeline);
  }

  vkCmdBeginRenderPass(
    commandBuffer: VkHandle,
    renderPass: VkHandle,
    framebuffer: VkHandle,
    clearColor: [number, number, number, number] = [0, 0, 0, 1],
    clearDepth = 1.0,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdBeginRenderPass);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeHandle(renderPass);
    this.cs.writeHandle(framebuffer);
    this.cs.writeF32(clearColor[0]);
    this.cs.writeF32(clearColor[1]);
    this.cs.writeF32(clearColor[2]);
    this.cs.writeF32(clearColor[3]);
    this.cs.writeF32(clearDepth);
  }

  vkCmdEndRenderPass(commandBuffer: VkHandle): void {
    this.header(VK_COMMAND_TYPE.vkCmdEndRenderPass);
    this.cs.writeHandle(commandBuffer);
  }

  vkCmdSetViewport(
    commandBuffer: VkHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth = 0,
    maxDepth = 1,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdSetViewport);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeF32(x);
    this.cs.writeF32(y);
    this.cs.writeF32(width);
    this.cs.writeF32(height);
    this.cs.writeF32(minDepth);
    this.cs.writeF32(maxDepth);
  }

  vkCmdSetScissor(commandBuffer: VkHandle, x: number, y: number, width: number, height: number): void {
    this.header(VK_COMMAND_TYPE.vkCmdSetScissor);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(x);
    this.cs.writeU32(y);
    this.cs.writeU32(width);
    this.cs.writeU32(height);
  }

  vkCmdBindVertexBuffers(
    commandBuffer: VkHandle,
    firstBinding: number,
    buffers: VkHandle[],
    offsets: bigint[],
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdBindVertexBuffers);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(firstBinding);
    this.cs.writeU32(buffers.length);
    for (let i = 0; i < buffers.length; i++) {
      this.cs.writeHandle(buffers[i]);
      this.cs.writeU64(offsets[i] ?? 0n);
    }
  }

  vkCmdBindIndexBuffer(commandBuffer: VkHandle, buffer: VkHandle, offset: bigint, indexType: number): void {
    this.header(VK_COMMAND_TYPE.vkCmdBindIndexBuffer);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeHandle(buffer);
    this.cs.writeU64(offset);
    this.cs.writeU32(indexType);
  }

  vkCmdDraw(
    commandBuffer: VkHandle,
    vertexCount: number,
    instanceCount = 1,
    firstVertex = 0,
    firstInstance = 0,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdDraw);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(vertexCount);
    this.cs.writeU32(instanceCount);
    this.cs.writeU32(firstVertex);
    this.cs.writeU32(firstInstance);
  }

  vkCmdDrawIndexed(
    commandBuffer: VkHandle,
    indexCount: number,
    instanceCount = 1,
    firstIndex = 0,
    vertexOffset = 0,
    firstInstance = 0,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdDrawIndexed);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeU32(indexCount);
    this.cs.writeU32(instanceCount);
    this.cs.writeU32(firstIndex);
    this.cs.writeI32(vertexOffset);
    this.cs.writeU32(firstInstance);
  }

  vkCmdCopyBufferToImage(
    commandBuffer: VkHandle,
    srcBuffer: VkHandle,
    dstImage: VkHandle,
    bufferOffset: bigint,
    width: number,
    height: number,
  ): void {
    this.header(VK_COMMAND_TYPE.vkCmdCopyBufferToImage);
    this.cs.writeHandle(commandBuffer);
    this.cs.writeHandle(srcBuffer);
    this.cs.writeHandle(dstImage);
    this.cs.writeU64(bufferOffset);
    this.cs.writeU32(width);
    this.cs.writeU32(height);
  }

  vkQueuePresentKHR(queue: VkHandle, image: VkHandle, reply = false): void {
    this.header(VK_COMMAND_TYPE.vkQueuePresentKHR, reply);
    this.cs.writeHandle(queue);
    this.cs.writeHandle(image);
  }

  finish(): Uint8Array {
    return this.cs.finish();
  }
}
