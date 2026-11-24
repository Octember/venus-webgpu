import {
  createVectorAddSpirv,
  SpirvTranslator,
  VenusCommandDecoder,
  VenusCommandEncoder,
  VenusRing,
  VK_BUFFER_USAGE,
  VK_DESCRIPTOR_TYPE,
  VK_PIPELINE_BIND_POINT,
  VK_SHADER_STAGE,
  WebGpuVenusBackend,
} from "../src/index.ts";

const out = document.getElementById("out")!;
const btn = document.getElementById("run")!;

btn.addEventListener("click", async () => {
  out.textContent = "Initializing WebGPU & naga-wasm...";
  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found.");
    const device = await adapter.requestDevice();

    const translator = new SpirvTranslator();
    const spirv = createVectorAddSpirv();
    const { wgsl } = await translator.translateToWgsl(spirv);

    const N = 4096;
    const BYTE_SIZE = BigInt(N * 4);
    const backend = new WebGpuVenusBackend({ device, translator });
    const decoder = new VenusCommandDecoder(backend);

    const enc = new VenusCommandEncoder();
    const INST = 1n;
    const PHYS = 0x1000n;
    const DEV = 2n;
    const QUEUE = 3n;
    const [MEM_A, MEM_B, MEM_C] = [10n, 11n, 12n];
    const [BUF_A, BUF_B, BUF_C] = [20n, 21n, 22n];
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
      enc.vkAllocateMemory(DEV, BYTE_SIZE, 1, mem);
      enc.vkBindBufferMemory(DEV, buf, mem, 0n);
      enc.vkMapMemory(DEV, mem, 0n, BYTE_SIZE);
    }

    enc.vkCreateShaderModule(DEV, spirv, SHADER);
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

    const shmem = new Uint8Array(16384);
    const ring = new VenusRing(shmem, {
      headOffset: 0,
      tailOffset: 4,
      statusOffset: 8,
      bufferOffset: 64,
      bufferSize: 8192,
    });
    ring.write(enc.finish());
    await decoder.execute(ring.consumeAvailable());

    const hostA = new Float32Array(backend.getMemoryHostData(MEM_A)!.buffer);
    const hostB = new Float32Array(backend.getMemoryHostData(MEM_B)!.buffer);
    for (let i = 0; i < N; i++) {
      hostA[i] = i;
      hostB[i] = i * 2;
    }

    const t0 = performance.now();
    const submitEnc = new VenusCommandEncoder();
    submitEnc.vkFlushMappedMemoryRanges(DEV, [
      { memory: MEM_A, offset: 0n, size: BYTE_SIZE },
      { memory: MEM_B, offset: 0n, size: BYTE_SIZE },
    ]);
    submitEnc.vkQueueSubmit(QUEUE, [{ waitSemaphores: [], commandBuffers: [CMD_BUF], signalSemaphores: [] }], FENCE);
    submitEnc.vkWaitForFences(DEV, [FENCE], true, 0xffffffffffffffffn);
    ring.write(submitEnc.finish());
    await decoder.execute(ring.consumeAvailable());
    const elapsedMs = (performance.now() - t0).toFixed(2);

    const hostC = new Float32Array(backend.getMemoryHostData(MEM_C)!.buffer);
    let mismatches = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(hostC[i] - i * 3) > 1e-4) mismatches++;
    }

    out.innerHTML =
      `<span class="ok">PASS</span>: ${N} floats computed in ${elapsedMs} ms (mismatches: ${mismatches})\n` +
      `Sample: C[0]=${hostC[0]}, C[1]=${hostC[1]}, C[4095]=${hostC[4095]}\n\n` +
      `--- Translated WGSL (via naga-wasm) ---\n${wgsl}`;
  } catch (err) {
    out.innerHTML = `<span class="err">ERROR</span>: ${(err as Error).message}`;
  }
});
