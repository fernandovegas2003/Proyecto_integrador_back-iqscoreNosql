// server.js - Configuración completa del servidor
import http from 'http';
import https from 'https';
import fs from 'fs';
import app from './app.js';
import 'dotenv/config';
import { connectDB } from './db.js';
import InitialSetup from './user&settings/schemas/initialSetup.js';
import path from 'path';  
import { fileURLToPath } from 'url';

// Configuración de puertos y protocolos
const PROTOCOL = process.env.PROTOCOL || 'http';
const HOST = '0.0.0.0'; // Escucha en todas las interfaces
const HTTP_PORT = process.env.HTTP_PORT || 3005;
const HTTPS_PORT = process.env.HTTPS_PORT || 3006;

// Configuración de rutas para los certificados
const __filename = fileURLToPath(import.meta.url);  
const __dirname = path.dirname(__filename);
const CERTS_PATH = path.join(__dirname, '../certificados');

// Verificación de existencia de certificados
const verifyCertificates = () => {
  const requiredFiles = [
    'private.key',
    'certificate.crt',
    'ca_bundle.crt'
  ];

  requiredFiles.forEach(file => {
    const filePath = path.join(CERTS_PATH, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`❌ Archivo de certificado faltante: ${filePath}`);
    }
  });
};

// Configuración de opciones HTTPS
const getHttpsOptions = () => {
  try {
    verifyCertificates();
    
    return {
      key: fs.readFileSync(path.join(CERTS_PATH, 'private.key')),
      cert: fs.readFileSync(path.join(CERTS_PATH, 'certificate.crt')),
      ca: [
        fs.readFileSync(path.join(CERTS_PATH, 'ca_bundle.crt'))
      ],
      // Configuraciones de seguridad recomendadas
      minVersion: 'TLSv1.2',
      ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'DHE-RSA-AES128-GCM-SHA256',
        'DHE-RSA-AES256-GCM-SHA384'
      ].join(':'),
      honorCipherOrder: true
    };
  } catch (error) {
    console.error('❌ Error al cargar certificados SSL:', error.message);
    if (PROTOCOL === 'https') {
      throw new Error('No se pueden cargar los certificados SSL en modo HTTPS');
    }
    return null;
  }
};

// Manejo de apagado del servidor
const gracefulShutdown = (server, serverType, signal) => {
  console.log(`🛑 [${serverType}] Recibida señal ${signal}, cerrando servidor...`);
  
  server.close(() => {
    console.log(`✅ [${serverType}] Servidor cerrado correctamente`);
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      process.exit(0);
    }
  });

  // Forzar cierre después de 5 segundos
  setTimeout(() => {
    console.error(`⚠️ [${serverType}] Forzando cierre del servidor...`);
    process.exit(1);
  }, 5000);
};

// Inicialización del servidor
const startServer = async () => {
  try {
    // 1. Conexión a la base de datos con reintentos
    let retries = 5;
    while (retries > 0) {
      try {
        await connectDB();
        console.log('✅ Conexión a la base de datos establecida.');
        break;
      } catch (dbError) {
        retries--;
        console.error(`❌ Error al conectar a DB. Reintentos restantes: ${retries}`, dbError.message);
        if (retries === 0) throw dbError;
        await new Promise(res => setTimeout(res, 5000));
      }
    }

    // 2. Configuraciones iniciales
    try {
      await InitialSetup.createRoles();
      console.log('✅ Configuraciones iniciales completadas.');
    } catch (setupError) {
      console.error('⚠️ Error en configuraciones iniciales:', setupError.message);
    }

    // 3. Crear servidores
    const httpServer = http.createServer(app);
    const httpsOptions = getHttpsOptions();
    let httpsServer = null;

    // Configuración de timeouts
    httpServer.keepAliveTimeout = 60000;
    httpServer.headersTimeout = 65000;

    if (httpsOptions) {
      httpsServer = https.createServer(httpsOptions, app);
      httpsServer.keepAliveTimeout = 60000;
      httpsServer.headersTimeout = 65000;
    }

    // 4. Iniciar servidores
    httpServer.listen(HTTP_PORT, HOST, () => {
      const hostDisplay = HOST === '0.0.0.0' ? 'localhost' : HOST;
      console.log(`🚀 Servidor HTTP iniciado en http://${hostDisplay}:${HTTP_PORT}`);
    });

    if (httpsServer) {
      httpsServer.listen(HTTPS_PORT, HOST, () => {
        const hostDisplay = HOST === '0.0.0.0' ? 'localhost' : HOST;
        console.log(`🔐 Servidor HTTPS iniciado en https://${hostDisplay}:${HTTPS_PORT}`);
      });
    } else {
      console.log('⚠️ Servidor HTTPS no iniciado (certificados no disponibles)');
    }

    // 5. Manejo de errores
    const handleServerError = (serverType, error) => {
      console.error(`❌ Error del servidor ${serverType}:`, error.message);
      
      switch (error.code) {
        case 'EACCES':
          console.error('   → El puerto requiere privilegios elevados (sudo)');
          break;
        case 'EADDRINUSE':
          console.error(`   → El puerto ${error.port} está en uso.`);
          console.error('     Comando para liberar puerto:');
          console.error(`     Linux/Mac: lsof -i :${error.port} | grep LISTEN`);
          console.error(`     Windows: netstat -ano | findstr :${error.port}`);
          break;
        default:
          console.error('   → Detalles:', error.stack);
      }

      process.exit(1);
    };

    httpServer.on('error', (error) => handleServerError('HTTP', error));
    if (httpsServer) {
      httpsServer.on('error', (error) => handleServerError('HTTPS', error));
    }

    // 6. Manejo de señales
    const signals = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'];
    signals.forEach(signal => {
      process.on(signal, () => {
        gracefulShutdown(httpServer, 'HTTP', signal);
        if (httpsServer) gracefulShutdown(httpsServer, 'HTTPS', signal);
      });
    });

  } catch (error) {
    console.error('💥 Error crítico al iniciar el servidor:', error.message);
    process.exit(1);
  }
};

// Iniciar el servidor
startServer()
  .catch(error => {
    console.error('💣 Error no controlado en startServer:', error.message);
    process.exit(1);
  });