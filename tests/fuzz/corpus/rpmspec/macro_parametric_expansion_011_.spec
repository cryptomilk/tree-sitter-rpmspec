%build
KCFLAGS="-fno-pie -fdebug-prefix-map=$(%python3 -c '%find_vmlinux_h')"
