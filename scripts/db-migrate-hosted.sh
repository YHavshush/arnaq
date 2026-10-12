#!/bin/zsh
# Migrates (and seeds) the hosted Postgres. Asks for the connection string without showing it, so it
# never ends up in the shell history, the terminal scrollback or a chat.
# Use the Supabase "Session pooler" string (port 5432) if your network has no IPv6.
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

read -s "URL?Plak je Supabase-string (je ziet niets verschijnen) en druk Enter: "
echo

# Forgive a pasted "DATABASE_URL=", surrounding quotes and stray whitespace or newlines.
URL="${URL#DATABASE_URL=}"
URL="${URL//[[:space:]]/}"
URL="${URL#[\"\']}"
URL="${URL%[\"\']}"

case "$URL" in
  postgres://*|postgresql://*) ;;
  *)
    case "$URL" in
      *://*) echo "Dat is een URL, maar niet postgresql:// (het is een ander soort adres)." ;;
      *) echo "Er staat geen '://' in wat je plakte: dat lijkt geen verbindingsadres (alleen een wachtwoord?)." ;;
    esac
    echo "Neem in Supabase bij Connect het tabblad URI, niet 'psql' of 'Key-value'. Er is niets gedaan."
    exit 1
    ;;
esac
case "$URL" in
  *\?*) SEP="&" ;;
  *) SEP="?" ;;
esac

DATABASE_URL="${URL}${SEP}sslmode=require" npm run db:migrate
