// Importaciones necesarias
import http from 'http';
import https from 'https'; // Importar módulo HTTPS
import fs from 'fs'; // Para leer los certificados
import app from './app.js';
import 'dotenv/config';
import { connectDB } from './db.js';
import InitialSetup from './user&settings/schemas/initialSetup.js';
import path from 'path';  
import { fileURLToPath } from 'url';

// Configuración mejorada con valores por defecto
const PROTOCOL = process.env.PROTOCOL || 'http';
const HOST = '0.0.0.0'; // Escucha en todas las interfaces
const HTTP_PORT = 3005; // Puerto para HTTP
const HTTPS_PORT = 3006; // Puerto para HTTPS

const __filename = fileURLToPath(import.meta.url);  
const __dirname = path.dirname(__filename);

// Cargar certificados para HTTPS
const httpsOptions = {  
  key: fs.readFileSync(path.join(__dirname, '../certificados/key.pem')), // Ruta absoluta  
  cert: fs.readFileSync(path.join(__dirname, '../certificados/cert.pem')), // Ruta absoluta  
};

// Mejores prácticas para manejo de señales de terminación
const shutdown = (server, signal) => {
  console.log(`🛑 Recibida señal ${signal}, cerrando servidor...`);
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });

  // Forzar cierre después de 5 segundos si no se completa
  setTimeout(() => {
    console.error('⚠️ Forzando cierre del servidor...');
    process.exit(1);
  }, 5000);
};

/**
 * @function startServer
 * @description Inicializa y configura el servidor HTTP y HTTPS con manejo mejorado de errores
 */
const startServer = async () => {
  try {
    // 1. Conectar a la base de datos con reintentos
    let retries = 5;
    while (retries > 0) {
      try {
        await connectDB();
        console.log('✅ Conexión a la base de datos establecida.');
        break;
      } catch (dbError) {
        retries--;
        console.error(`❌ Error al conectar a DB. Reintentos restantes: ${retries}`, dbError);
        if (retries === 0) throw dbError;
        await new Promise(res => setTimeout(res, 5000)); // Esperar 5 segundos
      }
    }

    // 2. Configuraciones iniciales con manejo de errores
    try {
      await InitialSetup.createRoles();
      console.log('✅ Configuraciones iniciales completadas.');
    } catch (setupError) {
      console.error('⚠️ Error en configuraciones iniciales:', setupError);
      // No es crítico, podemos continuar
    }

    // 3. Crear servidores HTTP y HTTPS con timeout configurado
    const httpServer = http.createServer(app);
    const httpsServer = https.createServer(httpsOptions, app);

    httpServer.keepAliveTimeout = 60000; // 60 segundos
    httpServer.headersTimeout = 65000; // 65 segundos
    httpsServer.keepAliveTimeout = 60000; // 60 segundos
    httpsServer.headersTimeout = 65000; // 65 segundos

    // 4. Iniciar servidores con verificación de entorno
    httpServer.listen(HTTP_PORT, HOST, () => {
      console.log(`🚀 Servidor HTTP iniciado:`);
      console.log(`   • URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${HTTP_PORT}`);
    });

    httpsServer.listen(HTTPS_PORT, HOST, () => {
      console.log(`🚀 Servidor HTTPS iniciado:`);
      console.log(`   • URL: https://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${HTTPS_PORT}`);
    });

    // 5. Manejo mejorado de errores del servidor
    const handleServerError = (serverType, error) => {
      console.error(`❌ Error del servidor ${serverType}:`, error.message);

      switch (error.code) {
        case 'EACCES':
          console.error(`   → El puerto requiere privilegios elevados (sudo)`);
          break;
        case 'EADDRINUSE':
          console.error(`   → El puerto está en uso. Intenta con otro puerto o mata el proceso:`);
          console.error(`     Comando para Linux/Mac: lsof -i :${error.port} | grep LISTEN`);
          console.error(`     Comando para Windows: netstat -ano | findstr :${error.port}`);
          break;
        case 'ECONNRESET':
          console.error('   → Conexión reseteada por el cliente');
          return; // No es fatal
        default:
          console.error('   → Error no manejado:', error.stack);
      }

      process.exit(1);
    };

    httpServer.on('error', (error) => handleServerError('HTTP', error));
    httpsServer.on('error', (error) => handleServerError('HTTPS', error));

    // 6. Manejo de señales para apagado limpio
    process.on('SIGTERM', () => {
      shutdown(httpServer, 'SIGTERM');
      shutdown(httpsServer, 'SIGTERM');
    });
    process.on('SIGINT', () => {
      shutdown(httpServer, 'SIGINT');
      shutdown(httpsServer, 'SIGINT');
    });
    process.on('uncaughtException', (err) => {
      console.error('⚠️ Excepción no capturada:', err);
      shutdown(httpServer, 'uncaughtException');
      shutdown(httpsServer, 'uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      console.error('⚠️ Rechazo no manejado:', reason);
    });

  } catch (error) {
    console.error('💥 Error crítico al iniciar el servidor:', error);
    process.exit(1);
  }
};

// Iniciar el servidor con manejo de promesas no controladas
startServer()
  .catch(error => {
    console.error('💣 Error no controlado en startServer:', error);
    process.exit(1);
  });