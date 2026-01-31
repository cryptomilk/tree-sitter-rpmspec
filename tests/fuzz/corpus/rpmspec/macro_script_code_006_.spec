%(pkg-config --cflags %{name} | sed 's/-I/-isystem /g')
