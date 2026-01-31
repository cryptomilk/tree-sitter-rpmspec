#include <assert.h>
#include <stdint.h>
#include <tree_sitter/api.h>

#ifndef TS_LANG
#error TS_LANG must be defined
#endif

const TSLanguage *TS_LANG(void);

/**
 * @brief Recursively traverse tree to exercise node APIs
 *
 * Walks the syntax tree built by the scanner, accessing node properties
 * and navigating the tree structure. This exercises scanner code paths
 * and can expose bugs in tree construction and node relationships.
 */
static void traverse_tree(TSNode node)
{
    // Access node properties - exercises scanner-built tree structure
    (void)ts_node_symbol(node);
    (void)ts_node_type(node);
    (void)ts_node_start_byte(node);
    (void)ts_node_end_byte(node);

    // Traverse all children recursively
    uint32_t child_count = ts_node_child_count(node);
    for (uint32_t i = 0; i < child_count; i++) {
        TSNode child = ts_node_child(node, i);
        if (!ts_node_is_null(child)) {
            traverse_tree(child);
        }
    }
}

int LLVMFuzzerTestOneInput(const uint8_t *data, const size_t len)
{
    // Limit input size to avoid timeouts on pathological inputs
    // Fuzzing works better with many small inputs than few large ones
    if (len > 4096) {
        return 0;
    }

    // Create a parser - should never fail
    TSParser *parser = ts_parser_new();
    assert(parser != NULL);

    // Set the parser's language - should never fail with compiled-in language
    assert(ts_parser_set_language(parser, TS_LANG()));

    // Build a syntax tree based on source code stored in a string.
    TSTree *tree =
        ts_parser_parse_string(parser, NULL, (const char *)data, len);

    // Traverse the tree to exercise scanner-built structure
    if (tree != NULL) {
        TSNode root = ts_tree_root_node(tree);
        if (!ts_node_is_null(root)) {
            traverse_tree(root);
        }
    }

    // Free all of the heap-allocated memory.
    // Note: ts_tree_delete handles NULL gracefully
    ts_tree_delete(tree);
    ts_parser_delete(parser);
    return 0;
}
