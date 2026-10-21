#!/bin/zsh
# Runs the app on http://localhost:3300 against the hosted Supabase database. The connection
# string is asked for without echo and only lives in this process: it is not written to a file.
# Use the Supabase "Session pooler" string (URI tab).
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

read -s "URL?Plak je Supabase-string (je ziet niets verschijnen) en druk Enter: "
echo

URL="${URL#DATABASE_URL=}"
URL="${URL//[[:space:]]/}"
URL="${URL#[\"\']}"
URL="${URL%[\"\']}"

case "$URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "Dat lijkt geen postgresql://-string. Er is niets gedaan."
    exit 1
    ;;
esac
case "$URL" in
  *\?*) SEP="&" ;;
  *) SEP="?" ;;
esac

echo "arnaq draait op http://localhost:3300 en gebruikt je Supabase-database. Stoppen: Ctrl-C."
DATABASE_URL="${URL}${SEP}sslmode=require" npm run dev -- -p 3300
