#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class InstitutionService
{
  public:
    InstitutionService(infrastructure::storage::AssignmentRepository &assignmentRepository,
                       infrastructure::storage::AnswerRepository &answerRepository,
                       infrastructure::storage::UserRepository &userRepository,
                       infrastructure::storage::ProfileRepository &profileRepository,
                       infrastructure::storage::OrganizationRepository &organizationRepository,
                       infrastructure::storage::ExamRepository &examRepository,
                       std::filesystem::path systemDir);

    Json::Value plans() const;
    Json::Value dashboard(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value teachingWorkbench(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value learningGroupGradebook(const std::string &userId,
                                       const Json::Value &roles,
                                       const std::string &organizationId,
                                       const std::string &learningGroupId) const;
    Json::Value studentProfile(const std::string &viewerUserId,
                               const Json::Value &roles,
                               const std::string &studentId) const;
    Json::Value lessonPrep(const std::string &userId,
                           const Json::Value &roles,
                           const Json::Value &payload) const;
    Json::Value listLessonPrepPlans(const std::string &userId,
                                    const Json::Value &roles,
                                    const std::string &orgId) const;
    Json::Value saveLessonPrepPlan(const std::string &userId,
                                   const Json::Value &roles,
                                   const Json::Value &payload);
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
    Json::Value visibleLearningGroups(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value buildMemberView(const std::string &userId) const;
    Json::Value buildAssignmentProgress(const Json::Value &learningGroup, const Json::Value &assignment) const;
    Json::Value summarizeStudentAnswers(const std::string &studentId) const;
    Json::Value buildWeaknessSummary(const std::vector<Json::Value> &answers) const;
    Json::Value renewalRisk(const std::string &studentId, const std::vector<Json::Value> &answers) const;
    Json::Value buildCoursePackageSummary(const Json::Value &organizations,
                                          const Json::Value &visibleLearningGroups,
                                          const std::string &viewerUserId,
                                          const Json::Value &roles) const;
    Json::Value buildScheduleSummary(const Json::Value &visibleLearningGroups,
                                     const std::string &viewerUserId,
                                     const Json::Value &roles) const;
    Json::Value buildStudentRelationshipSummary(const Json::Value &visibleLearningGroups,
                                                const Json::Value &coursePackages) const;
    Json::Value visibleOrganizations(const std::string &userId, const Json::Value &roles, const std::string &orgId) const;
    Json::Value visibleLessonPrepPlans(const std::string &userId,
                                       const Json::Value &roles,
                                       const Json::Value &organizations) const;
    Json::Value buildSeatSummary(const std::string &orgId, const Json::Value &learningGroups) const;
    Json::Value buildTeacherEffectiveness(const Json::Value &learningGroups) const;
    Json::Value buildClassAverageTrend(const Json::Value &learningGroups) const;
    Json::Value buildSkillWeaknessSummary(const std::vector<std::string> &studentIds) const;
    Json::Value buildStudentWrongTrend(const std::vector<Json::Value> &answers) const;
    Json::Value buildWritingHistory(const std::vector<Json::Value> &answers) const;
    Json::Value buildListeningWeaknesses(const std::vector<Json::Value> &answers) const;
    Json::Value buildQuestionSet(const Json::Value &payload) const;
    Json::Value buildAuditSummary(const std::string &orgId) const;
    Json::Value buildLessonPrepView(const std::string &userId, const Json::Value &payload) const;
    static Json::Value appendOrganizationAuditEntry(Json::Value organization,
                                                    const std::string &actorUserId,
                                                    const std::string &action,
                                                    const std::string &summary,
                                                    const Json::Value &details);
    static Json::Value upsertLessonPrepPlan(Json::Value organization, const Json::Value &plan);
    static std::string buildHandoutHtml(const Json::Value &lessonPrep);

    std::string classifyAnswerRow(const Json::Value &answer, const Json::Value &row, const std::string &resultKey) const;
    std::string examDisplayName(const std::string &examId) const;
    static double readScorePercent(const Json::Value &answer);
    static int readCorrectCount(const Json::Value &answer);
    static int readTotalCount(const Json::Value &answer);
    static std::string answerSavedAt(const Json::Value &answer);
    static bool stringArrayContains(const Json::Value &array, const std::string &value);
    static void appendUnique(Json::Value &array, const std::string &value);
    static bool isActiveEnrollment(const Json::Value &enrollment);
    static bool learningGroupHasUserRole(const Json::Value &learningGroup, const std::string &userId, const std::vector<std::string> &roles);
    static std::vector<std::string> learningGroupStudentIds(const Json::Value &learningGroup);
    static std::vector<std::string> learningGroupStaffIds(const Json::Value &learningGroup);
    static std::string normalizeRoleLabel(const std::string &role);
    static std::string todayDate();
    static int daysSince(const std::string &isoDate);

    infrastructure::storage::AssignmentRepository &assignmentRepository_;
    infrastructure::storage::AnswerRepository &answerRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::ExamRepository &examRepository_;
    std::filesystem::path plansFile_;
};
}  // namespace application::services
