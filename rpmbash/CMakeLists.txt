set(PROJECT_DESCRIPTION "RPM-aware Bash grammar for tree-sitter")

ts_add_parser_library(rpmbash)

add_custom_target(ts-test-rpmbash
                  COMMAND "${TREE_SITTER_CLI}" test
                  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                  COMMENT "tree-sitter test (rpmbash)")
