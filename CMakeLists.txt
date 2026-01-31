cmake_minimum_required(VERSION 3.13)

project(tree-sitter-rpmspec
        VERSION "0.0.1"
        DESCRIPTION "RPMSpec grammar for tree-sitter"
        HOMEPAGE_URL "https://gitlab.com/cryptomilk/tree-sitter-rpmspec"
        LANGUAGES C)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake/Modules")
include(GNUInstallDirs)
include(TSAddParserLibrary)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the library allocator" OFF)
option(PICKY_DEVELOPER "Enable strict compiler warnings for scanner.c" OFF)
option(ENABLE_FUZZING "Build libFuzzer-based fuzzers (requires Clang)" OFF)

set(TREE_SITTER_ABI_VERSION 15 CACHE STRING "Tree-sitter ABI version")

# Helper function to check compiler flag support
include(CheckCCompilerFlag)

function(add_c_compiler_flag_if_supported flag list_var)
    # Create a valid variable name from the flag
    string(REGEX REPLACE "[^a-zA-Z0-9]" "_" flag_var "HAVE_C_FLAG${flag}")
    check_c_compiler_flag("${flag}" ${flag_var})
    if(${flag_var})
        list(APPEND ${list_var} "${flag}")
        set(${list_var} "${${list_var}}" PARENT_SCOPE)
    endif()
endfunction()

# Check and accumulate compiler warning flags
set(SCANNER_WARNING_FLAGS)
if(PICKY_DEVELOPER AND UNIX)
    add_c_compiler_flag_if_supported(-Wall SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wpedantic SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wcast-align SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wcast-qual SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wmissing-field-initializers SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=strict-prototypes SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=write-strings SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=implicit-function-declaration SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=pointer-arith SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=return-type SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=uninitialized SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=strict-overflow SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wstrict-overflow=2 SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=implicit-int SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=int-conversion SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=format-security SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=uninitialized SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Werror=unused-function SCANNER_WARNING_FLAGS)
endif()
if(NOT ${TREE_SITTER_ABI_VERSION} MATCHES "^[0-9]+$")
    unset(TREE_SITTER_ABI_VERSION CACHE)
    message(FATAL_ERROR "TREE_SITTER_ABI_VERSION must be an integer")
endif()

find_program(TREE_SITTER_CLI tree-sitter DOC "Tree-sitter CLI")

add_subdirectory(rpmspec)
add_subdirectory(rpmbash)

# Fuzzing (requires Clang with -fsanitize=fuzzer support)
if(ENABLE_FUZZING)
    if(NOT CMAKE_C_COMPILER_ID MATCHES "Clang")
        message(
            FATAL_ERROR
            "Fuzzing requires Clang compiler (set -DCMAKE_C_COMPILER=clang)")
    endif()
    add_subdirectory(tests/fuzz)
endif()

# Aggregate test target that runs tests for all grammars
add_custom_target(ts-test
                  DEPENDS ts-test-rpmspec ts-test-rpmbash
                  COMMENT "Run tree-sitter tests for all grammars")
