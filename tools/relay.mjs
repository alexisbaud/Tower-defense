// Relais MQTT des tests dans le navigateur. À l'accueil, le jeu crée son salon sur
// des relais publics : depuis une machine de test sans accès à Internet, chaque
// tentative échouée s'écrirait en console. Les outils passent donc au jeu
// ?broker=<relais local> s'il répond (voir tools/net-test.mjs), sinon ?broker=off
// (salon « hors ligne », sans tentative de connexion).
export const LOCAL_RELAY = process.env.JDE_RELAY || 'ws://localhost:8883/mqtt';

export function relayReachable(url = LOCAL_RELAY, ms = 2000) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => {
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    try {
      ws = new WebSocket(url, ['mqtt']);
    } catch {
      done(false);
      return;
    }
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
  });
}

// « broker=… » à ajouter à l'adresse du jeu.
export async function brokerQuery() {
  return (await relayReachable()) ? `broker=${encodeURIComponent(LOCAL_RELAY)}` : 'broker=off';
}
