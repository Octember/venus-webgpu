import { describe, expect, test } from "bun:test";
import { createMockGPUDevice } from "../src/backend/mock-gpu.ts";
import { WebGpuVenusBackend } from "../src/backend/webgpu-backend.ts";
import {
  VK_ATTACHMENT_LOAD_OP,
  VK_ATTACHMENT_STORE_OP,
  VK_BUFFER_USAGE,
  VK_COMPARE_OP,
  VK_CULL_MODE,
  VK_DESCRIPTOR_TYPE,
  VK_FORMAT,
  VK_IMAGE_USAGE,
  VK_INDEX_TYPE,
  VK_PIPELINE_BIND_POINT,
  VK_PRIMITIVE_TOPOLOGY,
  VK_RESULT,
  VK_SHADER_STAGE,
} from "../src/protocol/constants.ts";
import { VenusCommandDecoder } from "../src/protocol/decoder.ts";
import { VenusCommandEncoder } from "../src/protocol/encoder.ts";
import { VenusRing } from "../src/protocol/ring.ts";
import { createCubeFragmentSpirv, createCubeVertexSpirv, SpirvTranslator } from "../src/shader/spirv.ts";

describe("Venus Phase 2 Graphics E2E", () => {
  test("encodes, decodes, and executes a 3D graphics render pass through VenusRing -> WebGpuVenusBackend", async () => {
    const device = createMockGPUDevice();
    const translator = new SpirvTranslator();
    const backend = new WebGpuVenusBackend({ device, translator });
    const decoder = new VenusCommandDecoder(backend);

    const enc = new VenusCommandEncoder();
    const [INST, DEV, QUEUE] = [1n, 2n, 3n];
    const [MEM_V, MEM_I, MEM_U] = [10n, 11n, 12n];
    const [BUF_V, BUF_I, BUF_U] = [20n, 21n, 22n];
    const [VS, FS] = [30n, 31n];
    const [DS_LAYOUT, PIPE_LAYOUT, PIPELINE] = [40n, 41n, 42n];
    const [DS_POOL, DS] = [50n, 51n];
    const [IMG_C, IMG_D, VIEW_C, VIEW_D] = [60n, 61n, 62n, 63n];
    const [RP, FB, CMD_POOL, CMD_BUF, FENCE] = [70n, 71n, 72n, 73n, 74n];

    enc.vkCreateInstance(INST);
    enc.vkEnumeratePhysicalDevices(INST, 1);
    enc.vkCreateDevice(0x1000n, DEV, 0);
    enc.vkGetDeviceQueue(DEV, 0, 0, QUEUE);

    enc.vkCreateBuffer(DEV, 192n, VK_BUFFER_USAGE.VERTEX_BUFFER, BUF_V);
    enc.vkAllocateMemory(DEV, 192n, 1, MEM_V);
    enc.vkBindBufferMemory(DEV, BUF_V, MEM_V, 0n);

    enc.vkCreateBuffer(DEV, 72n, VK_BUFFER_USAGE.INDEX_BUFFER, BUF_I);
    enc.vkAllocateMemory(DEV, 72n, 1, MEM_I);
    enc.vkBindBufferMemory(DEV, BUF_I, MEM_I, 0n);

    enc.vkCreateBuffer(DEV, 64n, VK_BUFFER_USAGE.UNIFORM_BUFFER, BUF_U);
    enc.vkAllocateMemory(DEV, 64n, 1, MEM_U);
    enc.vkBindBufferMemory(DEV, BUF_U, MEM_U, 0n);

    enc.vkCreateShaderModule(DEV, createCubeVertexSpirv(), VS);
    enc.vkCreateShaderModule(DEV, createCubeFragmentSpirv(), FS);
    enc.vkCreateDescriptorSetLayout(
      DEV,
      [
        {
          binding: 0,
          descriptorType: VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER,
          descriptorCount: 1,
          stageFlags: VK_SHADER_STAGE.VERTEX,
        },
      ],
      DS_LAYOUT,
    );
    enc.vkCreatePipelineLayout(DEV, [DS_LAYOUT], PIPE_LAYOUT);
    enc.vkCreateDescriptorPool(DEV, DS_POOL);
    enc.vkAllocateDescriptorSets(DEV, DS_POOL, [DS_LAYOUT], [DS]);
    enc.vkUpdateDescriptorSets(DEV, [
      {
        dstSet: DS,
        dstBinding: 0,
        dstArrayElement: 0,
        descriptorCount: 1,
        descriptorType: VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER,
        bufferInfos: [{ buffer: BUF_U, offset: 0n, range: 64n }],
      },
    ]);

    enc.vkCreateImage(
      DEV,
      { format: VK_FORMAT.R8G8B8A8_UNORM, width: 256, height: 256, usage: VK_IMAGE_USAGE.COLOR_ATTACHMENT },
      IMG_C,
    );
    enc.vkCreateImageView(DEV, { image: IMG_C, format: VK_FORMAT.R8G8B8A8_UNORM, aspectMask: 1 }, VIEW_C);
    enc.vkCreateImage(
      DEV,
      { format: VK_FORMAT.D32_SFLOAT, width: 256, height: 256, usage: VK_IMAGE_USAGE.DEPTH_STENCIL_ATTACHMENT },
      IMG_D,
    );
    enc.vkCreateImageView(DEV, { image: IMG_D, format: VK_FORMAT.D32_SFLOAT, aspectMask: 2 }, VIEW_D);

    enc.vkCreateRenderPass(
      DEV,
      {
        colorAttachment: {
          format: VK_FORMAT.R8G8B8A8_UNORM,
          loadOp: VK_ATTACHMENT_LOAD_OP.CLEAR,
          storeOp: VK_ATTACHMENT_STORE_OP.STORE,
        },
        depthAttachment: {
          format: VK_FORMAT.D32_SFLOAT,
          loadOp: VK_ATTACHMENT_LOAD_OP.CLEAR,
          storeOp: VK_ATTACHMENT_STORE_OP.DONT_CARE,
        },
      },
      RP,
    );
    enc.vkCreateFramebuffer(DEV, { renderPass: RP, attachments: [VIEW_C, VIEW_D], width: 256, height: 256 }, FB);
    enc.vkCreateGraphicsPipelines(
      DEV,
      {
        vertexShader: VS,
        vertexEntry: "main",
        fragmentShader: FS,
        fragmentEntry: "main",
        bindings: [{ binding: 0, stride: 24 }],
        attributes: [
          { location: 0, binding: 0, format: VK_FORMAT.R32G32B32_SFLOAT, offset: 0 },
          { location: 1, binding: 0, format: VK_FORMAT.R32G32B32_SFLOAT, offset: 12 },
        ],
        topology: VK_PRIMITIVE_TOPOLOGY.TRIANGLE_LIST,
        cullMode: VK_CULL_MODE.BACK,
        depthTestEnable: true,
        depthWriteEnable: true,
        depthCompareOp: VK_COMPARE_OP.LESS,
        layout: PIPE_LAYOUT,
        renderPass: RP,
      },
      PIPELINE,
    );

    enc.vkCreateCommandPool(DEV, 0, CMD_POOL);
    enc.vkAllocateCommandBuffers(DEV, CMD_POOL, [CMD_BUF]);
    enc.vkBeginCommandBuffer(CMD_BUF);
    enc.vkCmdBeginRenderPass(CMD_BUF, RP, FB, [0, 0, 0, 1], 1.0);
    enc.vkCmdSetViewport(CMD_BUF, 0, 0, 256, 256, 0, 1);
    enc.vkCmdSetScissor(CMD_BUF, 0, 0, 256, 256);
    enc.vkCmdBindPipeline(CMD_BUF, VK_PIPELINE_BIND_POINT.GRAPHICS, PIPELINE);
    enc.vkCmdBindDescriptorSets(CMD_BUF, VK_PIPELINE_BIND_POINT.GRAPHICS, PIPE_LAYOUT, 0, [DS]);
    enc.vkCmdBindVertexBuffers(CMD_BUF, 0, [BUF_V], [0n]);
    enc.vkCmdBindIndexBuffer(CMD_BUF, BUF_I, 0n, VK_INDEX_TYPE.UINT16);
    enc.vkCmdDrawIndexed(CMD_BUF, 36, 1, 0, 0, 0);
    enc.vkCmdEndRenderPass(CMD_BUF);
    enc.vkEndCommandBuffer(CMD_BUF);
    enc.vkCreateFence(DEV, false, FENCE);
    enc.vkQueueSubmit(QUEUE, [{ waitSemaphores: [], commandBuffers: [CMD_BUF], signalSemaphores: [] }], FENCE);
    enc.vkWaitForFences(DEV, [FENCE], true, 0xffffffffffffffffn);
    enc.vkQueuePresentKHR(QUEUE, IMG_C);

    const shmem = new Uint8Array(32768);
    const ring = new VenusRing(shmem, {
      headOffset: 0,
      tailOffset: 4,
      statusOffset: 8,
      bufferOffset: 64,
      bufferSize: 16384,
    });
    ring.write(enc.finish());
    await decoder.execute(ring.consumeAvailable());

    expect(backend.objects.pipelines.get(PIPELINE)?.kind).toBe("graphics");
    expect(backend.objects.framebuffers.get(FB)?.attachments.length).toBe(2);
    expect(backend.vkGetFenceStatus(DEV, FENCE)).toBe(VK_RESULT.VK_SUCCESS);
  });
});
