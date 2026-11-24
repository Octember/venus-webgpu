/**
 * Lightweight headless WebGPU mock for Bun/Node unit & E2E tests.
 * Executes vector-add compute dispatches and buffer copies on backing Uint8Arrays.
 */

if (typeof globalThis.GPUBufferUsage === "undefined") {
  (globalThis as Record<string, unknown>).GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
}

if (typeof globalThis.GPUShaderStage === "undefined") {
  (globalThis as Record<string, unknown>).GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  };
}

if (typeof globalThis.GPUMapMode === "undefined") {
  (globalThis as Record<string, unknown>).GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002,
  };
}

class MockGPUBuffer {
  readonly size: number;
  readonly usage: number;
  readonly data: Uint8Array;
  destroyed = false;

  constructor(desc: GPUBufferDescriptor) {
    this.size = desc.size;
    this.usage = desc.usage;
    this.data = new Uint8Array(desc.size);
  }

  async mapAsync(_mode: number): Promise<void> {}
  getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
    return this.data.slice(offset, offset + size).buffer;
  }
  unmap(): void {}
  destroy(): void {
    this.destroyed = true;
  }
}

interface MockBindGroup {
  entries: GPUBindGroupEntry[];
}

export function createMockGPUDevice(): GPUDevice {
  const queue = {
    writeBuffer(
      buffer: GPUBuffer,
      bufferOffset: number,
      data: ArrayBufferView | ArrayBuffer,
      dataOffset = 0,
      size?: number,
    ) {
      const mock = buffer as unknown as MockGPUBuffer;
      const src =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const byteLen = size ?? src.byteLength - dataOffset;
      mock.data.set(src.subarray(dataOffset, dataOffset + byteLen), bufferOffset);
    },
    submit(commandBuffers: GPUCommandBuffer[]) {
      for (const cb of commandBuffers) {
        const ops = (cb as unknown as { ops: Array<() => void> }).ops;
        for (const op of ops) op();
      }
    },
    async onSubmittedWorkDone() {},
  };

  const device = {
    limits: {
      minStorageBufferOffsetAlignment: 256,
      maxComputeWorkgroupsPerDimension: 65535,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
    },
    queue,
    createBuffer(desc: GPUBufferDescriptor): GPUBuffer {
      return new MockGPUBuffer(desc) as unknown as GPUBuffer;
    },
    createShaderModule(desc: GPUShaderModuleDescriptor): GPUShaderModule {
      return { code: desc.code } as unknown as GPUShaderModule;
    },
    createBindGroupLayout(desc: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
      return desc as unknown as GPUBindGroupLayout;
    },
    createPipelineLayout(desc: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
      return desc as unknown as GPUPipelineLayout;
    },
    createComputePipeline(desc: GPUComputePipelineDescriptor): GPUComputePipeline {
      return desc as unknown as GPUComputePipeline;
    },
    createRenderPipeline(desc: GPURenderPipelineDescriptor): GPURenderPipeline {
      return desc as unknown as GPURenderPipeline;
    },
    createTexture(desc: GPUTextureDescriptor): GPUTexture {
      return {
        ...desc,
        createView: () => ({ texture: desc }) as unknown as GPUTextureView,
        destroy: () => {},
      } as unknown as GPUTexture;
    },
    createSampler(desc?: GPUSamplerDescriptor): GPUSampler {
      return (desc ?? {}) as unknown as GPUSampler;
    },
    createBindGroup(desc: GPUBindGroupDescriptor): GPUBindGroup {
      return { entries: [...desc.entries] } as unknown as GPUBindGroup;
    },
    createCommandEncoder(): GPUCommandEncoder {
      const ops: Array<() => void> = [];
      let currentBindGroup: MockBindGroup | null = null;

      return {
        beginComputePass(): GPUComputePassEncoder {
          return {
            setPipeline(_p: GPUComputePipeline) {},
            setBindGroup(_index: number, bg: GPUBindGroup) {
              currentBindGroup = bg as unknown as MockBindGroup;
            },
            dispatchWorkgroups(x: number, y = 1, z = 1) {
              const bg = currentBindGroup;
              ops.push(() => {
                if (!bg || bg.entries.length < 3) return;
                const getSlice = (entry: GPUBindGroupEntry) => {
                  const res = entry.resource as GPUBufferBinding;
                  const buf = res.buffer as unknown as MockGPUBuffer;
                  const off = res.offset ?? 0;
                  const len = res.size ?? buf.size - off;
                  return new Float32Array(buf.data.buffer, buf.data.byteOffset + off, len >>> 2);
                };
                const a = getSlice(bg.entries[0]);
                const b = getSlice(bg.entries[1]);
                const c = getSlice(bg.entries[2]);
                const count = Math.min(a.length, b.length, c.length, x * 64 * y * z);
                for (let i = 0; i < count; i++) {
                  c[i] = a[i] + b[i];
                }
              });
            },
            end() {},
          } as unknown as GPUComputePassEncoder;
        },
        copyBufferToBuffer(
          src: GPUBuffer,
          srcOffset: number,
          dst: GPUBuffer,
          dstOffset: number,
          size: number,
        ) {
          ops.push(() => {
            const s = src as unknown as MockGPUBuffer;
            const d = dst as unknown as MockGPUBuffer;
            d.data.set(s.data.subarray(srcOffset, srcOffset + size), dstOffset);
          });
        },
        beginRenderPass(_desc: GPURenderPassDescriptor): GPURenderPassEncoder {
          return {
            setPipeline() {},
            setBindGroup() {},
            setVertexBuffer() {},
            setIndexBuffer() {},
            setViewport() {},
            setScissorRect() {},
            draw() {},
            drawIndexed() {},
            end() {},
          } as unknown as GPURenderPassEncoder;
        },
        copyBufferToTexture() {},
        copyTextureToBuffer() {},
        finish(): GPUCommandBuffer {
          return { ops } as unknown as GPUCommandBuffer;
        },
      } as unknown as GPUCommandEncoder;
    },
  };

  return device as unknown as GPUDevice;
}
