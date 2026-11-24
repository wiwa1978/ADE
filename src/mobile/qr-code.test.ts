import assert from "node:assert/strict"
import test from "node:test"
import { generateQrMatrix, generateQrSvgData, rsComputeRemainder } from "./qr-code.ts"

test("Reed-Solomon remainder matches ISO/IEC 18004 Annex I example (Hello World v1-M)", () => {
  // Standard ISO/IEC 18004 example for Version 1-M (16 data bytes, 10 EC bytes)
  const data = new Uint8Array([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17])
  const ec = rsComputeRemainder(data, 10)
  assert.deepEqual([...ec], [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test("QR matrix embeds valid finder patterns, timing patterns, and dark module for pairing URLs", () => {
  const url = "http://192.168.1.42:4320/pair?code=ab12cd34ef56gh78ij90kl12mn34op56"
  const qr = generateQrMatrix(url)
  assert.ok(qr.version >= 4 && qr.version <= 10)
  assert.equal(qr.size, qr.version * 4 + 17)

  // Check top-left 7x7 finder pattern corners + center
  const at = (r: number, c: number) => qr.modules[r * qr.size + c]
  assert.equal(at(0, 0), 1)
  assert.equal(at(0, 6), 1)
  assert.equal(at(6, 0), 1)
  assert.equal(at(3, 3), 1)
  assert.equal(at(1, 1), 0)
  // Separator white border around top-left finder
  assert.equal(at(7, 0), 0)
  assert.equal(at(0, 7), 0)
  // Top-right finder & bottom-left finder
  assert.equal(at(0, qr.size - 1), 1)
  assert.equal(at(3, qr.size - 4), 1)
  assert.equal(at(qr.size - 1, 0), 1)
  assert.equal(at(qr.size - 4, 3), 1)
  // Mandatory dark module at (4*version + 9, 8)
  assert.equal(at(qr.size - 8, 8), 1)
  // Timing pattern alternating on row 6 & col 6
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(at(6, i), i % 2 === 0 ? 1 : 0)
    assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0)
  }

  const svg = generateQrSvgData(url, 4)
  assert.equal(svg.viewBoxSize, qr.size + 8)
  assert.ok(svg.path.startsWith("M4,4h7v1h-7z"))
})
