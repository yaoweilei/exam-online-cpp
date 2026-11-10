from pathlib import Path
import csv
import json
import re

root = Path(__file__).resolve().parent
records = json.loads((root / 'all-observations.json').read_text(encoding='utf-8'))
inventory = json.loads((root / 'inventory.json').read_text(encoding='utf-8'))
by_id = {r['id']: r for r in records}
roles = {'superAdmin': '超级管理员', 'teacher': '老师', 'assistant': '教学管理员', 'orgAdmin': '机构管理员', 'orgContentAdmin': '机构内容管理员', 'contentAdmin': '平台内容管理员', 'student': '学员'}
issues = {
    'superAdmin': {'overview': [], 'users': ['M12','M13'], 'roles': [], 'access': [], 'organizations': ['M12','M13'], 'content': ['M02'], 'feedback': ['M12'], 'payments': ['M10','M12','M13'], 'pricing': ['M11'], 'flags': [], 'audit': ['M12','M29']},
    'teacher': {'__overview__': [], 'teacher-students': ['M20'], 'teacher-groups': ['M16'], 'teacher-gradebook': [], 'teacher-schedule': ['M16'], 'teacher-review': ['M14','M15'], 'teacher-prep': ['M15']},
    'assistant': {'__overview__': [], 'assistant-followup': ['M12','M17'], 'teacher-groups': ['M16'], 'teacher-schedule': ['M16'], 'assistant-package': []},
    'orgAdmin': {'__overview__': [], 'org-members': ['M06','M12','M13'], 'org-permissions': ['M07','M12'], 'org-course-packages': ['M03'], 'org-course-accounts': ['M03','M04'], 'org-groups': ['M08','M16'], 'org-dashboard': ['M01','M20','M29'], 'org-plan': ['M05'], 'org-settings': ['M09','M12'], 'org-audit': ['M12','M29']},
    'orgContentAdmin': {'__overview__': ['M26']},
    'contentAdmin': {'__overview__': [], 'content-feedback': ['M12','M24'], 'content-publish': ['M02','M24'], 'openAuditLog': ['M12','M24','M29']},
    'student': {'__overview__': ['M26'], 'openReviewWorkbench': ['M18'], 'openAssignments': [], 'openChapterPath': ['M19'], 'student-review-library': ['M26'], 'openLearningReport': ['M20'], 'student-account-plan': ['M21','M22'], 'student-account-coupons': [], 'student-account-feedback': ['M29']}
}
with (root / 'coverage.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['角色','入口','导航键','检查结果','对应整改项（含详情与共用组件）','截图宽度','截图入口'])
    for role in inventory:
        for dest in role['destinations']:
            key = dest['key']
            ident = role['role'] + '-overview' if key in ['overview','__overview__'] else re.sub('[^a-zA-Z0-9_-]+','_',role['role']+'-'+key)[:105]
            record = by_id.get(ident)
            if record is None:
                raise RuntimeError('Missing primary state: '+ident)
            simple = key.removeprefix('openRoleContent:')
            assigned = issues.get(role['role'], {}).get(simple, [])
            writer.writerow([roles[role['role']], dest['name'], key, '有整理项（部分在详情/展开态）' if assigned else '未确认独有的布局缺陷；共用样式仍需统一', '、'.join(assigned) or '—', '/'.join(str(w) for w in sorted({c['width'] for c in record.get('captures',[])})), 'index.html#'+ident])

captures = [c for r in records for c in r.get('captures', [])]
errors = [{'id': r['id'], 'errors': r.get('errors', [])} for r in records if r.get('errors')]
summary = {
    'primary_navigation_entries': sum(len(r['destinations']) for r in inventory),
    'roles': len(inventory),
    'distinct_ui_states': len(records),
    'indexed_screenshots': len(captures),
    'supplemental_middle_screenshots': len(list((root/'screenshots').glob('*-middle-*.png'))),
    'widths': sorted({c['width'] for c in captures}),
    'navigation_by_role': {roles[r['role']]:len(r['destinations']) for r in inventory},
    'findings': {'P1':3,'P2':21,'P3':5},
    'browser_errors':errors,
    'nonzero_content_overflow': [{'id':r['id'],'max_px':max(c['metrics']['mainOverflow'] for c in r['captures'])} for r in records if any(c['metrics']['mainOverflow']>0 for c in r.get('captures',[]))]
}
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
stats = f"""### 本次实际采集统计

- 7 个角色、47 个一级导航入口，均检查 360/390/540px。
- 共 {len(records)} 个页面/展开/表单采集场景、{len(captures)} 张索引截图，另有 {summary['supplemental_middle_screenshots']} 张长页面中段定位图。
- 问题 29 项：P1 3 项、P2 21 项、P3 5 项。
- [机器统计](summary.json) 与 [47 个导航入口覆盖表](coverage.csv) 可用于后续逐项复查。

截图数量包含同一状态的不同宽度和顶部/底部，不能当作页面数；未实际进入的状态没有计入。
"""
report = (root/'REPORT.md').read_text(encoding='utf-8')
report = re.sub(r'<!-- COVERAGE_STATS -->.*', '<!-- COVERAGE_STATS -->\n'+stats, report, flags=re.S)
(root/'REPORT.md').write_text(report,encoding='utf-8')
missing=[link for link in re.findall(r'\]\(([^)]+)\)',report) if not (root/link).exists()]
if missing: raise RuntimeError('Broken links: '+repr(missing))
assert len(list(csv.DictReader((root/'coverage.csv').open(encoding='utf-8-sig'))))==47
assert len(re.findall(r'### M0[1-3] ',report))==3
assert len(re.findall(r'\| M\d\d \|',report))==26
print(json.dumps(summary,ensure_ascii=False,indent=2))
