./configure \
        --enable-fhs \
        --with-piddir=/run \
%if %{without dc}
        --without-dc \
%endif
        --with-systemd
