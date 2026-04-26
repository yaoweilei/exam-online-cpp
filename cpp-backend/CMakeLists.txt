cmake_minimum_required(VERSION 3.20)

project(exam_online_cpp_v2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(BUILD_TESTING "Build tests" ON)

find_package(Drogon REQUIRED)

file(GLOB_RECURSE APP_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp"
)

add_executable(exam_online_cpp ${APP_SOURCES})
target_include_directories(exam_online_cpp PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(exam_online_cpp PRIVATE Drogon::Drogon)

if(MSVC)
    target_compile_options(exam_online_cpp PRIVATE /W4 /permissive- /utf-8)
    target_compile_definitions(exam_online_cpp PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
else()
    target_compile_options(exam_online_cpp PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(BUILD_TESTING)
    enable_testing()
    add_executable(smoke_tests
        tests/smoke_tests.cpp
        src/infrastructure/storage/UserRepository.cpp
        src/infrastructure/storage/OrganizationRepository.cpp
        src/infrastructure/storage/ProfileRepository.cpp
        src/infrastructure/storage/ExamRepository.cpp
        src/application/services/OrganizationService.cpp
        src/application/services/SubscriptionService.cpp
        src/application/services/UserService.cpp
        src/application/services/ContactChangeChallengeService.cpp
        src/application/services/WechatService.cpp
        src/application/services/PhoneService.cpp
        src/application/services/AnswerService.cpp
        src/application/services/StatisticsService.cpp
        src/application/services/EmailVerificationService.cpp
        src/application/services/AuthService.cpp
        src/application/services/ExamService.cpp
        src/application/services/ProfileService.cpp
        src/application/services/BookmarkService.cpp
        src/infrastructure/storage/WrongQuestionRepository.cpp
        src/application/services/WrongQuestionService.cpp
        src/infrastructure/storage/StreakRepository.cpp
        src/application/services/StreakService.cpp
        src/infrastructure/storage/DraftRepository.cpp
        src/application/services/DraftService.cpp
        src/infrastructure/storage/AttemptTimerRepository.cpp
        src/application/services/AttemptTimerService.cpp
        src/infrastructure/storage/FeatureFlagRepository.cpp
        src/application/services/FeatureFlagService.cpp
        src/infrastructure/storage/FeedbackRepository.cpp
        src/application/services/FeedbackService.cpp
        src/infrastructure/storage/ClassroomRepository.cpp
        src/infrastructure/storage/AssignmentRepository.cpp
        src/application/services/ClassroomService.cpp
        src/infrastructure/storage/SrsRepository.cpp
        src/application/services/SrsService.cpp
        src/infrastructure/storage/BookmarkFolderRepository.cpp
        src/application/services/BookmarkFolderService.cpp
        src/application/services/DataExportService.cpp
        src/application/services/AdminStatisticsService.cpp
        src/infrastructure/storage/CommunityRepository.cpp
        src/application/services/CommunityService.cpp
        src/application/services/AuditLogService.cpp
        src/application/services/DailyPracticeService.cpp
        src/application/services/LearningReportService.cpp
        src/application/services/StudyGoalService.cpp
        src/application/services/SyncService.cpp
        src/application/services/LeaderboardService.cpp
        src/application/services/OAuthService.cpp
    )
    target_include_directories(smoke_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(smoke_tests PRIVATE Drogon::Drogon)
    if(MSVC)
        target_compile_options(smoke_tests PRIVATE /utf-8)
        target_compile_definitions(smoke_tests PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
    endif()
    add_test(NAME smoke_tests COMMAND smoke_tests)
endif()
