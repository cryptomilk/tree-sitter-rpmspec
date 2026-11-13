# tree-sitter-rpmspec

A [tree-sitter](https://tree-sitter.github.io/) parser for
[RPM spec](https://rpm.org) files.

## Features

- (Almost) Full parsing of RPM spec file syntax
- Syntax highlighting support via `rpmspec/queries/highlights.scm`
- RPMBash: Extended bash grammar for scriptlets with RPM macro support

## Editor Integration

### Neovim

This parser is not yet part of
[nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter).
See [NEOVIM.md](NEOVIM.md) for setup instructions.

---

## Development

The repository root is a container for two grammars, `rpmspec/` and
`rpmbash/`. There is no `grammar.js` or `test/corpus` at the root, so
`tree-sitter generate`, `tree-sitter test` and `tree-sitter build` only work
from inside a grammar directory (or through `make`/CMake, which do that for
you).

The generated `src/parser.c` files are committed. You only need to run
`tree-sitter generate` after editing a `grammar.js`.

### Prerequisites

- [tree-sitter CLI](https://tree-sitter.github.io/tree-sitter/) 0.25.x
- CMake and a C compiler
- npm, for the `tree-sitter-bash` dependency of rpmbash
- prettier and clang-format, for contributions

### Setup

```sh
make configure
```

This installs `tree-sitter-bash` into `rpmbash/node_modules` and configures
CMake in `build/`. It is needed by `tree-sitter generate` and
`tree-sitter highlight`, and for the rpmbash tests.

### Building

```sh
make build                      # Regenerate parsers if grammar.js changed, then compile
make generate                   # Force regenerate both parsers
cmake --build build             # Compile only

# Regenerate a single grammar
cd rpmspec && tree-sitter generate
```

### Testing

```sh
make test                                      # Build and run all tests
cmake --build build --target ts-test           # All grammars
cmake --build build --target ts-test-rpmspec   # Only rpmspec
cmake --build build --target ts-test-rpmbash   # Only rpmbash

# Run from the grammar directory
cd rpmspec
tree-sitter test                       # All tests of this grammar
tree-sitter test -i "pattern"          # Tests matching pattern
tree-sitter test --file-name file.txt  # Tests from a specific file
```

### Code Quality

```sh
prettier -w rpmspec/grammar.js rpmbash/grammar.js
clang-format -i rpmspec/src/scanner.c rpmbash/src/scanner.c
make check-queries                     # Needs ts_query_ls
```

### Syntax Highlighting Preview

Run `make configure` first. The rpmbash highlights depend on
`rpmbash/node_modules/tree-sitter-bash`. From the repository root:

```sh
tree-sitter highlight --html example.spec > highlight.html
```

The warning about unconfigured parser directories is harmless for rpmspec and
rpmbash. Scriptlets in Lua, Python or Perl are only highlighted if those
grammars are in a directory listed by `tree-sitter init-config`.

### WebAssembly

```sh
# Build the wasm module (needs emscripten, docker or podman)
tree-sitter build --wasm -o rpmspec/tree-sitter-rpmspec.wasm rpmspec
tree-sitter build --wasm -o rpmbash/tree-sitter-rpmbash.wasm rpmbash

# Build rpmspec and open the playground
npm start
```

**Warning:** The rpmspec parser is large (about 25 MB of C, 20000 states).
Building it to wasm needs a lot of memory and takes a long time.

### Architecture

This project contains two grammars:

- **rpmspec**: Main RPM spec file grammar.
  See [rpmspec/DESIGN.md](rpmspec/DESIGN.md) for design decisions including
  section end detection, context-aware conditional parsing, and macro expansion.

- **rpmbash**: Extended bash grammar for scriptlets.
  See [rpmbash/DESIGN.md](rpmbash/DESIGN.md) for how it recognizes RPM macros
  and delegates highlighting back to rpmspec.

### References

#### Tree-sitter

- [Creating Parsers](https://tree-sitter.github.io/tree-sitter/creating-parsers)
- [Syntax Highlighting](https://tree-sitter.github.io/tree-sitter/syntax-highlighting)
- [Parser Development (Neovim wiki)](https://github.com/nvim-treesitter/nvim-treesitter/wiki/Parser-Development)
- [Tips and Tricks for a grammar author](https://github.com/tree-sitter/tree-sitter/wiki/Tips-and-Tricks-for-a-grammar-author)

#### RPM

- [Spec File Format](https://rpm-software-management.github.io/rpm/manual/spec.html)
- [Macro Syntax](https://rpm-software-management.github.io/rpm/man/rpm-macros.7)
