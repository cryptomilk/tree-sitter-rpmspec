TS ?= tree-sitter

default: build

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

.PHONY: default configure build test test-fast neovim
