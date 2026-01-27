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

    rules: {
        // Add RPM macro expansion to concatenation choices
        // This allows %{...} and %name to appear in command arguments
        _primary_expression: ($, previous) =>
            choice($.rpm_macro_expansion, $.rpm_macro_simple, previous),

        // RPM brace expansion: %{...}
        // Only recognize the outer boundaries - internal parsing is delegated
        // to rpmspec via injection.parent
        rpm_macro_expansion: ($) =>
            seq('%{', optional($._rpm_macro_content), '}'),

        // Content inside braces - handles nested %{...}
        _rpm_macro_content: ($) =>
            repeat1(
                choice(
                    $.rpm_macro_expansion, // Nested macros like %{dirname:%{SOURCE0}}
                    /[^{}%]+/, // Any content except braces and %
                    /%/ // Literal % when not followed by {
                )
            ),

        // RPM simple expansion: %name (without braces)
        // Requires 2+ chars to avoid conflicts with printf specifiers (%s, %d)
        // Single-char macros must use braces: %{s} not %s
        // Must be a single token with high precedence to win over bash's word rule
        rpm_macro_simple: ($) =>
            token(prec(10, seq('%', /[a-zA-Z_][a-zA-Z0-9_]+/))),

        // Extend command_substitution to include RPM's %(cmd) shell expansion
        // %(cmd) is semantically equivalent to $(cmd) - executes shell command
        // Content inside is parsed as bash statements, not delegated to parent
        command_substitution: ($, previous) =>
            choice(seq('%(', $._statements, ')'), previous),

        // Extend _statement to include RPM macro definitions
        _statement: ($, previous) =>
            choice($.rpm_define, $.rpm_global, $.rpm_undefine, previous),

        // RPM macro definitions - common in scriptlets
        // Use token() with high precedence to match before rpm_macro_simple
        // %define name value - define local macro
        rpm_define: ($) =>
            seq(
                token(prec(20, '%define')),
                $._rpm_macro_name,
                optional($._rpm_macro_body)
            ),

        // %global name value - define global macro (persists across scriptlets)
        rpm_global: ($) =>
            seq(
                token(prec(20, '%global')),
                $._rpm_macro_name,
                optional($._rpm_macro_body)
            ),

        // %undefine name - undefine a macro
        rpm_undefine: ($) =>
            seq(token(prec(20, '%undefine')), $._rpm_macro_name),

        // Macro name for definitions (hidden, same pattern as simple expansion)
        _rpm_macro_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        // Macro body - everything until end of line
        // Content is delegated to rpmspec for full parsing via injection.parent
        _rpm_macro_body: ($) => /[^\n]+/,

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
