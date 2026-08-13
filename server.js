/**
 * NextGen Realtors — SMS OTP & Social Media Proxy Server
 */

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const multer = require('multer');
const FormData = require('form-data');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const app = express();
const PORT = 3001;

const uploadsRoot = path.join(__dirname, 'uploads');
const brochuresDir = path.join(uploadsRoot, 'brochures');
fs.mkdirSync(brochuresDir, { recursive: true });
const BROCHURE_MAX_BYTES = 20 * 1024 * 1024;

// ---- Storage Config for Multer ----
const mediaUpload = multer({ storage: multer.memoryStorage() });

const brochureUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, brochuresDir),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `${unique}${path.extname(file.originalname).toLowerCase() || '.pdf'}`);
    }
  }),
  limits: {
    fileSize: BROCHURE_MAX_BYTES,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed.'));
    }
    cb(null, true);
  }
});

// ---- Your Fast2SMS API Key ----
const FAST2SMS_API_KEY = 'G2Odr3luxCqjJ7cUnwbBv5gfVyLFzQM91Hie0oskIWaDYNXh6mUnloSROW5kGiPA19hyJQKpETmMgDBZ';

// ---- Allow CORS & Security Headers ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Security Headers
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://accounts.google.com https://securetoken.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://*.googleapis.com https://*.firebaseio.com https://formsubmit.co wss://*.firebaseio.com; frame-src 'self' https://www.google.com https://nextgenrealtors-e3e3c.firebaseapp.com blob:; object-src 'self' blob: data:; frame-ancestors 'self';");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Health check ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'NextGen Realtors Proxy is running ✅' });
});

// ---- Uploaded Brochures ----
app.use('/uploads', express.static(uploadsRoot));

app.post('/api/upload-brochure', (req, res) => {
  brochureUpload.array('brochures', 10)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File size exceeds 20MB limit. Please choose a smaller file.' });
      }
      return res.status(400).json({ success: false, error: err.message || 'Failed to upload brochure files.' });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: 'No PDF files were provided.' });
    }

    const uploaded = files.map(file => ({
      url: `/uploads/brochures/${file.filename}`,
      name: file.originalname,
      path: file.path,
      size: file.size,
    }));

    res.json({ success: true, uploaded });
  });
});

// ---- Serve Frontend Files ----
app.use(express.static(__dirname));

// ---- Fallback for SPA routing (optional but helpful) ----
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ---- 1. Fast2SMS OTP Proxy ----
app.get('/send-otp', async (req, res) => {
  const { phone, otp } = req.query;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, error: 'Missing phone or otp parameter.' });
  }

  let tenDigitPhone = phone.replace(/[^0-9]/g, '');
  if (tenDigitPhone.startsWith('91') && tenDigitPhone.length === 12) {
    tenDigitPhone = tenDigitPhone.slice(2);
  }

  if (tenDigitPhone.length !== 10) {
    return res.status(400).json({ success: false, error: `Invalid phone number: ${phone}` });
  }

  const message = encodeURIComponent(`Your NextGen Realtors OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`);
  const smsUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=${FAST2SMS_API_KEY}&route=v3&sender_id=FTWSMS&message=${message}&language=english&flash=0&numbers=${tenDigitPhone}`;

  try {
    console.log(`[SMS] Sending OTP to ${tenDigitPhone}...`);
    const response = await fetch(smsUrl, { method: 'GET' });
    const result = await response.json();

    if (result.return === true) {
      console.log(`[SMS] ✅ OTP sent successfully to ${tenDigitPhone}`);
      return res.json({ success: true });
    } else {
      console.error('[SMS] ❌ Fast2SMS error:', result);
      return res.status(500).json({ success: false, error: result.message || 'Fast2SMS rejected the request.' });
    }
  } catch (err) {
    console.error('[SMS] ❌ Network error calling Fast2SMS:', err.message);
    return res.status(500).json({ success: false, error: 'Network error reaching SMS provider.' });
  }
});

// ---- 2. Social Media Publishing ----
app.post('/api/publish', mediaUpload.single('media'), async (req, res) => {
  try {
    const { desc, fb, ig, yt, type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No media file provided.' });
    }

    const isFb = fb === 'true';
    const isIg = ig === 'true';
    const isYt = yt === 'true';

    let fbResult = null;
    let ytResult = null;
    let igResult = null;

    // --- FACEBOOK INTEGRATION ---
    if (isFb) {
      const fbToken = process.env.FB_PAGE_ACCESS_TOKEN;
      const fbPageId = process.env.FB_PAGE_ID;
      
      if (!fbToken || !fbPageId) {
        fbResult = { error: 'Missing FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID in .env' };
      } else {
        const formData = new FormData();
        formData.append('description', desc || '');
        formData.append('source', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });

        const endpoint = file.mimetype.startsWith('video/') ? 'videos' : 'photos';
        const graphUrl = `https://graph.facebook.com/v19.0/${fbPageId}/${endpoint}?access_token=${fbToken}`;

        try {
          const response = await fetch(graphUrl, {
            method: 'POST',
            body: formData
          });
          fbResult = await response.json();
        } catch (e) {
          fbResult = { error: e.message };
        }
      }
    }

    // --- INSTAGRAM INTEGRATION ---
    // Note: Direct binary upload is not supported in IG Graph API (requires image_url).
    if (isIg) {
      igResult = { error: 'Instagram requires a public URL (e.g. Firebase) instead of direct binary upload.' };
    }

    // --- YOUTUBE INTEGRATION ---
    if (isYt && file.mimetype.startsWith('video/')) {
      const clientId = process.env.YOUTUBE_CLIENT_ID;
      const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
      const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        ytResult = { error: 'Missing YOUTUBE credentials in .env' };
      } else {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        try {
          const ytRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
              snippet: {
                title: file.originalname || 'New Realtor Video',
                description: desc,
                tags: ['Real Estate', 'NextGen Realtors'],
                categoryId: '22' // People & Blogs
              },
              status: {
                privacyStatus: 'public' // or 'unlisted'
              }
            },
            media: {
              body: bufferStream
            }
          });
          ytResult = ytRes.data;
        } catch (e) {
          ytResult = { error: e.message };
        }
      }
    }

    // If strictly only one platform was requested and it failed due to creds, throw 500
    if (isFb && !isIg && !isYt && fbResult && fbResult.error && fbResult.error.includes('Missing')) {
      return res.status(500).json({ success: false, error: fbResult.error });
    }
    if (isYt && !isFb && !isIg && ytResult && ytResult.error && ytResult.error.includes('Missing')) {
      return res.status(500).json({ success: false, error: ytResult.error });
    }

    res.json({
      success: true,
      message: 'Publish flow executed.',
      facebook: fbResult,
      instagram: igResult,
      youtube: ytResult
    });

  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log('');
  console.log('  ✅ NextGen Realtors API Server');
  console.log(`  🚀 Listening on http://localhost:${PORT}`);
  console.log('');
});
