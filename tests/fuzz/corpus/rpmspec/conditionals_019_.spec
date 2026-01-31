%ifarch x86_64
BuildRequires:  x86_64-package
%elifarch aarch64
BuildRequires:  aarch64-package
%else
BuildRequires:  generic-package
%endif
