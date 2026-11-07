# 4. Resultados y análisis

## 4.1 Producto construido y arquitectura general

El resultado principal es un sistema funcional compuesto por dos aplicaciones de escritorio, un paquete compartido, una Cloud Function, scripts de administración y una aplicación Android. La Figura 4.1 muestra la arquitectura general.

**Figura 4.1.** Arquitectura general de IsisAnubis.

![Arquitectura general](docs/figuras/fig01_arquitectura.png)

_Fuente: elaboración propia a partir del código de ambos repositorios._

La arquitectura separa tres planos:

1. **Plano de control:** Firestore transporta documentos de sesión, presencia, comandos y cámara. El host y el cliente usan el SDK web de Firebase con la API key pública; la tablet usa el SDK REST con una cuenta de servicio.
2. **Plano de medios:** WebRTC conecta host y cliente (video/audio y DataChannel) y cliente y tablet (cámara). El medio no pasa por Firestore.
3. **Plano local:** el host captura, inyecta entrada y publica presencia; el cliente muestra, controla y mide; la tablet escucha comandos y envía WoL.

El host está diseñado para Windows y el cliente para macOS. La asimetría es deliberada: Windows ofrece loopback de audio y UIPI, macOS ofrece una experiencia de cliente y el modo de tapa cerrada. El paquete `shared` es agnóstico y contiene el protocolo.

## 4.2 Métricas de código y estructura de los repositorios

**Tabla 4.1.** Métricas de código por módulo.

| Módulo | Lenguaje | Archivos principales | Líneas | Rol |
| --- | --- | --- | --- | --- |
| `packages/shared` | TypeScript | `signaling.ts`, `config.ts`, `pairing.ts`, `presence.ts`, `control.ts`, `tablet.ts` | 2.202 | Protocolo, tipos, configuración |
| `packages/host-app` | TypeScript/TSX | `main.ts`, `App.tsx`, `presence.ts`, `input.ts`, `input-worker.ts` | 3.477 | Host Windows |
| `packages/client-app` | TypeScript/TSX | `App.tsx`, `main.ts`, `CameraWindow.tsx` | 3.112 | Cliente macOS |
| `packages/functions` | TypeScript | `index.ts` | 153 | Rate limit y relé de probe |
| `packages/scripts` | TypeScript | `admin.ts`, `listSessions.ts`, `resetSessions.ts`, `cleanSessions.ts` | 238 | Administración |
| **Total escritorio** | | | **9.182** | |
| Android Kotlin | Kotlin | 14 archivos | 3.558 | UI, servicio, cámara, presencia |
| Android Python | Python | 8 archivos | 2.165 | Firestore REST, JWT, polling, WoL |
| **Total Android** | | | **5.723** | |
| **Total general** | | | **14.905** | |

**Figura 4.2.** Volumen de código por módulo.

![Volumen de código por módulo](docs/figuras/fig05_modulos.png)

_Fuente: conteo propio con `wc -l` sobre los repositorios. No incluye tests, configuraciones ni artefactos generados._

Los datos de la Tabla 4.1 y la Figura 4.2 muestran que el esfuerzo se concentra en el host y el cliente (6.589 líneas, 44 % del total), seguido por Android (5.723 líneas, 38 %) y el paquete compartido (2.202 líneas, 15 %). La Cloud Function es pequeña (153 líneas) porque su responsabilidad es acotada: rate limit y despacho. Los scripts de administración son herramientas de operación, no parte del producto.

El historial de commits es corto pero significativo:

- **Escritorio:** 18 commits, del 8 de septiembre al 19 de octubre de 2026. Los mensajes muestran una progresión desde "Fase 0" y "Fase 5 Complete, First Demo" hasta correcciones específicas de mouse, modo bocina, worker y cámara.
- **Android:** 4 commits, del 5 de septiembre al 18 de octubre de 2026: "First Commit", "Beta Funcional", "Check point before cam feature" y "Cam feature functional".

La brevedad del historial no refleja la complejidad: muchos cambios se agruparon en commits grandes. Para un análisis de evolución más fino sería recomendable un historial con commits atómicos y mensajes convencionales.

## 4.3 Flujo de sesión manual y emparejada

La Figura 4.3 resume el intercambio de señalización y las dos variantes de acceso: código manual y emparejamiento persistente.

**Figura 4.3.** Secuencia de una sesión y variante de emparejamiento.

![Secuencia de sesión](docs/figuras/fig02_sesion.png)

_Fuente: elaboración propia a partir de `packages/shared/src/signaling.ts`._

### 4.3.1 Sesión manual por código

El host genera un código de 6 caracteres con `crypto.getRandomValues` y el alfabeto `abcdefghjkmnpqrstuvwxyz23456789` (31 símbolos). Publica `sessions/{code}` con:

- `status: waiting`
- `machineCode`, `deviceName`
- `pinProtected`, `pinHash` (si hay PIN)
- `createdAt`, `updatedAt`, `expiresAt` (10 minutos)

El cliente lee el documento, valida que exista, que no esté `active`, que el PIN coincida (si aplica) y que el token de emparejamiento corresponda (si la sesión es persistente). Luego crea la oferta WebRTC, agrega transceivers `recvonly` de video y audio, publica la oferta y sus candidatos. El host observa el documento, aplica la descripción remota, captura pantalla/audio, agrega los tracks y publica la respuesta. Los candidatos se intercambian con encolado `trickle` para los que llegan antes de la descripción remota. Cuando el canal de datos abre, ambos envían `hello`, activan el keepalive y la sesión pasa a `active`.

Los errores se comunican con códigos estables: `code_not_found`, `session_busy`, `pin_required`, `pin_wrong`, `pair_required`, `pair_token_missing`, `pair_token_invalid`, `timeout`, `lookup_failed`. La UI del cliente los traduce a mensajes en español.

### 4.3.2 Emparejamiento persistente

El host genera un `hostId` de 8 caracteres y un `secret` de 8 caracteres. Guarda el secreto en `userData/isis-host.json` y publica solo `tokenHash = SHA-256(secret)` en `sessions/{hostId}`. El cliente guarda `id`, `name`, `secret`, `createdAt` y `lastConnectedAt` en `userData/isis-pairs.json`. Al conectar, envía `token = SHA-256(secret)` junto con la oferta. El host compara el token con su hash y rechaza si falta o no coincide.

La sesión emparejada no tiene TTL: al terminar, el host vuelve a `waiting` para el próximo cliente. El `hostId` es estable hasta que el usuario regenera el emparejamiento; en ese caso, los clientes viejos dejan de conectar porque su token ya no coincide.

### 4.3.3 Sesión "solo bocina"

El cliente ofrece sin sección `m=video`; el host detecta la ausencia de video y captura solo audio loopback. Esto evita abrir una segunda captura de pantalla, que en Windows degradaba el input. En macOS, el cliente activa el modo de tapa cerrada: `pmset disablesleep 1`, `displaysleepnow` y un watcher de `ioreg` para detectar el cierre y restaurar la configuración al salir.

## 4.4 Presencia, probe y cadena de energía

La Figura 4.4 relaciona el latido pasivo, el probe bajo demanda y la cadena de energía que despierta al host.

**Figura 4.4.** Presencia pasiva, probe bajo demanda y cadena de energía.

![Presencia, probe y energía](docs/figuras/fig03_presencia.png)

_Fuente: elaboración propia a partir de `presence.ts`, `functions/src/index.ts`, `polling_loop.py` y `config.ts`._

### 4.4.1 Heartbeat

El host publica `presence/{hostId}` cada 5 minutos (`PRESENCE_HEARTBEAT_MS = 300.000 ms`) y en eventos de `powerMonitor`: boot, suspend, resume, lock, unlock y shutdown. El documento incluye `state`, `bootId`, `deviceName`, `appVersion`, `lastEventAt`, `lastHeartbeatAt`, `lastLocalIp`, `captureOk` e `idle`.

La IP se obtiene de `os.networkInterfaces()` y se filtran adaptadores virtuales (VMware, Docker, WSL, Hyper-V, TUN/TAP). Se republica en cada latido, de modo que un DHCP renovado se refleja en ≤5 minutos. La app Android y el cliente leen el documento sin escribir. Si `lastHeartbeatAt` tiene más de 10 minutos, la UI muestra "sin señal" aunque el último `state` diga `online`.

### 4.4.2 Probe

El teléfono o la tablet escribe `presence/{hostId}/probe/pending` con un `requestId` nuevo. La Cloud Function `onProbeWritten`:

1. Detecta un `requestId` distinto del anterior (para no reaccionar a su propio sello).
2. Consume el rate limit de 10 probes por minuto sobre `probe/rate`.
3. Si está permitido, marca `state: dispatched` y `dispatchedAt`.
4. Si no, escribe `probe/answer` con `ok: false`, `reason: rate_limited` y campos vacíos.

El host observa `pending`, descarta probes con `dispatchedAt` de más de 30 s, ejecuta un health check (`desktopCapturer` + `powerMonitor`) y escribe `probe/answer` con `requestId`, `state`, `captureOk`, `idle`, `uptime` y `respondedAt`. El teléfono lee `answer` cada 2 s y declara timeout a los 25 s.

### 4.4.3 Wake-on-LAN y apagado

El cliente escribe `pc_commands/{hostId}` con `powerOn=true`, `timestamp` fresco, `senderDevice: "client"` y merge para no pisar `pcOnline/pcCheckedAt`. La tablet, en modo escucha, lee el documento cada 30 s (mínimo 10 s), detecta un `timestamp` nuevo y envía el magic packet a la MAC y broadcast configurados. El cliente vuelve a chequear presencia a los ~8 s y ~45 s.

El host escucha `pc_commands/{hostId}` para `powerOn=false`. Si el `timestamp` está dentro de la ventana de 30 s (`POWER_OFF_ACCEPT_WINDOW_MS`) y no fue visto antes, publica `offline` y ejecuta `shutdown.exe /s /t 10` en Windows (o `osascript` en macOS, `shutdown -h now` en Linux). La ventana evita apagar la PC por un comando viejo que quedó en el documento.

## 4.5 Aplicación Android: modos, cámara y servicios

La app Android tiene tres actividades principales:

- **`MainActivity`:** selección de modo (teléfono/tablet) y acceso a ajustes.
- **`PhoneActivity`:** presencia, probe, encendido/apagado y configuración.
- **`TabletActivity`:** presencia, cámara, estado del servicio y controles de tablet.
- **`SettingsActivity`:** MAC, broadcast, puerto WoL, intervalo de poll, IP de la PC, puertos de chequeo y emparejamiento con host.

El **modo teléfono** usa `HostPresence` para leer `presence/{hostId}` y `solicitar_probe` para un chequeo activo. El **modo tablet** agrega `PcListenService`, un servicio en primer plano de tipo `specialUse` que mantiene la escucha de `pc_commands` y el polling de WoL. Se eligió `specialUse` porque `dataSync` tiene un límite de ~6 horas diarias en Android 15+, incompatible con una tablet desatendida. El servicio publica una notificación persistente y se reinicia si el loop Python deja de correr.

La **cámara** se streaming por un WebRTC separado:

1. El cliente escribe `tablet_commands/{hostId}` con `cameraStream=true`, `mode`, `timestamp`, `requestId` y `token`.
2. La tablet lee el comando, verifica frescura (≤60 s) y token (`sha256(secret)`), y pide permiso de cámara si hace falta.
3. La tablet crea/limpia `tablet_stream/{hostId}`, publica `requestId`, `tokenHash`, `deviceName`, `mode` y `status: waiting`.
4. El cliente espera a ver su `requestId` en el documento de stream y negocia como oferente `recvonly` de video.
5. La tablet responde con su cámara, publica candidatos y el cliente recibe el stream en una ventana separada.

El puente Python/Chaquopy implementa el cliente REST de Firestore: firma un JWT RS256 con la cuenta de servicio, obtiene un token OAuth2 con scope `https://www.googleapis.com/auth/datastore` y llama a la API REST. Esto evita agregar el SDK de Firebase a Python, pero introduce el riesgo crítico de la clave embebida (capítulo 6).

## 4.6 Métricas de diseño y presupuestos de tiempo

**Tabla 4.2.** Constantes y presupuestos de tiempo.

| Parámetro | Valor | Fuente | Propósito |
| --- | --- | --- | --- |
| `PRESENCE_HEARTBEAT_MS` | 300.000 ms (5 min) | `config.ts` | Latido del host |
| `PRESENCE_STALE_AFTER_MS` | 600.000 ms (10 min) | `config.ts` | Umbral de "sin señal" |
| `PRESENCE_PASSIVE_POLL_MS` | 30.000 ms | `config.ts` | Poll pasivo de Android |
| `PROBE_RATE_LIMIT_MAX` | 10 | `config.ts` | Probes por ventana |
| `PROBE_RATE_LIMIT_WINDOW_MS` | 60.000 ms | `config.ts` | Ventana de rate limit |
| `PROBE_MAX_AGE_MS` | 30.000 ms | `config.ts` | Descarte de probe viejo |
| `PROBE_TIMEOUT_MS` | 25.000 ms | `config.ts` | Espera del cliente |
| `POWER_OFF_ACCEPT_WINDOW_MS` | 30.000 ms | `config.ts` | Frescura del apagado |
| `TABLET_CMD_FRESH_MS` | 60.000 ms | `config.ts` | Frescura de cámara |
| `TABLET_PRESENCE_HEARTBEAT_MS` | 60.000 ms | `config.ts` | Latido de tablet |
| `TABLET_PRESENCE_STALE_MS` | 150.000 ms | `config.ts` | "Sin señal" de tablet |
| Poll WoL tablet | 30.000 ms (mín. 10.000) | `SettingsManager.kt` | Lectura de comandos |
| Keepalive cliente | 5.000 ms | `signaling.ts` | Detección de caída |
| Host declara offline | 20.000 ms | `signaling.ts` | Sesión fantasma |
| Cliente declara caída | 15.000 ms | `signaling.ts` | Sin `pong` |
| Gracia ICE perdido | 8.000 ms | `signaling.ts` | Recuperación de red |
| Timeout de negociación | 90.000 ms | `signaling.ts` | Abortar sesión |
| TTL sesión manual | 600.000 ms | `signaling.ts` | Expiración |
| Move de mouse | 25 ms | `client-app/App.tsx` | Throttle |
| Wheel | 80 ms | `client-app/App.tsx` | Acumulación |
| Cola de input | 40 eventos | `input.ts` | Límite |
| Watchdog de input | 3.500 ms | `input.ts` | Reinicio |
| Captura | ≤30 fps | `host-app/main.ts` | Límite |

**Figura 4.5.** Presupuestos de tiempo y umbrales de diseño.

![Presupuestos de tiempo](docs/figuras/fig06_tiempos.png)

_Fuente: elaboración propia a partir de las constantes de `config.ts`, `signaling.ts`, `input.ts` y `SettingsManager.kt`. Escala logarítmica._

La lectura de la Figura 4.5 permite ver tres grupos:

- **Entrada (milisegundos):** 25 ms para move, 80 ms para wheel, 3,5 s de watchdog. Son los valores que más afectan la sensación de respuesta.
- **Liveness (segundos):** keepalive 5 s, gracia ICE 8 s, caída cliente 15 s, liberación host 20 s. Definen la rapidez con la que el sistema detecta y recupera una caída.
- **Señalización y presencia (segundos/minutos):** negociación 90 s, TTL 600 s, heartbeat 300 s, stale 600 s, probe 25/30 s. Definen la paciencia del sistema y el costo de escritura.

No se reportan mediciones reales de latencia, fps o bitrate. La figura muestra **presupuestos**, no resultados observados. La distinción es importante: un presupuesto de 25 ms no garantiza que el input llegue en 25 ms; solo indica el throttle del cliente. La medición real requiere el protocolo del Anexo F.

## 4.7 Verificación estática, compilación y cobertura de requisitos

### 4.7.1 Verificación estática

Se ejecutó `pnpm typecheck` en la raíz del monorepo. El comando recorre los cinco paquetes de escritorio (`shared`, `functions`, `host-app`, `client-app`, `scripts`) con `tsc --noEmit`.

**Tabla 4.3.** Verificación estática y compilación.

| Verificación | Comando | Resultado | Fecha |
| --- | --- | --- | --- |
| Typecheck escritorio | `pnpm typecheck` | **Satisfactorio** en los 5 paquetes | 2026-11-07 |
| Compilación Android | `./gradlew :app:compileDebugKotlin --offline` | **BUILD SUCCESSFUL**; tareas `UP-TO-DATE` | 2026-11-07 |
| Conteo de código | `wc -l` sobre `.ts/.tsx/.kt/.py` | 14.905 líneas | 2026-11-07 |
| Historial | `git log` en ambos repositorios | 18 + 4 commits | 2026-11-07 |

La compilación Android se ejecutó en modo `--offline` y todas las tareas estaban `UP-TO-DATE`, lo que confirma que el proyecto compila con el estado actual de Gradle y las dependencias cacheadas. No se ejecutó la app en un dispositivo ni se corrieron tests instrumentados.

### 4.7.2 Cobertura de casos de uso

**Tabla 4.4.** Cobertura de casos de uso.

| CU | Nombre | Evidencia en código | Estado |
| --- | --- | --- | --- |
| CU-01 | Generar sesión manual | `generateSessionCode`, `HostPeer.start` | Implementado |
| CU-02 | Conectar por código | `ClientPeer.startInner`, `answerOffer` | Implementado |
| CU-03 | PIN opcional | `pinHash`, `pinProtected`, UI | Implementado |
| CU-04 | Emparejamiento persistente | `pairing.ts`, `tokenHash`, `token` | Implementado |
| CU-05 | Regenerar emparejamiento | `regeneratePairing`, UI | Implementado |
| CU-06 | Pantalla en vivo | `getDisplayMedia`, `getScreenStream` | Implementado |
| CU-07 | Control remoto | `input.ts`, `input-worker.ts`, DataChannel | Implementado |
| CU-08 | Reiniciar input | `inputPanic`, `inputReset` | Implementado |
| CU-09 | Portapapeles | `clipboard` en DataChannel, poll 700 ms | Implementado |
| CU-10 | Calidad de conexión | `getStats()` cada 2 s | Implementado |
| CU-11 | Reconexión automática | 3 intentos, 1,5 s | Implementado |
| CU-12 | Solo bocina | `audioOnly`, loopback, tapa cerrada | Implementado |
| CU-13 | Modo servicio/autostart | `schtasks`, bandeja, `--isis-service` | Implementado |
| CU-14 | Sesiones fantasma | keepalive, `bye`, 20 s | Implementado |
| CU-14b | Heartbeat de presencia | `presence.ts`, `config.ts` | Implementado |
| CU-14c | Emparejado Android | `SettingsManager`, `validatePair` | Implementado |
| CU-14d | Estado + WoL desde cliente | `presence`, `pc_commands` | Implementado |
| CU-15 | Scripts de administración | `listSessions`, `resetSessions`, `cleanSessions` | Implementado |
| CU-16 | Diagnóstico | flags `--isis-*`, log rotativo | Implementado |

**Resultado:** 19/19 casos de uso tienen evidencia en código. **Ninguno** tiene todavía una prueba formal registrada con fecha, equipo, red y resultado. La diferencia entre "implementado" y "verificado" se desarrolla en la sección 4.10 y en el Anexo F.

### 4.7.3 Matriz de pruebas planificadas

**Tabla 4.5.** Matriz de pruebas funcionales planificadas.

| ID | Prueba | Precondición | Resultado esperado | Estado |
| --- | --- | --- | --- | --- |
| T-01 | Sesión por código sin PIN | Host y cliente en red | Video en <10 s; control | Pendiente |
| T-02 | Sesión por código con PIN correcto | PIN definido | Conexión exitosa | Pendiente |
| T-03 | PIN incorrecto | PIN definido | Error `pin_wrong`; no conecta | Pendiente |
| T-04 | Código inexistente | Cliente sin sesión | Error `code_not_found` | Pendiente |
| T-05 | Sesión ocupada | Host con cliente activo | Error `session_busy` | Pendiente |
| T-06 | Emparejamiento | Par guardado | Conexión sin código | Pendiente |
| T-07 | Token inválido | Par alterado | Error `pair_token_invalid` | Pendiente |
| T-08 | Regenerar par | Par activo | Cliente viejo no conecta | Pendiente |
| T-09 | Input en menú elevado | Menú de bandeja abierto | Helper inyecta; no se congela | Pendiente |
| T-10 | Watchdog de input | Operación bloqueada | Reinicio en 3,5 s | Pendiente |
| T-11 | Portapapeles bidireccional | Sesión activa | Texto en <2 s; sin eco | Pendiente |
| T-12 | Reconexión | Corte de red | ≤3 intentos; recupera | Pendiente |
| T-13 | Solo bocina | Host Windows | Audio sin video | Pendiente |
| T-14 | Tapa cerrada | Cliente macOS | Audio continúa; configuración restaurada | Pendiente |
| T-15 | Autostart | Windows con tarea | Host inicia oculto | Pendiente |
| T-16 | Sesión fantasma | Matar cliente | Host libera ≤20 s | Pendiente |
| T-17 | Heartbeat | Host activo | `presence` actualizado ≤5 min | Pendiente |
| T-18 | Probe | Teléfono | Respuesta ≤25 s | Pendiente |
| T-19 | Rate limit | 11 probes/min | El 11.º devuelve `rate_limited` | Pendiente |
| T-20 | WoL | PC apagada, tablet | Enciende ≤2 min | Pendiente |
| T-21 | Apagado remoto | PC encendida | Shutdown ≤30 s | Pendiente |
| T-22 | Cámara tablet | Tablet con permiso | Stream en ventana | Pendiente |
| T-23 | Cámara sin permiso | Permiso denegado | UI muestra error; no crashea | Pendiente |
| T-24 | Build host | `pnpm make` | Zip generado; nut-js carga | Pendiente |
| T-25 | Build cliente | `pnpm make` | Zip generado | Pendiente |

## 4.8 Análisis frente a los objetivos

**Tabla 4.6.** Correspondencia entre objetivos y evidencia.

| Objetivo | Evidencia | Grado de logro | Comentario |
| --- | --- | --- | --- |
| OE-1 Sesión manual | `signaling.ts`, UI | **Logrado en código** | Falta prueba formal |
| OE-2 Emparejamiento | `pairing.ts`, JSON locales | **Logrado en código** | Token estático; ver §6.4 |
| OE-3 Pantalla/audio | `getDisplayMedia`, loopback | **Logrado en código** | Calidad no medida |
| OE-4 Input | worker, cola, watchdog, helper | **Logrado en código** | Depende de UIPI/permisos |
| OE-5 Portapapeles | DataChannel + poll | **Logrado en código** | Sin E2EE |
| OE-6 Modo servicio | `schtasks`, bandeja | **Logrado en código** | Requiere Windows empaquetado |
| OE-7 Presencia/probe | `presence.ts`, Function | **Logrado en código** | Rate limit no es barrera |
| OE-8 IP LAN | `lastLocalIp` | **Logrado en código** | Expone IP en Firestore |
| OE-9 Emparejado Android | `SettingsManager` | **Parcial** | Guarda secreto, pero `validatePair` no autentica |
| OE-10 WoL/apagado | `pc_commands` | **Logrado en código** | Apagado sin autenticación |
| OE-11 Cámara tablet | `WebRtcCameraClient` | **Logrado en código** | Token reutilizable; stream abierto |
| OE-12 Documentación de seguridad | Capítulo 6 | **Logrado** | Este documento |

La lectura global es que **el producto existe y es coherente**, pero la evidencia es principalmente estática. Los objetivos funcionales se cumplen a nivel de implementación; los objetivos de calidad (latencia, estabilidad, usabilidad) no se pueden afirmar sin mediciones. El objetivo OE-9 es parcial porque el emparejamiento Android se usa como **puntero de documento**, no como autenticación: `validatePair` lee `presence/{hostId}` y muestra el nombre del equipo, pero no verifica el secreto contra Firestore. Esto es coherente con las reglas abiertas, pero no constituye una prueba de identidad.

## 4.9 Análisis de seguridad: resumen ejecutivo

**Tabla 4.7.** Resumen de hallazgos de seguridad.

| Hallazgo | Severidad | Consecuencia | Referencia |
| --- | --- | --- | --- |
| Cuenta de servicio completa embebida en el APK | **Crítica** | Acceso total a Firestore; abuso de cuotas; exfiltración | §6.11 |
| Reglas de Firestore abiertas en colecciones núcleo | **Crítica** | Lectura/escritura no autorizada; enumeración; DoS | §6.6 |
| Token de emparejamiento estático y reutilizable | **Alta** | Suplantación si se lee una oferta; replay | §6.4 |
| Secreto de 8 caracteres con SHA-256 simple | **Alta** | Fuerza bruta offline si se expone `tokenHash` | §6.4 |
| Apagado remoto sin autenticación | **Alta** | Cualquiera con `hostId` apaga la PC | §6.13 |
| Cámara de tablet activable con token reutilizable | **Alta** | Privacidad; stream no autorizado | §6.14 |
| Secretos locales en JSON/SharedPreferences sin cifrado | **Media** | Robo por malware o backup | §6.8 |
| Helper elevado con autenticación por secreto estático | **Media** | Escalada local si se compromete la sesión | §6.10 |
| Señalización sin integridad ni autenticación | **Alta** | MITM/tampering si Firestore se compromete | §6.7 |
| Sin TURN | **Media (disponibilidad)** | Falla en NAT simétrico | §6.7 |

El detalle, la evidencia y las mitigaciones están en el capítulo 6. La conclusión ejecutiva es clara: **el sistema no debe exponerse a Internet ni distribuirse fuera del entorno personal hasta resolver los riesgos críticos y altos.**

## 4.10 Limitaciones de la evidencia y plan de validación

**Tabla 4.8.** Limitaciones de la evidencia.

| Limitación | Efecto | Mitigación |
| --- | --- | --- |
| No hay benchmark de latencia/fps/bitrate | No se puede afirmar calidad real | Anexo F: protocolo, matriz y análisis |
| No hay estudio de usuarios | No se puede afirmar usabilidad | Anexo E: encuesta y consentimiento |
| No hay pruebas dinámicas registradas | "Implementado" no equivale a "verificado" | Tabla 4.5: 25 pruebas planificadas |
| El historial de commits es agrupado | Difícil reconstruir decisiones | Comentarios de código y este documento |
| El estado de reglas desplegadas es incierto | El archivo puede no coincidir con la consola | Verificar antes de desplegar; §6.6 |
| No hay pentest ni SAST formal | Pueden existir vulnerabilidades no vistas | Plan P1: SAST, dependencias, pentest |
| Android no se probó en dispositivo en esta fase | UI/servicio/cámara no verificados en runtime | Pruebas T-22/T-23 y build debug |
| La clave de servicio está en el repositorio | Riesgo de filtración | Rotar, remover, purgar historial (P0) |

El plan de validación se organiza en tres niveles:

1. **Validación funcional:** ejecutar la matriz T-01 a T-25 en un entorno controlado, con dos equipos y una tablet. Registrar fecha, versión, red, resultado y evidencia.
2. **Validación de rendimiento:** aplicar el Anexo F en tres escenarios de red (LAN, Internet doméstico, hotspot móvil), tres resoluciones (1280×720, 1920×1080, 2560×1440), cinco repeticiones de 10 minutos. Calcular media, mediana, p95, desviación estándar y pérdida.
3. **Validación de seguridad:** revisión de reglas desplegadas, escaneo de secretos, análisis de dependencias, prueba de replay del token, prueba de escritura no autorizada, prueba de apagado no autorizado y revisión de permisos Android. Registrar hallazgos y remediaciones.

La validación de usabilidad se hará con al menos 5 participantes (recomendado 8–12 para saturación cualitativa), usando el cuestionario del Anexo E y una tarea guiada: conectar, ver pantalla, mover el mouse, copiar/pegar, desconectar. Los resultados se reportarán como media/mediana de Likert y análisis temático de las respuestas abiertas.
