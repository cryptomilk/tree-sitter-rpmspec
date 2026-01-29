; inherits: bash

; Syntax highlighting queries for tree-sitter-rpmbash
;
; Bash highlights are inherited via tree-sitter.json array configuration.
; For Neovim, use neovim/queries/rpmbash/ which adds `; inherits: bash`.
;
; RPM constructs are delegated to rpmspec via injection.parent for full
; macro parsing and highlighting. This file provides fallback highlighting
; for RPM constructs when used standalone (not via rpmspec injection).
(rpm_macro_expansion) @embedded
(rpm_macro_simple) @embedded
(rpm_conditional_keyword) @keyword.conditional
(rpm_else) @keyword.conditional
(rpm_endif) @keyword.conditional

; Override bash's "}" @punctuation.bracket for the closing brace of RPM macro expansions
; to match rpmspec's @punctuation.special highlighting for the opening brace
(rpm_macro_expansion
  "}" @punctuation.special)
