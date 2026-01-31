%post boot-efi
if bootctl --quiet is-installed >/dev/null 2>&1 ; then
    bootctl --no-variables --graceful update || echo "warning"
fi
