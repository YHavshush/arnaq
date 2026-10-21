import type { Locale } from "./config";

/**
 * Messages from the server code (validation, import) are written in English, which is also what
 * logs and API clients see. For a Dutch reader they are translated here, by pattern, at the edge
 * where they leave the app. An unknown message stays English: never a wrong translation, never a
 * missing text. Add a pair here when a new message can reach the screen.
 */
type Rule = [RegExp, (m: RegExpExecArray) => string];

const bank = (b: string) => (b === "rabobank" ? "Rabobank" : b === "revolut" ? "Revolut" : b);

const NL: Rule[] = [
  [/^Not signed in\.$/, () => "Je bent niet ingelogd."],
  // import
  [
    /^Several (\w+) accounts exist, pick one with accountId\.$/,
    (m) => `Er zijn meerdere ${bank(m[1])}-rekeningen. Kies onder Opties welke rekening dit is.`,
  ],
  [/^Invalid month "(.*)", use YYYY-MM\.$/, (m) => `Ongeldige maand "${m[1]}". Gebruik JJJJ-MM.`],
  [
    /^Invalid date "(.*)", use YYYY-MM-DD\.$/,
    (m) => `Ongeldige datum "${m[1]}". Gebruik JJJJ-MM-DD.`,
  ],
  [/^Account (\d+) does not exist\.$/, (m) => `Rekening ${m[1]} bestaat niet.`],
  [
    /^This looks like a (\w+) file but account \d+ is (\w+)\.$/,
    (m) =>
      `Dit lijkt een ${bank(m[1])}-bestand, maar de gekozen rekening is een ${bank(m[2])}-rekening.`,
  ],
  [
    /^Could not recognise this (?:file|CSV) as a Rabobank or Revolut export\.$/,
    () => "Dit bestand is niet herkend als Revolut-CSV of Rabobank-afschrift.",
  ],
  [
    /^Too many rows \(max (\d+) per file\)\.$/,
    (m) => `Te veel regels (maximaal ${m[1]} per bestand).`,
  ],
  [/^The file contains no transactions\.$/, () => "Het bestand bevat geen transacties."],
  [
    /^No importable rows found, so the month cannot be detected\. Pass a month\.$/,
    () =>
      "Er zijn geen regels om te importeren, dus de maand is niet te bepalen. Kies een maand onder Opties.",
  ],
  [
    /^(\d+) row\(s\) fall outside (\S+); they were imported anyway\.$/,
    (m) => `${m[1]} regel(s) vallen buiten ${m[2]}; ze zijn toch geïmporteerd.`,
  ],
  [
    /^(\d+) row\(s\) are not in (\w+); review them manually\.$/,
    (m) => `${m[1]} regel(s) staan niet in ${m[2]}; kijk ze zelf na.`,
  ],
  [
    /^Not a Revolut export, missing: (.*)$/,
    (m) => `Dit is geen Revolut-export; er ontbreken kolommen: ${m[1]}`,
  ],
  [
    /^Not a Rabobank export, missing: (.*)$/,
    (m) => `Dit is geen Rabobank-export; er ontbreken kolommen: ${m[1]}`,
  ],
  [
    /^State (.*), only COMPLETED is imported$/,
    (m) => `Status ${m[1] === "(empty)" ? "(leeg)" : m[1]}; alleen COMPLETED wordt geïmporteerd`,
  ],
  [/^Invalid date "(.*)"$/, (m) => `Ongeldige datum "${m[1]}"`],
  [/^Cannot read CSV: (.*)$/, (m) => `Het CSV-bestand kan niet gelezen worden (${m[1]}).`],
  [/^Invalid amount: "(.*)"$/, (m) => `Ongeldig bedrag: "${m[1]}"`],
  [/^Amount out of range: "(.*)"$/, (m) => `Bedrag te groot: "${m[1]}"`],
  // PDF statements
  [
    /^Could not read "(.*)" from the statement\.$/,
    (m) => `Kon "${m[1]}" niet lezen uit het afschrift.`,
  ],
  [
    /^Could not read the period of the statement\.$/,
    () => "Kon de periode van het afschrift niet lezen.",
  ],
  [
    /^The period of the statement is not valid\.$/,
    () => "De periode van het afschrift klopt niet.",
  ],
  [
    /^Could not read the account number from the statement\.$/,
    () => "Kon het rekeningnummer niet lezen uit het afschrift.",
  ],
  [/^Row without a date or an amount$/, () => "Regel zonder datum of bedrag"],
  [/^Date outside the statement period$/, () => "Datum buiten de periode van het afschrift"],
  [
    /^The statement could not be read reliably: .*$/,
    () =>
      "Het afschrift kon niet betrouwbaar gelezen worden: de transacties kloppen niet met de totalen en saldi op het afschrift. Er is niets geïmporteerd. Download het afschrift opnieuw of gebruik de CSV-export.",
  ],
  [
    /^This PDF is too complex to be a statement\.$/,
    () => "Dit PDF-bestand is te complex voor een afschrift.",
  ],
  [/^This PDF could not be read\.$/, () => "Dit PDF-bestand kon niet gelezen worden."],
  [
    /^This PDF is not a Rabobank statement\. Only Rabobank statements are read\.$/,
    () => "Dit PDF-bestand is geen Rabobank-afschrift. Alleen Rabobank-afschriften worden gelezen.",
  ],
  [
    /^This statement belongs to a different account than the one chosen\.$/,
    () => "Dit afschrift hoort bij een andere rekening dan de gekozen rekening.",
  ],
  // upload route and API
  [/^File too large \(max 2 MB\)\.$/, () => "Dit bestand is te groot (maximaal 2 MB)."],
  [/^Expected multipart\/form-data\.$/, () => "Verwacht een bestand (multipart/form-data)."],
  [/^Missing file\.$/, () => "Er is geen bestand meegestuurd."],
  [/^Invalid accountId\.$/, () => "Ongeldige rekening."],
  [/^Invalid JSON body\.$/, () => "Ongeldige invoer."],
  [
    /^The request conflicts with existing data \(unknown reference or duplicate\)\.$/,
    () => "Dit past niet bij wat er al is (onbekende verwijzing of dubbele waarde).",
  ],
  // budget and rules
  [
    /^Budget amount must be a non-negative integer number of cents\.$/,
    () => "Een budget moet een bedrag van nul of meer zijn.",
  ],
  [/^Transaction (\d+) does not exist\.$/, (m) => `Transactie ${m[1]} bestaat niet.`],
  [/^Category (\d+) does not exist\.$/, (m) => `Categorie ${m[1]} bestaat niet.`],
  [/^Cannot create a rule without a pattern\.$/, () => "Een regel heeft een zoektekst nodig."],
  // savings
  [
    /^The savings goal must be a positive amount\.$/,
    () => "Het spaardoel moet een bedrag boven nul zijn.",
  ],
  [
    /^The amount already saved cannot be negative\.$/,
    () => "Het al gespaarde bedrag kan niet negatief zijn.",
  ],
  // sample data
  [
    /^Sample data can only be added to an empty account\.$/,
    () => "Voorbeeldgegevens kun je alleen toevoegen aan een leeg account.",
  ],
  // fixed costs
  [/^Name is required\.$/, () => "Geef de vaste post een naam."],
  [/^Name is too long \(max (\d+)\)\.$/, (m) => `De naam is te lang (maximaal ${m[1]} tekens).`],
  [/^Type must be "expense" or "income"\.$/, () => "Kies uitgave of inkomen."],
  [
    /^Give a counterparty name or an IBAN to match on\.$/,
    () =>
      "Geef een naam zoals op je afschrift, of een rekeningnummer, om de betaling te herkennen.",
  ],
  [
    /^Counterparty or IBAN is too long\.$/,
    () => "De naam op het afschrift of het rekeningnummer is te lang.",
  ],
  [
    /^Expected amount must be a positive integer number of cents\.$/,
    () => "Het bedrag moet groter dan nul zijn.",
  ],
  [
    /^Tolerance must be a non-negative integer number of cents\.$/,
    () => "De marge moet nul of meer zijn.",
  ],
  [
    /^Day of month must be between 1 and 31\.$/,
    () => "De dag van de maand moet tussen 1 en 31 liggen.",
  ],
  [
    /^Frequency must be "monthly", "quarterly" or "yearly"\.$/,
    () => "Kies per maand, per kwartaal of per jaar.",
  ],
  [/^Invalid start date "(.*)", use YYYY-MM-DD\.$/, (m) => `Ongeldige begindatum "${m[1]}".`],
  [/^Invalid end date "(.*)", use YYYY-MM-DD\.$/, (m) => `Ongeldige einddatum "${m[1]}".`],
  [
    /^End date must not be before the start date\.$/,
    () => "De einddatum mag niet voor de begindatum liggen.",
  ],
  [
    /^Category "(.*)" is not an? (expense|income) category\.$/,
    (m) =>
      `Categorie "${m[1]}" hoort niet bij ${m[2] === "expense" ? "een uitgave" : "een inkomen"}.`,
  ],
  [/^active must be true or false\.$/, () => "Actief moet aan of uit zijn."],
  [
    /^At most (\d+) recurring items are supported\.$/,
    (m) => `Er kunnen maximaal ${m[1]} vaste posten zijn.`,
  ],
  [/^Recurring item (\d+) does not exist\.$/, (m) => `Vaste post ${m[1]} bestaat niet.`],
  [
    /^(Start|End) date must be between (\S+) and (\S+)\.$/,
    (m) =>
      `De ${m[1] === "Start" ? "begindatum" : "einddatum"} moet tussen ${m[2]} en ${m[3]} liggen.`,
  ],
  [/^There is no such suggestion \(any more\)\.$/, () => "Deze suggestie bestaat niet (meer)."],
  [/^Suggestion key is required\.$/, () => "De suggestie is onvolledig."],
];

/** The message in the reader's language; English (as thrown) when there is no translation. */
export function localizeMessage(message: string, locale: Locale): string {
  if (locale === "en") return message;
  for (const [re, make] of NL) {
    const m = re.exec(message);
    if (m) return make(m);
  }
  return message;
}
