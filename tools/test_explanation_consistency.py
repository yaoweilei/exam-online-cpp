import json
import pathlib
import tempfile
import unittest

from audit_explanation_consistency import audit


class ExplanationChecks(unittest.TestCase):
    def check_questions(self, questions, **section):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            (root/'paper.json').write_text(json.dumps({'exam_info': {'sections': [dict(questions=questions, **section)]}}), encoding='utf-8')
            return audit(root)

    def test_explicit_answer_heading_only(self):
        result = self.check_questions([
            dict(id=1, options=['a', 'b'], correct_answer=2, explanation='为什么选1并不合适？这里选2。'),
            dict(id=2, options=['a', 'b'], correct_answer='B', explanation='【为什么选１】错误'),
            dict(id=3, options=['a', 'b'], correct_answer=2, explanation_expand='【为什么选择2】正确'),
        ])
        self.assertEqual([q['code'] for q in result['issues']], ['WHY_ANSWER_MISMATCH'])
        self.assertEqual(result['issues'][0]['question_id'], 2)
        self.assertFalse(result['official_answer_verified'])

    def test_missing_options_detected_in_both_question_locations(self):
        result = self.check_questions([dict(id=1, options=['a'], correct_answer=3)], passages=[
            dict(questions=[dict(id=2, options=['a'], correct_answer=2)])])
        self.assertEqual(len(result['issues']), 2)
        self.assertEqual(result['checked_choice_questions'], 2)

    def test_ungraded_and_writing_questions_skipped(self):
        result = self.check_questions([
            dict(id=1, options=['a'], correct_answer=2, has_ans=False),
            dict(id=2, options=[], correct_answer='自由回答'),
            dict(id=3, options=['a'], correct_answer=True),
        ])
        self.assertEqual(result['checked_choice_questions'], 0)
        self.assertEqual(result['issues'], [])

    def test_repeated_explanation_is_review_warning(self):
        result = self.check_questions([dict(id=i, options=['a'], correct_answer=1, explanation='重复解析'*30) for i in range(4)])
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['warnings'][0]['count'], 4)
        self.assertFalse(result['semantic_review_complete'])

    def test_invalid_json_is_not_silently_ignored(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            (root/'broken.json').write_text('{', encoding='utf-8')
            self.assertEqual(audit(root)['issues'][0]['code'], 'UNREADABLE_PAPER')

    def test_empty_or_wrong_root_cannot_report_a_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(audit(pathlib.Path(temp))['issues'][0]['code'], 'NO_PAPERS')


if __name__ == '__main__':
    unittest.main()
