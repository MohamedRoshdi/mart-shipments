// Store-only ZIP writer. A browser download cannot create folders — Chrome rewrites
// any "/" in the download name — so an archive is the only way to hand the owner a
// folder-per-type structure. No compression means no dependency and no build step.

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = -1;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function block(size, fill) {
  const buf = new ArrayBuffer(size);
  fill(new DataView(buf));
  return new Uint8Array(buf);
}

// files: [{ path, text }] — path may hold "/" and Arabic; flag bit 11 marks the name UTF-8
export function zipBlob(files) {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.text);
    const crc = crc32(data);

    parts.push(block(30, (v) => {
      v.setUint32(0, 0x04034b50, true);   // local file header
      v.setUint16(4, 20, true);           // version needed
      v.setUint16(6, 0x0800, true);       // UTF-8 file name
      v.setUint16(8, 0, true);            // method: stored
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
    }), name, data);

    central.push(block(46, (v) => {
      v.setUint32(0, 0x02014b50, true);   // central directory entry
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, time, true);
      v.setUint16(14, date, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, data.length, true);
      v.setUint32(24, data.length, true);
      v.setUint16(28, name.length, true);
      v.setUint32(42, offset, true);      // where the local header sits
    }), name);

    offset += 30 + name.length + data.length;
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = block(22, (v) => {
    v.setUint32(0, 0x06054b50, true);     // end of central directory
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, offset, true);
  });

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
