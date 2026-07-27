const textEncoder = new TextEncoder();

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

const crc32 = (bytes) => {
  let value = 0xffffffff;
  bytes.forEach((byte) => {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  });
  return (value ^ 0xffffffff) >>> 0;
};

const toDosDateTime = (value = new Date()) => {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
};

const concatBytes = (parts) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
};

const writeUint16 = (view, offset, value) => view.setUint16(offset, value, true);
const writeUint32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

const deflateBytes = async (bytes) => {
  if (typeof CompressionStream !== "function") {
    return { bytes, method: 0 };
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < bytes.length
      ? { bytes: compressed, method: 8 }
      : { bytes, method: 0 };
  } catch {
    return { bytes, method: 0 };
  }
};

const buildLocalHeader = ({ checksum, compressedSize, date, method, nameBytes, time, uncompressedSize }) => {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0x0800);
  writeUint16(view, 8, method);
  writeUint16(view, 10, time);
  writeUint16(view, 12, date);
  writeUint32(view, 14, checksum);
  writeUint32(view, 18, compressedSize);
  writeUint32(view, 22, uncompressedSize);
  writeUint16(view, 26, nameBytes.length);
  writeUint16(view, 28, 0);
  header.set(nameBytes, 30);
  return header;
};

const buildCentralHeader = ({ checksum, compressedSize, date, localOffset, method, nameBytes, time, uncompressedSize }) => {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0x0800);
  writeUint16(view, 10, method);
  writeUint16(view, 12, time);
  writeUint16(view, 14, date);
  writeUint32(view, 16, checksum);
  writeUint32(view, 20, compressedSize);
  writeUint32(view, 24, uncompressedSize);
  writeUint16(view, 28, nameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, localOffset);
  header.set(nameBytes, 46);
  return header;
};

const buildEndRecord = ({ centralOffset, centralSize, entryCount }) => {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  writeUint16(view, 20, 0);
  return record;
};

async function buildZipArchive(files, { modifiedAt = new Date() } = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const nameBytes = textEncoder.encode(String(file?.name || "file.txt"));
    const contentBytes = file?.content instanceof Uint8Array
      ? file.content
      : textEncoder.encode(String(file?.content ?? ""));
    const compressed = await deflateBytes(contentBytes);
    const dos = toDosDateTime(modifiedAt);
    const metadata = {
      checksum: crc32(contentBytes),
      compressedSize: compressed.bytes.length,
      date: dos.date,
      localOffset,
      method: compressed.method,
      nameBytes,
      time: dos.time,
      uncompressedSize: contentBytes.length,
    };
    const localHeader = buildLocalHeader(metadata);
    localParts.push(localHeader, compressed.bytes);
    centralParts.push(buildCentralHeader(metadata));
    localOffset += localHeader.length + compressed.bytes.length;
  }
  const centralDirectory = concatBytes(centralParts);
  return concatBytes([
    ...localParts,
    centralDirectory,
    buildEndRecord({
      centralOffset: localOffset,
      centralSize: centralDirectory.length,
      entryCount: files.length,
    }),
  ]);
}

export { buildZipArchive };
