import json,html
from pathlib import Path
root=Path(__file__).parent
records={}
for name in ['observations.json','expanded.json','public.json']:
    for r in json.loads((root/name).read_text('utf-8')): records[r['id']]=r
before={r['id']:r for r in json.loads((root.parent/'tablet-ui-audit-2026-11-01/reviewed.json').read_text('utf-8'))}
cards=[]
for key,r in records.items():
    pairs=[]
    for c in r.get('captures',[]):
        if c['position']!='top':continue
        assert (root/'screenshots'/c['file']).exists()
        old=next((p for p in before.get(key,{}).get('captures',[])if p['position']=='top' and p['width']==c['width']),None)
        left='<img loading="lazy" src="../tablet-ui-audit-2026-11-01/screenshots/'+old['file']+'">' if old else '<p>新增复查状态</p>'
        pairs.append(f'<div class="mode" data-width="{c["width"]}"><p>{c["width"]} × {c["height"]}</p><div class="pair"><div><p>调整前</p>{left}</div><div><p>调整后</p><a href="screenshots/{c["file"]}" target="_blank"><img loading="lazy" src="screenshots/{c["file"]}"></a></div></div></div>')
    cards.append(f'<article data-role="{r["role"]}"><h2>{html.escape(r["label"])}</h2><p>{key}</p>'+''.join(pairs)+'</article>')
page='''<!doctype html><meta charset="utf-8"><title>平板布局调整前后</title><style>body{font:14px system-ui;margin:16px;background:#f6f6f6}header{position:sticky;top:0;background:white;padding:12px;border:1px solid #ddd;z-index:1}h1{font-size:22px}h2{font-size:16px}article{padding:12px;margin-top:12px;background:white;border:1px solid #ddd}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{max-width:100%;height:auto}p{font-size:12px;color:#666}select{min-height:36px;margin-right:12px}[hidden]{display:none!important}</style><header><h1>平板布局调整前后 · 2026-11-02</h1><label>角色 <select id="role"><option value="">全部</option>'''+''.join(f'<option>{v}</option>'for v in ['superAdmin','teacher','assistant','orgAdmin','orgContentAdmin','contentAdmin','student','public','exam'])+'''</select></label><label>宽度 <select id="width"><option>768</option><option>1024</option><option>820</option><option>1180</option></select></label><a href="../../docs/tablet-layout-cleanup-2026-11-02.md">修改记录</a></header>'''+''.join(cards)+'''<script>const role=document.getElementById('role'),width=document.getElementById('width');function filter(){document.querySelectorAll('article').forEach(a=>{a.querySelectorAll('.mode').forEach(m=>m.hidden=m.dataset.width!==width.value);a.hidden=(role.value&&a.dataset.role!==role.value)||![...a.querySelectorAll('.mode')].some(m=>!m.hidden)})}role.onchange=width.onchange=filter;filter()</script>'''
(root/'index.html').write_text(page,encoding='utf-8')
summary={'roles':7,'primary_entries':47,'scenarios':len(records),'screenshots':sum(len(r.get('captures',[]))for r in records.values()),'overflow':[{'id':r['id'],'width':c['width']}for r in records.values()for c in r.get('captures',[])if c['metrics']['mainOverflow']>1],'blocked':[r['id']for r in records.values()if r.get('blocked')],'browser_errors':[r['id']for r in records.values()if r.get('errors')]}
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
