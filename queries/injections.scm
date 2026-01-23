; Language injection queries for tree-sitter-rpmspec
;
; This file enables syntax highlighting of embedded code within
; RPM spec file scriptlets (%build, %install, %pre, etc.).
;
; Interpreter-based injection:
; - Default (no -p): bash
; - -p <lua>: lua
; - -p /path/to/python: python
; - -p /path/to/perl: perl
;
; Limitations:
; - Each script_line is injected independently due to RPM macros
; - Lines with macros may not form valid syntax for the target language
;
; Requirements:
; - tree-sitter-bash, tree-sitter-lua, tree-sitter-python, etc.
; - Editor must support tree-sitter language injection

; ============================================================
; BUILD SCRIPTLETS (%prep, %build, %install, %check, %clean, %conf)
; These always use bash (no interpreter option)
; ============================================================

(prep_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(build_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(install_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(check_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(clean_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(conf_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(generate_buildrequires (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

; ============================================================
; RUNTIME SCRIPTLETS WITH INTERPRETER DETECTION
; ============================================================

; Lua interpreter: -p <lua>
(runtime_scriptlet
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#eq? @_interp "<lua>")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "lua")
  (#set! injection.include-children))

; Python interpreter: -p /path/python or -p /path/python3
(runtime_scriptlet
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "python")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "python")
  (#set! injection.include-children))

; Perl interpreter: -p /path/perl
(runtime_scriptlet
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "perl")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "perl")
  (#set! injection.include-children))

; Default: bash (no interpreter or shell path)
; This must come after specific interpreter matches
(runtime_scriptlet
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

; ============================================================
; TRIGGERS
; ============================================================

; Lua interpreter for triggers
(trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#eq? @_interp "<lua>")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "lua")
  (#set! injection.include-children))

; Perl interpreter for triggers
(trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "perl")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "perl")
  (#set! injection.include-children))

; Default bash for triggers
(trigger
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

; File triggers (same pattern)
(file_trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#eq? @_interp "<lua>")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "lua")
  (#set! injection.include-children))

(file_trigger
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

; ============================================================
; CONDITIONALS INSIDE SCRIPTLETS
; ============================================================

(if_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(scriptlet_elif_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(scriptlet_else_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

(ifarch_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(scriptlet_elifarch_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

(ifos_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))
(scriptlet_elifos_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children))

; ============================================================
; SHELL COMMAND EXPANSION %(...)
; ============================================================

(shell_command) @injection.content
  (#set! injection.language "bash")
  (#set! injection.include-children)

; ============================================================
; LUA MACRO EXPANSION %{lua:...}
; ============================================================

(macro_expansion
  (builtin) @_builtin
  argument: (script_code) @injection.content
  (#eq? @_builtin "lua:")
  (#set! injection.language "lua")
  (#set! injection.include-children))
