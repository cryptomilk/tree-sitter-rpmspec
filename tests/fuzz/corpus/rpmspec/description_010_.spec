%description main
Main description.

%if %{with feature}
%package feature
Summary: Feature package

%description feature
Feature description.

%package feature-devel
Summary: Feature development files

%description feature-devel
Devel description.
%endif
