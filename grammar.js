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

    // Grammar conflicts resolution
    conflicts: ($) => [
        [$.shell_block, $.string],
        [$.macro_expansion_call],
        [$._macro_expansion_call_nested],
    ],

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

    // Inline rules are flattened in the parse tree to reduce nesting
    // This improves the tree structure for syntax highlighting and analysis
    inline: ($) => [
        $._simple_statements, // Flatten statement types
        $._compound_statements, // Flatten compound statement types
        $._conditional_block, // Flatten conditional block contents
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
                $.setup_macro, // %setup with specific option support
                $.patch_macro, // %patch with specific option support
                $.macro_expansion, // %{name}, %name
                $.macro_expansion_call, // %name [options] [args] - standalone statement
                $.macro_simple_expansion, // %name - simple expansion
                $.macro_shell_expansion, // %(shell command)
                $.preamble, // Name:, Version:, etc.
                $.description, // %description section
                $.package, // %package subsection
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
                seq(
                    '\\',
                    choice(
                        seq(optional('\r'), '\n'), // Backslash-newline
                        '\0' // Backslash-null (rare)
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
                    $.parenthesized_expression, // (expr)
                    $.macro_simple_expansion, // %name
                    $.macro_expansion, // %{name}
                    $.macro_shell_expansion // %(shell command)
                    // $.macro_expression // %[expression]
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

        //// Macro Escaping: %%{name}
        // TODO FIXME Not so important
        //
        // macro_escaped: ($) =>
        //     prec(10, choice(
        //         seq('%%{', alias($.macro_name, $.identifier), '}'), // %%{name}
        //         seq('%%', alias($.macro_name, $.identifier)) // %%name
        //     )),

        //// Simple Macro Expansion: %name
        //
        // The simplest form of macro expansion, directly substituting %name with its value
        // Supports optional negation operator (!) and special variables
        macro_simple_expansion: ($) =>
            seq(
                '%',
                choice(
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        alias($.macro_name, $.identifier)
                    ),
                    $.conditional_expansion,
                    $._special_macro_name
                )
            ),

        // Special macro variables for RPM scriptlets and build context
        // %* - all arguments, %** - all arguments quoted, %# - argument count
        // %0, %1, %2... - positional arguments, %nil - empty value
        _special_macro_name: ($) =>
            alias(
                choice('*', '**', '#', /[0-9]+/, 'nil'),
                $.special_variable_name
            ),

        // Built-in RPM macros providing utility functions and system information
        // These are predefined macros available in all RPM builds
        builtin: ($) =>
            choice(
                $.macro_source,
                $.macro_patch,
                'basename',
                'dirname',
                'dnl',
                'dump',
                'echo',
                'error',
                'exists',
                'expand',
                'expr',
                'getdirconf',
                'getenv',
                'getncpus',
                'gsub',
                'len',
                'load',
                'lower',
                'lua',
                'macrobody',
                'quote',
                'rep',
                'reverse',
                'rpmversion',
                'shrink',
                'sub',
                'suffix',
                'trace',
                'u2p',
                'shescape',
                'uncompress',
                'upper',
                'url2path',
                'verbose',
                'warn'
            ),

        macro_source: ($) =>
            choice(token(prec(1, /SOURCE[0-9]+/)), token(prec(1, /S[0-9]+/))),

        macro_patch: ($) =>
            choice(token(prec(1, /PATCH[0-9]+/)), token(prec(1, /P[0-9]+/))),

        macro_define: ($) => choice('define', 'global'),

        macro_undefine: ($) => 'undefine',

        //// Parametric Macro Expansion: %macro_name [options] [arguments]
        //
        // Expands parametric/built-in macros with options and arguments
        // Syntax: %NAME [OPTIONS] [ARGUMENTS]
        // Arguments parsed up to string end or next newline
        //
        // Examples: %dirname -x /path/to/file, %basename /some/path, %configure --prefix=/usr
        //
        // TODO: Add support for %-f format specifiers
        macro_expansion_call: ($) =>
            seq(
                '%',
                choice(
                    // Builtin macros without arguments
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        $.builtin,
                        token.immediate(NEWLINE)
                    ),
                    // Builtin macros with arguments - require space after builtin
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        $.builtin,
                        token.immediate(/\s+/),
                        repeat1(
                            choice(
                                field('option', $.macro_option),
                                field('argument', $._macro_argument)
                            )
                        )
                    ),
                    // Regular macros with arguments
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        alias($.macro_name, $.identifier),
                        token.immediate(/\s+/),
                        repeat1(
                            choice(
                                field('option', $.macro_option),
                                field('argument', $._macro_argument)
                            )
                        ),
                        token.immediate(NEWLINE)
                    ),
                    // Standalone macro names followed by newline (higher precedence than simple expansion)
                    prec(
                        1,
                        seq(
                            optional(field('operator', token.immediate('!'))),
                            alias($.macro_name, $.identifier),
                            token.immediate(NEWLINE)
                        )
                    )
                )
            ),

        // Macro calls within braces (like conditional expansions)
        _macro_expansion_call_nested: ($) =>
            seq(
                '%',
                choice(
                    // Builtin macros with arguments
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        $.builtin,
                        token.immediate(/\s+/),
                        repeat1(
                            choice(
                                field('option', $.macro_option),
                                field('argument', $._macro_argument)
                            )
                        )
                    ),
                    // Regular macros with arguments
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        alias($.macro_name, $.identifier),
                        token.immediate(/\s+/),
                        repeat1(
                            choice(
                                field('option', $.macro_option),
                                field('argument', $._macro_argument)
                            )
                        )
                    )
                )
            ),

        // Macro options: short options with optional values
        // Supports: -x, -p VALUE, --long-option=VALUE
        macro_option: ($) =>
            prec.left(
                choice(
                    // Short option with immediate value: -p1
                    token(seq('-', /[a-zA-Z]/, /[a-zA-Z0-9_-]+/)),
                    // Short option without value: -x
                    token(seq('-', /[a-zA-Z]/)),
                    // Long option with equals: --option=value
                    seq(
                        '--',
                        /[a-zA-Z][a-zA-Z0-9_-]*/,
                        '=',
                        field('value', $._macro_argument)
                    )
                    // Separator: --
                    // TODO: This doesn't work yet
                    // token('--')
                )
            ),

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
                // %{<builtin>:<argument>}
                seq($.builtin, ':', field('argument', $._literal)),
                // %{<builtin> [options] [arguments]} - parametric expansion within braces
                seq(
                    $.builtin,
                    repeat1(
                        choice(
                            field('option', $.macro_option),
                            field('argument', $._macro_argument)
                        )
                    )
                ),
                // %{<builtin>} - standalone builtin without arguments
                $.builtin,
                // %{<name>}
                seq(
                    optional(field('operator', token.immediate('!'))),
                    choice(
                        alias($.macro_name, $.identifier),
                        $._special_macro_name
                    ),
                    optional(seq(optional(':'), $.string))
                ),
                // %{<name> <argument>}
                seq(
                    alias($.macro_name, $.identifier),
                    repeat1(field('argument', $._literal))
                ),
                // %{?<name>:<consequence>}
                $.conditional_expansion
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
                    optional(field('operator', token.immediate('!'))),
                    '?',
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
                                    alias(
                                        $._macro_expansion_call_nested,
                                        $.macro_expansion_call
                                    ),
                                    $.macro_expansion,
                                    $.text
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
                    field('value', $._body)
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
                    $.macro_expansion_call,
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
        // TODO Postpone this till the rest works. You don't see them often.
        // macro_expression: ($) => seq('%[', $._macro_expression_body, ']'),

        // Macro expression body: expressions allowed within macro expressions
        // Includes arithmetic operators that are only allowed in macro contexts
        // _macro_expression_body: ($) =>
        //     choice(
        //         $.arithmetic_operator, // +, -, *, / (only in macro expressions)
        //         $.comparison_operator, // <, <=, ==, !=, >=, >
        //         $.not_operator, // !
        //         $.boolean_operator, // &&, ||, and, or
        //         $.with_operator, // %{with feature}
        //         $.defined_operator, // %{defined macro}
        //         $._primary_expression // literals, macros, etc.
        //     ),

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
        shell_command: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion, // %name
                    $.macro_expansion, // %{name}
                    $.shell_code, // Raw shell text including spaces, pipes, quotes
                    alias($.shell_command_parentheses, $.shell_code) // Balanced parentheses
                )
            ),

        // Raw shell command text - matches everything except % and unbalanced )
        shell_code: (_) => token(prec(-1, /[^%()]+/)),

        // Balanced parentheses within shell commands
        shell_command_parentheses: ($) =>
            seq(
                '(',
                repeat(
                    choice(
                        $.macro_simple_expansion,
                        $.macro_expansion,
                        $.shell_code,
                        alias($.shell_command_parentheses, $.shell_code)
                    )
                ),
                ')'
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

        // Arithmetic operators: standard mathematical operations
        // Implements proper precedence: *, / before +, -
        // All operators are left-associative
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
                            field('left', $._primary_expression),
                            field('operator', operator),
                            field('right', $._primary_expression)
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

        _conditional_block: ($) =>
            repeat1(
                choice(
                    prec(-1, $._simple_statements),
                    $._compound_statements,
                    $.defattr,
                    $.file
                )
            ),

        // %if
        if_statement: ($) =>
            seq(
                '%if',
                field('condition', $.expression),
                token.immediate(NEWLINE),
                optional(field('consequence', $._conditional_block)),
                repeat(field('alternative', $.elif_clause)),
                optional(field('alternative', $.else_clause)),
                '%endif',
                token.immediate(NEWLINE)
            ),

        elif_clause: ($) =>
            seq(
                '%elif',
                field('condition', $.expression),
                token.immediate(NEWLINE),
                field('consequence', $._conditional_block)
            ),

        else_clause: ($) =>
            seq(
                '%else',
                token.immediate(NEWLINE),
                field('body', $._conditional_block)
            ),

        // %ifarch
        arch: ($) => repeat1(choice($.macro_expansion, $.identifier)),

        ifarch_statement: ($) =>
            seq(
                choice('%ifarch', '%ifnarch'),
                field('condition', $.arch),
                token.immediate(NEWLINE),
                optional(field('consequence', $._conditional_block)),
                repeat(field('alternative', $.elifarch_clause)),
                optional(field('alternative', $.else_clause)),
                '%endif',
                token.immediate(NEWLINE)
            ),

        elifarch_clause: ($) =>
            seq(
                '%elifarch',
                optional(field('condition', $._literal)),
                token.immediate(NEWLINE),
                field('consequence', $._conditional_block)
            ),

        // %ifos
        os: ($) => repeat1(choice($.macro_expansion, $.identifier)),

        ifos_statement: ($) =>
            seq(
                choice('%ifos', '%ifnos'),
                field('condition', $.os),
                token.immediate(NEWLINE),
                optional(field('consequence', $._conditional_block)),
                repeat(field('alternative', $.elifos_clause)),
                optional(field('alternative', $.else_clause)),
                '%endif',
                token.immediate(NEWLINE)
            ),

        elifos_clause: ($) =>
            seq(
                '%elifos',
                optional(field('consequence', $._literal)),
                token.immediate(NEWLINE),
                field('consequence', $._conditional_block)
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
                // Regular tags (Source, Name, etc.) - only support literals
                seq(
                    $.tag, // Tag name
                    token.immediate(/:( |\t)*/), // Colon separator with optional whitespace
                    field('value', $._literal), // Simple values (can contain macros)
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
                'URL', // Project homepage URL
                'Url', // Alternative spelling of URL
                'BugUrl', // Bug reporting URL
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
                'NoSource', // Exclude sources from SRPM
                /Patch\d*/, // Patch files: Patch0, Patch1, etc.
                /Source\d*/ // Source files: Source0, Source1, etc.
            ),

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
        dependency_qualifier_suffix: ($) =>
            seq(
                token.immediate('('),
                choice(
                    $.identifier, // Simple identifier: Carp, pytest
                    $.word // Allows hyphens: x86-64
                ),
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

        description: ($) =>
            prec.right(
                seq(
                    alias('%description', $.section_name),
                    optional(seq(optional('-n'), $._literal)),
                    token.immediate(NEWLINE),
                    optional($.text)
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Preamble Sub-Sections (%package)
        ///////////////////////////////////////////////////////////////////////

        package: ($) =>
            prec.right(
                seq(
                    alias('%package', $.section_name),
                    optional('-n'),
                    $._literal,
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
        shell_block: ($) =>
            prec.right(
                repeat1(
                    choice(
                        $._compound_statements, // Conditional blocks (%if, %ifarch)
                        $.macro_expansion, // Macro expansions %{...}
                        $.macro_definition, // Inline %define statements
                        $.macro_undefinition, // Inline %undefine statements
                        $.setup_macro, // %setup with specific option support
                        $.patch_macro, // %patch with specific option support
                        $.macro_expansion_call, // %name [options] [args] - higher precedence when has args
                        $.macro_simple_expansion, // %name - simple expansion
                        prec(-1, $.string) // Raw shell command text
                    )
                )
            ),

        // %prep scriptlet: prepare source code for building
        // Typically contains %setup (extract sources) and %patch (apply patches)
        // First scriptlet executed in build process
        prep_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%prep', NEWLINE)), $.section_name),
                    optional($.shell_block) // Shell commands for source preparation
                )
            ),

        // %generate_buildrequires scriptlet: dynamically determine build dependencies
        // Executes before main build, outputs additional BuildRequires to stdout
        // Used for language-specific dependency resolution (pip, npm, etc.)
        generate_buildrequires: ($) =>
            prec.right(
                seq(
                    alias(
                        token(seq('%generate_buildrequires', NEWLINE)),
                        $.section_name
                    ),
                    optional($.shell_block) // Commands to determine dependencies
                )
            ),

        // %conf scriptlet: configure build environment (deprecated)
        // Historically used for autotools configuration
        // Modern specs typically use %build for configuration
        conf_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%conf', NEWLINE)), $.section_name),
                    optional($.shell_block) // Configuration commands
                )
            ),

        // %build scriptlet: compile and build the software
        // Contains commands to configure, compile, and prepare software
        // Common macros: %configure, %make_build, %cmake_build
        build_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%build', NEWLINE)), $.section_name),
                    optional($.shell_block) // Build commands
                )
            ),

        // %install scriptlet: install software into build root
        // Installs files to %{buildroot} directory structure
        // Common macros: %make_install, %cmake_install
        install_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%install', NEWLINE)), $.section_name),
                    optional($.shell_block) // Installation commands
                )
            ),

        // %check scriptlet: run test suite
        // Executes after %install to validate the build
        // Can be disabled with --nocheck rpmbuild option
        check_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%check', NEWLINE)), $.section_name),
                    optional($.shell_block) // Test commands
                )
            ),

        // %clean scriptlet: clean up build artifacts (deprecated)
        // Historically used to remove %{buildroot} after build
        // Modern RPM automatically cleans build root
        clean_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%clean', NEWLINE)), $.section_name),
                    optional($.shell_block) // Cleanup commands
                )
            ),

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
                    optional(seq(optional('-n'), $._literal)), // Optional subpackage name
                    token.immediate(NEWLINE),
                    optional($.shell_block) // Shell commands to execute
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Triggers (%triggerin, %triggerun, ...)
        ///////////////////////////////////////////////////////////////////////

        trigger: ($) =>
            prec.right(
                seq(
                    choice(
                        '%triggerprein',
                        '%triggerin',
                        '%triggerun',
                        '%triggerpostun'
                    ),
                    optional(seq(optional('-n'), $._literal)),
                    token.immediate(NEWLINE),
                    optional($.shell_block)
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // File triggers (%filetriggerin, %filetriggerun, ...)
        ///////////////////////////////////////////////////////////////////////

        file_trigger: ($) =>
            prec.right(
                seq(
                    choice(
                        '%filetriggerin',
                        '%filetriggerun',
                        '%filetriggerpostun',
                        '%transfiletriggerin',
                        '%transfiletriggerun',
                        '%transfiletriggerpostun'
                    ),
                    optional(seq(optional('-n'), $._literal)),
                    token.immediate(NEWLINE),
                    optional($.shell_block)
                )
            ),

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
                        choice(
                            $._literal, // Subpackage name
                            seq('-n', $._literal) // Explicit subpackage name
                        )
                    ),
                    optional(seq('-f', $._literal)), // Read file list from file
                    token.immediate(NEWLINE),
                    repeat(
                        choice(
                            $._compound_statements, // Conditional file inclusion
                            $.defattr, // Default file attributes
                            $.file // Individual file entries
                        )
                    )
                )
            ),

        // Default file attributes: sets default permissions for all files
        // Format: %defattr(mode, user, group, dirmode)
        // Use '-' to keep existing permissions
        // Example:
        // %defattr(-,root,root,-) sets root ownership, preserves permissions
        defattr: ($) =>
            seq(
                '%defattr',
                '(',
                choice('-', /[0-9]+/), // File mode (octal) or '-' for default
                ',',
                /[a-zA-Z]+/, // User name
                ',',
                /[a-zA-Z]+/, // Group name
                ')',
                token.immediate(NEWLINE)
            ),

        // File qualifiers: specify file type and handling behavior
        // These affect how RPM treats the file during install/upgrade
        file_qualifier: ($) =>
            seq(
                choice(
                    '%artifact', // Build artifact (build system metadata)
                    '%config', // Configuration file (preserved on upgrade)
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

        // File entry: individual file with optional attributes and qualifiers
        // Can specify custom permissions, file type, and path
        file: ($) =>
            seq(
                optional($.attr), // Custom file attributes
                optional($.file_qualifier), // File type qualifier
                $.string, // File path (can contain macros)
                token.immediate(NEWLINE) // Must end with newline
            ),

        // File attributes: custom permissions for individual files
        // Format: %attr(mode, user, group) filepath
        // Use '-' to inherit from %defattr or filesystem defaults
        attr: ($) =>
            seq(
                '%attr',
                '(',
                choice('-', /[0-9]+/), // File mode (octal) or '-'
                ',',
                /[a-zA-Z]+/, // User name
                ',',
                /[a-zA-Z]+/, // Group name
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
                        'filedigest', // File checksum verification
                        'group', // Group ownership
                        'maj', // Major device number
                        'md5', // MD5 checksum (deprecated)
                        'mode', // File permissions
                        'min', // Minor device number
                        'mtime', // Modification time
                        'not', // Negation modifier
                        'owner', // User ownership
                        'size', // File size
                        'symlink' // Symbolic link target
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
                        field('argument', $.setup_flag), // Simple flags: -c, -C, -D, -T, -q
                        field('argument', $.setup_source_option), // Source options: -a N, -b N
                        field('argument', $.setup_name_option) // Name option: -n DIR
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
                field('directory', $._primary_expression)
            ),

        ///////////////////////////////////////////////////////////////////////
        // Legacy patch token for %patch0, %patch1 etc.
        patch_legacy_token: ($) =>
            seq(alias(token(prec(2, /patch[0-9]+/)), $.builtin)),

        // %patch macro: patch application with comprehensive option support
        // Syntax: %patch [number] [options] or %patch [options]
        // Supports modern (%patch 1, %patch -P1) and legacy (%patch0) syntax
        patch_macro: ($) =>
            prec(
                1,
                seq(
                    '%',
                    choice(
                        // Legacy syntax: %patch0, %patch1, etc. (direct number attachment)
                        $.patch_legacy_token,
                        // Modern syntax: %patch [optional number]
                        seq(
                            alias('patch', $.builtin),
                            optional(field('patch_number', $.integer))
                        )
                    ),
                    repeat(
                        choice(
                            $.patch_flag, // Simple flags: -E, -R, -Z
                            $.patch_number_option, // Number options: -F N, -p N, -P N
                            $.patch_string_option, // String options: -b SUF, -z SUF, -o FILE
                            $.patch_long_option // Long options: --fuzz=N, --backup=SUF
                        )
                    ),
                    NEWLINE
                )
            ),

        // Simple patch flags (no parameters)
        patch_flag: ($) =>
            seq(
                '-',
                choice(
                    'E', // Remove files emptied by patching
                    'R', // Assume reversed patch
                    'Z' // Set mtime and atime from context diff headers using UTC
                )
            ),

        // Patch options that take a number parameter
        patch_number_option: ($) =>
            choice(
                // Immediate format: -p1, -F3, -P2
                token(seq('-', choice('F', 'p', 'P'), /[0-9]+/)),
                // Spaced format: -p 1, -F 3, -P 2
                seq('-', choice('F', 'p', 'P'), field('value', $.integer))
            ),

        // Patch options that take a string parameter
        patch_string_option: ($) =>
            seq(
                '-',
                choice(
                    'b', // Backup with suffix
                    'z', // Same as -b
                    'o' // Send output to file
                ),
                field('value', $._primary_expression)
            ),

        // Long patch options: --option=value format
        patch_long_option: ($) =>
            seq(
                '--',
                choice(
                    seq('fuzz', '=', field('value', $.integer)), // --fuzz=N
                    seq('backup', '=', field('value', $._primary_expression)) // --backup=SUF
                )
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
