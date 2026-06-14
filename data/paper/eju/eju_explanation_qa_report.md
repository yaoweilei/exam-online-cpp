# EJU Explanation QA Report

## Summary

This report records the QA status for the EJU explanation data in `data/paper/eju/*.json`.

Review date: 2026-06-10

Scope:

- 26 existing EJU JSON files.
- 1344 explanation nodes:
  - Reading: 642
  - Listening-reading: 312
  - Listening: 390
- Writing content:
  - 26 writing sections
  - 52 model essays
  - 52 editorial explanations

Current result:

- Structural issues: 0
- Answer consistency issues: 0
- High-priority style/template issues: 0
- Bad option-number formatting issues: 0
- Short reading supplemental explanations: 0
- Generic writing `why_this_works` entries: 0

## Passed Checks

### Metadata

- Every explanation node has `explanation_source.generated_by`.
- Every explanation node has non-empty `explanation_source.review_pass`.
- Misplaced reading-style explanation content previously found in the `2022_01` writing section was removed; writing explanations are stored in writing-specific essay fields.

### Structure

- Every explanation node has `explanation`.
- Every explanation node has `explanation_expand`.
- Reading explanations use `【讲解】`.
- Reading supplemental explanations use `【补充解析】`.
- Answerable listening and listening-reading explanations use `【题目解析】`.
- Unpublished/not-answerable listening-reading exceptions use `【答案解析】` plus `【补充解析】`.
- Listening and listening-reading supplemental explanations use `【补充解析】`.

### Answer Consistency

- Checked 1344 explanation nodes.
- Checked 1340 answerable nodes.
- Verified `answer` and `correct_answer` agree where both are present.
- Verified answerable listening/listening-reading explanations contain `【为什么选X】` matching the stored answer.
- Kept 4 unpublished/not-answerable exceptions separated from normal answerable questions.

### Publication Style

- Removed high-risk mechanical or non-publication phrasing such as `答案就是`, `很明显`, and `显然`.
- Normalized terminology from `听读解` to `读听解` in explanation text.
- Removed repeated reading supplemental templates such as `下线部题复盘时...`, `作者观点题复盘时...`, and `复盘时不要只记选项号...`.
- Normalized reading distractor references from compact labels into publication-style option wording, such as `第1项...` and `第2、3项...`.
- Repaired grouped-option formatting artifacts introduced during normalization.
- Reviewed remaining `不能像` occurrences and confirmed they are normal semantic comparisons.

### Writing

- Checked 26 writing sections through the actual `passages[].model_essays[]` structure.
- Confirmed 52 model essays have editorial explanation content.
- Rewrote 52 `why_this_works` fields so they reference the specific topic, prompt type, and paragraph function instead of repeating a generic template.
- Confirmed no weak or generic writing explanation entries remain under the current automated checks.

## Fixed Issues

### Step 1

- Repaired missing metadata in `2022_01.json`.
- Marked the misplaced writing-section explanation as suspicious for later cleanup.

### Step 2

- Added missing `【补充解析】` headings to 543 reading `explanation_expand` entries.
- Removed the misplaced reading-style explanation from the `2022_01` writing section.
- Preserved 4 unpublished listening-reading questions as explicit exceptions instead of fabricating normal answer explanations.

### Step 3

- Fixed stale `correct_answer` values in `2011_01.json` for Q4, Q10, and Q12.
- Marked unpublished `2020_02.json` listening-reading Q5 as `has_ans: false`.
- Rewrote mismatched `2022_01.json` listening explanations for Q14-Q17 and Q19-Q27 so stored answers and explanation content align.

### Step 4

- Expanded 302 short reading supplemental explanations.
- Fixed 9 terminology/wording issues found by the publication-style scan.
- Confirmed 0 high-priority style issues after regression checks.

### Step 5

- Rewrote 273 reading supplemental explanations to remove repeated template wording and make the guidance item-specific.
- Normalized 472 reading distractor references in the first option-wording pass.
- Normalized 359 additional grouped option references in the second option-wording pass.
- Repaired 128 grouped-option formatting artifacts after normalization.
- Replaced 8 remaining terse option labels such as `第1项太浅` or `第2项未提` with fuller explanation wording.
- Rewrote all 52 writing `why_this_works` fields to be topic-specific.

## Current Known Exceptions

- 4 listening-reading nodes are unpublished/not-answerable exceptions. They are intentionally not treated as normal answerable questions.
- Existing files cover 2010_01 through 2023_02 except for years/sessions not present in the current data folder. This report does not claim coverage for missing source JSON files.
- Some listening question `question` values still serialize as object-like structures in audit output because the actual UI likely renders nested question assets. This report only validates explanation fields, answer consistency, and style; it does not validate question-rendering structure.

## Residual Risk

- Automated and sampled QA cannot prove every explanation is fully equivalent to a professional line-by-line manual commentary.
- Full publication sign-off should still include manual source comparison against the official paper/audio/transcript for every question.
- Listening and listening-reading quality depends on the correctness of source transcripts and extracted materials. This report does not re-transcribe audio.
- Reading explanations have been improved for style and consistency, but a complete semantic audit against every original passage would be a separate editorial pass.
- Writing model essays and explanations passed structural and style checks, but final publication may still require a Japanese-language native review for nuance.

## Recommended Next Review Targets

1. Full source-grounded manual review by paper, starting with the most recent papers:
   - 2023_02
   - 2023_01
   - 2022_02
   - 2022_01

2. Listening/listening-reading transcript verification:
   - Confirm scripts against source audio where available.
   - Check that `【为什么选X】` reasoning cites the actual decisive audio information.

3. Reading semantic review:
   - Compare each explanation with the original passage.
   - Confirm distractor analysis does not overstate what the passage says.

4. Writing editorial review:
   - Confirm model essays stay within EJU character expectations.
   - Check Japanese naturalness and argument balance with a native or near-native reviewer.

5. UI rendering QA:
   - Confirm explanation headings display correctly.
   - Confirm reading/listening/writing answer explanation and supplemental explanation are separated as intended.
   - Confirm unpublished exceptions display without implying a fabricated official answer.

## Final Audit Snapshot

Latest automated audit result:

```json
{
  "files": 26,
  "nodes": 1344,
  "answerable": 1340,
  "structuralIssues": 0,
  "answerIssues": 0,
  "styleIssues": 0,
  "shortReadingExpand": 0,
  "badFormat": 0,
  "writingSections": 26,
  "essays": 52,
  "editorials": 52,
  "weakWritingExplanations": 0,
  "genericWhyCount": 0
}
```
