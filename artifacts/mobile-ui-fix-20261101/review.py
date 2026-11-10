from pathlib import Path
import html
import json
import re

root=Path(__file__).resolve().parent
before_root=root.parent/'mobile-ui-audit-2026-11-01'
before={r['id']:r for r in json.loads((before_root/'all-observations.json').read_text('utf-8'))}
inventory=json.loads((root/'inventory.json').read_text('utf-8'))
ids=[]
for group in inventory:
    for item in group['destinations']:
        key=item['key']
        ids.append(group['role']+'-overview' if key in ['overview','__overview__'] else re.sub('[^a-zA-Z0-9_-]+','_',group['role']+'-'+key)[:105])
observations={r['id']:r for r in json.loads((root/'observations.json').read_text('utf-8'))}
records={key:observations[key] for key in ids}
for key in ['quality','payment-detail','org-dashboard']:
    records[key]=observations[key]
for record in json.loads((root/'medium.json').read_text('utf-8')):
    if record['id'] in records:
        records[record['id']]['captures']=[c for c in records[record['id']]['captures'] if c['width']!=540]+record['captures']
for record in json.loads((root/'secondary.json').read_text('utf-8')):
    records[record['id']]=record
aliases={'quality':'platform-content-record','payment-detail':'platform-payment-orders-detail','org-dashboard':'org-dashboard-open','profile-final':'account-profile','security-final':'account-security','login-phone':'public-login','login-password':'public-login-password','listening-final':'exam-listening'}
roles={'superAdmin':'超级管理员','teacher':'老师','assistant':'教学管理员','orgAdmin':'机构管理员','orgContentAdmin':'机构内容管理员','contentAdmin':'平台内容管理员','student':'学员','public':'游客与登录','exam':'答题'}
def capture(record,width):
    return next((c for c in record.get('captures',[]) if c['width']==width and c['position']=='top'),None)
cards=[]
for key,record in records.items():
    old=before.get(aliases.get(key,key))
    panels=[]
    for width in [390,360,540]:
        new=capture(record,width)
        if new is None:continue
        prior=capture(old,width) if old else None
        left=f'<a href="../{before_root.name}/screenshots/{prior["file"]}" target="_blank"><img loading="lazy" src="../{before_root.name}/screenshots/{prior["file"]}" alt="调整前"></a>' if prior else '<p>此展开态提供调整后截图。</p>'
        right=f'<a href="screenshots/{new["file"]}" target="_blank"><img loading="lazy" src="screenshots/{new["file"]}" alt="调整后"></a>'
        extras=' · '.join(f'<a target="_blank" href="screenshots/{c["file"]}">{c["position"]}</a>' for c in record['captures'] if c['width']==width and c['position']!='top')
        panels.append(f'<div class="view" data-width="{width}" {"hidden" if width!=390 else ""}><div class="pair"><div><p>调整前</p>{left}</div><div><p>调整后 · 内容区溢出 {new["metrics"]["mainOverflow"]}px</p>{right}</div></div><p>{extras}</p></div>')
    cards.append(f'<article id="{key}" data-role="{record["role"]}"><h2>{html.escape(record["label"])}</h2><p>{roles.get(record["role"],record["role"])} · {key}</p>{"".join(panels)}</article>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>手机布局调整前后对照</title><style>body{font:14px system-ui;margin:20px;background:#f7f7f7;color:#26221f}header{position:sticky;top:0;background:white;border:1px solid #ddd;padding:12px;z-index:1}h1{font-size:22px}h2{font-size:17px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:16px;margin-top:16px}article{background:#fff;padding:12px;border:1px solid #ddd;min-width:0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;max-width:390px;height:auto;border:1px solid #eee}p{color:#666;font-size:12px;overflow-wrap:anywhere}select{height:36px;margin-right:16px}a{color:#965020}article[hidden],.view[hidden]{display:none}@media(max-width:620px){body{margin:8px}main{grid-template-columns:1fr}.pair{gap:6px}}</style><header><h1>手机布局调整前后对照 · 2026-11-01</h1><p>一级导航全量复查，详情与表单按修改点补查。点击图片可查看原图；测试数据可能因账号和场景不同而变化。</p><label>角色 <select id="role"><option value="">全部</option>'''+''.join(f'<option value="{k}">{v}</option>' for k,v in roles.items())+'''</select></label><label>宽度 <select id="width"><option>390</option><option>360</option><option>540</option></select></label><a href="../../docs/mobile-layout-cleanup-2026-11-01.md">修改记录</a></header><main>'''+''.join(cards)+'''</main><script>const roleSelect=document.getElementById('role'),widthSelect=document.getElementById('width');function filter(){document.querySelectorAll('article').forEach(e=>e.hidden=!!roleSelect.value&&e.dataset.role!==roleSelect.value);document.querySelectorAll('.view').forEach(e=>e.hidden=e.dataset.width!==widthSelect.value)}roleSelect.onchange=widthSelect.onchange=filter;</script></html>'''
(root/'index.html').write_text(page,encoding='utf-8')
(root/'reviewed.json').write_text(json.dumps(list(records.values()),ensure_ascii=False,indent=2),encoding='utf-8')
primary=[records[key] for key in ids]
summary={'roles':7,'primary_entries':len(primary),'scenarios':len(records),'screenshots':sum(len(r['captures']) for r in records.values()),'primary_widths':sorted({c['width'] for r in primary for c in r['captures']}),'primary_overflow':[r['id'] for r in primary if any(c['metrics']['mainOverflow']>1 for c in r['captures'])],'expanded_overflow':[r['id'] for r in records.values() if r not in primary and any(c['metrics']['mainOverflow']>1 for c in r['captures'])],'browser_errors':[{'id':r['id'],'errors':r['errors']}for r in records.values() if r.get('errors')],'functional_checks':json.loads((root/'verification.json').read_text('utf-8'))}
for record in records.values():
    for c in record['captures']:assert (root/'screenshots'/c['file']).exists(),c['file']
assert len(primary)==47
assert all({360,390,540}.issubset({c['width'] for c in r['captures']})for r in primary)
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items()if k!='functional_checks'},ensure_ascii=False,indent=2))
