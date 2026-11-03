<div align="center">

# arnaq

**See what is left this month, and plan ahead.**

A personal budget tracker. Upload your bank files, and arnaq shows what you spent against your budget, keeps track of your fixed costs and income, and forecasts the months ahead.

English and Dutch.

</div>

## What it does

- **Today:** how the month is going. Spending against your budget, the pace of the month, income still to come and your savings goal.
- **Ahead:** a forecast of your net worth for the months to come, based on your fixed costs, income and everyday spending. It marks the lowest point so you see a tight month early.
- **Plan:** a grid of the months ahead. Every number is a suggestion you can type over, for one month or for the months after.
- **Fixed:** rent, insurance, subscriptions and income that comes back every month, found from your payments and checked off when they arrive.
- **Categories that learn:** correct a category once and arnaq remembers it for that shop.
- **BTW:** if you are self-employed, it sets the BTW aside so it never looks like money you can spend.
- **Savings goal:** a tank that fills as you save.

## Your bank files

Download an export from your bank and drop it on the add page. Uploading the same file twice never counts anything double.

| Bank     | File                                          |
| -------- | --------------------------------------------- |
| Rabobank | PDF statement (Rekeningafschrift), or CSV     |
| Revolut  | CSV                                           |
| ABN AMRO | TXT (tab separated), or CSV with a header row |
| ING      | CSV ("Alle afschriften")                      |
| Knab     | CSV                                           |

Good to know:

- A Rabobank PDF is only accepted when its transactions add up to the totals and balances printed on the statement. Otherwise nothing is imported.
- A month counts as "actual" in the forecast only when your files cover all of it.
- The ABN AMRO, ING and Knab readers follow the banks' documented layouts and have not been checked against many real files yet. If one of your files is not read, please [open an issue](../../issues) with the first line of the file (the column names only, no transactions).

## Your data

- Your bank files are read by the app itself and are not sent to any other service.
- Every account only sees its own data, and the database enforces it, not only the app.
- In Settings you can make a full backup, restore one, and delete all your data.
- The app never needs your bank login. You bring the files.

## Source available, not open source

The code is public so you can read how arnaq works. It is **not open source**: all rights are reserved (see [LICENSE](LICENSE)), so please do not copy, host or redistribute it without asking first. Ideas, bug reports and bank-file problems are welcome as [issues](../../issues).

Notes on how the code is organised are in [docs/development.md](docs/development.md); the look of the app is described in [DESIGN.md](DESIGN.md).
