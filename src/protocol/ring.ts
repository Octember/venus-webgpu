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
  private readonly bytes: Uint8Array;
  private readonly cfg: VenusRingConfig;

  constructor(shmem: Uint8Array, cfg: VenusRingConfig) {
    if (cfg.bufferSize <= 0 || (cfg.bufferSize & (cfg.bufferSize - 1)) !== 0) {
      throw new Error(`VenusRing bufferSize must be a power of 2, got ${cfg.bufferSize}`);
    }
    this.bytes = shmem;
    this.view = new DataView(shmem.buffer, shmem.byteOffset, shmem.byteLength);
    this.cfg = cfg;
  }

  get head(): number {
    return this.view.getUint32(this.cfg.headOffset, true);
  }

  set head(val: number) {
    this.view.setUint32(this.cfg.headOffset, val >>> 0, true);
  }

  get tail(): number {
    return this.view.getUint32(this.cfg.tailOffset, true);
  }

  set tail(val: number) {
    this.view.setUint32(this.cfg.tailOffset, val >>> 0, true);
  }

  get status(): number {
    return this.view.getUint32(this.cfg.statusOffset, true);
  }

  set status(val: number) {
    this.view.setUint32(this.cfg.statusOffset, val >>> 0, true);
  }

  /** Number of unread bytes available in the ring. */
  get available(): number {
    return (this.tail - this.head) >>> 0;
  }

  /** Number of free bytes available for writing. */
  get freeSpace(): number {
    return this.cfg.bufferSize - this.available;
  }

  /** Guest-side helper: write a command stream chunk into the ring and advance tail. */
  write(data: Uint8Array): void {
    if (data.byteLength > this.freeSpace) {
      throw new Error(`VenusRing overflow: need ${data.byteLength}, free ${this.freeSpace}`);
    }
    const mask = this.cfg.bufferSize - 1;
    let t = this.tail;
    const start = t & mask;
    const first = Math.min(data.byteLength, this.cfg.bufferSize - start);
    this.bytes.set(data.subarray(0, first), this.cfg.bufferOffset + start);
    if (first < data.byteLength) {
      this.bytes.set(data.subarray(first), this.cfg.bufferOffset);
    }
    t = (t + data.byteLength) >>> 0;
    this.tail = t;
  }

  /** Host-side: read all currently available bytes from head..tail and advance head. */
  consumeAvailable(): Uint8Array {
    const len = this.available;
    if (len === 0) return new Uint8Array(0);
    const out = new Uint8Array(len);
    const mask = this.cfg.bufferSize - 1;
    const start = this.head & mask;
    const first = Math.min(len, this.cfg.bufferSize - start);
    out.set(this.bytes.subarray(this.cfg.bufferOffset + start, this.cfg.bufferOffset + start + first), 0);
    if (first < len) {
      out.set(this.bytes.subarray(this.cfg.bufferOffset, this.cfg.bufferOffset + (len - first)), first);
    }
    this.head = (this.head + len) >>> 0;
    return out;
  }
}
