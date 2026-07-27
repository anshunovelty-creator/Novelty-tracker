// src/lib/export/zip.ts
// ============================================================
// Minimal ZIP writer — enough of the spec to bundle a handful of CSVs
// into one download, using only Node's built-in zlib.
//
// Deliberately not a general archiver: single disk, no ZIP64, no
// directory entries. The export is three text files, and adding a
// packaging dependency for that is not worth the install weight.
// ============================================================

import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name:    string;
  content: string | Buffer;
}

// ── CRC-32 (IEEE) ─────────────────────────────────────────────
// Every ZIP entry carries one; zlib does not expose a stable helper
// across the Node versions this deploys on, so compute it here.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// ── DOS date/time ─────────────────────────────────────────────
// ZIP stores modification time in the 1980-epoch MS-DOS packed format.
// Rendered in IST so the archive's timestamps match the plant's clock.

function dosDateTime(at: Date): { time: number; date: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(at);

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);

  // Hour comes back as 24 for midnight in some ICU builds.
  const hour = get('hour') % 24;

  return {
    time: (hour << 11) | (get('minute') << 5) | (get('second') >> 1),
    date: ((get('year') - 1980) << 9) | (get('month') << 5) | get('day'),
  };
}

// ── Archive assembly ──────────────────────────────────────────

const LOCAL_HEADER_SIG   = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CD_SIG      = 0x06054b50;

const VERSION   = 20;      // 2.0 — the deflate baseline
const DEFLATED  = 8;
const UTF8_FLAG = 0x0800;  // bit 11: file name is UTF-8

/** Build a ZIP archive containing `entries`, in the order given. */
export function createZip(entries: ZipEntry[], modifiedAt: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(modifiedAt);

  const body:       Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;   // running position of the next local header

  for (const entry of entries) {
    const name       = Buffer.from(entry.name, 'utf8');
    const raw        = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(raw);
    const crc        = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER_SIG,   0);
    local.writeUInt16LE(VERSION,            4);
    local.writeUInt16LE(UTF8_FLAG,          6);
    local.writeUInt16LE(DEFLATED,           8);
    local.writeUInt16LE(time,              10);
    local.writeUInt16LE(date,              12);
    local.writeUInt32LE(crc,               14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length,        22);
    local.writeUInt16LE(name.length,       26);
    local.writeUInt16LE(0,                 28);  // no extra field
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER_SIG,  0);
    central.writeUInt16LE(VERSION,             4);  // version made by
    central.writeUInt16LE(VERSION,             6);  // version needed
    central.writeUInt16LE(UTF8_FLAG,           8);
    central.writeUInt16LE(DEFLATED,           10);
    central.writeUInt16LE(time,               12);
    central.writeUInt16LE(date,               14);
    central.writeUInt32LE(crc,                16);
    central.writeUInt32LE(compressed.length,  20);
    central.writeUInt32LE(raw.length,         24);
    central.writeUInt16LE(name.length,        28);
    central.writeUInt16LE(0,                  30);  // extra field length
    central.writeUInt16LE(0,                  32);  // comment length
    central.writeUInt16LE(0,                  34);  // disk number start
    central.writeUInt16LE(0,                  36);  // internal attributes
    central.writeUInt32LE(0,                  38);  // external attributes
    central.writeUInt32LE(offset,             42);
    name.copy(central, 46);

    body.push(local, compressed);
    centralDir.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centralDir);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CD_SIG,      0);
  end.writeUInt16LE(0,                  4);  // this disk number
  end.writeUInt16LE(0,                  6);  // disk with central directory
  end.writeUInt16LE(entries.length,     8);  // entries on this disk
  end.writeUInt16LE(entries.length,    10);  // entries total
  end.writeUInt32LE(directory.length,  12);
  end.writeUInt32LE(offset,            16);  // central directory offset
  end.writeUInt16LE(0,                 20);  // archive comment length

  return Buffer.concat([...body, directory, end]);
}
