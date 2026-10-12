import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const ROOT_NODE_MODULES = path.resolve(__dirname, '../../node_modules');

/**
 * Localiza el directorio real de un paquete tal como lo resolvería Node en
 * runtime: primero sube desde el directorio del consumidor (manejando los
 * node_modules anidados de pnpm/npm para versiones en conflicto) y solo como
 * fallback mira el node_modules raíz del monorepo.
 */
function resolvePkgDir(name: string, fromDir: string | null): string | null {
  if (fromDir) {
    let dir = fromDir;
    for (let depth = 0; depth < 16 && dir; depth += 1) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
      const up = path.dirname(dir);
      if (up === dir) {
        break;
      }
      dir = up;
    }
  }
  const flat = path.join(ROOT_NODE_MODULES, name);
  if (existsSync(path.join(flat, 'package.json'))) {
    return flat;
  }
  return null;
}

interface ClosureEntry {
  name: string;
  dir: string | null;
}

/**
 * Recolecta la clausura de dependencias (dependencies/peer/optional) de una
 * lista de paquetes resolviendo CADA dependencia desde el directorio del
 * paquete que la declara. Resolver siempre desde el node_modules raíz es
 * incorrecto con layouts hoisted: el raíz puede tener otra versión del mismo
 * paquete (p.ej. is-wsl v1 hoisted frente a la v2 anidada que clipboardy
 * requiere) y sus dependencias nunca entran a la clausura -> MODULE_NOT_FOUND
 * (code=1) al cargar nut-js en el worker empaquetado.
 */
function dependencyClosure(entries: string[]): ClosureEntry[] {
  const seen = new Set<string>();
  const queue: Array<{ name: string; fromDir: string | null }> = entries.map(
    (name) => ({ name, fromDir: null }),
  );
  const closure: ClosureEntry[] = [];
  while (queue.length > 0) {
    const { name, fromDir } = queue.shift() as {
      name: string;
      fromDir: string | null;
    };
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const dir = resolvePkgDir(name, fromDir);
    closure.push({ name, dir });
    if (!dir) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const deps = Object.keys({
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    });
    for (const dep of deps) {
      queue.push({ name: dep, fromDir: dir });
    }
  }
  return closure;
}

/**
 * pnpm hoisted deja todos los paquetes en el node_modules raíz, por lo que
 * @electron/packager no alcanza a empaquetar las dependencias nativas de nut-js.
 * Este hook copia la clausura completa dentro del app empaquetada (pre-asar).
 */
async function copyNutClosure(buildPath: string): Promise<void> {
  // nice-try es dependencia transitiva de nut-js (clipboardy -> execa ->
  // cross-spawn v6). Su hoisting depende de la versión de cross-spawn que
  // pnpm resuelva (v7 ya no la declara), por eso la semillamos explícitamente
  // como dependencia directa de la clausura: el worker la requiere desde
  // app.asar y su ausencia provoca MODULE_NOT_FOUND (code=1) al cargar nut-js.
  const closure = dependencyClosure(['@nut-tree-fork/nut-js', 'nice-try']);
  console.log(`[forge] packageAfterCopy: copiando clausura nut-js (${closure.length} pkgs) a ${buildPath}`);
  for (const { name, dir } of closure) {
    if (!dir || !existsSync(dir)) {
      continue;
    }
    const dest = path.join(buildPath, 'node_modules', name);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(dir, dest, { recursive: true, dereference: true });
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: path.join(__dirname, 'assets', 'icon'),
    // El icono del tray vive fuera del asar (resources/tray.png): Electron no
    // garantiza leer imágenes desde dentro del asar para el Tray.
    extraResource: [
      path.join(__dirname, 'assets/tray.png'),
    ],
    // Los binarios .node de @nut-tree-fork/libnut-* ya vienen precompilados por
    // plataforma y son compatibles con el ABI de este Electron (verificado en
    // darwin). Evitamos que @electron/rebuild intente recompilarlos para win32
    // desde macOS (no hay toolchain de Windows) y conservamos los prebuilt.
    rebuild: false,
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await copyNutClosure(buildPath);
    },
  },
  makers: [
    // Squirrel solo se puede ejecutar desde Windows (en otros sistemas necesita
    // Wine), así que al compilar desde macOS generamos únicamente la portable.
    ...(process.platform === 'win32' ? [new MakerSquirrel({})] : []),
    new MakerZIP(),
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
        {
          entry: 'src/input-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
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
