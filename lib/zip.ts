export async function makeZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const central: ArrayBuffer[] = []
  const encoder = new TextEncoder()
  let offset = 0
  let centralSize = 0
  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer())
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(bytes)
    const header = new ArrayBuffer(30 + nameBytes.length)
    const head = new DataView(header)
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, bytes.length, true)
    head.setUint32(22, bytes.length, true)
    head.setUint16(26, nameBytes.length, true)
    new Uint8Array(header, 30).set(nameBytes)
    parts.push(header, file.blob)

    const entry = new ArrayBuffer(46 + nameBytes.length)
    const view = new DataView(entry)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint32(16, crc, true)
    view.setUint32(20, bytes.length, true)
    view.setUint32(24, bytes.length, true)
    view.setUint16(28, nameBytes.length, true)
    view.setUint32(42, offset, true)
    new Uint8Array(entry, 46).set(nameBytes)
    central.push(entry)
    centralSize += entry.byteLength
    offset += header.byteLength + file.blob.size
  }
  parts.push(...central)
  const end = new ArrayBuffer(22)
  const footer = new DataView(end)
  footer.setUint32(0, 0x06054b50, true)
  footer.setUint16(8, files.length, true)
  footer.setUint16(10, files.length, true)
  footer.setUint32(12, centralSize, true)
  footer.setUint32(16, offset, true)
  parts.push(end)
  return new Blob(parts, { type: 'application/zip' })
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of bytes) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
