#pragma once

#include <array>
#include <chrono>
#include <iomanip>
#include <random>
#include <sstream>
#include <string>

namespace common
{
inline std::string generateUuidV7()
{
    using namespace std::chrono;

    std::array<unsigned char, 16> bytes{};
    const auto timestampMs = static_cast<uint64_t>(duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());

    for (int index = 0; index < 6; ++index)
    {
        bytes[static_cast<size_t>(index)] = static_cast<unsigned char>((timestampMs >> (8 * (5 - index))) & 0xFF);
    }

    thread_local std::mt19937 generator([] {
        std::random_device device;
        std::seed_seq seed{device(), device(), device(), device()};
        return std::mt19937(seed);
    }());
    std::uniform_int_distribution<int> randomByte(0, 255);

    bytes[6] = static_cast<unsigned char>(0x70 | (randomByte(generator) & 0x0F));
    bytes[7] = static_cast<unsigned char>(randomByte(generator));
    bytes[8] = static_cast<unsigned char>(0x80 | (randomByte(generator) & 0x3F));
    for (size_t index = 9; index < bytes.size(); ++index)
    {
        bytes[index] = static_cast<unsigned char>(randomByte(generator));
    }

    std::ostringstream out;
    out << std::hex << std::nouppercase << std::setfill('0');
    for (size_t index = 0; index < bytes.size(); ++index)
    {
        out << std::setw(2) << static_cast<int>(bytes[index]);
        if (index == 3 || index == 5 || index == 7 || index == 9)
        {
            out << '-';
        }
    }
    return out.str();
}

inline std::string generateOpaqueId(const std::string &prefix)
{
    return prefix + generateUuidV7();
}
}  // namespace common