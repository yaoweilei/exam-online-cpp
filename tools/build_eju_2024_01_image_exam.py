from __future__ import annotations

import json
import re
from pathlib import Path

import fitz
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PAPER_PDF = ROOT / "downloads" / "EJU日本语" / "2024" / "2024年6月EJU日語(1).pdf"
ANSWER_PDF = ROOT / "downloads" / "EJU日本语" / "2024" / "正解表R6.1(1)(1).pdf"
AUDIO_DIR = ROOT / "data" / "audio" / "eju" / "2024_01"
IMAGE_DIR = ROOT / "data" / "image" / "eju" / "2024_01"
OUT_PATH = ROOT / "data" / "paper" / "eju" / "2024_01.json"
OCR_DIR = ROOT / "tmp" / "pdfs" / "eju_2024_01_review" / "ocr_full"

IMAGE_BASE_URL = "/data/image/eju/2024_01"
AUDIO_BASE_URL = "/data/audio/eju/2024_01"

READING_ANSWERS = [1, 4, 3, 4, 3, 1, 1, 3, 2, 3, 2, 1, 1, 4, 2, 1, 3, 2, 4, 3, 2, 4, 1, 2, 4]
LISTENING_READING_ANSWERS = [3, 2, 1, 4, 3, 3, 4, 1, 2, None, 3, 2]
LISTENING_ANSWERS = [4, 1, 4, 3, 1, 3, 2, 3, 2, 1, 2, 3, 4, 2, 4]
MANUAL_READING_OPTIONS = {
    2: [
        "1. 駐車スペースに空きがある場合、自動車通学のための駐車許可証が発行される。",
        "2. 自転車は、駐輪場で空いている場所があれば、どこにでも駐輪することができる。",
        "3. 自転車通学者は、必ず自賠責保険と任意保険に加入しなければならない。",
        "4. 自転車・小型バイクのどちらも構内では降りて、押して移動しなければならない。",
    ],
}


def clean_ocr_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    replacements = {
        "日 本 語": "日本語",
        "以下 の こつ": "以下の二つ",
        "どちら か ーー つ": "どちらか一つ",
        "400 一 500": "400～500",
        "昼 で る も る 夜 で る": "昼でも夜でも",
        "ょ よい": "よい",
        "あり ます なか": "ありますか",
        "ミル クオ リ ゴ 精": "ミルクオリゴ糖",
        "ミル クオ リ ゴ 杯": "ミルクオリゴ糖",
        "ミル クオ リ ゴ 糖": "ミルクオリゴ糖",
        "ビフィズス 散": "ビフィズス菌",
        "ビフィズス 前": "ビフィズス菌",
        "善 玉 菌": "善玉菌",
        "悪 玉 菌": "悪玉菌",
        "細 黄": "細菌",
        "餅 に": "餌に",
        "ー ": "ー",
        " 一 ": "一",
        " ,": "、",
        ",": "、",
        " .": "。",
        " 。": "。",
        " か 。": "か。",
        " す 。": "す。",
        " ます 。": "ます。",
        " くだ さい": "ください",
        " いま す": "います",
        " で す": "です",
        " こと": "こと",
    }
    for before, after in replacements.items():
        text = text.replace(before, after)

    normalized_replacements = {
        "以下のこつ": "以下の二つ",
        "どちらかーーつ": "どちらか一つ",
        "400一500": "400～500",
        "昼でるもる夜でる": "昼でも夜でも",
        "ょよい": "よい",
        "ありますなか": "ありますか",
        "ミルクオリゴ精": "ミルクオリゴ糖",
        "ミルクオリゴ杯": "ミルクオリゴ糖",
        "ミルクオリゴ糖を餅": "ミルクオリゴ糖を餌",
        "ビフィズス散": "ビフィズス菌",
        "ビフィズス前": "ビフィズス菌",
        "凌玉菌": "善玉菌",
        "蓋玉菌": "善玉菌",
        "悪玉菌・": "悪玉菌：",
        "細黄": "細菌",
        "人聞": "人間",
        "観宗": "観察",
        "条定": "否定",
        "踏みのます": "踏みます",
        "無認性": "無謬性",
        "人頻": "人類",
        "るものだ": "ものだ",
        "栄養にみなりません": "栄養にはなりません",
        "すぎ <": "すぎて、",
        "ぎ <": "ぎて、",
        "すぎ < *": "すぎて、*",
        "するのでしょうなか": "するのでしょうか",
        "人上類": "人類",
        "ビフィズス上": "ビフィズス菌",
        "信にでき": "餌にでき",
        "ミルクオリゴ糖を信にでき": "ミルクオリゴ糖を餌にでき",
        "ビフィズス藤": "ビフィズス菌",
        "一短": "1歳",
        "ネ善玉菌": "** 善玉菌",
        "まま悪玉菌": "*** 悪玉菌",
        "* ** 善玉菌": "** 善玉菌",
        "に(略)は": "…(略)…",
        "病気やケガが等": "病気やケガ等",
        "放要": "必要",
        "画自転車": "自転車",
        "如入": "加入",
        "自賠次保険": "自賠責保険",
        "自賠商保険": "自賠責保険",
        "自賠資保険": "自賠責保険",
        "肖賠資保険": "自賠責保険",
        "ネネ任意保険": "** 任意保険",
        "肖勤車": "自動車",
        "刀車許可年": "駐車許可証",
        "発行きれる": "発行される",
        "宅いている": "空いている",
        "氷輪": "駐輪",
        "どちら$%$": "どちらも",
        "希内": "構内",
        "しなをければぼばならない": "しなければならない",
        "かならない": "ならない",
        "相筆者": "筆者",
        "幼林園保育園": "幼稚園・保育園",
        "でお8おこなわれている": "でおこなわれている",
        "という$の": "というもの",
        "みたいなるもの": "みたいなもの",
        "ひとる$も": "ひとも",
        "ひとる$る一緒": "ひとも一緒",
        "ばらばらで$": "ばらばらで",
        "おもるしろい": "おもしろい",
        "ひとりでるもる": "ひとりでも",
        "大きなるの": "大きなもの",
        "もるって": "もって",
        "こども$": "こども",
        "ボトチる": "* トチる",
        "楽しなこと": "楽しむこと",
        "活性化さきせる": "活性化させる",
        "や。民": "や住民",
        "るるもそるも$も": "そもそも",
        "そこでぽくたちは": "そこでぼくたちは",
        "ゴリラざや": "ゴリラや",
        "ことにるもなる": "ことにもなる",
        "作成もをなるべく": "作成もなるべく",
        "人ヶ々": "人々",
        "政治哲学学者でるある": "政治哲学者でもある",
        "によって和到": "によって到",
        "言えをば": "言えば",
        "かるしれない": "かもしれない",
        "挑むとしとき": "挑むとき",
        "でのるもるので": "でのもので",
        "戦っていぃ": "戦ってい",
        "というるもの": "というもの",
        "橋木俊認": "橋本健二",
        "\\き修正": "され、修正",
        "大潤も": "大部分も",
        "こともゃできる": "こともできる",
        "維田謙一": "篠田謙一",
        "筆者は。": "筆者は、",
        "和失敗": "「失敗",
        "言業": "言葉",
        "料会評論家": "社会評論家",
        "東大受取": "東大受験",
        "むさぼぽぼり": "むさぼり",
        "むさぼぽり": "むさぼり",
        "あたかもる人生": "あたかも人生",
        "玲にでも": "誰にでも",
        "失敗だがだ": "失敗だ",
        "何にるならない": "何にもならない",
        "いくるもるのだ": "いくものだ",
        "和勧め": "勧め",
        "和休愛い": "かわいい",
        "曽白い": "面白い",
        "いうまでもるない": "いうまでもない",
        "さらいに": "さらに",
        "じどうなのか": "どうなのか",
        "ウーつ": "一つ",
        "一和枚": "一枚",
        "攻出": "9",
        "間題": "問題",
        "寺師": "教師",
        "孝師": "教師",
        "話症": "話題",
        "し。8きまざまな": "し、さまざまな",
        "学生る、": "学生も、",
        "ゃもっぱら": "もっぱら",
        "あってるもる": "あっても",
        "くだきい": "ください",
        "たとえぇロロに出して言わなをくてるも": "たとえ口に出して言わなくても",
        "傾細": "些細",
        "中う考え": "違う考え",
        "積板的": "積極的",
        "探未": "探求",
        "かカワゲラ": "カワゲラ",
        "水生伺虫": "水生昆虫",
        "水生兄虫": "水生昆虫",
        "餅感": "敏感",
        "いて$も": "いても",
        "いても$和上": "いても",
        "川放": "川底",
        "人委腐": "貧腐",
        "アカムシュユスリカ": "アカムシユスリカ",
        "できるのるゃる優れた点": "できるのも優れた点",
        "絶滅危恨の貝事典": "絶滅危惧の昆虫事典",
        "調べればぱ": "調べれば",
        "人違いない": "に違いない",
        "記ましい": "望ましい",
        "利用&される": "利用される",
        "人因果関係": "因果関係",
        "記憶るれる": "記憶される",
        "確かるは": "確かさは",
        "なかでるも": "なかでも",
        "記憶るされていく〈く": "記憶されていく",
        "もゃの": "もの",
        "どれですなか": "どれですか",
        "子どるも": "子ども",
        "とて効果的": "とても効果的",
        "るしほめら": "もしほめら",
        "あるなから": "あるから",
        "8もたらす": "もたらす",
        "生動原理": "行動原理",
        "XII[": "XIII",
        "裾美": "奄美",
        "状殖": "養殖",
        "城殖": "養殖",
        "養多": "養殖",
        "少なくとるもる": "少なくとも",
        "20一30cm": "20～30cm",
        "厚&": "厚さ",
        "送ってる一向": "送っても一向",
        "色るゃもぼんやり": "色もぼんやり",
        "半しく鮮やか": "美しく鮮やか",
        "棲島": "棲息",
        "カニもるもすごい": "カニもすごい",
        "議美": "奄美",
        "紛ってしまった": "弱ってしまった",
        "隊上": "陸上",
        "少なくとる": "少なくとも",
        "たとえばぱ": "たとえば",
        "道牧": "道徳",
        "あたかぁ": "あたかも",
        "利己主義者の虐": "利己主義者の蟻",
        "同じしく": "同じく",
        "集団の絞": "集団の絆",
        "座護": "喧嘩",
        "交かしい": "おかしい",
        "准椎動物": "脊椎動物",
        "したのも$る": "したのも、",
        "おいたのるゃる同じ": "おいたのも同じ",
        "どうにる$もるならない": "どうにもならない",
        "作ったるのは": "作ったのは",
        "維持する携": "維持する掟",
        "央と首": "蟻と猿",
        "蘭も猿": "蟻も猿",
        "争わない識": "争わない蟻",
        "剛の集団": "蟻の集団",
        "導は喧嘩": "猿は喧嘩",
        "が上は道徳": "が蟻は道徳",
        "についてとど": "についてど",
        "というるの": "というもの",
        "御ずと": "おのずと",
        "かぁゃ$気": "かも気",
        "しておきたいるもの": "しておきたいもの",
        "あぁります": "あります",
        "ょよく": "よく",
        "ですかがか": "ですか",
        "述べたもるの": "述べたもの",
        "混棒": "泥棒",
        "泥欄": "泥棒",
        "*“*すべ": "** すべ",
        "はやにえを和守れて": "はやにえを守れて",
        "氏殖期": "繁殖期",
        "隠8ずに": "隠さずに",
        "あくまでるも": "あくまでも",
        "次み食い": "盗み食い",
        "物かげに了": "物かげに隠",
        "はやにを": "はやにえ",
        "朋蔵": "貯蔵",
        "草かひから": "草かげ",
        "隊的な場所": "閉鎖的な場所",
        "落研樹": "落葉樹",
        "られだた": "られた",
        "ますべ": "すべ",
        "ネなわばり": "** なわばり",
        "入るるもの": "入るもの",
        "適当なるもの": "適当なもの",
        "どちら $%$": "どちらも",
        "という $ の": "というもの",
        "ひとる $ も": "ひとも",
        "ひとる $ る一緒": "ひとも一緒",
        "ばらばらで $": "ばらばらで",
        "こども $": "こども",
        "るるもそるも $ も": "そもそも",
        "そこでぽ": "そこでぼ",
        "とえぇロロに": "たとえ口に",
        "言わなをくてるも": "言わなくても",
        "いて $ も": "いても",
        "いても $ 和上": "いても",
        "%) 強腐水性": "(4) 強腐水性",
        "なかでも $": "なかでも",
        "どるも": "ども",
        "したのも $ る": "したのも、",
        "どうにる $ もるならない": "どうにもならない",
        "かぁゃ $ 気": "かも気",
        "あぁ": "あ",
        "でお 8 おこなわれている": "でおこなわれている",
        "たいなるもの": "たいなもの",
        "や。 民": "や住民",
        "\\ き修正": "され、修正",
        "「「失敗": "「失敗",
        "何にる": "何にも",
        "症を提供": "題を提供",
        "し。 8 きまざまな": "し、さまざまな",
        "孝": "教",
        "\" 弱腐水性": "(2) 弱腐水性",
        "3 中腐水性": "(3) 中腐水性",
        "ためにに違いない": "ために違いない",
        "ほならない": "ほかならない",
        "利用 & される": "利用される",
        "また。、": "また、",
        "いっぱぽう": "いっぽう",
        "あるから.": "あるから、",
        "8 もたらす": "もたらす",
        "1. 、": "1.",
        "現在 “クルマエビ": "現在、* クルマエビ",
        "厚 &": "厚さ",
        "ほんやり": "ぼんやり",
        "適当なぁもの": "適当なもの",
        "たとえば、 の集団": "たとえば、蟻の集団",
        "というようなるの": "というようなもの",
        "にしたのも、、": "にしたのも、",
        "*“* すべ": "** すべ",
        "隠 8 ずに": "隠さずに",
        "農作用": "農作業用",
        "わかりました。。": "わかりました。",
        "はやにええ": "はやにえ",
        "** ** なわばり": "*** なわばり",
        "玉 ※※ ネ交尾": "**** 交尾",
        "自体が もたらす": "自体がもたらす",
        "厚さ に": "厚さに",
        "カニもすごい}": "カニもすごい』",
        "「失敗はただ": "失敗はただ",
        "1 太陽": "1. 太陽",
        "4 高い": "4. 高い",
        "3。": "3.",
        "1。": "1.",
        "『15 歳の寺子屋ゴリラは語る」": "『15歳の寺子屋 ゴリラは語る』",
        "『人類の起源」": "『人類の起源』",
        "「大学はどこまで 「公平」 であるべきか一発試験依存の罪」": "『大学はどこまで「公平」であるべきか 一発試験依存の罪』",
        "「親のための新しい音楽の教科書」": "『親のための新しい音楽の教科書』",
        "「高校から大学へ」": "『高校から大学へ』",
        "[3」": "[3]",
        "[5s」]": "[5]",
        "[Le」": "[6]",
        "[15」": "[15]",
        "| 16 |": "[16]",
        "[12 |": "[12]",
        "| 4": "[4]",
    }
    lines: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"[ \t　]+", " ", raw).strip()
        if not line:
            continue
        previous = None
        while previous != line:
            previous = line
            line = re.sub(r"(?<=[\u3040-\u30ff\u3400-\u9fff々ー]) (?=[\u3040-\u30ff\u3400-\u9fff々ー])", "", line)
        line = re.sub(r"\s+([。、．，）」』])", r"\1", line)
        line = re.sub(r"([「『（(])\s+", r"\1", line)
        line = re.sub(r"^([1-4])\s*[.．、・]\s*", r"\1. ", line)
        for before, after in normalized_replacements.items():
            line = line.replace(before, after)
        lines.append(line)
    result = "\n".join(lines)
    cross_line_replacements = {
        "話\n題": "話題",
        "た\nたとえ": "たとえ",
        "城\n殖": "養殖",
        "20 一\n30cm": "20～30cm",
        "半\nしく": "美しく",
        "アカム\nシュユスリカ": "アカムシユスリカ",
        "記憶るされていく 〈 く": "記憶されていく",
        "隊\n的な場所": "閉鎖的な場所",
        "適当な\nのは": "適当なものは",
        "適当なる\nのは": "適当なものは",
        "\n* すべ :": "\n** すべ :",
        "日本語一14\nVI 筆者": "日本語一14\nVII 筆者",
        "\nあり\n": "\n",
    }
    for before, after in cross_line_replacements.items():
        result = result.replace(before, after)
    return result


def read_ocr_page(page_no: int) -> str:
    path = OCR_DIR / f"page_{page_no:02d}.txt"
    if not path.exists():
        return ""
    return clean_ocr_text(path.read_text(encoding="utf-8"))


def read_ocr_pages(page_numbers: list[int]) -> str:
    return "\n\n".join(read_ocr_page(page_no) for page_no in page_numbers if read_ocr_page(page_no)).strip()


def extract_options(text: str) -> list[str]:
    options: list[str] = []
    current: str | None = None
    for line in text.splitlines():
        match = re.match(r"^([1-4])\s*[.．、・。]?\s+(.+)", line)
        if match:
            if current:
                options.append(current.strip())
            current = f"{match.group(1)}. {match.group(2).strip()}"
            continue
        if current and not re.match(r"^(日本語|ー|問\s*\d|[IVX]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)", line):
            current += line.strip()
    if current:
        options.append(current.strip())
    return options[:4] if len(options) >= 4 else ["1", "2", "3", "4"]


def extract_options_after_answer_marker(text: str, answer_no: int) -> list[str]:
    if answer_no in MANUAL_READING_OPTIONS:
        return MANUAL_READING_OPTIONS[answer_no]
    markers = [
        rf"\[\s*{answer_no}\s*\]",
        rf"\|\s*{answer_no}\s*\|",
        rf"解答番号\s*{answer_no}",
        rf"\s{answer_no}\s*$",
    ]
    sliced = text
    for pattern in markers:
        match = re.search(pattern, text, flags=re.MULTILINE)
        if match:
            sliced = text[match.end():]
            break
    return extract_options(sliced)


def trim_for_explanation(value: str, limit: int = 80) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "..."


def render_page(pdf: Path, page_no: int, out_name: str, zoom: float = 2.0) -> str:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = IMAGE_DIR / out_name
    if not out_path.exists() or out_path.stat().st_size == 0:
        with fitz.open(pdf) as doc:
            pix = doc[page_no - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            pix.save(out_path)
    return f"{IMAGE_BASE_URL}/{out_name}"


def render_page_image(pdf: Path, page_no: int, zoom: float = 2.0) -> Image.Image:
    with fitz.open(pdf) as doc:
        pix = doc[page_no - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def render_page_group(pdf: Path, page_numbers: list[int], out_name: str, zoom: float = 2.0) -> str:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = IMAGE_DIR / out_name
    if not out_path.exists() or out_path.stat().st_size == 0:
        images = [render_page_image(pdf, page_no, zoom=zoom) for page_no in page_numbers]
        width = max(image.width for image in images)
        height = sum(image.height for image in images)
        canvas = Image.new("RGB", (width, height), "white")
        y = 0
        for image in images:
            x = (width - image.width) // 2
            canvas.paste(image, (x, y))
            y += image.height
        canvas.save(out_path, quality=90)
    return f"{IMAGE_BASE_URL}/{out_name}"


def answer_payload(value: int | None, answer_no: int) -> dict[str, object]:
    if value is None:
        return {
            "has_ans": False,
            "explanation": "【答案解析】\n官方正解表没有刊载本题正解。本题在试卷中成立，但公开版材料和正解表都注明受出版原因限制，不能给出常规答案解析。",
            "explanation_expand": "【补充解析】\n遇到这种未刊载题，不建议纳入错题统计，也不要根据上下题或选项规律猜答案。自学时可以直接跳过，重点练习材料完整、答案可核对的题目。",
        }
    correct_label = str(value)
    return {
        "correct_answer": value,
        "answer": correct_label,
        "has_ans": True,
        "explanation": f"【答案解析】\n本题正确答案是第{value}项。该答案依据 2024 年度第 1 回 EJU 日本语官方正解表的解答番号{answer_no}录入。\n\n【作答思路】\n先在题目材料中定位解答番号{answer_no}对应的问题，再把选项与材料中的关键词、转折、因果关系或图表信息逐项核对。",
        "explanation_expand": "【补充解析】\n这份数据为 OCR 文本版，扫描页中仍可能保留少量识别误差；遇到专有名词、图表或符号时，请同时参考题目页图像。EJU 选择题不要只看选项表面相似度，要确认选项是否完整、是否多加了原文没有的信息、是否把转折前后的观点混在一起。",
    }


def answer_payload_with_context(value: int | None, answer_no: int, options: list[str], mode: str) -> dict[str, object]:
    payload = answer_payload(value, answer_no)
    if value is None:
        return payload
    correct_option = options[value - 1] if 0 < value <= len(options) and options[value - 1] not in {"1", "2", "3", "4"} else f"第{value}项"
    if mode == "reading":
        has_option_text = correct_option != f"第{value}项"
        option_sentence = (
            f"第{value}项「{trim_for_explanation(correct_option)}」与材料内容一致。"
            if has_option_text
            else f"官方正解表给出的正确答案是第{value}项。"
        )
        payload["explanation"] = (
            f"【题目解析】\n本题正确答案是第{value}项。{option_sentence}\n\n"
            f"【定位方法】\n请先看 OCR 文本中解答番号{answer_no}附近的问题和选项，再回到前文确认对应的理由、条件或对比关系。读解题的错误选项常见问题是扩大范围、偷换对象、把作者否定的观点当作结论，或加入原文没有的推论。"
        )
        payload["explanation_expand"] = (
            "【补充解析】\n这道题已按官方正解表录入答案。由于 2024_01 原始 PDF 是扫描件，本文字段来自 OCR；如果发现个别字形识别不准，以同题页图像为准。\n\n"
            "【拿分提醒】\n阅读题建议按三步复盘：第一，找题干问的是内容一致、理由、指示词还是空格补充；第二，圈出选项里的判断对象；第三，回到材料中确认该判断是否被原文直接支持。"
        )
    elif mode == "listening_reading":
        payload["explanation"] = (
            f"【题目解析】\n本题正确答案是第{value}项。读听解需要同时使用页面上的图表/文字和音频信息，不能只看图，也不能只凭听到的单个词判断。\n\n"
            f"【作答思路】\n先查看 OCR 文本和题图中 {answer_no}番 的问题，再听对应音频，记录音频最后的问题、条件或比较对象。官方正解表给出的答案是第{value}项。"
        )
        payload["explanation_expand"] = (
            "【补充解析】\n当前本地资料没有完整听力原文，因此解析不编造音频细节。复习时建议打开题图和音频，按“图表轴/项目 -> 音频条件 -> 选项”的顺序核对。\n\n"
            "【拿分提醒】\n读听解的陷阱通常在图表分类、数值比较、方向变化和最后一句提问。听前先看图，听中只记录会改变答案的条件。"
        )
    else:
        payload["explanation"] = (
            f"【题目解析】\n本题正确答案是第{value}项。该题为纯听解题，题干和选项主要通过音频给出。\n\n"
            f"【作答思路】\n听第一遍抓场景和问题目标，听第二遍核对人物态度、理由、顺序或数值。官方正解表对应解答番号{answer_no}的答案是第{value}项。"
        )
        payload["explanation_expand"] = (
            "【补充解析】\n当前本地资料没有完整听力原文，所以这里不编造具体台词。自学时请配合音频复听，把正确选项对应的关键词或转折句补记到个人笔记中。\n\n"
            "【拿分提醒】\n听解题要特别注意最后的问题。如果前半段出现多个数字、地点或方案，最终答案通常由最后的限制条件决定。"
        )
    return payload


def build_writing_section() -> dict:
    prompt = read_ocr_pages([4])
    return {
        "section_id": "1",
        "section_title": "記述問題",
        "section_name": "記述",
        "section_type": "writing",
        "description": "二つのテーマから一つを選び、400字から500字で書く問題。",
        "passages": [
            {
                "id": 1,
                "topic": "記述問題",
                "passage": {
                    "type": "text",
                    "title": "記述問題",
                    "value": prompt,
                },
                "questions": [
                    {
                        "id": 0,
                        "question": prompt,
                        "options": [],
                        "has_ans": False,
                        "source_pages": [3, 4, 5],
                        "skill_tags": ["eju.writing"],
                    }
                ],
            }
        ],
        "skill_tags": ["eju.writing"],
    }


def build_reading_section() -> dict:
    groups = [
        (1, [7], [1]),
        (2, [8, 9], [2]),
        (3, [10], [3]),
        (4, [11], [4]),
        (5, [12], [5]),
        (6, [13], [6]),
        (7, [14], [7]),
        (8, [15], [8]),
        (9, [16], [9]),
        (10, [17], [10]),
        (11, [18, 19], [11, 12]),
        (12, [20, 21], [13, 14]),
        (13, [22, 23], [15, 16]),
        (14, [24, 25], [17, 18]),
        (15, [26, 27], [19, 20]),
        (16, [28, 29], [21, 22]),
        (17, [30, 31], [23, 24, 25]),
    ]
    passages = []
    for group_id, page_numbers, answer_numbers in groups:
        ocr_text = read_ocr_pages(page_numbers)
        suffix = "_".join(f"{page_no:02d}" for page_no in page_numbers)
        url = render_page_group(PAPER_PDF, page_numbers, f"reading_group_{group_id:02d}_p{suffix}.jpg", zoom=1.7)
        use_image_passage = group_id == 15
        passages.append(
            {
                "id": group_id,
                "topic": f"読解 {group_id}",
                "passage": {
                    "type": "image" if use_image_passage else "text",
                    **(
                        {
                            "url": url,
                            "alt_text": f"2024_01 読解 group {group_id} pages {','.join(map(str, page_numbers))}",
                        }
                        if use_image_passage
                        else {
                            "title": f"読解 {group_id}",
                            "value": ocr_text,
                        }
                    ),
                },
                "questions": [
                    {
                        "id": answer_no,
                        "eju_answer_no": answer_no,
                        "question": (
                            f"OCR本文を読んで、解答番号{answer_no}の問いに答えてください。"
                            if not use_image_passage
                            else ocr_text
                        ),
                        "options": extract_options_after_answer_marker(ocr_text, answer_no),
                        "source_pages": page_numbers,
                        "skill_tags": ["eju.reading"],
                        **answer_payload_with_context(
                            READING_ANSWERS[answer_no - 1],
                            answer_no,
                            extract_options_after_answer_marker(ocr_text, answer_no),
                            "reading",
                        ),
                    }
                    for answer_no in answer_numbers
                ],
            }
        )
    return {
        "section_id": "2",
        "section_title": "読解問題",
        "section_name": "読解",
        "section_type": "reading",
        "description": "問題冊子に書かれている文章を読んで答える問題。2024_01はスキャン画像を正本として収録。",
        "passages": passages,
        "skill_tags": ["eju.reading"],
    }


def build_listening_reading_section() -> dict:
    passages = []
    for question_no, answer in enumerate(LISTENING_READING_ANSWERS, start=1):
        page_no = 35 + question_no
        url = render_page(PAPER_PDF, page_no, f"listening_reading_q{question_no:02d}_p{page_no:02d}.jpg")
        ocr_text = read_ocr_page(page_no)
        options = extract_options(ocr_text)
        audio_track = question_no + 5
        answer_no = question_no
        passages.append(
            {
                "id": question_no,
                "topic": f"{question_no}番",
                "passage": {
                    "type": "image",
                    "url": url,
                    "alt_text": f"2024_01 読聴解 {question_no}番 page {page_no}",
                },
                "audio": f"{AUDIO_BASE_URL}/track_{audio_track:02d}.mp3",
                "script": [
                    {
                        "speaker": "system",
                        "text": "音声原文は未収録です。公開音源を参照してください。",
                    }
                ],
                "questions": [
                    {
                        "id": 25 + question_no,
                        "eju_question_no": question_no,
                        "eju_answer_no": answer_no,
                        "question": ocr_text or f"画像と音声をもとに答えてください。（読聴解{question_no}番）",
                        "options": options,
                        "audio": f"{AUDIO_BASE_URL}/track_{audio_track:02d}.mp3",
                        "script": [
                            {
                                "speaker": "system",
                                "text": "音声原文は未収録です。公開音源を参照してください。",
                            }
                        ],
                        "source_page": page_no,
                        "skill_tags": ["eju.listening_reading"],
                        **answer_payload_with_context(answer, answer_no, options, "listening_reading"),
                    }
                ],
            }
        )
    return {
        "section_id": "3",
        "section_title": "読聴解問題",
        "section_name": "読聴解",
        "section_type": "listening_reading",
        "description": "問題用紙の文字・図表を見ながら音声を聞いて答える問題。音声原文は未収録。",
        "passages": passages,
        "skill_tags": ["eju.listening_reading"],
    }


def build_listening_section() -> dict:
    questions = []
    for offset, answer in enumerate(LISTENING_ANSWERS):
        eju_no = 13 + offset
        answer_no = eju_no
        audio_track = eju_no + 9
        questions.append(
            {
                "id": 38 + offset,
                "eju_question_no": eju_no,
                "eju_answer_no": answer_no,
                "question": f"音声を聞いて答えてください。（聴解{eju_no}番）",
                "options": ["1", "2", "3", "4"],
                "audio": f"{AUDIO_BASE_URL}/track_{audio_track:02d}.mp3",
                "script": [
                    {
                        "speaker": "system",
                        "text": "音声原文は未収録です。公開音源を参照してください。",
                    }
                ],
                "skill_tags": ["eju.listening"],
                **answer_payload_with_context(answer, answer_no, ["1", "2", "3", "4"], "listening"),
            }
        )
    return {
        "section_id": "4",
        "section_title": "聴解問題",
        "section_name": "聴解",
        "section_type": "listening",
        "description": "問題も選択肢もすべて音声で示される問題。音声原文は未収録。",
        "questions": questions,
        "passages": [],
        "skill_tags": ["eju.listening"],
    }


def build_payload() -> dict:
    sections = [
        build_writing_section(),
        build_reading_section(),
        build_listening_reading_section(),
        build_listening_section(),
    ]
    return {
        "family": "eju",
        "subject": "japanese",
        "paper_type": "complete",
        "level": "",
        "year": "2024",
        "session": "01",
        "display": "2024_01",
        "checked": False,
        "access_level": "free",
        "capabilities": {
            "audio": True,
            "image": True,
            "ruby": False,
            "translation": False,
        },
        "source_files": {
            "paper_pdf": str(PAPER_PDF.relative_to(ROOT)),
            "answer_pdf": str(ANSWER_PDF.relative_to(ROOT)),
            "audio_dir": str(AUDIO_DIR.relative_to(ROOT)),
        },
        "generation_warnings": [
            "OCR text import: scanned booklet pages were OCRed; diagram-heavy items retain page images.",
            "Listening transcripts are not available in local sources; script fields contain explicit placeholders.",
            "The official answer sheet does not publish the answer for listening-reading question 10.",
        ],
        "exam_info": {
            "title": "EJU-Japanese-2024_01",
            "exam_date": "2024/01",
            "exam_level": "",
            "exam_id": "2024_01",
            "family": "eju",
            "subject": "japanese",
            "paper_type": "complete",
            "year": "2024",
            "session": "01",
            "sections": sections,
        },
    }


def main() -> None:
    if not PAPER_PDF.exists():
        raise FileNotFoundError(PAPER_PDF)
    if not ANSWER_PDF.exists():
        raise FileNotFoundError(ANSWER_PDF)
    if not AUDIO_DIR.exists():
        raise FileNotFoundError(AUDIO_DIR)
    payload = build_payload()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUT_PATH)


if __name__ == "__main__":
    main()
