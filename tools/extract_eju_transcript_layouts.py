from __future__ import annotations

import argparse
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
IMAGE_DIR = ROOT / "data" / "image" / "eju"
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA_DIR = ROOT
QUESTION_NO_RE = re.compile(r"^(1?\d|2[0-7])$")


@dataclass
class QuestionAnchor:
    question_no: int
    page_index: int
    top: int


def ocr_page_words(page: fitz.Page, zoom: float) -> tuple[Image.Image, dict[str, list[Any]]]:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    data = pytesseract.image_to_data(
        image,
        lang="jpn",
        config="--psm 6",
        output_type=pytesseract.Output.DICT,
    )
    return image, data


def find_question_anchors(doc: fitz.Document, zoom: float = 1.8) -> tuple[list[Image.Image], list[QuestionAnchor]]:
    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous_prefix = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    try:
        page_images: list[Image.Image] = []
        anchors: dict[int, QuestionAnchor] = {}
        for page_index, page in enumerate(doc):
            image, data = ocr_page_words(page, zoom)
            page_images.append(image)
            texts = [str(item or "").strip() for item in data["text"]]
            for idx, token in enumerate(texts):
                if not QUESTION_NO_RE.fullmatch(token):
                    continue
                if data["left"][idx] > int(image.width * 0.22):
                    continue
                question_no = int(token)
                for next_idx in range(idx + 1, min(idx + 5, len(texts))):
                    next_token = texts[next_idx]
                    same_line = abs(data["top"][next_idx] - data["top"][idx]) <= max(12, data["height"][idx])
                    near = data["left"][next_idx] - data["left"][idx] < 80
                    if next_token == "番" and same_line and near:
                        anchor = QuestionAnchor(question_no=question_no, page_index=page_index, top=int(data["top"][idx]))
                        previous = anchors.get(question_no)
                        if previous is None or anchor.top < previous.top or anchor.page_index < previous.page_index:
                            anchors[question_no] = anchor
                        break
        return page_images, [anchors[key] for key in sorted(anchors)]
    finally:
        if previous_prefix is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = previous_prefix


def crop_question_block(
    page_images: list[Image.Image],
    current: QuestionAnchor,
    next_anchor: QuestionAnchor | None,
    out_path: Path,
) -> None:
    image = page_images[current.page_index]
    left = 28
    right = image.width - 28
    top = max(current.top - 18, 0)
    if next_anchor and next_anchor.page_index == current.page_index:
        bottom = max(next_anchor.top - 16, top + 80)
    else:
        bottom = image.height - 24
    cropped = image.crop((left, top, right, bottom))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out_path, quality=92)


def update_exam(json_path: Path) -> None:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    transcript_rel = payload.get("source_files", {}).get("transcript_pdf")
    if not transcript_rel:
        return
    exam_id = str(payload.get("exam_info", {}).get("exam_id", json_path.stem))
    transcript_pdf = ROOT / Path(transcript_rel)
    if not transcript_pdf.exists():
        return

    with fitz.open(transcript_pdf) as doc:
        page_images, anchors = find_question_anchors(doc)
    anchor_by_no = {item.question_no: item for item in anchors}

    out_dir = IMAGE_DIR / exam_id
    for idx, anchor in enumerate(anchors):
        next_anchor = anchors[idx + 1] if idx + 1 < len(anchors) else None
        out_path = out_dir / f"transcript_q{anchor.question_no:02d}.jpg"
        crop_question_block(page_images, anchor, next_anchor, out_path)

    for section in payload.get("exam_info", {}).get("sections", []):
        questions: list[dict[str, Any]] = []
        if section.get("section_type") == "listening":
            questions = section.get("questions", [])
        elif section.get("section_type") == "listening_reading":
            questions = [q for passage in section.get("passages", []) for q in passage.get("questions", [])]
        for question in questions:
            question_no = int(question.get("eju_question_no") or question.get("eju_answer_no") or 0)
            if question_no in anchor_by_no:
                question["script_layout_image"] = f"/data/image/eju/{exam_id}/transcript_q{question_no:02d}.jpg"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{exam_id}: anchors={len(anchors)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract transcript PDF blocks for EJU listening questions.")
    parser.add_argument("--exam-id", nargs="+", required=True)
    args = parser.parse_args()
    for exam_id in args.exam_id:
        update_exam(EJU_DIR / f"{exam_id}.json")


if __name__ == "__main__":
    main()
