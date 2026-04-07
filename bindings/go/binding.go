package tree_sitter_rpmspec

// #cgo CFLAGS: -std=c11 -fPIC
// #include "../../rpmspec/src/parser.c"
// #include "../../rpmspec/src/scanner.c"
import "C"

import "unsafe"

// Get the tree-sitter Language for this grammar.
func Language() unsafe.Pointer {
	return unsafe.Pointer(C.tree_sitter_rpmspec())
}
