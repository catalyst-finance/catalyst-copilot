const corsOptions = {
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://www.figma.com',
      'https://figma.com'
    ];
    
    // Allow any *.figma.site subdomain (Figma Make preview) or allowed origins
    if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.figma.site'))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type']
};

module.exports = corsOptions;
