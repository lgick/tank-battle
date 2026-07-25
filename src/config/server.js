import VIMP from '../server/modules/VIMP.js';

export default {
  name: 'Tank Battle',
  protocol: 'https:',
  domain: 'localhost',
  port: 3000,

  // сертификаты для локальной разработки
  // (для продакшена сертификаты от Let's Encrypt)
  httpsOptions: {
    key: './.certs/key.pem', // ключ
    cert: './.certs/cert.pem', // сертификат
  },

  oneConnection: true,
  VIMP,
};
