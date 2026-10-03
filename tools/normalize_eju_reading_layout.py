"""Reflow verified EJU reading OCR without changing answer keys or options.

The ranges below refer to the original source's physical OCR lines.  A range is
one logical paragraph (or one item in a notice).  Running the script again is
safe: a group is skipped once it has been normalized.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "paper" / "eju"

# Text-only repairs in older papers. Most later years already contain logical
# paragraphs, so reflowing every newline would destroy notices and footnotes.
OLDER = {
    "2010_01.json": {
        9: [(0, 6), (7, 7)],
        11: [(0, 1), (2, 3), (4, 4), (5, 8), (9, 9), (10, 10)],
    },
    "2010_02.json": {
        1: [(0, 4), (5, 8), (9, 10), (11, 12), (13, 15), (16, 16)],
        2: [(0, 7), (8, 10), (11, 11)],
        5: [(0, 3), (4, 4), (5, 8), (9, 9)],
        8: [(0, 0), (1, 1), (2, 2), (3, 5), (6, 8), (9, 10), (11, 11), (12, 12), (13, 13)],
    },
    "2011_01.json": {
        9: [(0, 6), (7, 7)],
        12: [(0, 6), (7, 10), (11, 18), (19, 19), (20, 20)],
    },
    "2011_02.json": {
        1: [(0, 0), (1, 1), (2, 5), *[(index, index) for index in range(6, 15)]],
    },
    "2012_01.json": {
        4: [(0, 1), (3, 3), (5, 8), (9, 9)],
    },
    "2013_02.json": {
        8: [(0, 0), (1, 2), *[(index, index) for index in range(3, 10)], (10, 11), *[(index, index) for index in range(12, 16)]],
    },
    "2017_01.json": {
        11: [(0, 0), (1, 1), (2, 3), *[(index, index) for index in range(4, 19)]],
    },
    "2018_02.json": {
        2: [*[(index, index) for index in range(11)], (11, 12), *[(index, index) for index in range(13, 23)]],
    },
    "2021_02.json": {
        2: [*[(index, index) for index in range(17)], (17, 18), (19, 20), (21, 21)],
    },
}

# 2024 source was OCRed page by page. The passage field includes page numbers,
# question prompts and four answer options; those belong outside the passage.
READING_2024 = {
    2: [(2, 2), (3, 7), (8, 8), (9, 10), (11, 12), (13, 13), (14, 15), (16, 17), (18, 18), (19, 19), (20, 20)],
    3: [(2, 4), (5, 5), (6, 8), (9, 14), (15, 15), (16, 16)],
    4: [(2, 4), (5, 8), (9, 13), (14, 14), (15, 16)],
    5: [(2, 5), (6, 8), (9, 10), (11, 14), (15, 15)],
    6: [(2, 7), (8, 11), (12, 12), (13, 13)],
    7: [(2, 6), (7, 11), (12, 12), (13, 13)],
    8: [(3, 7), (8, 14), (15, 15)],
    9: [(2, 3), (4, 7), (8, 11), (12, 12)],
    10: [(2, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 10), (11, 15), (16, 16)],
    11: [(2, 5), (6, 11), (12, 14), (15, 16), (17, 17)],
    12: [(3, 5), (6, 12), (13, 13), (14, 16), (17, 18), (19, 19)],
    13: [(2, 11), (12, 12), (13, 13)],
    14: [(2, 8), (9, 16), (17, 19), (20, 20), (21, 21)],
    16: [(2, 4), (5, 8), (9, 14), (15, 16)],
    17: [(3, 6), (7, 9), (10, 14), (15, 21), (22, 25), (26, 26), (27, 30), (31, 33), (34, 35), (38, 38), (39, 39), (40, 40), (41, 42), (43, 43)],
}

PROMPTS_2024 = {
    2: [(1,)], 3: [(1,)], 4: [(1,)], 5: [(1,)], 6: [(1,)],
    7: [(1,)], 8: [(1,)], 9: [(1,)], 10: [(1,)],
    11: [(21,), (26,)],
    12: [(22,), (27,)],
    13: [(17,), (22,)],
    14: [(24,), (29,)],
    16: [(19,), (24,)],
    17: [(44,), (49,), (54,)],
}


def sections(data):
    return [
        group
        for section in data.get("exam_info", {}).get("sections", [])
        if section.get("section_type") == "reading"
        for group in section.get("passages", [])
    ]


def reflow(lines, spans):
    assert all(0 <= start <= end < len(lines) for start, end in spans)
    return "\n\n".join("".join(line.strip() for line in lines[start:end + 1]) for start, end in spans)


def clean_prompt(raw):
    raw = re.sub(r"^(?:[IVX]+_?\s+|[問間]\s*(\d+)\s*)", lambda m: f"問{m.group(1)} " if m.group(1) else "", raw.strip())
    raw = re.sub(r"\s*(?:\[|\|)?\s*\d+\s*\]?\s*$", "", raw)
    return raw.strip()


def replace_string(raw, old, new, field, expected=1):
    old_token = f'"{field}": {json.dumps(old, ensure_ascii=False)}'
    new_token = f'"{field}": {json.dumps(new, ensure_ascii=False)}'
    actual = raw.count(old_token)
    if actual != expected:
        raise ValueError(f"Expected {expected} {field!r} occurrence(s), found {actual}")
    return raw.replace(old_token, new_token, expected)


def process_file(path, spans_by_group, prompts=False):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    changes = 0
    for group in sections(data):
        group_id = group.get("id")
        if group_id not in spans_by_group:
            continue
        old = group.get("passage", {}).get("value")
        if not isinstance(old, str):
            continue
        if prompts and not group["questions"][0]["question"].startswith("OCR本文"):
            continue
        if not prompts and "\n\n" in old:
            continue
        lines = old.splitlines()
        spans = spans_by_group[group_id]
        if max(end for _, end in spans) >= len(lines):
            # The file has already been reflowed.
            continue
        new = reflow(lines, spans)
        if group_id == 2 and prompts:
            new = new.replace("ま自賠責保険・", "＊自賠責保険：").replace("** 任意保険・", "＊＊任意保険：")
        if new != old:
            raw = replace_string(raw, old, new, "value")
            changes += 1
        if prompts:
            for question, indices in zip(group["questions"], PROMPTS_2024[group_id]):
                old_question = question["question"]
                new_question = clean_prompt("".join(lines[index] for index in indices))
                if new_question != old_question:
                    raw = replace_string(raw, old_question, new_question, "question")
                    changes += 1
    if changes:
        json.loads(raw)
        path.write_text(raw, encoding="utf-8")
    return changes


def process_2024_image_questions(path):
    """The figure must stay as an image; only remove duplicate OCR from Q19/20."""
    raw = path.read_text(encoding="utf-8")
    group = next(group for group in sections(json.loads(raw)) if group.get("id") == 15)
    old = group["questions"][0]["question"]
    if not old.startswith("日本語一26"):
        return 0
    if group["questions"][1]["question"] != old:
        raise ValueError("Expected the same OCR dump in both image questions")
    token = f'"question": {json.dumps(old, ensure_ascii=False)}'
    if raw.count(token) != 2:
        raise ValueError("Expected two duplicated image questions")
    prompts = (
        "問1 （A）に入るものとして、最も適当なものはどれですか。",
        "問2 図1〜図3のうち、本文の説明の中で、図形の配置にデザインという作業がされていると述べられているものはどれですか。",
    )
    for prompt in prompts:
        raw = raw.replace(token, f'"question": {json.dumps(prompt, ensure_ascii=False)}', 1)
    json.loads(raw)
    path.write_text(raw, encoding="utf-8")
    return 2


def compact_notice(path, group_id):
    raw = path.read_text(encoding="utf-8")
    group = next(group for group in sections(json.loads(raw)) if group.get("id") == group_id)
    old = group["passage"]["value"]
    if "\n\n" not in old:
        return 0
    raw = replace_string(raw, old, old.replace("\n\n", "\n"), "value")
    json.loads(raw)
    path.write_text(raw, encoding="utf-8")
    return 1


OPTION_REPAIRS_2024 = {
    "4. ところで間 2 この文章の内容と合っているものはどれですか。 [12]": "4. ところで",
    "4. ほめられることに慣れてしまうと、 次第に喜びを感じなくなる。14": "4. ほめられることに慣れてしまうと、 次第に喜びを感じなくなる。",
    "4. 高い水温で飼育すると、 鮮やかで美しい色になる。間 2 下線部 「ある大きな問題」 の原因として、 最も適当なものはどれですか。 [16]": "4. 高い水温で飼育すると、 鮮やかで美しい色になる。",
    "2. 、 集団内で争わない蟻のほうが猿より知性的である。": "2. 集団内で争わない蟻のほうが猿より知性的である。",
    "3. _ それに対する感じ方が自分と他者では異なる": "3. それに対する感じ方が自分と他者では異なる",
    "4. それを他者に伝えることができる間 2 図 1一図 3 のうち、 本文の説明の中で、 図形の配置にデザインという作業がされていると人述べられている $ もるのはどれですか。 20": "4. それを他者に伝えることができる",
    "1. 交尾前 : オス交尾後 : オス": "1. 交尾前：オス　交尾後：オス",
    "2. 交尾前 : オス交尾後 : オスとメス": "2. 交尾前：オス　交尾後：オスとメス",
    "3. 交尾前 : メス交尾後・オスとメス": "3. 交尾前：メス　交尾後：オスとメス",
    "4. 交尾前 : オスとメス。 交尾後・メス": "4. 交尾前：オスとメス　交尾後：メス",
}


def repair_2024_option_artifacts(path):
    raw = path.read_text(encoding="utf-8")
    changes = 0
    for old, new in OPTION_REPAIRS_2024.items():
        if old in raw:
            raw = raw.replace(old, new)
            changes += 1
    for answer_no in range(2, 26):
        old = f"请先看 OCR 文本中解答番号{answer_no}附近的问题和选项，再回到前文确认对应的理由、条件或对比关系。"
        if old in raw:
            raw = raw.replace(old, "请根据题干定位上方材料中的相关语句，再核对选项中的对象、条件和结论。")
            changes += 1
    raw = raw.replace("> (略 ) ・…", "…（略）…")
    if changes:
        json.loads(raw)
        path.write_text(raw, encoding="utf-8")
    return changes


def remove_2016_page_mark(path):
    raw = path.read_text(encoding="utf-8")
    group = next(group for group in sections(json.loads(raw)) if group.get("id") == 17)
    old = group["passage"]["value"]
    if not old.endswith("\n第31页"):
        return 0
    raw = replace_string(raw, old, old.removesuffix("\n第31页"), "value")
    json.loads(raw)
    path.write_text(raw, encoding="utf-8")
    return 1


if __name__ == "__main__":
    for filename, spans in OLDER.items():
        print(filename, process_file(ROOT / filename, spans))
    print("2024_01.json", process_file(ROOT / "2024_01.json", READING_2024, True))
    print("2024_01.json image questions", process_2024_image_questions(ROOT / "2024_01.json"))
    diagnostic = ROOT / "EJU_JAPANESE_DIAGNOSTIC_V1.json"
    if diagnostic.exists():
        subset = {key: value for key, value in READING_2024.items() if key <= 12}
        print(diagnostic.name, process_file(diagnostic, subset, True))
    for filename, group_id in (
        ("2010_02.json", 8), ("2011_02.json", 1), ("2013_02.json", 8),
        ("2017_01.json", 11), ("2018_02.json", 2), ("2021_02.json", 2),
        ("2024_01.json", 2),
        ("EJU_JAPANESE_DIAGNOSTIC_V1.json", 2),
    ):
        path = ROOT / filename
        if path.exists():
            print(filename, "compact notice", compact_notice(path, group_id))
    print("2024_01.json option artifacts", repair_2024_option_artifacts(ROOT / "2024_01.json"))
    if diagnostic.exists():
        print(diagnostic.name, "option artifacts", repair_2024_option_artifacts(diagnostic))
    print("2016_01.json page mark", remove_2016_page_mark(ROOT / "2016_01.json"))
