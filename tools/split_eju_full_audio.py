from __future__ import annotations

import argparse
import contextlib
import difflib
import io
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import whisper


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"

STRIP_STAGE_RE = re.compile(r"\([^)]*\)|（[^）]*）")
NORMALIZE_RE = re.compile(r"[\s\u3000,，.．。、「」『』【】\[\]\(\)（）?？!！:：;；・…\-ー]")


@dataclass
class TimedChar:
    ch: str
    start: float
    end: float


def normalize_text(text: str) -> str:
    stripped = STRIP_STAGE_RE.sub("", text)
    return NORMALIZE_RE.sub("", stripped)


def build_timed_chars(transcript_result: dict[str, Any]) -> list[TimedChar]:
    chars: list[TimedChar] = []
    for segment in transcript_result.get("segments", []):
        for word in segment.get("words", []):
            word_text = normalize_text(str(word.get("word", "")))
            if not word_text:
                continue
            start = float(word.get("start", 0.0))
            end = float(word.get("end", start))
            duration = max(end - start, 0.01)
            step = duration / max(len(word_text), 1)
            for index, ch in enumerate(word_text):
                chars.append(
                    TimedChar(
                        ch=ch,
                        start=start + index * step,
                        end=start + (index + 1) * step,
                    )
                )
    return chars


def iter_audio_questions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for section in payload.get("exam_info", {}).get("sections", []):
        if section.get("section_type") == "listening_reading":
            for passage in section.get("passages", []):
                questions.extend(passage.get("questions", []))
        elif section.get("section_type") == "listening":
            questions.extend(section.get("questions", []))
    return [question for question in questions if question.get("script")]


def question_track_index(question: dict[str, Any]) -> int:
    number = int(question.get("eju_question_no") or question.get("eju_answer_no") or 0)
    if 1 <= number <= 12:
        return number + 5
    if 13 <= number <= 27:
        return number + 9
    raise ValueError(f"Unsupported question number for track mapping: {number}")


def extract_session_audio(source_dir: Path, session: str) -> Path:
    files = [p for p in source_dir.iterdir() if p.is_file() and p.suffix.lower() in {".mp3", ".wav", ".wma", ".m4a"}]
    if not files:
        raise FileNotFoundError(f"No audio files in {source_dir}")
    markers = [f"第{int(session)}回", f"{int(session)}回", "第一回" if session == "01" else "第二回"]
    matched = [path for path in files if any(marker in path.name for marker in markers)]
    return matched[0] if matched else files[0]


def align_question_spans(questions: list[dict[str, Any]], timed_chars: list[TimedChar]) -> list[tuple[dict[str, Any], float, float]]:
    normalized_chunks: list[tuple[dict[str, Any], str]] = []
    for question in questions:
        chunk = " ".join(str(row.get("text", "")).strip() for row in question.get("script", []) if str(row.get("text", "")).strip())
        normalized = normalize_text(chunk)
        if normalized:
            normalized_chunks.append((question, normalized))

    script_concat = "".join(normalized for _, normalized in normalized_chunks)
    recognized_concat = "".join(item.ch for item in timed_chars)
    matcher = difflib.SequenceMatcher(None, script_concat, recognized_concat, autojunk=False)
    opcodes = matcher.get_opcodes()

    spans: list[tuple[dict[str, Any], int, int]] = []
    cursor = 0
    for question, normalized in normalized_chunks:
        next_cursor = cursor + len(normalized)
        spans.append((question, cursor, next_cursor))
        cursor = next_cursor

    results: list[tuple[dict[str, Any], float, float]] = []
    previous_end = 0.0
    for question, start_idx, end_idx in spans:
        matched_positions: list[int] = []
        for tag, i1, i2, j1, j2 in opcodes:
            if tag != "equal":
                continue
            overlap_start = max(start_idx, i1)
            overlap_end = min(end_idx, i2)
            if overlap_start >= overlap_end:
                continue
            for pos in range(overlap_start, overlap_end):
                matched_positions.append(j1 + (pos - i1))
        if matched_positions:
            start = timed_chars[matched_positions[0]].start
            end = timed_chars[matched_positions[-1]].end
        else:
            start = previous_end
            end = previous_end + 1.0
        start = max(start - 0.2, 0.0)
        end = max(end + 0.35, start + 0.5)
        previous_end = end
        results.append((question, start, end))
    return results


def export_track(source_audio: Path, destination: Path, start: float, end: float) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(source_audio),
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(destination),
        ],
        check=True,
    )


def split_exam_audio(exam_id: str, model_name: str) -> None:
    json_path = EJU_DIR / f"{exam_id}.json"
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    source_dir = ROOT / Path(payload["source_files"]["audio_dir"])
    session = str(payload["exam_info"]["session"])
    source_audio = extract_session_audio(source_dir, session)

    model = whisper.load_model(model_name)
    silent = io.StringIO()
    with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
        result = model.transcribe(str(source_audio), language="ja", word_timestamps=True, fp16=False, verbose=False)
    timed_chars = build_timed_chars(result)
    questions = iter_audio_questions(payload)
    spans = align_question_spans(questions, timed_chars)

    out_dir = ROOT / "data" / "audio" / "eju" / exam_id
    for question, start, end in spans:
        track_no = question_track_index(question)
        destination = out_dir / f"track_{track_no:02d}.mp3"
        export_track(source_audio, destination, start, end)
        question["audio"] = f"/data/audio/eju/{exam_id}/track_{track_no:02d}.mp3"
        print(f"{exam_id} q{question.get('eju_question_no')} -> track_{track_no:02d} [{start:.2f}, {end:.2f}]")

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Split EJU full-session audio into per-question tracks.")
    parser.add_argument("--exam-id", nargs="+", required=True)
    parser.add_argument("--model", default="base")
    args = parser.parse_args()
    for exam_id in args.exam_id:
        split_exam_audio(exam_id, args.model)


if __name__ == "__main__":
    main()
