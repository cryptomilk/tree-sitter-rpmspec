/**
 * @file RPM-aware Bash grammar for tree-sitter
 * @author Andreas Schneider <asn@cryptomilk.org>
 * @license MIT
 *
 * This grammar extends tree-sitter-bash with RPM macro recognition.
 * RPM macros like %{name} are recognized so they don't break bash parsing.
 * The internal content of macros is delegated to rpmspec via injection.parent.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const Bash = require('tree-sitter-bash/grammar');

// Characters that break words - same as bash plus '%' for RPM macros
const SPECIAL_CHARACTERS = [
    "'",
    '"',
    '<',
    '>',
    '{',
    '}',
    '\\[',
    '\\]',
    '(',
    ')',
    '`',
    '$',
    '%', // Added for RPM macros
    '|',
    '&',
    ';',
    '\\',
    '\\s',
];

/**
 * Returns a regex matching any character except the ones provided.
 */
function noneOf(...characters) {
    const negatedString = characters
        .map((c) => (c == '\\' ? '\\\\' : c))
        .join('');
    return new RegExp('[^' + negatedString + ']');
}

module.exports = grammar(Bash, {
    name: 'rpmbash',

    // Add RPM conditionals as extras - allows them to appear anywhere
    // without breaking parse structure (like comments). This is critical
    // for conditionals inside multi-line commands:
    //   ./configure \
    //     --prefix=/usr \
    //   %if %{with ssl}
    //     --with-ssl \
    //   %endif
    //     --disable-gzip
    extras: ($, previous) =>
        previous.concat([$.rpm_conditional, $.rpm_else, $.rpm_endif]),

    rules: {
        // Add RPM macro expansion to concatenation choices
        // This allows %{...} and %name to appear in command arguments
        _primary_expression: ($, previous) =>
            choice($.rpm_macro_expansion, $.rpm_macro_simple, previous),

        // RPM simple expansion: %name (without braces)
        // Requires 2+ chars to avoid conflicts with printf specifiers (%s, %d)
        // Single-char macros must use braces: %{s} not %s
        // Note: scan_newline_before_rpm_statement in scanner.c returns NEWLINE
        // before %global/%define/etc to prevent them from matching here
        rpm_macro_simple: ($) => token(/%[a-zA-Z_][a-zA-Z0-9_]+/),

        // RPM brace expansion: %{...}
        // Only recognize the outer boundaries - internal parsing is delegated
        // to rpmspec via injection.parent
        rpm_macro_expansion: ($) =>
            seq('%{', optional($._rpm_macro_content), '}'),

        // Content inside braces - handles nested %{...}
        // Pattern order: try rpm_macro_expansion first for nested %{...},
        // then match content without braces or %, then handle lone % chars.
        _rpm_macro_content: ($) =>
            repeat1(
                choice(
                    $.rpm_macro_expansion, // Nested macros like %{dirname:%{SOURCE0}}
                    /[^{}%]+/, // Content without braces or %
                    /%/ // Lone % (when not followed by {, which would match above)
                )
            ),

        // Extend command_substitution to include RPM's %(cmd) shell expansion
        // %(cmd) is semantically equivalent to $(cmd) - executes shell command
        // Content inside is parsed as bash statements, not delegated to parent
        command_substitution: ($, previous) =>
            choice(seq('%(', $._statements, ')'), previous),

        // Extend _statement to include RPM macro definitions and special prep macros
        _statement: ($, previous) =>
            choice(
                $.rpm_define,
                $.rpm_global,
                $.rpm_undefine,
                $.rpm_setup,
                $.rpm_autosetup,
                $.rpm_patch,
                $.rpm_autopatch,
                previous
            ),

        // RPM macro definitions - common in scriptlets
        // Structured as keyword + name + body so the body can be handed back
        // to rpmspec for proper macro highlighting (like rpm_conditional).
        // %define name value - define local macro
        rpm_define: ($) =>
            seq(
                $.rpm_define_keyword,
                $.rpm_macro_name,
                optional($.rpm_macro_body)
            ),

        // %global name value - define global macro (persists across scriptlets)
        rpm_global: ($) =>
            seq(
                $.rpm_global_keyword,
                $.rpm_macro_name,
                optional($.rpm_macro_body)
            ),

        // %undefine name - undefine a macro
        rpm_undefine: ($) => seq($.rpm_undefine_keyword, $.rpm_macro_name),

        // Special prep macros - consume entire line and delegate to rpmspec
        // These macros have complex option syntax that rpmspec handles
        // %setup - source unpacking
        rpm_setup: ($) => seq($.rpm_setup_keyword, optional($.rpm_macro_body)),

        // %autosetup - automated source unpacking and patching
        rpm_autosetup: ($) =>
            seq($.rpm_autosetup_keyword, optional($.rpm_macro_body)),

        // %patch - apply patches
        rpm_patch: ($) => seq($.rpm_patch_keyword, optional($.rpm_macro_body)),

        // %autopatch - automated patch application
        rpm_autopatch: ($) =>
            seq($.rpm_autopatch_keyword, optional($.rpm_macro_body)),

        // Keywords with trailing whitespace - tokenized for clear boundaries
        rpm_define_keyword: ($) => token(prec(20, seq('%define', /[ \t]+/))),
        rpm_global_keyword: ($) => token(prec(20, seq('%global', /[ \t]+/))),
        rpm_undefine_keyword: ($) =>
            token(prec(20, seq('%undefine', /[ \t]+/))),

        // Keywords for special prep macros - no trailing whitespace required
        // (arguments are optional)
        rpm_setup_keyword: ($) => token(prec(20, '%setup')),
        rpm_autosetup_keyword: ($) => token(prec(20, '%autosetup')),
        rpm_patch_keyword: ($) => token(prec(20, '%patch')),
        rpm_autopatch_keyword: ($) => token(prec(20, '%autopatch')),

        // Macro name for definitions
        rpm_macro_name: ($) => token(prec(20, /[a-zA-Z_][a-zA-Z0-9_]*/)),

        // Macro body - everything until unescaped end of line
        // Supports line continuation with backslash
        // Content is delegated to rpmspec for full parsing via injection.parent
        // Used by: %define, %global, %setup, %autosetup, %patch, %autopatch
        // Pattern breakdown:
        //   [^\\\n]  - any char except backslash or newline
        //   |\\\n    - OR backslash followed by newline (line continuation)
        //   |\\[^\n] - OR backslash followed by non-newline (escape sequence)
        rpm_macro_body: ($) => token(prec(20, /([^\\\n]|\\\n|\\[^\n])+/)),

        // RPM conditionals with arguments - appear in extras so they don't break
        // multi-line commands. Structured as keyword + condition so the condition
        // can be handed back to rpmspec for proper macro highlighting.
        // Both parts are tokens for clear boundaries (required by extras mechanism).
        rpm_conditional: ($) => seq($.rpm_conditional_keyword, $.rpm_condition),

        // Keywords require whitespace after to avoid matching %iframe as %if + rame.
        rpm_conditional_keyword: ($) =>
            token(
                prec(
                    20,
                    seq(
                        choice(
                            '%if',
                            '%elif',
                            '%ifarch',
                            '%ifnarch',
                            '%ifos',
                            '%ifnos'
                        ),
                        /[ \t]+/
                    )
                )
            ),

        // Condition content - single token matching to end of line.
        // Handed back to rpmspec via injection.parent for macro highlighting.
        // IMPORTANT: Include trailing newline so it doesn't terminate commands
        // when rpm_conditional appears as an extra inside multi-line commands.
        rpm_condition: ($) => token(prec(20, /[^\n]+\n?/)),

        // %else and %endif as grammar rules with high precedence
        // These typically appear on their own line, so we can match them simply
        //
        // Note: %else/%endif will match instead of rpm_macro_simple even in
        // contexts like command arguments. This is fine because:
        // 1. %else/%endif are not valid macro names - they're conditional directives
        // 2. Via injection.parent, rpmspec receives them and highlights correctly
        // 3. %elsewhere would match as %else + where, but that's not valid RPM
        //
        // IMPORTANT: Include trailing newline so it doesn't terminate commands
        // when these appear as extras inside multi-line commands.
        rpm_else: ($) => token(prec(20, /%else\n?/)),
        rpm_endif: ($) => token(prec(20, /%endif\n?/)),

        // Override word to treat '%' as a word-breaking character
        // This allows %name to be recognized within concatenations
        word: ($) =>
            token(
                seq(
                    choice(
                        noneOf('#', ...SPECIAL_CHARACTERS),
                        seq('\\', noneOf('\\s'))
                    ),
                    repeat(
                        choice(
                            noneOf(...SPECIAL_CHARACTERS),
                            seq('\\', noneOf('\\s')),
                            '\\ '
                        )
                    )
                )
            ),
    },
});
