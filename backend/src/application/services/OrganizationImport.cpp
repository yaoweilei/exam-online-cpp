#include "OrganizationService.h"
#include <mutex>
#include <set>

namespace application::services
{
namespace
{
std::mutex importMutex;
std::string trimCell(std::string text)
{
    const auto a = text.find_first_not_of(" \t\r\n"), b = text.find_last_not_of(" \t\r\n");
    return a == std::string::npos ? "" : text.substr(a, b - a + 1);
}
std::vector<std::string> csvCells(const std::string &line)
{
    std::vector<std::string> cells; std::string cell; bool quoted = false;
    for (size_t i = 0; i < line.size(); ++i)
    {
        if (line[i] == '"') { if (quoted && i + 1 < line.size() && line[i + 1] == '"') { cell += '"'; ++i; } else quoted = !quoted; }
        else if (line[i] == ',' && !quoted) { cells.push_back(trimCell(cell)); cell.clear(); }
        else cell += line[i];
    }
    if (quoted) return {};
    cells.push_back(trimCell(cell)); return cells;
}
}

Json::Value OrganizationService::importStudents(const std::string &actorUserId, const std::string &organizationId, const std::string &text, bool commit)
{
    std::lock_guard lock(importMutex);
    requireOrganization(organizationId);
    if (text.empty() || text.size() > 65536)
        throw common::AppException("VALIDATION_ERROR", "请填写学员信息，每批最多 100 行、64KB", drogon::k422UnprocessableEntity);
    // Validate the whole batch size before committing any row.
    std::istringstream preflight(text); std::string checkedLine; int checkedRows = 0;
    while (std::getline(preflight, checkedLine))
        if (!trimCell(checkedLine).empty() && ++checkedRows > 100)
            throw common::AppException("VALIDATION_ERROR", "每批最多导入 100 行", drogon::k422UnprocessableEntity);
    std::istringstream input(text); std::string line; std::set<std::string> seenContacts, seenUsers;
    Json::Value out(Json::objectValue); out["rows"] = Json::arrayValue;
    int rowNumber = 0, valid = 0, added = 0, invited = 0, skipped = 0, failed = 0;
    while (std::getline(input, line))
    {
        if (trimCell(line).empty()) continue;
        if (++rowNumber > 100) throw common::AppException("VALIDATION_ERROR", "每批最多导入 100 行", drogon::k422UnprocessableEntity);
        const auto cells = csvCells(line);
        Json::Value row(Json::objectValue); row["row"] = rowNumber; row["raw"] = line; row["action"] = "error";
        row["name"] = cells.empty() ? "" : cells[0]; row["valid"] = false;
        try
        {
            if (cells.size() < 3 || cells.size() > 4 || cells[0].empty() || cells[0].size() > 120 ||
                (cells.size() == 4 && cells[3] != "" && cells[3] != "student" && cells[3] != "学员" && cells[3] != "学生"))
                throw std::runtime_error("格式应为：姓名,邮箱,手机,student；职员请从成员设置授权");
            const auto email = cells[1], phone = cells[2]; row["email"] = email; row["phone"] = phone;
            if (email.empty() && phone.empty()) throw std::runtime_error("请至少填写邮箱或手机");
            if (!email.empty() && (email.size() > 254 || email.find('@') == std::string::npos || email.find(' ') != std::string::npos))
                throw std::runtime_error("邮箱格式不正确");
            if (!phone.empty() && (phone.size() < 7 || phone.size() > 20 || !std::all_of(phone.begin(), phone.end(), [](char c) { return (c >= '0' && c <= '9') || c == '+'; })))
                throw std::runtime_error("手机格式不正确");
            auto byEmail = email.empty() ? Json::Value(Json::nullValue) : userRepository_.findUserByEmail(email);
            auto byPhone = phone.empty() ? Json::Value(Json::nullValue) : userRepository_.findUserByPhone(phone);
            if (!byEmail.isNull() && !byPhone.isNull() && byEmail["id"] != byPhone["id"]) throw std::runtime_error("邮箱与手机对应不同账号，请核对");
            const auto user = byEmail.isNull() ? byPhone : byEmail;
            const auto userId = user.isNull() ? "" : user["id"].asString();
            if (!user.isNull() && user.get("status", "active").asString() != "active") throw std::runtime_error("账号已停用，请先核查");
            const auto contact = !email.empty() ? "email:" + email : "phone:" + phone;
            const bool duplicate = !seenContacts.insert(contact).second || (!userId.empty() && !seenUsers.insert(userId).second);
            bool already = !userId.empty() && !organizationRepository_.findMembership(userId, organizationId).isNull();
            bool pending = false;
            const auto currentOrganization = requireOrganization(organizationId);
            for (const auto &invite : currentOrganization["invitations"])
                if (invite.get("status", "").asString() == "pending" &&
                    ((!email.empty() && invite.get("email", "").asString() == email) || (!phone.empty() && invite.get("phone", "").asString() == phone)))
                    pending = true;
            row["action"] = duplicate || already || pending ? "skip" : userId.empty() ? "invite" : "add";
            row["message"] = duplicate ? "本批次重复，已跳过" : already ? "已是机构成员，保持原角色" : pending ? "已有待接受邀请，已跳过" : userId.empty() ? "确认后创建加入邀请" : "确认后添加已有账号";
            row["valid"] = true; ++valid;
            if (!userId.empty()) row["matched_username"] = user.get("username", "");
            if (row["action"].asString() == "skip") ++skipped;
            else if (commit)
            {
                Json::Value payload(Json::objectValue); payload["roles"] = Json::arrayValue; payload["roles"].append("student");
                if (!userId.empty())
                {
                    payload["user_id"] = userId; upsertMember(actorUserId, organizationId, payload);
                    row["action"] = "added"; row["message"] = "已添加"; ++added;
                }
                else
                {
                    payload["channel"] = email.empty() ? "phone" : "email"; payload["contact"] = email.empty() ? phone : email;
                    payload["email"] = email; payload["phone"] = phone; payload["message"] = "邀请 " + cells[0] + " 加入机构";
                    const auto invitation = createInvitation(actorUserId, organizationId, payload);
                    row["action"] = "invited"; row["delivery_status"] = invitation["delivery_status"];
                    row["message"] = invitation.get("delivery_status", "").asString() == "delivered" ? "邀请已发送" : "邀请已创建，可到成员邀请中查看发送状态";
                    ++invited;
                }
            }
        }
        catch (const std::exception &error) { row["action"] = "error"; row["valid"] = false; row["message"] = error.what(); ++failed; }
        out["rows"].append(row);
    }
    out["summary"]["total"] = rowNumber; out["summary"]["valid_count"] = valid; out["summary"]["added"] = added;
    out["summary"]["invited"] = invited; out["summary"]["skipped"] = skipped; out["summary"]["failed"] = failed;
    out["committed"] = commit;
    return out;
}
}
