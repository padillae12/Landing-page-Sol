const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuración del Pool de MariaDB
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'delsol_admin',
  password: process.env.DB_PASS || 'petrosolcenter',
  database: process.env.DB_NAME || 'delsol_db',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

// Lista blanca de números autorizados
const rawAuthorized = process.env.AUTHORIZED_NUMBERS || '5216861190948,526861190948,5216861824675,526861824675,5216864004238,526864004238';
const AUTHORIZED_NUMBERS = rawAuthorized
  .split(',')
  .map(n => n.trim().replace(/\D/g, ''))
  .filter(Boolean);

console.log('🔒 Números autorizados cargados:', AUTHORIZED_NUMBERS);

// Inicializar cliente de WhatsApp con persistencia de sesión
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

// Generar código QR en la consola
client.on('qr', (qr) => {
  console.log('\n📲 Escanea este código QR con WhatsApp para vincular el bot:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot de WhatsApp listo y escuchando mensajes.');
});

client.on('authenticated', () => {
  console.log('🔑 Sesión de WhatsApp autenticada correctamente.');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación en WhatsApp:', msg);
});

// Función para extraer compra y venta del texto
function parseExchangeRateMessage(text) {
  const clean = text.toLowerCase();

  // Debe incluir alguna palabra clave como solcentro, sol o delsol
  if (!clean.includes('solcentro') && !clean.includes('sol') && !clean.includes('delsol')) {
    return null;
  }

  // Buscar compra y venta con decimales (acepta tanto coma como punto decimal)
  // Ejemplos: "compra: 17.30", "c: 17.30", "compra 17.30", "c 17,30"
  const buyMatch = clean.match(/(?:compra|c)[\s:]+(\d+[.,]\d+)/i);
  const sellMatch = clean.match(/(?:venta|v)[\s:]+(\d+[.,]\d+)/i);

  if (buyMatch && sellMatch) {
    const buy = parseFloat(buyMatch[1].replace(',', '.'));
    const sell = parseFloat(sellMatch[1].replace(',', '.'));
    return { buy, sell };
  }

  return null;
}

// Escuchar mensajes entrantes (tanto recibidos como enviados por uno mismo)
async function handleIncomingMessage(msg) {
  try {
    // Obtener número del remitente (o del chat si es mensaje propio)
    const rawSender = msg.from || msg.to || '';
    const sender = rawSender.replace(/\D/g, '');
    const body = msg.body || '';

    console.log(`📩 Mensaje detectado de [${rawSender}] (limpio: ${sender}): "${body}"`);

    // Validar si el remitente o destinatario está autorizado
    const isAuthorized = AUTHORIZED_NUMBERS.some(authNum => sender.includes(authNum) || authNum.includes(sender));
    if (!isAuthorized) {
      console.log(`⛔ Número [${sender}] NO está en la lista blanca.`);
      return;
    }

    // Si el usuario pide el estado actual
    if (/^(sol|delsol|precio|tasa|tipo de cambio)$/i.test(body.trim())) {
      const [rows] = await pool.query(
        'SELECT precio_compra, precio_venta, fecha_creacion FROM tipos_cambio ORDER BY fecha_creacion DESC LIMIT 1'
      );
      if (rows.length > 0) {
        const rate = rows[0];
        const date = new Date(rate.fecha_creacion).toLocaleString('es-MX', {
          timeZone: 'America/Tijuana',
          dateStyle: 'medium',
          timeStyle: 'short'
        });
        await msg.reply(
          `📊 *Tipo de cambio actual en delsolcentrocambiario.com:*\n\n` +
          `💵 *Compra:* $${parseFloat(rate.precio_compra).toFixed(4)}\n` +
          `🏷️ *Venta:* $${parseFloat(rate.precio_venta).toFixed(4)}\n` +
          `🕒 *Última actualización:* ${date}\n\n` +
          `_Para cambiarlo envía por ejemplo:_\n*SolCentro, compra: 17.30, venta: 18.50*`
        );
      }
      return;
    }

    // Intentar parsear el comando de cambio
    const parsed = parseExchangeRateMessage(body);
    if (!parsed) {
      console.log(`ℹ️ Mensaje no coincide con formato de compra/venta.`);
      return;
    }

    const { buy, sell } = parsed;

    // Validaciones
    if (isNaN(buy) || isNaN(sell) || buy <= 0 || sell <= 0) {
      await msg.reply('⚠️ *Error:* Los precios de compra y venta deben ser números válidos mayores a 0.');
      return;
    }

    if (sell <= buy) {
      await msg.reply(
        `⚠️ *Error de lógica:* El precio de venta ($${sell.toFixed(4)}) debe ser mayor al de compra ($${buy.toFixed(4)}).`
      );
      return;
    }

    // Insertar en la base de datos
    await pool.query(
      'INSERT INTO tipos_cambio (precio_compra, precio_venta) VALUES (?, ?)',
      [buy, sell]
    );

    const nowFormatted = new Date().toLocaleString('es-MX', {
      timeZone: 'America/Tijuana',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    // Responder con confirmación
    const replyMessage = 
      `✅ *¡Tipo de cambio actualizado con éxito!*\n\n` +
      `💵 *Compra:* $${buy.toFixed(4)} MXN\n` +
      `🏷️ *Venta:* $${sell.toFixed(4)} MXN\n` +
      `🕒 *Fecha:* ${nowFormatted}\n\n` +
      `🌐 Ya visible en vivo en: https://delsolcentrocambiario.com/`;

    await msg.reply(replyMessage);
    console.log(`[BOT] Tipo de cambio actualizado por ${sender}: Compra=${buy}, Venta=${sell}`);

  } catch (error) {
    console.error('❌ Error al procesar mensaje:', error);
    try {
      await msg.reply('❌ Ocurrió un error interno al intentar guardar el tipo de cambio.');
    } catch (_) {}
  }
}

client.on('message', handleIncomingMessage);
client.on('message_create', (msg) => {
  // message_create detecta también cuando te auto-envías mensajes a ti mismo
  if (msg.fromMe) {
    handleIncomingMessage(msg);
  }
});

// Iniciar cliente
client.initialize();
