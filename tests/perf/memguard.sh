#!/bin/bash
# memguard.sh <command...>: runs the command, and kills it and every process under it if any one of them
# passes 1.5 GB resident, or all of them together pass 4 GB (MEMGUARD_PER_MB / MEMGUARD_ALL_MB to change).
# Only its own process tree: other test browsers on the machine (another agent's, say) are never touched.
# (From the guard the earlier X-Flyer passes ran under; that one pkill'd every Chrome for Testing.)
PER_KB=$(( ${MEMGUARD_PER_MB:-1536} * 1024 ))
ALL_KB=$(( ${MEMGUARD_ALL_MB:-4096} * 1024 ))
"$@" & PID=$!
trap 'kill $PID 2>/dev/null' TERM INT
# the command's pid and everything below it: "pid rss" lines
tree() {
  ps -Ao pid=,ppid=,rss= | awk -v root="$PID" '
    { par[$1] = $2; rss[$1] = $3 }
    END {
      keep[root] = 1; more = 1
      while (more) { more = 0; for (p in par) if (!(p in keep) && (par[p] in keep)) { keep[p] = 1; more = 1 } }
      for (p in keep) if (p in rss) print p, rss[p]
    }'
}
while kill -0 $PID 2>/dev/null; do
  read -r mx sum pids < <(tree | awk '{ if ($2 > m) m = $2; s += $2; ids = ids " " $1 } END { print m + 0, s + 0, ids }')
  if [ "${mx:-0}" -gt "$PER_KB" ] || [ "${sum:-0}" -gt "$ALL_KB" ]; then
    echo "memguard: a process at $((mx / 1024)) MB (all $((sum / 1024)) MB), killing pids$pids" >&2
    kill -9 $pids 2>/dev/null
    break
  fi
  sleep 1
done
wait $PID
