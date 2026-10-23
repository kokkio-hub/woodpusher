// Reads a .zst file made of several frames. Node's own zstd decoder stops after the first frame, and
// files made with pzstd (like the Lichess database files) are many frames, each after a skippable frame
// that the decoder reads as an empty file. So this walks the frames (format: RFC 8878) and decodes each
// one with a fresh decoder. The next piece of input is read only when the reader wants more output.
import zlib from 'node:zlib';

const ZSTD_MAGIC = 0xFD2FB528;
const isSkippable = (m) => (m & 0xFFFFFFF0) >>> 0 === 0x184D2A50;
const EMPTY = Buffer.alloc(0);

// source: an async iterable of Buffers (a Readable). Yields the decompressed data, in order.
export async function* zstdFrames(source, options = {}) {
  let hold = EMPTY;                 // input bytes not parsed yet (a header cut in two by a chunk boundary)
  let st = 'magic', left = 0, last = false, checksum = false;
  let dec = null, out = [], pend = [];
  const open = () => { dec = zlib.createZstdDecompress(options); out = []; dec.on('data', (d) => out.push(d)); };
  const settle = (fn) => new Promise((res, rej) => {
    const onErr = (e) => rej(e); dec.once('error', onErr);
    fn(() => { dec.off('error', onErr); res(); });
  });
  // The write callback comes once the decoder has used the bytes, after it has emitted their output
  const write = () => { const b = pend.length === 1 ? pend[0] : Buffer.concat(pend); pend = []; return b.length ? settle((done) => dec.write(b, (e) => (e ? null : done()))) : null; };
  const take = () => { const o = out; out = []; return o; };
  try {
    for await (const chunk of source) {
      const b = hold.length ? Buffer.concat([hold, chunk]) : chunk; hold = EMPTY;
      let i = 0;
      for (;;) {
        const avail = b.length - i;
        if (st === 'magic') {
          if (avail < 5) break;
          const m = b.readUInt32LE(i);
          if (isSkippable(m)) { if (avail < 8) break; left = b.readUInt32LE(i + 4); i += 8; st = 'skip'; continue; }
          if (m !== ZSTD_MAGIC) throw new Error('not a zstd file (unknown frame)');
          const fhd = b[i + 4]; const single = (fhd >> 5) & 1;
          const len = 5 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3] + [single ? 1 : 0, 2, 4, 8][fhd >> 6];
          if (avail < len) break;
          checksum = !!((fhd >> 2) & 1); open();
          pend.push(b.subarray(i, i + len)); i += len; st = 'block';
        } else if (st === 'block') {
          if (avail < 3) break;
          const h = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); const type = (h >> 1) & 3;
          if (type === 3) throw new Error('not a zstd file (bad block)');
          last = !!(h & 1); left = type === 1 ? 1 : h >>> 3;
          pend.push(b.subarray(i, i + 3)); i += 3; st = 'data';
        } else if (st === 'data') {
          const n = Math.min(left, avail); if (n) { pend.push(b.subarray(i, i + n)); i += n; left -= n; }
          if (left > 0) break;
          st = !last ? 'block' : checksum ? 'sum' : 'end';
        } else if (st === 'sum') {
          if (avail < 4) break;
          pend.push(b.subarray(i, i + 4)); i += 4; st = 'end';
        } else if (st === 'end') {
          // A whole frame was given to its decoder: let it finish, then the next frame starts fresh
          await write(); yield* take();
          await settle((done) => { dec.once('end', done); dec.end(); }); yield* take();
          dec = null; st = 'magic';
        } else if (st === 'skip') {
          const n = Math.min(left, avail); i += n; left -= n;
          if (left > 0) break;
          st = 'magic';
        }
      }
      if (i < b.length) hold = Buffer.from(b.subarray(i));
      if (dec && pend.length) { await write(); yield* take(); }
    }
    if (st !== 'magic' || hold.length) throw new Error('the file ends in the middle (download cut off?)');
  } finally {
    if (dec) dec.destroy();
  }
}
