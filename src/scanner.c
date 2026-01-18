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

#include <ctype.h>
#include <string.h>

/** @brief String type alias for character arrays */
typedef Array(char) String;

/**
 * @brief Token types recognized by the RPM spec scanner
 *
 * These tokens represent different types of macro syntax elements
 * that can appear in RPM specification files.
 *
 * IMPORTANT: The order must match the externals array in grammar.js
 *
 * ORDERING RATIONALE: Tokens are ordered by frequency of occurrence.
 * During error recovery, tree-sitter may try tokens in order, so placing
 * the most common tokens first improves recovery behavior:
 *
 * 1. SIMPLE_MACRO (%name) - by far the most common pattern (~80% of macros)
 * 2. Other macro types - less common but still frequent
 * 3. Conditional tokens - used in control flow
 * 4. Context-specific tokens (EXPAND_CODE, SHELL_CODE) - rare, only valid
 *    in specific contexts like %{expand:...} or %(...)
 */
enum TokenType {
    /* Most common tokens first for better error recovery */
    SIMPLE_MACRO,     /**< Simple macro expansion: %name */
    NEGATED_MACRO,    /**< Negated macro expansion: %!name */
    SPECIAL_MACRO,    /**< Special macro variables: %*, %**, %#, %0-9, %nil */
    ESCAPED_PERCENT,  /**< Escaped percent sign: %% */
    /* Context-aware conditional tokens for distinguishing top-level vs shell */
    TOP_LEVEL_IF,     /**< %if at top-level or containing section keywords */
    SHELL_IF,         /**< %if inside shell section without section keywords */
    TOP_LEVEL_IFARCH, /**< %ifarch at top-level */
    SHELL_IFARCH,     /**< %ifarch inside shell section */
    TOP_LEVEL_IFNARCH,/**< %ifnarch at top-level */
    SHELL_IFNARCH,    /**< %ifnarch inside shell section */
    TOP_LEVEL_IFOS,   /**< %ifos at top-level */
    SHELL_IFOS,       /**< %ifos inside shell section */
    TOP_LEVEL_IFNOS,  /**< %ifnos at top-level */
    SHELL_IFNOS,      /**< %ifnos inside shell section */
    /* Context-specific tokens - only valid in specific macro contexts */
    EXPAND_CODE,      /**< Raw text inside %{expand:...} with balanced braces */
    SHELL_CODE        /**< Raw text inside %(...) with balanced parentheses */
};

/**
 * @brief Check if character is valid identifier start (letter or underscore)
 */
static inline bool is_identifier_start(int32_t c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}

/**
 * @brief Check if character is valid identifier continuation
 */
static inline bool is_identifier_char(int32_t c)
{
    return is_identifier_start(c) || (c >= '0' && c <= '9');
}

/**
 * @brief Check if character is a digit
 */
static inline bool is_digit(int32_t c)
{
    return c >= '0' && c <= '9';
}

/**
 * @brief Skip leading whitespace characters
 *
 * Advances the lexer past any whitespace characters without including
 * them in the token. This allows the scanner to find tokens that appear
 * after leading newlines or spaces.
 */
static inline void skip_whitespace(TSLexer *lexer)
{
    while (isspace(lexer->lookahead)) {
        lexer->advance(lexer, true); /* true = skip (don't include in token) */
    }
}

/**
 * @brief Check if identifier is "nil" (special macro)
 */
static inline bool is_nil(const char *id, size_t len)
{
    return len == 3 && strncmp(id, "nil", 3) == 0;
}

/**
 * @brief Check if identifier is legacy patch macro (patchN where N is digits)
 *
 * These are handled by the grammar's patch_legacy_token rule.
 */
static inline bool is_patch_legacy(const char *id, size_t len)
{
    if (len < 6) { /* "patch" + at least one digit */
        return false;
    }
    if (strncmp(id, "patch", 5) != 0) {
        return false;
    }
    /* Check remaining chars are all digits */
    for (size_t i = 5; i < len; i++) {
        if (id[i] < '0' || id[i] > '9') {
            return false;
        }
    }
    return true;
}

/**
 * @brief RPM spec keywords that should not be matched as simple macros
 *
 * These are reserved words that have special meaning in RPM specs.
 * The scanner must NOT match these as SIMPLE_MACRO tokens.
 *
 * Note: Section keywords (prep, build, install, etc.) are in SECTION_KEYWORDS.
 * The is_keyword() function checks both arrays.
 */
static const char *const KEYWORDS[] = {
    /* Conditionals */
    "if",
    "elif",
    "else",
    "endif",
    "ifarch",
    "ifnarch",
    "elifarch",
    "ifos",
    "ifnos",
    "elifos",
    /* Definitions */
    "define",
    "global",
    "undefine",
    /* Special macros handled by grammar */
    "setup",
    "patch",
    /* Note: autosetup and autopatch are NOT keywords - they are handled
     * by macro_parametric_expansion as regular parametric macros */
    /* File directives */
    "defattr",
    "attr",
    "config",
    "doc",
    "docdir",
    "dir",
    "license",
    "verify",
    "ghost",
    "exclude",
    /* Builtin string macros */
    "echo",
    "error",
    "expand",
    "getenv",
    "getncpus",
    "len",
    "lower",
    "macrobody",
    "quote",
    "reverse",
    "shescape",
    "shrink",
    "upper",
    "verbose",
    "warn",
    /* Builtin path macros */
    "basename",
    "dirname",
    "exists",
    "load",
    "suffix",
    "uncompress",
    /* Builtin URL macros */
    "url2path",
    "u2p",
    /* Builtin multi-arg macros */
    "gsub",
    "sub",
    "rep",
    /* Builtin standalone macros */
    "dnl",
    "dump",
    "rpmversion",
    "trace",
    /* Other builtins */
    "expr",
    "lua",
    /* End marker */
    NULL,
};

/**
 * @brief Check if a string matches any keyword in an array
 *
 * @param str The string to check
 * @param len Length of the string
 * @param keywords NULL-terminated array of keywords
 * @return true if str matches a keyword, false otherwise
 */
static bool matches_keyword_array(const char *str, size_t len,
                                  const char *const *keywords)
{
    for (const char *const *kw = keywords; *kw != NULL; kw++) {
        size_t kw_len = strlen(*kw);
        if (len == kw_len && strncmp(str, *kw, len) == 0) {
            return true;
        }
    }
    return false;
}

/**
 * @brief Section keywords that indicate top-level context
 *
 * When a %if body contains any of these keywords, it should be
 * parsed as a top-level conditional, not a shell-level one.
 */
static const char *const SECTION_KEYWORDS[] = {
    /* Main sections */
    "prep",
    "build",
    "install",
    "check",
    "clean",
    "files",
    "changelog",
    "description",
    "package",
    /* Runtime scriptlets */
    "pre",
    "post",
    "preun",
    "postun",
    "pretrans",
    "posttrans",
    "preuntrans",
    "postuntrans",
    /* Triggers */
    "triggerin",
    "triggerun",
    "triggerpostun",
    "triggerprein",
    /* File triggers */
    "filetriggerin",
    "filetriggerun",
    "filetriggerpostun",
    "transfiletriggerin",
    "transfiletriggerun",
    "transfiletriggerpostun",
    /* End marker */
    NULL,
};

/**
 * @brief Check if a string matches a section keyword
 */
static bool is_section_keyword(const char *str, size_t len)
{
    return matches_keyword_array(str, len, SECTION_KEYWORDS);
}

/**
 * @brief Check if a string matches an RPM keyword (either regular or section)
 *
 * @param str The string to check
 * @param len Length of the string
 * @return true if str is a keyword, false otherwise
 */
static bool is_keyword(const char *str, size_t len)
{
    return matches_keyword_array(str, len, KEYWORDS) ||
           matches_keyword_array(str, len, SECTION_KEYWORDS);
}

/**
 * @brief Maximum lines to scan ahead for section keywords
 *
 * This bounds the lookahead to avoid pathological cases with very large
 * conditional blocks. 2000 lines should cover most real-world specs.
 */
#define MAX_LOOKAHEAD_LINES 2000

/**
 * @brief Lookahead to check if %if body contains section keywords
 *
 * When we encounter %if inside a shell section, we need to determine
 * whether it's a shell-level conditional (e.g., if [ -f foo ]; then)
 * or a top-level conditional containing sections (e.g., %if with %files).
 *
 * This function scans ahead until %endif, looking for section keywords.
 * It tracks conditional nesting to find the matching %endif.
 *
 * @param lexer The Tree-sitter lexer (position will be restored)
 * @return true if the body contains section keywords, false otherwise
 */
static bool lookahead_finds_section_keyword(TSLexer *lexer)
{
    /* Track nesting depth of conditionals */
    int32_t nesting = 1; /* We're already inside one %if */
    int32_t lines_scanned = 0;
    bool at_line_start = true;

    /* Scan character by character, looking for section keywords */
    while (!lexer->eof(lexer) && lines_scanned < MAX_LOOKAHEAD_LINES) {
        int32_t c = lexer->lookahead;

        if (c == '\r' || c == '\n') {
            /* Newline - next character is at line start */
            lexer->advance(lexer, false);
            if (c == '\r' && lexer->lookahead == '\n') {
                lexer->advance(lexer, false);
            }
            at_line_start = true;
            lines_scanned++;
            continue;
        }

        if (c == ' ' || c == '\t') {
            /* Whitespace at line start - still at line start */
            lexer->advance(lexer, false);
            continue;
        }

        if (c == '%' && at_line_start) {
            /* Potential keyword at line start */
            lexer->advance(lexer, false);

            /* Buffer the identifier */
            char id_buf[32];
            size_t id_len = 0;

            while (is_identifier_char(lexer->lookahead) &&
                   id_len < sizeof(id_buf) - 1) {
                id_buf[id_len++] = (char)lexer->lookahead;
                lexer->advance(lexer, false);
            }
            id_buf[id_len] = '\0';

            if (id_len > 0) {
                /* Check for %endif (end of conditional) */
                if (id_len == 5 && strncmp(id_buf, "endif", 5) == 0) {
                    nesting--;
                    if (nesting == 0) {
                        /* Found matching %endif - no section keywords found */
                        return false;
                    }
                }
                /* Check for nested %if/%ifarch/%ifos */
                else if ((id_len == 2 && strncmp(id_buf, "if", 2) == 0) ||
                         (id_len == 6 && strncmp(id_buf, "ifarch", 6) == 0) ||
                         (id_len == 7 && strncmp(id_buf, "ifnarch", 7) == 0) ||
                         (id_len == 4 && strncmp(id_buf, "ifos", 4) == 0) ||
                         (id_len == 5 && strncmp(id_buf, "ifnos", 5) == 0)) {
                    nesting++;
                }
                /* Check for section keywords */
                else if (is_section_keyword(id_buf, id_len)) {
                    /* Found a section keyword - this is top-level! */
                    return true;
                }
            }
            at_line_start = false;
        } else {
            /* Other character - not at line start anymore */
            at_line_start = false;
            lexer->advance(lexer, false);
        }
    }

    /* Reached EOF or max lines without finding section keyword */
    return false;
}

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
    uint32_t stack_size = scanner->literal_stack.size;
    memcpy(buffer + size, &stack_size, sizeof(uint32_t));
    size += sizeof(uint32_t);

    /* Serialize each literal in the stack */
    for (size_t i = 0; i < scanner->literal_stack.size; i++) {
        if (size + sizeof(struct Literal) >
            TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
            return 0;
        }

        memcpy(buffer + size, &scanner->literal_stack.contents[i],
               sizeof(struct Literal));
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
    /* Clear existing stack */
    array_clear(&scanner->literal_stack);

    if (length == 0) {
        return;
    }

    size_t size = 0;

    /* Deserialize the number of literals */
    if (size + sizeof(uint32_t) > length) {
        return;
    }
    uint32_t stack_size;
    memcpy(&stack_size, buffer + size, sizeof(stack_size));
    size += sizeof(uint32_t);

    /* Deserialize each literal */
    for (uint32_t i = 0; i < stack_size; i++) {
        if (size + sizeof(struct Literal) > length) {
            return;
        }

        struct Literal literal;
        memcpy(&literal, buffer + size, sizeof(literal));
        array_push(&scanner->literal_stack, literal);
        size += sizeof(struct Literal);
    }
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
 * @brief Scans macro content after the % prefix
 *
 * This function handles the content after % in macro expansions.
 * The grammar is responsible for matching the % prefix, then calls
 * the scanner to match the rest:
 * - % (second %) for escaped percent - returns ESCAPED_PERCENT
 * - !name for negated macro - returns NEGATED_MACRO
 * - name for simple macro - returns SIMPLE_MACRO
 * - *, **, #, 0-9, nil for special macros - returns SPECIAL_MACRO
 *
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid
 * @return true if a macro token was matched, false otherwise
 */
static bool scan_macro(TSLexer *lexer, const bool *valid_symbols)
{
    int32_t c = lexer->lookahead;

    /* Mark potential token start */
    lexer->mark_end(lexer);

    switch (c) {
    case '%':
        /* Second % for escaped percent (%%) */
        if (valid_symbols[ESCAPED_PERCENT]) {
            advance(lexer);
            lexer->mark_end(lexer);
            lexer->result_symbol = ESCAPED_PERCENT;
            return true;
        }
        return false;

    case '!':
        /* !name for negated macro */
        if (!valid_symbols[NEGATED_MACRO]) {
            return false;
        }
        advance(lexer);
        /* Check for !? which is conditional, not negated macro */
        if (lexer->lookahead == '?') {
            return false;
        }
        /* Must be followed by identifier */
        if (!is_identifier_start(lexer->lookahead)) {
            return false;
        }
        /* Consume identifier */
        while (is_identifier_char(lexer->lookahead)) {
            advance(lexer);
        }
        lexer->mark_end(lexer);
        lexer->result_symbol = NEGATED_MACRO;
        return true;

    case '*':
        /* * or ** for special macro */
        if (!valid_symbols[SPECIAL_MACRO]) {
            return false;
        }
        advance(lexer);
        if (lexer->lookahead == '*') {
            advance(lexer); /* ** */
        }
        lexer->mark_end(lexer);
        lexer->result_symbol = SPECIAL_MACRO;
        return true;

    case '#':
        /* # for argument count */
        if (!valid_symbols[SPECIAL_MACRO]) {
            return false;
        }
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = SPECIAL_MACRO;
        return true;

    default:
        /* Check for 0-9 (positional args) */
        if (is_digit(c)) {
            if (!valid_symbols[SPECIAL_MACRO]) {
                return false;
            }
            /* Consume all digits */
            while (is_digit(lexer->lookahead)) {
                advance(lexer);
            }
            lexer->mark_end(lexer);
            lexer->result_symbol = SPECIAL_MACRO;
            return true;
        }

        /* Check for identifier (simple macro) */
        if (is_identifier_start(c)) {
            if (!valid_symbols[SIMPLE_MACRO]) {
                return false;
            }

            /* Buffer the identifier to check for keywords */
            char id_buf[64];
            size_t id_len = 0;

            /* Consume identifier while buffering */
            while (is_identifier_char(lexer->lookahead) &&
                   id_len < sizeof(id_buf) - 1) {
                id_buf[id_len++] = (char)lexer->lookahead;
                advance(lexer);
            }
            /* Consume any remaining chars if buffer was too small */
            while (is_identifier_char(lexer->lookahead)) {
                advance(lexer);
                id_len++;
            }
            id_buf[id_len < sizeof(id_buf) ? id_len : sizeof(id_buf) - 1] = '\0';

            /* Check if it's a keyword - if so, don't match */
            if (is_keyword(id_buf, id_len)) {
                return false;
            }

            /* Check if it's legacy patch syntax (patchN) - let grammar handle */
            if (is_patch_legacy(id_buf, id_len)) {
                return false;
            }

            /* Check if it's "nil" - special macro, not simple macro */
            if (is_nil(id_buf, id_len)) {
                if (valid_symbols[SPECIAL_MACRO]) {
                    lexer->mark_end(lexer);
                    lexer->result_symbol = SPECIAL_MACRO;
                    return true;
                }
                return false;
            }

            lexer->mark_end(lexer);
            lexer->result_symbol = SIMPLE_MACRO;
            return true;
        }

        /* Not a recognized macro pattern */
        return false;
    }
}

/**
 * @brief Scan for context-aware conditional tokens (%if, %ifarch, %ifos)
 *
 * This function determines whether a conditional should be parsed as
 * top-level or shell-level based on:
 * 1. Which tokens the grammar says are valid (context)
 * 2. Lookahead to check if body contains section keywords
 *
 * The grammar controls context: if only TOP_LEVEL_* is valid, we're at
 * top-level. If SHELL_* is also valid, we're in a shell context and
 * need lookahead to decide.
 *
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid
 * @return true if a conditional token was matched, false otherwise
 */
static bool scan_conditional(TSLexer *lexer, const bool *valid_symbols)
{
    /* Check if any conditional tokens are valid */
    bool top_if_valid = valid_symbols[TOP_LEVEL_IF];
    bool shell_if_valid = valid_symbols[SHELL_IF];
    bool top_ifarch_valid = valid_symbols[TOP_LEVEL_IFARCH];
    bool shell_ifarch_valid = valid_symbols[SHELL_IFARCH];
    bool top_ifnarch_valid = valid_symbols[TOP_LEVEL_IFNARCH];
    bool shell_ifnarch_valid = valid_symbols[SHELL_IFNARCH];
    bool top_ifos_valid = valid_symbols[TOP_LEVEL_IFOS];
    bool shell_ifos_valid = valid_symbols[SHELL_IFOS];
    bool top_ifnos_valid = valid_symbols[TOP_LEVEL_IFNOS];
    bool shell_ifnos_valid = valid_symbols[SHELL_IFNOS];

    bool any_if_valid = top_if_valid || shell_if_valid;
    bool any_ifarch_valid = top_ifarch_valid || shell_ifarch_valid;
    bool any_ifnarch_valid = top_ifnarch_valid || shell_ifnarch_valid;
    bool any_ifos_valid = top_ifos_valid || shell_ifos_valid;
    bool any_ifnos_valid = top_ifnos_valid || shell_ifnos_valid;

    if (!any_if_valid && !any_ifarch_valid && !any_ifnarch_valid &&
        !any_ifos_valid && !any_ifnos_valid) {
        return false;
    }

    /* Skip leading whitespace */
    skip_whitespace(lexer);

    /* Must start with '%' */
    if (lexer->lookahead != '%') {
        return false;
    }

    lexer->mark_end(lexer);
    lexer->advance(lexer, false); /* consume '%' */

    /* Match the keyword after '%' */
    char id_buf[16];
    size_t id_len = 0;

    while (is_identifier_char(lexer->lookahead) && id_len < sizeof(id_buf) - 1) {
        id_buf[id_len++] = (char)lexer->lookahead;
        lexer->advance(lexer, false);
    }
    id_buf[id_len] = '\0';

    if (id_len == 0) {
        return false;
    }

    /* Determine the keyword type and which tokens are valid for it */
    enum TokenType top_token;
    enum TokenType shell_token;
    bool top_valid;
    bool shell_valid;

    if ((id_len == 2 && strncmp(id_buf, "if", 2) == 0) && any_if_valid) {
        top_token = TOP_LEVEL_IF;
        shell_token = SHELL_IF;
        top_valid = top_if_valid;
        shell_valid = shell_if_valid;
    } else if ((id_len == 6 && strncmp(id_buf, "ifarch", 6) == 0) &&
               any_ifarch_valid) {
        top_token = TOP_LEVEL_IFARCH;
        shell_token = SHELL_IFARCH;
        top_valid = top_ifarch_valid;
        shell_valid = shell_ifarch_valid;
    } else if ((id_len == 7 && strncmp(id_buf, "ifnarch", 7) == 0) &&
               any_ifnarch_valid) {
        top_token = TOP_LEVEL_IFNARCH;
        shell_token = SHELL_IFNARCH;
        top_valid = top_ifnarch_valid;
        shell_valid = shell_ifnarch_valid;
    } else if ((id_len == 4 && strncmp(id_buf, "ifos", 4) == 0) &&
               any_ifos_valid) {
        top_token = TOP_LEVEL_IFOS;
        shell_token = SHELL_IFOS;
        top_valid = top_ifos_valid;
        shell_valid = shell_ifos_valid;
    } else if ((id_len == 5 && strncmp(id_buf, "ifnos", 5) == 0) &&
               any_ifnos_valid) {
        top_token = TOP_LEVEL_IFNOS;
        shell_token = SHELL_IFNOS;
        top_valid = top_ifnos_valid;
        shell_valid = shell_ifnos_valid;
    } else {
        /* Not a conditional keyword we handle */
        return false;
    }

    lexer->mark_end(lexer);

    /* Decide which token to emit based on what's valid */
    if (top_valid && !shell_valid) {
        /* Only top-level is valid - we're at top-level context */
        lexer->result_symbol = top_token;
        return true;
    }

    if (shell_valid && !top_valid) {
        /* Only shell is valid - we're in pure shell context */
        lexer->result_symbol = shell_token;
        return true;
    }

    /* Both are valid - need lookahead to decide */
    if (lookahead_finds_section_keyword(lexer)) {
        /* Body contains sections - this is a top-level conditional */
        lexer->result_symbol = top_token;
    } else {
        /* Body is pure shell - this is a shell-level conditional */
        lexer->result_symbol = shell_token;
    }
    return true;
}

/**
 * @brief Main scanning function for RPM spec tokens
 *
 * This is the primary entry point for token recognition. It attempts to
 * identify and parse various RPM spec syntax elements, particularly macro
 * expressions and escape sequences.
 *
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid at this
 * position
 * @return true if a token was successfully recognized, false otherwise
 */
static inline bool
rpmspec_scan(TSLexer *lexer, const bool *valid_symbols)
{
    /* EXPAND_CODE and SHELL_CODE are contextual - only valid inside
     * %{expand:...} and %(...) respectively. Check these first. */
    if (valid_symbols[EXPAND_CODE]) {
        if (scan_expand_content(lexer)) {
            lexer->result_symbol = EXPAND_CODE;
            return true;
        }
    }

    if (valid_symbols[SHELL_CODE]) {
        if (scan_shell_content(lexer)) {
            lexer->result_symbol = SHELL_CODE;
            return true;
        }
    }

    /* Try to scan context-aware conditional tokens */
    if (scan_conditional(lexer, valid_symbols)) {
        return true;
    }

    /* Try to scan macro tokens */
    if (valid_symbols[SIMPLE_MACRO] || valid_symbols[NEGATED_MACRO] ||
        valid_symbols[SPECIAL_MACRO] || valid_symbols[ESCAPED_PERCENT]) {
        return scan_macro(lexer, valid_symbols);
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
void *tree_sitter_rpmspec_external_scanner_create(void)
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
    (void)payload; /* Scanner state not currently used */

    return rpmspec_scan(lexer, valid_symbols);
}
