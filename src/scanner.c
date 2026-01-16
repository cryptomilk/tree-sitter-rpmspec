/**
 * @file scanner.c
 * @brief Tree-sitter external scanner for RPM specification files
 *
 * This file implements an external scanner for parsing RPM spec files with
 * Tree-sitter.
 *
 * It handles the lexical analysis of RPM spec macro syntax including:
 * - %{macro} - standard macro expansion
 * - %[expr] - macro expression evaluation
 * - %(shell) - shell command execution
 *
 * See also:
 * https://tree-sitter.github.io/tree-sitter/creating-parsers/4-external-scanners.html
 */

#include "tree_sitter/alloc.h"
#include "tree_sitter/array.h"
#include "tree_sitter/parser.h"

/** @brief String type alias for character arrays */
typedef Array(char) String;

/**
 * @brief Token types recognized by the RPM spec scanner
 *
 * These tokens represent different types of macro syntax elements
 * that can appear in RPM specification files.
 *
 * IMPORTANT: The order must match the externals array in grammar.js
 */
enum TokenType {
    EXPAND_CODE, /**< Raw text inside %{expand:...} with balanced braces */
    SHELL_CODE,  /**< Raw text inside %(...) with balanced parentheses */
};

/**
 * @brief Represents a literal context for macro parsing
 *
 * This structure tracks the state of a macro literal being parsed,
 * including its delimiters and nesting information.
 */
struct Literal {
    enum TokenType type;       /**< The type of macro token */
    int32_t open_delimiter;    /**< Opening delimiter character (e.g., '{', '[',
                                  '(') */
    int32_t close_delimiter;   /**< Closing delimiter character (e.g., '}', ']',
                                  ')') */
    int32_t nesting_depth;     /**< Depth of nested macro expansions */
    bool allows_interpolation; /**< Whether this literal allows variable
                                  interpolation */
};

/**
 * @brief Main scanner state structure
 *
 * Contains the parser state including a stack of literal contexts
 * to handle nested macro expansions properly.
 */
struct Scanner {
    Array(struct Literal)
        literal_stack; /**< Stack of nested literal contexts */
};

/**
 * @brief Advances the lexer to the next character
 * @param lexer The Tree-sitter lexer instance
 */
static inline void advance(TSLexer *lexer)
{
    lexer->advance(lexer, false);
}

/**
 * @brief Serializes the scanner state into a byte buffer
 *
 * This function copies the complete state of the scanner into the given byte
 * buffer and returns the number of bytes written. Used by Tree-sitter for
 * incremental parsing and error recovery.
 *
 * @param scanner The scanner instance to serialize
 * @param buffer The byte buffer to write the state to
 * @return The number of bytes written to the buffer
 */
static inline unsigned rpmspec_serialize(struct Scanner *scanner, char *buffer)
{
    size_t size = 0;

    /* Serialize the number of literals in the stack */
    if (size + sizeof(uint32_t) > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        return 0;
    }
    *(uint32_t *)(buffer + size) = scanner->literal_stack.size;
    size += sizeof(uint32_t);

    /* Serialize each literal in the stack */
    for (size_t i = 0; i < scanner->literal_stack.size; i++) {
        if (size + sizeof(struct Literal) >
            TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
            return 0;
        }

        struct Literal *literal = &scanner->literal_stack.contents[i];
        *(struct Literal *)(buffer + size) = *literal;
        size += sizeof(struct Literal);
    }

    return size;
}

/**
 * @brief Deserializes the scanner state from a byte buffer
 *
 * This function restores the state of the scanner based on the bytes that were
 * previously written by the serialize function. Used by Tree-sitter for
 * incremental parsing and error recovery.
 *
 * @param scanner The scanner instance to restore state to
 * @param buffer The byte buffer containing the serialized state
 * @param length The number of bytes to read from the buffer
 */
static inline void rpmspec_deserialize(struct Scanner *scanner,
                                       const char *buffer,
                                       unsigned length)
{
    if (length == 0) {
        return;
    }

    size_t size = 0;

    /* Deserialize the number of literals */
    if (size + sizeof(uint32_t) > length) {
        return;
    }
    uint32_t stack_size = *(uint32_t *)(buffer + size);
    size += sizeof(uint32_t);

    /* Clear existing stack */
    array_clear(&scanner->literal_stack);

    /* Deserialize each literal */
    for (uint32_t i = 0; i < stack_size; i++) {
        if (size + sizeof(struct Literal) > length) {
            return;
        }

        struct Literal literal = *(struct Literal *)(buffer + size);
        array_push(&scanner->literal_stack, literal);
        size += sizeof(struct Literal);
    }
}

/**
 * @brief Attempts to parse the start of a macro expression
 *
 * This function checks if the current position in the lexer represents the
 * beginning of a macro expression (%{, %[, or %() and sets up the literal
 * context accordingly.
 *
 * @param scanner The scanner instance
 * @param lexer The Tree-sitter lexer instance
 * @param literal The literal context to populate if a macro is found
 * @param valid_symbols Array indicating which token types are valid at this
 * position
 * @return true if a macro start was successfully parsed, false otherwise
 */
static inline bool rpmspec_macro_start(struct Scanner *scanner,
                                       TSLexer *lexer,
                                       struct Literal *literal,
                                       const bool *valid_symbols)
{
}

/**
 * @brief Scans raw content inside %{expand:...} with balanced braces
 *
 * This function reads characters until it finds:
 * - The closing } at depth 0 (end of expand macro)
 * - A % character (potential macro start - let grammar handle it)
 *
 * It tracks brace nesting depth to handle content like:
 *   %{expand: return {0:0, 11:+1}[c] }
 *
 * By stopping at %, macros inside expand content will be parsed
 * by the grammar and properly highlighted.
 *
 * @param lexer The Tree-sitter lexer instance
 * @return true if content was successfully scanned, false otherwise
 */
static bool scan_expand_content(TSLexer *lexer)
{
    int32_t brace_depth = 0;
    bool has_content = false;

    while (!lexer->eof(lexer)) {
        int32_t c = lexer->lookahead;

        if (c == '%') {
            /* Potential macro start - stop and let grammar handle it */
            break;
        } else if (c == '{') {
            /* Nested opening brace - track depth */
            brace_depth++;
            has_content = true;
            advance(lexer);
        } else if (c == '}') {
            if (brace_depth == 0) {
                /* This is the closing brace of %{expand:...} */
                /* Don't consume it - let the grammar handle it */
                break;
            }
            /* Closing a nested brace */
            brace_depth--;
            has_content = true;
            advance(lexer);
        } else {
            /* Any other character is part of the content */
            has_content = true;
            advance(lexer);
        }
    }

    return has_content;
}

/**
 * @brief Scans raw content inside %(...) with balanced parentheses
 *
 * This function reads characters until it finds:
 * - The closing ) at depth 0 (end of shell macro)
 * - A % character (potential macro start - let grammar handle it)
 *
 * It tracks parenthesis nesting depth to handle content like:
 *   %(test $(echo hello) = hello && echo success)
 *
 * By stopping at %, macros inside shell content will be parsed
 * by the grammar and properly highlighted.
 *
 * @param lexer The Tree-sitter lexer instance
 * @return true if content was successfully scanned, false otherwise
 */
static bool scan_shell_content(TSLexer *lexer)
{
    int32_t paren_depth = 0;
    bool has_content = false;

    while (!lexer->eof(lexer)) {
        int32_t c = lexer->lookahead;

        if (c == '%') {
            /* Potential macro start - stop and let grammar handle it */
            break;
        } else if (c == '(') {
            /* Nested opening paren - track depth */
            paren_depth++;
            has_content = true;
            advance(lexer);
        } else if (c == ')') {
            if (paren_depth == 0) {
                /* This is the closing paren of %(...) */
                /* Don't consume it - let the grammar handle it */
                break;
            }
            /* Closing a nested paren */
            paren_depth--;
            has_content = true;
            advance(lexer);
        } else {
            /* Any other character is part of the content */
            has_content = true;
            advance(lexer);
        }
    }

    return has_content;
}

/**
 * @brief Main scanning function for RPM spec tokens
 *
 * This is the primary entry point for token recognition. It attempts to
 * identify and parse various RPM spec syntax elements, particularly macro
 * expressions and escape sequences.
 *
 * @param scanner The scanner instance
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid at this
 * position
 * @return true if a token was successfully recognized, false otherwise
 */
static inline bool
rpmspec_scan(struct Scanner *scanner, TSLexer *lexer, const bool *valid_symbols)
{
    (void)scanner; /* Unused for now */

    if (valid_symbols[EXPAND_CODE]) {
        lexer->result_symbol = EXPAND_CODE;
        return scan_expand_content(lexer);
    }

    if (valid_symbols[SHELL_CODE]) {
        lexer->result_symbol = SHELL_CODE;
        return scan_shell_content(lexer);
    }

    return false;
}

/**
 * @brief Creates and initializes a new scanner instance
 *
 * This function is called by Tree-sitter to create a new external scanner
 * instance. It allocates memory and initializes the scanner state.
 *
 * @return A pointer to the newly created scanner instance
 */
void *tree_sitter_rpmspec_external_scanner_create()
{
    struct Scanner *scanner = ts_calloc(1, sizeof(struct Scanner));

    return scanner;
}

/**
 * @brief Destroys a scanner instance and frees its memory
 *
 * This function is called by Tree-sitter to clean up and destroy an external
 * scanner instance, releasing all allocated memory.
 *
 * @param payload The scanner instance to destroy (cast from void*)
 */
void tree_sitter_rpmspec_external_scanner_destroy(void *payload)
{
    struct Scanner *scanner = (struct Scanner *)payload;

    array_delete(&scanner->literal_stack);
    ts_free(scanner);
}

/**
 * @brief Tree-sitter API function for serializing scanner state
 *
 * This is the Tree-sitter external scanner API function that delegates
 * to the internal serialization implementation.
 *
 * @param payload The scanner instance (cast from void*)
 * @param buffer The buffer to write serialized state to
 * @return The number of bytes written
 */
unsigned tree_sitter_rpmspec_external_scanner_serialize(void *payload,
                                                        char *buffer)
{
    struct Scanner *scanner = (struct Scanner *)payload;

    return rpmspec_serialize(scanner, buffer);
}

/**
 * @brief Tree-sitter API function for deserializing scanner state
 *
 * This is the Tree-sitter external scanner API function that delegates
 * to the internal deserialization implementation.
 *
 * @param payload The scanner instance (cast from void*)
 * @param buffer The buffer containing serialized state
 * @param length The number of bytes to read from the buffer
 */
void tree_sitter_rpmspec_external_scanner_deserialize(void *payload,
                                                      const char *buffer,
                                                      unsigned length)
{
    struct Scanner *scanner = (struct Scanner *)payload;

    rpmspec_deserialize(scanner, buffer, length);
}

/**
 * @brief Tree-sitter API function for scanning tokens
 *
 * This is the main Tree-sitter external scanner API function that delegates
 * to the internal scanning implementation. Called by Tree-sitter during parsing
 * to recognize external tokens.
 *
 * @param payload The scanner instance (cast from void*)
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid at this
 * position
 * @return true if a token was successfully recognized, false otherwise
 */
bool tree_sitter_rpmspec_external_scanner_scan(void *payload,
                                               TSLexer *lexer,
                                               const bool *valid_symbols)
{
    struct Scanner *scanner = (struct Scanner *)payload;

    return rpmspec_scan(scanner, lexer, valid_symbols);
}
