# venus-webgpu

**Venus (virtio-gpu Vulkan) → WebGPU Bridge for Browser Linux**

`venus-webgpu` decodes Mesa's standard `venus-protocol` Vulkan command stream and executes it on the browser's `GPUDevice` (WebGPU), using [`naga-wasm`](https://www.npmjs.com/package/naga-wasm) for SPIR-V → WGSL shader translation.

It is designed as a standalone, zero-monorepo-coupling npm package for browser Linux runtimes such as **`unkernel`** (`pithings/unkernel`), **`trynix.dev`**, and **`qemu-wasm`**.

## Architecture

```
Linux Guest (stock Mesa Venus ICD)
  │  /dev/dri/renderD128 (venus-protocol wire stream)
  ▼
virtio-gpu (unkernel / qemu-wasm)
  │  UnkernelVenusBackend (GET_CAPSET_INFO, GET_CAPSET, SUBMIT_3D)
  ▼
VenusRing + VenusCommandDecoder (TypeScript, 4-byte aligned)
  │  ├── SpirvTranslator (naga-wasm: SPIR-V → WGSL, FNV-1a cached)
  │  └── WebGpuVenusBackend (GPUBuffer, GPUComputePipeline, GPUBindGroup)
  ▼
Browser WebGPU (GPUDevice / GPUCommandEncoder / GPUQueue)
```

## Open Questions Resolved

1. **How does `unkernel`'s `virtio-gpu` expose capsets and host command rings to JS?**
   `unkernel`'s `VirtioGpu` (`js/core/virtio-gpu.ts`) delegates `GET_CAPSET_INFO`, `GET_CAPSET`, `CTX_CREATE`, `RESOURCE_CREATE_BLOB`, and `SUBMIT_3D` to a `GpuBackend` interface. `UnkernelVenusBackend` (`venus-webgpu/unkernel`) implements this interface, advertising `VIRTIO_GPU_F_VIRGL | VIRTIO_GPU_F_RESOURCE_BLOB | VIRTIO_GPU_F_CONTEXT_INIT` and `VIRTIO_GPU_CAPSET_VENUS` (`id = 4`, `size = 160`).
   *Note*: `unkernel`'s `kwvirtio` transport does not yet expose a PCI `shm_region` for `HOST3D` mappable blobs, so guest-backed blobs (`VIRTGPU_BLOB_MEM_GUEST`) are used for rings/staging.
2. **TypeScript vs Rust/Wasm for the Venus decoder?**
   TypeScript + `naga-wasm`: zero FFI boundary overhead for WebGPU calls (`device.createBuffer`, `queue.writeBuffer`, `beginComputePass`), fast iteration, and `naga-wasm` handles SPIR-V → WGSL in Wasm.
3. **Bridging synchronous Vulkan readbacks (`vkWaitForFences`, `vkQueueWaitIdle`, `vkInvalidateMappedMemoryRanges`) to async WebGPU `mapAsync()`?**
   `unkernel`'s `VirtioGpu` already accepts `Promise<Uint8Array | null>` from `GpuBackend.command()` and suspends/resumes guest tasks via its own JSPI scheduler while fenced Promises are pending. `WebGpuVenusBackend` awaits `queue.onSubmittedWorkDone()` and staging `mapAsync(GPUMapMode.READ)` before resolving.

## Milestones

- **Phase 1 — Compute MVP** (Implemented): Instance/device setup, storage buffers, SPIR-V → WGSL via `naga-wasm`, `VkComputePipeline`, `vkCmdDispatch`, `vkQueueSubmit`, `vkWaitForFences`, and `UnkernelVenusBackend`.
- **Phase 2 — Graphics & Presentation** (Planned): `VkRenderPipeline`, textures/samplers, render passes, and `OffscreenCanvas` presentation (`vkcube`).
- **Phase 3 — OpenGL via Zink** (Planned): Mesa Zink (OpenGL-on-Vulkan) over Venus → WebGPU.

## Quickstart

```bash
bun install
bun test          # Unit + E2E compute tests (headless MockGPUDevice + real naga-wasm)
bun run typecheck # Strict TypeScript check
bun run build     # Bundle library + demo + .d.ts
bun run demo      # Serve browser demo at http://localhost:4173
```

## `unkernel` Integration

```ts
import { UnkernelVenusBackend } from "venus-webgpu/unkernel";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const backend = new UnkernelVenusBackend(device);

// Pass `backend` as `VirtioGpuOptions.backend` in unkernel
```
