#pragma once

#include <filesystem>
#include <string>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/ClassroomRepository.h"
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class InstitutionService
{
  public:
    InstitutionService(infrastructure::storage::ClassroomRepository &classroomRepository,
                       infrastructure::storage::AssignmentRepository &assignmentRepository,
                       infrastructure::storage::AnswerRepository &answerRepository,
                       infrastructure::storage::UserRepository &userRepository,
                       infrastructure::storage::ProfileRepository &profileRepository,
                       infrastructure::storage::OrganizationRepository &organizationRepository,
                       infrastructure::storage::ExamRepository &examRepository,
                       std::filesystem::path systemDir);

    Json::Value plans() const;
    Json::Value dashboard(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value classGradebook(const std::string &userId,
                               const Json::Value &roles,
                               const std::string &classId) const;
    Json::Value studentProfile(const std::string &viewerUserId,
                               const Json::Value &roles,
                               const std::string &studentId) const;
    Json::Value lessonPrep(const std::string &userId,
                           const Json::Value &roles,
                           const Json::Value &payload) const;
    Json::Value bulkImportPreview(const std::string &userId,
                                  const Json::Value &roles,
                                  const std::string &orgId,
                                  const std::string &rawText) const;

  private:
    bool canManageInstitution(const Json::Value &roles) const;
    bool canTeach(const Json::Value &roles) const;
    bool canViewStudent(const std::string &viewerUserId,
                        const Json::Value &roles,
                        const std::string &studentId) const;
    Json::Value activePlanForOrg(const std::string &orgId) const;
    bool featureEnabledForOrg(const std::string &orgId, const std::string &featureKey) const;
    void requireInstitutionFeature(const std::string &orgId,
                                   const std::string &featureKey,
                                   const std::string &message) const;
    Json::Value visibleClassrooms(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value buildMemberView(const std::string &userId) const;
    Json::Value buildAssignmentProgress(const Json::Value &classroom, const Json::Value &assignment) const;
    Json::Value summarizeStudentAnswers(const std::string &studentId) const;
    Json::Value buildWeaknessSummary(const std::vector<Json::Value> &answers) const;
    Json::Value renewalRisk(const std::string &studentId, const std::vector<Json::Value> &answers) const;
    Json::Value buildSeatSummary(const std::string &orgId, const Json::Value &classes) const;
    Json::Value buildTeacherEffectiveness(const Json::Value &classes) const;
    Json::Value buildQuestionSet(const Json::Value &payload) const;
    Json::Value buildAuditSummary(const std::string &orgId) const;
    static std::string buildHandoutHtml(const Json::Value &lessonPrep);

    static double readScorePercent(const Json::Value &answer);
    static int readCorrectCount(const Json::Value &answer);
    static int readTotalCount(const Json::Value &answer);
    static std::string answerSavedAt(const Json::Value &answer);
    static bool stringArrayContains(const Json::Value &array, const std::string &value);
    static void appendUnique(Json::Value &array, const std::string &value);
    static std::string normalizeRoleLabel(const std::string &role);
    static std::string todayDate();
    static int daysSince(const std::string &isoDate);

    infrastructure::storage::ClassroomRepository &classroomRepository_;
    infrastructure::storage::AssignmentRepository &assignmentRepository_;
    infrastructure::storage::AnswerRepository &answerRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::ExamRepository &examRepository_;
    std::filesystem::path plansFile_;
};
}  // namespace application::services
