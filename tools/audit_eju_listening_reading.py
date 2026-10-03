"""Check every local EJU listening-reading paper and its media references."""

import hashlib
import json
import subprocess
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAPERS = DATA / "paper" / "eju"


def asset_path(url: str, category: str) -> Path | None:
    prefix = f"/data/{category}/eju/"
    if not url.startswith(prefix) or ".." in url or "\\" in url:
        return None
    return DATA / url.removeprefix("/data/")


def audio_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def main() -> int:
    errors: list[str] = []
    answerable_audio: dict[str, list[str]] = defaultdict(list)
    paper_count = question_count = image_count = audio_count = 0

    for paper in sorted(PAPERS.glob("20??_??.json")):
        data = json.loads(paper.read_text(encoding="utf-8"))
        sections = data["exam_info"]["sections"]
        listening_reading = [section for section in sections if section.get("section_type") == "listening_reading"]
        if len(listening_reading) != 1:
            errors.append(f"{paper.stem}: expected one listening-reading section")
            continue
        paper_count += 1
        groups = listening_reading[0].get("passages", [])
        if len(groups) != 12:
            errors.append(f"{paper.stem}: expected 12 listening-reading questions, got {len(groups)}")
        seen_audio: set[str] = set()

        for number, group in enumerate(groups, 1):
            label = f"{paper.stem} Q{number}"
            questions = group.get("questions", [])
            if group.get("id") != number or len(questions) != 1:
                errors.append(f"{label}: group number or question count is wrong")
                continue
            question = questions[0]
            question_count += 1
            prompt = question.get("question", "")
            if not 10 <= len(prompt) <= 250 or "\n" in prompt or "日本語一" in prompt:
                errors.append(f"{label}: prompt looks like missing text or page OCR")
            options = question.get("options", [])
            answer = question.get("answer")
            correct = question.get("correct_answer")
            if question.get("has_ans"):
                if len(options) != 4 or str(answer) != str(correct) or str(correct) not in {"1", "2", "3", "4"}:
                    errors.append(f"{label}: answer and four choices do not agree")
            elif options or answer is not None or correct is not None:
                errors.append(f"{label}: unavailable question still has choices or an answer")

            image_url = group.get("passage", {}).get("url", "")
            image_path = asset_path(image_url, "image")
            if image_path is None or not image_path.is_file():
                errors.append(f"{label}: missing image {image_url}")
            else:
                try:
                    with Image.open(image_path) as image:
                        image.verify()
                    image_count += 1
                except Exception as exc:
                    errors.append(f"{label}: invalid image {image_url}: {exc}")

            audio_url = question.get("audio", "")
            audio_path = asset_path(audio_url, "audio")
            if audio_path is None or not audio_path.is_file() or audio_path.stat().st_size < 1000:
                errors.append(f"{label}: missing audio {audio_url}")
            else:
                audio_count += 1
                if audio_url in seen_audio:
                    errors.append(f"{label}: audio is reused within the paper")
                seen_audio.add(audio_url)
                if question.get("has_ans"):
                    digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()
                    answerable_audio[digest].append(label)
                    try:
                        duration = audio_duration(audio_path)
                        if duration < 20:
                            errors.append(f"{label}: answerable audio is only {duration:.1f} seconds")
                    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
                        errors.append(f"{label}: cannot read audio duration: {exc}")

        listening = [section for section in sections if section.get("section_type") == "listening"]
        if len(listening) == 1:
            urls = [question.get("audio") for question in listening[0].get("questions", [])]
            if len(urls) != len(set(urls)):
                errors.append(f"{paper.stem}: listening questions reuse the same audio")

    for labels in answerable_audio.values():
        if len(labels) > 1:
            errors.append(f"same audio used by different answerable questions: {', '.join(labels)}")

    print(f"Audited {paper_count} papers, {question_count} listening-reading questions, "
          f"{image_count} images, {audio_count} audio files; {len(errors)} errors")
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
