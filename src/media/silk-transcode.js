const SILK_SAMPLE_RATE = 24_000

export function normalizeSilkBuffer(silkBuf) {
  const buf = Buffer.isBuffer(silkBuf) ? silkBuf : Buffer.from(silkBuf)
  if (buf[0] === 0x02 && buf.subarray(1, 7).toString('ascii') === '#!SILK') {
    return buf.subarray(1)
  }
  return buf
}

function pcmBytesToWav(pcm, sampleRate) {
  const pcmBytes = pcm.byteLength
  const totalSize = 44 + pcmBytes
  const buf = Buffer.allocUnsafe(totalSize)
  let offset = 0

  buf.write('RIFF', offset)
  offset += 4
  buf.writeUInt32LE(totalSize - 8, offset)
  offset += 4
  buf.write('WAVE', offset)
  offset += 4

  buf.write('fmt ', offset)
  offset += 4
  buf.writeUInt32LE(16, offset)
  offset += 4
  buf.writeUInt16LE(1, offset)
  offset += 2
  buf.writeUInt16LE(1, offset)
  offset += 2
  buf.writeUInt32LE(sampleRate, offset)
  offset += 4
  buf.writeUInt32LE(sampleRate * 2, offset)
  offset += 4
  buf.writeUInt16LE(2, offset)
  offset += 2
  buf.writeUInt16LE(16, offset)
  offset += 2

  buf.write('data', offset)
  offset += 4
  buf.writeUInt32LE(pcmBytes, offset)
  offset += 4

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset)
  return buf
}

export async function silkToWav(silkBuf) {
  try {
    const { decode } = await import('silk-wasm')
    const normalized = normalizeSilkBuffer(silkBuf)
    const result = await decode(normalized, SILK_SAMPLE_RATE)
    return pcmBytesToWav(result.data, SILK_SAMPLE_RATE)
  } catch {
    return null
  }
}
