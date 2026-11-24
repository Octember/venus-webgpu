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
  SET_SCANOUT: 0x0103,
  RESOURCE_FLUSH: 0x0104,
  RESOURCE_ATTACH_BACKING: 0x0106,
  RESOURCE_DETACH_BACKING: 0x0107,
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
  blobId: bigint;
  size: bigint;
  blobMem: number;
  blobFlags: number;
  backing: VirtqBuffer[];
}

interface ScanoutInfo {
  resourceId: number;
  width: number;
  height: number;
}

function parseMemEntries(dv: DataView, offset: number, nrEntries: number): VirtqBuffer[] {
  const entries: VirtqBuffer[] = [];
  for (let i = 0; i < nrEntries; i++) {
    const base = offset + i * 16;
    const addr = Number(dv.getBigUint64(base, true));
    const len = dv.getUint32(base + 8, true);
    entries.push({ addr, len });
  }
  return entries;
}

function writeReplyToGuestMemory(
  memory: WebAssembly.Memory,
  backing: readonly VirtqBuffer[],
  offset: number,
  reply: Uint8Array,
): void {
  const guest = new Uint8Array(memory.buffer);
  let remainingOffset = offset;
  let srcPos = 0;
  for (const seg of backing) {
    if (srcPos >= reply.byteLength) break;
    if (remainingOffset >= seg.len) {
      remainingOffset -= seg.len;
      continue;
    }
    const avail = seg.len - remainingOffset;
    const n = Math.min(avail, reply.byteLength - srcPos);
    guest.set(reply.subarray(srcPos, srcPos + n), seg.addr + remainingOffset);
    srcPos += n;
    remainingOffset = 0;
  }
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
  private readonly scanouts = new Map<number, ScanoutInfo>();
  private inFlight = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(device: GPUDevice) {
    this.backend = new WebGpuVenusBackend({ device });
    this.decoder = new VenusCommandDecoder(this.backend);
  }

  resource(id: number): { width: number; height: number } | null {
    for (const s of this.scanouts.values()) {
      if (s.resourceId === id) {
        return { width: s.width, height: s.height };
      }
    }
    return null;
  }

  blocker(): string {
    if (this.inFlight > 0) return "venus-webgpu commands";
    if (this.blobs.size > 0) return "virtio-gpu resources";
    if (this.contexts.size > 0) return "virtio-gpu contexts";
    return "";
  }

  reset(): void {
    this.contexts.clear();
    this.blobs.clear();
    this.scanouts.clear();
    this.backend.objects.clear();
    this.inFlight = 0;
    this.tail = Promise.resolve();
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
        if (cmd.byteLength < HDR_SIZE + 8) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const capsetId = dv.getUint32(HDR_SIZE, true);
        if (capsetId !== VIRTIO_GPU_CAPSET_VENUS) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const capset = encodeVenusCapset();
        const out = respHeader(UNKERNEL_GPU_RESP.OK_CAPSET, HDR_SIZE + capset.byteLength);
        out.set(capset, HDR_SIZE);
        return out;
      }

      case UNKERNEL_GPU_CMD.CTX_CREATE: {
        if (ctxId === 0 || cmd.byteLength < HDR_SIZE + 4) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        this.contexts.add(ctxId);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.CTX_DESTROY: {
        this.contexts.delete(ctxId);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_CREATE_BLOB: {
        if (cmd.byteLength < 56) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const resourceId = dv.getUint32(HDR_SIZE, true);
        const blobMem = dv.getUint32(HDR_SIZE + 4, true);
        const blobFlags = dv.getUint32(HDR_SIZE + 8, true);
        const nrEntries = dv.getUint32(HDR_SIZE + 12, true);
        if (cmd.byteLength < 56 + nrEntries * 16) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const blobId = dv.getBigUint64(HDR_SIZE + 16, true);
        const size = dv.getBigUint64(HDR_SIZE + 24, true);
        const backing = parseMemEntries(dv, HDR_SIZE + 32, nrEntries);
        this.blobs.set(resourceId, { id: resourceId, blobId, size, blobMem, blobFlags, backing });
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_ATTACH_BACKING: {
        if (cmd.byteLength < HDR_SIZE + 8) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const resourceId = dv.getUint32(HDR_SIZE, true);
        const nrEntries = dv.getUint32(HDR_SIZE + 4, true);
        if (cmd.byteLength < HDR_SIZE + 8 + nrEntries * 16) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const blob = this.blobs.get(resourceId);
        if (!blob) return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        blob.backing = parseMemEntries(dv, HDR_SIZE + 8, nrEntries);
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_DETACH_BACKING: {
        const resourceId = dv.getUint32(HDR_SIZE, true);
        const blob = this.blobs.get(resourceId);
        if (blob) blob.backing = [];
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.SET_SCANOUT: {
        if (cmd.byteLength < HDR_SIZE + 24) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const width = dv.getUint32(HDR_SIZE + 8, true);
        const height = dv.getUint32(HDR_SIZE + 12, true);
        const scanoutId = dv.getUint32(HDR_SIZE + 16, true);
        const resourceId = dv.getUint32(HDR_SIZE + 20, true);
        if (resourceId === 0) {
          this.scanouts.delete(scanoutId);
          return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
        }
        this.scanouts.set(scanoutId, { resourceId, width, height });
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_FLUSH: {
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.RESOURCE_UNREF: {
        const resourceId = dv.getUint32(HDR_SIZE, true);
        this.blobs.delete(resourceId);
        for (const [sid, s] of this.scanouts.entries()) {
          if (s.resourceId === resourceId) this.scanouts.delete(sid);
        }
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.CTX_ATTACH_RESOURCE:
      case UNKERNEL_GPU_CMD.CTX_DETACH_RESOURCE: {
        return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
      }

      case UNKERNEL_GPU_CMD.SUBMIT_3D: {
        if (cmd.byteLength < HDR_SIZE + 4) {
          return respHeader(UNKERNEL_GPU_RESP.ERR_INVALID_PARAMETER);
        }
        const size = dv.getUint32(HDR_SIZE, true);
        const stream = cmd.slice(HDR_SIZE + 4, HDR_SIZE + 4 + size);
        this.inFlight++;
        const run = this.tail.then(async () => {
          try {
            const reply = await this.decoder.execute(stream);
            if (reply.byteLength > 0) {
              const replyStream = this.backend.getReplyStream();
              if (replyStream) {
                const blob = this.blobs.get(Number(replyStream.resourceId));
                const backing = blob?.backing.length
                  ? blob.backing
                  : _ctx.backing(Number(replyStream.resourceId));
                if (backing && backing.length > 0) {
                  writeReplyToGuestMemory(_ctx.memory(), backing, replyStream.offset, reply);
                }
              }
            }
            return respHeader(UNKERNEL_GPU_RESP.OK_NODATA);
          } catch (err) {
            console.error("[UnkernelVenusBackend] SUBMIT_3D failed:", err);
            return respHeader(UNKERNEL_GPU_RESP.ERR_UNSPEC);
          } finally {
            this.inFlight--;
          }
        });
        this.tail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }

      default:
        return respHeader(UNKERNEL_GPU_RESP.ERR_UNSPEC);
    }
  }
}
