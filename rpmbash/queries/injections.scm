; Injection queries for tree-sitter-rpmbash
;
; RPM constructs are delegated to the parent grammar (rpmspec) for parsing
; and highlighting. This allows rpmbash to recognize RPM syntax without
; breaking bash parsing, while rpmspec handles the actual macro semantics.

; =============================================================================
; RPM MACRO EXPANSIONS -> rpmspec
; =============================================================================

; Brace expansion: %{...}, %{?name}, %{name:arg}, etc.
(rpm_macro_expansion) @injection.content
  (#set! injection.parent)

; Simple expansion: %name, %version, etc.
(rpm_macro_simple) @injection.content
  (#set! injection.parent)

; =============================================================================
; RPM CONDITIONALS -> rpmspec
; =============================================================================
; rpm_conditional is structured as keyword + condition.
; The condition is handed back to rpmspec for proper macro/expression highlighting.

(rpm_condition) @injection.content
  (#set! injection.parent)

; =============================================================================
; RPM MACRO DEFINITIONS -> rpmspec
; =============================================================================

(rpm_global) @injection.content
  (#set! injection.parent)

(rpm_define) @injection.content
  (#set! injection.parent)

(rpm_undefine) @injection.content
  (#set! injection.parent)
