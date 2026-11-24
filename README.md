# venus-webgpu

**`venus-webgpu` lets Linux apps running in a browser tab use your real GPU for compute and 3D graphics via WebGPU, instead of slow CPU emulation or expensive server-side GPU streaming.**

It is a standalone, zero-monorepo-coupling npm package designed for browser Linux runtimes such as **`unkernel`** (`pithings/unkernel`), **`trynix.dev`**, and **`qemu-wasm`**.

## Why this exists

When you run Linux inside a browser tab (via WebAssembly), graphics and GPU compute usually hit a wall:

- **CPU software rendering** (like `llvmpipe`) is orders of magnitude slower than a real GPU and burns battery.
- **Cloud GPU streaming** requires renting servers, managing sessions, and paying latency/bandwidth costs.

`venus-webgpu` solves this locally. Linux apps already know how to talk to a virtual GPU using **Venus** (Mesa's standard virtualized Vulkan driver). `venus-webgpu` decodes that command stream in TypeScript, translates shaders on the fly with `naga-wasm`, and executes everything directly on the browser's `GPUDevice` (WebGPU).

## Milestones

| Phase | Status | Scope |
| --- | --- | --- |
| **Phase 1 — Compute MVP** | Implemented & Verified (Chrome WebGPU) | Compute pipelines (`VkComputePipeline`), storage buffers, SPIR-V → WGSL shader translation via `naga-wasm`, `vkCmdDispatch`, `vkQueueSubmit`, `vkWaitForFences`, and `UnkernelVenusBackend`. |
| **Phase 2 — Graphics & Presentation** | Implemented & Verified (Chrome WebGPU) | 3D render pipelines (`VkRenderPipeline`), textures and samplers, depth testing, and live `<canvas>` presentation (rotating 3D cube demo). |
| **Phase 3 — OpenGL via Zink** | Planned | Running Mesa Zink (OpenGL-on-Vulkan) over Venus → WebGPU. |

## How It Works

```
  Linux App in Browser (e.g. Vulkan / compute / 3D)
         │
         ▼  standard Linux GPU commands (Venus protocol)
  Browser Linux Runtime (unkernel / qemu-wasm)
         │
         ▼  passes command buffer to JS
  venus-webgpu
    ├── Translates shaders (SPIR-V ──► WGSL via naga-wasm)
    └── Maps buffers, pipelines & draw calls to WebGPU
         │
         ▼  GPUDevice / GPUCommandEncoder / GPUQueue
  Your Real GPU (via Browser WebGPU)
```

## Try It in 30 Seconds

Requires [Bun](https://bun.sh/) and a WebGPU-capable browser (such as Chrome).

```bash
bun install
bun run check     # Typecheck + unit/E2E tests + build
bun run demo      # Start the local demo server at http://localhost:4173
```

Open **`http://localhost:4173`** in Chrome to see both:
- **Compute Demo**: Runs a 4096-float GPU compute shader through the Venus → WebGPU pipeline and verifies the output.
- **3D Cube Demo**: Renders a live, rotating 3D cube to a `<canvas>` using WebGPU render pipelines, depth testing, and textures.

## `unkernel` Integration

Drop `UnkernelVenusBackend` into `unkernel` to give guest Linux programs hardware-accelerated WebGPU access:

```ts
import { createKernel } from "unkernel";
import { createUnkernelVenusBackend } from "venus-webgpu/unkernel";

const gpuBackend = await createUnkernelVenusBackend();

// Note: `worker: false` is required so the inline WebGPU backend runs on the main/UI thread.
const kernel = await createKernel({ gpu: true, gpuBackend, worker: false });
```

## Plain-English Glossary

- **Vulkan**: A modern, low-level 3D graphics and compute API used by Linux apps and games.
- **Venus**: Mesa's virtualized Vulkan driver that serializes Vulkan commands into a byte stream so a VM guest can send them to a host GPU.
- **`virtio-gpu`**: The standard virtual GPU device interface used by Linux VMs (like QEMU and `unkernel`) to pass graphics commands to the host.
- **SPIR-V**: The portable binary format that Vulkan shaders are compiled into.
- **WGSL**: WebGPU Shading Language—the shader language that browsers accept for WebGPU.
- **`naga-wasm`**: A WebAssembly build of `naga` (from `wgpu`) that translates SPIR-V shaders into WGSL right in the browser.
- **WebGPU**: The modern browser API (`navigator.gpu`) that gives web apps direct, high-performance access to your device's GPU.
- **`unkernel`**: A browser-based Linux runtime (`pithings/unkernel`) that runs Linux binaries in WebAssembly.

---

## Deep-Dive Architecture (For Systems Engineers)

```
Linux Guest (stock Mesa Venus ICD)
  │  /dev/dri/renderD128 (venus-protocol wire stream)
  ▼
virtio-gpu (unkernel / qemu-wasm)
  │  UnkernelVenusBackend (GET_CAPSET_INFO, GET_CAPSET, SUBMIT_3D)
  ▼
VenusRing + VenusCommandDecoder (TypeScript, 4-byte aligned)
  │  ├── SpirvTranslator (naga-wasm: SPIR-V → WGSL, FNV-1a cached)
  │  └── WebGpuVenusBackend (GPUBuffer, GPUComputePipeline, GPURenderPipeline, GPUBindGroup)
  ▼
Browser WebGPU (GPUDevice / GPUCommandEncoder / GPUQueue)
```

### `unkernel` Open Questions Resolved

- **Capsets & command rings**: `unkernel`'s `VirtioGpu` (`js/core/virtio-gpu.ts`) delegates `GET_CAPSET_INFO`, `GET_CAPSET`, `CTX_CREATE`, `RESOURCE_CREATE_BLOB`, and `SUBMIT_3D` to a `GpuBackend` interface. `UnkernelVenusBackend` (`venus-webgpu/unkernel`) implements this interface, advertising `VIRTIO_GPU_F_VIRGL | VIRTIO_GPU_F_RESOURCE_BLOB | VIRTIO_GPU_F_CONTEXT_INIT` and `VIRTIO_GPU_CAPSET_VENUS` (`id = 4`, `size = 160`). Because `unkernel`'s `kwvirtio` transport does not yet expose a PCI `shm_region` for `HOST3D` mappable blobs, guest-backed blobs (`VIRTGPU_BLOB_MEM_GUEST`) are used for rings and staging.
- **TypeScript vs. Rust/Wasm decoder**: TypeScript + `naga-wasm` avoids FFI boundary overhead on WebGPU calls (`device.createBuffer`, `queue.writeBuffer`, `beginComputePass`, `beginRenderPass`) while keeping SPIR-V → WGSL translation in Wasm.
- **Sync Vulkan readbacks vs. async WebGPU `mapAsync()`**: `unkernel`'s `VirtioGpu` accepts `Promise<Uint8Array | null>` from `GpuBackend.command()` and suspends/resumes guest tasks via its JSPI scheduler. `WebGpuVenusBackend` awaits `queue.onSubmittedWorkDone()` and staging `mapAsync(GPUMapMode.READ)` before resolving.

### Packaging & Build

The package exports `.` (`dist/index.js`) and `./unkernel` (`dist/transport/unkernel.js`).

```bash
bun run typecheck # Strict TypeScript check (tsc --noEmit)
bun run build     # Bundle library + demo + naga_bg.wasm + .d.ts
```
