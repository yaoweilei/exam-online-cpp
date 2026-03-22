#pragma once

#include <algorithm>
#include <string>
#include <vector>

#include <json/json.h>

#include "common/AppException.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class UserService
{
  public:
    explicit UserService(infrastructure::storage::UserRepository &repository) : repository_(repository) {}

    Json::Value getUser(const std::string &userId) const
    {
        auto user = repository_.findUserById(userId);
        if (user.isNull())
        {
            throw common::AppException("USER_NOT_FOUND", "User not found: " + userId, drogon::k404NotFound);
        }
        return user;
    }

    Json::Value usersByRole(const std::string &roleId) const
    {
        return repository_.usersByRole(roleId);
    }

    Json::Value allRoles() const
    {
        return repository_.roles();
    }

    Json::Value permissions(const std::string &userId) const
    {
        const auto user = getUser(userId);
        Json::Value roles(Json::arrayValue);
        for (const auto &role : user["roles"])
        {
            roles.append(role.asString());
        }

        Json::Value out(Json::objectValue);
        out["user_id"] = user.get("id", userId).asString();
        out["roles"] = roles;
        out["features"] = visibleFeatures(user["roles"]);
        out["sections"] = visibleSections(user["roles"]);
        return out;
    }

  private:
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

    static Json::Value visibleFeatures(const Json::Value &userRoles)
    {
        Json::Value features(Json::arrayValue);
        auto add = [&](const std::string &id,
                       const std::string &title,
                       const std::string &icon,
                       const std::vector<std::string> &requiredRoles = {}) {
            if (!requiredRoles.empty() && !hasAnyRole(userRoles, requiredRoles))
            {
                return;
            }
            Json::Value item(Json::objectValue);
            item["id"] = id;
            item["title"] = title;
            item["icon"] = icon;
            features.append(item);
        };

        add("recharge", "充值", "💰", {"student", "teacher", "reviewer", "academicAdmin", "systemAdmin", "superAdmin"});
        add("redeem", "兑换", "🎁", {"student", "teacher", "reviewer", "academicAdmin", "systemAdmin", "superAdmin"});
        add("coupons", "卡券", "🎫", {"student", "teacher", "reviewer", "academicAdmin", "systemAdmin", "superAdmin"});
        add("profile", "个人信息", "👤");
        add("community", "加入社群", "💬");
        add("checkin", "集点打卡", "🗓️", {"student", "teacher", "systemAdmin", "superAdmin"});
        add("questions", "题目管理", "🗂️", {"teacher", "academicAdmin", "systemAdmin", "superAdmin"});
        add("approvals", "角色审批", "🛂", {"systemAdmin", "superAdmin"});
        add("stats", "统计", "📊", {"systemAdmin", "superAdmin"});
        add("review", "阅卷审核", "📝", {"reviewer", "systemAdmin", "superAdmin"});
        add("sysFlags", "系统开关", "⚙️", {"superAdmin"});
        add("auditLogs", "审计日志", "📜", {"superAdmin"});
        add("maintenance", "维护模式", "🛠️", {"superAdmin"});
        return features;
    }

    static Json::Value visibleSections(const Json::Value &userRoles)
    {
        Json::Value sections(Json::arrayValue);
        auto add = [&](const std::string &id,
                       const std::string &title,
                       const std::vector<std::string> &requiredRoles = {}) {
            if (!requiredRoles.empty() && !hasAnyRole(userRoles, requiredRoles))
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
        add("roles", "角色权限");
        add("community", "社群");
        add("balance", "账户", {"student", "teacher", "reviewer", "academicAdmin", "systemAdmin", "superAdmin"});
        add("admin-hub", "管理面板", {"teacher", "reviewer", "academicAdmin", "systemAdmin", "superAdmin"});
        add("logout", "退出登录");
        return sections;
    }

  private:
    infrastructure::storage::UserRepository &repository_;
};
}  // namespace application::services
