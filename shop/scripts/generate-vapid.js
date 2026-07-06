const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('Добавьте в .env или Render Environment:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:info@emikashotchicken.ru');
