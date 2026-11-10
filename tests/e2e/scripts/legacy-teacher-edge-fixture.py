import sqlite3,json,pathlib,copy,os
repo=pathlib.Path(__file__).resolve().parents[3]
fpath=pathlib.Path(os.environ['TEACHER_EDGE_FIXTURE']).resolve();fpath.relative_to(repo/'tmp')
f=json.loads(fpath.read_text(encoding='utf-8'));root=pathlib.Path(f['dataRoot']).resolve();root.relative_to(repo/'tmp')
with sqlite3.connect(root/'user/core.sqlite3') as db:
 row=db.execute("SELECT payload FROM json_entities WHERE namespace='organizations' AND entity_key=?",(f['oid'],)).fetchone();assert row
 org=json.loads(row[0])
 for kind in ['api','ui','broken']:
  p=next(p for p in org['lesson_prep_plans'] if p['lesson_prep_id']==f['plans'][kind]['lesson_prep_id']);p.clear();p.update(copy.deepcopy(f['plans'][kind]))
  for key in ['question_ids','question_start','question_end','limit']:p.pop(key,None)
  p['question_set']=[{'exam_id':q['exam_id'],'section':'','question_id':q.get('local_question_id',q['question_id'].split(':')[-1]),'type':'','question_number':q.get('question_number','')} for q in p['question_set']]
  if kind=='broken':p['question_set'][0]['question_id']='99999'
  if kind=='ui':p.update(hide_answers=False,projection_mode=True,print_layout='A5')
 db.execute("UPDATE json_entities SET payload=? WHERE namespace='organizations' AND entity_key=?",(json.dumps(org,ensure_ascii=False),f['oid']))
with sqlite3.connect(root/'system/core.sqlite3') as db:
 aid=f['assignments']['historical']['assignment_id']; row=db.execute("SELECT payload FROM json_entities WHERE namespace='assignments' AND entity_key=?",(aid,)).fetchone();assert row
 a=json.loads(row[0]);a['submissions'][f['student']['user_id']].pop('submission_id',None)
 db.execute("UPDATE json_entities SET payload=? WHERE namespace='assignments' AND entity_key=?",(json.dumps(a,ensure_ascii=False),aid))
 for kind in ['legacy','reminder']:
  item=copy.deepcopy(f['assignments'][kind])
  if kind=='reminder':
   for actor,status in [(f['student'],'returned'),(f['reviewed'],'reviewed')]:
    sub=copy.deepcopy(a['submissions'][f['student']['user_id']]);sub.update(student_id=actor['user_id'],status=status,review_status=status,submission_id='edge-seed-'+actor['user_id']);item['submissions'][actor['user_id']]=sub
  db.execute("UPDATE json_entities SET payload=? WHERE namespace='assignments' AND entity_key=?",(json.dumps(item,ensure_ascii=False),item['assignment_id']))
print('Legacy fixtures prepared in isolated databases only')
