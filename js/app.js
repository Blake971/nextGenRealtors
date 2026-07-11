/* =========================================================
   APP.JS — SPA Router, shared UI, modal manager, toast
   ========================================================= */

window._viewMode = 'grid'; // Always default to grid on load

function toggleViewMode(type) {
  window._viewMode = window._viewMode === 'grid' ? 'table' : 'grid';
  localStorage.setItem('re_viewMode', window._viewMode);

  // Synchronize button state immediately if it exists in the DOM
  const btn = document.getElementById('view-toggle-btn');
  if (btn) {
    btn.innerHTML = window._viewMode === 'table' ? '📊 ' + t('btn_grid_view') : '📋 ' + t('btn_tabular_view');
    btn.classList.toggle('active', window._viewMode === 'table');
  }

  filterAndSortListings(type, false);
}

// ---- Modal helpers ----
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function syncAdminUI() {
  if (typeof applyAdminUI === 'function') applyAdminUI();
}

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    if (e.target.id === 'prop-form-modal' && typeof cancelPropertyForm === 'function') {
      cancelPropertyForm();
    } else {
      e.target.classList.remove('open');
    }
  }

  // Close navigation dropdowns when clicking outside
  if (!e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown.active').forEach(d => d.classList.remove('active'));
  }
});

// FAB — stop click from bubbling to overlay close listener
// (without this, the modal opens and immediately closes)
document.addEventListener('DOMContentLoaded', () => {
  // Navigation scroll effect
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  const fab = document.getElementById('admin-fab');
  if (fab) {
    fab.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof window._fabAction === 'function') window._fabAction();
    });
  }

  // Setup observer for dynamic elements once globally
  setupIntersectionObserver();
});

function setupIntersectionObserver() {
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  window._globalObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        // Handle number counting if it's a stat number
        if (entry.target.classList.contains('count-up-stat') && !entry.target.dataset.counted) {
          animateNumber(entry.target);
          entry.target.dataset.counted = 'true';
        }
        observer.unobserve(entry.target); // Optional: only animate once
      }
    });
  }, observerOptions);
}

// Call this function whenever new content is loaded into the DOM
window.observeNewElements = function() {
  if (!window._globalObserver) return;
  document.querySelectorAll('.fade-up:not(.in-view), .count-up-stat:not([data-counted])').forEach(el => {
    window._globalObserver.observe(el);
  });
};

function animateNumber(element) {
  const originalText = element.innerText;
  const target = element.dataset.targetValue ? parseInt(element.dataset.targetValue, 10) : parseInt(originalText.replace(/[^0-9]/g, ''), 10);
  if (isNaN(target)) return;
  
  const hasPlus = originalText.includes('+');
  
  const duration = 2000;
  const frameDuration = 1000 / 60;
  const totalFrames = Math.round(duration / frameDuration);
  let frame = 0;
  
  const counter = setInterval(() => {
    frame++;
    const progress = frame / totalFrames;
    const easing = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const currentCount = Math.round(target * easing);
    
    element.innerText = currentCount.toLocaleString() + (hasPlus ? '+' : '');
    
    if (frame === totalFrames) {
      clearInterval(counter);
      element.innerText = originalText;
    }
  }, frameDuration);
}


// ---- Toast ----
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}

// ---- Star rating renderer ----
function renderStars(rating, max = 5) {
  return Array.from({ length: max }, (_, i) =>
    `<span class="star${i < rating ? '' : ' empty'}">★</span>`
  ).join('');
}

// ---- Image with fallback ----
function imgOrIcon(url, icon = '🏠') {
  if (url) return `<img src="${esc(url)}" alt="Property" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="card-img-placeholder" style="display:none">${icon}</div>`;
  return `<div class="card-img-placeholder">${icon}</div>`;
}

// ---- Property Card ----
function renderPropertyCard(item, type) {
  const isAdmin = Admin.isLoggedIn();
  const visible = item.isVisible !== false;
  if (!visible && !isAdmin) return '';

  const icon = type === 'plots' ? '🌿' : type === 'flats' ? '🏢' : type === 'apartments' ? '🏢' : type === 'villas' ? '🏡' : '🏙️';
  const specsHtml = buildCardSpecs(item, type);

  return `
  <div class="property-card fade-up${visible ? '' : ' property-card-hidden'}" data-id="${item.id}">
    <div class="card-image-wrap">
      ${imgOrIcon(item.imageUrl, icon)}
      <div class="card-price-tag">${type === 'plots' ? esc(item.price) + ' <span style="font-size:0.75rem;opacity:0.9;font-weight:500;">/ Sq Yd</span>' : esc(item.price)}</div>
      ${!visible ? `<div class="card-hidden-chip">Hidden from visitors</div>` : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${esc(item.title)}</h3>
      <p class="card-location" style="display:flex;justify-content:space-between">
        <span>📍 ${esc(item.location)}</span>
        ${item.propId ? `<span style="font-size:0.8rem;color:var(--text-dark);font-weight:500;">ID: #${item.propId}</span>` : ''}
      </p>
      <div class="card-specs">${specsHtml}</div>
      ${item.description ? `<p class="card-desc">${esc(item.description)}</p>` : ''}
      <div class="card-footer">
        <button class="btn btn-primary btn-sm" onclick="viewDetailOrAuth('${type}','${item.id}')">${t('btn_view_details')}</button>
        <div class="card-admin-actions">
          <button class="btn-icon btn-visibility-toggle ${visible ? 'is-visible' : 'is-hidden'}"
            title="${visible ? 'Currently visible to visitors - Click to hide' : 'Currently hidden from visitors - Click to show'}"
            aria-label="${visible ? 'Currently visible to visitors - Click to hide' : 'Currently hidden from visitors - Click to show'}"
            onclick="togglePropertyVisibility('${type}','${item.id}', ${visible})">${visible ? '✓' : '🔒'}</button>
          <button class="btn-icon btn-edit" title="Edit" onclick="editProperty('${type}','${item.id}')">✏️</button>
          <button class="btn-icon btn-del"  title="Delete" onclick="deleteProperty('${type}','${item.id}')">🗑️</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function refreshVisibilityNavigation(settings = null) {
  const visSettings = settings || window._visibilitySettings || (typeof getVisibilitySettings === 'function' ? await getVisibilitySettings() : null);
  if (!visSettings) return;

  window._visibilitySettings = visSettings;
  const isAdmin = Admin.isLoggedIn();
  const pages = ['plots', 'flats', 'apartments', 'villas', 'commercial'];

  pages.forEach(page => {
    document.querySelectorAll(`.nav-links a[data-page="${page}"]`).forEach(link => {
      const item = link.closest('li');
      if (!item) return;

      const visible = visSettings[page] !== false;
      item.style.display = visible || isAdmin ? '' : 'none';
      link.title = visible ? '' : 'Hidden from visitors';
      link.classList.toggle('nav-section-hidden', !visible && isAdmin);
      link.style.opacity = visible || !isAdmin ? '' : '0.65';
      link.style.fontStyle = visible || !isAdmin ? '' : 'italic';
    });
  });
}

function buildCardSpecs(item, type) {
  const tag = (icon, val) => val ? `<span class="spec-tag">${icon} ${esc(val)}</span>` : '';
  if (type === 'plots') return tag('📍', [item.village, item.district].filter(Boolean).join(', ')) + (item.lpNumber ? tag('📝', 'LP: ' + item.lpNumber) : '') + tag('✅', item.approvedBy) + (item.reraApproved === 'Yes' ? tag('🏛️', 'RERA Approved') : '');
  if (type === 'flats') return tag('📍', [item.village, item.district].filter(Boolean).join(', ')) + tag('🛏️', item.bhk) + tag('📐', item.area) + tag('🎨', item.furnishing);
  if (type === 'apartments') return tag('📍', [item.village, item.district].filter(Boolean).join(', ')) + tag('🏢', (item.blocks ? item.blocks + ' Blocks' : '')) + tag('📏', item.flatSizes) + tag('🏠', (item.totalUnits ? item.totalUnits + ' Units' : ''));
  if (type === 'villas') return tag('📍', [item.village, item.district].filter(Boolean).join(', ')) + tag('🛏️', item.bedrooms) + tag('🌳', item.landArea) + (item.hasPool ? `<span class="spec-tag">🏊 Pool</span>` : '') + (item.hasGarden ? `<span class="spec-tag">🌿 Garden</span>` : '');
  if (type === 'commercial') return tag('📍', [item.village, item.district].filter(Boolean).join(', ')) + tag('📐', item.area) + tag('🏢', item.floor) + tag('🎨', item.furnishing);
  return '';
}

// ---- Detail Modal ----

/** Extract YouTube video ID from any common URL format */
function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function safeBrochureUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
  } catch (error) {
    return '';
  }
}

function getPropertyBrochures(item) {
  if (Array.isArray(item.brochures)) {
    return item.brochures
      .filter(brochure => brochure && safeBrochureUrl(brochure.url))
      .map(brochure => ({ ...brochure, url: safeBrochureUrl(brochure.url) }));
  }
  const legacyUrl = safeBrochureUrl(item.brochureUrl);
  if (legacyUrl) {
    return [{
      url: legacyUrl,
      name: item.brochureName || 'Property brochure.pdf',
      path: item.brochurePath || '',
      size: Number(item.brochureSize) || 0
    }];
  }
  return [];
}

async function renderDetail(type, id) {
  // ---- AUTH GATE: detail pages require login ----
  if (typeof Auth !== 'undefined' && !Auth.currentUser()) {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:60px 20px;text-align:center;">
        <div style="font-size:3.5rem;margin-bottom:20px;">🔒</div>
        <h2 style="color:var(--navy);font-family:'Playfair Display',serif;margin-bottom:12px;">Sign In Required</h2>
        <p style="color:var(--mid-grey);font-size:1rem;max-width:400px;margin-bottom:28px;">Please sign in with your Google account to view full property details.</p>
        <button class="btn btn-primary btn-lg" onclick="Auth.requireAuth(() => renderDetail('${esc(type)}', '${esc(id)}'))">
          Sign In to View
        </button>
      </div>`;
    // Also open the modal automatically
    Auth.requireAuth(() => renderDetail(type, id));
    return;
  }

  const content = document.getElementById('page-content');

  const items = await DB[type].get();
  const item = items.find(i => i.id === id);
  if (!item) {
    content.innerHTML = `<div class="container section" style="text-align:center"><h2>Property not found</h2><button class="btn btn-primary" onclick="navigate('${type}')">Back to Listings</button></div>`;
    return;
  }

  const isAdmin = Admin.isLoggedIn();
  const visibilitySettings = window._visibilitySettings
    || (typeof getVisibilitySettings === 'function' ? await getVisibilitySettings() : {});
  const isSectionVisible = visibilitySettings[type] !== false;
  const isPropertyVisible = item.isVisible !== false;
  if (!isAdmin && (!isSectionVisible || !isPropertyVisible)) {
    content.innerHTML = `<div class="container section visibility-unavailable">
      <div class="visibility-unavailable-icon">🔒</div>
      <h2>Property not available</h2>
      <p>This property is currently hidden from visitors.</p>
      <button class="btn btn-primary" onclick="navigate('home')">Back to Home</button>
    </div>`;
    return;
  }
  const hiddenAdminNotice = isAdmin && (!isSectionVisible || !isPropertyVisible)
    ? `<div class="admin-hidden-notice">🔒 Hidden from visitors${!isSectionVisible ? ' because this section is disabled' : ''}</div>`
    : '';

  if (window.I18n && I18n.currentLanguage !== 'en') {
    if (item.title) item.title = await I18n.translateDynamic(item.title);
    if (item.description) item.description = await I18n.translateDynamic(item.description);
    if (item.location) item.location = await I18n.translateDynamic(item.location);
    if (item.village) item.village = await I18n.translateDynamic(item.village);
    if (item.district) item.district = await I18n.translateDynamic(item.district);
  }

  const icon = type === 'plots' ? '🌿' : type === 'flats' ? '🏢' : type === 'apartments' ? '🏢' : type === 'villas' ? '🏡' : '🏙️';
  const specsHtml = buildDetailSpecs(item, type);

  // Build image gallery
  const imgs = (item.images && item.images.length > 0) ? item.images
    : (item.imageUrl ? [item.imageUrl] : []);

  window._detailImages = imgs;

  const galleryHtml = imgs.length > 0
    ? `<div class="detail-gallery-container">
        <div class="detail-main-image-wrap" style="cursor: zoom-in;" onclick="triggerLightbox()">
          <img id="detail-main-img" src="${esc(imgs[0])}" alt="Property Photo 1">
        </div>
        ${imgs.length > 1 ? `
        <div class="detail-thumbnails">
          ${imgs.map((src, i) =>
            `<img class="detail-thumb${i === 0 ? ' active' : ''}"
                  src="${esc(src)}" alt="Thumbnail ${i + 1}"
                  onclick="setGalleryActive(this)"
                  onerror="this.style.display='none'">`
          ).join('')}
        </div>` : ''}
       </div>`
    : `<div class="detail-placeholder-icon">${icon}</div>`;

  const brochures = getPropertyBrochures(item);
  const brochureHtml = brochures.length > 0
    ? `<section class="brochure-panel" aria-labelledby="brochure-panel-title">
        <div class="brochure-panel-header">
          <div>
            <p class="brochure-label">Downloads</p>
            <h2 class="brochure-title" id="brochure-panel-title">Property Brochures (${brochures.length})</h2>
          </div>
        </div>
        <div class="brochure-grid">
          ${brochures.map((brochure, index) => `
            <article class="brochure-card">
              <div class="brochure-card-header">
                <span class="brochure-file-icon">PDF</span>
                <div>
                  <h3 title="${esc(brochure.name || 'Property brochure.pdf')}">${esc(brochure.name || 'Property brochure.pdf')}</h3>
                  <p>${brochure.size && typeof formatFileSize === 'function' ? formatFileSize(brochure.size) : 'Size unavailable'}</p>
                </div>
              </div>
              <div class="brochure-actions">
                <a href="${esc(brochure.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Open PDF</a>
                <a href="${esc(brochure.url)}" download="${esc(brochure.name || 'brochure.pdf')}" class="btn btn-primary btn-sm">Download</a>
              </div>
              <div class="brochure-viewer-shell">
                <iframe src="${esc(brochure.url)}#toolbar=0&navpanes=0" title="Preview ${esc(brochure.name || `brochure ${index + 1}`)}" class="brochure-viewer-frame" loading="lazy"></iframe>
              </div>
            </article>
          `).join('')}
        </div>
      </section>`
    : '';

  const videoHtml = item.videoUrl
    ? `<div style="margin-top:16px;font-size:0.9rem;color:var(--navy);display:flex;align-items:center;gap:8px;">
        🎬 Property Video: 
        <a href="${esc(item.videoUrl)}" target="_blank" rel="noopener" class="btn btn-primary" style="padding:6px 14px;font-size:0.85rem;border-radius:20px;">
          ▶ Open in YouTube
        </a>
       </div>`
    : `<div style="margin-top:16px;font-size:0.9rem;color:var(--mid-grey)">🎬 Video Tour: N/A</div>`;

  const mapsHtml = item.mapUrl
    ? `<a href="${esc(item.mapUrl)}" target="_blank" rel="noopener"
         class="btn btn-ghost"
         style="display:inline-flex;align-items:center;gap:8px;color:var(--navy);border-color:var(--light-grey);font-size:0.88rem;margin:0;">
        📍 View on Google Maps
      </a>`
    : '';

  const contactHtml = item.contactNumber
    ? `<a href="tel:${esc(item.contactNumber)}"
         class="btn btn-primary"
         style="display:inline-flex;align-items:center;gap:8px;font-size:0.88rem;margin:0;">
        📞 Call: ${esc(item.contactNumber)}
      </a>`
    : '';

  const companyLogoHtml = item.companyLogoUrl 
    ? `<div style="text-align:center; padding:16px; margin-bottom:24px; background:var(--off-white); border-radius:12px;">
         <img src="${esc(item.companyLogoUrl)}" alt="Company Logo" style="max-height:80px; width:auto; object-fit:contain;">
       </div>`
    : '';

  // Similar Properties Section
  const similarItems = (Admin.isLoggedIn() ? items : items.filter(i => i.isVisible !== false))
    .filter(i => String(i.id) !== String(id))
    .sort(() => 0.5 - Math.random()) // Shuffle for variety
    .slice(0, 3);

  let similarHtml = '';
  if (similarItems.length > 0) {
    similarHtml = `
    <div class="similar-properties-section" style="margin-top: 80px; padding-top: 60px; border-top: 2px solid var(--off-white);">
      <h2 style="text-align: center; margin-bottom: 40px; font-family: 'Playfair Display', serif; color: var(--navy); font-size: 2.2rem;">Similar ${type.charAt(0).toUpperCase() + type.slice(1)}</h2>
      <div class="properties-grid">
        ${similarItems.map(i => renderPropertyCard(i, type)).filter(Boolean).join('')}
      </div>
    </div>`;
  }

  content.innerHTML = `
  <div class="hero">
    <div class="container" style="position:relative;z-index:1">
      <div style="text-align: left; margin-bottom: 20px;">
        <button class="btn btn-ghost btn-sm" style="color: white; border-color: rgba(255,255,255,0.3);" onclick="navigate('${type}')">← Back to ${type.charAt(0).toUpperCase() + type.slice(1)}</button>
      </div>
      <p class="hero-eyebrow">${type.toUpperCase()}</p>
      <h1>${esc(item.title)}</h1>
    </div>
  </div>
  <section class="section" style="background:var(--white)">
    <div class="container" style="max-width:1100px">
      ${hiddenAdminNotice}
      <div class="detail-page-layout">
        <div class="detail-left-col">
          ${galleryHtml}
          ${brochureHtml}
        </div>
        <div class="detail-right-col">
          ${companyLogoHtml}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="detail-modal-price" style="margin-bottom:0; font-size: 2rem; color: var(--gold); font-weight: 700;">${esc(item.price)}</div>
            ${item.status === 'Sold Out'
          ? `<span class="badge" style="background:var(--danger);color:white;font-size:0.9rem;padding:6px 12px">${t('status_soldout')}</span>`
          : `<span class="badge" style="background:#25D366;color:white;font-size:0.9rem;padding:6px 12px">${t('status_available')}</span>`}
          </div>
          <div class="detail-modal-location" style="display:flex;justify-content:space-between; margin-bottom: 16px;">
            <span style="font-size: 1.1rem; color: var(--navy);">📍 ${esc(item.location)}</span>
            ${item.propId ? `<span style="font-size:0.85rem;color:var(--mid-grey)">ID: #${item.propId}</span>` : ''}
          </div>
          ${(mapsHtml || contactHtml) ? `
          <div class="detail-actions-row" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:16px; margin-bottom:16px;">
            ${mapsHtml}
            ${contactHtml}
          </div>` : ''}
          <div class="detail-specs-grid" style="margin-top: 24px;">${specsHtml}</div>
          ${item.description ? `<div class="detail-desc" style="margin-top: 32px;"><strong style="color:var(--navy);font-family:'Playfair Display',serif; font-size: 1.4rem;">Description</strong><br><br>${esc(item.description).split('\n').join('<br>')}</div>` : ''}
          ${item.locationAdvantages ? `<div class="detail-desc" style="margin-top: 24px;"><strong style="color:var(--navy);font-family:'Playfair Display',serif; font-size: 1.4rem;">Location Advantages</strong><br><br>${esc(item.locationAdvantages).split('\n').join('<br>')}</div>` : ''}
          ${item.projectHighlights ? `<div class="detail-desc" style="margin-top: 24px;"><strong style="color:var(--navy);font-family:'Playfair Display',serif; font-size: 1.4rem;">Project Highlights</strong><br><br>${esc(item.projectHighlights).split('\n').join('<br>')}</div>` : ''}
          ${item.legalBenefits ? `<div class="detail-desc" style="margin-top: 24px;"><strong style="color:var(--navy);font-family:'Playfair Display',serif; font-size: 1.4rem;">Legal & Investment Benefits</strong><br><br>${esc(item.legalBenefits).split('\n').join('<br>')}</div>` : ''}
          ${item.investmentPotential ? `<div class="detail-desc" style="margin-top: 24px;"><strong style="color:var(--navy);font-family:'Playfair Display',serif; font-size: 1.4rem;">Investment Potential</strong><br><br>${esc(item.investmentPotential).split('\n').join('<br>')}</div>` : ''}
          ${videoHtml}
          ${item.status !== 'Sold Out' ? `
          <div style="margin-top:40px;padding-top:30px;border-top:1px solid var(--light-grey);text-align:center">
            <a href="#contact" class="btn btn-primary btn-lg" onclick="navigate('contact')">📞 Enquire Now</a>
          </div>` : ''}
        </div>
      </div>
      
      ${similarHtml}

      <div style="margin-top: 60px; text-align: center;">
        <button class="btn btn-ghost" onclick="navigate('${type}')">← Return to Listings</button>
      </div>
    </div>
  </section>`;

  window.scrollTo(0, 0);
  if (window.observeNewElements) window.observeNewElements();
}

// Keep old showDetail for compatibility if needed, but we'll mainly use renderDetail now
async function showDetail(type, id) {
  navigate(`detail/${type}/${id}`);
}

/**
 * Gate: If user is signed in → navigate to detail page.
 * Otherwise → show Google sign-in modal, then navigate after sign-in.
 */
function viewDetailOrAuth(type, id) {
  if (typeof Auth !== 'undefined') {
    Auth.requireAuth(() => navigate(`detail/${type}/${id}`));
  } else {
    navigate(`detail/${type}/${id}`);
  }
}

/** Clicking any image in the detail gallery marks it as the "active" (large) image */
/** Transition the main image and mark thumbnail as active */
function setGalleryActive(thumbEl) {
  const mainImg = document.getElementById('detail-main-img');
  if (!mainImg || thumbEl.classList.contains('active')) return;

  const container = thumbEl.closest('.detail-gallery-container');
  if (!container) return;

  // 1. Mark active thumbnail
  container.querySelectorAll('.detail-thumb').forEach(t => t.classList.remove('active'));
  thumbEl.classList.add('active');

  // 2. Fade transition for main image
  mainImg.style.opacity = '0';
  setTimeout(() => {
    mainImg.src = thumbEl.src;
    mainImg.onload = () => {
      mainImg.style.opacity = '1';
    };
  }, 250);
}

window.triggerLightbox = function() {
  const activeThumb = document.querySelector('.detail-thumb.active');
  const imgs = window._detailImages || [];
  if (imgs.length === 0) return;
  
  let index = 0;
  if (activeThumb) {
    const thumbs = Array.from(document.querySelectorAll('.detail-thumb'));
    index = thumbs.indexOf(activeThumb);
    if (index === -1) index = 0;
  }
  window.openLightbox(imgs, index);
};

window.openLightbox = function(imgs, startIndex) {
  let currentIndex = startIndex;

  // Remove any existing lightbox
  const oldLightbox = document.getElementById('lightbox-modal');
  if (oldLightbox) oldLightbox.remove();

  // Create lightbox overlay
  const lightbox = document.createElement('div');
  lightbox.id = 'lightbox-modal';
  lightbox.className = 'lightbox-overlay';
  
  // Lightbox layout
  lightbox.innerHTML = `
    <button class="lightbox-close" id="lightbox-close-btn">&times;</button>
    <button class="lightbox-nav lightbox-prev" id="lightbox-prev-btn">&#10094;</button>
    <div class="lightbox-content">
      <img id="lightbox-img" src="${imgs[currentIndex]}" alt="Enlarged property photo">
      <div class="lightbox-counter" id="lightbox-counter-text">Image ${currentIndex + 1} of ${imgs.length}</div>
    </div>
    <button class="lightbox-nav lightbox-next" id="lightbox-next-btn">&#10095;</button>
  `;

  document.body.appendChild(lightbox);
  document.body.style.overflow = 'hidden'; // Lock background scroll

  const imgEl = lightbox.querySelector('#lightbox-img');
  const counterEl = lightbox.querySelector('#lightbox-counter-text');
  const prevBtn = lightbox.querySelector('#lightbox-prev-btn');
  const nextBtn = lightbox.querySelector('#lightbox-next-btn');

  // If there's only 1 image, hide nav buttons
  if (imgs.length <= 1) {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }

  function updateLightbox() {
    imgEl.style.opacity = '0';
    setTimeout(() => {
      imgEl.src = imgs[currentIndex];
      imgEl.onload = () => {
        imgEl.style.opacity = '1';
      };
      counterEl.textContent = `Image ${currentIndex + 1} of ${imgs.length}`;
    }, 200);
  }

  function showPrev() {
    currentIndex = (currentIndex - 1 + imgs.length) % imgs.length;
    updateLightbox();
  }

  function showNext() {
    currentIndex = (currentIndex + 1) % imgs.length;
    updateLightbox();
  }

  function closeLightbox() {
    lightbox.classList.add('fade-out');
    setTimeout(() => {
      lightbox.remove();
      document.body.style.overflow = ''; // Unlock scroll
    }, 300);
  }

  // Event Listeners
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); showPrev(); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); showNext(); });
  lightbox.querySelector('#lightbox-close-btn').addEventListener('click', closeLightbox);
  
  // Close on clicking overlay (outside content area)
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.classList.contains('lightbox-content')) {
      closeLightbox();
    }
  });

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft' && imgs.length > 1) showPrev();
    if (e.key === 'ArrowRight' && imgs.length > 1) showNext();
    if (e.key === 'Escape') closeLightbox();
  };
  window.addEventListener('keydown', handleKeyDown);

  // Clean up keydown event listener when removed
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node.id === 'lightbox-modal') {
          window.removeEventListener('keydown', handleKeyDown);
          observer.disconnect();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true });
};

function buildDetailSpecs(item, type) {
  const spec = (label, val) => {
    const displayVal = (val !== undefined && val !== null && val !== '') ? esc(String(val)) : '<span style="color:var(--mid-grey)">N/A</span>';
    return `<div class="detail-spec"><div class="detail-spec-label">${label}</div><div class="detail-spec-value">${displayVal}</div></div>`;
  };

  if (type === 'plots') return spec('District', item.district) + spec('Village', item.village)
    + spec('Area', item.area) + spec('Facing', item.facing)
    + spec('Approved By', item.approvedBy)
    + spec('LP Number', item.lpNumber)
    + spec('RERA Approved', item.reraApproved)
    + spec('Contact', item.contactNumber)
    + spec('Price per Sq Yard', item.price)
    + spec('Type', 'Open Plot');
  if (type === 'flats') return spec('District', item.district) + spec('Village', item.village) + spec('BHK', item.bhk) + spec('Area', item.area) + spec('Floor', item.floor) + spec('Furnishing', item.furnishing) + spec('Amenities', item.amenities) + spec('Price', item.price);
  if (type === 'apartments') return spec('District', item.district) + spec('Village', item.village) + spec('Total Acres', item.acres) + spec('Blocks', item.blocks) + spec('Floors', item.floors) + spec('Flat Sizes', item.flatSizes) + spec('Total Units', item.totalUnits) + spec('Club House', item.clubHouseSize) + spec('Amenities', item.amenities) + spec('Price', item.price);
  if (type === 'villas') return spec('District', item.district) + spec('Village', item.village) + spec('Bedrooms', item.bedrooms) + spec('Land Area', item.landArea) + spec('Built-up Area', item.builtUpArea) + spec('Pool', item.hasPool ? '✅ Yes' : '❌ No') + spec('Garden', item.hasGarden ? '✅ Yes' : '❌ No') + spec('Price', item.price);
  if (type === 'commercial') return spec('District', item.district) + spec('Village', item.village) + spec('Super Built-up Area', item.area) + spec('Floor', item.floor) + spec('Washrooms', item.washrooms) + spec('Parking', item.parking) + spec('Furnishing', item.furnishing) + spec('Price', item.price);
  return '';
}

// ---- Admin handlers ----
async function editProperty(type, id) {
  const items = await DB[type].get();
  const item = items.find(i => i.id === id);
  if (item) showPropertyForm(type, item);
}

// Pending delete target (used by the custom modal)
let _pendingDelete = null;

function deleteProperty(type, id) {
  _pendingDelete = { kind: 'property', type, id };
  const btn = document.getElementById('delete-confirm-btn');
  if (btn) btn.onclick = confirmDelete;
  openModal('delete-confirm-modal');
}

async function confirmDelete() {
  if (!_pendingDelete) return;
  const { kind, type, id } = _pendingDelete;
  _pendingDelete = null;
  closeModal('delete-confirm-modal');

  try {
    if (kind === 'property') {
      const existingItems = await DB[type].get();
      const existingItem = existingItems.find(item => item.id === id);
      await DB[type].del(id);
      if (existingItem && typeof deleteBrochureFile === 'function') {
        const brochureFiles = getPropertyBrochures(existingItem);
        const deleteResults = await Promise.allSettled(brochureFiles.map(deleteBrochureFile));
        if (deleteResults.some(result => result.status === 'rejected')) {
          showToast('Listing deleted, but one brochure could not be removed from storage.', 'error');
        }
      }
      showToast('Listing deleted.', 'success');
      if (window._currentPage) window._currentPage();
      syncAdminUI();
    } else if (kind === 'review') {
      const review = (window._reviewsList || []).find(r => r.id === id);
      const currentUser = Auth.currentUser();
      const isAdmin = Admin.isLoggedIn();
      const isOwner = currentUser && review && review.uid === currentUser.uid;

      if (isOwner || isAdmin) {
        await DB.reviews.del(id);
        showToast('Review deleted.', 'success');
        renderReviews();
        syncAdminUI();
      } else {
        showToast('You are not authorized to delete this review.', 'error');
      }
    }
  } catch (e) {
    showToast('Failed to delete item.', 'error');
  }
}

// ---- Router ----
const pages = {
  home: renderHome,
  about: renderAbout,
  plots: () => renderListings('plots'),
  flats: () => renderListings('flats'),
  apartments: () => renderListings('apartments'),
  villas: () => renderListings('villas'),
  commercial: () => renderListings('commercial'),
  miniposts: () => {
    if (typeof Auth !== 'undefined') {
      // Temporarily write a loading state so the background isn't blank
      document.getElementById('page-content').innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div><p>Verifying access...</p></div>';
      Auth.requireAuth(() => renderMiniPosts());
    } else {
      renderMiniPosts();
    }
  },
  reviews: renderReviews,
  subscribe: renderSubscribe,
  contact: renderContact,
  detail: (params) => renderDetail(params[0], params[1])
};

function navigate(path) {
  // Ensure dropdowns are closed upon navigation
  document.querySelectorAll('.nav-dropdown.active').forEach(d => d.classList.remove('active'));
  // Close mobile nav if open
  document.querySelector('.nav-links')?.classList.remove('mobile-open');

  history.pushState({ path }, '', `#${path}`);
  loadPage(path);
}

function loadPage(path) {
  const parts = path.split('/');
  const pageName = parts[0];
  const params = parts.slice(1);

  let page = pageName;
  if (!pages[page]) page = 'home';

  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  // Close mobile nav
  document.querySelector('.nav-links')?.classList.remove('mobile-open');

  const content = document.getElementById('page-content');
  content.innerHTML = '';

  // Update FAB action for this page (FAB uses window._fabAction via its own event listener)
  window._fabAction = () => showPropertyForm(page);


  window._currentPage = () => pages[page](params);
  pages[page](params);
  syncAdminUI(); // syncAdminUI handles FAB visibility based on current hash
  refreshVisibilityNavigation().catch(() => { });
}

// ---- Page Renderers ----

async function renderHome() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div></div>';

  let allPlots = [], allApartments = [], allVillas = [], clientsData = [];
  let visSettings = {};
  try {
    const results = await Promise.all([
      DB.plots.get(),
      DB.apartments.get(),
      DB.villas.get(),
      DB.clients.get(),
      getVisibilitySettings()
    ]);
    
    allPlots = results[0];
    allApartments = results[1];
    allVillas = results[2];
    clientsData = results[3];
    visSettings = results[4];
    window._visibilitySettings = visSettings;
  } catch (e) {
    console.error('Data fetch failed', e);
  }

  const isAdmin = Admin.isLoggedIn();
  refreshVisibilityNavigation(visSettings).catch(() => { });

  // Helper: wrap section HTML — hides from visitors, shows admin badge overlay when hidden
  function _visWrap(key, html) {
    const visible = visSettings[key] !== false;
    if (visible) return html;
    if (!isAdmin) return '';
    return `<div class="vis-admin-hidden">
      <button class="vis-hidden-badge" onclick="openVisibilityModal()">🔒 Hidden from visitors</button>
      ${html}
    </div>`;
  }

  const onDemandPlots = allPlots.filter(p => p.projectOnDemand === 'Yes');
  const onDemandApartments = allApartments.filter(p => p.projectOnDemand === 'Yes');
  const onDemandVillas = allVillas.filter(p => p.projectOnDemand === 'Yes');
  const visibleOnDemandPlots = (isAdmin ? onDemandPlots : onDemandPlots.filter(p => p.isVisible !== false)).slice(0, 3);
  const visibleOnDemandApartments = (isAdmin ? onDemandApartments : onDemandApartments.filter(p => p.isVisible !== false)).slice(0, 3);
  const visibleOnDemandVillas = (isAdmin ? onDemandVillas : onDemandVillas.filter(p => p.isVisible !== false)).slice(0, 3);
  const heroTarget = isAdmin
    ? 'plots'
    : ['plots', 'flats', 'apartments', 'villas', 'commercial'].find(key => visSettings[key] !== false) || 'contact';

  // Parallelize dynamic translations for better performance
  if (window.I18n && I18n.currentLanguage !== 'en') {
    // Translate standard texts or descriptions if needed
  }

  content.innerHTML = `
  <section class="home-hero">
    <div class="home-hero-bg"></div>
    <div class="container" style="position:relative; z-index:2;">
      <div class="home-hero-content">
        <p class="hero-eyebrow text-gold fade-up">${t('hero_eyebrow')}</p>
        <h1 class="fade-up fade-up-delay-1">${t('hero_title')}</h1>
        <p class="hero-desc fade-up fade-up-delay-2">${t('hero_desc')}</p>
        <div class="fade-up fade-up-delay-3" style="display:flex; justify-content:center; gap:16px;">
          <button class="btn btn-primary btn-lg" onclick="navigate('${heroTarget}')">${t('hero_btn')}</button>
          <a href="#contact" class="btn btn-secondary btn-lg" onclick="navigate('contact')">Get in Touch</a>
        </div>
      </div>
    </div>
  </section>


  ${_visWrap('od_apartments', `<section class="section" style="background:var(--white);">
    <div class="container">
      <div class="section-header mb-32">
        <p class="hero-eyebrow text-gold">FEATURED</p>
        <h2 class="text-navy">Apartments on Demand</h2>
        <p>Explore our highly sought-after apartment projects available for a limited time.</p>
      </div>
      <div class="properties-grid" style="text-align:left;">
        ${visibleOnDemandApartments.length > 0
          ? visibleOnDemandApartments.map(p => renderPropertyCard(p, 'apartments')).filter(Boolean).join('')
          : '<div style="grid-column: 1 / -1; background: var(--white); border: 2px dashed rgba(243, 119, 33, 0.15); border-radius: var(--radius-md); padding: 40px 24px; text-align: center; color: var(--text-dark); box-shadow: var(--shadow-sm);"><div style="font-size: 2.2rem; margin-bottom: 12px;">🏢</div><p style="font-weight: 600; font-size: 1rem; margin-bottom: 16px; color: var(--navy);">No Featured Apartments On Demand Right Now</p><a href="#contact" class="btn btn-primary btn-sm" onclick="navigate(\'contact\')">📩 Enquire for Off-Market Deals</a></div>'
        }
      </div>
    </div>
  </section>`)}

  ${_visWrap('od_plots', `<section class="section" style="background:var(--white);">
    <div class="container">
      <div class="section-header mb-32">
        <p class="hero-eyebrow text-gold">FEATURED</p>
        <h2 class="text-navy">Plots on Demand</h2>
        <p>Explore our highly sought-after plot projects available for a limited time.</p>
      </div>
      <div class="properties-grid" style="text-align:left;">
        ${visibleOnDemandPlots.length > 0
          ? visibleOnDemandPlots.map(p => renderPropertyCard(p, 'plots')).filter(Boolean).join('')
          : '<div style="grid-column: 1 / -1; background: var(--off-white); border: 2px dashed rgba(243, 119, 33, 0.15); border-radius: var(--radius-md); padding: 40px 24px; text-align: center; color: var(--text-dark); box-shadow: var(--shadow-sm);"><div style="font-size: 2.2rem; margin-bottom: 12px;">🌿</div><p style="font-weight: 600; font-size: 1rem; margin-bottom: 16px; color: var(--navy);">No Featured Plots On Demand Right Now</p><a href="#contact" class="btn btn-primary btn-sm" onclick="navigate(\'contact\')">📩 Enquire for Off-Market Deals</a></div>'
        }
      </div>
    </div>
  </section>`)}

  ${_visWrap('od_villas', `<section class="section" style="background:var(--white);">
    <div class="container">
      <div class="section-header mb-32">
        <p class="hero-eyebrow text-gold">FEATURED</p>
        <h2 class="text-navy">Villas on Demand</h2>
        <p>Explore our highly sought-after villa projects available for a limited time.</p>
      </div>
      <div class="properties-grid" style="text-align:left;">
        ${visibleOnDemandVillas.length > 0
          ? visibleOnDemandVillas.map(p => renderPropertyCard(p, 'villas')).filter(Boolean).join('')
          : '<div style="grid-column: 1 / -1; background: var(--off-white); border: 2px dashed rgba(243, 119, 33, 0.15); border-radius: var(--radius-md); padding: 40px 24px; text-align: center; color: var(--text-dark); box-shadow: var(--shadow-sm);"><div style="font-size: 2.2rem; margin-bottom: 12px;">🏡</div><p style="font-weight: 600; font-size: 1rem; margin-bottom: 16px; color: var(--navy);">No Featured Villas On Demand Right Now</p><a href="#contact" class="btn btn-primary btn-sm" onclick="navigate(\'contact\')">📩 Enquire for Off-Market Deals</a></div>'
        }
      </div>
    </div>
  </section>`)}

  <!-- Social Media Handles -->
  <section class="section" style="background:var(--off-white); padding-bottom:60px;">
    <div class="container">
      <div class="section-header mb-32">
        <p class="hero-eyebrow text-gold">CONNECT WITH US</p>
        <h2 class="text-navy">Social Media Handles</h2>
        <p>Stay updated with our latest property listings and real estate insights.</p>
      </div>
      <div style="display:flex; justify-content:center; gap:30px; flex-wrap:wrap; margin-bottom:0;">
        <a href="https://whatsapp.com/channel/0029VbCgeWyAzNbsnw5lZV3O" target="_blank" class="social-card fade-up">
          <div class="social-card-icon wa">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </div>
          <span>WhatsApp</span>
        </a>
        <a href="https://www.youtube.com/channel/UC06qF2z-4PF2_9wxP0uuLUA" target="_blank" class="social-card fade-up" style="animation-delay:0.1s">
          <div class="social-card-icon yt">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </div>
          <span>YouTube</span>
        </a>
        <a href="https://www.instagram.com/nextgenrealtors4/" target="_blank" class="social-card fade-up" style="animation-delay:0.2s">
          <div class="social-card-icon insta">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </div>
          <span>Instagram</span>
        </a>
        <a href="https://www.facebook.com/nextGenRealtorsHub" target="_blank" class="social-card fade-up" style="animation-delay:0.3s">
          <div class="social-card-icon fb">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z"/></svg>
          </div>
          <span>Facebook</span>
        </a>
      </div>
    </div>
  </section>

  <!-- Find Your Perfect Property Categories -->
  <section class="section" style="background:var(--white); padding-top:60px;">
    <div class="container">
      <div class="section-header mb-32">
        <p class="hero-eyebrow text-gold">DISCOVER OUR PORTFOLIO</p>
        <h2 class="text-navy">Find Your Perfect Property</h2>
        <p>Explore our curated selection of premium real estate across Hyderabad's most sought-after locations.</p>
      </div>
      <div class="cat-card-grid">
        ${_visWrap('plots', `<div class="cat-card fade-up" onclick="navigate('plots')" style="background-image: url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1200&auto=format&fit=crop')"><div class="cat-card-overlay"></div><div class="cat-card-content"><h3>Plots</h3><span class="cat-card-link">View Listings →</span></div></div>`)}
        ${_visWrap('flats', `<div class="cat-card fade-up fade-up-delay-1" onclick="navigate('flats')" style="background-image: url('https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=1200&auto=format&fit=crop')"><div class="cat-card-overlay"></div><div class="cat-card-content"><h3>Flats</h3><span class="cat-card-link">View Listings →</span></div></div>`)}
        ${_visWrap('villas', `<div class="cat-card fade-up fade-up-delay-1" onclick="navigate('villas')" style="background-image: url('https://images.unsplash.com/photo-1613490493576-7fde63acd811?q=80&w=1200&auto=format&fit=crop')"><div class="cat-card-overlay"></div><div class="cat-card-content"><h3>Villas</h3><span class="cat-card-link">View Listings →</span></div></div>`)}
        ${_visWrap('commercial', `<div class="cat-card fade-up fade-up-delay-2" onclick="navigate('commercial')" style="background-image: url('https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop')"><div class="cat-card-overlay"></div><div class="cat-card-content"><h3>Commercial</h3><span class="cat-card-link">View Listings →</span></div></div>`)}
        ${_visWrap('apartments', `<div class="cat-card fade-up fade-up-delay-3" onclick="navigate('apartments')" style="background-image: url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?q=80&w=1200&auto=format&fit=crop')"><div class="cat-card-overlay"></div><div class="cat-card-content"><h3>Apartments</h3><span class="cat-card-link">View Listings →</span></div></div>`)}
      </div>
    </div>
  </section>

  <!-- Our Clients / Associations -->
  <section class="section" style="background:var(--off-white); text-align:center;">
    <div class="container">
      <p class="hero-eyebrow text-gold">ASSOCIATIONS</p>
      <h2 class="text-navy mb-8">Proudly Collaborating With</h2>
      <p class="mb-32" style="color:var(--text-dark);">Driving success through trusted partnerships and exceptional service.</p>
      
      ${Admin.isLoggedIn() ? `<div style="text-align:right; margin-bottom: 20px;"><button class="btn btn-primary btn-sm" onclick="showPropertyForm('clients')">➕ Add Client</button></div>` : ''}
      
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 40px;">
        ${clientsData.map(c => `
          <div class="fade-up" style="display:flex; flex-direction:column; align-items:center; width: 140px;">
            <div style="width: 100px; height: 100px; border-radius: 50%; overflow: hidden; background:var(--white); box-shadow:0 10px 20px rgba(0,0,0,0.05); margin-bottom:12px; display:flex; align-items:center; justify-content:center;">
              ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" loading="lazy" style="width:100%; height:100%; object-fit:contain; padding:8px;">` : '<span style="font-size:2rem;">🤝</span>'}
            </div>
            <p style="font-weight:600; color:var(--navy); font-size:0.95rem; text-align:center; word-break:break-word;">${esc(c.title)}</p>
            ${Admin.isLoggedIn() ? `<div style="display:flex; gap:4px; margin-top:8px;"><button class="btn-icon " style="padding:4px;font-size:0.8rem;border:none;background:none;cursor:pointer" title="Edit" onclick="editProperty('clients','${c.id}')">✏️</button><button class="btn-icon" style="padding:4px;font-size:0.8rem;border:none;background:none;cursor:pointer" title="Delete" onclick="deleteProperty('clients','${c.id}')">🗑️</button></div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  <!-- Testimonial teaser -->
  <section class="section" style="background:var(--navy);text-align:center">
    <div class="container">
      <p style="color:#FCA140;font-size:1.1rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:16px">${t('about_clients_say_pre')}</p>
      <h2 style="color:var(--white);font-size:2rem;margin-bottom:24px">${t('about_clients_quote')}</h2>
      <p style="color:rgba(255,255,255,0.6);margin-bottom:32px">${t('about_clients_author')}</p>
      <button class="btn btn-secondary" onclick="navigate('reviews')">${t('about_btn_reviews')}</button>
    </div>
  </section>
  `;

  if (window.observeNewElements) window.observeNewElements();
}

async function renderAbout() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div></div>';

  let aboutData = [], registeredUsersCount = 0;
  try {
    const results = await Promise.all([
      DB.about.get(),
      db.collection('users').get()
    ]);
    
    aboutData = results[0];
    registeredUsersCount = results[1].size;
  } catch (e) {
    console.error('Data fetch failed', e);
  }

  const defaultAbout = {
    name: 'NextGen Realtors™',
    tagline: 'Your Trusted Guide',
    title: 'Senior Property Consultant · Hyderabad',
    bio1: 'With over <strong>15 years of experience</strong> in the Hyderabad real estate market, I specialise in helping families and investors find their perfect property — whether it\'s an open plot, a luxury flat, or a bespoke villa. My approach is built on transparency, local expertise, and a genuine commitment to your goals.',
    bio2: 'I have successfully closed over <strong>500+ transactions</strong> across Hyderabad\'s most sought-after neighbourhoods. My deep network and market insight ensure you get the best value every time.',
    mission: 'To empower families and investors with transparent, data-driven real estate guidance. We strive to simplify the property buying process, ensuring every client finds their perfect home or solid investment with confidence, clarity, and peace of mind.',
    vision: 'To be Hyderabad\'s most trusted and innovative real estate partner. We envision a future where finding a dream property is an exciting, stress-free journey backed by unwavering integrity, exceptional service, and community-focused sustainable development.'
  };

  const info = aboutData.length > 0 ? aboutData[0] : defaultAbout;

  // Parallelize dynamic translations for better performance
  if (window.I18n && I18n.currentLanguage !== 'en') {
    const tKeys = ['name', 'tagline', 'title', 'bio1', 'bio2', 'mission', 'vision'];
    const tTasks = tKeys.map(k => I18n.translateDynamic(info[k]));
    const tValues = await Promise.all(tTasks);
    tKeys.forEach((k, i) => { if (info[k]) info[k] = tValues[i]; });
  }

  // Sanitize line breaks so they don't break the template string parsing
  const safeMission = esc(info.mission || '').replace(/\r?\n/g, '<br>');
  const safeVision = esc(info.vision || '').replace(/\r?\n/g, '<br>');

  const adminBtnHtml = Admin.isLoggedIn()
    ? `<button class="btn btn-ghost btn-sm" style="margin-top:20px; border-color:var(--light-grey)" onclick="openEditAboutModal('${info.id || ''}')">✏️ Edit About Info</button>`
    : '';

  content.innerHTML = `
  <section class="about-hero">
    <div class="about-hero-bg"></div>
    <div class="container">
      <div class="about-hero-grid">
        <div class="agent-photo-wrap" style="display:none;"></div>
        <div class="about-hero-content">

          <h1 class="about-name fade-up fade-up-delay-2"><span id="a-disp-name">${esc(info.name || '')}</span><br><em id="a-disp-tagline">${esc(info.tagline || '')}</em></h1>
          <p class="about-title fade-up fade-up-delay-2" id="a-disp-title">${esc(info.title || '')}</p>
          <p class="about-bio fade-up fade-up-delay-3" id="a-disp-bio1">${esc(info.bio1 || '')}</p>
          <p class="about-bio fade-up fade-up-delay-3" id="a-disp-bio2">${esc(info.bio2 || '')}</p>

          <div style="display:flex; justify-content:center; gap:12px; align-items:center" class="fade-up fade-up-delay-4">
            <a href="#contact" class="btn btn-primary btn-lg" onclick="navigate('contact')">${t('about_contact_btn')}</a>
            ${adminBtnHtml}
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Stats -->
  <section style="background:linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);padding:0;border-bottom:1px solid rgba(243,119,33,0.08);">
    <div class="container">
      <div class="stats-grid stats-grid-4 stats-grid-dark" style="padding:60px 0">
        <div class="stat-card"><div class="stat-number count-up-stat" data-target-value="${t('about_stats_1_num')}">${t('about_stats_1_num')}</div><div class="stat-label">${t('about_stats_1_label')}</div></div>
        <div class="stat-card"><div class="stat-number count-up-stat" data-target-value="${t('about_stats_2_num')}">${t('about_stats_2_num')}</div><div class="stat-label">${t('about_stats_2_label')}</div></div>
        <div class="stat-card"><div class="stat-number count-up-stat" data-target-value="${t('about_stats_3_num')}">${t('about_stats_3_num')}</div><div class="stat-label">${t('about_stats_3_label')}</div></div>
        <div class="stat-card stat-card-users">
          <div class="stat-number count-up-stat" id="registered-users-count" data-target-value="${registeredUsersCount}">${registeredUsersCount.toLocaleString()}</div>
          <div class="stat-label">👥 Registered Users</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Expertise -->
  <section class="section" style="background:var(--off-white)">
    <div class="container">
      <div class="section-header">
        <h2>${t('about_expertise')}</h2>
        <p>${t('about_expertise_desc')}</p>
      </div>
      <div class="expertise-grid">
        <div class="expertise-card">
          <div class="expertise-icon">🌿</div>
          <h4>${t('about_exp_plots')}</h4>
          <p>${t('about_exp_plots_desc')}</p>
        </div>
        <div class="expertise-card">
          <div class="expertise-icon">🏢</div>
          <h4>${t('about_exp_flats')}</h4>
          <p>${t('about_exp_flats_desc')}</p>
        </div>
        <div class="expertise-card">
          <div class="expertise-icon">🏡</div>
          <h4>${t('about_exp_villas')}</h4>
          <p>${t('about_exp_villas_desc')}</p>
        </div>
        <div class="expertise-card">
          <div class="expertise-icon">💼</div>
          <h4>${t('about_exp_invest')}</h4>
          <p>${t('about_exp_invest_desc')}</p>
        </div>
      </div>
    </div>
  </section>

  <style>
    .mv-row { display: grid; gap: 40px; align-items: center; }
    @media (min-width: 768px) {
      .mv-row { grid-template-columns: 1fr 1fr; }
      .mv-row.reverse .mv-content { order: 2; }
      .mv-row.reverse .mv-image-wrap { order: 1; }
    }
  </style>

  <!-- Mission & Vision -->
  <section class="section" style="background:var(--white)">
    <div class="container">
      <div class="mission-vision-container">
        <!-- Mission -->
        <div class="mv-row fade-up">
          <div class="mv-content">
            <h2 class="text-navy mb-16">${t('about_mission')}</h2>
            <p style="color:var(--text-dark);line-height:1.8;font-size:1.05rem;" id="a-disp-mission">
              ${safeMission}
            </p>
          </div>
          <div class="mv-image-wrap">
            <img src="images/mission_statement.png" alt="Our Mission" loading="lazy" style="width:100%;height:350px;object-fit:cover;border-radius:12px;box-shadow:0 15px 30px rgba(0,0,0,0.1);display:block;">
          </div>
        </div>

        <!-- Vision -->
        <div class="mv-row reverse fade-up fade-up-delay-1" style="margin-top:60px;">
          <div class="mv-content">
            <h2 class="text-navy mb-16">${t('about_vision')}</h2>
            <p style="color:var(--text-dark);line-height:1.8;font-size:1.05rem;" id="a-disp-vision">
               ${safeVision}
            </p>
          </div>
          <div class="mv-image-wrap">
            <img src="images/vision_statement.png" alt="Our Vision" loading="lazy" style="width:100%;height:350px;object-fit:cover;border-radius:12px;box-shadow:0 15px 30px rgba(0,0,0,0.1);display:block;">
          </div>
        </div>
      </div>
    </div>
  </section>`;

  if (window.observeNewElements) window.observeNewElements();
}

// Logic for generating the area column value
function getAreaVal(i, type) {
  if (type === 'plots') return i.area || '';
  if (type === 'flats') return i.area || '';
  if (type === 'apartments') return i.acres || '';
  if (type === 'villas') return i.builtUpArea || i.landArea || '';
  if (type === 'commercial') return i.area || '';
  return '';
}

function renderPropertyTable(items, type) {
  console.log(`DEBUG: Entering renderPropertyTable. Items count: ${items ? items.length : 'null'}, Type: ${type}`);
  if (!items || items.length === 0) return `<div class="empty-state"><h3>${t('empty_state')}</h3></div>`;

  let rows = '';
  const isAdmin = Admin.isLoggedIn();
  try {
    for (const i of items) {
      console.log('DEBUG: Rendering row for item ID:', i.id);
      const rowId = (typeof esc === 'function') ? esc(i.propId || '-') : (i.propId || '-');
      const rowTitle = (typeof esc === 'function') ? esc(i.title) : (i.title || '');
      const rowLocation = (typeof esc === 'function') ? esc(i.location) : (i.location || '');
      const rowVillage = (typeof esc === 'function') ? esc(i.village || '') : (i.village || '');
      const rowArea = getAreaVal(i, type);
      const rowFacing = (typeof esc === 'function') ? esc(i.facing || '-') : (i.facing || '-');
      const rowStatus = i.status === 'Sold Out' ? t('status_soldout') : t('status_available');
      const statusClass = i.status === 'Sold Out' ? 'table-status-sold' : 'table-status-available';
      const rowBtn = t('btn_view_details');

      const rowPrice = type === 'plots' ? `<td>${(typeof esc === 'function') ? esc(i.price || '-') : (i.price || '-')}</td>` : '';
      const isVisible = i.isVisible !== false;
      const adminBtns = isAdmin ? `
        <button class="btn-icon btn-visibility-toggle ${isVisible ? 'is-visible' : 'is-hidden'}" style="margin-left:4px;"
          title="${isVisible ? 'Currently visible to visitors - Click to hide' : 'Currently hidden from visitors - Click to show'}"
          aria-label="${isVisible ? 'Currently visible to visitors - Click to hide' : 'Currently hidden from visitors - Click to show'}"
          onclick="event.stopPropagation(); togglePropertyVisibility('${type}','${i.id}', ${isVisible})">${isVisible ? '✓' : '🔒'}</button>
        <button class="btn-icon btn-edit" style="margin-left:4px;" title="Edit" onclick="event.stopPropagation(); editProperty('${type}','${i.id}')">✏️</button>
        <button class="btn-icon btn-del" style="margin-left:4px;" title="Delete" onclick="event.stopPropagation(); deleteProperty('${type}','${i.id}')">🗑️</button>
      ` : '';

      rows += `
        <tr class="${isVisible ? '' : 'property-row-hidden'}" onclick="viewDetailOrAuth('${type}','${i.id}')" style="cursor:pointer">
          <td class="table-id">${rowId}</td>
          <td class="table-title">${rowTitle}</td>
          <td>${rowLocation}</td>
          <td>${rowVillage}</td>
          <td>${rowArea}</td>
          ${rowPrice}
          ${type !== 'plots' ? `<td class="table-facing">${rowFacing}</td>` : ''}
          <td>
            <span class="table-status ${statusClass}">${rowStatus}</span>
          </td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewDetailOrAuth('${type}','${i.id}');">${rowBtn}</button>
            ${adminBtns}
          </td>
        </tr>`;
    }
  } catch (err) {
    console.error('DEBUG: ERROR inside renderPropertyTable loop!', err);
    return `<div class="error-state">Error rendering table: ${err.message}</div>`;
  }

  console.log(`DEBUG: renderPropertyTable generated ${items.length} rows.`);

  return `
  <div class="property-table-wrap">
    <table class="property-table">
      <thead>
        <tr>
          <th>${t('table_col_id')}</th>
          <th>${t('table_col_title')}</th>
          <th>${t('table_col_location')}</th>
          <th>${t('table_col_village')}</th>
          <th>${t('table_col_area')}</th>
          ${type === 'plots' ? `<th>Price per sq Yard</th>` : ''}
          ${type !== 'plots' ? `<th>${t('table_col_facing')}</th>` : ''}
          <th>${t('table_col_status')}</th>
          <th>${t('table_col_action')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

async function renderListings(type) {
  const labels = {
    plots: { title: t('section_plots'), sub: t('section_plots_desc'), singular: t('nav_plots') },
    flats: { title: t('section_flats'), sub: t('section_flats_desc'), singular: t('nav_flats') },
    apartments: { title: 'Premium Apartments', sub: 'Find gated community living', singular: 'Apartment' },
    villas: { title: t('section_villas'), sub: t('section_villas_desc'), singular: t('nav_villas') },
    commercial: { title: t('section_commercial'), sub: t('section_commercial_desc'), singular: t('nav_commercial') },
  };
  const icons = { plots: '🌿', flats: '🏢', apartments: '🏢', villas: '🏡', commercial: '🏙️' };
  const { title, sub, singular } = labels[type];

  const isAdmin = Admin.isLoggedIn();
  const visibilitySettings = window._visibilitySettings
    || (typeof getVisibilitySettings === 'function' ? await getVisibilitySettings() : {});
  window._visibilitySettings = visibilitySettings;
  await refreshVisibilityNavigation(visibilitySettings);
  const sectionVisible = visibilitySettings[type] !== false;
  if (!sectionVisible && !isAdmin) {
    document.getElementById('page-content').innerHTML = `
      <div class="container section visibility-unavailable">
        <div class="visibility-unavailable-icon">🔒</div>
        <h2>Section not available</h2>
        <p>This property section is currently hidden from visitors.</p>
        <button class="btn btn-primary" onclick="navigate('home')">Back to Home</button>
      </div>`;
    return;
  }

  const items = await DB[type].get();
  const visibleItems = isAdmin ? items : items.filter(item => item.isVisible !== false);
  const sectionAdminNotice = !sectionVisible && isAdmin
    ? '<div class="admin-hidden-notice">🔒 This section is hidden from visitors. Admins can still manage its listings.</div>'
    : '';

  // Prepare hero header
  const heroHtml = `
  <div class="hero">
    <div class="container" style="position:relative;z-index:1">
      <p class="hero-eyebrow">${title}</p>
      <h1>${title.split(' ').slice(0, 1).join(' ')} <em>${title.split(' ').slice(1).join(' ')}</em></h1>
      <p>${sub}</p>
      <div style="margin-top:8px">
        <span class="badge badge-gold">${visibleItems.length} Listing${visibleItems.length !== 1 ? 's' : ''} Available</span>
      </div>
    </div>
  </div>`;

  if (window.I18n && I18n.currentLanguage !== 'en') {
    for (let item of visibleItems) {
      if (item.title) item.title = await I18n.translateDynamic(item.title);
      if (item.description) item.description = await I18n.translateDynamic(item.description);
      if (item.location) item.location = await I18n.translateDynamic(item.location);
    }
  }

  // Inline admin "Add" button — placed in the page itself, no floating button issues
  const adminAddBtn = isAdmin
    ? `<button class="btn btn-primary" style="margin-left:auto;flex-shrink:0"
         onclick="showPropertyForm('${type}')">
         ➕ Add New ${singular}
       </button>`
    : '';

  const viewToggleBtn = `
    <button id="view-toggle-btn" class="view-toggle-btn ${window._viewMode === 'table' ? 'active' : ''}" onclick="toggleViewMode('${type}')">
      ${window._viewMode === 'table' ? '📊 ' + t('btn_grid_view') : '📋 ' + t('btn_tabular_view')}
    </button>`;

  document.getElementById('page-content').innerHTML = `
  ${heroHtml}
  <section class="section">
    <div class="container">
      ${sectionAdminNotice}
      ${visibleItems.length > 0 ? `
      <div class="filter-bar">
        <input type="text" class="filter-input" id="listing-search" placeholder="${t('filter_search_placeholder')}" oninput="filterAndSortListings('${type}', true)">
        <select class="filter-select" id="status-select" onchange="filterAndSortListings('${type}', true)">
          <option value="all">${t('filter_status_all')}</option>
          <option value="available">${t('filter_status_avail')}</option>
          <option value="soldout">${t('filter_status_sold')}</option>
        </select>
        <select class="filter-select" id="sort-select" onchange="filterAndSortListings('${type}', true)">
          <option value="newest">${t('filter_sort_newest')}</option>
          <option value="price-asc">${t('filter_sort_asc')}</option>
          <option value="price-desc">${t('filter_sort_desc')}</option>
        </select>
        ${viewToggleBtn}
        <span class="listing-count"><span id="listing-count-text">${visibleItems.length}</span> ${t('filter_found_suffix')}</span>
        ${adminAddBtn}
      </div>` : `${isAdmin ? `<div class="filter-bar">${adminAddBtn}</div>` : ''}`}
      
      <div id="listings-container">
         <div style="text-align:center; padding: 40px; color: var(--mid-grey);">Loading items...</div>
      </div>
      <div id="pagination-container" style="display:flex; justify-content:center; align-items:center; gap:20px; margin-top:32px; padding-bottom: 24px;"></div>
    </div>
  </section>`;

  await filterAndSortListings(type, true);
}

async function filterAndSortListings(type, resetPage = false) {
  if (resetPage) window._listingPage = 1;
  if (!window._listingPage) window._listingPage = 1;

  const sortSelect = document.getElementById('sort-select');
  const statusSelect = document.getElementById('status-select');
  const searchInput = document.getElementById('listing-search');

  const sortVal = sortSelect ? sortSelect.value : 'newest';
  const statusVal = statusSelect ? statusSelect.value : 'all';
  const searchVal = searchInput ? searchInput.value.toLowerCase() : '';

  let items = await DB[type].get();
  const isAdmin = Admin.isLoggedIn();
  if (!isAdmin) {
    items = items.filter(item => item.isVisible !== false);
  }
  const priceVal = p => parseFloat((p || '').replace(/[^0-9.]/g, '')) || 0;

  if (window.I18n && I18n.currentLanguage !== 'en') {
    for (let item of items) {
      if (item.title) item.title = await I18n.translateDynamic(item.title);
      if (item.description) item.description = await I18n.translateDynamic(item.description);
      if (item.location) item.location = await I18n.translateDynamic(item.location);
    }
  }

  // Filter out by Status
  if (statusVal === 'available') {
    items = items.filter(i => (i.status || 'Available') === 'Available');
  } else if (statusVal === 'soldout') {
    items = items.filter(i => i.status === 'Sold Out');
  }

  // Filter out by Search string
  if (searchVal.trim() !== '') {
    items = items.filter(i => {
      const matchText = `${i.title || ''} ${i.description || ''} ${i.location || ''}`.toLowerCase();
      return matchText.includes(searchVal);
    });
  }

  // Sort by price
  if (sortVal === 'price-asc') items.sort((a, b) => priceVal(a.price) - priceVal(b.price));
  if (sortVal === 'price-desc') items.sort((a, b) => priceVal(b.price) - priceVal(a.price));

  // Update total matches count
  const countEl = document.getElementById('listing-count-text');
  if (countEl) countEl.innerText = items.length;

  const container = document.getElementById('listings-container');
  const paginationContainer = document.getElementById('pagination-container');

  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>${t('empty_state')}</h3></div>`;
    if (paginationContainer) paginationContainer.innerHTML = '';
  } else {
    // ---- Pagination Logic ----
    const itemsPerPage = 15;
    const totalPages = Math.ceil(items.length / itemsPerPage);

    if (window._listingPage > totalPages) window._listingPage = totalPages;
    if (window._listingPage < 1) window._listingPage = 1;

    const startIndex = (window._listingPage - 1) * itemsPerPage;
    const paginatedItems = items.slice(startIndex, startIndex + itemsPerPage);

    try {
      if (window._viewMode === 'table') {
        container.innerHTML = renderPropertyTable(paginatedItems, type);
      } else {
        container.innerHTML = `<div class="properties-grid">${paginatedItems.map(i => renderPropertyCard(i, type)).filter(Boolean).join('')}</div>`;
      }
    } catch (e) {
      console.error('DEBUG: ERROR during DOM update!', e);
    }

    // ---- Render Pagination Controls ----
    if (paginationContainer) {
      if (totalPages > 1) {
        let html = '';
        if (window._listingPage > 1) {
          html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeListingPage('${type}', -1)">← Previous</button>`;
        } else {
          html += `<button class="btn btn-ghost" style="padding: 8px 16px; visibility:hidden;">← Previous</button>`;
        }

        html += `<span style="font-weight:600; color:var(--navy); font-size:1.05rem;">Page ${window._listingPage} of ${totalPages}</span>`;

        if (window._listingPage < totalPages) {
          html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeListingPage('${type}', 1)">Next →</button>`;
        } else {
          html += `<button class="btn btn-ghost" style="padding: 8px 16px; visibility:hidden;">Next →</button>`;
        }
        paginationContainer.innerHTML = html;
      } else {
        paginationContainer.innerHTML = '';
      }
    }
  }
  
  if (window.observeNewElements) window.observeNewElements();
}

function changeListingPage(type, direction) {
  window._listingPage += direction;
  // Scroll to top of listings container 
  const container = document.getElementById('listings-container');
  if (container) {
    const y = container.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  filterAndSortListings(type, false);
}

async function renderReviews() {
  const content = document.getElementById('page-content');
  // Initial loading state
  content.innerHTML = `
  <div class="hero">
    <div class="container" style="position:relative;z-index:1">
      <p class="hero-eyebrow">Client Reviews</p>
      <h1>What My <em>Clients Say</em></h1>
      <p>Real experiences from real people who trusted me with their property journey.</p>
    </div>
  </div>
  <section class="section"><div class="container" style="text-align:center;padding:50px">Loading reviews...</div></section>
  `;

  const reviews = await DB.reviews.get();
  window._reviewsList = reviews; // Cache for editing
  const currentUser = Auth.currentUser();
  const isAdmin = Admin.isLoggedIn();

  if (window.I18n && I18n.currentLanguage !== 'en') {
    for (let r of reviews) {
      if (r.message) r.message = await I18n.translateDynamic(r.message);
      if (r.name) r.name = await I18n.translateDynamic(r.name);
    }
  }

  const cardHtml = r => {
    const isOwner = currentUser && r.uid === currentUser.uid;
    const canDelete = isOwner || isAdmin;
    const canEdit = isOwner; // Only owner can edit content

    return `
    <div class="review-card" data-id="${r.id}">
      <div class="review-quote">"</div>
      <div class="star-rating">${renderStars(r.rating)}</div>
      ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="Review Photo" style="width:100%;height:180px;object-fit:cover;border-radius:var(--radius-md);margin-top:12px;margin-bottom:12px;box-shadow:var(--shadow-sm)">` : ''}
      <p class="review-text">${esc(r.message)}</p>
      <div class="reviewer-info">
        <div class="reviewer-avatar">${(r.name || 'U').charAt(0).toUpperCase()}</div>
        <div>
          <div class="reviewer-name">${esc(r.name)}</div>
          <div class="reviewer-date">${r.date || ''}</div>
        </div>
      </div>
      <div class="review-actions">
        ${canEdit ? `<button class="btn-icon btn-edit" title="Edit review" onclick="editReview('${r.id}')">✏️</button>` : ''}
        ${canDelete ? `<button class="btn-icon btn-del review-del-btn" title="Delete review" onclick="deleteReview('${r.id}')">🗑️</button>` : ''}
      </div>
    </div>`;
  };

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '—';

  document.getElementById('page-content').innerHTML = `
  <div class="hero">
    <div class="container" style="position:relative;z-index:1">
      <p class="hero-eyebrow">Client Reviews</p>
      <h1>What My <em>Clients Say</em></h1>
      <p>Real experiences from real people who trusted me with their property journey.</p>
      <div style="margin-top:8px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
        <span class="badge badge-gold">⭐ ${avgRating} Average Rating</span>
        <span class="badge badge-navy">${reviews.length} Reviews</span>
      </div>
    </div>
  </div>
  <section class="section">
    <div class="container">
      ${reviews.length > 0
      ? `<div class="reviews-grid">${reviews.map(cardHtml).join('')}</div>`
      : `<div class="empty-state"><div class="empty-icon">💬</div><h3>No reviews yet</h3><p>Be the first to share your experience!</p></div>`}

      <!-- Submit Review Form -->
      <div id="review-form-container" style="max-width:600px;margin:0 auto;background:var(--white);border-radius:var(--radius-lg);padding:40px;box-shadow:var(--shadow-md);border:1px solid var(--light-grey)">
        <h3 class="text-navy mb-8" id="rv-form-title" style="font-size:1.5rem">Share Your Experience</h3>
        <p class="mb-24" id="rv-form-desc" style="color:var(--mid-grey);font-size:0.9rem">We'd love to hear about your property journey!</p>
        <div class="form-group">
          <label class="form-label">Your Name *</label>
          <input class="form-control" id="rv-name" placeholder="e.g. Priya Sharma">
        </div>
        <div class="form-group">
          <label class="form-label">Rating *</label>
          <div class="star-input" id="star-input">
            ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rv-rating" id="star-${n}" value="${n}"><label for="star-${n}" title="${n} stars">★</label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Your Review *</label>
          <textarea class="form-control" id="rv-message" placeholder="Tell us about your experience..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Attach a Photo <span style="color:var(--mid-grey);font-weight:400">(optional)</span></label>
          <div style="display:flex;align-items:center;gap:16px;margin-top:8px">
            <label class="btn btn-outline" for="rv-image" style="cursor:pointer;">
              📷 Browse Image
              <input type="file" id="rv-image" accept="image/*" style="display:none" onchange="previewReviewImage(event)">
            </label>
            <img id="rv-image-preview" style="display:none;width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--light-grey)">
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="btn btn-primary" style="flex:1" onclick="submitReview()" id="rv-submit-btn">🌟 Submit Review</button>
          <button class="btn btn-ghost" id="rv-cancel-btn" style="display:none" onclick="cancelReviewEdit()">Cancel</button>
        </div>
      </div>
    </div>
  </section>`;
}

let _editingReviewId = null;

function editReview(id) {
  const review = window._reviewsList.find(r => r.id === id);
  if (!review) return;

  _editingReviewId = id;

  // Fill form
  const nameInput = document.getElementById('rv-name');
  const msgInput = document.getElementById('rv-message');
  const titleEl = document.getElementById('rv-form-title');
  const descEl = document.getElementById('rv-form-desc');
  const submitBtn = document.getElementById('rv-submit-btn');
  const cancelBtn = document.getElementById('rv-cancel-btn');
  const previewImg = document.getElementById('rv-image-preview');

  if (nameInput) nameInput.value = review.name;
  if (msgInput) msgInput.value = review.message;
  if (titleEl) titleEl.innerText = 'Edit Your Review';
  if (descEl) descEl.innerText = 'Update your feedback and rating below.';
  if (submitBtn) submitBtn.innerText = '✨ Update Review';
  if (cancelBtn) cancelBtn.style.display = 'block';

  // Set rating
  const radio = document.querySelector(`input[name="rv-rating"][value="${review.rating}"]`);
  if (radio) radio.checked = true;

  // Set image
  if (review.photoUrl) {
    pendingReviewImage = review.photoUrl;
    if (previewImg) {
      previewImg.src = review.photoUrl;
      previewImg.style.display = 'block';
    }
  } else {
    pendingReviewImage = '';
    if (previewImg) previewImg.style.display = 'none';
  }

  // Scroll to form
  const form = document.getElementById('review-form-container');
  if (form) form.scrollIntoView({ behavior: 'smooth' });
}

function cancelReviewEdit() {
  _editingReviewId = null;
  const nameInput = document.getElementById('rv-name');
  const msgInput = document.getElementById('rv-message');
  const titleEl = document.getElementById('rv-form-title');
  const descEl = document.getElementById('rv-form-desc');
  const submitBtn = document.getElementById('rv-submit-btn');
  const cancelBtn = document.getElementById('rv-cancel-btn');
  const previewImg = document.getElementById('rv-image-preview');

  if (nameInput) nameInput.value = '';
  if (msgInput) msgInput.value = '';
  if (titleEl) titleEl.innerText = 'Share Your Experience';
  if (descEl) descEl.innerText = "We'd love to hear about your property journey!";
  if (submitBtn) submitBtn.innerText = '🌟 Submit Review';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (previewImg) previewImg.style.display = 'none';
  pendingReviewImage = '';
  
  // Reset stars
  document.querySelectorAll('input[name="rv-rating"]').forEach(r => r.checked = false);
}

// ---- Review Image Preview Helper ----
let pendingReviewImage = '';
function previewReviewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Image too large — please keep it under 2 MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    pendingReviewImage = e.target.result;
    const preview = document.getElementById('rv-image-preview');
    if (preview) {
      preview.src = pendingReviewImage;
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

async function submitReview() {
  const user = Auth.currentUser();
  if (!user) {
    Auth.openSignInModal();
    showToast('Please sign in to share a review.', 'error');
    return;
  }

  const name = document.getElementById('rv-name')?.value?.trim() || '';
  const rating = parseInt(document.querySelector('input[name="rv-rating"]:checked')?.value || '0');
  const message = document.getElementById('rv-message')?.value?.trim() || '';

  if (!name) { showToast('Please enter your name.', 'error'); return; }
  if (!rating) { showToast('Please select a star rating.', 'error'); return; }
  if (!message) { showToast('Please write your review.', 'error'); return; }

  const btn = document.getElementById('rv-submit-btn');
  if (btn) btn.disabled = true;

  try {
    const reviewData = {
      name,
      rating,
      message,
      photoUrl: pendingReviewImage,
      updatedAt: new Date().toISOString()
    };

    if (_editingReviewId) {
      await DB.reviews.update(_editingReviewId, reviewData);
      showToast('✨ Review updated successfully!', 'success');
      _editingReviewId = null;
    } else {
      reviewData.uid = user.uid;
      reviewData.userEmail = user.email;
      reviewData.date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      reviewData.createdAt = new Date().toISOString();
      await DB.reviews.add(reviewData);
      showToast('🌟 Thank you for your review!', 'success');
    }

    pendingReviewImage = ''; // Clear after successful submission
    renderReviews();
    syncAdminUI();
  } catch (e) {
    console.error('Review submission error:', e);
    showToast('Failed to save review. Try again.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function deleteReview(id) {
  _pendingDelete = { kind: 'review', id };
  const btn = document.getElementById('delete-confirm-btn');
  if (btn) btn.onclick = confirmDelete;
  openModal('delete-confirm-modal');
}

async function renderSubscribe() {
  const isAdmin = Admin.isLoggedIn();

  let contentHtml = '';

  if (isAdmin) {
    // ---- ADMIN VIEW: List Subscribers ----
    contentHtml = `
      <div style="max-width:800px;margin:0 auto;background:var(--white);border-radius:var(--radius-lg);padding:40px;box-shadow:var(--shadow-md);border:1px solid var(--light-grey)">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:12px;">
          <h3 style="color:var(--navy);font-size:1.5rem; margin:0;">Registered Users</h3>
          <button id="ru-export-btn" class="btn btn-primary" onclick="exportRegisteredUsersCSV()" style="display:flex; align-items:center; gap:8px; padding:8px 20px; font-size:0.95rem;">
            📥 Export to Excel
          </button>
        </div>
        <p id="ru-count-display" style="color:var(--navy);font-size:1.1rem;font-weight:700;margin-bottom:24px">Loading users...</p>
        <div class="property-table-wrap" style="box-shadow:var(--shadow-sm); border-radius:var(--radius-md); overflow:hidden; border:1px solid var(--light-grey)">
          <table class="property-table" style="width:100%; margin:0">
            <thead>
              <tr>
                <th style="width:60px; padding:12px; text-align:left; background:var(--off-white); border-bottom:2px solid var(--light-grey); color:var(--navy);">#</th>
                <th style="padding:12px; text-align:left; background:var(--off-white); border-bottom:2px solid var(--light-grey); color:var(--navy);">Name</th>
                <th style="padding:12px; text-align:left; background:var(--off-white); border-bottom:2px solid var(--light-grey); color:var(--navy);">Email</th>
                <th style="padding:12px; text-align:left; background:var(--off-white); border-bottom:2px solid var(--light-grey); color:var(--navy);">Last Sign In</th>
              </tr>
            </thead>
            <tbody id="ru-list-container">
            </tbody>
          </table>
        </div>
        <div id="ru-pagination-container" style="display:flex; justify-content:center; align-items:center; gap:20px; margin-top:32px; padding-bottom: 8px;"></div>
      </div>
    `;

    document.getElementById('page-content').innerHTML = `
      <div class="hero">
        <div class="container" style="position:relative;z-index:1">
          <p class="hero-eyebrow">Admin Area</p>
          <h1>Manage <em>Registered Users</em></h1>
        </div>
      </div>
      <section class="section">
        <div class="container">${contentHtml}</div>
      </section>
    `;

    renderRegisteredUsersPage(true);

  } else {
    // ---- VISITOR VIEW: Subscribe Form ----
    let subCountText = "";
    try {
      const subscribers = await DB.subscribers.get();
      if (subscribers && subscribers.length > 0) {
        subCountText = `<div style="text-align:center; padding-bottom:16px; margin-bottom: 24px; border-bottom: 1px solid var(--light-grey);">
           <p style="color:var(--navy); font-size:1.1rem; font-weight:700; margin:0;">Total <span style="color:var(--gold);">${subscribers.length}</span> Subscribers!</p>
        </div>`;
      }
    } catch (e) {
      console.error("Failed to fetch subscriber count", e);
    }

    contentHtml = `
      <div style="max-width:600px;margin:0 auto;background:var(--white);border-radius:var(--radius-lg);padding:40px;box-shadow:var(--shadow-md);border:1px solid var(--light-grey)">
        <h3 style="color:var(--navy);margin-bottom:8px;font-size:1.5rem;text-align:center;" data-i18n="subscribe_title">Subscribe via SMS</h3>
        <p style="color:var(--mid-grey);font-size:0.9rem;margin-bottom:24px;text-align:center;" id="sub-desc" data-i18n="subscribe_desc">Be the first to know about our latest exclusive listings.</p>
        
        ${subCountText}

        <div id="sub-step-1">
          <div class="form-group">
            <input class="form-control" id="sub-name" data-i18n="subscribe_name_placeholder" placeholder="Your Name">
          </div>
          <div class="form-group">
            <input class="form-control" id="sub-phone" type="tel" data-i18n="subscribe_phone_placeholder" placeholder="Mobile Number">
          </div>
          <button class="btn btn-primary btn-lg" style="width:100%" onclick="submitSubscribeForm()" id="sub-submit-btn">Get OTP via SMS</button>
        </div>

        <div id="sub-step-2" style="display:none; text-align:center;">
          <p style="font-size:0.95rem;color:var(--navy);margin-bottom:16px;">We've sent a 6-digit OTP to your mobile number.</p>
          <div class="form-group">
            <input class="form-control" id="sub-otp" type="text" maxlength="6" style="text-align:center; font-size:1.2rem; letter-spacing:4px;" placeholder="• • • • • •">
          </div>
          <button class="btn btn-primary btn-lg" style="width:100%" onclick="verifyOTPAndSave()" id="sub-verify-btn">Verify & Subscribe</button>
          <button class="btn btn-ghost" style="margin-top:16px;font-size:0.85rem;" onclick="resetSubscribeForm()">Back to edit details</button>
        </div>
      </div>
    `;

    document.getElementById('page-content').innerHTML = `
      <section class="section">
        <div class="container">${contentHtml}</div>
      </section>
    `;
  }

  // Trigger DOM translations
  if (window.I18n) window.I18n.translateDOM();
}

async function renderSubscribersPage(resetPage = false) {
  if (resetPage) window._subscribersPage = 1;
  if (!window._subscribersPage) window._subscribersPage = 1;

  try {
    let subscribers = await DB.subscribers.get();
    subscribers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const countDisplay = document.getElementById('sub-count-display');
    if (countDisplay) countDisplay.innerHTML = `Total Subscribers: <span style="color:var(--gold)">${subscribers.length}</span>`;

    const listContainer = document.getElementById('sub-list-container');
    const paginationContainer = document.getElementById('sub-pagination-container');

    if (!listContainer) return;

    if (subscribers.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center;color:var(--mid-grey);padding:20px;">No subscribers found.</p>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    const itemsPerPage = 50;
    const totalPages = Math.ceil(subscribers.length / itemsPerPage);
    if (window._subscribersPage > totalPages) window._subscribersPage = totalPages;
    if (window._subscribersPage < 1) window._subscribersPage = 1;

    const startIndex = (window._subscribersPage - 1) * itemsPerPage;
    const paginatedItems = subscribers.slice(startIndex, startIndex + itemsPerPage);

    listContainer.innerHTML = paginatedItems.map(sub => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--off-white);border-radius:var(--radius-md);border:1px solid var(--light-grey);margin-bottom:12px;">
        <div>
          <div style="font-weight:600;color:var(--navy);margin-bottom:4px;font-size:1.05rem;">${esc(sub.name || 'Unknown')}</div>
          <div style="font-size:0.9rem;color:var(--mid-grey);display:flex;gap:12px">
            <span>📱 ${esc(sub.phone || 'N/A')}</span>
          </div>
        </div>
        <div style="font-size:0.85rem;color:var(--mid-grey)">
          Subscribed: ${esc(sub.date || 'Unknown')}
        </div>
      </div>
    `).join('');

    if (paginationContainer) {
      if (totalPages > 1) {
        let html = '';
        if (window._subscribersPage > 1) {
          html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeSubscribersPage(-1)">← Previous</button>`;
        } else {
          html += `<button class="btn btn-ghost" style="padding: 8px 16px; visibility:hidden;">← Previous</button>`;
        }

        html += `<span style="font-weight:600; color:var(--navy); font-size:1.05rem;">Page ${window._subscribersPage} of ${totalPages}</span>`;

        if (window._subscribersPage < totalPages) {
          html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeSubscribersPage(1)">Next →</button>`;
        } else {
          html += `<button class="btn btn-ghost" style="padding: 8px 16px; visibility:hidden;">Next →</button>`;
        }
        paginationContainer.innerHTML = html;
      } else {
        paginationContainer.innerHTML = '';
      }
    }
  } catch (e) {
    const errorEl = document.getElementById('sub-count-display');
    if (errorEl) errorEl.textContent = 'Error loading subscribers.';
  }
}

function changeSubscribersPage(direction) {
  window._subscribersPage += direction;
  const container = document.getElementById('sub-list-container');
  if (container) {
    const y = container.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  renderSubscribersPage(false);
}

async function renderRegisteredUsersPage(resetPage = false) {
  if (resetPage) window._ruPage = 1;
  if (!window._ruPage) window._ruPage = 1;

  try {
    const usersSnap = await db.collection('users').orderBy('lastSignIn', 'desc').get();
    const totalUsers = usersSnap.size;
    const allUsers = usersSnap.docs.map(doc => doc.data());
    
    const countDisplay = document.getElementById('ru-count-display');
    if (countDisplay) countDisplay.innerHTML = `Total Registered Users: <span style="color:var(--gold)">${totalUsers}</span>`;
    
    const listContainer = document.getElementById('ru-list-container');
    const paginationContainer = document.getElementById('ru-pagination-container');
    if (!listContainer) return;

    const itemsPerPage = 100;
    const totalPages = Math.ceil(totalUsers / itemsPerPage) || 1;
    if (window._ruPage > totalPages) window._ruPage = totalPages;
    if (window._ruPage < 1) window._ruPage = 1;

    const startIndex = (window._ruPage - 1) * itemsPerPage;
    const paginatedItems = allUsers.slice(startIndex, startIndex + itemsPerPage);

    if (paginatedItems.length === 0) {
      listContainer.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--mid-grey)">No registered users found.</td></tr>';
    } else {
      listContainer.innerHTML = paginatedItems.map((u, i) => {
        const email = u.email || 'N/A';
        const name = u.displayName || 'N/A';
        const lastSignIn = u.lastSignIn ? new Date(u.lastSignIn).toLocaleString() : 'N/A';
        return `
          <tr style="border-bottom:1px solid var(--light-grey);">
            <td style="color:var(--mid-grey); padding:12px;">${startIndex + i + 1}</td>
            <td style="font-weight:600;color:var(--navy); padding:12px;">${esc(name)}</td>
            <td style="padding:12px;">${esc(email)}</td>
            <td style="color:var(--mid-grey);font-size:0.9rem; padding:12px;">${esc(lastSignIn)}</td>
          </tr>
        `;
      }).join('');
    }

    if (paginationContainer) {
      let html = '';
      if (window._ruPage > 1) {
        html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeRUPage(-1)">← Previous</button>`;
      } else {
        html += `<button class="btn btn-secondary" style="padding: 8px 16px; opacity:0.5; cursor:not-allowed;" disabled>← Previous</button>`;
      }

      html += `<span style="font-weight:600; color:var(--navy); font-size:1.05rem;">Page ${window._ruPage} of ${totalPages}</span>`;

      if (window._ruPage < totalPages) {
        html += `<button class="btn btn-secondary" style="padding: 8px 16px;" onclick="changeRUPage(1)">Next →</button>`;
      } else {
        html += `<button class="btn btn-secondary" style="padding: 8px 16px; opacity:0.5; cursor:not-allowed;" disabled>Next →</button>`;
      }
      paginationContainer.innerHTML = html;
    }

  } catch (e) {
    console.error(e);
    const errorEl = document.getElementById('ru-count-display');
    if (errorEl) errorEl.textContent = 'Error loading users.';
  }
}

function changeRUPage(direction) {
  window._ruPage += direction;
  const container = document.getElementById('ru-list-container');
  if (container) {
    const y = container.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  renderRegisteredUsersPage(false);
}

async function exportRegisteredUsersCSV() {
  if (!Admin.isLoggedIn()) { showToast('Unauthorized', 'error'); return; }

  const btn = document.getElementById('ru-export-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Exporting...'; }

  try {
    const usersSnap = await db.collection('users').orderBy('lastSignIn', 'desc').get();
    const allUsers = usersSnap.docs.map(doc => doc.data());

    if (allUsers.length === 0) {
      showToast('No registered users to export.', 'error');
      return;
    }

    // Build CSV rows
    const headers = ['#', 'Name', 'Email', 'Last Sign In'];
    const rows = allUsers.map((u, i) => [
      i + 1,
      u.displayName || 'N/A',
      u.email || 'N/A',
      u.lastSignIn ? new Date(u.lastSignIn).toLocaleString() : 'N/A'
    ]);

    const csvEscape = val => {
      const str = String(val);
      // Wrap in quotes if it contains comma, quote or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const csvContent = [
      headers.map(csvEscape).join(','),
      ...rows.map(row => row.map(csvEscape).join(','))
    ].join('\r\n');

    // Add BOM for Excel to correctly detect UTF-8
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `registered_users_${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✅ Exported ${allUsers.length} users successfully!`, 'success');
  } catch (e) {
    console.error('Export failed:', e);
    showToast('Failed to export users. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📥 Export to Excel'; }
  }
}

let pendingSubscriber = null;
let currentOTP = null;

// --- SMS API Configurations ---
// IMPORTANT: Replace this with your actual SMS provider API key (e.g., Fast2SMS)
const SMS_API_KEY = 'G2Odr3luxCqjJ7cUnwbBv5gfVyLFzQM91Hie0oskIWaDYNXh6mUnloSROW5kGiPA19hyJQKpETmMgDBZ';

async function submitSubscribeForm() {
  const name = document.getElementById('sub-name')?.value.trim();
  let phone = document.getElementById('sub-phone')?.value.trim();

  if (!name) { showToast('Please enter your full name.', 'error'); return; }
  if (!phone) { showToast('Please enter your mobile number.', 'error'); return; }

  // Clean the phone number (remove spaces, dashes)
  phone = phone.replace(/[^0-9+]/g, '');
  // Default to India (+91) if no country code is provided
  if (!phone.startsWith('+')) {
    if (phone.length === 10) phone = '+91' + phone;
    else if (!phone.startsWith('91') && phone.length > 10) phone = '+' + phone;
    else if (phone.startsWith('91')) phone = '+' + phone;
  }

  // APIs often require the number without the '+' sign
  const smsRecipientPhone = phone.replace('+', '');

  const btn = document.getElementById('sub-submit-btn');
  if (btn) btn.disabled = true;

  try {
    // Generate a 6-digit OTP
    currentOTP = Math.floor(100000 + Math.random() * 900000).toString();
    pendingSubscriber = { name, phone, date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) };

    // --- REAL SMS DELIVERY via local proxy server (server.js on port 3001) ---
    showToast('Sending OTP to your mobile...', 'info');

    const proxyUrl = `http://localhost:3001/send-otp?phone=${encodeURIComponent(smsRecipientPhone)}&otp=${currentOTP}`;
    let smsResult;
    try {
      const smsResponse = await fetch(proxyUrl);
      smsResult = await smsResponse.json();
    } catch (networkErr) {
      console.error('[SMS Proxy] Could not reach local proxy server:', networkErr);
      throw new Error('SMS proxy server is not running. Please start it with: node server.js');
    }

    if (!smsResult.success) {
      console.error('[SMS Proxy] Error from Fast2SMS:', smsResult.error);
      throw new Error(smsResult.error || 'Failed to send SMS.');
    }

    showToast('✅ OTP sent to your mobile via SMS!', 'success');

    // Switch UI to OTP step
    document.getElementById('sub-step-1').style.display = 'none';
    document.getElementById('sub-desc').style.display = 'none';
    document.getElementById('sub-step-2').style.display = 'block';
    document.getElementById('sub-otp').focus();

  } catch (e) {
    showToast('Failed to send OTP. Please try again.', 'error');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function resetSubscribeForm() {
  pendingSubscriber = null;
  currentOTP = null;
  document.getElementById('sub-step-2').style.display = 'none';
  document.getElementById('sub-otp').value = '';
  document.getElementById('sub-step-1').style.display = 'block';
  document.getElementById('sub-desc').style.display = 'block';
}

async function verifyOTPAndSave() {
  const enteredOTP = document.getElementById('sub-otp')?.value.trim();
  const btn = document.getElementById('sub-verify-btn');

  if (!enteredOTP || enteredOTP.length !== 6) {
    showToast('Please enter a valid 6-digit OTP.', 'error');
    return;
  }

  if (enteredOTP !== currentOTP) {
    showToast('Invalid OTP. Please check the code and try again.', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    // Save to Firebase database
    await DB.subscribers.add(pendingSubscriber);

    showToast('✅ Successfully subscribed to updates!', 'success');

    // Clear form and reset to step 1
    ['sub-name', 'sub-phone', 'sub-otp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    resetSubscribeForm();

  } catch (e) {
    showToast('Failed to subscribe. Please try again.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function renderContact() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div></div>';

  let contacts = [];
  try {
    contacts = await DB.contact.get();
  } catch (e) {
    console.error(e);
  }

  const defaultContact = {
    phone: '+91 98765 43210',
    email: 'alex.rajan@realtors.in',
    address: '102, Brigade Road, 2nd Floor,\\nBangalore - 560 001, Karnataka',
    hours: 'Mon–Sat: 9 AM – 7 PM\\nSunday: 10 AM – 4 PM'
  };

  const info = contacts.length > 0 ? contacts[0] : defaultContact;
  const adminBtnHtml = Admin.isLoggedIn()
    ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px; border-color:var(--light-grey)" onclick="openEditContactModal('${info.id || ''}')">✏️ Edit Contact Info</button>`
    : '';

  content.innerHTML = `
  <div class="hero">
    <div class="container" style="position:relative;z-index:1">
      <p class="hero-eyebrow">Contact Us</p>
      <h1>Let's <em>Talk Property</em></h1>
      <p>Have a question about a listing? Looking for your next investment? Reach out — I'm here to help.</p>
    </div>
  </div>
  <section class="section">
    <div class="container">
      <div class="contact-grid">

        <!-- Info card -->
        <div class="contact-info-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start">
            <h3>Get In Touch</h3>
            ${adminBtnHtml}
          </div>
          <p>Whether you're buying, selling, or just exploring — feel free to drop by the office or reach me via any of the channels below.</p>
          <div class="contact-detail">
            <div class="contact-detail-icon">📞</div>
            <div>
              <div class="contact-detail-label">Phone / WhatsApp</div>
              <div class="contact-detail-value" style="display:flex; align-items:center; gap:8px;">
                <span id="c-disp-phone">${esc(info.phone || '')}</span>
                <a href="https://wa.me/${(info.phone || '').replace(/[^0-9]/g, '')}" target="_blank" rel="noopener" title="Chat on WhatsApp" style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:#25D366; color:white; border-radius:50%; text-decoration:none; font-size:14px; box-shadow:0 2px 5px rgba(37,211,102,0.3); transition:transform 0.2s ease;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div class="contact-detail">
            <div class="contact-detail-icon">📧</div>
            <div>
              <div class="contact-detail-label">Email</div>
              <div class="contact-detail-value" id="c-disp-email">${esc(info.email || '')}</div>
            </div>
          </div>
          <div class="contact-detail">
            <div class="contact-detail-icon">📍</div>
            <div>
              <div class="contact-detail-label">Office Address</div>
              <div class="contact-detail-value" id="c-disp-address">${esc(info.address || '').replace(/\\n/g, '<br>')}</div>
            </div>
          </div>
          <div class="contact-detail">
            <div class="contact-detail-icon">🕐</div>
            <div>
              <div class="contact-detail-label">Working Hours</div>
              <div class="contact-detail-value" id="c-disp-hours">${esc(info.hours || '').replace(/\\n/g, '<br>')}</div>
            </div>
          </div>
        </div>

        <!-- Form card -->
        <div class="contact-form-card">
          <h3>Send a Message</h3>
          <p>Fill in the form and I'll get back to you within 24 hours.</p>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name *</label>
              <input class="form-control" id="cf-name" placeholder="Your name">
            </div>
            <div class="form-group">
              <label class="form-label">Phone Number *</label>
              <input class="form-control" id="cf-phone" placeholder="+91 ..." type="tel">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input class="form-control" id="cf-email" placeholder="you@email.com" type="email">
          </div>
          <div class="form-group">
            <label class="form-label">I'm interested in</label>
            <select class="form-control" id="cf-interest">
              <option value="">Select property type...</option>
              <option>Open Plots</option>
              <option>Flats / Apartments</option>
              <option>Villas</option>
              <option>General Inquiry</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Message *</label>
            <textarea class="form-control" id="cf-message" placeholder="Tell me more about what you're looking for..."></textarea>
          </div>
          <!-- Anti-bot honeypot: hidden from real users, filled only by bots -->
          <input type="text" id="cf-website" name="website" autocomplete="new-password" style="position:absolute;left:-9999px;visibility:hidden;" tabindex="-1">
          <button class="btn btn-primary btn-lg" onclick="submitContactForm(this)">📨 Send Message</button>
        </div>
      </div>

      <!-- Map placeholder -->
      <div class="map-section">
        <h3 class="text-navy mb-24" style="font-family:'Playfair Display',serif;font-size:1.5rem">📍 Find Us</h3>
        <div class="map-container">
          <iframe
            src="https://www.google.com/maps?q=NextGen+Future+Works+Pvt+Ltd&output=embed"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            style="border:0; width:100%; height:100%; pointer-events:auto;">
          </iframe>
        </div>
        <div class="text-center mt-16">
          <a href="https://share.google/Ccta8QgYZJ7mbEP5f" target="_blank" rel="noopener" class="btn btn-secondary">
            📍 Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  </section>`;
}

async function submitContactForm(btn) {
  // Honeypot check: bots fill this hidden field, humans don't see it
  const honeypot = document.getElementById('cf-website')?.value;
  if (honeypot) {
    // Silently do nothing — this is a bot
    console.log('[Security] Bot submission detected and blocked.');
    return;
  }

  const name = document.getElementById('cf-name')?.value.trim();
  const phone = document.getElementById('cf-phone')?.value.trim();
  const email = document.getElementById('cf-email')?.value.trim();
  const interest = document.getElementById('cf-interest')?.value.trim();
  const message = document.getElementById('cf-message')?.value.trim();

  if (!name) { showToast('Please enter your name.', 'error'); return; }
  if (!phone) { showToast('Please enter your phone number.', 'error'); return; }
  if (!message) { showToast('Please write a message.', 'error'); return; }

  // Extract admin email dynamically from the UI
  const adminEmail = document.getElementById('c-disp-email')?.textContent.trim();
  if (!adminEmail) {
    showToast('Action failed: No admin email configured.', 'error');
    return;
  }

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="auth-spinner" style="border-width:2px; width:16px; height:16px; margin-right:8px; vertical-align:middle;"></span> Sending...`;

  try {
    const response = await fetch(`https://formsubmit.co/ajax/${adminEmail}`, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        _subject: `New Lead: ${interest ? interest : 'General Inquiry'} from ${name}`,
        Name: name,
        Phone: phone,
        Email: email || 'Not provided',
        Interest: interest || 'Not selected',
        Message: message
      })
    });

    if (response.ok) {
      showToast('✅ Message sent successfully! We\'ll contact you soon.', 'success');
      ['cf-name', 'cf-phone', 'cf-email', 'cf-interest', 'cf-message'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    } else {
      throw new Error("HTTP error " + response.status);
    }
  } catch (err) {
    console.error("FormSubmit Error:", err);
    showToast('❌ Failed to send message. Please try again or message via WhatsApp.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ---- Agent Photo Upload (About Me page, admin only) ----
async function handleAgentPhotoUpload(event, aboutId) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('Photo too large — please keep it under 5 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;

    // Instantly preview the photo on the page
    const img = document.getElementById('agent-photo-img');
    if (img) img.src = base64;

    showToast('Saving profile photo...', 'info');

    try {
      if (aboutId) {
        // Update existing about record
        await DB.about.update(aboutId, { photoUrl: base64 });
      } else {
        // Fallback or create new if it doesn't exist yet
        await DB.about.add({ photoUrl: base64 });
      }
      showToast('✅ Profile photo saved permanently!', 'success');
    } catch (err) {
      console.error('Error saving photo:', err);
      // Fallback to local storage if DB fails
      localStorage.setItem('re_agent_photo', base64);
      showToast('Error saving to DB. Saved locally instead.', 'error');
    }
  };
  reader.readAsDataURL(file);
}

// ---- Hamburger menu ----
function toggleMobileNav() {
  document.querySelector('.nav-links')?.classList.toggle('mobile-open');
}

// ---- Global Settings (Logo) ----
// ========= MINI POSTS — standalone global helpers =========
function _mpSafeText(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mpDrawUI() {
  const content = document.getElementById('page-content');
  if (!content) return;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const allPosts = (window._mpRawData || []).map(p => {
    if (p.createdAt && new Date(p.createdAt) < ninetyDaysAgo) {
      return { ...p, status: 'Expired' };
    }
    return p;
  });

  const MP_CATS = ['House for Sale', 'Land for Sale', 'Plot for Sale', 'To-let'];
  const isAdmin = (typeof Admin !== 'undefined' && Admin.isLoggedIn());

  if (!MP_CATS.includes(window._activeMinipostCat)) window._activeMinipostCat = MP_CATS[0];

  const filtered = allPosts.filter(function(p) { 
    if (p.category !== window._activeMinipostCat) return false;
    // Hide expired posts from public view
    if (p.status === 'Expired' && !isAdmin) return false;
    return true;
  });
  const uniqueAreas = [];
  const seenAreas = {};

  // First, add predefined areas from DB
  (window._mpAreas || []).forEach(function(a) {
    const trimmed = a.trim();
    if (trimmed && !seenAreas[trimmed]) {
      seenAreas[trimmed] = true;
      uniqueAreas.push(trimmed);
    }
  });

  // Then, add any additional areas found in posts
  filtered.forEach(function(p) {
    const a = (p.area || '').trim();
    if (a && !seenAreas[a]) { seenAreas[a] = true; uniqueAreas.push(a); }
  });

  window._mpAreaMap = uniqueAreas;

  const currentAreaTrimmed = (window._activeMinipostArea || '').trim();
  if (!currentAreaTrimmed || uniqueAreas.indexOf(currentAreaTrimmed) === -1) {
    window._activeMinipostArea = uniqueAreas.length > 0 ? uniqueAreas[0] : null;
    window._mpPage = 1;
  } else {
    window._activeMinipostArea = currentAreaTrimmed;
  }
  if (!window._mpPage) window._mpPage = 1;

  const activePosts = window._activeMinipostArea
    ? filtered.filter(function(p) { return (p.area || '').trim() === window._activeMinipostArea; })
    : [];

  const ITEMS_PER_PAGE = 60;
  const totalPages = Math.max(1, Math.ceil(activePosts.length / ITEMS_PER_PAGE));
  if (window._mpPage > totalPages) window._mpPage = totalPages;
  const start = (window._mpPage - 1) * ITEMS_PER_PAGE;
  const paginatedPosts = activePosts.slice(start, start + ITEMS_PER_PAGE);

  const catHtml = MP_CATS.map(function(c) {
    const active = window._activeMinipostCat === c;
    return '<button class="btn' + (active ? ' btn-primary' : '') + '"'
      + ' onclick="mpSelectCat(\'' + c + '\')"'
      + ' style="margin:4px;' + (active ? '' : 'background:white;color:var(--navy);border:1.5px solid var(--light-grey);') + '">'
      + c + '</button>';
  }).join('');

  var areaHtml;
  if (uniqueAreas.length === 0) {
    areaHtml = '<p style="color:var(--mid-grey);margin-top:20px;">No areas listed for this category yet.</p>';
  } else {
    areaHtml = uniqueAreas.map(function(a) {
      const active = window._activeMinipostArea === a;
      const encoded = encodeURIComponent(a);
      return '<button class="btn' + (active ? ' btn-primary' : '') + '"'
        + ' onclick="mpSelectAreaByName(decodeURIComponent(\'' + encoded + '\'))"'
        + ' style="margin:4px;border-radius:20px;padding:4px 16px;font-size:0.9rem;'
        + (active ? '' : 'background:var(--off-white);color:var(--navy);border:1.5px solid var(--light-grey);') + '">'
        + _mpSafeText(a) + '</button>';
    }).join('');
  }

  var pageHtml = '';
  if (totalPages > 1) {
    var btns = '';
    for (var pi = 1; pi <= totalPages; pi++) {
      const active = window._mpPage === pi;
      btns += '<button class="btn' + (active ? ' btn-primary' : '') + '"'
        + ' onclick="mpSelectPage(' + pi + ')"'
        + ' style="border-radius:50%;width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;'
        + (active ? '' : 'background:white;color:var(--navy);border:1.5px solid var(--light-grey);') + '">'
        + pi + '</button>';
    }
    pageHtml = '<div style="margin-top:40px;display:flex;justify-content:center;flex-wrap:wrap;gap:8px;">' + btns + '</div>';
  }

  var postsHtml = '';
  if (paginatedPosts.length === 0 && uniqueAreas.length > 0) {
    postsHtml = '<p style="color:var(--mid-grey);padding:40px 0;">No details found for this area.</p>';
  } else {
    postsHtml = paginatedPosts.map(function(p) {
      const dEN = _mpSafeText(p.detailsEn || '').replace(/\r?\n/g,'<br>');
      const dHI = _mpSafeText(p.detailsHi || '').replace(/\r?\n/g,'<br>');
      const dTE = _mpSafeText(p.detailsTe || '').replace(/\r?\n/g,'<br>');
      const baseLang = dEN || dHI || dTE;
      const langCount = (p.detailsEn ? 1 : 0) + (p.detailsHi ? 1 : 0) + (p.detailsTe ? 1 : 0);
      const isAdmin = (typeof Admin !== 'undefined' && Admin.isLoggedIn());

      var translateHtml = '';
      if (langCount > 1) {
        translateHtml = '<div style="display:flex;gap:6px;border-top:1px dashed #eee;padding-top:10px;margin-top:auto;align-items:center;">'
          + '<span style="font-size:0.75rem;color:var(--mid-grey);margin-right:auto;">Translate:</span>'
          + (p.detailsEn ? '<button class="btn btn-sm" style="padding:2px 8px;font-size:0.75rem;background:var(--off-white);color:var(--navy);border:1px solid var(--light-grey);" onclick="(function(){document.getElementById(\'mp-detail-' + p.id + '\').innerHTML=\'' + dEN.replace(/'/g,'\\&#39;') + '\';})()">EN</button>' : '')
          + (p.detailsHi ? '<button class="btn btn-sm" style="padding:2px 8px;font-size:0.75rem;background:var(--off-white);color:var(--navy);border:1px solid var(--light-grey);" onclick="(function(){document.getElementById(\'mp-detail-' + p.id + '\').innerHTML=\'' + dHI.replace(/'/g,'\\&#39;') + '\';})()">HI</button>' : '')
          + (p.detailsTe ? '<button class="btn btn-sm" style="padding:2px 8px;font-size:0.75rem;background:var(--off-white);color:var(--navy);border:1px solid var(--light-grey);" onclick="(function(){document.getElementById(\'mp-detail-' + p.id + '\').innerHTML=\'' + dTE.replace(/'/g,'\\&#39;') + '\';})()">TE</button>' : '')
          + '</div>';
      }

      var adminBtns = '';
      if (isAdmin) {
        adminBtns = '<button style="font-size:0.8rem;background:transparent;padding:0;border:none;cursor:pointer;" onclick="editProperty(\'miniposts\',\'' + p.id + '\')" title="Edit">✏️</button>'
          + '<button style="font-size:0.8rem;background:transparent;padding:0;border:none;cursor:pointer;" onclick="deleteProperty(\'miniposts\',\'' + p.id + '\')" title="Delete">🗑️</button>';
      }

      const cardTitle = p.title ? _mpSafeText(p.title) : _mpSafeText(p.area);
      const status = p.status || 'Available';
      const statusColor = status === 'Sold Out' ? '#E74C3C' : status === 'Expired' ? '#95A5A6' : '#27AE60';
      const statusBadge = '<span style="background:' + statusColor + ';color:white;font-size:0.65rem;padding:2px 8px;border-radius:4px;display:inline-block;vertical-align:middle;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">' + status + '</span>';

      return '<div class="fade-up" style="background:white;border-radius:12px;padding:20px;box-shadow:0 6px 20px rgba(0,0,0,0.04);display:flex;flex-direction:column;">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #eee;padding-bottom:8px;margin-bottom:12px;gap:8px;">'
        + '<strong style="color:var(--navy);font-size:1.05rem;flex:1;">' + cardTitle + '</strong>'
        + '<div style="display:flex;gap:4px;">' + adminBtns + '</div>'
        + '</div>'
        + '<div id="mp-detail-' + p.id + '" style="font-size:0.85rem;color:var(--dark-grey);line-height:1.6;flex:1;margin-bottom:12px;overflow-wrap:anywhere;">' + baseLang + '</div>'
        + translateHtml
        + '<div style="font-size:0.75rem;color:var(--mid-grey);display:flex;align-items:center;gap:8px;flex-wrap:nowrap;border-top:1px solid #f5f5f5;padding-top:12px;margin-top:12px;overflow:hidden;">'
        + statusBadge
        + (p.propId ? '<span style="background:var(--navy);color:white;padding:2px 6px;border-radius:4px;font-weight:700;white-space:nowrap;">ID: #' + p.propId + '</span>' : '')
        + (p.createdAt ? '<span style="white-space:nowrap;">📅 ' + new Date(p.createdAt).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) + '</span>' : '')
        + '</div>'
        + '</div>';
    }).join('');
  }

  // isAdmin already declared at top of function
  content.innerHTML = '<div class="hero"><div class="container" style="position:relative;z-index:1">'
    + '<p class="hero-eyebrow">PREMIUM SECURE ACCESS</p><h1>Mini Posts</h1></div></div>'
    + '<section class="section" style="background:var(--off-white);min-height:80vh;text-align:center;padding-top:30px;">'
    + '<div class="container" style="max-width:1200px;">'
    + (isAdmin ? '<div style="text-align:right;margin-bottom:20px;display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-ghost btn-sm" onclick="showMPAreaManager()" style="border-color:var(--light-grey);background:white;">🗺️ Manage Areas</button><button class="btn btn-primary btn-sm" onclick="showPropertyForm(\'miniposts\')">➕ Add Mini Post</button></div>' : '')
    + '<div style="background:#fff9e6; border:1px solid #ffe58f; border-radius:8px; padding:12px 16px; margin-bottom:12px; text-align:left; display:flex; gap:12px; align-items:center;">'
    + '<span style="font-size:1.4rem;">⚠️</span>'
    + '<p style="margin:0; font-size:0.85rem; color:#856404; line-height:1.5;">'
    + '<strong>Disclaimer:</strong> Mini posts displayed in NextGen Realtors™ are only for advertisement purpose. '
    + 'NextGen Realtors™ do not take any accountability on the legal issues of the properties details posted in Mini Posts.'
    + '</p></div>'
    + '<div style="background:var(--white);border:1px solid var(--light-grey);border-radius:12px;padding:20px;margin-bottom:20px;text-align:left;box-shadow:var(--shadow-sm);">'
    + '  <h3 class="text-navy" style="margin-bottom:12px;font-size:1.3rem;">List Your Property with Ease!</h3>'
    + '  <p style="margin-bottom:16px;color:var(--dark-grey);font-size:0.95rem;line-height:1.5;">Have a property to sell or rent? Share your details with us on WhatsApp, and we’ll help you promote it to the right audience.</p>'
    + '  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;margin-bottom:20px;font-weight:600;color:var(--navy);">'
    + '    <div>✔ Fast Listing</div>'
    + '    <div>✔ Verified Leads</div>'
    + '    <div>✔ Maximum Visibility</div>'
    + '  </div>'
  + '  <p style="margin-bottom:0; color:var(--dark-grey); font-size:1rem; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">'
  + '    Contact us on WhatsApp '
  + '    <a href="https://wa.me/917569844192" target="_blank" class="btn btn-primary" style="display:inline-flex; align-items:center; padding:6px 16px; font-size:0.95rem; border-radius:6px; font-weight:700;">'
  + '      7569844192'
  + '    </a>'
  + '    now.'
  + '  </p>'
    + '</div>'
    + '<div style="margin-bottom:15px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;">' + catHtml + '</div>'
    + '<div style="background:white;border-radius:12px;padding:12px;margin-bottom:20px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;box-shadow:0 4px 15px rgba(0,0,0,0.03);">' + areaHtml + '</div>'
    + '<style>.mp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:left;}'
    + '@media(max-width:1024px){.mp-grid{grid-template-columns:repeat(3,1fr);}}'
    + '@media(max-width:768px){.mp-grid{grid-template-columns:repeat(2,1fr);}}'
    + '@media(max-width:480px){.mp-grid{grid-template-columns:1fr;}}</style>'
    + '<div class="mp-grid">' + postsHtml + '</div>'
    + pageHtml
    + '</div></section>';

  if (window.observeNewElements) window.observeNewElements();
}

function mpSelectCat(cat) {
  window._activeMinipostCat = cat;
  
  // Set Gachibowli as default area when switching categories
  if (window._mpAreas && window._mpAreas.includes('Gachibowli')) {
    window._activeMinipostArea = 'Gachibowli';
  } else {
    window._activeMinipostArea = null;
  }
  
  window._mpPage = 1;
  mpDrawUI();
}

function mpSelectAreaByName(areaName) {
  window._activeMinipostArea = areaName;
  window._mpPage = 1;
  mpDrawUI();
}

// Keep old function as alias in case it's called anywhere
function mpSelectArea(idx) {
  var map = window._mpAreaMap;
  if (map && idx >= 0 && idx < map.length) {
    mpSelectAreaByName(map[idx]);
  }
}

function mpSelectPage(page) {
  window._mpPage = page;
  mpDrawUI();
}

async function renderMiniPosts() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:100px;text-align:center"><div class="loading-spinner"></div><p>Securely fetching posts...</p></div>';
  try {
    const [posts, areas] = await Promise.all([
      DB.miniposts.get(),
      DB.mp_areas.get()
    ]);
    window._mpRawData = posts;
    window._mpAreas = (areas || []).map(a => a.name);

    // Set default area
    if (window._mpAreas && window._mpAreas.includes('Gachibowli')) {
      window._activeMinipostArea = 'Gachibowli';
    } else {
      window._activeMinipostArea = null;
    }
    window._mpPage = 1;
    if (!window._activeMinipostCat) window._activeMinipostCat = 'House for Sale';
    mpDrawUI();
    if (window.observeNewElements) window.observeNewElements();
  } catch(e) {
    console.error(e);
    content.innerHTML = '<div style="padding:100px;text-align:center"><p style="color:red">Failed to load miniposts.</p></div>';
  }
}

async function loadGlobalSettings() {
  try {
    const settings = await DB.about.get();
    let logoStr = localStorage.getItem('re_site_logo');

    // Find the first document in DB that actually contains a logoUrl
    const logoDoc = settings.find(s => s.logoUrl);
    if (logoDoc) {
      logoStr = logoDoc.logoUrl;
      // Keep local sync fresh
      localStorage.setItem('re_site_logo', logoStr);
    }

    if (logoStr) {
      const img = document.getElementById('site-logo-img');
      const icon = document.getElementById('site-logo-icon');
      if (img && icon) {
        img.src = logoStr;
        img.style.display = 'block';
        icon.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error loading static settings:', err);
  }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  syncAdminUI();
  loadGlobalSettings();

  let path = location.hash.replace('#', '');
  if (!path) path = 'home';

  // Set hash if it was empty so the URL looks correct (wrapped in try/catch for some file:// restrictions)
  try {
    if (!location.hash) history.replaceState({ path: 'home' }, '', '#home');
  } catch (e) {
    console.warn("History API restricted on file:// protocol", e);
  }

  loadPage(path);
});

window.addEventListener('popstate', e => {
  let path = (e.state && e.state.path) || location.hash.replace('#', '');
  if (!path) path = 'home';
  loadPage(path);
});

// ==== Admin Button Shortcut (Ctrl/Cmd + Shift + Y) ====
document.addEventListener('keydown', (e) => {
  // Check for Ctrl or Cmd, Shift, and 'Y'/'y'
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyY') {
    e.preventDefault(); // Prevent default browser action

    // If a normal Google user is logged in, DO NOT allow revealing the admin button
    if (window.Auth && Auth.currentUser()) {
      return; 
    }

    // Toggle the admin button visibility class
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) {
      adminBtn.classList.toggle('show-admin-btn');
    }
  }
});
