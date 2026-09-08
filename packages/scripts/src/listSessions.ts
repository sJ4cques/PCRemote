import { getAdminFirestore, SESSIONS_COLLECTION } from "./admin";

async function main(): Promise<void> {
  const db = getAdminFirestore();
  const snap = await db.collection(SESSIONS_COLLECTION).get();
  console.log(`Total de sesiones: ${snap.size}`);
  snap.forEach((doc) => {
    const data = doc.data();
    console.log(
      `- ${doc.id}\tmachineCode=${data.machineCode}\tstatus=${data.status}`,
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
