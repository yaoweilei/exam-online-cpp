#include "ApiRouter.h"

#include "transport/routes/Routes.h"

namespace transport
{
void ApiRouter::registerRoutes() const
{
    routes::registerStaticRoutes(context_);
    routes::registerHealthRoutes(context_);
    routes::registerExamRoutes(context_);
    routes::registerAnswerRoutes(context_);
    routes::registerAuthRoutes(context_);
    routes::registerMeRoutes(context_);
    routes::registerStatisticsRoutes(context_);
    routes::registerUserRoutes(context_);
    routes::registerFuriganaRoutes(context_);
    routes::registerProfileRoutes(context_);
    routes::registerBookmarkRoutes(context_);
    routes::registerSubscriptionRoutes(context_);
    routes::registerOrganizationRoutes(context_);
    routes::registerContactRoutes(context_);
    routes::registerWechatRoutes(context_);
}
}  // namespace transport
