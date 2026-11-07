#!/usr/bin/env python3
"""Genera DOCUMENTACION_ISISANUBIS.docx a partir del Markdown unificado.

Uso:
    python docs/generar_docx.py

Requiere python-docx. El documento resultante usa A4, Calibri 11, margenes de
2.5 cm, encabezado/pie con campos de pagina y un campo TOC que Word actualiza
al abrir el archivo (w:updateFields).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BASE = Path(__file__).resolve().parent.parent
MD_PATH = BASE / "DOCUMENTACION_ISISANUBIS.md"
OUT_PATH = BASE / "DOCUMENTACION_ISISANUBIS.docx"

NAVY = RGBColor(0x1F, 0x38, 0x64)
BLUE = RGBColor(0x2E, 0x54, 0x96)
GRAY = RGBColor(0x59, 0x59, 0x59)
LIGHT_GRAY = RGBColor(0x7F, 0x7F, 0x7F)
CODE_COLOR = RGBColor(0x8B, 0x1A, 0x1A)
TBLPR_ORDER = [
    "tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize",
    "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd",
    "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption",
    "tblDescription", "tblPrChange",
]
BODY_FONT = "Calibri"
CODE_FONT = "Consolas"

HEADER_FILL = "1F3864"
ZEBRA_FILL = "F3F5F9"
CODE_FILL = "F4F4F4"
QUOTE_FILL = "F7F9FC"
BORDER_COLOR = "BFC7D5"

INLINE_RE = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)")
SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+\.)\s+(.*)$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
IMAGE_RE = re.compile(r"^!\[([^\]]*)\]\(([^)]+)\)$")
CAPTION_RE = re.compile(r"^\*\*(Tabla|Figura)\s+[0-9A-Z]+(?:\.[0-9]+)?\.\*\*")


def clean_math(text: str) -> str:
    """Convierte notacion LaTeX sencilla a texto legible."""
    text = text.replace(r"\(", "").replace(r"\)", "")
    text = text.replace(r"\[", "").replace(r"\]", "")
    text = text.replace(r"\log_2", "log₂")
    text = text.replace(r"\approx", "≈")
    text = text.replace(r"\times", "×")
    text = text.replace(r"\ge", "≥")
    text = text.replace(r"\le", "≤")
    text = text.replace(r"\cdot", "·")
    # Potencias simples: 31^8 -> 31⁸
    def repl(m: re.Match[str]) -> str:
        base, exp = m.group(1), m.group(2)
        return base + exp.translate(SUPERSCRIPT)

    return re.sub(r"([0-9A-Za-z]+)\^([0-9]+)", repl, text)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_margins(table, top: int = 40, start: int = 70, bottom: int = 40, end: int = 70) -> None:
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for tag, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = OxmlElement(f"w:{tag}")
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tbl_pr.append(mar)


def set_table_borders(table, color: str = BORDER_COLOR, size: int = 4) -> None:
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tbl_pr.append(borders)


def set_table_width_pct(table, pct: int = 100) -> None:
    tbl_pr = table._tbl.tblPr
    tbl_w = OxmlElement("w:tblW")
    tbl_w.set(qn("w:w"), str(pct * 50))
    tbl_w.set(qn("w:type"), "pct")
    tbl_pr.append(tbl_w)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tbl_pr.append(layout)


def normalize_table_properties(table) -> None:
    """Deja los hijos de tblPr sin duplicados y en el orden del esquema OOXML.

    python-docx ya crea un w:tblW (auto) al insertar la tabla; agregar otro
    produce XML invalido que Word puede marcar como contenido ilegible.
    """
    tbl_pr = table._tbl.tblPr
    kept: dict[str, object] = {}
    for child in list(tbl_pr):
        name = child.tag.split("}")[-1]
        if name in kept:
            tbl_pr.remove(kept[name])
        kept[name] = child

    def sort_key(child) -> int:
        name = child.tag.split("}")[-1]
        return TBLPR_ORDER.index(name) if name in TBLPR_ORDER else len(TBLPR_ORDER)

    for child in sorted(list(tbl_pr), key=sort_key):
        tbl_pr.remove(child)
        tbl_pr.append(child)


def keep_row_together(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant = OxmlElement("w:cantSplit")
    tr_pr.append(cant)


def mark_header_row(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    hdr = OxmlElement("w:tblHeader")
    hdr.set(qn("w:val"), "true")
    tr_pr.append(hdr)


def add_run(paragraph, text: str, *, bold=False, italic=False, size=None,
            color=None, font=BODY_FONT, superscript=False):
    run = paragraph.add_run(text)
    run.bold = bold
    run.italic = italic
    if font:
        run.font.name = font
        rpr = run._element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.append(rfonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            rfonts.set(qn(attr), font)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = color
    if superscript:
        run.font.superscript = True
    return run


def add_inline(paragraph, text: str, *, bold=False, italic=False, size=None,
               color=None, font=BODY_FONT):
    """Agrega texto con **negrita**, *cursiva*, _cursiva_ y `codigo`."""
    text = clean_math(text)
    pos = 0
    for match in INLINE_RE.finditer(text):
        if match.start() > pos:
            add_run(paragraph, text[pos:match.start()], bold=bold, italic=italic,
                    size=size, color=color, font=font)
        token = match.group(0)
        if token.startswith("`"):
            add_run(paragraph, token[1:-1], bold=bold, italic=italic, size=(size - 0.5 if size else 9.5),
                    color=CODE_COLOR, font=CODE_FONT)
        elif token.startswith("**"):
            add_inline(paragraph, token[2:-2], bold=True, italic=italic, size=size, color=color, font=font)
        elif token.startswith("*"):
            add_inline(paragraph, token[1:-1], bold=bold, italic=True, size=size, color=color, font=font)
        else:  # _cursiva_
            add_inline(paragraph, token[1:-1], bold=bold, italic=True, size=size, color=color, font=font)
        pos = match.end()
    if pos < len(text):
        add_run(paragraph, text[pos:], bold=bold, italic=italic, size=size, color=color, font=font)


def add_paragraph_border(paragraph, edge: str = "bottom", color: str = BORDER_COLOR,
                         size: int = 6, space: int = 2) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    el = OxmlElement(f"w:{edge}")
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), str(size))
    el.set(qn("w:space"), str(space))
    el.set(qn("w:color"), color)
    p_bdr.append(el)


def shade_paragraph(paragraph, fill: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)


def add_field(paragraph, instruction: str, placeholder: str = "") -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(separate)
    run._r.append(text)
    run._r.append(end)


def configure_styles(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(11)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), BODY_FONT)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15
    normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    sizes = {1: 17, 2: 13.5, 3: 11.5, 4: 11}
    for level, size in sizes.items():
        style = styles[f"Heading {level}"]
        style.font.name = BODY_FONT
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = NAVY if level <= 2 else BLUE
        style.font.italic = False
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(16 if level == 1 else 12)
        style.paragraph_format.space_after = Pt(8 if level == 1 else 5)
        style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        srpr = style.element.get_or_add_rPr()
        sfonts = srpr.find(qn("w:rFonts"))
        if sfonts is None:
            sfonts = OxmlElement("w:rFonts")
            srpr.append(sfonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            sfonts.set(qn(attr), BODY_FONT)


def setup_page(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)
    section.header_distance = Cm(1.25)
    section.footer_distance = Cm(1.25)
    section.different_first_page_header_footer = True

    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    add_run(hp, "IsisAnubis · Documentación técnica y académica", size=8, color=LIGHT_GRAY)
    add_paragraph_border(hp, "bottom", BORDER_COLOR, 4, 2)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.paragraph_format.tab_stops.add_tab_stop(Cm(16), alignment=2)  # right
    add_run(fp, "Versión 1.0 · Noviembre de 2026", size=8, color=LIGHT_GRAY)
    add_run(fp, "\tPágina ", size=8, color=LIGHT_GRAY)
    add_field(fp, "PAGE", "1")
    add_run(fp, " de ", size=8, color=LIGHT_GRAY)
    add_field(fp, "NUMPAGES", "1")


def add_cover_title(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    add_run(p, text, bold=True, size=32, color=NAVY, font=BODY_FONT)
    add_paragraph_border(p, "bottom", "1F3864", 12, 6)


def add_cover_subtitle(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(10)
    add_run(p, text, bold=False, size=13.5, color=GRAY)


def add_toc(doc: Document) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    add_field(p, 'TOC \\o "1-2" \\h \\z \\u',
              "Índice en campo. Si no aparece, haga clic derecho sobre él y elija "
              "«Actualizar campos», o seleccione todo (Ctrl+A / Cmd+A) y pulse F9.")


def add_code_block(doc: Document, lines: list[str]) -> None:
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.35)
    pf.right_indent = Cm(0.2)
    pf.space_before = Pt(4)
    pf.space_after = Pt(8)
    shade_paragraph(p, CODE_FILL)
    add_paragraph_border(p, "top", "D0D0D0", 4, 4)
    add_paragraph_border(p, "bottom", "D0D0D0", 4, 4)
    for i, line in enumerate(lines):
        if i:
            p.add_run().add_break()
        add_run(p, line if line else " ", size=8, color=RGBColor(0x33, 0x33, 0x33), font=CODE_FONT)


def add_quote(doc: Document, lines: list[str]) -> None:
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.9)
    pf.right_indent = Cm(0.5)
    pf.space_before = Pt(4)
    pf.space_after = Pt(8)
    shade_paragraph(p, QUOTE_FILL)
    add_paragraph_border(p, "left", "1F3864", 18, 6)
    for i, line in enumerate(lines):
        if i:
            p.add_run().add_break()
        add_inline(p, line, size=10.5, color=RGBColor(0x33, 0x33, 0x33))


def add_list_item(doc: Document, indent: str, marker: str, text: str) -> None:
    level = min(len(indent.expandtabs(2)) // 2, 3)
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.55 + 0.55 * level)
    pf.first_line_indent = Cm(-0.4)
    pf.space_after = Pt(3)
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
    bullet = "•" if not marker[0].isdigit() else marker
    add_run(p, bullet + " ", size=11, color=NAVY)
    add_inline(p, text)


def add_markdown_table(doc: Document, rows: list[list[str]], header: bool,
                       cover: bool = False) -> None:
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    table = doc.add_table(rows=0, cols=ncols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    set_table_borders(table)
    set_table_width_pct(table, 100)
    set_cell_margins(table)

    # Pesos por longitud media para repartir el ancho disponible.
    page_width_cm = 16.0
    weights = []
    for col in range(ncols):
        lengths = [len(re.sub(r"[*_`]", "", row[col])) for row in rows[: min(len(rows), 12)]]
        weights.append(max(5.0, min(42.0, (sum(lengths) / max(1, len(lengths))) ** 0.65)))
    total = sum(weights) or 1
    widths = [page_width_cm * w / total for w in weights]
    # tblLayout=fixed usa w:tblGrid/w:gridCol: hay que fijar ahi el ancho.
    for c_idx, width in enumerate(widths):
        table.columns[c_idx].width = Cm(width)

    font_size = 9.5 if cover else (8.0 if ncols <= 5 else (7.5 if ncols <= 7 else 7.0))
    for r_idx, row_data in enumerate(rows):
        row = table.add_row()
        keep_row_together(row)
        if header and r_idx == 0:
            mark_header_row(row)
        for c_idx, cell_text in enumerate(row_data):
            cell = row.cells[c_idx]
            cell.width = Cm(widths[c_idx])
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.line_spacing = 1.0
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            is_header = header and r_idx == 0
            if is_header:
                set_cell_shading(cell, HEADER_FILL)
                add_inline(p, cell_text, bold=True, size=font_size,
                           color=RGBColor(0xFF, 0xFF, 0xFF))
            else:
                if r_idx % 2 == 0:
                    set_cell_shading(cell, ZEBRA_FILL)
                add_inline(p, cell_text, size=font_size, color=RGBColor(0x1A, 0x1A, 0x1A))
    # Espacio despues de la tabla
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    normalize_table_properties(table)


def add_image(doc: Document, alt: str, rel_path: str) -> None:
    path = (BASE / rel_path).resolve()
    if not path.exists():
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_run(p, f"[Imagen no disponible: {rel_path}]", italic=True, size=9, color=GRAY)
        return
    width = Cm(3.4) if "icon-master" in rel_path else Cm(15.4)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    run.add_picture(str(path), width=width)


def add_caption(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    add_inline(p, text, italic=True, size=9, color=GRAY)


def preprocess(markdown: str) -> str:
    markdown = re.sub(r"<!-- TOC -->.*?<!-- /TOC -->", "\n[[TOC]]\n", markdown, flags=re.S)
    markdown = re.sub(r"<!--\s*pagebreak\s*-->", "\n[[PAGEBREAK]]\n", markdown)
    markdown = re.sub(r"<!--.*?-->", "", markdown, flags=re.S)
    return markdown


def build() -> None:
    if not MD_PATH.exists():
        sys.exit(f"No existe {MD_PATH}; ejecute primero la concatenacion de docs/md/*.md")
    text = preprocess(MD_PATH.read_text(encoding="utf-8"))
    lines = text.splitlines()

    doc = Document()
    configure_styles(doc)
    setup_page(doc)

    core = doc.core_properties
    core.title = "IsisAnubis · Documentación técnica y académica"
    core.subject = "Escritorio remoto, WebRTC, Firebase y seguridad"
    core.author = "[Nombre completo del autor]"
    core.keywords = "IsisAnubis, WebRTC, Firebase, Electron, Android, seguridad"
    core.comments = "Versión 1.0 · Noviembre de 2026"

    # w:updateFields hace que Word actualice TOC y numeros al abrir.
    settings = doc.settings.element
    update = OxmlElement("w:updateFields")
    update.set(qn("w:val"), "true")
    settings.append(update)

    first_h1 = True
    last_pagebreak = False
    after_cover_title = False
    front_matter = {
        "Agradecimientos", "Dedicatoria", "Resumen", "Abstract",
        "Nota sobre el estado de la evidencia", "Índice general",
        "Lista de tablas", "Lista de figuras",
    }
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        line = raw.rstrip()

        if not line.strip():
            i += 1
            continue

        if line.strip() == "[[PAGEBREAK]]":
            doc.add_page_break()
            last_pagebreak = True
            i += 1
            continue

        if line.strip() == "[[TOC]]":
            add_toc(doc)
            last_pagebreak = False
            i += 1
            continue

        # Bloques de codigo
        if line.lstrip().startswith("```"):
            i += 1
            code_lines = []
            while i < n and not lines[i].lstrip().startswith("```"):
                code_lines.append(lines[i].rstrip("\n"))
                i += 1
            i += 1
            add_code_block(doc, code_lines)
            last_pagebreak = False
            continue

        # Imagen
        m = IMAGE_RE.match(line.strip())
        if m:
            add_image(doc, m.group(1), m.group(2))
            last_pagebreak = False
            i += 1
            continue

        # Encabezados
        m = HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            heading_text = m.group(2).strip()
            if level == 1:
                if not first_h1 and not last_pagebreak:
                    doc.add_page_break()
                first_h1 = False
                if heading_text == "IsisAnubis":
                    add_cover_title(doc, heading_text)
                    after_cover_title = True
                else:
                    p = doc.add_paragraph(style="Heading 1")
                    add_run(p, heading_text, bold=True, size=17, color=NAVY)
                    add_paragraph_border(p, "bottom", "1F3864", 8, 4)
                    if heading_text in front_matter:
                        # Excluye el material preliminar del campo TOC.
                        outline = OxmlElement("w:outlineLvl")
                        outline.set(qn("w:val"), "9")
                        p._p.get_or_add_pPr().append(outline)
                    after_cover_title = False
            elif level == 2:
                if after_cover_title:
                    add_cover_subtitle(doc, heading_text)
                    after_cover_title = False
                else:
                    p = doc.add_paragraph(style="Heading 2")
                    add_run(p, heading_text, bold=True, size=13.5, color=NAVY)
            elif level == 3:
                p = doc.add_paragraph(style="Heading 3")
                add_run(p, heading_text, bold=True, size=11.5, color=BLUE)
            else:
                p = doc.add_paragraph(style="Heading 4")
                add_run(p, heading_text, bold=True, size=11, color=BLUE)
            last_pagebreak = False
            i += 1
            continue

        # Tablas
        if line.lstrip().startswith("|"):
            table_lines = []
            while i < n and lines[i].lstrip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            parsed = []
            separator_seen = False
            for tline in table_lines:
                cells = [c.strip() for c in tline.strip().strip("|").split("|")]
                if all(re.fullmatch(r":?-{3,}:?", c or "---") for c in cells):
                    separator_seen = True
                    continue
                parsed.append(cells)
            if parsed:
                cover = parsed[0][0].lower().startswith("campo") and len(parsed[0]) == 2
                add_markdown_table(doc, parsed, header=True, cover=cover)
            last_pagebreak = False
            continue

        # Cita
        if line.lstrip().startswith(">"):
            quote_lines = []
            while i < n and lines[i].lstrip().startswith(">"):
                quote_lines.append(re.sub(r"^\s*>\s?", "", lines[i]).rstrip())
                i += 1
            add_quote(doc, quote_lines)
            last_pagebreak = False
            continue

        # Listas
        m = LIST_RE.match(line)
        if m:
            add_list_item(doc, m.group(1), m.group(2), m.group(3))
            last_pagebreak = False
            i += 1
            continue

        # Regla horizontal
        if re.fullmatch(r"\s*(---|\*\*\*|___)\s*", line):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(8)
            add_paragraph_border(p, "bottom", "1F3864", 6, 1)
            last_pagebreak = False
            i += 1
            continue

        # Parrafo normal: unir lineas consecutivas hasta un bloque especial
        para_lines = [line.strip()]
        i += 1
        while i < n:
            nxt = lines[i]
            if not nxt.strip():
                break
            if (HEADING_RE.match(nxt) or IMAGE_RE.match(nxt.strip()) or
                    nxt.lstrip().startswith(("|", ">", "```")) or
                    nxt.strip() == "[[PAGEBREAK]]" or nxt.strip() == "[[TOC]]" or
                    LIST_RE.match(nxt) or re.fullmatch(r"\s*(---|\*\*\*|___)\s*", nxt)):
                break
            para_lines.append(nxt.strip())
            i += 1
        paragraph_text = " ".join(para_lines)
        p = doc.add_paragraph()
        if CAPTION_RE.match(paragraph_text):
            add_caption(doc, paragraph_text)
        else:
            if paragraph_text.startswith("**Documentación técnica y académica"):
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(4)
                p.paragraph_format.space_after = Pt(10)
                add_inline(p, paragraph_text.replace("**", ""), bold=True, size=12, color=GRAY)
            elif paragraph_text.startswith("**Palabras clave:**") or paragraph_text.startswith("**Keywords:**"):
                p.paragraph_format.space_before = Pt(4)
                add_inline(p, paragraph_text, size=10.5)
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
                add_inline(p, paragraph_text)
        last_pagebreak = False

    doc.save(OUT_PATH)
    print(f"DOCX generado: {OUT_PATH}")
    print(f"Parrafos: {len(doc.paragraphs)} · Tablas: {len(doc.tables)}")


if __name__ == "__main__":
    build()
