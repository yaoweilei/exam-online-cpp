#pragma once

#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"

namespace application::services
{
class AssignmentService
{
  public:
    AssignmentService(infrastructure::storage::AssignmentRepository &assignmentRepository,
                      infrastructure::storage::OrganizationRepository &organizationRepository);

    Json::Value createAssignment(const std::string &organizationId,
                                 const std::string &learningGroupId,
                                 const std::string &createdBy,
                                 const Json::Value &payload);

    Json::Value listAssignmentsByLearningGroup(const std::string &organizationId,
                                               const std::string &learningGroupId) const;

    Json::Value listMyAssignments(const std::string &userId, const Json::Value &roles) const;

    Json::Value getAssignment(const std::string &assignmentId) const;

    Json::Value submitAssignment(const std::string &assignmentId,
                                 const std::string &studentId,
                                 const Json::Value &answers,
                                 const Json::Value &score);

	Json::Value assignmentSubmissions(const std::string &assignmentId) const;

	Json::Value reviewSubmission(const std::string &assignmentId,
	                            const std::string &studentId,
	                            const std::string &reviewedBy,
	                            const Json::Value &payload);

    Json::Value remindAssignment(const std::string &assignmentId,
                                 const std::string &createdBy,
                                 const Json::Value &payload);

    Json::Value updateAssignment(const std::string &assignmentId, const Json::Value &patch);

    Json::Value removeAssignment(const std::string &assignmentId);

    bool isLearningGroupMember(const std::string &organizationId,
                               const std::string &learningGroupId,
                               const std::string &userId) const;

    bool isLearningGroupStaff(const std::string &organizationId,
                              const std::string &learningGroupId,
                              const std::string &userId) const;

    Json::Value getLearningGroup(const std::string &organizationId, const std::string &learningGroupId) const;

    static std::vector<std::string> studentIdsForLearningGroup(const Json::Value &learningGroup);

  private:
    Json::Value requireOrganization(const std::string &organizationId) const;
    Json::Value requireLearningGroup(const Json::Value &organization, const std::string &learningGroupId) const;
    static bool hasRole(const Json::Value &roles, const std::string &role);
    static std::string assignmentLearningGroupId(const Json::Value &assignment);
    static Json::Value sanitizeAssignmentForStudent(Json::Value assignment, const std::string &userId);

    infrastructure::storage::AssignmentRepository &assignmentRepository_;
    infrastructure::storage::OrganizationRepository &organizationRepository_;
};
}  // namespace application::services
