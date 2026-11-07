<!-- portada -->

# IsisAnubis

## Sistema de escritorio remoto y control de presencia para host Windows, cliente macOS y aplicación Android

**Documentación técnica y académica del proyecto**

![Icono de IsisAnubis](packages/client-app/assets/icon-master.png)

---

| Campo | Detalle |
| --- | --- |
| **Autor** | _[Nombre completo del autor]_ |
| **Institución** | _[Universidad / Institución]_ |
| **Facultad / Programa** | _[Facultad / Carrera / Programa académico]_ |
| **Materia / Seminario** | _[Materia / Seminario / Proyecto de grado]_ |
| **Docente / Tutor** | _[Nombre del docente o tutor]_ |
| **Fecha** | Noviembre de 2026 |
| **Versión del documento** | 1.0 |
| **Repositorio de escritorio** | `/Users/jyang/Dev/personal/isisanubis` |
| **Repositorio Android** | `/Users/jyang/AndroidStudioProjects/IsisAnubis` |

> Documento elaborado a partir del código fuente, la configuración, el historial de cambios y la documentación existente de los dos repositorios. Las mediciones empíricas de rendimiento no estaban disponibles al cierre de esta versión; por ello se distinguen explícitamente los **resultados de ingeniería verificables**, las **métricas de diseño derivadas de la configuración** y las **mediciones pendientes**, cuyo procedimiento se define en el Anexo F.

<!-- pagebreak -->

<!-- inicio-cuerpo -->

# Agradecimientos

_[Sección opcional. Sustituir por el texto real o eliminar antes de la entrega.]_

Agradezco a _[personas, docentes, familia, compañeros]_ por su apoyo durante el desarrollo de este proyecto. Su acompañamiento permitió sostener un trabajo iterativo de ingeniería, pruebas y documentación que atraviesa dos plataformas de escritorio y una aplicación móvil.

# Dedicatoria

_[Sección opcional. Sustituir por el texto real o eliminar antes de la entrega.]_

A _[persona o grupo]_, por _[motivo]_.

# Índice general

<!-- TOC -->

_En la versión DOCX, este índice se genera automáticamente como campo de tabla de contenido. Si aparece vacío, haga clic derecho sobre el índice y elija «Actualizar campos», o seleccione todo el documento (Ctrl+A en Windows, Cmd+A en macOS) y pulse F9._

1. Introducción
   1.1 Antecedentes y origen del proyecto
   1.2 Planteamiento del problema
   1.3 Justificación
   1.4 Alcance y delimitación
   1.5 Objetivo general
   1.6 Objetivos específicos
   1.7 Estructura del documento
2. Marco teórico y conceptual
   2.1 Antecedentes y soluciones relacionadas
   2.2 Computación remota y escritorio remoto
   2.3 Arquitectura peer-to-peer y señalización
   2.4 WebRTC: ICE, STUN, TURN, DTLS-SRTP y canales de datos
   2.5 Captura de pantalla y audio loopback
   2.6 Inyección de entrada y UIPI en Windows
   2.7 Señalización serverless con Firestore
   2.8 Presencia, heartbeat, probe y Wake-on-LAN
   2.9 Seguridad: identidad sin cuentas, hash, emparejamiento y superficies de ataque
   2.10 Tecnologías empleadas
3. Metodología
   3.1 Enfoque y tipo de investigación
   3.2 Objeto de estudio y unidades de análisis
   3.3 Procedimiento por fases
   3.4 Técnicas e instrumentos
   3.5 Materiales y herramientas
   3.6 Plan de trabajo y cronograma
   3.7 Variables e indicadores
   3.8 Consideraciones éticas y de privacidad
4. Resultados y análisis
   4.1 Producto construido y arquitectura general
   4.2 Métricas de código y estructura de los repositorios
   4.3 Flujo de sesión manual y emparejada
   4.4 Presencia, probe y cadena de energía
   4.5 Aplicación Android: modos, cámara y servicios
   4.6 Métricas de diseño y presupuestos de tiempo
   4.7 Verificación estática, compilación y cobertura de requisitos
   4.8 Análisis frente a los objetivos
   4.9 Análisis de seguridad: resumen ejecutivo
   4.10 Limitaciones de la evidencia y plan de validación
5. Conclusiones y recomendaciones
   5.1 Conclusiones
   5.2 Recomendaciones
6. Seguridad del sistema
   6.1 Activos, adversarios y modelo de amenazas
   6.2 Límites de confianza y superficies de ataque
   6.3 Inventario de controles: qué se usa, dónde y cómo
   6.4 Identidad y emparejamiento
   6.5 Códigos de sesión, PIN y control de acceso
   6.6 Reglas de Firestore y modelo de confianza
   6.7 Medios WebRTC, señalización e integridad
   6.8 Almacenamiento local de secretos
   6.9 Endurecimiento de Electron
   6.10 Helper elevado de Windows
   6.11 Aplicación Android y cuenta de servicio embebida
   6.12 Permisos, componentes y servicios Android
   6.13 Presencia, probe, apagado remoto y Wake-on-LAN
   6.14 Cámara de la tablet
   6.15 Registro de riesgos
   6.16 Plan de endurecimiento priorizado
   6.17 Respuesta a incidentes y rotación de credenciales
   6.18 Privacidad, consentimiento y cumplimiento
   6.19 Checklist de despliegue seguro
7. Referencias
8. Anexos
   Anexo A. Matriz de trazabilidad de casos de uso
   Anexo B. Constantes y parámetros de configuración
   Anexo C. Mapa de módulos y archivos
   Anexo D. Protocolo de mensajes y documentos de Firestore
   Anexo E. Instrumento de encuesta y consentimiento informado
   Anexo F. Protocolo de medición empírica y matriz de datos
   Anexo G. Checklist de seguridad y despliegue
   Anexo H. Glosario
   Anexo I. Registro de evidencias y capturas
   Anexo J. Extractos de código representativos

<!-- /TOC -->

# Lista de tablas

<!-- LOT -->

| N.º | Título |
| --- | --- |
| 1.1 | Datos generales del proyecto |
| 1.2 | Objetivos específicos y criterios de logro |
| 1.3 | Alcance y exclusiones |
| 2.1 | Comparación de enfoques de escritorio remoto |
| 2.2 | Tecnologías y versiones principales |
| 2.3 | Conceptos de seguridad aplicados |
| 3.1 | Fases, actividades y entregables |
| 3.2 | Técnicas e instrumentos de recolección |
| 3.3 | Materiales y herramientas |
| 3.4 | Variables e indicadores |
| 3.5 | Consideraciones éticas y de privacidad |
| 4.1 | Métricas de código por módulo |
| 4.2 | Constantes y presupuestos de tiempo |
| 4.3 | Verificación estática y compilación |
| 4.4 | Cobertura de casos de uso |
| 4.5 | Matriz de pruebas funcionales planificadas |
| 4.6 | Correspondencia entre objetivos y evidencia |
| 4.7 | Resumen de hallazgos de seguridad |
| 4.8 | Limitaciones de la evidencia |
| 5.1 | Conclusiones por objetivo |
| 5.2 | Recomendaciones priorizadas |
| 6.1 | Activos y criticidad |
| 6.2 | Modelo STRIDE aplicado |
| 6.3 | Inventario de controles: qué, dónde y cómo |
| 6.4 | Controles ausentes o débiles |
| 6.5 | Registro de riesgos y mitigaciones |
| 6.6 | Plan de endurecimiento P0/P1/P2 |
| 6.7 | Privacidad y cumplimiento |
| 6.8 | Checklist de despliegue seguro |
| A.1 | Trazabilidad caso de uso–requisito–módulo–prueba |
| B.1 | Constantes y parámetros |
| C.1 | Mapa de archivos principales |
| D.1 | Mensajes del canal de datos |
| D.2 | Documentos y colecciones de Firestore |
| E.1 | Cuestionario de validación de usuario |
| F.1 | Matriz de datos para medición empírica |
| F.2 | Escenarios de medición |
| G.1 | Checklist de seguridad y despliegue |
| I.1 | Registro de evidencias |

<!-- /LOT -->

# Lista de figuras

<!-- LOF -->

| N.º | Título |
| --- | --- |
| 3.1 | Plan de trabajo reconstruido a partir del historial de commits |
| 4.1 | Arquitectura general de IsisAnubis |
| 4.2 | Volumen de código por módulo |
| 4.3 | Secuencia de una sesión y variante de emparejamiento |
| 4.4 | Presencia pasiva, probe bajo demanda y cadena de energía |
| 4.5 | Presupuestos de tiempo y umbrales de diseño |
| 6.1 | Límites de confianza y superficies de exposición |
| 6.2 | Matriz de riesgos de seguridad |

<!-- /LOF -->

# Resumen

IsisAnubis es un sistema de escritorio remoto de arquitectura asimétrica que permite controlar un equipo Windows desde un cliente macOS, con una aplicación Android complementaria para presencia, encendido remoto y cámara. El host captura pantalla y audio, inyecta mouse y teclado, sincroniza el portapapeles y opera de forma desatendida mediante emparejamiento persistente y modo servicio. La señalización utiliza Firebase Firestore y los medios viajan directamente entre pares con WebRTC; el proyecto no depende de servidores propios ni de cuentas de terceros.

El trabajo se desarrolló con un enfoque de investigación aplicada y diseño de desarrollo tecnológico iterativo. Se analizaron los dos repositorios, se reconstruyeron los requisitos, se documentó la arquitectura, se ejecutaron verificaciones estáticas y de compilación, y se elaboró un modelo de amenazas específico. Los resultados incluyen un producto funcional compuesto por cinco paquetes de escritorio y una aplicación Android, con 9.182 líneas de código TypeScript/TSX y 5.723 líneas Kotlin/Python, verificación de tipos satisfactoria en los cinco paquetes de escritorio y compilación Kotlin correcta en Android.

La revisión de seguridad identifica riesgos críticos que deben resolverse antes de cualquier exposición a redes no confiables: una cuenta de servicio de Firebase embebida en el APK con acceso amplio a Firestore, reglas de Firestore abiertas en las colecciones núcleo, un token de emparejamiento estático y reutilizable, y órdenes de apagado remoto sin autenticación. El documento no oculta estas debilidades: las describe, las prioriza y propone un plan de endurecimiento en tres niveles. También define el protocolo para obtener las mediciones de latencia, fps, bitrate y estabilidad que aún faltan.

**Palabras clave:** escritorio remoto, WebRTC, Firebase Firestore, Electron, Android, seguridad, presencia, Wake-on-LAN, emparejamiento, arquitectura peer-to-peer.

# Abstract

IsisAnubis is an asymmetric remote desktop system that lets a macOS client control a Windows host, complemented by an Android app for presence, remote power-on, and camera streaming. The host captures screen and audio, injects mouse and keyboard input, synchronizes the clipboard, and can run unattended through persistent pairing and a service mode. Signaling uses Firebase Firestore, while media travels directly between peers over WebRTC; the project relies on neither proprietary servers nor third-party accounts.

The work followed an applied research and iterative technology-development approach. Both repositories were analyzed, requirements were reconstructed, the architecture was documented, static and build verifications were executed, and a project-specific threat model was produced. Results include a working product made of five desktop packages and one Android app, with 9,182 lines of TypeScript/TSX and 5,723 lines of Kotlin/Python, successful type checking in all five desktop packages, and a successful Android Kotlin build.

The security review identifies critical risks that must be addressed before exposing the system to untrusted networks: a Firebase service-account key embedded in the APK with broad Firestore access, open Firestore rules on core collections, a static and replayable pairing token, and unauthenticated remote shutdown commands. The document does not conceal these weaknesses: it describes them, prioritizes them, and proposes a three-tier hardening plan. It also defines the protocol required to obtain the missing latency, fps, bitrate, and stability measurements.

**Keywords:** remote desktop, WebRTC, Firebase Firestore, Electron, Android, security, presence, Wake-on-LAN, pairing, peer-to-peer architecture.

# Nota sobre el estado de la evidencia

Este documento se apoya en tres tipos de evidencia y los distingue a lo largo del texto:

1. **Evidencia de código y configuración:** archivos, constantes, reglas, manifiestos y flujos verificables en los repositorios. Es la base principal de los capítulos 1 a 4 y 6.
2. **Evidencia de verificación estática:** resultados de `pnpm typecheck` en los paquetes de escritorio y de `./gradlew :app:compileDebugKotlin --offline` en Android. Se reportan en el capítulo 4.
3. **Evidencia empírica pendiente:** latencia de input, RTT, fps, bitrate, pérdida de paquetes, estabilidad en redes reales y percepción de usuario. **No se inventan datos.** El Anexo F contiene el diseño experimental, la matriz de datos y los pasos para producirla.

Los nombres de autor, institución, materia, docente y fechas de inicio son marcadores de posición porque no fueron suministrados. Deben reemplazarse antes de la entrega formal.


<!-- pagebreak -->

