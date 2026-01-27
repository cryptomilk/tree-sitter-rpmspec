; Language injection queries for tree-sitter-rpmspec
;
; This file enables syntax highlighting of embedded code within
; RPM spec file scriptlets (%build, %install, %pre, etc.).
;
; Interpreter-based injection:
; - Default (no -p): rpmbash (RPM-aware bash with macro support)
; - -p <lua>: lua
; - -p /path/to/python: python
; - -p /path/to/perl: perl
;
; rpmbash extends tree-sitter-bash to recognize RPM macros (%{...}, %name)
; and conditionals (%if/%endif). These are delegated back to rpmspec via
; injection.parent for proper highlighting.
;
; Requirements:
; - tree-sitter-rpmbash (included), tree-sitter-lua, tree-sitter-python, etc.
; - Editor must support tree-sitter language injection

; ============================================================
; BUILD SCRIPTLETS (%prep, %build, %install, %check, %clean, %conf)
; These always use rpmbash (no interpreter option)
; ============================================================

(prep_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(build_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(install_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(check_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(clean_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(conf_scriptlet (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))
(generate_buildrequires (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; RUNTIME SCRIPTLETS
; ============================================================

; runtime_scriptlet (no -p option) -> rpmbash
; Combine script_line nodes so multi-line constructs (if/fi, case/esac)
; parse in one rpmbash injection.
(runtime_scriptlet
  (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
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

; Bash/sh: -p /bin/bash, -p /bin/sh, -p /usr/bin/bash, etc.
(runtime_scriptlet_interpreter
  interpreter: (script_interpreter
    program: (interpreter_program) @_interp)
  (script_block (script_line) @injection.content)
  (#match? @_interp "(bash|/sh$)")
  (#set! injection.language "rpmbash")
  (#set! injection.include-children)
  (#set! injection.combined))

; ============================================================
; TRIGGERS (have optional interpreter like runtime_scriptlet_interpreter)
; Order: default bash first, specific interpreters last to override
; ============================================================

; Default rpmbash for triggers
(trigger
  (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
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

; Default rpmbash for file triggers
(file_trigger
  (script_block (script_line) @injection.content)
  (#set! injection.language "rpmbash")
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
; Note: Content inside RPM conditionals (%if/%endif, %ifarch/%endif, etc.)
; is included in the parent scriptlet injection via include-children.
; No separate injection needed - rpmbash handles %if/%endif as extras.

; ============================================================
; SHELL COMMAND EXPANSION %(...)
; ============================================================

(shell_command) @injection.content
  (#set! injection.language "rpmbash")
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
