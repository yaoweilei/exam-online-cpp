"""Generate a reviewable apply_patch diff; do not write application files."""
from pathlib import Path
import difflib

p = Path('frontend/src/viewer/personalCenter.ts')
old = p.read_text(encoding='utf-8')
s = old
def replace(before, after, count=1):
    global s
    assert s.count(before) == count, (before[:100], s.count(before), count)
    s = s.replace(before, after)

# The campus editor is opened explicitly; existing entries populate it by ID.
line = next(x for x in s.splitlines() if x.startswith('\t\treturn `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>校区管理'))
edited = line.replace('<form class="pc-org-add-form" data-org-campus-form', '<details class="pc-campus-editor" data-org-campus-editor><summary>新建或编辑校区</summary><form class="pc-org-add-form" data-org-campus-form')
edited = edited.replace('</form>${usePagedList', '</form></details>${usePagedList')
edited = edited.replace('<label class="pc-org-field"><span>校区ID（更新时填写）</span><input class="pc-profile-input" data-org-campus-id placeholder="留空新建" /></label>', '<input type="hidden" data-org-campus-id />')
edited = edited.replace(' 个校区</span></div>', ' 个校区</span><button class="pc-inline-ghost" type="button" data-org-campus-new data-org-id="${escapeHtml(organization.id)}">＋ 新建</button></div>')
replace(line, edited)
replace('<span>${escapeHtml(businessLabel(campus.status))} · ${escapeHtml(campus.id)}</span></div></div>', '<span>${escapeHtml(businessLabel(campus.status))}</span></div><button type="button" class="pc-inline-ghost" data-org-campus-edit="${escapeHtml(campus.id)}" data-org-id="${escapeHtml(organization.id)}">编辑</button></div>')
replace('<div class="pc-org-subsection-head"><h4>机构角色权限</h4><span>${escapeHtml(organization.name)}</span></div>', '<div class="pc-org-subsection-head"><h4>机构角色权限</h4></div>')
replace('data-org-package-list-page-size><option value="20"', 'data-org-package-list-page-size><option value="10"${assignmentPage.pageSize === 10 ? \' selected\' : \'\'}>10 条</option><option value="20"')

# Each topic has a full-width name and labelled counts on a phone. Native
# details also permits desktop and keyboard users to collapse a category.
replace('<section class="cp-category"><h3>${escapeHtmlSafe(chapterTypeLabel({ section_type: domain }))}</h3>', '<details class="cp-category"${window.innerWidth > 600 || domain === domains.find(value => groups.has(value)) ? \' open\' : \'\'}><summary>${escapeHtmlSafe(chapterTypeLabel({ section_type: domain }))}</summary>')
replace("}).join('')}</div></section>`).join('')}</section>`;", "}).join('')}</div></details>`).join('')}</section>`;")
replace('${count}</button>` : \'<span class="cp-stat-zero">0</span>\';', '${count}<small class="cp-stat-label">${label.replace(\'题目\', \'\')}</small></button>` : `<span class="cp-stat-zero">0<small class="cp-stat-label">${label.replace(\'题目\', \'\')}</small></span>`;')
replace("const row = content.querySelector(`[data-chapter-id=\"${CSS.escape(String(position.chapterId || ''))}\"]`)?.closest('.cp-row');", "const row = content.querySelector(`[data-chapter-id=\"${CSS.escape(String(position.chapterId || ''))}\"]`)?.closest('.cp-row');\n\t\t\tconst category = row?.closest<HTMLDetailsElement>('details.cp-category'); if (category) category.open = true;")

# Remove infrastructure jargon from the product copy.
for before, after in [
    ('看板由机构 dashboard 和 workbench 接口实时汇总。', '查看机构的教学履约、学习趋势与待跟进事项。'),
    ('反馈题目、解析、支付或账号问题，提交后写入反馈接口', '反馈题目、解析、支付或账号问题，并查看处理结果'),
    ('列表来自钱包接口', '查看已兑换的学习权益'),
]:
    if before in s: s = s.replace(before, after)

print('*** Begin Patch')
print('*** Update File: '+p.as_posix())
for line in list(difflib.unified_diff(old.splitlines(),s.splitlines(),lineterm=''))[2:]:
    print('@@' if line.startswith('@@') else line)
print('*** End Patch')
