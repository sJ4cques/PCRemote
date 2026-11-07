#!/usr/bin/env python3
"""Genera las figuras de la documentación de IsisAnubis.

Todas las figuras son originales y se construyen a partir de la arquitectura,
las constantes y los datos de código de los repositorios. No se usan capturas
de terceros. Salida: docs/figuras/*.png (200 dpi).
"""

from __future__ import annotations

import math
import os
from datetime import date

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle
from matplotlib.lines import Line2D

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figuras")
os.makedirs(OUT, exist_ok=True)

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.titlesize": 11,
        "axes.labelsize": 9,
        "savefig.bbox": "tight",
        "savefig.facecolor": "white",
        "figure.facecolor": "white",
    }
)

# Paleta
INK = "#111827"
MUTED = "#4B5563"
BLUE = "#1D4ED8"
BLUE_L = "#DBEAFE"
TEAL = "#0F766E"
TEAL_L = "#CCFBF1"
AMBER = "#B45309"
AMBER_L = "#FEF3C7"
RED = "#B91C1C"
RED_L = "#FEE2E2"
PURPLE = "#6D28D9"
PURPLE_L = "#EDE9FE"
GRAY = "#6B7280"
GRAY_L = "#F3F4F6"
GREEN = "#15803D"
GREEN_L = "#DCFCE7"


def box(ax, x, y, w, h, text, fc="white", ec=INK, lw=1.2, fs=9,
        weight="normal", align="center", color=INK, rounding=0.6, alpha=1.0,
        va="center"):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle=f"round,pad=0.35,rounding_size={rounding}",
        linewidth=lw, edgecolor=ec, facecolor=fc, alpha=alpha, zorder=2,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2 if align == "center" else x + 0.8,
        y + h / 2,
        text,
        ha=align, va=va, fontsize=fs, color=color, weight=weight, zorder=3,
        linespacing=1.35,
    )
    return patch


def arrow(ax, p1, p2, color=INK, lw=1.4, style="-|>", ls="-", rad=0.0,
          zorder=1, mutation=12):
    a = FancyArrowPatch(
        p1, p2, arrowstyle=style, mutation_scale=mutation,
        linewidth=lw, color=color, linestyle=ls, zorder=zorder,
        connectionstyle=f"arc3,rad={rad}", shrinkA=2, shrinkB=2,
    )
    ax.add_patch(a)
    return a


def label(ax, x, y, text, fs=8, color=MUTED, ha="center", va="center",
          weight="normal", bg=None):
    kw = {}
    if bg:
        kw["bbox"] = dict(boxstyle="round,pad=0.22", fc=bg, ec="none", alpha=0.95)
    ax.text(x, y, text, fontsize=fs, color=color, ha=ha, va=va,
            weight=weight, zorder=5, **kw)


def canvas(w=14, h=8.5):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")
    return fig, ax


# ---------------------------------------------------------------------------
# Figura 1. Arquitectura general
# ---------------------------------------------------------------------------
def fig_arquitectura():
    fig, ax = canvas(15, 9)
    ax.set_title(
        "Arquitectura general de IsisAnubis: host Windows, cliente macOS, "
        "señalización Firebase y acompañamiento Android",
        pad=14, fontsize=12, weight="bold", color=INK,
    )

    # Zonas
    box(ax, 1.5, 35, 27.5, 59, "", fc="#F8FAFC", ec=BLUE, lw=1.6, rounding=1.0)
    label(ax, 15.25, 91.5, "HOST · Windows", 10, BLUE, weight="bold")
    label(ax, 15.25, 88.4, "equipo controlado (Electron 44)", 7.5, MUTED)

    box(ax, 35.5, 50, 29, 44, "", fc="#FFFBEB", ec=AMBER, lw=1.6, rounding=1.0)
    label(ax, 50, 91.6, "FIREBASE · proyecto baobaoadmin", 9.5, AMBER, weight="bold")
    label(ax, 50, 88.6, "Firestore + Cloud Functions (Node 22)", 7.3, MUTED)

    box(ax, 71, 35, 27.5, 59, "", fc="#F5F3FF", ec=PURPLE, lw=1.6, rounding=1.0)
    label(ax, 84.75, 91.5, "CLIENTE · macOS", 10, PURPLE, weight="bold")
    label(ax, 84.75, 88.4, "equipo que controla (Electron 44)", 7.5, MUTED)

    box(ax, 35.5, 2, 29, 27, "", fc="#F0FDFA", ec=TEAL, lw=1.6, rounding=1.0)
    label(ax, 50, 26.5, "ANDROID · teléfono / tablet", 9.3, TEAL, weight="bold")
    label(ax, 50, 23.6, "Kotlin + Compose + Chaquopy (Python 3.14)", 6.9, MUTED)

    # Host internals
    box(ax, 3.3, 77, 23.9, 8.2, "Main process\ncaptura, presencia, autostart, IPC", fc=BLUE_L, ec=BLUE, fs=7.6)
    box(ax, 3.3, 66.5, 23.9, 8.2, "Renderer React 19\npanel, código/PIN, emparejamiento", fc=BLUE_L, ec=BLUE, fs=7.6)
    box(ax, 3.3, 56, 23.9, 8.2, "Input worker aislado\n@nut-tree-fork/nut-js", fc=BLUE_L, ec=BLUE, fs=7.6)
    box(ax, 3.3, 45.5, 23.9, 8.2, "Helper elevado (UIPI)\nTCP 127.0.0.1:47831", fc=RED_L, ec=RED, fs=7.6)
    box(ax, 3.3, 37.3, 23.9, 6.2, "userData: isis-host.json + isis-host.log", fc="white", ec=GRAY, fs=7.1)

    # Client internals
    box(ax, 72.8, 77, 23.9, 8.2, "Main process\npares, tapa cerrada, ventana cámara", fc=PURPLE_L, ec=PURPLE, fs=7.4)
    box(ax, 72.8, 66.5, 23.9, 8.2, "Renderer React 19\nvideo, audio, estadísticas, control", fc=PURPLE_L, ec=PURPLE, fs=7.4)
    box(ax, 72.8, 56, 23.9, 8.2, "RTCPeerConnection\nrecvonly + DataChannel ordenado", fc=PURPLE_L, ec=PURPLE, fs=7.4)
    box(ax, 72.8, 45.5, 23.9, 8.2, "Portapapeles y cursor\npoll 700 ms / overlay", fc=PURPLE_L, ec=PURPLE, fs=7.4)
    box(ax, 72.8, 37.3, 23.9, 6.2, "userData: isis-pairs.json", fc="white", ec=GRAY, fs=7.1)

    # Firebase internals
    chips = [
        ("sessions/{code}", "señalización, PIN, TTL"),
        ("presence/{hostId}", "heartbeat + probe"),
        ("pc_commands/{id}", "WoL / apagado"),
        ("tablet_commands/{id}", "orden de cámara"),
        ("tablet_stream/{id}", "oferta/answer cámara"),
        ("tablet_presence/{id}", "latido de la tablet"),
    ]
    ys = [84.5, 79.7, 74.9, 70.1, 65.3, 60.5]
    for (name, desc), y in zip(chips, ys):
        box(ax, 37.2, y, 25.6, 4.1, "", fc="white", ec=AMBER, lw=0.9)
        label(ax, 38.0, y + 2.05, name, 7.2, INK, ha="left", weight="bold")
        label(ax, 62.0, y + 2.05, desc, 6.4, MUTED, ha="right")
    box(ax, 37.2, 53.0, 25.6, 5.2, "Cloud Function onProbeWritten\nrate limit 10 probes/min", fc=AMBER_L, ec=AMBER, fs=7.1)

    # Android internals
    box(ax, 37.2, 14.2, 25.6, 6.4, "PcListenService (specialUse)\npoll pc_commands 30 s → WoL", fc=TEAL_L, ec=TEAL, fs=7.0)
    box(ax, 37.2, 6.6, 25.6, 6.4, "WebRtcCameraClient\ncámara + offer/answer", fc=TEAL_L, ec=TEAL, fs=7.0)
    box(ax, 37.2, 2.7, 25.6, 3.0, "Chaquopy: Firestore REST + JWT RS256", fc="white", ec=TEAL, fs=6.6)

    # STUN
    box(ax, 19, 17, 14, 9, "STUN público\nstun.l.google.com\n:19302", fc=GRAY_L, ec=GRAY, fs=7.0)

    # Enlaces
    arrow(ax, (29.3, 73), (35.3, 73), AMBER, 1.5, ls="--")
    label(ax, 32.3, 76.0, "HTTPS\nSDK web", 6.4, AMBER, bg="white")
    arrow(ax, (35.3, 65), (29.3, 65), AMBER, 1.5, ls="--")
    label(ax, 32.3, 61.8, "snapshots\n(señalización)", 6.4, AMBER, bg="white")
    arrow(ax, (70.7, 73), (71.0, 73), AMBER, 1.5, ls="--")
    label(ax, 71.0, 76.0, "HTTPS\nSDK web", 6.4, AMBER, bg="white")
    arrow(ax, (70.7, 65), (71.0, 65), AMBER, 1.5, ls="--")
    label(ax, 72.5, 61.8, "snapshots", 6.4, AMBER, bg="white")

    arrow(ax, (29.3, 49), (71.0, 49), PURPLE, 2.0, ls=(0, (5, 3)))
    label(ax, 50.0, 46.4, "WebRTC P2P · video/audio DTLS-SRTP + DataChannel (SCTP/DTLS)",
          7.6, PURPLE, weight="bold", bg="white")
    label(ax, 50.0, 43.4, "el medio no pasa por Firestore; solo la señalización",
          6.6, MUTED, bg="white")

    arrow(ax, (50.0, 50.0), (50.0, 29.4), TEAL, 1.6, ls="--")
    label(ax, 51.2, 38.0, "REST + service account\n(JWT → OAuth2)", 6.6, TEAL, ha="left", bg="white")
    arrow(ax, (84.7, 35.0), (61.5, 20.5), TEAL, 1.4, ls=":", rad=-0.15)
    label(ax, 76.8, 26.0, "cámara WebRTC\n(cliente → tablet)", 6.5, TEAL, bg="white")
    arrow(ax, (50.0, 29.4), (40.0, 41.0), GREEN, 1.4, ls=":")
    label(ax, 40.7, 33.0, "WoL / LAN", 6.5, GREEN, ha="right", bg="white")

    arrow(ax, (26.3, 19.0), (35.3, 19.0), GRAY, 1.4)
    arrow(ax, (65.2, 19.0), (73.0, 19.0), GRAY, 1.4)
    label(ax, 50.0, 20.6, "ICE / STUN (conectividad)", 6.5, GRAY, bg="white")

    # Leyenda
    handles = [
        Line2D([0], [0], color=AMBER, lw=1.7, ls="--", label="Señalización / control por Firestore"),
        Line2D([0], [0], color=PURPLE, lw=2.0, ls=(0, (5, 3)), label="Medios WebRTC P2P"),
        Line2D([0], [0], color=TEAL, lw=1.6, ls=":", label="Android / cámara / presencia"),
        Line2D([0], [0], color=GRAY, lw=1.4, label="STUN / ICE"),
    ]
    ax.legend(handles=handles, loc="lower center", bbox_to_anchor=(0.5, -0.05),
              ncol=4, frameon=False, fontsize=7.6)

    fig.savefig(os.path.join(OUT, "fig01_arquitectura.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 2. Secuencia de sesión
# ---------------------------------------------------------------------------
def fig_sesion():
    fig, ax = canvas(14.5, 10)
    ax.set_title(
        "Secuencia de una sesión: código manual/PIN y variante de emparejamiento persistente",
        pad=14, fontsize=12, weight="bold", color=INK,
    )

    actors = [
        ("Cliente\n(macOS)", 12, PURPLE),
        ("Firestore\nsessions/{code}", 39, AMBER),
        ("Host\n(Windows)", 66, BLUE),
        ("STUN\npúblico", 91, GRAY),
    ]
    top = 92
    for name, x, color in actors:
        box(ax, x - 7.4, top - 5, 14.8, 6.2, name, fc="white", ec=color, lw=1.6, fs=8.2, weight="bold")
        ax.plot([x, x], [7, top - 6.2], color=color, lw=1.0, ls=(0, (2, 3)), alpha=0.7)

    steps = [
        (86.5, 66, 39, "1. setDoc waiting\ncódigo 6, pinHash, expiresAt", BLUE, "right", 12),
        (81.5, 12, 39, "2. getDoc + valida\nstatus, PIN, tokenHash", PURPLE, "left", 12),
        (76.5, 12, 39, "3. offer + clientCandidates\n(token si está emparejado)", PURPLE, "left", 12),
        (71.5, 39, 66, "4. onSnapshot → setRemoteDescription\ncaptura pantalla/audio", AMBER, "right", 12),
        (66.5, 66, 39, "5. answer + hostCandidates", BLUE, "right", 12),
        (61.5, 12, 39, "6. answer aplicado\ncandidatos trickle", PURPLE, "left", 12),
        (56.5, 12, 91, "7. ICE connectivity checks", GRAY, "left", 12),
        (51.5, 66, 91, "8. ICE connectivity checks", GRAY, "right", 12),
        (46.0, 12, 66, "9. DTLS-SRTP + DataChannel\nhello → control", PURPLE, "left", 14),
        (40.0, 12, 66, "10. keepalive 5 s / healthcheck\nstats cada 2 s", PURPLE, "left", 12),
        (34.0, 66, 39, "11. presence + estado de sesión", BLUE, "right", 12),
        (28.0, 12, 66, "12. bye / caída\nhost libera a los 20 s", PURPLE, "left", 12),
    ]
    for y, x1, x2, text, color, side, fs in steps:
        arrow(ax, (x1, y), (x2, y), color, 1.4, mutation=11)
        if side == "left":
            label(ax, min(x1, x2) - 1.2, y + 1.9, text, fs, color, ha="left", va="bottom")
        else:
            label(ax, max(x1, x2) + 1.2, y + 1.9, text, fs, color, ha="right", va="bottom")

    # Nota de emparejamiento
    ax.add_patch(FancyBboxPatch((4, 8), 92, 9.6, boxstyle="round,pad=0.4,rounding_size=0.8",
                                fc="#FFFBEB", ec=AMBER, lw=1.2, zorder=2))
    ax.text(5.5, 15.8, "Variante emparejada (sin TTL, re-escucha automática):", fontsize=8.4,
            weight="bold", color=AMBER, zorder=3)
    ax.text(5.5, 12.7,
            "el host publica tokenHash = SHA-256(secret); el cliente envía token = SHA-256(secret). "
            "El host solo responde si coinciden. El secreto en claro nunca se escribe en Firestore.",
            fontsize=7.8, color=INK, zorder=3)
    ax.text(5.5, 9.8,
            "Riesgo: el token es un portador estático y el doc es legible con reglas abiertas; "
            "quien lo lea durante una sesión puede reutilizarlo (ver §6.4).",
            fontsize=7.4, color=RED, zorder=3)

    fig.savefig(os.path.join(OUT, "fig02_sesion.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 3. Presencia, probe y energía
# ---------------------------------------------------------------------------
def fig_presencia():
    fig, ax = canvas(15, 9.2)
    ax.set_title(
        "Presencia pasiva, probe bajo demanda y cadena de encendido/apagado",
        pad=14, fontsize=12, weight="bold", color=INK,
    )

    # Carriles
    for y, title, color in [(78, "A · Liveness pasiva (lecturas baratas)", TEAL),
                            (48, "B · Probe activo bajo demanda", AMBER),
                            (15, "C · Energía: Wake-on-LAN y apagado remoto", GREEN)]:
        ax.add_patch(Rectangle((1.5, y - 2), 97, 25, fc="#F9FAFB", ec="#E5E7EB", lw=0.8, zorder=0))
        label(ax, 2.6, y + 20.6, title, 8.8, color, ha="left", weight="bold")

    # A: heartbeat
    box(ax, 4, 88, 15, 8, "Host\nheartbeat 5 min", fc=BLUE_L, ec=BLUE, fs=7.6)
    box(ax, 26, 88, 20, 8, "presence/{hostId}\nstate · bootId · IP · idle", fc=AMBER_L, ec=AMBER, fs=7.2)
    box(ax, 53, 88, 17, 8, "Android\nlectura pasiva 30 s", fc=TEAL_L, ec=TEAL, fs=7.4)
    box(ax, 77, 88, 18, 8, "Cliente Electron\npoll 30 s (por equipo)", fc=PURPLE_L, ec=PURPLE, fs=7.2)
    arrow(ax, (19.2, 92), (25.8, 92), BLUE, 1.4)
    arrow(ax, (46.2, 92), (52.8, 92), AMBER, 1.4)
    arrow(ax, (70.2, 92), (76.8, 92), AMBER, 1.4)
    label(ax, 49.5, 84.0, "si lastHeartbeatAt > 10 min → «sin señal» aunque state=online", 6.8, MUTED)

    # B: probe
    box(ax, 4, 55, 15, 8, "Teléfono/tablet\nrequestId nuevo", fc=TEAL_L, ec=TEAL, fs=7.4)
    box(ax, 25, 55, 19, 8, "probe/pending\n+ Function", fc=AMBER_L, ec=AMBER, fs=7.4)
    box(ax, 49, 55, 18, 8, "rate limit 10/min\ndispatchedAt", fc=AMBER_L, ec=AMBER, fs=7.2)
    box(ax, 72, 55, 16, 8, "Host\nhealth check", fc=BLUE_L, ec=BLUE, fs=7.4)
    box(ax, 38, 40, 20, 7, "probe/answer\nrequestId · state · captureOk", fc=AMBER_L, ec=AMBER, fs=7.0)
    arrow(ax, (19.2, 59), (24.8, 59), TEAL, 1.4)
    arrow(ax, (44.2, 59), (48.8, 59), AMBER, 1.4)
    arrow(ax, (67.2, 59), (71.8, 59), AMBER, 1.4)
    arrow(ax, (80, 54.8), (54.5, 47.2), BLUE, 1.4, rad=0.1)
    arrow(ax, (37.8, 43.5), (12, 54.8), AMBER, 1.4, rad=0.1)
    label(ax, 20.0, 49.2, "lectura cada 2 s\n(timeout 25 s)", 6.5, MUTED)
    label(ax, 85.5, 47.0, "descarta probe\n> 30 s", 6.3, RED)

    # C: energía
    box(ax, 4, 22, 17, 8, "Cliente\npowerOn=true", fc=PURPLE_L, ec=PURPLE, fs=7.4)
    box(ax, 27, 22, 19, 8, "pc_commands/{hostId}\no /desktop (legacy)", fc=AMBER_L, ec=AMBER, fs=7.2)
    box(ax, 52, 22, 18, 8, "Tablet\npoll 30 s → WoL", fc=TEAL_L, ec=TEAL, fs=7.4)
    box(ax, 76, 22, 18, 8, "Magic packet\nMAC + broadcast", fc=GREEN_L, ec=GREEN, fs=7.4)
    arrow(ax, (21.2, 26), (26.8, 26), PURPLE, 1.4)
    arrow(ax, (46.2, 26), (51.8, 26), AMBER, 1.4)
    arrow(ax, (70.2, 26), (75.8, 26), TEAL, 1.4)
    box(ax, 27, 10, 44, 7.5, "Host escucha powerOn=false con timestamp fresco (≤30 s)\n→ shutdown del SO", fc=RED_L, ec=RED, fs=7.2)
    arrow(ax, (49, 21.8), (49, 17.8), RED, 1.4, ls="--")
    label(ax, 74.5, 13.8, "sin autenticación:\ncualquiera con el hostId\npuede apagar la PC", 6.3, RED, ha="left")

    fig.savefig(os.path.join(OUT, "fig03_presencia.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 4. Límites de confianza
# ---------------------------------------------------------------------------
def fig_confianza():
    fig, ax = canvas(14.5, 9)
    ax.set_title(
        "Límites de confianza y superficies de exposición del prototipo",
        pad=14, fontsize=12, weight="bold", color=INK,
    )

    ax.add_patch(FancyBboxPatch((1, 1), 98, 94, boxstyle="round,pad=0.5,rounding_size=1.2",
                                fc="#FEF2F2", ec=RED, lw=1.8, ls="--", zorder=0))
    label(ax, 2.6, 93.0, "INTERNET / RED NO CONFIABLE", 8.4, RED, ha="left", weight="bold")

    # Firebase
    box(ax, 32, 58, 36, 30, "", fc="#FFFBEB", ec=AMBER, lw=1.8, rounding=1.0)
    label(ax, 50, 85.0, "Firebase baobaoadmin", 9.2, AMBER, weight="bold")
    label(ax, 50, 81.6, "reglas abiertas en colecciones núcleo", 7.2, RED)
    for i, t in enumerate(["sessions", "presence", "pc_commands",
                           "tablet_commands", "tablet_stream", "tablet_presence"]):
        box(ax, 34.0 + (i % 3) * 11.2, 71.5 - (i // 3) * 7.0, 10.2, 4.8, t,
            fc="white", ec=AMBER, lw=0.8, fs=6.4)
    box(ax, 34, 60.0, 32, 5.4, "Cloud Function: rate limit 10/min (no es barrera de seguridad)",
        fc=AMBER_L, ec=AMBER, fs=6.6)

    # Host
    box(ax, 3, 28, 28, 26, "", fc="#EFF6FF", ec=BLUE, lw=1.8, rounding=1.0)
    label(ax, 17, 50.5, "HOST · Windows", 9.0, BLUE, weight="bold")
    label(ax, 17, 47.2, "isis-host.json (secreto en claro)", 6.8, RED)
    ax.text(4.4, 43.0, "• Captura de pantalla y audio\n• Inyección de mouse/teclado\n• Helper elevado (UIPI)\n• Log isis-host.log",
            fontsize=6.8, color=INK, va="top", linespacing=1.5)
    box(ax, 4.2, 30.0, 25.4, 5.0, "Helper TCP 127.0.0.1:47831\nauth = secreto de 8 chars",
        fc=RED_L, ec=RED, fs=6.5)

    # Cliente
    box(ax, 69, 28, 28, 26, "", fc="#F5F3FF", ec=PURPLE, lw=1.8, rounding=1.0)
    label(ax, 83, 50.5, "CLIENTE · macOS", 9.0, PURPLE, weight="bold")
    label(ax, 83, 47.2, "isis-pairs.json (secretos en claro)", 6.8, RED)
    ax.text(70.4, 43.0, "• Pares guardados por equipo\n• Video/audio remoto\n• Portapapeles\n• Ventana de cámara",
            fontsize=6.8, color=INK, va="top", linespacing=1.5)
    box(ax, 70.2, 30.0, 25.4, 5.0, "CSP + contextIsolation\nnodeIntegration=false",
        fc=PURPLE_L, ec=PURPLE, fs=6.5)

    # Android
    box(ax, 33, 6, 34, 20, "", fc="#F0FDFA", ec=TEAL, lw=1.8, rounding=1.0)
    label(ax, 50, 23.0, "ANDROID · APK", 9.0, TEAL, weight="bold")
    label(ax, 50, 19.8, "cuenta de servicio embebida = acceso total", 6.8, RED)
    ax.text(34.4, 17.0, "• firestore_config.py: private_key completa\n• JWT RS256 → OAuth2 → Firestore REST\n• SharedPreferences: hostId + secret\n• Cámara y Foreground Service",
            fontsize=6.7, color=INK, va="top", linespacing=1.45)

    # Límites
    for (x, y1, y2, txt) in [(31.4, 58, 88, "B1"), (68.6, 58, 88, "B2"),
                             (31.4, 26, 54, "B3"), (68.6, 26, 54, "B4"),
                             (31.4, 6, 26, "B5"), (68.6, 6, 26, "B6")]:
        ax.plot([x, x], [y1, y2], color=RED, lw=2.0, ls=(0, (4, 3)), zorder=4)
        label(ax, x, max(y1, y2) + 1.2, txt, 7.4, RED, weight="bold")

    # Flechas
    arrow(ax, (31.0, 70), (17.2, 54.5), AMBER, 1.5, ls="--")
    label(ax, 22.6, 64.0, "SDK web\nanónimo", 6.4, AMBER, bg="white")
    arrow(ax, (68.9, 70), (82.8, 54.5), AMBER, 1.5, ls="--")
    label(ax, 77.2, 64.0, "SDK web\nanónimo", 6.4, AMBER, bg="white")
    arrow(ax, (50, 58), (50, 26.2), TEAL, 1.6, ls="--")
    label(ax, 51.2, 42.0, "REST + service account\n(salta las reglas)", 6.5, TEAL, ha="left", bg="white")
    arrow(ax, (17.2, 54.5), (17.2, 28.2), BLUE, 1.2, ls=":")
    arrow(ax, (82.8, 54.5), (82.8, 28.2), PURPLE, 1.2, ls=":")
    arrow(ax, (69.0, 34.0), (59.5, 20.0), TEAL, 1.4, ls=":")
    label(ax, 66.8, 26.0, "cámara WebRTC", 6.3, TEAL, bg="white")

    # Activos
    ax.add_patch(FancyBboxPatch((3, 1.6), 94, 4.0, boxstyle="round,pad=0.3,rounding_size=0.6",
                                fc="white", ec=RED, lw=1.0, zorder=3))
    ax.text(4.5, 3.6,
            "Activos críticos: pantalla y audio del host · control de mouse/teclado · secretos de emparejamiento · "
            "credencial de servicio · cámara de la tablet · órdenes de encendido/apagado",
            fontsize=6.9, color=INK, va="center", zorder=4)

    fig.savefig(os.path.join(OUT, "fig04_confianza.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 5. Métricas de código
# ---------------------------------------------------------------------------
def fig_modulos():
    labels = [
        "shared (TS)", "host-app (TS/TSX)", "client-app (TS/TSX)",
        "functions (TS)", "scripts (TS)",
        "Android Kotlin", "Android Python",
    ]
    values = [2202, 3477, 3112, 153, 238, 3558, 2165]
    colors = [BLUE, BLUE, PURPLE, AMBER, GRAY, TEAL, TEAL]
    fig, ax = plt.subplots(figsize=(11.5, 6.2))
    y = np.arange(len(labels))
    bars = ax.barh(y, values, color=colors, alpha=0.88, edgecolor="white", height=0.66)
    ax.set_yticks(y, labels)
    ax.invert_yaxis()
    ax.set_xlabel("Líneas de código (archivos .ts/.tsx/.kt/.py, sin configs)")
    ax.set_title("Volumen de código por módulo (estado del repositorio al 2026-11-07)",
                 weight="bold", pad=12)
    ax.grid(axis="x", color="#E5E7EB", lw=0.8)
    ax.set_axisbelow(True)
    for b, v in zip(bars, values):
        ax.text(v + 55, b.get_y() + b.get_height() / 2, f"{v:,}".replace(",", "."),
                va="center", fontsize=8.5, color=INK, weight="bold")
    ax.set_xlim(0, max(values) * 1.15)
    fig.text(0.01, -0.02,
             "Fuente: conteo propio con wc -l sobre los repositorios. No incluye tests, configuraciones ni artefactos generados.",
             fontsize=7.4, color=MUTED)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig05_modulos.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 6. Presupuestos de tiempo
# ---------------------------------------------------------------------------
def fig_tiempos():
    items = [
        ("Move de mouse (throttle)", 0.025, "Entrada"),
        ("Wheel (acumulación)", 0.080, "Entrada"),
        ("Watchdog de input", 3.5, "Entrada"),
        ("Keepalive cliente", 5.0, "Liveness"),
        ("Gracia ICE perdido", 8.0, "Liveness"),
        ("Cliente declara caída", 15.0, "Liveness"),
        ("Host libera sesión", 20.0, "Liveness"),
        ("Poll de respuesta probe", 2.0, "Probe"),
        ("Timeout de probe", 25.0, "Probe"),
        ("Edad máx. de probe", 30.0, "Probe"),
        ("Negociación WebRTC", 90.0, "Señalización"),
        ("TTL sesión manual", 600.0, "Señalización"),
        ("Heartbeat host", 300.0, "Presencia"),
        ("Host «sin señal»", 600.0, "Presencia"),
        ("Heartbeat tablet", 60.0, "Presencia"),
        ("Tablet «sin señal»", 150.0, "Presencia"),
        ("Poll WoL tablet", 30.0, "Presencia"),
    ]
    order = ["Entrada", "Liveness", "Probe", "Señalización", "Presencia"]
    cmap = {"Entrada": BLUE, "Liveness": PURPLE, "Probe": AMBER,
            "Señalización": RED, "Presencia": TEAL}
    items = sorted(items, key=lambda t: (order.index(t[2]), t[1]))
    labels = [f"{n}" for n, _, _ in items]
    vals = [v for _, v, _ in items]
    colors = [cmap[c] for _, _, c in items]
    fig, ax = plt.subplots(figsize=(11.8, 7.0))
    y = np.arange(len(items))
    ax.barh(y, vals, color=colors, alpha=0.86, height=0.66, edgecolor="white")
    ax.set_xscale("log")
    ax.set_yticks(y, labels)
    ax.invert_yaxis()
    ax.set_xlabel("Segundos (escala logarítmica)")
    ax.set_title("Presupuestos de tiempo y umbrales de diseño del sistema", weight="bold", pad=12)
    ax.grid(axis="x", which="both", color="#E5E7EB", lw=0.7)
    ax.set_axisbelow(True)
    for b, v in zip(ax.patches, vals):
        txt = f"{v:g} s" if v >= 1 else f"{v*1000:g} ms"
        ax.text(v * 1.08, b.get_y() + b.get_height() / 2, txt, va="center",
                fontsize=7.6, color=INK, weight="bold")
    handles = [Line2D([0], [0], color=cmap[k], lw=5, label=k) for k in order]
    ax.legend(handles=handles, loc="lower right", frameon=False, fontsize=7.4, ncol=2)
    ax.set_xlim(0.015, 1600)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig06_tiempos.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 7. Matriz de riesgos
# ---------------------------------------------------------------------------
def fig_riesgos():
    risks = [
        ("R1", 5, 5, "Cuenta de servicio en el APK"),
        ("R2", 5, 5, "Reglas Firestore abiertas"),
        ("R3", 4, 5, "Token de emparejamiento reutilizable"),
        ("R4", 4, 4, "Secreto de 8 caracteres"),
        ("R5", 4, 4, "Apagado remoto sin autenticación"),
        ("R6", 3, 5, "Activación/hijack de cámara"),
        ("R7", 3, 4, "PIN corto con hash expuesto"),
        ("R8", 3, 3, "Secretos locales en claro"),
        ("R9", 2, 5, "IPC elevado en loopback"),
        ("R10", 3, 4, "Integridad de señalización"),
        ("R11", 4, 2, "Sin TURN / NAT simétrico"),
        ("R12", 2, 3, "Portapapeles sin E2EE"),
        ("R13", 2, 3, "Fuga de datos en logs"),
        ("R14", 4, 3, "Abuso de cuota / costo"),
    ]
    fig, ax = plt.subplots(figsize=(11.5, 7.4))
    ax.set_xlim(0.5, 5.5)
    ax.set_ylim(0.5, 5.5)
    ax.set_xticks(range(1, 6))
    ax.set_yticks(range(1, 6))
    ax.set_xlabel("Probabilidad estimada (1 = baja, 5 = alta)")
    ax.set_ylabel("Impacto estimado (1 = bajo, 5 = alto)")
    ax.set_title("Matriz de riesgos de seguridad del prototipo (estimación por análisis estático)",
                 weight="bold", pad=12)

    for i in range(1, 6):
        for j in range(1, 6):
            score = i * j
            color = "#FEE2E2" if score >= 15 else "#FFEDD5" if score >= 9 else "#FEF9C3" if score >= 4 else "#DCFCE7"
            ax.add_patch(Rectangle((i - 0.5, j - 0.5), 1, 1, fc=color, ec="white", lw=1.2, zorder=0))

    for code, l, imp, _ in risks:
        color = RED if l * imp >= 15 else AMBER if l * imp >= 9 else GRAY
        ax.scatter(l, imp, s=230, color=color, edgecolor="white", linewidth=1.4, zorder=3)
        ax.text(l, imp, code, ha="center", va="center", fontsize=7.2,
                color="white", weight="bold", zorder=4)

    # Etiquetas en dos columnas para no tapar la matriz
    ax.legend(
        handles=[Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markersize=8, label=t)
                 for c, t in [(RED, "Crítico (≥15)"), (AMBER, "Alto (9–14)"), (GRAY, "Medio/bajo (<9)")]],
        loc="upper left", bbox_to_anchor=(0.01, 0.99), frameon=True, fontsize=7.4,
    )
    note = "\n".join([f"{c} · {t}" for c, _, _, t in risks])
    ax.text(1.02, 0.02, note, transform=ax.transAxes, fontsize=6.9, va="bottom",
            bbox=dict(boxstyle="round,pad=0.5", fc="white", ec="#E5E7EB"))
    ax.grid(color="white", lw=1.0)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig07_riesgos.png"), dpi=200)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figura 8. Cronograma
# ---------------------------------------------------------------------------
def fig_cronograma():
    phases = [
        ("Fase 0 · Definición y entorno", date(2026, 9, 5), date(2026, 9, 8), GRAY),
        ("Fase 1 · Señalización y sesión manual", date(2026, 9, 8), date(2026, 9, 12), BLUE),
        ("Fase 2 · Captura, audio y portapapeles", date(2026, 9, 12), date(2026, 9, 16), BLUE),
        ("Fase 3 · Input y helper elevado", date(2026, 9, 16), date(2026, 9, 28), PURPLE),
        ("Fase 4 · Emparejamiento, presencia y WoL", date(2026, 9, 28), date(2026, 10, 13), TEAL),
        ("Fase 5 · Android, cámara e integración", date(2026, 10, 13), date(2026, 10, 19), AMBER),
        ("Fase 6 · Documentación y validación", date(2026, 10, 19), date(2026, 11, 7), RED),
    ]
    fig, ax = plt.subplots(figsize=(12.2, 5.8))
    for i, (name, start, end, color) in enumerate(phases):
        ax.barh(i, (end - start).days, left=start, height=0.55, color=color, alpha=0.86,
                edgecolor="white")
        ax.text(end, i, f"  {end.strftime('%d/%m')}", va="center", fontsize=7.4, color=MUTED)
    ax.set_yticks(range(len(phases)), [p[0] for p in phases])
    ax.invert_yaxis()
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d/%m"))
    ax.set_xlim(date(2026, 9, 4), date(2026, 11, 12))
    ax.grid(axis="x", color="#E5E7EB", lw=0.8)
    ax.set_axisbelow(True)
    ax.set_title("Plan de trabajo reconstruido a partir del historial de commits (2026)",
                 weight="bold", pad=12)

    milestones = [
        (date(2026, 9, 6), "Beta Android"),
        (date(2026, 9, 8), "Primera demo"),
        (date(2026, 9, 16), "Fix input worker"),
        (date(2026, 9, 28), "Modo bocina"),
        (date(2026, 10, 18), "Cámara tablet"),
        (date(2026, 11, 7), "Documentación"),
    ]
    for d, text in milestones:
        ax.axvline(d, color=RED, lw=0.8, ls=":", alpha=0.55)
        ax.text(d, len(phases) - 0.35, text, rotation=90, fontsize=6.6,
                color=RED, ha="right", va="top")

    fig.text(0.01, -0.03,
             "Las fases son una reconstrucción interpretativa de los commits; no sustituyen un cronograma formal aprobado.",
             fontsize=7.2, color=MUTED)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig08_cronograma.png"), dpi=200)
    plt.close(fig)


if __name__ == "__main__":
    fig_arquitectura()
    fig_sesion()
    fig_presencia()
    fig_confianza()
    fig_modulos()
    fig_tiempos()
    fig_riesgos()
    fig_cronograma()
    print("Figuras generadas en", OUT)
