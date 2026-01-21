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

/**
 * @brief Maximum lines to scan ahead for section keywords
 *
 * This bounds the lookahead to avoid pathological cases with very large
 * conditional blocks. 2000 lines should cover most real-world specs.
 */
#define MAX_LOOKAHEAD_LINES 2000

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
    /* Context-aware conditional tokens for distinguishing top-level vs scriptlet */
    TOP_LEVEL_IF,     /**< %if at top-level or containing section keywords */
    SCRIPTLET_IF,         /**< %if inside scriptlet section without section keywords */
    TOP_LEVEL_IFARCH, /**< %ifarch at top-level */
    SCRIPTLET_IFARCH,     /**< %ifarch inside scriptlet section */
    TOP_LEVEL_IFNARCH,/**< %ifnarch at top-level */
    SCRIPTLET_IFNARCH,    /**< %ifnarch inside scriptlet section */
    TOP_LEVEL_IFOS,   /**< %ifos at top-level */
    SCRIPTLET_IFOS,       /**< %ifos inside scriptlet section */
    TOP_LEVEL_IFNOS,  /**< %ifnos at top-level */
    SCRIPTLET_IFNOS,      /**< %ifnos inside scriptlet section */
    /* Files section context tokens */
    FILES_IF,         /**< %if inside %files section */
    FILES_IFARCH,     /**< %ifarch inside %files section */
    FILES_IFNARCH,    /**< %ifnarch inside %files section */
    FILES_IFOS,       /**< %ifos inside %files section */
    FILES_IFNOS,      /**< %ifnos inside %files section */
    /* Context-specific tokens - only valid in specific macro contexts */
    EXPAND_CODE,      /**< Raw text inside %{expand:...} with balanced braces */
    SHELL_CODE        /**< Raw text inside %(...) with balanced parentheses */
};

/**
 * @brief Main scanner state structure
 *
 * Contains cached lookahead results to avoid expensive repeated scans.
 * When parsing nested conditionals, we often need to scan ahead to check
 * if the block contains section keywords. Caching avoids re-scanning
 * the same content for each nested conditional.
 */
struct Scanner {
    bool lookahead_cache_valid;  /**< Whether cached result is valid */
    bool lookahead_has_section;  /**< Cached result: found section keyword? */
};

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
 * @brief Section keywords that indicate top-level context
 *
 * When a %if body contains any of these keywords, it should be
 * parsed as a top-level conditional, not a scriptlet-level one.
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
    return is_identifier_start(c) || isdigit(c);
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
 * @brief Check if identifier matches a literal string
 *
 * Compares a length-prefixed string against a null-terminated literal.
 * More readable than the raw (len == X && strncmp(...) == 0) pattern.
 *
 * @param literal The null-terminated string to compare against
 * @param id The identifier buffer (not null-terminated)
 * @param len Length of the identifier
 * @return true if they match, false otherwise
 */
static inline bool strequal(const char *literal, const char *id, size_t len)
{
    size_t lit_len = strlen(literal);
    return len == lit_len && strncmp(id, literal, lit_len) == 0;
}

/**
 * @brief Check if identifier is "nil" (special macro)
 */
static inline bool is_nil(const char *id, size_t len)
{
    return strequal("nil", id, len);
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
 * @brief Lookahead to check if %if body contains section keywords
 *
 * When we encounter %if inside a scriptlet section, we need to determine
 * whether it's a scriptlet-level conditional (e.g., if [ -f foo ]; then)
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
                if (strequal("endif", id_buf, id_len)) {
                    nesting--;
                    if (nesting == 0) {
                        /* Found matching %endif - no section keywords found */
                        return false;
                    }
                }
                /* Check for nested %if/%ifarch/%ifos */
                else if (strequal("if", id_buf, id_len) ||
                         strequal("ifarch", id_buf, id_len) ||
                         strequal("ifnarch", id_buf, id_len) ||
                         strequal("ifos", id_buf, id_len) ||
                         strequal("ifnos", id_buf, id_len)) {
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
    /* Serialize the lookahead cache (2 bytes) */
    if (2 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        return 0;
    }

    buffer[0] = scanner->lookahead_cache_valid ? 1 : 0;
    buffer[1] = scanner->lookahead_has_section ? 1 : 0;

    return 2;
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
    /* Clear cache by default */
    scanner->lookahead_cache_valid = false;
    scanner->lookahead_has_section = false;

    if (length < 2) {
        return;
    }

    /* Deserialize the lookahead cache */
    scanner->lookahead_cache_valid = buffer[0] != 0;
    scanner->lookahead_has_section = buffer[1] != 0;
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
        switch (lexer->lookahead) {
        case '%':
            /* Mark position before % so we can stop here if needed */
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->eof(lexer)) {
                /* Trailing % at EOF - include it */
                lexer->mark_end(lexer);
                has_content = true;
                goto done;
            }

            switch (lexer->lookahead) {
            case '%':
            case '#':
            case '*':
                /* %%, %#, %* - consume as content (escaped or special macro) */
                /* These will be re-evaluated after expand */
                advance(lexer);
                lexer->mark_end(lexer);
                has_content = true;
                continue;
            case '{':
                /* %{ - real macro expansion, stop BEFORE the % */
                /* mark_end was called before %, so token ends there */
                goto done;
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                /* %0-%9 - positional arg, consume as content */
                while (isdigit(lexer->lookahead)) {
                    advance(lexer);
                }
                lexer->mark_end(lexer);
                has_content = true;
                continue;
            default:
                /* Other % sequences - include % and continue */
                lexer->mark_end(lexer);
                has_content = true;
                continue;
            }
        case '{':
            /* Nested opening brace - track depth */
            brace_depth++;
            has_content = true;
            advance(lexer);
            lexer->mark_end(lexer);
            continue;
        case '}':
            if (brace_depth == 0) {
                /* This is the closing brace of %{expand:...} */
                /* Don't consume it - let the grammar handle it */
                goto done;
            }
            /* Closing a nested brace */
            brace_depth--;
            has_content = true;
            advance(lexer);
            lexer->mark_end(lexer);
            continue;
        default:
            /* Any other character is part of the content */
            has_content = true;
            advance(lexer);
            lexer->mark_end(lexer);
            continue;
        }
    }

done:

    /* Note: mark_end is called inline after consuming each character/sequence.
     * This ensures we don't overwrite the mark set before %{ when we break. */

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
        switch (lexer->lookahead) {
        case '%':
            /* Potential macro start - stop and let grammar handle it */
            goto done;
        case '(':
            /* Nested opening paren - track depth */
            paren_depth++;
            has_content = true;
            advance(lexer);
            continue;
        case ')':
            if (paren_depth == 0) {
                /* This is the closing paren of %(...) */
                /* Don't consume it - let the grammar handle it */
                goto done;
            }
            /* Closing a nested paren */
            paren_depth--;
            has_content = true;
            advance(lexer);
            continue;
        default:
            /* Any other character is part of the content */
            has_content = true;
            advance(lexer);
            continue;
        }
    }

done:
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
        if (isdigit(c)) {
            if (!valid_symbols[SPECIAL_MACRO]) {
                return false;
            }
            /* Consume all digits */
            while (isdigit(lexer->lookahead)) {
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
 * top-level or scriptlet-level based on:
 * 1. Which tokens the grammar says are valid (context)
 * 2. Lookahead to check if body contains section keywords
 *
 * The grammar controls context: if only TOP_LEVEL_* is valid, we're at
 * top-level. If scriptlet_* is also valid, we're in a scriptlet context and
 * need lookahead to decide.
 *
 * @param lexer The Tree-sitter lexer instance
 * @param valid_symbols Array indicating which token types are valid
 * @return true if a conditional token was matched, false otherwise
 */
/**
 * @brief Check for section keywords with caching
 *
 * Uses cached result if available, otherwise performs lookahead and caches.
 */
static bool cached_lookahead_finds_section(struct Scanner *scanner,
                                           TSLexer *lexer)
{
    if (scanner->lookahead_cache_valid) {
        return scanner->lookahead_has_section;
    }

    bool result = lookahead_finds_section_keyword(lexer);
    scanner->lookahead_cache_valid = true;
    scanner->lookahead_has_section = result;
    return result;
}

static bool scan_conditional(struct Scanner *scanner, TSLexer *lexer,
                             const bool *valid_symbols)
{
    /* Check if any conditional tokens are valid */
    bool top_if_valid = valid_symbols[TOP_LEVEL_IF];
    bool scriptlet_if_valid = valid_symbols[SCRIPTLET_IF];
    bool files_if_valid = valid_symbols[FILES_IF];
    bool top_ifarch_valid = valid_symbols[TOP_LEVEL_IFARCH];
    bool scriptlet_ifarch_valid = valid_symbols[SCRIPTLET_IFARCH];
    bool files_ifarch_valid = valid_symbols[FILES_IFARCH];
    bool top_ifnarch_valid = valid_symbols[TOP_LEVEL_IFNARCH];
    bool scriptlet_ifnarch_valid = valid_symbols[SCRIPTLET_IFNARCH];
    bool files_ifnarch_valid = valid_symbols[FILES_IFNARCH];
    bool top_ifos_valid = valid_symbols[TOP_LEVEL_IFOS];
    bool scriptlet_ifos_valid = valid_symbols[SCRIPTLET_IFOS];
    bool files_ifos_valid = valid_symbols[FILES_IFOS];
    bool top_ifnos_valid = valid_symbols[TOP_LEVEL_IFNOS];
    bool scriptlet_ifnos_valid = valid_symbols[SCRIPTLET_IFNOS];
    bool files_ifnos_valid = valid_symbols[FILES_IFNOS];

    bool any_if_valid = top_if_valid || scriptlet_if_valid || files_if_valid;
    bool any_ifarch_valid = top_ifarch_valid || scriptlet_ifarch_valid || files_ifarch_valid;
    bool any_ifnarch_valid = top_ifnarch_valid || scriptlet_ifnarch_valid || files_ifnarch_valid;
    bool any_ifos_valid = top_ifos_valid || scriptlet_ifos_valid || files_ifos_valid;
    bool any_ifnos_valid = top_ifnos_valid || scriptlet_ifnos_valid || files_ifnos_valid;

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
    enum TokenType scriptlet_token;
    enum TokenType files_token;
    bool top_valid;
    bool scriptlet_valid;
    bool files_valid;

    if (strequal("if", id_buf, id_len) && any_if_valid) {
        top_token = TOP_LEVEL_IF;
        scriptlet_token = SCRIPTLET_IF;
        files_token = FILES_IF;
        top_valid = top_if_valid;
        scriptlet_valid = scriptlet_if_valid;
        files_valid = files_if_valid;
    } else if (strequal("ifarch", id_buf, id_len) && any_ifarch_valid) {
        top_token = TOP_LEVEL_IFARCH;
        scriptlet_token = SCRIPTLET_IFARCH;
        files_token = FILES_IFARCH;
        top_valid = top_ifarch_valid;
        scriptlet_valid = scriptlet_ifarch_valid;
        files_valid = files_ifarch_valid;
    } else if (strequal("ifnarch", id_buf, id_len) && any_ifnarch_valid) {
        top_token = TOP_LEVEL_IFNARCH;
        scriptlet_token = SCRIPTLET_IFNARCH;
        files_token = FILES_IFNARCH;
        top_valid = top_ifnarch_valid;
        scriptlet_valid = scriptlet_ifnarch_valid;
        files_valid = files_ifnarch_valid;
    } else if (strequal("ifos", id_buf, id_len) && any_ifos_valid) {
        top_token = TOP_LEVEL_IFOS;
        scriptlet_token = SCRIPTLET_IFOS;
        files_token = FILES_IFOS;
        top_valid = top_ifos_valid;
        scriptlet_valid = scriptlet_ifos_valid;
        files_valid = files_ifos_valid;
    } else if (strequal("ifnos", id_buf, id_len) && any_ifnos_valid) {
        top_token = TOP_LEVEL_IFNOS;
        scriptlet_token = SCRIPTLET_IFNOS;
        files_token = FILES_IFNOS;
        top_valid = top_ifnos_valid;
        scriptlet_valid = scriptlet_ifnos_valid;
        files_valid = files_ifnos_valid;
    } else {
        /* Not a conditional keyword we handle */
        return false;
    }

    lexer->mark_end(lexer);

    /* Decide which token to emit based on what's valid */
    /*
     * Priority order for context determination:
     * 1. Files context - most specific, if files token is valid, we're in %files
     * 2. Scriptlet context (exclusive) - if only scriptlet is valid
     * 3. Top-level context (exclusive) - if only top-level is valid
     * 4. Ambiguous (top + scriptlet) - use lookahead to decide
     *
     * For files and scriptlet contexts, we need lookahead to check if the
     * conditional body contains section keywords. If it does, the conditional
     * should be parsed as top-level to allow new sections inside it.
     */
    if (files_valid && !top_valid && !scriptlet_valid) {
        /* Only files is valid - check for section keywords */
        if (cached_lookahead_finds_section(scanner, lexer)) {
            /* Body contains sections - but we can't emit top_token here
             * since top_valid is false. This is a grammar ambiguity.
             * Fall back to files_token and let grammar handle it. */
            lexer->result_symbol = files_token;
        } else {
            lexer->result_symbol = files_token;
        }
        return true;
    }

    if (files_valid && top_valid) {
        /* Both files and top are valid - prefer files context.
         * The grammar's _files_conditional_content can handle nested
         * %files sections, so we don't need lookahead to switch to top-level.
         * This allows file entries before nested sections to parse correctly. */
        lexer->result_symbol = files_token;
        return true;
    }

    if (top_valid && !scriptlet_valid && !files_valid) {
        /* Only top-level is valid - we're at top-level context
         * Invalidate cache since context changed */
        scanner->lookahead_cache_valid = false;
        lexer->result_symbol = top_token;
        return true;
    }

    if (scriptlet_valid && !top_valid && !files_valid) {
        /* Only scriptlet is valid - we're in pure scriptlet context
         * Invalidate cache since context changed */
        scanner->lookahead_cache_valid = false;
        lexer->result_symbol = scriptlet_token;
        return true;
    }

    /* Both top and scriptlet are valid - need lookahead to decide */
    if (cached_lookahead_finds_section(scanner, lexer)) {
        /* Body contains sections - this is a top-level conditional */
        lexer->result_symbol = top_token;
    } else {
        /* Body is pure scriptlet - this is a scriptlet-level conditional */
        lexer->result_symbol = scriptlet_token;
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
rpmspec_scan(struct Scanner *scanner, TSLexer *lexer, const bool *valid_symbols)
{
    /* Try to scan context-aware conditional tokens */
    if (scan_conditional(scanner, lexer, valid_symbols)) {
        return true;
    }

    /* Try to scan macro tokens */
    if (valid_symbols[SIMPLE_MACRO] || valid_symbols[NEGATED_MACRO] ||
        valid_symbols[SPECIAL_MACRO] || valid_symbols[ESCAPED_PERCENT]) {
        return scan_macro(lexer, valid_symbols);
    }

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
