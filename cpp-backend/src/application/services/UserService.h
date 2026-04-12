#pragma once

#include <algorithm>
#include <string>
#include <unordered_set>
#include <vector>

#include <json/json.h>

#include "common/AppException.h"
#include "application/services/SubscriptionService.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class UserService
{
  public:
    explicit UserService(
        infrastructure::storage::UserRepository &repository,
        infrastructure::storage::ProfileRepository &profileRepository,
        SubscriptionService &subscriptionService)
        : repository_(repository), profileRepository_(profileRepository), subscriptionService_(subscriptionService)
    {
    }

    Json::Value getUser(const std::string &userId) const
    {
        return buildUserView(requireUser(userId));
    }

    Json::Value usersByRole(const std::string &roleId) const
    {
        Json::Value out(Json::arrayValue);
        const auto users = repository_.usersByRole(roleId);
        for (const auto &user : users)
        {
            out.append(buildUserView(user));
        }
        return out;
    }

    Json::Value allRoles() const
    {
        return repository_.roles();
    }

    Json::Value permissions(const std::string &userId) const
    {
        const auto user = requireUser(userId);
        const auto subscription = subscriptionService_.currentSubscription(userId);
        Json::Value out(Json::objectValue);
        out["user_id"] = user.get("id", userId).asString();
        out["roles"] = user["roles"];
        out["subscription"] = subscription;
        out["features"] = visibleFeatures(user["roles"], subscription);
        out["sections"] = visibleSections(user["roles"], subscription);
        return out;
    }

    Json::Value context(const std::string &userId) const
    {
        const auto user = requireUser(userId);
        const auto profile = profileRepository_.loadProfile(userId);
        const auto subscription = subscriptionService_.currentSubscription(userId);

        Json::Value out(Json::objectValue);
        out["user"] = buildUserView(user);
        out["profile"] = profile;

        Json::Value membership(Json::objectValue);
        membership["user_id"] = userId;
        membership["scope_type"] = profile.get("scope_type", user.get("scope_type", "personal")).asString();
        membership["scope_id"] = profile.get("scope_id", user.get("scope_id", userId)).asString();
        membership["organization_type"] = profile.get("organization_type", user.get("organization_type", "")).asString();
        membership["roles"] = user["roles"];
        out["membership"] = membership;
        out["subscription"] = subscription;
        out["permissions"] = permissions(userId);
        return out;
    }

  private:
    Json::Value requireUser(const std::string &userId) const
    {
        auto user = repository_.findUserById(userId);
        if (user.isNull())
        {
            throw common::AppException("USER_NOT_FOUND", "User not found: " + userId, drogon::k404NotFound);
        }
        return user;
    }

    static bool hasAnyRole(const Json::Value &userRoles, const std::vector<std::string> &requiredRoles)
    {
        for (const auto &item : userRoles)
        {
            const auto role = item.asString();
            if (std::find(requiredRoles.begin(), requiredRoles.end(), role) != requiredRoles.end())
            {
                return true;
            }
        }
        return false;
    }

    static bool hasEntitlement(const Json::Value &entitlements, const std::string &required)
    {
        for (const auto &item : entitlements)
        {
            if (item.asString() == required)
            {
                return true;
            }
        }
        return false;
    }

    Json::Value buildUserView(const Json::Value &user) const
    {
        const auto userId = user.get("id", "").asString();
        const auto profile = profileRepository_.loadProfile(userId);
        const auto subscription = subscriptionService_.currentSubscription(userId);

        Json::Value out(Json::objectValue);
        out["id"] = userId;
        out["user_id"] = userId;
        out["username"] = user.get("username", "").asString();
        out["email"] = user.get("email", "").asString();
        out["phone"] = user.get("phone", "").asString();
        out["phone_verified"] = user.get("phone_verified", false).asBool();
        out["status"] = user.get("status", "active").asString();
        out["created_at"] = user.get("created_at", "").asString();
        out["roles"] = user["roles"];
        out["role_ids"] = user["roles"];
        out["roleIds"] = user["roles"];
        out["display_name"] = profile.get("display_name", "").asString();
        out["displayName"] = profile.get("display_name", "").asString();
        out["avatar_url"] = profile.get("avatar_url", "").asString();
        out["avatar"] = profile.get("avatar_url", "").asString();
        out["locale"] = profile.get("locale", "zh-CN").asString();
        out["goal_level"] = profile.get("goal_level", "").asString();
        out["goal_date"] = profile.get("goal_date", "").asString();
        out["daily_target"] = profile.get("daily_target", 20).asInt();
        out["last_active_at"] = profile.get("last_active_at", "").asString();
        out["lastLoginAt"] = profile.get("last_active_at", "").asString();
        out["scope_type"] = profile.get("scope_type", user.get("scope_type", "personal")).asString();
        out["scope_id"] = profile.get("scope_id", user.get("scope_id", userId)).asString();
        out["organization_type"] = profile.get("organization_type", user.get("organization_type", "")).asString();
        out["subscription"] = subscription;
        out["plan"] = subscription.get("plan", "free").asString();
        out["plan_status"] = subscription.get("status", "active").asString();
        out["plan_expires_at"] = subscription.get("expires_at", "").asString();
        out["entitlements"] = subscription["entitlements"];
        out["accessible_levels"] = subscription["accessible_levels"];
        out["accessibleLevels"] = subscription["accessible_levels"];
        out["balance"] = buildBalance(profile);
        return out;
    }

    static Json::Value buildBalance(const Json::Value &profile)
    {
        Json::Value balance(Json::objectValue);
        balance["credits"] = profile.get("credits", 0).asInt();
        balance["updated_at"] = profile.get("last_active_at", "").asString();
        balance["updatedAt"] = profile.get("last_active_at", "").asString();
        return balance;
    }

    static Json::Value visibleFeatures(const Json::Value &userRoles, const Json::Value &subscription)
    {
        Json::Value features(Json::arrayValue);
        const auto &entitlements = subscription["entitlements"];
        auto add = [&](const std::string &id,
                       const std::string &title,
                       const std::string &icon,
                       const std::vector<std::string> &requiredRoles = {},
                       const std::string &requiredEntitlement = "") {
            if (!requiredRoles.empty() && !hasAnyRole(userRoles, requiredRoles))
            {
                return;
            }
            if (!requiredEntitlement.empty() && !hasEntitlement(entitlements, requiredEntitlement))
            {
                return;
            }
            Json::Value item(Json::objectValue);
            item["id"] = id;
            item["title"] = title;
            item["icon"] = icon;
            features.append(item);
        };

        add("profile", "个人信息", "👤");
        add("subscription", "套餐与权益", "⭐");
        add("community", "加入社群", "💬");
        add("bookmarks", "收藏与错题", "📚", {"student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"}, "bookmark");
        add("stats", "学习统计", "📊", {"student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"}, "weak_points");
        add("recommendation", "推荐练习", "🎯", {"student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"}, "recommendation");
        add("training", "专项训练", "🚀", {"student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"}, "training.specialized");
        add("questions", "题目管理", "🗂️", {"teacher", "orgAdmin", "systemAdmin", "superAdmin"});
        add("review", "阅卷审核", "📝", {"reviewer", "systemAdmin", "superAdmin"});
        add("memberAdmin", "成员管理", "👥", {"orgAdmin", "systemAdmin", "superAdmin"});
        add("sysFlags", "系统开关", "⚙️", {"superAdmin"});
        return features;
    }

    static Json::Value visibleSections(const Json::Value &userRoles, const Json::Value &subscription)
    {
        Json::Value sections(Json::arrayValue);
        auto add = [&](const std::string &id,
                       const std::string &title,
                       const std::vector<std::string> &requiredRoles = {},
                       const std::string &requiredEntitlement = "") {
            if (!requiredRoles.empty() && !hasAnyRole(userRoles, requiredRoles))
            {
                return;
            }
            if (!requiredEntitlement.empty() && !hasEntitlement(subscription["entitlements"], requiredEntitlement))
            {
                return;
            }
            Json::Value item(Json::objectValue);
            item["id"] = id;
            item["title"] = title;
            sections.append(item);
        };

        add("dashboard", "概览");
        add("profile", "个人资料");
        add("subscription", "套餐");
        add("roles", "角色权限");
        add("learning", "学习能力", {"student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"});
        add("admin-hub", "管理面板", {"teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"});
        add("logout", "退出登录");
        return sections;
    }

  private:
    infrastructure::storage::UserRepository &repository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    SubscriptionService &subscriptionService_;
};
}  // namespace application::services
