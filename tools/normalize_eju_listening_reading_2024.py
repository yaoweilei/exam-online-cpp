"""Replace 2024 EJU listening-reading OCR dumps with verified page prompts.

The original page images remain the source of every chart, figure and table.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "paper" / "eju"
PROMPTS = {
    1: "先生が、野生動物の餌付けによって引き起こされる問題について話しています。この先生が最後に挙げる事例と関係があるのは、図のどの部分ですか。",
    2: "先生が、どのようなメディアを利用して、文字にふれているかについて話しています。この先生は、グラフのどの部分に注目して、意見を述べていますか。",
    3: "工学の先生が授業で、バルブについて話しています。この先生が最後にする質問の答えはどれですか。",
    4: "先生が、社会学の授業で、観光事業の「効果」と「影響」について話しています。この先生が最後にする質問の答えとして、適当なものはどれですか。",
    5: "先生が、仕事に対する積極性とストレスについて話しています。この先生が最後に挙げる例について、新しい職場における仕事の位置づけを表しているのはAからDのどれですか。",
    6: "先生が、技術を伝えるときのポイントについて話しています。この先生の話によると、技術を伝える人が特に気をつける必要がある項目はどれですか。",
    7: "男子学生と女子学生が、宅配便のサービスについて話しています。この女子学生は、図のAからDのどの項目について詳しく調べようと思っていますか。",
    8: "先生が、ラットという実験用のネズミを使った実験について話しています。この先生の説明を図で表すと、どうなりますか。",
    9: "先生が、コンテナ輸送について話しています。この先生が、コンテナ輸送の最も大きな利点だと言っていることは、図のどの場所での作業に関係しますか。",
    10: "本問題は出版上の都合により掲載されていません。解答できないため、次の問題へ進んでください。",
    11: "先生がエネルギー工学の授業で、ある水力発電設備について話しています。図の水力発電所のAとBの方向に水が移動する時間帯について、正しい組合せはどれですか。",
    12: "先生が、相手の発言を促すための工夫について話しています。この先生が最後に挙げる例は、図の方法のどれとどれに当たりますか。",
}
OPTIONS = {
    3: ["1. a", "2. b", "3. c", "4. d"],
    5: ["1. A", "2. B", "3. C", "4. D"],
    9: ["1. AとF", "2. BとC", "3. DとE", "4. EとF"],
    10: [],
    12: ["1. aとb", "2. bとc", "3. cとd", "4. aとd"],
}


def replace_field(raw, field, old, new):
    old_token = f'"{field}": {json.dumps(old, ensure_ascii=False)}'
    new_token = f'"{field}": {json.dumps(new, ensure_ascii=False)}'
    count = raw.count(old_token)
    if count != 1:
        raise ValueError(f"Expected one {field} field, found {count}")
    return raw.replace(old_token, new_token, 1)


def replace_options_after_question(raw, prompt, old, new):
    anchor = f'"question": {json.dumps(prompt, ensure_ascii=False)}'
    start = raw.find(anchor)
    if start < 0:
        raise ValueError(f"Missing prompt: {prompt}")
    match = re.search(r'"options"\s*:\s*', raw[start + len(anchor):])
    if not match:
        raise ValueError(f"Missing options after prompt: {prompt}")
    location = start + len(anchor) + match.end()
    parsed, length = json.JSONDecoder().raw_decode(raw[location:])
    if parsed != old:
        raise ValueError(f"Unexpected options after prompt: {prompt}")
    replacement = "[\n" + ",\n".join(" " * 18 + json.dumps(option, ensure_ascii=False) for option in new) + "\n" + " " * 16 + "]" if new else "[]"
    return raw[:location] + replacement + raw[location + length:]


def repair(path):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    groups = [
        group for section in data["exam_info"]["sections"]
        if section.get("section_type") == "listening_reading"
        for group in section.get("passages", [])
    ]
    if {group["id"] for group in groups} != set(PROMPTS):
        raise ValueError(f"Unexpected listening-reading groups in {path.name}")
    changes = 0
    for group in groups:
        group_id = group["id"]
        if group["passage"]["type"] != "image" or len(group["questions"]) != 1:
            raise ValueError(f"Unexpected source shape in group {group_id}")
        question = group["questions"][0]
        old_question = question["question"]
        new_question = PROMPTS[group_id]
        if old_question != new_question:
            if "番" not in old_question and "日本語一" not in old_question:
                raise ValueError(f"Unrecognized question text in group {group_id}")
            raw = replace_field(raw, "question", old_question, new_question)
            changes += 1
        if group_id in OPTIONS and question["options"] != OPTIONS[group_id]:
            raw = replace_options_after_question(raw, new_question, question["options"], OPTIONS[group_id])
            changes += 1
        old_hint = f"先查看 OCR 文本和题图中 {group_id}番 的问题"
        if old_hint in raw:
            raw = raw.replace(old_hint, f"先查看第{group_id}题的题干和原页图像")
            changes += 1
    if changes:
        json.loads(raw)
        path.write_text(raw, encoding="utf-8")
    return changes


if __name__ == "__main__":
    for filename in ("2024_01.json", "EJU_JAPANESE_DIAGNOSTIC_V1.json"):
        path = ROOT / filename
        if path.exists():
            print(filename, repair(path))
