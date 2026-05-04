/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { CLICKHOUSE_URL } from './config.js';
import {
  parseFragment,
  evaluatePassword,
  describeError,
  buildAlterUserSql,
  buildDropUserSql,
  isResetLinkValid,
} from './reset-password-logic.js';

const CREDENTIALS_KEY = 'clickhouse_credentials';

function basicAuthHeader(user, password) {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

async function clickhouseRequest(sql, user, password) {
  const response = await fetch(CLICKHOUSE_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(user, password),
      'Content-Type': 'text/plain',
    },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(text || `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return text;
}

function showError(message) {
  const errEl = document.getElementById('resetError');
  errEl.textContent = message;
  errEl.classList.add('visible');
}

function clearError() {
  const errEl = document.getElementById('resetError');
  errEl.textContent = '';
  errEl.classList.remove('visible');
}

function showSuccessAndRedirect() {
  document.getElementById('resetForm').hidden = true;
  const success = document.getElementById('resetSuccess');
  success.hidden = false;
  setTimeout(() => {
    window.location.href = '/delivery.html';
  }, 1200);
}

async function applyPasswordChange({
  user, resetUser, token, newPassword,
}) {
  await clickhouseRequest('SELECT 1', resetUser, token);
  await clickhouseRequest(buildAlterUserSql(user, newPassword), resetUser, token);
  try {
    await clickhouseRequest(buildDropUserSql(resetUser), resetUser, token);
  } catch (err) {
    // Best-effort: VALID UNTIL retires the temp user even if self-drop fails.
    // eslint-disable-next-line no-console
    console.warn('Failed to drop temp user (will expire via VALID UNTIL):', err);
  }
}

function applyStrength(input, meterEl, hintEl, result) {
  meterEl.classList.remove('s0', 's1', 's2', 's3', 's4');
  meterEl.classList.add(`s${result.score}`);
  // eslint-disable-next-line no-param-reassign -- updating UI element text is the purpose
  hintEl.textContent = result.hint;
  hintEl.classList.toggle('ok', result.valid);
  hintEl.classList.toggle('warn', !result.valid && input.value.length > 0);
}

function bindStrengthMeter(input, meterEl, hintEl, onChange) {
  const update = () => {
    const result = evaluatePassword(input.value);
    applyStrength(input, meterEl, hintEl, result);
    onChange(result);
  };
  input.addEventListener('input', update);
  update();
}

function init() {
  const params = parseFragment(window.location.hash);
  if (!isResetLinkValid(params)) {
    showError('Invalid reset link. Ask an admin to issue a fresh one.');
    document.getElementById('resetForm').hidden = true;
    return;
  }

  document.getElementById('usernameDisplay').textContent = params.user;
  // Some password managers want a username field for autofill; expose one.
  const hidden = document.createElement('input');
  hidden.type = 'text';
  hidden.name = 'username';
  hidden.autocomplete = 'username';
  hidden.value = params.user;
  hidden.style.display = 'none';
  document.getElementById('passwordForm').prepend(hidden);

  const newPassword = document.getElementById('newPassword');
  const confirmPassword = document.getElementById('confirmPassword');
  const submitBtn = document.getElementById('submitBtn');
  const meter = document.getElementById('strengthMeter');
  const hint = document.getElementById('strengthHint');

  let lastResult = evaluatePassword('');
  const refreshSubmit = () => {
    const match = newPassword.value === confirmPassword.value;
    submitBtn.disabled = !(lastResult.valid && match && newPassword.value.length > 0);
  };

  bindStrengthMeter(newPassword, meter, hint, (result) => {
    lastResult = result;
    refreshSubmit();
  });
  confirmPassword.addEventListener('input', refreshSubmit);

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    if (!lastResult.valid) {
      showError('Password does not meet the requirements.');
      return;
    }
    if (newPassword.value !== confirmPassword.value) {
      showError('Passwords do not match.');
      return;
    }
    submitBtn.disabled = true;
    const previousLabel = submitBtn.textContent;
    submitBtn.textContent = 'Setting password...';
    try {
      await applyPasswordChange({
        user: params.user,
        resetUser: params.resetUser,
        token: params.token,
        newPassword: newPassword.value,
      });
      localStorage.setItem(
        CREDENTIALS_KEY,
        JSON.stringify({ user: params.user, password: newPassword.value }),
      );
      showSuccessAndRedirect();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = previousLabel;
      showError(describeError(err));
    }
  });
}

function shouldAutoInit() {
  return typeof document !== 'undefined'
    && document.getElementById('passwordForm') !== null;
}

if (shouldAutoInit()) {
  init();
} else if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (shouldAutoInit()) { init(); }
  });
}
