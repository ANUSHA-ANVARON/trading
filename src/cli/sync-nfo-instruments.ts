import { syncInstruments } from "../instruments/instrumentsCache";

async function main() {
  const instruments = await syncInstruments("NFO");
  // eslint-disable-next-line no-console
  console.log(`Synced NFO instruments: ${instruments.length}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
