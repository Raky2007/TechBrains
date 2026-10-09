import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { CONFIG } from './config.js';
import { setupDatabase } from './database/setup.js';
import { setupSocketIO, broadcastRoundEvent } from './sockets/socketHandler.js';
import { registerTimerCallbacks, recoverRoundsOnStartup } from './services/timerService.js';
import { GameService } from './services/gameService.js';
import { getLanIpv4Addresses, getPrimaryLanIpv4, isAllowedLanOrigin } from './utils/network.js';

import authRoutes from './routes/authRoutes.js';
import gameRoutes from './routes/gameRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // 1. Initialize SQLite Database & Ensure Tables
  await setupDatabase();

  // 2. Express Application
  const app = express();
  const server = http.createServer(app);

  // 3. Socket.IO authoritative server setup with LAN-safe CORS origin policy
  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedLanOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin not allowed on LAN server'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  setupSocketIO(io);

  // 4. Timer Service & Authoritative Deadline monitor
  registerTimerCallbacks(io, async (expiredRound) => {
    try {
      const result = GameService.endRound(null, expiredRound.level);
      broadcastRoundEvent('round:ended', { level: expiredRound.level, round: result.round });
      console.log(`[Authoritative Server] Round ${expiredRound.id} (Level ${expiredRound.level}) timed out and ended.`);
    } catch (err) {
      console.error('[Authoritative Server] Error ending expired round:', err);
    }
  });

  // 5. Recover ongoing rounds if server was rebooted
  recoverRoundsOnStartup();

  // Security: warn loudly if running in production with the built-in default password.
  if (CONFIG.NODE_ENV === 'production' && CONFIG.ADMIN_PASSWORD === 'nexus_forensics_2026!') {
    console.warn('\n[SECURITY WARNING] Running in production with the default ADMIN_PASSWORD.');
    console.warn('[SECURITY WARNING] Set a strong ADMIN_PASSWORD in your .env before the event.\n');
  }
  if (CONFIG.AI.PROVIDER !== 'none' && CONFIG.AI.PROVIDER !== 'mock' && !CONFIG.AI.API_KEY) {
    console.warn(`[AI] AI_PROVIDER="${CONFIG.AI.PROVIDER}" is set but AI_API_KEY is empty; evaluations will fail until a key is provided.`);
  }

  // 6. Middleware stack with LAN-safe CORS
  app.use(cors({
    origin: (origin, callback) => {
      if (isAllowedLanOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS origin not allowed on LAN server'));
      }
    },
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 7. Static file serving
  // Static uploads
  if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
    fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(CONFIG.UPLOAD_DIR));

  // 8. API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api/admin', adminRoutes);

  // 9. Production React Static App Serving
  const publicDir = CONFIG.PUBLIC_DIR;
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // SPA fallback
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(`
        <html>
          <body style="background:#0B0D12;color:#F0F0F5;font-family:sans-serif;padding:40px;text-align:center;">
            <h1 style="color:#8B7CFF;">${CONFIG.BRANDING.title} - Backend Active</h1>
            <p style="color:#A8ADBC;">Frontend build not found in <code>server/public</code>.</p>
            <p>During development, run <code>npm run dev</code> to launch Vite frontend at <a href="http://localhost:5173" style="color:#51D9E8;">http://localhost:5173</a>.</p>
            <p>For production deployment on LAN, run <code>npm run build</code> and then <code>npm start</code>.</p>
          </body>
        </html>
      `);
    });
  }

  // 10. Start Listening on 0.0.0.0
  server.listen(CONFIG.PORT, CONFIG.HOST, () => {
    const lanIps = getLanIpv4Addresses();
    const primaryIp = getPrimaryLanIpv4();

    console.log(`\n===============================================================`);
    console.log(`  ★ ${CONFIG.BRANDING.title} ★`);
    console.log(`  ${CONFIG.BRANDING.eventEdition} - AUTHORITATIVE HOST SERVER`);
    console.log(`===============================================================`);
    console.log(`  Authoritative Host listening on: ${CONFIG.HOST}:${CONFIG.PORT}`);
    console.log(`  Local Access:      http://localhost:${CONFIG.PORT}`);
    console.log(`  Primary LAN IP:    http://${primaryIp}:${CONFIG.PORT}`);
    
    if (lanIps.length > 0) {
      console.log(`\n  All Detected LAN Network Interfaces:`);
      for (const iface of lanIps) {
        console.log(`    - [${iface.interfaceName}]: http://${iface.address}:${CONFIG.PORT}`);
      }
    } else {
      console.log(`  Warning: No external LAN IPv4 address detected. Check network connection.`);
    }

    console.log(`\n  Participant Access URL (Share with 30 Teams on LAN):`);
    console.log(`  >>> http://${primaryIp}:${CONFIG.PORT} <<<`);
    console.log(`\n  Admin Portal:`);
    console.log(`  >>> http://${primaryIp}:${CONFIG.PORT}/admin/login <<<`);
    console.log(`  Default Admin: ${CONFIG.ADMIN_USERNAME}`);
    console.log(`===============================================================\n`);
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Failed to start TechBrains server:', err);
  process.exit(1);
});
