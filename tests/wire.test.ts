import { describe, expect, test } from "bun:test";
import { VenusRing } from "../src/protocol/ring.ts";
import { VenusCsDecoder, VenusCsEncoder } from "../src/protocol/wire.ts";

describe("VenusCsEncoder / VenusCsDecoder", () => {
  test("round-trips primitives, handles, strings, and 4-byte aligned bytes", () => {
    const enc = new VenusCsEncoder();
    enc.writeU32(0xdeadbeef);
    enc.writeI32(-42);
    enc.writeU64(0x123456789abcdef0n);
    enc.writeHandle(0xfeedfacecafebaben);
    enc.writeBool32(true);
    enc.writeSimplePointer(false);
    enc.writeString("main");
    enc.writeBytes(new Uint8Array([1, 2, 3])); // 3 bytes -> padded to 4
    enc.writeU32(99);

    const bytes = enc.finish();
    const dec = new VenusCsDecoder(bytes);

    expect(dec.readU32()).toBe(0xdeadbeef);
    expect(dec.readI32()).toBe(-42);
    expect(dec.readU64()).toBe(0x123456789abcdef0n);
    expect(dec.readHandle()).toBe(0xfeedfacecafebaben);
    expect(dec.readBool32()).toBe(true);
    expect(dec.readSimplePointer()).toBe(false);
    expect(dec.readString()).toBe("main");
    expect(Array.from(dec.readBytes(3))).toEqual([1, 2, 3]);
    expect(dec.readU32()).toBe(99);
    expect(dec.remaining).toBe(0);
  });
});

describe("VenusRing", () => {
  test("handles wrap-around writes and reads cleanly", () => {
    const shmem = new Uint8Array(64);
    const ring = new VenusRing(shmem, {
      headOffset: 0,
      tailOffset: 4,
      statusOffset: 8,
      bufferOffset: 16,
      bufferSize: 32,
    });

    const chunk1 = new Uint8Array(20).fill(0xaa);
    ring.write(chunk1);
    expect(ring.available).toBe(20);
    expect(Array.from(ring.consumeAvailable())).toEqual(Array.from(chunk1));
    expect(ring.available).toBe(0);

    // Next write wraps around the 32-byte ring buffer
    const chunk2 = new Uint8Array(24);
    for (let i = 0; i < 24; i++) chunk2[i] = i;
    ring.write(chunk2);
    expect(ring.available).toBe(24);
    expect(Array.from(ring.consumeAvailable())).toEqual(Array.from(chunk2));
    expect(ring.available).toBe(0);
  });
});
