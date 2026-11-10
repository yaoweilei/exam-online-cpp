from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
import html

root = Path(__file__).resolve().parent
merged = {}
excluded = {'superAdmin-users-waited', 'superAdmin-users-reopened', 'teacher-prep-create', 'exam-question-map', 'exam-assist'}
for source in ['observations.json', 'expanded.json', 'student-expanded.json', 'public.json', 'rechecks.json', 'supplement.json', 'medium.json']:
    if not (root / source).exists():
        continue
    for record in json.loads((root / source).read_text(encoding='utf-8')):
        if record['id'] in excluded or '-__overview__' in record['id']:
            continue
        record['source'] = source
        if source == 'medium.json' and record['id'] in merged:
            merged[record['id']]['captures'] += record.get('captures', [])
            continue
        merged[record['id']] = record
records = list(merged.values())
(root / 'all-observations.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
role_names = {'superAdmin': '超级管理员', 'teacher': '老师', 'assistant': '教学管理员', 'orgAdmin': '机构管理员', 'orgContentAdmin': '机构内容管理员', 'contentAdmin': '平台内容管理员', 'student': '学员', 'public': '游客与登录', 'exam': '答题与练习'}
font_path = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 13)
roles = list(dict.fromkeys(r['role'] for r in records))
for role in roles:
    states = [r for r in records if r['role'] == role and r.get('captures')]
    for part in range((len(states) + 11) // 12):
        items = states[part*12:(part+1)*12]
        sheet = Image.new('RGB', (4*206, ((len(items)+3)//4)*490), '#e9e9e9')
        draw = ImageDraw.Draw(sheet)
        for index, item in enumerate(items):
            capture = next(c for c in item['captures'] if c['width'] == 390 and c['position'] == 'top')
            image = Image.open(root / 'screenshots' / capture['file']).convert('RGB')
            image.thumbnail((195, 422))
            x, y = (index % 4)*206+5, (index // 4)*490+5
            draw.text((x, y), item['id'][:28], font=font, fill='black')
            draw.text((x, y+19), item['label'][:23], font=font, fill='black')
            sheet.paste(image, (x, y+45))
        sheet.save(root / f'contact-{role}-{part+1}.jpg', quality=88)

cards = []
for record in records:
    links = ''.join(f'<a target="_blank" href="screenshots/{html.escape(c["file"])}">{c["width"]}px {c["position"]}</a>' for c in record.get('captures', []))
    image = next((c['file'] for c in record.get('captures', []) if c['width'] == 390 and c['position'] == 'top'), '')
    max_overflow = max((c['metrics']['mainOverflow'] for c in record.get('captures', [])), default=0)
    depth = max((n['depth'] for c in record.get('captures', []) for n in c['metrics']['nested']), default=0)
    cards.append(f'<article id="{record["id"]}" data-role="{record["role"]}"><h2>{html.escape(record["label"])}</h2><p>{role_names.get(record["role"], record["role"])} · {record["id"]}</p><p>内容区横向溢出 {max_overflow}px · 嵌套候选 {depth} 层（仅辅助定位）</p>{links}<a target="_blank" href="screenshots/{image}"><img loading="lazy" alt="{html.escape(record["label"])}：390px 截图" src="screenshots/{image}"></a>{html.escape(record.get("blocked", ""))}</article>')
(root / 'index.html').write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>手机端布局检查截图</title><style>body{margin:24px;background:#f7f7f7;font:14px system-ui;color:#222}header{position:sticky;top:0;background:#fff;padding:12px;border:1px solid #ddd;z-index:2}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;margin-top:16px}article{background:white;border:1px solid #ddd;padding:12px;min-width:0}h1{font-size:22px}h2{font-size:17px;margin:0}p{font-size:12px;overflow-wrap:anywhere;color:#666}a{display:inline-block;margin:4px 8px 4px 0}img{max-width:100%;width:300px;border:1px solid #eee}select{height:36px}article[hidden]{display:none}</style><header><h1>手机端布局检查 · 2026-11-01</h1><p>390×844 为主，360×800 复查。包括各角色导航、代表性的详情/展开/表单状态。嵌套为自动检测候选，具体问题以检查清单及人工复核为准。</p><a href="REPORT.md">查看检查清单</a><label>角色 <select onchange="document.querySelectorAll('article').forEach(e=>e.hidden=!!this.value&&e.dataset.role!==this.value)"><option value="">全部</option>''' + ''.join(f'<option value="{role}">{role_names.get(role,role)}</option>' for role in roles) + '</select></label></header><main>' + ''.join(cards) + '</main></html>', encoding='utf-8')
print(f'{len(records)} states, {sum(len(r.get("captures", [])) for r in records)} screenshots')
