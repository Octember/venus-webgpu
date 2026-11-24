/**
 * Venus wire-protocol & virtio-gpu constants.
 * Command IDs match VK_EXT_command_serialization.xml & VK_MESA_venus_protocol.xml.
 */

export const VK_COMMAND_TYPE = {
  vkCreateInstance: 0,
  vkDestroyInstance: 1,
  vkEnumeratePhysicalDevices: 2,
  vkGetPhysicalDeviceFeatures: 3,
  vkGetPhysicalDeviceProperties: 6,
  vkGetPhysicalDeviceQueueFamilyProperties: 7,
  vkGetPhysicalDeviceMemoryProperties: 8,
  vkCreateDevice: 11,
  vkDestroyDevice: 12,
  vkGetDeviceQueue: 17,
  vkQueueSubmit: 18,
  vkQueueWaitIdle: 19,
  vkDeviceWaitIdle: 20,
  vkAllocateMemory: 21,
  vkFreeMemory: 22,
  vkMapMemory: 23,
  vkUnmapMemory: 24,
  vkFlushMappedMemoryRanges: 25,
  vkInvalidateMappedMemoryRanges: 26,
  vkBindBufferMemory: 28,
  vkGetBufferMemoryRequirements: 30,
  vkCreateFence: 35,
  vkDestroyFence: 36,
  vkResetFences: 37,
  vkGetFenceStatus: 38,
  vkWaitForFences: 39,
  vkCreateBuffer: 50,
  vkDestroyBuffer: 51,
  vkCreateShaderModule: 59,
  vkDestroyShaderModule: 60,
  vkCreateComputePipelines: 66,
  vkDestroyPipeline: 67,
  vkCreatePipelineLayout: 68,
  vkDestroyPipelineLayout: 69,
  vkCreateDescriptorSetLayout: 72,
  vkDestroyDescriptorSetLayout: 73,
  vkCreateDescriptorPool: 74,
  vkDestroyDescriptorPool: 75,
  vkResetDescriptorPool: 76,
  vkAllocateDescriptorSets: 77,
  vkFreeDescriptorSets: 78,
  vkUpdateDescriptorSets: 79,
  vkCreateCommandPool: 85,
  vkDestroyCommandPool: 86,
  vkResetCommandPool: 87,
  vkAllocateCommandBuffers: 88,
  vkFreeCommandBuffers: 89,
  vkBeginCommandBuffer: 90,
  vkEndCommandBuffer: 91,
  vkResetCommandBuffer: 92,
  vkCmdBindPipeline: 93,
  vkCmdBindDescriptorSets: 103,
  vkCmdDispatch: 110,
  vkCmdCopyBuffer: 112,
  vkCmdUpdateBuffer: 117,
  vkCmdFillBuffer: 118,
  vkCmdPipelineBarrier: 126,

  // VK_MESA_venus_protocol
  vkSetReplyCommandStreamMESA: 178,
  vkSeekReplyCommandStreamMESA: 179,
  vkExecuteCommandStreamsMESA: 180,
  vkCreateRingMESA: 188,
  vkDestroyRingMESA: 189,
  vkNotifyRingMESA: 190,
  vkWriteRingExtraMESA: 191,
  vkGetMemoryResourcePropertiesMESA: 192,
} as const;

export type VkCommandType = (typeof VK_COMMAND_TYPE)[keyof typeof VK_COMMAND_TYPE];

export const VK_COMMAND_GENERATE_REPLY_BIT_EXT = 1;

export const VK_RESULT = {
  VK_SUCCESS: 0,
  VK_NOT_READY: 1,
  VK_TIMEOUT: 2,
  VK_ERROR_OUT_OF_HOST_MEMORY: -1,
  VK_ERROR_OUT_OF_DEVICE_MEMORY: -2,
  VK_ERROR_INITIALIZATION_FAILED: -3,
  VK_ERROR_DEVICE_LOST: -4,
  VK_ERROR_MEMORY_MAP_FAILED: -5,
  VK_ERROR_FEATURE_NOT_PRESENT: -8,
} as const;

export type VkResult = (typeof VK_RESULT)[keyof typeof VK_RESULT];

export const VK_BUFFER_USAGE = {
  TRANSFER_SRC: 0x00000001,
  TRANSFER_DST: 0x00000002,
  UNIFORM_BUFFER: 0x00000010,
  STORAGE_BUFFER: 0x00000020,
} as const;

export const VK_MEMORY_PROPERTY = {
  DEVICE_LOCAL: 0x00000001,
  HOST_VISIBLE: 0x00000002,
  HOST_COHERENT: 0x00000004,
  HOST_CACHED: 0x00000008,
} as const;

export const VK_DESCRIPTOR_TYPE = {
  UNIFORM_BUFFER: 6,
  STORAGE_BUFFER: 7,
  UNIFORM_BUFFER_DYNAMIC: 8,
  STORAGE_BUFFER_DYNAMIC: 9,
} as const;

export const VK_PIPELINE_BIND_POINT = {
  GRAPHICS: 0,
  COMPUTE: 1,
} as const;

export const VK_SHADER_STAGE = {
  COMPUTE: 0x00000020,
} as const;

export const VK_QUEUE_FLAGS = {
  GRAPHICS: 0x00000001,
  COMPUTE: 0x00000002,
  TRANSFER: 0x00000004,
} as const;

export const VK_PHYSICAL_DEVICE_TYPE = {
  OTHER: 0,
  INTEGRATED_GPU: 1,
  DISCRETE_GPU: 2,
  VIRTUAL_GPU: 3,
  CPU: 4,
} as const;

/** Virtio-GPU Venus capset (virglrenderer/src/venus_hw.h). */
export const VIRTIO_GPU_CAPSET_VENUS = 4;
export const VENUS_WIRE_FORMAT_VERSION = 1;
export const VENUS_CAPSET_SIZE = 160; // 40 * u32

export interface VenusCapsetOptions {
  wireFormatVersion?: number;
  vkXmlVersion?: number;
  vkExtCommandSerializationSpecVersion?: number;
  vkMesaVenusProtocolSpecVersion?: number;
  supportsBlobId0?: number;
  allowVkWaitSyncs?: number;
  supportsMultipleTimelines?: number;
  useGuestVram?: number;
}

export function encodeVenusCapset(opts: VenusCapsetOptions = {}): Uint8Array {
  const buf = new Uint8Array(VENUS_CAPSET_SIZE);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, opts.wireFormatVersion ?? VENUS_WIRE_FORMAT_VERSION, true);
  dv.setUint32(4, opts.vkXmlVersion ?? ((1 << 22) | (3 << 12) | 0), true); // Vulkan 1.3.0
  dv.setUint32(8, opts.vkExtCommandSerializationSpecVersion ?? 0, true);
  dv.setUint32(12, opts.vkMesaVenusProtocolSpecVersion ?? 4, true);
  dv.setUint32(16, opts.supportsBlobId0 ?? 1, true);
  // vk_extension_mask1[32] at bytes 20..147 (all 0 = backward-compat / all supported)
  dv.setUint32(148, opts.allowVkWaitSyncs ?? 1, true);
  dv.setUint32(152, opts.supportsMultipleTimelines ?? 1, true);
  dv.setUint32(156, opts.useGuestVram ?? 0, true);
  return buf;
}
