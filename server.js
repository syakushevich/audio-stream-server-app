// server.js
// Run: node server.js
// Dependencies: npm install ws
const WebSocket = require("ws");

const PORT = process.env.PORT || 3002;
// IMPORTANT: Use the same secret key as in your Python script!
const AUTH_TOKEN = "your-super-secret-key-123";

const wss = new WebSocket.Server({ port: PORT });

let sourceClient = null;
const browserClients = new Set();

console.log(`WebSocket relay server started on port ${PORT}`);
console.log(`Expecting auth token: Bearer ${AUTH_TOKEN}`);

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress; // Get client IP for logging

  // Check for Authorization header (Python script should send this)
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Get token part if header exists

  if (authHeader && token === AUTH_TOKEN) {
    // --- This is the Python Audio Source ---
    if (sourceClient && sourceClient.readyState === WebSocket.OPEN) {
      console.log(`WARN: New source connection from ${clientIp} replacing old one.`);
      sourceClient.close(1000, "New source connected");
    }
    sourceClient = ws;
    console.log(`Audio source connected from ${clientIp}.`);

    ws.on("message", (message) => {
      // Message from Python (audio chunk or transcription)
      // Broadcast to all connected browser clients
      let messageString;
      try {
        // Ensure message is string before parsing/broadcasting
        messageString = message.toString();
        // Optional: Parse to check type for logging
        // const parsed = JSON.parse(messageString);
        // console.log(`Broadcasting ${parsed.type} to ${browserClients.size} clients`);
      } catch (e) {
        console.error("Error processing message from source:", e);
        messageString = message.toString(); // Send raw if parse fails
      }

      browserClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageString); // Forward the raw message string
        }
      });
    });

    ws.on("close", (code, reason) => {
      console.log(`Audio source disconnected from ${clientIp}. Code: ${code}, Reason: ${reason}`);
      if (sourceClient === ws) {
        sourceClient = null;
      }
      // Notify browsers the source disconnected?
      browserClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "source_disconnected" }));
        }
      });
    });

    ws.on("error", (error) => {
      console.error(`Audio source WebSocket error from ${clientIp}:`, error);
      if (sourceClient === ws) {
        sourceClient = null;
      }
    });
  } else {
    // --- This is a Browser Client ---
    console.log(`Browser client connected from ${clientIp}. Total: ${browserClients.size + 1}`);
    browserClients.add(ws);

    // Send confirmation or initial state if needed
    ws.send(JSON.stringify({ type: "server_hello" }));
    if (!sourceClient || sourceClient.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "source_disconnected" }));
    }


    ws.on("message", (message) => {
      // Handle messages from browser if needed (e.g., control commands)
      console.log(`Received message from browser ${clientIp}: ${message.toString()}`);
    });

    ws.on("close", () => {
      console.log(`Browser client disconnected from ${clientIp}. Total: ${browserClients.size - 1}`);
      browserClients.delete(ws);
    });

    ws.on("error", (error) => {
      console.error(`Browser WebSocket error from ${clientIp}:`, error);
      browserClients.delete(ws);
    });
  }
});

wss.on("error", (error) => {
  console.error("WebSocket Server Error:", error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("SIGINT received, shutting down WebSocket server...");
    wss.clients.forEach(client => {
        client.close(1000, "Server shutting down");
    });
    wss.close(() => {
        console.log("WebSocket server closed.");
        process.exit(0);
    });
});
