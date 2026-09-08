import { getAdminFirestore, SESSIONS_COLLECTION } from "./admin";

/** Borra TODAS las sesiones y sus subcolecciones de candidatos (uso en desarrollo/pruebas). */
async function main(): Promise<void> {
  const db = getAdminFirestore();
  const sessionsSnapshot = await db.collection(SESSIONS_COLLECTION).get();

  let candidatesDeleted = 0;
  for (const session of sessionsSnapshot.docs) {
    for (const coll of ["hostCandidates", "clientCandidates"]) {
      const sub = await session.ref.collection(coll).get();
      for (const doc of sub.docs) {
        await doc.ref.delete();
        candidatesDeleted += 1;
      }
    }
  }

  let sessionsDeleted = 0;
  const batch = db.batch();
  sessionsSnapshot.forEach((doc) => {
    batch.delete(doc.ref);
    sessionsDeleted += 1;
  });
  if (sessionsDeleted > 0) {
    await batch.commit();
  }

  console.log(`Sesiones eliminadas: ${sessionsDeleted} (candidatos: ${candidatesDeleted})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });