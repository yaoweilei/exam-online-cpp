from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import fitz
import pytesseract
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA_DIR = ROOT

MANUAL_OVERRIDES: dict[str, dict[int, int | None]] = {
    "2011_01": {
        1: 1, 2: 1, 3: 2, 4: 4, 5: 3, 6: 4, 7: 2, 8: 2, 9: 3, 10: 3, 11: 2, 12: 2,
        13: 3, 14: 4, 15: 1, 16: 3, 17: 1, 18: 4, 19: 2, 20: 3, 21: 4, 22: 2, 23: 3,
        24: 1, 25: 4, 26: 2, 27: 3,
    },
    "2016_01": {
        1: 2, 2: 3, 3: 1, 4: 2, 5: 2, 6: 1, 7: 2, 8: 3, 9: 1, 10: 4, 11: 4, 12: 2,
        13: 2, 14: 1, 15: 3, 16: 4, 17: 2, 18: 4, 19: 4, 20: 1, 21: 4, 22: 1, 23: 1,
        24: 2, 25: 3, 26: 1, 27: 3,
    },
    "2016_02": {
        1: 2, 2: 3, 3: 3, 4: 2, 5: 3, 6: 1, 7: 3, 8: 4, 9: 1, 10: 1, 11: 2, 12: 2,
        13: 2, 14: 2, 15: 1, 16: 3, 17: 1, 18: 4, 19: 1, 20: 3, 21: 4, 22: 2, 23: 4,
        24: 1, 25: 4, 26: 4, 27: 2,
    },
    "2017_01": {
        1: 2, 2: 2, 3: 1, 4: 4, 5: 3, 6: 4, 7: 1, 8: 2, 9: 2, 10: 3, 11: 3, 12: 2,
        13: 1, 14: 2, 15: 3, 16: 1, 17: 4, 18: 3, 19: 3, 20: 3, 21: 4, 22: 2, 23: 4,
        24: 1, 25: 2, 26: 4, 27: 2,
    },
    "2018_02": {
        1: 3, 2: 2, 3: 3, 4: 4, 5: 3, 6: 4, 7: 1, 8: 4, 9: 3, 10: 3, 11: 1, 12: 4,
        13: 2, 14: 3, 15: 4, 16: 4, 17: 1, 18: 4, 19: 2, 20: 4, 21: 1, 22: 3, 23: 4,
        24: 2, 25: 2, 26: 1, 27: 2,
    },
    "2019_01": {
        1: 4, 2: 2, 3: 2, 4: 3, 5: None, 6: 2, 7: 2, 8: 1, 9: 2, 10: 1, 11: 1, 12: 4,
        13: 1, 14: 2, 15: 3, 16: 2, 17: 4, 18: 4, 19: 4, 20: 2, 21: 3, 22: 2, 23: 1,
        24: 3, 25: 4, 26: 4, 27: 1,
    },
    "2020_02": {
        1: 1, 2: 1, 3: 4, 4: 3, 5: 3, 6: 3, 7: 2, 8: 1, 9: 2, 10: 2, 11: 2, 12: 4,
        13: 4, 14: 3, 15: 2, 16: 2, 17: 4, 18: 2, 19: 3, 20: 4, 21: 3, 22: 2, 23: 1,
        24: 2, 25: 4, 26: 1, 27: 1,
    },
    "2021_01": {
        1: 2, 2: 4, 3: 1, 4: 3, 5: 4, 6: 2, 7: 4, 8: 1, 9: 2, 10: 3, 11: 2, 12: 3,
        13: 2, 14: 4, 15: 1, 16: 2, 17: 2, 18: 3, 19: 3, 20: 2, 21: 4, 22: 1, 23: 3,
        24: 1, 25: 1, 26: 2, 27: 3,
    },
    "2021_02": {
        1: 2, 2: 4, 3: 3, 4: None, 5: 2, 6: 4, 7: 3, 8: 3, 9: 1, 10: 4, 11: 2, 12: 1,
        13: 3, 14: 1, 15: 3, 16: 2, 17: 3, 18: 2, 19: 4, 20: 4, 21: 2, 22: 1, 23: 4,
        24: 1, 25: 3, 26: 4, 27: 3,
    },
    "2022_02": {
        1: 3, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 3, 8: 2, 9: 4, 10: 3, 11: 4, 12: 1,
        13: 1, 14: 3, 15: 2, 16: 4, 17: 4, 18: 3, 19: 2, 20: 2, 21: 3, 22: 4, 23: 4,
        24: 1, 25: 1, 26: 3, 27: 1,
    },
    "2023_01": {
        1: 1, 2: 2, 3: 1, 4: 4, 5: 4, 6: 4, 7: 1, 8: 2, 9: 2, 10: 3, 11: 3, 12: 2,
        13: 1, 14: 2, 15: 3, 16: 1, 17: 4, 18: 3, 19: 3, 20: 3, 21: 4, 22: 2, 23: 4,
        24: 1, 25: 2, 26: 4, 27: 2,
    },
    "2023_02": {
        1: None, 2: 3, 3: 1, 4: 2, 5: 3, 6: 1, 7: 4, 8: 1, 9: 2, 10: 4, 11: 2, 12: 4,
        13: 3, 14: 3, 15: 3, 16: 4, 17: 2, 18: 4, 19: 2, 20: 1, 21: 4, 22: 4, 23: 1,
        24: 3, 25: 3, 26: 2, 27: 4,
    },
}

READING_MANUAL_OVERRIDES: dict[str, dict[int, int | None]] = {
    "2011_02": {
        7: 1,
        8: 1,
        9: 1,
    },
    "2015_02": {
        3: 1,
    },
    "2016_01": {
        1: 3, 2: 4, 3: 1, 4: 2, 5: 4, 6: 1, 7: 3, 8: 3, 9: 3, 10: 1,
        11: 3, 12: 1, 13: 4, 14: 3, 15: 4, 16: 2, 17: 2, 18: 1, 19: 4, 20: 2,
        21: 4, 22: 2, 23: 3, 24: 4, 25: 2,
    },
    "2016_02": {
        12: 4,
        13: 1,
    },
    "2017_01": {
        1: 1, 2: 1, 3: 2, 4: 4, 5: 2, 6: 1, 7: 4, 8: 3, 9: 1, 10: 1,
        11: 1, 12: 3, 13: 4, 14: 2, 15: 2, 16: 3, 17: 4, 18: 3, 19: 2, 20: 3,
        21: 4, 22: 3, 23: 4, 24: 2,
    },
    "2018_02": {
        1: 2,
    },
    "2019_01": {
        1: 1,
    },
    "2020_02": {
        1: 4,
    },
    "2021_01": {
        1: 2,
    },
    "2021_02": {
        21: 4,
        22: 3,
        23: 1,
    },
}


def grouped_segments(values: list[int], counts: list[int], threshold: int) -> list[tuple[int, int, int]]:
    groups: list[tuple[int, int, int]] = []
    start: int | None = None
    for index, value in enumerate(values):
        if counts[index] >= threshold:
            if start is None:
                start = value
        elif start is not None:
            groups.append((start, values[index - 1], max(counts[start : values[index - 1] + 1])))
            start = None
    if start is not None:
        groups.append((start, values[-1], max(counts[start : values[-1] + 1])))
    return groups


def collapse_close_segments(segments: list[tuple[int, int, int]], min_gap: int) -> list[int]:
    collapsed: list[tuple[int, int, int]] = []
    for segment in segments:
        if not collapsed:
            collapsed.append(segment)
            continue
        prev_left, prev_right, prev_score = collapsed[-1]
        left, right, score = segment
        if left - prev_right < min_gap:
            if score > prev_score:
                collapsed[-1] = segment
            continue
        collapsed.append(segment)
    return [int((left + right) / 2) for left, right, _score in collapsed]


def render_page_image(page: fitz.Page, zoom: float = 2.5) -> Image.Image:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("L")


def detect_vertical_lines(image: Image.Image) -> list[int]:
    width, height = image.size
    pixels = image.load()
    y0 = int(height * 0.14)
    darkness_cutoff = 210
    counts = [sum(1 for y in range(y0, height) if pixels[x, y] < darkness_cutoff) for x in range(width)]
    threshold = max(int((height - y0) * 0.28), 450)
    groups = grouped_segments(list(range(width)), counts, threshold)
    midpoints = collapse_close_segments(groups, min_gap=18)
    return [x for x in midpoints if x > int(width * 0.4)]


def detect_left_vertical_lines(image: Image.Image) -> list[int]:
    width, height = image.size
    pixels = image.load()
    y0 = int(height * 0.14)
    darkness_cutoff = 210
    counts = [sum(1 for y in range(y0, height) if pixels[x, y] < darkness_cutoff) for x in range(width)]
    threshold = max(int((height - y0) * 0.22), 380)
    groups = grouped_segments(list(range(width)), counts, threshold)
    midpoints = collapse_close_segments(groups, min_gap=18)
    return [x for x in midpoints if x < int(width * 0.42)]


def detect_horizontal_lines(image: Image.Image, x0: int, x1: int) -> list[int]:
    width, height = image.size
    pixels = image.load()
    darkness_cutoff = 210
    counts = [sum(1 for x in range(x0, x1) if pixels[x, y] < darkness_cutoff) for y in range(height)]
    threshold = max(int((x1 - x0) * 0.42), 130)
    groups = grouped_segments(list(range(height)), counts, threshold)
    midpoints = collapse_close_segments(groups, min_gap=30)
    return [y for y in midpoints if y > int(height * 0.16)]


def extract_digit(cell: Image.Image) -> int | None:
    bw = cell.point(lambda p: 255 if p > 200 else 0)
    enlarged = bw.resize((bw.width * 3, bw.height * 3))
    text = pytesseract.image_to_string(
        enlarged,
        lang="jpn",
        config="--psm 10 -c tessedit_char_whitelist=1234",
    ).strip()
    match = re.search(r"[1-4]", text)
    return int(match.group(0)) if match else None


def extract_listening_answers_from_image(image: Image.Image) -> dict[int, int]:
    verticals = detect_vertical_lines(image)
    if len(verticals) < 7:
        return {}
    verticals = verticals[:7]

    center_y = detect_horizontal_lines(image, verticals[0], verticals[3])
    right_y = detect_horizontal_lines(image, verticals[3], verticals[6])
    if len(center_y) < 15 or len(right_y) < 18:
        return {}

    answers: dict[int, int] = {}

    for row_index in range(12):
        top = center_y[row_index + 2] + 2
        bottom = center_y[row_index + 3] - 2
        cell = image.crop((verticals[2] + 4, top, verticals[3] - 4, bottom))
        answer = extract_digit(cell)
        if answer is not None:
            answers[row_index + 1] = answer

    for row_index in range(15):
        top = right_y[row_index + 2] + 2
        bottom = right_y[row_index + 3] - 2
        cell = image.crop((verticals[5] + 4, top, verticals[6] - 4, bottom))
        answer = extract_digit(cell)
        if answer is not None:
            answers[row_index + 13] = answer

    return answers


def extract_listening_answers(pdf_path: Path) -> dict[int, int]:
    with fitz.open(pdf_path) as doc:
        for page in doc:
            image = render_page_image(page)
            answers = extract_listening_answers_from_image(image)
            if len(answers) >= 20:
                return answers
    return {}


def extract_reading_answers_from_image(image: Image.Image) -> dict[int, int]:
    width, height = image.size
    band_x0 = int(width * 0.23)
    band_x1 = int(width * 0.40)
    answer_x0 = int(width * 0.32)
    answer_x1 = int(width * 0.40)

    pixels = image.load()
    counts = [sum(1 for x in range(band_x0, band_x1) if pixels[x, y] < 215) for y in range(height)]

    candidate_sets: list[list[int]] = []
    for threshold in [60, 70, 80, 90, 100, 110]:
        segments = grouped_segments(list(range(height)), counts, threshold)
        filtered = [item for item in segments if item[0] > int(height * 0.16)]
        mids = collapse_close_segments(filtered, min_gap=20)
        if mids:
            candidate_sets.append(mids)

    if not candidate_sets:
        return {}

    def score(lines: list[int]) -> tuple[int, int]:
        return (abs(len(lines) - 28), -len(lines))

    row_lines = sorted(candidate_sets, key=score)[0]
    if len(row_lines) < 26:
        return {}
    if len(row_lines) > 28:
        row_lines = row_lines[:28]
    if len(row_lines) < 28:
        diffs = [row_lines[i + 1] - row_lines[i] for i in range(max(0, len(row_lines) - 10), len(row_lines) - 1)]
        step = round(sum(diffs) / len(diffs)) if diffs else 50
        while len(row_lines) < 28:
            row_lines.append(row_lines[-1] + step)

    answers: dict[int, int] = {}
    for row_index in range(25):
        top = row_lines[row_index + 2] + 2
        bottom = row_lines[row_index + 3] - 2
        cell = image.crop((answer_x0 + 4, top, answer_x1 - 4, bottom))
        answer = extract_digit(cell)
        if answer is not None:
            answers[row_index + 1] = answer
    return answers


def extract_reading_answers(pdf_path: Path) -> dict[int, int]:
    with fitz.open(pdf_path) as doc:
        for page in doc:
            image = render_page_image(page)
            answers = extract_reading_answers_from_image(image)
            if len(answers) >= 20:
                return answers
    return {}


def update_exam(json_path: Path) -> tuple[int, int]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    exam_id = str(payload.get("exam_info", {}).get("exam_id", json_path.stem))
    answer_rel = payload.get("source_files", {}).get("answer_pdf")
    if not answer_rel:
        return 0, 0

    answer_pdf = ROOT / Path(answer_rel)
    if not answer_pdf.exists():
        return 0, 0

    listening_answers = extract_listening_answers(answer_pdf)
    if exam_id in MANUAL_OVERRIDES:
        listening_answers = {
            **listening_answers,
            **{key: value for key, value in MANUAL_OVERRIDES[exam_id].items() if value is not None},
        }
    reading_answers = extract_reading_answers(answer_pdf)
    if exam_id in READING_MANUAL_OVERRIDES:
        reading_answers = {
            **reading_answers,
            **{key: value for key, value in READING_MANUAL_OVERRIDES[exam_id].items() if value is not None},
        }
    if not listening_answers and not reading_answers:
        return 0, 0

    updated = 0
    total = 0
    for section in payload.get("exam_info", {}).get("sections", []):
        section_type = section.get("section_type")
        if section_type == "reading":
            questions = [q for passage in section.get("passages", []) for q in passage.get("questions", [])]
        elif section_type == "listening":
            questions = section.get("questions", [])
        elif section_type == "listening_reading":
            questions = [q for passage in section.get("passages", []) for q in passage.get("questions", [])]
        else:
            questions = []

        for question in questions:
            total += 1
            answer_no = int(question.get("eju_answer_no") or question.get("eju_question_no") or 0)
            if section_type in ("listening", "listening_reading"):
                manual_answer = MANUAL_OVERRIDES.get(exam_id, {}).get(answer_no, "__missing__")
                if manual_answer is None:
                    question.pop("correct_answer", None)
                    question.pop("answer", None)
                    continue
                answer = listening_answers.get(answer_no)
            else:
                manual_answer = READING_MANUAL_OVERRIDES.get(exam_id, {}).get(answer_no, "__missing__")
                if manual_answer is None:
                    question.pop("correct_answer", None)
                    question.pop("answer", None)
                    continue
                answer = reading_answers.get(answer_no)
            if answer is None:
                continue
            question["correct_answer"] = answer
            question["answer"] = str(answer)
            updated += 1

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return updated, total


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply EJU official answer sheets to listening questions.")
    parser.add_argument("--exam-id", nargs="+", required=True)
    args = parser.parse_args()

    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous_prefix = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    try:
        for exam_id in args.exam_id:
            updated, total = update_exam(EJU_DIR / f"{exam_id}.json")
            print(f"{exam_id}: {updated}/{total}")
    finally:
        if previous_prefix is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = previous_prefix


if __name__ == "__main__":
    main()
