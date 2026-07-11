/**
 * NextGen Realtors — SMS OTP & Social Media Proxy Server
 */

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const multer = require('multer');
const FormData = require('form-data');
const { google } = require('googleapis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const MAX_BROCHURE_SIZE = 20 * 1024 * 1024;
const MAX_BROCHURES = 10;
const BROCHURE_DIR = path.join(__dirname, 'uploads', 'brochures');

fs.mkdirSync(BROCHURE_DIR, { recursive: true });
app.use(express.json({ limit: '1mb' }));

// ---- Storage Config for Multer ----
const upload = multer({ storage: multer.memoryStorage() });

// ---- Storage Config for PDF Uploads (Disk Storage) ----
const pdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, BROCHURE_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${uniqueSuffix}.pdf`);
  }
});
const pdfUpload = multer({
  storage: pdfStorage,
  limits: {
    fileSize: MAX_BROCHURE_SIZE,
    files: MAX_BROCHURES
  },
  fileFilter: function (req, file, cb) {
    const isPdf = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) {
      const error = new Error('Only PDF files are allowed.');
      error.code = 'INVALID_FILE_TYPE';
      return cb(error);
    }
    cb(null, true);
  }
});

function removeUploadedFiles(files = []) {
  for (const file of files) {
    fs.rm(file.path, { force: true }, () => {});
  }
}

function brochureInfo(file) {
  return {
    url: `/uploads/brochures/${file.filename}`,
    name: file.originalname,
    path: path.posix.join('uploads', 'brochures', file.filename),
    size: file.size
  };
}

// ---- Your Fast2SMS API Key ----
const FAST2SMS_API_KEY = 'G2Odr3luxCqjJ7cUnwbBv5gfVyLFzQM91Hie0oskIWaDYNXh6mUnloSROW5kGiPA19hyJQKpETmMgDBZ';

// ---- Allow CORS & Security Headers ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Security Headers
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://accounts.google.com https://securetoken.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://formsubmit.co wss://*.firebaseio.com; frame-src 'self' blob: https://www.google.com https://nextgenrealtors-e3e3c.firebaseapp.com https://firebasestorage.googleapis.com https://storage.googleapis.com; object-src 'self' blob:; frame-ancestors 'none';");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Health check ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'NextGen Realtors Proxy is running ✅' });
});

// ---- Serve Uploaded PDFs ----
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self';");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
}));

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

// ---- 2. PDF/Brochure Upload ----
app.post('/api/upload-brochure', (req, res) => {
  pdfUpload.array('brochures', MAX_BROCHURES)(req, res, (error) => {
    if (error) {
      removeUploadedFiles(req.files);
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File size exceeds 20MB limit. Please choose a smaller file.'
        });
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: 'A maximum of 10 brochures can be uploaded per property.'
        });
      }
      return res.status(400).json({
        success: false,
        error: error.message || 'Unable to upload brochure.'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded.' });
    }

    const brochures = req.files.map(brochureInfo);
    res.json({
      success: true,
      brochures
    });
  });
});

app.delete('/api/brochures', (req, res) => {
  const storedPath = typeof req.body.path === 'string' ? req.body.path : '';
  const storedUrl = typeof req.body.url === 'string' ? req.body.url : '';
  const filename = path.basename(storedPath || storedUrl);
  const brochurePath = path.join(BROCHURE_DIR, filename);

  if (!filename || path.extname(filename).toLowerCase() !== '.pdf' || path.dirname(brochurePath) !== BROCHURE_DIR) {
    return res.status(400).json({ success: false, error: 'Invalid brochure path.' });
  }

  fs.rm(brochurePath, { force: true }, (error) => {
    if (error) {
      return res.status(500).json({ success: false, error: 'Failed to delete brochure.' });
    }
    res.json({ success: true });
  });
});

// ---- 3. Social Media Publishing ----
app.post('/api/publish', upload.single('media'), async (req, res) => {
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
