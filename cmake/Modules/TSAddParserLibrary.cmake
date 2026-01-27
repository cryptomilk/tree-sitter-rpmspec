#[=======================================================================[.rst:
TSAddParserLibrary
------------------

Create a tree-sitter parser library target.

.. command:: ts_add_parser_library

  Creates a library target for a tree-sitter parser with standard configuration::

    ts_add_parser_library(<name>)

  This function creates a ``tree-sitter-<name>`` library target with:

  - ``src/parser.c`` as the main source (required)
  - ``src/scanner.c`` as additional source (if it exists)
  - PICKY_DEVELOPER warning flags applied to scanner.c
  - pkg-config file generation and installation
  - Query files installation (if queries/ directory exists)

  The function expects to be called from a directory containing:

  - ``src/parser.c`` or ``src/grammar.json`` (to generate parser.c)
  - ``src/scanner.c`` (optional)
  - ``queries/*.scm`` (optional)
  - ``bindings/c/tree-sitter-<name>.pc.in`` (for pkg-config)

  Set ``PROJECT_DESCRIPTION`` before calling to customize the description.

  Example usage::

    set(PROJECT_DESCRIPTION "RPM-aware Bash grammar for tree-sitter")
    ts_add_parser_library(rpmbash)

#]=======================================================================]

function(ts_add_parser_library name)
    set(_target "tree-sitter-${name}")
    set(_src_dir "${CMAKE_CURRENT_SOURCE_DIR}/src")

    # Generate parser.c from grammar.json if needed
    add_custom_command(
        OUTPUT "${_src_dir}/parser.c"
        DEPENDS "${_src_dir}/grammar.json"
        COMMAND "${TREE_SITTER_CLI}" generate src/grammar.json
                --abi=${TREE_SITTER_ABI_VERSION}
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Generating ${name}/src/parser.c"
    )

    # Create library target
    add_library(${_target} "${_src_dir}/parser.c")

    # Add scanner.c if it exists
    if(EXISTS "${_src_dir}/scanner.c")
        target_sources(${_target} PRIVATE "${_src_dir}/scanner.c")
        if(SCANNER_WARNING_FLAGS)
            set_source_files_properties(
                "${_src_dir}/scanner.c"
                PROPERTIES COMPILE_OPTIONS "${SCANNER_WARNING_FLAGS}"
            )
        endif()
    endif()

    # Include directories
    target_include_directories(${_target}
        PRIVATE "${_src_dir}"
        INTERFACE
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/bindings/c>
            $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
    )

    # Compile definitions
    target_compile_definitions(${_target} PRIVATE
        $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
        $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>
    )

    # Target properties
    set_target_properties(${_target} PROPERTIES
        C_STANDARD 11
        POSITION_INDEPENDENT_CODE ON
        SOVERSION "${TREE_SITTER_ABI_VERSION}.${PROJECT_VERSION_MAJOR}"
        DEFINE_SYMBOL ""
    )

    # pkg-config file
    set(_pc_in "${CMAKE_CURRENT_SOURCE_DIR}/bindings/c/${_target}.pc.in")
    if(EXISTS "${_pc_in}")
        configure_file(
            "${_pc_in}"
            "${CMAKE_CURRENT_BINARY_DIR}/${_target}.pc"
            @ONLY
        )
        install(
            FILES "${CMAKE_CURRENT_BINARY_DIR}/${_target}.pc"
            DESTINATION "${CMAKE_INSTALL_DATAROOTDIR}/pkgconfig"
        )
    endif()

    # Install headers
    set(_headers_dir "${CMAKE_CURRENT_SOURCE_DIR}/bindings/c/tree_sitter")
    if(EXISTS "${_headers_dir}")
        install(
            DIRECTORY "${_headers_dir}"
            DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}"
            FILES_MATCHING PATTERN "*.h"
        )
    endif()

    # Install library
    install(
        TARGETS ${_target}
        LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}"
    )

    # Install queries
    file(GLOB _queries "${CMAKE_CURRENT_SOURCE_DIR}/queries/*.scm")
    if(_queries)
        install(
            FILES ${_queries}
            DESTINATION "${CMAKE_INSTALL_DATADIR}/tree-sitter/queries/${name}"
        )
    endif()
endfunction()
