export interface EntitlementDecision {
	granted: boolean;
	known: boolean;
	requiredPlan?: string;
}

export interface EntitlementSource {
	entitlements?: string[];
	entitlementAccess?: Record<string, {
		granted: boolean;
		requiredPlan?: string;
	}>;
}

/**
 * The server is the source of truth. Missing entitlement data is treated as
 * unknown (UI fail-open for backward compatibility); protected APIs still
 * enforce the decision server-side.
 */
export function resolveEntitlement(
	source: EntitlementSource | undefined,
	entitlementKey: string
): EntitlementDecision {
	const explicit = source?.entitlementAccess?.[entitlementKey];
	if (explicit) {
		return {
			granted: explicit.granted,
			known: true,
			requiredPlan: explicit.requiredPlan
		};
	}
	if (Array.isArray(source?.entitlements)) {
		return {
			granted: source.entitlements.includes(entitlementKey),
			known: true
		};
	}
	return { granted: true, known: false };
}

export function hasEntitlement(
	source: EntitlementSource | undefined,
	entitlementKey: string
): boolean {
	return resolveEntitlement(source, entitlementKey).granted;
}
