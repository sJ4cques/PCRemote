import { getAdminFirestore, SESSIONS_COLLECTION } from "./admin";

async function main(): Promise<void> {
  const db = getAdminFirestore();
  const cutoff = Date.now() - 1000 * 60 * 60 * 24; // 24h
  const snap = await db
    .collection(SESSIONS_COLLECTION)
    .where("updatedAt", "<", cutoff)
    .get();

  if (snap.empty) {
    console.log("Sesiones antiguas eliminadas: 0");
    return;
  }

  let deleted = 0;
  const batch = db.batch();
  snap.forEach((doc) => {
    batch.delete(doc.ref);
    deleted++;
  });
  await batch.commit();

  console.log(`Sesiones antiguas eliminadas: ${deleted}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
