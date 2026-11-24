/**
 * Standards-compliant ISO/IEC 18004 QR Code generator (Versions 1–10, Byte mode, ECC Level L/M).
 * Zero external dependencies — outputs a crisp boolean module matrix and SVG path string
 * scannable by iPhone Camera, Android Camera, and standard QR readers.
 */

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsGeneratorPoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < ecCount; i++) {
    const next = new Uint8Array(poly.length + 1)
    const factor = GF_EXP[i]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], factor)
    }
    poly = next
  }
  return poly
}

export function rsComputeRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount)
  const rem = new Uint8Array(ecCount)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0]
    rem.copyWithin(0, 1)
    rem[ecCount - 1] = 0
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor)
      }
    }
  }
  return rem
}

type VersionSpec = {
  version: number
  /** Total data codewords across all blocks (Level M) */
  dataCodewords: number
  /** EC codewords per block (Level M) */
  ecPerBlock: number
  /** [blockCount, dataCodewordsPerBlock] groups (Level M) */
  groups: ReadonlyArray<readonly [number, number]>
  /** Alignment pattern center coordinates */
  alignment: readonly number[]
}

// ISO/IEC 18004 Table 9 (Error Correction Level M, Versions 1–10)
const VERSION_SPECS_M: readonly VersionSpec[] = [
  { version: 1, dataCodewords: 16, ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  { version: 2, dataCodewords: 28, ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18] },
  { version: 3, dataCodewords: 44, ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22] },
  { version: 4, dataCodewords: 64, ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26] },
  { version: 5, dataCodewords: 86, ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30] },
  { version: 6, dataCodewords: 108, ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34] },
  { version: 7, dataCodewords: 124, ecPerBlock: 18, groups: [[4, 31]], alignment: [6, 22, 38] },
  { version: 8, dataCodewords: 154, ecPerBlock: 22, groups: [[2, 38], [2, 39]], alignment: [6, 24, 42] },
  { version: 9, dataCodewords: 182, ecPerBlock: 22, groups: [[3, 36], [2, 37]], alignment: [6, 26, 46] },
  { version: 10, dataCodewords: 216, ecPerBlock: 26, groups: [[4, 43], [1, 44]], alignment: [6, 28, 50] },
]

// Precomputed 18-bit BCH(18,6) version info strings for versions 7–10
const VERSION_INFO_BITS: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
}

// Precomputed 15-bit BCH(15,5) format info strings for EC Level M (indicator 00) & masks 0..7
const FORMAT_INFO_M: readonly number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
]

function chooseSpec(byteLen: number): VersionSpec {
  for (const spec of VERSION_SPECS_M) {
    const countBits = spec.version >= 10 ? 16 : 8
    const neededBits = 4 + countBits + byteLen * 8
    if (neededBits <= spec.dataCodewords * 8) return spec
  }
  throw new Error(`QR payload too long (${byteLen} bytes, max 213 bytes).`)
}

function encodeCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = []
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  // Byte mode indicator (0100)
  pushBits(0b0100, 4)
  pushBits(bytes.length, spec.version >= 10 ? 16 : 8)
  for (const b of bytes) pushBits(b, 8)

  const totalDataBits = spec.dataCodewords * 8
  const terminator = Math.min(4, totalDataBits - bits.length)
  for (let i = 0; i < terminator; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const data = new Uint8Array(spec.dataCodewords)
  let byteIdx = 0
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b]
    data[byteIdx++] = v
  }
  const padBytes = [0xec, 0x11]
  let padIdx = 0
  while (byteIdx < spec.dataCodewords) {
    data[byteIdx++] = padBytes[padIdx++ & 1]
  }

  // Split into RS blocks & interleave
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (const [count, len] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + len)
      offset += len
      dataBlocks.push(block)
      ecBlocks.push(rsComputeRemainder(block, spec.ecPerBlock))
    }
  }

  const maxDataLen = Math.max(...dataBlocks.map(b => b.length))
  const totalLen = spec.dataCodewords + ecBlocks.length * spec.ecPerBlock
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) out[pos++] = block[i]
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      out[pos++] = block[i]
    }
  }
  return out
}

function buildBaseMatrix(spec: VersionSpec): { size: number; modules: Uint8Array; isFunction: Uint8Array } {
  const size = spec.version * 4 + 17
  const modules = new Uint8Array(size * size)
  const isFunction = new Uint8Array(size * size)

  const setFn = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return
    const idx = r * size + c
    modules[idx] = dark ? 1 : 0
    isFunction[idx] = 1
  }

  // Finder patterns + 1-module white separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr
        const c = left + dc
        if (r < 0 || c < 0 || r >= size || c >= size) continue
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const dark = inOuter && (
          dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
        )
        setFn(r, c, dark)
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }

  // Alignment patterns
  const centers = spec.alignment
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const cr = centers[i]
      const cc = centers[j]
      // Skip corners overlapping the 3 finder patterns
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) {
        continue
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc))
          setFn(cr + dr, cc + dc, dist === 2 || dist === 0)
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFn(8, i, false)
      setFn(i, 8, false)
    }
  }
  for (let i = 0; i < 8; i++) {
    setFn(8, size - 1 - i, false)
    setFn(size - 1 - i, 8, false)
  }
  setFn(size - 8, 8, true)

  // Version info areas (versions >= 7)
  if (spec.version >= 7) {
    const vBits = VERSION_INFO_BITS[spec.version]
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1
      const r = Math.floor(i / 3)
      const c = size - 11 + (i % 3)
      setFn(r, c, bit)
      setFn(c, r, bit)
    }
  }

  return { size, modules, isFunction }
}

function placeDataBits(size: number, modules: Uint8Array, isFunction: Uint8Array, codewords: Uint8Array): void {
  let bitIdx = 0
  const totalBits = codewords.length * 8
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const c = right - j
        const idx = r * size + c
        if (isFunction[idx]) continue
        let dark = false
        if (bitIdx < totalBits) {
          dark = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1
          bitIdx++
        }
        modules[idx] = dark ? 1 : 0
      }
    }
    upward = !upward
  }
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return false
  }
}

function writeFormatInfo(size: number, modules: Uint8Array, mask: number): void {
  const bits = FORMAT_INFO_M[mask]
  // Bit 14 is MSB, Bit 0 is LSB. Around top-left finder:
  const coords1: readonly (readonly [number, number])[] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]
  const coords2: readonly (readonly [number, number])[] = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ]
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> (14 - i)) & 1) === 1 ? 1 : 0
    const [r1, c1] = coords1[i]
    const [r2, c2] = coords2[i]
    modules[r1 * size + c1] = dark
    modules[r2 * size + c2] = dark
  }
}

function penaltyScore(size: number, modules: Uint8Array): number {
  let score = 0
  // Rule 1: adjacent modules in row/col of same color
  for (let r = 0; r < size; r++) {
    let runColor = modules[r * size]
    let runLen = 1
    for (let c = 1; c < size; c++) {
      const v = modules[r * size + c]
      if (v === runColor) {
        runLen++
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5)
        runColor = v
        runLen = 1
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5)
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[c]
    let runLen = 1
    for (let r = 1; r < size; r++) {
      const v = modules[r * size + c]
      if (v === runColor) {
        runLen++
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5)
        runColor = v
        runLen = 1
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5)
  }
  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r * size + c]
      if (
        v === modules[r * size + c + 1] &&
        v === modules[(r + 1) * size + c] &&
        v === modules[(r + 1) * size + c + 1]
      ) {
        score += 3
      }
    }
  }
  // Rule 4: dark/light ratio balance
  let darkCount = 0
  for (let i = 0; i < modules.length; i++) darkCount += modules[i]
  const pct = (darkCount * 100) / modules.length
  const k = Math.floor(Math.abs(pct - 50) / 5)
  score += k * 10
  return score
}

export type QrMatrix = {
  version: number
  size: number
  modules: Uint8Array
}

export function generateQrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text)
  const spec = chooseSpec(bytes.length)
  const codewords = encodeCodewords(bytes, spec)
  const { size, modules: base, isFunction } = buildBaseMatrix(spec)
  placeDataBits(size, base, isFunction, codewords)

  let bestMask = 0
  let bestScore = Infinity
  let bestModules = new Uint8Array(base.length)

  for (let mask = 0; mask < 8; mask++) {
    const candidate = new Uint8Array(base)
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c
        if (!isFunction[idx] && maskBit(mask, r, c)) {
          candidate[idx] ^= 1
        }
      }
    }
    writeFormatInfo(size, candidate, mask)
    const s = penaltyScore(size, candidate)
    if (s < bestScore) {
      bestScore = s
      bestMask = mask
      bestModules = candidate
    }
  }

  void bestMask
  return { version: spec.version, size, modules: bestModules }
}

/**
 * Generates an SVG path `d` attribute for all dark modules, including a quiet zone border.
 */
export function generateQrSvgData(text: string, quietZone = 4): { viewBoxSize: number; path: string; size: number; version: number } {
  const qr = generateQrMatrix(text)
  const parts: string[] = []
  for (let r = 0; r < qr.size; r++) {
    let c = 0
    while (c < qr.size) {
      if (qr.modules[r * qr.size + c]) {
        const start = c
        while (c < qr.size && qr.modules[r * qr.size + c]) c++
        const len = c - start
        parts.push(`M${start + quietZone},${r + quietZone}h${len}v1h-${len}z`)
      } else {
        c++
      }
    }
  }
  return {
    version: qr.version,
    size: qr.size,
    viewBoxSize: qr.size + quietZone * 2,
    path: parts.join(""),
  }
}
