import { createKiteClient } from "../kite/kiteClient";
import { getArgValues, usageAndExit } from "./_args";

async function main() {
  const instruments = getArgValues("--instruments");
  const instrument = getArgValues("--instrument");

  const keys = [...instruments, ...instrument];
  if (keys.length === 0) {
    usageAndExit("Usage: npm run quote:ltp -- --instruments NFO:SYMBOL1 NFO:SYMBOL2");
  }

  const kite = await createKiteClient();
  const data = await kite.getLTP(keys);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
