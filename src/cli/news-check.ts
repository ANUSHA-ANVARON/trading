import { getArgValue } from "./_args";
import { computeNewsContext } from "../news/newsContext";

async function main() {
  const timespan = getArgValue("--timespan") ?? "2h";
  const max = Number(getArgValue("--max") ?? "30");

  const ctx = await computeNewsContext({
    gdeltTimespan: timespan,
    gdeltMaxRecords: max,
    gdeltTerms: [
      "nifty",
      "sensex",
      "rbi",
      "sebi",
      "india",
      "rupee",
      "usd inr",
      "oil",
      "crude",
      "war",
      "sanctions",
      "iran",
      "israel",
      "ukraine",
      "fed",
      "inflation",
    ],
    officialWithinHours: 24,
    officialMaxItemsPerFeed: 6,
    maxHeadlines: 10,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(ctx, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
