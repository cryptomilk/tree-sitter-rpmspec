%package tools
Summary: Tools
%ifarch riscv64
%global binutils_version_req >= 2.42
%endif
BuildRequires: binutils %{?binutils_version_req}
