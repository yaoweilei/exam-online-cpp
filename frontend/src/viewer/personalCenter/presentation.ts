/** Display timestamps in the viewer's timezone; date-only values remain calendar dates. */
export function localDateTime(value: unknown, fallback = '未设置', short = false): string {
  if (!value) return fallback;
  const raw = String(value), date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleString('zh-CN', { ...(short ? {} : { year: 'numeric' as const }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function localDay(value: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function businessLabel(value: unknown): string {
  const raw = String(value || '');
  return ({ active: '正常', inactive: '已停用', disabled: '已停用', suspended: '已暂停', expired: '已到期', personal: '个人', organization: '机构', school: '学校', training: '培训机构', enterprise: '企业', business: '企业' } as Record<string, string>)[raw] || raw;
}
