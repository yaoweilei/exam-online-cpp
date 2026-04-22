/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *  Type-only definitions for the personal center module.
 *--------------------------------------------------------------------------------------------*/

export interface PCBalance {
	credits: number;
	updatedAt: string;
}

export interface PCSubscription {
	plan: string;
	status: string;
	expiresAt: string;
	seats?: number;
}

export interface PCReferral {
	code: string;
	hasReferrer: boolean;
	referredByCode?: string;
	boundAt?: string;
	rewardStatus?: string;
	rewardGrantedAt?: string;
	rewardCreditAmount?: number;
	rewardCreditRecipientUserId?: string;
}

export interface PCUser {
	id: string;
	displayName: string;
	username?: string;
	memberNo?: string;
	roleIds: string[];
	balance?: PCBalance;
	email?: string;
	emailVerified?: boolean;
	phone?: string;
	phoneVerified?: boolean;
	avatar?: string | null;
	lastLoginAt?: string;
	status?: string;
	accessibleLevels?: string[];
	subscription?: PCSubscription;
	referral?: PCReferral;
	xp?: number;
	streakDays?: number;
	couponCount?: number;
	planExpiresAt?: string;
	scopeType?: string;
	organizationType?: string;
	organizationId?: string;
	organizationName?: string;
}

export interface PCContext {
	guest: boolean;
	id?: string;
	displayName?: string;
	username?: string;
	memberNo?: string;
	roles?: string[];
	balance?: PCBalance;
	email?: string;
	emailVerified?: boolean;
	phone?: string;
	phoneVerified?: boolean;
	avatar?: string | null;
	lastLoginAt?: string;
	status?: string;
	accessibleLevels?: string[];
	subscription?: PCSubscription;
	referral?: PCReferral;
	xp?: number;
	streakDays?: number;
	couponCount?: number;
	planExpiresAt?: string;
	scopeType?: string;
	organizationType?: string;
	token?: string;
	organizationId?: string;
	organizationName?: string;
}

export interface PCContextManager {
	getUserContext: () => PCContext;
	setUserContext: (ctx: PCContext) => void;
}

export interface ManagedOrganizationMember {
	userId: string;
	username: string;
	memberNo?: string;
	roles: string[];
	status?: string;
}

export interface ManagedOrganizationInvitation {
	invitationId: string;
	inviteToken: string;
	channel: 'email' | 'phone';
	contact: string;
	status: string;
	deliveryStatus?: string;
	deliveryProvider?: string;
	deliveryMessageId?: string;
	deliveryError?: string;
	deliveredAt?: string;
	roles: string[];
	memberNo?: string;
	message?: string;
	createdAt: string;
	expiresAt: string;
}

export interface PendingOrganizationInvitation {
	invitationId: string;
	inviteToken: string;
	organizationId: string;
	organizationName: string;
	organizationType?: string;
	channel: 'email' | 'phone';
	contact: string;
	roles: string[];
	message?: string;
	createdAt: string;
	expiresAt: string;
	createdByUsername?: string;
	deliveryStatus?: string;
	deliveryProvider?: string;
	deliveredAt?: string;
	contactMatches: boolean;
	contactVerified: boolean;
	canAccept: boolean;
	isExpired: boolean;
	acceptBlockCode?: string;
	acceptBlockMessage?: string;
	acceptUrl?: string;
}

export interface ManagedOrganizationAuditLog {
	auditId: string;
	action: string;
	summary: string;
	actorUsername: string;
	createdAt: string;
	detailText: string;
}

export interface ManagedOrganization {
	id: string;
	name: string;
	organizationType?: string;
	memberCount: number;
	seats: number;
	plan: string;
	status: string;
	expiresAt?: string;
	members: ManagedOrganizationMember[];
	invitations: ManagedOrganizationInvitation[];
	auditLogs: ManagedOrganizationAuditLog[];
}

export interface OrganizationMemberDraft {
	searchQuery: string;
	searchResults: PCUser[];
	selectedUserId: string;
	memberNo: string;
	batchText: string;
	inviteContact: string;
	inviteMemberNo: string;
	inviteMessage: string;
}

export interface ContactVerificationDraft {
	email: string;
	emailCode: string;
	phone: string;
	phoneCode: string;
	changeChallengeChannel: '' | 'email' | 'phone';
	changeChallengeCode: string;
}

export type ContactVerificationKind = 'email' | 'phone';

export interface SectionDef {
	id: 'dashboard' | 'profile' | 'roles' | 'community' | 'balance' | 'admin-hub' | 'system-flags' | 'logout';
	title: string;
	gate: (ctx: PCContext) => boolean;
	nav?: boolean;
}

export interface SystemFlag {
	key: string;
	value: boolean;
	risk: 'low' | 'medium' | 'high';
	desc: string;
}

export interface FeatureItem {
	id: string;
	title: string;
	icon: string;
	intent: string;
	gate: (ctx: PCContext) => boolean;
}

export interface RoleDef {
	id: string;
	name: string;
	desc: string;
	risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface AvatarPreset {
	id: string;
	label: string;
	role: string;
	avatarUrl: string;
}

export interface AvatarPalette {
	bg: string;
	hair: string;
	shirt: string;
	skin: string;
	accent: string;
	line: string;
}

export interface AvatarSeed {
	id: string;
	label: string;
	role: string;
	hairStyle: 'short' | 'part' | 'bob' | 'buzz' | 'wave' | 'cap';
	accessory: 'none' | 'glasses' | 'badge' | 'star' | 'book' | 'bolt' | 'leaf' | 'ribbon';
	palette: AvatarPalette;
}
