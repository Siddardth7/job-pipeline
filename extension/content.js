// content.js — JobAgent content script
// Injected into Greenhouse and Lever pages

const PROFILE_KEY = 'jobagent_profile';

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FILL_FORM') {
    handleFillForm(msg).catch(e => {
      console.error('[JobAgent] FILL_FORM error:', e);
    });
    sendResponse({ ok: true }); // ack immediately; fill is async
  }
});

// ── Main fill handler ─────────────────────────────────────────────────────────

async function handleFillForm({ job, variant }) {
  // Load profile from storage
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const profile = result[PROFILE_KEY] || {};

  const url = window.location.href;
  const ats = detectAts(url);

  if (!ats) {
    console.warn('[JobAgent] Unrecognized ATS on this page');
    return;
  }

  // Fetch resume PDF via background service worker
  const compilerUrl = profile.compilerUrl || 'https://resume-compiler-1077806152183.us-central1.run.app';
  const pdfResponse = await chrome.runtime.sendMessage({
    type: 'FETCH_PDF',
    compilerUrl,
    variant,
    summary: profile.summary || '',
    skills_latex: profile.skills_latex || '',
    company: job.company,
    role: job.role,
  });

  let resumePdfBuffer = null;
  if (pdfResponse.ok) {
    resumePdfBuffer = pdfResponse.buffer;
  } else {
    console.warn('[JobAgent] PDF fetch failed:', pdfResponse.error);
  }

  // Fill the form using the right adapter
  const filled = [];
  const flagged = [];

  if (ats === 'greenhouse') {
    fillGreenhouse(profile, resumePdfBuffer, filled, flagged);
  } else if (ats === 'lever') {
    fillLever(profile, resumePdfBuffer, filled, flagged);
  }

  // Show confirm overlay
  showOverlay(filled, flagged, job, variant);
}

// ── ATS detection ─────────────────────────────────────────────────────────────

function detectAts(url) {
  if (/greenhouse\.io/.test(url)) return 'greenhouse';
  if (/lever\.co/.test(url)) return 'lever';
  return null;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setField(selector, value, filled, flagged, label) {
  const el = document.querySelector(selector);
  if (!el || !value) {
    if (label) flagged.push(label);
    return false;
  }
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  filled.push(label || selector);
  return true;
}

function fillSelectByLabel(labelRegex, answer, filled, flagged, label) {
  // Find all select elements whose preceding label text matches the regex
  const selects = document.querySelectorAll('select');
  for (const select of selects) {
    // Check associated label
    const id = select.id;
    const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
    const labelText = labelEl?.textContent || select.closest('label')?.textContent || '';
    if (!labelRegex.test(labelText)) continue;

    // Find option whose text matches the answer
    for (const opt of select.options) {
      if (opt.text.toLowerCase().includes(answer.toLowerCase())) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push(label || labelText.trim());
        return true;
      }
    }
    // Select exists but answer not found
    flagged.push(`⚠ ${label || labelText.trim()} — check manually`);
    return false;
  }
  return false;
}

function injectFile(inputEl, buffer, filename, mimeType) {
  if (!inputEl || !buffer) return false;
  try {
    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (e) {
    console.warn('[JobAgent] DataTransfer inject failed:', e.message);
    return false;
  }
}

// ── Greenhouse adapter ────────────────────────────────────────────────────────

function fillGreenhouse(profile, resumeBuffer, filled, flagged) {
  setField('#first_name', profile.firstName, filled, flagged, 'First Name');
  setField('#last_name', profile.lastName, filled, flagged, 'Last Name');
  setField('#email', profile.email, filled, flagged, 'Email');
  setField('#phone', profile.phone, filled, flagged, 'Phone');
  setField('input[name*="linkedin"], input[id*="linkedin"]', profile.linkedinUrl, filled, flagged, 'LinkedIn');

  // Work auth — label-text matching
  const authAnswer = profile.workAuth === 'authorized' ? 'Yes' : 'No';
  fillSelectByLabel(/authorized to work/i, authAnswer, filled, flagged, 'Work Auth');
  const sponsorAnswer = profile.needsSponsorship ? 'Yes' : 'No';
  fillSelectByLabel(/sponsor/i, sponsorAnswer, filled, flagged, 'Sponsorship');

  // Resume upload via DataTransfer
  if (resumeBuffer) {
    const resumeInput = document.querySelector('input[name="resume"]')
      || document.querySelector('input[type="file"][name*="resume"]')
      || document.querySelector('input[type="file"]');
    if (injectFile(resumeInput, resumeBuffer, 'resume.pdf', 'application/pdf')) {
      filled.push('Resume PDF');
    } else {
      flagged.push('⚠ Resume — upload manually');
    }
  } else {
    flagged.push('⚠ Resume — PDF fetch failed, upload manually');
  }
}

// ── Lever adapter ─────────────────────────────────────────────────────────────

function fillLever(profile, resumeBuffer, filled, flagged) {
  const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  setField('input[name="name"]', fullName, filled, flagged, 'Full Name');
  setField('input[name="email"]', profile.email, filled, flagged, 'Email');
  setField('input[name="phone"]', profile.phone, filled, flagged, 'Phone');
  setField('input[name="urls[LinkedIn]"]', profile.linkedinUrl, filled, flagged, 'LinkedIn');

  // Resume upload
  const fileInputs = document.querySelectorAll('input[type="file"]');
  const resumeInput = Array.from(fileInputs).find(i => !i.name?.includes('cover')) || fileInputs[0];
  if (resumeBuffer && injectFile(resumeInput, resumeBuffer, 'resume.pdf', 'application/pdf')) {
    filled.push('Resume PDF');
  } else {
    flagged.push('⚠ Resume — upload manually');
  }
}

// ── Confirm overlay ───────────────────────────────────────────────────────────

function showOverlay(filled, flagged, job, variant) {
  // Remove any existing overlay
  document.getElementById('__jobagent_overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__jobagent_overlay';
  overlay.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    width: 280px; background: #fff; border: 2px solid #6d28d9;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; color: #111827; overflow: hidden;
  `;

  const filledHtml = filled.map(f => `<div style="color:#15803d;">✓ ${f}</div>`).join('');
  const flaggedHtml = flagged.map(f => `<div style="color:#d97706;">${f}</div>`).join('');

  overlay.innerHTML = `
    <div style="background:#6d28d9;color:#fff;padding:10px 14px;font-weight:700;font-size:13px;display:flex;justify-content:space-between;align-items:center;">
      🧩 JobAgent — Review &amp; Submit
      <span id="__ja_close" style="cursor:pointer;font-size:16px;line-height:1;">×</span>
    </div>
    <div style="padding:12px 14px;">
      <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;">${job.company} · ${job.role}</div>
      <div style="font-size:10px;color:#6b7280;margin-bottom:8px;">Variant: ${variant}</div>
      <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px;font-size:12px;">
        ${filledHtml}
        ${flaggedHtml}
      </div>
      <button id="__ja_submit" style="width:100%;padding:10px;background:#15803d;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">
        ✅ Submit Application
      </button>
      <button id="__ja_cancel" style="width:100%;padding:7px;background:transparent;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;font-size:11px;cursor:pointer;font-family:inherit;margin-top:6px;">
        ✗ Cancel
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('__ja_close').onclick = () => overlay.remove();
  document.getElementById('__ja_cancel').onclick = () => overlay.remove();

  document.getElementById('__ja_submit').onclick = async () => {
    const btn = document.getElementById('__ja_submit');
    btn.textContent = 'Submitting...';
    btn.disabled = true;

    // Click the real submit button
    const submitBtn = document.querySelector(
      'input[type="submit"], button[type="submit"], button[data-submit]'
    );
    if (submitBtn) {
      submitBtn.click();
    }

    // Wait for URL change or success element (max 8s)
    const submitted = await waitForSuccess(5000);
    if (submitted) {
      overlay.innerHTML = `
        <div style="padding:20px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">✅</div>
          <div style="font-weight:700;color:#15803d;">Application submitted!</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px;">Marking as Applied in JobAgent...</div>
        </div>
      `;
      // Notify background to write back to Supabase
      await chrome.runtime.sendMessage({
        type: 'MARK_APPLIED',
        job,
        resumeVariant: variant,
      });
      setTimeout(() => overlay.remove(), 3000);
    } else {
      btn.textContent = '✅ Submit Application';
      btn.disabled = false;
      const note = document.createElement('div');
      note.style.cssText = 'color:#dc2626;font-size:11px;margin-top:6px;text-align:center;';
      note.textContent = 'Could not detect submission. Submit manually, then close this overlay.';
      btn.after(note);
    }
  };
}

// ── Success detection ─────────────────────────────────────────────────────────

function waitForSuccess(timeoutMs) {
  return new Promise(resolve => {
    const startUrl = window.location.href;
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 300;
      // URL changed = probably navigated to confirmation page
      if (window.location.href !== startUrl) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      // Greenhouse success message
      if (document.querySelector('.application-confirmation, [class*="confirmation"], [class*="success"]')) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (elapsed >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 300);
  });
}
