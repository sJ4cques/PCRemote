# 2. Marco teórico y conceptual

## 2.1 Antecedentes y soluciones relacionadas

El escritorio remoto tiene una larga tradición en la informática. Los enfoques clásicos —RDP, VNC y sus variantes— se basan en un servidor que captura la pantalla y un cliente que la muestra, con un protocolo de actualización de regiones y un canal de entrada. RDP, desarrollado por Microsoft, está optimizado para Windows y ofrece integración con sesiones, impresoras, portapapeles y audio; VNC es más simple y multiplataforma, pero suele tener menor calidad de video y menos funciones de seguridad. Ambos requieren normalmente una red accesible o un túnel.

Las soluciones modernas de acceso remoto (Chrome Remote Desktop, TeamViewer, AnyDesk) añaden atraviesamiento de NAT, señalización en la nube, autenticación, relay cuando la conexión directa falla y funciones de colaboración. Su ventaja es la facilidad de uso; su costo es la dependencia de cuentas, la telemetría y, en algunos casos, licencias. El proyecto se inspira en Chrome Remote Desktop por su modelo de código de acceso y su simplicidad, pero se diferencia en que la señalización es propia (Firebase) y el código es auditable.

WebRTC, estandarizado por el IETF y el W3C, es la base técnica de los medios. Originalmente pensado para videoconferencia en el navegador, hoy se usa también en aplicaciones nativas (Electron, Android) y en sistemas de escritorio remoto. Su fortaleza es que resuelve la negociación de sesión, la conectividad (ICE/STUN/TURN), el cifrado (DTLS-SRTP) y los canales de datos (SCTP sobre DTLS), con una pila madura y ampliamente desplegada.

**Tabla 2.1.** Comparación de enfoques de escritorio remoto.

| Enfoque | Fortalezas | Limitaciones | Relación con IsisAnubis |
| --- | --- | --- | --- |
| RDP | Integración profunda con Windows, alto rendimiento en LAN, audio/portapapeles | Requiere Windows Pro/Server, configuración de red, autenticación de dominio | No se usa; el host es una app Electron, no un servicio RDP |
| VNC | Multiplataforma, protocolo simple, código abierto | Seguridad variable, calidad de video limitada, requiere red/túnel | Inspiración conceptual; no se usa |
| Chrome Remote Desktop | Código de acceso, atraviesa NAT con relay de Google, fácil de usar | Dependencia de cuenta Google, telemetría, poca personalización | Referencia de experiencia; la señalización es propia |
| TeamViewer / AnyDesk | Relay global, funciones empresariales, soporte | Licencias, cuentas, agentes propietarios, telemetría | Alternativa que el proyecto busca evitar |
| WebRTC P2P propio | Sin servidores de medios, cifrado estándar, bajo costo, auditable | NAT simétrico, señalización propia, más complejidad de seguridad | Base del proyecto |

## 2.2 Computación remota y escritorio remoto

Un sistema de escritorio remoto debe resolver cinco problemas:

1. **Captura:** obtener los píxeles de la pantalla y, opcionalmente, el audio del sistema.
2. **Codificación y transporte:** comprimir y enviar el flujo con latencia y ancho de banda aceptables.
3. **Presentación:** decodificar y mostrar el flujo en el cliente, con sincronización de audio y video.
4. **Entrada:** capturar mouse y teclado en el cliente, transportarlos y reconstruirlos en el host.
5. **Estado de sesión:** negociar, mantener, recuperar y cerrar la sesión, incluyendo presencia y reconexión.

La calidad de un escritorio remoto se mide por la latencia de ida y vuelta, la tasa de frames, el bitrate, la pérdida de paquetes, la nitidez y la sensación de respuesta del cursor. La latencia de input es especialmente crítica: un retardo de 100–200 ms se percibe como "pesado"; por encima de 300 ms la operación se vuelve incómoda. Por eso el proyecto prioriza el control del mouse y del teclado sobre la calidad visual absoluta.

Un concepto central es la **separación entre plano de control y plano de medios**. El plano de control (señalización) negocia direcciones, códecs, credenciales y estado; el plano de medios transporta video, audio y datos. En IsisAnubis, el primero usa Firestore y el segundo usa WebRTC P2P. Esta separación permite que una caída de Firestore no corte una sesión ya establecida, aunque impide reconectar si la señalización no vuelve.

## 2.3 Arquitectura peer-to-peer y señalización

En una arquitectura P2P, los extremos se conectan directamente. Para lograrlo necesitan intercambiar:

- **Descripción de sesión (SDP):** códecs, direcciones, puertos, huellas DTLS y direcciones de medios.
- **Candidatos ICE:** combinaciones de IP, puerto y protocolo por las que se puede intentar la conexión.
- **Credenciales y estado:** quién es el oferente, quién responde, si la sesión está activa o cerrada.

La señalización es el "servicio de citas" que permite ese intercambio. Puede implementarse con WebSockets, HTTP, un broker MQTT o, como en este caso, una base de datos en tiempo real. Firestore ofrece documentos, colecciones, subcolecciones y listeners; el host y el cliente escriben y observan documentos, y la latencia de propagación es suficiente para una negociación que dura segundos.

La topología de IsisAnubis es asimétrica:

- El **host** crea la sesión y espera; es el respondedor WebRTC y el dueño de la captura.
- El **cliente** busca la sesión, crea la oferta y es el oferente; recibe video/audio y envía control.
- La **tablet Android** no es un par de la sesión de escritorio: es un nodo auxiliar que lee presencia, envía Wake-on-LAN y, si se le pide, transmite su cámara por un WebRTC separado.
- **Firebase** es el punto de encuentro y el almacén de estado; **STUN** ayuda a descubrir la dirección pública.

## 2.4 WebRTC: ICE, STUN, TURN, DTLS-SRTP y canales de datos

**ICE (Interactive Connectivity Establishment)** es el marco de negociación de conectividad. Reúne candidatos (host, servidor reflexivo y relay), los prioriza y prueba pares hasta encontrar una ruta. **STUN** permite descubrir la dirección pública y el puerto asignado por NAT. **TURN** es un relay para cuando la conexión directa falla; IsisAnubis no lo implementa, por lo que las redes con NAT simétrico o UDP bloqueado no conectan.

**DTLS-SRTP** es el perfil obligatorio de WebRTC para medios: DTLS autentica y negocia claves; SRTP cifra y autentica los paquetes de audio y video. Las huellas DTLS viajan en el SDP, de modo que los extremos pueden verificar que la clave negociada corresponde a la sesión. Esto protege los medios en tránsito, pero **no** protege la señalización ni autentica a los extremos más allá de la huella.

**SCTP sobre DTLS** proporciona canales de datos. En IsisAnubis se usa un `RTCDataChannel` ordenado para enviar mensajes JSON de control: mouse, teclado, portapapeles, cursor, resolución y keepalive. El canal viaja cifrado por DTLS, pero el contenido es texto JSON; no hay cifrado de aplicación adicional.

**Estadísticas WebRTC.** `RTCPeerConnection.getStats()` expone contadores de bytes, frames, paquetes perdidos, jitter y RTT. El cliente consulta cada 2 s y muestra `RTT ms · Mbit/s · fps`. Es una herramienta de observabilidad, no de seguridad.

## 2.5 Captura de pantalla y audio loopback

En Electron, la captura de pantalla se obtiene con `desktopCapturer` y `getDisplayMedia` (o el fallback legacy `getUserMedia` con `chromeMediaSource`). El host configura un `setDisplayMediaRequestHandler` que elige la pantalla primaria sin mostrar el selector, lo que permite operar en modo desatendido. La captura se limita a 30 fps para equilibrar calidad y costo.

El audio del sistema en Windows se captura mediante loopback. En el modo "solo bocina", el cliente ofrece una sesión sin sección `m=video`; el host captura únicamente audio y evita abrir una segunda captura de pantalla, que en Windows degradaba el pipeline de entrada. En macOS, el cliente activa un modo de tapa cerrada (`pmset disablesleep`, apagado de pantalla y un watcher de `ioreg`) para mantener el audio con la tapa cerrada, restaurando la configuración al salir. Es una solución de plataforma, no de WebRTC.

## 2.6 Inyección de entrada y UIPI en Windows

La inyección de mouse y teclado se realiza con `@nut-tree-fork/nut-js` en un proceso aislado (`input-worker`). La serialización evita condiciones de carrera y permite medir el tiempo de cada operación. Si una operación supera 3,5 s, el host reinicia el worker sin cortar el video.

Windows aplica **UIPI (User Interface Privilege Isolation)**: un proceso de integridad media no puede enviar mensajes de entrada a ventanas de integridad alta (por ejemplo, el Administrador de tareas, el menú de inicio elevado o ciertos flyouts de la bandeja). Para cruzar esa barrera, el host registra una tarea programada con `HighestAvailable` que ejecuta un **helper elevado**. El helper escucha en `127.0.0.1:47831` y autentica con el secreto de emparejamiento. El proceso principal (captura, señalización, UI) sigue corriendo con integridad normal: solo el helper está elevado. Este diseño reduce la superficie de ataque, pero crea un canal local privilegiado que debe protegerse.

## 2.7 Señalización serverless con Firestore

Firestore es una base de datos de documentos con sincronización en tiempo real. Su modelo encaja con la señalización:

- `sessions/{code}`: documento principal de la sesión, con estado, oferta, respuesta, PIN y tokens.
- `sessions/{code}/clientCandidates` y `hostCandidates`: subcolecciones de candidatos ICE.
- `presence/{hostId}`: estado del host (heartbeat, IP, captura, idle).
- `presence/{hostId}/probe/{pending,answer,rate}`: documentos fijos del probe.
- `pc_commands/{docId}`: órdenes de encendido/apagado.
- `tablet_commands/{hostId}` y `tablet_stream/{hostId}`: cámara de la tablet.
- `tablet_presence/{hostId}`: latido de la app Android.

Las **reglas de seguridad** de Firestore son el mecanismo de autorización. En el prototipo, las colecciones núcleo usan `allow read, write: if true`, lo que significa que cualquier cliente con la configuración web del proyecto puede leer y escribir. El archivo `firestore.rules` advierte que es una copia documentada, no necesariamente el estado desplegado. Esta decisión es coherente con un prototipo personal, pero es incompatible con un entorno multiusuario o expuesto a Internet.

Las **Cloud Functions** permiten reaccionar a escrituras. `onProbeWritten` consume el rate limit y marca el probe como `dispatched`. No es una barrera de seguridad: si el rate limit falla, la función deja pasar el probe para no romper la disponibilidad. Su objetivo es higiene y control de cuotas.

## 2.8 Presencia, heartbeat, probe y Wake-on-LAN

La **presencia** responde a la pregunta "¿está la PC encendida y operable?". Hay dos mecanismos:

1. **Liveness pasiva:** el host escribe `presence/{hostId}` cada 5 minutos y en eventos de `powerMonitor` (boot, suspend, resume, lock, unlock, shutdown). La app Android y el cliente leen el documento sin escribir. Si `lastHeartbeatAt` tiene más de 10 minutos, la UI muestra "sin señal" aunque el último estado diga `online`.
2. **Probe activo:** el teléfono o la tablet escribe `probe/pending` con un `requestId`; la Cloud Function aplica el rate limit y marca `dispatched`; el host hace un health check (`desktopCapturer` + `powerMonitor`) y responde en `probe/answer`. El cliente espera hasta 25 s y descarta respuestas de más de 30 s.

El **heartbeat** es barato (≈288 escrituras por día por host) y suficiente para saber si la PC "estuvo viva". El **probe** es la fuente autoritativa para saber si está operable "ahora". La separación evita gastar escrituras y cuotas en cada consulta de UI.

**Wake-on-LAN (WoL)** es un estándar de facto basado en un "magic packet": una trama Ethernet con la MAC del equipo repetida 16 veces, enviada a la dirección de broadcast. La tablet escucha `pc_commands/desktop` (o `pc_commands/{hostId}`) y, cuando ve `powerOn=true` con un `timestamp` nuevo, envía el paquete. El host escucha el mismo documento para `powerOn=false` y ejecuta un apagado del sistema si el timestamp es fresco (≤30 s). Este último comando es sensible: sin autenticación, cualquiera con el `hostId` puede apagar la PC.

## 2.9 Seguridad: identidad sin cuentas, hash, emparejamiento y superficies de ataque

El prototipo no usa cuentas de usuario. La identidad se basa en tres secretos:

- **Código de sesión:** 6 caracteres de un alfabeto de 31 símbolos (sin `i/l/o/0/1`), generado con `crypto.getRandomValues`. Entropía ≈ 29,7 bits.
- **PIN opcional:** se almacena como `pinHash = SHA-256(pin)` y se compara en el cliente. No hay mínimo de longitud ni rate limit.
- **Secreto de emparejamiento:** 8 caracteres del mismo alfabeto, generado con `crypto.getRandomValues`. Entropía ≈ 39,6 bits. El host guarda `tokenHash = SHA-256(secret)`; el cliente envía `token = SHA-256(secret)` en la oferta. El secreto en claro nunca se escribe en Firestore.

SHA-256 es una función hash criptográfica, no una función de derivación de claves (KDF) ni un MAC. Para un secreto de alta entropía, un hash simple es aceptable como compromiso; para un secreto de 8 caracteres, es vulnerable a fuerza bruta si el hash se expone. Además, el token es un **portador estático**: quien lo lee puede reutilizarlo. Estas distinciones se desarrollan en el capítulo 6.

Los principios de seguridad aplicados son:

- **Mínimo privilegio:** solo el helper de entrada se eleva; el resto corre con integridad normal.
- **Defensa en profundidad:** aislamiento de renderer, CSP, fuses de Electron, autenticación del helper, reglas de Firestore (aunque abiertas), rate limit.
- **Separación de planos:** la señalización no transporta medios; los medios no pasan por Firestore.
- **Minimización de secretos:** el secreto de emparejamiento no se publica; solo su hash.
- **Degradación controlada:** si la captura falla, la sesión sigue sin video; si el rate limit falla, el probe se permite; si el helper no conecta, se usa input local de respaldo.

## 2.10 Tecnologías empleadas

La selección de tecnologías responde a tres criterios: madurez del ecosistema, disponibilidad en las plataformas objetivo y posibilidad de operar sin infraestructura propia. La Tabla 2.2 resume las versiones declaradas en ambos repositorios; la Tabla 2.3 conecta esos componentes con los conceptos de seguridad que se aplican a lo largo del documento.

**Tabla 2.2.** Tecnologías y versiones principales.

| Componente | Tecnología | Versión | Uso |
| --- | --- | --- | --- |
| Desktop runtime | Electron | 44 | Host y cliente |
| UI | React | 19 | Paneles de host y cliente |
| Lenguaje | TypeScript | 5.6 | Todo el escritorio |
| Build | Vite / Electron Forge | 8 / 7.11 | Empaquetado |
| Monorepo | pnpm | 11.3 | Workspaces hoisted |
| Señalización | Firebase JS SDK | 11 | Firestore web |
| Funciones | firebase-functions / admin | 7.4 / 14.5 | Node 22 |
| Medios | WebRTC | nativo Electron | Video/audio/datos |
| Entrada | @nut-tree-fork/nut-js | 4.2.6 | Inyección |
| Android | Kotlin / Compose | 2.2.10 / BOM 2026.02.01 | UI |
| Android WebRTC | io.github.webrtc-sdk | 125.6422.07 | Cámara |
| Android Python | Chaquopy | 17.0.0 / Python 3.14 | Firestore REST |
| Android build | AGP / Gradle | 9.2.1 / 9.4.1 | Compilación |
| STUN | stun.l.google.com | 19302 | Descubrimiento |

**Tabla 2.3.** Conceptos de seguridad aplicados.

| Concepto | Definición | Aplicación en IsisAnubis |
| --- | --- | --- |
| Confidencialidad | Solo quien está autorizado accede a la información | DTLS-SRTP para medios; HTTPS para Firestore; secretos locales |
| Integridad | La información no cambia sin detección | DTLS/SRTP; huellas SDP; validación de token; hash de PIN |
| Disponibilidad | El sistema funciona cuando se necesita | Heartbeat, reconexión, re-escucha, modo servicio |
| Autenticación | Probar la identidad | Código/PIN, token de emparejamiento |
| Autorización | Decidir qué puede hacer quien se autenticó | Reglas de Firestore (abiertas en el prototipo), validación de token |
| No repudio | No poder negar una acción | **No implementado**; no hay auditoría firmada |
| Mínimo privilegio | Dar solo los permisos necesarios | Helper elevado aislado; preload acotado; permisos Android |
| Defensa en profundidad | Varias capas de control | Aislamiento + CSP + fuses + auth helper + rate limit |
| Superficie de ataque | Puntos por los que se puede entrar | Firestore, WebRTC, helper local, APK, cámara |
| Factor humano | Errores y decisiones de usuarios | Código/PIN débiles, secretos compartidos, falta de consentimiento |
