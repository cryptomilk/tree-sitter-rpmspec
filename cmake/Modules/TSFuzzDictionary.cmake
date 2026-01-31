#[=======================================================================[.rst:
TSFuzzDictionary
----------------

Generate libFuzzer dictionaries from tree-sitter grammar.json files.

.. command:: ts_add_fuzz_dictionary

  Creates a custom target to generate a fuzzer dictionary::

    ts_add_fuzz_dictionary(<name>
        GRAMMAR_JSON <path>
        OUTPUT <path>
    )

  This function extracts STRING and ALIAS tokens from the grammar.json file
  and generates a libFuzzer dictionary to improve fuzzing efficiency.

  Requires: jq, awk, iconv (gracefully degrades with warning if not found)

  Example usage::

    ts_add_fuzz_dictionary(rpmspec-fuzz-dict
        GRAMMAR_JSON "${CMAKE_CURRENT_SOURCE_DIR}/src/grammar.json"
        OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/fuzz.dict"
    )

#]=======================================================================]

# Find required tools (cached, so only searched once)
find_program(JQ_EXECUTABLE jq DOC "jq - command-line JSON processor")
find_program(AWK_EXECUTABLE awk DOC "awk - pattern scanning and processing language")
find_program(ICONV_EXECUTABLE iconv DOC "iconv - character encoding converter")

function(ts_add_fuzz_dictionary name)
    # Parse arguments: GRAMMAR_JSON and OUTPUT are required
    cmake_parse_arguments(PARSE_ARGV 1 ARG "" "GRAMMAR_JSON;OUTPUT" "")

    # Validate arguments
    if(NOT ARG_GRAMMAR_JSON)
        message(FATAL_ERROR "ts_add_fuzz_dictionary: GRAMMAR_JSON argument required")
    endif()

    if(NOT ARG_OUTPUT)
        message(FATAL_ERROR "ts_add_fuzz_dictionary: OUTPUT argument required")
    endif()

    # Check if required tools are available
    if(NOT JQ_EXECUTABLE)
        message(WARNING "jq not found - cannot generate fuzz dictionary for ${name}")
        message(WARNING "Install jq from your package manager or https://jqlang.github.io/jq/")
        return()
    endif()

    if(NOT AWK_EXECUTABLE)
        message(WARNING "awk not found - cannot generate fuzz dictionary for ${name}")
        return()
    endif()

    if(NOT ICONV_EXECUTABLE)
        message(WARNING "iconv not found - cannot generate fuzz dictionary for ${name}")
        return()
    endif()

    # jq filter to extract STRING and ALIAS tokens from grammar.json
    # Recursively descends, selecting nodes where:
    # - type is "STRING", OR
    # - type is "ALIAS" and named is false
    # - AND value is not empty
    # Then outputs just the value field
    set(_jq_filter ".. | select((.type? == \"STRING\" or (.type? == \"ALIAS\" and .named? == false)) and .value? != \"\") | .value")

    # awk script to filter and clean dictionary entries
    # - Skip entries containing backslashes (escape sequences like \n, \r, \\, \u0000)
    # - Skip empty or whitespace-only entries
    # - Remove duplicates while preserving order
    # - Keep quoted format for libFuzzer
    # Using index() instead of regex to avoid escaping issues
    set(_awk_script "!seen[$0]++ && index($0,\"\\\\\")== 0 && NF>0 && $0!=\"\\\"\\\"\"")

    # Create the dictionary generation command
    # Pipeline:
    #   1. jq: Extract tokens from grammar.json (outputs quoted strings)
    #   2. awk: Filter out escape sequences, empty lines, and duplicates
    #   3. iconv: Convert to ASCII, transliterating non-ASCII chars
    add_custom_command(
        OUTPUT "${ARG_OUTPUT}"
        COMMAND ${CMAKE_COMMAND} -E env
                ${JQ_EXECUTABLE} "${_jq_filter}" "${ARG_GRAMMAR_JSON}"
                | ${AWK_EXECUTABLE} "${_awk_script}"
                | ${ICONV_EXECUTABLE} -c -f UTF-8 -t ASCII//TRANSLIT
                > "${ARG_OUTPUT}"
        DEPENDS "${ARG_GRAMMAR_JSON}"
        COMMENT "Generating fuzzer dictionary: ${name}"
        VERBATIM
        COMMAND_EXPAND_LISTS
    )

    # Create a target that depends on the generated file
    add_custom_target(${name} DEPENDS "${ARG_OUTPUT}")
endfunction()
