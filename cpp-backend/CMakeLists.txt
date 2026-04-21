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
    add_executable(smoke_tests tests/smoke_tests.cpp)
    target_include_directories(smoke_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(smoke_tests PRIVATE Drogon::Drogon)
    if(MSVC)
        target_compile_options(smoke_tests PRIVATE /utf-8)
        target_compile_definitions(smoke_tests PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
    endif()
    add_test(NAME smoke_tests COMMAND smoke_tests)
endif()
