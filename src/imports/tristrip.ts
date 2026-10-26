/**
 * NVIDIA's NvTriStrip, as Java cwlib carries it (`external/nvtristrip/`,
 * ennuo/toolkit `d6a2ef8`: jMonkeyEngine's Java port by Artur Biesiadowski,
 * BSD-licensed, of NVIDIA's stripifier) -- the triangle-list-to-strip pass
 * `RMesh.strip()` runs on an imported mesh, ported line for line so a strip
 * comes out index for index as Java's does.
 *
 * Only what `RMesh.strip()` calls is here: `new TriStrip().generateStrips(t)`
 * at the defaults -- a cache of 16, strips stitched into one with degenerate
 * triangles, no minimum strip length, strips rather than lists.
 *
 * The single-precision steps (`meshJump`, the averages and costs that pick
 * among experiments) are rounded as Java's floats are; nothing else is
 * arithmetic. Java's `HashSet<FaceInfo>` here is only asked `contains`, so its
 * order does not matter.
 */

const f = Math.fround;

class FaceInfo {
  v0: number;
  v1: number;
  v2: number;
  stripId = -1;
  testStripId = -1;
  experimentId = -1;
  constructor(v0: number, v1: number, v2: number) {
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
  }
  set(o: FaceInfo): void {
    this.v0 = o.v0;
    this.v1 = o.v1;
    this.v2 = o.v2;
    this.stripId = o.stripId;
    this.testStripId = o.testStripId;
    this.experimentId = o.experimentId;
  }
}

class EdgeInfo {
  face0: FaceInfo | null = null;
  face1: FaceInfo | null = null;
  v0: number;
  v1: number;
  nextV0: EdgeInfo | null = null;
  nextV1: EdgeInfo | null = null;
  constructor(v0: number, v1: number) {
    this.v0 = v0;
    this.v1 = v1;
  }
}

class StripStartInfo {
  startFace: FaceInfo | null;
  startEdge: EdgeInfo | null;
  toV1: boolean;
  constructor(startFace: FaceInfo | null, startEdge: EdgeInfo | null, toV1: boolean) {
    this.startFace = startFace;
    this.startEdge = startEdge;
    this.toV1 = toV1;
  }
}

/** A Java `IndexOutOfBoundsException` where the port would read past an array. */
function at<T>(list: readonly T[], i: number): T {
  if (i < 0 || i >= list.length) throw new RangeError(`index ${i} out of bounds for length ${list.length}`);
  return list[i];
}

/** A Java `NullPointerException` where the port would dereference null. */
function nn<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError('null dereference (NvTriStrip)');
  return value;
}

function findEdgeInfo(edgeInfos: (EdgeInfo | null)[], v0: number, v1: number): EdgeInfo | null {
  let iter = at(edgeInfos, v0);
  while (iter !== null) {
    if (iter.v0 === v0) {
      if (iter.v1 === v1) return iter;
      iter = iter.nextV0;
    } else {
      if (iter.v0 === v1) return iter;
      iter = iter.nextV1;
    }
  }
  return null;
}

function findOtherFace(edgeInfos: (EdgeInfo | null)[], v0: number, v1: number, face: FaceInfo): FaceInfo | null {
  const edge = findEdgeInfo(edgeInfos, v0, v1);
  if (edge === null && v0 === v1) return null; // a degenerate
  const e = nn(edge);
  return e.face0 === face ? e.face1 : e.face0;
}

const isDegenerateFace = (face: FaceInfo): boolean => face.v0 === face.v1 || face.v0 === face.v2 || face.v1 === face.v2;

/** `getNextIndex`: the face's vertex that is not one of the list's last two. */
function getNextIndex(indices: number[], face: FaceInfo): number {
  const n = indices.length;
  const v0 = at(indices, n - 2);
  const v1 = at(indices, n - 1);
  const { v0: fv0, v1: fv1, v2: fv2 } = face;
  if (fv0 !== v0 && fv0 !== v1) return fv0;
  if (fv1 !== v0 && fv1 !== v1) return fv1;
  if (fv2 !== v0 && fv2 !== v1) return fv2;
  if (fv0 === fv1 || fv0 === fv2) return fv0;
  if (fv1 === fv0 || fv1 === fv2) return fv1;
  if (fv2 === fv0 || fv2 === fv1) return fv2;
  return -1;
}

function getUniqueVertexInB(a: FaceInfo, b: FaceInfo): number {
  if (b.v0 !== a.v0 && b.v0 !== a.v1 && b.v0 !== a.v2) return b.v0;
  if (b.v1 !== a.v0 && b.v1 !== a.v1 && b.v1 !== a.v2) return b.v1;
  if (b.v2 !== a.v0 && b.v2 !== a.v1 && b.v2 !== a.v2) return b.v2;
  return -1;
}

function getSharedVertices(a: FaceInfo, b: FaceInfo): [number, number] {
  const out: [number, number] = [-1, -1];
  for (const v of [b.v0, b.v1, b.v2]) {
    if (v === a.v0 || v === a.v1 || v === a.v2) {
      if (out[0] === -1) out[0] = v;
      else {
        out[1] = v;
        return out;
      }
    }
  }
  return out;
}

const isCW = (face: FaceInfo, v0: number, v1: number): boolean =>
  face.v0 === v0 ? face.v1 === v1 : face.v1 === v0 ? face.v2 === v1 : face.v0 === v1;

const nextIsCW = (numIndices: number): boolean => numIndices % 2 === 0;

class VertexCache {
  readonly entries: number[];
  constructor(size: number) {
    this.entries = new Array<number>(size).fill(-1);
  }
  inCache(entry: number): boolean {
    return this.entries.includes(entry);
  }
  addEntry(entry: number): void {
    for (let i = this.entries.length - 2; i >= 0; i -= 1) this.entries[i + 1] = this.entries[i];
    this.entries[0] = entry;
  }
}

class StripInfo {
  startInfo: StripStartInfo;
  faces: FaceInfo[] = [];
  stripId: number;
  experimentId: number;
  visited = false;
  numDegenerates = 0;
  constructor(startInfo: StripStartInfo, stripId: number, experimentId: number) {
    this.startInfo = startInfo;
    this.stripId = stripId;
    this.experimentId = experimentId;
  }
  isExperiment(): boolean {
    return this.experimentId >= 0;
  }
  isInStrip(face: FaceInfo | null): boolean {
    if (face === null) return false;
    return this.experimentId >= 0 ? face.testStripId === this.stripId : face.stripId === this.stripId;
  }
  isMarked(face: FaceInfo): boolean {
    return face.stripId >= 0 || (this.isExperiment() && face.experimentId === this.experimentId);
  }
  markTriangle(face: FaceInfo): void {
    if (this.isExperiment()) {
      face.experimentId = this.experimentId;
      face.testStripId = this.stripId;
    } else {
      face.experimentId = -1;
      face.stripId = this.stripId;
    }
  }
  unique(faces: FaceInfo[], face: FaceInfo): boolean {
    let b0 = false;
    let b1 = false;
    let b2 = false;
    for (const o of faces) {
      if (!b0 && (o.v0 === face.v0 || o.v1 === face.v0 || o.v2 === face.v0)) b0 = true;
      if (!b1 && (o.v0 === face.v1 || o.v1 === face.v1 || o.v2 === face.v1)) b1 = true;
      if (!b2 && (o.v0 === face.v2 || o.v1 === face.v2 || o.v2 === face.v2)) b2 = true;
      if (b0 && b1 && b2) return false;
    }
    return true;
  }
  build(edgeInfos: (EdgeInfo | null)[]): void {
    const scratch: number[] = [];
    const forward: FaceInfo[] = [];
    const backward: FaceInfo[] = [];
    const start = nn(this.startInfo.startFace);
    const edge = nn(this.startInfo.startEdge);
    forward.push(start);
    this.markTriangle(start);
    const v0 = this.startInfo.toV1 ? edge.v0 : edge.v1;
    const v1 = this.startInfo.toV1 ? edge.v1 : edge.v0;
    scratch.push(v0, v1);
    const v2 = getNextIndex(scratch, start);
    scratch.push(v2);

    let nv0 = v1;
    let nv1 = v2;
    let next = findOtherFace(edgeInfos, nv0, nv1, start);
    while (next !== null && !this.isMarked(next)) {
      let testnv0 = nv1;
      const testnv1 = getNextIndex(scratch, next);
      const nextNext = findOtherFace(edgeInfos, testnv0, testnv1, next);
      if (nextNext === null || this.isMarked(nextNext)) {
        const testNext = findOtherFace(edgeInfos, nv0, testnv1, next);
        if (testNext !== null && !this.isMarked(testNext)) {
          const temp = new FaceInfo(nv0, nv1, nv0);
          forward.push(temp);
          this.markTriangle(temp);
          scratch.push(nv0);
          testnv0 = nv0;
          this.numDegenerates += 1;
        }
      }
      forward.push(next);
      this.markTriangle(next);
      scratch.push(testnv1);
      nv0 = testnv0;
      nv1 = testnv1;
      next = findOtherFace(edgeInfos, nv0, nv1, next);
    }

    const all = forward.slice();
    scratch.length = 0;
    scratch.push(v2, v1, v0);
    nv0 = v1;
    nv1 = v0;
    next = findOtherFace(edgeInfos, nv0, nv1, start);
    while (next !== null && !this.isMarked(next)) {
      if (!this.unique(all, next)) break;
      let testnv0 = nv1;
      const testnv1 = getNextIndex(scratch, next);
      const nextNext = findOtherFace(edgeInfos, testnv0, testnv1, next);
      if (nextNext === null || this.isMarked(nextNext)) {
        const testNext = findOtherFace(edgeInfos, nv0, testnv1, next);
        if (testNext !== null && !this.isMarked(testNext)) {
          const temp = new FaceInfo(nv0, nv1, nv0);
          backward.push(temp);
          this.markTriangle(temp);
          scratch.push(nv0);
          testnv0 = nv0;
          this.numDegenerates += 1;
        }
      }
      backward.push(next);
      all.push(next);
      this.markTriangle(next);
      scratch.push(testnv1);
      nv0 = testnv0;
      nv1 = testnv1;
      next = findOtherFace(edgeInfos, nv0, nv1, next);
    }
    for (let i = backward.length - 1; i >= 0; i -= 1) this.faces.push(backward[i]);
    for (const face of forward) this.faces.push(face);
  }
  sharesEdge(face: FaceInfo, edgeInfos: (EdgeInfo | null)[]): boolean {
    for (const [a, b] of [[face.v0, face.v1], [face.v1, face.v2], [face.v2, face.v0]]) {
      const e = nn(findEdgeInfo(edgeInfos, a, b));
      if (this.isInStrip(e.face0) || this.isInStrip(e.face1)) return true;
    }
    return false;
  }
}

class Stripifier {
  indices: number[] = [];
  cacheSize = 0;
  minStripLength = 0;
  meshJump = 0;
  firstTimeResetPoint = true;

  buildStripifyInfo(faceInfos: FaceInfo[], edgeInfos: (EdgeInfo | null)[], maxIndex: number): void {
    const n = this.indices.length;
    for (let i = 0; i < maxIndex + 1; i += 1) edgeInfos.push(null);
    const numTriangles = Math.trunc(n / 3);
    let index = 0;
    for (let i = 0; i < numTriangles; i += 1) {
      let mightAlreadyExist = true;
      const updated = [false, false, false];
      const v0 = this.indices[index++];
      const v1 = this.indices[index++];
      const v2 = this.indices[index++];
      if (v0 === v1 || v0 === v2 || v1 === v2) continue;
      const face = new FaceInfo(v0, v1, v2);
      const edges: EdgeInfo[] = [];
      for (const [k, a, b] of [[0, v0, v1], [1, v1, v2], [2, v2, v0]]) {
        let e = findEdgeInfo(edgeInfos, a, b);
        if (e === null) {
          mightAlreadyExist = false;
          e = new EdgeInfo(a, b);
          e.nextV0 = at(edgeInfos, a);
          e.nextV1 = at(edgeInfos, b);
          edgeInfos[a] = e;
          edgeInfos[b] = e;
          e.face0 = face;
        } else if (e.face1 === null) {
          e.face1 = face;
          updated[k] = true;
        } // else "> 2 triangles on an edge... uncertain consequences", as Java prints and goes on
        edges.push(e);
      }
      if (mightAlreadyExist) {
        if (!faceInfos.some((o) => o.v0 === face.v0 && o.v1 === face.v1 && o.v2 === face.v2)) faceInfos.push(face);
        else {
          if (updated[0]) edges[0].face1 = null;
          if (updated[1]) edges[1].face1 = null;
          if (updated[2]) edges[2].face1 = null;
        }
      } else faceInfos.push(face);
    }
  }

  static findStartPoint(faceInfos: FaceInfo[], edgeInfos: (EdgeInfo | null)[]): number {
    let bestCtr = -1;
    let bestIndex = -1;
    for (let i = 0; i < faceInfos.length; i += 1) {
      const face = faceInfos[i];
      let ctr = 0;
      if (findOtherFace(edgeInfos, face.v0, face.v1, face) === null) ctr += 1;
      if (findOtherFace(edgeInfos, face.v1, face.v2, face) === null) ctr += 1;
      if (findOtherFace(edgeInfos, face.v2, face.v0, face) === null) ctr += 1;
      if (ctr > bestCtr) {
        bestCtr = ctr;
        bestIndex = i;
      }
    }
    return bestCtr === 0 ? -1 : bestIndex;
  }

  findGoodResetPoint(faceInfos: FaceInfo[], edgeInfos: (EdgeInfo | null)[]): FaceInfo | null {
    let result: FaceInfo | null = null;
    const numFaces = faceInfos.length;
    let startPoint: number;
    const jump = (): number => Math.trunc(f(f(numFaces - 1) * this.meshJump));
    if (this.firstTimeResetPoint) {
      startPoint = Stripifier.findStartPoint(faceInfos, edgeInfos);
      this.firstTimeResetPoint = false;
    } else startPoint = jump();
    if (startPoint === -1) startPoint = jump();
    let i = startPoint;
    do {
      if (at(faceInfos, i).stripId < 0) {
        result = faceInfos[i];
        break;
      }
      if (++i >= numFaces) i = 0;
    } while (i !== startPoint);
    this.meshJump = f(this.meshJump + f(0.1));
    if (this.meshJump > 1) this.meshJump = f(0.05);
    return result;
  }

  static commitStrips(allStrips: StripInfo[], strips: StripInfo[]): void {
    for (const strip of strips) {
      strip.experimentId = -1;
      allStrips.push(strip);
      for (const face of strip.faces) strip.markTriangle(face);
    }
  }

  static updateCacheFace(cache: VertexCache, face: FaceInfo): void {
    if (!cache.inCache(face.v0)) cache.addEntry(face.v0);
    if (!cache.inCache(face.v1)) cache.addEntry(face.v1);
    if (!cache.inCache(face.v2)) cache.addEntry(face.v2);
  }

  static updateCacheStrip(cache: VertexCache, strip: StripInfo): void {
    for (const face of strip.faces) Stripifier.updateCacheFace(cache, face);
  }

  static calcNumHitsStrip(cache: VertexCache, strip: StripInfo): number {
    let hits = 0;
    let faces = 0;
    for (const face of strip.faces) {
      if (cache.inCache(face.v0)) hits += 1;
      if (cache.inCache(face.v1)) hits += 1;
      if (cache.inCache(face.v2)) hits += 1;
      faces += 1;
    }
    return f(f(hits) / f(faces));
  }

  static avgStripSize(strips: StripInfo[]): number {
    let size = 0;
    for (const strip of strips) {
      size += strip.faces.length;
      size -= strip.numDegenerates;
    }
    return f(f(size) / f(strips.length));
  }

  static calcNumHitsFace(cache: VertexCache, face: FaceInfo): number {
    return (cache.inCache(face.v0) ? 1 : 0) + (cache.inCache(face.v1) ? 1 : 0) + (cache.inCache(face.v2) ? 1 : 0);
  }

  static numNeighbors(face: FaceInfo, edgeInfos: (EdgeInfo | null)[]): number {
    let n = 0;
    if (findOtherFace(edgeInfos, face.v0, face.v1, face) !== null) n += 1;
    if (findOtherFace(edgeInfos, face.v1, face.v2, face) !== null) n += 1;
    if (findOtherFace(edgeInfos, face.v2, face.v0, face) !== null) n += 1;
    return n;
  }

  static findTraversal(edgeInfos: (EdgeInfo | null)[], strip: StripInfo, startInfo: StripStartInfo): boolean {
    const startEdge = nn(strip.startInfo.startEdge);
    const v = strip.startInfo.toV1 ? startEdge.v1 : startEdge.v0;
    let untouched: FaceInfo | null = null;
    let iter = at(edgeInfos, v);
    while (iter !== null) {
      const face0 = iter.face0;
      const face1 = iter.face1;
      if (face0 !== null && !strip.isInStrip(face0) && face1 !== null && !strip.isMarked(face1)) {
        untouched = face1;
        break;
      }
      if (face1 !== null && !strip.isInStrip(face1) && face0 !== null && !strip.isMarked(face0)) {
        untouched = face0;
        break;
      }
      iter = iter.v0 === v ? iter.nextV0 : iter.nextV1;
    }
    startInfo.startFace = untouched;
    startInfo.startEdge = iter;
    if (iter !== null) {
      if (strip.sharesEdge(nn(startInfo.startFace), edgeInfos)) startInfo.toV1 = iter.v0 === v;
      else startInfo.toV1 = iter.v1 === v;
    }
    return startInfo.startFace !== null;
  }

  removeSmallStrips(allStrips: StripInfo[], allBigStrips: StripInfo[], faceList: FaceInfo[]): void {
    faceList.length = 0;
    allBigStrips.length = 0;
    const temp: FaceInfo[] = [];
    for (const strip of allStrips) {
      if (strip.faces.length < this.minStripLength) temp.push(...strip.faces);
      else allBigStrips.push(strip);
    }
    const visited = new Array<boolean>(temp.length).fill(false);
    const cache = new VertexCache(this.cacheSize);
    let bestIndex = -9999;
    for (;;) {
      let bestNumHits = -1;
      for (let i = 0; i < temp.length; i += 1) {
        if (visited[i]) continue;
        const hits = Stripifier.calcNumHitsFace(cache, temp[i]);
        if (hits > bestNumHits) {
          bestNumHits = hits;
          bestIndex = i;
        }
      }
      if (bestNumHits === -1) break;
      visited[bestIndex] = true;
      Stripifier.updateCacheFace(cache, temp[bestIndex]);
      faceList.push(temp[bestIndex]);
    }
  }

  /** `createStrips`, stitched (the only way `generateStrips` calls it at its defaults). */
  createStrips(allStrips: StripInfo[], stripIndices: number[], stitch: boolean): number {
    let numSeparate = 0;
    const last = new FaceInfo(0, 0, 0);
    const count = allStrips.length;
    let accountForNegatives = 0;
    for (let i = 0; i < count; i += 1) {
      const strip = allStrips[i];
      const faceCount = strip.faces.length;
      const f0 = at(strip.faces, 0);
      const first = new FaceInfo(f0.v0, f0.v1, f0.v2);
      if (faceCount > 1) {
        const unique = getUniqueVertexInB(strip.faces[1], first);
        if (unique === first.v1) [first.v0, first.v1] = [first.v1, first.v0];
        else if (unique === first.v2) [first.v0, first.v2] = [first.v2, first.v0];
        if (faceCount > 2) {
          if (isDegenerateFace(strip.faces[1])) {
            const pivot = strip.faces[1].v1;
            if (first.v1 === pivot) [first.v1, first.v2] = [first.v2, first.v1];
          } else {
            const shared = getSharedVertices(strip.faces[2], first);
            if (shared[0] === first.v1 && shared[1] === -1) [first.v1, first.v2] = [first.v2, first.v1];
          }
        }
      }
      if (i === 0 || !stitch) {
        if (!isCW(f0, first.v0, first.v1)) stripIndices.push(first.v0);
      } else {
        stripIndices.push(first.v0);
        if (nextIsCW(stripIndices.length - accountForNegatives) !== isCW(f0, first.v0, first.v1)) stripIndices.push(first.v0);
      }
      stripIndices.push(first.v0, first.v1, first.v2);
      last.set(first);
      for (let j = 1; j < faceCount; j += 1) {
        const face = strip.faces[j];
        const unique = getUniqueVertexInB(last, face);
        if (unique !== -1) {
          stripIndices.push(unique);
          last.v0 = last.v1;
          last.v1 = last.v2;
          last.v2 = unique;
        } else {
          stripIndices.push(face.v2);
          last.v0 = face.v0;
          last.v1 = face.v1;
          last.v2 = face.v2;
        }
      }
      if (stitch) {
        if (i !== count - 1) stripIndices.push(last.v2);
      } else {
        stripIndices.push(-1);
        accountForNegatives += 1;
        numSeparate += 1;
      }
      last.v0 = last.v1;
      last.v1 = last.v2;
    }
    return stitch ? 1 : numSeparate;
  }

  findAllStrips(allStrips: StripInfo[], allFaceInfos: FaceInfo[], allEdgeInfos: (EdgeInfo | null)[], numSamples: number): void {
    let experimentId = 0;
    let stripId = 0;
    let done = false;
    while (!done) {
      const experiments: StripInfo[][] = Array.from({ length: numSamples * 6 }, () => []);
      let experimentIndex = 0;
      const resetPoints = new Set<FaceInfo>();
      for (let i = 0; i < numSamples; i += 1) {
        const next = this.findGoodResetPoint(allFaceInfos, allEdgeInfos);
        if (next === null) {
          done = true;
          break;
        } else if (resetPoints.has(next)) continue;
        resetPoints.add(next);
        const e01 = findEdgeInfo(allEdgeInfos, next.v0, next.v1);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e01, true), stripId++, experimentId++));
        const e10 = findEdgeInfo(allEdgeInfos, next.v0, next.v1);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e10, false), stripId++, experimentId++));
        const e12 = findEdgeInfo(allEdgeInfos, next.v1, next.v2);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e12, true), stripId++, experimentId++));
        const e21 = findEdgeInfo(allEdgeInfos, next.v1, next.v2);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e21, false), stripId++, experimentId++));
        const e20 = findEdgeInfo(allEdgeInfos, next.v2, next.v0);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e20, true), stripId++, experimentId++));
        const e02 = findEdgeInfo(allEdgeInfos, next.v2, next.v0);
        experiments[experimentIndex++].push(new StripInfo(new StripStartInfo(next, e02, false), stripId++, experimentId++));
      }
      const numExperiments = experimentIndex;
      for (let i = 0; i < numExperiments; i += 1) {
        const firstStrip = experiments[i][0];
        firstStrip.build(allEdgeInfos);
        const experimentId2 = firstStrip.experimentId;
        let iter = firstStrip;
        // ⚠️ Java reuses one StripStartInfo for every strip of the experiment
        // ("TODO startInfo clone ?"), so a strip's start changes under it as the
        // next is found; the port shares it the same way.
        const startInfo = new StripStartInfo(null, null, false);
        while (Stripifier.findTraversal(allEdgeInfos, iter, startInfo)) {
          iter = new StripInfo(startInfo, stripId++, experimentId2);
          iter.build(allEdgeInfos);
          experiments[i].push(iter);
        }
      }
      let bestIndex = 0;
      let bestValue = 0;
      for (let i = 0; i < numExperiments; i += 1) {
        const avg = Stripifier.avgStripSize(experiments[i]);
        const numStrips = f(experiments[i].length);
        const value = f(f(avg * 1) + f(numStrips * 0));
        if (value > bestValue) {
          bestValue = value;
          bestIndex = i;
        }
      }
      Stripifier.commitStrips(allStrips, experiments[bestIndex]);
    }
  }

  splitUpStripsAndOptimize(allStrips: StripInfo[], outStrips: StripInfo[], edgeInfos: (EdgeInfo | null)[], outFaceList: FaceInfo[]): void {
    const threshold = this.cacheSize;
    const tempStrips: StripInfo[] = [];
    for (const strip of allStrips) {
      const startInfo = new StripStartInfo(null, null, false);
      let actualStripSize = 0;
      for (const face of strip.faces) if (!isDegenerateFace(face)) actualStripSize += 1;
      if (actualStripSize > threshold) {
        const numTimes = Math.trunc(actualStripSize / threshold);
        let numLeftover = actualStripSize % threshold;
        let degenerateCount = 0;
        let j: number;
        for (j = 0; j < numTimes; j += 1) {
          const current = new StripInfo(startInfo, 0, -1);
          let faceCtr = j * threshold + degenerateCount;
          let firstTime = true;
          while (faceCtr < threshold + j * threshold + degenerateCount) {
            if (isDegenerateFace(at(strip.faces, faceCtr))) {
              degenerateCount += 1;
              if ((faceCtr + 1 !== threshold + j * threshold + degenerateCount || (j === numTimes - 1 && numLeftover < 4 && numLeftover > 0)) && !firstTime) {
                current.faces.push(strip.faces[faceCtr++]);
              } else faceCtr += 1;
            } else {
              current.faces.push(strip.faces[faceCtr++]);
              firstTime = false;
            }
          }
          if (j === numTimes - 1) {
            if (numLeftover < 4 && numLeftover > 0) {
              let ctr = 0;
              while (ctr < numLeftover) {
                if (!isDegenerateFace(at(strip.faces, faceCtr))) {
                  current.faces.push(strip.faces[faceCtr++]);
                  ctr += 1;
                } else {
                  current.faces.push(strip.faces[faceCtr++]);
                  degenerateCount += 1;
                }
              }
              numLeftover = 0;
            }
          }
          tempStrips.push(current);
        }
        let leftOff = j * threshold + degenerateCount;
        if (numLeftover !== 0) {
          const current = new StripInfo(startInfo, 0, -1);
          let ctr = 0;
          let firstTime = true;
          while (ctr < numLeftover) {
            if (!isDegenerateFace(at(strip.faces, leftOff))) {
              ctr += 1;
              firstTime = false;
              current.faces.push(strip.faces[leftOff++]);
            } else if (!firstTime) current.faces.push(strip.faces[leftOff++]);
            else leftOff += 1;
          }
          tempStrips.push(current);
        }
      } else {
        const current = new StripInfo(startInfo, 0, -1);
        current.faces.push(...strip.faces);
        tempStrips.push(current);
      }
    }

    const tempStrips2: StripInfo[] = [];
    this.removeSmallStrips(tempStrips, tempStrips2, outFaceList);
    outStrips.length = 0;
    if (tempStrips2.length === 0) return;
    const cache = new VertexCache(this.cacheSize);
    let bestIndex = -99999;
    let firstIndex = 0;
    let minCost = f(10000);
    for (let i = 0; i < tempStrips2.length; i += 1) {
      let neighbors = 0;
      for (const face of tempStrips2[i].faces) neighbors += Stripifier.numNeighbors(face, edgeInfos);
      const cost = f(f(neighbors) / f(tempStrips2[i].faces.length));
      if (cost < minCost) {
        minCost = cost;
        firstIndex = i;
      }
    }
    Stripifier.updateCacheStrip(cache, tempStrips2[firstIndex]);
    outStrips.push(tempStrips2[firstIndex]);
    tempStrips2[firstIndex].visited = true;
    let wantsCW = tempStrips2[firstIndex].faces.length % 2 === 0;
    for (;;) {
      let bestNumHits = -1;
      for (let i = 0; i < tempStrips2.length; i += 1) {
        const strip = tempStrips2[i];
        if (strip.visited) continue;
        const hits = Stripifier.calcNumHitsStrip(cache, strip);
        if (hits > bestNumHits) {
          bestNumHits = hits;
          bestIndex = i;
        } else if (hits >= bestNumHits) {
          const faceCount = strip.faces.length;
          const f0 = strip.faces[0];
          const first = new FaceInfo(f0.v0, f0.v1, f0.v2);
          if (faceCount > 1) {
            const unique = getUniqueVertexInB(strip.faces[1], first);
            if (unique === first.v1) [first.v0, first.v1] = [first.v1, first.v0];
            else if (unique === first.v2) [first.v0, first.v2] = [first.v2, first.v0];
            if (faceCount > 2) {
              const shared = getSharedVertices(strip.faces[2], first);
              if (shared[0] === first.v1 && shared[1] === -1) [first.v1, first.v2] = [first.v2, first.v1];
            }
          }
          if (wantsCW === isCW(f0, first.v0, first.v1)) bestIndex = i;
        }
      }
      if (bestNumHits === -1) break;
      const best = tempStrips2[bestIndex];
      best.visited = true;
      Stripifier.updateCacheStrip(cache, best);
      outStrips.push(best);
      wantsCW = best.faces.length % 2 === 0 ? wantsCW : !wantsCW;
    }
  }

  stripify(indices: number[], cacheSize: number, minStripLength: number, maxIndex: number, outStrips: StripInfo[], outFaceList: FaceInfo[]): void {
    this.meshJump = 0;
    this.firstTimeResetPoint = true;
    this.cacheSize = Math.max(1, cacheSize - 6);
    this.minStripLength = minStripLength;
    this.indices = indices;
    const faceInfos: FaceInfo[] = [];
    const edgeInfos: (EdgeInfo | null)[] = [];
    this.buildStripifyInfo(faceInfos, edgeInfos, maxIndex);
    const allStrips: StripInfo[] = [];
    this.findAllStrips(allStrips, faceInfos, edgeInfos, 10);
    this.splitUpStripsAndOptimize(allStrips, outStrips, edgeInfos, outFaceList);
  }
}

/** A `PrimitiveGroup`: a strip (`PT_STRIP`, 1) or a list (`PT_LIST`, 0) of indices. */
export interface PrimitiveGroup {
  readonly type: 0 | 1;
  readonly indices: number[];
}

/**
 * `new TriStrip().generateStrips(triangles)`: one stitched strip, and a list
 * of the faces left out of every strip when there are any (none at the
 * default minimum strip length of 0).
 *
 * ⚠️ Throws where Java does -- on an empty triangle list (an index out of
 * bounds in `findGoodResetPoint`), and on input whose edges do not resolve.
 */
export function generateStrips(triangles: ArrayLike<number>): PrimitiveGroup[] {
  const indices = Array.from(triangles);
  let maxIndex = 0;
  for (const i of indices) if (i > maxIndex) maxIndex = i;
  const strips: StripInfo[] = [];
  const faces: FaceInfo[] = [];
  const stripifier = new Stripifier();
  stripifier.stripify(indices, 16, 0, maxIndex, strips, faces);
  const stripIndices: number[] = [];
  stripifier.createStrips(strips, stripIndices, true);
  const groups: PrimitiveGroup[] = [{ type: 1, indices: stripIndices }];
  if (faces.length !== 0) groups.push({ type: 0, indices: faces.flatMap((face) => [face.v0, face.v1, face.v2]) });
  return groups;
}
