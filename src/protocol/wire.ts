/**
 * 4-byte aligned little-endian binary reader/writer matching venus-protocol's
 * vn_cs_decoder / vn_cs_encoder.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function align4(n: number): number {
  return (n + 3) & ~3;
}

export class VenusCsDecoder {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array, offset = 0) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.bytes.byteLength) {
      throw new RangeError(
        `VenusCsDecoder out of bounds: need ${n} bytes at ${this.offset}, have ${this.bytes.byteLength}`,
      );
    }
  }

  readU32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readI32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readF32(): number {
    this.ensure(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    this.ensure(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readHandle(): bigint {
    return this.readU64();
  }

  readBool32(): boolean {
    return this.readU32() !== 0;
  }

  /** Venus encodes nullable pointer presence as a 4-byte uint32 flag. */
  readSimplePointer(): boolean {
    return this.readU32() !== 0;
  }

  /** Venus encodes array lengths as 8-byte uint64. */
  readArraySize(): number {
    return Number(this.readU64());
  }

  readBytes(byteLength: number): Uint8Array {
    const padded = align4(byteLength);
    this.ensure(padded);
    const out = this.bytes.slice(this.offset, this.offset + byteLength);
    this.offset += padded;
    return out;
  }

  readU32Array(count: number): Uint32Array {
    const byteLength = count * 4;
    this.ensure(byteLength);
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.view.getUint32(this.offset + i * 4, true);
    }
    this.offset += byteLength;
    return out;
  }

  readString(): string {
    const len = this.readArraySize();
    if (len === 0) return "";
    const raw = this.readBytes(len);
    const nul = raw.indexOf(0);
    return textDecoder.decode(nul >= 0 ? raw.subarray(0, nul) : raw);
  }

  skip(byteLength: number): void {
    const padded = align4(byteLength);
    this.ensure(padded);
    this.offset += padded;
  }
}

export class VenusCsEncoder {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  get position(): number {
    return this.offset;
  }

  reset(): void {
    this.offset = 0;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.buf.byteLength) {
      throw new RangeError(`VenusCsEncoder seek out of bounds: ${pos}`);
    }
    this.offset = pos;
  }

  private ensure(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.buf.byteLength) return;
    let nextCap = this.buf.byteLength * 2;
    while (nextCap < needed) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.offset));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeU32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  writeI32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, v | 0, true);
    this.offset += 4;
  }

  writeF32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  writeU64(v: bigint | number): void {
    this.ensure(8);
    this.view.setBigUint64(this.offset, BigInt(v), true);
    this.offset += 8;
  }

  writeHandle(v: bigint | number): void {
    this.writeU64(v);
  }

  writeBool32(v: boolean): void {
    this.writeU32(v ? 1 : 0);
  }

  writeSimplePointer(present: boolean): void {
    this.writeU32(present ? 1 : 0);
  }

  writeArraySize(count: number): void {
    this.writeU64(BigInt(count));
  }

  writeBytes(data: Uint8Array): void {
    const padded = align4(data.byteLength);
    this.ensure(padded);
    this.buf.set(data, this.offset);
    if (padded > data.byteLength) {
      this.buf.fill(0, this.offset + data.byteLength, this.offset + padded);
    }
    this.offset += padded;
  }

  writeU32Array(words: Uint32Array | readonly number[]): void {
    const byteLength = words.length * 4;
    this.ensure(byteLength);
    for (let i = 0; i < words.length; i++) {
      this.view.setUint32(this.offset + i * 4, words[i] >>> 0, true);
    }
    this.offset += byteLength;
  }

  writeString(str: string): void {
    const encoded = textEncoder.encode(str);
    const withNul = new Uint8Array(encoded.byteLength + 1);
    withNul.set(encoded);
    withNul[encoded.byteLength] = 0;
    this.writeArraySize(withNul.byteLength);
    this.writeBytes(withNul);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }
}
