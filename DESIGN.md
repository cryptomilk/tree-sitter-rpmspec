# Tree-sitter RPM Spec Grammar Design

This document explains some key design decisions in the tree-sitter-rpmspec
grammar.

## The Section End Detection Problem

RPM spec files have no explicit section end markers. Sections like `%prep`,
`%build`, `%install`, and `%files` continue until another section begins:

```spec
%prep
%autosetup -p1

%build
%cmake
%cmake_build

%install
%cmake_install
```

This creates a fundamental parsing challenge as soon as conditionals get
involved: **How do we know where a section ends?**

### The Conditional Complication

The section end problem becomes significantly harder with conditionals because
`%if`/`%endif` can appear at **different structural levels** in the same file,
but the `%if` token looks identical in all cases.

Consider these two conditionals in the same file:

```spec
%build
make

%if %{with feature}
make feature              # shell code inside %build
%endif

%if %{with tests}
%check                    # section keyword!
make test
%endif

%post
systemctl daemon-reload
```

**The first `%if`** is a "shell-level" conditional:
- It appears inside the `%build` section
- Its body contains only shell code (`make feature`)
- After `%endif`, we're still in `%build`

**The second `%if`** is a "top-level" conditional:
- It appears between sections (after `%build` ends, before `%post`)
- Its body contains a section keyword (`%check`)
- The conditional wraps an entire section definition

The parsing problem is: **when we encounter each `%if`, how do we know which
type it is?** The `%if` token looks the same in both cases.

A naive approach fails in two ways:

1. **If we assume all `%if` blocks are shell-level**: We'd try to parse `%check`
   as shell code, which is wrong - it should start a new section.

2. **If we assume all `%if` blocks are top-level**: We'd incorrectly allow
   section keywords inside every conditional, even ones that should contain
   only shell code. This breaks the grammar's ability to validate content.

The fundamental issue is that we need to know what's *inside* the conditional
body to determine how to parse the conditional itself - a chicken-and-egg
problem.

### Context-Aware Conditional Tokens

To solve the chicken-and-egg problem, the external scanner uses **lookahead**:
before emitting the `%if` token, it peeks ahead (without consuming input) to
see what's inside the conditional body. Based on what it finds, it emits
*different* tokens for the same `%if` keyword:

```c
static bool lookahead_finds_section_keyword(TSLexer *lexer)
{
    // Scan ahead until %endif, looking for section keywords
    // like %prep, %build, %install, %files, %post, etc.
    // If found, this is a "top-level" conditional
    // If not found, this is a "shell-level" or "file-level" conditional
}
```

The scanner emits different tokens based on context:

| Context | Token | Example |
|---------|-------|---------|
| Top-level | `top_level_if` | `%if` containing `%install` |
| Shell scriptlet | `scriptlet_if` | `%if` inside `%build` with only shell code |
| Files section | `files_if` | `%if` inside `%files` with only file entries |

This allows the grammar to use different rules for conditional bodies:

- **Top-level conditionals**: Can contain any statement including new sections
- **Shell conditionals**: Can only contain shell code and macros
- **Files conditionals**: Can only contain file entries, `%defattr`, and nested
  conditionals

### Why Three Context Types?

With only one conditional type, the parser often misinterpreted content:

- File entries inside `%files` conditionals could be confused with other
  `%`-prefixed statements
- Shell code inside scriptlet conditionals could be misinterpreted as
  preamble content or macro invocations

By having context-specific conditionals, each context only allows valid content
for that section. This makes the parser more robust and prevents these
misinterpretations. The grammar explicitly restricts what can appear inside
each conditional type rather than allowing anything and hoping for the best.

## Macro Expansion Complexity

RPM macros are surprisingly complex. The grammar must handle:

### 1. Braced Expansion: `%{name}`

The "full" form with explicit delimiters:

```spec
%{name}                    # Simple expansion
%{?name}                   # Conditional (empty if undefined)
%{!?name}                  # Negated conditional
%{name:default}            # With default value
%{name arg1 arg2}          # With arguments
%{expand:code}             # Evaluated expansion
%{lua:code}                # Lua code execution
%{expr:1+2}                # Expression evaluation
```

This form is relatively easy to parse because `{` and `}` clearly delimit the macro.

### 2. Simple Expansion: `%name`

The short form without braces is **much harder**:

```spec
%version                   # Expands to version value
%{version}                 # Same thing, but delimited

%configure --prefix=/usr   # Parametric macro (takes rest of line)

%1 %2 %*                   # Positional arguments for macros
%#                         # Argument count of macros
%%                         # Percent escaping
```

#### The Keyword Problem

Many `%name` patterns are NOT macro expansions but keywords:

```spec
%if                        # Conditional, not a macro
%define                    # Definition, not expansion
%files                     # Section, not a macro
%config                    # File directive, builtin and not a macro
```

The external scanner maintains a keyword list and refuses to match these as
`SIMPLE_MACRO` tokens, allowing the grammar to handle them specially.

#### The Parametric Problem

Some macros consume the rest of the line as arguments:

```spec
%configure --prefix=/usr   # --prefix=/usr are arguments
%cmake -DFOO=bar           # -DFOO=bar are arguments
```

But others don't:

```spec
%version                   # Just expands, no arguments
%_libdir/bin               # Expands, /bin is literal text
```

The grammar uses `macro_parametric_expansion` with higher precedence when
arguments follow a macro name on the same line. Without arguments,
`macro_simple_expansion` matches instead.

#### The Concatenation Problem

Macros can be concatenated with literal text:

```spec
%{name}-%{version}         # Clear boundaries
%name-%version             # Where does %name end?
lib%{name}.so              # Prefix + macro + suffix
%{_libdir}/lib%name.so.%{version}  # Mixed styles
```

For `%name-something`:
- Is it `%name` followed by `-something`?
- Or is `name-something` the macro name?

RPM answers: macro names are `[a-zA-Z_][a-zA-Z0-9_]*`, so `-` terminates the
name.  The scanner implements this by stopping at non-identifier characters.

### 3. Special Variables

Macros inside macro definitions can access special variables:

```spec
%define mymacro() \
  echo "Args: %*"  \
  echo "Count: %#" \
  echo "First: %1"
```

These are:
- `%*` - All arguments as a string
- `%**` - All arguments, quoted
- `%#` - Argument count
- `%0` through `%9` - Positional arguments
- `%{-f}` - Option value for `-f`
- `%{-f*}` - Option value or remaining args

### 4. Conditional Expansion

```spec
%{?name:value}             # "value" if name is defined
%{?name}                   # Expands to value if defined, empty otherwise
%{!?name:value}            # "value" if name is NOT defined
%{?with_foo:--enable-foo}  # Common pattern for build options
```

### 5. Built-in Macros

RPM provides many built-in macros with special syntax:

```spec
# Path operations (colon separator)
%{basename:/path/to/file}  # Returns "file"
%{dirname:/path/to/file}   # Returns "/path/to"
%{suffix:file.tar.gz}      # Returns "gz"

# String operations (colon separator)
%{upper:hello}             # Returns "HELLO"
%{lower:HELLO}             # Returns "hello"
%{len:hello}               # Returns "5"

# Multi-argument (space separator!)
%{gsub hello l x}          # Returns "hexxo"
%{sub hello 2 4}           # Returns "ell"
%{rep hello 3}             # Returns "hellohellohello"
```

Note the inconsistency: some use `:` as separator, others use spaces.

## External Scanner Design

The external scanner (`src/scanner.c`) handles tokens that are difficult or
impossible to express in the grammar DSL:

### Why Use an External Scanner?

1. **Keyword exclusion**: The scanner can check if an identifier matches a
   keyword list before emitting `SIMPLE_MACRO`.

2. **Context-aware lookahead**: The scanner can peek ahead to determine
   conditional context without consuming input.

3. **Balanced delimiter tracking**: For `%{expand:...}` and `%(...)`, the
   scanner tracks nesting depth to find the correct closing delimiter.

4. **Stateful parsing**: The scanner maintains state for nested macro contexts.

### Token Priority

Tokens are ordered by frequency in the enum to improve error recovery:

```c
enum TokenType {
    SIMPLE_MACRO,      // Most common (~80% of macros)
    NEGATED_MACRO,     // Less common
    SPECIAL_MACRO,     // Rare
    ESCAPED_PERCENT,   // Rare
    // ... conditional tokens ...
    EXPAND_CODE,       // Only inside %{expand:...}
    SHELL_CODE         // Only inside %(...)
};
```

### Context Priority in Conditionals

When multiple conditional token types are valid, the scanner uses this priority:

1. **Files context**: If `FILES_*` tokens are valid, emit them (most specific)
2. **Exclusive contexts**: If only one of top/shell is valid, emit that
3. **Ambiguous**: Use lookahead to decide between top-level and shell

## Grammar Structure

### Inline Rules

Several rules are marked as `inline` to flatten the parse tree:

```javascript
inline: ($) => [
    $._simple_statements,
    $._compound_statements,
    $._shell_compound_statements,
    $._files_compound_statements,
    $._conditional_block,
    $._shell_conditional_content,
    $._files_conditional_content,
    $._literal,
],
```

Inline rules don't create their own nodes in the syntax tree. Instead, their
children appear directly under the parent. This:
- Reduces tree nesting depth
- Simplifies syntax highlighting queries
- Improves tree-sitter's state machine efficiency

### Precedence Strategy

The grammar uses precedence sparingly:

- `prec(-1, ...)` for fallback rules (e.g., raw string content)
- `prec(1, ...)` for specific matches over generic ones
- `prec.left(...)` for left-associative concatenation

Most disambiguation is done through:
1. Token specificity (external scanner)
2. Rule ordering in `choice()`
3. `token.immediate()` to prevent whitespace

### Alias Strategy

Files and shell conditionals are aliased to their top-level counterparts:

```javascript
_files_compound_statements: ($) =>
    choice(
        alias($.files_if_statement, $.if_statement),
        alias($.files_ifarch_statement, $.ifarch_statement),
        alias($.files_ifos_statement, $.ifos_statement)
    ),
```

This means the parse tree shows `if_statement` regardless of context, making
syntax highlighting and analysis simpler. The context is already resolved
by the scanner; consumers don't need to care.
