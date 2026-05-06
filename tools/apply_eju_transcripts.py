from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
import pytesseract
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA_DIR = ROOT

JP_CHARS = r"一-龯ぁ-んァ-ヶー々〇〆ヵヶ"
QUESTION_START_RE = re.compile(r"(?P<num>1?\d|2[0-7])\s*番")
SPEAKER_RE = re.compile(r"^(?P<speaker>[^：]{1,20})：(?P<body>.+)$")
SPEAKER_LABEL_RE = re.compile(r"^(?P<speaker>女子留学生|男子留学生|女子学生|男子学生|留学生|学生|先生|議員)\s*(?:[:：*・]+\s*)?(?P<body>.+)$")
OPTION_RE = re.compile(r"^[1-4][\.\．]\s*")


@dataclass
class ExamResult:
    exam_id: str
    transcript_path: str
    question_count: int
    updated_count: int


def tighten_japanese_spacing(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    patterns = [
        (fr"([{JP_CHARS}])\s+([{JP_CHARS}])", r"\1\2"),
        (fr"([{JP_CHARS}])\s+([、。！？」』）】〉》：；])", r"\1\2"),
        (fr"([「『（【〈《])\s+([{JP_CHARS}])", r"\1\2"),
        (r"([0-9０-９])\s+([番年月日時分秒回人個件問])", r"\1\2"),
        (r"([A-Za-z])\s+([A-Za-z])", r"\1\2"),
        (r"\s+([.,])", r"\1"),
    ]
    for _ in range(3):
        previous = text
        for pattern, replacement in patterns:
            text = re.sub(pattern, replacement, text)
        if text == previous:
            break
    return text.strip()


def normalize_ocr_line(raw: str) -> str:
    line = raw.replace("\u3000", " ").replace("\t", " ").strip()
    if not line:
        return ""
    line = tighten_japanese_spacing(line)
    if not line:
        return ""
    if re.fullmatch(r"[ー一\-=\d\s]+", line):
        return ""
    if "スクリプト" in line and "聴" in line:
        return ""
    if re.match(r"^C[mn]?[a-zA-Z0-9]+", line):
        return ""
    if re.fullmatch(r"[\(\[]?[A-Za-z][A-Za-z0-9\s]*[\)\]]?", line):
        return ""
    speaker_match = SPEAKER_LABEL_RE.match(line)
    if speaker_match:
        speaker = speaker_match.group("speaker").strip()
        body = speaker_match.group("body").strip()
        line = f"{speaker}：{body}"
    return line


def ocr_pdf_lines(pdf_path: Path, zoom: float = 1.8) -> list[str]:
    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous_prefix = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    try:
        doc = fitz.open(pdf_path)
        lines: list[str] = []
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            text = pytesseract.image_to_string(image, lang="jpn", config="--psm 6")
            for raw in text.splitlines():
                line = normalize_ocr_line(raw)
                if line:
                    lines.append(line)
        return lines
    finally:
        if previous_prefix is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = previous_prefix


def extract_question_blocks(lines: list[str]) -> dict[int, list[str]]:
    blocks: dict[int, list[str]] = {}
    current_num: int | None = None
    current_lines: list[str] = []

    for line in lines:
        match = QUESTION_START_RE.search(line)
        if match:
            num = int(match.group("num"))
            if 1 <= num <= 27:
                if current_num is not None and current_lines:
                    blocks[current_num] = current_lines[:]
                current_num = num
                current_lines = [line]
                continue
        if current_num is not None:
            current_lines.append(line)

    if current_num is not None and current_lines:
        blocks[current_num] = current_lines[:]

    return blocks


def build_script(lines: list[str]) -> list[dict[str, str]]:
    script: list[dict[str, str]] = []

    def append_text(text: str, speaker: str | None = None) -> None:
        if speaker:
            script.append({"speaker": speaker, "text": f"{speaker}：{text}"})
            return
        script.append({"text": text})

    for line in lines:
        clean = tighten_japanese_spacing(line)
        if not clean:
            continue
        speaker_match = SPEAKER_RE.match(clean)
        if speaker_match:
            speaker = speaker_match.group("speaker").strip()
            body = speaker_match.group("body").strip()
            append_text(body, speaker)
            continue

        is_new_line = bool(OPTION_RE.match(clean) or QUESTION_START_RE.search(clean))
        if is_new_line or not script:
            append_text(clean)
            continue

        previous = script[-1]
        previous["text"] = f"{previous['text']} {clean}".strip()
    return script


def apply_scripts_to_exam(payload: dict[str, Any], blocks: dict[int, list[str]]) -> int:
    updated = 0
    sections = payload.get("exam_info", {}).get("sections", [])
    for section in sections:
        if section.get("section_type") == "listening_reading":
            for passage in section.get("passages", []):
                for question in passage.get("questions", []):
                    question_no = int(question.get("eju_question_no") or question.get("eju_answer_no") or 0)
                    if question_no in blocks:
                        question["script"] = build_script(blocks[question_no])
                        updated += 1
        elif section.get("section_type") == "listening":
            for question in section.get("questions", []):
                question_no = int(question.get("eju_question_no") or question.get("eju_answer_no") or 0)
                if question_no in blocks:
                    question["script"] = build_script(blocks[question_no])
                    updated += 1
    return updated


def process_exam(json_path: Path) -> ExamResult | None:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    transcript_rel = payload.get("source_files", {}).get("transcript_pdf")
    if not transcript_rel:
        return None
    transcript_path = ROOT / Path(transcript_rel)
    if not transcript_path.exists():
        return None

    lines = ocr_pdf_lines(transcript_path)
    blocks = extract_question_blocks(lines)
    updated = apply_scripts_to_exam(payload, blocks)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    exam_id = payload.get("exam_info", {}).get("exam_id", json_path.stem)
    return ExamResult(
        exam_id=str(exam_id),
        transcript_path=str(transcript_path),
        question_count=len(blocks),
        updated_count=updated,
    )


def main() -> None:
    results: list[ExamResult] = []
    for json_path in sorted(EJU_DIR.glob("*.json")):
        result = process_exam(json_path)
        if result:
            results.append(result)

    for result in results:
        print(
            f"{result.exam_id}: blocks={result.question_count} updated={result.updated_count} "
            f"pdf={result.transcript_path}"
        )


if __name__ == "__main__":
    main()
