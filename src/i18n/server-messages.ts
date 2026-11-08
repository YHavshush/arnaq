import { bankName } from "@/lib/import/banks";
import type { Locale } from "./config";

/**
 * Messages from the server code (validation, import) are written in English, which is also what
 * logs and API clients see. For a Dutch reader they are translated here, by pattern, at the edge
 * where they leave the app. An unknown message stays English: never a wrong translation, never a
 * missing text. Add a pair here when a new message can reach the screen.
 */
type Rule = [RegExp, (m: RegExpExecArray) => string];

const bank = bankName;

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
    /^Could not recognise this (?:file|CSV) as (?:a Rabobank or Revolut export|an export from a bank the app reads)\.$/,
    () =>
      "Dit bestand is niet herkend. Ik lees CSV of TXT van Rabobank, Revolut, ABN AMRO, ING en Knab, en Rabobank-afschriften als PDF.",
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
    /^A difference of (-?[\d.]+) on (\d{4}-\d{2}-\d{2}) is missing from the statement\. It was added as "Unlisted difference" so the balance is right: please sort it\.$/,
    (m) =>
      `Een verschil van ${m[1].replace(".", ",")} op ${m[2]} staat niet op het afschrift. Het is toegevoegd als "Unlisted difference" zodat het saldo klopt: sorteer het zelf.`,
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
    /^Not (?:an ING|a Knab|an ABN AMRO) export, missing: (.*)$/,
    (m) => `Dit is niet het verwachte bestand van de bank; er ontbreken kolommen: ${m[1]}`,
  ],
  [
    /^Not an ABN AMRO export, (?:the file is empty|no transaction lines found)$/,
    () => "Dit is geen ABN AMRO-export: er staan geen transactieregels in.",
  ],
  [/^Not a transaction line$/, () => "Geen transactieregel"],
  [/^Af Bij must be Af or Bij, not "(.*)"$/, (m) => `Af Bij moet Af of Bij zijn, niet "${m[1]}"`],
  [
    /^CreditDebet must be Credit or Debet, not "(.*)"$/,
    (m) => `CreditDebet moet Credit of Debet zijn, niet "${m[1]}"`,
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
  [/^File too large \(max 4 MB\)\.$/, () => "Dit bestand is te groot (maximaal 4 MB)."],
  [
    /^Too many uploads\. Wait a minute and try again\.$/,
    () => "Te veel uploads. Wacht even en probeer het opnieuw.",
  ],
  [
    /^The server is busy\. Try again in a moment\.$/,
    () => "De server is druk. Probeer het zo opnieuw.",
  ],
  [/^This file could not be read\.$/, () => "Dit bestand kon niet worden gelezen."],
  [
    /^A rule pattern can be at most 100 characters\.$/,
    () => "Een regelpatroon mag maximaal 100 tekens bevatten.",
  ],
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
  [
    /^The expected spending must be an amount of zero or more\.$/,
    () => "De verwachte uitgaven moeten een bedrag van nul of meer zijn.",
  ],
  // BTW settings
  [/^Use letters or numbers in the name\.$/, () => "Gebruik letters of cijfers in de naam."],
  [
    /^The name is too long \(max (\d+)\)\.$/,
    (m) => `De naam is te lang (maximaal ${m[1]} tekens).`,
  ],
  [
    /^The payment lag must be 0, 1 or 2 months\.$/,
    () => "De betaaltermijn moet 0, 1 of 2 maanden zijn.",
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
  // the plan grid
  [
    /^Only a category or a fixed item can be typed in the plan\.$/,
    () => "In het plan kun je alleen een categorie of een vaste post invullen.",
  ],
  [
    /^The scope must be "month" or "after"\.$/,
    () => "Kies alleen deze maand, of deze en de maanden erna.",
  ],
  [
    /^The amount must be a whole number of cents, zero or more\.$/,
    () => "Het bedrag moet nul of meer zijn.",
  ],
  [
    /^A month that has passed cannot be planned\.$/,
    () => "Een maand die voorbij is kun je niet meer plannen.",
  ],
  [
    /^The plan goes up to (\d+) months ahead\.$/,
    (m) => `Het plan gaat tot ${m[1]} maanden vooruit.`,
  ],
  [/^Unknown category\.$/, () => "Deze categorie bestaat niet."],
  [/^Unknown fixed item\.$/, () => "Deze vaste post bestaat niet."],
  [
    /^months must be a whole number from 1 to (\d+)\.$/,
    (m) => `Het aantal maanden moet een heel getal van 1 tot ${m[1]} zijn.`,
  ],
  [
    /^The basis must be "averages", "budget" or "own"\.$/,
    () => "Kies gemiddelden, budget of eigen bedrag als basis.",
  ],
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
