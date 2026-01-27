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

module.exports = grammar(Bash, {
    name: 'rpmbash',

    rules: {
        // Add RPM macro expansion to concatenation choices
        // This allows %{...} to appear in command arguments
        _primary_expression: ($, previous) =>
            choice($.rpm_macro_expansion, previous),

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
    },
});
