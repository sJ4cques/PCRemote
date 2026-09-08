import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const require_ = createRequire(__filename);
const ROOT_NODE_MODULES = path.resolve(__dirname, '../../node_modules');

/** Localiza el directorio real de un paquete (pnpm hoisted o .pnpm). */
function resolvePkgDir(name: string): string | null {
  const flat = path.join(ROOT_NODE_MODULES, name);
  if (existsSync(path.join(flat, 'package.json'))) {
    return flat;
  }
  try {
    const entry = require_.resolve(name, { paths: [ROOT_NODE_MODULES] });
    let dir = path.dirname(entry);
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const up = path.dirname(dir);
      if (up === dir) {
        break;
      }
      dir = up;
    }
  } catch {
    // no existe o no se puede resolver; se omite
  }
  return null;
}

/**
 * Recolecta la clausura de dependencias (dependencies/peer/optional) de una
 * lista de paquetes resolviendo desde el node_modules raíz del monorepo.
 */
function dependencyClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  const closure: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const dir = resolvePkgDir(name);
    closure.push(name);
    if (!dir) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    queue.push(
      ...Object.keys({
        ...pkg.dependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
      }),
    );
  }
  return closure;
}

/**
 * pnpm hoisted deja todos los paquetes en el node_modules raíz, por lo que
 * @electron/packager no alcanza a empaquetar las dependencias nativas de nut-js.
 * Este hook copia la clausura completa dentro del app empaquetada (pre-asar).
 */
async function copyNutClosure(buildPath: string): Promise<void> {
  const closure = dependencyClosure(['@nut-tree-fork/nut-js']);
  console.log(`[forge] packageAfterCopy: copiando clausura nut-js (${closure.length} pkgs) a ${buildPath}`);
  for (const name of closure) {
    const src = path.join(ROOT_NODE_MODULES, name);
    if (!existsSync(src)) {
      continue;
    }
    const dest = path.join(buildPath, 'node_modules', name);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await copyNutClosure(buildPath);
    },
  },
  makers: [
    new MakerSquirrel({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;