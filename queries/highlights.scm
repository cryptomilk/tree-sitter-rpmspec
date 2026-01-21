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
(qualifier) @attribute

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

; =============================================================================
; SCRIPTLETS
; =============================================================================

; Build scriptlets (%prep, %build, %install, %check, %clean)
(prep_scriptlet
  (section_name) @function.builtin)
(generate_buildrequires
  (section_name) @function.builtin)
(conf_scriptlet
  (section_name) @function.builtin)
(build_scriptlet
  (section_name) @function.builtin)
(install_scriptlet
  (section_name) @function.builtin)
(check_scriptlet
  (section_name) @function.builtin)
(clean_scriptlet
  (section_name) @function.builtin)

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
] @function.builtin

; Trigger scriptlets
[
  "%triggerprein"
  "%triggerin"
  "%triggerun"
  "%triggerpostun"
] @function.builtin

; File trigger scriptlets
[
  "%filetriggerin"
  "%filetriggerun"
  "%filetriggerpostun"
  "%transfiletriggerin"
  "%transfiletriggerun"
  "%transfiletriggerpostun"
] @function.builtin

; -----------------------------------------------------------------------------
; Prep macros (%setup, %autosetup, %patch, %autopatch)
; -----------------------------------------------------------------------------

(setup_macro
  argument: [
    (setup_flag) @variable.parameter
    (setup_source_option) @variable.parameter
    ((setup_name_option
      directory: (_) @string) @variable.parameter)
  ])

(autosetup_macro
  [
    (autosetup_option) @variable.parameter
  ])

(autopatch_macro
  [
    (autopatch_option) @variable.parameter
    (autopatch_argument) @number
  ])

(patch_macro
  [
    (patch_option) @variable.parameter
    (patch_argument) @number
  ])

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
  (builtin) @keyword.directive.define
  (identifier) @keyword.macro)

(macro_undefinition
  (builtin) @keyword.directive.define
  (identifier) @keyword.macro)

; -----------------------------------------------------------------------------
; Simple macro expansion (%name, %!name, %*, etc.)
; -----------------------------------------------------------------------------

(macro_simple_expansion
  "%" @punctuation.special
  (simple_macro) @function.macro)

(macro_simple_expansion
  "%" @punctuation.special
  (negated_macro) @function.macro)

(macro_simple_expansion
  "%" @punctuation.special
  (special_macro) @constant)

; -----------------------------------------------------------------------------
; Parametric macro expansion (%name [options] [arguments])
; -----------------------------------------------------------------------------

(macro_parametric_expansion
  "%" @punctuation.special
  name: (simple_macro) @function.call)

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
  (builtin) @variable.builtin
  argument: (_) @variable.parameter)

(macro_expansion
  (identifier) @function.call
  argument: [
    (word) @variable.parameter
    (concatenation
      (word) @variable.parameter)
  ])

; -----------------------------------------------------------------------------
; General macro rules
; -----------------------------------------------------------------------------

(special_variable_name) @constant
(builtin) @variable.builtin

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
