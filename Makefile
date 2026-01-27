TS ?= tree-sitter

default: build

configure:
	cmake -B build -DPICKY_DEVELOPER=ON

build:
	cd rpmspec && $(TS) generate
	cmake --build build

test: default
	cmake --build build --target ts-test

test-fast:
	cmake --build build --target ts-test

.PHONY: default configure build test test-fast
