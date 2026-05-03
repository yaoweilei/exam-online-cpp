from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import fitz
import numpy as np
import pytesseract
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_ROOT = ROOT / "downloads" / "EJU日本语"
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA_DIR = ROOT


@dataclass(frozen=True)
class SourceSet:
    paper_pdf: Path
    answer_pdf: Path
    transcript_pdf: Path | None
    audio_dir: Path
    session: int


def normalize_ocr_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"[ \t　]+", " ", raw).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def render_pdf_page(pdf_path: Path, page_index: int, zoom: float = 2.0) -> Image.Image:
    with fitz.open(pdf_path) as doc:
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def save_pdf_page_image(pdf_path: Path, page_index: int, out_path: Path, zoom: float = 2.0) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with fitz.open(pdf_path) as doc:
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    pix.save(out_path)


def ocr_image(image: Image.Image, psm: int = 6) -> str:
    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    try:
        return normalize_ocr_text(pytesseract.image_to_string(image, lang="jpn", config=f"--psm {psm}"))
    finally:
        if previous is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = previous


def discover_sources(year: int, session: int) -> SourceSet:
    year_text = str(year)
    if year <= 2018:
        era_text = f"平成{year - 1988}"
    else:
        era_text = f"令和{year - 2018}"
    session_patterns = [
        f"第{session}回",
        f"{session}回",
        "第一回" if session == 1 else "第二回",
        "第１回" if session == 1 else "第２回",
    ]
    all_files = [p for p in DOWNLOAD_ROOT.rglob("*") if p.is_file()]

    def relevant_parts(path: Path) -> list[str]:
        parts = []
        for part in path.parts:
            if re.search(r"\d{4}\s*[-－]\s*\d{4}", part):
                continue
            parts.append(part)
        return parts

    def has_year(path: Path) -> bool:
        return any(year_text in part or era_text in part for part in relevant_parts(path))

    def has_session(path: Path) -> bool:
        parts = relevant_parts(path)
        has_year_value = any(year_text in part or era_text in part for part in parts)
        has_round = any(any(pattern in part for pattern in session_patterns) for part in parts)
        return has_year_value and has_round

    paper_candidates = [
        p for p in all_files
        if p.suffix.lower() == ".pdf" and "【1】" in str(p) and "日语" in p.name and has_session(p)
    ]
    answer_candidates = [
        p for p in all_files
        if p.suffix.lower() == ".pdf" and "【3】" in str(p) and "答案" in p.name and has_session(p)
    ]
    transcript_candidates = [
        p for p in all_files
        if p.suffix.lower() == ".pdf" and "听力原文" in str(p) and has_session(p)
    ]
    audio_candidates = [
        p for p in all_files
        if p.suffix.lower() in {".mp3", ".wav", ".wma", ".m4a"} and (has_session(p) or has_year(p))
    ]

    if not paper_candidates:
        raise FileNotFoundError(f"Paper PDF not found for {year}_{session}")
    if not answer_candidates:
        raise FileNotFoundError(f"Answer PDF not found for {year}_{session}")
    if not audio_candidates:
        raise FileNotFoundError(f"Audio files not found for {year}_{session}")

    audio_dirs = sorted({p.parent for p in audio_candidates}, key=lambda p: (len(list(p.glob("*"))), str(p)), reverse=True)
    audio_dirs = sorted(
        {p.parent for p in audio_candidates},
        key=lambda p: (
            any(pattern in str(p) for pattern in session_patterns),
            len([item for item in p.iterdir() if item.is_file() and item.suffix.lower() in {".mp3", ".wav", ".wma", ".m4a"}]),
            str(p),
        ),
        reverse=True,
    )
    return SourceSet(
        paper_pdf=sorted(paper_candidates)[0],
        answer_pdf=sorted(answer_candidates)[0],
        transcript_pdf=sorted(transcript_candidates)[0] if transcript_candidates else None,
        audio_dir=audio_dirs[0],
        session=session,
    )


def group_positions(values: Iterable[int], max_gap: int = 2) -> list[int]:
    values = list(values)
    if not values:
        return []
    groups: list[int] = []
    start = prev = int(values[0])
    for raw in values[1:]:
        value = int(raw)
        if value <= prev + max_gap:
            prev = value
            continue
        groups.append((start + prev) // 2)
        start = prev = value
    groups.append((start + prev) // 2)
    return groups


def split_x_clusters(xs: list[int], page_width: int) -> list[list[int]]:
    clusters: list[list[int]] = []
    current: list[int] = []
    for x in xs:
        if current and x - current[-1] > page_width * 0.1:
            clusters.append(current)
            current = []
        current.append(x)
    if current:
        clusters.append(current)
    return clusters


def detect_table_verticals(mask: np.ndarray) -> list[list[int]]:
    height, width = mask.shape
    for threshold in (0.35, 0.3, 0.25, 0.2):
        projection = mask.sum(axis=0)
        xs = group_positions(np.where(projection > height * threshold)[0])
        clusters = split_x_clusters(xs, width)
        if len(clusters) >= 2 and len(clusters[0]) >= 5 and len(clusters[1]) >= 7:
            return clusters[:2]
    raise RuntimeError("Could not detect answer table vertical lines")


def detect_horizontal_lines(mask: np.ndarray, x0: int, x1: int) -> list[int]:
    height, _ = mask.shape
    segment = mask[:, x0:x1]
    projection = segment.sum(axis=1)
    ys = group_positions(np.where(projection > (x1 - x0) * 0.45)[0])
    ys = [y for y in ys if y > height * 0.17]
    condensed: list[int] = []
    min_gap = height * 0.018
    for y in ys:
        if not condensed or y - condensed[-1] >= min_gap:
            condensed.append(y)
    return condensed


def detect_modern_answer_lines(gray: np.ndarray, x0: int, x1: int) -> list[int]:
    segment = gray[:, x0:x1]
    width = max(1, x1 - x0)
    candidates: list[int] = []
    for threshold in (190, 200, 210, 220):
        mask = gray < threshold
        projection = mask[:, x0:x1].sum(axis=1)
        ys = group_positions(np.where(projection > width * 0.35)[0], max_gap=3)
        ys = [y for y in ys if y > gray.shape[0] * 0.18]
        if len(ys) > len(candidates):
            candidates = ys
    return candidates


def ocr_choice_cell(image: Image.Image, x0: int, x1: int, y0: int, y1: int) -> int | None:
    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)
    previous = os.environ.get("TESSDATA_PREFIX")
    os.environ.pop("TESSDATA_PREFIX", None)
    for mx_ratio in (0.12, 0.18, 0.28, 0.34):
        try:
            mx = int((x1 - x0) * mx_ratio)
            my = int((y1 - y0) * 0.12)
            crop = image.crop((x0 + mx, y0 + my, x1 - mx, y1 - my)).convert("L")
            if crop.width <= 0 or crop.height <= 0:
                continue
            crop = ImageOps.autocontrast(crop.resize((crop.width * 6, crop.height * 6)))
            for psm in (10, 8, 7, 13):
                text = pytesseract.image_to_string(
                    crop,
                    lang="eng",
                    config=f"--psm {psm} -c tessedit_char_whitelist=1234*",
                )
                match = re.search(r"[1234]", text)
                if match:
                    return int(match.group(0))
                if "*" in text:
                    return None
        finally:
            if previous is None:
                os.environ.pop("TESSDATA_PREFIX", None)
            else:
                os.environ["TESSDATA_PREFIX"] = previous
    return None


def choose_answer_row_boundaries(
    image: Image.Image,
    gray: np.ndarray,
    x0: int,
    x1: int,
    y_region: tuple[int, int],
    count: int,
    allow_first_blank: bool = False,
) -> list[int]:
    lines = detect_modern_answer_lines(gray, y_region[0], y_region[1])
    min_gap = gray.shape[0] * 0.018
    max_gap = gray.shape[0] * 0.04
    best: tuple[int, list[int]] | None = None

    for start in range(0, max(0, len(lines) - count)):
        window = lines[start:start + count + 1]
        if len(window) < count + 1:
            continue
        gaps = [b - a for a, b in zip(window, window[1:])]
        if not gaps or min(gaps) < min_gap or max(gaps) > max_gap:
            continue

        sample_count = min(5, count)
        values = [ocr_choice_cell(image, x0, x1, window[i], window[i + 1]) for i in range(sample_count)]
        score = sum(value in {1, 2, 3, 4} for value in values)
        if allow_first_blank and values and values[0] is None:
            score += 1
        if best is None or score > best[0]:
            best = (score, window)

    if best is None or best[0] <= 0:
        raise RuntimeError(f"Could not detect modern answer rows in x={y_region}")
    return best[1]


def extract_answers_modern(answer_pdf: Path) -> dict[str, list[int | None]]:
    image = render_pdf_page(answer_pdf, 1, zoom=3.0)
    gray = np.array(image.convert("L"))
    height, width = gray.shape

    specs = {
        "reading": {
            "x": (int(width * 0.291), int(width * 0.371)),
            "y_region": (int(width * 0.055), int(width * 0.405)),
            "count": 25,
            "allow_first_blank": False,
        },
        "listening_reading": {
            "x": (int(width * 0.560), int(width * 0.640)),
            "y_region": (int(width * 0.400), int(width * 0.650)),
            "count": 12,
            "allow_first_blank": True,
        },
        "listening": {
            "x": (int(width * 0.788), int(width * 0.868)),
            "y_region": (int(width * 0.635), int(width * 0.875)),
            "count": 15,
            "allow_first_blank": False,
        },
    }

    output: dict[str, list[int | None]] = {}
    for key, spec in specs.items():
        x0, x1 = spec["x"]
        y_region = spec["y_region"]
        boundaries = choose_answer_row_boundaries(
            image,
            gray,
            x0,
            x1,
            y_region,
            int(spec["count"]),
            bool(spec["allow_first_blank"]),
        )
        output[key] = [
            ocr_choice_cell(image, x0, x1, boundaries[index], boundaries[index + 1])
            for index in range(int(spec["count"]))
        ]
    return output


def extract_answers(answer_pdf: Path) -> dict[str, list[int | None]]:
    image = render_pdf_page(answer_pdf, 1, zoom=3.0)
    gray = np.array(image.convert("L"))
    pixel_threshold = 140 if gray.mean() > 210 else 210
    mask = gray < pixel_threshold
    try:
        left, right = detect_table_verticals(mask)
    except RuntimeError:
        return extract_answers_modern(answer_pdf)

    boxes = {
        "reading": ((left[-2], left[-1]), (left[0], left[-1]), 25),
        "listening_reading": ((right[2], right[3]), (right[0], right[3]), 12),
        "listening": ((right[5], right[6]), (right[3], right[-1]), 15),
    }

    output: dict[str, list[int | None]] = {}
    for key, (x_bounds, x_region, count) in boxes.items():
        y_lines = detect_horizontal_lines(mask, x_region[0], x_region[1])
        data_lines = y_lines[2: 2 + count + 1]
        if len(data_lines) < count + 1:
            raise RuntimeError(f"Could not detect enough answer rows for {key}: {len(data_lines)}")
        output[key] = [
            ocr_choice_cell(image, x_bounds[0], x_bounds[1], data_lines[index], data_lines[index + 1])
            for index in range(count)
        ]
    return output


def answer_payload(value: int | None) -> dict[str, object]:
    if value is None:
        return {"has_ans": False}
    return {"correct_answer": value, "answer": str(value), "has_ans": True}


def load_reading_section(year: int, session: int, reading_answers: list[int | None]) -> dict:
    session_text = f"{session:02d}"
    root_path = ROOT / "data" / "paper" / "eju" / f"{year}_{session_text}.json"
    legacy_path = ROOT / "data" / "paper" / "eju" / "reading" / f"EJU_READING_{year}_{session}.json"
    path = root_path if root_path.exists() else legacy_path
    data = json.loads(path.read_text(encoding="utf-8"))
    source_sections = data["exam_info"]["sections"]
    if path == root_path:
        source_sections = [
            section
            for section in source_sections
            if str(section.get("section_id")) == "2" or section.get("section_type") == "reading"
        ]
    passages = []
    question_index = 0
    for old_section in source_sections:
        for passage in old_section.get("passages", []):
            new_passage = copy.deepcopy(passage)
            new_passage["topic"] = old_section.get("section_title", new_passage.get("topic", ""))
            for question in new_passage.get("questions", []):
                question_index += 1
                answer = reading_answers[question_index - 1] if question_index <= len(reading_answers) else None
                question.update(answer_payload(answer))
                question["eju_answer_no"] = question_index
            passages.append(new_passage)

    return {
        "section_id": "2",
        "section_title": "読解問題",
        "section_name": "読解",
        "section_type": "reading",
        "description": "問題冊子に書かれている文章を読んで答える問題。",
        "passages": passages,
        "skill_tags": ["eju.reading"],
    }


def build_writing_section(source: SourceSet, image_base_url: str, image_out_dir: Path) -> dict:
    # 2010+ booklets place the writing prompt on the first writing pages; page 4 in PDF is the actual prompt for 2010_1.
    prompt_pages = [2, 3]
    parts = []
    assets = []
    for page_index in prompt_pages:
        image = render_pdf_page(source.paper_pdf, page_index, zoom=3.0)
        text = ocr_image(image, psm=4)
        if "記述" in text or "テーマ" in text:
            out_name = f"writing_p{page_index + 1:02d}.jpg"
            save_pdf_page_image(source.paper_pdf, page_index, image_out_dir / out_name, zoom=2.0)
            parts.append(text)
            assets.append({"type": "image", "url": f"{image_base_url}/{out_name}", "alt_text": "記述問題 page"})

    return {
        "section_id": "1",
        "section_title": "記述問題",
        "section_name": "記述",
        "section_type": "writing",
        "description": "二つのテーマから一つを選び、400字から500字で書く問題。",
        "passages": [
            {
                "id": 1,
                "passage": {
                    "type": "text",
                    "title": "記述問題",
                    "value": "\n\n".join(parts),
                },
                "assets": assets,
                "questions": [
                    {
                        "id": 0,
                        "question": "\n\n".join(parts),
                        "options": [],
                        "has_ans": False,
                        "skill_tags": ["eju.writing"],
                    }
                ],
            }
        ],
        "skill_tags": ["eju.writing"],
    }


def sorted_audio_files(audio_dir: Path) -> list[Path]:
    files = [p for p in audio_dir.iterdir() if p.is_file() and p.suffix.lower() in {".mp3", ".wav", ".wma", ".m4a"}]

    def key(path: Path) -> tuple[int, str]:
        match = re.search(r"(\d+)", path.name)
        return (int(match.group(1)) if match else 9999, path.name)

    return sorted(files, key=key)


def ensure_mp3(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return
    if source.suffix.lower() == ".mp3":
        shutil.copy2(source, destination)
        return
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-fflags",
            "+genpts",
            "-i",
            str(source),
            "-af",
            "aresample=async=1:first_pts=0",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(destination),
        ],
        check=True,
    )


def prepare_audio_assets(source: SourceSet, audio_out_dir: Path, audio_base_url: str) -> dict[int, str]:
    files = sorted_audio_files(source.audio_dir)
    urls: dict[int, str] = {}
    if len(files) <= 2:
        session_patterns = [
            f"第{source.session}回",
            f"{source.session}回",
            "第一回" if source.session == 1 else "第二回",
        ]
        matched = [path for path in files if any(pattern in path.name for pattern in session_patterns)]
        source_audio = matched[0] if matched else files[0] if files else None
        if source_audio is None:
            return {}
        out_name = "track_01.mp3"
        ensure_mp3(source_audio, audio_out_dir / out_name)
        url = f"{audio_base_url}/{out_name}"
        return {index: url for index in range(1, 50)}
    for index, audio_file in enumerate(files, start=1):
        out_name = f"track_{index:02d}.mp3"
        ensure_mp3(audio_file, audio_out_dir / out_name)
        urls[index] = f"{audio_base_url}/{out_name}"
    return urls


def extract_question_prompt(text: str, number: int) -> str:
    normalized = text.replace(" ", "")
    marker = f"{number}番"
    if marker not in normalized:
        return ""
    # Keep the full OCR page text for now; the page image remains the authoritative source for diagrams/options.
    return text


def locate_listening_reading_pages(paper_pdf: Path) -> dict[int, int]:
    found: dict[int, int] = {}
    with fitz.open(paper_pdf) as doc:
        start = min(24, doc.page_count)
        end = min(doc.page_count, 50)
        for page_index in range(start, end):
            image = render_pdf_page(paper_pdf, page_index, zoom=1.5)
            text = ocr_image(image, psm=6).replace(" ", "").replace("　", "")
            if "聴解問題" in text and page_index > start:
                break
            if "説明" in text or "練習" in text:
                continue
            for question_no in range(1, 13):
                if question_no in found:
                    continue
                if re.search(rf"(?<!\d){question_no}番", text):
                    found[question_no] = page_index

        for question_no in range(1, 13):
            if question_no in found:
                continue
            previous = found.get(question_no - 1)
            if previous is not None and previous + 1 < doc.page_count:
                found[question_no] = previous + 1

    if len(found) < 12:
        return {question_no: 29 + question_no for question_no in range(1, 13)}
    return found


def build_listening_reading_section(
    source: SourceSet,
    answers: list[int | None],
    audio_urls: dict[int, str],
    image_base_url: str,
    image_out_dir: Path,
) -> dict:
    passages = []
    page_map = locate_listening_reading_pages(source.paper_pdf)
    for question_no in range(1, 13):
        pdf_page_index = page_map[question_no]
        out_name = f"listening_reading_q{question_no:02d}.jpg"
        image = render_pdf_page(source.paper_pdf, pdf_page_index, zoom=2.0)
        save_pdf_page_image(source.paper_pdf, pdf_page_index, image_out_dir / out_name, zoom=2.0)
        prompt = extract_question_prompt(ocr_image(image), question_no)
        question_id = 25 + question_no
        audio_track = question_no + 5
        question = {
            "id": question_id,
            "eju_question_no": question_no,
            "eju_answer_no": question_no,
            "question": prompt,
            "options": ["1", "2", "3", "4"],
            "audio": audio_urls.get(audio_track, ""),
            "source_page": pdf_page_index + 1,
            "skill_tags": ["eju.listening_reading"],
        }
        question.update(answer_payload(answers[question_no - 1]))
        passages.append(
            {
                "id": question_no,
                "topic": f"{question_no}番",
                "passage": {
                    "type": "image",
                    "url": f"{image_base_url}/{out_name}",
                    "alt_text": f"読聴解 {question_no}番",
                },
                "questions": [question],
            }
        )

    return {
        "section_id": "3",
        "section_title": "読聴解問題",
        "section_name": "読聴解",
        "section_type": "listening_reading",
        "description": "問題用紙の文字・図表を見ながら音声を聞いて答える問題。",
        "passages": passages,
        "skill_tags": ["eju.listening_reading"],
    }


def build_listening_section(answers: list[int | None], audio_urls: dict[int, str]) -> dict:
    questions = []
    for offset, answer in enumerate(answers):
        eju_no = 13 + offset
        question_id = 38 + offset
        audio_track = eju_no + 9
        question = {
            "id": question_id,
            "eju_question_no": eju_no,
            "eju_answer_no": eju_no,
            "question": "",
            "options": ["1", "2", "3", "4"],
            "audio": audio_urls.get(audio_track, ""),
            "skill_tags": ["eju.listening"],
        }
        question.update(answer_payload(answer))
        questions.append(question)

    return {
        "section_id": "4",
        "section_title": "聴解問題",
        "section_name": "聴解",
        "section_type": "listening",
        "description": "問題も選択肢もすべて音声で示される問題。問題冊子上の題干は空。",
        "questions": questions,
        "passages": [],
        "skill_tags": ["eju.listening"],
    }


def build_payload(year: int, session: int) -> dict:
    if not TESSERACT_EXE.exists():
        raise FileNotFoundError(f"Tesseract not found: {TESSERACT_EXE}")
    if not (TESSDATA_DIR / "jpn.traineddata").exists():
        raise FileNotFoundError(f"Japanese traineddata not found: {TESSDATA_DIR / 'jpn.traineddata'}")
    pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)

    source = discover_sources(year, session)
    session_text = f"{session:02d}"
    exam_id = f"{year}_{session_text}"
    asset_key = f"{year}_{session_text}"
    image_out_dir = ROOT / "data" / "image" / "eju" / asset_key
    audio_out_dir = ROOT / "data" / "audio" / "eju" / asset_key
    image_base_url = f"/data/image/eju/{asset_key}"
    audio_base_url = f"/data/audio/eju/{asset_key}"

    generation_warnings: list[str] = []
    try:
        answers = extract_answers(source.answer_pdf)
    except Exception as error:
        generation_warnings.append(f"answer extraction failed: {error}")
        answers = {
            "reading": [None] * 25,
            "listening_reading": [None] * 12,
            "listening": [None] * 15,
        }
    audio_urls = prepare_audio_assets(source, audio_out_dir, audio_base_url)

    sections = [
        build_writing_section(source, image_base_url, image_out_dir),
        load_reading_section(year, session, answers["reading"]),
        build_listening_reading_section(source, answers["listening_reading"], audio_urls, image_base_url, image_out_dir),
        build_listening_section(answers["listening"], audio_urls),
    ]

    return {
        "family": "eju",
        "subject": "japanese",
        "paper_type": "complete",
        "level": "",
        "year": str(year),
        "session": session_text,
        "display": exam_id,
        "checked": False,
        "access_level": "free",
        "source_files": {
            "paper_pdf": str(source.paper_pdf.relative_to(ROOT)),
            "answer_pdf": str(source.answer_pdf.relative_to(ROOT)),
            "transcript_pdf": str(source.transcript_pdf.relative_to(ROOT)) if source.transcript_pdf else "",
            "audio_dir": str(source.audio_dir.relative_to(ROOT)),
        },
        "generation_warnings": generation_warnings,
        "exam_info": {
            "title": f"EJU-Japanese-{exam_id}",
            "exam_date": f"{year}/{session_text}",
            "exam_level": "",
            "exam_id": exam_id,
            "family": "eju",
            "subject": "japanese",
            "paper_type": "complete",
            "year": str(year),
            "session": session_text,
            "sections": sections,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a full EJU Japanese sample JSON from local PDFs/audio.")
    parser.add_argument("--year", type=int, default=2010)
    parser.add_argument("--session", type=int, default=1)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "data" / "paper" / "eju")
    args = parser.parse_args()

    payload = build_payload(args.year, args.session)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{args.year}_{args.session:02d}.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
