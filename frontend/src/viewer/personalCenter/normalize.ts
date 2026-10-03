/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PCSubscription, PCReferral, PendingOrganizationInvitation } from './types.js';
import { asRecord, readBoolean, readCount, readString, readStringArray } from './utils.js';

export function normalizeSubscription(value: unknown): PCSubscription | undefined {
	const raw = asRecord(value);
	if (!raw) {
		return undefined;
	}
	const rawAccess = asRecord(raw.entitlementAccess) || asRecord(raw.entitlement_access);
	const entitlementAccess: NonNullable<PCSubscription['entitlementAccess']> = {};
	if (rawAccess) {
		for (const [key, value] of Object.entries(rawAccess)) {
			const decision = asRecord(value);
			const granted = decision ? readBoolean(decision.granted) : undefined;
			if (!decision || granted === undefined) {
				continue;
			}
			entitlementAccess[key] = {
				granted,
				requiredPlan: readString(decision.requiredPlan) || readString(decision.required_plan)
			};
		}
	}
	return {
		plan: readString(raw.plan) || 'free',
		effectivePlan: readString(raw.effectivePlan) || readString(raw.effective_plan),
		status: readString(raw.status) || 'active',
		expiresAt: readString(raw.expiresAt) || readString(raw.expires_at) || '',
		seats: readCount(raw.seats),
		isActive: readBoolean(raw.isActive) ?? readBoolean(raw.is_active),
		entitlements: readStringArray(raw.entitlements),
		entitlementAccess: rawAccess ? entitlementAccess : undefined
	};
}

export function normalizeReferral(value: unknown): PCReferral | undefined {
	const raw = asRecord(value);
	if (!raw) {
		return undefined;
	}
	const code = readString(raw.code) || readString(raw.referral_code) || '';
	const rewardRecordsRaw = Array.isArray(raw.inviteRewardRecords)
		? raw.inviteRewardRecords
		: Array.isArray(raw.invite_reward_records)
			? raw.invite_reward_records
			: [];
	const inviteRewardRecords = rewardRecordsRaw.flatMap((value) => {
		const record = asRecord(value);
		if (!record) return [];
		const id = readString(record.id);
		const amountCents = readCount(record.amountCents) ?? readCount(record.amount_cents) ?? 0;
		if (!id || amountCents <= 0) return [];
		return [{
			id,
			inviteeLabel: readString(record.inviteeLabel) || readString(record.invitee_label) || '受邀用户',
			amountCents,
			currency: readString(record.currency) || 'cny',
			status: readString(record.status) || 'granted',
			grantedAt: readString(record.grantedAt) || readString(record.granted_at) || ''
		}];
	});
	return {
		code,
		hasReferrer: readBoolean(raw.hasReferrer) ?? readBoolean(raw.has_referrer) ?? Boolean(readString(raw.referredByCode) || readString(raw.referred_by_code)),
		referredByCode: readString(raw.referredByCode) || readString(raw.referred_by_code),
		boundAt: readString(raw.boundAt) || readString(raw.bound_at),
		rewardStatus: readString(raw.rewardStatus) || readString(raw.reward_status) || (code ? 'none' : undefined),
		rewardGrantedAt: readString(raw.rewardGrantedAt) || readString(raw.reward_granted_at),
		rewardCreditAmount: readCount(raw.rewardCreditAmount) ?? readCount(raw.reward_credit_amount),
		rewardAmountCents: readCount(raw.rewardAmountCents) ?? readCount(raw.reward_amount_cents),
		rewardCurrency: readString(raw.rewardCurrency) || readString(raw.reward_currency),
		rewardCreditRecipientUserId: readString(raw.rewardCreditRecipientUserId) || readString(raw.reward_credit_recipient_user_id),
		inviteRewardCount: readCount(raw.inviteRewardCount) ?? readCount(raw.invite_reward_count) ?? inviteRewardRecords.length,
		inviteRewardEarnedCents: readCount(raw.inviteRewardEarnedCents) ?? readCount(raw.invite_reward_earned_cents) ?? inviteRewardRecords.reduce((sum, item) => sum + item.amountCents, 0),
		inviteRewardRecords
	};
}

export function normalizePendingInvitation(value: unknown): PendingOrganizationInvitation | null {
	const raw = asRecord(value);
	if (!raw) {
		return null;
	}
	const invitationId = readString(raw.invitation_id) || '';
	const inviteToken = readString(raw.invite_token) || readString(raw.invite_code) || '';
	const organizationId = readString(raw.organization_id) || '';
	if (!invitationId || !inviteToken || !organizationId) {
		return null;
	}
	return {
		invitationId,
		inviteToken,
		organizationId,
		organizationName: readString(raw.organization_name) || '未命名组织',
		organizationType: readString(raw.organization_type),
		channel: (readString(raw.channel) || 'email') as 'email' | 'phone',
		contact: readString(raw.contact) || readString(raw.email) || readString(raw.phone) || '',
		roles: readStringArray(raw.roles) || ['student'],
		message: readString(raw.message) || '',
		createdAt: readString(raw.created_at) || '',
		expiresAt: readString(raw.expires_at) || '',
		createdByUsername: readString(raw.created_by_username) || readString(raw.created_by),
		deliveryStatus: readString(raw.delivery_status),
		deliveryProvider: readString(raw.delivery_provider),
		deliveredAt: readString(raw.delivered_at),
		contactMatches: readBoolean(raw.contact_matches) ?? false,
		contactVerified: readBoolean(raw.contact_verified) ?? false,
		canAccept: readBoolean(raw.can_accept) ?? false,
		isExpired: readBoolean(raw.is_expired) ?? false,
		acceptBlockCode: readString(raw.accept_block_code),
		acceptBlockMessage: readString(raw.accept_block_message),
		acceptUrl: readString(raw.accept_url)
	};
}
