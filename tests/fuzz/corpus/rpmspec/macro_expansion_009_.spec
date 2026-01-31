%global systemd_post() \
if [ $1 -eq 1 ]; then \
    systemctl daemon-reload \
fi \
%{nil}
