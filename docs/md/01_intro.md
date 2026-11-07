# 1. Introducción

## 1.1 Antecedentes y origen del proyecto

El acceso remoto a un equipo de escritorio es una necesidad recurrente en soporte técnico, administración de equipos, educación a distancia y trabajo híbrido. Las soluciones comerciales dominantes —Chrome Remote Desktop, TeamViewer, AnyDesk y, en el ámbito corporativo, RDP y VNC— resolvieron el problema con distintos modelos: algunas priorizan la simplicidad y la atravesabilidad de NAT, otras la integración con directorios y políticas empresariales. Sin embargo, todas imponen un costo de adopción: cuentas de terceros, agentes con privilegios elevados, telemetría, licencias o dependencia de infraestructura ajena.

IsisAnubis nace de una necesidad concreta: controlar un equipo Windows desde una Mac de forma desatendida, sin cuentas de terceros y con una señalización mínima en la nube. El proyecto se planteó como una alternativa propia y auditable, construida sobre tecnologías abiertas: Electron para el escritorio, React para la interfaz, WebRTC para los medios, Firebase Firestore para la señalización y una aplicación Android para funciones de acompañamiento (presencia, encendido remoto y cámara). El nombre evoca a Isis y Anubis, figuras mitológicas egipcias asociadas a la protección y al tránsito entre mundos: una metáfora del puente entre dos equipos separados por la red.

El repositorio de escritorio contiene cinco paquetes (`shared`, `host-app`, `client-app`, `functions`, `scripts`) y el repositorio Android contiene una aplicación Kotlin con un puente Python/Chaquopy. Ambos se desarrollaron de forma iterativa entre septiembre y octubre de 2026. La documentación existente (`REQUERIMIENTOS.md`, `BUILD.md` y los comentarios de código) fue la base para reconstruir los requisitos y verificar la implementación.

## 1.2 Planteamiento del problema

El problema se puede formular en cuatro dimensiones:

1. **Dependencia de terceros.** Las soluciones comerciales requieren cuentas, suscripciones o agentes propietarios. Para un usuario que administra sus propios equipos, esto implica ceder control sobre la identidad, la disponibilidad y los datos de la sesión.
2. **Complejidad de la infraestructura.** Montar un servidor de retransmisión propio (TURN, señalización, autenticación) incrementa el costo operativo y la superficie de ataque. El proyecto necesitaba una alternativa serverless, con la capa gratuita de Firebase como mínimo viable.
3. **Operación desatendida.** El host debe escuchar sin intervención humana, sobrevivir a reinicios, ocultarse en la bandeja del sistema y recuperarse de fallos de captura o de entrada. Las soluciones domésticas suelen fallar en este punto: si el usuario cierra la ventana, se pierde el acceso.
4. **Trazabilidad y seguridad.** Al tratarse de un proyecto propio, era posible —y necesario— documentar el modelo de confianza, los secretos, las superficies de ataque y los riesgos. La seguridad no podía quedar como una afirmación de marketing: debía explicarse qué se usa, dónde y cómo, incluyendo lo que falta.

A esto se suma una necesidad práctica: el usuario quería saber si la PC estaba encendida antes de intentar conectarse, encenderla remotamente cuando estuviera apagada y, en ciertos escenarios, usar la cámara de una tablet como cámara remota. Esas funciones no forman parte del núcleo de escritorio remoto, pero motivaron la aplicación Android y el diseño de presencia distribuida.

## 1.3 Justificación

La justificación del proyecto se organiza en cinco argumentos:

- **Técnica.** WebRTC ofrece transporte cifrado, bajo consumo y conexión directa entre pares; Firestore ofrece señalización serverless con sincronización en tiempo real. La combinación permite construir un escritorio remoto funcional sin servidores propios.
- **Económica.** El proyecto no paga licencias ni servidores dedicados. La señalización y la presencia caben en la capa gratuita de Firebase para el volumen de un usuario personal; el costo marginal es principalmente eléctrico y de ancho de banda.
- **Académica.** El proyecto integra requisitos, arquitectura, protocolos, seguridad, pruebas y documentación. Permite analizar decisiones de ingeniería reales: por qué STUN y no TURN, por qué un helper elevado en Windows, por qué SHA-256 y no una función de derivación de claves, por qué las reglas abiertas son coherentes con el prototipo pero incompatibles con producción.
- **De privacidad.** Al no depender de un proveedor de escritorio remoto, el flujo de pantalla y audio no pasa por un servidor de terceros. La señalización sí pasa por Firebase, pero el contenido multimedia viaja P2P y se cifra con DTLS-SRTP.
- **De aprendizaje.** La documentación de las debilidades —incluida la clave de servicio embebida en el APK— tiene un valor formativo: muestra que un prototipo puede funcionar y, a la vez, tener riesgos críticos que deben resolverse antes de production.

La utilidad práctica esperada es un sistema que permita, desde una Mac, abrir una sesión por código o por emparejamiento, ver la pantalla del Windows, usar mouse y teclado, copiar y pegar texto, y consultar la calidad de la conexión. Desde Android, el usuario puede consultar el estado de la PC, encenderla por Wake-on-LAN y ver la cámara de la tablet. La documentación busca que ese sistema sea comprensible, mantenible y evaluable por terceros.

## 1.4 Alcance y delimitación

### 1.4.1 Alcance incluido

El proyecto incluye:

- **Host Windows** (Electron 44 + React 19): captura de pantalla y audio, inyección de mouse y teclado, portapapeles bidireccional, presencia, autoinicio, modo servicio, bandeja del sistema y helper elevado para cruzar UIPI.
- **Cliente macOS** (Electron 44 + React 19): conexión por código/PIN o por emparejamiento, visualización de video y audio, control remoto, métricas de calidad, reconexión automática, modo "solo bocina" y ventana de cámara de la tablet.
- **Paquete compartido** (`@isisanubis/shared`): protocolo de señalización, generación de códigos, emparejamiento, presencia, tipos de control, configuración de Firebase y componentes de estado.
- **Cloud Function** (`onProbeWritten`): relé del probe de presencia y rate limit de 10 solicitudes por minuto.
- **Scripts de administración**: listar, limpiar y reiniciar sesiones de Firestore con el Admin SDK.
- **Aplicación Android** (Kotlin + Compose + Chaquopy): modos teléfono y tablet, presencia pasiva, probe activo, Wake-on-LAN, servicio en primer plano y streaming de cámara por WebRTC.
- **Documentación**: requisitos, build, arquitectura, seguridad, resultados, conclusiones, referencias y anexos.

### 1.4.2 Exclusiones

Quedan fuera de esta versión:

- Host Linux o macOS como plataforma oficial (el host está pensado para Windows; existe un modo de desarrollo en macOS, pero no es el objetivo).
- Cliente iOS o Android como cliente de control de escritorio (Android es acompañamiento, no cliente de pantalla completa).
- Multiplexación de varios clientes sobre un mismo host (una sola sesión activa a la vez).
- Transferencia de archivos, impresión remota, audio bidireccional y grabación de sesiones.
- TURN propio o servicio de retransmisión para NAT simétrico; el sistema usa STUN público y falla en redes que bloquean la conexión directa.
- Autenticación de usuarios con Firebase Auth, App Check, cuentas, roles y auditoría centralizada. El prototipo usa un modelo de confianza basado en códigos, PIN y secretos de emparejamiento.
- Cifrado de extremo a extremo a nivel de aplicación (E2EE) sobre WebRTC; se usa el cifrado estándar DTLS-SRTP.
- Firma de código, notarización, autoactualización firmada y despliegue empresarial.
- Validación empírica formal con usuarios y mediciones de rendimiento en redes reales; se define el protocolo, pero no se ejecutó al cierre de esta versión.

### 1.4.3 Supuestos

- El host y el cliente tienen conectividad a Internet y pueden alcanzar los servidores de Firebase y el STUN público.
- El usuario del host autoriza la captura de pantalla y la inyección de entrada.
- El host puede ejecutarse con una cuenta de usuario de Windows con permisos para registrar tareas programadas y solicitar elevación una vez.
- La tableta Android está en la misma red local que la PC para enviar el magic packet de Wake-on-LAN, o el router permite el reenvío del broadcast.
- El proyecto Firebase `baobaoadmin` está disponible y las reglas desplegadas coinciden con el archivo versionado; esto último debe verificarse en la consola.

**Tabla 1.1.** Datos generales del proyecto.

| Aspecto | Detalle |
| --- | --- |
| Nombre | IsisAnubis |
| Tipo de sistema | Escritorio remoto asimétrico + acompañamiento móvil |
| Host | Windows, Electron 44, React 19, TypeScript |
| Cliente | macOS, Electron 44, React 19, TypeScript |
| Android | Kotlin, Jetpack Compose, Chaquopy Python 3.14 |
| Señalización | Firebase Firestore, proyecto `baobaoadmin` |
| Medios | WebRTC P2P, STUN público, DTLS-SRTP, SCTP |
| Presencia | Heartbeat cada 5 min + probe bajo demanda + Cloud Function |
| Energía | Wake-on-LAN desde tablet; apagado remoto desde host |
| Versión host | 0.1.3 |
| Versión cliente | 0.1.13 |
| Versión Android | 1.0 (versionCode 1) |
| Repositorios | Escritorio: 5 paquetes; Android: 1 módulo + Python |
| Periodo reconstruido | 2026-09-05 a 2026-10-19 (commits) |
| Documento | Versión 1.0, noviembre de 2026 |

## 1.5 Objetivo general

Diseñar, construir y documentar un sistema de escritorio remoto host–cliente que permita controlar un equipo Windows desde un cliente macOS, con transmisión de pantalla y audio, inyección de mouse y teclado, portapapeles sincronizado, emparejamiento persistente y una aplicación Android complementaria para presencia, encendido remoto y cámara, utilizando Firebase Firestore como señalización y WebRTC como transporte de medios.

## 1.6 Objetivos específicos

**Tabla 1.2.** Objetivos específicos y criterios de logro.

| N.º | Objetivo específico | Criterio de logro | Evidencia |
| --- | --- | --- | --- |
| OE-1 | Implementar una sesión manual por código de 6 caracteres, con PIN opcional y TTL de 10 minutos. | El host publica `sessions/{code}` en estado `waiting`; el cliente conecta; los errores `code_not_found`, `session_busy`, `pin_required` y `pin_wrong` se muestran. | `signaling.ts`, `host-app/App.tsx`, `client-app/App.tsx` |
| OE-2 | Implementar emparejamiento persistente con `hostId` y secreto, sin publicar el secreto en Firestore. | El host guarda solo `tokenHash`; el cliente envía `token`; el host rechaza token ausente o inválido; la sesión re-escucha. | `pairing.ts`, `signaling.ts`, `isis-host.json`, `isis-pairs.json` |
| OE-3 | Transmitir pantalla y audio con captura de escritorio y audio loopback. | El cliente recibe video/audio; el host informa el modo de captura; el modo "solo bocina" funciona sin video. | `host-app/main.ts`, `signaling.ts`, `client-app/App.tsx` |
| OE-4 | Inyectar mouse y teclado de forma serializada, con recuperación ante bloqueos. | El input remoto responde; la cola se limita a 40 eventos; el watchdog reinicia a los 3,5 s; "Reiniciar input" libera botones. | `input.ts`, `input-worker.ts`, `main.ts` |
| OE-5 | Sincronizar el portapapeles en ambos sentidos. | Texto copiado en un extremo se pega en el otro en menos de 2 s, sin eco. | `client-app/App.tsx`, `host-app/main.ts` |
| OE-6 | Operar de forma desatendida con autoinicio, modo servicio y bandeja. | El host inicia con Windows, se oculta y re-escucha; el helper elevado se registra con `HighestAvailable`. | `main.ts`, `forge.config.ts`, `BUILD.md` |
| OE-7 | Publicar presencia pasiva y responder probes bajo demanda. | `presence/{hostId}` se actualiza cada 5 min y por eventos; la app Android lee sin escribir; el probe tiene timeout y rate limit. | `presence.ts`, `config.ts`, `functions/src/index.ts` |
| OE-8 | Publicar la IP LAN actual y permitir el chequeo LAN desde Android. | `lastLocalIp` se actualiza en cada latido; la tablet la empuja al `PcPollingLoop`. | `presence.ts`, `polling_loop.py`, `TabletActivity.kt` |
| OE-9 | Permitir el emparejamiento de la app Android con un host específico. | La app guarda `hostId` + secreto en SharedPreferences y apunta probe/presence a `presence/{hostId}`. | `SettingsManager.kt`, `SettingsActivity.kt`, `HostPresence.kt` |
| OE-10 | Encender la PC por Wake-on-LAN desde el cliente y apagarla remotamente. | El cliente escribe `pc_commands/{hostId}`; la tablet envía el magic packet; el host ejecuta el shutdown con timestamp fresco. | `tablet.ts`, `polling_loop.py`, `presence.ts` |
| OE-11 | Transmitir la cámara de la tablet al cliente por WebRTC. | El cliente escribe `tablet_commands/{hostId}`; la tablet valida token y frescura; el cliente recibe el stream. | `tablet.ts`, `WebRtcCameraClient.kt`, `TabletActivity.kt` |
| OE-12 | Documentar la seguridad con un modelo de amenazas y un plan de endurecimiento. | Se identifican activos, límites de confianza, controles, riesgos y acciones P0/P1/P2. | Capítulo 6 |

## 1.7 Estructura del documento

El documento se organiza en ocho capítulos. El capítulo 2 presenta el marco teórico y conceptual: escritorio remoto, WebRTC, Firestore, presencia, Wake-on-LAN y principios de seguridad. El capítulo 3 describe la metodología: enfoque, fases, técnicas, materiales, cronograma, variables y ética. El capítulo 4 presenta los resultados: arquitectura, métricas de código, flujos, presupuestos de tiempo, verificación estática, cobertura de requisitos y análisis frente a los objetivos. El capítulo 5 sintetiza conclusiones y recomendaciones. El capítulo 6 desarrolla la seguridad en profundidad, con el inventario de controles, el modelo de amenazas, los riesgos y el plan de endurecimiento. El capítulo 7 contiene las referencias en formato APA 7. El capítulo 8 reúne los anexos: matrices, constantes, mapa de código, protocolo, encuesta, protocolo de medición, checklist, glosario, registro de evidencias y extractos de código.

**Tabla 1.3.** Alcance y exclusiones.

| Dimensión | Incluido | Excluido |
| --- | --- | --- |
| Plataformas | Host Windows, cliente macOS, Android acompañante | Host Linux/macOS oficial, cliente iOS, cliente Android de control |
| Sesiones | Código + PIN, emparejamiento persistente, un cliente por host | Multicliente, multiusuario, salas, transferencia de archivos |
| Medios | Pantalla, audio loopback, cámara de tablet | Audio bidireccional, grabación, impresión remota |
| Red | P2P con STUN público | TURN propio, NAT simétrico, redes que bloquean UDP |
| Seguridad | DTLS-SRTP, hash de secretos, aislamiento Electron, helper autenticado | Firebase Auth, App Check, E2EE de aplicación, firma de código, auditoría central |
| Validación | Verificación estática y de compilación; protocolo de medición | Benchmark formal y estudio de usuarios ejecutados |
