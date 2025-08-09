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
# ALWAYS run the full test suite to verfiy changes are working
tree-sitter test

# Run tests matching a pattern (regex)
tree-sitter test -i "pattern"
```

### Code Quality

ALWAYS run code quality as the last step when done

```sh
# Format the grammar.js code
prettier -w grammar.js
```
