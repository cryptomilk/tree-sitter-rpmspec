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

; Dependency comparison operators (>=, <=, =, etc.)
(dependency_comparison_operator) @operator

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

; Source tag file paths
(tags
  (tag)
  value: (file) @string.special.path)

; Description and package sections
(description
  (section_name) @type.definition)
(package
  (section_name) @type.definition)

; Sourcelist section
(sourcelist
  (section_name) @type.definition)
(sourcelist
  (file) @string.special.path)

; Patchlist section
(patchlist
  (section_name) @type.definition)
(patchlist
  (file) @string.special.path)

; =============================================================================
; SCRIPTLETS
; =============================================================================

; Build scriptlets (%prep, %build, %install, %check, %clean)
(prep_scriptlet
  (section_name) @module.builtin)
(generate_buildrequires
  (section_name) @module.builtin)
(conf_scriptlet
  (section_name) @module.builtin)
(build_scriptlet
  (section_name) @module.builtin)
(install_scriptlet
  (section_name) @module.builtin)
(check_scriptlet
  (section_name) @module.builtin)
(clean_scriptlet
  (section_name) @module.builtin)

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
  (section_name) @type.definition)

; File directives
[
  "%artifact"
  "%attr"
  "%config"
  "%dir"
  "%doc"
  "%docdir"
  "%ghost"
  "%license"
  "%missingok"
  "%readme"
] @keyword.type

; =============================================================================
; CHANGELOG
; =============================================================================

(changelog
  (section_name) @type.definition)

; =============================================================================
; MACROS
; =============================================================================

; -----------------------------------------------------------------------------
; Macro definitions
; -----------------------------------------------------------------------------

(macro_definition
  "%" @punctuation.special
  (builtin) @constant.builtin
  (identifier) @keyword.macro)

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
