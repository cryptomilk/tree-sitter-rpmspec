; Syntax highlighting queries for tree-sitter-rpmspec
;
; Organized following the structure of an RPM spec file:
; 1. Preamble (tags, dependencies)
; 2. Scriptlets (%prep, %build, %install, etc.)
; 3. Files section
; 4. Macros
; 5. Conditionals
; 6. Literals and operators

; =============================================================================
; PREAMBLE
; =============================================================================

; Tags like Name:, Version:, Release:, etc.
[
  (tag)
  (dependency_tag)
] @type.definition

; Dependency tag qualifier (e.g., post in Requires(post):)
(qualifier) @attribute.builtin

; Boolean dependency operators
[
  "if"
  "else"
  "unless"
  "with"
  "without"
] @keyword.operator

; Boolean dependency parentheses
(boolean_dependency
  "(" @punctuation.bracket
  ")" @punctuation.bracket)

; -----------------------------------------------------------------------------
; Dependency Types
; -----------------------------------------------------------------------------

; ELF dependencies: libc.so.6(GLIBC_2.2.5)(64bit)
(elf_dependency
  soname: (soname) @module
  symbol_version: (elf_symbol_version) @property
  arch: (elf_arch) @attribute)

; Path dependencies: /usr/bin/pkg-config
(path_dependency) @string.special.path

; Qualified dependencies: perl(Carp), pkgconfig(glib-2.0)
(qualified_dependency
  name: (_) @function
  qualifier: (dependency_qualifier
    content: (_) @variable.parameter))

; ISA qualifiers override - known architecture patterns
((dependency_qualifier
   content: (word) @attribute)
 (#match? @attribute "^(x86-64|x86-32|aarch64|arm|ppc-64|ppc-32|s390x)$"))

; Simple dependencies: make, cmake-filesystem >= 3
; Note: qualified_dependency also has name field
(qualified_dependency
  name: (_) @module)
(dependency
  (word) @module)

; Source tag file paths
(preamble
  (tag)
  value: (file) @string.special.path)

; Description and package sections
(description
  "%description" @type.definition)
(package
  "%package" @type.definition)

; Sourcelist section
(sourcelist
  "%sourcelist" @type.definition)
(sourcelist
  (file) @string.special.path)

; Patchlist section
(patchlist
  "%patchlist" @type.definition)
(patchlist
  (file) @string.special.path)

; =============================================================================
; SCRIPTLETS
; =============================================================================

; Build scriptlets (%prep, %build, %install, %check, %clean)
(prep_scriptlet
  (section_prep) @module.builtin)
(generate_buildrequires
  (section_generate_buildrequires) @module.builtin)
(conf_scriptlet
  (section_conf) @module.builtin)
(build_scriptlet
  (section_build) @module.builtin)
(install_scriptlet
  (section_install) @module.builtin)
(check_scriptlet
  (section_check) @module.builtin)
(clean_scriptlet
  (section_clean) @module.builtin)

; Runtime scriptlets (%pre, %post, %preun, %postun, etc.)
[
  "%pre"
  "%post"
  "%preun"
  "%postun"
  "%pretrans"
  "%posttrans"
  "%preuntrans"
  "%postuntrans"
  "%verify"
] @module.builtin

; Scriptlet interpreter (-p <program>)
(script_interpreter
  "-p" @variable.parameter)
(interpreter_program) @string.special.path

; Scriptlet augment options (-a, -p for append/prepend)
(scriptlet_augment_option) @variable.parameter

; Trigger scriptlets
[
  "%triggerprein"
  "%triggerin"
  "%triggerun"
  "%triggerpostun"
] @module.builtin

; File trigger scriptlets
[
  "%filetriggerin"
  "%filetriggerun"
  "%filetriggerpostun"
  "%transfiletriggerin"
  "%transfiletriggerun"
  "%transfiletriggerpostun"
] @module.builtin

; -----------------------------------------------------------------------------
; Prep macros (%setup, %autosetup, %patch, %autopatch)
; -----------------------------------------------------------------------------

; All prep macros use macro_option for their options via argument: field
[
  (setup_macro argument: (macro_option) @variable.parameter)
  (autosetup_macro argument: (macro_option) @variable.parameter)
  (autopatch_macro argument: (macro_option) @variable.parameter)
  (patch_macro argument: (macro_option) @variable.parameter)
]

; Patch number arguments
[
  (autopatch_macro (macro_argument) @number)
  (patch_macro (macro_argument) @number)
]

; =============================================================================
; FILES SECTION
; =============================================================================

(files
  "%files" @type.definition)

; File directives
[
  "%artifact"
  "%attr"
  "%caps"
  "%config"
  "%defattr"
  "%dir"
  "%doc"
  "%docdir"
  "%exclude"
  "%ghost"
  "%license"
  "%missingok"
  "%readme"
] @keyword.type

; =============================================================================
; CHANGELOG
; =============================================================================

(changelog
  "%changelog" @type.definition)

; =============================================================================
; MACROS
; =============================================================================

; -----------------------------------------------------------------------------
; Macro definitions
; -----------------------------------------------------------------------------

(macro_definition
  "%" @punctuation.special
  ["define" "global"] @constant.builtin
  name: (identifier) @keyword.macro)

(macro_undefinition
  "%" @punctuation.special
  (builtin) @constant.builtin
  (identifier) @keyword.macro)

; -----------------------------------------------------------------------------
; Simple macro expansion (%name, %!name, %*, etc.)
; -----------------------------------------------------------------------------

(macro_simple_expansion
  "%" @punctuation.special
  (simple_macro) @constant.macro)

(macro_simple_expansion
  "%" @punctuation.special
  (negated_macro) @constant.macro)

(macro_simple_expansion
  "%" @punctuation.special
  (special_macro) @constant.macro)

; -----------------------------------------------------------------------------
; Parametric macro expansion (%name [options] [arguments])
; -----------------------------------------------------------------------------

; Note: parametric_macro_name includes the '%' prefix and is aliased to simple_macro
(macro_parametric_expansion
  name: (simple_macro) @function.macro)

(macro_parametric_expansion
  option: (macro_option) @variable.parameter)

(macro_parametric_expansion
  argument: (word) @variable.parameter)

(macro_parametric_expansion
  argument: (integer) @number)

(macro_parametric_expansion
  argument: (quoted_string) @string)

; Macro options in parametric expansions
(macro_option) @variable.parameter

; -----------------------------------------------------------------------------
; Brace macro expansion (%{name}, %{name:arg}, etc.)
; -----------------------------------------------------------------------------

(macro_expansion
  "%{" @punctuation.special
  "}" @punctuation.special) @none

(macro_expansion
  (builtin) @constant.builtin
  argument: (_) @variable.parameter)

(macro_expansion
  (identifier) @constant.macro)

(macro_expansion
  (identifier)
  argument: [
    (word) @variable.parameter
    (concatenation
      (word) @variable.parameter)
  ])

; Conditional expansion (%{?name}, %{!?name})
(conditional_expansion
  condition: (identifier) @constant.macro)

; -----------------------------------------------------------------------------
; General macro rules
; -----------------------------------------------------------------------------

(special_variable_name) @constant
(builtin) @constant.builtin

; =============================================================================
; CONDITIONALS
; =============================================================================

; Conditional directives
[
  "%if"
  "%ifarch"
  "%ifnarch"
  "%ifos"
  "%ifnos"
  "%elif"
  "%elifarch"
  "%elifos"
  "%else"
  "%endif"
] @keyword.conditional

; Macro conditional operators
[
  "defined"
  "undefined"
] @keyword.operator

; =============================================================================
; LITERALS AND OPERATORS
; =============================================================================

; Numbers
(integer) @number
(float) @number.float
(version) @number.float

; Strings
(quoted_string) @string

; URLs
(url) @string.special.url

; Comments
(comment) @comment

; Comparison and logical operators
[
  "!="
  "<"
  "<="
  "="
  "=="
  ">"
  ">="
  "and"
  "&&"
  "or"
  "||"
] @operator
