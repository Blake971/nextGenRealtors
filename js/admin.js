/* =========================================================
   ADMIN.JS — Authentication + Admin form logic
   Default password: admin123
   ========================================================= */

/* ---- Security: SHA-256 helper (non-reversible, unlike btoa) ---- */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Migrate a legacy btoa hash to sha256 if needed */
async function _migrateLegacyHash(plaintext, storedHash) {
  // Check if stored hash looks like btoa (valid base64, not a 64-char hex string)
  if (storedHash && storedHash.length !== 64) {
    // It might be btoa — compare and migrate
    if (btoa(plaintext) === storedHash) return true; // password matches legacy hash
  }
  return false;
}

/* ---- Brute-Force Protection ---- */
const _loginState = {
  attempts: 0,
  lockUntil: 0,
  maxAttempts: 5,
  lockDurationMs: 2 * 60 * 1000 // 2 minutes
};

function _isLockedOut() {
  if (_loginState.lockUntil && Date.now() < _loginState.lockUntil) return true;
  if (_loginState.lockUntil && Date.now() >= _loginState.lockUntil) {
    // Lock expired, reset
    _loginState.attempts = 0;
    _loginState.lockUntil = 0;
  }
  return false;
}

function _getLockoutMessage() {
  const remaining = Math.ceil((_loginState.lockUntil - Date.now()) / 1000);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `Too many failed attempts. Try again in ${mins}m ${secs}s.`;
}

const Admin = {
  isLoggedIn() {
    try { return sessionStorage.getItem('re_admin') === 'true'; }
    catch (e) { return false; }
  },

  async getAuthDoc() {
    const settings = (await DB.settings.get()) || [];
    let authDoc = settings.find(s => s.type === 'admin_auth');
    if (!authDoc) {
      const defaultAuth = {
        type: 'admin_auth',
        passwordHash: await sha256('admin123'),
        sqQuestion: 'What is the name of your first pet?',
        sqAnswerHash: await sha256('fluffy')
      };
      const added = await DB.settings.add(defaultAuth);
      authDoc = { id: added.id, ...defaultAuth };
    }
    return authDoc;
  },

  async login(pw) {
    // Brute-force check
    if (_isLockedOut()) return { success: false, locked: true };
    try {
      const authDoc = await this.getAuthDoc();
      const pwHash = await sha256(pw);
      let matched = (pwHash === authDoc.passwordHash);

      // Auto-migrate legacy btoa hash → sha256 on successful match
      if (!matched) {
        const legacyMatch = await _migrateLegacyHash(pw, authDoc.passwordHash);
        if (legacyMatch) {
          // Upgrade hash in Firestore to sha256 silently
          await DB.settings.update(authDoc.id, { passwordHash: pwHash });
          matched = true;
        }
      }

      if (matched) {
        _loginState.attempts = 0;
        _loginState.lockUntil = 0;
        try { sessionStorage.setItem('re_admin', 'true'); } catch (e) { }
        return { success: true };
      }
    } catch (err) {
      console.error('Login error:', err);
    }
    _loginState.attempts++;
    if (_loginState.attempts >= _loginState.maxAttempts) {
      _loginState.lockUntil = Date.now() + _loginState.lockDurationMs;
    }
    return { success: false, locked: false };
  },

  logout() {
    try { sessionStorage.removeItem('re_admin'); } catch (e) { }
  },
};

// ---- UI helpers ----
function applyAdminUI() {
  const isAdmin = Admin.isLoggedIn();
  document.body.classList.toggle('admin-mode', isAdmin);

  const btn = document.getElementById('admin-btn');
  const badge = document.getElementById('admin-badge');
  const fab = document.getElementById('admin-fab');

  if (btn) {
    btn.innerHTML = isAdmin
      ? '🔓 <span>Admin Mode</span>'
      : '🔐 <span>Admin</span>';
  }
  if (badge) badge.style.display = isAdmin ? 'inline-block' : 'none';

  // Fix: control FAB with inline style here (overrides any stale inline style from loadPage)
  if (fab) {
    const listingPages = ['plots', 'flats', 'apartments', 'villas', 'commercial'];
    const currentPage = (location.hash || '#about').replace('#', '');
    fab.style.display = (isAdmin && listingPages.includes(currentPage)) ? 'flex' : 'none';
  }

  // Toggle Change Password button
  const cpwbtn = document.getElementById('admin-cpw-btn');
  if (cpwbtn) cpwbtn.style.display = isAdmin ? 'inline-block' : 'none';

  // Toggle Subscribers tab
  const subNav = document.getElementById('nav-subscribers');
  if (subNav) subNav.style.display = isAdmin ? 'block' : 'none';
}

// ---- Admin Modals ----
function showAdminLoginModal() {
  if (Admin.isLoggedIn()) {
    openModal('admin-logout-modal');
    return;
  }
  document.getElementById('admin-pw-error').textContent = '';
  document.getElementById('admin-pw-input').value = '';
  openModal('admin-login-modal');
}

function confirmLogout() {
  Admin.logout();
  closeModal('admin-logout-modal');
  applyAdminUI();
  showToast('Logged out of admin mode.');
  if (window._currentPage) window._currentPage();
}

async function handleAdminLogin() {
  const pw = document.getElementById('admin-pw-input').value;
  const err = document.getElementById('admin-pw-error');
  const btn = document.getElementById('admin-login-submit-btn');

  if (!pw) { err.textContent = 'Please enter a password.'; return; }

  // Check lockout before making any request
  if (_isLockedOut()) {
    err.textContent = _getLockoutMessage();
    return;
  }

  if (btn) btn.disabled = true;
  if (window.showToast) showToast('Verifying...', 'info');

  const result = await Admin.login(pw);

  if (btn) btn.disabled = false;

  if (result.success) {
    closeModal('admin-login-modal');
    document.getElementById('admin-pw-input').value = '';
    err.textContent = '';
    applyAdminUI();
    showToast('✅ Admin mode activated!', 'success');
    if (window._currentPage) window._currentPage();
  } else if (result.locked) {
    err.textContent = _getLockoutMessage();
    document.getElementById('admin-pw-input').value = '';
  } else {
    const remaining = _loginState.maxAttempts - _loginState.attempts;
    err.textContent = remaining > 0
      ? `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      : _getLockoutMessage();
    document.getElementById('admin-pw-input').value = '';
    document.getElementById('admin-pw-input').focus();
  }
}

window.formatFileSize = window.formatFileSize || function(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const BROCHURE_MAX_BYTES = 20 * 1024 * 1024;

window.normalizeBrochures = window.normalizeBrochures || function(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        return { url: item, name: 'Brochure PDF', path: '', size: 0, status: 'uploaded', progress: 100 };
      }
      return {
        url: item.url || item.fileUrl || item.brochureUrl || '',
        name: item.name || item.originalName || item.filename || item.brochureName || 'Brochure PDF',
        path: item.path || item.filePath || item.brochurePath || '',
        size: Number(item.size || item.fileSize || 0),
        status: item.status || 'uploaded',
        progress: Number(item.progress || (item.status === 'uploading' ? 0 : 100)),
      };
    })
    .filter(item => item && item.url);
};

function getBrochureUploadEndpoint() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    if (window.location.port === '3001') {
      return '/api/upload-brochure';
    }
    return `${window.location.protocol}//${host}:3001/api/upload-brochure`;
  }
  return '/api/upload-brochure';
}

function readBrochureAsDataUrl(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    reader.onload = (e) => {
      resolve({
        url: e.target.result,
        name: file.name,
        path: '',
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read brochure file.'));
    reader.readAsDataURL(file);
  });
}

async function uploadBrochureFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getBrochureUploadEndpoint());
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = xhr.response || JSON.parse(xhr.responseText || '{}');
        const uploaded = response.uploaded || [];
        if (response.success && uploaded.length > 0) {
          resolve(uploaded[0]);
          return;
        }
      }
      // Fallback to Data URL if server response is not successful
      readBrochureAsDataUrl(file, onProgress).then(resolve).catch(reject);
    };

    xhr.onerror = () => {
      // Fallback to Data URL if network error occurs (e.g. backend server offline or cross-origin issue)
      readBrochureAsDataUrl(file, onProgress).then(resolve).catch(reject);
    };

    const formData = new FormData();
    formData.append('brochures', file);
    xhr.send(formData);
  });
}

async function handleBrochureUpload(event) {
  const files = Array.from(event.target.files || []);
  const list = document.getElementById('pf-brochure-list');
  const progressWrap = document.getElementById('pf-brochure-progress');
  const progressBar = document.getElementById('pf-brochure-progress-bar');
  const submitBtn = document.getElementById('prop-form-submit');
  if (!files.length) return;

  window._brochureUploadBusy = true;

  const validFiles = files.filter(file => {
    if (file.type !== 'application/pdf') {
      showToast(`"${file.name}" is not a PDF file.`, 'error');
      return false;
    }
    if (file.size > BROCHURE_MAX_BYTES) {
      showToast('File size exceeds 20MB limit. Please choose a smaller file.', 'error');
      return false;
    }
    return true;
  });

  if (!validFiles.length) {
    event.target.value = '';
    window._brochureUploadBusy = false;
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  const brochures = getCurrentBrochures();
  const total = validFiles.length;

  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i];
    const item = {
      url: '',
      name: file.name,
      path: '',
      size: file.size,
      status: 'uploading',
      progress: 0,
    };

    brochures.push(item);
    setCurrentBrochures(brochures);

    try {
      const uploaded = await uploadBrochureFile(file, (progress) => {
        item.progress = progress;
        if (progressBar) {
          progressBar.style.width = `${Math.min(100, Math.round(((i + progress / 100) / total) * 100))}%`;
        }
        renderBrochureList(list, brochures);
      });

      const index = brochures.findIndex(entry => entry === item);
      if (index !== -1) {
        brochures[index] = { ...uploaded, status: 'uploaded' };
      } else {
        brochures.push({ ...uploaded, status: 'uploaded' });
      }
      showToast(`Uploaded ${file.name}`, 'success');
    } catch (error) {
      const index = brochures.findIndex(entry => entry === item);
      if (index !== -1) brochures.splice(index, 1);
      showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
    }

    setCurrentBrochures(brochures);
  }

  if (progressBar) progressBar.style.width = '100%';
  if (progressWrap) {
    setTimeout(() => {
      progressWrap.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
    }, 800);
  }

  event.target.value = '';
  if (submitBtn) submitBtn.disabled = false;
  window._brochureUploadBusy = false;
}

// ==== CHANGE PASSWORD ====
function openChangePasswordModal() {
  closeModal('admin-logout-modal');
  document.getElementById('cpw-current').value = '';
  document.getElementById('cpw-new').value = '';
  document.getElementById('cpw-sq').value = '';
  document.getElementById('cpw-sa').value = '';
  document.getElementById('cpw-error').textContent = '';
  openModal('admin-change-pw-modal');
}

async function submitChangePassword() {
  const currentPw = document.getElementById('cpw-current').value;
  const newPw = document.getElementById('cpw-new').value;
  const sq = document.getElementById('cpw-sq').value.trim();
  const sa = document.getElementById('cpw-sa').value.trim().toLowerCase();
  const err = document.getElementById('cpw-error');

  if (!currentPw || !newPw || !sq || !sa) {
    err.textContent = 'All fields are required.';
    return;
  }

  const btn = document.getElementById('cpw-submit-btn');
  btn.disabled = true;

  try {
    const authDoc = await Admin.getAuthDoc();
    const currentHash = await sha256(currentPw);
    // Also support legacy btoa migration
    const isCorrect = (currentHash === authDoc.passwordHash) ||
      await _migrateLegacyHash(currentPw, authDoc.passwordHash);

    if (!isCorrect) {
      err.textContent = 'Current password is incorrect.';
      btn.disabled = false;
      return;
    }

    await DB.settings.update(authDoc.id, {
      passwordHash: await sha256(newPw),
      sqQuestion: sq,
      sqAnswerHash: await sha256(sa)
    });

    closeModal('admin-change-pw-modal');
    showToast('✅ Password changed successfully!', 'success');
  } catch (error) {
    console.error(error);
    err.textContent = 'Failed to save changes.';
  }
  btn.disabled = false;
}

// ==== FORGOT PASSWORD ====
async function openForgotPasswordModal() {
  closeModal('admin-login-modal');
  document.getElementById('fpw-answer').value = '';
  document.getElementById('fpw-error').textContent = '';
  document.getElementById('forgot-pw-step-1').style.display = 'block';
  document.getElementById('forgot-pw-footer-1').style.display = 'flex';
  document.getElementById('forgot-pw-step-2').style.display = 'none';
  document.getElementById('forgot-pw-footer-2').style.display = 'none';

  const authDoc = await Admin.getAuthDoc();
  document.getElementById('fpw-question-text').textContent = authDoc.sqQuestion;

  openModal('admin-forgot-pw-modal');
}

async function verifySecurityAnswer() {
  const ans = document.getElementById('fpw-answer').value.trim().toLowerCase();
  const err = document.getElementById('fpw-error');

  if (!ans) { err.textContent = 'Please enter an answer.'; return; }

  const authDoc = await Admin.getAuthDoc();
  const ansHash = await sha256(ans);
  const isCorrect = (ansHash === authDoc.sqAnswerHash) ||
    await _migrateLegacyHash(ans, authDoc.sqAnswerHash);

  if (isCorrect) {
    document.getElementById('forgot-pw-step-1').style.display = 'none';
    document.getElementById('forgot-pw-footer-1').style.display = 'none';
    document.getElementById('forgot-pw-step-2').style.display = 'block';
    document.getElementById('forgot-pw-footer-2').style.display = 'flex';
    document.getElementById('fpw-new-pw').value = '';
    document.getElementById('fpw-reset-error').textContent = '';
  } else {
    err.textContent = 'Incorrect answer.';
  }
}

async function submitResetPassword() {
  const newPw = document.getElementById('fpw-new-pw').value;
  const err = document.getElementById('fpw-reset-error');

  if (!newPw) { err.textContent = 'Please enter a new password.'; return; }

  const btn = document.getElementById('fpw-reset-btn');
  btn.disabled = true;

  try {
    const authDoc = await Admin.getAuthDoc();
    await DB.settings.update(authDoc.id, {
      passwordHash: await sha256(newPw)
    });

    closeModal('admin-forgot-pw-modal');
    showToast('✅ Password has been reset!', 'success');
  } catch (error) {
    console.error(error);
    err.textContent = 'Failed to reset password.';
  }
  btn.disabled = false;
}

// ==== MINI POST AREA MANAGEMENT ====
async function showMPAreaManager() {
  if (!Admin.isLoggedIn()) return;
  openModal('mp-areas-modal');
  renderMPAreaList();
}

async function renderMPAreaList() {
  const container = document.getElementById('mpa-list');
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mid-grey)">Loading...</div>';

  try {
    const areas = await DB.mp_areas.get();
    if (areas.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mid-grey)">No areas added yet.</div>';
    } else {
      container.innerHTML = areas.map(a => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #eee">
          <span style="font-weight:500; color:var(--navy)">${esc(a.name)}</span>
          <button class="btn btn-danger btn-sm" onclick="deleteMPArea('${a.id}')">🗑️ Delete</button>
        </div>
      `).join('');
    }
  } catch (e) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red)">Failed to load.</div>';
  }
}

async function addMPArea() {
  const input = document.getElementById('mpa-new-name');
  const name = input.value.trim();
  if (!name) { showToast('Please enter an area name.', 'error'); return; }

  try {
    await DB.mp_areas.add({ name });
    input.value = '';
    showToast('Area added successfully.', 'success');
    renderMPAreaList();
  } catch (e) {
    showToast('Failed to add area.', 'error');
  }
}

async function deleteMPArea(id) {
  if (!confirm('Are you sure you want to delete this area?')) return;
  try {
    await DB.mp_areas.del(id);
    showToast('Area deleted successfully.', 'success');
    renderMPAreaList();
  } catch (e) {
    showToast('Failed to delete area.', 'error');
  }
}

// ---- Generic Property Form ----
// type: 'plots' | 'flats' | 'villas'
// editItem: existing item to edit (or null for add)
async function showPropertyForm(type, editItem = null) {
  if (!Admin.isLoggedIn()) { showToast('Please login as admin first.', 'error'); return; }

  let areas = [];
  if (type === 'miniposts') {
    try {
      areas = await DB.mp_areas.get();
    } catch (e) { console.error('Failed to load areas', e); }
  }

  const isEdit = !!editItem;
  const title = isEdit ? `Edit ${capitalize(type.slice(0, -1))}` : `Add New ${capitalize(type.slice(0, -1))}`;

  const formHtml = buildFormHtml(type, editItem ?? {}, areas);

  document.getElementById('prop-form-modal-title').textContent = title;
  document.getElementById('prop-form-fields').innerHTML = formHtml;
  document.getElementById('prop-form-type').value = type;
  document.getElementById('prop-form-id').value = editItem ? editItem.id : '';
  document.getElementById('prop-form-submit').textContent = isEdit ? '💾 Save Changes' : '✅ Add Listing';

  // Pre-load existing images into the preview grid (edit mode)
  if (editItem && Array.isArray(editItem.images) && editItem.images.length > 0) {
    const grid = document.getElementById('pf-image-grid');
    if (grid) editItem.images.forEach(src => addImagePreview(src, grid));
  }

  const brochures = window.normalizeBrochures ? window.normalizeBrochures(editItem?.brochures || editItem?.brochure || [
    editItem?.brochureUrl ? {
      url: editItem.brochureUrl,
      name: editItem.brochureName || 'Brochure PDF',
      path: editItem.brochurePath || '',
      size: editItem.brochureSize || 0,
    } : null
  ]) : [];
  setCurrentBrochures(brochures);

  openModal('prop-form-modal');
}

function buildFormHtml(type, d = {}, areas = []) {
  const commonTop = `
    <div class="form-group">
      <label class="form-label">Company Logo <span style="font-weight:400;color:var(--mid-grey)">(optional)</span></label>
      <div style="display:flex;align-items:center;gap:16px;">
        <label class="btn btn-ghost" for="pf-company-logo-input" style="cursor:pointer;border-color:var(--light-grey)">
          📁 Browse Logo
          <input type="file" id="pf-company-logo-input" accept="image/*" style="display:none" onchange="handleCompanyLogoUpload(event)">
        </label>
        <img id="pf-company-logo-preview" style="${d.companyLogoUrl ? 'display:block' : 'display:none'};width:80px;height:40px;object-fit:contain;border-radius:4px;border:1px solid var(--light-grey)" src="${esc(d.companyLogoUrl || '')}">
        <input type="hidden" id="pf-company-logo-hidden" value="${esc(d.companyLogoUrl || '')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Brochure / PDF <span style="font-weight:400;color:var(--mid-grey)">(optional, multiple PDFs, max 20MB each)</span></label>
      <div class="brochure-upload-box">
        <input type="hidden" id="pf-brochures-hidden" value="${esc(JSON.stringify(window.normalizeBrochures ? window.normalizeBrochures(d.brochures || d.brochure || (d.brochureUrl ? [{ url: d.brochureUrl, name: d.brochureName || 'Brochure PDF', path: d.brochurePath || '', size: d.brochureSize || 0 }] : [])) : []))}">
        <div id="pf-brochure-list" class="brochure-list"></div>
        <div id="pf-brochure-progress" class="upload-progress" style="display:none;">
          <div id="pf-brochure-progress-bar" class="upload-progress-bar" style="width:0%"></div>
        </div>
        <label class="btn btn-outline" for="pf-brochure-input" style="cursor:pointer; margin-top:12px; display:inline-flex;">
          📎 Upload Brochures
          <input type="file" id="pf-brochure-input" accept="application/pdf" multiple style="display:none" onchange="handleBrochureUpload(event)">
        </label>
        <small class="brochure-hint">PDF only. Up to 10 files per upload batch.</small>
      </div>
    </div>
    <div class="form-group">
      <label class="checkbox-group">
        <input type="checkbox" id="pf-isVisible" ${d.isVisible === false ? '' : 'checked'}>
        <span class="form-label" style="margin-bottom:0;">Visible on website</span>
      </label>
    </div>
    <div class="form-group">
      <label class="form-label">Title *</label>
      <input class="form-control" id="pf-title" placeholder="e.g. Prime Plot in Koramangala" value="${esc(d.title || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">District</label>
        <input class="form-control" id="pf-district" placeholder="e.g. Hyderabad" value="${esc(d.district || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Village / Area</label>
        <input class="form-control" id="pf-village" placeholder="e.g. Madhapur" value="${esc(d.village || '')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Location *</label>
      <input class="form-control" id="pf-location" placeholder="e.g. Whitefield, Bangalore" value="${esc(d.location || '')}">
    </div>`;

  const getPriceAndDesc = (type, d) => `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Contact Number</label>
        <input class="form-control" id="pf-contactNumber" type="tel" placeholder="e.g. +91 98765 43210" value="${esc(d.contactNumber || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Google Map Location</label>
        <input class="form-control" id="pf-mapUrl" placeholder="Paste a Google Maps link..." value="${esc(d.mapUrl || '')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">${type === 'plots' ? 'Price per Sq Yard *' : 'Price *'}</label>
        <input class="form-control" id="pf-price" placeholder="${type === 'plots' ? 'e.g. \u20b915,000' : 'e.g. \u20b945 Lakhs'}" value="${esc(d.price || '')}">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Status *</label>
        <select class="form-control" id="pf-status">
          <option value="Available" ${d.status !== 'Sold Out' ? 'selected' : ''}>Available</option>
          <option value="Sold Out" ${d.status === 'Sold Out' ? 'selected' : ''}>Sold Out</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-control" id="pf-description" maxlength="5000" placeholder="Brief description of the property...">${esc(d.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Location Advantages <span style="font-weight:400;color:var(--mid-grey)">(optional)</span></label>
        <textarea class="form-control" id="pf-locationAdvantages" maxlength="2000" placeholder="Nearby schools, hospitals, transport...">${esc(d.locationAdvantages || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Project Highlights <span style="font-weight:400;color:var(--mid-grey)">(optional)</span></label>
        <textarea class="form-control" id="pf-projectHighlights" maxlength="2000" placeholder="Key features of the project...">${esc(d.projectHighlights || '')}</textarea>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Legal & Investment Benefits <span style="font-weight:400;color:var(--mid-grey)">(optional)</span></label>
        <textarea class="form-control" id="pf-legalBenefits" maxlength="2000" placeholder="Clear title, high ROI, etc...">${esc(d.legalBenefits || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Investment Potential <span style="font-weight:400;color:var(--mid-grey)">(optional)</span></label>
        <textarea class="form-control" id="pf-investmentPotential" maxlength="2000" placeholder="Future growth drivers...">${esc(d.investmentPotential || '')}</textarea>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Property Images <span style="color:var(--mid-grey);font-weight:400">(up to 15 photos)</span></label>
      <div class="img-upload-area" id="pf-drop-zone">
        <div class="img-preview-grid" id="pf-image-grid"></div>
        <label class="img-browse-btn" for="pf-image-input">
          <span>📁 Browse Images</span>
          <input type="file" id="pf-image-input" accept="image/*" multiple
            style="position:absolute;width:0;height:0;opacity:0"
            onchange="handleImageUpload(event)">
        </label>
        <p class="img-upload-hint">JPG / PNG / WEBP &nbsp;·&nbsp; Max 2 MB each &nbsp;·&nbsp; Up to 15 images</p>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">YouTube Video Link <span style="color:var(--mid-grey);font-weight:400">(optional)</span></label>
      <input class="form-control" id="pf-videoUrl"
        placeholder="e.g. https://www.youtube.com/watch?v=..."
        value="${esc(d.videoUrl || '')}">
      <small style="color:var(--mid-grey);font-size:0.78rem;margin-top:4px;display:block">Paste a YouTube link to embed a property tour video in the detail view.</small>
    </div>`;

  if (type === 'plots') {
    return commonTop + `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Area</label>
          <input class="form-control" id="pf-area" placeholder="e.g. 2400 sq ft" value="${esc(d.area || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Facing</label>
          <select class="form-control" id="pf-facing">
            ${['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West']
        .map(f => `<option ${d.facing === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Approved By</label>
          <input class="form-control" id="pf-approvedBy" placeholder="e.g. DTCP, BMRDA, Panchayat" value="${esc(d.approvedBy || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">LP Number</label>
          <input class="form-control" id="pf-lpNumber" placeholder="e.g. LP No. 123/2024" value="${esc(d.lpNumber || '')}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">RERA Approved</label>
          <div style="display:flex;gap:24px;margin-top:10px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.92rem;color:var(--navy)">
              <input type="radio" name="pf-rera" id="pf-rera-yes" value="Yes" ${d.reraApproved === 'Yes' ? 'checked' : ''} style="accent-color:var(--gold);width:16px;height:16px"> Yes
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.92rem;color:var(--navy)">
              <input type="radio" name="pf-rera" id="pf-rera-no" value="No" ${d.reraApproved !== 'Yes' ? 'checked' : ''} style="accent-color:var(--gold);width:16px;height:16px"> No
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Project On Demand <span style="font-weight:400;color:var(--mid-grey)">(Admin Only)</span></label>
          <select class="form-control" id="pf-projectOnDemand">
            <option value="No" ${d.projectOnDemand !== 'Yes' ? 'selected' : ''}>No</option>
            <option value="Yes" ${d.projectOnDemand === 'Yes' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Amenities</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:10px">
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-spa" ${(d.amenities && d.amenities.includes('Spa')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🧖 Spa</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-gym" ${(d.amenities && d.amenities.includes('Fitness Centre / Gym')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">💪 Fitness Centre / Gym</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-pool" ${(d.amenities && d.amenities.includes('Swimming Pool')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🏊 Swimming Pool</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-clubhouse" ${(d.amenities && d.amenities.includes('Club House')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🏠 Club House</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-firealarm" ${(d.amenities && d.amenities.includes('Fire Alarm')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🔥 Fire Alarm</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-wifi" ${(d.amenities && d.amenities.includes('Wifi')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">📶 Wifi</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-maintenance" ${(d.amenities && d.amenities.includes('Maintenance Staff')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">👷 Maintenance Staff</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-waterstorage" ${(d.amenities && d.amenities.includes('Water Storage')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">💧 Water Storage</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-waterdisposal" ${(d.amenities && d.amenities.includes('Water Disposal')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🚰 Water Disposal</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-rainwater" ${(d.amenities && d.amenities.includes('Rain Water Harvesting')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🌧️ Rain Water Harvesting</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-garden" ${(d.amenities && d.amenities.includes('Garden')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🌿 Garden</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-security" ${(d.amenities && d.amenities.includes('Security')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🔒 Security</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-lift" ${(d.amenities && d.amenities.includes('Lift(s)')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🛗 Lift(s)</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-kidsarea" ${(d.amenities && d.amenities.includes('Kids Area')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🎠 Kids Area</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-amenity-intercom" ${(d.amenities && d.amenities.includes('Intercom')) ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">📞 Intercom</span>
          </label>
        </div>
      </div>` + getPriceAndDesc(type, d);
  }

  if (type === 'flats') {
    return commonTop + `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">BHK Type *</label>
          <select class="form-control" id="pf-bhk">
            ${['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK', 'Studio']
        .map(b => `<option ${d.bhk === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Carpet Area</label>
          <input class="form-control" id="pf-area" placeholder="e.g. 1400 sq ft" value="${esc(d.area || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Floor</label>
          <input class="form-control" id="pf-floor" placeholder="e.g. 8th of 15" value="${esc(d.floor || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Furnishing</label>
          <select class="form-control" id="pf-furnishing">
            ${['Unfurnished', 'Semi-Furnished', 'Fully Furnished']
        .map(f => `<option ${d.furnishing === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amenities</label>
          <input class="form-control" id="pf-amenities" placeholder="e.g. Pool, Gym, Clubhouse" value="${esc(d.amenities || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Project On Demand <span style="font-weight:400;color:var(--mid-grey)">(Admin Only)</span></label>
          <select class="form-control" id="pf-projectOnDemand">
            <option value="No" ${d.projectOnDemand !== 'Yes' ? 'selected' : ''}>No</option>
            <option value="Yes" ${d.projectOnDemand === 'Yes' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </div>` + getPriceAndDesc(type, d);
  }

  if (type === 'apartments') {
    return commonTop + `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Total Acres</label>
          <input class="form-control" id="pf-acres" placeholder="e.g. 5 Acres" value="${esc(d.acres || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Number of Blocks</label>
          <input class="form-control" id="pf-blocks" placeholder="e.g. 4 Blocks" value="${esc(d.blocks || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Flat Sizes (BHK)</label>
          <input class="form-control" id="pf-flatSizes" placeholder="e.g. 2 BHK, 3 BHK" value="${esc(d.flatSizes || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Total Units</label>
          <input class="form-control" id="pf-totalUnits" placeholder="e.g. 400 Units" value="${esc(d.totalUnits || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Total Floors</label>
          <input class="form-control" id="pf-floors" placeholder="e.g. G+15 Floors" value="${esc(d.floors || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Club House Size</label>
          <input class="form-control" id="pf-clubHouseSize" placeholder="e.g. 20,000 sq ft" value="${esc(d.clubHouseSize || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amenities</label>
          <input class="form-control" id="pf-amenities" placeholder="e.g. Pool, Gym, Park" value="${esc(d.amenities || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Project On Demand <span style="font-weight:400;color:var(--mid-grey)">(Admin Only)</span></label>
          <select class="form-control" id="pf-projectOnDemand">
            <option value="No" ${d.projectOnDemand !== 'Yes' ? 'selected' : ''}>No</option>
            <option value="Yes" ${d.projectOnDemand === 'Yes' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </div>` + getPriceAndDesc(type, d);
  }

  if (type === 'villas') {
    return commonTop + `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Bedrooms</label>
          <select class="form-control" id="pf-bedrooms">
            ${['2 Bedrooms', '3 Bedrooms', '4 Bedrooms', '5 Bedrooms', '6+ Bedrooms']
        .map(b => `<option ${d.bedrooms === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Land Area</label>
          <input class="form-control" id="pf-landArea" placeholder="e.g. 4800 sq ft" value="${esc(d.landArea || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Built-up Area</label>
          <input class="form-control" id="pf-builtUpArea" placeholder="e.g. 3200 sq ft" value="${esc(d.builtUpArea || '')}">
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;gap:14px;justify-content:center;padding-top:8px">
          <label class="checkbox-group">
            <input type="checkbox" id="pf-hasPool" ${d.hasPool ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🏊 Swimming Pool</span>
          </label>
          <label class="checkbox-group">
            <input type="checkbox" id="pf-hasGarden" ${d.hasGarden ? 'checked' : ''}>
            <span class="form-label" style="margin-bottom:0">🌿 Garden / Lawn</span>
          </label>
        </div>
      <div class="form-group">
        <label class="form-label">Project On Demand <span style="font-weight:400;color:var(--mid-grey)">(Admin Only)</span></label>
        <select class="form-control" id="pf-projectOnDemand">
          <option value="No" ${d.projectOnDemand !== 'Yes' ? 'selected' : ''}>No</option>
          <option value="Yes" ${d.projectOnDemand === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </div>` + getPriceAndDesc(type, d);
  } else if (type === 'commercial') {
    return commonTop + `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Super Built-up Area</label>
          <input class="form-control" id="pf-area" placeholder="e.g. 5000 sq ft" value="${esc(d.area || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Floor</label>
          <input class="form-control" id="pf-floor" placeholder="e.g. 3rd Floor" value="${esc(d.floor || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Washrooms</label>
          <input class="form-control" id="pf-washrooms" placeholder="e.g. 2 Attached, 1 Common" value="${esc(d.washrooms || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Parking Spaces</label>
          <input class="form-control" id="pf-parking" placeholder="e.g. 3 Covered" value="${esc(d.parking || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Furnishing Status</label>
          <select class="form-control" id="pf-furnishing">
            ${['Bare Shell', 'Plug & Play', 'Fully Furnished', 'Semi-Furnished']
          .map(fu => `<option ${d.furnishing === fu ? 'selected' : ''}>${fu}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Project On Demand <span style="font-weight:400;color:var(--mid-grey)">(Admin Only)</span></label>
          <select class="form-control" id="pf-projectOnDemand">
            <option value="No" ${d.projectOnDemand !== 'Yes' ? 'selected' : ''}>No</option>
            <option value="Yes" ${d.projectOnDemand === 'Yes' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </div>` + getPriceAndDesc(type, d);
  } else if (type === 'clients') {
    return `
      <div class="form-group">
        <label class="form-label">Client Name *</label>
        <input class="form-control" id="pf-title" placeholder="e.g. Acme Corp" value="${esc(d.title || '')}">
      </div>

      <div class="form-group">
        <label class="form-label">Client Logo <span style="color:var(--mid-grey);font-weight:400">(Upload 1 logo)</span></label>
        <div class="img-upload-area" id="pf-drop-zone">
          <div class="img-preview-grid" id="pf-image-grid"></div>
          <label class="img-browse-btn" for="pf-image-input">
            <span>📁 Browse Image</span>
            <input type="file" id="pf-image-input" accept="image/*"
              style="position:absolute;width:0;height:0;opacity:0"
              onchange="handleImageUpload(event)">
          </label>
        </div>
      </div>
      </div>
    `;
  } else if (type === 'miniposts') {
    return `
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input class="form-control" id="pf-title" placeholder="e.g. Spacious 3BHK for Rent, Open Plot..." value="${esc(d.title || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category *</label>
          <select class="form-control" id="pf-category">
            ${['House for Sale', 'Land for Sale', 'Plot for Sale', 'To-let']
        .map(c => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Area *</label>
          <select class="form-control" id="pf-area">
            <option value="">-- Select Area --</option>
            ${areas.map(a => `<option value="${esc(a.name)}" ${d.area === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
          <small style="color:var(--mid-grey); margin-top:4px; display:block">Manage this list via "Manage Areas" button.</small>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Status *</label>
        <select class="form-control" id="pf-status">
          <option value="Available" ${d.status !== 'Sold Out' && d.status !== 'Expired' ? 'selected' : ''}>Available</option>
          <option value="Sold Out" ${d.status === 'Sold Out' ? 'selected' : ''}>Sold Out</option>
          <option value="Expired" ${d.status === 'Expired' ? 'selected' : ''}>Expired</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Details (English) *</label>
        <textarea class="form-control" id="pf-detailsEn" rows="6" placeholder="Maximum 7 lines of details here...">${esc(d.detailsEn || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Details (Hindi)</label>
        <textarea class="form-control" id="pf-detailsHi" rows="6" placeholder="Optional Hindi translation...">${esc(d.detailsHi || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Details (Telugu)</label>
        <textarea class="form-control" id="pf-detailsTe" rows="6" placeholder="Optional Telugu translation...">${esc(d.detailsTe || '')}</textarea>
      </div>
    `;
  }
  return '';
}

function collectFormData(type) {
  const g = id => { const el = document.getElementById(id); return el && el.value ? el.value.trim() : ''; };
  const gb = id => { const el = document.getElementById(id); return el ? el.checked : false; };

  // Collect base64 images from preview grid
  const imgEls = document.querySelectorAll('#pf-image-grid .img-thumb');
  const images = Array.from(imgEls).map(img => img.src).filter(Boolean);
  
  const logoHidden = document.getElementById('pf-company-logo-hidden');
  const companyLogoUrl = logoHidden ? logoHidden.value : '';
  const brochuresHidden = document.getElementById('pf-brochures-hidden');
  let brochures = [];
  if (brochuresHidden && brochuresHidden.value) {
    try {
      brochures = window.normalizeBrochures ? window.normalizeBrochures(JSON.parse(brochuresHidden.value)) : JSON.parse(brochuresHidden.value);
    } catch (e) {
      brochures = [];
    }
  }

  const base = {
    companyLogoUrl,
    title: g('pf-title'),
    location: g('pf-location'),
    district: g('pf-district'),
    village: g('pf-village'),
    contactNumber: g('pf-contactNumber'),
    mapUrl: g('pf-mapUrl'),
    price: g('pf-price'),
    status: g('pf-status') || 'Available',
    description: g('pf-description'),
    locationAdvantages: g('pf-locationAdvantages'),
    projectHighlights: g('pf-projectHighlights'),
    legalBenefits: g('pf-legalBenefits'),
    investmentPotential: g('pf-investmentPotential'),
    videoUrl: g('pf-videoUrl'),
    brochures,
    isVisible: gb('pf-isVisible'),
    images,           // array of up to 15 base64/URL strings
    imageUrl: images[0] || '',   // keep for backward compat with card renderer
  };

  if (type === 'plots') {
    const amenities = [];
    if (document.getElementById('pf-amenity-spa')?.checked) amenities.push('Spa');
    if (document.getElementById('pf-amenity-gym')?.checked) amenities.push('Fitness Centre / Gym');
    if (document.getElementById('pf-amenity-pool')?.checked) amenities.push('Swimming Pool');
    if (document.getElementById('pf-amenity-clubhouse')?.checked) amenities.push('Club House');
    if (document.getElementById('pf-amenity-firealarm')?.checked) amenities.push('Fire Alarm');
    if (document.getElementById('pf-amenity-wifi')?.checked) amenities.push('Wifi');
    if (document.getElementById('pf-amenity-maintenance')?.checked) amenities.push('Maintenance Staff');
    if (document.getElementById('pf-amenity-waterstorage')?.checked) amenities.push('Water Storage');
    if (document.getElementById('pf-amenity-waterdisposal')?.checked) amenities.push('Water Disposal');
    if (document.getElementById('pf-amenity-rainwater')?.checked) amenities.push('Rain Water Harvesting');
    if (document.getElementById('pf-amenity-garden')?.checked) amenities.push('Garden');
    if (document.getElementById('pf-amenity-security')?.checked) amenities.push('Security');
    if (document.getElementById('pf-amenity-lift')?.checked) amenities.push('Lift(s)');
    if (document.getElementById('pf-amenity-kidsarea')?.checked) amenities.push('Kids Area');
    if (document.getElementById('pf-amenity-intercom')?.checked) amenities.push('Intercom');
    
    return {
      ...base, area: g('pf-area'), facing: g('pf-facing'),
      approvedBy: g('pf-approvedBy'),
      lpNumber: g('pf-lpNumber'),
      reraApproved: (document.getElementById('pf-rera-yes')?.checked ? 'Yes' : 'No'),
      projectOnDemand: g('pf-projectOnDemand'),
      amenities: amenities,
    };
  }
  if (type === 'flats') {
    return { ...base, bhk: g('pf-bhk'), area: g('pf-area'), floor: g('pf-floor'), furnishing: g('pf-furnishing'), amenities: g('pf-amenities'), projectOnDemand: g('pf-projectOnDemand') };
  }
  if (type === 'apartments') {
    return { ...base, acres: g('pf-acres'), blocks: g('pf-blocks'), flatSizes: g('pf-flatSizes'), totalUnits: g('pf-totalUnits'), amenities: g('pf-amenities'), floors: g('pf-floors'), clubHouseSize: g('pf-clubHouseSize'), projectOnDemand: g('pf-projectOnDemand') };
  }
  if (type === 'villas') {
    return { ...base, bedrooms: g('pf-bedrooms'), landArea: g('pf-landArea'), builtUpArea: g('pf-builtUpArea'), hasPool: gb('pf-hasPool'), hasGarden: gb('pf-hasGarden'), projectOnDemand: g('pf-projectOnDemand') };
  }
  if (type === 'commercial') {
    return { ...base, area: g('pf-area'), floor: g('pf-floor'), washrooms: g('pf-washrooms'), parking: g('pf-parking'), furnishing: g('pf-furnishing'), projectOnDemand: g('pf-projectOnDemand') };
  }
  if (type === 'clients') {
    return {
      title: g('pf-title'),
      images,
      imageUrl: images[0] || '',
    };
  }
  if (type === 'miniposts') {
    return {
      title: g('pf-title'),
      category: g('pf-category'),
      area: g('pf-area'),
      status: g('pf-status') || 'Available',
      detailsEn: g('pf-detailsEn'),
      detailsHi: g('pf-detailsHi'),
      detailsTe: g('pf-detailsTe')
    };
  }
}

async function submitPropertyForm() {
  const type = document.getElementById('prop-form-type').value;
  const editId = document.getElementById('prop-form-id').value;

  if (window._brochureUploadBusy) {
    showToast('Please wait for brochure uploads to finish.', 'error');
    return;
  }

  // collectFormData needs to be handled properly. Wait, collectFormData is defined below submitPropertyForm in the original but above in my file? 
  // Let me check lines 276-304. Yes, it's defined right above it.
  let data;
  try {
    data = collectFormData(type);
    Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);
  } catch (e) {
    console.error(e);
    showToast('Validation Error: ' + e.message, 'error');
    return;
  }

  if (type === 'miniposts') {
    if (!data.category || !data.area || !data.detailsEn) {
      showToast('Please provide Category, Area, and English Details', 'error');
      return;
    }
  } else {
    if (!data.title) { showToast(type === 'clients' ? 'Please enter a name.' : 'Please enter a title.', 'error'); return; }
    if (type !== 'clients') {
      if (!data.location) { showToast('Please enter a location.', 'error'); return; }
      if (!data.price) { showToast('Please enter a price.', 'error'); return; }
    }
  }

  const btn = document.getElementById('prop-form-submit');
  if (btn) btn.disabled = true;
  showToast('Saving property...', 'info');

  // Re-compress all images to guarantee they fit within Firestore's 1MB limit
  if (data.images && data.images.length > 0) {
    showToast('Optimizing images for database...', 'info');
    try {
      const compressedImages = [];
      for (const img of data.images) {
        if (img.startsWith('data:image/')) {
          // Compress to 800x800 maximum, 50% quality to ensure low payload size (~25-30KB per image)
          const comp = await compressImage(img, 800, 800, 0.5);
          compressedImages.push(comp);
        } else {
          compressedImages.push(img);
        }
      }
      data.images = compressedImages;
      if (compressedImages.length > 0) {
        data.imageUrl = compressedImages[0];
      }
    } catch (compressionErr) {
      console.error('Image compression failed during save:', compressionErr);
    }
  }

  data.brochures = window.normalizeBrochures ? window.normalizeBrochures(data.brochures) : (data.brochures || []);
  if (data.brochures.length === 0) delete data.brochures;

  try {
    if (editId) {
      await DB[type].update(editId, data);
      showToast('✏️ Listing updated successfully!', 'success');
      closeModal('prop-form-modal');
      if (window._currentPage) window._currentPage();
    } else {
      const newItem = await DB[type].add(data);
      showToast('✅ New listing added!', 'success');
      closeModal('prop-form-modal');
      promptNotifySubscribers(newItem, type); // Trigger the notification flow
    }
  } catch (e) {
    console.error(e);
    showToast('Failed to save listing. Error: ' + (e.message || e), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- Image Upload Helpers ----
async function handleImageUpload(event) {
  const grid = document.getElementById('pf-image-grid');
  const files = Array.from(event.target.files);
  let count = grid ? grid.querySelectorAll('.img-preview-item').length : 0;

  for (const file of files) {
    if (count >= 15) {
      showToast('Maximum 15 images allowed.', 'error');
      break;
    }

    // We can allow larger original files now because we compress them immediately
    if (file.size > 10 * 1024 * 1024) {
      showToast(`"${file.name}" is too large (>10MB).`, 'error');
      continue;
    }

    try {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(file);
      });

      // Show a temporary "optimizing" toast if it's a large file
      if (file.size > 1 * 1024 * 1024) {
        showToast(`Optimizing ${file.name}...`, 'info');
      }

      // Optimize image dimensions and quality to ensure 15 images stay under Firestore's 1MB document limit
      const compressed = await compressImage(base64, 1000, 1000, 0.6);
      addImagePreview(compressed, grid);
      count++;
    } catch (err) {
      console.error('Compression error:', err);
      showToast(`Failed to process ${file.name}`, 'error');
    }
  }
  // Reset input so same files can be re-selected if needed
  event.target.value = '';
}

async function handleCompanyLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo is too large (>2MB).', 'error');
    return;
  }
  try {
    const base64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
    
    // We can compress log just like images
    let finalImage = base64;
    try {
      finalImage = await compressImage(base64);
    } catch(e) { } // If compression fails, use original Base64 (it is < 2MB anyways)
    
    const preview = document.getElementById('pf-company-logo-preview');
    const hidden = document.getElementById('pf-company-logo-hidden');
    if (preview) {
      preview.src = finalImage;
      preview.style.display = 'block';
    }
    if (hidden) {
      hidden.value = finalImage;
    }
  } catch (err) {
    showToast('Failed to load company logo', 'error');
  }
  event.target.value = '';
}

function addImagePreview(src, grid) {
  if (!grid) return;
  if (grid.querySelectorAll('.img-preview-item').length >= 15) {
    showToast('Maximum 15 images allowed.', 'error');
    return;
  }
  const item = document.createElement('div');
  item.className = 'img-preview-item';
  item.innerHTML = `
    <img class="img-thumb" src="${src}" alt="Preview">
    <button type="button" class="img-remove-btn" title="Remove" onclick="this.closest('.img-preview-item').remove()">✕</button>
  `;
  grid.appendChild(item);
}

/** Client-side image compression using Canvas */
async function compressImage(base64Str, maxWidth = 1200, maxHeight = 1200, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Export as compressed JPEG
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}

// ---- Utilities ----
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function esc(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---- WhatsApp Notifications ----
async function promptNotifySubscribers(property, type) {
  const listEl = document.getElementById('subscribers-list');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--mid-grey)">Loading subscribers...</div>';
  openModal('notify-subscribers-modal');

  try {
    const subscribers = await DB.subscribers.get();

    if (subscribers.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--mid-grey)">No subscribers have registered yet.</div>';
      return;
    }

    // Build the message text
    const propType = type === 'plots' ? 'plot' : type === 'flats' ? 'flat' : 'villa';
    const rawMsg = `*New ${capitalize(propType)} Alert!* 🏡\n\n` +
      `*${property.title}*\n` +
      `📍 ${property.location}\n` +
      `💰 ${property.price}\n\n` +
      `Visit our website to see the photos and full details!`;

    // URI encode the message
    const msg = encodeURIComponent(rawMsg);

    listEl.innerHTML = subscribers.map(sub => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--off-white);border-radius:var(--radius-md);border:1px solid var(--light-grey)">
        <div>
          <div style="font-weight:600;color:var(--navy);margin-bottom:2px">${esc(sub.name)}</div>
          <div style="font-size:0.85rem;color:var(--mid-grey)">${esc(sub.phone)}</div>
        </div>
        <a href="https://wa.me/${sub.phone.replace('+', '')}?text=${msg}" 
           target="_blank" rel="noopener"
           class="btn btn-primary btn-sm"
           onclick="this.textContent = '✅ Sent'; this.classList.replace('btn-primary', 'btn-ghost');"
           style="background-color:#25D366;border-color:#25D366;color:white">
          💬 Send
        </a>
      </div>
    `).join('');

  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">Failed to load subscribers.</div>';
  }
}

// ---- Contact Info Editing ----
function openEditContactModal(id) {
  if (!Admin.isLoggedIn()) {
    showToast('Please login as admin first.', 'error');
    return;
  }

  // Read current display values from DOM to populate form initially
  const getC = id => { const e = document.getElementById(id); return e ? e.innerHTML.replace(/<br>/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''; };

  document.getElementById('ec-id').value = id || '';
  document.getElementById('ec-phone').value = getC('c-disp-phone');
  document.getElementById('ec-email').value = getC('c-disp-email');
  document.getElementById('ec-address').value = getC('c-disp-address');
  document.getElementById('ec-hours').value = getC('c-disp-hours');

  openModal('edit-contact-modal');
}

async function submitEditContact() {
  if (!Admin.isLoggedIn()) return;
  const id = document.getElementById('ec-id').value;
  const data = {
    phone: document.getElementById('ec-phone').value.trim(),
    email: document.getElementById('ec-email').value.trim(),
    address: document.getElementById('ec-address').value.trim(),
    hours: document.getElementById('ec-hours').value.trim(),
  };

  const btn = document.getElementById('ec-submit');
  btn.disabled = true;
  showToast('Saving contact info...', 'info');

  try {
    if (id) {
      await DB.contact.update(id, data);
    } else {
      await DB.contact.add(data);
    }
    showToast('✅ Contact info updated!', 'success');
    closeModal('edit-contact-modal');
    if (window._currentPage) window._currentPage();
  } catch (e) {
    console.error(e);
    showToast('Failed to save contact info.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---- About Info Editing ----
function openEditAboutModal(id) {
  if (!Admin.isLoggedIn()) {
    showToast('Please login as admin first.', 'error');
    return;
  }

  const getC = id => { const e = document.getElementById(id); return e ? e.innerHTML.replace(/<br>/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''; };

  document.getElementById('ea-id').value = id || '';
  document.getElementById('ea-name').value = getC('a-disp-name');
  document.getElementById('ea-tagline').value = getC('a-disp-tagline');
  document.getElementById('ea-title').value = getC('a-disp-title');
  document.getElementById('ea-bio1').value = getC('a-disp-bio1');
  document.getElementById('ea-bio2').value = getC('a-disp-bio2');
  document.getElementById('ea-mission').value = getC('a-disp-mission');
  document.getElementById('ea-vision').value = getC('a-disp-vision');

  openModal('edit-about-modal');
}

async function submitEditAbout() {
  if (!Admin.isLoggedIn()) return;
  const id = document.getElementById('ea-id').value;
  const data = {
    name: document.getElementById('ea-name').value.trim(),
    tagline: document.getElementById('ea-tagline').value.trim(),
    title: document.getElementById('ea-title').value.trim(),
    bio1: document.getElementById('ea-bio1').value.trim(),
    bio2: document.getElementById('ea-bio2').value.trim(),
    mission: document.getElementById('ea-mission').value.trim(),
    vision: document.getElementById('ea-vision').value.trim(),
  };

  const btn = document.getElementById('ea-submit');
  btn.disabled = true;
  showToast('Saving about info...', 'info');

  try {
    if (id) {
      await DB.about.update(id, data);
    } else {
      await DB.about.add(data);
    }
    showToast('✅ About info updated!', 'success');
    closeModal('edit-about-modal');
    if (window._currentPage) window._currentPage();
  } catch (e) {
    console.error(e);
    showToast('Failed to save about info.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ==== REGISTERED USERS VIEW (ADMIN ONLY) ====
window.renderRegisteredUsers = async function(pageIndexRaw) {
  if (!Admin.isLoggedIn()) {
    showToast('Unauthorized access', 'error');
    if (typeof navigate === 'function') navigate('about');
    return;
  }
  
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div></div>';

  try {
    const usersSnap = await db.collection('users').orderBy('lastSignIn', 'desc').get();
    const totalUsers = usersSnap.size;
    const allUsers = usersSnap.docs.map(doc => doc.data());
    
    const pageSize = 50;
    const totalPages = Math.ceil(totalUsers / pageSize) || 1;
    let pageIndex = parseInt(pageIndexRaw, 10);
    if (isNaN(pageIndex) || pageIndex < 1) pageIndex = 1;
    const currentPage = Math.max(1, Math.min(pageIndex, totalPages));
    
    const startIndex = (currentPage - 1) * pageSize;
    const pagedUsers = allUsers.slice(startIndex, startIndex + pageSize);
    
    let rowsHtml = '';
    if (pagedUsers.length === 0) {
      rowsHtml = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--mid-grey)">No registered users found.</td></tr>';
    } else {
      pagedUsers.forEach((u, i) => {
        const email = u.email || 'N/A';
        const name = u.displayName || 'N/A';
        const lastSignIn = u.lastSignIn ? new Date(u.lastSignIn).toLocaleString() : 'N/A';
        rowsHtml += `
          <tr>
            <td style="color:var(--mid-grey)">${startIndex + i + 1}</td>
            <td style="font-weight:600;color:var(--navy)">${esc(name)}</td>
            <td>${esc(email)}</td>
            <td style="color:var(--mid-grey);font-size:0.9rem">${esc(lastSignIn)}</td>
          </tr>
        `;
      });
    }

    let paginationHtml = '';
    if (totalPages > 1) {
      paginationHtml = `
        <div style="display:flex; justify-content:center; align-items:center; gap:16px; margin-top: 32px;">
          <button class="btn btn-secondary btn-sm" ${currentPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''} onclick="window.renderRegisteredUsers(${currentPage - 1})">← Previous</button>
          <span style="font-size:0.9rem;color:var(--navy);font-weight:600">Page ${currentPage} of ${totalPages}</span>
          <button class="btn btn-secondary btn-sm" ${currentPage === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''} onclick="window.renderRegisteredUsers(${currentPage + 1})">Next →</button>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="hero" style="padding: 40px 0;">
        <div class="container" style="position:relative;z-index:1">
          <button class="btn btn-ghost" style="position:absolute; top: -10px; left: 0; padding:6px 12px; font-size:0.85rem; color: white; border-color: rgba(255,255,255,0.3);" onclick="navigate('about')">← Back to About</button>
          <h1 style="font-size: clamp(2rem, 4vw, 2.8rem); margin-bottom:8px">Registered Users</h1>
          <p style="font-size:1.1rem; color: #FFAC70; font-weight:600; letter-spacing:0.05em">Total Users: ${totalUsers}</p>
        </div>
      </div>
      <section class="section" style="background:var(--white); min-height: 50vh;">
        <div class="container" style="max-width:900px">
          <div class="property-table-wrap" style="box-shadow:var(--shadow-sm); border-radius:var(--radius-md); overflow:hidden; border:1px solid var(--light-grey)">
            <table class="property-table" style="width:100%; margin:0">
              <thead>
                <tr>
                  <th style="width:60px">#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last Sign In</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
          ${paginationHtml}
        </div>
      </section>
    `;

    window.scrollTo(0, 0);
  } catch (error) {
    console.error('Error loading users:', error);
    content.innerHTML = '<div class="container section" style="text-align:center"><h3>Error loading users</h3><p style="color:red">'+esc(error.message)+'</p><button class="btn btn-primary mt-4" onclick="navigate(\'about\')">Back</button></div>';
  }
};

// ==== MARKETING VIEW (ADMIN ONLY) ====
window.renderMarketing = function() {
  if (!Admin.isLoggedIn()) {
    showToast('Unauthorized access', 'error');
    if (typeof navigate === 'function') navigate('about');
    return;
  }
  
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="hero" style="padding: 40px 0; background: linear-gradient(135deg, var(--navy-light) 0%, var(--navy) 100%);">
      <div class="container" style="position:relative;z-index:1; text-align:center;">
        <h1 style="font-size: clamp(2rem, 4vw, 2.5rem); margin-bottom:8px; color: white;">Marketing Dashboard</h1>
        <p style="font-size:1.1rem; color: var(--gold-light);">Publish to Facebook, Instagram, and YouTube</p>
      </div>
    </div>
    <section class="section" style="background:var(--off-white); min-height: 60vh;">
      <div class="container" style="max-width:800px">
        <div style="background:white; padding: 40px; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); border: 1px solid var(--light-grey);">
          
          <div class="form-row" style="margin-bottom: 24px;">
            <div class="form-group" style="flex:1;">
              <label class="form-label" style="font-weight:600; font-size:1rem;">Post Type</label>
              <select class="form-control" id="mkt-post-type" style="padding: 12px;" onchange="window.toggleMarketingType()">
                <option value="image">📸 Image Post (Facebook / Instagram)</option>
                <option value="video">🎥 Video Post (YouTube / Facebook / Instagram)</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label" style="font-weight:600; font-size:1rem;">Select Platforms</label>
              <div style="display:flex; gap: 16px; margin-top: 12px; align-items:center;">
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="plat-fb" checked style="width:18px;height:18px"> Facebook</label>
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="plat-ig" checked style="width:18px;height:18px"> Instagram</label>
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer;" id="lbl-plat-yt" style="display:none;"><input type="checkbox" id="plat-yt" style="width:18px;height:18px"> YouTube</label>
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 24px;">
            <label class="form-label" style="font-weight:600; font-size:1rem;">Media File (<span id="mkt-file-hint">Images only</span>)</label>
            <div class="img-upload-area" id="mkt-drop-zone" style="background: #fdfdfd; border: 2px dashed rgba(201,168,76,0.5); padding: 40px; text-align:center; border-radius: var(--radius-sm);">
              <div id="mkt-preview" style="margin-bottom:16px; max-height:250px; overflow:hidden; border-radius:8px; display:none;"></div>
              <label class="btn btn-secondary" for="mkt-file-input" style="cursor:pointer; display:inline-block;">
                📁 Browse Local File
                <input type="file" id="mkt-file-input" accept="image/*" style="display:none" onchange="window.handleMarketingFile(event)">
              </label>
              <p style="margin-top:12px; font-size:0.85rem; color:var(--mid-grey)" id="mkt-file-formats">Recommended: JPG, PNG.</p>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 32px;">
            <label class="form-label" style="font-weight:600; font-size:1rem;">Post Description / Caption</label>
            <textarea class="form-control" id="mkt-desc" rows="5" placeholder="Write an engaging caption for your local audience..." style="padding: 16px; font-size:1rem;"></textarea>
          </div>

          <div style="text-align:right;">
            <button class="btn btn-primary btn-lg" id="mkt-publish-btn" onclick="window.publishMarketingPost()" style="padding: 14px 40px;">
              🚀 Publish to Socials
            </button>
          </div>
          
        </div>
      </div>
    </section>
  `;
  window.scrollTo(0, 0);
  window.toggleMarketingType(); // initialize state
};

window.toggleMarketingType = function() {
  const type = document.getElementById('mkt-post-type').value;
  const input = document.getElementById('mkt-file-input');
  const hint = document.getElementById('mkt-file-hint');
  const formats = document.getElementById('mkt-file-formats');
  const ytLabel = document.getElementById('lbl-plat-yt');
  const ytBox = document.getElementById('plat-yt');

  if (type === 'image') {
    input.accept = 'image/*';
    hint.textContent = 'Images only';
    formats.textContent = 'Recommended: JPG, PNG.';
    if(ytLabel) ytLabel.style.display = 'none';
    if(ytBox) ytBox.checked = false;
  } else {
    input.accept = 'video/*';
    hint.textContent = 'Videos only';
    formats.textContent = 'Recommended: MP4, MOV (Max 100MB for demo).';
    if(ytLabel) ytLabel.style.display = 'flex';
  }
  
  // Clear file buffer
  input.value = '';
  document.getElementById('mkt-preview').innerHTML = '';
  document.getElementById('mkt-preview').style.display = 'none';
};

window.handleMarketingFile = function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const preview = document.getElementById('mkt-preview');
  preview.style.display = 'block';

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      preview.innerHTML = `<img src="${evt.target.result}" style="max-width:100%; max-height:250px; object-fit:contain; border-radius:8px;">`;
    };
    reader.readAsDataURL(file);
  } else if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `
      <video src="${url}" controls style="max-width:100%; max-height:250px; border-radius:8px;"></video>
      <div style="margin-top:8px;font-size:0.85rem;color:var(--navy);">${file.name} (${(file.size/1024/1024).toFixed(2)} MB)</div>
    `;
  } else {
    preview.innerHTML = '<div style="color:red">Unsupported file format.</div>';
  }
};

window.publishMarketingPost = async function() {
  const type = document.getElementById('mkt-post-type').value;
  const desc = document.getElementById('mkt-desc').value.trim();
  const fileInput = document.getElementById('mkt-file-input');
  const file = fileInput.files[0];
  const btn = document.getElementById('mkt-publish-btn');
  
  const fb = document.getElementById('plat-fb').checked;
  const ig = document.getElementById('plat-ig').checked;
  const yt = document.getElementById('plat-yt') ? document.getElementById('plat-yt').checked : false;

  if (!fb && !ig && !yt) {
    if (typeof showToast === 'function') showToast('Please select at least one platform.', 'error');
    return;
  }

  if (!file) {
    if (typeof showToast === 'function') showToast('Please attach a media file to publish.', 'error');
    return;
  }

  if (!desc) {
    if (typeof showToast === 'function') showToast('Please write a description/caption.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Uploading & Publishing...';

  try {
    const formData = new FormData();
    formData.append('media', file);
    formData.append('desc', desc);
    formData.append('type', type);
    formData.append('fb', fb);
    formData.append('ig', ig);
    formData.append('yt', yt);

    const publishUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'http://localhost:3001/api/publish' 
      : 'https://' + window.location.hostname + '/api/publish';

    const resp = await fetch(publishUrl, {
      method: 'POST',
      body: formData
    });

    const result = await resp.json();

    if (result.success) {
      if (typeof showToast === 'function') showToast('✅ Successfully processed post!', 'success');
      alert(`Publish Flow Completed!\n\nFacebook: ${JSON.stringify(result.facebook || 'N/A')}\nInstagram: ${JSON.stringify(result.instagram || 'N/A')}\nYouTube: ${JSON.stringify(result.youtube || 'N/A')}`);
      
      fileInput.value = '';
      document.getElementById('mkt-desc').value = '';
      document.getElementById('mkt-preview').style.display = 'none';
      
    } else {
      if (typeof showToast === 'function') showToast('Failed: ' + result.error, 'error');
      alert(`Error during publish: ${result.error}\nIf it says Missing credentials, ensure you have created a .env file and placed the keys inside it!`);
    }

  } catch(e) {
    if (typeof showToast === 'function') showToast('Network Error', 'error');
    alert('Failed to reach the API server. Ensure server.js is running and listening for requests.');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚀 Publish to Socials';
  }
};
