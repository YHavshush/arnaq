/**
 * The privacy notice and the terms of use, as documents: sections of paragraphs, bullet lists and one table. English is
 * the source; Dutch must have the same number of sections, paragraphs and rows (the language test checks the shape).
 * Update the date and the text whenever a processor or a data flow changes.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets: string[];
  table: { head: string[]; rows: string[][] } | null;
}

export interface LegalDoc {
  title: string;
  intro: string;
  sections: LegalSection[];
}

const s = (
  heading: string,
  paragraphs: string[] = [],
  bullets: string[] = [],
  table: LegalSection["table"] = null,
): LegalSection => ({ heading, paragraphs, bullets, table });

export const legal: {
  updated: string;
  back: string;
  privacyLink: string;
  termsLink: string;
  privacy: LegalDoc;
  terms: LegalDoc;
} = {
  updated: "Last updated 18 November 2026",
  back: "Back to arnaq",
  privacyLink: "Privacy",
  termsLink: "Terms",
  privacy: {
    title: "Privacy notice",
    intro:
      "arnaq is a personal budget tracker. This notice says what it stores about you, why, who else receives it, and what you can do about it.",
    sections: [
      s("Who is responsible", [
        "Yonathan Havshush, Uilenstede 207, Amstelveen, the Netherlands (the address registered with the Chamber of Commerce, KvK). Email: yonathanhav@gmail.com. This person is the controller of the personal data described here.",
      ]),
      s("What arnaq is", [
        "You create an account, add your own bank data (by uploading statements or by linking your bank), and arnaq shows where your money goes and how the coming months look.",
      ]),
      s(
        "What we store",
        ["We do not use advertising or analytics trackers, and we do not sell data."],
        [],
        {
          head: ["Data", "Why", "Where"],
          rows: [
            [
              "Your email address and a password (stored only as a hash by Supabase Auth)",
              "To sign you in",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "The transactions from the statements you upload or the banks you link: date, amount, counterparty name and account number, description",
              "To show your overview and forecast",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "Your categories, rules, budgets, fixed costs, BTW and income tax settings, and the shops arnaq has learned from your choices",
              "To work the way you set it up",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "Your bank connections: which bank you linked, until when you agreed, and which accounts. Never your bank login, which arnaq does not see",
              "To read new transactions from your bank",
              "Supabase, EU (Frankfurt)",
            ],
            [
              "A language and a theme choice",
              "To remember your preference",
              "Your browser (a cookie and local storage)",
            ],
            [
              "Sign-in cookies",
              "To keep you signed in. Scripts cannot read them and they are only sent to this site",
              "Your browser",
            ],
          ],
        },
      ),
      s(
        "Linking your bank (optional)",
        [
          "If you link a bank, arnaq uses Enable Banking Oy (Finland), a regulated provider of account information services, to connect to it. You sign in at your own bank, never in arnaq. arnaq can only read the balances and transactions of the accounts you agree to. It cannot move money.",
          "Your agreement lasts at most about six months (the bank sets the limit). Then you agree again, or the link stops. You can disconnect at any time in Settings, and deleting your data also ends every connection.",
        ],
        [
          "What arnaq sends to Enable Banking: the bank you chose, a random code that ties your return to your visit, the address to return to, your language and the date your agreement ends.",
          "When you press Refresh in arnaq, your IP address and browser details go along, so the bank knows that you are present.",
          "Enable Banking has its own privacy policy for what it does with your data.",
        ],
      ),
      s(
        "Who else receives data",
        [],
        [
          "Supabase (database and sign-in), data in the EU.",
          "Vercel (hosting, region Frankfurt): the app is served through it. Requests pass through Vercel, which keeps technical logs.",
          "Enable Banking Oy: only if you link a bank, as described above.",
          "Anthropic (the company behind Claude): only if you switch on arnaq AI after reading its consent text. Then arnaq sends the name of a shop and a short description with numbers, account numbers and email addresses removed. It never sends amounts, dates, account numbers, your name, or payments to and from people. Anthropic is outside the EU, and its own terms and privacy policy apply to the data it receives. You can switch arnaq AI off at any time.",
        ],
      ),
      s("How long we keep it", [
        'As long as you have an account. "Delete my data" in Settings removes everything you stored, including your bank connection records, and ends your bank agreements. Your login itself is removed when you ask by email. Backups at Supabase are kept for a limited time and then disappear.',
      ]),
      s("Your rights", [
        "You can see and download your data (Settings, backup and CSV), correct it and delete it. You can ask for your account to be deleted, object to or limit the processing, and complain to the Dutch Data Protection Authority (Autoriteit Persoonsgegevens). Email yonathanhav@gmail.com for any of this.",
      ]),
      s("Security", [
        "Every row belongs to one account, and the database itself refuses to show it to anyone else (row level security). Connections are encrypted. The app never holds an administrator key. Uploaded statements are read to extract transactions, and the files themselves are not kept. The key arnaq uses to talk to Enable Banking is kept on the server and never reaches your browser.",
      ]),
      s("Changes", [
        "If this notice changes in a way that matters, for example a new processor or a new use of your data, we will tell you in the app. For arnaq AI we ask for your consent again.",
      ]),
    ],
  },
  terms: {
    title: "Terms of use",
    intro: "These are the terms for using arnaq.",
    sections: [
      s("What this is", [
        "arnaq is a tool that helps you keep track of your own money. It is not financial, tax or investment advice. Forecasts and the amounts it sets aside for BTW or income tax are estimates from what you uploaded and typed in. They can be wrong, and you stay responsible for your own tax returns and payments.",
      ]),
      s("Your account", [
        "You must be 18 or older. Keep your password to yourself. You are responsible for what happens under your account.",
      ]),
      s("Your data", [
        "The data you add is yours. You promise that it is your own or that you may use it. Do not add other people's statements without their permission.",
      ]),
      s("Linking a bank", [
        "You can link your own bank accounts. You agree with your bank, and you can end the link at any time in Settings. arnaq only reads. It never makes payments.",
      ]),
      s("Acceptable use", [
        "Do not try to break, overload or scrape the service, do not use it unlawfully, and do not try to reach other people's data.",
      ]),
      s("arnaq AI (optional)", [
        "arnaq AI uses a language model for the shop names you switch it on for. Its suggestions can be wrong, they are marked as automatic, and you can undo them. If it ever becomes a paid feature, we will tell you first.",
      ]),
      s("Availability", [
        "The service is provided as it is, without a promise that it is always available or free of errors. Keep your own backup (Settings).",
      ]),
      s("Liability", [
        "To the extent the law allows, we are not liable for decisions you take based on arnaq's numbers, or for damage from the service being unavailable or wrong. Nothing here limits liability that the law does not allow to be limited.",
      ]),
      s("Ending", [
        "You can stop at any time and delete your data in Settings. We may suspend an account that breaks these terms.",
      ]),
      s("Changes", ["We may change these terms. For changes that matter, we tell you in advance."]),
      s("Law and contact", [
        "Dutch law applies. Contact: Yonathan Havshush, Uilenstede 207, Amstelveen, the Netherlands, yonathanhav@gmail.com.",
      ]),
    ],
  },
};
