import { syncInstruments } from "../instruments/instrumentsCache";

async function main() {
  const instruments = await syncInstruments("NSE");
  // eslint-disable-next-line no-console
  console.log(`Synced NSE instruments: ${instruments.length}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
