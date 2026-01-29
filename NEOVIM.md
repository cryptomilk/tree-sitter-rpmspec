# Neovim: Install tree-sitter-rpmspec

This project provides two tree-sitter grammars for Neovim:

- **rpmspec**: Main RPM spec file grammar
- **rpmbash**: RPM-aware bash grammar (used for scriptlet injection)

Both are needed for full syntax highlighting with language injection.

## User Setup

Add the following to your Neovim configuration to register the parsers with
nvim-treesitter. This allows you to install them via
`:TSInstall rpmspec rpmbash`.

```lua
vim.api.nvim_create_autocmd('User', {
    pattern = 'TSUpdate',
    callback = function()
        require('nvim-treesitter.parsers').rpmspec = {
            install_info = {
                url = 'https://github.com/cryptomilk/tree-sitter-rpmspec',
                location = 'rpmspec',
                queries = 'neovim/queries/rpmspec',
            },
        }

        require('nvim-treesitter.parsers').rpmbash = {
            install_info = {
                url = 'https://github.com/cryptomilk/tree-sitter-rpmspec',
                location = 'rpmbash',
                queries = 'neovim/queries/rpmbash',
            },
        }
    end,
})
```

After adding this configuration:

1. Restart Neovim
2. Run `:TSInstall rpmspec rpmbash`
3. Open a `.spec` file to see syntax highlighting

## Developer Setup

This section is for developers working on the grammar who want to test changes
in Neovim. For end-user installation, see the User Setup section above.

### Quick Start

The `neovim/` directory is pre-configured with symlinks to parsers and queries.
Build the project and generate Neovim-specific files:

```bash
# Build the parsers
make configure
make build

# Generate Neovim query files (adds bash inheritance for rpmbash)
make neovim
```

```lua
-- Add to your Neovim config
vim.opt.runtimepath:prepend('/path/to/tree-sitter-rpmspec/neovim')
```

### Manual Setup (alternative)

If you prefer to set up symlinks yourself:

```bash
# Create parser directory with symlinks to built libraries
mkdir -p parser
ln -sf ../build/rpmspec/libtree-sitter-rpmspec.so parser/rpmspec.so
ln -sf ../build/rpmbash/libtree-sitter-rpmbash.so parser/rpmbash.so

# Create queries symlinks (Neovim expects queries/<lang>/)
mkdir -p queries
ln -sf ../rpmspec/queries queries/rpmspec
ln -sf ../rpmbash/queries queries/rpmbash
```

Then point Neovim to the repo root:

```lua
vim.opt.runtimepath:prepend('/path/to/tree-sitter-rpmspec')
```

### Auto command to add it for filetype

This will load rpmspec automatically for the spec filetype and allow you to use
`:InspectTree`. Both rpmspec and rpmbash are loaded so injection works.

```lua
local rpmspec_path = '/path/to/tree-sitter-rpmspec/neovim'

-- Add path for queries and parsers
vim.opt.runtimepath:prepend(rpmspec_path)

vim.treesitter.language.register('rpmspec', 'spec')

local augroup = vim.api.nvim_create_augroup('rpmspec', {})
vim.api.nvim_create_autocmd('FileType', {
    group = augroup,
    pattern = { 'spec' },
    callback = function(args)
        vim.treesitter.start(args.buf, 'rpmspec')

        vim.bo.commentstring = "# %s"
        vim.bo.comments = "b:#"
    end,
})
```

### Verify injection is working

Open a spec file with scriptlets and run:

```vim
:InspectTree
```

You should see:
- `script_block` / `script_line` nodes in the rpmspec tree
- Injected rpmbash parsing for bash content
- RPM macros (`rpm_macro_expansion`, `rpm_macro_simple`) delegated back to rpmspec
