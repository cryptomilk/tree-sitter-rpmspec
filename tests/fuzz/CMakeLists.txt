# Fuzzing targets for rpmspec and rpmbash parsers
#
# This file builds libFuzzer-based fuzzers with AddressSanitizer,
# UndefinedBehaviorSanitizer, and LeakSanitizer enabled.
#
# Build with: cmake -B build -DENABLE_FUZZING=ON -DCMAKE_C_COMPILER=clang
# Run with:   build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec

include(TSFuzzDictionary)

# Find tree-sitter library (required for the fuzzer)
find_package(TreeSitter REQUIRED)

# Check compiler support for sanitizer flags
# Note: check_c_compiler_flag doesn't work well with combined sanitizer flags
# and linker flags, so we test linking capability directly
set(FUZZER_COMPILE_FLAGS)
set(FUZZER_LINK_FLAGS)

# Test if the compiler supports fuzzer + sanitizers by attempting compilation
include(CheckCSourceCompiles)
set(CMAKE_REQUIRED_FLAGS "-fsanitize=fuzzer,address,undefined")
check_c_source_compiles("
    #include <stdint.h>
    #include <stddef.h>
    int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
        return 0;
    }
" HAVE_FUZZER_SUPPORT)
set(CMAKE_REQUIRED_FLAGS)

if(NOT HAVE_FUZZER_SUPPORT)
    message(FATAL_ERROR "Compiler does not support -fsanitize=fuzzer,address,undefined")
endif()

# Core fuzzer sanitizers (required)
list(APPEND FUZZER_COMPILE_FLAGS -fsanitize=fuzzer,address,undefined)
list(APPEND FUZZER_LINK_FLAGS -fsanitize=fuzzer,address,undefined)

# Sanitizer ignorelist (optional, gracefully degrade if not supported)
set(_ignorelist_flag "-fsanitize-ignorelist=${CMAKE_CURRENT_SOURCE_DIR}/ignorelist.ini")
add_c_compiler_flag_if_supported(${_ignorelist_flag} FUZZER_COMPILE_FLAGS)

# Debug symbols (optional but recommended)
add_c_compiler_flag_if_supported(-g FUZZER_COMPILE_FLAGS)

# Optimization level (optional but recommended for faster fuzzing)
add_c_compiler_flag_if_supported(-O1 FUZZER_COMPILE_FLAGS)

# Helper function to create a fuzzer target
function(add_fuzzer_target name grammar_dir ts_lang)
    set(_grammar_src_dir "${CMAKE_SOURCE_DIR}/${grammar_dir}/src")
    set(_fuzzer_name "fuzz-${name}")

    # Create the fuzzer executable
    add_executable(${_fuzzer_name}
        fuzzer.c
        ${_grammar_src_dir}/parser.c
    )

    # Add scanner.c if it exists
    if(EXISTS "${_grammar_src_dir}/scanner.c")
        target_sources(${_fuzzer_name} PRIVATE ${_grammar_src_dir}/scanner.c)
    endif()

    # Define TS_LANG macro to select the grammar
    target_compile_definitions(${_fuzzer_name} PRIVATE
        TS_LANG=${ts_lang}
    )

    # Include the grammar's source directory
    target_include_directories(${_fuzzer_name} PRIVATE
        ${_grammar_src_dir}
    )

    # Link against tree-sitter library
    target_link_libraries(${_fuzzer_name} PRIVATE TreeSitter::TreeSitter)

    # Add sanitizer flags
    target_compile_options(${_fuzzer_name} PRIVATE ${FUZZER_COMPILE_FLAGS})
    target_link_options(${_fuzzer_name} PRIVATE ${FUZZER_LINK_FLAGS})

    # Set C standard
    set_target_properties(${_fuzzer_name} PROPERTIES
        C_STANDARD 11
        C_STANDARD_REQUIRED ON
    )

    # Generate fuzzer dictionary
    set(_dict_output "${CMAKE_CURRENT_BINARY_DIR}/${name}.dict")
    ts_add_fuzz_dictionary(${_fuzzer_name}-dict
        GRAMMAR_JSON "${_grammar_src_dir}/grammar.json"
        OUTPUT "${_dict_output}"
    )

    # Make fuzzer depend on dictionary (optional but helpful)
    add_dependencies(${_fuzzer_name} ${_fuzzer_name}-dict)
endfunction()

# Create fuzzer targets
add_fuzzer_target(rpmspec "rpmspec" tree_sitter_rpmspec)
add_fuzzer_target(rpmbash "rpmbash" tree_sitter_rpmbash)

# Aggregate target to build all fuzzers
add_custom_target(fuzzers ALL
    DEPENDS fuzz-rpmspec fuzz-rpmbash
    COMMENT "Build all fuzzer targets"
)
