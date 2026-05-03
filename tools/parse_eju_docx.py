from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET
from zipfile import ZipFile


ROMAN_OR_QUESTION_RE = re.compile(
    r"^(?P<label>[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+|問[0-9０-９一二三四五六七八九十]+)\s*[　 ]*"
    r"(?P<title>.*?)(?:（(?P<date>20\d{2}/[12])）)?$"
)
SUBQUESTION_RE = re.compile(r"^問[0-9０-９一二三四五六七八九十]+")


@dataclass
class ParseIssue:
    exam_date: str
    section_label: str
    message: str


@dataclass
class ExamBlock:
    exam_date: str
    style: str
    sections: list[tuple[str, str, list[str]]]


def extract_paragraphs(docx_path: Path) -> list[str]:
    with ZipFile(docx_path) as archive:
        xml = archive.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", ns):
        text = "".join((node.text or "") for node in paragraph.findall(".//w:t", ns)).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


def clean_heading_title(title: str, date: str) -> str:
    return title.replace(f"（{date}）", "").strip()


def split_question_block(lines: list[str]) -> tuple[list[str], list[str]] | None:
    if len(lines) < 4:
        return None
    return lines[:-4], lines[-4:]


def make_question(question_id: int, prompt: str, options: list[str], extra_lines: list[str]) -> dict:
    question = {
        "id": question_id,
        "question": prompt.strip(),
        "options": options,
        "has_ans": False,
        "skill_tags": ["reading.comprehension"],
    }
    if extra_lines:
        question["passage"] = {
            "type": "text",
            "value": "\n".join(extra_lines).strip(),
        }
    return question


def build_section(
    exam_date: str,
    label: str,
    title: str,
    body_lines: list[str],
    section_index: int,
    next_question_id: int,
    issues: list[ParseIssue],
) -> tuple[dict | None, int]:
    clean_title = clean_heading_title(title, exam_date)
    subquestion_indexes = [index for index, line in enumerate(body_lines) if SUBQUESTION_RE.match(line)]
    passage_lines = body_lines
    questions: list[dict] = []

    if subquestion_indexes:
        passage_lines = body_lines[: subquestion_indexes[0]]
        for idx, start in enumerate(subquestion_indexes):
            end = subquestion_indexes[idx + 1] if idx + 1 < len(subquestion_indexes) else len(body_lines)
            prompt = body_lines[start].strip()
            payload = body_lines[start + 1 : end]
            split = split_question_block(payload)
            if split is None:
                issues.append(ParseIssue(exam_date, label, f"Skipped incomplete subquestion: {prompt}"))
                continue
            extra_lines, options = split
            questions.append(make_question(next_question_id, prompt, options, extra_lines))
            next_question_id += 1
    else:
        split = split_question_block(body_lines)
        if split is None:
            issues.append(ParseIssue(exam_date, label, "Skipped incomplete section with fewer than 4 options"))
            return None, next_question_id
        passage_lines, options = split
        questions.append(make_question(next_question_id, clean_title, options, []))
        next_question_id += 1

    if not questions:
        issues.append(ParseIssue(exam_date, label, "Skipped section because no complete question remained"))
        return None, next_question_id

    section = {
        "section_id": f"{section_index:02d}.{label}",
        "section_title": f"{label} {clean_title}".strip(),
        "section_name": f"{label} - 阅读理解",
        "section_type": "reading",
        "description": clean_title,
        "passages": [
            {
                "id": 1,
                "topic": label,
                "passage": {
                    "type": "text",
                    "title": clean_title,
                    "value": "\n".join(passage_lines).strip(),
                },
                "questions": questions,
            }
        ],
        "skill_tags": ["reading.comprehension"],
    }
    return section, next_question_id


def split_exam_blocks(lines: list[str]) -> list[ExamBlock]:
    dated_headings: list[tuple[int, re.Match[str]]] = []
    for index, line in enumerate(lines):
        match = ROMAN_OR_QUESTION_RE.match(line)
        if match and match.group("date"):
            dated_headings.append((index, match))

    exam_ranges: list[tuple[str, int, int, str]] = []
    current_date = ""
    current_start = 0
    current_style = ""

    for idx, (line_index, match) in enumerate(dated_headings):
        exam_date = match.group("date") or ""
        label = match.group("label") or ""
        style = "roman" if label.startswith("Ⅰ") or label.startswith("Ⅱ") or label.startswith("Ⅲ") or label.startswith("Ⅳ") or label.startswith("Ⅴ") or label.startswith("Ⅵ") or label.startswith("Ⅶ") or label.startswith("Ⅷ") or label.startswith("Ⅸ") or label.startswith("Ⅹ") else "question"
        if not current_date:
            current_date = exam_date
            current_start = line_index
            current_style = style
            continue
        if exam_date != current_date:
            exam_ranges.append((current_date, current_start, line_index, current_style))
            current_date = exam_date
            current_start = line_index
            current_style = style

    if current_date:
        exam_ranges.append((current_date, current_start, len(lines), current_style))

    exams: list[ExamBlock] = []
    for exam_date, start, end, style in exam_ranges:
        exam_lines = lines[start:end]
        sections: list[tuple[str, str, list[str]]] = []

        if style == "roman":
            heading_indexes: list[tuple[int, re.Match[str]]] = []
            for index, line in enumerate(exam_lines):
                match = ROMAN_OR_QUESTION_RE.match(line)
                if match and match.group("date"):
                    heading_indexes.append((index, match))
        else:
            heading_indexes = []
            for index, line in enumerate(exam_lines):
                match = ROMAN_OR_QUESTION_RE.match(line)
                if match and (match.group("label") or "").startswith("問"):
                    heading_indexes.append((index, match))

        for idx, (line_index, match) in enumerate(heading_indexes):
            next_index = heading_indexes[idx + 1][0] if idx + 1 < len(heading_indexes) else len(exam_lines)
            sections.append(
                (
                    match.group("label") or "",
                    match.group("title") or "",
                    exam_lines[line_index + 1 : next_index],
                )
            )

        exams.append(ExamBlock(exam_date=exam_date, style=style, sections=sections))

    return exams


def build_exam_payload(exam_date: str, sections: list[dict]) -> dict:
    year, session = exam_date.split("/")
    exam_id = f"EJU_READING_{year}_{session}"
    return {
        "family": "eju",
        "subject": "japanese",
        "paper_type": "reading",
        "level": "Reading",
        "year": year,
        "session": session,
        "display": f"{year}_{session}",
        "checked": False,
        "access_level": "free",
        "exam_info": {
            "title": f"EJU-Reading-{year}_{session}",
            "exam_date": exam_date,
            "exam_level": "Reading",
            "exam_id": exam_id,
            "family": "eju",
            "subject": "japanese",
            "paper_type": "reading",
            "year": year,
            "session": session,
            "sections": sections,
        },
    }


def write_report(output_dir: Path, exam_summaries: Iterable[tuple[str, int]], issues: list[ParseIssue]) -> None:
    lines = [
        "# EJU Reading Parse Report",
        "",
        "Source: `downloads/EJU日本语/总集 H17.1-R5.2EJU日语 文字版.docx`",
        "",
        "## Exams",
    ]
    for exam_date, question_count in exam_summaries:
        lines.append(f"- `{exam_date}`: {question_count} questions")

    lines.extend(["", "## Issues"])
    if issues:
        for issue in issues:
            lines.append(f"- `{issue.exam_date}` / `{issue.section_label}`: {issue.message}")
    else:
        lines.append("- None")

    (output_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse EJU reading DOCX into exam JSON files.")
    parser.add_argument("docx", type=Path, help="Path to the EJU reading docx source")
    parser.add_argument("output", type=Path, help="Directory to write parsed exam JSON files into")
    args = parser.parse_args()

    raw_lines = extract_paragraphs(args.docx)
    lines = raw_lines[7:] if len(raw_lines) > 7 else raw_lines
    exams = split_exam_blocks(lines)

    output_dir = args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    issues: list[ParseIssue] = []
    exam_summaries: list[tuple[str, int]] = []

    for exam_block in exams:
        exam_date = exam_block.exam_date
        sections: list[dict] = []
        question_id = 1

        for section_index, (label, title, body) in enumerate(exam_block.sections, start=1):
            section, question_id = build_section(
                exam_date,
                label,
                title,
                body,
                section_index,
                question_id,
                issues,
            )
            if section is not None:
                sections.append(section)

        payload = build_exam_payload(exam_date, sections)
        exam_summaries.append((exam_date, question_id - 1))

        year, session = exam_date.split("/")
        file_path = output_dir / f"EJU_READING_{year}_{session}.json"
        file_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    write_report(output_dir.parent, exam_summaries, issues)


if __name__ == "__main__":
    main()
