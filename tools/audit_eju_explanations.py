"""Check that EJU answer notes do not pose as unsupported question analysis."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path


PAPERS = Path(__file__).resolve().parents[1] / "data" / "paper" / "eju"
GENERIC_CLAIMS = (
    "听第一遍抓场景和问题目标",
    "读听解需要同时使用页面上的图表/文字",
    "请根据题干定位上方材料",
    "读解题的错误选项常见问题",
)
# 2024 年度第 1 回 EJU 日本语正解表，第 371 页。
ANSWER_SHEET_2024 = {
    "reading": [1, 4, 3, 4, 3, 1, 1, 3, 2, 3, 2, 1, 1, 4, 2, 1, 3, 2, 4, 3, 2, 4, 1, 2, 4],
    "listening_reading": [3, 2, 1, 4, 3, 3, 4, 1, 2, None, 3, 2],
    "listening": [4, 1, 4, 3, 1, 3, 2, 3, 2, 1, 2, 3, 4, 2, 4],
}


def questions(section: dict) -> list[dict]:
    direct = section.get("questions", [])
    return direct or [question for block in section.get("passages", []) for question in block.get("questions", [])]


def main() -> None:
    errors: list[str] = []
    repeated: dict[str, list[str]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    canonical_2024: dict[tuple[str, int], dict] = {}
    papers = [p for p in sorted(PAPERS.glob("*.json")) if re.fullmatch(r"\d{4}_\d{2}", p.stem)]

    for path in papers:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for section in payload["exam_info"]["sections"]:
            category = section.get("section_type", "")
            if category == "writing":
                continue
            items = questions(section)
            counts[category] += len(items)
            if path.stem == "2024_01":
                expected = ANSWER_SHEET_2024[category]
                actual = [item.get("correct_answer") for item in items]
                if actual != expected:
                    errors.append(f"{path.stem}/{category}: answers differ from the source answer sheet")

            for item in items:
                label = f"{path.stem}/{category}/{item.get('id')}"
                core = str(item.get("explanation") or "")
                extra = str(item.get("explanation_expand") or "")
                answer_no = item.get("eju_answer_no")
                if not core:
                    errors.append(f"{label}: missing answer note")
                    continue
                if any(marker in core + extra for marker in GENERIC_CLAIMS):
                    errors.append(f"{label}: unsupported boilerplate survives")
                repeated[core].append(label)

                script = item.get("script") or []
                script_text = " ".join(str(segment.get("text", "")) for segment in script) if isinstance(script, list) else str(script)
                lacks_audio_text = category in {"listening", "listening_reading"} and (
                    len(script_text) < 100 or "音声原文は未収録" in script_text
                )
                if item.get("correct_answer") is None:
                    if not core.startswith("【资料说明】"):
                        errors.append(f"{label}: unavailable item is labeled as an answer analysis")
                elif lacks_audio_text and not core.startswith("【答案核对】"):
                    errors.append(f"{label}: audio has no transcript, but note claims to be analysis")
                elif path.stem == "2024_01" and category == "reading" and answer_no != 1:
                    if not core.startswith("【答案核对】"):
                        errors.append(f"{label}: generic reading note claims to be analysis")
                if path.stem == "2024_01":
                    if extra:
                        errors.append(f"{label}: 2024 boilerplate supplemental note survives")
                    canonical_2024[(category, answer_no)] = item

    for core, labels in repeated.items():
        if len(labels) > 1 and not core.startswith("【资料说明】"):
            errors.append(f"identical analysis reused across questions: {', '.join(labels)}")

    diagnostic = json.loads((PAPERS / "EJU_JAPANESE_DIAGNOSTIC_V1.json").read_text(encoding="utf-8"))
    diagnostic_count = 0
    for section in diagnostic["exam_info"]["sections"]:
        category = section.get("section_type", "")
        if category == "writing":
            continue
        for item in questions(section):
            diagnostic_count += 1
            source = canonical_2024.get((category, item.get("eju_answer_no")))
            if source is None or any(item.get(field) != source.get(field) for field in ("correct_answer", "explanation", "explanation_expand")):
                errors.append(f"diagnostic/{category}/{item.get('id')}: answer note differs from 2024_01")

    print(f"Audited {len(papers)} EJU papers, {sum(counts.values())} objective items, "
          f"and {diagnostic_count} diagnostic items: {dict(counts)}")
    if errors:
        raise SystemExit("\n".join(errors))


if __name__ == "__main__":
    main()
