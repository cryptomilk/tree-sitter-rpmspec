TS ?= tree-sitter

default: build

configure:
	@if [ ! -d rpmbash/node_modules/tree-sitter-bash ]; then \
		npm --prefix rpmbash install; \
	fi
	cmake -B build -DPICKY_DEVELOPER=ON

build:
	cd rpmspec && $(TS) generate
	cd rpmbash && $(TS) generate
	cmake --build build

test: default
	cmake --build build --target ts-test

test-fast:
	cmake --build build --target ts-test

.PHONY: default configure build test test-fast
