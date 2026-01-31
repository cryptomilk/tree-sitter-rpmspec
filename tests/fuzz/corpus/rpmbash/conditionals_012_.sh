%configure \
        --enable-fhs \
%if %{without dc}
        --without-dc \
%endif
%if %{with ssl}
        --with-ssl \
%endif
        --with-systemd
