/**
 * Venus circular shared-memory ring buffer.
 * Matches VkRingCreateInfoMESA layout in VK_MESA_venus_protocol.xml.
 */

export interface VenusRingConfig {
  headOffset: number;
  tailOffset: number;
  statusOffset: number;
  bufferOffset: number;
  bufferSize: number;
  extraOffset?: number;
  extraSize?: number;
}

export class VenusRing {
  private readonly view: DataView;
  private readonly atomicView: Int32Array | null;
  private readonly bytes: Uint8Array;
  private readonly cfg: VenusRingConfig;

  constructor(shmem: Uint8Array, cfg: VenusRingConfig) {
    if (cfg.bufferSize <= 0 || (cfg.bufferSize & (cfg.bufferSize - 1)) !== 0) {
      throw new Error(`VenusRing bufferSize must be a power of 2, got ${cfg.bufferSize}`);
    }
    this.bytes = shmem;
    this.view = new DataView(shmem.buffer, shmem.byteOffset, shmem.byteLength);
    this.atomicView =
      typeof SharedArrayBuffer !== "undefined" &&
      shmem.buffer instanceof SharedArrayBuffer &&
      (shmem.byteOffset & 3) === 0
        ? new Int32Array(shmem.buffer, shmem.byteOffset, shmem.byteLength >> 2)
        : null;
    this.cfg = cfg;
  }

  private loadU32(byteOffset: number): number {
    if (this.atomicView && (byteOffset & 3) === 0) {
      return Atomics.load(this.atomicView, byteOffset >> 2) >>> 0;
    }
    return this.view.getUint32(byteOffset, true);
  }

  private storeU32(byteOffset: number, val: number): void {
    if (this.atomicView && (byteOffset & 3) === 0) {
      Atomics.store(this.atomicView, byteOffset >> 2, val | 0);
      return;
    }
    this.view.setUint32(byteOffset, val >>> 0, true);
  }

  get head(): number {
    return this.loadU32(this.cfg.headOffset);
  }

  set head(val: number) {
    this.storeU32(this.cfg.headOffset, val);
  }

  get tail(): number {
    return this.loadU32(this.cfg.tailOffset);
  }

  set tail(val: number) {
    this.storeU32(this.cfg.tailOffset, val);
  }

  get status(): number {
    return this.loadU32(this.cfg.statusOffset);
  }

  set status(val: number) {
    this.storeU32(this.cfg.statusOffset, val);
  }

  /** Number of unread bytes available in the ring. */
  get available(): number {
    const avail = (this.tail - this.head) >>> 0;
    if (avail > this.cfg.bufferSize) {
      throw new Error(`VenusRing corrupted: available ${avail} > bufferSize ${this.cfg.bufferSize}`);
    }
    return avail;
  }

  /** Number of free bytes available for writing. */
  get freeSpace(): number {
    return this.cfg.bufferSize - this.available;
  }

  /** Guest-side helper: write a command stream chunk into the ring and advance tail. */
  write(data: Uint8Array): void {
    const head = this.head;
    const tail = this.tail;
    const avail = (tail - head) >>> 0;
    if (avail > this.cfg.bufferSize) {
      throw new Error(`VenusRing corrupted: available ${avail} > bufferSize ${this.cfg.bufferSize}`);
    }
    const free = this.cfg.bufferSize - avail;
    if (data.byteLength > free) {
      throw new Error(`VenusRing overflow: need ${data.byteLength}, free ${free}`);
    }
    const mask = this.cfg.bufferSize - 1;
    const start = tail & mask;
    const first = Math.min(data.byteLength, this.cfg.bufferSize - start);
    this.bytes.set(data.subarray(0, first), this.cfg.bufferOffset + start);
    if (first < data.byteLength) {
      this.bytes.set(data.subarray(first), this.cfg.bufferOffset);
    }
    this.tail = (tail + data.byteLength) >>> 0;
  }

  /** Host-side: peek all currently available bytes from head..tail without advancing head. */
  peekAvailable(): Uint8Array {
    const head = this.head;
    const tail = this.tail;
    const len = (tail - head) >>> 0;
    if (len > this.cfg.bufferSize) {
      throw new Error(`VenusRing corrupted: available ${len} > bufferSize ${this.cfg.bufferSize}`);
    }
    if (len === 0) return new Uint8Array(0);
    const out = new Uint8Array(len);
    const mask = this.cfg.bufferSize - 1;
    const start = head & mask;
    const first = Math.min(len, this.cfg.bufferSize - start);
    out.set(this.bytes.subarray(this.cfg.bufferOffset + start, this.cfg.bufferOffset + start + first), 0);
    if (first < len) {
      out.set(this.bytes.subarray(this.cfg.bufferOffset, this.cfg.bufferOffset + (len - first)), first);
    }
    return out;
  }

  /** Host-side: advance head after execution completes. */
  advanceHead(bytes: number): void {
    this.head = (this.head + bytes) >>> 0;
  }

  /** Host-side: read all currently available bytes from head..tail and advance head. */
  consumeAvailable(): Uint8Array {
    const out = this.peekAvailable();
    if (out.byteLength > 0) {
      this.advanceHead(out.byteLength);
    }
    return out;
  }
}
