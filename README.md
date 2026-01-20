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
To use it, add the parser manually:

```lua
vim.api.nvim_create_autocmd('User', {
  pattern = 'TSUpdate',
  callback = function()
    require('nvim-treesitter.parsers').rpmspec = {
      install_info = {
        url = 'https://gitlab.com/cryptomilk/tree-sitter-rpmspec',
        queries = 'queries',
      },
    }
  end
})
```

Then run `:TSInstall rpmspec bash` and enable highlighting:

```lua
require('nvim-treesitter.configs').setup {
  highlight = { enable = true },
}
```

The `bash` parser is needed for syntax highlighting inside scriptlets (`%prep`,
`%build`, `%install`, etc.).

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

See [DESIGN.md](DESIGN.md) for details on key design decisions, including:
- Section end detection without explicit markers
- Context-aware conditional parsing with lookahead
- Macro expansion complexity

### References

#### Tree-sitter

- [Creating Parsers](https://tree-sitter.github.io/tree-sitter/creating-parsers)
- [Syntax Highlighting](https://tree-sitter.github.io/tree-sitter/syntax-highlighting)
- [Parser Development (Neovim wiki)](https://github.com/nvim-treesitter/nvim-treesitter/wiki/Parser-Development)

#### RPM

- [Spec File Format](https://rpm-software-management.github.io/rpm/manual/spec.html)
- [Macro Syntax](https://rpm-software-management.github.io/rpm/man/rpm-macros.7)
