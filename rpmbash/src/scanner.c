/**
 * RPMBash external scanner
 *
 * This includes the tree-sitter-bash scanner and renames its functions
 * to use the rpmbash prefix via preprocessor macros.
 */

// Rename bash scanner functions to rpmbash before including
#define tree_sitter_bash_external_scanner_create \
    tree_sitter_rpmbash_external_scanner_create
#define tree_sitter_bash_external_scanner_destroy \
    tree_sitter_rpmbash_external_scanner_destroy
#define tree_sitter_bash_external_scanner_serialize \
    tree_sitter_rpmbash_external_scanner_serialize
#define tree_sitter_bash_external_scanner_deserialize \
    tree_sitter_rpmbash_external_scanner_deserialize
#define tree_sitter_bash_external_scanner_scan \
    tree_sitter_rpmbash_external_scanner_scan

// Suppress warnings from the included bash scanner code
#ifdef __GNUC__
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wstrict-prototypes"
#pragma GCC diagnostic ignored "-Wunused-value"
#endif

#include "../node_modules/tree-sitter-bash/src/scanner.c"

#ifdef __GNUC__
#pragma GCC diagnostic pop
#endif
