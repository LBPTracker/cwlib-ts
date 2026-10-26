/**
 * The order a `java.util.HashSet` hands its elements back in, which cwlib's
 * `RMesh` lets into its output: the edge list `generateEdges` writes after the
 * strips is a `HashSet<Edge>` iterated, the smooth normals sum the triangles of
 * a `HashSet<Triangle>` in its order (float addition does not commute), and
 * `generateSprings` keeps its springs in the order a `HashSet` gives them.
 *
 * The emulation is OpenJDK's `HashMap` (`putVal`, `resize`, `treeifyBin`): a
 * table of power-of-two buckets indexed by `hash ^ (hash >>> 16)`, each bucket
 * in insertion order, doubled when the size passes three quarters of it, a
 * doubling that keeps each bucket's order; and a bucket of eight that takes a
 * ninth resizes the table instead while it is below 64.
 *
 * ⚠️ **Past that, Java's own order is not reproducible**: a bucket of nine in a
 * table of 64 or more becomes a red-black tree, ordered among equal hashes by
 * `System.identityHashCode`. `treeified` says when that happened; the order
 * returned is then the list order, which Java's may not be.
 */

const MAXIMUM_CAPACITY = 1 << 30;

/** `HashMap.tableSizeFor`: the power of two at or above `c`. */
function tableSizeFor(c: number): number {
  const n = c <= 1 ? 0 : -1 >>> Math.clz32(c - 1);
  return n < 0 ? 1 : n >= MAXIMUM_CAPACITY ? MAXIMUM_CAPACITY : n + 1;
}

export class JavaHashSet<T> {
  private buckets: { key: string; hash: number; value: T }[][] | undefined;
  private capacity = 0;
  private threshold: number;
  private count = 0;
  private readonly keys = new Set<string>();
  /** A bucket became a tree: Java's order from then on depends on identity hashes. */
  treeified = false;

  /** `new HashSet<>()` with no argument, or `new HashSet<>(initialCapacity)`. */
  constructor(initialCapacity?: number) {
    this.threshold = initialCapacity === undefined ? 0 : tableSizeFor(initialCapacity);
  }

  /** `new HashSet<>(collection)`: sized for it, then every element added. */
  static of<T>(items: readonly { key: string; hash: number; value: T }[]): JavaHashSet<T> {
    const set = new JavaHashSet<T>(Math.max(Math.trunc(Math.fround(items.length / Math.fround(0.75))) + 1, 16));
    for (const item of items) set.add(item.key, item.hash, item.value);
    return set;
  }

  get size(): number {
    return this.count;
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  private resize(): void {
    const oldCap = this.capacity;
    const oldThr = this.threshold;
    let newCap: number;
    let newThr = 0;
    if (oldCap > 0) {
      newCap = oldCap * 2;
      if (newCap < MAXIMUM_CAPACITY && oldCap >= 16) newThr = oldThr * 2;
    } else if (oldThr > 0) {
      newCap = oldThr;
    } else {
      newCap = 16;
      newThr = 12;
    }
    if (newThr === 0) newThr = Math.trunc(Math.fround(newCap * Math.fround(0.75)));
    const next: { key: string; hash: number; value: T }[][] = Array.from({ length: newCap }, () => []);
    for (const bucket of this.buckets ?? []) for (const node of bucket) next[node.hash & (newCap - 1)].push(node);
    this.buckets = next;
    this.capacity = newCap;
    this.threshold = newThr;
  }

  /** `add`: false when an equal element (the same `key`) is already in. */
  add(key: string, hash: number, value: T): boolean {
    if (this.keys.has(key)) return false;
    const h = (hash ^ (hash >>> 16)) | 0;
    if (this.buckets === undefined) this.resize();
    const bucket = this.buckets![h & (this.capacity - 1)];
    const before = bucket.length;
    bucket.push({ key, hash: h, value });
    this.keys.add(key);
    if (before >= 8) {
      if (this.capacity < 64) this.resize();
      else this.treeified = true;
    }
    this.count += 1;
    if (this.count > this.threshold) this.resize();
    return true;
  }

  /** The elements in iteration order. */
  values(): T[] {
    const out: T[] = [];
    for (const bucket of this.buckets ?? []) for (const node of bucket) out.push(node.value);
    return out;
  }
}
