TS ?= tree-sitter

default: build

help:
	@echo "Available targets:"
	@echo "  configure          - Install npm dependencies and configure cmake"
	@echo "  build              - Generate parsers and build with cmake"
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

build: neovim
	cd rpmspec && $(TS) generate
	cd rpmbash && $(TS) generate
	cmake --build build

test: default
	cmake --build build --target ts-test

test-fast:
	cmake --build build --target ts-test

neovim:
	@printf "; inherits: bash\n\n" > neovim/queries/rpmbash/highlights.scm
	@cat rpmbash/queries/highlights.scm >> neovim/queries/rpmbash/highlights.scm
	@echo "Created neovim/queries/rpmbash/highlights.scm"

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

.PHONY: default configure build test test-fast neovim update-bash-scanner check-bash-scanner check-queries
