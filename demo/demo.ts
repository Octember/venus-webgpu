import {
  createCubeFragmentSpirv,
  createCubeVertexSpirv,
  createVectorAddSpirv,
  SpirvTranslator,
  VenusCommandDecoder,
  VenusCommandEncoder,
  VenusRing,
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
  VK_SHADER_STAGE,
  WebGpuVenusBackend,
} from "../src/index.ts";

const out = document.getElementById("out")!;
const btn = document.getElementById("run")!;
const cubeBtn = document.getElementById("run-cube")!;
const canvas = document.getElementById("cube-canvas") as HTMLCanvasElement;

declare global {
  interface Window {
    venusDemo: {
      status: string;
      frames: number;
      computePassed: boolean;
      lastError: string | null;
    };
  }
}

window.venusDemo = {
  status: "idle",
  frames: 0,
  computePassed: false,
  lastError: null,
};

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

    const badge = document.createElement("span");
    badge.className = "ok";
    badge.textContent = "PASS";
    out.replaceChildren(
      badge,
      document.createTextNode(
        `: ${N} floats computed in ${elapsedMs} ms (mismatches: ${mismatches})\n` +
          `Sample: C[0]=${hostC[0]}, C[1]=${hostC[1]}, C[4095]=${hostC[4095]}\n\n` +
          `--- Translated WGSL (via naga-wasm) ---\n${wgsl}`,
      ),
    );
    window.venusDemo.computePassed = mismatches === 0;
    window.venusDemo.status = mismatches === 0 ? "compute-pass" : "compute-fail";
  } catch (err) {
    const badge = document.createElement("span");
    badge.className = "err";
    badge.textContent = "ERROR";
    out.replaceChildren(badge, document.createTextNode(`: ${(err as Error).message}`));
    window.venusDemo.lastError = (err as Error).message;
    window.venusDemo.status = "error";
  }
});

function buildMvpMatrix(angle: number, aspect: number): Float32Array {
  const fov = (45 * Math.PI) / 180;
  const f = 1 / Math.tan(fov / 2);
  const near = 0.1;
  const far = 100;
  const nf = 1 / (near - far);

  // Perspective projection (column-major)
  const proj = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, near * far * nf, 0,
  ]);

  // ModelView: translate(0, 0, -3.2) * rotateY(angle) * rotateX(angle * 0.7)
  const cy = Math.cos(angle);
  const sy = Math.sin(angle);
  const cx = Math.cos(angle * 0.7);
  const sx = Math.sin(angle * 0.7);

  const mv = new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, -3.2, 1,
  ]);

  const outM = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      outM[c * 4 + r] =
        proj[0 * 4 + r] * mv[c * 4 + 0] +
        proj[1 * 4 + r] * mv[c * 4 + 1] +
        proj[2 * 4 + r] * mv[c * 4 + 2] +
        proj[3 * 4 + r] * mv[c * 4 + 3];
    }
  }
  return outM;
}

let cubeAnimId = 0;

cubeBtn.addEventListener("click", async () => {
  if (cubeAnimId) cancelAnimationFrame(cubeAnimId);
  out.textContent = "Initializing 3D Cube via Venus -> naga-wasm -> WebGPU...";
  window.venusDemo.status = "cube-init";
  try {
    if (!navigator.gpu) throw new Error("WebGPU is not supported in this browser.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found.");
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("Could not get WebGPU canvas context.");

    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    const vkColorFmt = format === "bgra8unorm" ? VK_FORMAT.B8G8R8A8_UNORM : VK_FORMAT.R8G8B8A8_UNORM;

    const translator = new SpirvTranslator();
    const vsSpirv = createCubeVertexSpirv();
    const fsSpirv = createCubeFragmentSpirv();
    const backend = new WebGpuVenusBackend({ device, translator, canvasContext: ctx });
    const decoder = new VenusCommandDecoder(backend);

    // 8 vertices: (x, y, z, r, g, b)
    const vertices = new Float32Array([
      -0.7, -0.7,  0.7, 1, 0, 0,
       0.7, -0.7,  0.7, 0, 1, 0,
       0.7,  0.7,  0.7, 0, 0, 1,
      -0.7,  0.7,  0.7, 1, 1, 0,
      -0.7, -0.7, -0.7, 1, 0, 1,
       0.7, -0.7, -0.7, 0, 1, 1,
       0.7,  0.7, -0.7, 1, 1, 1,
      -0.7,  0.7, -0.7, 0.3, 0.3, 0.3,
    ]);
    const indices = new Uint16Array([
      0, 1, 2, 2, 3, 0, // front
      1, 5, 6, 6, 2, 1, // right
      5, 4, 7, 7, 6, 5, // back
      4, 0, 3, 3, 7, 4, // left
      3, 2, 6, 6, 7, 3, // top
      4, 5, 1, 1, 0, 4, // bottom
    ]);

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

    enc.vkCreateBuffer(DEV, BigInt(vertices.byteLength), VK_BUFFER_USAGE.VERTEX_BUFFER, BUF_V);
    enc.vkAllocateMemory(DEV, BigInt(vertices.byteLength), 1, MEM_V);
    enc.vkBindBufferMemory(DEV, BUF_V, MEM_V, 0n);
    enc.vkMapMemory(DEV, MEM_V, 0n, BigInt(vertices.byteLength));

    enc.vkCreateBuffer(DEV, BigInt(indices.byteLength), VK_BUFFER_USAGE.INDEX_BUFFER, BUF_I);
    enc.vkAllocateMemory(DEV, BigInt(indices.byteLength), 1, MEM_I);
    enc.vkBindBufferMemory(DEV, BUF_I, MEM_I, 0n);
    enc.vkMapMemory(DEV, MEM_I, 0n, BigInt(indices.byteLength));

    enc.vkCreateBuffer(DEV, 64n, VK_BUFFER_USAGE.UNIFORM_BUFFER, BUF_U);
    enc.vkAllocateMemory(DEV, 64n, 1, MEM_U);
    enc.vkBindBufferMemory(DEV, BUF_U, MEM_U, 0n);
    enc.vkMapMemory(DEV, MEM_U, 0n, 64n);

    enc.vkCreateShaderModule(DEV, vsSpirv, VS);
    enc.vkCreateShaderModule(DEV, fsSpirv, FS);
    enc.vkCreateDescriptorSetLayout(
      DEV,
      [{ binding: 0, descriptorType: VK_DESCRIPTOR_TYPE.UNIFORM_BUFFER, descriptorCount: 1, stageFlags: VK_SHADER_STAGE.VERTEX }],
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

    enc.vkCreateImage(DEV, { format: vkColorFmt, width: canvas.width, height: canvas.height, usage: VK_IMAGE_USAGE.COLOR_ATTACHMENT | VK_IMAGE_USAGE.TRANSFER_SRC }, IMG_C);
    enc.vkCreateImageView(DEV, { image: IMG_C, format: vkColorFmt, aspectMask: 1 }, VIEW_C);
    enc.vkCreateImage(DEV, { format: VK_FORMAT.D32_SFLOAT, width: canvas.width, height: canvas.height, usage: VK_IMAGE_USAGE.DEPTH_STENCIL_ATTACHMENT }, IMG_D);
    enc.vkCreateImageView(DEV, { image: IMG_D, format: VK_FORMAT.D32_SFLOAT, aspectMask: 2 }, VIEW_D);

    enc.vkCreateRenderPass(
      DEV,
      {
        colorAttachment: { format: vkColorFmt, loadOp: VK_ATTACHMENT_LOAD_OP.CLEAR, storeOp: VK_ATTACHMENT_STORE_OP.STORE },
        depthAttachment: { format: VK_FORMAT.D32_SFLOAT, loadOp: VK_ATTACHMENT_LOAD_OP.CLEAR, storeOp: VK_ATTACHMENT_STORE_OP.DONT_CARE },
      },
      RP,
    );
    enc.vkCreateFramebuffer(DEV, { renderPass: RP, attachments: [VIEW_C, VIEW_D], width: canvas.width, height: canvas.height }, FB);
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
    enc.vkCmdBeginRenderPass(CMD_BUF, RP, FB, [0.04, 0.06, 0.1, 1.0], 1.0);
    enc.vkCmdBindPipeline(CMD_BUF, VK_PIPELINE_BIND_POINT.GRAPHICS, PIPELINE);
    enc.vkCmdBindDescriptorSets(CMD_BUF, VK_PIPELINE_BIND_POINT.GRAPHICS, PIPE_LAYOUT, 0, [DS]);
    enc.vkCmdBindVertexBuffers(CMD_BUF, 0, [BUF_V], [0n]);
    enc.vkCmdBindIndexBuffer(CMD_BUF, BUF_I, 0n, VK_INDEX_TYPE.UINT16);
    enc.vkCmdDrawIndexed(CMD_BUF, indices.length, 1, 0, 0, 0);
    enc.vkCmdEndRenderPass(CMD_BUF);
    enc.vkEndCommandBuffer(CMD_BUF);
    enc.vkCreateFence(DEV, false, FENCE);

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

    new Uint8Array(backend.getMemoryHostData(MEM_V)!.buffer).set(new Uint8Array(vertices.buffer));
    new Uint8Array(backend.getMemoryHostData(MEM_I)!.buffer).set(new Uint8Array(indices.buffer));
    const uboBytes = backend.getMemoryHostData(MEM_U)!;

    const flushStatic = new VenusCommandEncoder();
    flushStatic.vkFlushMappedMemoryRanges(DEV, [
      { memory: MEM_V, offset: 0n, size: BigInt(vertices.byteLength) },
      { memory: MEM_I, offset: 0n, size: BigInt(indices.byteLength) },
    ]);
    ring.write(flushStatic.finish());
    await decoder.execute(ring.consumeAvailable());

    window.venusDemo.status = "cube-running";
    out.textContent = "3D Cube running via Venus -> naga-wasm -> WebGPU!";

    const renderFrame = async (timeMs: number) => {
      const mvp = buildMvpMatrix(timeMs * 0.001, canvas.width / canvas.height);
      uboBytes.set(new Uint8Array(mvp.buffer));
      const frameEnc = new VenusCommandEncoder();
      frameEnc.vkFlushMappedMemoryRanges(DEV, [{ memory: MEM_U, offset: 0n, size: 64n }]);
      frameEnc.vkQueueSubmit(QUEUE, [{ waitSemaphores: [], commandBuffers: [CMD_BUF], signalSemaphores: [] }], FENCE);
      frameEnc.vkQueuePresentKHR(QUEUE, IMG_C);
      ring.write(frameEnc.finish());
      await decoder.execute(ring.consumeAvailable());
      window.venusDemo.frames++;
      cubeAnimId = requestAnimationFrame((t) => void renderFrame(t));
    };
    cubeAnimId = requestAnimationFrame((t) => void renderFrame(t));
  } catch (err) {
    const badge = document.createElement("span");
    badge.className = "err";
    badge.textContent = "ERROR";
    out.replaceChildren(badge, document.createTextNode(`: ${(err as Error).message}`));
    window.venusDemo.lastError = (err as Error).message;
    window.venusDemo.status = "error";
  }
});
