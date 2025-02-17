require('dotenv').config(); // Charger les variables d'environnement depuis .env
const fastify = require('fastify')({ logger: true }); // Activer les logs pour le débogage
const paypal = require('@paypal/checkout-server-sdk');
const crypto = require('node:crypto');

const qs = require('querystring');
const axios = require('axios');

// Récupérer les identifiants PayPal à partir des variables d'environnement
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;


// Vérifier si les identifiants sont présents
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error('Erreur : Les variables d\'environnement PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET doivent être définies.');
  process.exit(1); // Quitter l'application si les identifiants sont manquants
}

// Configuration de l'environnement PayPal (Sandbox ou Live)
const paypalEnvironment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET); // Utilisez Sandbox pour le développement
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);

// Route de test pour vérifier que le serveur fonctionne
fastify.get('/', async (request, reply) => {
  reply.send({ hello: 'world' });
});

// Exemple de route pour créer une commande PayPal
fastify.post('/api/orders', async (request, reply) => {
  try {
    // 1. Créer un corps de requête pour la création de la commande
    const requestBody = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: '10.00' // Montant de la commande
        }
      }]
    };

    // 2. Créer la requête pour l'API de création de commande
    const paypalRequest = new paypal.orders.OrdersCreateRequest();
    paypalRequest.requestBody(requestBody);

    // 3. Exécuter la requête et obtenir la réponse
    const response = await paypalClient.execute(paypalRequest);

    // 4. Envoyer la réponse au client
    reply.send(response.result);
  } catch (error) {
    console.error('Erreur lors de la création de la commande :', error);
    reply.status(500).send({ error: 'Erreur lors de la création de la commande' });
  }
});

// Route pour capturer le paiement
fastify.post('/api/orders/:orderID/capture', async (request, reply) => {
  const { orderID } = request.params; // Extraire l'orderID des paramètres de la route

  try {
    // 1. Créer une requête de capture de commande
    const captureRequest = new paypal.orders.OrdersCaptureRequest(orderID);
    captureRequest.requestBody({}); // Le corps de la requête peut être vide pour une capture simple

    // 2. Exécuter la requête de capture
    const captureResponse = await paypalClient.execute(captureRequest);

    // 3. Traiter la réponse
    if (captureResponse.statusCode === 201) {
      // Capture réussie
      console.log('Paiement capturé avec succès!');
      reply.send({ status: 'COMPLETED', details: captureResponse.result }); // Envoyer une réponse de succès
    } else {
      // Échec de la capture
      console.error('Erreur lors de la capture du paiement:', captureResponse);
      reply.status(500).send({ error: 'La capture du paiement a échoué', details: captureResponse });
    }
  } catch (error) {
    // Gérer les erreurs
    console.error('Erreur lors de la capture du paiement:', error);
    reply.status(500).send({ error: 'Erreur lors de la capture du paiement', details: error.message });
  }
});

// Route pour recevoir les webhooks de PayPal
fastify.post('/webhook', async (request, reply) => {
  try {
    // 1. Récupérer les en-têtes et le corps de la requête
    const auth_algo = request.headers['paypal-auth-algo'];
    const cert_url = request.headers['paypal-cert-url'];
    const transmission_id = request.headers['paypal-transmission-id'];
    const transmission_sig = request.headers['paypal-transmission-sig'];
    const transmission_time = request.headers['paypal-transmission-time'];
    const webhook_id = process.env.PAYPAL_WEBHOOK_ID; // Récupérer l'ID du webhook depuis les variables d'environnement
    const webhook_event = request.body;

    // 2. Vérifier que l'ID du webhook est configuré
    if (!webhook_id) {
      console.error('Erreur : La variable d\'environnement PAYPAL_WEBHOOK_ID doit être définie.');
      reply.status(500).send({ error: 'Erreur de configuration du webhook' });
      return;
    }

    // 3. Préparer les données pour la vérification de la signature
    const data = {
      auth_algo: auth_algo,
      cert_url: cert_url,
      transmission_id: transmission_id,
      transmission_sig: transmission_sig,
      transmission_time: transmission_time,
      webhook_id: webhook_id,
      webhook_event: webhook_event
    };

    // 4. Vérifier la signature du webhook (fonction à implémenter - voir l'exemple ci-dessous)
    const verificationStatus = await verifyWebhookSignature(data);

    if (verificationStatus === 'SUCCESS') {
      // 5. Traiter l'événement du webhook
      console.log('Webhook vérifié avec succès. Événement :', webhook_event.event_type);
      // Ajoutez ici la logique pour traiter les différents types d'événements (par exemple, mettre à jour la base de données, envoyer des notifications, etc.)

      // 6. Envoyer une réponse 200 OK
      reply.status(200).send({ status: 'OK' });
    } else {
      // La signature n'est pas valide
      console.error('Erreur : Signature du webhook invalide.');
      reply.status(400).send({ error: 'Signature du webhook invalide' });
    }
  } catch (error) {
    console.error('Erreur lors du traitement du webhook :', error);
    reply.status(500).send({ error: 'Erreur lors du traitement du webhook' });
  }
});

async function verifyWebhookSignature(data) {

  const paypalAPIUrl = 'https://api.sandbox.paypal.com/v1/notifications/verify-webhook-signature';

  const body = {
    auth_algo: data.auth_algo,
    cert_url: data.cert_url,
    transmission_id: data.transmission_id,
    transmission_sig: data.transmission_sig,
    transmission_time: data.transmission_time,
    webhook_id: data.webhook_id,
    webhook_event: data.webhook_event
  };

  try {
    const response = await axios.post(paypalAPIUrl, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64')}`
      }
    });

    if (response.data.verification_status === 'SUCCESS') {
      return 'SUCCESS';
    } else {
      console.error('Webhook signature verification failed:', response.data);
      return 'FAILURE';
    }
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return 'ERROR';
  }
}

// Démarrage du serveur
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Serveur démarré sur le port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
