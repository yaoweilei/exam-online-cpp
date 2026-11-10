from pathlib import Path
import json,html
root=Path(__file__).parent
records=json.loads((root/'checks.json').read_text('utf-8'))
assert len(records)==7
cards=[]
for r in records:
    images=[]
    for kind,width in [('workspace',390),('workspace',540),('workspace',768),('practice',768)]:
        name=f'{r["role"]}-{kind}-{width}.png'
        assert (root/name).exists()
        images.append(f'<figure><figcaption>{kind} · {width}px</figcaption><a href="{name}" target="_blank"><img loading="lazy" src="{name}" alt="{html.escape(r["role"])}"></a></figure>')
    cards.append(f'<section><h2>{html.escape(r["role"])} · {html.escape(r["account"])}</h2><div>'+''.join(images)+'</div></section>')
(root/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>统一账号菜单 · 七角色复查</title><style>body{font:14px system-ui;background:#f7f7f7;margin:16px;color:#26221f}h1{font-size:22px}h2{font-size:16px}section{background:white;padding:12px;margin-block:12px;border:1px solid #ddd}section>div{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0;flex:1 1 250px;max-width:400px}img{width:100%;height:auto}figcaption{font-size:12px;margin-bottom:6px}</style><h1>统一头像菜单 · 2026-11-02</h1><p>七个实际测试账号；两个头像入口内容一致，学习页面额外保留进入当前工作台。每个账号均验证资料与安全返回。</p><a href="../../docs/unified-account-menu-2026-11-02.md">修改记录</a>'+''.join(cards)+'</html>',encoding='utf-8')
print('7 roles / 28 screenshots, all files present')
