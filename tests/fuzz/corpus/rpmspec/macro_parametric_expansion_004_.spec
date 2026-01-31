%bcond_without luajit

%ifarch x86_64
  %bcond_without test
%endif
