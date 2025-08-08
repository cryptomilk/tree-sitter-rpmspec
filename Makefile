TS ?= tree-sitter

default: build

configure:
	cmake -B build

build:
	$(TS) generate
	cmake --build build

test: all
	$(TS) test

fast-test:
	$(TS) test

.PHONY: default configure build test
