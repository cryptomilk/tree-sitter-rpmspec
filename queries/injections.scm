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
  (#set! injection.include-children)
  (#set! injection.combined))
(build_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(install_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(check_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(clean_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(conf_scriptlet (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(generate_buildrequires (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; RUNTIME SCRIPTLETS
; ============================================================

; runtime_scriptlet (no -p option) -> bash
; Combine script_line nodes so multi-line constructs (if/fi, case/esac)
; parse in one bash injection while skipping macro-only lines.
(runtime_scriptlet
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; RUNTIME SCRIPTLETS WITH INTERPRETER (-p option)
; Each pattern checks the interpreter value explicitly
; ============================================================

; Lua: -p <lua>
; Inject entire script_block so multi-line constructs work
(runtime_scriptlet_interpreter
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block) @injection.content
  (#eq? @_interp "<lua>")
  (#set! injection.language "lua")
  (#set! injection.include-children))

; Python: -p /path/python or -p /path/python3
; Inject entire script_block so multi-line constructs work
(runtime_scriptlet_interpreter
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block) @injection.content
  (#match? @_interp "python")
  (#set! injection.language "python")
  (#set! injection.include-children))

; Perl: -p /path/perl
; Inject entire script_block so multi-line constructs work
(runtime_scriptlet_interpreter
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block) @injection.content
  (#match? @_interp "perl")
  (#set! injection.language "perl")
  (#set! injection.include-children))

; Bash: -p /bin/bash, -p /bin/sh, -p /usr/bin/bash, etc.
(runtime_scriptlet_interpreter
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "(bash|/sh$)")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; TRIGGERS (have optional interpreter like runtime_scriptlet_interpreter)
; Order: default bash first, specific interpreters last to override
; ============================================================

; Default bash for triggers
(trigger
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

; Lua interpreter for triggers
(trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#eq? @_interp "<lua>")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "lua")
  (#set! injection.include-children)
  (#set! injection.combined))

; Perl interpreter for triggers
(trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "perl")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "perl")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; FILE TRIGGERS
; ============================================================

; Default bash for file triggers
(file_trigger
  (script_block (script_line) @injection.content)
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

; Lua interpreter for file triggers
(file_trigger
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#eq? @_interp "<lua>")
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "lua")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; CONDITIONALS INSIDE SCRIPTLETS
; ============================================================

(if_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(scriptlet_elif_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(scriptlet_else_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

(ifarch_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(scriptlet_elifarch_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

(ifos_statement (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))
(scriptlet_elifos_clause (script_line) @injection.content
  (#not-match? @injection.content "^\\s*[%]")
  (#set! injection.language "bash")
  (#set! injection.include-children)
  (#set! injection.combined))

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
  (#set! injection.include-children)
  (#set! injection.combined))
