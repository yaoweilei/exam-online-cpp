"""Audit all EJU reading groups for OCR artifacts that damage on-screen layout.

Returns a nonzero status for high-confidence problems. Physical line-break
candidates are reported separately because notices and tables need their rows.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "paper" / "eju"
PAGE_MARK = re.compile(r"^(?:日本語[―ー一−-]\s*\d+|[ー―-]\s*\d+\s*[ー―-])$")
STRUCTURED = re.compile(r"お知らせ|募集|申込|申請|各種|宛先|講習会|講演会|診断の実施|登録について|利用について")


def reading_groups(data):
    return [
        group
        for section in data.get("exam_info", {}).get("sections", [])
        if section.get("section_type") == "reading"
        for group in section.get("passages", [])
    ]


def audit_group(group):
    passage = group.get("passage", {})
    value = passage.get("value", "") if passage.get("type") == "text" else ""
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    problems = []
    if any(PAGE_MARK.fullmatch(line) for line in lines):
        problems.append("page marker in passage")
    if any(re.fullmatch(r"第\d+[页頁]", line) for line in lines):
        problems.append("page marker in passage")
    if any(isinstance(question.get("question"), str) and question["question"].startswith("OCR本文") for question in group.get("questions", [])):
        problems.append("placeholder question")
    if any(isinstance(question.get("question"), str) and question["question"].startswith("日本語一") for question in group.get("questions", [])):
        problems.append("duplicate OCR in question")

    # Only count an option as duplicated when its full text is already stored
    # in the question. A notice with four numbered rules is legitimate.
    for question in group.get("questions", []):
        options = question.get("options", [])
        if isinstance(options, dict):
            option_texts = [str(option) for option in options.values()]
        elif isinstance(options, list):
            option_texts = [str(option.get("text", option.get("value", ""))) if isinstance(option, dict) else str(option) for option in options]
        else:
            option_texts = []
        if any(re.search(r"(?:問|間)\s*[1-9１-９]", option) for option in option_texts):
            problems.append("next question embedded in option")
        matches = 0
        for option in option_texts:
            body = re.sub(r"^\s*[1-4１-４][.．、。)）]?\s*", "", option).strip()
            if len(body) >= 7 and any(body in line for line in lines):
                matches += 1
        if matches >= 3:
            problems.append("answer options duplicated in passage")
            break

    # Paper-width line runs are suspicious only in continuous prose. Later
    # editions already use long logical paragraphs plus separate footnotes.
    if lines and not STRUCTURED.search(lines[0]):
        wraps = 0
        for paragraph in value.split("\n\n"):
            rows = [row.strip() for row in paragraph.splitlines() if row.strip()]
            rows = [row for row in rows if not row.startswith(("（", "(", "＊", "*", "a.", "b.", "c.", "d."))]
            wraps += sum(
                30 <= len(left) <= 44
                and 5 <= len(right) <= 44
                and not re.search(r"[。！？!?…：:]$", left)
                for left, right in zip(rows, rows[1:])
            )
        if wraps >= 2:
            problems.append(f"possible paper-width wraps ({wraps})")
    return problems


def main():
    papers = 0
    groups = 0
    text_groups = 0
    problems = []
    for path in sorted(ROOT.glob("*.json")):
        papers += 1
        for group in reading_groups(json.loads(path.read_text(encoding="utf-8"))):
            groups += 1
            text_groups += group.get("passage", {}).get("type") == "text"
            for problem in audit_group(group):
                problems.append((path.name, group.get("id"), problem))
    print(f"Checked {groups} reading groups ({text_groups} text) in {papers} EJU papers")
    for filename, group_id, problem in problems:
        print(f"{filename} group {group_id}: {problem}")
    print(f"Findings: {len(problems)}")
    return bool(problems)


if __name__ == "__main__":
    raise SystemExit(main())
