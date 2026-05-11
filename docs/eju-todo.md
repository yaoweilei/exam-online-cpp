# EJU TODO

Last updated: 2026-05-11

This document tracks the remaining follow-up work after the recent EJU import, transcript, timestamp, layout, and answer backfill.

## Data Gaps

- `2023_01` listening transcript is still missing.
  Reason: the source transcript PDF is not present under `downloads/EJU日本语/【2】日本语听力音频+听力原文/听力原文2005-2023`.
  Impact: this exam does not have `script`, sentence timestamps, or `script_layout_image` for listening questions.
  Next step: locate the original `2023` first-session transcript source and rerun the transcript import/layout extraction pipeline.

- Some answers are intentionally still blank because the official answer sheet omits them.
  Reading:
  none. Previously blank reading answers were filled by checking the source passage and marking the answer basis as text-inferred where the official answer sheet did not publish a key.
  Listening:
  `2019_01` question `5`
  `2021_02` question `4`
  `2023_02` question `1`
  Next step: keep them blank in data, but show an explicit "official answer not published" message in the UI instead of leaving them visually ambiguous.

## Product Follow-up

- Add a dedicated UI state for omitted official listening answers.
  Current state: these listening questions simply have no `correct_answer`.
  Desired state: when `showAnswers` is enabled, render a clear label such as `官方未公布答案` or equivalent instead of just showing no green check.

- Browser-level verification is still incomplete.
  Current state: data coverage was checked by script and `npm run build` was used for relevant frontend changes, but there has not been a full click-through regression for EJU reading/listening answer display.
  Next step: open representative exams in the app and verify:
  `2022_02` reading correct answer highlighting
  listening transcript image + structured transcript coexistence
  sentence click-to-seek behavior
  transcript manual edit and save flow
  omitted-answer UI once implemented

- Confirm the manual transcript editor UX is acceptable.
  Current state: editing and saving are implemented.
  Open question: whether the editor needs version history, reset/reload, or a more explicit save-success/failure status.

## Tooling Follow-up

- Harden `tools/apply_eju_answers.py`.
  Current state: the script works for the current dataset, but it contains OCR heuristics and several manual overrides accumulated during recovery.
  Risks:
  answer extraction is not yet cleanly separated by section
  manual overrides are embedded directly in code
  regression behavior is hard to review
  Next step:
  split extraction, normalization, and override layers
  move manual overrides into a data file if they continue to grow
  add a coverage summary output that is easy to diff

- Add one command or script to regenerate all EJU enrichments from source.
  Desired scope:
  transcript import
  transcript layout image extraction
  sentence timestamp alignment
  answer import
  optional index rebuild
  Goal: make future refreshes reproducible without rerunning several ad hoc commands manually.

- Document external prerequisites for the EJU pipeline.
  Missing documentation:
  Tesseract model requirements
  PyMuPDF dependency
  audio splitting requirements
  expected source file locations under `downloads/`
  Next step: add a short setup section either in `data/paper/eju/README.md` or a dedicated tooling note.

## Optional Cleanup

- Review whether generated assets under `data/image/eju/*` and `data/audio/eju/2018_*` should all be committed as-is or if some should be regenerated in CI/manual release flow.

- Decide whether `.exam_index.json` should be regenerated after the current EJU data changes and committed together with the paper JSON updates.
