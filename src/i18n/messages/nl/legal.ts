import type { LegalSection } from "../en/legal";
import type { legal as legalEn } from "../en/legal";

/** De privacyverklaring en de gebruiksvoorwaarden, in dezelfde opbouw als de Engelse tekst. */
const s = (
  heading: string,
  paragraphs: string[] = [],
  bullets: string[] = [],
  table: LegalSection["table"] = null,
): LegalSection => ({ heading, paragraphs, bullets, table });

export const legal: typeof legalEn = {
  updated: "Laatst bijgewerkt op 18 november 2026",
  back: "Terug naar arnaq",
  privacyLink: "Privacy",
  termsLink: "Voorwaarden",
  privacy: {
    title: "Privacyverklaring",
    intro:
      "arnaq is een persoonlijke budgetapp. Deze verklaring zegt wat arnaq over je bewaart, waarom, wie het verder ontvangt en wat je ermee kunt doen.",
    sections: [
      s("Wie verantwoordelijk is", [
        "Yonathan Havshush, Uilenstede 207, Amstelveen, Nederland (het adres dat bij de Kamer van Koophandel, KvK, staat ingeschreven). E-mail: yonathanhav@gmail.com. Deze persoon is de verwerkingsverantwoordelijke voor de persoonsgegevens die hier staan.",
      ]),
      s("Wat arnaq is", [
        "Je maakt een account, voegt je eigen bankgegevens toe (door afschriften te uploaden of je bank te koppelen) en arnaq laat zien waar je geld naartoe gaat en hoe de komende maanden eruitzien.",
      ]),
      s(
        "Wat we bewaren",
        ["We gebruiken geen advertentie- of analysetrackers en we verkopen geen gegevens."],
        [],
        {
          head: ["Gegevens", "Waarom", "Waar"],
          rows: [
            [
              "Je e-mailadres en een wachtwoord (alleen als hash opgeslagen door Supabase Auth)",
              "Om je in te laten loggen",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "De transacties uit de afschriften die je uploadt of de banken die je koppelt: datum, bedrag, naam en rekeningnummer van de tegenpartij, omschrijving",
              "Om je overzicht en prognose te tonen",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "Je categorieën, regels, budgetten, vaste lasten, btw- en inkomstenbelastinginstellingen en de winkels die arnaq van jouw keuzes heeft geleerd",
              "Om te werken zoals jij het hebt ingesteld",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "Je bankkoppelingen: welke bank je hebt gekoppeld, tot wanneer je toestemming geldt en welke rekeningen. Nooit je bankinlog, die arnaq niet ziet",
              "Om nieuwe transacties van je bank te lezen",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "Een taal- en themakeuze",
              "Om je voorkeur te onthouden",
              "Je browser (een cookie en lokale opslag)",
            ],
            [
              "Inlogcookies",
              "Om je ingelogd te houden. Scripts kunnen ze niet lezen en ze gaan alleen naar deze site",
              "Je browser",
            ],
          ],
        },
      ),
      s(
        "Je bank koppelen (optioneel)",
        [
          "Als je een bank koppelt, gebruikt arnaq Enable Banking Oy (Finland), een gereguleerde aanbieder van rekeninginformatiediensten, om de verbinding te maken. Je logt in bij je eigen bank, nooit in arnaq. arnaq kan alleen de saldi en transacties lezen van de rekeningen waarvoor je toestemming geeft. Het kan geen geld overmaken.",
          "Je toestemming duurt hooguit ongeveer zes maanden (de bank bepaalt de grens). Daarna geef je opnieuw toestemming, anders stopt de koppeling. Je kunt de koppeling altijd verbreken bij Instellingen, en als je je gegevens verwijdert, eindigt elke koppeling ook.",
        ],
        [
          "Wat arnaq naar Enable Banking stuurt: de bank die je koos, een willekeurige code die je terugkeer aan je bezoek koppelt, het adres om naar terug te keren, je taal en de datum waarop je toestemming eindigt.",
          "Als je in arnaq op Verversen drukt, gaan je IP-adres en browsergegevens mee, zodat de bank weet dat je aanwezig bent.",
          "Enable Banking heeft een eigen privacyverklaring voor wat het met je gegevens doet.",
        ],
      ),
      s(
        "Wie nog meer gegevens ontvangt",
        [],
        [
          "Supabase (database en inloggen), gegevens in de EU.",
          "Vercel (hosting, regio Frankfurt): de app wordt erdoorheen geleverd. Verzoeken gaan via Vercel, dat technische logs bewaart.",
          "Enable Banking Oy: alleen als je een bank koppelt, zoals hierboven beschreven.",
          "Anthropic (het bedrijf achter Claude): alleen als je arnaq AI aanzet nadat je de toestemmingstekst hebt gelezen. Dan stuurt arnaq de naam van een winkel en een korte omschrijving waaruit cijfers, rekeningnummers en e-mailadressen zijn gehaald. Het stuurt nooit bedragen, datums, rekeningnummers, je naam of betalingen van en naar personen. Anthropic zit buiten de EU en voor de gegevens die het ontvangt gelden zijn eigen voorwaarden en privacyverklaring. Je kunt arnaq AI altijd uitzetten.",
        ],
      ),
      s("Hoe lang we het bewaren", [
        'Zolang je een account hebt. "Mijn gegevens verwijderen" bij Instellingen haalt alles weg wat je hebt opgeslagen, inclusief je bankkoppelingen, en beëindigt je banktoestemmingen. Je login zelf verwijderen we als je dat per e-mail vraagt. Back-ups bij Supabase worden een beperkte tijd bewaard en verdwijnen daarna.',
      ]),
      s("Je rechten", [
        "Je kunt je gegevens inzien en downloaden (Instellingen, back-up en CSV), verbeteren en verwijderen. Je kunt vragen om je account te verwijderen, bezwaar maken tegen of beperking vragen van de verwerking, en een klacht indienen bij de Autoriteit Persoonsgegevens. Mail naar yonathanhav@gmail.com voor al dit soort verzoeken.",
      ]),
      s("Beveiliging", [
        "Elke rij hoort bij één account en de database zelf weigert die aan anderen te tonen (row level security). Verbindingen zijn versleuteld. De app heeft nooit een beheerderssleutel. Geüploade afschriften worden gelezen om transacties eruit te halen en de bestanden zelf worden niet bewaard. De sleutel waarmee arnaq met Enable Banking praat staat op de server en komt nooit in je browser.",
      ]),
      s("Wijzigingen", [
        "Als deze verklaring op een belangrijke manier verandert, bijvoorbeeld door een nieuwe verwerker of een nieuw gebruik van je gegevens, laten we het je weten in de app. Voor arnaq AI vragen we opnieuw om je toestemming.",
      ]),
    ],
  },
  terms: {
    title: "Gebruiksvoorwaarden",
    intro: "Dit zijn de voorwaarden voor het gebruik van arnaq.",
    sections: [
      s("Wat dit is", [
        "arnaq is een hulpmiddel om je eigen geld bij te houden. Het is geen financieel, fiscaal of beleggingsadvies. Prognoses en de bedragen die het opzij zet voor btw of inkomstenbelasting zijn schattingen op basis van wat je hebt geüpload en ingevuld. Ze kunnen er naast zitten en je blijft zelf verantwoordelijk voor je eigen belastingaangiften en betalingen.",
      ]),
      s("Je account", [
        "Je moet 18 jaar of ouder zijn. Houd je wachtwoord voor jezelf. Je bent verantwoordelijk voor wat er onder je account gebeurt.",
      ]),
      s("Je gegevens", [
        "De gegevens die je toevoegt zijn van jou. Je belooft dat ze van jezelf zijn of dat je ze mag gebruiken. Voeg geen afschriften van anderen toe zonder hun toestemming.",
      ]),
      s("Een bank koppelen", [
        "Je kunt je eigen bankrekeningen koppelen. Je geeft toestemming aan je bank en je kunt de koppeling altijd beëindigen bij Instellingen. arnaq leest alleen. Het doet nooit betalingen.",
      ]),
      s("Toegestaan gebruik", [
        "Probeer de dienst niet kapot te maken, te overbelasten of leeg te halen, gebruik hem niet in strijd met de wet en probeer niet bij de gegevens van anderen te komen.",
      ]),
      s("arnaq AI (optioneel)", [
        "arnaq AI gebruikt een taalmodel voor de winkelnamen waarvoor je het aanzet. De suggesties kunnen fout zijn, ze zijn als automatisch gemarkeerd en je kunt ze ongedaan maken. Als het ooit een betaalde functie wordt, laten we het je eerst weten.",
      ]),
      s("Beschikbaarheid", [
        "De dienst wordt geleverd zoals hij is, zonder belofte dat hij altijd beschikbaar of foutloos is. Houd je eigen back-up bij (Instellingen).",
      ]),
      s("Aansprakelijkheid", [
        "Voor zover de wet het toestaat zijn we niet aansprakelijk voor beslissingen die je neemt op basis van de cijfers van arnaq, of voor schade doordat de dienst niet beschikbaar of onjuist is. Niets hier beperkt aansprakelijkheid die de wet niet laat beperken.",
      ]),
      s("Stoppen", [
        "Je kunt altijd stoppen en je gegevens verwijderen bij Instellingen. We mogen een account opschorten dat deze voorwaarden schendt.",
      ]),
      s("Wijzigingen", [
        "We mogen deze voorwaarden wijzigen. Bij belangrijke wijzigingen laten we het je vooraf weten.",
      ]),
      s("Recht en contact", [
        "Nederlands recht is van toepassing. Contact: Yonathan Havshush, Uilenstede 207, Amstelveen, Nederland, yonathanhav@gmail.com.",
      ]),
    ],
  },
};
