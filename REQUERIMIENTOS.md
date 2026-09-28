# Toma de Requerimientos — IsisAnubis

> Documento de especificación de requerimientos generado a partir del código fuente del proyecto y del
> modelo de "Toma de Requerimientos" de la materia Sistemas de Información.

---

## 1. Información general

| Aspecto | Detalle |
| --- | --- |
| **Nombre del proyecto** | IsisAnubis |
| **Fecha de inicio** | _[Fecha de inicio]_ (placeholder) |
| **Responsable del levantamiento** | _[Nombre del estudiante / analista]_ (placeholder) |
| **Stakeholders principales** | Propietario/administrador del servicio (cliente del sistema), administrador del equipo controlado (host), operador remoto (usuario del cliente), usuario administrador de la plataforma de señalización (Firebase) |

---

## 2. Contexto y objetivos

### 2.1 Descripción del problema (oportunidad)

Acceder y controlar un equipo de escritorio de forma remota suele depender de soluciones comerciales
(Cromo Remote Desktop, TeamViewer, AnyDesk) que requieren cuentas, instalación de agentes con privilegios
elevados y telemetría. Para el caso de uso "host Windows → cliente macOS" no existe una alternativa ligera,
propia y auditable que:

- funcione de forma **desatendida** (el equipo controlado escucha sin intervención del usuario);
- no exija cuentas de usuario de terceros ni infraestructura de servidores propia;
- mantenga una **señalización en la nube** (Firebase Firestore) con un **protocolo cifrado y mínimo**,
  sin exponer secretos en la infraestructura pública.

Por ello se plantea construir **IsisAnubis**, una aplicación de escritorio remoto en la que el equipo
controlado (host, Windows) transmite pantalla, audio y acepta entrada de mouse/teclado, y el equipo que
controla (cliente, macOS) la visualiza y la opera en tiempo real.

### 2.2 Objetivo principal

Desarrollar una aplicación de escritorio remoto de arquitectura host–cliente (tipo Chrome Remote Desktop)
en la que un cliente macOS controle un host Windows transmitiendo en vivo la pantalla y el audio del
escritorio, con inyección de mouse/teclado, portapapeles sincronizado y dos modos de acceso: **sesión
manual por código** (opcionalmente con PIN) y **emparejamiento persistente**.

### 2.3 Objetivos secundarios

- Mantener el secreto de emparejamiento **fuera de la nube**: nunca se publica en Firestore, solo su hash.
- Detectar y liberar automáticamente **sesiones fantasma** (cliente que se desconecta sin avisar).
- Operar en **modo servicio**: ventana oculta, arranque automático con Windows y re-escucha continua.
- Recuperar el control remoto ante input congelado (reinicio del pipeline de entrada sin cortar video).
- Brindar calidad de conexión observable en el cliente (RTT, bitrate, fps).

---

## 3. Beneficios esperados

- Control remoto **sin cuentas de terceros** ni suscripciones; usa la capa gratuita de Firebase.
- Conexión **desatendida** y persistente gracias al emparejamiento y al modo servicio.
- Experiencia tipo CRD: cursor remoto dibujado en el cliente, pantalla completa y métricas de calidad.
- Seguridad por diseño: los secretos viajan **haseados** (SHA-256) y se derivan localmente.
- Recuperación automática ante caídas de red y ante input atascado por menús del sistema.

### 3.1 Actores y usuarios

**Tipos de usuarios identificados**

| Tipo | Descripción |
| --- | --- |
| **Administrador** | Gestiona el equipo controlado (host): nombre del equipo, emparejamiento, autostart, modo servicio, audio de escritorio y desconexión de sesiones. También el administrador de la señalización (Firebase) que opera las herramientas de consola. |
| **Usuario** | Operador remoto que se conecta desde el cliente: guarda equipos, establece sesiones, controla y utiliza el modo "solo bocina". |

**Roles de usuario final**

1. **Operador del host** — ve el estado de la escucha, genera/copia el código o el par ID+secreto, configura
   PIN, autostart, modo servicio y audio de escritorio; puede regenerar el emparejamiento y desconectar al
   cliente actual.
2. **Operador remoto** — desde el cliente, añade/elimina equipos emparejados, conecta por código y PIN,
   controla el mouse/teclado, sincroniza portapapeles, alterna pantalla completa y reinicia el input remoto.
3. **Administrador de señalización** — opera los scripts de consola (`listSessions`, `resetSessions`,
   `cleanSessions`) sobre la colección `sessions` de Firestore usando el Admin SDK.

---

## 4. Requerimientos funcionales

Los casos de uso se identifican con prefijo **CU**, un **ID** asociado (RF-XX), su **autor**, las
**precondiciones**, el **escenario** y las **postcondiciones**.

### CU-01 · Generar sesión manual por código — RF-01

- **Descripción:** el host crea una sesión temporal con un código de 6 caracteres (alfabeto sin caracteres
  ambiguos `i/l/o/0/1`: `abcdefghjkmnpqrstuvwxyz23456789`) y la expone al cliente.
- **Autor:** Sistema (módulo `@isisanubis/shared` → `generateSessionCode`).
- **Precondiciones:** el host está iniciado y con acceso a Firestore; el usuario eligió el modo "Código".
- **Escenario:**
  1. El host genera el código criptográficamente aleatorio y publica el documento `sessions/{code}`
     con estado `waiting`, `machineCode`, `deviceName`, `pinProtected` y `expiresAt`.
  2. Si el usuario definió un PIN, se almacena **solo su hash** (`pinHash`, SHA-256).
  3. El host comienza a observar el documento y los candidatos ICE del cliente y queda a la espera
     (TTL por defecto: 10 minutos; configurable con `--isis-session-ttl`).
- **Postcondiciones:** existe una sesión visible en Firestore en estado `waiting` con vigencia acotada; si
  expira sin clientes, el host la cierra (estado `closed`).

### CU-02 · Conectar por código (sesión manual) — RF-02

- **Descripción:** el cliente busca una sesión por su código y negocia una conexión WebRTC (video+audio).
- **Autor:** Operador remoto.
- **Precondiciones:** existe una sesión `waiting` con el código; el cliente conoce el código.
- **Escenario:**
  1. El cliente lee `sessions/{code}`; si no existe → error `code_not_found`; si está `active` →
     error `session_busy` (una sola sesión a la vez).
  2. El cliente crea su `RTCPeerConnection` (STUN público), agrega transceivers `recvonly` de video/audio y
     publica su **offer** (y sus candidatos ICE en `sessions/{code}/clientCandidates`).
  3. El host aplica la descripción remota, captura pantalla/audio, genera el **answer** y lo publica en la
     sesión (estado `signaling`).
  4. El cliente aplica el answer, intercambia candidatos (con encolado `trickle` para los que llegan antes
     de la descripción remota), y la conexión pasa a estado `active`.
  5. Ambos lados saludan por el canal de datos (`hello`) y activan el keepalive.
- **Postcondiciones:** la sesión queda en `active`; el cliente recibe el stream remoto y el canal de datos
  para control; si la negociación excede 90 s, el cliente aborta (`timeout`).

### CU-03 · Proteger sesión con PIN (opcional) — RF-03

- **Descripción:** el host exige un PIN al cliente antes de permitir la conexión.
- **Autor:** Operador del host.
- **Precondiciones:** el host creó una sesión manual marcando `pinProtected`.
- **Escenario:** en la búsqueda, el cliente valida el PIN contra `pinHash`; si falta → `pin_required`;
  si no coincide → `pin_wrong`. Solo con PIN correcto el cliente procede a negociar.
- **Postcondiciones:** el PIN nunca viaja en claro; solo se compara su hash.

### CU-04 · Emparejamiento persistente (ID + secreto) — RF-04

- **Descripción:** el host publica un par `hostId` (8 caracteres) + `secreto` (8 caracteres) mostrado una
  sola vez; el cliente lo guarda localmente y se conecta sin código.
- **Autor:** Operador del host / Operador remoto.
- **Precondiciones:** el host tiene generada su identidad (`isis-host.json`) y el cliente aún no guardó el par.
- **Escenario:**
  1. El host persiste `hostId` y `secret` **localmente** (`userData/isis-host.json`) y muestra el secreto
     (oculto por omisión) para entrega única; guarda en Firestore solo `tokenHash = sha256(secret)`.
  2. El cliente ingresa nombre, `hostId` y `secreto` en "Añadir equipo" y guarda el par en
     `userData/isis-pairs.json`.
  3. Al conectar, el cliente envía su oferta con `token = sha256(secreto)`.
  4. El host valida el token (si falta → `pair_token_missing`; si no coincide → `pair_token_invalid` y la
     sesión se rechaza).
  5. La sesión persiste **sin TTL** y, al terminar, el host vuelve a `waiting` para el próximo cliente.
- **Postcondiciones:** el secreto en claro vive solo en ambos extremos (nunca en Firestore); la sesión
  re-escucha automáticamente; cambia `lastConnectedAt` del par al conectarse.

### CU-05 · Regenerar emparejamiento — RF-05

- **Descripción:** el operador del host invalida el par actual y genera uno nuevo.
- **Autor:** Operador del host.
- **Precondiciones:** modo emparejado activo; confirmación del usuario.
- **Escenario:** el host pide confirmación, genera nuevo `hostId` y `secret`, los persiste y los muestra;
  los equipos guardados con el ID anterior dejan de conectar (su token deja de coincidir).
- **Postcondiciones:** se requiera volver a emparejar a los clientes existentes.

### CU-06 · Transmisión de pantalla en vivo — RF-06

- **Descripción:** el host publica la pantalla del escritorio (y audio opcional) hacia el cliente.
- **Autor:** Operador del host.
- **Precondiciones:** sesión en negociación o activa; permiso de captura disponible.
- **Escenario:**
  1. Al responder la oferta, el host obtiene la fuente de escritorio vía `getDisplayMedia` (manejador de
     `setDisplayMediaRequestHandler` que elige la pantalla primaria sin picker); fallback legacy por
     `getUserMedia` con `chromeMediaSource`.
  2. Hasta 3 intentos para obtener el video (no se contesta una oferta sin pistas); si falla en modo
     forzado → error `screen_stream_unavailable`.
  3. En modo "solo bocina" (oferta sin sección `m=video`) se captura **solo audio loopback** y no se
     captura pantalla (evita degradación de input en Windows).
  4. El host agrega los tracks al peer antes de crear el `answer`, limitando a ≤30 fps.
  5. El cliente recibe el stream vía `ontrack` y lo reproduce en `<video>`/`<audio>`.
- **Postcondiciones:** el cliente muestra el escritorio remoto; el host informa el modo de captura
  (real/simulada/loopback) y errores en el panel.

### CU-07 · Control remoto (mouse y teclado) — RF-07

- **Descripción:** el cliente envía los movimientos/clics/teclas al host para que se inyecten en el SO.
- **Autor:** Operador remoto.
- **Precondiciones:** canal de datos abierto; sesión `connected`.
- **Escenario:**
  1. El cliente mapea las coordenadas del `<video>` a la **resolución real del host** (mensaje `display`)
     y envía `mouse` (move/down/up/click/dblclick/scroll) con throttling: moves cada 25 ms y acumulación
     del wheel cada 80 ms (evita saturar la cola serializada del host).
  2. El teclado se envía como `type` para texto simple o `down`/`up` con códigos normalizados
     (`KeyA`…, `F1`…F24, flechas, modificadores).
  3. El host inyecta serializadamente en un proceso aislado (`input-worker`) con `nut-js`
     (`autoDelayMs=0`); en Windows un **helper elevado** (`schtasks` con `HighestAvailable`) cruza la
     barrera UIPI para inyectar sobre menús de la bandeja/taskbar.
  4. El host vigila la cola (máx. 40 pendientes), el tiempo de cada operación (>3,5 s → reinicio) y ejecuta
     watchdogs de salud.
  5. Si el cliente pierde el `mouseup` (suelta el botón fuera del video/blur), el host libera los botones
     para evitar "mouse trabado".
- **Postcondiciones:** el escritorio remoto reacciona como si se operara localmente; ante bloqueo del
  pipeline, el host reinicia el worker sin cerrar el video.

### CU-08 · Reiniciar input remoto (recuperación) — RF-08

- **Descripción:** el operador solicita al host liberar botones, despejar la cola y cerrar menús elevados.
- **Autor:** Operador remoto.
- **Precondiciones:** sesión `connected`; cursor remoto congelado tras un menú del sistema.
- **Escenario:** el cliente envía `control { inputReset }`; el host ejecuta `inputPanic`: libera botones,
  limpia la cola y envía `Escape` para cerrar el flyout capturado (best effort si es elevado).
- **Postcondiciones:** el control se recupera sin reconectar.

### CU-09 · Sincronización bidireccional del portapapeles — RF-09

- **Descripción:** copiar texto en un extremo queda disponible en el otro.
- **Autor:** Operador remoto / Operador del host.
- **Precondiciones:** sesión `connected`; canal de datos abierto.
- **Escenario:** cada lado siembra su portapapeles al conectar y un poller (700 ms) detecta cambios y envía
  el texto por el canal (`clipboard`), evitando ecos con la última copia conocida.
- **Postcondiciones:** el texto copiado en el cliente se pega en el host y viceversa; el host aplica la
  escritura vía `clipboard.writeText`.

### CU-10 · Indicador de calidad de conexión — RF-10

- **Descripción:** el cliente muestra RTT, bitrate y fps decodificados de la sesión.
- **Autor:** Operador remoto.
- **Precondiciones:** sesión `connected`.
- **Escenario:** cada 2 s el cliente consulta `peer.getStats()`; extrae `currentRoundTripTime` del
  `candidate-pair` exitoso y bytes/frames del `inbound-rtp` de video; muestra `RTT ms · Mbit/s · fps`.
- **Postcondiciones:** el usuario puede evaluar la calidad objetivamente.

### CU-11 · Reconexión automática — RF-11

- **Descripción:** tras una caída de transporte en una sesión que ya funcionó, el cliente reconecta solo.
- **Autor:** Sistema (cliente).
- **Precondiciones:** hubo al menos un `connected` previo; la caída no fue iniciada por el usuario.
- **Escenario:** al terminar la sesión por error/caída, el cliente reintenta hasta **3 veces** con 1,5 s de
  espera usando los parámetros anteriores; el botón "Reconectar" resetea el contador y "Desconectar" lo
  desactiva (`manualDisconnect`).
- **Postcondiciones:** la sesión se reestablece o se muestra el overlay "Se perdió la conexión".

### CU-12 · Modo "solo bocina" (usar el host como altavoz) — RF-12

- **Descripción:** el cliente se conecta recibiendo únicamente audio del host (sin video ni control).
- **Autor:** Operador remoto.
- **Precondiciones:** host en Windows con loopback de audio disponible.
- **Escenario:** el cliente elige la acción "solo audio" del par; ofrece sin `m=video`; el host captura
  solo audio de escritorio (loopback) y el cliente lo reproduce en un `<audio>` oculto. En macOS el
  cliente activa el modo tapa cerrada (`pmset disablesleep`, apagado de pantalla con `displaysleepnow` y
  watcher de `ioreg`) para mantener el audio con la tapa cerrada, restaurando la config al salir.
- **Postcondiciones:** el audio del equipo remoto suena en el cliente, incluso con tapa cerrada.

### CU-13 · Modo servicio / inicio con Windows / bandeja — RF-13

- **Descripción:** el host puede ocultar la ventana, seguir escuchando, iniciar con Windows y operarse
  desde la bandeja del sistema.
- **Autor:** Operador del host.
- **Precondiciones:** host en Windows; permisos para registrar tareas.
- **Escenario:** el panel permite activar "Modo servicio" (ventana oculta + re-escucha automática con
  reintento a los 1,5–2 s tras error) y "Inicio automático con la PC", que crea dos tareas `schtasks`
  (host con `LeastPrivilege` y helper de input elevado con `HighestAvailable`, vía WScript ocultos). La
  bandeja ofrece Abrir panel, Ocultar, Desconectar sesión y Salir.
- **Postcondiciones:** el host queda disponible sin interacción; los procesos sobreviven entre sesiones y
  la captura sigue en el escritorio normal.

### CU-14 · Gestión de sesiones fantasma y cierre — RF-14

- **Descripción:** el sistema detecta clientes que se fueron sin avisar y libera la sesión.
- **Autor:** Sistema (host y cliente).
- **Precondiciones:** canal de datos abierto.
- **Escenario:** el cliente emite `healthcheck` cada 5 s; si el host no recibe actividad en 20 s, cierra la
  sesión fantasma y notifica `bye`; el cliente si no recibe `pong` en 15 s declara la caída. Al desconectar
  cualquiera de los dos se envía `bye` para liberación inmediata.
- **Postcondiciones:** no quedan sesiones ocupadas fantasma; el cliente muestra la pérdida de conexión.

### CU-15 · Herramientas de administración de la señalización — RF-15

- **Descripción:** scripts de consola para listar, limpiar y reiniciar sesiones en Firestore.
- **Autor:** Administrador de la señalización.
- **Precondiciones:** credenciales del Admin SDK disponibles (`firebase-admin.json` o
  `FIREBASE_ADMIN_CRED_PATH`).
- **Escenario:** el administrador ejecuta `listSessions`, `resetSessions` o `cleanSessions` contra la
  colección `sessions`.
- **Postcondiciones:** el estado de la señalización queda consistente y auditable.

### CU-16 · Diagnóstico y pruebas asistidas — RF-16

- **Descripción:** flags de arranque que permiten probar captura, input, portapapeles y reconexión sin
  dependencias externas.
- **Autor:** Desarrollador / Operador del host.
- **Precondiciones:** app con soporte de argumentos de CLI.
- **Escenario:** el host acepta `--isis-simulate-video`, `--isis-simulate-audio`, `--isis-fake-input`,
  `--isis-capture-test`, `--isis-force-getdisplaymedia`, `--isis-host-id`, `--isis-pair-secret`,
  `--isis-service`, `--isis-manual`; el cliente acepta `--isis-input-test`, `--isis-clipboard-test`,
  `--isis-audio-only`, `--isis-pair=<id,secret>`, `--isis-autostop` y `--isis-code/--isis-pin`.
- **Postcondiciones:** se validan los pipelines (captura, input, clipboard, audio) con o sin hardware real;
  el renderer vuelca su consola a un **log rotativo** (`isis-host.log`, máx. 2 MB).

---

## 5. Requerimientos no funcionales

| Categoría | Requerimiento |
| --- | --- |
| **Seguridad** | El PIN y el secreto de emparejamiento se almacenan y transmiten **haseados** (SHA-256); jamás se publican en Firestore. El `secret` en claro solo persiste localmente en el host y en el cliente. La prueba de identidad del emparejamiento es un token derivado (`sha256(secret)`); las ofertas con token ausente/inválido se rechazan. Las ventanas usan `contextIsolation: true`, `nodeIntegration: false` y preload acotado. La API key de Firebase es pública por diseño (config SDK cliente) y no se incluyen credenciales de Admin SDK en las apps. El helper de input corre **elevado** vía Task Scheduler solo para cruzar UIPI; la captura y la señalización se mantienen con el token normal. El canal de control TCP del helper autentica con el secreto local. |
| **Escalabilidad** | La señalización usa Firestore serverless (colección `sessions` + subcolecciones de candidatos); sin servidores propios. Una sesión admite un único cliente a la vez (`session_busy`); el crecimiento es horizontal y por cuota de Firebase. |
| **Disponibilidad** | La señalización depende de la disponibilidad de Firestore (verificada con `pingFirestore` en fase 0). La conexión de medios es **P2P** (WebRTC + STUN) y sobrevive a fallas transitorias de la señalización una vez negociada. Reconexión automática (3 intentos) y re-escucha automática del host ante errores. |
| **Compatibilidad** | Aplicación **nativa de escritorio multiplataforma asimétrica**: el host solo admite **Windows** (inyección con helper elevado, loopback de audio), el cliente solo **macOS** (modo tapa cerrada); el código compartido (`@isisanubis/shared`) es agnóstico. Electron 44, React 19, Node ≥22, pnpm ≥11 (nodeLinker hoisted). |
| **Rendimiento esperado** | Captura de pantalla ≤30 fps con balance a ≤1920x1080 en modo legacy; throttle de `move` cada 25 ms y acumulación del wheel cada 80 ms; cola de input acotada (40 eventos) y ejecución serializada; keepalive a 5 s con detección de caída en 15–20 s; watchdog de input: reinicio si una operación supera 3,5 s; negociación con timeout de 90 s en el cliente y TTL de 10 min en sesiones manuales; métricas en vivo (RTT, Mbps, fps) cada 2 s. |

---

## 6. Restricciones y supuestos

### 6.1 Restricciones técnicas

- Plataformas fijas: host **solo Windows**, cliente **solo macOS** (no multiplataforma simétrica).
- Stack: Electron + Forge + Vite, React 19, TypeScript, pnpm workspaces, Firebase (Firestore), WebRTC,
  `@nut-tree-fork/nut-js`, entrada por `electron-squirrel-startup` (Squirrel) en Windows.
- Señalización sobre un proyecto Firebase público (`baobaoadmin`) con reglas que permiten a los clientes
  escribir en `sessions` y subcolecciones; sin cuentas de autenticación propias.
- La inyección en Windows requiere registrar tareas `schtasks` y, para autostart, ejecución de
  `Update.exe` de Squirrel; el helper elevado exige autorización de UAC una vez.
- Reducir capturas de escritorio puede requerir permisos del SO (Screen Recording en macOS solo es
  necesario si el host se ejecuta en macOS en modo desarrollo/fallback).

### 6.2 Presupuesto

- Sin presupuesto de licencias: herramientas de código abierto (Electron, React, Vite, nut-js).
- Señalización en la capa gratuita de Firebase (Firestore). La escalabilidad queda sujeta a las cuotas
  gratuitas.

### 6.3 Recursos

- Desarrollo con pnpm ≥11 y Node ≥22; dos máquinas de prueba (Windows para host, macOS para cliente);
  acceso a la consola del proyecto Firebase `baobaoadmin` y al Admin SDK (solo para scripts de
  administración, fuera de las apps distribuidas).

### 6.4 Supuestos iniciales

- Host y cliente se encuentran vía Firestore público sin autenticación de cuentas; la confianza se deriva
  del **código de sesión**, el **PIN** (manual) o el **secreto de emparejamiento** (persistente).
- El host puede exhibirse desatendido y con ventana oculta; el usuario otorga los permisos de captura.
- Una sola sesión simultánea por host y un solo cliente a la vez.
- Internet razonable y WebRTC no bloqueado (STUN público); el streaming P2P falla detrás de NAT
  simétrico sin TURN (fuera de alcance en esta iteración).
- El modo "solo bocina" solo ofrece audio en hosts Windows por el loopback de sistema.

---

## 7. Priorización

| Prioridad | Requerimientos | Justificación |
| --- | --- | --- |
| **Alta** | CU-01, CU-02, CU-04, CU-06, CU-07 (sesión por código, emparejamiento, streaming de pantalla y control) | Núcleo del producto: sin estos no existe el acceso remoto. |
| **Alta** | CU-03, CU-05, CU-14 (PIN, regenerar emparejamiento, sesiones fantasma) | Integridad del modelo de confianza y disponibilidad del host. |
| **Media** | CU-08, CU-09, CU-10, CU-11 (reinicio de input, portapapeles, calidad, reconexión) | Robustez y experiencia de uso; no bloquean la conexión básica. |
| **Media** | CU-12, CU-13 (solo bocina, modo servicio/autostart/bandeja) | Escenarios desatendidos y de audio; habilitan el uso productivo continuo. |
| **Baja** | CU-15, CU-16 (herramientas admin y flags de diagnóstico) | Soportan el desarrollo y la operación, no al usuario final. |

---

## 8. Validación y aceptación

### 8.1 Criterios de aceptación

| Requerimiento | Criterio de aceptación |
| --- | --- |
| CU-01 | Un código de 6 caracteres sin `i/l/o/0/1` se genera y se publica una sesión `waiting` con TTL; expira sola. |
| CU-02 | Cliente se conecta por código y el video aparece en vivo; código inexistente → `code_not_found`; sesión ocupada → `session_busy`. |
| CU-03 | Con PIN, una conexión sin PIN o con PIN incorrecto se rechaza; con PIN correcto avanza. |
| CU-04 | El par ID+secreto conecta de forma persistente sin código; un token inválido es rechazado (`pair_token_invalid`) y la sesión re-escucha al terminar. |
| CU-05 | Refrescar el par invalida los clientes guardados. |
| CU-06 | Se ve la pantalla real del host (real o simulada), con audio según configuración; sin pistas → no se contesta oferta. |
| CU-07 | El mouse/teclado del cliente opera el host con latencia perceptiblemente baja; el botón no queda "pegado". |
| CU-08 | Al presionar "Reiniciar input", el cursor vuelve a responder sin reconectar. |
| CU-09 | Texto copiado en un extremo se pega en el otro en <2 s, sin eco. |
| CU-10 | El panel muestra RTT/Mbps/fps durante la sesión. |
| CU-11 | Un corte de red intenta hasta 3 reconexiones automáticas; "Desconectar" lo detiene. |
| CU-12 | Una sesión "solo audio" reproduce el sonido del host y, en macOS, mantiene el audio con la tapa cerrada y restaura la configuración al salir. |
| CU-13 | Con "inicio con Windows" activado, host + helper se lanzan sin consola; "modo servicio" escucha de forma continua. |
| CU-14 | Un cliente que muere sin avisar libera la sesión en ≤20 s y el estado vuelve a `waiting`/`closed`. |
| CU-15 | `listSessions` muestra el estado real; `resetSessions`/`cleanSessions` dejan la colección consistente. |
| CU-16 | Los flags de prueba validan captura, input, clipboard y audio con y sin hardware real. |

### 8.2 Métodos de validación

- **Pruebas funcionales e2e**: sesiones manuales (con/sin PIN) y emparejadas entre una máquina Windows
  (host) y una macOS (cliente); verificación de video, audio, input, portapapeles y reconexión.
- **Pruebas de flags automatizables**: `--isis-simulate-video`, `--isis-fake-input`, `--isis-input-test`,
  `--isis-clipboard-test`, `--isis-audio-only`, `--isis-capture-test` y `--isis-autostop`.
- **Diagnóstico por logs**: log rotativo `isis-host.log` que vuelca consola del renderer, eventos de
  captura (`getDisplayMedia`/`legacy`), cambio de estado de sesión y salud del pipeline de input.
- **Revisión de seguridad**: verificar que no existan secretos en las apps distribuidas ni en Firestore
  (solo hashes), aislamiento `contextIsolation`, y que el helper elevado se limite a la inyección.
- **Prototipos incrementales**: compilación empaquetada (`electron-forge make`) de host y cliente en sus
  plataformas objetivo para validar instalación, actualizaciones Squirrel y autostart.
- **Revisión del panel**: sesión de revisión con el stakeholder donde se recorre cada caso de uso frente a
  los criterios de aceptación de la sección 8.1.