/**
 * @file Tree-sitter grammar definition for RPM spec files
 * @author Andreas Schneider
 * @author Omair Majid
 * @license MIT
 * @see {@link https://rpm-software-management.github.io/rpm/manual/spec.html|spec syntax documentation}
 */

const PREC = {
    parenthesized_expression: 1,

    or: 10,
    and: 11,
    not: 12,
    compare: 13,
    plus: 14,
    times: 15,
};

const NEWLINE = /\r?\n/;
const ANYTHING = /[^\r\n]*/;
const BLANK = /( |\t)+/;

/* https://rpm-software-management.github.io/rpm/manual/spec.html */
module.exports = grammar({
    name: 'rpmspec',

    // FIXME Is there a better way?
    conflicts: ($) => [[$.macro_call, $.string]],

    // Array of tokens that may appear anywhere in the language.
    extras: ($) => [$.comment, /\s+/, /\\( |\t|\v|\f)/, $.line_continuation],

    supertypes: ($) => [
        $._simple_statements,
        $._compound_statements,
        $.expression,
        $._primary_expression,
    ],

    inline: ($) => [
        $._simple_statements,
        $._compound_statements,
        $._conditional_block,
        $._literal,
    ],

    // TODO We probably need to scan for the macro end as in macro shell
    // expansions, you can still have () inside the shell code.
    //
    //externals: ($) => [
    //    $._macro_start,
    //    $._macro_end,
    //],

    word: ($) => $.identifier,

    rules: {
        spec: ($) => repeat($._statements),

        _statements: ($) =>
            choice($._simple_statements, $._compound_statements),

        _simple_statements: ($) =>
            choice(
                $.macro_definition,
                $.macro_undefinition,
                $.macro_call,
                $.macro_expansion,
                $.preamble,
                $.description,
                $.package,
                $.prep_scriptlet,
                $.generate_buildrequires,
                $.conf_scriptlet,
                $.build_scriptlet,
                $.install_scriptlet,
                $.check_scriptlet,
                $.clean_scriptlet,
                $.runtime_scriptlet,
                $.trigger,
                $.file_trigger,
                $.files,
                $.changelog
            ),

        comment: ($) =>
            token(choice(seq('#', ANYTHING), seq('%dnl ', ANYTHING))),

        line_continuation: (_) =>
            token(seq('\\', choice(seq(optional('\r'), '\n'), '\0'))),

        identifier: (_) =>
            /(\p{XID_Start}|\$|_|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})(\p{XID_Continue}|\$|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*/,

        ///////////////////////////////////////////////////////////////////////
        // Literals
        ///////////////////////////////////////////////////////////////////////

        _literal: ($) => choice($.concatenation, $._primary_expression),

        _primary_expression: ($) =>
            prec(
                1,
                choice(
                    $.word,
                    $.quoted_string,
                    $.integer,
                    $.float,
                    $.version,
                    $.parenthesized_expression,
                    $.macro_simple_expansion,
                    $.macro_expansion,
                    $.macro_integer_expansion,
                    $.macro_shell_expansion
                )
            ),

        // 0%{?<name>}
        // TODO FIXME Can we integrate this in macro_(simple_)expansion??
        macro_integer_expansion: ($) =>
            seq($.integer, choice($.macro_simple_expansion, $.macro_expansion)),

        ///////////////////////////////////////////////////////////////////////
        // Macros
        ///////////////////////////////////////////////////////////////////////

        macro_name: (_) => /[a-zA-Z_][a-zA-Z0-9_]*/,

        //// Simple Macro Expansion
        //
        // %<name>
        //
        // TODO Support %-f ?
        macro_simple_expansion: ($) =>
            seq(
                '%',
                choice(
                    seq(
                        optional(field('operator', token.immediate('!'))),
                        choice(
                            $.macro_builtin,
                            alias($.macro_name, $.identifier)
                        )
                    ),
                    $.conditional_expansion,
                    $._special_macro_name
                )
            ),

        // %*, %**, %#, %<num>
        _special_macro_name: ($) =>
            alias(
                choice('*', '**', '#', /[0-9]+/, 'nil'),
                $.special_variable_name
            ),

        // Builtin macro names
        macro_builtin: ($) =>
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

        macro_source: ($) => seq(choice('S', 'SOURCE'), $.integer),

        macro_patch: ($) => seq(choice('P', 'PATCH'), $.integer),

        macro_define: ($) => choice('define', 'global'),

        macro_undefine: ($) => 'undefine',

        //// Macro Expansion
        //
        // %{<name>}
        // ...
        //
        macro_expansion: ($) =>
            seq('%{', optional($._macro_expansion_body), '}'),

        _macro_expansion_body: ($) =>
            choice(
                // %{<name>}
                seq(
                    optional(field('operator', token.immediate('!'))),
                    choice(
                        $.macro_builtin,
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

        //// Conditionally Expanded Macros
        //
        // %{?macro_name:value}
        // %{!?macro_name:value}
        // %{?macro_name}
        // %{!?macro_name}
        //
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
                                    $.macro_simple_expansion,
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
            prec.left(
                seq(
                    '%',
                    alias($.macro_define, $.macro_builtin),
                    token.immediate(BLANK),
                    field('name', alias($.macro_name, $.identifier)),
                    optional(seq('(', optional($.macro_options), ')')),
                    token.immediate(BLANK),
                    field('value', $._body),
                    token.immediate(NEWLINE)
                )
            ),

        macro_options: (_) => /[-:a-zA-Z]/,

        _body: ($) =>
            repeat1(
                choice(
                    $.macro_simple_expansion,
                    $.macro_expansion,
                    $.macro_shell_expansion,
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
                    alias($.macro_undefine, $.macro_builtin),
                    token.immediate(BLANK),
                    field('name', alias($.macro_name, $.identifier))
                )
            ),

        //// Macro call
        //
        // %setup -q
        //
        macro_call: ($) =>
            prec.left(
                seq(
                    field('name', $.macro_simple_expansion),
                    repeat(field('argument', $._literal)),
                    NEWLINE
                )
            ),

        _macro_argument_list: ($) => sep1($.concatenation, BLANK),

        //// Macro Expression: %[<expression>]
        //macro_expression: ($) => seq('%[', $.expression, ']'),

        // TODO: macro_shell_expansion needs to be implemented in an
        // external scanner.
        // Inside the $(...) are also () allowed, so you need to count them to
        // detect the last one.
        // %(...)
        macro_shell_expansion: ($) =>
            choice(
                seq('%(', ')'),
                seq(
                    '%(',
                    repeat1(
                        choice(
                            prec(1, $.macro_expansion),
                            $.quoted_string,
                            $.string
                        )
                    ),
                    ')'
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Conditionals (%if, %ifarch, %ifos)
        ///////////////////////////////////////////////////////////////////////

        _compound_statements: ($) =>
            choice($.if_statement, $.ifarch_statement, $.ifos_statement),

        boolean_operator: ($) =>
            choice(
                prec.left(
                    PREC.and,
                    seq(
                        field('left', $.expression),
                        field('operator', choice('&&', 'and')),
                        field('right', $.expression)
                    )
                ),
                prec.left(
                    PREC.or,
                    seq(
                        field('left', $.expression),
                        field('operator', choice('||', 'or')),
                        field('right', $.expression)
                    )
                )
            ),

        not_operator: ($) =>
            prec(PREC.not, seq('!', field('argument', $.expression))),

        arithmetic_operator: ($) => {
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
                            field('left', $._primary_expression),
                            field('operator', operator),
                            field('right', $._primary_expression)
                        )
                    )
                )
            );
        },

        comparison_operator: ($) =>
            prec.left(
                PREC.compare,
                seq(
                    $._primary_expression,
                    repeat1(
                        seq(
                            field(
                                'operators',
                                choice('<', '<=', '==', '!=', '>=', '>')
                            ),
                            $._primary_expression
                        )
                    )
                )
            ),

        with_operator: ($) =>
            seq(
                '%{',
                field('operators', choice('with', 'without')),
                $.identifier,
                '}'
            ),

        defined_operator: ($) =>
            seq(
                '%{',
                field('operators', choice('defined', 'undefined')),
                $.identifier,
                '}'
            ),

        parenthesized_expression: ($) =>
            prec(PREC.parenthesized_expression, seq('(', $.expression, ')')),

        expression: ($) =>
            choice(
                $.arithmetic_operator,
                $.comparison_operator,
                $.not_operator,
                $.boolean_operator,
                $.with_operator,
                $.defined_operator,
                $._primary_expression
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
                optional(field('consequence', $._literal)),
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
        // Preamble Section (Name, Version, Release, ...)
        ///////////////////////////////////////////////////////////////////////

        preamble: ($) => seq($.tags),

        // Name:   tree-sitter-rpmspec
        // Requires(pre): tree-sitter
        // Summary: A parser generator Tool
        tags: ($) =>
            seq(
                choice($.tag, $.dependency_tag),
                token.immediate(/:( |\t)*/),
                field('value', $._literal),
                token.immediate(NEWLINE)
            ),

        tag: ($) =>
            choice(
                'AutoProv',
                'AutoReq',
                'AutoReqProv',
                'BugUrl',
                'BuildRoot',
                'BuildSystem',
                'DistTag',
                'Distribution',
                'Epoch',
                'Group',
                'License',
                'ModularityLabel',
                'Name',
                'NoPatch',
                'NoSource',
                'Packager',
                'Release',
                'SourceLicense',
                'Summary',
                'URL',
                'Url',
                'VCS',
                'Vendor',
                'Version',
                /Patch\d*/,
                /Source\d*/
            ),

        // Dependencies:
        // Requires(pre): tree-sitter
        qualifier: ($) =>
            choice(
                'pre',
                'post',
                'preun',
                'postun',
                'pretrans',
                'posttrans',
                'verify',
                'interp',
                'meta'
            ),

        // BuildRequires: tree-sitter-cli
        dependency_tag: ($) =>
            choice(
                seq('Requires', optional(seq('(', $.qualifier, ')'))),
                'BuildArch',
                'BuildArchitectures',
                'BuildConflicts',
                'BuildPrereq',
                'BuildRequires',
                'Conflicts',
                'DocDir',
                'Enhances',
                'ExcludeArch',
                'ExcludeOS',
                'ExclusiveArch',
                'ExclusiveOS',
                'Obsoletes',
                'OrderWithRequires',
                'Prefix',
                'Prefixes',
                'Prereq',
                'Provides',
                'Recommends',
                'RemovePathPostfixes',
                'Suggests',
                'Supplements'
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
        // Build scriptlets (%prep, %build, %install, ...)
        ///////////////////////////////////////////////////////////////////////

        shell_block: ($) =>
            prec.right(
                repeat1(
                    choice(
                        $._compound_statements,
                        prec(1, $.macro_expansion),
                        $.macro_definition,
                        $.macro_undefinition,
                        $.macro_call,
                        $.string
                    )
                )
            ),

        prep_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%prep', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        generate_buildrequires: ($) =>
            prec.right(
                seq(
                    alias(
                        token(seq('%generate_buildrequires', NEWLINE)),
                        $.section_name
                    ),
                    optional($.shell_block)
                )
            ),

        conf_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%conf', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        build_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%build', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        install_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%install', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        check_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%check', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        clean_scriptlet: ($) =>
            prec.right(
                seq(
                    alias(token(seq('%clean', NEWLINE)), $.section_name),
                    optional($.shell_block)
                )
            ),

        ///////////////////////////////////////////////////////////////////////
        // Runtime scriptlets (%pre, %post, ...)
        ///////////////////////////////////////////////////////////////////////

        runtime_scriptlet: ($) =>
            prec.right(
                seq(
                    choice(
                        '%pre',
                        '%post',
                        '%preun',
                        '%postun',
                        '%pretrans',
                        '%posttrans',
                        '%preuntrans',
                        '%postuntrans',
                        '%verify'
                    ),
                    optional(seq(optional('-n'), $._literal)),
                    token.immediate(NEWLINE),
                    optional($.shell_block)
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
        // Files section (%files)
        ///////////////////////////////////////////////////////////////////////

        files: ($) =>
            prec.right(
                seq(
                    alias('%files', $.section_name),
                    optional(choice($._literal, seq('-n', $._literal))),
                    optional(seq('-f', $._literal)),
                    token.immediate(NEWLINE),
                    repeat(choice($._compound_statements, $.defattr, $.file))
                )
            ),

        defattr: ($) =>
            seq(
                '%defattr',
                '(',
                choice('-', /[0-9]+/),
                ',',
                /[a-zA-Z]+/,
                ',',
                /[a-zA-Z]+/,
                ')',
                token.immediate(NEWLINE)
            ),

        file_qualifier: ($) =>
            seq(
                choice(
                    '%artifact',
                    '%config',
                    '%dir',
                    '%doc',
                    '%docdir',
                    '%ghost',
                    '%license',
                    '%missingok',
                    '%readme',
                    $.verify
                ),
                token.immediate(BLANK)
            ),

        file: ($) =>
            seq(
                optional($.attr),
                optional($.file_qualifier),
                $.string,
                token.immediate(NEWLINE)
            ),

        attr: ($) =>
            seq(
                '%attr',
                '(',
                choice('-', /[0-9]+/),
                ',',
                /[a-zA-Z]+/,
                ',',
                /[a-zA-Z]+/,
                ')',
                token.immediate(BLANK)
            ),

        // %verify(not size filedigest mtime) %{prefix}/bin/file
        verify: ($) =>
            seq(
                '%verify',
                token.immediate('('),
                repeat(
                    choice(
                        'filedigest',
                        'group',
                        'maj',
                        'md5',
                        'mode',
                        'min',
                        'mtime',
                        'not',
                        'owner',
                        'size',
                        'symlink'
                    )
                ),
                token.immediate(')')
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

        ///////////////////////////////////////////////////////////////////////
        // Directives (%attr, %dir, %config, ...)
        ///////////////////////////////////////////////////////////////////////

        integer: ($) => token(/-?(0x)?[0-9]+(#[0-9A-Za-z@_]+)?/),

        float: ($) => {
            const digits = repeat1(/[0-9]+_?/);

            return token(seq(digits, '.', digits));
        },

        version: ($) => {
            const digits = repeat1(/[0-9]+_?/);

            return token(
                seq(digits, '.', digits, optional(/[a-zA-Z0-9+._-~]+/))
            );
        },

        text: ($) =>
            prec(
                -1,
                repeat1(
                    seq(
                        choice(
                            seq(optional('%'), $.text_content),
                            $.macro_simple_expansion,
                            $.macro_expansion
                        )
                    )
                )
            ),

        text_content: (_) => token(prec(-1, /([^"%\\\r\n]|\\(.|\r?\n))+/)),

        string: ($) =>
            prec.left(
                repeat1(
                    choice(
                        seq(optional('%'), $.string_content),
                        $.macro_simple_expansion,
                        $.macro_expansion
                    )
                )
            ),

        string_content: (_) => token(prec(-1, /([^%\\\r\n])+/)),

        quoted_string: ($) =>
            seq(
                '"',
                repeat(choice($.macro_expansion, $.quoted_string_content)),
                '"'
            ),

        quoted_string_content: (_) => token(prec(-1, /([^"%\\\r\n])+/)),

        word: ($) => token(/([^\s"#%{}()\\])+/),

        concatenation: ($) =>
            prec(
                -1,
                seq($._primary_expression, repeat1($._primary_expression))
            ),
    },
});

/**
 * Creates a rule to match one or more occurrences of `rule` separated by `sep`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @return {SeqRule}
 *
 */
function sep1(rule, separator) {
    return seq(rule, repeat(seq(separator, rule)));
}
