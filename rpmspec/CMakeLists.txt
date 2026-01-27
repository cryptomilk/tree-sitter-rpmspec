set(PROJECT_DESCRIPTION "RPMSpec grammar for tree-sitter")

ts_add_parser_library(rpmspec)

add_custom_target(ts-test-rpmspec
                  COMMAND "${TREE_SITTER_CLI}" test
                  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                  COMMENT "tree-sitter test (rpmspec)")
