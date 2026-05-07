from __future__ import annotations

import json
import re
from pathlib import Path

import fitz

from build_eju_full_sample import ROOT, discover_sources, ocr_image, render_pdf_page, save_pdf_page_image


IMAGE_DIR = ROOT / "data" / "image" / "eju"
EJU_DIR = ROOT / "data" / "paper" / "eju"

HEADER_RE = re.compile(r"日本語[ー\-]?\s*\d+")
PAGE_NO_RE = re.compile(r"[-ー―]\s*\d+\s*[-ー―]")
WARNING_RE = re.compile(r"問題冊子の表紙.*?0点になります。?")

COMMON_REPLACEMENTS = {
    "二こつ": "二つ",
    "こつのテーマ": "二つのテーマ",
    "どちらかーつ": "どちらか一つ",
    "どちらかーーつ": "どちらか一つ",
    "どちらか一つ": "どちらか一つ",
    "くだきい": "ください",
    "くだきさい": "ください",
    "くだ さい": "ください",
    "名読点": "句読点",
    "商方": "両方",
    "也.": "2.",
    "記 .": "1.",
    "記.": "1.",
    "也.": "2.",
    "の\n私たち": "2.\n私たち",
    "る\n最近": "2.\n最近",
    "400500字程度": "400～500字程度",
    "400一500字程度": "400～500字程度",
    "400-500字程度": "400～500字程度",
    "400字から500字": "400～500字",
    "ペパーニパポパーレス化": "ペーパーレス化",
    "ペロレ詳性": "ペーパーレス化",
    "つゅて": "ついて",
    "様々 な": "様々な",
    "このょうに": "このように",
    "してがら": "してから",
    "身党に": "簡単に",
    "あるがか": "あるか",
    "よょよう": "よう",
    "について:。": "について、",
    "そして。、": "そして、",
}

MANUAL_TEXT_KEEP = {"2023_02"}


def normalize_spacing(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            normalized_lines.append("")
            continue
        line = line.replace("（", "(").replace("）", ")")
        line = line.replace("①", "1.").replace("②", "2.")
        line = HEADER_RE.sub("", line)
        line = PAGE_NO_RE.sub("", line)
        line = re.sub(r"[ \t　]+", " ", line)
        line = re.sub(r"(?<=[一-龯ぁ-んァ-ヶーA-Za-z0-9]) (?=[一-龯ぁ-んァ-ヶーA-Za-z0-9])", "", line)
        line = re.sub(r"\s*([、。，．,])\s*", r"\1", line)
        line = re.sub(r"\(\s*", "（", line)
        line = re.sub(r"\s*\)", "）", line)
        line = line.replace(" .", "。")
        line = line.replace("，", "、")
        for before, after in COMMON_REPLACEMENTS.items():
            line = line.replace(before, after)
        normalized_lines.append(line.strip())
    text = "\n".join(normalized_lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def prettify_block(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(?<=[一-龯ぁ-んァ-ヶーA-Za-z0-9]) (?=[一-龯ぁ-んァ-ヶーA-Za-z0-9])", "", text)
    text = text.replace(",", "、")
    text = text.replace("。 ", "。")
    text = text.replace("（ ", "（").replace(" ）", "）")
    text = text.replace("400～500字で", "400～500字程度で")
    text = text.replace("句読点を含む）。", "句読点を含む）。")
    text = text.replace(" （", "（")
    return text


def build_clean_prompt(text: str) -> str:
    normalized = normalize_spacing(text)
    raw_lines = [line.strip() for line in normalized.splitlines()]
    lines: list[str] = []
    for line in raw_lines:
        if not line:
            continue
        if HEADER_RE.search(line) or line == "記述問題":
            continue
        line = COMMON_REPLACEMENTS.get(line, line)
        line = line.replace("①", "1.").replace("②", "2.")
        line = line.replace("1。", "1.").replace("2。", "2.")
        line = line.replace("以下のこつのテーマ", "以下の二つのテーマ")
        line = line.replace("以下の二こつのテーマ", "以下の二つのテーマ")
        line = line.replace("以下の二つのテーマのうち,どちらか一つを選んで", "以下の二つのテーマのうち、どちらか一つを選んで")
        line = line.replace("400字から500字で", "400～500字程度で")
        line = line.replace("400～500字で", "400～500字程度で")
        lines.append(line)

    started = False
    instruction_lines: list[str] = []
    item1_lines: list[str] = []
    item2_lines: list[str] = []
    warning_lines: list[str] = []
    target = None

    for line in lines:
        if not started:
            if line.startswith("以下"):
                started = True
                instruction_lines.append(line)
            continue

        if line.startswith("問題冊子の表紙"):
            target = "warning"
            warning_lines.append(line)
            continue

        if target is None and ("句読点" in line or line.startswith("（")):
            instruction_lines.append(line)
            continue

        if line in {"1.", "1"} or line.startswith("1."):
            target = "item1"
            content = line[2:].strip() if line.startswith("1.") else ""
            if content:
                item1_lines.append(content)
            continue

        if line in {"2.", "2"} or line.startswith("2."):
            target = "item2"
            content = line[2:].strip() if line.startswith("2.") else ""
            if content:
                item2_lines.append(content)
            continue

        if target == "warning":
            warning_lines.append(line)
        elif target == "item2":
            item2_lines.append(line)
        elif target == "item1":
            item1_lines.append(line)
        else:
            target = "item1"
            item1_lines.append(line)

    parts: list[str] = []
    if instruction_lines:
        parts.append(prettify_block(" ".join(instruction_lines)))
    if item1_lines:
        parts.append("1.\n　" + prettify_block(" ".join(item1_lines)))
    if item2_lines:
        parts.append("2.\n　" + prettify_block(" ".join(item2_lines)))
    if warning_lines:
        parts.append(prettify_block(" ".join(warning_lines)))
    return "\n\n".join(part for part in parts if part).strip()


def page_score(text: str) -> int:
    score = 0
    if "以下" in text:
        score += 5
    if "テーマ" in text:
        score += 4
    if "400" in text and "500" in text:
        score += 4
    if "記述" in text:
        score += 2
    if "試験全体" in text:
        score -= 6
    if "問題はありません" in text:
        score -= 4
    if "読解問題" in text:
        score -= 3
    return score


def detect_prompt_page(pdf_path: Path) -> int:
    best_index = 0
    best_score = -999
    with fitz.open(pdf_path) as doc:
        page_count = doc.page_count
    for page_index in range(min(12, page_count)):
        image = render_pdf_page(pdf_path, page_index, zoom=2.0)
        text = ocr_image(image, psm=4)
        score = page_score(text)
        if score > best_score:
            best_score = score
            best_index = page_index
    return best_index


def update_exam(exam_id: str) -> None:
    json_path = EJU_DIR / f"{exam_id}.json"
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    writing = next((section for section in payload["exam_info"]["sections"] if section.get("section_type") == "writing"), None)
    if not writing:
        return
    passage = writing["passages"][0]["passage"]

    year, session = exam_id.split("_")
    source = discover_sources(int(year), int(session))
    prompt_page_index = detect_prompt_page(source.paper_pdf)
    prompt_image = render_pdf_page(source.paper_pdf, prompt_page_index, zoom=3.0)
    prompt_text = build_clean_prompt(ocr_image(prompt_image, psm=11))
    if exam_id in MANUAL_TEXT_KEEP:
        prompt_text = passage["value"].strip()

    image_dir = IMAGE_DIR / exam_id
    image_dir.mkdir(parents=True, exist_ok=True)
    out_name = "writing_prompt.jpg"
    save_pdf_page_image(source.paper_pdf, prompt_page_index, image_dir / out_name, zoom=2.0)

    passage["title"] = "記述問題"
    passage["value"] = prompt_text
    writing["passages"][0]["assets"] = [
        {
            "type": "image",
            "url": f"/data/image/eju/{exam_id}/{out_name}",
            "alt_text": "記述問題 page",
        }
    ]

    def normalize_question(question: dict) -> None:
        question["id"] = 1
        question["question"] = ""
        question["has_ans"] = False
        question["skill_tags"] = ["eju.writing"]
        question["_groupPassage"] = {
            "title": "記述問題",
            "type": "text",
            "value": prompt_text,
        }
        question["_groupPassageKey"] = "1:p1"
        question.pop("options", None)
        question.pop("correct_answer", None)
        question.pop("answer", None)

    if writing.get("questions"):
        normalize_question(writing["questions"][0])
        writing["questions"] = [writing["questions"][0]]
    if writing["passages"][0].get("questions"):
        normalize_question(writing["passages"][0]["questions"][0])
        writing["passages"][0]["questions"] = [writing["passages"][0]["questions"][0]]

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{exam_id}: page {prompt_page_index + 1} -> normalized")


def main() -> None:
    exam_ids = sorted(path.stem for path in EJU_DIR.glob("*.json"))
    for exam_id in exam_ids:
        update_exam(exam_id)


if __name__ == "__main__":
    main()
