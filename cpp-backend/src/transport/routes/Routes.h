#pragma once

#include "transport/ApiRouter.h"

namespace transport::routes
{
void registerStaticRoutes(const AppContext &ctx);
void registerHealthRoutes(const AppContext &ctx);
void registerExamRoutes(const AppContext &ctx);
void registerAnswerRoutes(const AppContext &ctx);
void registerAuthRoutes(const AppContext &ctx);
void registerMeRoutes(const AppContext &ctx);
void registerStatisticsRoutes(const AppContext &ctx);
void registerUserRoutes(const AppContext &ctx);
void registerFuriganaRoutes(const AppContext &ctx);
void registerProfileRoutes(const AppContext &ctx);
void registerBookmarkRoutes(const AppContext &ctx);
void registerSubscriptionRoutes(const AppContext &ctx);
void registerOrganizationRoutes(const AppContext &ctx);
void registerContactRoutes(const AppContext &ctx);
void registerWechatRoutes(const AppContext &ctx);
}  // namespace transport::routes
