import { describe, expect, test } from "bun:test";
import { createMockGPUDevice } from "../src/backend/mock-gpu.ts";
import { WebGpuVenusBackend } from "../src/backend/webgpu-backend.ts";
import {
  VK_BUFFER_USAGE,
  VK_DESCRIPTOR_TYPE,
  VK_PIPELINE_BIND_POINT,
  VK_RESULT,
  VK_SHADER_STAGE,
} from "../src/protocol/constants.ts";
import { VenusCommandDecoder } from "../src/protocol/decoder.ts";
import { VenusCommandEncoder } from "../src/protocol/encoder.ts";
import { VenusRing } from "../src/protocol/ring.ts";
import { VenusCsDecoder } from "../src/protocol/wire.ts";
import { createVectorAddSpirv } from "../src/shader/spirv.ts";

describe("Venus Compute E2E (Vector Add)", () => {
  test("executes a full Venus Vulkan compute stream through VenusRing -> WebGpuVenusBackend", async () => {
    const N = 1024;
    const BYTE_SIZE = BigInt(N * 4);

    const device = createMockGPUDevice();
    const backend = new WebGpuVenusBackend({ device });
    const decoder = new VenusCommandDecoder(backend);

    // 1. Encode setup commands
    const enc = new VenusCommandEncoder();
    const INST = 1n;
    const PHYS = 0x1000n;
    const DEV = 2n;
    const QUEUE = 3n;
    const MEM_A = 10n;
    const MEM_B = 11n;
    const MEM_C = 12n;
    const BUF_A = 20n;
    const BUF_B = 21n;
    const BUF_C = 22n;
    const SHADER = 30n;
    const DS_LAYOUT = 40n;
    const PIPE_LAYOUT = 41n;
    const PIPELINE = 42n;
    const DS_POOL = 50n;
    const DS = 51n;
    const CMD_POOL = 60n;
    const CMD_BUF = 61n;
    const FENCE = 70n;

    enc.vkCreateInstance(INST);
    enc.vkEnumeratePhysicalDevices(INST, 1);
    enc.vkCreateDevice(PHYS, DEV, 0);
    enc.vkGetDeviceQueue(DEV, 0, 0, QUEUE);

    for (const [mem, buf] of [
      [MEM_A, BUF_A],
      [MEM_B, BUF_B],
      [MEM_C, BUF_C],
    ] as const) {
      enc.vkCreateBuffer(DEV, BYTE_SIZE, VK_BUFFER_USAGE.STORAGE_BUFFER, buf);
      enc.vkAllocateMemory(DEV, BYTE_SIZE, 1 /* HOST_VISIBLE */, mem);
      enc.vkBindBufferMemory(DEV, buf, mem, 0n);
      enc.vkMapMemory(DEV, mem, 0n, BYTE_SIZE);
    }

    enc.vkCreateShaderModule(DEV, createVectorAddSpirv(), SHADER);
    enc.vkCreateDescriptorSetLayout(
      DEV,
      [
        { binding: 0, descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER, descriptorCount: 1, stageFlags: VK_SHADER_STAGE.COMPUTE },
        { binding: 1, descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER, descriptorCount: 1, stageFlags: VK_SHADER_STAGE.COMPUTE },
        { binding: 2, descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER, descriptorCount: 1, stageFlags: VK_SHADER_STAGE.COMPUTE },
      ],
      DS_LAYOUT,
    );
    enc.vkCreatePipelineLayout(DEV, [DS_LAYOUT], PIPE_LAYOUT);
    enc.vkCreateComputePipelines(DEV, SHADER, "main", PIPE_LAYOUT, PIPELINE);
    enc.vkCreateDescriptorPool(DEV, DS_POOL);
    enc.vkAllocateDescriptorSets(DEV, DS_POOL, [DS_LAYOUT], [DS]);
    enc.vkUpdateDescriptorSets(DEV, [
      {
        dstSet: DS,
        dstBinding: 0,
        dstArrayElement: 0,
        descriptorCount: 1,
        descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER,
        bufferInfos: [{ buffer: BUF_A, offset: 0n, range: BYTE_SIZE }],
      },
      {
        dstSet: DS,
        dstBinding: 1,
        dstArrayElement: 0,
        descriptorCount: 1,
        descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER,
        bufferInfos: [{ buffer: BUF_B, offset: 0n, range: BYTE_SIZE }],
      },
      {
        dstSet: DS,
        dstBinding: 2,
        dstArrayElement: 0,
        descriptorCount: 1,
        descriptorType: VK_DESCRIPTOR_TYPE.STORAGE_BUFFER,
        bufferInfos: [{ buffer: BUF_C, offset: 0n, range: BYTE_SIZE }],
      },
    ]);

    enc.vkCreateCommandPool(DEV, 0, CMD_POOL);
    enc.vkAllocateCommandBuffers(DEV, CMD_POOL, [CMD_BUF]);
    enc.vkBeginCommandBuffer(CMD_BUF);
    enc.vkCmdBindPipeline(CMD_BUF, VK_PIPELINE_BIND_POINT.COMPUTE, PIPELINE);
    enc.vkCmdBindDescriptorSets(CMD_BUF, VK_PIPELINE_BIND_POINT.COMPUTE, PIPE_LAYOUT, 0, [DS]);
    enc.vkCmdDispatch(CMD_BUF, N / 64, 1, 1);
    enc.vkEndCommandBuffer(CMD_BUF);
    enc.vkCreateFence(DEV, false, FENCE);

    // Push setup stream through a VenusRing
    const shmem = new Uint8Array(16384);
    const ring = new VenusRing(shmem, {
      headOffset: 0,
      tailOffset: 4,
      statusOffset: 8,
      bufferOffset: 64,
      bufferSize: 8192,
    });
    ring.write(enc.finish());
    const setupReplies = await decoder.execute(ring.consumeAvailable());
    expect(setupReplies.byteLength).toBeGreaterThan(0);

    // 2. Populate guest host-visible memory A and B
    const hostA = new Float32Array(backend.getMemoryHostData(MEM_A)!.buffer);
    const hostB = new Float32Array(backend.getMemoryHostData(MEM_B)!.buffer);
    for (let i = 0; i < N; i++) {
      hostA[i] = i * 1.5;
      hostB[i] = i * 2.5;
    }

    // 3. Submit and wait for fence
    const submitEnc = new VenusCommandEncoder();
    submitEnc.vkFlushMappedMemoryRanges(DEV, [
      { memory: MEM_A, offset: 0n, size: BYTE_SIZE },
      { memory: MEM_B, offset: 0n, size: BYTE_SIZE },
    ]);
    submitEnc.vkQueueSubmit(QUEUE, [{ waitSemaphores: [], commandBuffers: [CMD_BUF], signalSemaphores: [] }], FENCE);
    submitEnc.vkWaitForFences(DEV, [FENCE], true, 0xffffffffffffffffn);

    ring.write(submitEnc.finish());
    const submitReplies = await decoder.execute(ring.consumeAvailable());

    // Verify all 3 replies returned VK_SUCCESS
    const rdec = new VenusCsDecoder(submitReplies);
    for (let i = 0; i < 3; i++) {
      rdec.readU32(); // commandType
      rdec.readU32(); // commandFlags
      expect(rdec.readI32()).toBe(VK_RESULT.VK_SUCCESS);
    }

    // 4. Verify output vector C[i] == A[i] + B[i]
    const hostC = new Float32Array(backend.getMemoryHostData(MEM_C)!.buffer);
    for (let i = 0; i < N; i++) {
      expect(hostC[i]).toBeCloseTo(i * 4.0, 5);
    }
  });
});
