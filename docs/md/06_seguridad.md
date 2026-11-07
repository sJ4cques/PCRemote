# 6. Seguridad del sistema

La seguridad de IsisAnubis se analizó con tres lentes complementarias: un modelo de amenazas basado en activos, adversarios y límites de confianza; una revisión estática del código, la configuración y las reglas; y una estimación de riesgo por probabilidad e impacto. El resultado no es una certificación ni un pentest: es un diagnóstico honesto del estado del prototipo. El capítulo explica **qué** control se usa, **dónde** vive y **cómo** funciona, y separa con claridad lo implementado de lo ausente. También evita reproducir la clave privada o las credenciales completas que aparecen en el repositorio Android; describir la exposición es suficiente para remediarla.

El marco conceptual sigue el modelado de amenazas de Shostack (2014) y STRIDE, complementado con los catálogos de OWASP (2021, 2024, 2025), los lineamientos de autenticación de NIST (Grassi et al., 2017), el estándar de gestión de seguridad ISO/IEC 27001:2022 y las especificaciones de WebRTC e Internet citadas en el capítulo 7. La estimación de riesgo es cualitativa y se declara como tal: no sustituye una medición de explotabilidad ni una prueba de penetración.

## 6.1 Activos, adversarios y modelo de amenazas

### 6.1.1 Activos

**Tabla 6.1.** Activos y criticidad.

| ID | Activo | Descripción | Criticidad | Consecuencia si se compromete |
| --- | --- | --- | --- | --- |
| A1 | Pantalla y audio del host | Contenido visual y sonoro del escritorio Windows capturado en vivo. | **Crítica** | Exposición de documentos, contraseñas, correo, reuniones y datos de terceros. |
| A2 | Control de mouse y teclado | Capacidad de inyectar entrada en la sesión del usuario. | **Crítica** | Ejecución de acciones arbitrarias, instalación de software, borrado o exfiltración. |
| A3 | Portapapeles | Texto sincronizado en ambos sentidos. | **Alta** | Robo de contraseñas, tokens, fragmentos de código o datos personales. |
| A4 | Secretos de emparejamiento | `hostId`, `secret`, `tokenHash` y tokens derivados. | **Crítica** | Suplantación del host o del cliente; acceso persistente. |
| A5 | Credencial de cuenta de servicio | Clave privada embebida en el APK Android. | **Crítica** | Acceso administrativo a Firestore; abuso de cuotas; exfiltración y borrado. |
| A6 | Órdenes de energía | Comandos de encendido (WoL) y apagado remoto. | **Alta** | Apagado no autorizado, denegación de servicio, consumo eléctrico. |
| A7 | Cámara de la tablet | Video en vivo de la cámara frontal o trasera. | **Alta** | Vigilancia no consentida; exposición de la intimidad y del entorno. |
| A8 | Presencia y metadatos | `state`, `lastLocalIp`, `deviceName`, `appVersion`, `uptime`, `idle`. | **Media** | Reconocimiento, correlación, exposición de la red local y de hábitos. |
| A9 | Código y artefactos | Repositorios, APK, binarios Electron, scripts de administración. | **Alta** | Ingeniería inversa, extracción de secretos, cadena de suministro. |
| A10 | Configuración y logs | `isis-host.json`, `isis-pairs.json`, `isis-host.log`, SharedPreferences. | **Media** | Persistencia, diagnóstico filtrado, robo de secretos locales. |

### 6.1.2 Adversarios

El modelo considera seis perfiles. No todos tienen la misma capacidad, y el sistema no pretende defenderse de todos con la misma fuerza.

1. **Actor oportunista en Internet.** No conoce el proyecto; descubre el proyecto Firebase `baobaoadmin` por el APK, un repositorio público, un documento filtrado o una búsqueda. Puede leer las colecciones abiertas, enumerar sesiones y escribir documentos. Su motivación es curiosidad, vandalismo o abuso de cuota.
2. **Atacante con el APK.** Descompila el APK, extrae la cuenta de servicio y obtiene acceso directo a Firestore sin pasar por la app. No necesita el `hostId` ni el secreto: la credencial lo autoriza. Es el adversario más peligroso del estado actual.
3. **Atacante en la red local.** Comparte LAN o Wi-Fi con el host, la tablet o el cliente. Puede observar tráfico, enviar magic packets, spoofear ARP, intentar conectarse al helper en `127.0.0.1` si tiene ejecución local, o escribir en Firestore si tiene Internet.
4. **Malware o usuario local con la misma cuenta.** Lee los archivos de configuración, la línea de comandos de los procesos, el portapapeles o los logs. Puede conectar al helper elevado si obtiene el secreto. Si tiene privilegios de administrador, el modelo asume compromiso total.
5. **Usuario curioso o malicioso de la tablet.** Tiene acceso físico al dispositivo, puede abrir la app, cambiar ajustes, leer SharedPreferences con root o backup, y activar la cámara si conoce el comando.
6. **Adversario de cadena de suministro.** Compromete una dependencia, un binario sin firma o el canal de actualización. El proyecto no tiene firma de código ni actualización firmada, así que este adversario queda fuera del alcance de los controles actuales.

### 6.1.3 Supuestos y exclusiones

El análisis asume que el sistema operativo del host y del cliente es confiable, que el usuario del host autoriza la captura y el control, que el propietario del proyecto Firebase administra la consola y que la red y Google Cloud no están comprometidos a nivel de infraestructura. También asume que el atacante no es administrador del host: si lo es, puede leer los secretos, modificar el helper, inyectar entrada y capturar la pantalla sin necesidad de explotar IsisAnubis.

Quedan fuera del alcance: ataques físicos al hardware, compromiso del kernel o del firmware, denegación de servicio a gran escala contra Firebase o Google, ingeniería social, cumplimiento legal específico de una jurisdicción y auditoría formal de la cadena de suministro. Estas exclusiones no son una excusa: se declaran para que el lector sepa qué preguntas no responde este capítulo.

## 6.2 Límites de confianza y superficies de ataque

La Figura 6.1 resume los límites de confianza. El prototipo tiene seis fronteras relevantes:

- **B1 · Internet/Firebase ↔ host.** El host usa el SDK web de Firebase con la API key pública y sin autenticación. Las reglas lo tratan como un cliente anónimo.
- **B2 · Internet/Firebase ↔ cliente macOS.** El cliente usa el mismo SDK anónimo. Escribe ofertas, candidatos y comandos, y lee respuestas y presencia.
- **B3 · Host ↔ sistema operativo y escritorio.** El host captura pantalla, audio e inyecta entrada. El helper elevado cruza UIPI. Es la frontera con más poder efectivo.
- **B4 · Cliente ↔ sistema operativo macOS.** El cliente lee y escribe el portapapeles, abre una ventana de cámara y puede desactivar el sueño con la tapa cerrada.
- **B5 · Android ↔ Firebase.** La tablet y el teléfono usan una cuenta de servicio por REST; esa credencial **salta las reglas** de Firestore. Es la frontera más privilegiada y la peor protegida.
- **B6 · Android ↔ host/cliente por WebRTC.** La cámara viaja de la tablet al cliente por un peer connection separado, señalizado en `tablet_stream`.

**Figura 6.1.** Límites de confianza y superficies de exposición.

![Límites de confianza y superficies de exposición](docs/figuras/fig04_confianza.png)

_Fuente: elaboración propia a partir del código, las reglas y la configuración de ambos repositorios._

Las superficies de ataque concretas son:

1. **Documentos de Firestore** (`sessions`, `presence`, `pc_commands`, `tablet_commands`, `tablet_stream`, `tablet_presence`, `_healthcheck`) con reglas abiertas.
2. **API key web pública** y configuración del proyecto Firebase; no es un secreto, pero identifica el proyecto y permite invocar la API.
3. **Cuenta de servicio embebida** en el APK, con clave privada y token OAuth2.
4. **Códigos de sesión, PIN y tokens de emparejamiento**, publicados o derivados de secretos de baja entropía.
5. **SDP, ICE candidates y fingerprints** en documentos legibles; revelan IPs, códecs y permiten sustitución si la señalización no está autenticada.
6. **Helper TCP** en `127.0.0.1:47831`, autenticado con un secreto estático y sin TLS.
7. **IPC de Electron y preload**, que expone entrada, portapapeles, pares y cámara al renderer.
8. **Línea de comandos de los procesos**, que en modo de prueba puede incluir `--isis-pair-secret` o `--isis-pair`.
9. **Archivos locales** `isis-host.json`, `isis-pairs.json`, SharedPreferences y logs.
10. **Componentes Android exportados** (solo `MainActivity`), servicio en primer plano y permiso de cámara.
11. **Canal de actualización y binarios sin firma**, que hoy no existe pero es una superficie futura.

**Tabla 6.2.** Modelo STRIDE aplicado.

| Categoría | Aplicación en IsisAnubis | Activos | Control actual | Brecha principal |
| --- | --- | --- | --- | --- |
| **S**poofing | Un atacante se hace pasar por el host o el cliente usando un `hostId` y un token leídos de Firestore. | A2, A4, A7 | Token `SHA-256(secreto)` comparado por el host. | El verificador se publica; el token es un portador reutilizable. |
| **T**ampering | Se modifica una oferta, una respuesta, un candidato ICE o un comando de energía en Firestore. | A1, A2, A6, A7 | Reglas abiertas; `attemptId` solo descarta candidatos viejos. | No hay firma ni MAC de los mensajes de señalización. |
| **R**epudiation | No hay registro confiable de quién abrió una sesión, activó la cámara o apagó la PC. | A1–A7 | Logs locales del host, sin identidad ni retención formal. | No hay auditoría central ni atribución. |
| **I**nformation disclosure | Lectura de pantalla, audio, portapapeles, cámara, IPs, SDP y metadatos. | A1, A3, A5, A7, A8 | DTLS-SRTP en medios; reglas abiertas en el resto. | Firestore expone señalización y presencia; el APK expone la credencial. |
| **D**enial of service | Borrado o inundación de documentos, apagado remoto, agotamiento de cuotas, activación repetida de cámara. | A1, A5, A6, A7 | Rate limit de probe 10/min; TTL de sesión. | No hay límites de escritura, autenticación ni presupuesto por usuario. |
| **E**levation of privilege | El helper elevado acepta entrada de un proceso local; la cuenta de servicio da acceso administrativo. | A2, A5 | Helper en loopback con secreto; cuenta de servicio con IAM amplio. | Secreto de 8 caracteres, sin TLS ni autenticación mutua; IAM excesivo. |

La lectura de la tabla es consistente con el resto del documento: los controles protegen razonablemente el **transporte** (WebRTC usa DTLS-SRTP; TLS protege Firebase), pero no protegen la **autorización** ni la **identidad**. La mayor parte del riesgo no está en el cifrado de los medios, sino en quién puede escribir la señalización, quién puede leer los documentos y qué credencial lleva el APK.

## 6.3 Inventario de controles: qué se usa, dónde y cómo

El inventario se organiza por control y se contrasta con las buenas prácticas de la familia ISO/IEC 27002:2022 para la selección e implementación de controles (ISO/IEC, 2022b). La columna “Estado” distingue lo implementado de lo parcial y de lo ausente; no califica la eficacia real, que solo una prueba podría determinar.

**Tabla 6.3.** Inventario de controles: qué, dónde y cómo.

| Control | Qué se usa | Dónde | Cómo funciona | Estado |
| --- | --- | --- | --- | --- |
| Aislamiento del renderer | `contextIsolation: true`, `nodeIntegration: false` | `host-app/src/main.ts`, `client-app/src/main.ts` | El renderer no accede a Node; el preload expone una API mínima por `contextBridge`. | Implementado; falta `sandbox: true`. |
| CSP | `default-src 'self'`, `script-src 'self'`, `connect-src` limitado a Firebase | `host-app/index.html`, `client-app/index.html` | Restringe scripts, estilos y conexiones del renderer. | Implementado; `style-src` permite `unsafe-inline`. |
| Fuses de Electron | `RunAsNode` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, integridad ASAR on, cifrado de cookies on | `host-app/forge.config.ts`, `client-app/forge.config.ts` | Impide modos de ejecución peligrosos y valida el empaquetado. | Implementado; no sustituye la firma de código. |
| Preload mínimo | Métodos explícitos para entrada, portapapeles, pares, cámara y ventana | `host-app/src/preload.ts`, `client-app/src/preload.ts` | El renderer solo puede llamar a los `ipcRenderer` expuestos. | Implementado; los secretos de prueba se exponen por `additionalArguments`. |
| DTLS-SRTP | WebRTC nativo de Electron y `io.github.webrtc-sdk` | `signaling.ts`, `WebRtcCameraClient.kt` | Cifra y autentica media y DataChannel en tránsito. | Implementado; sin E2EE de aplicación. |
| ICE y STUN | `stun:stun.l.google.com:19302` | `signaling.ts` | Descubre candidatos y atraviesa NAT. | Implementado; sin TURN. |
| Código de sesión | 6 caracteres de un alfabeto de 31 símbolos; TTL de 10 min | `signaling.ts`, `config.ts` | Genera una ruta `sessions/{code}` y expira la sesión manual. | Implementado; enumerable y sin autenticación. |
| PIN opcional | `pinHash = SHA-256(pin)` | `signaling.ts` | El cliente envía el PIN; el host compara el hash. | Implementado; sin longitud mínima, rate limit ni KDF. |
| Token de emparejamiento | `token = SHA-256(secret)`; `tokenHash` publicado | `pairing.ts`, `signaling.ts` | El host compara el token recibido con su hash. | Implementado; portador estático y reutilizable. |
| `attemptId` | 12 caracteres aleatorios por negociación | `signaling.ts` | Etiqueta candidatos y descarta los de intentos anteriores. | Implementado. |
| Keepalive y liveness | Ping cada 5 s; host declara caída a los 20 s; cliente a los 15 s; gracia ICE de 8 s | `signaling.ts` | Detecta canales muertos y sesiones fantasma. | Implementado. |
| Ventanas de frescura | 30 s para apagado; 60 s para cámara; 30 s para probe | `config.ts`, `presence.ts`, `TabletActivity.kt` | Ignora comandos viejos que quedaron en un documento. | Implementado; no autentica, solo limita la ventana. |
| Rate limit de probe | 10 solicitudes por minuto | `functions/src/index.ts` | Cuenta en `probe/rate` y rechaza el exceso. | Implementado; “fail-open” y no es barrera de seguridad. |
| Autenticación del helper | Secreto de emparejamiento comparado en el primer mensaje | `host-app/src/main.ts` | Rechaza conexiones que no presentan el secreto. | Implementado; secreto estático, sin TLS ni nonce. |
| Helper elevado | Tarea programada con `HighestAvailable` | `host-app/src/main.ts` | Separa la captura (usuario normal) de la inyección (elevada) para cruzar UIPI. | Implementado; el helper puede inyectar en ventanas elevadas. |
| Autoarranque | Dos tareas programadas: host normal y helper elevado | `host-app/src/main.ts` | Inicia ambos al abrir sesión de Windows y los oculta. | Implementado; no se verificó el binario empaquetado en esta fase. |
| Almacenamiento local | JSON y SharedPreferences | `main.ts`, `pairing.ts`, `SettingsManager.kt` | Guarda `hostId`, secreto, pares y preferencias. | Implementado; sin cifrado del sistema. |
| Permisos Android | INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS, CAMERA | `AndroidManifest.xml` | Declara solo lo necesario; cámara se pide en runtime. | Implementado; `allowBackup` sigue en `true`. |
| Componentes Android | Solo `MainActivity` exportada; actividades y servicio no exportados | `AndroidManifest.xml` | Reduce la superficie de invocación externa. | Implementado. |
| Servicio en primer plano | `specialUse` con notificación persistente | `PcListenService.kt` | Mantiene la escucha de comandos y el polling de WoL sin límite de 6 h. | Implementado; falta declaración de Play y no hay receptor de arranque. |
| Rotación de logs | `isis-host.log` con corte a 2 MB | `host-app/src/main.ts` | Evita crecimiento indefinido y conserva diagnóstico. | Implementado; sin redacción de datos sensibles. |

Tres observaciones se desprenden del inventario. Primera: hay controles de **disponibilidad y consistencia** bien pensados (`attemptId`, keepalive, frescura, purga de candidatos, TTL, rate limit). Segunda: los controles de **confidencialidad del transporte** son estándar y correctos (TLS, DTLS-SRTP, CSP, aislamiento de Electron). Tercera: los controles de **identidad y autorización** son los más débiles, y son justamente los que separan un prototipo de un sistema seguro. La tabla 6.4 enumera lo que falta o está mal implementado.

**Tabla 6.4.** Controles ausentes o débiles.

| ID | Control ausente o débil | Por qué importa | Evidencia | Riesgo asociado |
| --- | --- | --- | --- | --- |
| C1 | Autenticación de usuarios y App Check | Cualquiera con la API key puede llamar a Firestore; las reglas son la única barrera y están abiertas. | `firestore.rules`, `config.ts` | R2, R14 |
| C2 | Credencial de servicio fuera del APK | La clave privada permite acceso administrativo y no se puede restringir a un dispositivo. | `firestore_config.py` | R1 |
| C3 | Token de emparejamiento con desafío-respuesta | El token es un portador estático; el verificador se publica. | `pairing.ts`, `signaling.ts` | R3 |
| C4 | Secreto de alta entropía y KDF | 8 caracteres ≈ 39,6 bits; SHA-256 es rápido y no es KDF. | `pairing.ts` | R4 |
| C5 | Autenticación de comandos de energía y cámara | `hostId` no es un secreto; el timestamp solo evita comandos viejos. | `presence.ts`, `tablet.ts` | R5, R6 |
| C6 | Cifrado de secretos en reposo | JSON y SharedPreferences en claro; `allowBackup=true`. | `main.ts`, `SettingsManager.kt`, `AndroidManifest.xml` | R8 |
| C7 | Protección del helper elevado | Secreto de 8 caracteres, TCP sin TLS, autenticación unilateral. | `host-app/src/main.ts` | R9 |
| C8 | Integridad de señalización | Un atacante con escritura en Firestore puede sustituir SDP/fingerprint. | `signaling.ts` | R10 |
| C9 | TURN y diagnóstico de NAT | Sin relay, el NAT simétrico y algunas redes móviles fallan. | `signaling.ts` | R11 |
| C10 | E2EE de aplicación | DTLS-SRTP termina en el peer; el host ve el portapapeles y la entrada en claro. | `control.ts`, `App.tsx` | R12 |
| C11 | Redacción y retención de logs | Los logs pueden contener IPs, rutas, nombres de dispositivo y códigos. | `host-app/src/main.ts` | R13 |
| C12 | Firma de código, notarización y actualización firmada | Un binario alterado no se distingue del legítimo. | `forge.config.ts` | R1, R9 |
| C13 | Límites de escritura y presupuesto por usuario | Las reglas abiertas permiten inundar documentos y agotar cuotas. | `firestore.rules`, `functions/src/index.ts` | R14 |
| C14 | Rate limit y bloqueo de PIN/sesión | El PIN se puede probar sin límite; el hash está publicado. | `signaling.ts` | R7 |
| C15 | Endurecimiento de release Android | `isMinifyEnabled=false`, sin `signingConfig`, sin ofuscación. | `app/build.gradle.kts` | R1, R8 |
| C16 | Consentimiento y indicador de cámara | No hay pantalla de consentimiento ni indicador persistente fuera de la app. | `TabletActivity.kt` | R6 |

## 6.4 Identidad y emparejamiento

El emparejamiento persistente es el corazón del modelo de identidad. El host genera un `hostId` de 8 caracteres y un `secret` de 8 caracteres con el alfabeto `abcdefghjkmnpqrstuvwxyz23456789` (31 símbolos). Guarda el secreto en `userData/isis-host.json` y publica en `sessions/{hostId}` únicamente `tokenHash = SHA-256(secret)`. El cliente guarda `id`, `name`, `secret`, `createdAt` y `lastConnectedAt` en `userData/isis-pairs.json`; al conectar envía `token = SHA-256(secret)` junto con la oferta. El host compara el token con su hash y rechaza si falta o no coincide (`pair_token_missing`, `pair_token_invalid`).

La intención es correcta: el secreto no viaja en claro y el documento público no lo contiene. El problema es que **el hash publicado es exactamente el valor que el host acepta como prueba**. La comparación es `hash === data.token`, y `tokenHash` está en el mismo documento que cualquiera puede leer. Por tanto, `tokenHash` no es un verificador resistente: es una contraseña equivalente. Un atacante que lea `sessions/{hostId}` puede copiar `tokenHash`, ponerlo en el campo `token` de su propia oferta y ser aceptado sin conocer el secreto. La misma propiedad se repite en la cámara de la tablet: la tablet publica `tokenHash` en `tablet_stream/{hostId}` y luego acepta `command.token == sha256(secret)`.

A esto se suman dos debilidades:

1. **Entropía insuficiente.** El secreto tiene 8 caracteres de 31 símbolos: \(31^8 = 852.891.037.441\), es decir, \(\log_2(31^8) \approx 39,6\) bits. SHA-256 es una función rápida, sin sal ni iteraciones (NIST, 2015); si el hash se expone, un atacante con GPU puede probar el espacio completo en tiempos del orden de segundos o minutos, no de años. La recomendación de NIST para autenticadores memorables es de al menos 112 bits de entropía efectiva (Grassi et al., 2017); este esquema está muy lejos.
2. **Estaticidad y ausencia de revocación por dispositivo.** El token no cambia entre sesiones ni expira. Solo se invalida si el usuario regenera el emparejamiento (`regeneratePairing`), lo que obliga a reemparejar todos los clientes. No hay identificador de dispositivo, lista de revocación, auditoría de uso ni rotación programada. Un token filtrado sigue siendo válido hasta que el usuario lo note.

La app Android añade una confusión adicional: guarda `hostId` y secreto en SharedPreferences y los usa para apuntar presencia y probe al host elegido, pero `validatePair()` lee `presence/{hostId}` para mostrar el nombre del equipo y **no autentica** el secreto contra el host. Es decir, el emparejamiento Android funciona como un puntero de documento, no como una prueba de identidad. Esto es coherente con las reglas abiertas, pero no debe confundirse con autenticación.

**Qué hacer.** La solución correcta es un protocolo de desafío-respuesta: el host emite un `nonce` impredecible y de un solo uso; el cliente responde `HMAC-SHA-256(secret, nonce || hostId || sessionId || timestamp)`; el host verifica y consume el nonce. El verificador nunca se publica. El secreto debe tener al menos 128 bits (por ejemplo, 26 caracteres del alfabeto o 32 bytes en base64url) y compararse en tiempo constante. Para un nivel superior, un PAKE como SPAKE2 u OPAQUE evita que un atacante con acceso al servidor de señalización pueda hacer un ataque de diccionario offline. Firebase Auth con custom tokens, emitidos por una Cloud Function después de un emparejamiento controlado, es la opción con menos código propio y la que mejor se integra con reglas y App Check.

## 6.5 Códigos de sesión, PIN y control de acceso

La sesión manual usa un código de 6 caracteres del mismo alfabeto: \(31^6 = 887.503.681\), \(\log_2 \approx 29,7\) bits. El host publica `sessions/{code}` en estado `waiting`, con `machineCode`, `deviceName`, `pinProtected`, `pinHash` si hay PIN, `createdAt`, `updatedAt` y `expiresAt` (10 minutos). El cliente lee el documento, valida existencia, estado, PIN y token, y negocia.

El código no es un control de acceso sólido por tres razones. Primera: con reglas abiertas, un atacante puede listar la colección `sessions` y ver todos los códigos en estado `waiting`; no necesita adivinarlos. Segunda: aunque las reglas se cerraran, no hay rate limit de intentos ni bloqueo; 29,7 bits son pocos para un atacante con automatización. Tercera: el PIN es opcional y no tiene longitud mínima, complejidad ni límite de intentos. Su hash se publica en el documento, de modo que un PIN de 4 dígitos (10.000 combinaciones) se recupera al instante. La comparación de hashes no es en tiempo constante, aunque el canal remoto hace poco práctico un ataque de temporización.

El TTL de 10 minutos y la regla de una sola sesión activa reducen la ventana y la concurrencia, pero no sustituyen la autenticación. La conclusión es directa: **el código de sesión debe tratarse como un identificador de routing, no como un secreto**. Si el producto necesita que el código sea la barrera de acceso, debe exigir un PIN fuerte, verificar del lado del servidor, limitar intentos, no publicar el hash y auditar los fallos. La opción más robusta es autenticar a ambos extremos con Firebase Auth y usar el código solo para enrutar la oferta.

## 6.6 Reglas de Firestore y modelo de confianza

El archivo `firestore.rules` es explícito: es una **copia del posture documentado**, no una exportación confirmada de la consola. Esa advertencia es importante; el estado desplegado puede diferir. Las reglas versionadas permiten `read, write: if true` en `sessions` y sus subcolecciones, `presence` y sus subcolecciones, `pc_commands`, `tablet_commands`, `tablet_stream` y sus subcolecciones, `tablet_presence` y `_healthcheck`; el resto queda cerrado por la regla final. Los comentarios justifican la apertura: el host y el cliente usan el SDK web sin Auth, la tablet usa una cuenta de servicio que salta las reglas, y `presence` “no decide nada sensible”. Esa justificación es coherente con un prototipo, pero incompatible con producción.

Las consecuencias de las reglas abiertas son:

- **Lectura total:** cualquiera puede enumerar sesiones, presencia, comandos, streams y presencia de tablets. Se exponen `hostId`, `deviceName`, `lastLocalIp`, SDP, candidatos ICE, `tokenHash`, `pinHash`, estados y timestamps.
- **Escritura total:** cualquiera puede crear, modificar o borrar documentos; inyectar ofertas; cambiar una respuesta; marcar una PC como online/offline; escribir un apagado; publicar un stream falso; borrar evidencia.
- **Saltarse la lógica:** las reglas no validan campos ni transiciones de estado. Un cliente puede escribir `status: "active"` sin negociar, o `powerOn: false` sin ser el cliente legítimo.
- **Costo y disponibilidad:** inundar documentos o candidatos incrementa lecturas, escrituras y costo; un atacante puede agotar la capa gratuita y provocar denegación de servicio.
- **Bypass de la cuenta de servicio:** la tablet no pasa por las reglas; cualquier regla que se escriba no la afecta. La credencial del APK es, en la práctica, la política de acceso más poderosa del sistema.

La API key web (`AIza...`) no es un secreto y no debe tratarse como tal; su presencia en el cliente es normal. Lo que falta es **Firebase Auth** para identificar a los usuarios y **App Check** para atestiguar que la llamada viene de la app legítima (Firebase, 2026a, 2026b). Sin esas dos piezas, las reglas no pueden distinguir a un host de un atacante.

Un esquema endurecido debería: negar por defecto; exigir `request.auth != null`; separar lectura y escritura por colección; validar `keys().hasOnly([...])`, tipos y transiciones; impedir que el cliente escriba campos privilegiados (`tokenHash`, `pinHash`, `status`, `powerOn`); mover las escrituras sensibles a Cloud Functions con Admin SDK; y probar las reglas en el emulador antes de desplegarlas. También debería desplegarse desde CI y comparar el archivo con la consola, porque hoy el repositorio no garantiza que lo versionado sea lo activo.

## 6.7 Medios WebRTC, señalización e integridad

WebRTC ofrece cifrado y autenticación de medios con DTLS-SRTP (Baugher et al., 2004; Rescorla, 2018, 2021). El canal de datos usa SCTP sobre DTLS (Stewart, 2007). ICE descubre la ruta (Keranen et al., 2018), STUN descubre la dirección pública (Rosenberg et al., 2008a) y TURN retransmite cuando la conexión directa no es posible (Rosenberg et al., 2008b). La especificación W3C define el modelo de sesión y las APIs que ambos extremos implementan (W3C, 2024). IsisAnubis usa STUN público y no usa TURN.

Esa base es sólida para la **confidencialidad e integridad del transporte**: un observador pasivo en la red no puede leer el video, el audio ni el DataChannel, y no puede modificarlos sin romper DTLS. Pero WebRTC **no autentica la señalización**. El fingerprint DTLS viaja en el SDP; si un atacante puede escribir la oferta o la respuesta en Firestore, puede sustituir el fingerprint por el suyo y situarse en el medio, o aceptar la sesión como si fuera el peer legítimo. DTLS protege contra un tercero pasivo, no contra un signaling comprometido. En IsisAnubis, la señalización está en documentos abiertos y no tiene firma, MAC ni nonce: la integridad de la sesión depende de que nadie escriba en Firestore.

Otros riesgos del plano de medios:

- **Exposición de IPs y metadatos.** SDP y ICE candidates revelan IPs locales y públicas, códecs, versiones y nombres de dispositivo. En un documento público, eso facilita reconocimiento y correlación (A8).
- **Sin TURN.** El sistema falla en NAT simétrico, redes móviles restrictivas o firewalls UDP. No es solo un problema de disponibilidad: empuja al usuario a redes más permisivas o a soluciones externas.
- **Sin E2EE de aplicación.** DTLS-SRTP termina en el peer, así que el host ve el portapapeles y la entrada en claro; si el host está comprometido, no hay una capa adicional que proteja el contenido. Para el modelo de amenaza actual (host confiable) es aceptable; para un host compartido o administrado por un tercero, no.
- **Portapapeles y entrada por DataChannel.** Viajan como JSON dentro de SCTP/DTLS. No hay cifrado adicional ni control de tamaño; un mensaje enorme puede afectar la memoria o la UI.
- **Inundación de candidatos.** Las subcolecciones `clientCandidates` y `hostCandidates` no tienen límite por intento; un atacante puede escribir miles de documentos y aumentar lecturas, costo y tiempo de negociación.

**Qué hacer.** Firmar o autenticar los mensajes de señalización con un secreto compartido y un nonce; verificar el fingerprint fuera de banda; limitar el tamaño y la cantidad de candidatos; usar TURN con credenciales efímeras; y, si el modelo de amenaza incluye al host, añadir una capa de E2EE de aplicación para entrada y portapapeles. La integridad de la señalización es más urgente que el E2EE: sin ella, un atacante con escritura puede elegir el peer.

## 6.8 Almacenamiento local de secretos

El host guarda `hostId`, `secret`, `deviceName`, `service`, `autostart` y `desktopAudio` en `userData/isis-host.json`, un JSON en claro. El cliente guarda los pares en `userData/isis-pairs.json`, también en claro, con `id`, `name`, `secret`, `createdAt` y `lastConnectedAt`. La tablet guarda `hostId`, secreto y nombre en SharedPreferences con `MODE_PRIVATE`. En ninguno de los tres casos se usa el almacén cifrado del sistema (`safeStorage` en Electron, Keychain en macOS, Keystore/EncryptedSharedPreferences en Android). En Android, además, la configuración de backup por defecto puede incluir las preferencias de la app si no se excluyen (Android Developers, 2026b).

Hay una fuga adicional: en modo de prueba, el host y el cliente reciben el secreto por `additionalArguments` (`--isis-pair-secret=...`, `--isis-pair=<id>,<secret>`). Esos argumentos quedan en la línea de comandos del proceso y son visibles para otros procesos de la misma cuenta; el preload los expone además al renderer. Aunque el modo de prueba no sea el flujo normal, un usuario podría usarlo y filtrar el secreto sin saberlo. Los logs rotativos (`isis-host.log`, 2 MB) no están pensados para contener secretos, pero pueden incluir IPs, rutas, nombres de dispositivo y códigos de sesión; sin redacción, son una fuente de reconocimiento.

El impacto es fundamentalmente local: malware con la misma cuenta, un backup de Android, un usuario con acceso físico o un forense. En un host desatendido, el archivo de configuración es además un objetivo de persistencia: quien lo lea puede reemparejarse o conectar al helper. La recomendación es usar el almacén del sistema, permisos restrictivos (0600 en POSIX; ACL solo para el usuario en Windows), exclusión de backups y redacción de logs. Los secretos no deben viajar por `argv`; si se necesitan para pruebas, deben pasarse por variable de entorno efímera o por un archivo temporal con permisos restringidos y borrarse al terminar.

## 6.9 Endurecimiento de Electron

Los controles implementados son correctos y conviene reconocerlos. Ambos procesos crean `BrowserWindow` con `contextIsolation: true` y `nodeIntegration: false`; el preload expone una API acotada mediante `contextBridge`; el HTML declara una CSP que limita scripts a `'self'` y conexiones a Firebase; los fuses desactivan `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` y `EnableNodeCliInspectArguments`, activan `OnlyLoadAppFromAsar`, la validación de integridad ASAR y el cifrado de cookies. Para un prototipo, es una base mejor que la media.

Faltan, sin embargo, controles que Electron recomienda explícitamente (Electron, 2026a, 2026b):

- **`sandbox: true`** en los renderers. Hoy el preload tiene acceso a Node y el renderer no está en sandbox; el aislamiento depende de que el preload no exponga más de lo necesario.
- **Denegación de navegación y ventanas nuevas.** No hay `will-navigate` ni `setWindowOpenHandler` que bloqueen destinos externos. Si un enlace o un contenido comprometido intenta navegar, el comportamiento por defecto puede abrir una ventana.
- **Manejador de permisos.** No hay `setPermissionRequestHandler`; las solicitudes de cámara, micrófono, portapapeles o notificaciones no se filtran por origen.
- **Validación del remitente de IPC.** Los handlers de `ipcMain` no comprueban `event.senderFrame.url` ni el origen; un renderer comprometido podría invocar métodos expuestos.
- **Firma de código y notarización.** Los binarios no están firmados; un atacante que reemplace el ejecutable no puede ser detectado por el usuario ni por el sistema.
- **Actualización firmada.** No hay autoactualización ni verificación de firma; el canal de distribución es manual.
- **CSP más estricta.** `style-src` permite `'unsafe-inline'`; no es crítico, pero se puede endurecer con hashes o nonces.

La combinación de `contextIsolation`, preload mínimo y fuses reduce mucho la probabilidad de una ejecución remota de código en el renderer, pero no la elimina. Si un atacante logra ejecutar JavaScript en el renderer, puede usar la API expuesta para enviar entrada, leer o escribir el portapapeles y abrir la ventana de cámara. La recomendación es tratar el renderer como no confiable: sandbox, permisos por origen, navegación denegada, validación de remitente y firma de código.

## 6.10 Helper elevado de Windows

El host principal corre con la sesión normal del usuario para conservar la captura de pantalla. La inyección de entrada se delega a un proceso separado, `--isis-input-helper`, que se registra con el Programador de tareas con `HighestAvailable` y escucha en `127.0.0.1:47831`. El primer mensaje debe ser `{ "type": "auth", "secret": "<secreto>" }`; si coincide con `loadConfig().secret`, el helper acepta comandos `input`, `reset` y `shutdown`. El objetivo es cruzar UIPI: una ventana elevada no acepta entrada de un proceso de integridad media, y el helper elevado sí (Microsoft, 2024).

El diseño es funcional, pero su autenticación es débil:

- **Secreto de 8 caracteres.** El mismo secreto de emparejamiento, con 39,6 bits de entropía, protege el canal. Un proceso local puede intentar conectarse y probar; no hay rate limit ni bloqueo.
- **TCP sin TLS ni HMAC.** El secreto viaja en claro por loopback. Un proceso con capacidad de sniffing local (normalmente requiere privilegios) puede capturarlo y reutilizarlo. No hay nonce ni autenticación mutua: el cliente no verifica que el servidor sea el helper legítimo.
- **Secuestro del puerto.** Si un proceso malicioso se enlaza a `127.0.0.1:47831` antes que el helper, el host puede conectarse y enviarle el secreto. El helper legítimo fallaría al enlazar y el host quedaría sin la ruta elevada, pero el atacante ya tendría la credencial.
- **Superficie de comandos.** `input` permite inyectar mouse y teclado en la sesión elevada; `shutdown` cierra el helper. No hay lista de comandos permitidos por origen ni auditoría de quién los envía.
- **Persistencia.** La tarea programada `HighestAvailable` se crea y se elimina con `schtasks`; si un atacante modifica la tarea, puede ejecutar otro binario con elevación. La firma de código y la integridad de la tarea no se verifican.

**Qué hacer.** Sustituir TCP por un named pipe con descriptor de seguridad que solo permita al usuario del host y a SYSTEM; autenticar con un nonce y HMAC, no con un secreto estático; verificar la ruta y la firma del ejecutable del helper; limitar los comandos y auditar; y no exponer `shutdown` por el mismo canal. Si el helper se ejecuta elevado, debe asumirse que un compromiso del helper es un compromiso de la sesión elevada.

## 6.11 Aplicación Android y cuenta de servicio embebida

El hallazgo más grave del proyecto está en `app/src/main/python/firestore_config.py`: el APK incluye un diccionario `SERVICE_ACCOUNT` con `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id` y `token_uri`. El propio archivo advierte que la clave da “acceso total (IAM) a Firestore” y que no se debe publicar el APK ni compartir el archivo. La clave privada no se reproduce aquí por razones obvias; basta decir que está completa y que es válida para firmar JWT RS256.

El puente Python/Chaquopy firma un JWT con esa clave, lo intercambia por un token OAuth2 con scope `https://www.googleapis.com/auth/datastore` y llama a la API REST de Firestore. Ese token **no pasa por las reglas de Firestore**: las cuentas de servicio con permisos de Firestore las ignoran. Por eso la tablet puede leer y escribir `presence`, `pc_commands`, `tablet_commands`, `tablet_stream` y `tablet_presence` aunque las reglas estén cerradas o abiertas. La credencial es, en la práctica, la llave maestra del proyecto.

Las consecuencias son:

- **Extracción trivial.** Un APK es un archivo ZIP; las cadenas y los recursos Python se pueden extraer con `unzip`, `apktool`, `jadx` o un simple `strings`. No hace falta ingeniería inversa avanzada.
- **Uso fuera del dispositivo.** La clave no está atada al APK, a la tablet ni a un certificado. Cualquiera que la obtenga puede usarla desde una laptop, un servidor o un contenedor, sin App Check ni atestación.
- **Persistencia.** La clave no expira y no se rota automáticamente. Aunque se borre el archivo, sigue en el historial de Git, en copias locales y en APKs ya distribuidos.
- **Alcance incierto pero amplio.** El archivo afirma acceso total a Firestore; el rol IAM exacto debe verificarse en Google Cloud. Si la cuenta tiene permisos de Editor u Owner, el impacto se extiende a otros recursos del proyecto.
- **Costo y abuso.** Un atacante puede inundar Firestore, borrar documentos o ejecutar consultas costosas; la factura y la disponibilidad quedan expuestas.
- **Falsa sensación de seguridad.** Las reglas abiertas se justifican porque “la tablet usa una cuenta de servicio”; pero esa cuenta es precisamente el eslabón que hay que proteger. La existencia de la cuenta de servicio no es una defensa: es la vulnerabilidad.

**Remediación inmediata.** Revocar la clave en Google Cloud IAM; crear una nueva solo si es imprescindible y con el rol mínimo; eliminar el archivo del repositorio y purgar el historial; auditar los logs de Firestore y de la cuenta; revisar la facturación; y asumir que la clave anterior está comprometida. No basta con borrar el archivo en un commit nuevo.

**Remediación estructural.** Migrar la app Android a Firebase Auth con custom tokens emitidos por una Cloud Function después de un emparejamiento verificado, o a un proxy de Cloud Functions que reciba comandos autenticados y hable con Firestore con una cuenta de servicio del servidor. La cuenta de servicio nunca debe viajar al cliente. Si por alguna razón se mantiene una credencial en el dispositivo, debe tener el rol más restrictivo posible, rotación automática, App Check y un mecanismo de revocación; aun así, no se recomienda. Google Cloud documenta que las claves de cuenta de servicio son credenciales de larga duración y que deben evitarse cuando sea posible (Google Cloud, 2026a, 2026b).

## 6.12 Permisos, componentes y servicios Android

El manifiesto declara seis permisos: `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS` y `CAMERA`. No solicita almacenamiento, ubicación, micrófono, contactos ni `QUERY_ALL_PACKAGES`. La minimización es correcta y debe mantenerse. La cámara se pide en runtime y solo se usa desde `TabletActivity`; el servicio en primer plano publica una notificación persistente; `specialUse` evita el límite de ~6 horas diarias de `dataSync` en Android 15+ (Android Developers, 2026a).

Los componentes también están razonablemente acotados: solo `MainActivity` es exportada (launcher); `PhoneActivity`, `TabletActivity`, `SettingsActivity` y `PcListenService` no lo son. El servicio no tiene receptor de arranque (`BOOT_COMPLETED`), así que no se reinicia solo tras un reinicio del dispositivo; eso reduce la persistencia maliciosa, pero también la disponibilidad de la tablet desatendida. `START_STICKY` ayuda a que Android lo recree si el sistema lo mata, no si el usuario reinicia.

Los problemas están en la configuración de release y en los datos:

- **`allowBackup="true"`** con reglas de backup y extracción vacías. Las SharedPreferences que contienen `hostId` y secreto pueden entrar en el backup de Google o en una transferencia entre dispositivos. En un dispositivo con root o depuración, también son legibles.
- **`isMinifyEnabled = false`** y sin `signingConfig` de release. El APK no se ofusca ni se reduce; el código Kotlin y los recursos Python quedan más expuestos. Sin firma de release, la distribución es cuando menos informal.
- **Python embebido.** Chaquopy incluye el intérprete y los módulos Python en el APK; la clave y la lógica de Firestore son visibles. La ofuscación no resuelve el problema de fondo, pero eleva el costo de extracción.
- **Servicio en primer plano.** `specialUse` requiere una declaración en Play Console y una justificación; si se publica, la política debe cumplirse. La notificación es el único indicador persistente; no hay un indicador visual de cámara fuera de la app.
- **Sin `networkSecurityConfig`.** No se necesita cleartext, pero una configuración explícita que prohíba tráfico claro y fije los dominios esperados reduce el riesgo de configuración accidental.

**Qué hacer.** `allowBackup="false"` o reglas que excluyan las SharedPreferences sensibles; `minifyEnabled=true` con reglas de R8; firma de release y gestión de keystore fuera del repositorio; `networkSecurityConfig` con `cleartextTrafficPermitted="false"`; y una revisión de la declaración `specialUse` antes de publicar. La clave de servicio debe desaparecer del APK, no solo ofuscarse.

## 6.13 Presencia, probe, apagado remoto y Wake-on-LAN

La presencia es un estado para la UI, no una frontera de seguridad. El host publica `presence/{hostId}` cada 5 minutos y en eventos de `powerMonitor`; la app Android lee sin escribir; si `lastHeartbeatAt` tiene más de 10 minutos, la UI muestra “sin señal”. El probe es un ida y vuelta: el teléfono escribe `probe/pending` con un `requestId`; la Cloud Function aplica el rate limit y marca `dispatched`; el host responde en `probe/answer`; el teléfono declara timeout a los 25 s. El rate limit de 10/min protege la cuota, no la autenticidad: la Function falla abierta si no puede leer el contador, y las reglas abiertas permiten escribir `answer` directamente.

El apagado remoto es el caso más claro de una acción sensible sin autenticación. El host escucha `pc_commands/{hostId}`; si recibe `powerOn: false` con un `timestamp` dentro de 30 s y no lo vio antes, publica `offline` y ejecuta `shutdown.exe /s /t 10` (o el equivalente en macOS/Linux). La ventana y la deduplicación evitan apagar la PC por un comando viejo, pero **no verifican quién envía**. Cualquiera que conozca el `hostId` —8 caracteres, enumerables— puede escribir el documento y apagar la máquina. Lo mismo aplica al alias legacy `pc_commands/desktop` que usa el WoL.

El WoL es, por diseño, un protocolo sin autenticación: el magic packet es un broadcast con la MAC repetida (AMD, 1995). La tablet lo envía cuando ve `powerOn: true` con un `timestamp` nuevo en `pc_commands/desktop`. Un atacante en la LAN puede enviar su propio magic packet o escribir el documento para que la tablet lo haga; el resultado es encender la PC sin autorización. La mitigación no es criptográfica en el paquete (el estándar no lo permite), sino en el control de quién puede ordenar el encendido y en la segmentación de la LAN.

**Qué hacer.** Autenticar los comandos con un HMAC por host y un nonce; exigir que el emisor esté autenticado; separar `pc_commands` por host y eliminar el alias `desktop`; deshabilitar el apagado remoto por defecto y pedir confirmación explícita; limitar la tasa de comandos; auditar; y no publicar `lastLocalIp` en un documento legible por cualquiera. Para el WoL, aceptar que el magic packet es spoofable y proteger la red, no solo el documento.

## 6.14 Cámara de la tablet

El flujo de cámara es un espejo del de sesión. El cliente escribe `tablet_commands/{hostId}` con `cameraStream: true`, `mode`, `timestamp`, `requestId` y `token = SHA-256(secret)`. La tablet lee el comando, verifica frescura (≤60 s) y token (`tokenOk = secret.isEmpty() || command.token == sha256Hex(secret)`), pide permiso de cámara si hace falta, crea/limpia `tablet_stream/{hostId}` con `tokenHash`, `requestId`, `deviceName`, `mode` y `status: waiting`, y negocia como respondedor. El cliente espera ver su `requestId` y negocia como oferente `recvonly` de video.

Los problemas son cuatro:

1. **Si no hay secreto, todo comando es válido.** `secret.isEmpty()` hace que `tokenOk` sea `true`. Una tablet sin emparejar acepta cualquier `cameraStream: true` con timestamp fresco. El modo por defecto no debería permitir cámara sin emparejamiento.
2. **El token es el hash publicado.** La tablet escribe `tokenHash` en `tablet_stream`; el cliente y cualquier lector pueden verlo. Como la comparación es `command.token == sha256(secret)`, el `tokenHash` publicado es un portador válido. Un atacante que lea el stream doc puede reutilizarlo.
3. **La oferta no se vincula al pedido.** `WebRtcCameraClient` lee la oferta de `tablet_stream` y responde; no compara el `tokenHash` de la oferta con el del comando ni con el `requestId` de forma criptográfica. Un atacante con escritura en `tablet_stream` puede insertar su propia oferta mientras la cámara está activa y recibir el video, o competir con el cliente legítimo.
4. **El documento de stream está abierto.** SDP, candidatos ICE y `tokenHash` son legibles; un atacante puede reconocer el dispositivo, la cámara y la red, y intentar el hijack descrito.

La ventana de exposición se reduce porque la cámara solo se activa con `TabletActivity` en primer plano, permiso concedido y un comando fresco. Pero esas condiciones son de **disponibilidad y consentimiento**, no de autenticación. La tablet muestra el estado de la cámara en la UI, pero no hay un indicador persistente fuera de la app ni una confirmación explícita del usuario para cada solicitud.

**Qué hacer.** Exigir emparejamiento para la cámara; usar un token efímero de un solo uso, ligado a `requestId` y al fingerprint de la oferta; validar el token en la oferta y en el comando; no publicar el verificador; pedir confirmación en la tablet (o al menos un indicador visible y un botón de detener); y cerrar la colección a escrituras no autenticadas. La cámara es el activo con mayor impacto de privacidad después de la pantalla; merece un control más estricto que el apagado remoto.

## 6.15 Registro de riesgos

La Figura 6.2 y la Tabla 6.5 consolidan los riesgos. La probabilidad y el impacto se estiman de 1 a 5 con el análisis estático y el modelo de amenazas; no son frecuencias medidas. La puntuación es \(P \times I\). Se usa el umbral de la figura: crítico ≥15, alto 9–14, medio/bajo <9.

**Figura 6.2.** Matriz de riesgos de seguridad.

![Matriz de riesgos de seguridad](docs/figuras/fig07_riesgos.png)

_Fuente: elaboración propia. Estimación cualitativa basada en el análisis estático, no en explotación._

**Tabla 6.5.** Registro de riesgos y mitigaciones.

| ID | Riesgo | Activo | P | I | Puntuación | Nivel | Control actual | Mitigación prioritaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Cuenta de servicio completa embebida en el APK | A5 | 5 | 5 | 25 | **Crítico** | Ninguno; el archivo advierte del riesgo | Revocar, rotar, purgar historial y migrar a Auth/proxy |
| R2 | Reglas de Firestore abiertas en colecciones núcleo | A1–A8 | 5 | 5 | 25 | **Crítico** | Regla final cerrada, pero colecciones núcleo abiertas | Auth, App Check, reglas por propietario y validación |
| R3 | Token de emparejamiento estático y reutilizable | A2, A4 | 4 | 5 | 20 | **Crítico** | `tokenHash` comparado con `token` | Desafío-respuesta con nonce; no publicar verificador |
| R4 | Secreto de 8 caracteres con SHA-256 simple | A4 | 4 | 4 | 16 | **Crítico** | Hash SHA-256; sin KDF | ≥128 bits; Argon2id/scrypt si se usa contraseña |
| R5 | Apagado remoto sin autenticación | A6 | 4 | 4 | 16 | **Crítico** | Ventana de 30 s y deduplicación | HMAC por host, emisor autenticado, deshabilitar por defecto |
| R6 | Activación o hijack de cámara | A7 | 3 | 5 | 15 | **Crítico** | Token y frescura; sin binding de oferta | Token efímero, confirmación, validar oferta, cerrar stream |
| R7 | PIN corto con hash expuesto | A2, A4 | 3 | 4 | 12 | **Alto** | PIN opcional; hash en el documento | PIN fuerte, rate limit, verificación server-side |
| R8 | Secretos locales en claro y backups | A4, A10 | 3 | 3 | 9 | **Alto** | Archivos locales; `MODE_PRIVATE` | safeStorage/Keystore; excluir backups; no usar `argv` |
| R9 | IPC elevado en loopback con secreto estático | A2 | 2 | 5 | 10 | **Alto** | Secreto de 8 caracteres; bind local | Named pipe con ACL, nonce/HMAC, firma del helper |
| R10 | Señalización sin integridad ni autenticación | A1, A2, A7 | 3 | 4 | 12 | **Alto** | DTLS-SRTP solo protege el transporte | Firmar SDP/fingerprint; verificación fuera de banda |
| R11 | Sin TURN; falla en NAT simétrico | A1, A2 | 4 | 2 | 8 | **Medio** | STUN público | TURN con credenciales efímeras; diagnóstico |
| R12 | Portapapeles sin E2EE | A3 | 2 | 3 | 6 | **Medio** | DTLS-SRTP | E2EE de aplicación si el host no es confiable |
| R13 | Fuga de datos en logs | A8, A10 | 2 | 3 | 6 | **Medio** | Rotación a 2 MB | Redacción, retención, acceso restringido |
| R14 | Abuso de cuota y costo | A5, A8 | 4 | 3 | 12 | **Alto** | Rate limit de probe 10/min | Presupuesto, alertas, límites por usuario, App Check |

La matriz muestra un patrón: los riesgos críticos no son de criptografía, sino de **autorización y manejo de credenciales**. DTLS-SRTP, TLS y CSP están bien; lo que falla es quién puede leer el documento, quién puede escribir la señalización y qué credencial lleva el APK. Por eso el plan de endurecimiento prioriza identidad, reglas y rotación antes que algoritmos.

## 6.16 Plan de endurecimiento priorizado

El plan se alinea con las seis funciones del NIST Cybersecurity Framework 2.0 —Gobernar, Identificar, Proteger, Detectar, Responder y Recuperar— para que cada acción tenga un lugar en el ciclo de vida y no quede como una lista aislada (NIST, 2024).

**Tabla 6.6.** Plan de endurecimiento P0/P1/P2.

| ID | Prioridad | Acción | Riesgo que atiende | Cómo se implementa | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| P0-1 | **P0** | Revocar y eliminar la clave de servicio | R1 | Revocar en IAM; borrar `firestore_config.py`; purgar historial; auditar logs; crear credencial nueva solo si es imprescindible | La clave vieja falla; el APK no contiene credenciales; no hay claves en el historial |
| P0-2 | **P0** | Migrar Android a Auth/proxy | R1, R2 | Custom tokens emitidos por Cloud Function o proxy de Functions; App Check; reglas por usuario | La app no usa cuenta de servicio; el acceso queda atribuido y limitado |
| P0-3 | **P0** | Cerrar reglas de Firestore | R2, R14 | Negar por defecto; Auth; validación de campos; pruebas en emulador; deploy desde CI | Un cliente anónimo no lee ni escribe; las pruebas de violación fallan |
| P0-4 | **P0** | Sustituir el token portador | R3, R4 | Nonce + HMAC-SHA-256; secreto ≥128 bits; comparación en tiempo constante; rotación | Un token capturado no se puede reutilizar; `tokenHash` no se publica |
| P0-5 | **P0** | Autenticar apagado y cámara | R5, R6 | Comando firmado/HMAC con nonce, timestamp y hostId; deshabilitar apagado por defecto; confirmación en tablet | Un tercero con `hostId` no puede apagar ni activar la cámara |
| P0-6 | **P0** | Escaneo de secretos y bloqueo en CI | R1, R8 | `gitleaks`/`trufflehog`; regla de pre-commit; revisión de historial | Un commit con secreto falla el pipeline |
| P1-1 | **P1** | Almacén de secretos del sistema | R8 | `safeStorage`/Keychain/Keystore; permisos 0600; excluir backups; quitar `argv` | Los secretos no están en claro ni en la línea de comandos |
| P1-2 | **P1** | Endurecer Electron | R9, R10 | `sandbox: true`; `will-navigate`; `setWindowOpenHandler`; permisos por origen; firma/notarización | Navegación y ventanas externas bloqueadas; binario firmado |
| P1-3 | **P1** | Endurecer release Android | R1, R8 | `allowBackup=false`; R8; firma de release; `networkSecurityConfig`; sin secretos | APK firmado, ofuscado y sin backup de secretos |
| P1-4 | **P1** | Añadir TURN y diagnóstico | R11 | coturn con credenciales efímeras; telemetría de candidatos | Sesión funcional en NAT simétrico y red móvil |
| P1-5 | **P1** | Pruebas y análisis continuo | R2, R10, R14 | T-01..T-25; SAST; dependencias; DAST; presupuesto de pruebas | Cada release ejecuta la matriz y no introduce hallazgos críticos |
| P1-6 | **P1** | Rate limit y bloqueo de PIN/sesión | R7, R14 | Límite por IP/hostId; backoff; bloqueo temporal; auditoría | Fuerza bruta de PIN/sesión inviable y registrada |
| P1-7 | **P1** | Redacción y retención de logs | R13 | Filtro de secretos/IPs; retención; acceso restringido | Los logs no contienen secretos ni datos personales innecesarios |
| P2-1 | **P2** | E2EE de aplicación | R12 | Cifrado extremo a extremo de entrada/portapapeles con claves derivadas | El host no ve el contenido si no es el destinatario |
| P2-2 | **P2** | Identidad por dispositivo y revocación | R3, R5 | Claves por dispositivo; lista de revocación; auditoría | Se puede revocar un dispositivo sin reemparejar todos |
| P2-3 | **P2** | Consentimiento e indicadores | R6 | Pantalla de consentimiento; indicador de cámara/control; política de privacidad | El usuario ve y puede retirar el consentimiento |
| P2-4 | **P2** | Monitoreo y respuesta | R1, R14 | Alertas de facturación, Firestore, IAM; runbooks | Un incidente se detecta y contiene en menos de 24 h |
| P2-5 | **P2** | Pentest independiente | Todos | Prueba externa con alcance acordado | Informe con hallazgos y remediaciones verificadas |
| P2-6 | **P2** | Réplica de mediciones | R11, R13 | Anexo F; datos abiertos; scripts | Resultados reproducibles y limitaciones declaradas |

**Secuencia recomendada.** Primero P0-1 y P0-6 (sacar la credencial y evitar que vuelva), luego P0-2 y P0-3 (identidad y reglas), después P0-4 y P0-5 (tokens y comandos). Sin ese orden, cerrar reglas puede romper la tablet y el host, y rotar la clave sin migrar la app deja el sistema sin acceso. Las P1 se ejecutan en paralelo por frentes: escritorio, Android, red y pruebas. Las P2 se planifican cuando el sistema ya opera con datos reales y hay una persona responsable de su mantenimiento.

## 6.17 Respuesta a incidentes y rotación de credenciales

Un incidente en IsisAnubis puede manifestarse como facturación anómala, lecturas o escrituras inusuales en Firestore, un apagado no solicitado, una cámara activa sin pedido, un cliente desconocido en la sesión o un reporte del usuario. El proceso mínimo es:

1. **Detectar y confirmar.** Revisar Cloud Audit Logs, métricas de Firestore, facturación, logs del host y el estado de las sesiones. No confiar solo en la UI: la presencia y el probe son estados, no pruebas.
2. **Contener.** Revocar la clave de servicio; rotar el secreto de emparejamiento; deshabilitar el apagado remoto; detener el servicio de la tablet; desconectar el host de la red si hay sospecha de compromiso; cambiar las reglas a deny temporal si es necesario.
3. **Erradicar.** Eliminar la causa: clave fuera del APK, reglas cerradas, token reemplazado, malware eliminado, tarea programada maliciosa borrada, dispositivo reimaginado si corresponde.
4. **Recuperar.** Crear credenciales nuevas, reemparejar dispositivos, verificar el funcionamiento, monitorear durante 72 horas y confirmar que no hay persistencia.
5. **Aprender.** Registrar línea de tiempo, causa raíz, impacto, acciones y lecciones; actualizar este documento, las pruebas y el plan.

**Playbook de clave filtrada.** Revocar la clave en IAM; comprobar si se usó desde IPs o proyectos inesperados; revisar Firestore y facturación; crear una clave nueva solo si no hay alternativa y con rol mínimo; eliminar el archivo y purgar el historial; reconstruir el APK sin la clave; distribuir solo la versión nueva; considerar la clave anterior comprometida para siempre.

**Playbook de secreto de emparejamiento filtrado.** Regenerar el par (`regeneratePairing`), invalidar todos los clientes, reemparejar uno por uno, revisar sesiones y comandos recientes, y comprobar si hubo apagados o cámaras no autorizadas. Si el secreto se usó para el helper, asumir que un proceso local pudo inyectar entrada y revisar la integridad del host.

**Playbook de host comprometido.** Asumir que pantalla, audio, portapapeles, entrada y secretos están comprometidos. Desconectar de la red, revisar tareas programadas (`schtasks /Query`), procesos, extensiones, reglas de firewall y el helper; rotar todas las credenciales; reimaginar el sistema si hay persistencia; y no reutilizar el mismo `hostId` sin analizar el alcance.

**Playbook de cámara.** Detener el stream, revocar el permiso de cámara, borrar `tablet_stream` y `tablet_commands`, revisar quién escribió y a qué hora, y avisar al usuario. Si la tablet estaba sin emparejar, la causa probable es la aceptación de comandos sin secreto.

## 6.18 Privacidad, consentimiento y cumplimiento

IsisAnubis trata datos de alto impacto: pantalla, audio, entrada, portapapeles, cámara y metadatos de presencia. Aunque el flujo multimedia sea P2P, el host y el cliente ven el contenido, y Firestore conserva señalización y metadatos. La privacidad no es un anexo legal: es parte del diseño.

**Tabla 6.7.** Privacidad y cumplimiento.

| Principio | Estado actual | Brecha | Acción recomendada |
| --- | --- | --- | --- |
| Consentimiento informado | Se asume en la operación; no hay pantalla explícita | El usuario del host puede no saber que es controlado | Pantalla de consentimiento y registro; indicador visible |
| Finalidad | Captura y control para acceso remoto | No hay política escrita ni límites de uso | Declarar finalidad y prohibir usos secundarios |
| Minimización | Se publican IP, deviceName, appVersion, uptime, idle | Metadatos innecesarios en documentos abiertos | Reducir campos; evitar IP pública; retención corta |
| Retención | TTL de sesiones; logs rotativos | Sin política de borrado de presencia, streams y backups | Definir plazos y borrado automático |
| Seguridad | DTLS-SRTP; secretos locales en claro | Credencial en APK; reglas abiertas; backups | P0/P1 del plan |
| Derechos | No hay interfaz de borrado ni exportación | El usuario no puede ejercer acceso/rectificación/supresión | UI de borrado; contacto; procedimiento |
| Transparencia | No hay indicador persistente de cámara/control | El usuario puede no saber que la cámara está activa | Indicador en pantalla y notificación |
| Base legal | No definida | Varía por jurisdicción (GDPR, LFPDPPP, etc.) | Revisión legal y consentimiento |
| Terceros | Firebase/Google Cloud | Falta DPA y evaluación de transferencias | Documentar proveedor, región y DPA |
| Incidentes | No hay notificación formal | Obligaciones legales de notificación | Runbook y plazos |

La tabla 6.7 no sustituye una evaluación legal. Su función es mostrar que el sistema necesita decisiones de privacidad antes de operar con datos de terceros. El sistema de gestión descrito en ISO/IEC 27001:2022 exige, además de los controles técnicos, responsabilidades, revisión por la dirección y mejora continua; nada de eso existe todavía en IsisAnubis (ISO/IEC, 2022a). Para un uso académico, basta con anonimizar las evidencias y no capturar pantallas con datos personales; para un uso real, hacen falta consentimiento, política, retención y derechos.

## 6.19 Checklist de despliegue seguro

La checklist traduce el plan y las funciones del NIST CSF 2.0 en verificaciones binarias que pueden auditarse antes de cada release (NIST, 2024).

**Tabla 6.8.** Checklist de despliegue seguro.

| N.º | Verificación | Criterio | Estado |
| --- | --- | --- | --- |
| 1 | Clave de servicio fuera del APK y del historial | El APK no contiene `private_key`; el historial no tiene la clave | **Pendiente (P0)** |
| 2 | Clave anterior revocada | La credencial vieja falla en IAM | **Pendiente (P0)** |
| 3 | Reglas de Firestore cerradas y probadas | Un cliente anónimo no lee ni escribe | **Pendiente (P0)** |
| 4 | Autenticación y App Check activos | Las llamadas no autenticadas se rechazan | **Pendiente (P0)** |
| 5 | Token de emparejamiento con nonce/HMAC | Un token capturado no se reutiliza | **Pendiente (P0)** |
| 6 | Comandos de energía y cámara autenticados | Un tercero con `hostId` no puede ejecutarlos | **Pendiente (P0)** |
| 7 | Secretos locales cifrados | `isis-host.json`, `isis-pairs.json` y SharedPreferences no tienen secretos en claro | **Pendiente (P1)** |
| 8 | Backups de Android excluidos | El backup no contiene el secreto | **Pendiente (P1)** |
| 9 | Electron con sandbox y navegación denegada | `sandbox: true`; `will-navigate` y `setWindowOpenHandler` | **Pendiente (P1)** |
| 10 | Firma y notarización | El binario está firmado y notarizado | **Pendiente (P1)** |
| 11 | Actualización firmada | La actualización verifica firma | **Pendiente (P1)** |
| 12 | TURN operativo | Sesión en NAT simétrico y red móvil | **Pendiente (P1)** |
| 13 | Rate limit y bloqueo de PIN | Fuerza bruta inviable | **Pendiente (P1)** |
| 14 | Logs redactados y retenidos | Sin secretos ni datos personales innecesarios | **Pendiente (P1)** |
| 15 | Pruebas T-01 a T-25 ejecutadas | Matriz completa con evidencia | **Pendiente (P1)** |
| 16 | SAST y dependencias | Sin hallazgos críticos abiertos | **Pendiente (P1)** |
| 17 | `allowBackup` y release Android | `allowBackup=false`; R8; firma | **Pendiente (P1)** |
| 18 | Indicador de cámara/control | Visible para el usuario | **Pendiente (P2)** |
| 19 | Consentimiento y política | Documento y UI | **Pendiente (P2)** |
| 20 | Monitoreo y alertas | Facturación, Firestore, IAM | **Pendiente (P2)** |
| 21 | Typecheck de escritorio | `pnpm typecheck` sin errores | **Hecho (2026-11-07)** |
| 22 | Compilación Android | `BUILD SUCCESSFUL` | **Hecho (2026-11-07)** |
| 23 | Documentación de seguridad | Capítulo 6 y anexos | **Hecho** |
| 24 | Revisión de reglas desplegadas | Archivo y consola coinciden | **Pendiente** |
| 25 | Pentest independiente | Informe y remediaciones | **Pendiente (P2)** |

La checklist se usa como puerta de release: ningún despliegue fuera del entorno personal debería ocurrir con un ítem P0 o P1 abierto. Los ítems “Hecho” de typecheck y compilación no implican seguridad; solo confirman que el código se construye. El Anexo G amplía esta lista con comandos y evidencias.
