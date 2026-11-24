import { describe, expect, test } from "bun:test";
import { createMockGPUDevice } from "../src/backend/mock-gpu.ts";
import { VENUS_CAPSET_SIZE, VIRTIO_GPU_CAPSET_VENUS } from "../src/protocol/constants.ts";
import { VenusCommandEncoder } from "../src/protocol/encoder.ts";
import {
  UNKERNEL_GPU_CMD,
  UNKERNEL_GPU_RESP,
  UnkernelVenusBackend,
  VIRTIO_GPU_F_CONTEXT_INIT,
  VIRTIO_GPU_F_RESOURCE_BLOB,
  VIRTIO_GPU_F_VIRGL,
} from "../src/transport/unkernel.ts";

function makeCmd(type: number, ctxId = 0, payloadBytes = 0): Uint8Array {
  const buf = new Uint8Array(24 + payloadBytes);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, type, true);
  dv.setUint32(16, ctxId, true);
  return buf;
}

describe("UnkernelVenusBackend", () => {
  test("exposes Venus features, capset, context lifecycle, and SUBMIT_3D", async () => {
    const device = createMockGPUDevice();
    const backend = new UnkernelVenusBackend(device);
    const wasmMem = new WebAssembly.Memory({ initial: 1 });
    const ctx = {
      memory: () => wasmMem,
      backing: () => null,
    };

    expect(backend.features).toBe(
      VIRTIO_GPU_F_VIRGL | VIRTIO_GPU_F_RESOURCE_BLOB | VIRTIO_GPU_F_CONTEXT_INIT,
    );
    expect(backend.capsetCount).toBe(1);

    // GET_CAPSET_INFO
    const infoCmd = makeCmd(UNKERNEL_GPU_CMD.GET_CAPSET_INFO, 0, 8);
    const infoResp = (await backend.command(infoCmd, ctx))!;
    const idv = new DataView(infoResp.buffer);
    expect(idv.getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_CAPSET_INFO);
    expect(idv.getUint32(24, true)).toBe(VIRTIO_GPU_CAPSET_VENUS);
    expect(idv.getUint32(32, true)).toBe(VENUS_CAPSET_SIZE);

    // GET_CAPSET
    const capCmd = makeCmd(UNKERNEL_GPU_CMD.GET_CAPSET, 0, 8);
    new DataView(capCmd.buffer).setUint32(24, VIRTIO_GPU_CAPSET_VENUS, true);
    const capResp = (await backend.command(capCmd, ctx))!;
    expect(new DataView(capResp.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_CAPSET);
    expect(capResp.byteLength).toBe(24 + VENUS_CAPSET_SIZE);

    // CTX_CREATE + SUBMIT_3D (with payload >= 4 bytes)
    const ctxResp = (await backend.command(makeCmd(UNKERNEL_GPU_CMD.CTX_CREATE, 1, 4), ctx))!;
    expect(new DataView(ctxResp.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_NODATA);

    const enc = new VenusCommandEncoder();
    enc.vkCreateInstance(1n);
    const stream = enc.finish();

    const submitCmd = makeCmd(UNKERNEL_GPU_CMD.SUBMIT_3D, 1, 4 + stream.byteLength);
    new DataView(submitCmd.buffer).setUint32(24, stream.byteLength, true);
    submitCmd.set(stream, 28);

    const submitResp = (await backend.command(submitCmd, ctx))!;
    expect(new DataView(submitResp.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_NODATA);
  });

  test("handles RESOURCE_CREATE_BLOB layout, ATTACH/DETACH_BACKING, SET_SCANOUT, and blocker()", async () => {
    const device = createMockGPUDevice();
    const backend = new UnkernelVenusBackend(device);
    const wasmMem = new WebAssembly.Memory({ initial: 1 });
    const ctx = { memory: () => wasmMem, backing: () => null };

    // RESOURCE_CREATE_BLOB with 1 inline entry (56 + 16 = 72 bytes)
    const blobCmd = makeCmd(UNKERNEL_GPU_CMD.RESOURCE_CREATE_BLOB, 1, 32 + 16);
    const bdv = new DataView(blobCmd.buffer);
    bdv.setUint32(24, 42, true); // resource_id
    bdv.setUint32(28, 1, true); // blob_mem
    bdv.setUint32(32, 3, true); // blob_flags
    bdv.setUint32(36, 1, true); // nr_entries
    bdv.setBigUint64(40, 99n, true); // blob_id
    bdv.setBigUint64(48, 4096n, true); // size
    bdv.setBigUint64(56, 1024n, true); // entry[0].addr
    bdv.setUint32(64, 4096, true); // entry[0].length

    const blobResp = (await backend.command(blobCmd, ctx))!;
    expect(new DataView(blobResp.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_NODATA);
    expect(backend.blocker()).toBe("virtio-gpu resources");

    // RESOURCE_DETACH_BACKING + RESOURCE_ATTACH_BACKING
    const detachCmd = makeCmd(UNKERNEL_GPU_CMD.RESOURCE_DETACH_BACKING, 1, 8);
    new DataView(detachCmd.buffer).setUint32(24, 42, true);
    expect(new DataView((await backend.command(detachCmd, ctx))!.buffer).getUint32(0, true)).toBe(
      UNKERNEL_GPU_RESP.OK_NODATA,
    );

    const attachCmd = makeCmd(UNKERNEL_GPU_CMD.RESOURCE_ATTACH_BACKING, 1, 8 + 16);
    const adv = new DataView(attachCmd.buffer);
    adv.setUint32(24, 42, true);
    adv.setUint32(28, 1, true);
    adv.setBigUint64(32, 2048n, true);
    adv.setUint32(40, 4096, true);
    expect(new DataView((await backend.command(attachCmd, ctx))!.buffer).getUint32(0, true)).toBe(
      UNKERNEL_GPU_RESP.OK_NODATA,
    );

    // SET_SCANOUT(42) -> resource(42) returns { width, height }, then SET_SCANOUT(0) clears it
    const scanoutCmd = makeCmd(UNKERNEL_GPU_CMD.SET_SCANOUT, 0, 24);
    const sdv = new DataView(scanoutCmd.buffer);
    sdv.setUint32(32, 800, true); // width
    sdv.setUint32(36, 600, true); // height
    sdv.setUint32(40, 0, true); // scanout_id
    sdv.setUint32(44, 42, true); // resource_id
    expect(new DataView((await backend.command(scanoutCmd, ctx))!.buffer).getUint32(0, true)).toBe(
      UNKERNEL_GPU_RESP.OK_NODATA,
    );
    expect(backend.resource(42)).toEqual({ width: 800, height: 600 });

    sdv.setUint32(44, 0, true);
    expect(new DataView((await backend.command(scanoutCmd, ctx))!.buffer).getUint32(0, true)).toBe(
      UNKERNEL_GPU_RESP.OK_NODATA,
    );
    expect(backend.resource(42)).toBeNull();
  });

  test("writes SUBMIT_3D reply bytes into guest memory and serializes concurrent SUBMIT_3D", async () => {
    const device = createMockGPUDevice();
    const backend = new UnkernelVenusBackend(device);
    const wasmMem = new WebAssembly.Memory({ initial: 1 });
    const ctx = { memory: () => wasmMem, backing: () => null };

    // Create blob resource 7 at guest addr 512, len 1024
    const blobCmd = makeCmd(UNKERNEL_GPU_CMD.RESOURCE_CREATE_BLOB, 1, 32 + 16);
    const bdv = new DataView(blobCmd.buffer);
    bdv.setUint32(24, 7, true);
    bdv.setUint32(36, 1, true);
    bdv.setBigUint64(48, 1024n, true);
    bdv.setBigUint64(56, 512n, true);
    bdv.setUint32(64, 1024, true);
    await backend.command(blobCmd, ctx);

    const enc1 = new VenusCommandEncoder();
    enc1.vkSetReplyCommandStreamMESA(7, 0n, 1024n);
    enc1.vkCreateInstance(1n);
    const s1 = enc1.finish();

    const enc2 = new VenusCommandEncoder();
    enc2.vkEnumeratePhysicalDevices(1n, 1);
    const s2 = enc2.finish();

    const sub1 = makeCmd(UNKERNEL_GPU_CMD.SUBMIT_3D, 1, 4 + s1.byteLength);
    new DataView(sub1.buffer).setUint32(24, s1.byteLength, true);
    sub1.set(s1, 28);

    const sub2 = makeCmd(UNKERNEL_GPU_CMD.SUBMIT_3D, 1, 4 + s2.byteLength);
    new DataView(sub2.buffer).setUint32(24, s2.byteLength, true);
    sub2.set(s2, 28);

    const [r1, r2] = await Promise.all([backend.command(sub1, ctx), backend.command(sub2, ctx)]);
    expect(new DataView(r1!.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_NODATA);
    expect(new DataView(r2!.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_NODATA);

    // Reply bytes from vkEnumeratePhysicalDevices should be written at guest addr 512
    const guestReply = new Uint8Array(wasmMem.buffer, 512, 16);
    expect(guestReply.some((b) => b !== 0)).toBe(true);
  });
});
