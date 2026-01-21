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
 * Creates a build scriptlet rule with -a (append) and -p (prepend) options
 *
 * Build scriptlets support augmentation options since rpm >= 4.20.
 * This helper generates the grammar rule for scriptlets like %prep, %build,
 * %install, %check, %clean, %conf, and %generate_buildrequires.
 *
 * @param {string} name - The scriptlet name without % prefix (e.g., 'prep', 'build')
 * @returns {function} A grammar rule function for the scriptlet
 */
function buildScriptlet(name) {
    return ($) =>
        prec.right(
            choice(
                // With options: %name -a or %name -p
                seq(
                    alias(token(seq('%' + name, / +/)), $.section_name),
                    $.scriptlet_augment_option,
                    token.immediate(NEWLINE),
                    optional($.shell_block)
                ),
                // Without options: %name
                seq(
                    alias(token(seq('%' + name, NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            )
        );
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
            token.immediate(NEWLINE),
            optionalContent
                ? optional(field('consequence', contentRule($)))
                : optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            token.immediate(NEWLINE)
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
            token.immediate(NEWLINE),
            optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            token.immediate(NEWLINE)
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
            token.immediate(NEWLINE),
            optional(field('consequence', contentRule($))),
            repeat(field('alternative', elifRule($))),
            optional(field('alternative', elseRule($))),
            '%endif',
            token.immediate(NEWLINE)
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
            token.immediate(NEWLINE),
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
            token.immediate(NEWLINE),
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
            token.immediate(NEWLINE),
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
            token.immediate(NEWLINE),
            optionalContent
                ? optional(field('body', contentRule($)))
                : field('body', contentRule($))
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
        /\s+/, // All whitespace characters
        /\\( |\t|\v|\f)/, // Escaped whitespace characters
        $.line_continuation, // Backslash line continuations
    ],

    // Supertypes define abstract syntax tree node categories
    // These help with syntax highlighting and semantic analysis
    supertypes: ($) => [
        $._simple_statements, // Single-line statements (tags, macros, etc.)
        $._compound_statements, // Multi-line blocks (if/else, sections)
        $.expression, // Mathematical and logical expressions
        $._primary_expression, // Basic expression components
    ],

    // Conflict resolution for ambiguous grammar rules
    conflicts: ($) => [
        // file_path: After a path segment, a % could either continue the current
        // path (e.g., /usr/%{name}) or start a new path. Let GLR handle it.
        [$.file_path],
        // subpackage_name vs text: In %description, a macro after package name could
        // be continuation of subpackage_name or start of inline text.
        [$.subpackage_name, $.text],
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
        $.negated_macro, // Negated macro %!name
        $.special_macro, // Special macros: %*, %**, %#, %0-9
        $.escaped_percent, // Escaped percent: %%
        // Context-aware conditional tokens
        $.top_level_if, // %if at top-level or containing section keywords
        $.scriptlet_if, // %if inside scriptlet section without section keywords
        $.top_level_ifarch, // %ifarch at top-level
        $.scriptlet_ifarch, // %ifarch inside scriptlet section
        $.top_level_ifnarch, // %ifnarch at top-level
        $.scriptlet_ifnarch, // %ifnarch inside scriptlet section
        $.top_level_ifos, // %ifos at top-level
        $.scriptlet_ifos, // %ifos inside scriptlet section
        $.top_level_ifnos, // %ifnos at top-level
        $.scriptlet_ifnos, // %ifnos inside scriptlet section
        // Files section context tokens
        $.files_if, // %if inside %files section
        $.files_ifarch, // %ifarch inside %files section
        $.files_ifnarch, // %ifnarch inside %files section
        $.files_ifos, // %ifos inside %files section
        $.files_ifnos, // %ifnos inside %files section
        // Context-specific tokens (only valid in specific macro contexts)
        $.expand_code, // Raw text inside %{expand:...} with balanced braces
        $.shell_code, // Raw text inside %(...) with balanced parentheses
    ],

    // Inline rules are flattened in the parse tree to reduce nesting
    // This improves the tree structure for syntax highlighting and analysis
    inline: ($) => [
        $._simple_statements, // Flatten statement types
        $._compound_statements, // Flatten compound statement types
        $._scriptlet_compound_statements, // Flatten shell compound statement types
        $._files_compound_statements, // Flatten files compound statement types
        $._conditional_block, // Flatten conditional block contents
        $._scriptlet_conditional_content, // Flatten shell conditional content
        $._files_conditional_content, // Flatten files conditional content
        $._literal, // Flatten literal value types
    ],

    // Default token type for unrecognized words
    word: ($) => $.identifier,

    rules: {
        // Root rule: An RPM spec file is a sequence of statements
        spec: ($) => repeat($._statements),

        // Top-level statements in spec files
        _statements: ($) =>
            choice($._simple_statements, $._compound_statements),

        // Simple statements: single-line directives and sections
        _simple_statements: ($) =>
            choice(
                $.macro_definition, // %define, %global
                $.macro_undefinition, // %undefine
                $.macro_expansion, // %{name}, %name
                $.macro_parametric_expansion, // %name [options] [arguments]
                $.macro_simple_expansion, // %name - simple expansion
                $.macro_shell_expansion, // %(shell command)
                $.macro_expression, // %[expression]
                $.preamble, // Name:, Version:, etc.
                $.description, // %description section
                $.package, // %package subsection
                $.sourcelist, // %sourcelist section
                $.patchlist, // %patchlist section
                $.prep_scriptlet, // %prep section
                $.generate_buildrequires, // %generate_buildrequires section
                $.conf_scriptlet, // %conf section
                $.build_scriptlet, // %build section
                $.install_scriptlet, // %install section
                $.check_scriptlet, // %check section
                $.clean_scriptlet, // %clean section
                $.runtime_scriptlet, // %pre, %post, etc.
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
        macro_parametric_expansion: ($) =>
            prec(
                1,
                seq(
                    '%',
                    field('name', $.simple_macro),
                    token.immediate(/[ \t]+/), // Same-line whitespace required
                    repeat($._macro_invocation_argument),
                    optional(
                        seq(
                            $.macro_option_terminator,
                            repeat($._macro_invocation_value)
                        )
                    ),
                    NEWLINE
                )
            ),

        // Arguments that can appear in parametric macro invocations (options + arguments)
        _macro_invocation_argument: ($) =>
            choice(
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
                'expr',
                'lua'
            ),

        // Builtin rule for builtins not handled by category-specific rules
        // String, path, and URL builtins are handled separately in _macro_expansion_body
        builtin: ($) =>
            choice(
                $.macro_source,
                $.macro_patch,
                $._builtin_multi_arg,
                $._builtin_standalone,
                'expr', // Special: takes expression argument
                'lua' // Special: takes Lua code argument
            ),

        macro_source: ($) =>
            choice(token(prec(1, /SOURCE[0-9]+/)), token(prec(1, /S[0-9]+/))),

        macro_patch: ($) =>
            choice(token(prec(1, /PATCH[0-9]+/)), token(prec(1, /P[0-9]+/))),

        macro_define: ($) => choice('define', 'global'),

        macro_undefine: ($) => 'undefine',

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
                // String builtins: %{upper:hello}
                // Combined token ensures no whitespace between builtin and colon
                seq(
                    alias($._builtin_string_colon, $.builtin),
                    field('argument', $._literal)
                ),
                // Expand builtin: %{expand:...}
                // Uses external scanner to handle balanced braces in content
                // expand_content is a container with macros and raw text
                seq(
                    alias(token('expand:'), $.builtin),
                    field('argument', $.expand_content)
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
        conditional_expansion: ($) =>
            prec.left(
                1,
                seq(
                    choice(
                        field(
                            'operator',
                            alias(token.immediate('!?'), $.negation_operator)
                        ),
                        token.immediate('?')
                    ),
                    field('condition', alias($.macro_name, $.identifier)),
                    optional(
                        seq(
                            ':',
                            field(
                                'consequence',
                                choice(
                                    alias(
                                        $._macro_definition,
                                        $.macro_definition
                                    ),
                                    $.macro_undefinition,
                                    $.macro_simple_expansion,
                                    $.macro_expansion,
                                    alias($.macro_body_text, $.text)
                                )
                            )
                        )
                    )
                )
            ),

        //// Macro Definition
        //
        // %define <name>[(opts)] <body>
        macro_definition: ($) =>
            seq($._macro_definition, token.immediate(NEWLINE)),

        _macro_definition: ($) =>
            prec.left(
                seq(
                    '%',
                    alias($.macro_define, $.builtin),
                    token.immediate(BLANK),
                    field('name', alias($.macro_name, $.identifier)),
                    optional(
                        seq('(', optional($.parametric_macro_options), ')')
                    ),
                    token.immediate(BLANK),
                    field('value', $._macro_value)
                )
            ),

        macro_options: (_) => /[-:a-zA-Z]/,

        // Parametric macro options: defines supported short options for the macro
        // Format: (xyz) where x, y, z are single-letter options that can be passed
        // Example: %define myhelper(x) enables %myhelper -x arg
        // Special format ('-') disables default getopt processing
        parametric_macro_options: ($) =>
            choice(
                '-', // Disable default getopt processing
                repeat1(
                    choice(
                        /[a-zA-Z]/, // Single letter options (a-z, A-Z)
                        ':' // Option parameter separator
                    )
                )
            ),

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
        // More permissive than _body - allows raw text with ();<>|& etc.
        // Recognizes macro expansions within the value
        // Example: %global elf_suffix ()%{elf_bits}
        //   -> macro_value_text: "()"
        //   -> macro_expansion: %{elf_bits}
        _macro_value: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion,
                    $.macro_expansion,
                    $.macro_shell_expansion,
                    $.macro_expression, // %[expression]
                    $.integer,
                    $.float,
                    $.version,
                    $.word,
                    $.quoted_string,
                    $.macro_value_text // Fallback for text with ();<>|& etc.
                )
            ),

        //// Macro Undefintion
        //
        // %undefine <name>
        macro_undefinition: ($) =>
            prec.left(
                seq(
                    '%',
                    alias($.macro_undefine, $.builtin),
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
        // Uses external scanner (shell_code) for raw text with parenthesis tracking
        // The scanner handles balanced parentheses and stops at % for macro parsing
        // shell_code is an external scanner token - see src/scanner.c
        shell_command: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion, // %name
                    $.macro_expansion, // %{name}
                    $.shell_code // Raw shell text with balanced parens (external scanner)
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
        _conditional_block: ($) =>
            repeat1(
                choice(prec(-1, $._simple_statements), $._compound_statements)
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
                    $.macro_definition,
                    $.macro_undefinition,
                    $.setup_macro,
                    $.autosetup_macro,
                    $.patch_macro,
                    $.autopatch_macro,
                    $.macro_parametric_expansion,
                    $.macro_expansion,
                    $.macro_simple_expansion,
                    $.macro_shell_expansion,
                    $.macro_expression,
                    $.shell_content
                )
            ),

        // Scriptlet-specific compound statements (alias to regular names in parse tree)
        _scriptlet_compound_statements: ($) =>
            choice(
                alias($.scriptlet_if_statement, $.if_statement),
                alias($.scriptlet_ifarch_statement, $.ifarch_statement),
                alias($.scriptlet_ifos_statement, $.ifos_statement)
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
        scriptlet_if_statement: makeIfStatement(
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
        scriptlet_ifarch_statement: makeIfarchStatement(
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
        scriptlet_ifos_statement: makeIfosStatement(
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
                alias($.files_if_statement, $.if_statement),
                alias($.files_ifarch_statement, $.ifarch_statement),
                alias($.files_ifos_statement, $.ifos_statement)
            ),

        // Content allowed inside files conditionals (files section context)
        // Allows: nested conditionals, defattr, file entries, and nested %files sections
        // Nested %files needed for cases like: %if %{with dc} ... %files subpkg ... %endif
        _files_conditional_content: ($) =>
            repeat1(
                choice($._files_compound_statements, $.defattr, $.file, $.files)
            ),

        // Files-specific %if (uses _files_conditional_content for body)
        files_if_statement: makeIfStatement(
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
        files_ifarch_statement: makeIfarchStatement(
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
        files_ifos_statement: makeIfosStatement(
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
                seq(
                    $.tag, // Tag name
                    token.immediate(/:( |\t)*/), // Colon separator with optional whitespace
                    field('value', $._literal), // Simple values (can contain macros)
                    token.immediate(NEWLINE) // Must end with newline
                ),
                // Source tags (Source0, Source1, etc.) - URL or file path
                seq(
                    alias($.source_tag, $.tag), // Source tag name
                    token.immediate(/:( |\t)*/), // Colon separator with optional whitespace
                    field('value', $._url_or_file), // URL or file path
                    token.immediate(NEWLINE) // Must end with newline
                ),
                // Patch tags (Patch0, Patch1, etc.) - URL or file path
                seq(
                    alias($.patch_tag, $.tag), // Patch tag name
                    token.immediate(/:( |\t)*/), // Colon separator with optional whitespace
                    field('value', $._url_or_file), // URL or file path
                    token.immediate(NEWLINE) // Must end with newline
                ),
                // URL tags (URL, Url, BugUrl) - URL value
                seq(
                    alias($.url_tag, $.tag), // URL tag name
                    token.immediate(/:( |\t)*/), // Colon separator with optional whitespace
                    field('value', alias($.url_with_macro, $.url)), // URL value
                    token.immediate(NEWLINE) // Must end with newline
                ),
                // Strong dependency tags (Requires, BuildRequires) - full boolean support
                seq(
                    alias($.requires_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $.rich_dependency_list), // Supports boolean deps
                    token.immediate(NEWLINE)
                ),
                // Weak dependency tags (Recommends, Suggests, etc.) - full boolean support
                seq(
                    alias($.weak_requires_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $.rich_dependency_list), // Supports boolean deps
                    token.immediate(NEWLINE)
                ),
                // Conflicts/Obsoletes tags - NO boolean expressions
                seq(
                    alias($.conflicts_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $.dependency_list), // No boolean deps
                    token.immediate(NEWLINE)
                ),
                // Provides tag - NO boolean expressions
                seq(
                    alias($.provides_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $.dependency_list), // No boolean deps
                    token.immediate(NEWLINE)
                ),
                // Architecture/OS constraint tags - use literals
                seq(
                    alias($.arch_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $._literal), // Simple arch/OS names
                    token.immediate(NEWLINE)
                ),
                // Legacy/deprecated tags - use rich dependency list for compatibility
                seq(
                    alias($.legacy_dependency_tag, $.dependency_tag),
                    token.immediate(/:( |\t)*/),
                    field('value', $.rich_dependency_list),
                    token.immediate(NEWLINE)
                )
            ),

        // Standard RPM tags: core package metadata fields
        // These are the fundamental tags recognized by RPM
        tag: ($) =>
            choice(
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
        source_tag: (_) => /Source\d*/,

        // Patch tag: Patch0, Patch1, Patch, etc.
        patch_tag: (_) => /Patch\d*/,

        // URL tag: URL, Url, BugUrl
        url_tag: (_) => choice('URL', 'Url', 'BugUrl'),

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

        // Strong dependency tags: Requires (with qualifier), BuildRequires
        // These support full boolean dependency syntax (and, or, if, with, without)
        requires_tag: ($) =>
            choice(
                seq('Requires', optional(seq('(', $.qualifier, ')'))),
                'BuildRequires'
            ),

        // Weak dependency tags: Recommends, Suggests, Supplements, Enhances
        // These also support full boolean dependency syntax
        weak_requires_tag: ($) =>
            choice('Recommends', 'Suggests', 'Supplements', 'Enhances'),

        // Conflict/Obsolete tags: Conflicts, BuildConflicts, Obsoletes
        // These do NOT support boolean expressions - only simple versioned deps
        conflicts_tag: ($) =>
            choice('Conflicts', 'BuildConflicts', 'Obsoletes'),

        // Provides tag: provides virtual packages/capabilities
        // Does NOT support boolean expressions - only simple versioned deps
        provides_tag: (_) => 'Provides',

        // Architecture/OS constraint tags
        // These use simple literals (arch names), not dependency lists
        arch_tag: ($) =>
            choice(
                'BuildArch',
                'BuildArchitectures',
                'ExcludeArch',
                'ExclusiveArch',
                'ExcludeOS',
                'ExclusiveOS'
            ),

        // Legacy/deprecated dependency tags
        // Keep for backwards compatibility
        legacy_dependency_tag: ($) =>
            choice(
                'BuildPrereq', // Build prerequisites (deprecated)
                'Prereq', // Prerequisites (deprecated)
                'OrderWithRequires', // Ordering dependency
                'DocDir', // Documentation directory
                'Prefix', // Installation prefix
                'Prefixes', // Multiple installation prefixes
                'RemovePathPostfixes' // Path postfixes to remove
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

        // A single dependency: package name with optional version constraint
        // Examples: python, python >= 3.6, package = 2:1.0.0-1
        dependency: ($) =>
            seq(
                field('name', $.dependency_name),
                optional(field('version', $.dependency_version_constraint))
            ),

        // Simple dependency list: NO boolean expressions allowed
        // Used for Conflicts, Obsoletes, and Provides tags
        // Examples: "python perl", "python, perl", "python >= 3.6, perl"
        dependency_list: ($) =>
            seq($.dependency, repeat(seq(optional(','), $.dependency))),

        // Rich dependency list: supports boolean expressions (RPM 4.13+)
        // Used for Requires, BuildRequires, and weak dependency tags
        // Examples: "(foo or bar), baz", "(pkgA and pkgB)"
        rich_dependency_list: ($) =>
            seq(
                $._rich_dependency_item,
                repeat(seq(optional(','), $._rich_dependency_item))
            ),

        // A single item in a rich dependency list: regular or boolean
        _rich_dependency_item: ($) =>
            choice($.dependency, $.boolean_dependency),

        // Dependency name
        // Supports: simple words, macros, concatenation, and qualifier suffixes
        // Examples: foo, %{name}, %{name}-libs, perl(Carp), python3dist(pytest)
        dependency_name: ($) =>
            seq(
                $._dependency_name_base,
                optional($.dependency_qualifier_suffix)
            ),

        // Base part of dependency name (without qualifier suffix)
        _dependency_name_base: ($) =>
            choice(
                $._dependency_name_concatenation, // %{name}-libs, foo%{?_isa}
                $.word, // simple: foo
                $.macro_expansion, // %{name}
                $.macro_simple_expansion // %name
            ),

        // Qualifier suffix for dependencies
        // Examples: (Carp), (x86-64), (pytest), (abi)
        // Nested: bundled(golang(golang.org/x/arch))
        dependency_qualifier_suffix: ($) =>
            seq(
                token.immediate('('),
                choice($.identifier, $.word),
                optional($.dependency_qualifier_suffix), // Allow nesting
                ')'
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
        dependency_version_constraint: ($) =>
            seq(
                field('operator', $.dependency_comparison_operator),
                field('version', $._dependency_version_value)
            ),

        // Version value in dependencies - can be literal or macro-based
        // Examples: 1.0.0, %{version}, %{version}-%{release}
        _dependency_version_value: ($) =>
            choice(
                $._dependency_version_concatenation, // %{version}-%{release}
                alias($.dependency_version, $.version), // literal: 1.0.0-1.fc35
                $.macro_expansion, // %{version}
                $.macro_simple_expansion // %version
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
        dependency_comparison_operator: (_) =>
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
        // Can be a regular dependency or a nested boolean expression
        _boolean_operand: ($) =>
            prec(
                PREC.boolean_operand,
                choice(
                    $.dependency,
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
                            $.subpackage_name // Package name (stops at whitespace)
                        )
                    ),
                    optional($.text), // Optional inline text on same line
                    token.immediate(NEWLINE),
                    optional($.text) // Optional multi-line text
                )
            ),

        // Subpackage name for section headers (-n option)
        // Used by %description, %package, %files, etc. to reference subpackages
        // Can be a word, macro, or immediate concatenation (no spaces)
        // Examples: devel, %{crate}, %{name}-libs
        subpackage_name: ($) =>
            prec.left(
                seq(
                    choice($.word, $.macro_simple_expansion, $.macro_expansion),
                    repeat(
                        choice(
                            token.immediate(/[a-zA-Z0-9_-]+/),
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    )
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Preamble Sub-Sections (%sourcelist, %patchlist)
        ///////////////////////////////////////////////////////////////////////

        // %sourcelist section: list of source files, one per line
        // Handled like unnumbered Source tags
        // Example:
        //   %sourcelist
        //   https://example.com/foo-1.0.tar.gz
        //   https://example.com/foo-data-1.0.zip
        sourcelist: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%sourcelist', NEWLINE)), $.section_name),
                    optional($._url_or_file_list)
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
                    alias(token(seq('%patchlist', NEWLINE)), $.section_name),
                    optional($._url_or_file_list)
                )
            ),

        // URL or file path - reusable for Source:, Patch:, %sourcelist, %patchlist
        _url_or_file: ($) =>
            choice(
                alias($.url_with_macro, $.url),
                alias($.path_with_macro, $.file)
            ),

        // List of URLs or file paths, one per line
        // Used by %sourcelist and %patchlist
        _url_or_file_list: ($) => repeat1(seq($._url_or_file, NEWLINE)),

        ///////////////////////////////////////////////////////////////////////
        // Preamble Sub-Sections (%package)
        ///////////////////////////////////////////////////////////////////////

        package: ($) =>
            prec.right(
                seq(
                    alias('%package', $.section_name),
                    optional('-n'),
                    $.subpackage_name,
                    token.immediate(NEWLINE),
                    repeat1($.preamble)
                )
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

        // Shell block: executable shell script content in scriptlets
        // Can contain shell commands, macro expansions, and conditional blocks
        // Right precedence allows greedy matching of script content
        // Uses shell_content instead of string for permissive shell parsing
        shell_block: ($) =>
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
                        $.macro_expansion, // %{...}
                        $.macro_simple_expansion, // %name
                        $.macro_shell_expansion, // %(shell)
                        $.macro_expression, // %[expr]
                        $.shell_content // Raw shell text (no prec needed)
                    )
                )
            ),

        // Scriptlet augment option: -a (append) or -p (prepend)
        // Since rpm >= 4.20, scriptlets can be augmented with -a or -p
        scriptlet_augment_option: (_) => choice('-a', '-p'),

        // Build scriptlets - all support -a (append) and -p (prepend) options since rpm >= 4.20
        // %prep: prepare source code for building (extract sources, apply patches)
        prep_scriptlet: buildScriptlet('prep'),
        // %generate_buildrequires: dynamically determine build dependencies
        generate_buildrequires: buildScriptlet('generate_buildrequires'),
        // %conf: configure build environment (deprecated, use %build)
        conf_scriptlet: buildScriptlet('conf'),
        // %build: compile and build the software
        build_scriptlet: buildScriptlet('build'),
        // %install: install software into build root
        install_scriptlet: buildScriptlet('install'),
        // %check: run test suite
        check_scriptlet: buildScriptlet('check'),
        // %clean: clean up build artifacts (deprecated)
        clean_scriptlet: buildScriptlet('clean'),

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

        // Runtime scriptlet: scripts executed during package lifecycle
        // Can specify subpackage with -n option
        // Contains shell commands for system integration
        runtime_scriptlet: ($) =>
            prec.right(
                seq(
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
                    optional(seq(optional('-n'), $.subpackage_name)), // Optional subpackage name
                    token.immediate(NEWLINE),
                    optional($.shell_block) // Shell commands to execute
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
                    optional(field('interpreter', $.trigger_interpreter)),
                    optional(field('condition', $.trigger_condition)),
                    token.immediate(NEWLINE),
                    optional($.shell_block)
                )
            ),

        // Trigger subpackage: [-n] <name>
        trigger_subpackage: ($) => seq(optional('-n'), $.subpackage_name),

        // Trigger interpreter: -p <program>
        trigger_interpreter: ($) => seq('-p', $._literal),

        // Trigger condition: -- <dependency_list>
        trigger_condition: ($) => seq('--', $.dependency_list),

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
                    optional(field('interpreter', $.trigger_interpreter)),
                    optional(field('priority', $.file_trigger_priority)),
                    optional(field('paths', $.file_trigger_paths)),
                    token.immediate(NEWLINE),
                    optional($.shell_block)
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
                            $.subpackage_name // Subpackage name
                        )
                    ),
                    optional(seq('-f', alias($.path_with_macro, $.path))), // Read file list from file
                    token.immediate(NEWLINE),
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
                token.immediate(NEWLINE)
            ),

        // File qualifiers: specify file type and handling behavior
        // These affect how RPM treats the file during install/upgrade
        file_qualifier: ($) =>
            seq(
                choice(
                    '%artifact', // Build artifact (build system metadata)
                    $.caps_qualifier, // %caps(capabilities) - POSIX capabilities
                    $.config_qualifier, // %config or %config(noreplace) etc.
                    '%dir', // Directory (created if missing)
                    '%doc', // Documentation file
                    '%docdir', // Documentation directory
                    '%ghost', // Ghost file (not in package, but owned)
                    '%license', // License file
                    '%missingok', // OK if file is missing at install
                    '%readme', // README file
                    $.verify // Custom verification attributes
                ),
                token.immediate(BLANK) // Required whitespace after qualifier
            ),

        // %caps directive: set POSIX.1e capabilities on the file
        // Format: %caps(<capability_text>)
        // Example: %caps(cap_net_raw=p) %{_bindir}/foo
        caps_qualifier: ($) =>
            seq('%caps', token.immediate('('), /[^)]+/, token.immediate(')')),

        // %config directive with optional arguments
        // Forms: %config, %config(noreplace), %config(missingok), %config(noreplace,missingok)
        config_qualifier: ($) =>
            seq(
                '%config',
                optional(
                    seq(
                        token.immediate('('),
                        $.config_option,
                        repeat(seq(',', $.config_option)),
                        ')'
                    )
                )
            ),

        // Options for %config directive
        config_option: (_) => choice('noreplace', 'missingok'),

        // File entry: individual file with optional attributes and qualifiers
        // Can specify custom permissions, file type, and path
        file: ($) =>
            seq(
                optional($.attr), // Custom file attributes
                repeat($.file_qualifier), // File type qualifiers (can have multiple, e.g., %ghost %dir)
                repeat1(alias($.file_path, $.path)), // One or more file paths
                token.immediate(NEWLINE) // Must end with newline
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
                        $.macro_expansion
                    ),
                    repeat(
                        choice(
                            // Literal segment must be immediately adjacent
                            token.immediate(/[^\s"{}%]+/),
                            // Macros naturally attach (start with %)
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    )
                )
            ),

        // File attributes: custom permissions for individual files
        // Format: %attr(<mode>, <user>, <group>) <file|directory>
        // Any parameter can be '-' to use current default
        attr: ($) =>
            seq(
                '%attr',
                '(',
                choice('-', /[0-9]+/), // File mode (octal) or '-'
                ',',
                choice('-', /[a-zA-Z0-9_]+/), // User name or '-'
                ',',
                choice('-', /[a-zA-Z0-9_]+/), // Group name or '-'
                ')',
                token.immediate(BLANK) // Required whitespace before filename
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
                alias(token(seq('%changelog', NEWLINE)), $.section_name),
                repeat($.changelog_entry)
            ),

        // * Tue May 31 2016 Adam Miller <maxamillion@fedoraproject.org> - 0.1-1
        // * Fri Jun 21 2002 Bob Marley <marley@redhat.com>

        changelog_entry: ($) =>
            seq(
                '*',
                $.string_content,
                NEWLINE,
                repeat(seq('-', $.string, NEWLINE))
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
                        field('argument', alias($.setup_flag, $.macro_option)),
                        // Source options: -a N, -b N
                        field(
                            'argument',
                            alias($.setup_source_option, $.macro_option)
                        ),
                        // Name option: -n DIR
                        field(
                            'argument',
                            alias($.setup_name_option, $.macro_option)
                        )
                    )
                ),
                NEWLINE
            ),

        // Simple setup flags (no parameters)
        setup_flag: ($) =>
            seq(
                '-',
                choice(
                    'c', // Create build directory and change to it
                    'C', // Create build directory, unpack, strip top-level if exists
                    'D', // Do not delete build directory before unpacking
                    'T', // Skip default unpacking of first source
                    'q' // Operate quietly
                )
            ),

        // Setup options that take a source number parameter
        setup_source_option: ($) =>
            seq(
                '-',
                choice('a', 'b'), // -a: unpack after cd, -b: unpack before cd
                field('number', $.integer)
            ),

        // Setup name option that takes a directory name
        setup_name_option: ($) =>
            seq(
                '-',
                'n', // Set name of build directory
                field(
                    'directory',
                    choice(
                        alias($._setup_directory, $.concatenation),
                        $._primary_expression
                    )
                )
            ),

        // Directory concatenation for setup/autosetup -n option
        // Handles hyphen-connected parts like %{crate}-%{version}
        // token.immediate('-') ensures hyphen binds tightly to preceding token
        _setup_directory: ($) =>
            seq(
                $._primary_expression,
                repeat1(seq(token.immediate('-'), $._primary_expression))
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
                            alias($.autosetup_flag, $.macro_option)
                        ),
                        // Source: -a N
                        field(
                            'argument',
                            alias($.autosetup_source_option, $.macro_option)
                        ),
                        // Name: -n DIR
                        field(
                            'argument',
                            alias($.autosetup_name_option, $.macro_option)
                        ),
                        // Patch: -p N
                        field(
                            'argument',
                            alias($.autosetup_patch_option, $.macro_option)
                        ),
                        // VCS: -S <vcs>
                        field(
                            'argument',
                            alias($.autosetup_vcs_option, $.macro_option)
                        )
                    )
                ),
                NEWLINE
            ),

        // Autosetup flags (no parameters)
        autosetup_flag: ($) =>
            seq(
                '-',
                choice(
                    'v', // Verbose operation
                    'N', // Disable automatic patch application
                    'c', // Create build directory before unpacking
                    'C', // Create build directory, strip top-level
                    'D', // Do not delete build directory
                    'T', // Skip default unpacking of first source
                    'b' // Backup (accepted but ignored)
                )
            ),

        // Autosetup source option: -a N
        autosetup_source_option: ($) =>
            seq('-', 'a', field('number', $.integer)),

        // Autosetup name option: -n DIR
        autosetup_name_option: ($) =>
            seq(
                '-',
                'n',
                field(
                    'directory',
                    choice(
                        alias($._setup_directory, $.concatenation),
                        $._primary_expression
                    )
                )
            ),

        // Autosetup patch option: -p N
        autosetup_patch_option: ($) =>
            choice(
                token(seq('-', 'p', /[0-9]+/)), // -p1
                seq('-', 'p', field('value', $.integer)) // -p 1
            ),

        // Autosetup VCS option: -S <vcs>
        autosetup_vcs_option: ($) =>
            seq(
                '-',
                'S',
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
                            alias($.autopatch_flag, $.macro_option)
                        ),
                        // Number: -p N, -m N, -M N
                        field(
                            'argument',
                            alias($.autopatch_number_option, $.macro_option)
                        ),
                        // Positional patch numbers
                        alias($.autopatch_argument, $.macro_argument)
                    )
                ),
                NEWLINE
            ),

        // Autopatch flags (no parameters)
        autopatch_flag: ($) => seq('-', choice('v', 'q')),

        // Autopatch options that take a number parameter
        autopatch_number_option: ($) =>
            choice(
                // Immediate format: -p1, -m100, -M400
                token(seq('-', choice('p', 'm', 'M'), /[0-9]+/)),
                // Spaced format: -p 1, -m 100, -M 400
                seq('-', choice('p', 'm', 'M'), field('value', $.integer))
            ),

        // Autopatch arguments: positional patch numbers
        autopatch_argument: ($) => $.integer,

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
                                alias($.patch_option_flag, $.macro_option)
                            ),
                            // Number options: -F N, -p N, -P N
                            field(
                                'argument',
                                alias($.patch_option_number, $.macro_option)
                            ),
                            // String options: -b SUF, -d DIR, -o FILE, -z SUF
                            field(
                                'argument',
                                alias($.patch_option_string, $.macro_option)
                            ),
                            // Positional patch numbers
                            alias($.patch_argument, $.macro_argument)
                        )
                    ),
                    NEWLINE
                )
            ),

        // Patch arguments: positional patch numbers
        patch_argument: ($) => $.integer,

        // Patch option flags (no parameters)
        patch_option_flag: ($) =>
            seq(
                '-',
                choice(
                    'E', // Remove files emptied by patching
                    'R', // Assume reversed patch
                    'Z' // Set mtime and atime from context diff headers using UTC
                )
            ),

        // Patch options that take a number parameter
        patch_option_number: ($) =>
            choice(
                // Immediate format: -p1, -F3, -P2
                token(seq('-', choice('F', 'p', 'P'), /[0-9]+/)),
                // Spaced format: -p 1, -F 3, -P 2
                seq('-', choice('F', 'p', 'P'), field('value', $.integer))
            ),

        // Patch options that take a string parameter
        patch_option_string: ($) =>
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
            seq('v', token.immediate('"'), $.quoted_string_content, '"'),

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
                        optional(/[a-zA-Z0-9+._~]+/), // Optional version suffix (patch, pre-release, etc.)
                        optional(seq('-', /[0-9]+[a-zA-Z0-9+._~]*/)) // Optional release: -release (must start with digit)
                    )
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
                    seq(
                        choice(
                            seq(optional('%'), $.text_content), // Raw text (% is literal)
                            $.macro_simple_expansion, // %macro
                            $.macro_expansion // %{macro}
                        )
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
        macro_body_text: ($) =>
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
        // Does not include quotes, backslashes, or newlines
        string_content: (_) => token(prec(-1, /([^%\\\r\n])+/)),

        // Shell content: permissive raw text for shell script sections
        // Stops at: %, newline
        // Includes: quotes, backslashes, !, etc. - anything valid in shell
        // Used in shell_block for %prep, %build, %install, etc.
        shell_content: (_) => token(prec(-1, /[^%\r\n]+/)),

        // Quoted strings: explicit string literals with macro expansion
        // Allows macro expansion within quotes: "prefix-%{version}-suffix"
        // Used when whitespace or special characters need to be preserved
        quoted_string: ($) =>
            seq(
                '"', // Opening quote
                repeat(
                    choice(
                        $.macro_expansion, // %{macro} inside quotes
                        $.quoted_string_content // Literal text
                    )
                ),
                '"' // Closing quote
            ),

        // Quoted string content: literal text within quotes
        // Includes escaped quotes (\") and other escape sequences
        // Excludes unescaped quotes, macro delimiters, and line breaks
        quoted_string_content: (_) => token(prec(-1, /([^"%\\\r\n]|\\.)+/)),

        // Word tokens: unquoted identifiers and simple values
        // Excludes whitespace and special characters that have syntactic meaning
        // Used for simple identifiers, paths, and unquoted string values
        word: ($) => token(/([^\s"#%{}()<>|&\\])+/),

        // Macro value text: raw text content in macro definitions
        // More permissive than 'word' - allows ();<>|& etc.
        // Only stops at: whitespace, %, {, }, #, ", \, or newlines
        // Used for macro values like: %global elf_bits (64bit)
        macro_value_text: (_) => token(prec(-1, /[^\s%{}#"\\]+/)),

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
