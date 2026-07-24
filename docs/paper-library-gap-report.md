# Paper Library Gap Report

Generated: 2026-07-07T01:57:42.309Z

## Summary

- EJU JSON files present: 27
- EJU expected sessions in local coverage window: 32
- EJU missing sessions: 5
- JLPT expected files: 160
- JLPT missing JSON files: 0
- JLPT empty template files: 72
- JLPT populated files: 88

## EJU Missing Sessions

- 2019_02
  - source candidate: none found under downloads/EJU日本语
- 2020_01
  - source candidate: none found under downloads/EJU日本语
- 2024_02
  - source candidate: none found under downloads/EJU日本语
- 2025_01
  - source candidate: downloads\EJU日本语\2025\2025.mp3
  - source candidate: downloads\EJU日本语\2025\EJU日语\2025.mp3
  - source candidate: downloads\EJU日本语\2025\EJU日语\听力原文.pdf
  - source candidate: downloads\EJU日本语\2025\EJU日语\日本語.pdf
  - source candidate: downloads\EJU日本语\2025\听力原文.pdf
  - source candidate: downloads\EJU日本语\2025\日本語.pdf
  - source candidate: downloads\EJU日本语\2025\答案\全科答案.pdf
- 2025_02
  - source candidate: downloads\EJU日本语\2025\2025.mp3
  - source candidate: downloads\EJU日本语\2025\EJU日语\2025.mp3
  - source candidate: downloads\EJU日本语\2025\EJU日语\听力原文.pdf
  - source candidate: downloads\EJU日本语\2025\EJU日语\日本語.pdf
  - source candidate: downloads\EJU日本语\2025\听力原文.pdf
  - source candidate: downloads\EJU日本语\2025\日本語.pdf
  - source candidate: downloads\EJU日本语\2025\答案\全科答案.pdf

## JLPT Empty Templates

- N1: 2020_07, 2025_12
- N2: 2020_07, 2025_12
- N3: 2010_12, 2020_07, 2025_07, 2025_12
- N4: 2010_07, 2010_12, 2011_07, 2011_12, 2012_07, 2012_12, 2013_07, 2013_12, 2014_07, 2014_12, 2015_07, 2015_12, 2016_07, 2016_12, 2017_07, 2017_12, 2018_07, 2018_12, 2019_07, 2019_12, 2020_07, 2020_12, 2021_07, 2021_12, 2022_07, 2022_12, 2023_07, 2023_12, 2024_07, 2024_12, 2025_07, 2025_12
- N5: 2010_07, 2010_12, 2011_07, 2011_12, 2012_07, 2012_12, 2013_07, 2013_12, 2014_07, 2014_12, 2015_07, 2015_12, 2016_07, 2016_12, 2017_07, 2017_12, 2018_07, 2018_12, 2019_07, 2019_12, 2020_07, 2020_12, 2021_07, 2021_12, 2022_07, 2022_12, 2023_07, 2023_12, 2024_07, 2024_12, 2025_07, 2025_12

## JLPT Missing Files

- None in the 2010-2025 N1-N5 July/December coverage window.

## Notes

- `tools/audit_exam_content.mjs` should still be used for field-level checks such as missing explanations, missing audio, missing images, and malformed timestamps.
- This report treats empty `exam_info.sections` or zero extracted questions as a template gap, even when a JSON placeholder exists.
- EJU source candidates are heuristic matches from local downloads; importing them still requires parsing and visual/content QA.
