from __future__ import annotations

import argparse
import difflib
import json
import os
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import pytesseract
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA_DIR = ROOT


NOISE_RE = re.compile(r"[ \t\r\n　「」『』（）\(\)\[\]【】、。，．・:：;；!！?？…‥ー－―〜~]")
TIME_RE = re.compile(r"\b\d{1,2}:\d{2}(?:\.\d+)?\b")


@dataclass
class TranscriptItem:
    exam_id: str
    question_no: int
    image_path: str | None
    has_script: bool
    ratio: float | None
    json_len: int
    ocr_len: int
    reason: str
    json_text: str
    ocr_text: str


def iter_listening_questions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for section in payload.get("exam_info", {}).get("sections", []):
        section_type = section.get("section_type")
        if section_type == "listening_reading":
            for passage in section.get("passages", []):
                questions.extend(passage.get("questions", []))
        elif section_type == "listening":
            questions.extend(section.get("questions", []))
    return questions


def flatten_script(script: Any) -> str:
    if not script:
        return ""
    if isinstance(script, str):
        return script
    if isinstance(script, list):
        parts: list[str] = []
        for item in script:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = str(item.get("text") or "")
                parts.append(text)
        return "\n".join(part for part in parts if part.strip())
    return str(script)


def normalize_text(text: str) -> str:
    text = TIME_RE.sub("", text)
    text = text.replace("聞いてください", "")
    text = text.replace("きいてください", "")
    text = text.replace("スクリプト", "")
    text = text.replace("聴解", "")
    text = text.replace("聴読解", "")
    text = text.replace("読聴解", "")
    text = text.replace("一番", "1番").replace("二番", "2番").replace("三番", "3番")
    text = text.replace("四番", "4番").replace("五番", "5番").replace("六番", "6番")
    text = text.replace("七番", "7番").replace("八番", "8番").replace("九番", "9番")
    text = text.replace("０", "0").replace("１", "1").replace("２", "2").replace("３", "3")
    text = text.replace("４", "4").replace("５", "5").replace("６", "6").replace("７", "7")
    text = text.replace("８", "8").replace("９", "9")
    text = NOISE_RE.sub("", text)
    return text


def ocr_image(image_path: Path) -> str:
    image = Image.open(image_path)
    return pytesseract.image_to_string(image, lang="jpn", config="--psm 6")


def review_exam(json_path: Path) -> list[TranscriptItem]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    exam_id = str(payload.get("exam_info", {}).get("exam_id", json_path.stem))
    items: list[TranscriptItem] = []

    for question in iter_listening_questions(payload):
        question_no = int(question.get("eju_question_no") or question.get("eju_answer_no") or 0)
        script_text = flatten_script(question.get("script") or question.get("listening_script") or question.get("transcript"))
        image_rel = question.get("script_layout_image")
        image_path = ROOT / str(image_rel).lstrip("/") if image_rel else None

        if not script_text.strip():
            items.append(
                TranscriptItem(
                    exam_id=exam_id,
                    question_no=question_no,
                    image_path=str(image_path) if image_path else None,
                    has_script=False,
                    ratio=None,
                    json_len=0,
                    ocr_len=0,
                    reason="missing_script",
                    json_text="",
                    ocr_text="",
                )
            )
            continue
        if image_path is None or not image_path.exists():
            items.append(
                TranscriptItem(
                    exam_id=exam_id,
                    question_no=question_no,
                    image_path=str(image_path) if image_path else None,
                    has_script=True,
                    ratio=None,
                    json_len=len(normalize_text(script_text)),
                    ocr_len=0,
                    reason="missing_image",
                    json_text=script_text,
                    ocr_text="",
                )
            )
            continue

        ocr_text = ocr_image(image_path)
        json_norm = normalize_text(script_text)
        ocr_norm = normalize_text(ocr_text)
        ratio = difflib.SequenceMatcher(None, json_norm, ocr_norm).ratio() if json_norm or ocr_norm else 1.0
        reason = "ok"
        if ratio < 0.82:
            reason = "low_similarity"
        elif abs(len(json_norm) - len(ocr_norm)) > max(80, int(len(json_norm) * 0.25)):
            reason = "length_gap"

        items.append(
            TranscriptItem(
                exam_id=exam_id,
                question_no=question_no,
                image_path=str(image_path),
                has_script=True,
                ratio=ratio,
                json_len=len(json_norm),
                ocr_len=len(ocr_norm),
                reason=reason,
                json_text=script_text,
                ocr_text=ocr_text,
            )
        )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="OCR-audit EJU listening transcript crops against JSON scripts.")
    parser.add_argument("--exam-id", nargs="*")
    parser.add_argument("--output", default="tmp_eju_listening_full_review_audit.json")
    parser.add_argument("--threshold", type=float, default=0.82)
    args = parser.parse_args()

    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous_prefix = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    try:
        paths = sorted(EJU_DIR.glob("*.json"))
        if args.exam_id:
            wanted = set(args.exam_id)
            paths = [path for path in paths if path.stem in wanted]
        all_items: list[TranscriptItem] = []
        for path in paths:
            all_items.extend(review_exam(path))
    finally:
        if previous_prefix is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = previous_prefix

    flagged = [
        item
        for item in all_items
        if item.reason != "ok" or (item.ratio is not None and item.ratio < args.threshold)
    ]
    summary = {
        "total_questions": len(all_items),
        "flagged": len(flagged),
        "missing_script": sum(1 for item in all_items if item.reason == "missing_script"),
        "missing_image": sum(1 for item in all_items if item.reason == "missing_image"),
        "low_similarity": sum(1 for item in all_items if item.reason == "low_similarity"),
        "length_gap": sum(1 for item in all_items if item.reason == "length_gap"),
    }
    Path(args.output).write_text(
        json.dumps(
            {
                "summary": summary,
                "flagged": [asdict(item) for item in flagged],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
