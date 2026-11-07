# 8. Anexos

Los anexos reúnen el material de soporte que no conviene interrumpir la lectura de los capítulos: trazabilidad, constantes, mapa de archivos, protocolo, instrumentos de validación, checklist operativo, glosario, registro de evidencias y extractos de código. Cuando un anexo depende de una medición que aún no se ejecutó, se indica explícitamente y se describe el procedimiento para producirla.

## Anexo A. Matriz de trazabilidad de casos de uso

La Tabla A.1 relaciona cada caso de uso con su requisito funcional, los módulos que lo implementan, la evidencia concreta y la prueba planificada. La columna “Prueba” remite a la matriz T-01 a T-25 de la Tabla 4.5; “Manual” indica una verificación de operación que no tiene un test automatizable en esta fase. Ninguna fila debe leerse como “verificado”: la evidencia es de código o de configuración, salvo que se indique lo contrario.

**Tabla A.1.** Trazabilidad caso de uso–requisito–módulo–prueba.

| Caso de uso | RF | Módulo(s) | Evidencia | Prueba |
| --- | --- | --- | --- | --- |
| CU-01 · Generar sesión manual | RF-01 | `shared/signaling.ts`, `host-app/App.tsx` | `generateSessionCode`, `HostPeer.start`, `sessions/{code}` con TTL | T-01, T-04 |
| CU-02 · Conectar por código | RF-02 | `shared/signaling.ts`, `client-app/App.tsx` | `ClientPeer.startInner`, `answerOffer`, errores estables | T-01, T-05 |
| CU-03 · PIN opcional | RF-03 | `shared/signaling.ts`, ambas UI | `pinHash`, `pinProtected`, comparación en host | T-02, T-03 |
| CU-04 · Emparejamiento persistente | RF-04 | `shared/pairing.ts`, `shared/signaling.ts` | `generateHostId`, `tokenFor`, `tokenHash`, `pair_token_invalid` | T-06, T-07 |
| CU-05 · Regenerar emparejamiento | RF-05 | `shared/pairing.ts`, `host-app/App.tsx` | `regeneratePairing`, reescritura de `isis-host.json` | T-08 |
| CU-06 · Pantalla en vivo | RF-06 | `host-app/main.ts`, `shared/signaling.ts` | `getDisplayMedia`, `getScreenStream`, tracks | T-01, T-13 |
| CU-07 · Control remoto | RF-07 | `host-app/input.ts`, `input-worker.ts`, `client-app/App.tsx` | DataChannel `mouse`/`key`, cola, throttle | T-09, T-10 |
| CU-08 · Reiniciar input | RF-08 | `host-app/input.ts`, `shared/control.ts` | `inputReset`, `inputPanic`, watchdog | T-10 |
| CU-09 · Portapapeles | RF-09 | `client-app/App.tsx`, `host-app/main.ts` | Poll 700 ms, mensaje `clipboard`, sin eco | T-11 |
| CU-10 · Calidad de conexión | RF-10 | `client-app/App.tsx` | `getStats()` cada 2 s, RTT/fps/bitrate | T-01 |
| CU-11 · Reconexión automática | RF-11 | `client-app/App.tsx`, `shared/signaling.ts` | 3 intentos, 1,5 s, `bye` | T-12 |
| CU-12 · Solo bocina | RF-12 | `shared/signaling.ts`, `host-app/main.ts` | Oferta sin `m=video`, audio loopback, tapa cerrada | T-13, T-14 |
| CU-13 · Modo servicio | RF-13 | `host-app/main.ts`, `forge.config.ts` | `schtasks`, bandeja, `--isis-service` | T-15, T-24 |
| CU-14 · Sesiones fantasma | RF-14 | `shared/signaling.ts` | Keepalive 5 s, `HOST_OFFLINE_REASONS`, 20 s | T-16 |
| CU-14b · Heartbeat de presencia | RF-14b | `host-app/presence.ts`, `shared/config.ts` | `PRESENCE_HEARTBEAT_MS`, `powerMonitor` | T-17 |
| CU-14c · Emparejado Android | RF-14c | `SettingsManager.kt`, `SettingsActivity.kt`, `HostPresence.kt` | `hostId` + secreto, `validatePair` | Manual |
| CU-14d · Estado y WoL desde cliente | RF-14d | `shared/tablet.ts`, `polling_loop.py`, `client-app/App.tsx` | `pc_commands`, magic packet, presencia | T-20 |
| CU-15 · Scripts de administración | RF-15 | `packages/scripts/src` | `listSessions`, `resetSessions`, `cleanSessions` | Manual |
| CU-16 · Diagnóstico | RF-16 | `host-app/main.ts`, flags `--isis-*` | Log rotativo 2 MB, chequeos de captura/input/audio | Manual, T-24, T-25 |

**Lectura de la matriz.** Los 19 casos de uso tienen al menos una implementación identificable. Los que dependen de hardware o de una cuenta externa (CU-13, CU-14c, CU-15, CU-16) no pueden automatizarse por completo con el estado actual del proyecto; por eso se marcan como manuales. La trazabilidad inversa —de un archivo a un caso de uso— se puede reconstruir con la Tabla C.1.

## Anexo B. Constantes y parámetros de configuración

La Tabla B.1 amplía la Tabla 4.2 con los valores que se usan en el análisis de seguridad y en el protocolo. Todos son constantes de código o valores por defecto de configuración; ninguno se midió en ejecución. La columna “Fuente” permite verificarlos en el repositorio.

**Tabla B.1.** Constantes y parámetros.

| Constante o parámetro | Valor | Fuente | Uso |
| --- | --- | --- | --- |
| `CODE_LENGTH` | 6 caracteres | `shared/signaling.ts` | Código de sesión manual |
| `CODE_ALPHABET` | 31 símbolos | `shared/signaling.ts` | Sin `i`, `l`, `o`, `0`, `1` |
| `HOST_ID_LENGTH` | 8 caracteres | `shared/pairing.ts` | Identificador de host |
| `PAIR_SECRET_LENGTH` | 8 caracteres | `shared/pairing.ts` | Secreto de emparejamiento |
| `PAIR_ALPHABET` | 31 símbolos | `shared/pairing.ts` | Mismo alfabeto que el código |
| `PRESENCE_HEARTBEAT_MS` | 300.000 ms | `shared/config.ts` | Latido del host |
| `PRESENCE_STALE_AFTER_MS` | 600.000 ms | `shared/config.ts` | Umbral de “sin señal” |
| `PRESENCE_PASSIVE_POLL_MS` | 30.000 ms | `shared/config.ts` | Poll pasivo de Android |
| `PROBE_RATE_LIMIT_MAX` | 10 | `shared/config.ts` | Probes por ventana |
| `PROBE_RATE_LIMIT_WINDOW_MS` | 60.000 ms | `shared/config.ts` | Ventana del rate limit |
| `PROBE_MAX_AGE_MS` | 30.000 ms | `shared/config.ts` | Descarte de probe viejo |
| `PROBE_TIMEOUT_MS` | 25.000 ms | `shared/config.ts` | Espera del cliente |
| `POWER_OFF_ACCEPT_WINDOW_MS` | 30.000 ms | `shared/config.ts` | Frescura del apagado |
| `TABLET_CMD_FRESH_MS` | 60.000 ms | `shared/config.ts` | Frescura del comando de cámara |
| `TABLET_PRESENCE_HEARTBEAT_MS` | 60.000 ms | `shared/config.ts` | Latido de la tablet |
| `TABLET_PRESENCE_STALE_MS` | 150.000 ms | `shared/config.ts` | “Sin señal” de la tablet |
| Poll WoL de la tablet | 30.000 ms (mín. 10.000) | `SettingsManager.kt` | Lectura de `pc_commands` |
| Keepalive de sesión | 5.000 ms | `shared/signaling.ts` | `ping`/`pong` del DataChannel |
| Host declara caída | 20.000 ms | `shared/signaling.ts` | Liberación de sesión |
| Cliente declara caída | 15.000 ms | `shared/signaling.ts` | Sin `pong` |
| Gracia ICE perdido | 8.000 ms | `shared/signaling.ts` | Recuperación de red |
| Timeout de negociación | 90.000 ms | `shared/signaling.ts` | Abortar sesión |
| TTL de sesión manual | 600.000 ms | `shared/signaling.ts` | Expiración del código |
| Move de mouse | 25 ms | `client-app/App.tsx` | Throttle de `mousemove` |
| Wheel | 80 ms | `client-app/App.tsx` | Acumulación de scroll |
| Cola de input | 40 eventos | `host-app/input.ts` | Límite de backpressure |
| Watchdog de input | 3.500 ms | `host-app/input.ts` | Reinicio del worker |
| Captura de pantalla | ≤30 fps | `host-app/main.ts` | Límite de `getDisplayMedia` |
| Poll de portapapeles | 700 ms | `client-app/App.tsx` | Sincronización de texto |
| Stats de conexión | 2.000 ms | `client-app/App.tsx` | `getStats()` |
| Intentos de reconexión | 3 | `client-app/App.tsx` | Recuperación automática |
| Retardo de reconexión | 1.500 ms | `client-app/App.tsx` | Espera entre intentos |
| Helper de entrada | `127.0.0.1:47831` | `host-app/main.ts` | IPC local elevado |
| Log del host | 2 MB rotativos | `host-app/main.ts` | Diagnóstico |
| Ice server | `stun:stun.l.google.com:19302` | `shared/signaling.ts` | Descubrimiento de candidatos |

**Nota sobre entropía.** Los valores de `HOST_ID_LENGTH` y `PAIR_SECRET_LENGTH` no son parámetros de seguridad adecuados: 8 caracteres de 31 símbolos equivalen a unos 39,6 bits, por debajo de los 112 bits recomendados para un autenticador (Grassi et al., 2017). Se listan aquí para que el lector pueda reproducir el cálculo y no para presentarlos como una decisión defendible.

## Anexo C. Mapa de módulos y archivos

La Tabla C.1 describe los archivos principales y su responsabilidad. No es un inventario exhaustivo: excluye configuraciones de build, artefactos generados, `node_modules`, recursos gráficos y pruebas de ejemplo. La intención es que un lector nuevo pueda ubicar dónde vive cada concepto del documento.

**Tabla C.1.** Mapa de archivos principales.

| Ruta | Capa | Responsabilidad |
| --- | --- | --- |
| `packages/shared/src/signaling.ts` | Protocolo | `HostPeer`/`ClientPeer`, sesiones, oferta/respuesta, candidatos, keepalive |
| `packages/shared/src/pairing.ts` | Protocolo | `hostId`, secreto, `tokenFor`, configuración local del host y pares |
| `packages/shared/src/config.ts` | Protocolo | Constantes, colecciones, configuración pública de Firebase |
| `packages/shared/src/control.ts` | Protocolo | Tipos de mouse, teclado, portapapeles y mensajes del DataChannel |
| `packages/shared/src/presence.ts` | Protocolo | Snapshot de presencia, frescura, etiquetas de estado |
| `packages/shared/src/tablet.ts` | Protocolo | Comandos de cámara, stream de tablet, presencia de tablet |
| `packages/shared/src/firebase.ts` | Infraestructura | Inicialización del SDK web de Firebase |
| `packages/shared/src/FirestoreStatus.tsx` | UI compartida | Indicador de conectividad con Firestore |
| `packages/host-app/src/main.ts` | Host | Ventana, bandeja, autostart, helper, secretos, captura, apagado |
| `packages/host-app/src/presence.ts` | Host | Heartbeat, eventos de energía, respuesta a probe |
| `packages/host-app/src/input.ts` | Host | Cola, worker, watchdog, normalización de eventos |
| `packages/host-app/src/input-worker.ts` | Host | Inyección con `nut-js` en proceso aislado |
| `packages/host-app/src/preload.ts` | Host | API mínima al renderer |
| `packages/host-app/src/App.tsx` | Host | UI de sesión, PIN, emparejamiento, modo servicio |
| `packages/host-app/forge.config.ts` | Build | Empaquetado, fuses, clausura de dependencias |
| `packages/client-app/src/App.tsx` | Cliente | Conexión, video, control, portapapeles, stats, reconexión |
| `packages/client-app/src/CameraWindow.tsx` | Cliente | Ventana de cámara de la tablet |
| `packages/client-app/src/main.ts` | Cliente | Ventana, modo tapa cerrada, IPC |
| `packages/client-app/src/preload.ts` | Cliente | API mínima al renderer |
| `packages/client-app/forge.config.ts` | Build | Empaquetado del cliente macOS |
| `packages/functions/src/index.ts` | Servidor | `onProbeWritten`, rate limit, despacho |
| `packages/scripts/src/admin.ts` | Operación | Utilidades comunes de administración |
| `packages/scripts/src/listSessions.ts` | Operación | Listado de sesiones |
| `packages/scripts/src/resetSessions.ts` | Operación | Reinicio de sesiones |
| `packages/scripts/src/cleanSessions.ts` | Operación | Limpieza de sesiones |
| `app/src/main/java/.../MainActivity.kt` | Android | Selección de modo y navegación |
| `app/src/main/java/.../PhoneActivity.kt` | Android | Presencia, probe, encendido |
| `app/src/main/java/.../TabletActivity.kt` | Android | Cámara, servicio, presencia de tablet |
| `app/src/main/java/.../SettingsActivity.kt` | Android | MAC, broadcast, puerto, emparejamiento |
| `app/src/main/java/.../PcListenService.kt` | Android | Servicio en primer plano, polling de WoL |
| `app/src/main/java/.../WebRtcCameraClient.kt` | Android | Oferta/respuesta y captura de cámara |
| `app/src/main/java/.../SettingsManager.kt` | Android | SharedPreferences y configuración |
| `app/src/main/java/.../HostPresence.kt` | Android | Lectura de presencia del host |
| `app/src/main/java/.../TabletPresence.kt` | Android | Publicación de presencia de tablet |
| `app/src/main/python/firestore_client.py` | Android | Cliente REST de Firestore |
| `app/src/main/python/jwt_rs256.py` | Android | Firma JWT RS256 |
| `app/src/main/python/polling_loop.py` | Android | Poll de comandos y WoL |
| `app/src/main/python/pc_status.py` | Android | Chequeo LAN de la PC |
| `app/src/main/python/wol_sender.py` | Android | Magic packet |
| `app/src/main/python/net_discovery.py` | Android | Descubrimiento de red |
| `firestore.rules` | Infraestructura | Reglas versionadas de Firestore |
| `REQUERIMIENTOS.md` | Documentación | Casos de uso, RF, RNF y criterios |
| `BUILD.md` | Documentación | Comandos de build y verificación |

## Anexo D. Protocolo de mensajes y documentos de Firestore

### D.1 Canal de datos

El canal `control` transporta mensajes JSON con una envoltura `{ kind, payload }`. La Tabla D.1 describe los tipos implementados en `shared/control.ts` y su dirección habitual.

**Tabla D.1.** Mensajes del canal de datos.

| `kind` | `payload` | Dirección | Propósito |
| --- | --- | --- | --- |
| `hello` | `{ sessionId, deviceName }` | Ambos | Confirmar conectividad al abrir el canal |
| `mouse` | `{ type, x, y, button?, deltaX?, deltaY? }` | Cliente → host | Mover, botón, clic, doble clic o scroll |
| `key` | `{ type, key, text? }` | Cliente → host | Tecla abajo/arriba o texto |
| `clipboard` | `{ text }` | Ambos | Sincronizar texto del portapapeles |
| `control` | `{ kind: "pong" }` | Host → cliente | Responder al keepalive |
| `control` | `{ kind: "bye" }` | Ambos | Cierre ordenado |
| `control` | `{ kind: "requestDisconnect" }` | Cliente → host | Pedir desconexión |
| `control` | `{ kind: "healthcheck" }` | Cliente → host | Verificar que el host responde |
| `control` | `{ kind: "inputReset" }` | Cliente → host | Liberar botones y reiniciar la cola |
| `display` | `{ width, height }` | Host → cliente | Resolución real para mapear el mouse |
| `cursor` | `{ x, y }` | Host → cliente | Posición del cursor para el overlay |

**Codificación.** `encodeDataChannelMessage` aplica `JSON.stringify`; `decodeDataChannelMessage` valida que exista `kind` y que un mensaje `control` tenga `payload` objeto. Un mensaje malformado se descarta y no lanza. No hay firma, MAC, cifrado adicional ni control de tamaño: la integridad y la confidencialidad dependen de DTLS-SRTP.

### D.2 Documentos de Firestore

La Tabla D.2 resume las rutas, los campos principales, quién escribe y quién lee. Todas las colecciones núcleo están abiertas en el archivo `firestore.rules` versionado; el estado desplegado debe verificarse en la consola. La columna “Riesgo” señala el problema de seguridad dominante, no una propiedad del diseño deseado.

**Tabla D.2.** Documentos y colecciones de Firestore.

| Ruta | Campos principales | Escribe | Lee | Riesgo |
| --- | --- | --- | --- | --- |
| `sessions/{code}` | `machineCode`, `status`, `deviceName`, `pinProtected`, `pinHash`, `offer`, `answer`, `expiresAt`, `attemptId`, `hostId`, `tokenHash` | Host y cliente | Host, cliente, cualquiera | Enumeración y lectura de `tokenHash`/`pinHash` |
| `sessions/{code}/clientCandidates/{id}` | `candidate`, `attemptId`, `createdAt` | Cliente | Host | Inundación de candidatos |
| `sessions/{code}/hostCandidates/{id}` | `candidate`, `attemptId`, `createdAt` | Host | Cliente | Inundación de candidatos |
| `presence/{hostId}` | `state`, `bootId`, `deviceName`, `appVersion`, `lastEventAt`, `lastHeartbeatAt`, `lastLocalIp`, `captureOk`, `idle` | Host | Android, cliente, cualquiera | IP y metadatos públicos |
| `presence/{hostId}/probe/pending` | `requestId`, `state`, `requestedAt`, `dispatchedAt` | Teléfono/tablet | Cloud Function, host | Escritura anónima |
| `presence/{hostId}/probe/answer` | `requestId`, `state`, `captureOk`, `idle`, `uptime`, `respondedAt`, `ok`, `reason` | Host o Function | Teléfono/tablet | Respuesta falsificable |
| `presence/{hostId}/probe/rate` | `windowStart`, `count` | Cloud Function | Cloud Function | Falla abierta si no puede leer |
| `pc_commands/{hostId}` | `powerOn`, `timestamp`, `senderDevice`, `pcOnline`, `pcCheckedAt` | Cliente, teléfono | Host, tablet | Apagado/encendido sin autenticación |
| `pc_commands/desktop` | `powerOn`, `timestamp`, `senderDevice` | Cliente, teléfono | Tablet (WoL) | Alias legacy compartido |
| `tablet_commands/{hostId}` | `cameraStream`, `mode`, `timestamp`, `requestId`, `token` | Cliente | Tablet | Token reutilizable |
| `tablet_stream/{hostId}` | `offer`, `answer`, `status`, `requestId`, `deviceName`, `mode`, `tokenHash`, `updatedAt` | Cliente y tablet | Ambos, cualquiera | Oferta no vinculada; `tokenHash` público |
| `tablet_stream/{hostId}/clientCandidates/{id}` | `candidate`, `requestId`, `createdAt` | Cliente | Tablet | Inundación de candidatos |
| `tablet_stream/{hostId}/hostCandidates/{id}` | `candidate`, `requestId`, `createdAt` | Tablet | Cliente | Inundación de candidatos |
| `tablet_presence/{hostId}` | `running`, `foreground`, `updatedAt`, `deviceName`, `appVersion`, `mode` | Android | Cliente | Metadatos de dispositivo |
| `_healthcheck/{doc}` | `ok`, `updatedAt`, `source` | Operación | Operación | Bajo, pero abierto |

**Ciclo de vida.** Las sesiones manuales expiran a los 10 minutos; las emparejadas vuelven a `waiting` al terminar. Los candidatos se purgan por edad y por `attemptId`; la presencia se considera vieja a los 10 minutos; la presencia de tablet a los 150 segundos. El TTL de Firestore no se usa: la expiración es lógica, implementada por el host y por la UI.

## Anexo E. Instrumento de encuesta y consentimiento informado

### E.1 Consentimiento informado (modelo breve)

> **Título:** Validación de usabilidad de IsisAnubis.
>
> **Propósito.** Evaluar si el sistema permite conectarse, ver la pantalla del host, controlarlo y desconectarse sin ayuda.
>
> **Qué se observa.** Tiempo de conexión, errores visibles, acciones del participante y respuestas al cuestionario. Se pueden tomar capturas de la interfaz; las capturas se anonimizan y no deben incluir datos personales de terceros.
>
> **Qué no se registra.** Contenido del portapapeles, contraseñas, documentos abiertos ni audio de la habitación. La cámara de la tablet solo se activa si el participante lo autoriza explícitamente.
>
> **Duración.** Aproximadamente 30 minutos (10 de preparación, 15 de tareas, 5 de cuestionario).
>
> **Riesgos.** Fatiga visual o incomodidad por el control remoto. El participante puede detener la sesión en cualquier momento sin consecuencia.
>
> **Confidencialidad.** Los datos se identifican con un código; la lista de nombres se guarda separada. Los resultados se reportan agregados.
>
> **Retiro.** El participante puede retirar su consentimiento y solicitar el borrado de sus datos escribiendo a _[correo de contacto]_.
>
> **Consentimiento.** He leído la información, tuve oportunidad de preguntar y acepto participar. Autorizo el uso de capturas anonimizadas: sí / no.
>
> Nombre: ______________________  Firma: ______________________  Fecha: __________

### E.2 Cuestionario

El cuestionario combina 12 ítems Likert de 1 a 5 (1 = totalmente en desacuerdo; 5 = totalmente de acuerdo) con tres preguntas abiertas. Se aplica después de la tarea guiada: conectar, ver pantalla, mover el mouse, copiar y pegar, y desconectar. La Tabla E.1 define los ítems y la dimensión que miden.

**Tabla E.1.** Cuestionario de validación de usuario.

| N.º | Ítem | Dimensión |
| --- | --- | --- |
| 1 | La conexión fue rápida y el video apareció sin pasos adicionales. | Facilidad de uso |
| 2 | El código de sesión y el PIN se entienden sin explicación previa. | Facilidad de uso |
| 3 | El mouse responde de forma predecible y sin sensación de retraso. | Rendimiento percibido |
| 4 | El teclado funciona con las teclas que esperaba. | Rendimiento percibido |
| 5 | La calidad de imagen permite leer texto y distinguir controles. | Calidad |
| 6 | El audio se escucha sincronizado con el video. | Calidad |
| 7 | Copiar y pegar entre equipos funciona de forma confiable. | Utilidad |
| 8 | La reconexión tras un corte es automática y comprensible. | Robustez |
| 9 | Sé cómo detener la sesión y cómo evitar que el host quede controlado. | Control y seguridad |
| 10 | Entiendo cuándo la cámara de la tablet está activa. | Transparencia |
| 11 | Recomendaría el sistema a alguien con un caso de uso similar. | Aceptación |
| 12 | La interfaz me dio confianza para usar el sistema en un equipo real. | Confianza |
| A1 | ¿Qué fue lo más difícil de la tarea? | Abierta |
| A2 | ¿Qué debería cambiar antes de usarlo a diario? | Abierta |
| A3 | ¿Qué haría si sospechara que alguien más controla el host? | Abierta |

**Análisis.** Para cada ítem se reporta media, mediana, desviación estándar y distribución. Con 5 a 12 participantes no se pretende significación estadística; se busca detectar problemas de usabilidad y brechas de comprensión. Las respuestas abiertas se codifican por temas (conexión, input, calidad, seguridad, confianza) y se citan de forma anonimizada. Un ítem con mediana <4 se trata como área de mejora, no como fallo del participante.

## Anexo F. Protocolo de medición empírica y matriz de datos

### F.1 Objetivo y diseño

El objetivo es producir datos reproducibles de latencia, RTT, fps, bitrate, pérdida, tiempo de conexión y estabilidad. El diseño es un experimento factorial con dos factores: **escenario de red** (LAN, Internet doméstico, hotspot móvil) y **resolución** (1280×720, 1920×1080, 2560×1440). Cada combinación se repite cinco veces durante 10 minutos, con el mismo contenido de pantalla y la misma configuración de códec. Son 45 ejecuciones (3 × 3 × 5) y 450 minutos de captura, sin contar preparación.

**Variables controladas.** Versión de host, cliente y tablet; sistema operativo; hardware; resolución del host; fps de captura; codec; ausencia de otras aplicaciones de red; hora del día; distancia al punto de acceso; y versión de Firestore/WebRTC. Se registran en la hoja de metadatos.

**Variables independientes.** Escenario de red y resolución. **Variables dependientes.** Latencia de input, RTT, fps, bitrate, pérdida, tiempo de conexión, reconexiones y minutos sin caída.

### F.2 Instrumentación

- **Latencia de input.** Un script envía un movimiento de mouse con marca de tiempo y el host registra el evento de entrada con `performance.now()`; se resta el desfase estimado por NTP. Como alternativa de bajo costo, se graba la pantalla del cliente y del host con un reloj visible y se cuenta la diferencia de cuadros.
- **RTT, fps, bitrate y pérdida.** Se leen de `RTCPeerConnection.getStats()` cada 2 segundos y se exportan a CSV. Se usan los campos `currentRoundTripTime`, `framesPerSecond`, `bytesReceived`/`bytesSent` y `packetsLost`/`packetsReceived`.
- **Tiempo de conexión.** Desde el clic en “Conectar” hasta el evento `connected` del canal de datos.
- **Estabilidad.** Minutos hasta la primera caída no recuperada; número de reconexiones; motivo del cierre.
- **Condiciones de red.** `ping` al host, prueba de ancho de banda y tipo de NAT (mapeo y filtrado) con una herramienta de diagnóstico STUN.

### F.3 Matriz de datos

La Tabla F.1 define las columnas del archivo CSV. Cada fila es una observación de 10 minutos o un evento; las métricas continuas se agregan por ejecución. La Tabla F.2 define los escenarios.

**Tabla F.1.** Matriz de datos para medición empírica.

| Columna | Tipo | Unidad | Origen | Análisis |
| --- | --- | --- | --- | --- |
| `run_id` | Texto | — | Planilla | Identificador único |
| `fecha` | Fecha | ISO 8601 | Planilla | Control temporal |
| `red` | Categórica | LAN / Internet / hotspot | Planilla | Factor |
| `resolucion` | Categórica | 720p / 1080p / 1440p | Planilla | Factor |
| `repeticion` | Entero | 1–5 | Planilla | Bloque |
| `host_version` | Texto | — | `package.json` | Metadato |
| `client_version` | Texto | — | `package.json` | Metadato |
| `rtt_ms` | Continua | ms | `getStats` | Media, mediana, p95, DE |
| `fps` | Continua | fps | `getStats` | Media, mediana, p5, DE |
| `bitrate_mbps` | Continua | Mbit/s | `getStats` | Media, mediana, p95, DE |
| `packet_loss_pct` | Continua | % | `getStats` | Media, mediana, p95 |
| `input_latency_ms` | Continua | ms | Logs + reloj | Media, mediana, p95, DE |
| `connect_time_s` | Continua | s | Logs | Media, mediana, p95 |
| `reconnects` | Entero | — | Logs | Conteo |
| `uptime_min` | Continua | min | Logs | Media, mínimo |
| `close_reason` | Categórica | — | Logs | Frecuencia |
| `observaciones` | Texto | — | Observador | Cualitativo |

**Tabla F.2.** Escenarios de medición.

| Escenario | Topología | Ancho de banda esperado | NAT | Qué se prueba |
| --- | --- | --- | --- | --- |
| LAN | Host y cliente en la misma red Wi-Fi 5/6 o Ethernet | ≥100 Mbit/s | Sin NAT entre pares | Línea base de latencia y fps |
| Internet doméstico | Host en una red, cliente en otra, ambas con fibra/cable | 20–100 Mbit/s | NAT doméstico | Ruta P2P, STUN, pérdida |
| Hotspot móvil | Cliente en 4G/5G; host en red doméstica | 5–50 Mbit/s | NAT simétrico probable | Falla sin TURN; pérdida y jitter |

### F.4 Procedimiento

1. **Preparar.** Verificar versiones, cerrar aplicaciones de red, fijar resolución y fps, limpiar sesiones y confirmar la hora con NTP.
2. **Ejecutar.** Iniciar la captura de stats, conectar, reproducir la tarea guiada (video, scroll, texto, copiar/pegar) y mantener 10 minutos. Registrar reconexiones y cierres.
3. **Medir la latencia.** Ejecutar 30 movimientos de mouse y 30 pulsaciones de tecla por ejecución; registrar el desfase.
4. **Cerrar.** Desconectar, exportar CSV, guardar logs y anotar observaciones. No borrar los datos crudos.
5. **Analizar.** Calcular media, mediana, p95, desviación estándar y pérdida por celda. Comparar contra las metas de la Tabla 3.4. Reportar los valores atípicos y las ejecuciones inválidas.
6. **Reproducir.** Publicar la versión, el CSV, los scripts y las limitaciones. Un resultado sin estas piezas no es replicable.

**Criterios de exclusión.** Se descarta una ejecución si el host se apaga, si la red cambia de ruta a mitad de la prueba, si el cliente entra en suspensión o si el archivo de stats tiene menos del 80 % de las muestras esperadas. Las exclusiones se registran y no se ocultan.

## Anexo G. Checklist de seguridad y despliegue

La Tabla G.1 operacionaliza la Tabla 6.8 por dominio y añade el comando o la evidencia que permite verificarla. No sustituye una auditoría: es una puerta de release. Los ítems marcados “P0” bloquean cualquier despliegue fuera del entorno personal.

**Tabla G.1.** Checklist de seguridad y despliegue.

| Bloque | Verificación | Comando o evidencia | Criterio | Prioridad |
| --- | --- | --- | --- | --- |
| Secretos | La clave de servicio no está en el APK ni en el historial | `gitleaks detect --source .`; `unzip -p app.apk` + búsqueda de `private_key` | Sin coincidencias | P0 |
| Secretos | La clave anterior está revocada | Consola IAM; prueba de firma con la clave vieja | Falla la autenticación | P0 |
| Firestore | Reglas desplegadas y probadas | Emulador + pruebas de lectura/escritura anónima | Deniega todo cliente anónimo | P0 |
| Firestore | Auth y App Check activos | Consola Firebase; llamada sin token | Rechazo 401/403 | P0 |
| Emparejamiento | Token con nonce/HMAC y ≥128 bits | Prueba de replay y de fuerza bruta | Token capturado no reutilizable | P0 |
| Comandos | Apagado y cámara autenticados | Prueba con `hostId` ajeno | No ejecuta | P0 |
| Secretos locales | `safeStorage`/Keystore y permisos | Inspección de `isis-host.json`, `isis-pairs.json`, SharedPreferences | Sin secretos en claro | P1 |
| Android | `allowBackup=false` y R8 | `aapt dump xmltree`; `build.gradle.kts` | Backup excluido; `minifyEnabled=true` | P1 |
| Android | Firma de release | `apksigner verify` | Firma válida | P1 |
| Electron | Sandbox y navegación denegada | Revisión de `main.ts`; prueba de `window.open` | Bloqueado | P1 |
| Electron | Firma y notarización | `codesign -dv`; `spctl -a` | Firma válida | P1 |
| Red | TURN operativo | Prueba en NAT simétrico | Sesión conecta | P1 |
| Red | Rate limit y bloqueo | 100 intentos de PIN/código | Bloqueo y registro | P1 |
| Logs | Redacción y retención | Revisión de `isis-host.log` | Sin secretos ni IPs innecesarias | P1 |
| Pruebas | T-01 a T-25 ejecutadas | Matriz con fecha y evidencia | 25/25 registradas | P1 |
| SAST | Sin hallazgos críticos | `npm audit`, Semgrep/CodeQL | 0 críticos abiertos | P1 |
| Privacidad | Consentimiento e indicador | UI y documento | Visible y retirable | P2 |
| Operación | Monitoreo y alertas | Facturación, Firestore, IAM | Alerta configurada | P2 |
| Documentación | Capítulo 6 y anexos revisados | Este documento | Sin placeholders críticos | P1 |

**Uso.** Antes de un release se copia la tabla a un issue o a una hoja de cálculo, se marca cada fila como “hecho”, “no aplica” o “pendiente” y se adjunta la evidencia. Un “no aplica” debe justificarse. La checklist no se cierra por mayoría: cualquier P0 abierto invalida el despliegue.

## Anexo H. Glosario

**API key web.** Clave pública del proyecto Firebase que identifica la aplicación ante los servicios de Google. No es un secreto y no autoriza por sí sola; la autorización depende de las reglas y de Auth.

**App Check.** Servicio de Firebase que atestigua que una llamada proviene de una app legítima y no de un script o de un cliente modificado.

**Canal de datos (DataChannel).** Canal bidireccional de WebRTC sobre SCTP/DTLS que IsisAnubis usa para mouse, teclado, portapapeles y control.

**Cuenta de servicio.** Identidad de Google Cloud pensada para servidores. Su clave privada permite firmar JWT y obtener tokens OAuth2; no debe distribuirse en un cliente.

**DTLS-SRTP.** Combinación de DTLS para el handshake y SRTP para el cifrado de medios. Protege la confidencialidad e integridad en tránsito, no la señalización.

**Emparejamiento.** Mecanismo por el cual un cliente guarda un `hostId` y un secreto para reconectarse sin código. En IsisAnubis el verificador se publica, lo que lo convierte en un portador reutilizable.

**Entropía.** Medida de la impredecibilidad de un secreto, expresada en bits. Un secreto de 8 caracteres de 31 símbolos tiene ~39,6 bits, insuficiente para resistencia moderna.

**Firestore.** Base de datos de documentos de Firebase usada como plano de control: sesiones, presencia, comandos y señalización.

**Heartbeat.** Latido periódico con el que un componente declara que sigue vivo. No prueba identidad; solo actualidad.

**ICE.** Marco de WebRTC para descubrir rutas y candidatos entre pares, con STUN y TURN como ayudantes.

**Magic packet.** Paquete de Wake-on-LAN con la MAC del equipo repetida. Es spoofable por diseño; la mitigación es de red y de autorización del emisor.

**NAT simétrico.** Tipo de NAT que asigna un mapeo distinto por destino; sin TURN, la conexión P2P suele fallar.

**Nonce.** Valor impredecible de un solo uso que evita replay en un protocolo de desafío-respuesta.

**PAKE.** Protocolo de autenticación por contraseña que resiste ataques de diccionario offline, como SPAKE2 u OPAQUE.

**PIN.** Segundo factor opcional de la sesión manual. En IsisAnubis su hash se publica y no hay límite de intentos, por lo que un PIN corto no protege.

**Señalización.** Intercambio de oferta, respuesta y candidatos ICE antes de establecer los medios. En IsisAnubis viaja por Firestore sin firma ni MAC.

**SRTP.** Protocolo de transporte seguro para audio y video; en WebRTC se negocia con DTLS.

**STUN.** Servicio que permite a un par descubrir su dirección pública y su tipo de NAT.

**TURN.** Relay que retransmite medios cuando la conexión directa no es posible. IsisAnubis no lo usa, lo que limita la conectividad.

**UIPI.** Aislamiento de privilegios de interfaz de Windows: un proceso de integridad media no puede enviar entrada a una ventana elevada. El helper de IsisAnubis existe para cruzar esa barrera.

**WebRTC.** Conjunto de APIs y protocolos para comunicación en tiempo real entre navegadores y aplicaciones, con ICE, DTLS-SRTP y SCTP.

**WoL (Wake-on-LAN).** Mecanismo para encender un equipo mediante un magic packet en la red local.

## Anexo I. Registro de evidencias y capturas

La Tabla I.1 registra la evidencia producida para esta versión. No incluye capturas de pantalla con datos personales; cuando una captura sea necesaria, debe anonimizarse y guardarse en `docs/evidencias/` con un nombre estable. Las fechas corresponden a la ejecución, no a la redacción.

**Tabla I.1.** Registro de evidencias.

| ID | Evidencia | Fecha | Comando o fuente | Resultado | Ubicación |
| --- | --- | --- | --- | --- | --- |
| E-01 | Typecheck de escritorio | 2026-11-07 | `pnpm typecheck` | 5 paquetes sin errores | Log de terminal |
| E-02 | Compilación Kotlin | 2026-11-07 | `./gradlew :app:compileDebugKotlin --offline` | `BUILD SUCCESSFUL`; `UP-TO-DATE` | Log de Gradle |
| E-03 | Conteo de líneas | 2026-11-07 | `wc -l` sobre `.ts`, `.tsx`, `.kt`, `.py` | 14.905 líneas | Tabla 4.1 |
| E-04 | Historial de escritorio | 2026-11-07 | `git log --oneline` | 18 commits | Repositorio |
| E-05 | Historial Android | 2026-11-07 | `git log --oneline` | 4 commits | Repositorio |
| E-06 | Reglas de Firestore | 2026-11-07 | Lectura de `firestore.rules` | Colecciones núcleo abiertas | §6.6 |
| E-07 | Manifiesto Android | 2026-11-07 | Lectura de `AndroidManifest.xml` | 6 permisos; `allowBackup=true` | §6.12 |
| E-08 | Configuración de release | 2026-11-07 | Lectura de `app/build.gradle.kts` | `isMinifyEnabled=false`; sin firma | §6.12 |
| E-09 | Clave embebida | 2026-11-07 | Lectura de `firestore_config.py` | Clave completa presente; no se reproduce | §6.11 |
| E-10 | Token de emparejamiento | 2026-11-07 | Lectura de `pairing.ts`, `signaling.ts` | `tokenHash` público y aceptado | §6.4 |
| E-11 | Figuras del documento | 2026-11-07 | `python docs/generar_figuras.py` | 8 figuras PNG | `docs/figuras/` |
| E-12 | Este documento | 2026-11-07 | `DOCUMENTACION_ISISANUBIS.md` y `.docx` | Versión 1.0 | Raíz del repositorio |

**Evidencia pendiente.** Las mediciones del Anexo F, la encuesta del Anexo E y las pruebas T-01 a T-25 no se ejecutaron. Cuando se ejecuten, deben añadirse filas con fecha, versión, equipo, red y resultado. No se debe marcar una fila como “hecha” solo porque el código existe.

## Anexo J. Extractos de código representativos

Los extractos se incluyen por valor pedagógico, no como especificación completa. Se eliminaron credenciales, rutas absolutas y datos personales. El código puede haber cambiado después de la fecha de este documento; la fuente autoritativa es el repositorio.

### J.1 Generación del código de sesión

```ts
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;

export function generateSessionCode(length: number = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}
```

**Observación.** Usa `crypto.getRandomValues`, lo cual es correcto para generar el código. El problema no es la aleatoriedad, sino la entropía total (≈29,7 bits) y el hecho de que el código se publica en una colección abierta.

### J.2 Token de emparejamiento

```ts
export const PAIR_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const HOST_ID_LENGTH = 8;
export const PAIR_SECRET_LENGTH = 8;

export async function tokenFor(secret: string): Promise<string> {
  return sha256Hex(secret);
}
```

**Observación.** El token es `SHA-256(secreto)`, sin sal ni iteraciones. El host publica ese mismo valor como `tokenHash` y lo acepta como prueba; por eso el token es una contraseña equivalente y no un verificador.

### J.3 Comparación del token en el host

```ts
const expected = session.tokenHash;
const provided = data.token;
if (!provided) {
  // rechazo: pair_token_missing
}
if (provided !== expected) {
  // rechazo: pair_token_invalid
}
```

**Observación.** La comparación es correcta en cuanto a igualdad, pero no en tiempo constante y, sobre todo, compara contra un valor publicado. Un atacante con lectura del documento copia `tokenHash` y lo envía como `token`.

### J.4 Verificación del comando de cámara en Android

```kotlin
val tokenOk = secret.isEmpty() || command.token == sha256Hex(secret)
if (!fresh || !tokenOk) {
    return
}
```

**Observación.** `secret.isEmpty()` convierte la ausencia de emparejamiento en una autorización total. Además, `sha256Hex(secret)` es exactamente el `tokenHash` que la tablet publica en `tablet_stream`, de modo que el valor está disponible para cualquiera que lea el documento.

### J.5 Regla abierta de Firestore

```text
match /sessions/{sessionId} {
  allow read, write: if true;
}
```

**Observación.** La regla no valida campos, transiciones ni identidad. Un cliente anónimo puede crear, leer, modificar o borrar sesiones, incluidos `tokenHash`, `pinHash`, `offer` y `answer`. El archivo advierte que es una copia del posture documentado; aun así, el riesgo debe tratarse como real hasta verificar la consola.

### J.6 Fuses de Electron

```ts
fuses: {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  onlyLoadAppFromAsar: true,
  enableEmbeddedAsarIntegrityValidation: true,
  enableCookieEncryption: true,
}
```

**Observación.** Los fuses reducen la superficie de ejecución y protegen el empaquetado. No sustituyen `sandbox: true`, la denegación de navegación, el manejador de permisos ni la firma de código.

### J.7 Apagado remoto

```ts
if (cmd.powerOn === false && isFresh(cmd.timestamp, POWER_OFF_ACCEPT_WINDOW_MS)) {
  await publishOffline();
  await shutdownOperatingSystem();
}
```

**Observación.** La frescura evita ejecutar un comando viejo, pero no verifica quién lo escribió. Cualquiera que conozca el `hostId` puede publicar `powerOn: false` con un `timestamp` nuevo.

### J.8 Helper elevado

```ts
const INPUT_HELPER_HOST = "127.0.0.1";
const INPUT_HELPER_PORT = 47831;

// El primer mensaje debe ser:
// { "type": "auth", "secret": "<secreto>" }
```

**Observación.** El helper escucha en loopback y autentica con el secreto de emparejamiento. No hay TLS, nonce ni autenticación mutua; un proceso local que gane la carrera por el puerto puede recibir el secreto. La tarea programada con `HighestAvailable` amplifica el impacto.

---

**Fin del documento.** Las secciones marcadas con placeholders (_[Nombre del autor]_, _[Universidad / Institución]_, etc.) deben completarse antes de la entrega formal. Las mediciones pendientes deben ejecutarse con el protocolo del Anexo F y reportarse sin inventar valores.
