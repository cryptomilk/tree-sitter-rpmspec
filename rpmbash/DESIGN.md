# Tree-sitter RPMBash Grammar Design

This document explains key design decisions in the tree-sitter-rpmbash grammar.

## Introduction

RPMBash extends tree-sitter-bash to recognize RPM macros and conditionals. When
RPM spec file scriptlets are syntax-highlighted via language injection, embedded
RPM constructs cause parse errors in the standard bash parser:

```bash
cd %{goroot}/bin    # bash parser fails on %{goroot}
%if 0%{?fedora}     # bash parser fails on %if
  echo "Fedora"
%endif
```

RPMBash solves this by extending tree-sitter-bash to *recognize* RPM constructs
(so they don't break parsing), then delegating their highlighting back to
rpmspec via `injection.parent`.

| Construct | rpmbash recognizes | rpmspec highlights |
|-----------|-------------------|---------------------------|
| `%{...}` | Balanced braces | Modifiers, names, arguments, nested macros |
| `%name` | Identifier (2+ chars) | Full macro expansion |
| `%(cmd)` | Extended command_substitution | Parsed as bash (no delegation) |
| `%if/%endif` | Directive keywords (extras) | Condition expressions |
| `%define/%global` | Keyword + name | Macro body |

The `rpmbash/queries/injections.scm` configures this delegation:

```scheme
(rpm_macro_expansion) @injection.content
  (#set! injection.parent)

(rpm_macro_simple) @injection.content
  (#set! injection.parent)

(rpm_condition) @injection.content
  (#set! injection.parent)
```

## The Word Override

The most critical design decision is overriding bash's `word` rule to add `%`
to the list of special characters that break words.

Bash's `word` rule defines which characters can appear in unquoted words. By
default, `%` is NOT special, so `%name-%version` would parse as one big `word`
which would be wrong.

By adding `%` to `SPECIAL_CHARACTERS`, the parser correctly breaks at `%`.

## Printf Specifiers vs Simple Macros

Bash printf uses format specifiers like `%s`, `%d`, `%f`:

```bash
printf "%s: %d items\n" "$name" "$count"
```

RPM allows single-char macros (e.g., `%s` if defined). If rpmbash treated all
`%<char>` as macro expansions, it would break printf format strings.

To avoid this conflict, simple macros (`%name` form) require 2+ characters
after `%`. Single-char macros must use braces:

| Syntax | Interpretation |
|--------|----------------|
| `%name` | RPM macro (2+ chars) |
| `%version` | RPM macro |
| `%s` | NOT a macro (printf specifier) |
| `%d` | NOT a macro (printf specifier) |
| `%{s}` | RPM macro (braces make it explicit) |

## Conditionals as Extras

RPM conditionals can appear inside multi-line bash commands:

```bash
./configure \
  --prefix=/usr \
%if %{with ssl}
  --with-ssl \
%endif
  --disable-gzip
```

If conditionals were parsed as statements, they would break the command into
separate pieces, losing the connection between arguments.
The trick is to define conditionals as `extras`, which allows them to appear
anywhere without disrupting the surrounding structure!

## Shell Expansion `%(...)`

`%(cmd)` is actually the same as `command_substitution` in tree-sitter-bash, so
we can just extend the rule for it.

## External Scanner

The external scanner wraps bash's scanner and teaches it about RPM macros. The
key decision is knowing when to handle tokens ourselves vs delegating to bash.

### When to Intercept

The scanner intercepts in one case: when bash would skip a newline but an RPM
statement follows. Bash's scanner skips newlines when looking for more command
arguments, which caused RPM statements to be incorrectly parsed as arguments.
The scanner peeks ahead at newlines and if the next content is an RPM keyword,
it returns a `NEWLINE` token to terminate the previous command.

### When to Delegate

For everything else, we let bash's scanner handle it. RPM constructs like
`%else` and `%endif` are defined as grammar rules with `token(prec(...))`,
not external tokens. We tried external tokens initially, but they interfered
with other `%` tokens when used in `extras` - the scanner would consume `%`
while checking for matches, breaking `%{...}` and `%name` parsing.

## Limitations

### Heredocs

Bash's heredoc scanner consumes text until it sees `$` or the end delimiter.
RPM macros inside heredocs are swallowed as plain text and not highlighted.
Fixing this would require modifying bash's external scanner to also stop at
`%`.
