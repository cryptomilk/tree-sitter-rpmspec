TS ?= tree-sitter

default: build

configure:
	cmake -B build -DPICKY_DEVELOPER=ON

build:
	$(TS) generate
	cmake --build build

test: default
	$(TS) test

test-fast:
	$(TS) test

.PHONY: default configure build test
