# 3. Metodología

## 3.1 Enfoque y tipo de investigación

El proyecto se abordó como una **investigación aplicada** con un **diseño de desarrollo tecnológico iterativo e incremental**. No se buscó producir conocimiento teórico nuevo sobre WebRTC o Firestore, sino aplicar conocimiento existente para construir un artefacto funcional y evaluar sus decisiones de ingeniería. El enfoque es **mixto**:

- **Cualitativo:** análisis de código, revisión documental, reconstrucción de requisitos, observación de flujos y elaboración de un modelo de amenazas.
- **Cuantitativo:** conteo de líneas de código, número de commits, constantes de tiempo, entropía de secretos, presupuestos de latencia y, cuando se ejecute el protocolo del Anexo F, métricas de RTT, fps, bitrate y pérdida.

El diseño iterativo se refleja en el historial de commits: cada fase agregó una capacidad verificable (señalización, captura, input, emparejamiento, presencia, Android, cámara) y corrigió problemas detectados en uso real. La documentación se construyó al final, pero se apoyó en los comentarios y decisiones registrados en el código.

El método principal fue el **análisis de artefactos**: se leyó el código, se identificaron los contratos entre módulos, se reconstruyeron los requisitos y se contrastó lo implementado con lo especificado. Se complementó con **verificación estática** (`tsc --noEmit`, compilación Kotlin) y con un **análisis de seguridad** basado en STRIDE y en el modelo de límites de confianza.

## 3.2 Objeto de estudio y unidades de análisis

El objeto de estudio es el sistema IsisAnubis en su estado de octubre de 2026. Las unidades de análisis son:

1. **Paquete `shared`:** protocolo de señalización, emparejamiento, presencia, tipos de control y configuración.
2. **Host Electron:** captura, audio, input, helper elevado, autoinicio, bandeja, presencia y apagado remoto.
3. **Cliente Electron:** UI, conexión, video/audio, control, portapapeles, estadísticas, reconexión, modo bocina y cámara.
4. **Cloud Functions:** relé de probe y rate limit.
5. **Scripts de administración:** listado, limpieza y reinicio de sesiones.
6. **App Android:** modos teléfono/tablet, presencia, probe, WoL, servicio en primer plano y cámara WebRTC.
7. **Infraestructura Firebase:** proyecto `baobaoadmin`, colecciones, reglas y configuración.
8. **Documentación existente:** `REQUERIMIENTOS.md`, `BUILD.md`, comentarios y este documento.

No se trabajó con una muestra probabilística de usuarios. La unidad de observación empírica, cuando se ejecute el Anexo F, será una **muestra por conveniencia** de dos equipos (Windows y macOS), una tablet Android y tres escenarios de red. Los resultados de usabilidad no se extrapolan a toda la población; se interpretan como evidencia de viabilidad del prototipo.

## 3.3 Procedimiento por fases

El procedimiento se organizó en siete fases. Las fechas son una reconstrucción a partir de los commits de ambos repositorios; no sustituyen un cronograma formal aprobado.

**Tabla 3.1.** Fases, actividades y entregables.

| Fase | Periodo (aprox.) | Actividades | Entregables |
| --- | --- | --- | --- |
| Fase 0 · Definición y entorno | 2026-09-05 a 2026-09-08 | Configuración de monorepo, Electron Forge, Firebase, primer esqueleto; app Android inicial | Repositorios, build base, primeras pantallas |
| Fase 1 · Señalización y sesión manual | 2026-09-08 a 2026-09-12 | `HostPeer`/`ClientPeer`, códigos, PIN, oferta/respuesta, candidatos ICE, sesión `waiting/active` | Sesión por código funcional; primera demo |
| Fase 2 · Captura, audio y portapapeles | 2026-09-12 a 2026-09-16 | `getDisplayMedia`, audio loopback, portapapeles, cursor, métricas | Video/audio remoto; sincronización de texto |
| Fase 3 · Input y helper elevado | 2026-09-16 a 2026-09-28 | Worker aislado, cola, watchdog, helper UIPI, autoinicio, bandeja, modo servicio | Control remoto estable; fix de `MODULE_NOT_FOUND`; modo bocina |
| Fase 4 · Emparejamiento, presencia y WoL | 2026-09-28 a 2026-10-13 | `hostId`/secreto, token, heartbeat, `lastLocalIp`, probe, Cloud Function, `pc_commands`, WoL | Emparejamiento persistente; presencia; encendido/apagado |
| Fase 5 · Android, cámara e integración | 2026-10-13 a 2026-10-19 | Modos teléfono/tablet, `PcListenService`, cámara WebRTC, `tablet_commands`, `tablet_stream`, presencia de tablet | APK beta; cámara funcional; chequeos de presencia |
| Fase 6 · Documentación y validación | 2026-10-19 a 2026-11-07 | Revisión de código, requisitos, seguridad, métricas, figuras, documento y verificación estática | Este documento; figuras; plan de medición |

**Figura 3.1.** Plan de trabajo reconstruido a partir del historial de commits.

![Plan de trabajo reconstruido](docs/figuras/fig08_cronograma.png)

_Fuente: elaboración propia a partir de `git log` de ambos repositorios. Las fases son interpretativas._

La secuencia no fue estrictamente lineal. Hubo retrabajo: el input se congelaba en menús elevados de Windows, lo que obligó a introducir el helper; el worker empaquetado falló por una dependencia transitiva de `nut-js`, lo que obligó a corregir la clausura de `forge.config.ts`; el modo bocina se agregó después de detectar que la segunda captura degradaba el input. Estos retrocesos son parte normal de un diseño iterativo y se documentan porque explican decisiones del producto.

## 3.4 Técnicas e instrumentos

**Tabla 3.2.** Técnicas e instrumentos de recolección.

| Técnica | Instrumento | Qué se obtuvo | Limitación |
| --- | --- | --- | --- |
| Revisión documental | `REQUERIMIENTOS.md`, `BUILD.md`, comentarios de código | Requisitos, casos de uso, criterios de aceptación, decisiones | Documento previo con placeholders |
| Análisis de código | Lectura de archivos, `grep`, `wc -l`, `git log` | Arquitectura, contratos, constantes, métricas | No sustituye pruebas dinámicas |
| Verificación estática | `pnpm typecheck`, `tsc --noEmit` | Ausencia de errores de tipos en escritorio | No valida comportamiento en runtime |
| Compilación | `./gradlew :app:compileDebugKotlin --offline` | Compilación Kotlin correcta | No valida UI ni integración real |
| Análisis de seguridad | STRIDE, límites de confianza, revisión de secretos y reglas | Riesgos, controles, plan de endurecimiento | Basado en código, no en pentest |
| Observación de flujos | Diagramas de secuencia y de estado | Confirmación de contratos entre módulos | Derivada del código, no de trazas reales |
| Pruebas funcionales | Flags de diagnóstico (`--isis-*`), logs | Evidencia de pipelines | **Pendiente de ejecución formal** |
| Medición de rendimiento | `getStats`, logs, cronómetro, `ping` | RTT, fps, bitrate, latencia | **Pendiente**; protocolo en Anexo F |
| Encuesta de usuario | Cuestionario Likert + preguntas abiertas | Percepción de utilidad y usabilidad | **Pendiente**; instrumento en Anexo E |

## 3.5 Materiales y herramientas

**Tabla 3.3.** Materiales y herramientas.

| Categoría | Elemento | Uso |
| --- | --- | --- |
| Hardware | PC con Windows 10/11 (host) | Captura, input, helper, autoinicio |
| Hardware | Mac con macOS (cliente) | Video/audio, control, modo bocina |
| Hardware | Tablet Android (API 24+) | Modo tablet, WoL, cámara |
| Hardware | Teléfono Android | Probe, presencia, WoL |
| Red | LAN doméstica y red externa | Pruebas P2P y presencia |
| Software | Node.js ≥22, pnpm 11.3 | Monorepo y builds |
| Software | Electron 44, React 19, Vite 8, TypeScript 5.6 | Desktop |
| Software | Firebase CLI, Firestore, Cloud Functions | Señalización |
| Software | Android Studio, AGP 9.2.1, Gradle 9.4.1, Kotlin 2.2.10 | Android |
| Software | Chaquopy 17.0.0, Python 3.14 | Puente Android–Firestore |
| Software | `@nut-tree-fork/nut-js` 4.2.6 | Inyección de entrada |
| Software | WebRTC (Electron y `io.github.webrtc-sdk`) | Medios y datos |
| Software | `python-docx`, `matplotlib` | Generación de documento y figuras |
| Documentación | `REQUERIMIENTOS.md`, `BUILD.md`, `firestore.rules` | Base de requisitos y operación |

## 3.6 Plan de trabajo y cronograma

El plan se reconstruyó con los commits:

- **Escritorio:** 18 commits entre el 8 de septiembre y el 19 de octubre de 2026. Hitos: Fase 0, primera demo, corrección de mouse, modo bocina, fix del worker, funciones de presencia/WoL, cámara.
- **Android:** 4 commits entre el 5 de septiembre y el 18 de octubre de 2026. Hitos: primer commit, beta funcional, checkpoint y cámara funcional.

La Figura 3.1 muestra el cronograma. La fase 6 se extendió hasta el 7 de noviembre de 2026 para incluir esta documentación y la verificación estática. El esfuerzo se concentró en tres áreas: estabilidad de input (la más costosa), emparejamiento/presencia y la integración Android.

El plan de trabajo puede expresarse también como una secuencia de entregables:

1. **Entregable 1:** sesión manual por código con video.
2. **Entregable 2:** control de mouse/teclado y portapapeles.
3. **Entregable 3:** emparejamiento persistente y modo servicio.
4. **Entregable 4:** presencia, probe, WoL y apagado remoto.
5. **Entregable 5:** app Android con modos teléfono/tablet y cámara.
6. **Entregable 6:** documentación, seguridad y plan de validación.

## 3.7 Variables e indicadores

**Tabla 3.4.** Variables e indicadores.

| Variable | Tipo | Indicador | Instrumento | Meta de diseño |
| --- | --- | --- | --- | --- |
| Latencia de input | Cuantitativa continua | Tiempo entre evento en cliente y efecto en host (ms) | Logs + video de alta velocidad | ≤100 ms en LAN; ≤200 ms en Internet |
| RTT de sesión | Cuantitativa continua | `currentRoundTripTime` (ms) | `getStats()` cada 2 s | ≤150 ms |
| Tasa de frames | Cuantitativa discreta | fps decodificados | `getStats()` | ≥24 fps en movimiento |
| Bitrate | Cuantitativa continua | Mbit/s de video | `getStats()` | 2–8 Mbit/s según contenido |
| Pérdida de paquetes | Cuantitativa continua | Porcentaje de paquetes perdidos | `getStats()` | ≤1 % |
| Tiempo de conexión | Cuantitativa continua | Desde `start()` hasta `connected` (s) | Logs | ≤10 s en LAN; ≤20 s en Internet |
| Reconexión | Cuantitativa discreta | Intentos hasta recuperar | Logs/UI | ≤3 intentos; ≤5 s |
| Estabilidad | Cuantitativa continua | Minutos sin caída | Logs | ≥60 min |
| Usabilidad | Cualitativa ordinal | Puntuación Likert 1–5 | Encuesta | ≥4/5 |
| Seguridad | Cualitativa ordinal | Nivel de riesgo | Matriz L×I | Sin riesgos críticos antes de exponer |
| Cobertura de requisitos | Cuantitativa discreta | CU con evidencia en código | Matriz de trazabilidad | 19/19 |
| Documentación | Cuantitativa discreta | Secciones completas | Checklist | 100 % |

## 3.8 Consideraciones éticas y de privacidad

El proyecto manipula pantalla, audio, entrada, portapapeles y cámara: son datos sensibles. Las consideraciones éticas son parte del diseño, no un apéndice.

**Tabla 3.5.** Consideraciones éticas y de privacidad.

| Principio | Aplicación | Estado |
| --- | --- | --- |
| Consentimiento informado | El operador del host debe autorizar la captura y el control; el usuario del cliente debe saber que controla un equipo real | **Parcial:** no hay pantalla de consentimiento explícita; se asume en la operación |
| Transparencia | El host debe mostrar que está siendo controlado; la tablet debe indicar que la cámara está activa | **Parcial:** hay estado en UI y notificación de servicio; falta indicador persistente en pantalla |
| Minimización | Solo se recogen datos necesarios: estado, IP, deviceName, timestamps | **Parcial:** se publican IPs y SDP en Firestore |
| Confidencialidad | Medios cifrados en tránsito; secretos fuera de la nube | **Parcial:** secreto en claro local; service account en APK |
| Retención | Las sesiones deben limpiarse; los logs deben rotar | **Parcial:** TTL de sesiones, limpieza de candidatos, log rotativo 2 MB; sin política formal |
| Derechos de las personas | No capturar terceros sin consentimiento; permitir borrar datos | **Pendiente:** no hay interfaz de borrado ni política de privacidad |
| Ética académica | No usar datos reales de personas; anonimizar evidencias | **Aplicable** a este documento; las capturas deben anonimizarse |
| Legalidad | Cumplir la ley de protección de datos aplicable (GDPR, LFPDPPP u otra) | **Pendiente:** requiere revisión legal según jurisdicción |

Para la validación con usuarios se propone un consentimiento breve (Anexo E) que explique: qué se observa, qué se registra, cuánto dura, cómo se anonimiza y cómo se puede retirar. No se deben capturar pantallas con datos personales de terceros; las evidencias deben difuminarse. La cámara de la tablet solo debe activarse con una acción explícita del usuario y con un indicador visible.
