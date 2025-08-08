This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Development commands

### Building

```sh
# Regenerate the tree-sitter parser files
# ALWAYS check the output for warnings
tree-sitter generate

# ALWAYS build the parser after generating
cmake -B build
cmake --build build
```

### Testing

```sh
# Run the full test suite
tree-sitter test
```

### Code Quality

```sh
# Format the grammar.js code
prettier -w grammar.js

# Format the src/scanner.c code
clang-format -i src/scanner.c
```
