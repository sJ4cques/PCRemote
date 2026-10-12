# Builds — IsisAnubis

Instrucción única para generar y verificar las builds del host y del cliente.
**El paso de VERIFICAR es obligatorio antes de entregar el host: evita la
regresión del mouse clavado.**

## Prerrequisitos

- Node 22+ y pnpm en la raíz del monorepo.
- `pnpm install` en la raíz (usa `pnpm-lock.yaml` — commitealo junto con los
  cambios de deps, no es opcional).

## Host (`packages/host-app`)

### 1. Subir versión

Antes de buildear, subí la versión en `packages/host-app/package.json`
(ej. `0.1.2`). El nombre del zip y del `.exe` usan la versión, y en Windows el
single-instance lock hace imposible distinguir dos builds con el mismo nombre.
No commitees la build sin el bump.

### 2. Compilar

Desde macOS (no hay toolchain de Windows local, forge descarga el Electron de
win32 solo):

```sh
cd packages/host-app
pnpm make --platform=win32 --arch=x64   # → out/make/zip/win32/x64/IsisAnubis Host-win32-x64-<versión>.zip
pnpm make --platform=darwin --arch=x64  # host para macOS (mirror del host)
```

(Squirrel installer solo se puede ejecutar desde Windows; desde macOS se genera
solo el zip portable.)

### 3. VERIFICAR antes de entregar (obligatorio)

El input worker empaquetado debe poder cargar nut-js. Si pnpm cambia el
hoisting del lockfile, el hook `copyNutClosure` de `forge.config.ts` puede dejar
la clausura incompleta y el worker crashea al arrancar:

```
[host] input worker terminó code=1   ← en el isis-host.log
```

Eso se ve como "mouse clavado" aunque el host parezca sano. Síntoma típico:
`Cannot find module 'is-docker'` (o `semver`, u otro dep transitivo de nut-js)
al cargar `@nut-tree-fork/nut-js` desde el asar empaquetado.

Check:

```sh
cd packages/host-app
# 1) la clausura JS de nut-js carga (detecta la regresión MODULE_NOT_FOUND)
npx asar extract "out/IsisAnubis Host-win32-x64/resources/app.asar" /tmp/hostcheck
cd /tmp/hostcheck && node -e "require('@nut-tree-fork/nut-js'); console.log('OK: nut-js carga')"

# 2) los binarios nativos de la plataforma objetivo existen (app.asar.unpacked)
ls "out/IsisAnubis Host-win32-x64/resources/app.asar.unpacked/node_modules/@nut-tree-fork/"
#   debe listar libnut-win32/.../libnut.node
```

El require test se hace con node local: la extracción del asar deja la clausura
copiada y la carga de clipbboardy/nut-js es JS puro hasta el primer uso del
binding nativo.

Si el check 1 falla: `resolvePkgDir`/`dependencyClosure` en `forge.config.ts`
resuelven cada dependencia desde el directorio del paquete que la declara (estilo
Node). No rompas eso volviendo a resolver solo desde el `node_modules` raíz — una
versión hoisted equivocada (ej. `is-wsl@1` frente a la `v2` anidada de
`clipboardy`) deja la clausura sin `is-docker`/`semver`.

### 4. Instalar en la PC Windows

- **Cerrar TODAS las instancias de `IsisAnubis Host.exe`** (Administrador de
  tareas) antes de abrir una build nueva: `requestSingleInstanceLock` hace que
  lanzar la nueva con una vieja abierta solo "enfoque" la vieja.
- Verificar en el panel del host que el `isis-host.log` ya no muestre
  `input worker terminó code=1` y que el worker quede vivo.

## Cliente (`packages/client-app`)

```sh
cd packages/client-app
pnpm make --platform=darwin --arch=x64   # Mac
pnpm make --platform=win32 --arch=x64    # Windows, si hiciera falta
```

El cliente no empaqueta nut-js: no requiere el check del host. Usa el mismo
patrón de versión antes de buildear.

## Recordatorios

- `out/` está en `.gitignore`; los `.vite/` se versionan (el `main` de forge
  apunta a `.vite/build/main.js`).
- Deploys de Firebase: `firebase deploy --only firestore:rules` y
  `packages/functions` (`pnpm --filter functions deploy`) quedan aparte de la
  build.