# tree-sitter-rpmspec

A [tree-sitter](https://tree-sitter.github.io/) parser for
[RPM spec](https://rpm.org) files.

## Features

- (Almost) Full parsing of RPM spec file syntax
- Syntax highlighting support via `queries/highlights.scm`
- Bash injection for shell content in scriptlets

## Editor Integration

### Neovim

This parser is not yet part of
[nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter).
See [NEOVIM.md](NEOVIM.md) for setup instructions.

---

## Development

### Building

```sh
tree-sitter generate       # Regenerate parser from grammar.js
cmake -B build             # Configure
cmake --build build        # Compile
```

### Testing

```sh
tree-sitter test                       # Run all tests
tree-sitter test -i "pattern"          # Run tests matching pattern
tree-sitter test --file-name file.txt  # Run tests from specific file
```

### Code Quality

```sh
prettier -w grammar.js     # Format grammar.js
```

### Syntax Highlighting Preview

```sh
tree-sitter highlight --html example.spec > highlight.html
```

### Architecture

See [DESIGN.md](rpmspec/DESIGN.md) for details on key design decisions, including:
- Section end detection without explicit markers
- Context-aware conditional parsing with lookahead
- Macro expansion complexity

### References

#### Tree-sitter

- [Creating Parsers](https://tree-sitter.github.io/tree-sitter/creating-parsers)
- [Syntax Highlighting](https://tree-sitter.github.io/tree-sitter/syntax-highlighting)
- [Parser Development (Neovim wiki)](https://github.com/nvim-treesitter/nvim-treesitter/wiki/Parser-Development)
- [Tips and Tricks for a grammar author](https://github.com/tree-sitter/tree-sitter/wiki/Tips-and-Tricks-for-a-grammar-author)

#### RPM

- [Spec File Format](https://rpm-software-management.github.io/rpm/manual/spec.html)
- [Macro Syntax](https://rpm-software-management.github.io/rpm/man/rpm-macros.7)
