; Highlight macro options in parametric expansions
(macro_option) @variable.parameter

; Simple macro expansion tokens from external scanner
(macro_simple_expansion
  "%" @punctuation.special
  (simple_macro) @function.macro)
(macro_simple_expansion
  "%" @punctuation.special
  (negated_macro) @function.macro)
(macro_simple_expansion
  "%" @punctuation.special
  (special_macro) @constant)

; Parametric macro expansion: %name [options] [arguments]
; The name is a function call, options and arguments are parameters
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

; Macro expansion rules
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

; Macro definition and undefinition
(macro_definition
  "%" @punctuation.special
  (builtin) @keyword.directive.define
  (identifier) @keyword.macro)
(macro_undefinition
  (builtin) @keyword.directive.define
  (identifier) @keyword.macro)

; General punctuation for macros
(macro_expansion
  "%{" @punctuation.special
  "}" @punctuation.special) @none

; General identifier and builtin rules (must come after specific rules)
(special_variable_name) @constant
(builtin) @variable.builtin

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

(patch_macro
  [
    (patch_option) @variable.parameter
    (patch_argument) @number
  ])

[
  (tag)
  (dependency_tag)
] @type.definition

(integer) @number
(float) @number.float
(version) @number.float

(comment) @comment
;(string) @string
(quoted_string) @string

(description
  (section_name) @type.definition)
(package
  (section_name) @type.definition)
(files
  (section_name) @type.definition)
(changelog
  (section_name) @type.definition)

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

[
  "%triggerprein"
  "%triggerin"
  "%triggerun"
  "%triggerpostun"
] @function.builtin

[
  "%filetriggerin"
  "%filetriggerun"
  "%filetriggerpostun"
  "%transfiletriggerin"
  "%transfiletriggerun"
  "%transfiletriggerpostun"
] @function.builtin

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

; Dependency comparison operators
(dependency_comparison_operator) @operator

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

; Dependency tag qualifier (e.g., post in Requires(post):)
(qualifier) @attribute

; Macro conditional operators
[
  "defined"
  "undefined"
] @keyword.operator

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

; Fallback rule for identifiers (commented out due to conflicts with parametric macros)
; (identifier) @variable
