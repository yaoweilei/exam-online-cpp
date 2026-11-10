"""Read-only checks of answer/explanation agreement; not an official-answer audit."""
import argparse
import collections
import hashlib
import html
import json
import pathlib
import re
import unicodedata


def plain(value):
    if not isinstance(value, str):
        return ''
    return unicodedata.normalize('NFKC', html.unescape(re.sub(r'<[^>]*>', '', value)))


def answer_number(value):
    if isinstance(value, bool):
        return None
    text = str(value).strip()
    if re.fullmatch(r'[1-9][0-9]?', text):
        return int(text)
    if re.fullmatch(r'[A-Fa-f]', text):
        return ord(text.upper()) - ord('A') + 1
    return None


def audit(root):
    issues, warnings = [], []
    repeated = collections.defaultdict(list)
    files = questions = checked = 0
    for file in sorted(root.rglob('*.json')):
        if file.name.startswith('.'):
            continue
        files += 1
        try:
            doc = json.loads(file.read_text(encoding='utf-8-sig'))
            sections = doc.get('exam_info', {}).get('sections', [])
            if not isinstance(sections, list):
                raise ValueError('sections must be an array')
        except (ValueError, OSError, AttributeError) as error:
            issues.append({'code': 'UNREADABLE_PAPER', 'file': str(file.relative_to(root)), 'message': str(error)})
            continue
        for section_index, section in enumerate(sections):
            if not isinstance(section, dict):
                issues.append({'code': 'INVALID_SECTION', 'file': str(file.relative_to(root)), 'section': section_index})
                continue
            items = list(section.get('questions') or [])
            items += [question for block in section.get('passages', []) if isinstance(block, dict) for question in block.get('questions', [])]
            for question in items:
                questions += 1
                if not isinstance(question, dict):
                    continue
                location = {'file': str(file.relative_to(root)), 'section': section_index, 'question_id': question.get('id')}
                options = question.get('options', [])
                answer = answer_number(question.get('correct_answer', question.get('answer')))
                if question.get('has_ans') is False or answer is None or not isinstance(options, list) or not options:
                    continue
                checked += 1
                if answer > len(options):
                    issues.append({**location, 'code': 'ANSWER_OUT_OF_RANGE', 'answer': answer, 'options': len(options)})
                for field in ['explanation', 'explanation_expand']:
                    text = plain(question.get(field))
                    # Restrict to explicit headings. Discussing a wrong option in
                    # normal prose must not be mistaken for a declared answer.
                    claims = re.findall(r'【\s*为什么(?:选择|选)\s*([1-9][0-9]?)\s*】', text)
                    for claim in sorted(set(map(int, claims))):
                        if claim != answer:
                            issues.append({**location, 'code': 'WHY_ANSWER_MISMATCH', 'field': field, 'answer': answer, 'explanation_answer': claim})
                    if field == 'explanation':
                        normalized = re.sub(r'\s+', '', text)
                        if len(normalized) >= 100:
                            repeated[hashlib.sha256(normalized.encode()).hexdigest()].append(location)
    for locations in repeated.values():
        if len(locations) >= 4:
            warnings.append({'code': 'REPEATED_EXPLANATION_REVIEW', 'count': len(locations), 'questions': locations})
    if not files:
        issues.append({'code': 'NO_PAPERS', 'message': 'No paper JSON files found; verify the selected root'})
    return {'files': files, 'questions': questions, 'checked_choice_questions': checked, 'issues': issues, 'warnings': warnings,
            'automated_checks_passed': not issues, 'official_answer_verified': False, 'semantic_review_complete': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paper-root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'data/paper')
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    result = audit(args.paper_root.resolve())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({**{key: result[key] for key in ['files', 'questions', 'checked_choice_questions', 'automated_checks_passed', 'official_answer_verified', 'semantic_review_complete']}, 'issues': len(result['issues']), 'warnings': len(result['warnings'])}, ensure_ascii=False))
    raise SystemExit(0 if result['automated_checks_passed'] else 1)
