/**
 * Batch Asset Streamer for High-Performance Netplay Loading
 * 
 * Multiplexes hundreds of individual game chunk requests (.bin) and HD textures (.dds)
 * into a single binary stream directly from SSD/NVMe.
 */

const fs = require('fs');
const path = require('path');

const ROOT_SEARCH_PATHS = [
  path.resolve(__dirname, '../../port/build/web/disc'),
  path.resolve(__dirname, '../../Tenkaichi3Decomp/gamedata'),
  path.resolve(__dirname, '../../Tenkaichi3Decomp/textures/SLUS-21678/replacements'),
  path.resolve(__dirname, '../../Tenkaichi3Decomp/textures/SLUS-21678'),
  path.resolve(__dirname, '../../port/build/web/textures'),
  path.resolve(__dirname, '../../port/build/web')
];

function resolveAssetPath(relPath) {
  const clean = relPath.replace(/^(\/|\\)+/, '').replace(/\.\./g, '');
  for (const base of ROOT_SEARCH_PATHS) {
    const candidate = path.join(base, clean);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function handleBatchStreaming(req, res, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'paths array required' }));
    return;
  }

  // Cap at 200 files per batch request to prevent memory spikes
  const requested = paths.slice(0, 200);

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*'
  });

  // Header: uint32 total count
  const headerBuf = Buffer.alloc(4);
  headerBuf.writeUInt32LE(requested.length, 0);
  res.write(headerBuf);

  for (const rel of requested) {
    const filePath = resolveAssetPath(rel);
    const pathBytes = Buffer.from(rel, 'utf8');
    const pathLenBuf = Buffer.alloc(2);
    pathLenBuf.writeUInt16LE(pathBytes.length, 0);

    res.write(pathLenBuf);
    res.write(pathBytes);

    if (filePath) {
      try {
        const stat = fs.statSync(filePath);
        const sizeBuf = Buffer.alloc(4);
        sizeBuf.writeUInt32LE(stat.size, 0);
        res.write(sizeBuf);

        // Stream file contents
        const content = fs.readFileSync(filePath);
        res.write(content);
      } catch (err) {
        const notFoundBuf = Buffer.alloc(4);
        notFoundBuf.writeUInt32LE(0xFFFFFFFF, 0); // Not found marker
        res.write(notFoundBuf);
      }
    } else {
      const notFoundBuf = Buffer.alloc(4);
      notFoundBuf.writeUInt32LE(0xFFFFFFFF, 0);
      res.write(notFoundBuf);
    }
  }

  res.end();
}

module.exports = { handleBatchStreaming, resolveAssetPath };
