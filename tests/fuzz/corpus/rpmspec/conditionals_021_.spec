%if %{with feature_x}
%files x
/usr/bin/x

%if %{with feature_y}
%files y
/usr/bin/y
%endif

%endif
