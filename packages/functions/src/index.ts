import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

initializeApp();

/**
 * Relay del probe de presencia ("¿está prendida la PC?").
 *
 * El teléfono NO puede preguntar directamente al host: está en otra red y la
 * Cloud Function tampoco tiene ruta hacia la LAN. El ida y vuelta va siempre por
 * Firestore, así que el trabajo de esta Function es acotado:
 *
 *   1. rate limit (la clave de service account va DENTRO del APK; sin este tope
 *      cualquiera que descompile la app agota las cuotas del proyecto);
 *   2. marcar el pedido como `dispatched` para que el host lo atienda.
 *
 * No espera al host ni hace polling: despacha y retorna en milisegundos. Si el
 * host no responde dentro de `PROBE_MAX_AGE_MS`, el teléfono aplica su timeout
 * y muestra "APAGADA O ENCENDIENDO". Esperar acá solo sumaría costo.
 */

// Estas constantes DEBEN coincidir con packages/shared/src/config.ts. No se
// importa de ahí a propósito: @isisanubis/shared arrastra React (FirestoreStatus)
// y el bundle de Functions corre en Node sin bundler.
const PRESENCE_COLLECTION = 'presence';
const PROBE_SUBCOLLECTION = 'probe';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const db = () => getFirestore();

type PendingProbe = {
  requestId?: unknown;
  requestedAt?: unknown;
  requestedBy?: unknown;
  state?: unknown;
};

/**
 * Ventana fija de rate limit sobre el doc `probe/rate`.
 *
 * Contra: dos pedidos simultáneos pueden leer el mismo `count` y escribir el
 * mismo incremented → se cuela uno por encima del tope. Para el uso real (un
 * humano tocando un botón) es irrelevante; no se justifica un contador
 * transaccional por eso.
 *
 * Usa `Date.now()` del runtime y no `FieldValue.serverTimestamp()` para que el
 * cálculo de la ventana sea aritmética simple y consistente con el resto del
 * proyecto, que mezcla tiempos del cliente.
 */
async function consumeRateLimit(machineId: string, now: number): Promise<boolean> {
  const rateRef = db()
    .collection(PRESENCE_COLLECTION)
    .doc(machineId)
    .collection(PROBE_SUBCOLLECTION)
    .doc('rate');

  const snap = await rateRef.get();
  const data = snap.data() as { windowStart?: unknown; count?: unknown } | undefined;
  const windowStart = Number(data?.windowStart ?? 0);
  const count = Number(data?.count ?? 0);

  // Ventana vencida (o nunca hubo ventana): arrancamos una nueva.
  if (!count || now - windowStart >= RATE_LIMIT_WINDOW_MS) {
    await rateRef.set({ windowStart: now, count: 1 });
    return true;
  }
  if (count >= RATE_LIMIT_MAX) {
    logger.warn('probe rechazado por rate limit', { machineId, count });
    return false;
  }
  await rateRef.set({ windowStart, count: count + 1 });
  return true;
}

/**
 * Se dispara en CADA write de `probe/pending`, no solo al crearse: el documento
 * es fijo y permanente (el teléfono lo sobreescribe), así que nunca vuelve a
 * "crearse". El corte anti-bucle es comparar el `requestId` de antes y después:
 * si no cambió, el write es nuestro propio sello `dispatched` y se ignora.
 *
 * El teléfono escribe con un `requestId` nuevo por consulta → exactamente una
 * invocación por consulta.
 */
export const onProbeWritten = onDocumentWritten(
  `${PRESENCE_COLLECTION}/{machineId}/${PROBE_SUBCOLLECTION}/pending`,
  async (event) => {
    const before = event.data?.before.data() as PendingProbe | undefined;
    const after = event.data?.after.data() as PendingProbe | undefined;
    const machineId = event.params.machineId;

    const beforeId = String(before?.requestId ?? '');
    const afterId = String(after?.requestId ?? '');
    if (!after || !afterId) {
      return;
    }
    if (beforeId === afterId) {
      // Write sin requestId nuevo: es el sello `dispatched` de una invocación
      // anterior (o una corrección manual). Ignorar para no encadenar llamadas.
      return;
    }

    const now = Date.now();
    const probeRoot = db()
      .collection(PRESENCE_COLLECTION)
      .doc(machineId)
      .collection(PROBE_SUBCOLLECTION);
    const pendingRef = probeRoot.doc('pending');

    let allowed = false;
    try {
      allowed = await consumeRateLimit(machineId, now);
    } catch (err) {
      // Si el rate limit no se puede evaluar preferimos dejar pasar: la función
      // es higiene, no una barrera de seguridad (ver reglas de Firestore).
      logger.error('rate limit ilegible, se permite el probe', { machineId, err });
      allowed = true;
    }

    if (!allowed) {
      // La respuesta va al doc `answer` para que el teléfono necesite UNA sola
      // lectura mientras espera, en lugar de dos.
      //
      // Se escriben los campos de la respuesta ANTERIOR explícitamente a cero:
      // `answer` es un doc fijo y el merge los conservaría, con lo cual un
      // `ok:false` podía viajar junto a un `state:'online'` de un probe viejo y
      // el teléfono mostraría "operativa" sobre un pedido rechazado.
      await probeRoot.doc('answer').set(
        {
          requestId: afterId,
          ok: false,
          reason: 'rate_limited',
          state: '',
          captureOk: false,
          idle: '',
          uptime: 0,
          respondedAt: now,
        },
        { merge: true },
      );
      return;
    }

    await pendingRef.set({ state: 'dispatched', dispatchedAt: now }, { merge: true });
    logger.info('probe despachado', {
      machineId,
      requestId: afterId,
      requestedBy: String(after.requestedBy ?? ''),
      requestedAt: Number(after.requestedAt ?? 0),
    });
  },
);