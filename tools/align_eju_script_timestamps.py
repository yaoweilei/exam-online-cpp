from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import difflib
import whisper


ROOT = Path(__file__).resolve().parents[1]
EJU_DIR = ROOT / "data" / "paper" / "eju"

SPEAKER_RE = re.compile(r"^(?P<speaker>[^：:]{1,20})[：:]\s*(?P<body>.*)$")
SENTENCE_SPLIT_RE = re.compile(r".+?[。！？?!](?:」)?|.+$", re.DOTALL)
STRIP_STAGE_RE = re.compile(r"\([^)]*\)|（[^）]*）")
NORMALIZE_RE = re.compile(r"[\s\u3000,，.．。、「」『』【】\[\]\(\)（）?？!！:：;；・…\-ー]")


@dataclass
class ScriptUnit:
    speaker: str | None
    text: str
    normalized: str


@dataclass
class TimedChar:
    ch: str
    start: float
    end: float


def normalize_text(text: str) -> str:
    stripped = STRIP_STAGE_RE.sub("", text)
    return NORMALIZE_RE.sub("", stripped)


def split_script_into_units(script: list[dict[str, Any]]) -> list[ScriptUnit]:
    units: list[ScriptUnit] = []
    for row in script:
        raw_text = str(row.get("text", "")).strip()
        if not raw_text:
            continue

        speaker = str(row.get("speaker", "")).strip() or None
        body = raw_text
        speaker_match = SPEAKER_RE.match(raw_text)
        if speaker_match:
            speaker = speaker or speaker_match.group("speaker").strip()
            body = speaker_match.group("body").strip()

        for piece in SENTENCE_SPLIT_RE.findall(body):
            sentence = piece.strip()
            if not sentence:
                continue
            normalized = normalize_text(sentence)
            if not normalized:
                continue
            units.append(ScriptUnit(speaker=speaker, text=sentence, normalized=normalized))
    return units


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


def format_time(seconds: float) -> str:
    whole_minutes = int(seconds // 60)
    remainder = max(seconds - whole_minutes * 60, 0.0)
    return f"{whole_minutes:02d}:{remainder:05.2f}"


def probe_audio_duration(audio_path: Path) -> float:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return max(float(completed.stdout.strip() or "0"), 0.0)
    except Exception:
        return 0.0


def assign_sentence_times(units: list[ScriptUnit], timed_chars: list[TimedChar]) -> tuple[list[dict[str, str]], int]:
    if not units or not timed_chars:
        return [], 0

    script_concat = "".join(unit.normalized for unit in units)
    recognized_concat = "".join(item.ch for item in timed_chars)
    matcher = difflib.SequenceMatcher(None, script_concat, recognized_concat, autojunk=False)
    opcodes = matcher.get_opcodes()

    spans: list[tuple[int, int]] = []
    cursor = 0
    for unit in units:
        next_cursor = cursor + len(unit.normalized)
        spans.append((cursor, next_cursor))
        cursor = next_cursor

    indexed_times: list[tuple[float | None, float | None]] = []
    exact_matches = 0
    for start_idx, end_idx in spans:
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
            exact_matches += 1
            indexed_times.append(
                (
                    timed_chars[matched_positions[0]].start,
                    timed_chars[matched_positions[-1]].end,
                )
            )
        else:
            indexed_times.append((None, None))

    # Fill gaps by borrowing neighboring boundaries, so short utterances like 「たぶん」 still become clickable.
    for index, (start, end) in enumerate(indexed_times):
        if start is not None and end is not None:
            continue

        prev_end = None
        next_start = None
        for prev_index in range(index - 1, -1, -1):
            if indexed_times[prev_index][1] is not None:
                prev_end = indexed_times[prev_index][1]
                break
        for next_index in range(index + 1, len(indexed_times)):
            if indexed_times[next_index][0] is not None:
                next_start = indexed_times[next_index][0]
                break

        if prev_end is None and next_start is None:
            fallback_start = 0.0
            fallback_end = timed_chars[-1].end
        elif prev_end is None:
            fallback_start = max(next_start - 0.8, 0.0)  # type: ignore[operator]
            fallback_end = next_start  # type: ignore[assignment]
        elif next_start is None:
            fallback_start = prev_end
            fallback_end = min(prev_end + 0.8, timed_chars[-1].end)
        else:
            gap = max(next_start - prev_end, 0.12)  # type: ignore[operator]
            fallback_start = prev_end
            fallback_end = prev_end + min(gap, 0.9)
        indexed_times[index] = (fallback_start, fallback_end)

    aligned: list[dict[str, str]] = []
    for unit, (start, end) in zip(units, indexed_times):
        record: dict[str, str] = {
            "text": f"{unit.speaker}：{unit.text}" if unit.speaker else unit.text,
            "start": format_time(start or 0.0),
            "end": format_time(end or 0.0),
        }
        if unit.speaker:
            record["speaker"] = unit.speaker
        aligned.append(record)
    return aligned, exact_matches


def iter_audio_questions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for section in payload.get("exam_info", {}).get("sections", []):
        if section.get("section_type") == "listening":
            questions.extend(q for q in section.get("questions", []) if q.get("audio") and q.get("script"))
            continue
        if section.get("section_type") == "listening_reading":
            for passage in section.get("passages", []):
                questions.extend(q for q in passage.get("questions", []) if q.get("audio") and q.get("script"))
    return questions


def question_has_timestamps(question: dict[str, Any]) -> bool:
    rows = question.get("script", [])
    if not isinstance(rows, list) or not rows:
        return False
    sample = rows[: min(3, len(rows))]
    return all(isinstance(row, dict) and row.get("start") and row.get("end") for row in sample)


def align_exam(json_path: Path, model: Any, dry_run: bool = False) -> dict[str, Any]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    exam_id = str(payload.get("exam_info", {}).get("exam_id", json_path.stem))
    question_reports: list[dict[str, Any]] = []
    mutated = False

    for question in iter_audio_questions(payload):
        if question_has_timestamps(question):
            continue
        units = split_script_into_units(question.get("script", []))
        if not units:
            continue
        audio_rel = str(question.get("audio", "")).lstrip("/").replace("/", "\\")
        audio_path = ROOT / audio_rel
        if not audio_path.exists():
            question_reports.append(
                {"question_id": question.get("id"), "status": "missing_audio", "audio": str(audio_path)}
            )
            continue

        silent = io.StringIO()
        with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
            result = model.transcribe(str(audio_path), language="ja", word_timestamps=True, fp16=False, verbose=False)
        timed_chars = build_timed_chars(result)
        if not timed_chars:
            fallback_script = fallback_single_unit(units, audio_path)
            if fallback_script:
                question["script"] = fallback_script
                mutated = True
                question_reports.append(
                    {
                        "question_id": question.get("id"),
                        "status": "fallback_duration",
                        "units": len(fallback_script),
                        "exact_matches": 0,
                    }
                )
                continue
            question_reports.append({"question_id": question.get("id"), "status": "no_timed_chars"})
            continue
        aligned_script, exact_matches = assign_sentence_times(units, timed_chars)
        if aligned_script:
            question["script"] = aligned_script
            mutated = True
            question_reports.append(
                {
                    "question_id": question.get("id"),
                    "status": "ok",
                    "units": len(aligned_script),
                    "exact_matches": exact_matches,
                }
            )
        else:
            question_reports.append({"question_id": question.get("id"), "status": "no_alignment"})

    if mutated and not dry_run:
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "exam_id": exam_id,
        "mutated": mutated,
        "questions": question_reports,
    }


def fallback_single_unit(units: list[ScriptUnit], audio_path: Path) -> list[dict[str, str]]:
    if len(units) != 1:
        return []
    duration = probe_audio_duration(audio_path)
    if duration <= 0:
        return []
    unit = units[0]
    row = {
        "text": f"{unit.speaker}：{unit.text}" if unit.speaker else unit.text,
        "start": "00:00.00",
        "end": format_time(duration),
    }
    if unit.speaker:
        row["speaker"] = unit.speaker
    return [row]


def main() -> None:
    parser = argparse.ArgumentParser(description="Align EJU listening transcripts with per-sentence timestamps.")
    parser.add_argument("--exam-id", nargs="*", help="Only process one or more exam ids, e.g. 2010_01 2010_02")
    parser.add_argument("--model", default="base", help="Whisper model name")
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes back to JSON")
    args = parser.parse_args()

    model = whisper.load_model(args.model)

    json_paths = [EJU_DIR / f"{exam_id}.json" for exam_id in args.exam_id] if args.exam_id else sorted(EJU_DIR.glob("*.json"))
    for json_path in json_paths:
        if not json_path.exists():
            print(f"skip {json_path.stem}: missing file")
            continue
        report = align_exam(json_path, model, dry_run=args.dry_run)
        ok_count = sum(1 for item in report["questions"] if item["status"] == "ok")
        total_units = sum(int(item.get("units", 0)) for item in report["questions"] if item["status"] == "ok")
        total_exact = sum(int(item.get("exact_matches", 0)) for item in report["questions"] if item["status"] == "ok")
        print(
            f"{report['exam_id']}: questions={ok_count} units={total_units} exact_matches={total_exact} "
            f"mutated={report['mutated']}"
        )


if __name__ == "__main__":
    main()
