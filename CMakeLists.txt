cmake_minimum_required(VERSION 3.13)

project(tree-sitter-rpmspec
        VERSION "0.0.1"
        DESCRIPTION "RPMSpec grammar for tree-sitter"
        HOMEPAGE_URL "https://gitlab.com/cryptomilk/tree-sitter-rpmspec"
        LANGUAGES C)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the library allocator" OFF)
option(PICKY_DEVELOPER "Enable strict compiler warnings for scanner.c" OFF)

set(TREE_SITTER_ABI_VERSION 15 CACHE STRING "Tree-sitter ABI version")

# Check and accumulate compiler warning flags
set(SCANNER_WARNING_FLAGS)
if(PICKY_DEVELOPER AND UNIX)
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

    add_c_compiler_flag_if_supported(-Wall SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wpedantic SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wcast-align SCANNER_WARNING_FLAGS)
    add_c_compiler_flag_if_supported(-Wcast-qual SCANNER_WARNING_FLAGS)
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
endif()
if(NOT ${TREE_SITTER_ABI_VERSION} MATCHES "^[0-9]+$")
    unset(TREE_SITTER_ABI_VERSION CACHE)
    message(FATAL_ERROR "TREE_SITTER_ABI_VERSION must be an integer")
endif()

find_program(TREE_SITTER_CLI tree-sitter DOC "Tree-sitter CLI")

add_custom_command(OUTPUT "${CMAKE_CURRENT_SOURCE_DIR}/src/parser.c"
                   DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/grammar.json"
                   COMMAND "${TREE_SITTER_CLI}" generate src/grammar.json
                            --abi=${TREE_SITTER_ABI_VERSION}
                   WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                   COMMENT "Generating parser.c")

add_library(tree-sitter-rpmspec src/parser.c)
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/src/scanner.c)
  target_sources(tree-sitter-rpmspec PRIVATE src/scanner.c)
  if(SCANNER_WARNING_FLAGS)
    set_source_files_properties(src/scanner.c PROPERTIES COMPILE_OPTIONS "${SCANNER_WARNING_FLAGS}")
  endif()
endif()
target_include_directories(tree-sitter-rpmspec
                           PRIVATE src
                           INTERFACE $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/bindings/c>
                                     $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)

target_compile_definitions(tree-sitter-rpmspec PRIVATE
                           $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
                           $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>)

set_target_properties(tree-sitter-rpmspec
                      PROPERTIES
                      C_STANDARD 11
                      POSITION_INDEPENDENT_CODE ON
                      SOVERSION "${TREE_SITTER_ABI_VERSION}.${PROJECT_VERSION_MAJOR}"
                      DEFINE_SYMBOL "")

configure_file(bindings/c/tree-sitter-rpmspec.pc.in
               "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-rpmspec.pc" @ONLY)

include(GNUInstallDirs)

install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bindings/c/tree_sitter"
        DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}"
        FILES_MATCHING PATTERN "*.h")
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-rpmspec.pc"
        DESTINATION "${CMAKE_INSTALL_DATAROOTDIR}/pkgconfig")
install(TARGETS tree-sitter-rpmspec
        LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}")

file(GLOB QUERIES queries/*.scm)
install(FILES ${QUERIES}
        DESTINATION "${CMAKE_INSTALL_DATADIR}/tree-sitter/queries/rpmspec")

add_custom_target(ts-test "${TREE_SITTER_CLI}" test
                  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                  COMMENT "tree-sitter test")
