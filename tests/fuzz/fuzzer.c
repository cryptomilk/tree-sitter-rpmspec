#include <assert.h>
#include <tree_sitter/api.h>

#ifndef TS_LANG
#error TS_LANG must be defined
#endif

const TSLanguage *TS_LANG(void);

int LLVMFuzzerTestOneInput(const uint8_t *data, const size_t len)
{
    // Create a parser - should never fail
    TSParser *parser = ts_parser_new();
    assert(parser != NULL);

    // Set the parser's language - should never fail with compiled-in language
    assert(ts_parser_set_language(parser, TS_LANG()));

    // Build a syntax tree based on source code stored in a string.
    TSTree *tree =
        ts_parser_parse_string(parser, NULL, (const char *)data, len);

    // Free all of the heap-allocated memory.
    // Note: ts_tree_delete handles NULL gracefully
    ts_tree_delete(tree);
    ts_parser_delete(parser);
    return 0;
}
