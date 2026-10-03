export type GuestTrialKind = 'experience' | 'jlpt' | 'eju';

const PRACTICE_KEY = 'japanese.pending-practice-results.v1';
const EXPERIENCE_KEY = 'japanese.guest-experience.v1';
const RECORD_LIFETIME = 7 * 86400000;
const KINDS: GuestTrialKind[] = ['experience', 'jlpt', 'eju'];

export type GuestPracticeRecord = {
	exam_id: string;
	label: string;
	section_indexes: number[];
	answers: Record<string, unknown>;
	created_at: number;
	submission_id: string;
	owner_id?: string;
};

type ExperienceRecord = { checked?: boolean; savedAt?: number; id?: string; sample?: number; answer?: number };
type SavedExperience = ExperienceRecord & { completed?: ExperienceRecord[] };

function isRecent(value: unknown): boolean {
	const age = Date.now() - Number(value);
	return Number.isFinite(age) && age >= 0 && age < RECORD_LIFETIME;
}

export function practiceTrialKind(examId: string, family = ''): GuestTrialKind {
	return family.toLowerCase() === 'eju' || /^EJU(?:_|-)/i.test(examId) || /^20\d{2}[_-]\d{2}$/.test(examId) ? 'eju' : 'jlpt';
}

export function guestPracticeRecords(): GuestPracticeRecord[] {
	const stored = localStorage.getItem(PRACTICE_KEY);
	let parsed: unknown;
	try { parsed = JSON.parse(stored || '[]'); } catch { return []; }
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((record): record is GuestPracticeRecord =>
		record && !record.owner_id && typeof record.exam_id === 'string' && Array.isArray(record.section_indexes)
		&& typeof record.submission_id === 'string' && record.submission_id.length > 0
		&& isRecent(record.created_at));
}

function guestExperienceRecords(): ExperienceRecord[] {
	const stored = localStorage.getItem(EXPERIENCE_KEY);
	let saved: SavedExperience | null;
	try { saved = JSON.parse(stored || 'null') as SavedExperience | null; } catch { return []; }
	if (!saved || typeof saved !== 'object' || !isRecent(saved.savedAt)) return [];
	return [saved, ...(Array.isArray(saved.completed) ? saved.completed : [])].filter(
		(record) => record?.checked === true && typeof record.id === 'string' && record.id.length > 0
			&& (record.sample === 0 || record.sample === 1) && Number.isInteger(record.answer)
			&& Number(record.answer) >= 1 && Number(record.answer) <= 4 && isRecent(record.savedAt)
	);
}

function activeRecords(): Partial<Record<GuestTrialKind, string>> {
	const active: Partial<Record<GuestTrialKind, string>> = {};
	for (const record of guestPracticeRecords()) {
		const kind = practiceTrialKind(record.exam_id);
		active[kind] ||= `practice:${record.submission_id}`;
	}
	const experience = guestExperienceRecords()[0];
	if (experience) active.experience = `experience:${experience.id}`;
	return active;
}

export function guestTrialStatus(kind?: GuestTrialKind): { used: number; remaining: number; storageAvailable: boolean } {
	try {
		const records = activeRecords();
		const used = kind ? Number(Boolean(records[kind])) : KINDS.filter((item) => Boolean(records[item])).length;
		return { used, remaining: (kind ? 1 : KINDS.length) - used, storageAvailable: true };
	} catch {
		return { used: kind ? 1 : KINDS.length, remaining: 0, storageAvailable: false };
	}
}

// The stored result is the quota. A result that was transferred or expired no longer consumes a guest trial.
export function consumeGuestTrial(kind: GuestTrialKind, id: string): boolean {
	try {
		const existing = activeRecords()[kind];
		return !existing || existing === id;
	} catch {
		return false;
	}
}

(window as Window & { GuestTrialQuota?: { guestTrialStatus: typeof guestTrialStatus; consumeGuestTrial: typeof consumeGuestTrial } }).GuestTrialQuota = {
	guestTrialStatus,
	consumeGuestTrial
};
