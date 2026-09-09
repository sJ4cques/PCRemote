import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../../..');

const SVG = '/Users/jyang/Downloads/Isis_Anubis.svg';
const CANVAS = 1024;
const PAD = 0.12;

const APP_DIRS = ['host-app', 'client-app'];

function pngBytes(size: number, bg: { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
  return sharp(SVG)
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      background: bg,
    })
    .png()
    .toBuffer();
}

/** Contenedor ICO con entradas PNG (Windows Vista+; rcedit lo acepta). */
function buildIco(sizes: number[], pngs: Map<number, Buffer>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = Buffer.alloc(16 * sizes.length);
  const blobs: Buffer[] = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const png = pngs.get(s)!;
    const e = i * 16;
    entries.writeUInt8(s >= 256 ? 0 : s, e);
    entries.writeUInt8(s >= 256 ? 0 : s, e + 1);
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
    blobs.push(png);
  });

  return Buffer.concat([header, entries, ...blobs]);
}

async function main(): Promise<void> {
  for (const app of APP_DIRS) {
    const assets = path.join(ROOT, 'packages', app, 'assets');
    mkdirSync(assets, { recursive: true });

    const svg = readFileSync(SVG);
    void svg;
    const bg = { r: 0, g: 0, b: 0, alpha: 0 };

    // Maestro 1024x1024 (arte vertical centrado; lado menor = canvas*(1-PAD))
    const padPx = CANVAS * PAD;
    const master = await sharp(svg)
      .resize({ width: CANVAS, height: CANVAS, fit: 'contain', background: bg })
      .png()
      .toBuffer();
    const masterPath = path.join(assets, 'icon-master.png');
    writeFileSync(masterPath, master);
    console.log(`[icons] ${app}: maestro ${masterPath} (${master.length} bytes)`);

    // .icns para macOS
    const iconset = path.join(assets, 'icon.iconset');
    rmSync(iconset, { recursive: true, force: true });
    mkdirSync(iconset, { recursive: true });
    const icnsSizes: Array<[string, number]> = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ];
    for (const [name, size] of icnsSizes) {
      writeFileSync(path.join(iconset, name), await pngBytes(size, bg));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
    rmSync(iconset, { recursive: true, force: true });
    console.log(`[icons] ${app}: .icns generado (${readFileSync(path.join(assets, 'icon.icns')).length} bytes)`);

    // .ico para Windows
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = new Map<number, Buffer>();
    for (const s of icoSizes) {
      pngs.set(s, await pngBytes(s, bg));
    }
    const ico = buildIco(icoSizes, pngs);
    const icoPath = path.join(assets, 'icon.ico');
    writeFileSync(icoPath, ico);
    console.log(`[icons] ${app}: .ico generado (${ico.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});