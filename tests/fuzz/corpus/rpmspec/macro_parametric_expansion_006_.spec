%build
%configure \
  --prefix=/usr \
%if %{with unittests}
  --enable-unittests \
%endif
  --with-systemd
