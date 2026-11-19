cmake_minimum_required(VERSION 3.16)

# The image's version string (esp_app_desc_t.version, which the app reads from
# an update file) comes from the same numbers the badge reports in INFO.
file(STRINGS main/protocol.h _inktag_ver REGEX "#define INKTAG_FW_VERSION_(MAJOR|MINOR|PATCH) ")
string(REGEX REPLACE ".*MAJOR ([0-9]+).*MINOR ([0-9]+).*PATCH ([0-9]+).*" "\\1.\\2.\\3" PROJECT_VER "${_inktag_ver}")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(inktag)
