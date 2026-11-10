from pathlib import Path
import difflib
changes=[]
def emit(p,old,new):
    if old==new:return
    diff=list(difflib.unified_diff(old.splitlines(),new.splitlines(),lineterm=''))[2:]
    changes.append('*** Update File: '+p.as_posix()+'\n'+'\n'.join('@@' if line.startswith('@@') else line for line in diff))
p=Path('frontend/src/viewer/personalCenter/institutionWorkflow.ts');old=p.read_text('utf-8');s=old
a="return '<div data-flow-attendance=\"' + h(id) + '\"><strong>' + h(name(student))"
b="return '<details class=\"pc-attendance-person\" data-flow-attendance=\"' + h(id) + '\"><summary><strong>' + h(name(student))"
assert s.count(a)==1;s=s.replace(a,b)
a="+ '</strong><label>出勤<select class=\"pc-profile-input\" data-attendance-status>'"
b="+ '</strong><span data-attendance-summary>' + (leaveRequest ? '请假' : '出勤') + ' · 扣 ' + (packages.length && !leaveRequest ? 1 : 0) + ' 次</span></summary><div class=\"pc-attendance-fields\"><label>出勤<select class=\"pc-profile-input\" data-attendance-status>'"
assert s.count(a)==1;s=s.replace(a,b)
a="+ (packages.length && !leaveRequest ? 1 : 0) + '\"/></label></div>';"
b="+ (packages.length && !leaveRequest ? 1 : 0) + '\"/></label></div></details>';"
assert s.count(a)==1;s=s.replace(a,b)
emit(p,old,s)
p=Path('frontend/src/viewer/personalCenter.ts');old=p.read_text('utf-8');s=old
a='<div class="pc-card pc-info-card pc-avatar-picker-card">\n\t\t\t\t<div class="pc-service-header">头像选择'
b='<details class="pc-card pc-info-card pc-avatar-picker-card">\n\t\t\t\t<summary class="pc-service-header">头像选择'
assert s.count(a)==1;s=s.replace(a,b)
a='dicebear.com</a></span></div>\n\t\t\t\t<div class="pc-avatar-style-grid">'
b='dicebear.com</a></span></summary>\n\t\t\t\t<div class="pc-avatar-style-grid">'
assert s.count(a)==1;s=s.replace(a,b)
a='\t\t\t</div>\n\t\t\t${isPlatformAdmin ? \'\' : `<div class="pc-card pc-info-card pc-profile-identity-card">'
b='\t\t\t</details>\n\t\t\t${isPlatformAdmin ? \'\' : `<div class="pc-card pc-info-card pc-profile-identity-card">'
assert s.count(a)==1;s=s.replace(a,b)
emit(p,old,s)
print('*** Begin Patch\n'+'\n'.join(changes)+'\n*** End Patch')
