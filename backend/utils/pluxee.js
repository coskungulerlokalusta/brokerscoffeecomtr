// Pluxee (eski adıyla Sodexo) OTP tabanlı ödeme entegrasyonu — SOAP/XML web servisleri.
// Akış: LoginWsUser (kullanıcı adı+şifre) -> WsToken -> CreateActionToken -> işlem tokenı ->
// müşteri Pluxee mobil uygulamasından aldığı 6 haneli kodu (OTP) + telefon numarasını girer ->
// OTP, Pluxee'nin verdiği RSA public key ile şifrelenir -> MakePayment ile ödeme tamamlanır.
//
// NOT: Bu, Multinet/Paynet gibi kart yönlendirmeli bir 3D akış DEĞİL — müşteri sitede kalır,
// sadece telefon + Pluxee uygulamasından aldığı kodu girer.
const https = require('https');
const crypto = require('crypto');
const integrations = require('./integrations');

const URLS = {
  uat: {
    login: 'https://payment.partners.uat.pluxee.com.tr/LoginWS.svc',
    payment: 'https://payment.partners.uat.pluxee.com.tr/PaymentWS.svc',
  },
  prod: {
    login: 'https://payment.partners.pluxee.com.tr/LoginWS.svc',
    payment: 'https://payment.partners.pluxee.com.tr/PaymentWS.svc',
  },
};

let cachedWsToken = null;
let cachedWsTokenAt = 0;
const WS_TOKEN_CACHE_MS = 10 * 60 * 1000; // 10 dakika — doküman süresini belirtmiyor, temkinli bir değer

function extractXml(xml, tag) {
  const match = xml.match(new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([^<]*)<\\/(?:[\\w]+:)?${tag}>`));
  return match ? match[1] : null;
}

function postSoap(url, xmlBody) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(xmlBody, 'utf8'),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, raw }));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`Pluxee sunucusuna bağlanılamadı (zaman aşımı): ${u.hostname}`)));
    req.on('error', reject);
    req.write(xmlBody, 'utf8');
    req.end();
  });
}

// Kullanıcının Pluxee uygulamasından aldığı 6 haneli kodu, Pluxee'nin verdiği RSA
// public key (PEM formatında) ile OAEP+SHA-1 şifreler.
function encryptOtp(otp, publicKeyPem) {
  const buffer = Buffer.from(otp, 'utf16le'); // dokümandaki örnekler UTF-16LE/Unicode kullanıyor
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    buffer
  );
  return encrypted.toString('base64');
}

async function login(creds, { force } = {}) {
  if (!force && cachedWsToken && Date.now() - cachedWsTokenAt < WS_TOKEN_CACHE_MS) {
    return cachedWsToken;
  }
  const url = URLS[creds.environment || 'uat'].login;
  const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.sodexopayment.com/LoginService/2019/04" xmlns:sod="http://schemas.datacontract.org/2004/07/SodexoPayment.Common.Model.Login">
   <soapenv:Header/>
   <soapenv:Body>
      <ns:LoginWsUser>
         <ns:wsUserInfo>
            <sod:Password>${creds.wsPassword}</sod:Password>
            <sod:UserName>${creds.wsUserName}</sod:UserName>
         </ns:wsUserInfo>
      </ns:LoginWsUser>
   </soapenv:Body>
</soapenv:Envelope>`;

  const res = await postSoap(url, xml);
  const resultCode = extractXml(res.raw, 'ResultCode');
  const resultMessage = extractXml(res.raw, 'ResultMessage');
  const token = extractXml(res.raw, 'Token');

  if (resultCode !== '0' || !token) {
    throw new Error(`Pluxee girişi başarısız (kod ${resultCode}): ${resultMessage || res.raw.slice(0, 300)}`);
  }
  cachedWsToken = token;
  cachedWsTokenAt = Date.now();
  return token;
}

async function createActionToken(creds, wsToken) {
  const url = URLS[creds.environment || 'uat'].login;
  const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.sodexopayment.com/LoginService/2019/04" xmlns:sod="http://schemas.datacontract.org/2004/07/SodexoPayment.Common.Model.Login">
   <soapenv:Header/>
   <soapenv:Body>
      <ns:CreateActionToken>
         <ns:actionTokenRequest>
            <sod:ActionType>SodexoPayment</sod:ActionType>
            <sod:MerchantNo>${creds.merchantNo}</sod:MerchantNo>
            <sod:TerminalNo>${creds.terminalNo}</sod:TerminalNo>
            <sod:WsToken>${wsToken}</sod:WsToken>
         </ns:actionTokenRequest>
      </ns:CreateActionToken>
   </soapenv:Body>
</soapenv:Envelope>`;

  const res = await postSoap(url, xml);
  const resultCode = extractXml(res.raw, 'ResultCode');
  const resultMessage = extractXml(res.raw, 'ResultMessage');
  const token = extractXml(res.raw, 'Token');

  if (resultCode !== '0' || !token) {
    throw new Error(`Pluxee işlem anahtarı alınamadı (kod ${resultCode}): ${resultMessage || res.raw.slice(0, 300)}`);
  }
  return token;
}

// Ödemeyi tamamlar. gsm: 10 haneli (başında 0 olmadan), otp: müşterinin girdiği 6 haneli kod.
async function makePayment({ gsm, otp, amount, externalRrn, externalInfo }) {
  const creds = await integrations.getProviderCredentials('pluxee');
  if (!creds || !creds.enabled) throw new Error('Pluxee entegrasyonu aktif değil');
  if (!creds.wsUserName || !creds.wsPassword || !creds.merchantNo || !creds.terminalNo) {
    throw new Error('Pluxee bilgileri eksik (Kullanıcı Adı / Şifre / Üye No / Terminal No)');
  }
  if (!creds.publicKeyPem) {
    throw new Error('Pluxee RSA Public Key girilmemiş — bunu Pluxee ayrıca bir dosya olarak paylaşacak');
  }

  const wsToken = await login(creds);
  const actionToken = await createActionToken(creds, wsToken);
  const encryptedOtp = encryptOtp(otp, creds.publicKeyPem);

  const url = URLS[creds.environment || 'uat'].payment;
  const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.sodexopayment.com/PaymentService/2019/04" xmlns:sod="http://schemas.datacontract.org/2004/07/SodexoPayment.Common.Model.Payment">
   <soapenv:Body>
      <ns:MakePayment>
         <ns:paymentInfo>
            <sod:WsToken>${actionToken}</sod:WsToken>
            <sod:TxnType>OtpPayment</sod:TxnType>
            <sod:TxnStatus>N</sod:TxnStatus>
            <sod:MerchantNo>${creds.merchantNo}</sod:MerchantNo>
            <sod:TerminalNo>${creds.terminalNo}</sod:TerminalNo>
            <sod:ExternalRrn>${externalRrn}</sod:ExternalRrn>
            <sod:TxnCode>${encryptedOtp}</sod:TxnCode>
            <sod:Amount>${amount}</sod:Amount>
            <sod:Gsm>${gsm}</sod:Gsm>
            <sod:ExternalInfo>${externalInfo || ''}</sod:ExternalInfo>
         </ns:paymentInfo>
      </ns:MakePayment>
   </soapenv:Body>
</soapenv:Envelope>`;

  const res = await postSoap(url, xml);
  const resultCode = extractXml(res.raw, 'ResultCode');
  const resultMessage = extractXml(res.raw, 'ResultMessage');
  const rrn = extractXml(res.raw, 'Rrn');

  return { success: resultCode === '0', resultCode, resultMessage, rrn, raw: res.raw };
}

// İade — kısmi ya da tam
async function makeRefund({ originalRrn, amount }) {
  const creds = await integrations.getProviderCredentials('pluxee');
  if (!creds || !creds.enabled) throw new Error('Pluxee entegrasyonu aktif değil');
  const wsToken = await login(creds);
  const actionToken = await createActionToken(creds, wsToken);

  const url = URLS[creds.environment || 'uat'].payment;
  const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.sodexopayment.com/PaymentService/2019/04" xmlns:sod="http://schemas.datacontract.org/2004/07/SodexoPayment.Common.Model.Payment">
   <soapenv:Body>
      <ns:MakeRefund>
         <ns:refundInfo>
            <sod:WsToken>${actionToken}</sod:WsToken>
            <sod:TxnStatus>N</sod:TxnStatus>
            <sod:MerchantNo>${creds.merchantNo}</sod:MerchantNo>
            <sod:TerminalNo>${creds.terminalNo}</sod:TerminalNo>
            <sod:Amount>${amount}</sod:Amount>
            <sod:OriginalRrn>${originalRrn}</sod:OriginalRrn>
         </ns:refundInfo>
      </ns:MakeRefund>
   </soapenv:Body>
</soapenv:Envelope>`;

  const res = await postSoap(url, xml);
  const resultCode = extractXml(res.raw, 'ResultCode');
  const resultMessage = extractXml(res.raw, 'ResultMessage');
  const rrn = extractXml(res.raw, 'Rrn');
  return { success: resultCode === '0', resultCode, resultMessage, rrn, raw: res.raw };
}

// Bilgilerin doğru olduğunu gerçekten giriş yaparak test eder.
async function testConnection() {
  const creds = await integrations.getProviderCredentials('pluxee');
  if (!creds.wsUserName || !creds.wsPassword) {
    throw new Error('Kullanıcı Adı / Şifre eksik');
  }
  await login(creds, { force: true });
  return `Giriş başarılı (${creds.environment === 'prod' ? 'CANLI' : 'UAT/TEST'} ortam). Gerçek ödeme testi için siteden bir sipariş denemen gerekir.`;
}

module.exports = { encryptOtp, makePayment, makeRefund, testConnection };
