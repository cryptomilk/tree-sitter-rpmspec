/**
 * @file Tree-sitter grammar definition for RPM spec files
 *
 * This grammar parses RPM spec files according to the RPM specification.
 * RPM spec files contain metadata and instructions for building RPM packages,
 * including dependencies, build scripts, and file listings.
 *
 * @author Andreas Schneider
 * @author Omair Majid
 * @license MIT
 * @see {@link https://rpm-software-management.github.io/rpm/manual/spec.html|RPM spec syntax documentation}
 * @see {@link https://docs.fedoraproject.org/en-US/packaging-guidelines/|Fedora packaging guidelines}
 * @see {@link https://rpm-packaging-guide.github.io/|RPM packaging guide}
 */

/**
 * Precedence constants for expression parsing
 *
 * These values define the operator precedence in macro expressions.
 * Higher numbers indicate higher precedence (tighter binding).
 * Based on standard mathematical and logical operator precedence.
 */
const PREC = {
    parenthesized_expression: 1, // Lowest precedence for parentheses

    // Ternary operator (lowest precedence after parentheses)
    ternary: 5, // ? : (right-associative)

    // Logical operators (lower precedence)
    or: 10, // ||, or
    and: 11, // &&, and
    not: 12, // !

    // Comparison operators
    compare: 13, // <, <=, ==, !=, >=, >

    // Arithmetic operators (higher precedence)
    plus: 14, // +, -
    times: 15, // *, /

    // Dependency parsing
    dependency_concat: 20, // Higher precedence for dependency name/version concatenation

    // Boolean dependencies (separate from conditional expression operators)
    boolean_if_dep: 21, // 'if'/'unless' conditionals (lowest)
    boolean_or_dep: 22, // 'or' in boolean dependencies
    boolean_and_dep: 23, // 'and' in boolean dependencies (higher than or)
    boolean_with_dep: 24, // 'with'/'without' modifiers
    boolean_operand: 25, // Base operand in boolean dependency
};

/**
 * Common regex patterns used throughout the grammar
 */
const NEWLINE = /\r?\n/; // Cross-platform newline (Unix/Windows)
const ANYTHING = /[^\r\n]*/; // Any character except newlines
const BLANK = /( |\t)+/; // One or more spaces or tabs

/**
 * Special characters that have syntactic meaning in RPM spec files
 *
 * These characters are excluded from the word token and handled by specific rules.
 * Pattern borrowed from tree-sitter-bash, adapted for RPM spec syntax:
 * - % replaces $ as the macro expansion prefix
 * - Similar handling of quotes, braces, parentheses, etc.
 */
const SPECIAL_CHARACTERS = [
    '"',
    '<',
    '>',
    '{',
    '}',
    '\\[',
    '\\]',
    '(',
    ')',
    '%',
    '|',
    '\\\\',
    '\\s',
    '#',
];

/**
 * Special characters for package names
 *
 * Package names have stricter rules than general words:
 * - Must not include whitespace or version comparison operators (<>=)
 */
const PACKAGE_NAME_SPECIAL_CHARS = [...SPECIAL_CHARACTERS, '&', '=', ','];

/**
 * Creates a build scriptlet rule with -a (append) and -p (prepend) options
 *
 * Build scriptlets support augmentation options since rpm >= 4.20.
 * This helper generates the grammar rule for scriptlets like %prep, %build,
 * %install, %check, %clean, %conf, and %generate_buildrequires.
 *
 * @param {string} name - The scriptlet name without % prefix (e.g., 'prep', 'build')
 * @returns {function} A grammar rule function for the scriptlet
 */
function buildScriptlet(name, sectionToken) {
    // Uses external token for word boundary checking
    // This prevents %conf from matching %configure
    return ($) =>
        prec.right(
            choice(
                // With options: %name -a or %name -p
                seq(
                    alias(sectionToken($), $.section_name),
                    field('argument', $.scriptlet_augment_option),
                    /\n/,
                    optional($.script_block)
                ),
                // Without options: %name
                seq(
                    alias(sectionToken($), $.section_name),
                    /\n/,
                    optional($.script_block)
                )
            )
        );
}

/**
 * Main grammar definition for RPM spec files
 *
 * The grammar is structured to handle the complex nature of RPM spec files,
 * which combine structured metadata (preamble) with shell scripts and
 * sophisticated macro expansion capabilities.
 *
 * @see {@link https://rpm-software-management.github.io/rpm/manual/spec.html|RPM spec file format}
 */
module.exports = grammar({
    name: 'rpmspec',

    // Tokens that may appear anywhere in the language and are typically ignored
    // during parsing (whitespace, comments, line continuations)
    extras: ($) => [
        $.comment, // # comments and %dnl comments
        /\s/, // All whitespace characters (single, matched repeatedly)
        /\\( |\t|\v|\f)/, // Escaped whitespace characters
        // Note: line_continuation is handled explicitly in rules that need it
        // (script_line, _macro_value) rather than globally in extras
    ],

    // Supertypes define abstract syntax tree node categories
    // These help with syntax highlighting and semantic analysis
    supertypes: ($) => [
        $._compound_statements, // Multi-line blocks (if/else, sections)
        $.expression, // Mathematical and logical expressions
        $._primary_expression, // Basic expression components
    ],

    // Conflict resolution for ambiguous grammar rules
    conflicts: ($) => [
        // file_path: After a path segment, a % could either continue the current
        // path (e.g., /usr/%{name}) or start a new path. Let GLR handle it.
        [$.file_path],
        // REMOVED: [$.package_name, $.text] - resolved with precedence (package_name prec 1, text prec -1)
        // script_block vs script_line: A conditional inside script_block could be
        // a direct child of script_block or embedded inside script_line (for line
        // continuation sequences with conditionals).
        [$.script_block, $.script_line],
        // header vs body: Macros and conditionals can appear in both contexts.
        // At the boundary, GLR handles the ambiguity.
        [$._header_item, $._body_item],
        [$._header_statements, $._body_statements],
    ],

    // External scanner tokens (implemented in src/scanner.c)
    // Order must match enum TokenType in scanner.c
    //
    // ORDERING: Tokens are ordered by frequency - most common first.
    // This improves error recovery behavior since tree-sitter may try
    // tokens in order. simple_macro (%name) is ~80% of macro usage.
    externals: ($) => [
        // Most common tokens first
        $.simple_macro, // Simple macro %name (most common ~80%)
        $.parametric_macro_name, // %name at line start for parametric expansion
        $.negated_macro, // Negated macro %!name
        $.special_macro, // Special macros: %*, %**, %#, %0-9
        $.escaped_percent, // Escaped percent: %%
        // Context-aware conditional tokens (top-level)
        $.top_level_if, // %if at top-level or containing section keywords
        $.top_level_ifarch, // %ifarch at top-level
        $.top_level_ifnarch, // %ifnarch at top-level
        $.top_level_ifos, // %ifos at top-level
        $.top_level_ifnos, // %ifnos at top-level
        // Subsection context tokens (description, package, sourcelist, patchlist)
        $.subsection_if, // %if inside subsection (text content)
        $.subsection_ifarch, // %ifarch inside subsection
        $.subsection_ifnarch, // %ifnarch inside subsection
        $.subsection_ifos, // %ifos inside subsection
        $.subsection_ifnos, // %ifnos inside subsection
        // Scriptlet section context tokens
        $.scriptlet_if, // %if inside scriptlet section without section keywords
        $.scriptlet_ifarch, // %ifarch inside scriptlet section
        $.scriptlet_ifnarch, // %ifnarch inside scriptlet section
        $.scriptlet_ifos, // %ifos inside scriptlet section
        $.scriptlet_ifnos, // %ifnos inside scriptlet section
        // Files section context tokens
        $.files_if, // %if inside %files section
        $.files_ifarch, // %ifarch inside %files section
        $.files_ifnarch, // %ifnarch inside %files section
        $.files_ifos, // %ifos inside %files section
        $.files_ifnos, // %ifnos inside %files section
        // Context-specific tokens (only valid in specific macro contexts)
        $.expand_code, // Raw text inside %{expand:...} with balanced braces
        $.script_code, // Raw text inside %(...) with balanced parentheses
        // Scriptlet section tokens with word boundary checking
        // Prevents %conf from matching %configure
        $.section_prep,
        $.section_generate_buildrequires,
        $.section_conf,
        $.section_build,
        $.section_install,
        $.section_check,
        $.section_clean,
        // Newline token for explicit line termination
        /\n/,
    ],

    // Inline rules are flattened in the parse tree to reduce nesting
    // This improves the tree structure for syntax highlighting and analysis
    inline: ($) => [
        // Note: _header_statements and _body_statements are NOT inlined
        // to allow proper conflict resolution at the header/body boundary
        $._compound_statements, // Flatten compound statement types
        $._scriptlet_compound_statements, // Flatten shell compound statement types
        $._files_compound_statements, // Flatten files compound statement types
        $._conditional_block, // Flatten conditional block contents
        $._scriptlet_conditional_content, // Flatten shell conditional content
        $._files_conditional_content, // Flatten files conditional content
        $._literal, // Flatten literal value types
        $._macro_inline, // Flatten inline macro types
        $._macro_statement, // Flatten macro statement types
    ],

    // Default token type for unrecognized words
    word: ($) => $.identifier,

    rules: {
        // Root rule: An RPM spec file has header (preamble) then body (sections)
        // Header contains preamble tags, %package, %description, macros
        // Body contains scriptlets, %files, %changelog (NO preamble tags)
        spec: ($) =>
            seq(repeat($._header_statements), repeat($._body_statements)),

        // Header statements: preamble tags allowed here
        // Includes: preamble, %package (with its own preamble), %description, macros
        _header_statements: ($) =>
            choice($._header_item, $._compound_statements),

        // Common macro statements that can appear in multiple contexts
        // Extracted to reduce duplication and potentially share parser states
        _macro_statement: ($) =>
            choice(
                $.macro_definition, // %define, %global
                $.macro_undefinition, // %undefine
                $.macro_expansion, // %{name}
                $.macro_parametric_expansion, // %name [options] [arguments]
                $.macro_simple_expansion, // %name
                $.macro_shell_expansion, // %(shell command)
                $.macro_expression // %[expression]
            ),

        // Inline macro expansions that can appear within text/values
        // These don't consume the whole line (unlike macro_parametric_expansion)
        _macro_inline: ($) =>
            choice(
                $.macro_expansion, // %{name}
                $.macro_simple_expansion, // %name
                $.macro_shell_expansion, // %(shell command)
                $.macro_expression // %[expression]
            ),

        _header_item: ($) =>
            choice(
                $._macro_statement,
                $.preamble, // Name:, Version:, etc.
                $.description, // %description section
                $.package, // %package subsection (has its own preamble)
                $.sourcelist, // %sourcelist section
                $.patchlist // %patchlist section
            ),

        // Body statements: NO preamble tags allowed here
        // Includes: scriptlets, %files, %changelog, macros
        _body_statements: ($) => choice($._body_item, $._compound_statements),

        _body_item: ($) =>
            choice(
                $._macro_statement,
                // NO preamble here - preamble tags not valid in body
                $.description, // %description can appear in body too
                $.package, // %package can appear in body too
                $.prep_scriptlet, // %prep section
                $.generate_buildrequires, // %generate_buildrequires section
                $.conf_scriptlet, // %conf section
                $.build_scriptlet, // %build section
                $.install_scriptlet, // %install section
                $.check_scriptlet, // %check section
                $.clean_scriptlet, // %clean section
                $.runtime_scriptlet, // %pre, %post without -p (bash default)
                $.runtime_scriptlet_interpreter, // %pre, %post with -p interpreter
                $.trigger, // %triggerin, %triggerun, etc.
                $.file_trigger, // %filetriggerin, etc.
                $.files, // %files section
                $.changelog // %changelog section
            ),

        // Comments: traditional # comments and %dnl (do not list) comments
        comment: ($) =>
            token(
                choice(
                    seq('#', ANYTHING), // Shell-style comments
                    seq('%dnl ', ANYTHING) // RPM "do not list" comments
                )
            ),

        // Line continuation: backslash at end of line
        line_continuation: (_) =>
            token(
                prec(
                    1,
                    seq(
                        '\\',
                        choice(
                            seq(optional('\r'), '\n'), // Backslash-newline
                            '\0' // Backslash-null (rare)
                        )
                    )
                )
            ),

        // Escape sequence: backslash followed by any character (not newline)
        // Used in regex patterns like ^golang\\(.*\\)$ where \\ = literal backslash
        // and \\( = literal \( (escaped paren in regex)
        escape_sequence: (_) => token(seq('\\', /[^\r\n]/)),

        identifier: (_) =>
            /(\p{XID_Start}|\$|_|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})(\p{XID_Continue}|\$|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*/,

        ///////////////////////////////////////////////////////////////////////
        // LITERALS AND PRIMARY EXPRESSIONS
        //
        // This section defines the basic building blocks of RPM spec syntax:
        // - String literals (quoted and unquoted)
        // - Numeric literals (integers, floats, version numbers)
        // - Macro expansions (simple and complex forms)
        // - Parenthesized expressions for precedence control
        ///////////////////////////////////////////////////////////////////////

        // Literal values: either concatenated expressions or primary expressions
        _literal: ($) => choice($.concatenation, $._primary_expression),

        // Primary expressions: the basic atomic values in RPM specs
        // Precedence 1 ensures these bind tightly in larger expressions
        // Note: Macros listed explicitly here (not via _macro_inline) to avoid
        // conflicts with $.string in expression contexts
        _primary_expression: ($) =>
            prec(
                1,
                choice(
                    $.word, // Unquoted words
                    $.quoted_string, // "quoted strings"
                    $.integer, // 123, 0x1a
                    $.version, // Version literals like 1.2.3
                    $.float, // 1.23
                    $.version_literal, // v"3:1.2-1" for macro expressions
                    $.parenthesized_expression, // (expr)
                    $.macro_simple_expansion, // %name
                    $.macro_expansion, // %{name}
                    $.macro_shell_expansion, // %(shell command)
                    $.macro_expression // %[expression]
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // PATH TYPES
        // Filesystem paths used by path-taking builtins like %{basename:},
        // %{dirname:}, %{exists:}, etc.
        // Paths can contain Unicode (Umlauts, etc.) - almost any char except
        // whitespace and RPM special characters.
        ///////////////////////////////////////////////////////////////////////

        // Path that can contain macro expansions
        // Examples: /usr/share/%{name}, %{_datadir}/foo, /path/with/Ümlauts
        // Pattern excludes :// to prevent matching URLs
        // prec.left ensures greedy left-to-right matching of path segments
        path_with_macro: ($) =>
            prec.left(
                repeat1(
                    choice(
                        // Match path segments that don't contain ://
                        // - Any chars without colon
                        // - Colon not followed by /
                        // - Colon-slash not followed by /
                        /[^\s{}%:]+|:[^\s{}%\/]|:\/[^\s{}%\/]/,
                        $.macro_simple_expansion,
                        $.macro_expansion
                    )
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // URL TYPES
        // URLs used by url2path builtin to extract path component
        ///////////////////////////////////////////////////////////////////////

        // URL with optional macro expansions
        // Examples: https://example.org/%{name}-%{version}.tar.gz
        // prec.left ensures greedy left-to-right matching of URL segments
        url_with_macro: ($) =>
            prec.left(
                seq(
                    // Protocol prefix as single token to avoid conflicts
                    token(seq(choice('http', 'https', 'ftp', 'file'), '://')),
                    // URL body - can contain macros
                    repeat1(
                        choice(
                            /[^\s{}%]+/,
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    )
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // MACRO SYSTEM
        // RPM's macro system is a powerful text substitution mechanism that
        // allows for:
        // - Variable definitions and expansions (%define, %global)
        // - Conditional text inclusion (%{?macro:text})
        // - Shell command execution (%(command))
        // - Built-in utility macros (%basename, %dirname, etc.)
        // - Architecture and OS conditionals (%ifarch, %ifos)
        //
        // Macro syntax forms:
        // - Simple: %name
        // - Complex: %{name}, %{name:default}, %{name arg1 arg2}
        // - Conditional: %{?name:value}, %{!?name:value}
        // - Shell: %(shell command)
        ///////////////////////////////////////////////////////////////////////

        // Macro names: alphanumeric identifiers starting with letter or underscore
        macro_name: (_) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        //// Simple Macro Expansion: %name
        //
        // The simplest form of macro expansion, directly substituting %name with its value
        // Supports optional negation operator (!) and special variables
        // Note: External scanner handles:
        // - %*, %**, %#, %0-9 - special variables (special_macro)
        // - %% - escaped percent (escaped_percent)
        // Simple macro expansion using external scanner tokens
        // - %name: simple_macro from scanner
        // - %!name: negated_macro from scanner
        // - %*, %#, %0-9, %nil: special_macro from scanner
        // - %?name: conditional_expansion still handled by grammar
        macro_simple_expansion: ($) =>
            choice(
                seq('%', $.simple_macro), // %name
                seq('%', $.negated_macro), // %!name
                seq('%', $.special_macro), // %*, %#, etc.
                seq('%', $.conditional_expansion), // %?name, %!?name
                seq('%', $.escaped_percent) // %% - escaped percent
            ),

        // Parametric macro invocation: %name [options] [arguments]
        // Arguments are parsed until end of line (newline)
        // Examples: %bcond bzip2 1, %autosetup -p1 -n %{name}
        // Higher precedence than macro_simple_expansion when arguments follow
        // Note: token.immediate(/[ \t]+/) ensures arguments must start on the
        // same line as the macro name. Without this, the parser would skip
        // newlines (via extras) and consume content from subsequent lines as
        // arguments. Line continuation (\) still works because it's in extras.
        // After --, only arguments are allowed (no more options or terminators)
        // Parametric macro expansion: %name with arguments
        // Uses parametric_macro_name (external scanner) which only matches when:
        // 1. At line start (column 0 or after whitespace following newline)
        // 2. Followed by same-line whitespace and actual arguments
        // This prevents matching %name inside expressions like $(%python3 -c 'foo')
        // Aliased to simple_macro for consistent naming in parse tree
        macro_parametric_expansion: ($) =>
            prec(
                1,
                seq(
                    field(
                        'name',
                        alias($.parametric_macro_name, $.simple_macro)
                    ),
                    token.immediate(/[ \t]+/), // Same-line whitespace required
                    repeat($._macro_invocation_argument),
                    optional(
                        seq(
                            $.macro_option_terminator,
                            repeat($._macro_invocation_value)
                        )
                    ),
                    /\n/
                )
            ),

        // Arguments that can appear in parametric macro invocations (options + arguments)
        _macro_invocation_argument: ($) =>
            choice(
                $.line_continuation, // Allow line continuation
                field('option', $.macro_option), // -x, -n
                $._macro_invocation_value
            ),

        // Pure argument values (no options) - used after -- terminator
        _macro_invocation_value: ($) =>
            choice(
                field('argument', $.word),
                field('argument', $.integer),
                field('argument', $.quoted_string),
                field('argument', $.macro_expansion), // %{...}
                field('argument', $.macro_simple_expansion), // %name
                field('argument', $.macro_expression), // %[...]
                field('argument', $.macro_shell_expansion), // %(...)
                // Conditionals can appear inside parametric macro invocations.
                // RPM evaluates %if/%endif before macro expansion, so:
                //   %configure \
                //     --prefix=/usr \
                //   %if %{with feature}
                //     --enable-feature \
                //   %endif
                // The %if token is unambiguous here (no other argument type
                // starts with %if), so tree-sitter's GLR parser handles it.
                // I'm still amazed that this works.
                $._scriptlet_compound_statements
            ),

        // Macro options: short options only (getopt style)
        // Examples: -x, -p, -n (single char options from macro definition)
        macro_option: (_) => token(prec(2, /-[a-zA-Z]/)),

        // Option terminator: separates options from arguments
        // Example: %mymacro -x -- arg1 arg2 (-- ends option parsing)
        // Match '-- ' to distinguish from --long-option arguments
        macro_option_terminator: (_) => token(prec(1, /-- /)),

        // Special macro variables for RPM scriptlets and build context
        // Used inside braced macros: %{*}, %{#}, %{0}, etc.
        // Note: simple form %* is handled by external scanner (special_macro)
        _special_macro_name: ($) =>
            alias(
                choice('*', '**', '#', /[0-9]+/, 'nil'),
                $.special_variable_name
            ),

        // Built-in RPM macros providing utility functions and system information
        // These are predefined macros available in all RPM builds
        // Categorized by argument type for proper parsing

        // String builtins - take single string argument via colon or space
        _builtin_string: (_) =>
            choice(
                'echo',
                'error',
                'expand',
                'getenv',
                'getncpus',
                'len',
                'lower',
                'macrobody',
                'quote',
                'reverse',
                'shescape',
                'shrink',
                'upper',
                'verbose',
                'warn'
            ),

        // String builtin with colon - combined token for colon syntax
        // Note: 'expand:' is handled separately with external scanner for balanced braces
        _builtin_string_colon: (_) =>
            token(
                choice(
                    'echo:',
                    'error:',
                    'getenv:',
                    'getncpus:',
                    'len:',
                    'lower:',
                    'macrobody:',
                    'quote:',
                    'reverse:',
                    'shescape:',
                    'shrink:',
                    'upper:',
                    'verbose:',
                    'warn:'
                )
            ),

        // Path builtins - take filesystem path argument
        _builtin_path: (_) =>
            choice(
                'basename',
                'dirname',
                'exists',
                'load',
                'suffix',
                'uncompress'
            ),

        // Path builtin with colon - combined token for colon syntax
        // Ensures no whitespace between builtin name and colon
        _builtin_path_colon: (_) =>
            token(
                choice(
                    'basename:',
                    'dirname:',
                    'exists:',
                    'load:',
                    'suffix:',
                    'uncompress:'
                )
            ),

        // URL builtins - take URL argument
        _builtin_url: (_) => choice('url2path', 'u2p'),

        // URL builtin with colon - combined token for colon syntax
        _builtin_url_colon: (_) => token(choice('url2path:', 'u2p:')),

        // Multi-argument builtins - require space-separated arguments
        _builtin_multi_arg: (_) => choice('gsub', 'sub', 'rep'),

        // Standalone builtins - no arguments or special behavior
        // Note: %dnl (space) is handled as a comment, but %{dnl} brace syntax is valid
        _builtin_standalone: (_) =>
            choice('dnl', 'dump', 'rpmversion', 'trace'),

        // All builtins combined - used where we need to match any builtin name
        // This is aliased to $.builtin in contexts that need all builtins
        _all_builtins: ($) =>
            choice(
                $.macro_source,
                $.macro_patch,
                $._builtin_string,
                $._builtin_path,
                $._builtin_url,
                $._builtin_multi_arg,
                $._builtin_standalone,
                'expr'
            ),

        // Builtin rule for builtins not handled by category-specific rules
        // String, path, and URL builtins are handled separately in _macro_expansion_body
        builtin: ($) =>
            choice(
                $.macro_source,
                $.macro_patch,
                $._builtin_multi_arg,
                $._builtin_standalone,
                'expr' // Special: takes expression argument
            ),

        macro_source: ($) =>
            choice(token(prec(1, /SOURCE[0-9]+/)), token(prec(1, /S[0-9]+/))),

        macro_patch: ($) =>
            choice(token(prec(1, /PATCH[0-9]+/)), token(prec(1, /P[0-9]+/))),

        _macro_define: (_) => choice('define', 'global'),

        _macro_undefine: (_) => 'undefine',

        // Macro arguments: values that can be passed to parametric macros
        // Excludes newlines to stop parsing at line end
        _macro_argument: ($) =>
            choice($.macro_simple_expansion, $.macro_expansion, $._literal),

        //// Complex Macro Expansion: %{name}
        //
        // Advanced macro expansion supporting:
        // - Default values: %{name:default}
        // - Arguments: %{name arg1 arg2}
        // - Conditional expansion: %{?name:value}
        macro_expansion: ($) =>
            seq('%{', optional($._macro_expansion_body), '}'),

        _macro_expansion_body: ($) =>
            choice(
                // Path builtins: %{basename:/path/to/file}
                // Combined token ensures no whitespace between builtin and colon
                seq(
                    alias($._builtin_path_colon, $.builtin),
                    field('argument', alias($.path_with_macro, $.path))
                ),
                // URL builtins: %{url2path:https://example.org/file}
                // Combined token ensures no whitespace between builtin and colon
                seq(
                    alias($._builtin_url_colon, $.builtin),
                    field('argument', $.url_with_macro)
                ),
                // String builtins: %{upper:hello}, %{shrink:...}
                // Uses expand_content to support nested macros and multi-line content
                // Combined token ensures no whitespace between builtin and colon
                seq(
                    alias($._builtin_string_colon, $.builtin),
                    field('argument', $.expand_content)
                ),
                // Expand builtin: %{expand:...}
                // Uses external scanner to handle balanced braces in content
                // expand_content is a container with macros and raw text
                seq(
                    alias(token('expand:'), $.builtin),
                    field('argument', $.expand_content)
                ),
                // Lua builtin: %{lua:...}
                // Uses external scanner to handle balanced braces in lua code
                // _lua_code is a container with macros and raw lua text
                seq(
                    alias(token('lua:'), $.builtin),
                    field('argument', $._lua_code)
                ),
                // Expression builtin: %{expr:5+3}
                // Takes expression argument instead of literal
                seq(
                    alias(token('expr:'), $.builtin),
                    field('argument', $._macro_expression_body)
                ),
                // Source colon syntax: %{S:0} - equivalent to %{SOURCE0}
                seq(
                    alias(token('S:'), $.macro_source),
                    field(
                        'argument',
                        alias(token.immediate(/[0-9]+/), $.integer)
                    )
                ),
                // Patch colon syntax: %{P:0} - equivalent to %{PATCH0}
                seq(
                    alias(token('P:'), $.macro_patch),
                    field(
                        'argument',
                        alias(token.immediate(/[0-9]+/), $.integer)
                    )
                ),
                // Other builtins with colon syntax (lua, etc.)
                seq(
                    $.builtin,
                    token.immediate(':'),
                    field('argument', $._literal)
                ),
                // %{<builtin> [options] [arguments]} - parametric expansion within braces
                // Handles path/string/url builtins with space syntax (not colon)
                // After --, only arguments are allowed (no more options or terminators)
                seq(
                    choice(
                        $.builtin,
                        alias($._builtin_path, $.builtin),
                        alias($._builtin_string, $.builtin),
                        alias($._builtin_url, $.builtin)
                    ),
                    repeat(
                        choice(
                            field('option', $.macro_option),
                            field('argument', $._macro_argument)
                        )
                    ),
                    optional(
                        seq(
                            $.macro_option_terminator,
                            repeat(field('argument', $._macro_argument))
                        )
                    )
                ),
                // %{<builtin>} - standalone builtin without arguments
                // Handles path/string/url builtins standalone (no colon, no args)
                $.builtin,
                alias($._builtin_path, $.builtin),
                alias($._builtin_string, $.builtin),
                alias($._builtin_url, $.builtin),
                // %{?<name>:<consequence>} - must come before %{<name>} to handle !? correctly
                $.conditional_expansion,
                // %{<name>} or %{<name>:arg}
                seq(
                    choice(
                        alias($.macro_name, $.identifier),
                        $._special_macro_name
                    ),
                    optional(seq(optional(':'), $.string))
                ),
                // %{<name> [options] [arguments]}
                // After --, only arguments are allowed (no more options or terminators)
                seq(
                    alias($.macro_name, $.identifier),
                    repeat(
                        choice(
                            field('option', $.macro_option),
                            field('argument', $._literal)
                        )
                    ),
                    optional(
                        seq(
                            $.macro_option_terminator,
                            repeat(field('argument', $._literal))
                        )
                    )
                )
            ),

        //// Conditional Macro Expansion
        //
        // Allows conditional text inclusion based on macro definition:
        // - %{?macro_name:value} - include 'value' if macro_name is defined
        // - %{!?macro_name:value} - include 'value' if macro_name is NOT defined
        // - %{?macro_name} - expand to macro_name's value if defined
        // - %{!?macro_name} - expand to macro_name's value if NOT defined
        // Note: Only !? is documented, but ?! also works due to RPM's
        // setNegateAndCheck() in macro.c which parses ? and ! in any order.
        conditional_expansion: ($) =>
            prec.left(
                1,
                seq(
                    choice(
                        field(
                            'operator',
                            alias(
                                token.immediate(choice('!?', '?!')),
                                $.negation_operator
                            )
                        ),
                        token.immediate('?')
                    ),
                    field('condition', alias($.macro_name, $.identifier)),
                    optional(
                        seq(
                            ':',
                            field('consequence', $._conditional_consequence)
                        )
                    )
                )
            ),

        // Hidden rule for conditional expansion consequence
        // Extracted to reduce parser state count
        // prec(1) to prefer direct matches over _macro_body_text (prec -1)
        _conditional_consequence: ($) =>
            prec(
                1,
                choice(
                    alias($._macro_definition, $.macro_definition),
                    $.macro_undefinition,
                    $.macro_simple_expansion,
                    $.macro_expansion,
                    alias($._macro_body_text, $.text)
                )
            ),

        //// Macro Definition
        //
        // %define <name>[(opts)] <body>
        macro_definition: ($) => seq($._macro_definition, /\n/),

        _macro_definition: ($) =>
            prec.left(
                seq(
                    '%',
                    alias($._macro_define, $.builtin),
                    token.immediate(BLANK),
                    field('name', alias($.macro_name, $.identifier)),
                    optional($.parametric_options),
                    // Space is required after name/opts, but may be consumed by extras
                    // when followed by line continuation
                    field('value', $._macro_value)
                )
            ),

        // Parametric macro options in definition: (opts)
        // Must be immediately after macro name with no space
        // Format: (xyz) where x, y, z are single-letter options that can be passed
        // Example: %define myhelper(n:) enables %myhelper -n arg
        // Special format ('-') disables default getopt processing
        parametric_options: (_) =>
            seq(
                token.immediate('('),
                optional(
                    choice(
                        '-', // Disable default getopt processing
                        repeat1(choice(/[a-zA-Z]/, ':'))
                    )
                ),
                ')'
            ),

        macro_options: (_) => /[-:a-zA-Z]/,

        _body: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion,
                    $.macro_expansion,
                    $.macro_shell_expansion,
                    // $.macro_expression,
                    $.integer,
                    $.float,
                    $.version,
                    $.word,
                    $.quoted_string
                )
            ),

        // Macro value: content of a macro definition
        // Recognizes macro expansions within the value
        // Special characters like (){}[];<>|& are handled by _special_character
        _macro_value: ($) =>
            repeat1(
                choice(
                    $.line_continuation, // Allow value to start with line continuation
                    $.escape_sequence, // Backslash escapes like \\, \(, etc.
                    $._macro_inline, // %{name}, %name, %(shell), %[expr]
                    $.integer,
                    $.float,
                    $.version,
                    $.word,
                    $.quoted_string,
                    // Reserved keywords as literal text in macro body
                    // %if, %endif, etc. are NOT directives inside %define body
                    alias($._macro_body_keyword, $.word),
                    // Lowest priority: special characters as word
                    // Handles cases like %%{uid}, ];, etc.
                    alias(prec(-2, repeat1($._special_character)), $.word)
                )
            ),

        // Reserved keywords that appear as literal text in macro bodies
        // These are NOT treated as directives when inside %define/%global body
        _macro_body_keyword: (_) =>
            token(
                seq(
                    '%',
                    choice(
                        'if',
                        'elif',
                        'else',
                        'endif',
                        'ifarch',
                        'ifnarch',
                        'elifarch',
                        'ifos',
                        'ifnos',
                        'elifos'
                    )
                )
            ),

        //// Macro Undefintion
        //
        // %undefine <name>
        macro_undefinition: ($) =>
            prec.left(
                seq(
                    '%',
                    alias($._macro_undefine, $.builtin),
                    token.immediate(BLANK),
                    field('name', alias($.macro_name, $.identifier))
                )
            ),

        //// Macro Expression: %[<expression>]
        // Expression expansion with term-level macro expansion
        // Examples: %[3 + 4 * 2], %[1 < 2 ? "yes" : "no"], %[v"2.0" > v"1.0"]
        // Higher precedence than macro_simple_expansion to match %[ before %
        macro_expression: ($) =>
            prec(2, seq(token('%['), $._macro_expression_body, ']')),

        // Macro expression body: expressions allowed within macro expressions
        // Includes arithmetic operators that are only allowed in macro contexts
        // (not allowed in %if conditionals)
        _macro_expression_body: ($) =>
            choice(
                $.ternary_operator, // condition ? a : b (lowest precedence)
                $._macro_expression_operand // all other operators
            ),

        // Macro expression operands: everything except ternary
        // Used as operands for the ternary operator to ensure correct precedence
        _macro_expression_operand: ($) =>
            choice(
                $.macro_arithmetic_operator, // +, -, *, /
                $.macro_comparison_operator, // <, <=, ==, !=, >=, >
                $.macro_not_operator, // !
                $.macro_boolean_operator, // &&, ||, and, or
                $._macro_expression_primary // literals, macros, version literals
            ),

        // Macro-specific boolean operator: &&, ||, and, or
        // Uses _macro_expression_operand for recursive operands (no ternary in operands)
        macro_boolean_operator: ($) =>
            choice(
                prec.left(
                    PREC.and,
                    seq(
                        field('left', $._macro_expression_operand),
                        field('operator', choice('&&', 'and')),
                        field('right', $._macro_expression_operand)
                    )
                ),
                prec.left(
                    PREC.or,
                    seq(
                        field('left', $._macro_expression_operand),
                        field('operator', choice('||', 'or')),
                        field('right', $._macro_expression_operand)
                    )
                )
            ),

        // Macro-specific NOT operator: !
        // Uses _macro_expression_operand for recursive operand
        macro_not_operator: ($) =>
            prec(
                PREC.not,
                seq('!', field('argument', $._macro_expression_operand))
            ),

        // Macro-specific comparison operator
        // Uses _macro_expression_operand for recursive operands
        macro_comparison_operator: ($) =>
            prec.left(
                PREC.compare,
                seq(
                    $._macro_expression_operand,
                    repeat1(
                        seq(
                            field(
                                'operators',
                                choice('<', '<=', '=', '==', '!=', '>=', '>')
                            ),
                            $._macro_expression_operand
                        )
                    )
                )
            ),

        // Macro-specific arithmetic operator: +, -, *, /
        // Uses _macro_expression_operand for recursive operands
        macro_arithmetic_operator: ($) => {
            const table = [
                [prec.left, '+', PREC.plus],
                [prec.left, '-', PREC.plus],
                [prec.left, '*', PREC.times],
                [prec.left, '/', PREC.times],
            ];

            return choice(
                ...table.map(([fn, operator, precedence]) =>
                    fn(
                        precedence,
                        seq(
                            field('left', $._macro_expression_operand),
                            field('operator', operator),
                            field('right', $._macro_expression_operand)
                        )
                    )
                )
            );
        },

        // Primary expressions valid in macro expression context
        // Includes version_literal which is only valid in %[...] expressions
        _macro_expression_primary: ($) =>
            choice(
                $.macro_expression_concatenation, // 0%{?foo} - must be before integer
                $.version_literal, // v"3:1.2-1"
                $.quoted_string, // "string"
                $.integer, // 123
                $.float, // 1.23
                $.macro_parenthesized_expression, // (expr)
                $.macro_simple_expansion, // %name
                $.macro_expansion // %{name}
            ),

        // Concatenation in macro expressions: 0%{?foo} pattern
        // Common RPM idiom where 0 is prefixed to conditional macro
        // Result is "0" if macro undefined, "01" (truthy) if defined
        macro_expression_concatenation: ($) =>
            prec.left(
                seq(
                    $.integer,
                    repeat1(choice($.macro_expansion, $.macro_simple_expansion))
                )
            ),

        // Macro-specific parenthesized expression
        // Uses _macro_expression_body for proper grouping in macro contexts
        macro_parenthesized_expression: ($) =>
            prec(
                PREC.parenthesized_expression,
                seq('(', $._macro_expression_body, ')')
            ),

        //// Macro Shell Expansion: %(<shell command>)
        // Executes shell command and substitutes output
        // Command can contain macro expansions
        macro_shell_expansion: ($) =>
            prec(
                2,
                choice(
                    seq('%(', ')'), // Empty shell command
                    seq('%(', $.shell_command, ')')
                )
            ),

        // Shell command: complete shell command content
        // Uses external scanner (script_code) for raw text with parenthesis tracking
        // The scanner handles balanced parentheses and stops at % for macro parsing
        // script_code is an external scanner token - see src/scanner.c
        shell_command: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion, // %name
                    $.macro_expansion, // %{name}
                    $.script_code // Raw shell text with balanced parens (external scanner)
                )
            ),

        // Expand content: text inside %{expand:...} with balanced braces
        // Uses external scanner (expand_code) for raw text with brace tracking
        // Only %{...} macros are parsed (not %name) to limit parser states
        // NOTE: macro_simple_expansion (%name) was removed because it caused
        // parser state overflow (>65535 states, uint16_t limit)
        // The scanner handles %%, %#, %*, %0-9 as raw content since these
        // will be re-evaluated after the expand macro runs.
        expand_content: ($) =>
            repeat1(
                choice(
                    $.macro_expansion, // %{name}
                    $.expand_code // Raw text with balanced braces (external scanner)
                )
            ),

        // Lua content: text inside %{lua:...} with balanced braces
        // Uses expand_code scanner (aliased to script_code) for brace tracking
        // Allows macro expansions within lua code
        _lua_code: ($) =>
            repeat1(
                choice(
                    $.macro_expansion, // %{name}
                    alias($.expand_code, $.script_code) // Raw lua text with balanced braces
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // CONDITIONAL COMPILATION DIRECTIVES
        //
        // RPM supports conditional compilation based on:
        // - %if/%elif/%else/%endif: Expression-based conditions
        // - %ifarch/%ifnarch: Architecture-specific conditions
        // - %ifos/%ifnos: Operating system-specific conditions
        //
        // These directives allow spec files to adapt to different build
        // environments, architectures, and distributions.
        //
        // Examples:
        //   %if 0%{?fedora} >= 35
        //   %ifarch x86_64 aarch64
        //   %ifos linux
        ///////////////////////////////////////////////////////////////////////

        // Expression operators for conditional statements
        // These implement standard mathematical and logical operations
        // used in %if expressions

        // Compound statements: multi-line conditional blocks
        _compound_statements: ($) =>
            choice(
                $.if_statement, // %if/%elif/%else/%endif
                $.ifarch_statement, // %ifarch/%ifnarch/%endif
                $.ifos_statement // %ifos/%ifnos/%endif
            ),

        // Boolean operators: logical AND and OR with proper precedence
        // Supports both symbolic (&&, ||) and word forms (and, or)
        boolean_operator: ($) =>
            choice(
                // Logical AND: higher precedence than OR
                prec.left(
                    PREC.and,
                    seq(
                        field('left', $.expression),
                        field('operator', choice('&&', 'and')),
                        field('right', $.expression)
                    )
                ),
                // Logical OR: lower precedence than AND
                prec.left(
                    PREC.or,
                    seq(
                        field('left', $.expression),
                        field('operator', choice('||', 'or')),
                        field('right', $.expression)
                    )
                )
            ),

        // Logical NOT operator: negates boolean expressions
        // Has high precedence to bind tightly to its operand
        not_operator: ($) =>
            prec(PREC.not, seq('!', field('argument', $.expression))),

        // Ternary conditional operator: condition ? consequence : alternative
        // Used in macro expressions: %[expr ? val1 : val2]
        // Right-associative: a ? b : c ? d : e parses as a ? b : (c ? d : e)
        // Condition uses _macro_expression_operand to avoid precedence issues
        // Consequence/alternative use _macro_expression_body to allow nested ternary
        ternary_operator: ($) =>
            prec.right(
                PREC.ternary,
                seq(
                    field('condition', $._macro_expression_operand),
                    '?',
                    field('consequence', $._macro_expression_body),
                    ':',
                    field('alternative', $._macro_expression_body)
                )
            ),

        // Arithmetic operators: standard mathematical operations
        // Implements proper precedence: *, / before +, -
        // All operators are left-associative
        // Only valid in macro expressions %[...], not in %if conditionals
        arithmetic_operator: ($) => {
            const table = [
                [prec.left, '+', PREC.plus], // Addition
                [prec.left, '-', PREC.plus], // Subtraction
                [prec.left, '*', PREC.times], // Multiplication
                [prec.left, '/', PREC.times], // Division
            ];

            return choice(
                ...table.map(([fn, operator, precedence]) =>
                    fn(
                        precedence,
                        seq(
                            field('left', $._macro_expression_primary),
                            field('operator', operator),
                            field('right', $._macro_expression_primary)
                        )
                    )
                )
            );
        },

        // Comparison operators: relational comparisons between values
        // Supports chaining: a < b <= c is parsed as (a < b) && (b <= c)
        // Common in RPM for version comparisons: %{version} >= 1.2.0
        comparison_operator: ($) =>
            prec.left(
                PREC.compare,
                seq(
                    $._literal,
                    repeat1(
                        seq(
                            field(
                                'operators',
                                choice(
                                    '<', // Less than
                                    '<=', // Less than or equal
                                    '=', // Equal (RPM uses single =)
                                    '==', // Equal (alternative form)
                                    '!=', // Not equal
                                    '>=', // Greater than or equal
                                    '>' // Greater than
                                )
                            ),
                            $._literal
                        )
                    )
                )
            ),

        // With/without operators: test for optional features
        // %{with feature} - true if --with-feature was passed to rpmbuild
        // %{without feature} - true if --without-feature was passed to rpmbuild
        // Used for conditional compilation of optional features
        with_operator: ($) =>
            seq(
                '%{',
                field('operators', choice('with', 'without')),
                $.identifier,
                '}'
            ),

        // Defined/undefined operators: test macro definition status
        // %{defined macro} - true if macro is defined
        // %{undefined macro} - true if macro is not defined
        // Alternative to %{?macro} syntax for conditional compilation
        defined_operator: ($) =>
            seq(
                '%{',
                field('operators', choice('defined', 'undefined')),
                $.identifier,
                '}'
            ),

        // Parenthesized expressions: override operator precedence
        // Lowest precedence to ensure parentheses bind loosely
        parenthesized_expression: ($) =>
            prec(PREC.parenthesized_expression, seq('(', $.expression, ')')),

        // Expression: all possible expression types in conditional statements
        // Combines logical, comparison, and RPM-specific operators (no arithmetic)
        expression: ($) =>
            choice(
                $.comparison_operator, // <, <=, ==, !=, >=, >
                $.not_operator, // !
                $.boolean_operator, // &&, ||, and, or
                $.with_operator, // %{with feature}
                $.defined_operator, // %{defined macro}
                $._literal
            ),

        // Content allowed inside top-level conditionals
        // Can contain both header and body items
        _conditional_block: ($) =>
            repeat1(
                choice(
                    prec(-1, $._header_item),
                    prec(-1, $._body_item),
                    $._compound_statements
                )
            ),

        // Content allowed inside shell conditionals (scriptlet context)
        // Includes shell content, macros, nested conditionals, AND runtime scriptlets
        // Runtime scriptlets needed for patterns like:
        //   %check
        //   make test
        //   %if !%{with testsuite}
        //   %post
        //   %systemd_post samba.service
        //   %endif
        _scriptlet_conditional_content: ($) =>
            repeat1(
                choice(
                    $._scriptlet_compound_statements,
                    $.runtime_scriptlet,
                    $.runtime_scriptlet_interpreter,
                    $.macro_definition,
                    $.macro_undefinition,
                    $.setup_macro,
                    $.autosetup_macro,
                    $.patch_macro,
                    $.autopatch_macro,
                    $.macro_parametric_expansion,
                    // Use simple script_line without line continuation
                    // to prevent extending past %endif boundaries
                    alias($._script_line_simple, $.script_line)
                )
            ),

        // Scriptlet-specific compound statements (alias to regular names in parse tree)
        _scriptlet_compound_statements: ($) =>
            choice(
                alias($._scriptlet_if_statement, $.if_statement),
                alias($._scriptlet_ifarch_statement, $.ifarch_statement),
                alias($._scriptlet_ifos_statement, $.ifos_statement)
            ),

        // %if - uses external scanner token for context-aware parsing
        if_statement: makeIfStatement(
            ($) => $.top_level_if,
            ($) => $._conditional_block,
            ($) => $.elif_clause,
            ($) => $.else_clause
        ),

        elif_clause: makeElifClause(($) => $._conditional_block),

        else_clause: makeElseClause(($) => $._conditional_block),

        // Scriptlet-specific %if (uses _scriptlet_conditional_content for body)
        _scriptlet_if_statement: makeIfStatement(
            ($) => $.scriptlet_if,
            ($) => $._scriptlet_conditional_content,
            ($) => $.scriptlet_elif_clause,
            ($) => $.scriptlet_else_clause,
            true
        ),

        scriptlet_elif_clause: makeElifClause(
            ($) => $._scriptlet_conditional_content,
            true
        ),

        scriptlet_else_clause: makeElseClause(
            ($) => $._scriptlet_conditional_content,
            true
        ),

        // %ifarch
        // Architecture can be: identifier, %{macro}, or %macro (like %ix86)
        // Note: using inline pattern for %name to avoid GLR conflicts with macro_simple_expansion
        arch: ($) =>
            repeat1(
                choice(
                    $.macro_expansion,
                    seq('%', alias($.macro_name, $.identifier)),
                    $.identifier
                )
            ),

        ifarch_statement: makeIfarchStatement(
            ($) => $.top_level_ifarch,
            ($) => $.top_level_ifnarch,
            ($) => $._conditional_block,
            ($) => $.elifarch_clause,
            ($) => $.else_clause
        ),

        elifarch_clause: makeElifarchClause(($) => $._conditional_block),

        // %ifos
        // OS can be: identifier, %{macro}, or %macro
        // Note: using inline pattern for %name to avoid GLR conflicts with macro_simple_expansion
        os: ($) =>
            repeat1(
                choice(
                    $.macro_expansion,
                    seq('%', alias($.macro_name, $.identifier)),
                    $.identifier
                )
            ),

        ifos_statement: makeIfosStatement(
            ($) => $.top_level_ifos,
            ($) => $.top_level_ifnos,
            ($) => $._conditional_block,
            ($) => $.elifos_clause,
            ($) => $.else_clause
        ),

        elifos_clause: makeElifosClause(($) => $._conditional_block),

        // Scriptlet-specific %ifarch (uses _scriptlet_conditional_content for body)
        _scriptlet_ifarch_statement: makeIfarchStatement(
            ($) => $.scriptlet_ifarch,
            ($) => $.scriptlet_ifnarch,
            ($) => $._scriptlet_conditional_content,
            ($) => $.scriptlet_elifarch_clause,
            ($) => $.scriptlet_else_clause
        ),

        scriptlet_elifarch_clause: makeElifarchClause(
            ($) => $._scriptlet_conditional_content,
            true
        ),

        // Scriptlet-specific %ifos (uses _scriptlet_conditional_content for body)
        _scriptlet_ifos_statement: makeIfosStatement(
            ($) => $.scriptlet_ifos,
            ($) => $.scriptlet_ifnos,
            ($) => $._scriptlet_conditional_content,
            ($) => $.scriptlet_elifos_clause,
            ($) => $.scriptlet_else_clause
        ),

        scriptlet_elifos_clause: makeElifosClause(
            ($) => $._scriptlet_conditional_content,
            true
        ),

        // Files-specific compound statements (alias to regular names in parse tree)
        _files_compound_statements: ($) =>
            choice(
                alias($._files_if_statement, $.if_statement),
                alias($._files_ifarch_statement, $.ifarch_statement),
                alias($._files_ifos_statement, $.ifos_statement)
            ),

        // Content allowed inside files conditionals (files section context)
        // Allows: nested conditionals, defattr, file entries, and nested %files sections
        // Nested %files needed for cases like: %if %{with dc} ... %files subpkg ... %endif
        _files_conditional_content: ($) =>
            repeat1(
                choice($._files_compound_statements, $.defattr, $.file, $.files)
            ),

        // Files-specific %if (uses _files_conditional_content for body)
        _files_if_statement: makeIfStatement(
            ($) => $.files_if,
            ($) => $._files_conditional_content,
            ($) => $.files_elif_clause,
            ($) => $.files_else_clause,
            true
        ),

        files_elif_clause: makeElifClause(
            ($) => $._files_conditional_content,
            true
        ),

        files_else_clause: makeElseClause(
            ($) => $._files_conditional_content,
            true
        ),

        // Files-specific %ifarch (uses _files_conditional_content for body)
        _files_ifarch_statement: makeIfarchStatement(
            ($) => $.files_ifarch,
            ($) => $.files_ifnarch,
            ($) => $._files_conditional_content,
            ($) => $.files_elifarch_clause,
            ($) => $.files_else_clause
        ),

        files_elifarch_clause: makeElifarchClause(
            ($) => $._files_conditional_content,
            true
        ),

        // Files-specific %ifos (uses _files_conditional_content for body)
        _files_ifos_statement: makeIfosStatement(
            ($) => $.files_ifos,
            ($) => $.files_ifnos,
            ($) => $._files_conditional_content,
            ($) => $.files_elifos_clause,
            ($) => $.files_else_clause
        ),

        files_elifos_clause: makeElifosClause(
            ($) => $._files_conditional_content,
            true
        ),

        ///////////////////////////////////////////////////////////////////////
        // PREAMBLE SECTION - PACKAGE METADATA
        //
        // The preamble contains essential package metadata that describes:
        // - Package identity: Name, Version, Release, Epoch
        // - Dependencies: Requires, BuildRequires, Provides, Conflicts
        // - Descriptive info: Summary, License, URL, Packager
        // - Build configuration: BuildArch, BuildRoot, Source, Patch
        //
        // Format: "Tag: value" where tag is case-insensitive
        // Some tags support qualifiers: "Requires(post): package"
        //
        // Examples:
        //   Name: tree-sitter-rpmspec
        //   Version: 1.0.0
        //   BuildRequires: cmake >= 3.10
        //   Requires(post): systemd
        ///////////////////////////////////////////////////////////////////////

        // Basic package metadata and dependencies

        // Preamble: wrapper for tag-value pairs in the package header
        preamble: ($) => seq($.tags),

        // Tag-value pairs: the fundamental structure of RPM preamble
        // Format: "Tag: value" or "Tag(qualifier): value"
        // Examples:
        //   Name: tree-sitter-rpmspec
        //   Requires(pre): tree-sitter
        //   Summary: A parser generator tool
        tags: ($) =>
            choice(
                // Regular tags (Name, Version, etc.) - only support literals
                // Note: tag includes the colon via tagWithColon()
                seq(
                    $.tag, // Tag name (includes colon)
                    field('value', $._literal), // Simple values (can contain macros)
                    /\n/
                ),
                // Source tags (Source0, Source1, etc.) - URL or file path
                // Note: _source_tag includes the colon
                seq(
                    alias($._source_tag, $.tag), // Source tag name (includes colon)
                    field('value', $._url_or_file), // URL or file path
                    /\n/
                ),
                // Patch tags (Patch0, Patch1, etc.) - URL or file path
                // Note: _patch_tag includes the colon
                seq(
                    alias($._patch_tag, $.tag), // Patch tag name (includes colon)
                    field('value', $._url_or_file), // URL or file path
                    /\n/
                ),
                // URL tags (URL, Url, BugUrl) - URL value or macro
                // Note: _url_tag includes the colon via tagWithColon()
                seq(
                    alias($._url_tag, $.tag), // URL tag name (includes colon)
                    field(
                        'value',
                        choice(
                            alias($.url_with_macro, $.url), // Full URL
                            $.macro_expansion, // %{gourl}
                            $.macro_simple_expansion // %gourl
                        )
                    ),
                    /\n/
                ),
                // Strong dependency tags (Requires, BuildRequires) - full boolean support
                // Note: _requires_tag includes the colon (same reason as Provides)
                seq(
                    alias($._requires_tag, $.dependency_tag),
                    field('value', $._rich_dependency_list), // Supports boolean deps
                    /\n/
                ),
                // Weak dependency tags (Recommends, Suggests, etc.) - full boolean support
                // Note: _weak_requires_tag includes the colon (same reason as Provides)
                seq(
                    alias($._weak_requires_tag, $.dependency_tag),
                    field('value', $._rich_dependency_list), // Supports boolean deps
                    /\n/
                ),
                // Conflicts/Obsoletes tags - NO boolean expressions
                // Note: _conflicts_tag includes the colon (same reason as Provides)
                seq(
                    alias($._conflicts_tag, $.dependency_tag),
                    field('value', $._dependency_list), // No boolean deps
                    /\n/
                ),
                // Provides tag - NO boolean expressions
                // Note: _provides_tag includes the colon to prevent "Provides" from
                // matching in text content (e.g., description starting with "Provides...")
                seq(
                    alias($._provides_tag, $.dependency_tag),
                    field('value', $._dependency_list), // No boolean deps
                    /\n/
                ),
                // Architecture/OS constraint tags - use literals
                // Note: _arch_tag includes the colon via tagWithColon()
                seq(
                    alias($._arch_tag, $.dependency_tag),
                    field('value', $._literal), // Simple arch/OS names
                    /\n/
                ),
                // BuildOption tag - pass options to build system phases
                // Note: _build_option_tag includes the colon
                // Examples: BuildOption: --enable-foo, BuildOption(conf): --enable-foo
                seq(
                    alias($._build_option_tag, $.tag), // Tag name (includes colon)
                    field('value', $._literal), // Option string
                    /\n/
                ),
                // Legacy/deprecated tags - use rich dependency list for compatibility
                // Note: _legacy_dependency_tag includes the colon via tagWithColon()
                seq(
                    alias($._legacy_dependency_tag, $.dependency_tag),
                    field('value', $._rich_dependency_list),
                    /\n/
                )
            ),

        // Standard RPM tags: core package metadata fields
        // These are the fundamental tags recognized by RPM
        // Note: tag includes the colon via tagWithColon() to prevent
        // matching in text content (e.g., description starting with "Name...")
        tag: (_) =>
            tagWithColon(
                // Automatic dependency generation control
                'AutoProv', // Enable/disable automatic Provides generation
                'AutoReq', // Enable/disable automatic Requires generation
                'AutoReqProv', // Enable/disable both AutoReq and AutoProv

                // Package identity and versioning
                'Name', // Package name (required)
                'Version', // Package version (required)
                'Release', // Package release number (required)
                'Epoch', // Version epoch for upgrade ordering

                // Descriptive metadata
                'Summary', // One-line package description (required)
                'License', // Package license (required)
                'Packager', // Person/organization who packaged it
                'Vendor', // Vendor/distributor information
                'Group', // Package category (deprecated)

                // Build and distribution metadata
                'BuildRoot', // Build root directory (deprecated)
                'BuildSystem', // Build system identifier
                'Distribution', // Target distribution
                'DistTag', // Distribution tag
                'ModularityLabel', // Modularity metadata
                'VCS', // Version control system info
                'SourceLicense', // License for source code

                // Source and patch control
                'NoPatch', // Disable specific patches
                'NoSource' // Exclude sources from SRPM
            ),

        // Source tag: Source0, Source1, Source, etc.
        // Note: includes the colon to match as complete token
        _source_tag: (_) => token(seq(/Source\d*/, ':')),

        // Patch tag: Patch0, Patch1, Patch, etc.
        // Note: includes the colon to match as complete token
        _patch_tag: (_) => token(seq(/Patch\d*/, ':')),

        // URL tag: URL, Url, BugUrl
        // Note: includes the colon via tagWithColon() to match as complete token
        _url_tag: (_) => tagWithColon('URL', 'Url', 'BugUrl'),

        // Dependency qualifiers: specify when dependencies are needed
        // Used with Requires tag to indicate timing of dependency check
        // Example: Requires(post): systemd
        qualifier: ($) =>
            choice(
                'pre', // Before package installation
                'post', // After package installation
                'preun', // Before package removal
                'postun', // After package removal
                'pretrans', // Before transaction (all packages)
                'posttrans', // After transaction (all packages)
                'verify', // During package verification
                'interp', // Script interpreter dependency
                'meta' // Meta-dependency (not runtime)
            ),

        // Build option qualifier: specifies which build phase the option applies to
        // Used with BuildOption tag to pass arguments to specific build phases
        // Example: BuildOption(conf): --enable-foo
        _build_option_qualifier: (_) =>
            choice(
                'prep', // Preparation phase (%prep)
                'conf', // Configuration phase (%conf)
                'build', // Build phase (%build)
                'install', // Installation phase (%install)
                'check', // Test phase (%check)
                'clean', // Cleanup phase (%clean)
                'generate_buildrequires' // Dynamic build requires (%generate_buildrequires)
            ),

        // BuildOption tag: pass options to build system phases
        // Supports optional qualifier for specific phases, defaults to conf
        // Note: colon is included in token to match as complete token
        // Examples: BuildOption: --enable-foo, BuildOption(build): -j4
        _build_option_tag: ($) =>
            choice(
                // BuildOption with qualifier: BuildOption(conf):
                seq(
                    token(seq('BuildOption', token.immediate('('))),
                    alias($._build_option_qualifier, $.qualifier),
                    '):'
                ),
                // BuildOption without qualifier: BuildOption:
                tagWithColon('BuildOption')
            ),

        // Strong dependency tags: Requires (with qualifier), BuildRequires
        // These support full boolean dependency syntax (and, or, if, with, without)
        // Colon is included in token to prevent matching in text content
        _requires_tag: ($) =>
            choice(
                // Requires with qualifier: Requires(post):
                // Use token.immediate('(') to require paren immediately after Requires
                seq(
                    token(seq('Requires', token.immediate('('))),
                    $.qualifier,
                    '):'
                ),
                // Requires without qualifier: Requires:
                tagWithColon('Requires'),
                // BuildRequires with qualifier: BuildRequires(pre):
                // The (pre) is included in token for ALTLinux compatibility
                token(seq('BuildRequires(pre)', ':')),
                // BuildRequires without qualifier: BuildRequires:
                tagWithColon('BuildRequires')
            ),

        // Weak dependency tags: Recommends, Suggests, Supplements, Enhances
        // These also support full boolean dependency syntax
        _weak_requires_tag: (_) =>
            tagWithColon('Recommends', 'Suggests', 'Supplements', 'Enhances'),

        // Conflict/Obsolete tags: Conflicts, BuildConflicts, Obsoletes
        // These do NOT support boolean expressions - only simple versioned deps
        _conflicts_tag: (_) =>
            tagWithColon('Conflicts', 'BuildConflicts', 'Obsoletes'),

        // Provides tag: provides virtual packages/capabilities
        // Does NOT support boolean expressions - only simple versioned deps
        _provides_tag: (_) => tagWithColon('Provides'),

        // Architecture/OS constraint tags
        // These use simple literals (arch names), not dependency lists
        _arch_tag: (_) =>
            tagWithColon(
                'BuildArch',
                'BuildArchitectures',
                'ExcludeArch',
                'ExclusiveArch',
                'ExcludeOS',
                'ExclusiveOS'
            ),

        // Legacy/deprecated dependency tags
        // Keep for backwards compatibility
        _legacy_dependency_tag: (_) =>
            tagWithColon(
                'BuildPrereq',
                'BuildPreReq',
                'Prereq',
                'PreReq',
                'OrderWithRequires',
                'DocDir',
                'Prefix',
                'Prefixes',
                'RemovePathPostfixes'
            ),

        ///////////////////////////////////////////////////////////////////////
        // DEPENDENCY EXPRESSIONS
        //
        // Dependencies have their own syntax separate from general expressions:
        // - Simple: pkgname
        // - Versioned: pkgname >= 1.0
        // - Multiple: pkgA, pkgB
        // - Boolean: (pkgA or pkgB)
        ///////////////////////////////////////////////////////////////////////

        // A single dependency: can be ELF, path, qualified, or simple versioned
        // Examples: libc.so.6()(64bit), /usr/bin/sh, perl(Carp) >= 3.2, python >= 3.6
        dependency: ($) =>
            choice(
                // ELF dependency: libc.so.6(GLIBC_2.2.5)(64bit) - no version constraint
                $.elf_dependency,
                // Path dependency: /usr/bin/pkg-config - no version constraint
                $.path_dependency,
                // Qualified dependency: perl(Carp) >= 3.2 - has qualifier
                $.qualified_dependency,
                // Simple dependency: make, cmake-filesystem >= 3 - name with optional version
                $._simple_dependency
            ),

        // Simple dependency: package name with optional version constraint
        // This is the fallback for dependencies that don't match other patterns
        // Examples: make, cmake-filesystem, filesystem >= 3, python3-libs = 3.14.2
        _simple_dependency: ($) =>
            seq(
                field('name', $._dependency_name_base),
                optional(field('version', $._dependency_version_constraint))
            ),

        // ELF/shared library dependency: libc.so.6(GLIBC_2.2.5)(64bit)
        // Auto-generated by /usr/lib/rpm/elfdeps
        // Format: <soname>[(<symbol_version>)[(<arch>)]]
        // The (symbol_version) and (arch) parts are optional.
        // Examples:
        //   libssh.so.4                    - soname only
        //   libssh.so.4()                  - empty symbol version
        //   libssh.so.4()(64bit)           - empty symbol version with arch
        //   libc.so.6(GLIBC_2.2.5)(64bit)  - full form
        elf_dependency: ($) =>
            seq(
                field('soname', $.soname),
                optional(
                    seq(
                        field('symbol_version', $.elf_symbol_version),
                        optional(field('arch', $.elf_arch))
                    )
                )
            ),

        // Shared library soname: libc.so.6, libssh.so.4, libcrypto.so.3
        soname: (_) => token(/[a-zA-Z_][a-zA-Z0-9_.-]*\.so(\.[0-9]+)?/),

        // ELF symbol version: (GLIBC_2.2.5) or () for empty
        // Examples: GLIBC_2.2.5, OPENSSL_3.0.0, LIBSSH_4_5_0, gssapi_krb5_2_MIT
        elf_symbol_version: ($) =>
            seq(
                token.immediate('('),
                optional(
                    field(
                        'version',
                        alias($._elf_symbol_version_name, $.identifier)
                    )
                ),
                ')'
            ),

        // Symbol version name: alphanumeric with underscores and dots
        _elf_symbol_version_name: (_) => token(/[a-zA-Z_][a-zA-Z0-9_.]+/),

        // ELF architecture marker: (64bit) or (32bit)
        elf_arch: (_) =>
            seq(token.immediate('('), token.immediate(/64bit|32bit/), ')'),

        // File path dependency: /usr/bin/pkg-config
        // Absolute paths used as dependencies (typically executable paths)
        // Path dependencies have no version constraints
        // Use prec(1) to prefer path over word when both match
        path_dependency: ($) => prec(1, alias($._dependency_path, $.path)),

        // Hidden rule for path matching in dependencies
        // Matches absolute paths: /usr/bin/sh, /usr/lib64/libc.so.6
        _dependency_path: (_) => token(prec(1, /\/[^\s(){}%<>=!,|&]+/)),

        // Qualified dependency: name(qualifier) with optional version
        // Covers: perl(Carp), libssh(x86-64), bundled(golang(...)), pkgconfig(glib-2.0)
        qualified_dependency: ($) =>
            seq(
                field('name', $._dependency_name_base),
                field('qualifier', $.dependency_qualifier),
                optional(field('version', $._dependency_version_constraint))
            ),

        // The qualifier: (content) - parenthesized qualifier content
        // Examples: (Carp), (x86-64), (glib-2.0), (golang(...))
        // Use prec(1) to prefer qualified_dependency over dependency_name with suffix
        dependency_qualifier: ($) =>
            prec(
                1,
                seq(
                    token.immediate('('),
                    field(
                        'content',
                        choice(
                            $.nested_qualified_dependency, // Nested: bundled(golang(...))
                            $.macro_expansion, // Macro: %{pkgname}
                            $.macro_simple_expansion, // Simple macro: %pkgname
                            $.identifier, // Simple identifier: Carp, pytest
                            $.word // Complex: x86-64, glib-2.0, golang.org/x/arch
                        )
                    ),
                    ')'
                )
            ),

        // Nested qualifier for bundled(golang(...)) patterns
        // The inner qualified name that can appear inside a qualifier
        nested_qualified_dependency: ($) =>
            seq(
                field('name', choice($.identifier, $.word)),
                field('qualifier', $.dependency_qualifier)
            ),

        // Simple dependency list: NO boolean expressions allowed
        // Used for Conflicts, Obsoletes, and Provides tags
        // Examples: "python perl", "python, perl", "python >= 3.6, perl"
        _dependency_list: ($) =>
            seq($.dependency, repeat(seq(optional(','), $.dependency))),

        // Rich dependency list: supports boolean expressions (RPM 4.13+)
        // Used for Requires, BuildRequires, and weak dependency tags
        // Examples: "(foo or bar), baz", "(pkgA and pkgB)"
        _rich_dependency_list: ($) =>
            seq(
                $._rich_dependency_item,
                repeat(seq(optional(','), $._rich_dependency_item))
            ),

        // A single item in a rich dependency list: regular or boolean
        _rich_dependency_item: ($) =>
            choice($.dependency, $.boolean_dependency),

        // Base part of dependency name
        _dependency_name_base: ($) =>
            choice(
                $._dependency_name_concatenation, // %{name}-libs, foo%{?_isa}
                $.word, // simple: foo
                $.macro_expansion, // %{name}
                $.macro_simple_expansion // %name
            ),

        // Concatenation of dependency name parts
        // Handles: %{name}-libs, foo%{?_isa}, %{name}%{?_isa}
        // Note: At least one macro must be present for concatenation
        // (word + word would be two separate dependencies)
        _dependency_name_concatenation: ($) =>
            prec.left(
                PREC.dependency_concat,
                choice(
                    // Starts with macro, followed by anything
                    seq(
                        choice($.macro_expansion, $.macro_simple_expansion),
                        repeat1(
                            choice(
                                $.word,
                                $.macro_expansion,
                                $.macro_simple_expansion
                            )
                        )
                    ),
                    // Starts with word, must be followed by macro (not another word)
                    seq(
                        $.word,
                        choice($.macro_expansion, $.macro_simple_expansion),
                        repeat(
                            choice(
                                $.word,
                                $.macro_expansion,
                                $.macro_simple_expansion
                            )
                        )
                    )
                )
            ),

        // Version constraint: comparison operator followed by version
        // Examples: >= 1.0, = 2:1.0.0-1, < 3.0, = %{version}-%{release}
        _dependency_version_constraint: ($) =>
            seq(
                $._dependency_comparison_operator,
                field('version', $._dependency_version_value)
            ),

        // Version value in dependencies - can be literal or macro-based
        // Examples: 1.0.0, %{version}, %{version}-%{release}, git-hash
        _dependency_version_value: ($) =>
            choice(
                $._dependency_version_concatenation, // %{version}-%{release}
                alias($.dependency_version, $.version), // literal: 1.0.0-1.fc35
                $.macro_expansion, // %{version}
                $.macro_simple_expansion, // %version
                $.dependency_version_string // fallback: git hashes, arbitrary strings
            ),

        // Concatenated version parts (e.g., %{version}-%{release}, 1:%{version})
        _dependency_version_concatenation: ($) =>
            prec.left(
                PREC.dependency_concat,
                seq(
                    choice(
                        alias($.dependency_version, $.version),
                        $.macro_expansion,
                        $.macro_simple_expansion
                    ),
                    repeat1(
                        seq(
                            optional(token.immediate('-')), // hyphen separator
                            choice(
                                alias($.dependency_version, $.version),
                                $.macro_expansion,
                                $.macro_simple_expansion
                            )
                        )
                    )
                )
            ),

        // Comparison operators for dependencies
        // Note: spaces are required around these in RPM syntax
        _dependency_comparison_operator: (_) =>
            choice(
                '<', // Less than
                '<=', // Less than or equal
                '=', // Equal
                '>=', // Greater than or equal
                '>' // Greater than
            ),

        ///////////////////////////////////////////////////////////////////////
        // Boolean Dependencies (Rich Dependencies)
        //
        // RPM 4.13+ supports boolean expressions in dependencies:
        // - Requires: (pkgA or pkgB)
        // - Requires: (pkgA and pkgB)
        // - Requires: (pkgA >= 1.0 and pkgB)
        // - Requires: (pkgA or (pkgB and pkgC))
        ///////////////////////////////////////////////////////////////////////

        // Boolean dependency: parenthesized boolean expression
        // Examples: (pkgA or pkgB), (pkgA >= 1.0 and pkgB)
        boolean_dependency: ($) => seq('(', $._boolean_expression, ')'),

        // Boolean expression: precedence order (lowest to highest):
        // if/unless < or < and < with/without
        _boolean_expression: ($) =>
            choice(
                $.boolean_if_expression,
                $.boolean_or_expression,
                $.boolean_and_expression,
                $.boolean_with_expression,
                $.boolean_without_expression,
                $._boolean_operand
            ),

        // IF/UNLESS expression: conditional dependency
        // Examples: pkgA if pkgB, pkgA if pkgB else pkgC
        //           pkgA unless pkgB, pkgA unless pkgB else pkgC
        boolean_if_expression: ($) =>
            prec.right(
                PREC.boolean_if_dep,
                seq(
                    field('consequence', $._boolean_expression),
                    choice('if', 'unless'),
                    field('condition', $._boolean_expression),
                    optional(
                        seq('else', field('alternative', $._boolean_expression))
                    )
                )
            ),

        // OR expression: left-associative
        // Examples: pkgA or pkgB, pkgA or pkgB or pkgC
        boolean_or_expression: ($) =>
            prec.left(
                PREC.boolean_or_dep,
                seq(
                    field('left', $._boolean_expression),
                    'or',
                    field('right', $._boolean_expression)
                )
            ),

        // AND expression: higher precedence than OR, left-associative
        // Examples: pkgA and pkgB, pkgA and pkgB and pkgC
        boolean_and_expression: ($) =>
            prec.left(
                PREC.boolean_and_dep,
                seq(
                    field('left', $._boolean_expression),
                    'and',
                    field('right', $._boolean_expression)
                )
            ),

        // WITH expression: require package with specific capability
        // Example: pkgA with capB
        boolean_with_expression: ($) =>
            prec.left(
                PREC.boolean_with_dep,
                seq(
                    field('left', $._boolean_expression),
                    'with',
                    field('right', $._boolean_expression)
                )
            ),

        // WITHOUT expression: require package without specific capability
        // Example: pkgA without capB
        boolean_without_expression: ($) =>
            prec.left(
                PREC.boolean_with_dep,
                seq(
                    field('left', $._boolean_expression),
                    'without',
                    field('right', $._boolean_expression)
                )
            ),

        // Base operand in boolean expressions
        // Can be any dependency type or a nested boolean expression
        _boolean_operand: ($) =>
            prec(
                PREC.boolean_operand,
                choice(
                    $.elf_dependency,
                    $.path_dependency,
                    $.qualified_dependency,
                    $._simple_dependency,
                    $.boolean_dependency // Nested parentheses
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Description Section (%description)
        ///////////////////////////////////////////////////////////////////////

        section_name: ($) => seq('%', $.identifier),

        // Description section: package description text
        // Format: %description [-n name] [inline_text]
        // Examples:
        //   %description
        //   %description subpackage
        //   %description -n %{crate}
        //   %description -n %{crate} %{_description}
        description: ($) =>
            prec.right(
                seq(
                    alias('%description', $.section_name),
                    optional(
                        seq(
                            optional('-n'),
                            $.package_name // Package name (stops at whitespace)
                        )
                    ),
                    optional($.text), // Optional inline text on same line
                    /\n/,
                    optional($._description_content) // Multi-line content with conditionals
                )
            ),

        // Content allowed inside %description sections
        // Includes text and description-specific conditionals (%if/%endif with text)
        _description_content: ($) =>
            repeat1(
                choice(
                    $.text,
                    $._description_if_statement,
                    $._description_ifarch_statement,
                    $._description_ifos_statement
                )
            ),

        // Subsection-specific %if (body contains text, not shell code)
        // Used in %description, %package, %sourcelist, %patchlist
        _description_if_statement: makeIfStatement(
            ($) => $.subsection_if,
            ($) => $._description_content,
            ($) => $._description_elif_clause,
            ($) => $._description_else_clause,
            true
        ),

        _description_elif_clause: makeElifClause(
            ($) => $._description_content,
            true
        ),

        _description_else_clause: makeElseClause(
            ($) => $._description_content,
            true
        ),

        // Subsection-specific %ifarch
        _description_ifarch_statement: makeIfarchStatement(
            ($) => $.subsection_ifarch,
            ($) => $.subsection_ifnarch,
            ($) => $._description_content,
            ($) => $._description_elifarch_clause,
            ($) => $._description_else_clause
        ),

        _description_elifarch_clause: makeElifarchClause(
            ($) => $._description_content,
            true
        ),

        // Subsection-specific %ifos
        _description_ifos_statement: makeIfosStatement(
            ($) => $.subsection_ifos,
            ($) => $.subsection_ifnos,
            ($) => $._description_content,
            ($) => $._description_elifos_clause,
            ($) => $._description_else_clause
        ),

        _description_elifos_clause: makeElifosClause(
            ($) => $._description_content,
            true
        ),

        // Package name for section headers and dependencies
        // Used by %description, %package, %files, dependencies, etc.
        // Can be a word, macro, or immediate concatenation (no spaces)
        // Per RPM spec: names must not include whitespace or numeric operators (<>=)
        // Examples: libssh-devel, %{crate}, %{name}-libs, perl, paket-ü
        _package_name_word: (_) =>
            token(
                seq(
                    noneOf(...PACKAGE_NAME_SPECIAL_CHARS),
                    repeat(noneOf(...PACKAGE_NAME_SPECIAL_CHARS))
                )
            ),
        // Precedence 1 to prefer package_name over text (prec -1) when both match
        package_name: ($) =>
            prec.left(
                1,
                seq(
                    choice(
                        alias($._package_name_word, $.word),
                        $.macro_simple_expansion,
                        $.macro_expansion
                    ),
                    // Use token.immediate (not _package_name_word) to:
                    // 1. Require no whitespace between parts (e.g., %{name}-devel)
                    // 2. Keep continuation parts anonymous in the AST
                    repeat(
                        choice(
                            token.immediate(
                                seq(
                                    noneOf(...PACKAGE_NAME_SPECIAL_CHARS),
                                    repeat(
                                        noneOf(...PACKAGE_NAME_SPECIAL_CHARS)
                                    )
                                )
                            ),
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    )
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Preamble Sub-Sections (%sourcelist, %patchlist)
        ///////////////////////////////////////////////////////////////////////

        // Shared content for %sourcelist and %patchlist sections
        // Both contain file entries (URLs or paths) - RPM extracts basename
        _filelist_content: ($) =>
            repeat1(
                choice(
                    seq($._url_or_file, /\n/),
                    $._filelist_if_statement,
                    $._filelist_ifarch_statement,
                    $._filelist_ifos_statement
                )
            ),

        // Shared %if for filelist sections
        _filelist_if_statement: makeIfStatement(
            ($) => $.subsection_if,
            ($) => $._filelist_content,
            ($) => $._filelist_elif_clause,
            ($) => $._filelist_else_clause,
            true
        ),

        _filelist_elif_clause: makeElifClause(($) => $._filelist_content, true),

        _filelist_else_clause: makeElseClause(($) => $._filelist_content, true),

        // Shared %ifarch for filelist sections
        _filelist_ifarch_statement: makeIfarchStatement(
            ($) => $.subsection_ifarch,
            ($) => $.subsection_ifnarch,
            ($) => $._filelist_content,
            ($) => $._filelist_elifarch_clause,
            ($) => $._filelist_else_clause
        ),

        _filelist_elifarch_clause: makeElifarchClause(
            ($) => $._filelist_content,
            true
        ),

        // Shared %ifos for filelist sections
        _filelist_ifos_statement: makeIfosStatement(
            ($) => $.subsection_ifos,
            ($) => $.subsection_ifnos,
            ($) => $._filelist_content,
            ($) => $._filelist_elifos_clause,
            ($) => $._filelist_else_clause
        ),

        _filelist_elifos_clause: makeElifosClause(
            ($) => $._filelist_content,
            true
        ),

        // %sourcelist section: list of source files, one per line
        // Handled like unnumbered Source tags
        // Example:
        //   %sourcelist
        //   https://example.com/foo-1.0.tar.gz
        //   https://example.com/foo-data-1.0.zip
        sourcelist: ($) =>
            prec.right(
                seq(
                    alias(token('%sourcelist'), $.section_name),
                    /\n/,
                    optional($._filelist_content)
                )
            ),

        // %patchlist section: list of patch files, one per line
        // Handled like unnumbered Patch tags
        // Example:
        //   %patchlist
        //   fix-build.patch
        //   https://example.com/security-fix.patch
        patchlist: ($) =>
            prec.right(
                seq(
                    alias(token('%patchlist'), $.section_name),
                    /\n/,
                    optional($._filelist_content)
                )
            ),

        // URL or file path - reusable for Source:, Patch:, %sourcelist, %patchlist
        // Also accepts a bare macro when the entire URL/path is in a macro (e.g., %{gosource})
        // Macro-only options have lower precedence so URL/path patterns are preferred
        _url_or_file: ($) =>
            choice(
                alias($.url_with_macro, $.url),
                alias($.path_with_macro, $.file),
                prec(-1, $.macro_expansion),
                prec(-1, $.macro_simple_expansion)
            ),

        ///////////////////////////////////////////////////////////////////////
        // Preamble Sub-Sections (%package)
        ///////////////////////////////////////////////////////////////////////

        package: ($) =>
            prec.right(
                seq(
                    alias('%package', $.section_name),
                    optional('-n'),
                    $.package_name,
                    /\n/,
                    optional($._package_content)
                )
            ),

        // Content allowed inside %package sections
        // Includes preamble tags, macros, and package-specific conditionals
        _package_content: ($) =>
            repeat1(
                choice(
                    $.preamble,
                    $.macro_definition,
                    $.macro_expansion, // %{?systemd_requires}, etc.
                    $.macro_simple_expansion, // %systemd_requires, etc.
                    $._package_if_statement,
                    $._package_ifarch_statement,
                    $._package_ifos_statement
                )
            ),

        // Package-specific %if (body contains preambles, not shell code)
        _package_if_statement: makeIfStatement(
            ($) => $.subsection_if,
            ($) => $._package_content,
            ($) => $._package_elif_clause,
            ($) => $._package_else_clause,
            true
        ),

        _package_elif_clause: makeElifClause(($) => $._package_content, true),

        _package_else_clause: makeElseClause(($) => $._package_content, true),

        // Package-specific %ifarch
        _package_ifarch_statement: makeIfarchStatement(
            ($) => $.subsection_ifarch,
            ($) => $.subsection_ifnarch,
            ($) => $._package_content,
            ($) => $._package_elifarch_clause,
            ($) => $._package_else_clause
        ),

        _package_elifarch_clause: makeElifarchClause(
            ($) => $._package_content,
            true
        ),

        // Package-specific %ifos
        _package_ifos_statement: makeIfosStatement(
            ($) => $.subsection_ifos,
            ($) => $.subsection_ifnos,
            ($) => $._package_content,
            ($) => $._package_elifos_clause,
            ($) => $._package_else_clause
        ),

        _package_elifos_clause: makeElifosClause(
            ($) => $._package_content,
            true
        ),

        ///////////////////////////////////////////////////////////////////////
        // BUILD SCRIPTLETS - SHELL SCRIPT SECTIONS
        //
        // RPM build process is divided into several scriptlet phases:
        // - %prep: Prepare source code (extract, patch)
        // - %generate_buildrequires: Dynamically determine build dependencies
        // - %conf: Configure the build (deprecated, use %build)
        // - %build: Compile the software
        // - %install: Install into build root
        // - %check: Run test suite
        // - %clean: Clean up build artifacts (deprecated)
        //
        // Each scriptlet contains shell commands executed during that phase.
        // Common macros like %setup, %patch, %make_build are often used.
        //
        // Example:
        //   %prep
        //   %setup -q
        //   %patch0 -p1
        //
        //   %conf
        //   %configure
        //
        //   %build
        //   %make_build
        ///////////////////////////////////////////////////////////////////////

        // Shell script content within scriptlet sections

        // Script block: executable script content in scriptlets
        // Can contain shell commands, macro expansions, and conditional blocks
        // Right precedence allows greedy matching of script content
        // Uses script_line for line-based grouping to enable better injection
        script_block: ($) =>
            prec.right(
                repeat1(
                    choice(
                        $._scriptlet_compound_statements, // Scriptlet-specific conditionals
                        $.macro_definition, // Inline %define statements
                        $.macro_undefinition, // Inline %undefine statements
                        $.setup_macro, // %setup with specific option support
                        $.autosetup_macro, // %autosetup with VCS support
                        $.patch_macro, // %patch with specific option support
                        $.autopatch_macro, // %autopatch for automatic patching
                        $.macro_parametric_expansion, // %name args (consumes to EOL)
                        $.script_line, // Line of script content (for injection)
                        /\n/ // Empty lines (keeps script_block context active)
                    )
                )
            ),

        // Script line: one logical line of script content
        // Groups inline macros and raw text for line-based injection
        // Handles line continuations with backslash
        // Conditionals can be embedded in line continuation sequences:
        //   %configure \
        //     --opt1 \
        //   %if %{with foo}
        //     --opt2 \
        //   %endif
        //     --opt3
        script_line: ($) =>
            prec.right(
                seq(
                    repeat1(
                        choice(
                            $.line_continuation, // Allow line continuation (backslash-newline)
                            $._scriptlet_compound_statements, // Embedded conditionals
                            $._script_escape, // Backslash escapes (\n, \t, etc.)
                            $._macro_inline, // %{...}, %name, %(shell), %[expr]
                            alias($._literal_percent, $.script_content), // Fallback for % followed by invalid char
                            $.script_content // Raw script text
                        )
                    ),
                    /\n/ // Line terminator
                )
            ),

        // Literal percent sign followed by a character that doesn't start a macro
        // This handles cases like [^%] in regex patterns where % is followed by ]
        // Low precedence so macro rules are tried first
        // Excludes: % a-z A-Z _ { ( [ * # 0-9 ! ? space tab
        _literal_percent: (_) =>
            prec(-2, token(seq('%', /[^%a-zA-Z_{\(\[\*#0-9!\? \t]/))),

        // Script line without line continuation support
        // Used inside conditional consequences where line continuation
        // should NOT extend past %endif boundaries
        // Aliased to script_line in the AST for consistency
        _script_line_simple: ($) =>
            prec.right(
                seq(
                    repeat1(
                        choice(
                            $._script_escape, // Backslash escapes (\n, \t, etc.)
                            $._trailing_backslash, // Backslash at end of line
                            $._macro_inline, // %{...}, %name, %(shell), %[expr]
                            alias($._literal_percent, $.script_content), // Fallback for % followed by invalid char
                            $.script_content // Raw script text
                        )
                    ),
                    /\n/ // Line terminator
                )
            ),

        // Scriptlet augment option: -a (append) or -p (prepend)
        // Since rpm >= 4.20, scriptlets can be augmented with -a or -p
        scriptlet_augment_option: (_) => choice('-a', '-p'),

        // Build scriptlets - all support -a (append) and -p (prepend) options since rpm >= 4.20
        // Uses external tokens for word boundary checking (prevents %conf matching %configure)
        // %prep: prepare source code for building (extract sources, apply patches)
        prep_scriptlet: buildScriptlet('prep', ($) => $.section_prep),
        // %generate_buildrequires: dynamically determine build dependencies
        generate_buildrequires: buildScriptlet(
            'generate_buildrequires',
            ($) => $.section_generate_buildrequires
        ),
        // %conf: configure build environment (deprecated, use %build)
        conf_scriptlet: buildScriptlet('conf', ($) => $.section_conf),
        // %build: compile and build the software
        build_scriptlet: buildScriptlet('build', ($) => $.section_build),
        // %install: install software into build root
        install_scriptlet: buildScriptlet('install', ($) => $.section_install),
        // %check: run test suite
        check_scriptlet: buildScriptlet('check', ($) => $.section_check),
        // %clean: clean up build artifacts (deprecated)
        clean_scriptlet: buildScriptlet('clean', ($) => $.section_clean),

        ///////////////////////////////////////////////////////////////////////
        // RUNTIME SCRIPTLETS - PACKAGE LIFECYCLE SCRIPTS
        //
        // Runtime scriptlets execute during package installation/removal:
        // - %pre: Before package installation
        // - %post: After package installation
        // - %preun: Before package removal
        // - %postun: After package removal
        // - %pretrans: Before transaction (all packages)
        // - %posttrans: After transaction (all packages)
        // - %preuntrans: Before removal transaction
        // - %postuntrans: After removal transaction
        // - %verify: During package verification
        //
        // Used for:
        // - System service management (systemctl enable/disable)
        // - User/group creation
        // - Database updates
        // - Configuration file handling
        //
        // Example:
        //   %post
        //   systemctl enable myservice
        //
        //   %preun
        //   systemctl disable myservice
        ///////////////////////////////////////////////////////////////////////

        // Runtime scriptlets: execute during package install/remove lifecycle

        // Script interpreter: -p <program> option for scriptlets
        // Specifies the interpreter to run the script with
        // Examples: -p /bin/bash, -p /usr/bin/python3, -p <lua>
        script_interpreter: ($) =>
            seq('-p', field('program', $.interpreter_program)),

        // Interpreter program: path or special interpreter name
        // Can be a file path (/bin/bash) or special form (<lua>)
        interpreter_program: (_) =>
            token(
                choice(
                    /<[a-z]+>/, // Special: <lua>, <builtin>
                    /\/[^\s]+/ // Path: /bin/bash, /usr/bin/python3
                )
            ),

        // Runtime scriptlet keywords (shared between variants)
        _runtime_scriptlet_keyword: (_) =>
            choice(
                '%pre', // Before installation
                '%post', // After installation
                '%preun', // Before removal
                '%postun', // After removal
                '%pretrans', // Before transaction
                '%posttrans', // After transaction
                '%preuntrans', // Before removal transaction
                '%postuntrans', // After removal transaction
                '%verify' // During verification
            ),

        // Runtime scriptlet without interpreter (defaults to bash)
        runtime_scriptlet: ($) =>
            prec.right(
                seq(
                    $._runtime_scriptlet_keyword,
                    optional(seq(optional('-n'), $.package_name)),
                    /\n/,
                    optional($.script_block)
                )
            ),

        // Runtime scriptlet with explicit interpreter (-p option)
        // Use this for lua, python, perl, etc.
        runtime_scriptlet_interpreter: ($) =>
            prec.right(
                seq(
                    $._runtime_scriptlet_keyword,
                    optional(seq(optional('-n'), $.package_name)),
                    field('interpreter', $.script_interpreter),
                    /\n/,
                    optional($.script_block)
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Triggers (%triggerin, %triggerun, ...)
        //
        // Syntax: %trigger{un|in|postun} [[-n] <subpackage>] [-p <program>] -- <trigger>
        //
        // Examples:
        //   %triggerun -- systemd < 256
        //   %triggerin -n package -p /usr/bin/perl -- fileutils > 3.0, perl < 1.2
        ///////////////////////////////////////////////////////////////////////

        trigger: ($) =>
            prec.right(
                seq(
                    field(
                        'type',
                        choice(
                            '%triggerprein',
                            '%triggerin',
                            '%triggerun',
                            '%triggerpostun'
                        )
                    ),
                    optional(field('subpackage', $.trigger_subpackage)),
                    optional(field('interpreter', $.script_interpreter)),
                    optional(field('condition', $.trigger_condition)),
                    /\n/,
                    optional($.script_block)
                )
            ),

        // Trigger subpackage: [-n] <name>
        trigger_subpackage: ($) => seq(optional('-n'), $.package_name),

        // Trigger condition: -- <dependency_list>
        trigger_condition: ($) => seq('--', $._dependency_list),

        ///////////////////////////////////////////////////////////////////////
        // File triggers (%filetriggerin, %filetriggerun, ...)
        //
        // Syntax: %file_trigger_tag [OPTIONS] -- PATHPREFIX...
        //
        // Options:
        //   -n <subpackage>  - subpackage name
        //   -p <program>     - interpreter program
        //   -P <priority>    - trigger priority (default 1000000)
        //
        // Examples:
        //   %filetriggerin -- /usr/lib /lib
        //   %filetriggerin -P 20 -- /usr/lib
        //   %transfiletriggerin -p /usr/bin/lua -- /usr/share/lua
        ///////////////////////////////////////////////////////////////////////

        file_trigger: ($) =>
            prec.right(
                seq(
                    field(
                        'type',
                        choice(
                            '%filetriggerin',
                            '%filetriggerun',
                            '%filetriggerpostun',
                            '%transfiletriggerin',
                            '%transfiletriggerun',
                            '%transfiletriggerpostun'
                        )
                    ),
                    optional(field('subpackage', $.trigger_subpackage)),
                    optional(field('interpreter', $.script_interpreter)),
                    optional(field('priority', $.file_trigger_priority)),
                    optional(field('paths', $.file_trigger_paths)),
                    /\n/,
                    optional($.script_block)
                )
            ),

        // File trigger priority: -P <number>
        file_trigger_priority: ($) => seq('-P', $.integer),

        // File trigger paths: -- <path>...
        file_trigger_paths: ($) => seq('--', repeat1($._literal)),

        ///////////////////////////////////////////////////////////////////////
        // FILES SECTION - PACKAGE FILE LISTING
        //
        // The %files section lists all files included in the package.
        // Each file can have attributes specifying:
        // - Permissions: %attr(mode, user, group)
        // - Type qualifiers: %config, %doc, %dir, %ghost, etc.
        // - Verification attributes: %verify(not size mtime)
        //
        // File types:
        // - %config: Configuration files (preserved on upgrade)
        // - %doc: Documentation files
        // - %dir: Directories (created if missing)
        // - %ghost: Files not packaged but owned by package
        // - %license: License files
        //
        // Examples:
        //   %files
        //   %defattr(-,root,root,-)
        //   %{_bindir}/myprogram
        //   %config(noreplace) %{_sysconfdir}/myprogram.conf
        //   %doc README.md
        //   %attr(755,root,root) %{_bindir}/special-program
        ///////////////////////////////////////////////////////////////////////

        // Files section: lists files included in the package

        // Files section: declares which files belong to the package
        // Can specify subpackage name and file list from external file
        files: ($) =>
            prec.right(
                seq(
                    alias('%files', $.section_name),
                    optional(
                        seq(
                            optional('-n'),
                            $.package_name // Subpackage name
                        )
                    ),
                    optional(seq('-f', alias($.path_with_macro, $.path))), // Read file list from file
                    /\n/,
                    repeat(
                        choice(
                            $._files_compound_statements, // Conditional file inclusion (files context)
                            $.defattr, // Default file attributes
                            $.file // Individual file entries
                        )
                    )
                )
            ),

        // Default file attributes: sets default permissions for all files
        // Format: %defattr(<mode>, <user>, <group>[, <dirmode>])
        // Sets default permissions for following file entries
        // Any parameter can be '-' to use current default
        // Example: %defattr(-,root,root,-) sets root ownership, preserves permissions
        defattr: ($) =>
            seq(
                '%defattr',
                '(',
                choice('-', /[0-9]+/), // File mode (octal) or '-'
                ',',
                choice('-', /[a-zA-Z0-9_]+/), // User name or '-'
                ',',
                choice('-', /[a-zA-Z0-9_]+/), // Group name or '-'
                optional(seq(',', choice('-', /[0-9]+/))), // Optional dirmode
                ')',
                /\n/
            ),

        // File qualifiers: specify file type and handling behavior
        // These affect how RPM treats the file during install/upgrade
        file_qualifier: ($) =>
            choice(
                '%artifact', // Build artifact (build system metadata)
                $.caps_qualifier, // %caps(capabilities) - POSIX capabilities
                $.config_qualifier, // %config or %config(noreplace) etc.
                '%dir', // Directory (created if missing)
                '%doc', // Documentation file
                '%docdir', // Documentation directory
                '%exclude', // Exclude file from package (used with -f file lists)
                '%ghost', // Ghost file (not in package, but owned)
                '%license', // License file
                '%missingok', // OK if file is missing at install
                '%readme', // README file
                $.verify // Custom verification attributes
            ),

        // %caps directive: set POSIX.1e capabilities on the file
        // Format: %caps(<capability_text>)
        // Example: %caps(cap_net_raw=p) %{_bindir}/foo
        caps_qualifier: ($) =>
            seq('%caps', token.immediate('('), /[^)]+/, token.immediate(')')),

        // %config directive with optional arguments
        // Forms: %config, %config(noreplace), %config(missingok), %config(noreplace,missingok)
        // Use token.immediate to force ( to be part of the same token as %config
        config_qualifier: ($) =>
            seq(
                // Match %config or %config( as the start
                choice(
                    // %config( forces parsing of options
                    seq(
                        token(seq('%config', '(')),
                        commaSep1($.config_option),
                        ')'
                    ),
                    // Plain %config without options
                    '%config'
                )
            ),

        // Options for %config directive
        config_option: (_) => choice('noreplace', 'missingok'),

        // File entry: individual file with optional attributes and qualifiers
        // Can specify custom permissions, file type, and path
        // Attributes (%attr) and qualifiers (%ghost, %dir, etc.) can appear in any order
        file: ($) =>
            choice(
                // Just qualifiers, no paths (e.g., standalone %doc)
                seq(repeat1(choice($.attr, $.file_qualifier)), /\n/),
                // Paths with optional qualifiers
                seq(
                    repeat(choice($.attr, $.file_qualifier)),
                    repeat1(alias($.file_path, $.path)),
                    /\n/
                )
            ),

        // Single file path for %files section - follows shell globbing rules (see glob(7))
        // Each path is contiguous (no internal whitespace unless quoted)
        // Supports:
        // - Quoted paths for spaces: "/opt/bob's htdocs"
        // - Escaped metacharacters: \?, \*, %%, \\, \"
        // - Shell glob patterns: *, ?, |, [], {}
        // - Macro expansions: %{_bindir}/*
        file_path: ($) =>
            choice(
                // Quoted path - preserves spaces, allows escapes
                seq(
                    '"',
                    repeat(
                        choice(
                            /[^"\\%]+/, // Regular chars (no quote, backslash, percent)
                            /\\[\\"]/, // Escaped backslash or quote
                            '%%', // Escaped percent
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    ),
                    '"'
                ),
                // Unquoted path - contiguous segments (no whitespace between parts)
                // First segment, then immediate continuations
                seq(
                    choice(
                        /[^\s"{}%]+/,
                        $.macro_simple_expansion,
                        $.macro_expansion,
                        $.brace_expansion
                    ),
                    repeat(
                        choice(
                            // Literal segment must be immediately adjacent
                            token.immediate(/[^\s"{}%]+/),
                            // Macros naturally attach (start with %)
                            $.macro_simple_expansion,
                            $.macro_expansion,
                            // Brace expansion for globs like {a,b,c}
                            $.brace_expansion
                        )
                    )
                )
            ),

        // Brace expansion for shell globs: {a,b,c}
        // Used in file paths like /path/{foo,bar,baz}
        // Also handles empty alternatives like {,.*} (matches "" or ".anything")
        brace_expansion: ($) =>
            seq(token.immediate('{'), commaSepAllowEmpty($._brace_item), '}'),

        // Single item inside brace expansion
        _brace_item: ($) =>
            choice(
                /[^\s,{}%]+/, // Simple word (includes * and ? globs)
                $.macro_simple_expansion,
                $.macro_expansion
            ),

        // File attributes: custom permissions for individual files
        // Format: %attr(<mode>, <user>, <group>) <file|directory>
        // Any parameter can be '-' to use current default
        attr: ($) =>
            seq(
                '%attr',
                '(',
                $._attr_mode, // File mode (octal) or '-' or macro
                ',',
                $._attr_owner, // User name or '-' or macro
                ',',
                $._attr_owner, // Group name or '-' or macro
                ')',
                token.immediate(BLANK) // Required whitespace before filename
            ),

        // File mode in %attr: octal number, '-' for default, or macro
        _attr_mode: ($) =>
            choice('-', /[0-9]+/, $.macro_expansion, $.macro_simple_expansion),

        // User/group name in %attr: identifier, '-' for default, or macro
        _attr_owner: ($) =>
            choice(
                '-',
                /[a-zA-Z0-9_]+/,
                $.macro_expansion,
                $.macro_simple_expansion
            ),

        // Verify attributes: control package verification behavior
        // Specifies which file attributes to verify during rpm -V
        // Use 'not' to exclude specific verification checks
        // Example: %verify(not size filedigest mtime) %{prefix}/bin/file
        verify: ($) =>
            seq(
                '%verify',
                token.immediate('('),
                repeat(
                    choice(
                        'caps', // POSIX capabilities
                        'filedigest', // File checksum verification
                        'group', // Group ownership
                        'link', // Symbolic link target
                        'maj', // Major device number
                        'md5', // MD5 checksum (alias for filedigest)
                        'min', // Minor device number
                        'mode', // File permissions
                        'mtime', // Modification time
                        'not', // Negation modifier
                        'owner', // User ownership (alias: user)
                        'rdev', // Device number
                        'size', // File size
                        'symlink', // Symbolic link target (alias for link)
                        'user' // User ownership (alias for owner)
                    )
                ),
                token.immediate(')') // Closing parenthesis
            ),

        ///////////////////////////////////////////////////////////////////////
        // Changelog Section (%changelog)
        ///////////////////////////////////////////////////////////////////////

        changelog: ($) =>
            seq(
                alias(token('%changelog'), $.section_name),
                /\n/,
                repeat($.changelog_entry)
            ),

        // * Tue May 31 2016 Adam Miller <maxamillion@fedoraproject.org> - 0.1-1
        // * Fri Jun 21 2002 Bob Marley <marley@redhat.com>
        // - Some change description
        //   continuation line (starts with whitespace)

        changelog_entry: ($) =>
            seq(
                '*',
                $.string_content,
                /\n/,
                repeat(
                    choice(
                        // Standard format: - item description
                        seq(
                            '-',
                            $.string,
                            /\n/,
                            // Continuation lines: start with whitespace, not * or -
                            repeat(seq(/[ \t]+/, $.string, /\n/))
                        ),
                        // Legacy format: item without leading - (must start with non-whitespace)
                        seq(/[^\s*%-]/, optional($.string), /\n/)
                    )
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Special Macros (%autosetup, %autopatch, %setup, ...)
        ///////////////////////////////////////////////////////////////////////

        // %setup macro: source preparation with comprehensive option support
        // Syntax: %setup [options]
        // Options can be combined, e.g., %setup -c -n mydir -q
        setup_macro: ($) =>
            seq(
                '%',
                alias('setup', $.builtin),
                repeat(
                    choice(
                        // Simple flags: -c, -C, -D, -T, -q
                        field('argument', alias($._setup_flag, $.macro_option)),
                        // Source options: -a N, -b N
                        field(
                            'argument',
                            alias($._setup_source_option, $.macro_option)
                        ),
                        // Name option: -n DIR
                        field(
                            'argument',
                            alias($._setup_name_option, $.macro_option)
                        )
                    )
                ),
                /\n/
            ),

        // Simple setup flags (no parameters)
        // Must be tokens so they only match with whitespace separation
        _setup_flag: (_) => token(choice('-c', '-C', '-D', '-T', '-q')),

        // Setup options that take a source number parameter
        // -a/-b must be tokens to require whitespace separation
        _setup_source_option: ($) =>
            choice(
                token(seq('-', choice('a', 'b'), /[0-9]+/)), // -a4, -b4
                seq(
                    token(seq('-', choice('a', 'b'))), // -a: unpack after cd, -b: unpack before cd
                    field('number', $.integer)
                ) // -a 4, -b 4
            ),

        // Directory value for -n option in setup/autosetup
        // Uses package_name for word/macro combinations, or quoted string for names with spaces
        // Examples: %{name}-%{version}, %{name}-v%{version}, talloc-%{version}, "name with spaces"
        _setup_directory: ($) =>
            choice(alias($.package_name, $.directory), $.quoted_string),

        // Setup name option: -n DIR (or combined forms like -qn, -cqn, -Tqn, etc.)
        // Supports getopt-style combined flags where -n is last and takes directory argument
        // -n must be a token to require whitespace separation
        _setup_name_option: ($) =>
            seq(
                token(seq('-', repeat(choice('c', 'C', 'D', 'T', 'q')), 'n')),
                field('directory', $._setup_directory)
            ),

        // %autosetup macro: automated source unpacking and patch application
        // Syntax: %autosetup [options]
        // Options: -v, -N, -c, -C, -D, -T, -a N, -b, -n DIR, -p N, -S <vcs>
        autosetup_macro: ($) =>
            seq(
                '%',
                alias('autosetup', $.builtin),
                repeat(
                    choice(
                        // Flags: -v, -N, -c, -C, -D, -T, -b
                        field(
                            'argument',
                            alias($._autosetup_flag, $.macro_option)
                        ),
                        // Source: -a N
                        field(
                            'argument',
                            alias($._autosetup_source_option, $.macro_option)
                        ),
                        // Name: -n DIR
                        field(
                            'argument',
                            alias($._autosetup_name_option, $.macro_option)
                        ),
                        // Patch: -p N
                        field(
                            'argument',
                            alias($._autosetup_patch_option, $.macro_option)
                        ),
                        // VCS: -S <vcs>
                        field(
                            'argument',
                            alias($._autosetup_vcs_option, $.macro_option)
                        )
                    )
                ),
                /\n/
            ),

        // Autosetup flags (no parameters)
        // Must be tokens so they only match with whitespace separation
        _autosetup_flag: (_) =>
            token(choice('-v', '-N', '-c', '-C', '-D', '-T', '-b')),

        // Autosetup source option: -a N
        // -a must be a token to require whitespace separation
        _autosetup_source_option: ($) =>
            choice(
                token(seq('-', 'a', /[0-9]+/)), // -a4
                seq(token(seq('-', 'a')), field('number', $.integer)) // -a 4
            ),

        // Autosetup name option: -n DIR (or combined forms like -qn, -cqn, etc.)
        // Supports getopt-style combined flags where -n is last and takes directory argument
        // -n must be a token to require whitespace separation
        _autosetup_name_option: ($) =>
            seq(
                token(
                    seq(
                        '-',
                        repeat(choice('v', 'N', 'c', 'C', 'D', 'T', 'b')),
                        'n'
                    )
                ),
                field('directory', $._setup_directory)
            ),

        // Autosetup patch option: -p N
        // -p must be a token to require whitespace separation
        _autosetup_patch_option: ($) =>
            choice(
                token(seq('-', 'p', /[0-9]+/)), // -p1
                seq(token(seq('-', 'p')), field('value', $.integer)) // -p 1
            ),

        // Autosetup VCS option: -S <vcs>
        // -S must be a token to require whitespace separation
        _autosetup_vcs_option: (_) =>
            seq(
                token(seq('-', 'S')),
                field(
                    'vcs',
                    choice(
                        'git',
                        'git_am',
                        'hg',
                        'bzr',
                        'quilt',
                        'patch',
                        'gendiff'
                    )
                )
            ),

        // %autopatch macro: apply patches automatically
        // Syntax: %autopatch [options] [arguments]
        // Options: -v, -q, -p N, -m N, -M N
        // Arguments: patch numbers (positional)
        autopatch_macro: ($) =>
            seq(
                '%',
                alias('autopatch', $.builtin),
                repeat(
                    choice(
                        // Flags: -v, -q
                        field(
                            'argument',
                            alias($._autopatch_flag, $.macro_option)
                        ),
                        // Number: -p N, -m N, -M N
                        field(
                            'argument',
                            alias($._autopatch_number_option, $.macro_option)
                        ),
                        // Positional patch numbers
                        alias($._autopatch_argument, $.macro_argument)
                    )
                ),
                /\n/
            ),

        // Autopatch flags (no parameters)
        _autopatch_flag: (_) => seq('-', choice('v', 'q')),

        // Autopatch options that take a number parameter
        _autopatch_number_option: ($) =>
            choice(
                // Immediate format: -p1, -m100, -M400
                token(seq('-', choice('p', 'm', 'M'), /[0-9]+/)),
                // Spaced format: -p 1, -m 100, -M 400
                // Value can be integer, macro expansion, or macro expression
                seq(
                    token(seq('-', choice('p', 'm', 'M'))),
                    field(
                        'value',
                        choice($.integer, $.macro_expansion, $.macro_expression)
                    )
                )
            ),

        // Autopatch arguments: positional patch numbers
        _autopatch_argument: ($) => $.integer,

        ///////////////////////////////////////////////////////////////////////
        // Legacy patch token for %patch0, %patch1 etc.
        patch_legacy_token: ($) =>
            seq(alias(token(prec(2, /patch[0-9]+/)), $.builtin)),

        // %patch macro: patch application with comprehensive option support
        // Syntax: %patch [options] [arguments]
        // Options: -b SUF, -d DIR, -E, -F N, -o FILE, -p N, -P N, -R, -z SUF, -Z
        // Arguments: patch numbers (positional)
        // Supports modern (%patch 1, %patch -P1) and legacy (%patch0) syntax
        patch_macro: ($) =>
            prec(
                1,
                seq(
                    '%',
                    choice(
                        // Legacy syntax: %patch0, %patch1, etc. (direct number attachment)
                        $.patch_legacy_token,
                        // Modern syntax: %patch
                        alias('patch', $.builtin)
                    ),
                    repeat(
                        choice(
                            // Simple flags: -E, -R, -Z
                            field(
                                'argument',
                                alias($._patch_option_flag, $.macro_option)
                            ),
                            // Number options: -F N, -p N, -P N
                            field(
                                'argument',
                                alias($._patch_option_number, $.macro_option)
                            ),
                            // String options: -b SUF, -d DIR, -o FILE, -z SUF
                            field(
                                'argument',
                                alias($._patch_option_string, $.macro_option)
                            ),
                            // Positional patch numbers
                            alias($._patch_argument, $.macro_argument)
                        )
                    ),
                    /\n/
                )
            ),

        // Patch arguments: positional patch numbers
        _patch_argument: ($) => $.integer,

        // Patch option flags (no parameters)
        _patch_option_flag: (_) =>
            seq(
                '-',
                choice(
                    'E', // Remove files emptied by patching
                    'R', // Assume reversed patch
                    'Z' // Set mtime and atime from context diff headers using UTC
                )
            ),

        // Patch options that take a number parameter
        _patch_option_number: ($) =>
            choice(
                // Immediate format: -p1, -F3, -P2
                token(seq('-', choice('F', 'p', 'P'), /[0-9]+/)),
                // Spaced format: -p 1, -F 3, -P 2
                seq('-', choice('F', 'p', 'P'), field('value', $.integer))
            ),

        // Patch options that take a string parameter
        _patch_option_string: ($) =>
            seq(
                '-',
                choice(
                    'b', // Backup with suffix
                    'd', // Change to directory before patching
                    'o', // Send output to file
                    'z' // Same as -b
                ),
                field('value', $._primary_expression)
            ),

        ///////////////////////////////////////////////////////////////////////
        // LITERAL VALUES - NUMBERS, VERSIONS, AND STRINGS
        //
        // RPM specs support various literal value types:
        // - Integers: 123, -456, 0x1a2b (with optional suffixes)
        // - Floating point: 1.23, 45.67
        // - Version numbers: 1.2.3, 2.0.1-beta, 1.0~rc1
        // - Strings: unquoted words, "quoted strings"
        // - Text blocks: multi-line content in descriptions
        //
        // String concatenation happens automatically when expressions
        // are adjacent: %{name}-%{version} becomes "package-1.0"
        ///////////////////////////////////////////////////////////////////////

        // Integer literals: whole numbers with optional base and suffix
        // Supports decimal (123), hexadecimal (0x1a), and RPM version suffixes
        // Example: 0x10#sometext for special RPM version handling
        integer: ($) =>
            choice(
                /-?(0x)?[0-9]+(#[0-9A-Za-z@_]+)?/,
                seq(
                    /-?(0x)?[0-9]+/,
                    choice($.macro_simple_expansion, $.macro_expansion)
                )
            ),

        // Floating point literals: decimal numbers with fractional part
        // Supports underscores in digits for readability: 1_000.50
        float: ($) => {
            const digits = repeat1(/[0-9]+_?/);

            return token(seq(digits, '.', digits));
        },

        // Version literals: semantic version numbers with optional epoch and suffixes
        // Supports various version formats: 1.2.3, 2:1.0.0, 1.0~rc1+git123
        // Common in RPM for package versioning and dependency specifications
        version: ($) => {
            const digits = repeat1(/[0-9]+_?/);

            return token(
                prec(
                    1,
                    seq(
                        optional(seq(digits, ':')), // Optional epoch: N:
                        digits,
                        '.',
                        digits, // Major.minor version
                        optional(/[a-zA-Z0-9+._~]+/) // Optional version suffix (patch, pre-release, etc.)
                    )
                )
            );
        },

        // Version literal for macro expressions: v"3:1.2-1"
        // Used in %[...] expressions for version comparison with RPM algorithm
        // Example: %[ v"3.1.0-1" < v"1.0~alpha-2" ]
        // The 'v' is followed immediately by '"' (no space allowed)
        version_literal: ($) =>
            seq(
                'v',
                token.immediate('"'),
                alias($._quoted_string_content, $.string_content),
                '"'
            ),

        // Release literals: RPM release numbers
        // Examples: 1, 2, 1.fc35, 3.el8
        release: ($) => {
            return token(/[a-zA-Z0-9+._~]+/);
        },

        // Dependency version: version with optional release for dependency specifications
        // Format: [epoch:]version[-release] - used in dependency contexts like Requires
        dependency_version: ($) => {
            const digits = repeat1(/[0-9]+_?/);

            return token(
                prec(
                    3,
                    seq(
                        optional(seq(digits, ':')), // Optional epoch: N:
                        digits,
                        optional(seq('.', digits)), // Optional minor version
                        optional(/[a-zA-Z0-9+._~]+/), // Optional version suffix
                        optional(seq('-', /[0-9]+[a-zA-Z0-9+._~]*/)) // Optional release
                    )
                )
            );
        },

        // Arbitrary version string: for git hashes, commit IDs, etc.
        // Fallback when dependency_version doesn't match
        // Must start with alphanumeric, greedy match to end
        dependency_version_string: ($) => {
            return token(
                prec(
                    1, // Lower precedence than dependency_version
                    /[a-zA-Z0-9][a-zA-Z0-9+._~-]*/
                )
            );
        },

        // Text blocks: multi-line content with macro expansion support
        // Used in %description sections and other narrative content
        // Low precedence (-1) allows greedy matching of text content
        text: ($) =>
            prec(
                -1,
                repeat1(
                    choice(
                        seq(optional('%'), $.text_content), // Raw text (% is literal)
                        $.macro_simple_expansion, // %macro
                        $.macro_expansion, // %{macro}
                        $.macro_shell_expansion, // %(shell command)
                        $.quoted_string // Quoted strings like "%{crate}"
                    )
                )
            ),

        // Text content: raw text excluding macro delimiters and quotes
        // Supports backslash escaping and line continuations
        // Excludes % " \ characters that have special meaning
        text_content: (_) => token(prec(-1, /([^"%\\\r\n]|\\(.|\r?\n))+/)),

        // Macro body text: text inside macro expansion that excludes }
        // Used for conditional expansion consequences like %{?name:value}
        // Must stop at } to not consume the closing brace of macro_expansion
        _macro_body_text: ($) =>
            prec(
                -1,
                repeat1(
                    choice(
                        seq(
                            optional('%'),
                            alias($._macro_body_text_content, $.text_content)
                        ),
                        $.macro_simple_expansion,
                        $.macro_expansion,
                        $.macro_shell_expansion
                    )
                )
            ),

        // Text content for inside macro expansions - excludes } and newlines
        // Pattern: anything except % " \ } \r \n, or escaped characters
        // Aliased to text_content for consistent syntax highlighting
        _macro_body_text_content: (_) =>
            token(prec(-1, /([^"%\\}\r\n]|\\(.|\r?\n))+/)),

        // String values: sequences of text and macro expansions
        // Automatically concatenates adjacent elements
        // Left precedence for proper parsing of concatenated strings
        string: ($) =>
            prec.left(
                repeat1(
                    choice(
                        seq(optional('%'), $.string_content), // Raw string content
                        $.macro_simple_expansion, // %macro expansions
                        $.macro_expansion // %{macro} expansions
                    )
                )
            ),

        // String content: raw text excluding macro delimiters
        // Includes escape sequences (backslash followed by any char)
        // Excludes unescaped %, bare backslash at EOL, and newlines
        string_content: (_) => token(prec(-1, /([^%\\\r\n]|\\.)+/)),

        // Shell content: permissive raw text for shell script sections
        // Stops at: %, backslash, newline
        // Used in script_block for %prep, %build, %install, etc.
        script_content: (_) => token(prec(-1, /[^%\\\r\n]+/)),

        // Backslash escape sequence in script content (not line continuation)
        // Matches backslash followed by any character except CR/LF
        // Examples: \n, \t, \r within strings like echo "\n\t"
        // Note: backslash-newline is handled by line_continuation
        _script_escape: (_) => token(/\\[^\r\n]/),

        // Trailing backslash: just a backslash character
        // Used in _script_line_simple where we don't want line continuation
        // but still need to match the backslash at end of line
        _trailing_backslash: (_) => '\\',

        // Quoted strings: explicit string literals with macro expansion
        // Allows macro expansion within quotes: "prefix-%{version}-suffix"
        // Used when whitespace or special characters need to be preserved
        quoted_string: ($) =>
            seq(
                '"', // Opening quote
                repeat(
                    choice(
                        $.macro_expansion, // %{macro} inside quotes
                        alias($._quoted_string_content, $.string_content) // Literal text
                    )
                ),
                '"' // Closing quote
            ),

        // Quoted string content: literal text within quotes
        // Includes escaped quotes (\") and other escape sequences
        // Excludes unescaped quotes, macro delimiters, and line breaks
        // Aliased to string_content for simpler AST
        _quoted_string_content: (_) => token(prec(-1, /([^"%\\\r\n]|\\.)+/)),

        // Word tokens: unquoted identifiers and simple values
        // Excludes whitespace and special characters that have syntactic meaning
        // Used for simple identifiers, paths, and unquoted string values
        // Pattern borrowed from tree-sitter-bash, using noneOf() helper
        word: (_) =>
            token(
                seq(
                    noneOf(...SPECIAL_CHARACTERS),
                    repeat(noneOf(...SPECIAL_CHARACTERS))
                )
            ),

        // Special characters that are excluded from word tokens
        // Used with low precedence to catch standalone special chars in macro values
        // Pattern from tree-sitter-bash for handling edge cases like %%{uid}
        // Matches all chars in SPECIAL_CHARACTERS except quotes/whitespace/escapes
        _special_character: (_) =>
            token(
                prec(-1, choice('{', '}', '[', ']', '(', ')', '<', '>', '|'))
            ),

        // String concatenation: automatic joining of adjacent expressions
        // RPM automatically concatenates adjacent values without operators
        // Low precedence (-1) ensures this binds loosely
        // Example: %{name}-%{version}.tar.gz becomes "mypackage-1.0.tar.gz"
        concatenation: ($) =>
            prec(
                -1,
                seq(
                    $._primary_expression, // First expression
                    // One or more additional expressions
                    repeat1($._primary_expression)
                )
            ),
    },
});

/**
 * Creates a rule to match one or more occurrences of `rule` separated by `separator`
 *
 * This is a common Tree-sitter pattern for parsing comma-separated lists,
 * space-separated arguments, and other delimited sequences.
 *
 * The pattern generates: rule (separator rule)
 *
 * Examples:
 * - sep1($.identifier, ',') matches: \"a, b, c\"
 * - sep1($.argument, /\\s+/) matches: \"arg1 arg2 arg3\"
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @return {SeqRule} A sequence rule matching one or more separated items
 *
 */
function sep1(rule, separator) {
    return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match zero or more occurrences of `rule` separated by `separator`
 *
 * @param {RuleOrLiteral} rule - The rule to match
 * @param {RuleOrLiteral} separator - The separator between occurrences
 * @return {ChoiceRule} A rule matching zero or more separated items
 */
function sep(rule, separator) {
    return optional(sep1(rule, separator));
}

/**
 * Creates a rule to match one or more comma-separated occurrences of `rule`
 *
 * @param {RuleOrLiteral} rule - The rule to match
 * @return {SeqRule} A rule matching one or more comma-separated items
 */
function commaSep1(rule) {
    return sep1(rule, ',');
}

/**
 * Creates a rule to match zero or more comma-separated occurrences of `rule`
 *
 * @param {RuleOrLiteral} rule - The rule to match
 * @return {ChoiceRule} A rule matching zero or more comma-separated items
 */
function commaSep(rule) {
    return optional(commaSep1(rule));
}

/**
 * Creates a comma-separated list where items are optional
 *
 * Allows empty slots like {,.*} or {a,} or {a,,b}
 * Used for shell brace expansion patterns.
 *
 * @param {RuleOrLiteral} rule - The rule to match (each item is optional)
 * @return {SeqRule} A rule matching comma-separated optional items
 */
function commaSepAllowEmpty(rule) {
    return sep1(optional(rule), ',');
}

/**
 * Creates a tag token that includes the colon.
 *
 * This prevents tag keywords (like "Provides", "Requires") from matching
 * in text content (e.g., description starting with "Provides...").
 * By including the colon in the token, "Provides" without a colon
 * won't be recognized as a tag.
 *
 * @param {...string} keywords - One or more tag keywords
 * @return {TokenRule} A token matching any keyword followed by colon
 */
function tagWithColon(...keywords) {
    const keywordChoice =
        keywords.length === 1 ? keywords[0] : choice(...keywords);
    return token(seq(keywordChoice, ':'));
}

/**
 * Creates an %if statement rule for different contexts
 *
 * @param {function} tokenRule - Function returning the scanner token (e.g., $.top_level_if)
 * @param {function} contentRule - Function returning the content rule (e.g., $._conditional_block)
 * @param {function} elifRule - Function returning the elif clause rule
 * @param {function} elseRule - Function returning the else clause rule
 * @param {boolean} optionalContent - Whether content is optional (true for scriptlet/files contexts)
 * @returns {function} A grammar rule function for the if statement
 */
function makeIfStatement(
    tokenRule,
    contentRule,
    elifRule,
    elseRule,
    optionalContent = false
) {
    return ($) =>
        seq(
            alias(tokenRule($), '%if'),
            field('condition', $.expression),
            /\n/,
            optionalContent
                ? optional(field('consequence', contentRule($)))
                : optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            /\n/
        );
}

/**
 * Creates an %ifarch/%ifnarch statement rule for different contexts
 *
 * @param {function} ifarchToken - Function returning the %ifarch scanner token
 * @param {function} ifnarchToken - Function returning the %ifnarch scanner token
 * @param {function} contentRule - Function returning the content rule
 * @param {function} elifRule - Function returning the elifarch clause rule
 * @param {function} elseRule - Function returning the else clause rule
 * @returns {function} A grammar rule function for the ifarch statement
 */
function makeIfarchStatement(
    ifarchToken,
    ifnarchToken,
    contentRule,
    elifRule,
    elseRule
) {
    return ($) =>
        seq(
            choice(
                alias(ifarchToken($), '%ifarch'),
                alias(ifnarchToken($), '%ifnarch')
            ),
            field('condition', $.arch),
            /\n/,
            optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            /\n/
        );
}

/**
 * Creates an %ifos/%ifnos statement rule for different contexts
 *
 * @param {function} ifosToken - Function returning the %ifos scanner token
 * @param {function} ifnosToken - Function returning the %ifnos scanner token
 * @param {function} contentRule - Function returning the content rule
 * @param {function} elifRule - Function returning the elifos clause rule
 * @param {function} elseRule - Function returning the else clause rule
 * @returns {function} A grammar rule function for the ifos statement
 */
function makeIfosStatement(
    ifosToken,
    ifnosToken,
    contentRule,
    elifRule,
    elseRule
) {
    return ($) =>
        seq(
            choice(
                alias(ifosToken($), '%ifos'),
                alias(ifnosToken($), '%ifnos')
            ),
            field('condition', $.os),
            /\n/,
            optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            /\n/
        );
}

/**
 * Creates an %elif clause rule for different contexts
 *
 * @param {function} contentRule - Function returning the content rule
 * @param {boolean} optionalContent - Whether content is optional
 * @returns {function} A grammar rule function for the elif clause
 */
function makeElifClause(contentRule, optionalContent = false) {
    return ($) =>
        seq(
            '%elif',
            field('condition', $.expression),
            /\n/,
            optionalContent
                ? optional(field('consequence', contentRule($)))
                : field('consequence', contentRule($))
        );
}

/**
 * Creates an %elifarch clause rule for different contexts
 *
 * @param {function} contentRule - Function returning the content rule
 * @param {boolean} optionalContent - Whether content is optional
 * @returns {function} A grammar rule function for the elifarch clause
 */
function makeElifarchClause(contentRule, optionalContent = false) {
    return ($) =>
        seq(
            '%elifarch',
            optional(field('condition', $._literal)),
            /\n/,
            optionalContent
                ? optional(field('consequence', contentRule($)))
                : field('consequence', contentRule($))
        );
}

/**
 * Creates an %elifos clause rule for different contexts
 *
 * @param {function} contentRule - Function returning the content rule
 * @param {boolean} optionalContent - Whether content is optional
 * @returns {function} A grammar rule function for the elifos clause
 */
function makeElifosClause(contentRule, optionalContent = false) {
    return ($) =>
        seq(
            '%elifos',
            optional(field('condition', $._literal)),
            /\n/,
            optionalContent
                ? optional(field('consequence', contentRule($)))
                : field('consequence', contentRule($))
        );
}

/**
 * Creates an %else clause rule for different contexts
 *
 * @param {function} contentRule - Function returning the content rule
 * @param {boolean} optionalContent - Whether content is optional
 * @returns {function} A grammar rule function for the else clause
 */
function makeElseClause(contentRule, optionalContent = false) {
    return ($) =>
        seq(
            '%else',
            /\n/,
            optionalContent
                ? optional(field('body', contentRule($)))
                : field('body', contentRule($))
        );
}

/**
 * Creates a regex that matches any character EXCEPT the specified ones
 *
 * Helper function from tree-sitter-bash for building negated character classes.
 * Used to define word tokens that exclude special characters.
 *
 * @param {...string} characters - Characters to exclude
 * @returns {RegExp} A regex matching any character except those specified
 */
function noneOf(...characters) {
    const negatedString = characters
        .map((c) => (c === '\\' ? '\\\\' : c))
        .join('');
    return new RegExp('[^' + negatedString + ']');
}
