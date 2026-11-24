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
    const capResp = (await backend.command(capCmd, ctx))!;
    expect(new DataView(capResp.buffer).getUint32(0, true)).toBe(UNKERNEL_GPU_RESP.OK_CAPSET);
    expect(capResp.byteLength).toBe(24 + VENUS_CAPSET_SIZE);

    // CTX_CREATE + SUBMIT_3D
    const ctxResp = (await backend.command(makeCmd(UNKERNEL_GPU_CMD.CTX_CREATE, 1), ctx))!;
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
});
