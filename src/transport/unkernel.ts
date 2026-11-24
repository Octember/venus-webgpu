import { WebGpuVenusBackend } from "../backend/webgpu-backend.ts";
import { encodeVenusCapset, VENUS_CAPSET_SIZE, VIRTIO_GPU_CAPSET_VENUS } from "../protocol/constants.ts";
import { VenusCommandDecoder } from "../protocol/decoder.ts";

/**
 * Minimal unkernel virtio-gpu types matching pithings/unkernel's js/core/virtio-gpu.ts.
 */
export interface VirtqBuffer {
  addr: number;
  len: number;
}

export interface UnkernelGpuBackendContext {
  memory(): WebAssembly.Memory;
  backing(resourceId: number): readonly VirtqBuffer[] | null;
}

export interface UnkernelGpuBackend {
  readonly features: bigint;
  readonly capsetCount: number;
  command(cmd: Uint8Array, ctx: UnkernelGpuBackendContext): Uint8Array | null | Promise<Uint8Array | null>;
  resource(id: number): { width: number; height: number } | null;
  reset?(): void;
  blocker?(): string;
}

export const VIRTIO_GPU_F_VIRGL = 1n << 0n;
export const VIRTIO_GPU_F_RESOURCE_BLOB = 1n << 3n;
export const VIRTIO_GPU_F_CONTEXT_INIT = 1n << 4n;

export const UNKERNEL_GPU_CMD = {
  RESOURCE_UNREF: 0x0102,
  GET_CAPSET_INFO: 0x0108,
  GET_CAPSET: 0x0109,
  RESOURCE_CREATE_BLOB: 0x010c,
  CTX_CREATE: 0x0200,
  CTX_DESTROY: 0x0201,
  CTX_ATTACH_RESOURCE: 0x0202,
  CTX_DETACH_RESOURCE: 0x0203,
  SUBMIT_3D: 0x0207,
} as const;

export const UNKERNEL_GPU_RESP = {
  OK_NODATA: 0x1100,
  OK_CAPSET_INFO: 0x1102,
  OK_CAPSET: 0x1103,
  ERR_UNSPEC: 0x1200,
  ERR_INVALID_PARAMETER: 0x1205,
} as const;

const HDR_SIZE = 24;

function respHeader(type: number, size = HDR_SIZE): Uint8Array {
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, type, true);
  return out;
}

interface BlobResource {
  id: number;
  size: bigint;
  blobMem: number;
  blobFlags: number;
}

/**
 * Adapts WebGpuVenusBackend + VenusCommandDecoder to unkernel's GpuBackend interface.
 * Unkernel's VirtioGpu awaits returned Promises and signals the guest fence via JSPI.
 */
export class UnkernelVenusBackend implements UnkernelGpuBackend {
  readonly features = VIRTIO_GPU_F_VIRGL | VIRTIO_GPU_F_RESOURCE_BLOB | VIRTIO_GPU_F_CONTEXT_INIT;
  readonly capsetCount = 1;

  readonly backend: WebGpuVenusBackend;
  readonly decoder: VenusCommandDecoder;
  private readonly contexts = new Set<number>();
  private readonly blobs = new Map<number, BlobResource>();
  private inFlight = 0;

  constructor(device: GPUDevice) {
    this.backend = new WebGpuVenusBackend({ device });
    this.decoder = new VenusCommandDecoder(this.backend);
  }

  resource(_id: number): { width: number; height: number } | null {
    return null;
  }

  blocker(): string {
    return this.inFlight > 0 ? "venus-webgpu commands" : "";
  }

  reset(): void {
    this.contexts.clear();
    this.blobs.clear();
    this.backend.objects.clear();
    this.inFlight = 0;
  }

  command(cmd: Uint8Array, _ctx: UnkernelGpuBackendContext): Uint8Array | null | Promise<Uint8Array | null> {
    if (cmd.byteLength < HDR_SIZE) {
      return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
    }
    const dv = new DataView(cmd.buffer, cmd.byteOffset, cmd.byteLength);
    const type = dv.getUint32(0, true);
    const ctxId = dv.getUint32(16, true);

    switch (type) {
      case UNKERNEL_GPU_CMD.GET_CAPSET_INFO: {
        const index = dv.getUint32(HDR_SIZE, true);
        if (index !== 0) return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        const out = respHeader(UNKERNEL_GPU_RESP.OK_CAPSET_INFO, HDR_SIZE + 16);
        const odv = new DataView(out.buffer);
        odv.setUint32(HDR_SIZE, VIRTIO_GPU_CAPSET_VENUS, true);
        odv.setUint32(HDR_SIZE + 4, 0, true); // capset_max_version
        odv.setUint32(HDR_SIZE + 8, VENUS_CAPSET_SIZE, true);
        return out;
      }

      case UNKERNEL_GPU_CMD.GET_CAPSET: {
        const capset = encodeVenusCapset();
        const out = respHeader(UNKERNEL_GPU_RESP.OK_CAPSET, HDR_SIZE + capset.byteLength);
        out.set(capset, HDR_SIZE);
        return out;
      }

      case UNKERNEL_GPU_CMD.CTX_CREATE: {
        this.contexts.add(ctxId);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.CTX_DESTROY: {
        this.contexts.delete(ctxId);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_CREATE_BLOB: {
        const resourceId = dv.getUint32(HDR_SIZE, true);
        const blobMem = dv.getUint32(HDR_SIZE + 4, true);
        const blobFlags = dv.getUint32(HDR_SIZE + 8, true);
        const size = dv.getBigUint64(HDR_SIZE + 16, true);
        this.blobs.set(resourceId, { id: resourceId, size, blobMem, blobFlags });
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_UNREF: {
        const resourceId = dv.getUint32(HDR_SIZE, true);
        this.blobs.delete(resourceId);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.CTX_ATTACH_RESOURCE:
      case UNKERNEL_GPU_CMD.CTX_DETACH_RESOURCE: {
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.SUBMIT_3D: {
        const size = dv.getUint32(HDR_SIZE, true);
        const stream = cmd.subarray(HDR_SIZE + 4, HDR_SIZE + 4 + size);
        this.inFlight++;
        return this.decoder
          .execute(stream)
          .then(() => respHeader(UNKERNEL_GPU_RESP.OK_NODATA))
          .catch(() => respHeader(UNKERNEL_GPU_RESP.ERR_UNSPEC))
          .finally(() => {
            this.inFlight--;
          });
      }

      default:
        return respHeader(UNKERNEL_GPU_RESP.ERR_UNSPEC);
    }
  }
}
