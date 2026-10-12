#!/bin/zsh
# Sets a random password on the app's database role and saves the app's connection string in
# .env.hosted. Asks for the OWNER connection string (Supabase: Connect > URI, user postgres...)
# without echo; nothing is printed or stored except .env.hosted.
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

read -s "URL?Plak de Supabase-string van de eigenaar (je ziet niets verschijnen) en druk Enter: "
echo
URL="${URL#DATABASE_URL=}"
URL="${URL//[[:space:]]/}"
URL="${URL#[\"\']}"
URL="${URL%[\"\']}"
case "$URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Dat lijkt geen postgresql://-string. Er is niets gedaan."; exit 1 ;;
esac
OWNER_URL="$URL" npx tsx scripts/db-app-role.ts
