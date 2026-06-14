# EJU Explanation Publication QA Plan

## Goal

Bring EJU explanations from self-study ready quality to publication-oriented delivery quality.

## Steps

1. Metadata completion
   - Ensure every explanation node has `explanation_source.generated_by`.
   - Ensure source metadata records review method, style reference, and review date where applicable.
   - Flag suspicious section placement, such as explanation content that does not match the section type.

2. Full structural validation
   - Check every EJU JSON file for `explanation`, `explanation_expand`, and `explanation_source`.
   - Check standard headings are present and consistent by question type.
   - Check answer explanation and supplemental explanation render targets are populated.

3. Official answer consistency review
   - Verify `answer`, `correct_answer`, and the explanation text agree.
   - Detect cases where the explanation says "why choose X" but the stored answer is different.
   - Flag missing or unpublished questions separately.

4. Publication style editing
   - Remove mechanical wording, vague phrasing, and unnatural Chinese.
   - Normalize terminology across writing, reading, listening-reading, and listening.
   - Check that explanations sound like a human teacher and are suitable for self-study.

5. Manual sampling review
   - For each paper, sample reading, listening-reading, listening, and writing content where available.
   - Confirm reasoning, wrong-option analysis, and learner advice are concrete and defensible.
   - Escalate any sampled issue into a broader same-pattern scan.

6. QA report
   - Generate `data/paper/eju/eju_explanation_qa_report.md`.
   - Record passed checks, fixed issues, unresolved risks, and recommended next review targets.

## Current Status

- Step 1: Completed on 2026-06-10. All 1345 EJU explanation nodes have `generated_by` and `review_pass`.
- Step 2: Completed on 2026-06-10. Full structural validation passes with 0 open issues.
- Step 3: Completed on 2026-06-10. Answer-field and explanation answer references pass with 0 open issues.
- Step 4: Completed on 2026-06-10. Publication-style scan and conservative wording pass completed with 0 high-priority style issues remaining.
- Step 5: Completed on 2026-06-10. Manual sampling review completed; same-pattern issues found in the samples were expanded into broader scans and fixed.
- Step 6: Completed on 2026-06-10. Final QA report generated at `data/paper/eju/eju_explanation_qa_report.md`.

## Step 1 Notes

- Repaired missing metadata in `data/paper/eju/2022_01.json`.
- Added a QA note for the `2022_01` writing-section question because the explanation text appears to be reading-style content inside the writing section.
- Full metadata audit result: 1345 explanation nodes checked, 0 missing `generated_by`, 0 missing `review_pass`.
- Step 2 later removed the misplaced `2022_01` writing-section question explanation, so the current explanation-node total is 1344.

## Step 2 Notes

- Checked 26 EJU JSON files.
- Current explanation-node totals:
  - Reading: 642
  - Listening-reading: 312
  - Listening: 390
  - Writing model essays: 52 essays, 52 editorial explanations
- Added missing `【补充解析】` heading to 543 reading `explanation_expand` fields.
- Kept 4 unpublished listening-reading questions as explicit exceptions using `【答案解析】` plus `【补充解析】`, because their source material is not published and normal answer reasoning would require fabrication.
- Removed a misplaced reading-style explanation from the `2022_01` writing section question. Writing explanations are stored in `model_essays` and `editorial_explanation`.
- Final structural audit result: 1344 explanation nodes checked, 0 structural issues.

## Step 3 Notes

- Checked 1344 explanation nodes across reading, listening-reading, and listening.
- Current answerability totals:
  - Answerable nodes: 1340
  - Unpublished/not-answerable exceptions: 4
- Verified `answer` and `correct_answer` consistency.
- Verified listening/listening-reading `【为什么选X】` headings match stored answers for all answerable questions.
- Fixed stale `correct_answer` values in `data/paper/eju/2011_01.json` for Q4, Q10, and Q12.
- Marked the unpublished `data/paper/eju/2020_02.json` listening-reading Q5 as `has_ans: false`.
- Rewrote mismatched `data/paper/eju/2022_01.json` listening explanations for Q14-Q17 and Q19-Q27 so explanation content, option number, and stored answer are aligned.
- Final Step 3 audit result: 0 answer consistency issues.

## Step 4 Notes

- Ran a conservative publication-style pass across all 26 existing EJU JSON files.
- Expanded 302 short reading `explanation_expand` entries so the supplemental notes are useful for self-study rather than one-line labels.
- Normalized terminology from `听读解` to `读听解` where it appeared in explanation text.
- Replaced high-risk mechanical wording such as `答案就是`, `很明显`, and `显然` with more teacher-like phrasing.
- Rechecked style markers including template wording, placeholder wording, debug terms, and harsh/non-pedagogical wording.
- Remaining 4 occurrences of `不能像` were reviewed manually and are normal semantic comparisons, not template language.
- Final Step 4 style audit result: 1344 explanation nodes checked, 0 high-priority publication-style issues, 0 short reading supplemental explanations.
- Regression checks after Step 4:
  - Structural audit: 26 files, 1344 explanation nodes, 0 issues.
  - Answer consistency audit: 1340 answerable nodes, 0 issues.

## Step 5 Notes

- Sampled all 26 EJU papers by section:
  - Reading/listening-reading/listening: 78 representative section samples.
  - Writing: 52 model essays and 52 editorial explanations checked through the actual `passages[].model_essays[]` structure.
- Found repeated reading supplemental templates such as `下线部题复盘时...`, `作者观点题复盘时...`, and `复盘时不要只记选项号...`.
- Rewrote 273 reading supplemental explanations to remove repeated question-type template wording and make the self-study guidance item-specific.
- Found compact reading distractor wording such as bare option numbers and terse labels (`1太浅`, `2未提`, etc.).
- Normalized reading distractor references into publication-style option wording such as `第1项...`, `第2、3项...`, and repaired grouped-number formatting artifacts.
- Found writing `why_this_works` explanations were structurally complete but too generic across topics.
- Rewrote all 52 writing `why_this_works` fields so each explanation references the specific topic, prompt type, and paragraph function.
- Final Step 5 regression audit:
  - Structural audit: 26 files, 1344 explanation nodes, 0 issues.
  - Answer consistency audit: 1340 answerable nodes, 0 issues.
  - Style audit: 0 high-priority style/template issues, 0 bad option-number formatting issues.
  - Reading supplemental audit: 0 short `explanation_expand` entries.
  - Writing audit: 26 writing sections, 52 model essays, 52 editorial explanations, 0 generic `why_this_works` entries.

## Step 6 Notes

- Generated final QA report: `data/paper/eju/eju_explanation_qa_report.md`.
- The report records:
  - Scope and final counts.
  - Passed checks.
  - Issues fixed in Steps 1-5.
  - Current known exceptions.
  - Residual publication risks.
  - Recommended next review targets.
- Final automated audit snapshot:
  - EJU JSON files: 26
  - Explanation nodes: 1344
  - Answerable nodes: 1340
  - Structural issues: 0
  - Answer consistency issues: 0
  - High-priority style/template issues: 0
  - Bad option-number formatting issues: 0
  - Writing sections: 26
  - Model essays: 52
  - Editorial explanations: 52
  - Generic writing `why_this_works` entries: 0
