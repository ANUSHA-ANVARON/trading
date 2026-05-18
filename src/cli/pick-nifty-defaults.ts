import { getArgValue } from "./_args";
import { pickNearExpiryNiftyFutureKey, pickNearestWeeklyNiftyOptionExpiry } from "../analysis/defaults";

async function main() {
  const underlying = getArgValue("--underlying") ?? "NIFTY";
  const futKey = await pickNearExpiryNiftyFutureKey(underlying);
  const expiry = await pickNearestWeeklyNiftyOptionExpiry(underlying);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        underlying,
        fut: futKey,
        option_expiry: expiry,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
