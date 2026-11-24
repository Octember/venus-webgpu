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

  // Phase 2: Graphics & Presentation
  vkCreateImage: 400,
  vkDestroyImage: 401,
  vkGetImageMemoryRequirements: 402,
  vkBindImageMemory: 403,
  vkCreateImageView: 404,
  vkDestroyImageView: 405,
  vkCreateSampler: 406,
  vkDestroySampler: 407,
  vkCreateRenderPass: 408,
  vkDestroyRenderPass: 409,
  vkCreateFramebuffer: 410,
  vkDestroyFramebuffer: 411,
  vkCreateGraphicsPipelines: 412,
  vkCmdBeginRenderPass: 413,
  vkCmdEndRenderPass: 414,
  vkCmdSetViewport: 415,
  vkCmdSetScissor: 416,
  vkCmdBindVertexBuffers: 417,
  vkCmdBindIndexBuffer: 418,
  vkCmdDraw: 419,
  vkCmdDrawIndexed: 420,
  vkCmdCopyBufferToImage: 421,
  vkQueuePresentKHR: 422,
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
  INDEX_BUFFER: 0x00000040,
  VERTEX_BUFFER: 0x00000080,
} as const;

export const VK_MEMORY_PROPERTY = {
  DEVICE_LOCAL: 0x00000001,
  HOST_VISIBLE: 0x00000002,
  HOST_COHERENT: 0x00000004,
  HOST_CACHED: 0x00000008,
} as const;

export const VK_DESCRIPTOR_TYPE = {
  SAMPLER: 0,
  COMBINED_IMAGE_SAMPLER: 1,
  SAMPLED_IMAGE: 2,
  STORAGE_IMAGE: 3,
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
  VERTEX: 0x00000001,
  FRAGMENT: 0x00000010,
  COMPUTE: 0x00000020,
  ALL_GRAPHICS: 0x0000001f,
  ALL: 0x7fffffff,
} as const;

export const VK_FORMAT = {
  R8G8B8A8_UNORM: 37,
  B8G8R8A8_UNORM: 44,
  R32G32_SFLOAT: 103,
  R32G32B32_SFLOAT: 106,
  R32G32B32A32_SFLOAT: 109,
  D32_SFLOAT: 126,
  D24_UNORM_S8_UINT: 129,
} as const;

export const VK_IMAGE_USAGE = {
  TRANSFER_SRC: 0x00000001,
  TRANSFER_DST: 0x00000002,
  SAMPLED: 0x00000004,
  STORAGE: 0x00000008,
  COLOR_ATTACHMENT: 0x00000010,
  DEPTH_STENCIL_ATTACHMENT: 0x00000020,
} as const;

export const VK_ATTACHMENT_LOAD_OP = {
  LOAD: 0,
  CLEAR: 1,
  DONT_CARE: 2,
} as const;

export const VK_ATTACHMENT_STORE_OP = {
  STORE: 0,
  DONT_CARE: 1,
} as const;

export const VK_PRIMITIVE_TOPOLOGY = {
  POINT_LIST: 0,
  LINE_LIST: 1,
  LINE_STRIP: 2,
  TRIANGLE_LIST: 3,
  TRIANGLE_STRIP: 4,
} as const;

export const VK_CULL_MODE = {
  NONE: 0,
  FRONT: 1,
  BACK: 2,
  FRONT_AND_BACK: 3,
} as const;

export const VK_COMPARE_OP = {
  NEVER: 0,
  LESS: 1,
  EQUAL: 2,
  LESS_OR_EQUAL: 3,
  GREATER: 4,
  NOT_EQUAL: 5,
  GREATER_OR_EQUAL: 6,
  ALWAYS: 7,
} as const;

export const VK_INDEX_TYPE = {
  UINT16: 0,
  UINT32: 1,
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

export const VK_WHOLE_SIZE = 0xffffffffffffffffn;

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
