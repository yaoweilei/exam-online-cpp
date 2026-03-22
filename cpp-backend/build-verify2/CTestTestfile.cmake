# CMake generated Testfile for 
# Source directory: D:/_develop/_side/exam-online-cpp/cpp-backend
# Build directory: D:/_develop/_side/exam-online-cpp/cpp-backend/build-verify2
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
if(CTEST_CONFIGURATION_TYPE MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
  add_test([=[smoke_tests]=] "D:/_develop/_side/exam-online-cpp/cpp-backend/build-verify2/Debug/smoke_tests.exe")
  set_tests_properties([=[smoke_tests]=] PROPERTIES  _BACKTRACE_TRIPLES "D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;36;add_test;D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
  add_test([=[smoke_tests]=] "D:/_develop/_side/exam-online-cpp/cpp-backend/build-verify2/Release/smoke_tests.exe")
  set_tests_properties([=[smoke_tests]=] PROPERTIES  _BACKTRACE_TRIPLES "D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;36;add_test;D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
  add_test([=[smoke_tests]=] "D:/_develop/_side/exam-online-cpp/cpp-backend/build-verify2/MinSizeRel/smoke_tests.exe")
  set_tests_properties([=[smoke_tests]=] PROPERTIES  _BACKTRACE_TRIPLES "D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;36;add_test;D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
  add_test([=[smoke_tests]=] "D:/_develop/_side/exam-online-cpp/cpp-backend/build-verify2/RelWithDebInfo/smoke_tests.exe")
  set_tests_properties([=[smoke_tests]=] PROPERTIES  _BACKTRACE_TRIPLES "D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;36;add_test;D:/_develop/_side/exam-online-cpp/cpp-backend/CMakeLists.txt;0;")
else()
  add_test([=[smoke_tests]=] NOT_AVAILABLE)
endif()
