%files
%config(noreplace) /etc/myapp.conf
%config(missingok) /etc/optional.conf
%config(noreplace,missingok) /etc/combined.conf
