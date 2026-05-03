from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"
READING_DIR = EJU_DIR / "reading"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def session_text(value: str | int) -> str:
    return f"{int(value):02d}"


def question_count(section: dict[str, Any]) -> int:
    return len(section.get("questions", [])) + sum(
        len(passage.get("questions", [])) for passage in section.get("passages", [])
    )


def empty_section(section_id: str, title: str, name: str, section_type: str, description: str) -> dict[str, Any]:
    return {
        "section_id": section_id,
        "section_title": title,
        "section_name": name,
        "section_type": section_type,
        "description": description,
        "passages": [],
        "questions": [],
        "skill_tags": [f"eju.{section_type}"],
    }


def skeleton_payload(year: str, session: str) -> dict[str, Any]:
    exam_id = f"{year}_{session}"
    return {
        "family": "eju",
        "subject": "japanese",
        "paper_type": "complete",
        "level": "",
        "year": year,
        "session": session,
        "display": exam_id,
        "checked": False,
        "access_level": "free",
        "exam_info": {
            "title": f"EJU-Japanese-{exam_id}",
            "exam_date": f"{year}/{session}",
            "exam_level": "",
            "exam_id": exam_id,
            "family": "eju",
            "subject": "japanese",
            "paper_type": "complete",
            "year": year,
            "session": session,
            "sections": [
                empty_section(
                    "1",
                    "記述問題",
                    "記述",
                    "writing",
                    "二つのテーマから一つを選び、400字から500字で書く問題。",
                ),
                empty_section(
                    "2",
                    "読解問題",
                    "読解",
                    "reading",
                    "問題冊子に書かれている文章を読んで答える問題。",
                ),
                empty_section(
                    "3",
                    "読聴解問題",
                    "読聴解",
                    "listening_reading",
                    "問題用紙の文字・図表を見ながら音声を聞いて答える問題。",
                ),
                empty_section(
                    "4",
                    "聴解問題",
                    "聴解",
                    "listening",
                    "問題も選択肢もすべて音声で示される問題。問題冊子上の題干は空。",
                ),
            ],
        },
    }


def normalize_complete_payload(payload: dict[str, Any], year: str, session: str) -> dict[str, Any]:
    exam_id = f"{year}_{session}"
    payload["family"] = "eju"
    payload["subject"] = "japanese"
    payload["paper_type"] = "complete"
    payload["level"] = ""
    payload["year"] = year
    payload["session"] = session
    payload["display"] = exam_id
    payload.setdefault("checked", False)
    payload.setdefault("access_level", "free")

    exam_info = payload.setdefault("exam_info", {})
    exam_info["title"] = f"EJU-Japanese-{exam_id}"
    exam_info["exam_date"] = f"{year}/{session}"
    exam_info["exam_level"] = ""
    exam_info["exam_id"] = exam_id
    exam_info["family"] = "eju"
    exam_info["subject"] = "japanese"
    exam_info["paper_type"] = "complete"
    exam_info["year"] = year
    exam_info["session"] = session
    return payload


def find_section(payload: dict[str, Any], section_id: str, section_type: str) -> dict[str, Any] | None:
    for section in payload.get("exam_info", {}).get("sections", []):
        if str(section.get("section_id", "")) == section_id or section.get("section_type") == section_type:
            return section
    return None


def answer_by_order(section: dict[str, Any] | None) -> dict[int, dict[str, Any]]:
    if not section:
        return {}
    answers: dict[int, dict[str, Any]] = {}
    index = 0
    for passage in section.get("passages", []):
        for question in passage.get("questions", []):
            index += 1
            answer_no = int(question.get("eju_answer_no") or index)
            kept = {
                key: deepcopy(question[key])
                for key in ("correct_answer", "answer", "has_ans")
                if key in question
            }
            if kept:
                answers[answer_no] = kept
    for question in section.get("questions", []):
        index += 1
        answer_no = int(question.get("eju_answer_no") or index)
        kept = {
            key: deepcopy(question[key])
            for key in ("correct_answer", "answer", "has_ans")
            if key in question
        }
        if kept:
            answers[answer_no] = kept
    return answers


def build_reading_section(reading_payload: dict[str, Any], existing_section: dict[str, Any] | None) -> dict[str, Any]:
    preserved_answers = answer_by_order(existing_section)
    passages: list[dict[str, Any]] = []
    question_index = 0

    for old_section in reading_payload["exam_info"].get("sections", []):
        for passage in old_section.get("passages", []):
            new_passage = deepcopy(passage)
            new_passage["topic"] = old_section.get("section_title", new_passage.get("topic", ""))
            for question in new_passage.get("questions", []):
                question_index += 1
                question["eju_answer_no"] = question_index
                question.setdefault("has_ans", False)
                if question_index in preserved_answers:
                    question.update(deepcopy(preserved_answers[question_index]))
            passages.append(new_passage)

    return {
        "section_id": "2",
        "section_title": "読解問題",
        "section_name": "読解",
        "section_type": "reading",
        "description": "問題冊子に書かれている文章を読んで答える問題。",
        "passages": passages,
        "questions": [],
        "skill_tags": ["eju.reading"],
    }


def ensure_four_sections(payload: dict[str, Any], reading_section: dict[str, Any]) -> None:
    existing = {str(section.get("section_id", "")): section for section in payload["exam_info"].get("sections", [])}
    existing_by_type = {section.get("section_type", ""): section for section in payload["exam_info"].get("sections", [])}
    fallback = skeleton_payload(payload["year"], payload["session"])["exam_info"]["sections"]

    sections: list[dict[str, Any]] = []
    for template in fallback:
        if template["section_id"] == "2":
            sections.append(reading_section)
            continue
        section = existing.get(template["section_id"]) or existing_by_type.get(template["section_type"]) or template
        sections.append(section)
    payload["exam_info"]["sections"] = sections


def copy_full_to_root() -> list[Path]:
    written: list[Path] = []
    for path in sorted((EJU_DIR / "full").glob("EJU_JAPANESE_*.json")):
        match = re.search(r"EJU_JAPANESE_(\d{4})_(\d+)$", path.stem)
        if not match:
            continue
        year, raw_session = match.groups()
        session = session_text(raw_session)
        out_path = EJU_DIR / f"{year}_{session}.json"
        if out_path.exists():
            continue
        payload = normalize_complete_payload(read_json(path), year, session)
        write_json(out_path, payload)
        written.append(out_path)
    return written


def merge_reading_to_root() -> list[tuple[Path, int]]:
    results: list[tuple[Path, int]] = []
    for path in sorted(READING_DIR.glob("EJU_READING_*.json")):
        match = re.search(r"EJU_READING_(\d{4})_(\d+)$", path.stem)
        if not match:
            continue
        year, raw_session = match.groups()
        if int(year) < 2010:
            continue

        session = session_text(raw_session)
        out_path = EJU_DIR / f"{year}_{session}.json"
        existing = read_json(out_path) if out_path.exists() else skeleton_payload(year, session)
        existing = normalize_complete_payload(existing, year, session)
        existing_section = find_section(existing, "2", "reading")
        reading_section = build_reading_section(read_json(path), existing_section)
        ensure_four_sections(existing, reading_section)
        write_json(out_path, existing)
        results.append((out_path, question_count(reading_section)))
    return results


def main() -> None:
    full_written = copy_full_to_root()
    merged = merge_reading_to_root()
    print(f"full copied: {len(full_written)}")
    print(f"reading merged: {len(merged)}")
    for path, count in merged:
        print(f"{path.relative_to(ROOT)}\tsection2_questions={count}")


if __name__ == "__main__":
    main()
