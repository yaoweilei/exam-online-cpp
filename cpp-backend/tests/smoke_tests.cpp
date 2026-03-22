#include <cassert>

#include "common/RequestId.h"

int main()
{
    const auto id1 = common::generateRequestId();
    const auto id2 = common::generateRequestId();
    assert(!id1.empty());
    assert(!id2.empty());
    assert(id1 != id2);
    return 0;
}
