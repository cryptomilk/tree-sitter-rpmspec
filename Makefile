TS ?= tree-sitter

default: build

help:
	@echo "Available targets:"
	@echo "  configure          - Install npm dependencies and configure cmake"
	@echo "  build              - Generate parsers (if needed) and build with cmake"
	@echo "  generate           - Force regenerate parsers from grammar.js"
	@echo "  test               - Build and run all tests"
	@echo "  test-fast          - Run tests without rebuilding"
	@echo "  neovim             - Generate neovim query files (with ; inherits)"
	@echo "  check-queries      - Validate queries with ts_query_ls"
	@echo "  check-bash-scanner - Check if vendored bash scanner is up to date"
	@echo "  update-bash-scanner- Update vendored bash scanner from node_modules"
	@echo "  help               - Show this help message"

configure:
	@if [ ! -d rpmbash/node_modules/tree-sitter-bash ]; then \
		npm --prefix rpmbash install; \
	fi
	cmake -B build -DPICKY_DEVELOPER=ON

# Generate rpmspec parser only if grammar.js changed
rpmspec/src/parser.c: rpmspec/grammar.js
	@echo "Regenerating rpmspec parser (grammar.js changed)..."
	cd rpmspec && $(TS) generate

# Generate rpmbash parser only if grammar.js changed
# Also depends on tree-sitter-bash grammar since it extends it
rpmbash/src/parser.c: rpmbash/grammar.js rpmbash/node_modules/tree-sitter-bash/grammar.js
	@echo "Regenerating rpmbash parser (grammar.js changed)..."
	cd rpmbash && $(TS) generate

# Generate neovim query file only if source query changed
neovim/queries/rpmbash/highlights.scm: rpmbash/queries/highlights.scm
	@echo "Regenerating neovim query file..."
	@printf "; inherits: bash\n\n" > $@
	@cat $< >> $@

# Build target depends on generated parsers and neovim files
build: rpmspec/src/parser.c rpmbash/src/parser.c neovim/queries/rpmbash/highlights.scm
	cmake --build build

# Force regenerate all parsers
generate:
	@echo "Force regenerating all parsers..."
	cd rpmspec && $(TS) generate
	cd rpmbash && $(TS) generate

test: build
	cmake --build build --target ts-test

test-fast:
	cmake --build build --target ts-test

# Update vendored bash scanner from node_modules (run after npm install)
update-bash-scanner:
	@if [ ! -f rpmbash/node_modules/tree-sitter-bash/src/scanner.c ]; then \
		echo "Error: Run 'npm --prefix rpmbash install' first"; \
		exit 1; \
	fi
	cp rpmbash/node_modules/tree-sitter-bash/src/scanner.c rpmbash/src/third_party/bash_scanner.c
	@echo "Updated rpmbash/src/third_party/bash_scanner.c"

# Check if vendored bash scanner matches node_modules version
check-bash-scanner:
	@if [ ! -f rpmbash/node_modules/tree-sitter-bash/src/scanner.c ]; then \
		echo "Error: Run 'npm --prefix rpmbash install' first"; \
		exit 1; \
	fi
	@if diff -q rpmbash/node_modules/tree-sitter-bash/src/scanner.c rpmbash/src/third_party/bash_scanner.c > /dev/null; then \
		echo "bash_scanner.c is up to date"; \
	else \
		echo "Error: bash_scanner.c differs from node_modules version"; \
		echo "Run 'make update-bash-scanner' to update"; \
		exit 1; \
	fi

# Validate queries with ts_query_ls
check-queries:
	@command -v ts_query_ls >/dev/null 2>&1 || { echo "Error: ts_query_ls not found. Install from https://github.com/ribru17/ts_query_ls"; exit 1; }
	@test -f build/rpmspec/libtree-sitter-rpmspec.so || { echo "Error: Run 'make build' first"; exit 1; }
	@ln -sf ../build/rpmspec/libtree-sitter-rpmspec.so rpmspec/rpmspec.so; \
		ln -sf ../build/rpmbash/libtree-sitter-rpmbash.so rpmbash/rpmbash.so; \
		(cd rpmspec && ts_query_ls check queries/) && \
		(cd rpmbash && ts_query_ls check queries/); \
		ret=$$?; rm -f rpmspec/rpmspec.so rpmbash/rpmbash.so; exit $$ret

.PHONY: default configure build generate test test-fast update-bash-scanner check-bash-scanner check-queries
