import json, html, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).parent
records=[]
for filename in ['observations.json','expanded.json','additional.json','public.json']:
    if (root/filename).exists(): records += json.loads((root/filename).read_text('utf-8'))
records=list({r['id']:r for r in records}.values())
(root/'reviewed.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
roles={'superAdmin':'超级管理员','teacher':'老师','assistant':'教学管理员','orgAdmin':'机构管理员','orgContentAdmin':'机构内容管理员','contentAdmin':'平台内容管理员','student':'学员','public':'游客/登录','exam':'答题'}
cards=[]
for r in records:
    views=[]
    for c in r.get('captures',[]):
        src='screenshots/'+c['file']
        assert (root/src).exists(),src
        views.append(f'<figure data-width="{c["width"]}"><figcaption>{c["width"]}×{c["height"]} · {c["position"]} · 内容区宽 {c["metrics"]["mainWidth"]}px · 溢出 {c["metrics"]["mainOverflow"]}px</figcaption><a href="{src}" target="_blank"><img loading="lazy" src="{src}" alt="{html.escape(r["label"])}"></a></figure>')
    cards.append(f'<article id="{r["id"]}" data-role="{r["role"]}"><h2>{html.escape(r["label"])}</h2><p>{roles.get(r["role"],r["role"])} · {r["id"]}</p><div class="views">'+''.join(views)+'</div></article>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>平板 UI 检查</title><style>body{font:14px system-ui;margin:16px;background:#f6f6f6;color:#26221f}header{position:sticky;top:0;z-index:1;background:white;padding:12px;border:1px solid #ddd}h1{font-size:22px}h2{font-size:17px}select{height:36px;margin-right:16px}article{padding:12px;background:white;border:1px solid #ddd;margin-top:16px}article[hidden],figure[hidden]{display:none}.views{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0;min-width:0;flex:1 1 360px;max-width:600px}img{width:100%;height:auto;border:1px solid #eee}p,figcaption{font-size:12px;color:#666;overflow-wrap:anywhere}figcaption{margin-bottom:8px}</style><header><h1>平板 UI 检查 · 2026-11-01</h1><p>768×1024 竖屏 / 1024×768 横屏；部分页面补查 820、1180px 和窄容器。点击图片看原图。</p><label>角色 <select id="role"><option value="">全部</option>'''+''.join(f'<option value="{k}">{v}</option>' for k,v in roles.items())+'''</select></label><label>宽度 <select id="width"><option value="">全部</option><option>768</option><option>1024</option><option>820</option><option>1180</option><option>1440</option></select></label><a href="REPORT.md">问题清单</a></header><main>'''+''.join(cards)+'''</main><script>const role=document.getElementById('role'),width=document.getElementById('width');function filter(){document.querySelectorAll('article').forEach(a=>{a.querySelectorAll('figure').forEach(f=>f.hidden=!!width.value&&f.dataset.width!==width.value);a.hidden=(!!role.value&&a.dataset.role!==role.value)||![...a.querySelectorAll('figure')].some(f=>!f.hidden)})}role.onchange=width.onchange=filter;</script></html>'''
(root/'index.html').write_text(page,encoding='utf-8')
for kind,selected in [('primary',records[:47]),('expanded',records[47:])]:
    images=[(r,c) for r in selected for c in r.get('captures',[]) if c['position']=='top' and (c['width']==768 or not any(x['width']==768 for x in r['captures']))]
    for start in range(0,len(images),12):
        sheet=Image.new('RGB',(1280,1404),'#ddd');draw=ImageDraw.Draw(sheet)
        for i,(r,c) in enumerate(images[start:start+12]):
            x=(i%4)*320;y=(i//4)*468
            draw.text((x+4,y+3),r['id'][:43],fill='black')
            im=Image.open(root/'screenshots'/c['file']).convert('RGB');im.thumbnail((316,440))
            sheet.paste(im,(x+2,y+24))
        sheet.save(root/f'contact-{kind}-{start//12+1}.jpg',quality=90)
summary={'roles':7,'primary_entries':len(json.loads((root/'observations.json').read_text('utf-8'))),'scenarios':len(records),'screenshots':sum(len(r.get('captures',[]))for r in records),'blocked':[{'id':r['id'],'reason':r['blocked']}for r in records if r.get('blocked')],'main_overflow':[{'id':r['id'],'width':c['width'],'overflow':c['metrics']['mainOverflow']}for r in records for c in r.get('captures',[])if c['metrics']['mainOverflow']>1],'browser_errors':[{'id':r['id'],'errors':r['errors']}for r in records if r.get('errors')]}
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
