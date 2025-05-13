import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import cors from 'cors';

// Importación de rutas
import authRoutes from './user&settings/routes/auth.routes.js';
import paymentRoutes from './user&settings/routes/payment.routes.js';
import paypalRoutes from './user&settings/routes/paypal.routes.js';
import settingsRoutes from './user&settings/routes/settings.routes.js';
import scrapingRoutes from './scraping/routes/partidos.scraping.routes.js';
import scrapingRoutesLigas from './scraping/routes/ligas.scraping.routes.js';
import googleAuthRoutes from './user&settings/routes/googleAuth.routes.js';

// Configuración de Passport
import passport from './user&settings/config/passport.js';
import session from 'express-session';

const app = express();

// 1. Configuración CORS mejorada y simplificada
const allowedOrigins = [
  'http://localhost:5173',
  'https://iqscore.space',
  'https://www.iqscore.space',
  'http://iqscore.space',
  'http://www.iqscore.space',
  process.env.FRONTEND_URL
].filter(Boolean);

// Middleware CORS más permisivo para desarrollo
if (process.env.NODE_ENV === 'development') {
  app.use(cors({
    origin: true, // Permite cualquier origen en desarrollo
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} else {
  // Configuración CORS para producción
  app.use(cors({
    origin: function (origin, callback) {
      // Permitir solicitudes sin origen (como mobile apps o curl)
      if (!origin) return callback(null, true);
      
      // Verificar si el origen está en la lista blanca
      if (allowedOrigins.some(allowedOrigin => {
        return origin === allowedOrigin || 
               origin.includes(allowedOrigin.replace(/https?:\/\//, '')) ||
               origin.includes(allowedOrigin.replace('www.', ''));
      })) {
        return callback(null, true);
      }
      
      console.warn(`⚠️ Origen no permitido por CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
  }));
}

// 2. Middlewares esenciales
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// 3. Configuración de sesión mejorada
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  },
  name: 'sessionId'
}));

// 4. Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// 5. Middleware para manejar preflight OPTIONS requests
app.options('*', cors()); // Habilitar preflight para todas las rutas

// 6. Rutas API
app.use('/api', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/scraping', scrapingRoutes);
app.use('/api/scraping', scrapingRoutesLigas);
app.use('/api/auth', googleAuthRoutes);

// 7. Middleware para manejar rutas no encontradas
app.use((req, res, next) => {
  res.status(404).json({ 
    success: false,
    message: 'Endpoint no encontrado',
    path: req.originalUrl
  });
});

// 8. Manejador de errores global mejorado
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.stack);
  
  // Manejo específico para errores CORS
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Acceso no permitido por política CORS',
      allowedOrigins: allowedOrigins
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Error interno del servidor' 
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

export default app;