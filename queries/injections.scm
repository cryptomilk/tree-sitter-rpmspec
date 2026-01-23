; Language injection queries for tree-sitter-rpmspec
;
; This file enables syntax highlighting of embedded bash code within
; RPM spec file scriptlets (%build, %install, %check, etc.).
;
; Limitations:
; - Each script_content fragment is parsed independently because RPM macros
;   (%{...}, %name, etc.) and line continuations (\) break up the content
; - Fragments like "--prefix=/usr" may not form valid bash syntax alone,
;   so some highlighting may be incomplete
; - We intentionally avoid injection.combined since concatenating fragments
;   with macro gaps confuses the bash parser
;
; Requirements:
; - tree-sitter-bash must be installed and configured
; - Editor must support tree-sitter language injection

; Inject bash into shell content within scriptlets
(script_block (script_content) @injection.content
  (#set! injection.language "bash"))

; Inject bash into shell content inside conditionals
; Note: shell_if_statement is aliased to if_statement in parse tree
(if_statement (script_content) @injection.content
  (#set! injection.language "bash"))
(scriptlet_elif_clause (script_content) @injection.content
  (#set! injection.language "bash"))
(scriptlet_else_clause (script_content) @injection.content
  (#set! injection.language "bash"))

; ifarch conditionals use scriptlet_elifarch_clause
(ifarch_statement (script_content) @injection.content
  (#set! injection.language "bash"))
(scriptlet_elifarch_clause (script_content) @injection.content
  (#set! injection.language "bash"))

; ifos conditionals use scriptlet_elifos_clause
(ifos_statement (script_content) @injection.content
  (#set! injection.language "bash"))
(scriptlet_elifos_clause (script_content) @injection.content
  (#set! injection.language "bash"))

; Inject bash into shell command expansions %(...)
(shell_command) @injection.content
  (#set! injection.language "bash")
