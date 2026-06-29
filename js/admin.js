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

  if (typeof refreshVisibilityNavigation === 'function') {
    refreshVisibilityNavigation(window._visibilitySettings || null).catch(() => { });
  }
}

async function togglePropertyVisibility(type, id, currentVisible) {
  if (!Admin.isLoggedIn()) return;

  try {
    await DB[type].update(id, { isVisible: !currentVisible });
    showToast(currentVisible ? 'Card hidden from visitors.' : 'Card shown to visitors.', 'success');
    if (window._currentPage) window._currentPage();
  } catch (e) {
    console.error('Failed to toggle property visibility:', e);
    showToast('Failed to update card visibility.', 'error');
  }
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
      <label class="form-label">Title *</label>
      <input class="form-control" id="pf-title" placeholder="e.g. Prime Plot in Koramangala" value="${esc(d.title || '')}">
    </div>
    <div class="form-group">
      <label class="checkbox-group" style="align-items:center; gap:10px; margin:4px 0 2px; cursor:pointer;">
        <input type="checkbox" id="pf-isVisible" ${d.isVisible === false ? '' : 'checked'}>
        <span class="form-label" style="margin-bottom:0">Visible on website</span>
      </label>
      <small style="display:block;color:var(--mid-grey);margin-top:6px;">Uncheck to hide this card from visitors while keeping it in the admin panel.</small>
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

  const brochureHtml = `
    <div class="form-group">
      <label class="form-label">Brochure / PDF <span style="color:var(--mid-grey);font-weight:400">(optional)</span></label>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label class="btn btn-ghost" for="pf-brochure-input" style="cursor:pointer;border-color:var(--light-grey);width:max-content;">
          📄 Upload PDF
          <input type="file" id="pf-brochure-input" accept="application/pdf" style="display:none" onchange="handleBrochureUpload(event)">
        </label>
        <div id="pf-brochure-status" style="font-size:0.85rem;color:var(--mid-grey);">
          ${d.brochureName ? `Current brochure: ${esc(d.brochureName)}` : 'No brochure uploaded yet.'}
        </div>
        <input type="hidden" id="pf-brochure-url" value="${esc(d.brochureUrl || '')}">
        <input type="hidden" id="pf-brochure-name" value="${esc(d.brochureName || '')}">
        <input type="hidden" id="pf-brochure-path" value="${esc(d.brochurePath || '')}">
      </div>
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
    return commonTop + brochureHtml + `
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
      </div>` + getPriceAndDesc(type, d);
  }

  if (type === 'flats') {
    return commonTop + brochureHtml + `
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
    return commonTop + brochureHtml + `
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
    return commonTop + brochureHtml + `
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
    return commonTop + brochureHtml + `
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

  const base = {
    companyLogoUrl,
    title: g('pf-title'),
    isVisible: document.getElementById('pf-isVisible') ? document.getElementById('pf-isVisible').checked : true,
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
    brochureUrl: g('pf-brochure-url'),
    brochureName: g('pf-brochure-name'),
    brochurePath: g('pf-brochure-path'),
    images,           // array of up to 15 base64/URL strings
    imageUrl: images[0] || '',   // keep for backward compat with card renderer
  };

  if (type === 'plots') {
    return {
      ...base, area: g('pf-area'), facing: g('pf-facing'),
      approvedBy: g('pf-approvedBy'),
      lpNumber: g('pf-lpNumber'),
      reraApproved: (document.getElementById('pf-rera-yes')?.checked ? 'Yes' : 'No'),
      projectOnDemand: g('pf-projectOnDemand'),
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

async function handleBrochureUpload(event) {
  const file = event.target.files[0];
  const status = document.getElementById('pf-brochure-status');
  if (!file) return;
  if (file.type !== 'application/pdf') {
    showToast('Please select a PDF brochure.', 'error');
    event.target.value = '';
    return;
  }
  
  if (status) {
    status.textContent = `Uploading: ${file.name}...`;
  }
  
  const formData = new FormData();
  formData.append('brochure', file);
  
  try {
    const response = await fetch('/api/upload-brochure', {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('pf-brochure-url').value = result.brochureUrl;
      document.getElementById('pf-brochure-name').value = result.brochureName;
      document.getElementById('pf-brochure-path').value = result.brochurePath;
      if (status) {
        status.textContent = `✅ Uploaded: ${result.brochureName}`;
      }
      showToast('Brochure uploaded successfully!', 'success');
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Brochure upload error:', error);
    showToast('Failed to upload brochure: ' + error.message, 'error');
    if (status) {
      status.textContent = 'Upload failed. Please try again.';
    }
    event.target.value = '';
  }
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

/* =========================================================
   SECTION VISIBILITY MANAGER
   Stores visibility settings in Firestore (settings collection,
   type: 'section_visibility').
   ========================================================= */

const _VISIBILITY_CATEGORIES = [
  { key: 'plots',       label: 'Plots',       icon: '🌿' },
  { key: 'villas',      label: 'Villas',      icon: '🏡' },
  { key: 'flats',       label: 'Flats',       icon: '🏢' },
  { key: 'apartments',  label: 'Apartments',  icon: '🏢' },
  { key: 'commercial',  label: 'Commercial',  icon: '🏙️' },
];

const _VISIBILITY_ONDEMAND = [
  { key: 'od_apartments', label: 'Apartments on Demand', icon: '🏢' },
  { key: 'od_plots',      label: 'Plots on Demand',      icon: '🌿' },
  { key: 'od_villas',     label: 'Villas on Demand',     icon: '🏡' },
];

/**
 * Fetch the current visibility settings doc from Firestore.
 * Returns an object like { plots: true, villas: false, od_plots: true, ... }
 * Defaults to true (visible) for all keys if no doc exists.
 */
async function getVisibilitySettings() {
  try {
    const allSettings = await DB.settings.get();
    const doc = allSettings.find(s => s.type === 'section_visibility');
    if (doc) return doc;
  } catch (e) {
    console.error('Failed to load visibility settings:', e);
  }
  // Default: everything visible
  const defaults = { type: 'section_visibility' };
  [..._VISIBILITY_CATEGORIES, ..._VISIBILITY_ONDEMAND].forEach(item => {
    defaults[item.key] = true;
  });
  return defaults;
}

/** Build a toggle row HTML for the visibility modal */
function _buildToggleRow(item, settings) {
  const checked = settings[item.key] !== false; // default to true
  return `
  <div class="vis-toggle-row">
    <div class="vis-toggle-label">
      <span class="vis-icon">${item.icon}</span>
      <span>${item.label}</span>
    </div>
    <label class="vis-switch">
      <input type="checkbox" id="vis-chk-${item.key}" ${checked ? 'checked' : ''}>
      <span class="vis-switch-track"></span>
    </label>
  </div>`;
}

/** Open the Section Visibility Manager modal */
async function openVisibilityModal() {
  closeModal('admin-logout-modal');

  const catContainer   = document.getElementById('vis-categories');
  const odContainer    = document.getElementById('vis-ondemand');
  if (!catContainer || !odContainer) return;

  catContainer.innerHTML = '<div style="padding:12px;text-align:center;color:var(--mid-grey)">Loading...</div>';
  odContainer.innerHTML  = '';
  openModal('visibility-modal');

  const settings = await getVisibilitySettings();
  window._visibilityDocId = settings.id || null;

  catContainer.innerHTML = _VISIBILITY_CATEGORIES.map(item => _buildToggleRow(item, settings)).join('');
  odContainer.innerHTML  = _VISIBILITY_ONDEMAND.map(item => _buildToggleRow(item, settings)).join('');
}

/** Save the current toggle state back to Firestore */
async function saveVisibilitySettings() {
  if (!Admin.isLoggedIn()) return;

  const btn = document.getElementById('vis-save-btn');
  if (btn) btn.disabled = true;

  const allKeys = [..._VISIBILITY_CATEGORIES, ..._VISIBILITY_ONDEMAND];
  const updates = { type: 'section_visibility' };
  allKeys.forEach(item => {
    const chk = document.getElementById(`vis-chk-${item.key}`);
    updates[item.key] = chk ? chk.checked : true;
  });

  try {
    if (window._visibilityDocId) {
      await DB.settings.update(window._visibilityDocId, updates);
    } else {
      const added = await DB.settings.add(updates);
      window._visibilityDocId = added.id;
    }
    // Invalidate cache so next home-page render picks up changes
    clearCache('settings');
    showToast('✅ Visibility settings saved!', 'success');
    closeModal('visibility-modal');
    if (window._currentPage) window._currentPage();
  } catch (e) {
    console.error('Failed to save visibility settings:', e);
    showToast('Failed to save settings.', 'error');
  }

  if (btn) btn.disabled = false;
}
